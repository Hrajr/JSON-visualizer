<script setup lang="ts">
/**
 * RowDrawer – right-side sliding drawer showing full details
 * of a selected record as pretty-printed JSON and key/value list.
 */
import { computed, ref, watch } from 'vue'
import type { JsonRecord } from '../types'

const props = defineProps<{
  record: JsonRecord | null
  recordIndex: number
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const activeTab = ref<'kv' | 'json'>('kv')

// Reset tab when record changes
watch(() => props.recordIndex, () => {
  activeTab.value = 'kv'
})

const entries = computed(() => {
  if (!props.record) return []
  return Object.entries(props.record).map(([key, value]) => ({
    key,
    value: value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value),
    rawValue: value,
  }))
})

const prettyJson = computed(() => {
  if (!props.record) return ''
  return JSON.stringify(props.record, null, 2)
})

function formatValue(val: unknown): string {
  if (val === null) return 'null'
  if (val === undefined) return 'undefined'
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}
</script>

<template>
  <!-- Overlay -->
  <Transition name="fade">
    <div
      v-if="open"
      class="fixed inset-0 bg-black/20 z-40"
      @click="emit('close')"
    ></div>
  </Transition>

  <!-- Drawer -->
  <Transition name="slide">
    <div
      v-if="open && record"
      class="fixed top-0 right-0 h-full w-full max-w-lg bg-white shadow-xl z-50 flex flex-col"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b bg-gray-50 shrink-0">
        <h2 class="text-sm font-semibold text-gray-700">
          Record #{{ recordIndex + 1 }}
        </h2>
        <button
          class="p-1 rounded hover:bg-gray-200 transition-colors text-gray-500"
          title="Close (Esc)"
          @click="emit('close')"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex border-b shrink-0">
        <button
          class="flex-1 px-4 py-2 text-xs font-medium transition-colors"
          :class="activeTab === 'kv' ? 'border-b-2 border-blue-600 text-blue-600 bg-white' : 'text-gray-500 hover:text-gray-700'"
          @click="activeTab = 'kv'"
        >
          Key / Value
        </button>
        <button
          class="flex-1 px-4 py-2 text-xs font-medium transition-colors"
          :class="activeTab === 'json' ? 'border-b-2 border-blue-600 text-blue-600 bg-white' : 'text-gray-500 hover:text-gray-700'"
          @click="activeTab = 'json'"
        >
          Raw JSON
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto">
        <!-- Key/Value panel -->
        <div v-if="activeTab === 'kv'">
          <table class="w-full text-xs">
            <tbody>
              <tr
                v-for="entry in entries"
                :key="entry.key"
                class="border-b border-gray-100 hover:bg-gray-50"
              >
                <td class="px-3 py-2 font-medium text-gray-600 align-top whitespace-nowrap w-1/3">
                  {{ entry.key }}
                </td>
                <td class="px-3 py-2 text-gray-800 break-all">
                  {{ formatValue(entry.rawValue) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- JSON panel -->
        <div v-else>
          <pre class="p-4 text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">{{ prettyJson }}</pre>
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
  transition: transform 0.25s ease;
}
.slide-enter-from, .slide-leave-to {
  transform: translateX(100%);
}
</style>
