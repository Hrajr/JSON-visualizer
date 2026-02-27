<script setup lang="ts">
/**
 * App.vue – Root component.
 *
 * Integrates: FileLoader, SearchBar, ColumnManager, PaginatedTable,
 * RowDrawer, LoadingFooter, DatasetManager.
 *
 * Architecture:
 *   - useParser: manages file parsing into a new dataset (IndexedDB)
 *   - useDatasets: manages persistence, multi-dataset selection
 *   - useSearch: search + sort across active datasets
 *   - useColumns: column visibility / order / pinning
 *
 * On page reload, datasets are restored from localStorage + IndexedDB.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import FileLoader from './components/FileLoader.vue'
import SearchBar from './components/SearchBar.vue'
import ColumnManager from './components/ColumnManager.vue'
import PaginatedTable from './components/PaginatedTable.vue'
import RowDrawer from './components/RowDrawer.vue'
import LoadingFooter from './components/LoadingFooter.vue'
import DatasetManager from './components/DatasetManager.vue'

import { useParser } from './composables/useParser'
import { useDatasets } from './composables/useDatasets'
import { useSearch } from './composables/useSearch'
import { useColumns } from './composables/useColumns'
import { useTheme } from './composables/useTheme'
import { formatColumnName } from './utils/format'
import { getRecordFromDB } from './utils/db'
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
  currentDbName,
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
      ? [{ id: 'loading', dbName: currentDbName.value, offset: 0, count: dbRecordCount.value }]
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
  toggleVisibility, togglePin, moveColumn,
  showAll: showAllColumns, hideAll: hideAllColumns,
  reset: resetColumns,
} = useColumns(displayKeys)

// ── Search + Sort ──
const {
  query: searchQuery,
  propertyFilter,
  matchCount, searchTime, isSearching,
  sortColumn, sortDirection, isSorting,
  displayIndices,
  setSort,
  resetSort,
  dispose: disposeSearch,
} = useSearch(displayRecordCount, effectiveRanges)

// ── Row drawer ──
const selectedRowIndex = ref<number>(-1)
const drawerOpen = ref(false)
const selectedRecord = ref<JsonRecord | null>(null)

const allKeysList = computed(() => Array.from(displayKeys.value.keys()))

async function onSelectRow(index: number) {
  selectedRowIndex.value = index
  drawerOpen.value = true
  selectedRecord.value = null

  if (viewMode.value === 'loading') {
    // During loading, use the single loading DB
    const rec = await getRecordFromDB(currentDbName.value, index)
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
const sidebarOpen = ref(true)
const columnFilterText = ref('')

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
function onLoadFile(file: File) {
  urlQueue.value = []
  batchLoadedIds.value = []
  batchTotal.value = 0
  resetColumns()
  searchQuery.value = ''
  propertyFilter.value = ''
  resetSort()
  selectedRowIndex.value = -1
  drawerOpen.value = false
  viewMode.value = 'loading'
  startParsing(file)
}

function onLoadUrls(files: { url: string; name: string }[]) {
  if (files.length === 0) return
  resetColumns()
  searchQuery.value = ''
  propertyFilter.value = ''
  resetSort()
  selectedRowIndex.value = -1
  drawerOpen.value = false

  // Queue all files, start the first one
  const [first, ...rest] = files
  urlQueue.value = rest
  batchLoadedIds.value = []
  batchTotal.value = files.length
  viewMode.value = 'loading'
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
  propertyFilter.value = ''
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
  propertyFilter.value = ''
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
    propertyFilter.value = ''
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
onMounted(() => {
  window.addEventListener('keydown', onKeydown)

  // Restore persisted datasets
  initDatasets()
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
    <header class="shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
      <div class="flex items-center gap-4 px-4 py-2">
        <!-- Title -->
        <h1 class="text-base font-bold text-gray-800 dark:text-gray-100 whitespace-nowrap tracking-tight">
          JSON Visualizer
        </h1>

        <!-- Search + property filter (when data available) -->
        <template v-if="isDataReady">
          <SearchBar
            v-model="searchQuery"
            :match-count="matchCount"
            :total-count="displayRecordCount"
            :search-time="searchTime"
            :is-searching="isSearching"
          />

          <!-- Non-empty property filter -->
          <div class="flex items-center gap-1.5">
            <select
              v-model="propertyFilter"
              class="px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 max-w-[180px] truncate"
              title="Filter records that have a value for this property"
            >
              <option value="">All properties</option>
              <option v-for="key in allKeysList" :key="key" :value="key">
                {{ formatColumnName(key) }}
              </option>
            </select>
            <span v-if="propertyFilter" class="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">has value</span>
          </div>
        </template>

        <div class="ml-auto flex items-center gap-1">
          <!-- Dataset manager -->
          <DatasetManager
            v-if="datasets.length > 0"
            :datasets="datasets"
            :active-ids="activeIds"
            @select="onSelectDataset"
            @toggle="onToggleDataset"
            @remove="onRemoveDataset"
          />

          <!-- Dark mode toggle -->
          <button
            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400"
            :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
            @click="toggleTheme"
          >
            <svg v-if="isDark" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <svg v-else class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          </button>

          <!-- Column panel toggle -->
          <button
            v-if="isDataReady"
            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400"
            :title="sidebarOpen ? 'Hide column panel' : 'Show column panel'"
            @click="sidebarOpen = !sidebarOpen"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 4h6M9 8h6M9 12h6M9 16h6M9 20h6" />
            </svg>
          </button>
        </div>
      </div>

      <!-- File summary bar (viewing mode) -->
      <template v-if="viewMode === 'viewing'">
        <div class="flex items-center gap-4 px-4 py-2 text-sm border-t border-gray-100 dark:border-gray-800">
          <span class="font-medium text-gray-700 dark:text-gray-300">{{ displayFileName }}</span>
          <span class="text-gray-500 dark:text-gray-400">{{ displayRecordCount.toLocaleString() }} records</span>
          <span v-if="limitReached" class="text-amber-600 dark:text-amber-400 text-xs font-medium">
            Limit reached ({{ maxRecords.toLocaleString() }})
          </span>
          <span v-if="errors.length > 0" class="text-amber-600 dark:text-amber-400">
            {{ errors.length }} error{{ errors.length > 1 ? 's' : '' }}
          </span>
          <button
            class="ml-auto px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            @click="onStartNewLoad"
          >
            Load Another
          </button>
        </div>
      </template>
    </header>

    <!-- Main content -->
    <div class="flex-1 flex min-h-0">
      <!-- Empty state -->
      <template v-if="viewMode === 'idle'">
        <div class="flex-1 flex items-center justify-center">
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
      </template>

      <!-- Data view (loading or viewing) -->
      <template v-else>
        <!-- Left sidebar -->
        <Transition name="sidebar">
          <aside
            v-if="sidebarOpen && isDataReady"
            class="w-56 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden"
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

        <!-- Table -->
        <main class="flex-1 min-w-0 flex flex-col">
          <PaginatedTable
            v-if="isDataReady"
            :record-count="displayRecordCount"
            :columns="visibleColumns"
            :filtered-indices="displayIndices"
            :is-loading="viewMode === 'loading'"
            :dataset-ranges="effectiveRanges"
            :sort-column="sortColumn"
            :sort-direction="sortDirection"
            :is-sorting="isSorting"
            @select-row="onSelectRow"
            @sort="onSort"
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
        class="fixed bottom-4 right-4 bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800 rounded-xl shadow-lg p-4 max-w-sm z-30"
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
