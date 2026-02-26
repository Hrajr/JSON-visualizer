<script setup lang="ts">
/**
 * SearchBar – debounced global search input with match count and timing display.
 */
defineProps<{
  matchCount: number
  totalCount: number
  searchTime: number
  isSearching: boolean
}>()

const query = defineModel<string>({ required: true })

function onClear() {
  query.value = ''
}
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- Search input -->
    <div class="relative">
      <svg
        class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
        fill="none" viewBox="0 0 24 24" stroke="currentColor"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref="searchInput"
        v-model="query"
        type="text"
        placeholder="Search records... (Ctrl+F)"
        class="pl-8 pr-8 py-1.5 text-sm border rounded-lg w-72 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
      />
      <button
        v-if="query"
        class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        @click="onClear"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Stats -->
    <div class="text-xs text-gray-500 whitespace-nowrap">
      <template v-if="isSearching">
        <span class="inline-flex items-center gap-1">
          <svg class="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          Searching...
        </span>
      </template>
      <template v-else-if="query">
        <span>{{ matchCount.toLocaleString() }} of {{ totalCount.toLocaleString() }}</span>
        <span v-if="searchTime > 0" class="ml-1 text-gray-400">({{ searchTime }}ms)</span>
      </template>
    </div>
  </div>
</template>
