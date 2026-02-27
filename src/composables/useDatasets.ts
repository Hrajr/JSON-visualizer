/**
 * useDatasets – composable for managing multiple persistent datasets.
 *
 * Each dataset is stored in its own IndexedDB database.
 * Metadata is persisted to localStorage so datasets survive page reloads.
 * Supports multi-select: selecting multiple datasets combines their records.
 */

import { ref, computed, type Ref } from 'vue'
import type { DatasetInfo, DatasetRange, JsonRecord } from '../types'
import {
  getSavedDatasets, saveDatasetInfo, removeDatasetInfo,
  getSavedActiveIds, saveActiveIds,
  deleteNamedDB, computeRanges,
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

  /** Load state from localStorage. Call once on mount. */
  function init() {
    datasets.value = getSavedDatasets()
    const saved = getSavedActiveIds()
    activeIds.value = saved.filter(id => datasets.value.some(d => d.id === id))
  }

  /** Register a newly loaded dataset and make it the only active one. */
  function addDataset(info: DatasetInfo) {
    saveDatasetInfo(info)
    datasets.value = getSavedDatasets()
    activeIds.value = [info.id]
    saveActiveIds(activeIds.value)
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

  /** Delete a dataset (removes IDB + metadata). */
  async function removeDataset(id: string) {
    const ds = datasets.value.find(d => d.id === id)
    if (ds) {
      try { await deleteNamedDB(ds.dbName) } catch { /* best effort */ }
      removeDatasetInfo(id)
      datasets.value = getSavedDatasets()
      activeIds.value = activeIds.value.filter(i => i !== id)
      saveActiveIds(activeIds.value)
    }
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
    removeDataset,
    getRecord,
    getRecords,
  }
}
