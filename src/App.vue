<script setup lang="ts">
/**
 * App.vue – Root component.
 *
 * Integrates: FileLoader, SearchBar, ColumnManager, PaginatedTable,
 * RowDrawer, LoadingFooter, DatasetManager.
 *
 * Architecture:
 *   - useParser: manages file parsing into a new dataset (SQLite)
 *   - useDatasets: manages persistence, multi-dataset selection
 *   - useSearch: search + sort across active datasets
 *   - useColumns: column visibility / order / pinning
 *
 * On page reload, datasets are restored from server-side SQLite.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import FileLoader from './components/FileLoader.vue'
import SearchBar from './components/SearchBar.vue'
import ColumnManager from './components/ColumnManager.vue'
import PaginatedTable from './components/PaginatedTable.vue'
import RowDrawer from './components/RowDrawer.vue'
import LoadingFooter from './components/LoadingFooter.vue'
import DatasetManager from './components/DatasetManager.vue'
import FilterModal from './components/FilterModal.vue'
import ChartModal from './components/ChartModal.vue'

import { useParser } from './composables/useParser'
import { useDatasets } from './composables/useDatasets'
import { useSearch } from './composables/useSearch'
import { useColumns } from './composables/useColumns'
import { useTheme } from './composables/useTheme'
import { formatColumnName } from './utils/format'
import { getRecordFromServer } from './utils/db'
import type { JsonRecord, DatasetRange } from './types'

// ── Theme ──
const { isDark, toggle: toggleTheme } = useTheme()

// ── View mode ──
// 'idle'    = show FileLoader full-page
// 'loading' = parsing in progress, show table + loading footer
// 'viewing' = data loaded, show table
const viewMode = ref<'idle' | 'loading' | 'viewing'>('idle')

// ── Parser ──
const {
  allKeys: parserAllKeys,
  errors,
  state: parserState,
  bytesRead, totalBytes, recordsParsed, dbRecordCount, progress,
  fileName: parserFileName,
  limitReached, maxRecords,
  currentDatasetId,
  startParsing, startParsingUrl, cancelParsing,
  reset: resetParser,
  onComplete: onParserComplete,
} = useParser()

// ── Datasets ──
const {
  datasets,
  activeIds,
  activeDatasets,
  datasetRanges,
  totalRecordCount,
  combinedKeys,
  init: initDatasets,
  addDataset,
  selectDataset,
  toggleDataset,
  setActiveIds,
  clearAllDatasets,
  removeDataset,
  getRecord: getDatasetRecord,
} = useDatasets()

// ── Effective display state (bridges loading vs viewing modes) ──
const displayRecordCount = computed(() => {
  if (viewMode.value === 'loading') return dbRecordCount.value
  return totalRecordCount.value
})

const displayKeys = computed(() => {
  if (viewMode.value === 'loading') return parserAllKeys.value
  if (viewMode.value === 'viewing') return combinedKeys.value
  return new Map<string, number>()
})

const effectiveRanges = computed<DatasetRange[]>(() => {
  if (viewMode.value === 'loading') {
    return dbRecordCount.value > 0
      ? [{ id: currentDatasetId.value || 'loading', offset: 0, count: dbRecordCount.value }]
      : []
  }
  return datasetRanges.value
})

const displayFileName = computed(() => {
  if (viewMode.value === 'loading') return parserFileName.value
  const active = activeDatasets.value
  if (active.length === 0) return ''
  if (active.length === 1) return active[0].fileName
  return `${active.length} datasets selected`
})

const displayTotalBytes = computed(() => {
  if (viewMode.value === 'loading') return totalBytes.value
  return activeDatasets.value.reduce((sum, ds) => sum + ds.totalBytes, 0)
})

// ── Columns ──
const {
  columns, visibleColumns,
  toggleVisibility, togglePin, moveColumn, reorderColumn,
  showAll: showAllColumns, hideAll: hideAllColumns,
  reset: resetColumns,
} = useColumns(displayKeys)

// ── Search + Sort ──
const {
  query: searchQuery,
  propertyFilters,
  matchCount, searchTime, isSearching,
  sortColumn, sortDirection, isSorting,
  page, pageSize, pageRecords,
  setSort,
  resetSort,
  setPage,
  setPageSize,
  fetchPage,
  dispose: disposeSearch,
} = useSearch(displayRecordCount, effectiveRanges)

// ── Row drawer ──
const selectedRowIndex = ref<number>(-1)
const drawerOpen = ref(false)
const selectedRecord = ref<JsonRecord | null>(null)

// ── Filter modal ──
const filterModalOpen = ref(false)

// ── Chart modal ──
const chartModalOpen = ref(false)

const allKeysList = computed(() => Array.from(displayKeys.value.keys()))

async function onSelectRow(index: number) {
  selectedRowIndex.value = index
  drawerOpen.value = true
  selectedRecord.value = null

  if (viewMode.value === 'loading') {
    // During loading, fetch from the current dataset being loaded
    const rec = await getRecordFromServer(currentDatasetId.value, index)
    selectedRecord.value = rec ?? null
  } else {
    const rec = await getDatasetRecord(index)
    selectedRecord.value = rec ?? null
  }
}

function closeDrawer() {
  drawerOpen.value = false
}

// ── Column sidebar ──
const sidebarOpen = ref(localStorage.getItem('jv-sidebar-open') !== 'false')
const sidebarWidth = ref(parseInt(localStorage.getItem('jv-sidebar-width') || '224'))
const columnFilterText = ref('')
const isResizingSidebar = ref(false)

watch(sidebarOpen, (val) => localStorage.setItem('jv-sidebar-open', String(val)))

function onSidebarResizeStart(e: MouseEvent) {
  e.preventDefault()
  isResizingSidebar.value = true
  const startX = e.clientX
  const startWidth = sidebarWidth.value

  function onMouseMove(ev: MouseEvent) {
    const dx = ev.clientX - startX
    sidebarWidth.value = Math.max(160, Math.min(500, startWidth + dx))
  }
  function onMouseUp() {
    isResizingSidebar.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    localStorage.setItem('jv-sidebar-width', String(sidebarWidth.value))
  }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// ── Multi-file queue ──
const urlQueue = ref<{ url: string; name: string }[]>([])
const batchLoadedIds = ref<string[]>([])
const batchTotal = ref(0)
const batchDone = computed(() => batchTotal.value - urlQueue.value.length)

// ── Computed states ──
const isDataReady = computed(() => viewMode.value === 'loading' || viewMode.value === 'viewing')

// ── Watch parser state for errors ──
watch(parserState, (state) => {
  if (state === 'error' && viewMode.value === 'loading') {
    // If we have previously active datasets, go back to viewing
    if (activeDatasets.value.length > 0) {
      viewMode.value = 'viewing'
    } else {
      viewMode.value = 'idle'
    }
  }
})

// ── Parser completion callback ──
onParserComplete((info) => {
  const isBatch = batchTotal.value > 1
  addDataset(info, !isBatch) // Don't change active selection during batch
  batchLoadedIds.value.push(info.id)

  // If there are more files in the queue, start the next one
  if (urlQueue.value.length > 0) {
    const next = urlQueue.value.shift()!
    startParsingUrl(next.url, next.name)
    return
  }

  // All files loaded – activate all batch-loaded datasets
  if (isBatch) {
    setActiveIds([...batchLoadedIds.value])
  }

  batchTotal.value = 0
  batchLoadedIds.value = []
  viewMode.value = 'viewing'
})

// ── File loading ──
async function onLoadFile(file: File) {
  // IMMEDIATELY switch mode so the table stops fetching from old databases
  viewMode.value = 'loading'
  selectedRowIndex.value = -1
  drawerOpen.value = false
  resetColumns()
  searchQuery.value = ''
  propertyFilters.value = []
  resetSort()

  // Terminate workers & delete ALL old datasets
  resetParser()
  await clearAllDatasets()

  urlQueue.value = []
  batchLoadedIds.value = []
  batchTotal.value = 0
  startParsing(file)
}

async function onLoadUrls(files: { url: string; name: string }[]) {
  if (files.length === 0) return
  // IMMEDIATELY switch mode so the table stops fetching from old databases
  viewMode.value = 'loading'
  selectedRowIndex.value = -1
  drawerOpen.value = false
  resetColumns()
  searchQuery.value = ''
  propertyFilters.value = []
  resetSort()

  // Terminate workers & delete ALL old datasets
  resetParser()
  await clearAllDatasets()

  // Queue all files, start the first one
  const [first, ...rest] = files
  urlQueue.value = rest
  batchLoadedIds.value = []
  batchTotal.value = files.length
  startParsingUrl(first.url, first.name)
}

function onCancel() {
  cancelParsing()
  urlQueue.value = []
  batchTotal.value = 0
  // If we have active datasets, go back to viewing them
  if (activeDatasets.value.length > 0) {
    viewMode.value = 'viewing'
  } else {
    viewMode.value = 'idle'
  }
}

function onStartNewLoad() {
  resetParser()
  resetColumns()
  searchQuery.value = ''
  propertyFilters.value = []
  resetSort()
  selectedRowIndex.value = -1
  drawerOpen.value = false
  urlQueue.value = []
  batchTotal.value = 0
  batchLoadedIds.value = []
  viewMode.value = 'idle'
}

function onReset() {
  onStartNewLoad()
}

function onUpdateMaxRecords(val: number) {
  maxRecords.value = val
}

// ── Dataset switching ──
function onSelectDataset(id: string) {
  selectDataset(id)
  resetParser()
  resetColumns()
  searchQuery.value = ''
  propertyFilters.value = []
  resetSort()
  viewMode.value = 'viewing'
}

function onToggleDataset(id: string) {
  toggleDataset(id)
  if (activeIds.value.length === 0) {
    resetParser()
    resetColumns()
    viewMode.value = 'idle'
  } else {
    resetColumns()
    searchQuery.value = ''
    propertyFilters.value = []
    resetSort()
    viewMode.value = 'viewing'
  }
}

async function onRemoveDataset(id: string) {
  await removeDataset(id)
  if (activeIds.value.length === 0) {
    resetParser()
    resetColumns()
    viewMode.value = 'idle'
  } else {
    resetColumns()
  }
}

function onSort(column: string) {
  setSort(column)
}

// ── Keyboard shortcuts ──
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault()
    const input = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement | null
    input?.focus()
  }
  if (e.key === 'Escape' && drawerOpen.value) {
    closeDrawer()
  }
}

// ── Lifecycle ──
onMounted(async () => {
  window.addEventListener('keydown', onKeydown)

  // Restore persisted datasets from server-side SQLite
  await initDatasets()
  if (activeDatasets.value.length > 0) {
    viewMode.value = 'viewing'
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  disposeSearch()
})
</script>

<template>
  <div class="h-screen flex flex-col bg-gray-50 dark:bg-gray-950 overflow-hidden transition-colors">
    <!-- Top bar -->
    <header class="shrink-0 border-b border-gray-200/60 dark:border-gray-800/60 bg-white dark:bg-gray-900">
      <div class="flex items-center gap-3 px-4 h-12">
        <!-- Left: Logo -->
        <div class="flex items-center gap-2 shrink-0">
          <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
            <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
            </svg>
          </div>
          <span class="text-sm font-semibold text-gray-800 dark:text-gray-100 tracking-tight hidden sm:block">JSON Visualizer</span>
        </div>

        <!-- Center: Search bar (when data available) -->
        <div v-if="isDataReady" class="flex-1 flex justify-center px-4">
          <SearchBar
            v-model="searchQuery"
            :match-count="matchCount"
            :total-count="displayRecordCount"
            :search-time="searchTime"
            :is-searching="isSearching"
          />
        </div>
        <div v-else class="flex-1"></div>

        <!-- Right: Action buttons -->
        <div class="flex items-center gap-0.5 shrink-0">
          <!-- Charts button -->
          <button
            v-if="isDataReady"
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Charts & Diagrams"
            @click="chartModalOpen = true"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span class="hidden sm:inline">Charts</span>
          </button>

          <!-- Filter button -->
          <button
            v-if="isDataReady"
            class="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            :class="propertyFilters.length > 0
              ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/60'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'"
            title="Property filters"
            @click="filterModalOpen = true"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <span class="hidden sm:inline">Filters</span>
            <span
              v-if="propertyFilters.length > 0"
              class="absolute -top-1 -right-1 w-4 h-4 text-[9px] font-bold bg-blue-600 text-white rounded-full flex items-center justify-center"
            >
              {{ propertyFilters.length }}
            </span>
          </button>

          <!-- Dataset manager -->
          <DatasetManager
            v-if="datasets.length > 0"
            :datasets="datasets"
            :active-ids="activeIds"
            @select="onSelectDataset"
            @toggle="onToggleDataset"
            @remove="onRemoveDataset"
          />

          <!-- Column panel toggle -->
          <button
            v-if="isDataReady"
            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400"
            :title="sidebarOpen ? 'Hide column panel' : 'Show column panel'"
            @click="sidebarOpen = !sidebarOpen"
          >
            <svg class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 4h18M3 8h18M3 12h18M3 16h12M3 20h8" />
            </svg>
          </button>

          <!-- Dark mode toggle -->
          <button
            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400"
            :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
            @click="toggleTheme"
          >
            <svg v-if="isDark" class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <svg v-else class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          </button>
        </div>
      </div>

      <!-- File info bar (viewing mode) -->
      <div
        v-if="viewMode === 'viewing'"
        class="flex items-center gap-3 px-4 py-1.5 text-xs border-t border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/50"
      >
        <span class="font-medium text-gray-600 dark:text-gray-300 tracking-tight truncate max-w-xs">{{ displayFileName }}</span>
        <span class="text-gray-400 dark:text-gray-500 font-mono tabular-nums">{{ displayRecordCount.toLocaleString() }} records</span>
        <span v-if="limitReached" class="text-amber-600 dark:text-amber-400 font-medium">
          Limit ({{ maxRecords.toLocaleString() }})
        </span>
        <span v-if="errors.length > 0" class="text-amber-600 dark:text-amber-400">
          {{ errors.length }} error{{ errors.length > 1 ? 's' : '' }}
        </span>
        <span v-if="propertyFilters.length > 0" class="text-blue-500 dark:text-blue-400">
          {{ propertyFilters.length }} filter{{ propertyFilters.length > 1 ? 's' : '' }} active
        </span>
        <button
          class="ml-auto px-2.5 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
          @click="onStartNewLoad"
        >
          Load Another
        </button>
      </div>
    </header>

    <!-- Main content -->
    <div class="flex-1 flex min-h-0">
      <!-- Empty state -->
      <template v-if="viewMode === 'idle'">
        <div class="flex-1 flex items-center justify-center">
          <div class="flex flex-col items-center gap-6 w-full max-w-2xl px-8">
            <!-- Previously loaded datasets -->
            <div
              v-if="datasets.length > 0"
              class="w-full bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700/80 p-5"
            >
              <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Previously Loaded Datasets</h3>
              <div class="space-y-1 max-h-40 overflow-y-auto virtual-table-scroll">
                <button
                  v-for="ds in datasets"
                  :key="ds.id"
                  class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors group"
                  @click="onSelectDataset(ds.id)"
                >
                  <svg class="w-4 h-4 text-gray-400 dark:text-gray-500 group-hover:text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <div class="flex-1 min-w-0">
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate block">{{ ds.fileName }}</span>
                    <span class="text-xs text-gray-400 dark:text-gray-500">{{ ds.recordCount.toLocaleString() }} records</span>
                  </div>
                  <svg class="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- File loader -->
            <FileLoader
              :state="'idle'"
              :progress="0"
              :bytes-read="0"
              :total-bytes="0"
              :records-parsed="0"
              file-name=""
              :error-count="0"
              :limit-reached="false"
              :max-records="maxRecords"
              @load="onLoadFile"
              @load-urls="onLoadUrls"
              @cancel="onCancel"
              @reset="onReset"
              @update:max-records="onUpdateMaxRecords"
            />
          </div>
        </div>
      </template>

      <!-- Data view (loading or viewing) -->
      <template v-else>
        <!-- Left sidebar -->
        <Transition name="sidebar">
          <aside
            v-if="sidebarOpen && isDataReady"
            class="shrink-0 border-r border-gray-200/80 dark:border-gray-800/80 bg-white dark:bg-gray-900 overflow-hidden relative"
            :style="{ width: sidebarWidth + 'px' }"
          >
            <ColumnManager
              :columns="columns"
              :visible-count="visibleColumns.length"
              :total-count="columns.length"
              v-model:filter-text="columnFilterText"
              @toggle-visibility="toggleVisibility"
              @toggle-pin="togglePin"
              @move="moveColumn"
              @show-all="showAllColumns"
              @hide-all="hideAllColumns"
            />
          </aside>
        </Transition>

        <!-- Sidebar resize handle -->
        <div
          v-if="sidebarOpen && isDataReady"
          class="sidebar-resize-handle"
          :class="{ 'sidebar-resize-active': isResizingSidebar }"
          @mousedown="onSidebarResizeStart"
        ></div>

        <!-- Table -->
        <main class="flex-1 min-w-0 flex flex-col">
          <PaginatedTable
            v-if="isDataReady"
            :total-count="matchCount"
            :columns="visibleColumns"
            :records="pageRecords"
            :page="page"
            :page-size="pageSize"
            :is-loading="viewMode === 'loading'"
            :sort-column="sortColumn"
            :sort-direction="sortDirection"
            :is-sorting="isSorting"
            @select-row="onSelectRow"
            @sort="onSort"
            @reorder-column="reorderColumn"
            @page-change="setPage"
            @page-size-change="setPageSize"
          />
        </main>
      </template>
    </div>

    <!-- Row detail drawer -->
    <RowDrawer
      :record="selectedRecord"
      :record-index="selectedRowIndex"
      :open="drawerOpen"
      :all-keys="allKeysList"
      @close="closeDrawer"
    />

    <!-- Loading footer -->
    <LoadingFooter
      v-if="viewMode === 'loading'"
      :progress="progress"
      :bytes-read="bytesRead"
      :total-bytes="totalBytes"
      :records-parsed="recordsParsed"
      :file-name="batchTotal > 1 ? `[${batchDone + 1}/${batchTotal}] ${parserFileName}` : parserFileName"
      @cancel="onCancel"
    />

    <!-- Error toast -->
    <Transition name="fade">
      <div
        v-if="errors.length > 0"
        class="fixed bottom-4 right-4 bg-amber-50 dark:bg-amber-950/80 border border-amber-200/80 dark:border-amber-800/60 rounded-2xl shadow-card p-4 max-w-sm z-30 backdrop-blur-sm"
      >
        <div class="flex items-start gap-2">
          <svg class="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
          <div>
            <p class="text-sm font-medium text-amber-800 dark:text-amber-200">
              {{ errors.length }} parse error{{ errors.length > 1 ? 's' : '' }}
            </p>
            <p class="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              {{ errors[0]?.message || 'Some records could not be parsed' }}
            </p>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Filter modal -->
    <FilterModal
      :open="filterModalOpen"
      :all-keys="allKeysList"
      :selected-keys="propertyFilters"
      @update:selected-keys="propertyFilters = $event"
      @close="filterModalOpen = false"
    />

    <!-- Chart modal -->
    <ChartModal
      :open="chartModalOpen"
      :all-keys="allKeysList"
      :search-query="searchQuery"
      :property-filters="propertyFilters"
      :dataset-ranges="effectiveRanges"
      :match-count="matchCount"
      @close="chartModalOpen = false"
    />
  </div>
</template>

<style scoped>
.sidebar-enter-active, .sidebar-leave-active {
  transition: width 0.2s ease, opacity 0.2s ease;
}
.sidebar-enter-from, .sidebar-leave-to {
  width: 0;
  opacity: 0;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
