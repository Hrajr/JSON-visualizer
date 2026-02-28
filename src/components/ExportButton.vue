<script setup lang="ts">
/**
 * ExportButton – dropdown button for exporting visible data as CSV or PDF.
 *
 * CSV: fetches all matching records for visible columns, streams to a .csv file.
 * PDF: uses jsPDF + jspdf-autotable to generate a real PDF binary —
 *      no DOM rendering, no browser print dialog, handles millions of rows.
 *      Rows are fed in batches so the UI stays responsive (progress updates).
 */
import { ref, computed, onBeforeUnmount, watch, nextTick } from 'vue'
import type { ColumnDef, DatasetRange } from '../types'
import { fetchExportData } from '../utils/db'
import { formatColumnName } from '../utils/format'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const props = defineProps<{
  columns: ColumnDef[]
  searchQuery: string
  propertyFilters: string[]
  datasetRanges: DatasetRange[]
  sortColumn: string
  sortDirection: 'asc' | 'desc'
  totalCount: number
}>()

const dropdownOpen = ref(false)
const isExporting = ref(false)
const exportProgress = ref('')
let abortController: AbortController | null = null

const visibleColumnKeys = computed(() => props.columns.map(c => c.key))

function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value
}

function closeDropdown() {
  dropdownOpen.value = false
}

// Close dropdown on outside click
function onClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.export-button-container')) {
    closeDropdown()
  }
}

onBeforeUnmount(() => {
  if (abortController) abortController.abort()
  document.removeEventListener('click', onClickOutside)
})

watch(dropdownOpen, (open) => {
  if (open) {
    setTimeout(() => document.addEventListener('click', onClickOutside), 0)
  } else {
    document.removeEventListener('click', onClickOutside)
  }
})

async function fetchAllData(): Promise<Record<string, unknown>[] | null> {
  if (abortController) abortController.abort()
  abortController = new AbortController()

  isExporting.value = true
  exportProgress.value = 'Fetching data…'

  try {
    const datasets = props.datasetRanges.map(r => ({ id: r.id, offset: r.offset, count: r.count }))
    const result = await fetchExportData(
      datasets,
      props.searchQuery,
      props.propertyFilters,
      props.sortColumn,
      props.sortDirection,
      visibleColumnKeys.value,
      abortController.signal,
    )
    return result.records
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null
    console.error('[Export] Fetch error:', err)
    return null
  }
}

function getCellText(record: Record<string, unknown>, key: string): string {
  const val = record[key]
  if (val === undefined || val === null) return ''
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

/** Yield to the browser event loop so the UI can repaint. */
function yieldUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

// ── CSV Export ──
async function exportCSV() {
  closeDropdown()
  const records = await fetchAllData()
  if (!records) { isExporting.value = false; exportProgress.value = ''; return }

  exportProgress.value = `Generating CSV (${records.length.toLocaleString()} rows)…`
  await yieldUI()

  const cols = visibleColumnKeys.value
  const header = cols.map(c => `"${formatColumnName(c).replace(/"/g, '""')}"`).join(',')

  // Build CSV in chunks to avoid blocking UI for large datasets
  const CHUNK = 50_000
  const parts: string[] = [header]
  for (let i = 0; i < records.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, records.length)
    for (let j = i; j < end; j++) {
      const rec = records[j]
      parts.push(cols.map(c => {
        const val = getCellText(rec, c)
        return `"${val.replace(/"/g, '""')}"`
      }).join(','))
    }
    if (end < records.length) {
      exportProgress.value = `Generating CSV… ${end.toLocaleString()} / ${records.length.toLocaleString()}`
      await yieldUI()
    }
  }

  const csv = parts.join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, 'export.csv')

  isExporting.value = false
  exportProgress.value = ''
}

// ── PDF Export (jsPDF + autotable — no DOM, real PDF binary) ──
async function exportPDF() {
  closeDropdown()
  const records = await fetchAllData()
  if (!records) { isExporting.value = false; exportProgress.value = ''; return }

  const total = records.length
  exportProgress.value = `Generating PDF (${total.toLocaleString()} rows)…`
  await yieldUI()

  const cols = visibleColumnKeys.value
  const headers = ['#', ...cols.map(c => formatColumnName(c))]

  // Build body rows in batches to keep UI responsive
  const BATCH = 50_000
  const body: string[][] = []

  for (let i = 0; i < total; i += BATCH) {
    const end = Math.min(i + BATCH, total)
    for (let j = i; j < end; j++) {
      const rec = records[j]
      const row = [String(j + 1)]
      for (const c of cols) {
        const text = getCellText(rec, c)
        // Truncate very long cell values to keep PDF file size sane
        row.push(text.length > 200 ? text.slice(0, 197) + '…' : text)
      }
      body.push(row)
    }
    if (end < total) {
      exportProgress.value = `Preparing rows… ${end.toLocaleString()} / ${total.toLocaleString()}`
      await yieldUI()
    }
  }

  exportProgress.value = `Rendering PDF…`
  await yieldUI()

  // Landscape A4, points unit
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })

  // Title
  doc.setFontSize(12)
  doc.setTextColor(17, 24, 39) // #111827
  doc.text('JSON Visualizer Export', 40, 30)
  doc.setFontSize(8)
  doc.setTextColor(107, 114, 128) // #6b7280
  doc.text(
    `${total.toLocaleString()} records · ${cols.length} columns · Exported ${new Date().toLocaleString()}`,
    40, 42,
  )

  // Table – styled to match the app's look
  autoTable(doc, {
    startY: 52,
    head: [headers],
    body,
    styles: {
      fontSize: 6.5,
      cellPadding: 3,
      lineColor: [243, 244, 246], // #f3f4f6
      lineWidth: 0.5,
      textColor: [55, 65, 81], // #374151
      overflow: 'ellipsize',
      cellWidth: 'auto',
    },
    headStyles: {
      fillColor: [249, 250, 251], // #f9fafb
      textColor: [107, 114, 128], // #6b7280
      fontStyle: 'bold',
      fontSize: 6,
      cellPadding: 4,
      lineColor: [229, 231, 235], // #e5e7eb
      lineWidth: 1,
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251], // #f9fafb
    },
    columnStyles: {
      0: { halign: 'right', cellWidth: 35, textColor: [156, 163, 175], fontSize: 6 }, // row #
    },
    margin: { top: 52, left: 20, right: 20, bottom: 20 },
    didDrawPage: (data: any) => {
      // Footer with page number
      const pageCount = (doc as any).internal.getNumberOfPages()
      const pageNum = (doc as any).internal.getCurrentPageInfo().pageNumber
      doc.setFontSize(7)
      doc.setTextColor(156, 163, 175)
      const pageHeight = doc.internal.pageSize.getHeight()
      doc.text(
        `Page ${pageNum} of ${pageCount}`,
        doc.internal.pageSize.getWidth() - 20, pageHeight - 10,
        { align: 'right' },
      )
    },
  })

  exportProgress.value = `Saving PDF…`
  await yieldUI()

  doc.save('export.pdf')

  isExporting.value = false
  exportProgress.value = ''
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="export-button-container relative">
    <!-- Export button -->
    <button
      class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      :class="isExporting ? 'opacity-60 pointer-events-none' : ''"
      title="Export data"
      @click.stop="toggleDropdown"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span class="hidden sm:inline">{{ isExporting ? exportProgress : 'Export' }}</span>
    </button>

    <!-- Dropdown -->
    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="dropdownOpen"
        class="absolute right-0 top-full mt-1 w-48 rounded-lg bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10 z-50 py-1"
      >
        <button
          class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
          @click="exportCSV"
        >
          <svg class="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div>
            <div class="font-medium">Export as CSV</div>
            <div class="text-[10px] text-gray-400 dark:text-gray-500">Comma-separated values</div>
          </div>
        </button>
        <button
          class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
          @click="exportPDF"
        >
          <svg class="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <div>
            <div class="font-medium">Export as PDF</div>
            <div class="text-[10px] text-gray-400 dark:text-gray-500">Styled table document</div>
          </div>
        </button>
        <div class="px-3 py-1.5 border-t border-gray-100 dark:border-gray-700 mt-1">
          <p class="text-[10px] text-gray-400 dark:text-gray-500">
            {{ totalCount.toLocaleString() }} rows · {{ visibleColumnKeys.length }} columns
          </p>
        </div>
      </div>
    </Transition>
  </div>
</template>
