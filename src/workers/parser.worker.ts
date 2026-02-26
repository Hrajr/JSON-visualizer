/**
 * Parser Web Worker
 *
 * Receives a File object, reads it in chunks using streaming,
 * parses concatenated JSON objects, and sends batches back to main thread.
 *
 * Messages IN:  { type: 'start', file: File, batchSize: number }
 *               { type: 'cancel' }
 *
 * Messages OUT: { type: 'progress', bytesRead, totalBytes, recordsParsed }
 *               { type: 'batch', records, keys, searchStrings, startIndex }
 *               { type: 'error', error: ParseError }
 *               { type: 'done', totalRecords, totalErrors }
 *               { type: 'cancelled' }
 */

import { extractJsonObjects, buildSearchString } from '../utils/parser'
import type { JsonRecord, ParseError } from '../types'

let cancelled = false

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'cancel') {
    cancelled = true
    return
  }

  if (msg.type === 'start') {
    cancelled = false
    const file: File = msg.file
    const batchSize: number = msg.batchSize || 200
    const totalBytes = file.size

    let bytesRead = 0
    let recordsParsed = 0
    let totalErrors = 0
    let remainder = ''

    // Accumulate a batch before sending
    let batchRecords: JsonRecord[] = []
    let batchKeys: Set<string> = new Set()
    let batchSearchStrings: string[] = []
    let batchStartIndex = 0

    const CHUNK_SIZE = 2 * 1024 * 1024 // 2 MB chunks

    function flushBatch() {
      if (batchRecords.length === 0) return
      self.postMessage({
        type: 'batch',
        records: batchRecords,
        keys: Array.from(batchKeys),
        searchStrings: batchSearchStrings,
        startIndex: batchStartIndex,
      })
      batchStartIndex = recordsParsed
      batchRecords = []
      batchKeys = new Set()
      batchSearchStrings = []
    }

    try {
      // Use File.stream() for modern browsers, fallback to slice-based reading
      if (typeof file.stream === 'function') {
        const stream = file.stream()
        const reader = stream.getReader()
        const decoder = new TextDecoder('utf-8')

        while (true) {
          if (cancelled) {
            reader.cancel()
            self.postMessage({ type: 'cancelled' })
            return
          }

          const { done, value } = await reader.read()
          if (done) break

          bytesRead += value.byteLength
          const chunk = decoder.decode(value, { stream: true })
          const text = remainder + chunk

          const result = extractJsonObjects(text)
          remainder = result.remainder

          for (const jsonStr of result.jsonStrings) {
            try {
              const record = JSON.parse(jsonStr) as JsonRecord
              batchRecords.push(record)
              for (const key of Object.keys(record)) {
                batchKeys.add(key)
              }
              batchSearchStrings.push(buildSearchString(record))
              recordsParsed++

              if (batchRecords.length >= batchSize) {
                flushBatch()
              }
            } catch (parseErr) {
              totalErrors++
              const error: ParseError = {
                recordIndex: recordsParsed,
                snippet: jsonStr.substring(0, 200),
                message: parseErr instanceof Error ? parseErr.message : String(parseErr),
              }
              self.postMessage({ type: 'error', error })
            }
          }

          // Send progress
          self.postMessage({
            type: 'progress',
            bytesRead,
            totalBytes,
            recordsParsed,
          })
        }
      } else {
        // Fallback: slice-based reading for older browsers
        let offset = 0
        while (offset < totalBytes) {
          if (cancelled) {
            self.postMessage({ type: 'cancelled' })
            return
          }

          const end = Math.min(offset + CHUNK_SIZE, totalBytes)
          const blob = file.slice(offset, end)
          const text = remainder + (await blob.text())
          offset = end
          bytesRead = end

          const result = extractJsonObjects(text)
          remainder = result.remainder

          for (const jsonStr of result.jsonStrings) {
            try {
              const record = JSON.parse(jsonStr) as JsonRecord
              batchRecords.push(record)
              for (const key of Object.keys(record)) {
                batchKeys.add(key)
              }
              batchSearchStrings.push(buildSearchString(record))
              recordsParsed++

              if (batchRecords.length >= batchSize) {
                flushBatch()
              }
            } catch (parseErr) {
              totalErrors++
              const error: ParseError = {
                recordIndex: recordsParsed,
                snippet: jsonStr.substring(0, 200),
                message: parseErr instanceof Error ? parseErr.message : String(parseErr),
              }
              self.postMessage({ type: 'error', error })
            }
          }

          self.postMessage({
            type: 'progress',
            bytesRead,
            totalBytes,
            recordsParsed,
          })
        }
      }

      // Handle any remaining text (incomplete final object)
      if (remainder.trim().length > 0) {
        // Try to parse remainder as a final object
        try {
          const record = JSON.parse(remainder) as JsonRecord
          batchRecords.push(record)
          for (const key of Object.keys(record)) {
            batchKeys.add(key)
          }
          batchSearchStrings.push(buildSearchString(record))
          recordsParsed++
        } catch {
          totalErrors++
          const error: ParseError = {
            recordIndex: recordsParsed,
            snippet: remainder.substring(0, 200),
            message: 'Incomplete or malformed JSON object at end of file',
          }
          self.postMessage({ type: 'error', error })
        }
      }

      // Flush any remaining batch
      flushBatch()

      self.postMessage({
        type: 'done',
        totalRecords: recordsParsed,
        totalErrors,
      })
    } catch (err) {
      self.postMessage({
        type: 'error',
        error: {
          recordIndex: -1,
          snippet: '',
          message: err instanceof Error ? err.message : String(err),
        },
      })
    }
  }
}
