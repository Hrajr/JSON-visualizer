/**
 * Parser Web Worker
 *
 * Reads data from a File object OR a URL (fetch streaming).
 * Parses concatenated JSON objects and writes them DIRECTLY to IndexedDB
 * inside this worker – records never touch the main thread, keeping memory
 * usage constant regardless of file size.
 *
 * Messages IN:
 *   { type: 'start', file: File, batchSize: number, maxRecords: number }
 *   { type: 'start-url', url: string, batchSize: number, maxRecords: number }
 *   { type: 'cancel' }
 *
 * Messages OUT:
 *   { type: 'progress', bytesRead, totalBytes, recordsParsed }
 *   { type: 'keys', keys: string[] }             — new keys discovered in batch
 *   { type: 'db-flushed', count: number }         — records committed to IDB
 *   { type: 'error', error: ParseError }
 *   { type: 'done', totalRecords, totalErrors }
 *   { type: 'limit-reached', totalRecords }
 *   { type: 'cancelled' }
 */

import { extractJsonObjects, buildSearchString } from '../utils/parser'
import type { JsonRecord, ParseError } from '../types'

const DB_NAME = 'json-visualizer-db'
const DB_VERSION = 1
const RECORDS_STORE = 'records'
const META_STORE = 'meta'

let cancelled = false
let db: IDBDatabase | null = null

/** Open IndexedDB inside the worker (workers have full IDB access). */
function openWorkerDB(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(RECORDS_STORE)) d.createObjectStore(RECORDS_STORE)
      if (!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE)
    }
    req.onsuccess = () => { db = req.result; resolve(db) }
    req.onerror = () => reject(req.error)
  })
}

function clearDB(): Promise<void> {
  return openWorkerDB().then(d => new Promise((resolve, reject) => {
    const tx = d.transaction([RECORDS_STORE, META_STORE], 'readwrite')
    tx.objectStore(RECORDS_STORE).clear()
    tx.objectStore(META_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

/** Write a batch of records + meta to IndexedDB. */
function writeBatch(
  startIndex: number,
  records: JsonRecord[],
  searchStrings: string[],
): Promise<void> {
  return openWorkerDB().then(d => new Promise((resolve, reject) => {
    const tx = d.transaction([RECORDS_STORE, META_STORE], 'readwrite')
    const recStore = tx.objectStore(RECORDS_STORE)
    const metaStore = tx.objectStore(META_STORE)

    for (let i = 0; i < records.length; i++) {
      const idx = startIndex + i
      recStore.put(records[i], idx)

      const record = records[i]
      const nonEmptyKeys = Object.entries(record)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k]) => k)
      const keysStr = nonEmptyKeys.length > 0 ? '\t' + nonEmptyKeys.join('\t') + '\t' : ''
      metaStore.put({ s: searchStrings[i], k: keysStr }, idx)
    }

    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

interface ParseContext {
  batchSize: number
  maxRecords: number
  totalBytes: number
  bytesRead: number
  recordsParsed: number
  totalErrors: number
  remainder: string
  batchRecords: JsonRecord[]
  batchKeys: Set<string>
  batchSearchStrings: string[]
  batchStartIndex: number
}

/** How many records to accumulate before flushing to IDB. */
const IDB_FLUSH_SIZE = 2000

function createContext(batchSize: number, maxRecords: number, totalBytes: number): ParseContext {
  return {
    batchSize: IDB_FLUSH_SIZE, // override caller batchSize – we flush to IDB on our own schedule
    maxRecords,
    totalBytes,
    bytesRead: 0,
    recordsParsed: 0,
    totalErrors: 0,
    remainder: '',
    batchRecords: [],
    batchKeys: new Set(),
    batchSearchStrings: [],
    batchStartIndex: 0,
  }
}

/** Flush accumulated records to IndexedDB and notify main thread. */
async function flushBatch(ctx: ParseContext): Promise<void> {
  if (ctx.batchRecords.length === 0) return

  const keys = Array.from(ctx.batchKeys)
  const records = ctx.batchRecords
  const ss = ctx.batchSearchStrings
  const startIdx = ctx.batchStartIndex

  // Reset batch state immediately so new records can accumulate
  ctx.batchStartIndex = ctx.recordsParsed
  ctx.batchRecords = []
  ctx.batchKeys = new Set()
  ctx.batchSearchStrings = []

  // Write to IndexedDB (on-disk, no main-thread memory)
  await writeBatch(startIdx, records, ss)

  // Tell main thread only about new keys (tiny) and how many were committed
  if (keys.length > 0) {
    self.postMessage({ type: 'keys', keys })
  }
  self.postMessage({ type: 'db-flushed', count: startIdx + records.length })
}

/** Process a chunk of text data. Returns true if limit reached. */
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
      ctx.batchRecords.push(record)
      for (const key of Object.keys(record)) {
        ctx.batchKeys.add(key)
      }
      ctx.batchSearchStrings.push(buildSearchString(record))
      ctx.recordsParsed++

      if (ctx.batchRecords.length >= IDB_FLUSH_SIZE) {
        await flushBatch(ctx)
      }
    } catch (parseErr) {
      ctx.totalErrors++
      const error: ParseError = {
        recordIndex: ctx.recordsParsed,
        snippet: jsonStr.substring(0, 200),
        message: parseErr instanceof Error ? parseErr.message : String(parseErr),
      }
      self.postMessage({ type: 'error', error })
    }
  }

  // Send progress (lightweight – just numbers)
  self.postMessage({
    type: 'progress',
    bytesRead: ctx.bytesRead,
    totalBytes: ctx.totalBytes,
    recordsParsed: ctx.recordsParsed,
  })

  return false
}

async function finalize(ctx: ParseContext) {
  // Handle any remaining text
  if (ctx.remainder.trim().length > 0) {
    if (ctx.maxRecords <= 0 || ctx.recordsParsed < ctx.maxRecords) {
      try {
        const record = JSON.parse(ctx.remainder) as JsonRecord
        ctx.batchRecords.push(record)
        for (const key of Object.keys(record)) {
          ctx.batchKeys.add(key)
        }
        ctx.batchSearchStrings.push(buildSearchString(record))
        ctx.recordsParsed++
      } catch {
        ctx.totalErrors++
        const error: ParseError = {
          recordIndex: ctx.recordsParsed,
          snippet: ctx.remainder.substring(0, 200),
          message: 'Incomplete or malformed JSON object at end of file',
        }
        self.postMessage({ type: 'error', error })
      }
    }
  }

  await flushBatch(ctx)

  self.postMessage({
    type: 'done',
    totalRecords: ctx.recordsParsed,
    totalErrors: ctx.totalErrors,
  })
}

async function parseFromFile(file: File, batchSize: number, maxRecords: number) {
  await clearDB()
  const ctx = createContext(batchSize, maxRecords, file.size)

  if (typeof file.stream === 'function') {
    const stream = file.stream()
    const reader = stream.getReader()
    const decoder = new TextDecoder('utf-8')

    try {
      while (true) {
        if (cancelled) { reader.cancel(); self.postMessage({ type: 'cancelled' }); return }
        const { done, value } = await reader.read()
        if (done) break
        if (await processChunk(ctx, decoder.decode(value, { stream: true }), value.byteLength)) return
      }
    } catch (err) {
      self.postMessage({ type: 'error', error: {
        recordIndex: -1, snippet: '',
        message: err instanceof Error ? err.message : String(err),
      }})
      return
    }
  } else {
    // Fallback slice-based reading
    const CHUNK_SIZE = 2 * 1024 * 1024
    let offset = 0
    while (offset < file.size) {
      if (cancelled) { self.postMessage({ type: 'cancelled' }); return }
      const end = Math.min(offset + CHUNK_SIZE, file.size)
      const blob = file.slice(offset, end)
      const text = await blob.text()
      if (await processChunk(ctx, text, end - offset)) return
      offset = end
    }
  }

  await finalize(ctx)
}

async function parseFromUrl(url: string, batchSize: number, maxRecords: number) {
  try {
    await clearDB()
    const response = await fetch(url)
    if (!response.ok) {
      self.postMessage({ type: 'error', error: {
        recordIndex: -1, snippet: '',
        message: `Failed to fetch: ${response.status} ${response.statusText}. Make sure the file exists in the public/data/ folder.`,
      }})
      return
    }

    const contentLength = response.headers.get('content-length')
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0
    const ctx = createContext(batchSize, maxRecords, totalBytes)

    if (!response.body) {
      const text = await response.text()
      await processChunk(ctx, text, new TextEncoder().encode(text).length)
      await finalize(ctx)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')

    while (true) {
      if (cancelled) { reader.cancel(); self.postMessage({ type: 'cancelled' }); return }
      const { done, value } = await reader.read()
      if (done) break
      if (await processChunk(ctx, decoder.decode(value, { stream: true }), value.byteLength)) { reader.cancel(); return }
    }

    await finalize(ctx)
  } catch (err) {
    self.postMessage({ type: 'error', error: {
      recordIndex: -1, snippet: '',
      message: err instanceof Error ? err.message : String(err),
    }})
  }
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'cancel') {
    cancelled = true
    return
  }

  if (msg.type === 'start') {
    cancelled = false
    await parseFromFile(msg.file, msg.batchSize || 200, msg.maxRecords || 0)
  }

  if (msg.type === 'start-url') {
    cancelled = false
    await parseFromUrl(msg.url, msg.batchSize || 200, msg.maxRecords || 0)
  }
}
