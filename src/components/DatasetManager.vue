<script setup lang="ts">
/**
 * DatasetManager – dropdown menu for managing previously loaded datasets.
 * Shows a list of datasets with checkboxes for multi-select, delete buttons,
 * and metadata (record count, file size, load date).
 */
import { ref, computed } from 'vue'
import type { DatasetInfo } from '../types'

const props = defineProps<{
  datasets: DatasetInfo[]
  activeIds: string[]
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'toggle', id: string): void
  (e: 'remove', id: string): void
}>()

const open = ref(false)

const activeCount = computed(() => props.activeIds.length)

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function isActive(id: string): boolean {
  return props.activeIds.includes(id)
}

function onCheckboxChange(id: string) {
  emit('toggle', id)
}

function onNameClick(id: string) {
  emit('select', id)
  open.value = false
}

function onRemove(e: Event, id: string) {
  e.stopPropagation()
  emit('remove', id)
}

function onToggleMenu() {
  open.value = !open.value
}

function onBackdropClick() {
  open.value = false
}
</script>

<template>
  <div class="relative">
    <!-- Trigger button -->
    <button
      class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400 relative"
      title="Manage datasets"
      @click="onToggleMenu"
    >
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </svg>
      <!-- Badge showing active count -->
      <span
        v-if="activeCount > 0"
        class="absolute -top-0.5 -right-0.5 w-4 h-4 text-[9px] font-bold bg-blue-600 text-white rounded-full flex items-center justify-center"
      >
        {{ activeCount }}
      </span>
    </button>

    <!-- Backdrop -->
    <div v-if="open" class="fixed inset-0 z-40" @click="onBackdropClick"></div>

    <!-- Dropdown panel -->
    <Transition name="dropdown">
      <div
        v-if="open"
        class="absolute right-0 top-full mt-1 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden"
      >
        <!-- Header -->
        <div class="px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Loaded Datasets ({{ datasets.length }})
          </h3>
          <p class="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            Click name to switch · Use checkbox for multi-select
          </p>
        </div>

        <!-- Dataset list -->
        <div class="max-h-64 overflow-y-auto">
          <div
            v-for="ds in datasets"
            :key="ds.id"
            class="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors group"
          >
            <!-- Multi-select checkbox -->
            <input
              type="checkbox"
              :checked="isActive(ds.id)"
              class="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 cursor-pointer accent-blue-600 shrink-0"
              @change="onCheckboxChange(ds.id)"
            />

            <!-- Dataset info (clickable to select solo) -->
            <div
              class="flex-1 min-w-0 cursor-pointer"
              @click="onNameClick(ds.id)"
            >
              <div class="flex items-center gap-1.5">
                <span
                  class="text-xs font-medium truncate"
                  :class="isActive(ds.id)
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-700 dark:text-gray-300'"
                >
                  {{ ds.fileName }}
                </span>
                <span
                  v-if="isActive(ds.id)"
                  class="shrink-0 w-1.5 h-1.5 bg-blue-500 rounded-full"
                ></span>
              </div>
              <div class="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                <span>{{ ds.recordCount.toLocaleString() }} records</span>
                <span>{{ formatBytes(ds.totalBytes) }}</span>
                <span>{{ formatDate(ds.loadedAt) }}</span>
              </div>
            </div>

            <!-- Delete button -->
            <button
              class="p-1 rounded text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 opacity-0 group-hover:opacity-100 transition-all shrink-0"
              title="Delete dataset"
              @click="onRemove($event, ds.id)"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Empty state -->
        <div
          v-if="datasets.length === 0"
          class="px-3 py-6 text-center text-xs text-gray-400 dark:text-gray-600"
        >
          No datasets loaded yet
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.dropdown-enter-active, .dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.dropdown-enter-from, .dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
