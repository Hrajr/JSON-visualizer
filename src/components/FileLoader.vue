<script setup lang="ts">
/**
 * FileLoader – file input, drag & drop zone, sample generator, and progress display.
 */
import { ref, computed, type PropType } from 'vue'
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
}>()

const emit = defineEmits<{
  (e: 'load', file: File): void
  (e: 'cancel'): void
  (e: 'reset'): void
}>()

const isDragging = ref(false)
const sampleCount = ref(500)

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
    emit('load', input.files[0])
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
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
  const file = generateSampleFile(sampleCount.value)
  emit('load', file)
}

const isLoading = computed(() => props.state === 'loading')
const isLoaded = computed(() => props.state === 'loaded')
</script>

<template>
  <!-- Idle: show drop zone -->
  <div v-if="state === 'idle'" class="flex flex-col items-center gap-6 p-8">
    <div
      class="w-full max-w-xl border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer"
      :class="isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-white'"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
      @click="($refs.fileInput as HTMLInputElement).click()"
    >
      <svg class="mx-auto mb-3 w-12 h-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
      <p class="text-lg font-medium text-gray-600">Drop a .txt file here or click to browse</p>
      <p class="text-sm text-gray-400 mt-1">Concatenated JSON objects, any size</p>
      <input ref="fileInput" type="file" accept=".txt,.json" class="hidden" @change="onFileInput" />
    </div>

    <div class="flex items-center gap-3 text-sm text-gray-500">
      <span>Or generate sample:</span>
      <input
        v-model.number="sampleCount"
        type="number"
        min="10"
        max="100000"
        class="w-24 px-2 py-1 border rounded text-center"
      />
      <span>records</span>
      <button
        class="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-800 transition-colors"
        @click="loadSample"
      >
        Generate
      </button>
    </div>
  </div>

  <!-- Loading: show progress -->
  <div v-else-if="state === 'loading'" class="flex flex-col items-center gap-4 p-6">
    <div class="w-full max-w-lg">
      <div class="flex items-center justify-between text-sm text-gray-600 mb-1">
        <span>Parsing {{ fileName }}...</span>
        <span>{{ progress }}%</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2.5">
        <div
          class="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
          :style="{ width: `${progress}%` }"
        ></div>
      </div>
      <div class="flex items-center justify-between text-xs text-gray-500 mt-2">
        <span>{{ formatBytes(bytesRead) }} / {{ formatBytes(totalBytes) }}</span>
        <span>{{ recordsParsed.toLocaleString() }} records parsed</span>
      </div>
    </div>
    <button
      class="px-4 py-1.5 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
      @click="$emit('cancel')"
    >
      Cancel
    </button>
  </div>

  <!-- Loaded: show summary bar -->
  <div v-else class="flex items-center gap-4 px-4 py-2 text-sm">
    <span class="font-medium text-gray-700">{{ fileName }}</span>
    <span class="text-gray-500">{{ recordsParsed.toLocaleString() }} records</span>
    <span class="text-gray-500">{{ formatBytes(totalBytes) }}</span>
    <span v-if="errorCount > 0" class="text-amber-600">{{ errorCount }} error{{ errorCount > 1 ? 's' : '' }}</span>
    <button
      class="ml-auto px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
      @click="$emit('reset')"
    >
      Load Another
    </button>
  </div>
</template>
