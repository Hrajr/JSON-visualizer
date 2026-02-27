/**
 * Search & Sort Web Worker
 *
 * Searches IndexedDB RECORDS stores across multiple dataset databases.
 * Supports text query, property filter, and column-based sorting.
 * All IDB access happens inside this worker to avoid blocking the main thread.
 *
 * Uses operation IDs to handle cancellation correctly when async tasks overlap.
 */

import type { DatasetRange } from '../types'

const DB_VERSION = 1
const RECORDS_STORE = 'records'
const META_STORE = 'meta'
const SCAN_CHUNK = 50_000

let currentOpId = 0
const dbCache = new Map<string, IDBDatabase>()

function openDB(name: string): Promise<IDBDatabase> {
  const cached = dbCache.get(name)
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(RECORDS_STORE)) d.createObjectStore(RECORDS_STORE)
      if (!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE)
    }
    req.onsuccess = () => { dbCache.set(name, req.result); resolve(req.result) }
    req.onerror = () => reject(req.error)
  })
}

// ── Search ──

function buildSearchString(record: Record<string, unknown>): string {
  const parts: string[] = []
  for (const val of Object.values(record)) {
    if (val !== null && val !== undefined) parts.push(String(val))
  }
  return parts.join(' ').toLowerCase()
}

async function searchDataset(
  dbName: string,
  offset: number,
  terms: string[],
  propFilter: string,
  opId: number,
): Promise<number[]> {
  const db = await openDB(dbName)
  const hasQuery = terms.length > 0
  const hasProp = propFilter.length > 0
  const matches: number[] = []
  let nextKey: IDBValidKey = 0

  while (true) {
    if (opId !== currentOpId) return matches

    const range = IDBKeyRange.lowerBound(nextKey)

    const { keys, values } = await new Promise<{
      keys: IDBValidKey[]
      values: Record<string, unknown>[]
    }>((resolve, reject) => {
      const tx = db.transaction(RECORDS_STORE, 'readonly')
      const store = tx.objectStore(RECORDS_STORE)
      const kr = store.getAllKeys(range, SCAN_CHUNK)
      const vr = store.getAll(range, SCAN_CHUNK)
      let k: IDBValidKey[] | null = null
      let v: Record<string, unknown>[] | null = null
      kr.onsuccess = () => { k = kr.result; if (v) resolve({ keys: k, values: v }) }
      vr.onsuccess = () => { v = vr.result; if (k) resolve({ keys: k!, values: v }) }
      tx.onerror = () => reject(tx.error)
    })

    if (keys.length === 0) break

    for (let i = 0; i < keys.length; i++) {
      const record = values[i]
      let match = true

      if (hasQuery) {
        const s = buildSearchString(record)
        for (let t = 0; t < terms.length; t++) {
          if (!s.includes(terms[t])) { match = false; break }
        }
      }

      if (match && hasProp) {
        const val = record[propFilter]
        if (val === null || val === undefined || val === '') match = false
      }

      if (match) matches.push((keys[i] as number) + offset)
    }

    nextKey = (keys[keys.length - 1] as number) + 1
    self.postMessage({ type: 'progress', scanned: matches.length })
    if (keys.length < SCAN_CHUNK) break
  }

  return matches
}

async function search(query: string, propertyFilter: string, datasets: DatasetRange[], opId: number) {
  const start = performance.now()

  const lowerQuery = query.toLowerCase().trim()
  const terms = lowerQuery ? lowerQuery.split(/\s+/).filter(Boolean) : []
  const hasProp = propertyFilter.length > 0

  if (terms.length === 0 && !hasProp) {
    if (opId === currentOpId) {
      self.postMessage({ type: 'result', matchingIndices: null, timeTaken: 0 })
    }
    return
  }

  const allMatches: number[] = []

  for (const ds of datasets) {
    if (opId !== currentOpId) return
    const dsMatches = await searchDataset(ds.dbName, ds.offset, terms, propertyFilter, opId)
    if (opId !== currentOpId) return
    allMatches.push(...dsMatches)
  }

  if (opId !== currentOpId) return

  self.postMessage({
    type: 'result',
    matchingIndices: allMatches,
    timeTaken: performance.now() - start,
  })
}

// ── Sort ──

async function sortDataset(
  dbName: string,
  offset: number,
  column: string,
  indexSet: Set<number> | null,
  opId: number,
): Promise<{ absIdx: number; value: unknown }[]> {
  const db = await openDB(dbName)
  const pairs: { absIdx: number; value: unknown }[] = []
  let nextKey: IDBValidKey = 0

  while (true) {
    if (opId !== currentOpId) return pairs

    const range = IDBKeyRange.lowerBound(nextKey)
    const { keys, values } = await new Promise<{
      keys: IDBValidKey[]
      values: Record<string, unknown>[]
    }>((resolve, reject) => {
      const tx = db.transaction(RECORDS_STORE, 'readonly')
      const store = tx.objectStore(RECORDS_STORE)
      const kr = store.getAllKeys(range, SCAN_CHUNK)
      const vr = store.getAll(range, SCAN_CHUNK)
      let k: IDBValidKey[] | null = null
      let v: Record<string, unknown>[] | null = null
      kr.onsuccess = () => { k = kr.result; if (v) resolve({ keys: k, values: v }) }
      vr.onsuccess = () => { v = vr.result; if (k) resolve({ keys: k!, values: v }) }
      tx.onerror = () => reject(tx.error)
    })

    if (keys.length === 0) break

    for (let i = 0; i < keys.length; i++) {
      const absIdx = (keys[i] as number) + offset
      if (indexSet && !indexSet.has(absIdx)) continue
      pairs.push({ absIdx, value: values[i][column] })
    }

    nextKey = (keys[keys.length - 1] as number) + 1
    self.postMessage({ type: 'progress', scanned: pairs.length })
    if (keys.length < SCAN_CHUNK) break
  }

  return pairs
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? -1 : 1
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
}

async function sort(
  column: string,
  direction: 'asc' | 'desc',
  indices: number[] | null,
  datasets: DatasetRange[],
  opId: number,
) {
  const start = performance.now()
  const indexSet = indices ? new Set(indices) : null
  const allPairs: { absIdx: number; value: unknown }[] = []

  for (const ds of datasets) {
    if (opId !== currentOpId) return
    const dsPairs = await sortDataset(ds.dbName, ds.offset, column, indexSet, opId)
    if (opId !== currentOpId) return
    allPairs.push(...dsPairs)
  }

  if (opId !== currentOpId) return

  const mult = direction === 'asc' ? 1 : -1
  allPairs.sort((a, b) => mult * compareValues(a.value, b.value))

  if (opId !== currentOpId) return

  self.postMessage({
    type: 'sort-result',
    sortedIndices: allPairs.map(p => p.absIdx),
    timeTaken: performance.now() - start,
  })
}

// ── Message handler ──

self.onmessage = (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'cancel') {
    currentOpId++
    return
  }

  if (msg.type === 'search') {
    const opId = ++currentOpId
    search(msg.query, msg.propertyFilter, msg.datasets || [], opId)
  }

  if (msg.type === 'sort') {
    const opId = ++currentOpId
    sort(msg.column, msg.direction, msg.indices, msg.datasets || [], opId)
  }
}
