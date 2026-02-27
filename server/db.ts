/**
 * Server-side SQLite database operations.
 *
 * Each dataset is stored in its own SQLite file at data/databases/{id}.db.
 * Metadata for all datasets is stored in data/databases/_meta.json.
 *
 * Uses better-sqlite3 (synchronous, native SQLite bindings) for maximum
 * performance. WAL mode + NORMAL synchronous for safe, fast writes.
 */

import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

const DB_DIR = path.resolve('data/databases')
const META_FILE = path.join(DB_DIR, '_meta.json')

function ensureDir(): void {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })
}

// ── Database connection cache ──

const openDBs = new Map<string, Database.Database>()

function getDB(id: string): Database.Database {
  let db = openDBs.get(id)
  if (db) return db

  ensureDir()
  const dbPath = path.join(DB_DIR, `${id}.db`)
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  openDBs.set(id, db)
  return db
}

function closeDB(id: string): void {
  const db = openDBs.get(id)
  if (db) { db.close(); openDBs.delete(id) }
}

function closeAllDBs(): void {
  for (const [, db] of openDBs) db.close()
  openDBs.clear()
}

// ── Metadata management ──

export interface DatasetMeta {
  id: string
  fileName: string
  recordCount: number
  keys: string[]
  totalBytes: number
  loadedAt: number
}

function readMeta(): DatasetMeta[] {
  ensureDir()
  try {
    if (fs.existsSync(META_FILE)) {
      return JSON.parse(fs.readFileSync(META_FILE, 'utf-8'))
    }
  } catch { /* corrupted file */ }
  return []
}

function writeMeta(datasets: DatasetMeta[]): void {
  ensureDir()
  fs.writeFileSync(META_FILE, JSON.stringify(datasets, null, 2))
}

// ── Public API ──

/** Create a new dataset database with the records table. */
export function createDataset(id: string, fileName: string, totalBytes: number): void {
  const db = getDB(id)
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      idx INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      search_text TEXT NOT NULL
    )
  `)

  const meta = readMeta()
  const existing = meta.findIndex(m => m.id === id)
  const info: DatasetMeta = { id, fileName, recordCount: 0, keys: [], totalBytes, loadedAt: Date.now() }
  if (existing >= 0) meta[existing] = info
  else meta.push(info)
  writeMeta(meta)
}

/** Build a search-text string from a record's values (lowercase). */
function buildSearchText(record: Record<string, unknown>): string {
  const parts: string[] = []
  for (const val of Object.values(record)) {
    if (val !== null && val !== undefined) {
      parts.push(typeof val === 'string' ? val : String(val))
    }
  }
  return parts.join(' ').toLowerCase()
}

/** Insert records in bulk (single transaction). Returns number inserted. */
export function insertRecords(
  id: string,
  records: Record<string, unknown>[],
  startIndex: number,
): number {
  const db = getDB(id)

  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      idx INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      search_text TEXT NOT NULL
    )
  `)

  const insert = db.prepare(
    'INSERT OR REPLACE INTO records (idx, data, search_text) VALUES (?, ?, ?)',
  )

  const tx = db.transaction((recs: Record<string, unknown>[]) => {
    for (let i = 0; i < recs.length; i++) {
      const record = recs[i]
      const data = JSON.stringify(record)
      const searchText = buildSearchText(record)
      insert.run(startIndex + i, data, searchText)
    }
  })

  tx(records)
  return records.length
}

/** Finalize dataset after parsing is complete. Updates metadata with final count and keys. */
export function finalizeDataset(
  id: string,
  recordCount: number,
  keys: string[],
  totalBytes: number,
): void {
  const meta = readMeta()
  const idx = meta.findIndex(m => m.id === id)
  if (idx >= 0) {
    meta[idx].recordCount = recordCount
    meta[idx].keys = keys
    meta[idx].totalBytes = totalBytes
  }
  writeMeta(meta)
}

/** Get all datasets. */
export function getDatasets(): DatasetMeta[] {
  return readMeta()
}

/** Check if a dataset database file exists. */
export function datasetExists(id: string): boolean {
  const dbPath = path.join(DB_DIR, `${id}.db`)
  return fs.existsSync(dbPath)
}

/** Delete a single dataset. */
export function deleteDataset(id: string): void {
  closeDB(id)
  const dbPath = path.join(DB_DIR, `${id}.db`)
  try { fs.unlinkSync(dbPath) } catch { /* file may not exist */ }
  try { fs.unlinkSync(dbPath + '-wal') } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + '-shm') } catch { /* ok */ }

  const meta = readMeta().filter(m => m.id !== id)
  writeMeta(meta)
}

/** Delete all datasets. */
export function deleteAllDatasets(): void {
  closeAllDBs()
  ensureDir()
  try {
    const files = fs.readdirSync(DB_DIR)
    for (const file of files) {
      fs.unlinkSync(path.join(DB_DIR, file))
    }
  } catch { /* ok */ }
  // Don't write meta – directory was cleared
}

/** Get records by their indices from a single dataset. */
export function getRecords(
  id: string,
  indices: number[],
): (Record<string, unknown> | null)[] {
  if (indices.length === 0) return []
  const db = getDB(id)

  // For large index lists, batch with temp table
  if (indices.length > 500) {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _idx (i INTEGER PRIMARY KEY)')
    db.exec('DELETE FROM _idx')
    const ins = db.prepare('INSERT INTO _idx VALUES (?)')
    const insertTx = db.transaction((idxs: number[]) => {
      for (const i of idxs) ins.run(i)
    })
    insertTx(indices)

    const rows = db.prepare(
      'SELECT r.idx, r.data FROM records r INNER JOIN _idx t ON r.idx = t.i',
    ).all() as { idx: number; data: string }[]

    const map = new Map<number, Record<string, unknown>>()
    for (const row of rows) map.set(row.idx, JSON.parse(row.data))
    return indices.map(i => map.get(i) ?? null)
  }

  // Small list: use IN clause
  const placeholders = indices.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT idx, data FROM records WHERE idx IN (${placeholders})`,
  ).all(...indices) as { idx: number; data: string }[]

  const map = new Map<number, Record<string, unknown>>()
  for (const row of rows) map.set(row.idx, JSON.parse(row.data))
  return indices.map(i => map.get(i) ?? null)
}

/** Get a single record. */
export function getRecord(id: string, index: number): Record<string, unknown> | null {
  const db = getDB(id)
  const row = db.prepare('SELECT data FROM records WHERE idx = ?').get(index) as
    | { data: string }
    | undefined
  return row ? JSON.parse(row.data) : null
}

/** Get records by absolute indices across multiple datasets. */
export function getRecordsByAbsoluteIndices(
  datasets: { id: string; offset: number; count: number }[],
  absIndices: number[],
): (Record<string, unknown> | null)[] {
  if (absIndices.length === 0) return []

  // Group by dataset
  const groups = new Map<string, { resultIdx: number; localIdx: number }[]>()
  for (let i = 0; i < absIndices.length; i++) {
    const absIdx = absIndices[i]
    for (const ds of datasets) {
      if (absIdx >= ds.offset && absIdx < ds.offset + ds.count) {
        let arr = groups.get(ds.id)
        if (!arr) { arr = []; groups.set(ds.id, arr) }
        arr.push({ resultIdx: i, localIdx: absIdx - ds.offset })
        break
      }
    }
  }

  const results: (Record<string, unknown> | null)[] = new Array(absIndices.length).fill(null)

  for (const [dsId, items] of groups) {
    const localIndices = items.map(it => it.localIdx)
    const records = getRecords(dsId, localIndices)
    for (let j = 0; j < items.length; j++) {
      results[items[j].resultIdx] = records[j]
    }
  }

  return results
}

/** Search records across multiple datasets. */
export function searchRecords(
  datasets: { id: string; offset: number; count: number }[],
  query: string,
  propertyFilters: string[],
): { indices: number[]; timeTaken: number } {
  const start = performance.now()
  const lowerQuery = query.toLowerCase().trim()
  const terms = lowerQuery ? lowerQuery.split(/\s+/).filter(Boolean) : []

  if (terms.length === 0 && propertyFilters.length === 0) {
    return { indices: [], timeTaken: 0 }
  }

  const allIndices: number[] = []

  for (const ds of datasets) {
    try {
      const db = getDB(ds.id)

      const conditions: string[] = []
      const params: unknown[] = []

      for (const term of terms) {
        conditions.push('search_text LIKE ?')
        params.push(`%${term}%`)
      }

      for (const prop of propertyFilters) {
        conditions.push(
          `json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) != '' AND json_extract(data, ?) != 'null'`,
        )
        params.push(`$.${prop}`, `$.${prop}`, `$.${prop}`)
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const sql = `SELECT idx FROM records ${where} ORDER BY idx`

      const rows = db.prepare(sql).all(...params) as { idx: number }[]

      for (const row of rows) {
        allIndices.push(row.idx + ds.offset)
      }
    } catch (err) {
      console.error(`[SQLite] Search error on dataset ${ds.id}:`, err)
    }
  }

  return { indices: allIndices, timeTaken: performance.now() - start }
}

/** Sort records across multiple datasets. */
export function sortRecords(
  datasets: { id: string; offset: number; count: number }[],
  column: string,
  direction: 'asc' | 'desc',
  indices: number[] | null,
): { indices: number[]; timeTaken: number } {
  const start = performance.now()

  const pairs: { absIdx: number; value: unknown }[] = []
  const indexSet = indices ? new Set(indices) : null

  for (const ds of datasets) {
    try {
      const db = getDB(ds.id)
      const sql = `SELECT idx, json_extract(data, ?) as val FROM records ORDER BY idx`
      const rows = db.prepare(sql).all(`$.${column}`) as { idx: number; val: unknown }[]

      for (const row of rows) {
        const absIdx = row.idx + ds.offset
        if (indexSet && !indexSet.has(absIdx)) continue
        pairs.push({ absIdx, value: row.val })
      }
    } catch (err) {
      console.error(`[SQLite] Sort error on dataset ${ds.id}:`, err)
    }
  }

  const mult = direction === 'asc' ? 1 : -1
  pairs.sort((a, b) => {
    const av = a.value
    const bv = b.value
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return mult * (av - bv)
    return mult * String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true })
  })

  return { indices: pairs.map(p => p.absIdx), timeTaken: performance.now() - start }
}

/** Get the record count for a dataset. */
export function getRecordCount(id: string): number {
  try {
    const db = getDB(id)
    const row = db.prepare('SELECT COUNT(*) as cnt FROM records').get() as { cnt: number }
    return row.cnt
  } catch {
    return 0
  }
}
