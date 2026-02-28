<script setup lang="ts">
/**
 * ChartModal – modal for visualizing data with charts and diagrams.
 *
 * Fetches aggregated data from the server for selected columns,
 * respecting current search query and property filters.
 * Renders bar charts (categorical), histograms (numeric), and pie charts.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, shallowRef } from 'vue'
import { Chart, registerables } from 'chart.js'
import { fetchChartData, type ColumnStats } from '../utils/db'
import { formatColumnName } from '../utils/format'
import type { DatasetRange } from '../types'

Chart.register(...registerables)

const props = defineProps<{
  open: boolean
  allKeys: string[]
  searchQuery: string
  propertyFilters: string[]
  datasetRanges: DatasetRange[]
  matchCount: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

// ── State ──
const selectedColumns = ref<string[]>([])
const columnSearchText = ref('')
const isLoading = ref(false)
const chartData = shallowRef<ColumnStats[]>([])
const totalRecords = ref(0)
const timeTaken = ref(0)
const chartType = ref<'bar' | 'pie' | 'histogram'>('bar')
const errorMessage = ref('')

// Chart instance tracking for cleanup
const chartInstances = new Map<string, Chart>()

const filteredKeys = computed(() => {
  const q = columnSearchText.value.toLowerCase().trim()
  if (!q) return props.allKeys
  return props.allKeys.filter(
    k => k.toLowerCase().includes(q) || formatColumnName(k).toLowerCase().includes(q),
  )
})

const hasFiltersActive = computed(() => {
  return props.searchQuery.trim() !== '' || props.propertyFilters.length > 0
})

// ── Preset: auto-select first 3 columns on open ──
watch(() => props.open, (val) => {
  if (val) {
    columnSearchText.value = ''
    errorMessage.value = ''
    if (selectedColumns.value.length === 0 && props.allKeys.length > 0) {
      selectedColumns.value = props.allKeys.slice(0, 3)
    }
    // Auto-fetch when modal opens
    if (selectedColumns.value.length > 0) {
      loadChartData()
    }
  } else {
    destroyAllCharts()
  }
})

function toggleColumn(key: string) {
  const idx = selectedColumns.value.indexOf(key)
  if (idx >= 0) {
    selectedColumns.value = selectedColumns.value.filter(k => k !== key)
  } else {
    if (selectedColumns.value.length >= 8) return // max 8 columns
    selectedColumns.value = [...selectedColumns.value, key]
  }
}

function removeColumn(key: string) {
  selectedColumns.value = selectedColumns.value.filter(k => k !== key)
}

function selectAllVisible() {
  const toAdd = filteredKeys.value.slice(0, 8)
  selectedColumns.value = [...new Set([...selectedColumns.value, ...toAdd])].slice(0, 8)
}

function clearColumns() {
  selectedColumns.value = []
  chartData.value = []
  destroyAllCharts()
}

// ── Data fetching ──
async function loadChartData() {
  if (selectedColumns.value.length === 0) return
  isLoading.value = true
  errorMessage.value = ''

  try {
    const datasets = props.datasetRanges.map(r => ({ id: r.id, offset: r.offset, count: r.count }))
    const result = await fetchChartData(
      datasets,
      props.searchQuery,
      props.propertyFilters,
      selectedColumns.value,
    )
    chartData.value = result.columns
    totalRecords.value = result.totalRecords
    timeTaken.value = Math.round(result.timeTaken * 100) / 100
  } catch (err) {
    console.error('[ChartModal]', err)
    errorMessage.value = 'Failed to load chart data. Please try again.'
  } finally {
    isLoading.value = false
  }
  // Render after isLoading is false so canvas elements are in the DOM
  await nextTick()
  renderCharts()
}

// ── Chart rendering ──
const COLORS = [
  'rgba(59, 130, 246, 0.7)',   // blue
  'rgba(16, 185, 129, 0.7)',   // emerald
  'rgba(245, 158, 11, 0.7)',   // amber
  'rgba(239, 68, 68, 0.7)',    // red
  'rgba(139, 92, 246, 0.7)',   // violet
  'rgba(236, 72, 153, 0.7)',   // pink
  'rgba(6, 182, 212, 0.7)',    // cyan
  'rgba(249, 115, 22, 0.7)',   // orange
  'rgba(34, 197, 94, 0.7)',    // green
  'rgba(168, 85, 247, 0.7)',   // purple
  'rgba(251, 146, 60, 0.7)',   // orange-400
  'rgba(56, 189, 248, 0.7)',   // sky
  'rgba(52, 211, 153, 0.7)',   // teal
  'rgba(251, 191, 36, 0.7)',   // yellow
  'rgba(244, 114, 182, 0.7)',  // rose
  'rgba(129, 140, 248, 0.7)',  // indigo
  'rgba(45, 212, 191, 0.7)',   // teal-400
  'rgba(253, 186, 116, 0.7)',  // orange-300
  'rgba(196, 181, 253, 0.7)',  // violet-300
  'rgba(110, 231, 183, 0.7)',  // emerald-300
]

const BORDER_COLORS = COLORS.map(c => c.replace('0.7)', '1)'))

function destroyAllCharts() {
  chartInstances.forEach(chart => chart.destroy())
  chartInstances.clear()
}

function renderCharts() {
  destroyAllCharts()

  for (const colStat of chartData.value) {
    const canvasId = `chart-${colStat.key}`
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null
    if (!canvas) continue

    const ctx = canvas.getContext('2d')
    if (!ctx) continue

    // Determine which chart to render based on type and user selection
    if (chartType.value === 'histogram' && colStat.numeric) {
      renderHistogram(ctx, canvasId, colStat)
    } else if (chartType.value === 'pie') {
      renderPieChart(ctx, canvasId, colStat)
    } else {
      renderBarChart(ctx, canvasId, colStat)
    }
  }
}

function getChartFontColor(): string {
  return document.documentElement.classList.contains('dark')
    ? 'rgba(209, 213, 219, 0.9)'
    : 'rgba(55, 65, 81, 0.9)'
}

function getGridColor(): string {
  return document.documentElement.classList.contains('dark')
    ? 'rgba(75, 85, 99, 0.3)'
    : 'rgba(209, 213, 219, 0.5)'
}

function renderBarChart(ctx: CanvasRenderingContext2D, id: string, col: ColumnStats) {
  const labels = col.topValues.map(v => truncateLabel(v.value, 25))
  const data = col.topValues.map(v => v.count)
  const fontColor = getChartFontColor()
  const gridColor = getGridColor()

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: formatColumnName(col.key),
        data,
        backgroundColor: COLORS.slice(0, data.length),
        borderColor: BORDER_COLORS.slice(0, data.length),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => col.topValues[items[0].dataIndex]?.value || '',
            label: (item) => `Count: ${(item.raw as number).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: fontColor, maxRotation: 45, font: { size: 11 } },
          grid: { color: gridColor },
        },
        y: {
          ticks: { color: fontColor, font: { size: 11 } },
          grid: { color: gridColor },
          beginAtZero: true,
        },
      },
    },
  })
  chartInstances.set(id, chart)
}

function renderHistogram(ctx: CanvasRenderingContext2D, id: string, col: ColumnStats) {
  const hist = col.numeric!.histogram
  const labels = hist.map(h => h.bucket)
  const data = hist.map(h => h.count)
  const fontColor = getChartFontColor()
  const gridColor = getGridColor()

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: `${formatColumnName(col.key)} distribution`,
        data,
        backgroundColor: 'rgba(59, 130, 246, 0.6)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1,
        borderRadius: 2,
        barPercentage: 1,
        categoryPercentage: 0.95,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `Count: ${(item.raw as number).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: fontColor, maxRotation: 45, font: { size: 10 } },
          grid: { color: gridColor },
        },
        y: {
          ticks: { color: fontColor, font: { size: 11 } },
          grid: { color: gridColor },
          beginAtZero: true,
        },
      },
    },
  })
  chartInstances.set(id, chart)
}

function renderPieChart(ctx: CanvasRenderingContext2D, id: string, col: ColumnStats) {
  const maxSlices = 10
  const topValues = col.topValues.slice(0, maxSlices)
  const othersCount = col.topValues.slice(maxSlices).reduce((s, v) => s + v.count, 0)
  const labels = topValues.map(v => truncateLabel(v.value, 20))
  const data = topValues.map(v => v.count)
  const colors = COLORS.slice(0, data.length)
  const borders = BORDER_COLORS.slice(0, data.length)

  if (othersCount > 0) {
    labels.push('Others')
    data.push(othersCount)
    colors.push('rgba(156, 163, 175, 0.6)')
    borders.push('rgba(156, 163, 175, 1)')
  }

  const fontColor = getChartFontColor()

  const chart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: borders,
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: fontColor, font: { size: 11 }, padding: 8 },
        },
        tooltip: {
          callbacks: {
            label: (item) => {
              const count = item.raw as number
              const total = data.reduce((s, v) => s + v, 0)
              const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0'
              return `${item.label}: ${count.toLocaleString()} (${pct}%)`
            },
          },
        },
      },
    },
  })
  chartInstances.set(id, chart)
}

function truncateLabel(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

// Re-render when chart type changes
watch(chartType, () => {
  if (chartData.value.length > 0) {
    nextTick(() => renderCharts())
  }
})

function onBackdrop() {
  emit('close')
}

onBeforeUnmount(() => {
  destroyAllCharts()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="onBackdrop"></div>

        <!-- Panel -->
        <div class="relative z-10 w-full max-w-5xl max-h-[90vh] mx-4 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200/60 dark:border-gray-700/60 overflow-hidden flex flex-col">
          <!-- Header -->
          <div class="shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <div>
              <h2 class="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <svg class="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Charts &amp; Diagrams
              </h2>
              <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                Visualize data distribution across {{ matchCount.toLocaleString() }} records
                <span v-if="hasFiltersActive" class="text-blue-400">(filtered)</span>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <!-- Aggregation time -->
              <span v-if="timeTaken > 0 && !isLoading" class="text-xs text-gray-400 dark:text-gray-500 font-mono tabular-nums">
                {{ timeTaken }}ms
              </span>
              <button
                class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 transition-colors"
                @click="$emit('close')"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Controls bar -->
          <div class="shrink-0 flex flex-wrap items-center gap-3 px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
            <!-- Chart type selector -->
            <div class="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
              <button
                v-for="ct in (['bar', 'histogram', 'pie'] as const)"
                :key="ct"
                class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize"
                :class="chartType === ct
                  ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
                @click="chartType = ct"
              >
                {{ ct === 'histogram' ? 'Histogram' : ct === 'pie' ? 'Pie' : 'Bar' }}
              </button>
            </div>

            <!-- Column selector dropdown -->
            <div class="relative group flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs text-gray-500 dark:text-gray-400 shrink-0">Columns:</span>
                <div class="flex items-center gap-1 flex-wrap">
                  <span
                    v-for="col in selectedColumns"
                    :key="col"
                    class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-md border border-blue-100 dark:border-blue-900/50"
                  >
                    {{ formatColumnName(col) }}
                    <button class="hover:text-blue-800 dark:hover:text-blue-200" @click="removeColumn(col)">
                      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                  <span v-if="selectedColumns.length === 0" class="text-xs text-gray-400 dark:text-gray-600 italic">
                    Select columns to chart...
                  </span>
                </div>
              </div>
            </div>

            <!-- Generate button -->
            <button
              class="px-4 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              :class="selectedColumns.length > 0
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'"
              :disabled="selectedColumns.length === 0 || isLoading"
              @click="loadChartData"
            >
              <span v-if="isLoading" class="flex items-center gap-1.5">
                <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Loading…
              </span>
              <span v-else>Generate Charts</span>
            </button>
          </div>

          <!-- Content area -->
          <div class="flex-1 min-h-0 flex overflow-hidden">
            <!-- Column picker sidebar -->
            <div class="w-52 shrink-0 border-r border-gray-100 dark:border-gray-800 flex flex-col bg-gray-50/30 dark:bg-gray-900/50">
              <!-- Search -->
              <div class="p-2">
                <div class="relative">
                  <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    v-model="columnSearchText"
                    type="text"
                    placeholder="Search columns..."
                    class="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-md
                           bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200
                           placeholder-gray-400 dark:placeholder-gray-500
                           focus:outline-none focus:ring-1 focus:ring-blue-400/50 focus:border-blue-400 transition-all"
                  />
                </div>
              </div>

              <!-- Quick actions -->
              <div class="flex items-center gap-1 px-2 pb-1">
                <button
                  class="text-[10px] text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  @click="selectAllVisible"
                >Select first 8</button>
                <span class="text-gray-300 dark:text-gray-600">|</span>
                <button
                  class="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  @click="clearColumns"
                >Clear all</button>
              </div>

              <!-- Column list -->
              <div class="flex-1 overflow-y-auto px-1 pb-2 virtual-table-scroll">
                <label
                  v-for="key in filteredKeys"
                  :key="key"
                  class="flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-colors group"
                  :class="selectedColumns.includes(key) ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''"
                >
                  <input
                    type="checkbox"
                    :checked="selectedColumns.includes(key)"
                    :disabled="!selectedColumns.includes(key) && selectedColumns.length >= 8"
                    class="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 accent-blue-600 shrink-0 cursor-pointer disabled:opacity-40"
                    @change="toggleColumn(key)"
                  />
                  <span class="text-xs text-gray-700 dark:text-gray-300 truncate">{{ formatColumnName(key) }}</span>
                </label>
                <div v-if="filteredKeys.length === 0" class="py-6 text-center text-xs text-gray-400 dark:text-gray-600">
                  No matching columns
                </div>
              </div>
            </div>

            <!-- Charts area -->
            <div class="flex-1 overflow-y-auto p-4 virtual-table-scroll">
              <!-- Empty state -->
              <div v-if="chartData.length === 0 && !isLoading && !errorMessage" class="flex flex-col items-center justify-center h-full text-center py-12">
                <svg class="w-16 h-16 text-gray-200 dark:text-gray-700 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <p class="text-sm text-gray-500 dark:text-gray-400 font-medium">Select columns and click "Generate Charts"</p>
                <p class="text-xs text-gray-400 dark:text-gray-600 mt-1">Charts will reflect your current search and filter settings</p>
              </div>

              <!-- Error message -->
              <div v-if="errorMessage" class="flex flex-col items-center justify-center h-full text-center py-12">
                <svg class="w-12 h-12 text-red-300 dark:text-red-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <p class="text-sm text-red-500 dark:text-red-400">{{ errorMessage }}</p>
              </div>

              <!-- Loading state -->
              <div v-if="isLoading" class="flex flex-col items-center justify-center h-full py-12">
                <svg class="w-10 h-10 text-blue-400 animate-spin mb-3" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                <p class="text-sm text-gray-500 dark:text-gray-400">Aggregating data…</p>
              </div>

              <!-- Chart cards -->
              <div v-if="!isLoading && chartData.length > 0" class="space-y-4">
                <!-- Summary -->
                <div class="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 pb-2 border-b border-gray-100 dark:border-gray-800">
                  <span>
                    Analyzed <strong class="text-gray-600 dark:text-gray-300">{{ totalRecords.toLocaleString() }}</strong> records
                  </span>
                  <span v-if="hasFiltersActive" class="flex items-center gap-1 text-blue-400">
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    Filters applied
                  </span>
                </div>

                <!-- Chart card per column -->
                <div
                  v-for="col in chartData"
                  :key="col.key"
                  class="bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-200/60 dark:border-gray-700/40 overflow-hidden"
                >
                  <!-- Card header -->
                  <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800/60">
                    <div class="flex items-center gap-2">
                      <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-200">{{ formatColumnName(col.key) }}</h3>
                      <span
                        class="px-1.5 py-0.5 text-[10px] font-medium rounded uppercase tracking-wider"
                        :class="{
                          'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400': col.type === 'numeric',
                          'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400': col.type === 'categorical',
                          'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400': col.type === 'mixed',
                        }"
                      >
                        {{ col.type }}
                      </span>
                    </div>
                    <div class="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                      <span>{{ col.totalNonNull.toLocaleString() }} values</span>
                      <span v-if="col.type !== 'categorical'">{{ col.topValues.length }} unique</span>
                    </div>
                  </div>

                  <!-- Numeric stats summary -->
                  <div v-if="col.numeric" class="flex items-center gap-4 px-4 py-2 text-xs bg-gray-100/50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-800/40">
                    <span class="text-gray-500 dark:text-gray-400">
                      Min: <strong class="text-gray-700 dark:text-gray-200 font-mono">{{ col.numeric.min.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</strong>
                    </span>
                    <span class="text-gray-500 dark:text-gray-400">
                      Max: <strong class="text-gray-700 dark:text-gray-200 font-mono">{{ col.numeric.max.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</strong>
                    </span>
                    <span class="text-gray-500 dark:text-gray-400">
                      Avg: <strong class="text-gray-700 dark:text-gray-200 font-mono">{{ col.numeric.avg.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</strong>
                    </span>
                    <span class="text-gray-500 dark:text-gray-400">
                      Sum: <strong class="text-gray-700 dark:text-gray-200 font-mono">{{ col.numeric.sum.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</strong>
                    </span>
                  </div>

                  <!-- Canvas -->
                  <div class="p-4" :class="chartType === 'pie' ? 'h-72' : 'h-64'">
                    <canvas :id="`chart-${col.key}`" class="w-full h-full"></canvas>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="shrink-0 flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
            <span class="text-xs text-gray-400 dark:text-gray-500">
              {{ selectedColumns.length }} column{{ selectedColumns.length !== 1 ? 's' : '' }} selected (max 8)
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
