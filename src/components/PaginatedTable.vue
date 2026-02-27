<script setup lang="ts">
/**
 * PaginatedTable – table with server-side pagination.
 *
 * Records are provided by the parent (via useSearch composable which
 * queries server-side SQLite with LIMIT/OFFSET). This component only
 * manages pagination controls and display.
 *
 * Supports sortable column headers: click to cycle asc → desc → none.
 */
import { ref, computed, watch, reactive } from 'vue'
import type { JsonRecord, ColumnDef } from '../types'
import { formatColumnName } from '../utils/format'

interface PageRecord {
  absIndex: number
  data: JsonRecord
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500]

const props = defineProps<{
  /** Total number of matching records (for pagination). */
  totalCount: number
  columns: ColumnDef[]
  /** Current page records from the server. */
  records: PageRecord[]
  /** When true, adds bottom padding so the fixed loading footer doesn't overlap. */
  isLoading?: boolean
  /** Currently sorted column key (empty = no sort). */
  sortColumn?: string
  /** Sort direction. */
  sortDirection?: 'asc' | 'desc'
  /** Whether a sort/search is in progress. */
  isSorting?: boolean
  /** Current page (1-based). */
  page: number
  /** Current page size. */
  pageSize: number
}>()

const emit = defineEmits<{
  (e: 'select-row', index: number): void
  (e: 'sort', column: string): void
  (e: 'reorder-column', fromKey: string, toKey: string): void
  (e: 'page-change', page: number): void
  (e: 'page-size-change', size: number): void
}>()

// ── Pagination ──
const totalPages = computed(() => Math.max(1, Math.ceil(props.totalCount / props.pageSize)))

const startRecord = computed(() => (props.page - 1) * props.pageSize + 1)
const endRecord = computed(() => Math.min(props.page * props.pageSize, props.totalCount))

const pageRange = computed(() => {
  const total = totalPages.value
  const current = props.page
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
  if (page >= 1 && page <= totalPages.value) {
    emit('page-change', page)
  }
}

function onPageSizeChange(e: Event) {
  const size = parseInt((e.target as HTMLSelectElement).value, 10)
  emit('page-size-change', size)
}

function getCellValue(record: JsonRecord | undefined, key: string): string {
  if (!record) return ''
  const val = record[key]
  if (val === undefined || val === null) return ''
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function onHeaderClick(column: string) {
  if (isResizingColumn.value || justFinishedResize.value) return
  emit('sort', column)
}

// ── Column drag reorder ──
const dragSourceKey = ref('')
const dragOverKey = ref('')

function onColDragStart(e: DragEvent, key: string) {
  dragSourceKey.value = key
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }
}
function onColDragOver(key: string) {
  if (key !== dragSourceKey.value) dragOverKey.value = key
}
function onColDragLeave() { dragOverKey.value = '' }
function onColDrop(targetKey: string) {
  dragOverKey.value = ''
  if (dragSourceKey.value && dragSourceKey.value !== targetKey) {
    emit('reorder-column', dragSourceKey.value, targetKey)
  }
  dragSourceKey.value = ''
}
function onColDragEnd() { dragSourceKey.value = ''; dragOverKey.value = '' }

// ── Column resize ──
const DEFAULT_COL_WIDTH = 180
const MIN_COL_WIDTH = 60
const columnWidths = reactive<Record<string, number>>({})

function getColWidth(key: string): number {
  return columnWidths[key] ?? DEFAULT_COL_WIDTH
}

const isResizingColumn = ref(false)
const justFinishedResize = ref(false)

function onResizeStart(e: MouseEvent, key: string) {
  e.preventDefault()
  e.stopPropagation()
  isResizingColumn.value = true
  const startX = e.clientX
  const startWidth = getColWidth(key)

  function onMouseMove(ev: MouseEvent) {
    const dx = ev.clientX - startX
    columnWidths[key] = Math.max(MIN_COL_WIDTH, startWidth + dx)
  }
  function onMouseUp() {
    isResizingColumn.value = false
    justFinishedResize.value = true
    setTimeout(() => { justFinishedResize.value = false }, 200)
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function pinnedLeft(col: ColumnDef): number {
  let left = 64 // row-number column width
  for (const c of props.columns) {
    if (c.key === col.key) break
    if (c.pinned && c.order < col.order) {
      left += getColWidth(c.key)
    }
  }
  return left
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Sort indicator bar -->
    <div
      v-if="sortColumn || isSorting"
      class="shrink-0 flex items-center gap-2 px-3 py-1 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-100 dark:border-blue-900/50 text-xs"
    >
      <template v-if="isSorting">
        <svg class="w-3 h-3 animate-spin text-blue-500 shrink-0" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <span class="text-blue-600 dark:text-blue-400">Sorting...</span>
      </template>
      <template v-else-if="sortColumn">
        <span class="text-blue-600 dark:text-blue-400">
          Sorted by <strong>{{ formatColumnName(sortColumn) }}</strong>
          {{ sortDirection === 'asc' ? '↑' : '↓' }}
        </span>
        <button
          class="ml-1 text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
          @click="emit('sort', sortColumn!)"
        >clear</button>
      </template>
    </div>

    <!-- Table container -->
    <div class="flex-1 overflow-auto virtual-table-scroll">
      <table class="w-full border-collapse min-w-max text-[13px] leading-relaxed table-striped">
        <!-- Sticky header -->
        <thead class="sticky top-0 z-20">
          <tr>
            <th class="shrink-0 w-16 px-3 py-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider border-b border-r border-gray-200/60 dark:border-gray-700/60 bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm sticky left-0 z-30 text-right">
              #
            </th>
            <th
              v-for="col in columns"
              :key="col.key"
              draggable="true"
              class="relative px-3 py-2 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-r border-gray-200/60 dark:border-gray-700/60 bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm text-left cell-truncate cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors group/th"
              :class="[
                col.pinned ? 'sticky z-30' : '',
                dragOverKey === col.key ? 'ring-2 ring-blue-400 ring-inset' : '',
              ]"
              :style="{
                width: getColWidth(col.key) + 'px',
                minWidth: getColWidth(col.key) + 'px',
                maxWidth: getColWidth(col.key) + 'px',
                ...(col.pinned ? { left: pinnedLeft(col) + 'px' } : {}),
              }"
              :title="`Click to sort · Drag to reorder`"
              @click="onHeaderClick(col.key)"
              @dragstart="onColDragStart($event, col.key)"
              @dragover.prevent="onColDragOver(col.key)"
              @dragleave="onColDragLeave"
              @drop.prevent="onColDrop(col.key)"
              @dragend="onColDragEnd"
            >
              <div class="flex items-center gap-1">
                <span class="truncate">{{ formatColumnName(col.key) }}</span>
                <span
                  v-if="sortColumn === col.key"
                  class="shrink-0 text-blue-500 dark:text-blue-400 text-[10px] font-bold"
                >
                  {{ sortDirection === 'asc' ? '▲' : '▼' }}
                </span>
              </div>
              <!-- Resize handle -->
              <div
                class="absolute top-0 right-0 w-[5px] h-full cursor-col-resize z-40 opacity-0 group-hover/th:opacity-100 hover:!opacity-100 transition-opacity"
                :class="isResizingColumn ? '!opacity-100' : ''"
                @mousedown="onResizeStart($event, col.key)"
              >
                <div class="w-[2px] h-full mx-auto bg-blue-400/60 dark:bg-blue-500/60"></div>
              </div>
            </th>
          </tr>
        </thead>

        <!-- Body – only current page rows -->
        <tbody>
          <tr
            v-for="row in records"
            :key="row.absIndex"
            class="group/row border-b border-gray-100/80 dark:border-gray-800/60 cursor-pointer transition-colors"
            @click="emit('select-row', row.absIndex)"
          >
            <td class="shrink-0 w-16 px-3 py-1.5 text-[11px] font-mono text-gray-400/80 dark:text-gray-500/80 border-r border-gray-100/60 dark:border-gray-800/40 bg-white dark:bg-gray-900 group-hover/row:bg-blue-50/60 dark:group-hover/row:bg-blue-950/30 sticky left-0 z-10 text-right tabular-nums select-none transition-colors">
              {{ row.absIndex + 1 }}
            </td>
            <td
              v-for="col in columns"
              :key="col.key"
              class="px-3 py-1.5 text-[13px] border-r border-gray-100/60 dark:border-gray-800/40 bg-white dark:bg-gray-900 group-hover/row:bg-blue-50/60 dark:group-hover/row:bg-blue-950/30 transition-colors"
              :class="col.pinned ? 'sticky z-10' : ''"
              :style="{
                width: getColWidth(col.key) + 'px',
                minWidth: getColWidth(col.key) + 'px',
                maxWidth: getColWidth(col.key) + 'px',
                ...(col.pinned ? { left: pinnedLeft(col) + 'px' } : {}),
              }"
            >
              <span
                class="cell-truncate block text-gray-700 dark:text-gray-300"
                :title="getCellValue(row.data, col.key)"
              >
                {{ getCellValue(row.data, col.key) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Empty state -->
      <div v-if="totalCount === 0 && !isLoading" class="py-20 text-center">
        <svg class="mx-auto mb-3 w-10 h-10 text-gray-300 dark:text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
        <p class="text-sm text-gray-400 dark:text-gray-600">No records to display</p>
      </div>
      <!-- Bottom spacer when loading footer is visible -->
      <div v-if="isLoading" class="h-8 shrink-0"></div>
    </div>

    <!-- Pagination footer -->
    <div
      v-if="totalCount > 0"
      class="shrink-0 flex items-center justify-between gap-4 px-4 py-2.5 border-t border-gray-200/80 dark:border-gray-700/80 bg-white dark:bg-gray-900 text-xs transition-[padding] duration-300 shadow-[0_-1px_3px_-1px_rgb(0,0,0,0.04)] dark:shadow-[0_-1px_3px_-1px_rgb(0,0,0,0.2)]"
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
            class="px-2 py-0.5 border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 shadow-soft"
          >
            <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
          </select>
        </div>
        <span class="text-gray-400 dark:text-gray-500">
          {{ startRecord.toLocaleString() }}–{{ endRecord.toLocaleString() }} of {{ totalCount.toLocaleString() }}
        </span>
      </div>

      <!-- Right: pagination buttons -->
      <div class="flex items-center gap-1">
        <button class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-gray-500 dark:text-gray-400" :disabled="page === 1" title="First page" @click="goToPage(1)">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
        </button>
        <button class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-gray-500 dark:text-gray-400" :disabled="page === 1" title="Previous page" @click="goToPage(page - 1)">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>

        <template v-for="(pg, idx) in pageRange" :key="idx">
          <span v-if="pg === -1" class="px-1 text-gray-400 dark:text-gray-600 select-none">…</span>
          <button v-else class="min-w-[24px] h-6 rounded text-center transition-colors" :class="pg === page ? 'bg-blue-600 text-white font-medium shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'" @click="goToPage(pg)">{{ pg }}</button>
        </template>

        <button class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-gray-500 dark:text-gray-400" :disabled="page === totalPages" title="Next page" @click="goToPage(page + 1)">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
        <button class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-gray-500 dark:text-gray-400" :disabled="page === totalPages" title="Last page" @click="goToPage(totalPages)">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>
  </div>
</template>
