<script setup lang="ts">
/**
 * ColumnManager – left panel for column visibility, pinning, and reordering.
 */
import type { ColumnDef } from '../types'

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
    <div class="px-3 py-2 border-b border-gray-200 bg-gray-50">
      <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        Columns ({{ visibleCount }}/{{ totalCount }})
      </h3>
      <div class="flex gap-1 mt-1.5">
        <button
          class="text-xs px-2 py-0.5 bg-white border rounded hover:bg-gray-50"
          @click="$emit('show-all')"
        >All</button>
        <button
          class="text-xs px-2 py-0.5 bg-white border rounded hover:bg-gray-50"
          @click="$emit('hide-all')"
        >None</button>
      </div>
      <input
        v-model="filterText"
        type="text"
        placeholder="Filter columns..."
        class="mt-2 w-full text-xs px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    </div>

    <!-- Column List -->
    <div class="flex-1 overflow-y-auto">
      <template v-for="col in columns" :key="col.key">
        <div
          v-if="!filterText || col.key.toLowerCase().includes(filterText.toLowerCase())"
          class="flex items-center gap-1 px-2 py-1 hover:bg-gray-50 border-b border-gray-100 group"
        >
          <!-- Checkbox -->
          <input
            type="checkbox"
            :checked="col.visible"
            class="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 cursor-pointer"
            @change="$emit('toggle-visibility', col.key)"
          />

          <!-- Key name -->
          <span
            class="flex-1 text-xs truncate cursor-default"
            :class="col.visible ? 'text-gray-800' : 'text-gray-400'"
            :title="col.key"
          >{{ col.key }}</span>

          <!-- Pin button -->
          <button
            class="p-0.5 rounded transition-colors"
            :class="col.pinned
              ? 'text-blue-600 hover:text-blue-800'
              : 'text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100'"
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
              class="text-gray-400 hover:text-gray-600 leading-none"
              title="Move up"
              @click="$emit('move', col.key, 'up')"
            >
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              class="text-gray-400 hover:text-gray-600 leading-none"
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
