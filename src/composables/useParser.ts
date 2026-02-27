/**
 * useParser – manages the parser worker lifecycle.
 *
 * Each load creates a new dataset with its own IndexedDB database.
 * The worker writes directly to IndexedDB – no records on the main thread.
 * On completion, calls the registered callback with DatasetInfo.
 */

import { ref, shallowRef, computed, type Ref } from 'vue'
import type { ParseError, AppState, DatasetInfo } from '../types'
import { generateDatasetId, dbNameForDataset, closeNamedDB } from '../utils/db'
import ParserWorker from '../workers/parser.worker?worker'

/** Default max records to load (0 = unlimited) */
const DEFAULT_MAX_RECORDS = 0

export function useParser() {
  const allKeys: Ref<Map<string, number>> = shallowRef(new Map())
  const errors: Ref<ParseError[]> = ref([])

  const state: Ref<AppState> = ref('idle')
  const bytesRead = ref(0)
  const totalBytes = ref(0)
  const recordsParsed = ref(0)
  const dbRecordCount = ref(0)
  const fileName = ref('')
  const limitReached = ref(false)
  const maxRecords = ref(DEFAULT_MAX_RECORDS)
  const currentDbName = ref('')

  let worker: Worker | null = null
  let currentDatasetId = ''

  /** Called when parsing completes successfully. */
  let onCompleteCallback: ((info: DatasetInfo) => void) | null = null

  const progress = computed(() => {
    if (totalBytes.value === 0) return 0
    return Math.round((bytesRead.value / totalBytes.value) * 100)
  })

  function buildDatasetInfo(totalRecords: number): DatasetInfo {
    return {
      id: currentDatasetId,
      dbName: currentDbName.value,
      fileName: fileName.value,
      recordCount: totalRecords,
      keys: Array.from(allKeys.value.keys()),
      totalBytes: totalBytes.value || bytesRead.value,
      loadedAt: Date.now(),
    }
  }

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
          const keyMap = new Map(allKeys.value)
          for (const key of msg.keys as string[]) {
            keyMap.set(key, (keyMap.get(key) || 0) + 1)
          }
          allKeys.value = keyMap
          break
        }

        case 'db-flushed':
          dbRecordCount.value = msg.count as number
          break

        case 'error':
          errors.value = [...errors.value, msg.error]
          // Fatal infrastructure error (not a bad record) → stop loading
          if (msg.error.recordIndex === -1) {
            state.value = 'error'
          }
          break

        case 'done': {
          state.value = 'loaded'
          recordsParsed.value = msg.totalRecords
          dbRecordCount.value = msg.totalRecords
          try {
            if (onCompleteCallback) onCompleteCallback(buildDatasetInfo(msg.totalRecords))
          } catch (err) {
            console.error('onComplete callback error:', err)
            state.value = 'error'
          }
          break
        }

        case 'limit-reached': {
          limitReached.value = true
          state.value = 'loaded'
          recordsParsed.value = msg.totalRecords
          dbRecordCount.value = msg.totalRecords
          try {
            if (onCompleteCallback) onCompleteCallback(buildDatasetInfo(msg.totalRecords))
          } catch (err) {
            console.error('onComplete callback error:', err)
            state.value = 'error'
          }
          break
        }

        case 'cancelled':
          state.value = 'idle'
          closeNamedDB(currentDbName.value)
          break
      }
    }

    worker.onerror = (err) => {
      console.error('Parser worker error:', err)
      state.value = 'error'
    }
  }

  function resetState() {
    allKeys.value = new Map()
    errors.value = []
    bytesRead.value = 0
    totalBytes.value = 0
    recordsParsed.value = 0
    dbRecordCount.value = 0
    limitReached.value = false
    state.value = 'loading'
  }

  function startParsing(file: File, batchSize = 200) {
    currentDatasetId = generateDatasetId()
    currentDbName.value = dbNameForDataset(currentDatasetId)

    resetState()
    totalBytes.value = file.size
    fileName.value = file.name

    setupWorker()
    worker!.postMessage({
      type: 'start',
      file,
      batchSize,
      maxRecords: maxRecords.value,
      dbName: currentDbName.value,
    })
  }

  function startParsingUrl(url: string, displayName: string, batchSize = 200) {
    currentDatasetId = generateDatasetId()
    currentDbName.value = dbNameForDataset(currentDatasetId)

    resetState()
    fileName.value = displayName

    setupWorker()
    worker!.postMessage({
      type: 'start-url',
      url,
      batchSize,
      maxRecords: maxRecords.value,
      dbName: currentDbName.value,
    })
  }

  function cancelParsing() {
    if (worker) worker.postMessage({ type: 'cancel' })
  }

  function reset() {
    if (worker) { worker.terminate(); worker = null }
    allKeys.value = new Map()
    errors.value = []
    state.value = 'idle'
    bytesRead.value = 0
    totalBytes.value = 0
    recordsParsed.value = 0
    dbRecordCount.value = 0
    fileName.value = ''
    limitReached.value = false
    currentDatasetId = ''
    currentDbName.value = ''
  }

  function onComplete(cb: (info: DatasetInfo) => void) {
    onCompleteCallback = cb
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
    currentDbName,
    startParsing,
    startParsingUrl,
    cancelParsing,
    reset,
    onComplete,
  }
}
