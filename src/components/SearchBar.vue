<script setup lang="ts">
/**
 * SearchBar – debounced global search with nicer styling and dark mode.
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
  <div class="flex items-center gap-3">
    <!-- Search input -->
    <div class="relative group">
      <svg
        class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 group-focus-within:text-blue-500 transition-colors"
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
        class="pl-9 pr-9 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl w-80
               bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200
               placeholder-gray-400 dark:placeholder-gray-500
               focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent
               shadow-sm transition-all"
      />
      <button
        v-if="query"
        class="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        @click="onClear"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Stats -->
    <div class="text-xs whitespace-nowrap min-w-[100px]">
      <template v-if="isSearching">
        <span class="inline-flex items-center gap-1.5 text-blue-500 dark:text-blue-400">
          <svg class="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          Searching...
        </span>
      </template>
      <template v-else-if="query">
        <span class="text-gray-600 dark:text-gray-400 font-medium">
          {{ matchCount.toLocaleString() }}
        </span>
        <span class="text-gray-400 dark:text-gray-500"> / {{ totalCount.toLocaleString() }}</span>
        <span v-if="searchTime > 0" class="text-gray-400 dark:text-gray-600 ml-1">({{ searchTime }}ms)</span>
      </template>
    </div>
  </div>
</template>
