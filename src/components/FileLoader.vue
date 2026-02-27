<script setup lang="ts">
/**
 * FileLoader – file input, drag-and-drop, load-from-data-folder, sample generator, progress.
 * Dark-mode aware.
 */
import { ref, computed } from 'vue'
import type { AppState } from '../types'
import { generateSampleFile } from '../utils/sample'

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
  (e: 'load-url', url: string, name: string): void
  (e: 'cancel'): void
  (e: 'reset'): void
  (e: 'update:maxRecords', val: number): void
}>()

const isDragging = ref(false)
const sampleCount = ref(500)
const dataFileName = ref('data.txt')
const localMaxRecords = ref(props.maxRecords)

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

function loadFromDataFolder() {
  const name = dataFileName.value.trim()
  if (!name) return
  emit('update:maxRecords', localMaxRecords.value)
  emit('load-url', `/data/${name}`, name)
}

const isLoading = computed(() => props.state === 'loading')
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

    <!-- Load from data folder (for huge files) -->
    <div class="w-full bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Load from data folder</h3>
      <p class="text-xs text-gray-400 dark:text-gray-500 mb-3">
        For very large files (multi-GB), place the file in <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">public/data/</code> and load it via streaming fetch. This avoids browser file-picker memory issues.
      </p>
      <div class="flex items-center gap-2">
        <div class="flex-1 relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-gray-500 select-none">/data/</span>
          <input
            v-model="dataFileName"
            type="text"
            placeholder="filename.txt"
            class="w-full pl-12 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <button
          class="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
          @click="loadFromDataFolder"
        >
          Load File
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
