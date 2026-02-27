/**
 * useSearch – composable for debounced search, property filtering,
 * and column sorting across multiple datasets via server-side SQLite.
 *
 * All heavy work (scanning, sorting) happens server-side so the browser
 * thread stays responsive.
 */

import { ref, watch, computed, type Ref } from 'vue'
import type { DatasetRange } from '../types'
import { searchRecords, sortRecords } from '../utils/db'

export function useSearch(totalCount: Ref<number>, datasetRanges: Ref<DatasetRange[]>) {
  const query = ref('')
  const propertyFilters = ref<string[]>([])

  /** null = show all (no active search/filter). */
  const matchingIndices = ref<number[] | null>(null)
  const matchCount = computed(() =>
    matchingIndices.value !== null ? matchingIndices.value.length : totalCount.value
  )
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

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let searchAbort: AbortController | null = null
  let sortAbort: AbortController | null = null

  async function runSearch() {
    const q = query.value.trim()
    const pf = propertyFilters.value

    if (!q && pf.length === 0) {
      matchingIndices.value = null
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

    // Cancel any in-flight search
    if (searchAbort) searchAbort.abort()
    searchAbort = new AbortController()

    try {
      const datasets = datasetRanges.value.map(r => ({ id: r.id, offset: r.offset, count: r.count }))
      const result = await searchRecords(datasets, q, pf)

      matchingIndices.value = result.indices
      searchTime.value = Math.round(result.timeTaken * 100) / 100
      isSearching.value = false

      // Re-sort the new search results if sort is active
      if (sortColumn.value) {
        runSort()
      } else {
        sortedIndices.value = null
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('[Search]', err)
      isSearching.value = false
    }
  }

  async function runSort() {
    if (!sortColumn.value) {
      sortedIndices.value = null
      isSorting.value = false
      return
    }
    isSorting.value = true

    // Cancel any in-flight sort
    if (sortAbort) sortAbort.abort()
    sortAbort = new AbortController()

    try {
      const datasets = datasetRanges.value.map(r => ({ id: r.id, offset: r.offset, count: r.count }))
      const result = await sortRecords(
        datasets,
        sortColumn.value,
        sortDirection.value,
        matchingIndices.value,
      )
      sortedIndices.value = result.indices
      isSorting.value = false
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('[Sort]', err)
      isSorting.value = false
    }
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

  // Debounced watch on query + propertyFilters
  watch([query, propertyFilters], () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(runSearch, 250)
  }, { deep: true })

  // Re-run search when dataset ranges structurally change (dataset switch, not count updates)
  let lastRangeSignature = ''
  watch(datasetRanges, (ranges) => {
    const sig = ranges.map(r => r.id).join('|')
    if (sig === lastRangeSignature) return // Just a count update during loading
    lastRangeSignature = sig
    if (query.value.trim() || propertyFilters.value.length > 0) {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(runSearch, 500)
    } else {
      matchingIndices.value = null
      if (sortColumn.value) runSort()
      else sortedIndices.value = null
    }
  }, { deep: true })

  function dispose() {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (searchAbort) searchAbort.abort()
    if (sortAbort) sortAbort.abort()
  }

  return {
    query,
    propertyFilters,
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
