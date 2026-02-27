<script setup lang="ts">
/**
 * LoadingFooter – ultra-thin fixed footer shown while a file is being parsed.
 * Shows a slim progress bar, percentage, record count, and a cancel button.
 */
defineProps<{
  progress: number
  bytesRead: number
  totalBytes: number
  recordsParsed: number
  fileName: string
}>()

defineEmits<{
  (e: 'cancel'): void
}>()

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
</script>

<template>
  <div class="fixed bottom-0 left-0 right-0 z-50">
    <!-- Progress bar (2px) -->
    <div class="h-0.5 bg-gray-200 dark:bg-gray-800">
      <div
        class="h-full bg-blue-500 transition-all duration-300 ease-out"
        :style="{ width: `${progress}%` }"
      ></div>
    </div>
    <!-- Info row -->
    <div class="flex items-center gap-3 px-3 py-1 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-t border-gray-200 dark:border-gray-800 text-[11px]">
      <svg class="w-3 h-3 animate-spin text-blue-500 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
      <span class="text-gray-500 dark:text-gray-400 truncate">{{ fileName }}</span>
      <span class="text-gray-400 dark:text-gray-500">{{ progress }}%</span>
      <span class="text-gray-400 dark:text-gray-500">{{ formatBytes(bytesRead) }} / {{ formatBytes(totalBytes) }}</span>
      <span class="text-gray-600 dark:text-gray-300 font-medium">{{ recordsParsed.toLocaleString() }} records</span>
      <button
        class="ml-auto px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors"
        @click="$emit('cancel')"
      >
        Cancel
      </button>
    </div>
  </div>
</template>
