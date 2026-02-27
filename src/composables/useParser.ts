/**
 * useParser – composable that manages the parser worker lifecycle.
 *
 * Supports two modes:
 *   1. File (from file picker / drag-drop)
 *   2. URL  (fetch streaming from public/data/ folder – best for huge files)
 *
 * Records are stored with shallowRef + markRaw to avoid deep reactivity overhead.
 * A configurable maxRecords limit prevents memory exhaustion on multi-GB files.
 */

import { ref, shallowRef, computed, markRaw, type Ref } from 'vue'
import type { JsonRecord, ParseError, AppState, ParserWorkerOutMessage } from '../types'
import ParserWorker from '../workers/parser.worker?worker'

/** Default max records to load (0 = unlimited) */
const DEFAULT_MAX_RECORDS = 100_000

export function useParser() {
  const records: Ref<JsonRecord[]> = shallowRef([])
  const searchStrings: Ref<string[]> = shallowRef([])
  const allKeys: Ref<Map<string, number>> = shallowRef(new Map())
  const errors: Ref<ParseError[]> = ref([])

  const state: Ref<AppState> = ref('idle')
  const bytesRead = ref(0)
  const totalBytes = ref(0)
  const recordsParsed = ref(0)
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

    worker.onmessage = (e: MessageEvent<ParserWorkerOutMessage>) => {
      const msg = e.data

      switch (msg.type) {
        case 'progress':
          bytesRead.value = msg.bytesRead
          totalBytes.value = msg.totalBytes
          recordsParsed.value = msg.recordsParsed
          break

        case 'batch': {
          const newRecords = msg.records.map((r) => markRaw(r))
          const currentRecords = records.value
          const merged = new Array(currentRecords.length + newRecords.length)
          for (let i = 0; i < currentRecords.length; i++) merged[i] = currentRecords[i]
          for (let i = 0; i < newRecords.length; i++) merged[currentRecords.length + i] = newRecords[i]
          records.value = merged

          const currentSearchStrings = searchStrings.value
          const mergedSS = new Array(currentSearchStrings.length + msg.searchStrings.length)
          for (let i = 0; i < currentSearchStrings.length; i++) mergedSS[i] = currentSearchStrings[i]
          for (let i = 0; i < msg.searchStrings.length; i++) mergedSS[currentSearchStrings.length + i] = msg.searchStrings[i]
          searchStrings.value = mergedSS

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

  function resetState() {
    records.value = []
    searchStrings.value = []
    allKeys.value = new Map()
    errors.value = []
    bytesRead.value = 0
    totalBytes.value = 0
    recordsParsed.value = 0
    limitReached.value = false
    state.value = 'loading'
  }

  function startParsing(file: File, batchSize = 200) {
    resetState()
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

  function startParsingUrl(url: string, displayName: string, batchSize = 200) {
    resetState()
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

  function reset() {
    if (worker) { worker.terminate(); worker = null }
    records.value = []
    searchStrings.value = []
    allKeys.value = new Map()
    errors.value = []
    state.value = 'idle'
    bytesRead.value = 0
    totalBytes.value = 0
    recordsParsed.value = 0
    fileName.value = ''
    limitReached.value = false
  }

  return {
    records,
    searchStrings,
    allKeys,
    errors,
    state,
    bytesRead,
    totalBytes,
    recordsParsed,
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
