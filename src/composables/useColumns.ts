/**
 * useColumns – composable for managing dynamic table columns.
 *
 * Columns are ordered by frequency (most common keys first), then alphabetically.
 * Provides visibility toggling, pinning, reordering, and drag reorder.
 * Persists column preferences (visibility, pinning, order) to localStorage.
 */

import { ref, computed, watch, type Ref } from 'vue'
import type { ColumnDef } from '../types'

const COL_PREFS_KEY = 'jv-col-prefs'

interface SavedColPref {
  visible: boolean
  pinned: boolean
  order: number
}

function loadSavedPrefs(): Map<string, SavedColPref> {
  try {
    const raw = localStorage.getItem(COL_PREFS_KEY)
    if (!raw) return new Map()
    const arr = JSON.parse(raw) as Array<{ key: string } & SavedColPref>
    return new Map(arr.map(p => [p.key, p]))
  } catch { return new Map() }
}

function savePrefs(cols: ColumnDef[]) {
  const data = cols.map(c => ({
    key: c.key,
    visible: c.visible,
    pinned: c.pinned,
    order: c.order,
  }))
  localStorage.setItem(COL_PREFS_KEY, JSON.stringify(data))
}

export function useColumns(allKeys: Ref<Map<string, number>>) {
  const columns = ref<ColumnDef[]>([])

  // Track keys we've already added to preserve user customizations
  const knownKeys = new Set<string>()

  watch(allKeys, (keyMap) => {
    const isFirstLoad = columns.value.length === 0
    const savedPrefs = isFirstLoad ? loadSavedPrefs() : new Map<string, SavedColPref>()
    const hasSavedPrefs = savedPrefs.size > 0 && [...keyMap.keys()].some(k => savedPrefs.has(k))

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
        const pref = savedPrefs.get(key)
        newColumns.push({
          key,
          visible: pref ? pref.visible : (isFirstLoad && hasSavedPrefs ? false : newColumns.length < 15),
          pinned: pref ? pref.pinned : false,
          frequency: freq,
          order: pref ? pref.order : newColumns.length + 1000, // high order for unsaved (appended)
        })
      }
    }

    if (hasNew) {
      if (isFirstLoad && hasSavedPrefs) {
        // Restore saved order: columns with saved prefs use their saved order,
        // new columns are appended after by frequency
        newColumns.sort((a, b) => a.order - b.order)
      } else {
        // Default: sort by pinned first, then frequency desc, then alpha
        newColumns.sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
          return b.frequency - a.frequency || a.key.localeCompare(b.key)
        })
      }
      // Re-assign order
      newColumns.forEach((c, i) => (c.order = i))
    }

    columns.value = newColumns
    savePrefs(columns.value)
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
      savePrefs(columns.value)
    }
  }

  function togglePin(key: string) {
    const col = columns.value.find((c) => c.key === key)
    if (col) {
      col.pinned = !col.pinned
      if (col.pinned) col.visible = true

      // Re-sort so pinned columns move to the top, preserving relative order
      const newCols = [...columns.value]
      newCols.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return a.order - b.order
      })
      newCols.forEach((c, i) => (c.order = i))
      columns.value = newCols
      savePrefs(columns.value)
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
    savePrefs(columns.value)
  }

  /** Move a column to the position of another column (for drag-and-drop reorder). */
  function reorderColumn(fromKey: string, toKey: string) {
    if (fromKey === toKey) return
    const cols = [...columns.value]
    const fromIdx = cols.findIndex(c => c.key === fromKey)
    const toIdx = cols.findIndex(c => c.key === toKey)
    if (fromIdx === -1 || toIdx === -1) return
    const [moved] = cols.splice(fromIdx, 1)
    const newToIdx = cols.findIndex(c => c.key === toKey)
    cols.splice(newToIdx, 0, moved)
    cols.forEach((c, i) => c.order = i)
    columns.value = cols
    savePrefs(columns.value)
  }

  function showAll() {
    columns.value = columns.value.map((c) => ({ ...c, visible: true }))
    savePrefs(columns.value)
  }

  function hideAll() {
    columns.value = columns.value.map((c) => ({ ...c, visible: false, pinned: false }))
    savePrefs(columns.value)
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
    reorderColumn,
    showAll,
    hideAll,
    reset,
  }
}
