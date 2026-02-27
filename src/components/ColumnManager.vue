<script setup lang="ts">
/**
 * ColumnManager – left panel for column visibility, pinning, and reordering.
 * Dark-mode aware. Uses formatColumnName for display labels.
 */
import { ref } from 'vue'
import type { ColumnDef } from '../types'
import { formatColumnName } from '../utils/format'

defineProps<{
  columns: ColumnDef[]
  visibleCount: number
  totalCount: number
}>()

const emit = defineEmits<{
  (e: 'toggle-visibility', key: string): void
  (e: 'toggle-pin', key: string): void
  (e: 'move', key: string, direction: 'up' | 'down'): void
  (e: 'show-all'): void
  (e: 'hide-all'): void
}>()

const filterText = defineModel<string>('filterText', { default: '' })
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="px-3 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
      <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Columns ({{ visibleCount }}/{{ totalCount }})
      </h3>
      <div class="flex gap-1.5 mt-2">
        <button
          class="text-xs px-2.5 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors"
          @click="$emit('show-all')"
        >All</button>
        <button
          class="text-xs px-2.5 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors"
          @click="$emit('hide-all')"
        >None</button>
      </div>
      <input
        v-model="filterText"
        type="text"
        placeholder="Filter columns..."
        class="mt-2 w-full text-xs px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    </div>

    <!-- Column List -->
    <div class="flex-1 overflow-y-auto">
      <template v-for="col in columns" :key="col.key">
        <div
          v-if="!filterText || col.key.toLowerCase().includes(filterText.toLowerCase())"
          class="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 group transition-colors"
        >
          <!-- Checkbox -->
          <input
            type="checkbox"
            :checked="col.visible"
            class="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 cursor-pointer accent-blue-600"
            @change="$emit('toggle-visibility', col.key)"
          />

          <!-- Key name (formatted) -->
          <span
            class="flex-1 text-xs truncate cursor-default"
            :class="col.visible ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-600'"
            :title="col.key"
          >{{ formatColumnName(col.key) }}</span>

          <!-- Pin button -->
          <button
            class="p-0.5 rounded transition-all"
            :class="col.pinned
              ? 'text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300'
              : 'text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 opacity-0 group-hover:opacity-100'"
            :title="col.pinned ? 'Unpin column' : 'Pin column (max 3)'"
            @click="$emit('toggle-pin', col.key)"
          >
            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1-.707.707l-.586-.586-3.535 3.536 1.06 4.242a.5.5 0 0 1-.839.415L7.172 10.78l-3.536 3.535a.5.5 0 1 1-.707-.707l3.536-3.536L3.11 6.72a.5.5 0 0 1 .415-.839l4.243 1.06L11.303 3.4l-.586-.586a.5.5 0 0 1 .146-.854z"/>
            </svg>
          </button>

          <!-- Move buttons -->
          <div class="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              class="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 leading-none"
              title="Move up"
              @click="$emit('move', col.key, 'up')"
            >
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              class="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 leading-none"
              title="Move down"
              @click="$emit('move', col.key, 'down')"
            >
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
