/**
 * IndexedDB / Dataset management utility.
 *
 * Each dataset is stored in its own IndexedDB database (jv-ds-{id}).
 * Dataset metadata is persisted to localStorage for instant restore on reload.
 * Supports multi-dataset selection with offset-based absolute indexing.
 */

import type { JsonRecord, DatasetInfo, DatasetRange } from '../types'

export const DB_VERSION = 1
export const RECORDS_STORE = 'records'
export const META_STORE = 'meta'

const DATASETS_LS_KEY = 'jv-datasets'
const ACTIVE_LS_KEY = 'jv-active'

// ── Unique ID generation ──

export function generateDatasetId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

export function dbNameForDataset(id: string): string {
  return `jv-ds-${id}`
}

// ── Dataset metadata (localStorage) ──

export function getSavedDatasets(): DatasetInfo[] {
  try {
    const raw = localStorage.getItem(DATASETS_LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveDatasetInfo(info: DatasetInfo): void {
  const datasets = getSavedDatasets()
  const idx = datasets.findIndex(d => d.id === info.id)
  if (idx >= 0) datasets[idx] = info
  else datasets.push(info)
  localStorage.setItem(DATASETS_LS_KEY, JSON.stringify(datasets))
}

export function removeDatasetInfo(id: string): void {
  const datasets = getSavedDatasets().filter(d => d.id !== id)
  localStorage.setItem(DATASETS_LS_KEY, JSON.stringify(datasets))
}

export function getSavedActiveIds(): string[] {
  try {
    const raw = localStorage.getItem(ACTIVE_LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveActiveIds(ids: string[]): void {
  localStorage.setItem(ACTIVE_LS_KEY, JSON.stringify(ids))
}

// ── IndexedDB connection management ──

const dbCache = new Map<string, IDBDatabase>()

export function openNamedDB(name: string): Promise<IDBDatabase> {
  const cached = dbCache.get(name)
  if (cached) return Promise.resolve(cached)

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(RECORDS_STORE)) db.createObjectStore(RECORDS_STORE)
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
    }
    req.onsuccess = () => {
      dbCache.set(name, req.result)
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}

export function closeNamedDB(name: string): void {
  const db = dbCache.get(name)
  if (db) { db.close(); dbCache.delete(name) }
}

export function closeAllDBs(): void {
  for (const [, db] of dbCache) db.close()
  dbCache.clear()
}

export async function deleteNamedDB(name: string): Promise<void> {
  closeNamedDB(name)
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve() // best effort
    req.onblocked = () => resolve()
  })
}

export async function clearStores(dbName: string): Promise<void> {
  const db = await openNamedDB(dbName)
  return new Promise((resolve, reject) => {
    const tx = db.transaction([RECORDS_STORE, META_STORE], 'readwrite')
    tx.objectStore(RECORDS_STORE).clear()
    tx.objectStore(META_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Single-DB record access ──

export async function getRecordFromDB(
  dbName: string,
  index: number,
): Promise<JsonRecord | undefined> {
  const db = await openNamedDB(dbName)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDS_STORE, 'readonly')
    const req = tx.objectStore(RECORDS_STORE).get(index)
    req.onsuccess = () => resolve(req.result as JsonRecord | undefined)
    req.onerror = () => reject(req.error)
  })
}

export async function getRecordsByIndicesFromDB(
  dbName: string,
  indices: number[],
): Promise<(JsonRecord | undefined)[]> {
  if (indices.length === 0) return []
  const db = await openNamedDB(dbName)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDS_STORE, 'readonly')
    const store = tx.objectStore(RECORDS_STORE)
    const results: (JsonRecord | undefined)[] = new Array(indices.length)
    let completed = 0

    for (let i = 0; i < indices.length; i++) {
      const req = store.get(indices[i])
      req.onsuccess = () => {
        results[i] = req.result as JsonRecord | undefined
        if (++completed === indices.length) resolve(results)
      }
      req.onerror = () => reject(req.error)
    }
  })
}

export async function getRecordCountFromDB(dbName: string): Promise<number> {
  const db = await openNamedDB(dbName)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDS_STORE, 'readonly')
    const req = tx.objectStore(RECORDS_STORE).count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ── Multi-dataset helpers ──

export function computeRanges(datasets: DatasetInfo[]): DatasetRange[] {
  const ranges: DatasetRange[] = []
  let offset = 0
  for (const ds of datasets) {
    ranges.push({ id: ds.id, dbName: ds.dbName, offset, count: ds.recordCount })
    offset += ds.recordCount
  }
  return ranges
}

export function resolveAbsoluteIndex(
  ranges: DatasetRange[],
  absIndex: number,
): { dbName: string; localIndex: number } | null {
  for (const r of ranges) {
    if (absIndex >= r.offset && absIndex < r.offset + r.count) {
      return { dbName: r.dbName, localIndex: absIndex - r.offset }
    }
  }
  return null
}

export async function getRecordByAbsoluteIndex(
  ranges: DatasetRange[],
  absIndex: number,
): Promise<JsonRecord | undefined> {
  const r = resolveAbsoluteIndex(ranges, absIndex)
  if (!r) return undefined
  return getRecordFromDB(r.dbName, r.localIndex)
}

export async function getRecordsByAbsoluteIndices(
  ranges: DatasetRange[],
  absIndices: number[],
): Promise<(JsonRecord | undefined)[]> {
  if (absIndices.length === 0) return []

  // Group indices by dataset for efficient batched reads
  const groups = new Map<string, { resultIdx: number; localIdx: number }[]>()
  for (let i = 0; i < absIndices.length; i++) {
    const r = resolveAbsoluteIndex(ranges, absIndices[i])
    if (!r) continue
    let arr = groups.get(r.dbName)
    if (!arr) { arr = []; groups.set(r.dbName, arr) }
    arr.push({ resultIdx: i, localIdx: r.localIndex })
  }

  const results: (JsonRecord | undefined)[] = new Array(absIndices.length)
  const promises: Promise<void>[] = []

  for (const [dbName, items] of groups) {
    promises.push(
      getRecordsByIndicesFromDB(dbName, items.map(it => it.localIdx)).then(records => {
        for (let j = 0; j < items.length; j++) {
          results[items[j].resultIdx] = records[j]
        }
      })
    )
  }

  await Promise.all(promises)
  return results
}
