<script setup lang="ts">
/**
 * PaginatedTable – table with pagination for large datasets.
 *
 * Records are loaded from IndexedDB on demand – only the current page's rows
 * are ever in memory, so even multi-million-row datasets won't crash.
 */
import { ref, shallowRef, computed, watch, onMounted } from 'vue'
import type { JsonRecord, ColumnDef } from '../types'
import { formatColumnName } from '../utils/format'
import { getRecordsByIndices } from '../utils/db'

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500]

const props = defineProps<{
  /** Total number of records available in IndexedDB. */
  recordCount: number
  columns: ColumnDef[]
  /** Filtered indices (null = show all). Comes from search across ALL records. */
  filteredIndices: number[] | null
  /** When true, adds bottom padding so the fixed loading footer doesn't overlap pagination. */
  isLoading?: boolean
}>()

const emit = defineEmits<{
  (e: 'select-row', index: number): void
}>()

const pageSize = ref(100)
const currentPage = ref(1)

// ── Total row count (filtered or all) ──
const totalRows = computed(() => props.filteredIndices?.length ?? props.recordCount)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize.value)))

// Clamp currentPage when data changes
watch(totalPages, () => {
  if (currentPage.value > totalPages.value) {
    currentPage.value = Math.max(1, totalPages.value)
  }
})

// Reset to page 1 when filter changes
watch(() => props.filteredIndices, () => {
  currentPage.value = 1
})

// ── Compute which indices belong on the current page ──
const pageRows = computed(() => {
  const total = totalRows.value
  const start = (currentPage.value - 1) * pageSize.value
  const end = Math.min(start + pageSize.value, total)
  const rows: { dataIndex: number; displayIndex: number }[] = []

  if (props.filteredIndices) {
    for (let i = start; i < end; i++) {
      rows.push({ dataIndex: props.filteredIndices[i], displayIndex: i })
    }
  } else {
    for (let i = start; i < end; i++) {
      rows.push({ dataIndex: i, displayIndex: i })
    }
  }

  return rows
})

// ── Async page records from IndexedDB ──
const pageRecords = shallowRef<Map<number, JsonRecord>>(new Map())
const isPageLoading = ref(false)
let loadGeneration = 0

async function loadPage() {
  const gen = ++loadGeneration
  const rows = pageRows.value
  const indices = rows.map((r) => r.dataIndex)

  if (indices.length === 0) {
    pageRecords.value = new Map()
    return
  }

  isPageLoading.value = true
  try {
    const records = await getRecordsByIndices(indices)
    if (gen !== loadGeneration) return // stale
    const map = new Map<number, JsonRecord>()
    for (let i = 0; i < indices.length; i++) {
      if (records[i]) map.set(indices[i], records[i]!)
    }
    pageRecords.value = map
  } finally {
    if (gen === loadGeneration) isPageLoading.value = false
  }
}

// Reload on page / pageSize change
watch([currentPage, pageSize], loadPage)

// Reload on filter change (currentPage is reset above, but watch may not re-fire if already 1)
watch(() => props.filteredIndices, loadPage)

// Debounce reload when recordCount grows (during parsing)
let rcTimer: ReturnType<typeof setTimeout> | null = null
watch(() => props.recordCount, () => {
  if (rcTimer) clearTimeout(rcTimer)
  rcTimer = setTimeout(loadPage, 500)
})

// Initial load
onMounted(loadPage)

// ── Pagination range ──
const pageRange = computed(() => {
  const total = totalPages.value
  const current = currentPage.value
  const delta = 2
  const range: number[] = []
  const start = Math.max(1, current - delta)
  const end = Math.min(total, current + delta)
  if (start > 1) { range.push(1); if (start > 2) range.push(-1) }
  for (let i = start; i <= end; i++) range.push(i)
  if (end < total) { if (end < total - 1) range.push(-1); range.push(total) }
  return range
})

function goToPage(page: number) {
  if (page >= 1 && page <= totalPages.value) currentPage.value = page
}

function getCellValue(record: JsonRecord | undefined, key: string): string {
  if (!record) return ''
  const val = record[key]
  if (val === undefined || val === null) return ''
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function onPageSizeChange(e: Event) {
  pageSize.value = parseInt((e.target as HTMLSelectElement).value, 10)
  currentPage.value = 1
}

const startRecord = computed(() => (currentPage.value - 1) * pageSize.value + 1)
const endRecord = computed(() => Math.min(currentPage.value * pageSize.value, totalRows.value))
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Table container -->
    <div class="flex-1 overflow-auto virtual-table-scroll">
      <table class="w-full border-collapse min-w-max">
        <!-- Sticky header -->
        <thead class="sticky top-0 z-20">
          <tr>
            <th class="shrink-0 w-16 px-2 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-r border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 sticky left-0 z-30 text-left">
              #
            </th>
            <th
              v-for="col in columns"
              :key="col.key"
              class="px-2 py-2.5 text-xs font-semibold text-gray-700 dark:text-gray-300 border-b border-r border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-left cell-truncate"
              :class="col.pinned ? 'sticky z-30' : ''"
              :style="{
                width: '180px',
                minWidth: '180px',
                maxWidth: '180px',
                ...(col.pinned ? { left: `${64 + columns.filter(c => c.pinned && c.order < col.order).length * 180}px` } : {}),
              }"
              :title="col.key"
            >
              {{ formatColumnName(col.key) }}
            </th>
          </tr>
        </thead>

        <!-- Body – only current page rows -->
        <tbody>
          <tr
            v-for="row in pageRows"
            :key="row.dataIndex"
            class="border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer transition-colors"
            @click="emit('select-row', row.dataIndex)"
          >
            <td class="shrink-0 w-16 px-2 py-2 text-xs text-gray-400 dark:text-gray-500 border-r border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 sticky left-0 z-10">
              {{ row.dataIndex + 1 }}
            </td>
            <td
              v-for="col in columns"
              :key="col.key"
              class="px-2 py-2 text-xs border-r border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900"
              :class="col.pinned ? 'sticky z-10' : ''"
              :style="{
                width: '180px',
                minWidth: '180px',
                maxWidth: '180px',
                ...(col.pinned ? { left: `${64 + columns.filter(c => c.pinned && c.order < col.order).length * 180}px` } : {}),
              }"
            >
              <span
                class="cell-truncate block text-gray-700 dark:text-gray-300"
                :title="getCellValue(pageRecords.get(row.dataIndex), col.key)"
              >
                {{ getCellValue(pageRecords.get(row.dataIndex), col.key) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Empty states -->
      <div v-if="totalRows === 0 && recordCount > 0" class="py-16 text-center text-gray-400 dark:text-gray-600 text-sm">
        No matching records found
      </div>
      <div v-if="recordCount === 0 && !isLoading" class="py-16 text-center text-gray-400 dark:text-gray-600 text-sm">
        No data loaded
      </div>
      <!-- Bottom spacer when loading footer is visible -->
      <div v-if="isLoading" class="h-8 shrink-0"></div>
    </div>

    <!-- Pagination footer -->
    <div
      v-if="totalRows > 0"
      class="shrink-0 flex items-center justify-between gap-4 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs transition-[padding] duration-300"
      :class="isLoading ? 'pb-8' : ''"
    >
      <!-- Left: page size & info -->
      <div class="flex items-center gap-3 text-gray-500 dark:text-gray-400">
        <div class="flex items-center gap-1.5">
          <label for="page-size" class="whitespace-nowrap">Rows per page:</label>
          <select
            id="page-size"
            :value="pageSize"
            @change="onPageSizeChange"
            class="px-1.5 py-0.5 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
          </select>
        </div>
        <span class="text-gray-400 dark:text-gray-500">
          {{ startRecord.toLocaleString() }}–{{ endRecord.toLocaleString() }} of {{ totalRows.toLocaleString() }}
        </span>
      </div>

      <!-- Right: pagination buttons -->
      <div class="flex items-center gap-1">
        <button class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-gray-500 dark:text-gray-400" :disabled="currentPage === 1" title="First page" @click="goToPage(1)">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
        </button>
        <button class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-gray-500 dark:text-gray-400" :disabled="currentPage === 1" title="Previous page" @click="goToPage(currentPage - 1)">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>

        <template v-for="(page, idx) in pageRange" :key="idx">
          <span v-if="page === -1" class="px-1 text-gray-400 dark:text-gray-600 select-none">…</span>
          <button v-else class="min-w-[24px] h-6 rounded text-center transition-colors" :class="page === currentPage ? 'bg-blue-600 text-white font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'" @click="goToPage(page)">{{ page }}</button>
        </template>

        <button class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-gray-500 dark:text-gray-400" :disabled="currentPage === totalPages" title="Next page" @click="goToPage(currentPage + 1)">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
        <button class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-gray-500 dark:text-gray-400" :disabled="currentPage === totalPages" title="Last page" @click="goToPage(totalPages)">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>
  </div>
</template>
