/**
 * useSearch – composable for debounced, worker-backed search/filtering.
 *
 * Accepts search strings and record indices; runs search in a Web Worker;
 * returns matching indices and stats.
 */

import { ref, watch, type Ref } from 'vue'
import SearchWorker from '../workers/search.worker?worker'

export function useSearch(
  searchStrings: Ref<string[]>,
  totalCount: Ref<number>,
) {
  const query = ref('')
  const matchingIndices = ref<number[] | null>(null) // null = show all
  const matchCount = ref(0)
  const searchTime = ref(0)
  const isSearching = ref(false)

  let worker: Worker | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function getWorker(): Worker {
    if (!worker) {
      worker = new SearchWorker()
      worker.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'result') {
          matchingIndices.value = e.data.matchingIndices
          matchCount.value = e.data.matchingIndices.length
          searchTime.value = Math.round(e.data.timeTaken * 100) / 100
          isSearching.value = false
        }
      }
    }
    return worker
  }

  function runSearch(q: string) {
    const trimmed = q.trim()
    if (!trimmed) {
      matchingIndices.value = null
      matchCount.value = totalCount.value
      searchTime.value = 0
      isSearching.value = false
      return
    }

    isSearching.value = true
    const ss = searchStrings.value
    const indices = Array.from({ length: ss.length }, (_, i) => i)

    getWorker().postMessage({
      type: 'search',
      query: trimmed,
      searchStrings: ss,
      indices,
    })
  }

  // Debounced watch on query
  watch(query, (newVal) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      runSearch(newVal)
    }, 250)
  })

  // Also re-run when totalCount changes (new data loaded) and there's an active query
  watch(totalCount, () => {
    if (query.value.trim()) {
      runSearch(query.value)
    } else {
      matchingIndices.value = null
      matchCount.value = totalCount.value
    }
  })

  function dispose() {
    if (worker) {
      worker.terminate()
      worker = null
    }
    if (debounceTimer) clearTimeout(debounceTimer)
  }

  return {
    query,
    matchingIndices,
    matchCount,
    searchTime,
    isSearching,
    dispose,
  }
}
