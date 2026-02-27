/**
 * Parser Web Worker
 *
 * Reads data from a File object OR a URL (fetch streaming).
 * Parses concatenated JSON objects and writes them DIRECTLY to IndexedDB
 * inside this worker – records never touch the main thread.
 *
 * Includes automatic JSON repair for common issues (trailing commas,
 * missing closing brackets, control characters).
 *
 * Messages IN:
 *   { type: 'start', file, batchSize, maxRecords, dbName }
 *   { type: 'start-url', url, batchSize, maxRecords, dbName }
 *   { type: 'cancel' }
 *
 * Messages OUT:
 *   { type: 'progress', bytesRead, totalBytes, recordsParsed }
 *   { type: 'keys', keys }
 *   { type: 'db-flushed', count }
 *   { type: 'error', error }
 *   { type: 'done', totalRecords, totalErrors }
 *   { type: 'limit-reached', totalRecords }
 *   { type: 'cancelled' }
 */

import { extractJsonObjects } from '../utils/parser'
import type { JsonRecord, ParseError } from '../types'

const DB_VERSION = 1
const RECORDS_STORE = 'records'
const META_STORE = 'meta'

let cancelled = false
let db: IDBDatabase | null = null
let currentDBName = ''

// ── IndexedDB helpers ──

function openWorkerDB(dbName: string): Promise<IDBDatabase> {
  if (db && currentDBName === dbName) return Promise.resolve(db)
  if (db) { db.close(); db = null }
  currentDBName = dbName
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(RECORDS_STORE)) d.createObjectStore(RECORDS_STORE)
      if (!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE)
    }
    req.onsuccess = () => { db = req.result; resolve(db) }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error(`Worker IDB open blocked: ${dbName}`))
  })
}

function closeWorkerDB(): void {
  if (db) { db.close(); db = null; currentDBName = '' }
}

/** Delete ALL jv-ds-* databases except `keepName` to free IDB quota. */
async function deleteOldJvDatabases(keepName: string): Promise<void> {
  if (typeof indexedDB.databases !== 'function') return
  try {
    const allDBs = await indexedDB.databases()
    for (const info of allDBs) {
      if (info.name && info.name.startsWith('jv-ds-') && info.name !== keepName) {
        await new Promise<void>(resolve => {
          const req = indexedDB.deleteDatabase(info.name!)
          req.onsuccess = () => resolve()
          req.onerror = () => resolve()
          req.onblocked = () => {
            // Force-resolve after timeout; blocker is gone by now ideally
            const t = setTimeout(resolve, 3000)
            req.onsuccess = () => { clearTimeout(t); resolve() }
          }
        })
      }
    }
  } catch { /* best effort */ }
}

function clearDB(dbName: string): Promise<void> {
  return openWorkerDB(dbName).then(d => new Promise((resolve, reject) => {
    const tx = d.transaction([RECORDS_STORE, META_STORE], 'readwrite')
    tx.objectStore(RECORDS_STORE).clear()
    tx.objectStore(META_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

function writeBatchDirect(
  startIndex: number,
  records: JsonRecord[],
): Promise<void> {
  if (!db) return Promise.reject(new Error('DB not open'))
  const d = db
  return new Promise((resolve, reject) => {
    const tx = d.transaction(RECORDS_STORE, 'readwrite')
    const store = tx.objectStore(RECORDS_STORE)
    for (let i = 0; i < records.length; i++) {
      store.put(records[i], startIndex + i)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Write batch with automatic retry using progressively smaller sub-batches on quota errors. */
async function writeBatch(
  startIndex: number,
  records: JsonRecord[],
): Promise<void> {
  try {
    await writeBatchDirect(startIndex, records)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isQuota = msg.toLowerCase().includes('quota')
    if (isQuota && records.length > 1) {
      // Progressively halve the batch size until we're writing single records
      const half = Math.max(1, Math.floor(records.length / 2))
      for (let i = 0; i < records.length; i += half) {
        const slice = records.slice(i, Math.min(i + half, records.length))
        await writeBatch(startIndex + i, slice) // recursive – will keep halving on failure
      }
    } else if (isQuota && records.length === 1) {
      // Even a single record exceeds quota – report non-fatal error and skip
      self.postMessage({
        type: 'error',
        error: {
          recordIndex: startIndex,
          snippet: JSON.stringify(records[0]).substring(0, 200),
          message: 'IDB quota exceeded – record skipped',
        },
      })
    } else {
      throw err
    }
  }
}

// ── JSON repair ──

/**
 * Try to repair broken JSON. Returns parsed object or null.
 * Handles: trailing commas, missing closing braces/brackets, control characters.
 */
function tryRepairJson(jsonStr: string): JsonRecord | null {
  // 1. Remove trailing commas before } or ]
  let fixed = jsonStr.replace(/,(\s*[}\]])/g, '$1')
  try { return JSON.parse(fixed) as JsonRecord } catch { /* continue */ }

  // 2. Fix missing closing braces/brackets
  let braceCount = 0
  let bracketCount = 0
  let inStr = false
  let esc = false
  for (const ch of fixed) {
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') braceCount++
    else if (ch === '}') braceCount--
    else if (ch === '[') bracketCount++
    else if (ch === ']') bracketCount--
  }
  if (braceCount > 0 || bracketCount > 0) {
    let repaired = fixed
    for (let i = 0; i < bracketCount; i++) repaired += ']'
    for (let i = 0; i < braceCount; i++) repaired += '}'
    try { return JSON.parse(repaired) as JsonRecord } catch { /* continue */ }
    // Try with trailing comma removal on the repaired version
    repaired = repaired.replace(/,(\s*[}\]])/g, '$1')
    try { return JSON.parse(repaired) as JsonRecord } catch { /* continue */ }
  }

  // 3. Remove control characters (except whitespace)
  const cleaned = jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  if (cleaned !== jsonStr) {
    try { return JSON.parse(cleaned) as JsonRecord } catch { /* continue */ }
    const cleanedFixed = cleaned.replace(/,(\s*[}\]])/g, '$1')
    try { return JSON.parse(cleanedFixed) as JsonRecord } catch { /* continue */ }
  }

  return null
}

// ── Parse context ──

interface ParseContext {
  dbName: string
  maxRecords: number
  totalBytes: number
  bytesRead: number
  recordsParsed: number
  totalErrors: number
  remainder: string
  batchRecords: JsonRecord[]
  batchKeys: Set<string>
  batchStartIndex: number
}

const IDB_FLUSH_SIZE = 50

function createContext(dbName: string, maxRecords: number, totalBytes: number): ParseContext {
  return {
    dbName,
    maxRecords,
    totalBytes,
    bytesRead: 0,
    recordsParsed: 0,
    totalErrors: 0,
    remainder: '',
    batchRecords: [],
    batchKeys: new Set(),
    batchStartIndex: 0,
  }
}

async function flushBatch(ctx: ParseContext): Promise<void> {
  if (ctx.batchRecords.length === 0) return

  const keys = Array.from(ctx.batchKeys)
  const records = ctx.batchRecords
  const startIdx = ctx.batchStartIndex

  ctx.batchStartIndex = ctx.recordsParsed
  ctx.batchRecords = []
  ctx.batchKeys = new Set()

  await writeBatch(startIdx, records)

  if (keys.length > 0) {
    self.postMessage({ type: 'keys', keys })
  }
  self.postMessage({ type: 'db-flushed', count: startIdx + records.length })
}

function addRecord(ctx: ParseContext, record: JsonRecord) {
  ctx.batchRecords.push(record)
  for (const key of Object.keys(record)) ctx.batchKeys.add(key)
  ctx.recordsParsed++
}

async function processChunk(ctx: ParseContext, chunk: string, chunkByteLength: number): Promise<boolean> {
  ctx.bytesRead += chunkByteLength
  const text = ctx.remainder + chunk
  const result = extractJsonObjects(text)
  ctx.remainder = result.remainder

  for (const jsonStr of result.jsonStrings) {
    if (ctx.maxRecords > 0 && ctx.recordsParsed >= ctx.maxRecords) {
      await flushBatch(ctx)
      self.postMessage({ type: 'limit-reached', totalRecords: ctx.recordsParsed })
      return true
    }

    try {
      const record = JSON.parse(jsonStr) as JsonRecord
      addRecord(ctx, record)
    } catch {
      // Try automatic repair
      const repaired = tryRepairJson(jsonStr)
      if (repaired) {
        addRecord(ctx, repaired)
      } else {
        ctx.totalErrors++
        const error: ParseError = {
          recordIndex: ctx.recordsParsed,
          snippet: jsonStr.substring(0, 200),
          message: 'Malformed JSON (auto-repair failed)',
        }
        self.postMessage({ type: 'error', error })
      }
    }

    if (ctx.batchRecords.length >= IDB_FLUSH_SIZE) {
      await flushBatch(ctx)
    }
  }

  self.postMessage({
    type: 'progress',
    bytesRead: ctx.bytesRead,
    totalBytes: ctx.totalBytes,
    recordsParsed: ctx.recordsParsed,
  })

  return false
}

async function finalize(ctx: ParseContext) {
  if (ctx.remainder.trim().length > 0) {
    if (ctx.maxRecords <= 0 || ctx.recordsParsed < ctx.maxRecords) {
      try {
        const record = JSON.parse(ctx.remainder) as JsonRecord
        addRecord(ctx, record)
      } catch {
        const repaired = tryRepairJson(ctx.remainder)
        if (repaired) {
          addRecord(ctx, repaired)
        } else {
          ctx.totalErrors++
          self.postMessage({ type: 'error', error: {
            recordIndex: ctx.recordsParsed,
            snippet: ctx.remainder.substring(0, 200),
            message: 'Incomplete or malformed JSON at end of file (repair failed)',
          } })
        }
      }
    }
  }

  await flushBatch(ctx)
  closeWorkerDB()

  self.postMessage({
    type: 'done',
    totalRecords: ctx.recordsParsed,
    totalErrors: ctx.totalErrors,
  })
}

// ── Parse entry points ──

async function parseFromFile(file: File, maxRecords: number, dbName: string) {
  try {
    // Delete any leftover databases from previous sessions to free IDB quota
    await deleteOldJvDatabases(dbName)
    await clearDB(dbName)
    const ctx = createContext(dbName, maxRecords, file.size)

    if (typeof file.stream === 'function') {
      const reader = file.stream().getReader()
      const decoder = new TextDecoder('utf-8')
      try {
        while (true) {
          if (cancelled) { reader.cancel(); closeWorkerDB(); self.postMessage({ type: 'cancelled' }); return }
          const { done, value } = await reader.read()
          if (done) break
          if (await processChunk(ctx, decoder.decode(value, { stream: true }), value.byteLength)) return
        }
      } catch (err) {
        closeWorkerDB()
        self.postMessage({ type: 'error', error: {
          recordIndex: -1, snippet: '',
          message: err instanceof Error ? err.message : String(err),
        } })
        return
      }
    } else {
      const CHUNK_SIZE = 2 * 1024 * 1024
      let offset = 0
      while (offset < file.size) {
        if (cancelled) { closeWorkerDB(); self.postMessage({ type: 'cancelled' }); return }
        const end = Math.min(offset + CHUNK_SIZE, file.size)
        const text = await file.slice(offset, end).text()
        if (await processChunk(ctx, text, end - offset)) return
        offset = end
      }
    }

    await finalize(ctx)
  } catch (err) {
    closeWorkerDB()
    self.postMessage({ type: 'error', error: {
      recordIndex: -1, snippet: '',
      message: 'File parse failed: ' + (err instanceof Error ? err.message : String(err)),
    } })
  }
}

async function parseFromUrl(url: string, maxRecords: number, dbName: string) {
  try {
    // Delete any leftover databases from previous sessions to free IDB quota
    await deleteOldJvDatabases(dbName)
    await clearDB(dbName)
    const response = await fetch(url)
    if (!response.ok) {
      self.postMessage({ type: 'error', error: {
        recordIndex: -1, snippet: '',
        message: `Failed to fetch: ${response.status} ${response.statusText}. Make sure the file exists in the public/data/ folder.`,
      } })
      return
    }

    const contentLength = response.headers.get('content-length')
    const totalBytesVal = contentLength ? parseInt(contentLength, 10) : 0
    const ctx = createContext(dbName, maxRecords, totalBytesVal)

    if (!response.body) {
      const text = await response.text()
      await processChunk(ctx, text, new TextEncoder().encode(text).length)
      await finalize(ctx)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')

    while (true) {
      if (cancelled) { reader.cancel(); closeWorkerDB(); self.postMessage({ type: 'cancelled' }); return }
      const { done, value } = await reader.read()
      if (done) break
      if (await processChunk(ctx, decoder.decode(value, { stream: true }), value.byteLength)) {
        reader.cancel(); return
      }
    }

    await finalize(ctx)
  } catch (err) {
    closeWorkerDB()
    self.postMessage({ type: 'error', error: {
      recordIndex: -1, snippet: '',
      message: err instanceof Error ? err.message : String(err),
    } })
  }
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'cancel') {
    cancelled = true
    return
  }

  try {
    if (msg.type === 'start') {
      cancelled = false
      await parseFromFile(msg.file, msg.maxRecords || 0, msg.dbName)
    }

    if (msg.type === 'start-url') {
      cancelled = false
      await parseFromUrl(msg.url, msg.maxRecords || 0, msg.dbName)
    }
  } catch (err) {
    closeWorkerDB()
    self.postMessage({ type: 'error', error: {
      recordIndex: -1, snippet: '',
      message: 'Worker error: ' + (err instanceof Error ? err.message : String(err)),
    } })
  }
}
