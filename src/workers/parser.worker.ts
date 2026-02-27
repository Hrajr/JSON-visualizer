/**
 * Parser Web Worker
 *
 * Reads data from a File object OR a URL (fetch streaming).
 * Parses concatenated JSON objects and sends batches back to main thread.
 * Supports a maxRecords limit to prevent memory exhaustion on huge files.
 *
 * Messages IN:
 *   { type: 'start', file: File, batchSize: number, maxRecords: number }
 *   { type: 'start-url', url: string, batchSize: number, maxRecords: number }
 *   { type: 'cancel' }
 *
 * Messages OUT:
 *   { type: 'progress', bytesRead, totalBytes, recordsParsed }
 *   { type: 'batch', records, keys, searchStrings, startIndex }
 *   { type: 'error', error: ParseError }
 *   { type: 'done', totalRecords, totalErrors }
 *   { type: 'limit-reached', totalRecords }
 *   { type: 'cancelled' }
 */

import { extractJsonObjects, buildSearchString } from '../utils/parser'
import type { JsonRecord, ParseError } from '../types'

let cancelled = false

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

function createContext(batchSize: number, maxRecords: number, totalBytes: number): ParseContext {
  return {
    batchSize,
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

function flushBatch(ctx: ParseContext) {
  if (ctx.batchRecords.length === 0) return
  self.postMessage({
    type: 'batch',
    records: ctx.batchRecords,
    keys: Array.from(ctx.batchKeys),
    searchStrings: ctx.batchSearchStrings,
    startIndex: ctx.batchStartIndex,
  })
  ctx.batchStartIndex = ctx.recordsParsed
  ctx.batchRecords = []
  ctx.batchKeys = new Set()
  ctx.batchSearchStrings = []
}

/** Process a chunk of text data. Returns true if limit reached. */
function processChunk(ctx: ParseContext, chunk: string, chunkByteLength: number): boolean {
  ctx.bytesRead += chunkByteLength
  const text = ctx.remainder + chunk
  const result = extractJsonObjects(text)
  ctx.remainder = result.remainder

  for (const jsonStr of result.jsonStrings) {
    // Check record limit
    if (ctx.maxRecords > 0 && ctx.recordsParsed >= ctx.maxRecords) {
      flushBatch(ctx)
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

      if (ctx.batchRecords.length >= ctx.batchSize) {
        flushBatch(ctx)
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

  // Send progress
  self.postMessage({
    type: 'progress',
    bytesRead: ctx.bytesRead,
    totalBytes: ctx.totalBytes,
    recordsParsed: ctx.recordsParsed,
  })

  return false
}

function finalize(ctx: ParseContext) {
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

  flushBatch(ctx)

  self.postMessage({
    type: 'done',
    totalRecords: ctx.recordsParsed,
    totalErrors: ctx.totalErrors,
  })
}

async function parseFromFile(file: File, batchSize: number, maxRecords: number) {
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
        const chunk = decoder.decode(value, { stream: true })
        if (processChunk(ctx, chunk, value.byteLength)) return
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
      if (processChunk(ctx, text, end - offset)) return
      offset = end
    }
  }

  finalize(ctx)
}

async function parseFromUrl(url: string, batchSize: number, maxRecords: number) {
  try {
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
      // No streaming – fallback to reading all text (may fail on huge files)
      const text = await response.text()
      processChunk(ctx, text, new TextEncoder().encode(text).length)
      finalize(ctx)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')

    while (true) {
      if (cancelled) { reader.cancel(); self.postMessage({ type: 'cancelled' }); return }
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      if (processChunk(ctx, chunk, value.byteLength)) { reader.cancel(); return }
    }

    finalize(ctx)
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
