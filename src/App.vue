<script setup lang="ts">
/**
 * App.vue – Root component.
 * Wires FileLoader, SearchBar, ColumnManager, VirtualTable, RowDrawer.
 * Includes dark/light mode toggle and keyboard shortcuts.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import FileLoader from './components/FileLoader.vue'
import SearchBar from './components/SearchBar.vue'
import ColumnManager from './components/ColumnManager.vue'
import VirtualTable from './components/VirtualTable.vue'
import RowDrawer from './components/RowDrawer.vue'

import { useParser } from './composables/useParser'
import { useSearch } from './composables/useSearch'
import { useColumns } from './composables/useColumns'
import { useTheme } from './composables/useTheme'

// ── Theme ──
const { isDark, toggle: toggleTheme } = useTheme()

// ── Parser ──
const {
  records, searchStrings, allKeys, errors, state,
  bytesRead, totalBytes, recordsParsed, progress, fileName,
  limitReached, maxRecords,
  startParsing, startParsingUrl, cancelParsing, reset: resetParser,
} = useParser()

// ── Columns ──
const {
  columns, visibleColumns,
  toggleVisibility, togglePin, moveColumn,
  showAll: showAllColumns, hideAll: hideAllColumns,
  reset: resetColumns,
} = useColumns(allKeys)

// ── Search ──
const totalRecordCount = computed(() => records.value.length)
const {
  query: searchQuery, matchingIndices, matchCount, searchTime, isSearching,
  dispose: disposeSearch,
} = useSearch(searchStrings, totalRecordCount)

// ── Row drawer ──
const selectedRowIndex = ref<number>(-1)
const drawerOpen = ref(false)

const selectedRecord = computed(() => {
  if (selectedRowIndex.value < 0 || selectedRowIndex.value >= records.value.length) return null
  return records.value[selectedRowIndex.value]
})

const allKeysList = computed(() => Array.from(allKeys.value.keys()))

function onSelectRow(index: number) {
  selectedRowIndex.value = index
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

// ── Column sidebar ──
const sidebarOpen = ref(true)
const columnFilterText = ref('')

// ── File loading ──
function onLoadFile(file: File) {
  resetColumns()
  searchQuery.value = ''
  selectedRowIndex.value = -1
  drawerOpen.value = false
  startParsing(file)
}

function onLoadUrl(url: string, name: string) {
  resetColumns()
  searchQuery.value = ''
  selectedRowIndex.value = -1
  drawerOpen.value = false
  startParsingUrl(url, name)
}

function onCancel() {
  cancelParsing()
}

function onReset() {
  resetParser()
  resetColumns()
  searchQuery.value = ''
  selectedRowIndex.value = -1
  drawerOpen.value = false
}

function onUpdateMaxRecords(val: number) {
  maxRecords.value = val
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

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => { window.removeEventListener('keydown', onKeydown); disposeSearch() })

const isDataReady = computed(() =>
  state.value === 'loaded' || (state.value === 'loading' && records.value.length > 0)
)
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

        <!-- Search (when data available) -->
        <template v-if="isDataReady">
          <SearchBar
            v-model="searchQuery"
            :match-count="matchCount"
            :total-count="records.length"
            :search-time="searchTime"
            :is-searching="isSearching"
          />
        </template>

        <div class="ml-auto flex items-center gap-1">
          <!-- Dark mode toggle -->
          <button
            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400"
            :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
            @click="toggleTheme"
          >
            <!-- Sun icon (shown in dark mode) -->
            <svg v-if="isDark" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <!-- Moon icon (shown in light mode) -->
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

      <!-- File progress / info bar -->
      <template v-if="state !== 'idle'">
        <FileLoader
          :state="state"
          :progress="progress"
          :bytes-read="bytesRead"
          :total-bytes="totalBytes"
          :records-parsed="recordsParsed"
          :file-name="fileName"
          :error-count="errors.length"
          :limit-reached="limitReached"
          :max-records="maxRecords"
          @load="onLoadFile"
          @load-url="onLoadUrl"
          @cancel="onCancel"
          @reset="onReset"
          @update:max-records="onUpdateMaxRecords"
        />
      </template>
    </header>

    <!-- Main content -->
    <div class="flex-1 flex min-h-0">
      <!-- Empty state -->
      <template v-if="state === 'idle'">
        <div class="flex-1 flex items-center justify-center">
          <FileLoader
            :state="state"
            :progress="0"
            :bytes-read="0"
            :total-bytes="0"
            :records-parsed="0"
            file-name=""
            :error-count="0"
            :limit-reached="false"
            :max-records="maxRecords"
            @load="onLoadFile"
            @load-url="onLoadUrl"
            @cancel="onCancel"
            @reset="onReset"
            @update:max-records="onUpdateMaxRecords"
          />
        </div>
      </template>

      <!-- Data view -->
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
          <VirtualTable
            v-if="isDataReady"
            :records="records"
            :columns="visibleColumns"
            :filtered-indices="matchingIndices"
            @select-row="onSelectRow"
          />
          <div v-else-if="state === 'loading'" class="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600">
            <div class="flex items-center gap-2">
              <svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              <span>Parsing file...</span>
            </div>
          </div>
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

    <!-- Error toast -->
    <Transition name="fade">
      <div
        v-if="errors.length > 0 && state === 'loaded'"
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
              {{ errors[0]?.message }}
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
