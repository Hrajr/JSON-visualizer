/**
 * useParser – composable that manages the parser worker lifecycle.
 *
 * Supports two modes:
 *   1. File (from file picker / drag-drop)
 *   2. URL  (fetch streaming from public/data/ folder – best for huge files)
 *
 * Records are written to IndexedDB (on disk) instead of held in a JS array,
 * so even 10 GB+ files won't crash the browser.
 * Only lightweight metadata (allKeys, error list, counts) stays in memory.
 */

import { ref, shallowRef, computed, type Ref } from 'vue'
import type { JsonRecord, ParseError, AppState, ParserWorkerOutMessage } from '../types'
import { openDB, clearAllStores, addBatch } from '../utils/db'
import ParserWorker from '../workers/parser.worker?worker'

/** Default max records to load (0 = unlimited) */
const DEFAULT_MAX_RECORDS = 100_000

/** Accumulate this many records before flushing to IndexedDB for write performance. */
const DB_WRITE_BATCH = 2000

export function useParser() {
  const allKeys: Ref<Map<string, number>> = shallowRef(new Map())
  const errors: Ref<ParseError[]> = ref([])

  const state: Ref<AppState> = ref('idle')
  const bytesRead = ref(0)
  const totalBytes = ref(0)
  const recordsParsed = ref(0)
  /** Number of records actually committed to IndexedDB (available for display). */
  const dbRecordCount = ref(0)
  const fileName = ref('')
  const limitReached = ref(false)
  const maxRecords = ref(DEFAULT_MAX_RECORDS)

  let worker: Worker | null = null

  // ── Write-accumulator ──
  let pendingRecords: JsonRecord[] = []
  let pendingSearchStrings: string[] = []
  let pendingStartIndex = 0
  /** Sequential write-chain so IndexedDB transactions never overlap. */
  let writeChain: Promise<void> = Promise.resolve()

  const progress = computed(() => {
    if (totalBytes.value === 0) return 0
    return Math.round((bytesRead.value / totalBytes.value) * 100)
  })

  function flushPending(): Promise<void> {
    if (pendingRecords.length === 0) return Promise.resolve()
    const batch = pendingRecords
    const ss = pendingSearchStrings
    const start = pendingStartIndex
    pendingStartIndex += batch.length
    pendingRecords = []
    pendingSearchStrings = []
    return addBatch(start, batch, ss).then(() => {
      dbRecordCount.value = start + batch.length
    })
  }

  function setupWorker() {
    if (worker) worker.terminate()
    worker = new ParserWorker()

    worker.onmessage = (e: MessageEvent<ParserWorkerOutMessage>) => {
      const msg = e.data

      switch (msg.type) {
        case 'progress':
          bytesRead.value = msg.bytesRead
          totalBytes.value = msg.totalBytes
          recordsParsed.value = msg.recordsParsed
          break

        case 'batch': {
          // Accumulate records for a larger IndexedDB write
          pendingRecords.push(...msg.records)
          pendingSearchStrings.push(...msg.searchStrings)

          if (pendingRecords.length >= DB_WRITE_BATCH) {
            writeChain = writeChain.then(() => flushPending())
          }

          // Update allKeys in memory (small footprint)
          const keyMap = new Map(allKeys.value)
          for (const key of msg.keys) {
            keyMap.set(key, (keyMap.get(key) || 0) + 1)
          }
          allKeys.value = keyMap
          break
        }

        case 'error':
          errors.value = [...errors.value, msg.error]
          break

        case 'done':
          // Flush remaining records, then mark loaded
          writeChain = writeChain
            .then(() => flushPending())
            .then(() => {
              state.value = 'loaded'
              recordsParsed.value = msg.totalRecords
            })
          break

        case 'limit-reached':
          writeChain = writeChain
            .then(() => flushPending())
            .then(() => {
              limitReached.value = true
              state.value = 'loaded'
              recordsParsed.value = msg.totalRecords
            })
          break

        case 'cancelled':
          state.value = 'idle'
          break
      }
    }

    worker.onerror = (err) => {
      console.error('Parser worker error:', err)
      state.value = 'error'
    }
  }

  async function resetState() {
    await openDB()
    await clearAllStores()
    allKeys.value = new Map()
    errors.value = []
    bytesRead.value = 0
    totalBytes.value = 0
    recordsParsed.value = 0
    dbRecordCount.value = 0
    limitReached.value = false
    pendingRecords = []
    pendingSearchStrings = []
    pendingStartIndex = 0
    writeChain = Promise.resolve()
    state.value = 'loading'
  }

  async function startParsing(file: File, batchSize = 200) {
    await resetState()
    totalBytes.value = file.size
    fileName.value = file.name

    setupWorker()
    worker!.postMessage({
      type: 'start',
      file,
      batchSize,
      maxRecords: maxRecords.value,
    })
  }

  async function startParsingUrl(url: string, displayName: string, batchSize = 200) {
    await resetState()
    fileName.value = displayName

    setupWorker()
    worker!.postMessage({
      type: 'start-url',
      url,
      batchSize,
      maxRecords: maxRecords.value,
    })
  }

  function cancelParsing() {
    if (worker) worker.postMessage({ type: 'cancel' })
  }

  async function reset() {
    if (worker) { worker.terminate(); worker = null }
    await openDB()
    await clearAllStores()
    allKeys.value = new Map()
    errors.value = []
    state.value = 'idle'
    bytesRead.value = 0
    totalBytes.value = 0
    recordsParsed.value = 0
    dbRecordCount.value = 0
    fileName.value = ''
    limitReached.value = false
    pendingRecords = []
    pendingSearchStrings = []
    pendingStartIndex = 0
    writeChain = Promise.resolve()
  }

  return {
    allKeys,
    errors,
    state,
    bytesRead,
    totalBytes,
    recordsParsed,
    dbRecordCount,
    progress,
    fileName,
    limitReached,
    maxRecords,
    startParsing,
    startParsingUrl,
    cancelParsing,
    reset,
  }
}
