/**
 * useDatasets – composable for managing multiple persistent datasets.
 *
 * Each dataset is stored in a server-side SQLite database.
 * Metadata is fetched from the server API. Active dataset IDs are
 * stored in localStorage as a browser-local UI preference.
 */

import { ref, computed, type Ref } from 'vue'
import type { DatasetInfo, DatasetRange, JsonRecord } from '../types'
import {
  fetchDatasets, deleteServerDataset, deleteAllServerDatasets,
  getSavedActiveIds, saveActiveIds, computeRanges,
  getRecordByAbsoluteIndex, getRecordsByAbsoluteIndices,
} from '../utils/db'

export function useDatasets() {
  const datasets: Ref<DatasetInfo[]> = ref([])
  const activeIds: Ref<string[]> = ref([])

  const activeDatasets = computed(() =>
    activeIds.value
      .map(id => datasets.value.find(d => d.id === id))
      .filter((d): d is DatasetInfo => !!d)
  )

  const datasetRanges = computed<DatasetRange[]>(() =>
    computeRanges(activeDatasets.value)
  )

  const totalRecordCount = computed(() =>
    activeDatasets.value.reduce((sum, ds) => sum + ds.recordCount, 0)
  )

  const combinedKeys = computed(() => {
    const keyMap = new Map<string, number>()
    for (const ds of activeDatasets.value) {
      for (const key of ds.keys) {
        keyMap.set(key, (keyMap.get(key) || 0) + 1)
      }
    }
    return keyMap
  })

  /** Load state from server. */
  async function init() {
    try {
      datasets.value = await fetchDatasets()
    } catch (err) {
      console.error('[Datasets] Failed to fetch datasets from server:', err)
      datasets.value = []
    }
    const saved = getSavedActiveIds()
    activeIds.value = saved.filter(id => datasets.value.some(d => d.id === id))
  }

  /**
   * Register a newly loaded dataset.
   * @param activate If true (default), makes it the only active dataset.
   *                 If false, registers it without changing active selection.
   */
  async function addDataset(info: DatasetInfo, activate = true) {
    // Refresh dataset list from server (the dataset was just finalized there)
    try {
      datasets.value = await fetchDatasets()
    } catch {
      // Fallback: add locally
      const existing = datasets.value.findIndex(d => d.id === info.id)
      if (existing >= 0) datasets.value[existing] = info
      else datasets.value = [...datasets.value, info]
    }
    if (activate) {
      activeIds.value = [info.id]
      saveActiveIds(activeIds.value)
    }
  }

  /** Set exactly one dataset as active. */
  function selectDataset(id: string) {
    activeIds.value = [id]
    saveActiveIds(activeIds.value)
  }

  /** Toggle a dataset in the active set (for multi-select). */
  function toggleDataset(id: string) {
    if (activeIds.value.includes(id)) {
      activeIds.value = activeIds.value.filter(i => i !== id)
    } else {
      activeIds.value = [...activeIds.value, id]
    }
    saveActiveIds(activeIds.value)
  }

  /** Set the active dataset IDs (replaces current selection). */
  function setActiveIds(ids: string[]) {
    activeIds.value = ids.filter(id => datasets.value.some(d => d.id === id))
    saveActiveIds(activeIds.value)
  }

  /** Delete ALL datasets and their SQLite databases. */
  async function clearAllDatasets() {
    datasets.value = []
    activeIds.value = []
    saveActiveIds([])

    try {
      await deleteAllServerDatasets()
    } catch (err) {
      console.error('[Datasets] Failed to delete all datasets:', err)
    }
  }

  /** Delete a dataset (removes SQLite DB + metadata). */
  async function removeDataset(id: string) {
    try {
      await deleteServerDataset(id)
    } catch { /* best effort */ }

    datasets.value = datasets.value.filter(d => d.id !== id)
    activeIds.value = activeIds.value.filter(i => i !== id)
    saveActiveIds(activeIds.value)
  }

  async function getRecord(absIndex: number): Promise<JsonRecord | undefined> {
    return getRecordByAbsoluteIndex(datasetRanges.value, absIndex)
  }

  async function getRecords(absIndices: number[]): Promise<(JsonRecord | undefined)[]> {
    return getRecordsByAbsoluteIndices(datasetRanges.value, absIndices)
  }

  return {
    datasets,
    activeIds,
    activeDatasets,
    datasetRanges,
    totalRecordCount,
    combinedKeys,
    init,
    addDataset,
    selectDataset,
    toggleDataset,
    setActiveIds,
    clearAllDatasets,
    removeDataset,
    getRecord,
    getRecords,
  }
}
