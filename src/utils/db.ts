/**
 * IndexedDB utility – stores parsed records on disk to prevent memory crashes.
 *
 * Two object stores:
 *   records : key = record index (number) → value = JsonRecord
 *   meta    : key = record index (number) → value = { s: searchString, k: "\tkey1\tkey2\t..." }
 *
 * The "meta" store enables the search worker to scan lightweight search strings
 * and non-empty-key lists without loading full records.
 *
 * Multiple connections (main thread + workers) are supported – each caller
 * gets its own IDBDatabase handle via the module-level singleton.
 */

import type { JsonRecord } from '../types'

export const DB_NAME = 'json-visualizer-db'
export const DB_VERSION = 1
export const RECORDS_STORE = 'records'
export const META_STORE = 'meta'

let dbInstance: IDBDatabase | null = null

/** Open (or reuse) the database. */
export function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RECORDS_STORE)) {
        db.createObjectStore(RECORDS_STORE)
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
    }

    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onerror = () => reject(request.error)
  })
}

/** Close the current connection. */
export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}

/** Clear both stores (call before loading a new file). */
export async function clearAllStores(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([RECORDS_STORE, META_STORE], 'readwrite')
    tx.objectStore(RECORDS_STORE).clear()
    tx.objectStore(META_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Write a batch of records + meta to IndexedDB.
 * Each record and its corresponding meta entry share the same numeric key.
 */
export async function addBatch(
  startIndex: number,
  records: JsonRecord[],
  searchStrings: string[],
): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([RECORDS_STORE, META_STORE], 'readwrite')
    const recStore = tx.objectStore(RECORDS_STORE)
    const metaStore = tx.objectStore(META_STORE)

    for (let i = 0; i < records.length; i++) {
      const idx = startIndex + i
      recStore.put(records[i], idx)

      // Build non-empty keys string for fast property-filter checks:
      // "\tkey1\tkey2\t" – tab-delimited, leading + trailing tab for exact includes()
      const record = records[i]
      const nonEmptyKeys = Object.entries(record)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k]) => k)
      const keysStr = nonEmptyKeys.length > 0 ? '\t' + nonEmptyKeys.join('\t') + '\t' : ''

      metaStore.put({ s: searchStrings[i], k: keysStr }, idx)
    }

    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Fetch records by their exact indices (for loading one page of results). */
export async function getRecordsByIndices(
  indices: number[],
): Promise<(JsonRecord | undefined)[]> {
  if (indices.length === 0) return []
  const db = await openDB()
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

/** Fetch a single record. */
export async function getRecord(index: number): Promise<JsonRecord | undefined> {
  const results = await getRecordsByIndices([index])
  return results[0]
}

/** Total number of records in the database. */
export async function getRecordCount(): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDS_STORE, 'readonly')
    const req = tx.objectStore(RECORDS_STORE).count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
