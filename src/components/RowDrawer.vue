<script setup lang="ts">
/**
 * RowDrawer – right-side sliding drawer showing full details of a selected record.
 *
 * Features:
 *  - Separates populated properties from empty/missing ones
 *  - Key/Value tab with clean card-like layout
 *  - Raw JSON tab
 *  - Dark mode aware
 *  - Smooth slide-in animation
 */
import { computed, ref, watch } from 'vue'
import type { JsonRecord } from '../types'
import { formatColumnName } from '../utils/format'

const props = defineProps<{
  record: JsonRecord | null
  recordIndex: number
  open: boolean
  allKeys: string[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const activeTab = ref<'kv' | 'json'>('kv')

watch(() => props.recordIndex, () => {
  activeTab.value = 'kv'
})

/** Properties that have a meaningful value */
const populatedEntries = computed(() => {
  if (!props.record) return []
  return Object.entries(props.record)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({ key, rawValue: value }))
})

/** Properties that are empty, null, undefined, or missing from this record */
const missingEntries = computed(() => {
  if (!props.record) return []
  const record = props.record

  // Keys in the record that are empty
  const emptyFromRecord = Object.entries(record)
    .filter(([, value]) => value === null || value === undefined || value === '')
    .map(([key]) => key)

  // Keys from the global set that aren't in this record at all
  const missingFromGlobal = props.allKeys.filter((k) => !(k in record))

  return [...new Set([...emptyFromRecord, ...missingFromGlobal])].sort()
})

const prettyJson = computed(() => {
  if (!props.record) return ''
  return JSON.stringify(props.record, null, 2)
})

function formatValue(val: unknown): string {
  if (val === null) return 'null'
  if (val === undefined) return 'undefined'
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}

function valueColor(val: unknown): string {
  if (typeof val === 'number') return 'text-blue-600 dark:text-blue-400'
  if (typeof val === 'boolean') return val ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
  if (val === null || val === undefined) return 'text-gray-400 dark:text-gray-600 italic'
  return 'text-gray-800 dark:text-gray-200'
}
</script>

<template>
  <!-- Overlay -->
  <Transition name="fade">
    <div
      v-if="open"
      class="fixed inset-0 bg-black/30 dark:bg-black/50 z-40 backdrop-blur-sm"
      @click="emit('close')"
    ></div>
  </Transition>

  <!-- Drawer -->
  <Transition name="slide">
    <div
      v-if="open && record"
      class="fixed top-0 right-0 h-full w-full max-w-xl bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col border-l border-gray-200 dark:border-gray-700"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div>
          <h2 class="text-base font-semibold text-gray-800 dark:text-gray-100">
            Record #{{ recordIndex + 1 }}
          </h2>
          <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            {{ populatedEntries.length }} populated · {{ missingEntries.length }} empty
          </p>
        </div>
        <button
          class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          title="Close (Esc)"
          @click="emit('close')"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex shrink-0 bg-gray-50 dark:bg-gray-800/50">
        <button
          class="flex-1 px-4 py-2.5 text-xs font-medium transition-all relative"
          :class="activeTab === 'kv'
            ? 'text-blue-600 dark:text-blue-400'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'"
          @click="activeTab = 'kv'"
        >
          Properties
          <span
            v-if="activeTab === 'kv'"
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400"
          ></span>
        </button>
        <button
          class="flex-1 px-4 py-2.5 text-xs font-medium transition-all relative"
          :class="activeTab === 'json'
            ? 'text-blue-600 dark:text-blue-400'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'"
          @click="activeTab = 'json'"
        >
          Raw JSON
          <span
            v-if="activeTab === 'json'"
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400"
          ></span>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto">
        <!-- Key/Value panel -->
        <div v-if="activeTab === 'kv'" class="p-4 space-y-5">
          <!-- Populated properties -->
          <div>
            <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
              </svg>
              Populated ({{ populatedEntries.length }})
            </h3>
            <div class="space-y-1">
              <div
                v-for="entry in populatedEntries"
                :key="entry.key"
                class="flex gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
              >
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400 min-w-[120px] shrink-0 pt-0.5">
                  {{ formatColumnName(entry.key) }}
                </span>
                <span
                  class="text-xs break-all flex-1"
                  :class="valueColor(entry.rawValue)"
                >
                  {{ formatValue(entry.rawValue) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Missing properties -->
          <div v-if="missingEntries.length > 0">
            <h3 class="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 text-gray-400 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4" />
              </svg>
              Empty / Missing ({{ missingEntries.length }})
            </h3>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="key in missingEntries"
                :key="key"
                class="inline-block text-xs px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 border border-gray-200 dark:border-gray-700"
              >
                {{ formatColumnName(key) }}
              </span>
            </div>
          </div>
        </div>

        <!-- JSON panel -->
        <div v-else class="p-4">
          <div class="rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden">
            <pre class="p-4 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">{{ prettyJson }}</pre>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

.slide-enter-active, .slide-leave-active {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.slide-enter-from, .slide-leave-to {
  transform: translateX(100%);
}
</style>
