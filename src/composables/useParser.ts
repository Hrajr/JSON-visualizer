/**
 * useParser – composable that manages the parser worker lifecycle.
 *
 * Provides reactive state for records, keys, progress, errors.
 * Records are stored with shallowRef + markRaw to avoid deep reactivity overhead.
 */

import { ref, shallowRef, computed, markRaw, type Ref } from 'vue'
import type { JsonRecord, ParseError, AppState, ParserWorkerOutMessage } from '../types'
import ParserWorker from '../workers/parser.worker?worker'

export function useParser() {
  const records: Ref<JsonRecord[]> = shallowRef([])
  const searchStrings: Ref<string[]> = shallowRef([])
  const allKeys: Ref<Map<string, number>> = shallowRef(new Map()) // key -> frequency
  const errors: Ref<ParseError[]> = ref([])

  const state: Ref<AppState> = ref('idle')
  const bytesRead = ref(0)
  const totalBytes = ref(0)
  const recordsParsed = ref(0)
  const fileName = ref('')

  let worker: Worker | null = null

  const progress = computed(() => {
    if (totalBytes.value === 0) return 0
    return Math.round((bytesRead.value / totalBytes.value) * 100)
  })

  function startParsing(file: File, batchSize = 200) {
    // Reset state
    records.value = []
    searchStrings.value = []
    allKeys.value = new Map()
    errors.value = []
    bytesRead.value = 0
    totalBytes.value = file.size
    recordsParsed.value = 0
    fileName.value = file.name
    state.value = 'loading'

    // Terminate previous worker if any
    if (worker) {
      worker.terminate()
    }

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
          // Append batch efficiently using shallowRef trigger
          const newRecords = msg.records.map((r) => markRaw(r))
          const currentRecords = records.value
          const merged = new Array(currentRecords.length + newRecords.length)
          for (let i = 0; i < currentRecords.length; i++) merged[i] = currentRecords[i]
          for (let i = 0; i < newRecords.length; i++) merged[currentRecords.length + i] = newRecords[i]
          records.value = merged

          // Append search strings
          const currentSearchStrings = searchStrings.value
          const mergedSS = new Array(currentSearchStrings.length + msg.searchStrings.length)
          for (let i = 0; i < currentSearchStrings.length; i++) mergedSS[i] = currentSearchStrings[i]
          for (let i = 0; i < msg.searchStrings.length; i++) mergedSS[currentSearchStrings.length + i] = msg.searchStrings[i]
          searchStrings.value = mergedSS

          // Merge keys
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

        case 'cancelled':
          state.value = 'idle'
          break
      }
    }

    worker.onerror = (err) => {
      console.error('Parser worker error:', err)
      state.value = 'error'
    }

    worker.postMessage({ type: 'start', file, batchSize })
  }

  function cancelParsing() {
    if (worker) {
      worker.postMessage({ type: 'cancel' })
    }
  }

  function reset() {
    if (worker) {
      worker.terminate()
      worker = null
    }
    records.value = []
    searchStrings.value = []
    allKeys.value = new Map()
    errors.value = []
    state.value = 'idle'
    bytesRead.value = 0
    totalBytes.value = 0
    recordsParsed.value = 0
    fileName.value = ''
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
    startParsing,
    cancelParsing,
    reset,
  }
}
