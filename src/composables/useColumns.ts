/**
 * useColumns – composable for managing dynamic table columns.
 *
 * Columns are ordered by frequency (most common keys first), then alphabetically.
 * Provides visibility toggling, pinning, and reordering.
 */

import { ref, computed, watch, type Ref } from 'vue'
import type { ColumnDef } from '../types'

export function useColumns(allKeys: Ref<Map<string, number>>) {
  const columns = ref<ColumnDef[]>([])

  // Track keys we've already added to preserve user customizations
  const knownKeys = new Set<string>()

  watch(allKeys, (keyMap) => {
    const newColumns = [...columns.value]
    let hasNew = false

    for (const [key, freq] of keyMap.entries()) {
      if (knownKeys.has(key)) {
        // Update frequency for existing column
        const col = newColumns.find((c) => c.key === key)
        if (col) col.frequency = freq
      } else {
        knownKeys.add(key)
        hasNew = true
        newColumns.push({
          key,
          visible: newColumns.length < 15, // Show first 15 columns by default
          pinned: false,
          frequency: freq,
          order: newColumns.length,
        })
      }
    }

    if (hasNew) {
      // Re-sort new columns by frequency desc, then alpha
      newColumns.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.frequency - a.frequency || a.key.localeCompare(b.key)
      })
      // Re-assign order
      newColumns.forEach((c, i) => (c.order = i))
    }

    columns.value = newColumns
  }, { deep: true })

  const visibleColumns = computed(() =>
    columns.value
      .filter((c) => c.visible)
      .sort((a, b) => {
        // Pinned first, then by order
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return a.order - b.order
      })
  )

  const pinnedColumns = computed(() =>
    columns.value.filter((c) => c.pinned && c.visible)
  )

  function toggleVisibility(key: string) {
    const col = columns.value.find((c) => c.key === key)
    if (col) {
      col.visible = !col.visible
      if (!col.visible) col.pinned = false
      columns.value = [...columns.value]
    }
  }

  function togglePin(key: string) {
    const col = columns.value.find((c) => c.key === key)
    if (col) {
      // Limit pinning to 3
      const pinnedCount = columns.value.filter((c) => c.pinned).length
      if (!col.pinned && pinnedCount >= 3) return
      col.pinned = !col.pinned
      if (col.pinned) col.visible = true
      columns.value = [...columns.value]
    }
  }

  function moveColumn(key: string, direction: 'up' | 'down') {
    const idx = columns.value.findIndex((c) => c.key === key)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= columns.value.length) return

    const newCols = [...columns.value]
    const tempOrder = newCols[idx].order
    newCols[idx].order = newCols[swapIdx].order
    newCols[swapIdx].order = tempOrder
    ;[newCols[idx], newCols[swapIdx]] = [newCols[swapIdx], newCols[idx]]
    columns.value = newCols
  }

  function showAll() {
    columns.value = columns.value.map((c) => ({ ...c, visible: true }))
  }

  function hideAll() {
    columns.value = columns.value.map((c) => ({ ...c, visible: false, pinned: false }))
  }

  function reset() {
    columns.value = []
    knownKeys.clear()
  }

  return {
    columns,
    visibleColumns,
    pinnedColumns,
    toggleVisibility,
    togglePin,
    moveColumn,
    showAll,
    hideAll,
    reset,
  }
}
