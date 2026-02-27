/**
 * useSearch – composable for debounced, worker-backed search, property filtering,
 * and column sorting across multiple dataset databases.
 *
 * The search worker scans IndexedDB directly (no data passed from main thread),
 * so memory stays constant regardless of dataset size.
 */

import { ref, watch, computed, type Ref } from 'vue'
import type { DatasetRange } from '../types'
import SearchWorker from '../workers/search.worker?worker'

export function useSearch(totalCount: Ref<number>, datasetRanges: Ref<DatasetRange[]>) {
  const query = ref('')
  const propertyFilter = ref('')

  /** null = show all (no active search/filter). */
  const matchingIndices = ref<number[] | null>(null)
  const matchCount = ref(0)
  const searchTime = ref(0)
  const isSearching = ref(false)

  // ── Sort state ──
  const sortColumn = ref('')
  const sortDirection = ref<'asc' | 'desc'>('asc')
  const sortedIndices = ref<number[] | null>(null)
  const isSorting = ref(false)

  /** Final indices for display: sort takes priority, then search, then null (all). */
  const displayIndices = computed(() => {
    if (sortedIndices.value) return sortedIndices.value
    return matchingIndices.value
  })

  let worker: Worker | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function getWorker(): Worker {
    if (!worker) {
      worker = new SearchWorker()
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data
        if (msg.type === 'result') {
          matchingIndices.value = msg.matchingIndices
          matchCount.value = msg.matchingIndices ? msg.matchingIndices.length : totalCount.value
          searchTime.value = Math.round(msg.timeTaken * 100) / 100
          isSearching.value = false

          // Re-sort the new search results if sort is active
          if (sortColumn.value) {
            runSort()
          } else {
            sortedIndices.value = null
          }
        } else if (msg.type === 'sort-result') {
          sortedIndices.value = msg.sortedIndices
          isSorting.value = false
        } else if (msg.type === 'progress') {
          // could expose progress if needed
        } else if (msg.type === 'cancelled') {
          // operation was cancelled, do nothing
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

      if (sortColumn.value) {
        runSort()
      } else {
        sortedIndices.value = null
      }
      return
    }

    isSearching.value = true
    const w = getWorker()
    w.postMessage({ type: 'cancel' })
    w.postMessage({
      type: 'search',
      query: q,
      propertyFilter: pf,
      datasets: datasetRanges.value,
    })
  }

  function runSort() {
    if (!sortColumn.value) {
      sortedIndices.value = null
      isSorting.value = false
      return
    }
    isSorting.value = true
    const w = getWorker()
    w.postMessage({ type: 'cancel' })
    w.postMessage({
      type: 'sort',
      column: sortColumn.value,
      direction: sortDirection.value,
      indices: matchingIndices.value,
      datasets: datasetRanges.value,
    })
  }

  /** Toggle sort on a column. First click: asc, second: desc, third: clear. */
  function setSort(column: string) {
    if (sortColumn.value === column) {
      if (sortDirection.value === 'asc') {
        sortDirection.value = 'desc'
      } else {
        // Third click — clear sort
        sortColumn.value = ''
        sortDirection.value = 'asc'
        sortedIndices.value = null
        isSorting.value = false
        return
      }
    } else {
      sortColumn.value = column
      sortDirection.value = 'asc'
    }
    runSort()
  }

  function resetSort() {
    sortColumn.value = ''
    sortDirection.value = 'asc'
    sortedIndices.value = null
    isSorting.value = false
  }

  // Debounced watch on query + propertyFilter
  watch([query, propertyFilter], () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(runSearch, 250)
  })

  // Re-run search when dataset ranges change (e.g., dataset switch)
  watch(datasetRanges, () => {
    if (query.value.trim() || propertyFilter.value) {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(runSearch, 500)
    } else {
      matchingIndices.value = null
      matchCount.value = totalCount.value
      if (sortColumn.value) runSort()
      else sortedIndices.value = null
    }
  })

  // Re-run when totalCount changes (during loading)
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
    sortColumn,
    sortDirection,
    sortedIndices,
    isSorting,
    displayIndices,
    setSort,
    resetSort,
    dispose,
  }
}
