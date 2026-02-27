/**
 * Search Web Worker
 *
 * Opens the same IndexedDB that the parser writes to and scans the lightweight
 * "meta" store (search-string + non-empty-key list per record).
 *
 * Supports:
 *   - Text query  (AND-matched terms against the search string)
 *   - Property filter  (records that have a non-empty value for a given key)
 *   - Combined query + property filter
 *   - Progress reporting every 50 000 records
 *   - Cancellation between getAll() chunks
 */

const DB_NAME = 'json-visualizer-db'
const DB_VERSION = 1
const META_STORE = 'meta'
const SCAN_CHUNK = 20_000

let cancelled = false
let dbInstance: IDBDatabase | null = null

function openSearchDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records')
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
    }
    req.onsuccess = () => { dbInstance = req.result; resolve(dbInstance) }
    req.onerror = () => reject(req.error)
  })
}

function idbReq<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function search(query: string, propertyFilter: string) {
  const db = await openSearchDB()
  const start = performance.now()

  const lowerQuery = query.toLowerCase().trim()
  const terms = lowerQuery ? lowerQuery.split(/\s+/).filter(Boolean) : []
  const hasQuery = terms.length > 0
  const hasPropFilter = propertyFilter.length > 0

  if (!hasQuery && !hasPropFilter) {
    // Nothing to filter – tell caller to show everything
    self.postMessage({ type: 'result', matchingIndices: null, timeTaken: 0 })
    return
  }

  const propNeedle = hasPropFilter ? '\t' + propertyFilter + '\t' : ''
  const matchingIndices: number[] = []
  let scanned = 0
  let nextKey: IDBValidKey = 0

  while (true) {
    if (cancelled) { self.postMessage({ type: 'cancelled' }); return }

    // Read a chunk – both keys and values in one transaction
    const range = IDBKeyRange.lowerBound(nextKey)
    const keys: IDBValidKey[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly')
      const store = tx.objectStore(META_STORE)
      const kr = store.getAllKeys(range, SCAN_CHUNK)
      kr.onsuccess = () => resolve(kr.result)
      kr.onerror = () => reject(kr.error)
    })
    const values: { s: string; k: string }[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly')
      const store = tx.objectStore(META_STORE)
      const vr = store.getAll(range, SCAN_CHUNK)
      vr.onsuccess = () => resolve(vr.result)
      vr.onerror = () => reject(vr.error)
    })

    if (keys.length === 0) break

    for (let i = 0; i < keys.length; i++) {
      let match = true

      if (hasQuery) {
        const s = values[i].s
        for (let t = 0; t < terms.length; t++) {
          if (!s.includes(terms[t])) { match = false; break }
        }
      }

      if (match && hasPropFilter) {
        if (!values[i].k.includes(propNeedle)) match = false
      }

      if (match) matchingIndices.push(keys[i] as number)
    }

    scanned += keys.length
    nextKey = (keys[keys.length - 1] as number) + 1
    self.postMessage({ type: 'progress', scanned })

    if (keys.length < SCAN_CHUNK) break // end of data
  }

  if (cancelled) { self.postMessage({ type: 'cancelled' }); return }

  self.postMessage({
    type: 'result',
    matchingIndices,
    timeTaken: performance.now() - start,
  })
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'cancel') {
    cancelled = true
    return
  }

  if (msg.type === 'search') {
    cancelled = false
    const { query, propertyFilter } = msg as { query: string; propertyFilter: string }
    search(query, propertyFilter)
  }
}
