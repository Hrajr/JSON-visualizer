<script setup lang="ts">
/**
 * VirtualTable – high-performance virtualised table for large datasets.
 * Dark-mode aware. Uses formatColumnName for display-friendly headers.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { JsonRecord, ColumnDef } from '../types'
import { formatColumnName } from '../utils/format'

const ROW_HEIGHT = 36
const BUFFER_ROWS = 10

const props = defineProps<{
  records: JsonRecord[]
  columns: ColumnDef[]
  filteredIndices: number[] | null
}>()

const emit = defineEmits<{
  (e: 'select-row', index: number): void
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const scrollTop = ref(0)
const containerHeight = ref(600)

const displayIndices = computed(() => {
  return props.filteredIndices ?? Array.from({ length: props.records.length }, (_, i) => i)
})

const totalRows = computed(() => displayIndices.value.length)
const totalHeight = computed(() => totalRows.value * ROW_HEIGHT)

const startRow = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - BUFFER_ROWS))
const endRow = computed(() => {
  const visibleCount = Math.ceil(containerHeight.value / ROW_HEIGHT)
  return Math.min(totalRows.value, Math.floor(scrollTop.value / ROW_HEIGHT) + visibleCount + BUFFER_ROWS)
})

const visibleRows = computed(() => {
  const rows: { dataIndex: number; displayIndex: number }[] = []
  const indices = displayIndices.value
  for (let i = startRow.value; i < endRow.value; i++) {
    rows.push({ dataIndex: indices[i], displayIndex: i })
  }
  return rows
})

const offsetY = computed(() => startRow.value * ROW_HEIGHT)

function onScroll(e: Event) {
  scrollTop.value = (e.target as HTMLDivElement).scrollTop
}

function getCellValue(record: JsonRecord, key: string): string {
  const val = record[key]
  if (val === undefined || val === null) return ''
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) containerHeight.value = entry.contentRect.height
    })
    resizeObserver.observe(containerRef.value)
  }
})
onBeforeUnmount(() => resizeObserver?.disconnect())

watch(() => props.filteredIndices, () => {
  if (containerRef.value) { containerRef.value.scrollTop = 0; scrollTop.value = 0 }
})
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Summary bar -->
    <div class="flex items-center justify-between px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shrink-0">
      <span>{{ totalRows.toLocaleString() }} rows</span>
      <span>{{ columns.length }} column{{ columns.length !== 1 ? 's' : '' }}</span>
    </div>

    <!-- Table container -->
    <div
      ref="containerRef"
      class="flex-1 overflow-auto virtual-table-scroll relative"
      @scroll="onScroll"
    >
      <!-- Sticky header -->
      <div class="sticky top-0 z-20 flex border-b border-gray-300 dark:border-gray-600 min-w-max">
        <!-- Row # column -->
        <div class="shrink-0 w-16 px-2 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 sticky left-0 z-30">
          #
        </div>
        <template v-for="col in columns" :key="col.key">
          <div
            class="shrink-0 px-2 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 cell-truncate"
            :class="col.pinned ? 'sticky z-30' : ''"
            :style="{
              width: '180px',
              minWidth: '180px',
              ...(col.pinned ? { left: `${64 + columns.filter(c => c.pinned && c.order < col.order).length * 180}px` } : {}),
            }"
            :title="col.key"
          >
            {{ formatColumnName(col.key) }}
          </div>
        </template>
      </div>

      <!-- Virtual space -->
      <div :style="{ height: `${totalHeight}px`, position: 'relative' }">
        <div :style="{ transform: `translateY(${offsetY}px)` }">
          <div
            v-for="row in visibleRows"
            :key="row.dataIndex"
            class="flex min-w-max border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer transition-colors"
            :style="{ height: `${ROW_HEIGHT}px` }"
            @click="emit('select-row', row.dataIndex)"
          >
            <!-- Row # -->
            <div class="shrink-0 w-16 px-2 flex items-center text-xs text-gray-400 dark:text-gray-500 border-r border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 sticky left-0 z-10">
              {{ row.dataIndex + 1 }}
            </div>
            <template v-for="col in columns" :key="col.key">
              <div
                class="shrink-0 px-2 flex items-center text-xs border-r border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900"
                :class="col.pinned ? 'sticky z-10' : ''"
                :style="{
                  width: '180px',
                  minWidth: '180px',
                  ...(col.pinned ? { left: `${64 + columns.filter(c => c.pinned && c.order < col.order).length * 180}px` } : {}),
                }"
              >
                <span
                  class="cell-truncate w-full text-gray-700 dark:text-gray-300"
                  :title="getCellValue(records[row.dataIndex], col.key)"
                >
                  {{ getCellValue(records[row.dataIndex], col.key) }}
                </span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty states -->
    <div v-if="totalRows === 0 && records.length > 0" class="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600">
      No matching records found
    </div>
    <div v-if="records.length === 0" class="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600">
      No data loaded
    </div>
  </div>
</template>
