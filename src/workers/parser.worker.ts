/**
 * Parser Web Worker
 *
 * Reads data from a File object OR a URL (fetch streaming).
 * Parses concatenated JSON objects and sends them to the server-side
 * SQLite database via HTTP POST.
 *
 * Includes automatic JSON repair for common issues (trailing commas,
 * missing closing brackets, control characters).
 *
 * Messages IN:
 *   { type: 'start', file, batchSize, maxRecords, datasetId }
 *   { type: 'start-url', url, batchSize, maxRecords, datasetId }
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

let cancelled = false

// ── Server API helper ──

async function postRecordsToServer(
  datasetId: string,
  records: JsonRecord[],
  startIndex: number,
): Promise<void> {
  const res = await fetch(`/api/db/datasets/${datasetId}/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records, startIndex }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Server insert failed (${res.status}): ${text}`)
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
  datasetId: string
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

/** Flush batch size – send records to server in chunks of 500. */
const FLUSH_SIZE = 500

function createContext(datasetId: string, maxRecords: number, totalBytes: number): ParseContext {
  return {
    datasetId,
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

  await postRecordsToServer(ctx.datasetId, records, startIdx)

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

    if (ctx.batchRecords.length >= FLUSH_SIZE) {
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

  self.postMessage({
    type: 'done',
    totalRecords: ctx.recordsParsed,
    totalErrors: ctx.totalErrors,
  })
}

// ── Parse entry points ──

async function parseFromFile(file: File, maxRecords: number, datasetId: string) {
  try {
    const ctx = createContext(datasetId, maxRecords, file.size)

    if (typeof file.stream === 'function') {
      const reader = file.stream().getReader()
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
        } })
        return
      }
    } else {
      const CHUNK_SIZE = 2 * 1024 * 1024
      let offset = 0
      while (offset < file.size) {
        if (cancelled) { self.postMessage({ type: 'cancelled' }); return }
        const end = Math.min(offset + CHUNK_SIZE, file.size)
        const text = await file.slice(offset, end).text()
        if (await processChunk(ctx, text, end - offset)) return
        offset = end
      }
    }

    await finalize(ctx)
  } catch (err) {
    self.postMessage({ type: 'error', error: {
      recordIndex: -1, snippet: '',
      message: 'File parse failed: ' + (err instanceof Error ? err.message : String(err)),
    } })
  }
}

async function parseFromUrl(url: string, maxRecords: number, datasetId: string) {
  try {
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
    const ctx = createContext(datasetId, maxRecords, totalBytesVal)

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
      if (await processChunk(ctx, decoder.decode(value, { stream: true }), value.byteLength)) {
        reader.cancel(); return
      }
    }

    await finalize(ctx)
  } catch (err) {
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
      await parseFromFile(msg.file, msg.maxRecords || 0, msg.datasetId)
    }

    if (msg.type === 'start-url') {
      cancelled = false
      await parseFromUrl(msg.url, msg.maxRecords || 0, msg.datasetId)
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: {
      recordIndex: -1, snippet: '',
      message: 'Worker error: ' + (err instanceof Error ? err.message : String(err)),
    } })
  }
}
