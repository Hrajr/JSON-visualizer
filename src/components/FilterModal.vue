<script setup lang="ts">
/**
 * FilterModal – modal for multi-select property filtering.
 * Shows all available keys as checkboxes. Selected keys filter records
 * to only those with non-empty values for ALL selected properties.
 */
import { ref, computed, watch } from 'vue'
import { formatColumnName } from '../utils/format'

const props = defineProps<{
  open: boolean
  allKeys: string[]
  selectedKeys: string[]
}>()

const emit = defineEmits<{
  (e: 'update:selectedKeys', keys: string[]): void
  (e: 'close'): void
}>()

const filterText = ref('')

const filteredKeys = computed(() => {
  const q = filterText.value.toLowerCase().trim()
  if (!q) return props.allKeys
  return props.allKeys.filter(k => k.toLowerCase().includes(q) || formatColumnName(k).toLowerCase().includes(q))
})

function isSelected(key: string): boolean {
  return props.selectedKeys.includes(key)
}

function toggle(key: string) {
  const current = [...props.selectedKeys]
  const idx = current.indexOf(key)
  if (idx >= 0) {
    current.splice(idx, 1)
  } else {
    current.push(key)
  }
  emit('update:selectedKeys', current)
}

function clearAll() {
  emit('update:selectedKeys', [])
}

function onBackdrop() {
  emit('close')
}

// Reset filter text when modal opens
watch(() => props.open, (val) => {
  if (val) filterText.value = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="onBackdrop"></div>

        <!-- Panel -->
        <div class="relative z-10 w-full max-w-md mx-4 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200/60 dark:border-gray-700/60 overflow-hidden">
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <div>
              <h2 class="text-sm font-semibold text-gray-800 dark:text-gray-100">Property Filters</h2>
              <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                Show only records with non-empty values for selected properties
              </p>
            </div>
            <button
              class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 transition-colors"
              @click="$emit('close')"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Search -->
          <div class="px-5 pt-3 pb-2">
            <div class="relative">
              <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                v-model="filterText"
                type="text"
                placeholder="Search properties..."
                class="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg
                       bg-gray-50 dark:bg-gray-800/50 text-gray-800 dark:text-gray-200
                       placeholder-gray-400 dark:placeholder-gray-500
                       focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400 transition-all"
              />
            </div>
          </div>

          <!-- Active filters summary -->
          <div v-if="selectedKeys.length > 0" class="px-5 pb-2">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs text-gray-400 dark:text-gray-500">Active:</span>
              <span
                v-for="key in selectedKeys"
                :key="key"
                class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-md border border-blue-100 dark:border-blue-900/50"
              >
                {{ formatColumnName(key) }}
                <button class="hover:text-blue-800 dark:hover:text-blue-200" @click="toggle(key)">
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
              <button
                class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                @click="clearAll"
              >
                Clear all
              </button>
            </div>
          </div>

          <!-- Key list -->
          <div class="max-h-72 overflow-y-auto px-3 pb-2 virtual-table-scroll">
            <div v-if="filteredKeys.length === 0" class="py-8 text-center text-sm text-gray-400 dark:text-gray-600">
              No matching properties
            </div>
            <label
              v-for="key in filteredKeys"
              :key="key"
              class="flex items-center gap-3 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors group"
            >
              <input
                type="checkbox"
                :checked="isSelected(key)"
                class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 accent-blue-600 shrink-0 cursor-pointer"
                @change="toggle(key)"
              />
              <span class="text-sm text-gray-700 dark:text-gray-300 truncate">{{ formatColumnName(key) }}</span>
              <span class="text-xs text-gray-400 dark:text-gray-600 font-mono ml-auto opacity-0 group-hover:opacity-100 transition-opacity">{{ key }}</span>
            </label>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
            <span class="text-xs text-gray-400 dark:text-gray-500">
              {{ selectedKeys.length }} of {{ allKeys.length }} selected
            </span>
            <button
              class="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              @click="$emit('close')"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active, .modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-active .relative, .modal-leave-active .relative {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.modal-enter-from, .modal-leave-to {
  opacity: 0;
}
.modal-enter-from .relative {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}
.modal-leave-to .relative {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}
</style>
