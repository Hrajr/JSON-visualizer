<script setup lang="ts">
/**
 * FileLoader – file input, drag-and-drop, load-from-data-folder, sample generator.
 * The data folder section auto-discovers .txt files and allows multi-select.
 * Dark-mode aware.
 */
import { ref, computed, onMounted } from 'vue'
import type { AppState } from '../types'
import { generateSampleFile } from '../utils/sample'
import { useDataFolder } from '../composables/useDataFolder'

const props = defineProps<{
  state: AppState
  progress: number
  bytesRead: number
  totalBytes: number
  recordsParsed: number
  fileName: string
  errorCount: number
  limitReached: boolean
  maxRecords: number
}>()

const emit = defineEmits<{
  (e: 'load', file: File): void
  (e: 'load-urls', files: { url: string; name: string }[]): void
  (e: 'cancel'): void
  (e: 'reset'): void
  (e: 'update:maxRecords', val: number): void
}>()

const isDragging = ref(false)
const sampleCount = ref(500)
const localMaxRecords = ref(props.maxRecords)

const {
  files: dataFiles,
  isLoading: isScanning,
  error: scanError,
  selectedFiles,
  hasSelection,
  refresh: refreshDataFolder,
  toggleFile,
  selectAll,
  deselectAll,
} = useDataFolder()

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files && input.files[0]) {
    emit('update:maxRecords', localMaxRecords.value)
    emit('load', input.files[0])
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
    emit('update:maxRecords', localMaxRecords.value)
    emit('load', e.dataTransfer.files[0])
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

function onDragLeave() {
  isDragging.value = false
}

function loadSample() {
  emit('update:maxRecords', localMaxRecords.value)
  const file = generateSampleFile(sampleCount.value)
  emit('load', file)
}

function loadSelectedFiles() {
  if (!hasSelection.value) return
  emit('update:maxRecords', localMaxRecords.value)
  const toLoad = selectedFiles.value.map(name => ({
    url: `/data/${name}`,
    name,
  }))
  emit('load-urls', toLoad)
}

const isLoading = computed(() => props.state === 'loading')

onMounted(() => {
  refreshDataFolder()
})
</script>

<template>
  <!-- Idle: show full loading interface -->
  <div v-if="state === 'idle'" class="flex flex-col items-center gap-8 p-8 max-w-2xl mx-auto">
    <!-- Drop zone -->
    <div
      class="w-full border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer"
      :class="isDragging
        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 bg-white dark:bg-gray-900'"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
      @click="($refs.fileInput as HTMLInputElement).click()"
    >
      <svg class="mx-auto mb-4 w-14 h-14 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
      <p class="text-lg font-medium text-gray-600 dark:text-gray-300">Drop a .txt file here or click to browse</p>
      <p class="text-sm text-gray-400 dark:text-gray-500 mt-1">Concatenated JSON objects, any size</p>
      <input ref="fileInput" type="file" accept=".txt,.json" class="hidden" @change="onFileInput" />
    </div>

    <!-- Data folder file picker -->
    <div class="w-full bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <div class="flex items-center justify-between mb-1">
        <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Load from data folder</h3>
        <button
          class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-400 dark:text-gray-500"
          title="Refresh file list"
          @click="refreshDataFolder"
        >
          <svg class="w-4 h-4" :class="{ 'animate-spin': isScanning }" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
      <p class="text-xs text-gray-400 dark:text-gray-500 mb-3">
        Place .txt files in <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">public/data/</code> and select one or more to load.
      </p>

      <!-- Error -->
      <p v-if="scanError" class="text-xs text-red-500 dark:text-red-400 mb-2">{{ scanError }}</p>

      <!-- File list -->
      <div v-if="dataFiles.length > 0" class="space-y-1 max-h-48 overflow-y-auto mb-3">
        <label
          v-for="f in dataFiles"
          :key="f.name"
          class="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        >
          <input
            type="checkbox"
            :checked="f.selected"
            class="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 accent-blue-600 shrink-0"
            @change="toggleFile(f.name)"
          />
          <svg class="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <span class="text-sm text-gray-700 dark:text-gray-300 truncate">{{ f.name }}</span>
        </label>
      </div>

      <!-- Empty state -->
      <div v-else-if="!isScanning" class="py-4 text-center">
        <p class="text-xs text-gray-400 dark:text-gray-500">No .txt files found in <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">public/data/</code></p>
      </div>

      <!-- Scanning -->
      <div v-if="isScanning" class="py-3 text-center">
        <p class="text-xs text-gray-400 dark:text-gray-500">Scanning...</p>
      </div>

      <!-- Action buttons -->
      <div v-if="dataFiles.length > 0" class="flex items-center gap-2">
        <button
          class="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          @click="selectAll"
        >
          Select All
        </button>
        <button
          class="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          @click="deselectAll"
        >
          Deselect All
        </button>
        <div class="flex-1"></div>
        <span v-if="hasSelection" class="text-xs text-gray-400 dark:text-gray-500">
          {{ selectedFiles.length }} file{{ selectedFiles.length > 1 ? 's' : '' }} selected
        </span>
        <button
          :disabled="!hasSelection"
          class="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          @click="loadSelectedFiles"
        >
          Load Selected
        </button>
      </div>
    </div>

    <!-- Options row -->
    <div class="w-full flex flex-wrap items-center justify-between gap-4">
      <!-- Record limit -->
      <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <label>Max records:</label>
        <input
          v-model.number="localMaxRecords"
          type="number"
          min="0"
          step="10000"
          class="w-28 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <span class="text-xs text-gray-400">(0 = unlimited)</span>
      </div>

      <!-- Sample generator -->
      <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span>Sample:</span>
        <input
          v-model.number="sampleCount"
          type="number"
          min="10"
          max="100000"
          class="w-24 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          class="px-3 py-1 bg-gray-700 dark:bg-gray-600 text-white rounded-lg hover:bg-gray-800 dark:hover:bg-gray-500 transition-colors text-sm"
          @click="loadSample"
        >
          Generate
        </button>
      </div>
    </div>
  </div>

  <!-- Loaded: summary bar -->
  <div v-else class="flex items-center gap-4 px-4 py-2 text-sm">
    <span class="font-medium text-gray-700 dark:text-gray-300">{{ fileName }}</span>
    <span class="text-gray-500 dark:text-gray-400">{{ recordsParsed.toLocaleString() }} records</span>
    <span class="text-gray-500 dark:text-gray-400">{{ formatBytes(totalBytes) }}</span>
    <span v-if="limitReached" class="text-amber-600 dark:text-amber-400 text-xs font-medium">
      Limit reached ({{ maxRecords.toLocaleString() }})
    </span>
    <span v-if="errorCount > 0" class="text-amber-600 dark:text-amber-400">
      {{ errorCount }} error{{ errorCount > 1 ? 's' : '' }}
    </span>
    <button
      class="ml-auto px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
      @click="$emit('reset')"
    >
      Load Another
    </button>
  </div>
</template>
