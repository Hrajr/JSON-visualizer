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
  deleteNamedDB, deleteAllJvDatabases, computeRanges,
  getRecordByAbsoluteIndex, getRecordsByAbsoluteIndices,
  getExistingJvDatabaseNames,
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

  /** Load state from localStorage. Validates IDB databases still exist. */
  async function init() {
    datasets.value = getSavedDatasets()
    const saved = getSavedActiveIds()
    activeIds.value = saved.filter(id => datasets.value.some(d => d.id === id))

    // Validate that IDB databases actually exist (may have been evicted by browser)
    try {
      const existingNames = await getExistingJvDatabaseNames()
      if (existingNames.size > 0 || datasets.value.length > 0) {
        const validDatasets = datasets.value.filter(ds => existingNames.has(ds.dbName))
        if (validDatasets.length !== datasets.value.length) {
          // Some databases were evicted – clean up metadata
          datasets.value = validDatasets
          localStorage.setItem('jv-datasets', JSON.stringify(validDatasets))
          activeIds.value = activeIds.value.filter(id => validDatasets.some(d => d.id === id))
          saveActiveIds(activeIds.value)
        }
      }
    } catch {
      // If databases() API fails, trust localStorage
    }
  }

  /**
   * Register a newly loaded dataset.
   * @param activate If true (default), makes it the only active dataset.
   *                 If false, registers it without changing active selection.
   */
  function addDataset(info: DatasetInfo, activate = true) {
    saveDatasetInfo(info)
    datasets.value = getSavedDatasets()
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

  /** Delete ALL datasets and their IDB databases. Frees storage quota.
   *  Uses indexedDB.databases() to also delete orphaned databases not tracked in localStorage. */
  async function clearAllDatasets() {
    // CRITICAL: Clear reactive state FIRST so the table stops fetching data.
    // Otherwise Vue watchers re-open IDB connections during deletion, blocking it.
    const toCleanMeta = [...datasets.value]
    datasets.value = []
    activeIds.value = []
    saveActiveIds([])
    for (const ds of toCleanMeta) removeDatasetInfo(ds.id)

    // Now that no reactive code is accessing databases, delete them all.
    // Uses indexedDB.databases() to also catch orphaned databases.
    await deleteAllJvDatabases()
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
    setActiveIds,
    clearAllDatasets,
    removeDataset,
    getRecord,
    getRecords,
  }
}
