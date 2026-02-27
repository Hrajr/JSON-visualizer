/**
 * useSearch – composable for debounced, worker-backed search + property filtering.
 *
 * The search worker scans IndexedDB directly (no data passed from main thread),
 * so memory stays constant regardless of dataset size.
 *
 * Combines:
 *   - Text query  (AND-matched terms)
 *   - Property filter  (only records where a specific key has a non-empty value)
 */

import { ref, watch, type Ref } from 'vue'
import SearchWorker from '../workers/search.worker?worker'

export function useSearch(totalCount: Ref<number>) {
  const query = ref('')
  const propertyFilter = ref('')

  /** null = show all (no active filter). */
  const matchingIndices = ref<number[] | null>(null)
  const matchCount = ref(0)
  const searchTime = ref(0)
  const isSearching = ref(false)
  const searchProgress = ref(0)

  let worker: Worker | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function getWorker(): Worker {
    if (!worker) {
      worker = new SearchWorker()
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data
        if (msg.type === 'result') {
          matchingIndices.value = msg.matchingIndices // null means show all
          matchCount.value = msg.matchingIndices ? msg.matchingIndices.length : totalCount.value
          searchTime.value = Math.round(msg.timeTaken * 100) / 100
          isSearching.value = false
          searchProgress.value = 0
        } else if (msg.type === 'progress') {
          searchProgress.value = msg.scanned
        } else if (msg.type === 'cancelled') {
          isSearching.value = false
        }
      }
    }
    return worker
  }

  function runSearch() {
    const q = query.value.trim()
    const pf = propertyFilter.value

    if (!q && !pf) {
      matchingIndices.value = null
      matchCount.value = totalCount.value
      searchTime.value = 0
      isSearching.value = false
      return
    }

    isSearching.value = true
    searchProgress.value = 0

    // Cancel any in-flight search
    getWorker().postMessage({ type: 'cancel' })
    getWorker().postMessage({ type: 'search', query: q, propertyFilter: pf })
  }

  // Debounced watch on both query and propertyFilter
  watch([query, propertyFilter], () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(runSearch, 250)
  })

  // Re-run when record count changes (new data loaded) and there's an active filter
  watch(totalCount, () => {
    if (query.value.trim() || propertyFilter.value) {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(runSearch, 500)
    } else {
      matchingIndices.value = null
      matchCount.value = totalCount.value
    }
  })

  function dispose() {
    if (worker) { worker.terminate(); worker = null }
    if (debounceTimer) clearTimeout(debounceTimer)
  }

  return {
    query,
    propertyFilter,
    matchingIndices,
    matchCount,
    searchTime,
    isSearching,
    searchProgress,
    dispose,
  }
}
