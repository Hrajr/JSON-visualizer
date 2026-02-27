/**
 * useParser – composable that manages the parser worker lifecycle.
 *
 * Supports two modes:
 *   1. File (from file picker / drag-drop)
 *   2. URL  (fetch streaming from public/data/ folder – best for huge files)
 *
 * The parser worker writes records DIRECTLY to IndexedDB inside the worker
 * thread.  No records are ever sent to the main thread, so memory stays
 * constant regardless of file size.
 *
 * The main thread only receives lightweight messages:
 *   - progress   (bytesRead / totalBytes / recordsParsed)
 *   - keys       (newly discovered column names)
 *   - db-flushed (how many records have been committed to IDB)
 *   - error / done / limit-reached / cancelled
 */

import { ref, shallowRef, computed, type Ref } from 'vue'
import type { ParseError, AppState } from '../types'
import { openDB, clearAllStores } from '../utils/db'
import ParserWorker from '../workers/parser.worker?worker'

/** Default max records to load (0 = unlimited) */
const DEFAULT_MAX_RECORDS = 100_000

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

  const progress = computed(() => {
    if (totalBytes.value === 0) return 0
    return Math.round((bytesRead.value / totalBytes.value) * 100)
  })

  function setupWorker() {
    if (worker) worker.terminate()
    worker = new ParserWorker()

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data

      switch (msg.type) {
        case 'progress':
          bytesRead.value = msg.bytesRead
          totalBytes.value = msg.totalBytes
          recordsParsed.value = msg.recordsParsed
          break

        case 'keys': {
          // Lightweight – just an array of new key names
          const keyMap = new Map(allKeys.value)
          for (const key of msg.keys as string[]) {
            keyMap.set(key, (keyMap.get(key) || 0) + 1)
          }
          allKeys.value = keyMap
          break
        }

        case 'db-flushed':
          // Worker committed records to IndexedDB – update the count
          dbRecordCount.value = msg.count as number
          break

        case 'error':
          errors.value = [...errors.value, msg.error]
          break

        case 'done':
          state.value = 'loaded'
          recordsParsed.value = msg.totalRecords
          break

        case 'limit-reached':
          limitReached.value = true
          state.value = 'loaded'
          recordsParsed.value = msg.totalRecords
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
