/**
 * useSearch – composable for debounced search, property filtering,
 * column sorting, and server-side pagination via SQLite.
 *
 * All heavy work (search, filter, sort, pagination) happens server-side
 * in a single SQL query. The client only receives the current page's
 * records — never millions of index arrays.
 */

import { ref, shallowRef, watch, computed, type Ref } from 'vue'
import type { JsonRecord, DatasetRange } from '../types'
import { queryPage } from '../utils/db'

export interface PageRecord {
  absIndex: number
  data: JsonRecord
}

export function useSearch(totalCount: Ref<number>, datasetRanges: Ref<DatasetRange[]>) {
  const query = ref('')
  const propertyFilters = ref<string[]>([])

  // ── Pagination state ──
  const page = ref(1)
  const pageSize = ref(100)

  // ── Sort state ──
  const sortColumn = ref('')
  const sortDirection = ref<'asc' | 'desc'>('asc')

  // ── Results ──
  const matchCount = ref(0)
  const searchTime = ref(0)
  const isSearching = ref(false)
  const isSorting = ref(false)
  const pageRecords = shallowRef<PageRecord[]>([])

  // Track whether any filter/search is active
  const hasActiveQuery = computed(() => {
    return query.value.trim() !== '' || propertyFilters.value.length > 0
  })

  // Effective total: server-computed matchCount, or totalCount if no filter
  const effectiveTotal = computed(() => {
    if (hasActiveQuery.value) return matchCount.value
    return totalCount.value
  })

  let queryGeneration = 0
  let fetchTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Schedule a fetchPage with debounce.  Multiple callers within the
   * debounce window are coalesced into a single request.
   */
  function scheduleFetch(delay = 0) {
    if (fetchTimer) clearTimeout(fetchTimer)
    if (delay <= 0) {
      fetchTimer = null
      fetchPage()
    } else {
      fetchTimer = setTimeout(() => { fetchTimer = null; fetchPage() }, delay)
    }
  }

  /**
   * Fetch one page of records from the server.
   * Single endpoint handles search + filter + sort + LIMIT/OFFSET.
   */
  async function fetchPage() {
    const gen = ++queryGeneration
    const datasets = datasetRanges.value.map(r => ({ id: r.id, offset: r.offset, count: r.count }))

    if (datasets.length === 0) {
      pageRecords.value = []
      matchCount.value = 0
      return
    }

    isSearching.value = true

    try {
      const result = await queryPage(
        datasets,
        query.value.trim(),
        propertyFilters.value,
        sortColumn.value,
        sortDirection.value,
        page.value,
        pageSize.value,
      )

      if (gen !== queryGeneration) return // stale response

      matchCount.value = result.totalCount
      pageRecords.value = result.records
      searchTime.value = Math.round(result.timeTaken * 100) / 100
    } catch (err) {
      if (gen !== queryGeneration) return
      console.error('[Query]', err)
    } finally {
      if (gen === queryGeneration) {
        isSearching.value = false
        isSorting.value = false
      }
    }
  }

  /** Called when search/filter changes — reset to page 1, debounced. */
  function onQueryChange() {
    page.value = 1
    scheduleFetch(250)
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
        isSorting.value = false
        scheduleFetch()
        return
      }
    } else {
      sortColumn.value = column
      sortDirection.value = 'asc'
    }
    isSorting.value = true
    scheduleFetch()
  }

  function resetSort() {
    sortColumn.value = ''
    sortDirection.value = 'asc'
    isSorting.value = false
  }

  function setPage(p: number) {
    page.value = p
    scheduleFetch()
  }

  function setPageSize(size: number) {
    pageSize.value = size
    page.value = 1
    scheduleFetch()
  }

  // Debounced watch on query + propertyFilters
  watch([query, propertyFilters], onQueryChange, { deep: true })

  // Re-fetch when dataset ranges structurally change (dataset switch)
  let lastRangeSignature = ''
  watch(datasetRanges, (ranges) => {
    const sig = ranges.map(r => `${r.id}:${r.count}`).join('|')
    if (sig === lastRangeSignature) return
    lastRangeSignature = sig
    page.value = 1
    scheduleFetch(100)
  }, { deep: true })

  // Re-fetch when totalCount changes during loading (debounced, coalesced)
  watch(totalCount, () => {
    scheduleFetch(800)
  })

  function dispose() {
    if (fetchTimer) clearTimeout(fetchTimer)
  }

  return {
    query,
    propertyFilters,
    matchCount: effectiveTotal,
    searchTime,
    isSearching,
    sortColumn,
    sortDirection,
    isSorting,
    page,
    pageSize,
    pageRecords,
    setSort,
    resetSort,
    setPage,
    setPageSize,
    fetchPage,
    dispose,
  }
}
