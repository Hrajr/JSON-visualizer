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

/**
 * Reconstruct metadata for a single .db file by opening it and
 * reading its records table. Returns null if the file is not a valid
 * dataset database.
 */
function recoverMetaFromDb(dbFile: string): DatasetMeta | null {
  const id = path.basename(dbFile, '.db')
  try {
    const db = getDB(id)

    // Check that records table exists
    const tableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='records'",
    ).get()
    if (!tableCheck) return null

    // Get record count
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM records').get() as { cnt: number }
    const recordCount = countRow.cnt
    if (recordCount === 0) return null

    // Get keys from the first record
    const firstRow = db.prepare('SELECT data FROM records ORDER BY idx LIMIT 1').get() as
      | { data: string }
      | undefined
    const keys = firstRow ? Object.keys(JSON.parse(firstRow.data)) : []

    // Get file size on disk
    const dbPath = path.join(DB_DIR, dbFile)
    const stat = fs.statSync(dbPath)

    return {
      id,
      fileName: `${id} (recovered)`,
      recordCount,
      keys,
      totalBytes: stat.size,
      loadedAt: stat.mtimeMs,
    }
  } catch (err) {
    console.warn(`[SQLite] Could not recover metadata from ${dbFile}:`, err)
    return null
  }
}

/**
 * Ensure metadata is in sync with actual .db files on disk.
 * Recovers entries for any .db file that exists but is missing from _meta.json.
 * This makes the system resilient to _meta.json being deleted/corrupted.
 */
function ensureMetaSync(): DatasetMeta[] {
  const meta = readMeta()
  const knownIds = new Set(meta.map(m => m.id))

  // Scan for .db files not tracked in _meta.json
  let dbFiles: string[]
  try {
    dbFiles = fs.readdirSync(DB_DIR).filter(f => f.endsWith('.db'))
  } catch {
    return meta
  }

  let changed = false
  for (const dbFile of dbFiles) {
    const id = path.basename(dbFile, '.db')
    if (knownIds.has(id)) continue

    const recovered = recoverMetaFromDb(dbFile)
    if (recovered) {
      console.log(`[SQLite] Recovered dataset metadata: ${id} (${recovered.recordCount} records)`)
      meta.push(recovered)
      changed = true
    }
  }

  // Also remove entries whose .db files no longer exist
  const existingFiles = new Set(dbFiles.map(f => path.basename(f, '.db')))
  const cleaned = meta.filter(m => existingFiles.has(m.id))
  if (cleaned.length !== meta.length) changed = true

  if (changed) writeMeta(cleaned)
  return cleaned
}

// ── Public API ──

/** Create a new dataset database with the records table + FTS5 index. */
export function createDataset(id: string, fileName: string, totalBytes: number): void {
  const db = getDB(id)
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      idx INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      search_text TEXT NOT NULL
    )
  `)

  // Contentless FTS5 table for fast full-text search (unicode61 = word tokenizer, case-insensitive)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
        search_text,
        content='',
        tokenize='unicode61'
      )
    `)
  } catch (err) {
    console.warn('[SQLite] Could not create FTS5 table (may not be supported):', err)
  }

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

  // Check if FTS table exists for this database
  const hasFts = !!db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='records_fts'",
  ).get()
  const ftsInsert = hasFts
    ? db.prepare('INSERT INTO records_fts(rowid, search_text) VALUES (?, ?)')
    : null

  const tx = db.transaction((recs: Record<string, unknown>[]) => {
    for (let i = 0; i < recs.length; i++) {
      const record = recs[i]
      const data = JSON.stringify(record)
      const searchText = buildSearchText(record)
      insert.run(startIndex + i, data, searchText)
      if (ftsInsert) ftsInsert.run(startIndex + i, searchText)
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

/** Get all datasets. Auto-recovers metadata from .db files if _meta.json is missing/incomplete. */
export function getDatasets(): DatasetMeta[] {
  return ensureMetaSync()
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

/**
 * Escape a user search term for safe use in an FTS5 MATCH query.
 * Wraps in double-quotes (phrase query) and doubles any internal quotes.
 */
function escapeFtsTerm(term: string): string {
  return '"' + term.replace(/"/g, '""') + '"'
}

/**
 * Search records across multiple datasets.
 *
 * Supports comma-separated multi-value search (AND logic).
 * E.g. "John, Madrid, 1500" finds records containing ALL three values.
 * Case-insensitive. Single terms (no comma) work as before.
 *
 * Uses FTS5 when available for fast indexed search; falls back to
 * LIKE-based scanning for legacy databases without an FTS table.
 */
export function searchRecords(
  datasets: { id: string; offset: number; count: number }[],
  query: string,
  propertyFilters: string[],
): { indices: number[]; timeTaken: number } {
  const start = performance.now()
  const trimmedQuery = query.trim().toLowerCase()

  // Split by comma for multi-value search, trim each term
  const terms = trimmedQuery
    ? trimmedQuery.split(',').map(t => t.trim()).filter(Boolean)
    : []

  if (terms.length === 0 && propertyFilters.length === 0) {
    return { indices: [], timeTaken: 0 }
  }

  const allIndices: number[] = []

  for (const ds of datasets) {
    try {
      const db = getDB(ds.id)

      // Detect FTS5 table
      const hasFts = !!db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='records_fts'",
      ).get()

      // Build property-filter conditions (same for both paths)
      const propConditions: string[] = []
      const propParams: unknown[] = []
      for (const prop of propertyFilters) {
        propConditions.push(
          `json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) != '' AND json_extract(data, ?) != 'null'`,
        )
        propParams.push(`$.${prop}`, `$.${prop}`, `$.${prop}`)
      }

      let rows: { idx: number }[]

      if (hasFts && terms.length > 0) {
        // ── Fast path: FTS5 indexed search ──
        const ftsQuery = terms.map(escapeFtsTerm).join(' ')

        if (propConditions.length === 0) {
          // Pure FTS search – no join needed
          rows = db.prepare(
            'SELECT rowid AS idx FROM records_fts WHERE records_fts MATCH ? ORDER BY rowid',
          ).all(ftsQuery) as { idx: number }[]
        } else {
          // FTS + property filters – join with records table
          const propWhere = propConditions.join(' AND ')
          rows = db.prepare(
            `SELECT r.idx FROM records r
             WHERE r.idx IN (SELECT rowid FROM records_fts WHERE records_fts MATCH ?)
               AND ${propWhere}
             ORDER BY r.idx`,
          ).all(ftsQuery, ...propParams) as { idx: number }[]
        }
      } else {
        // ── Fallback: LIKE-based scan (no FTS table, or only property filters) ──
        const conditions: string[] = []
        const params: unknown[] = []

        for (const term of terms) {
          conditions.push('search_text LIKE ?')
          params.push(`%${term}%`)
        }
        conditions.push(...propConditions)
        params.push(...propParams)

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
        rows = db.prepare(`SELECT idx FROM records ${where} ORDER BY idx`).all(
          ...params,
        ) as { idx: number }[]
      }

      for (const row of rows) {
        allIndices.push(row.idx + ds.offset)
      }
    } catch (err) {
      console.error(`[SQLite] Search error on dataset ${ds.id}:`, err)
    }
  }

  return { indices: allIndices, timeTaken: performance.now() - start }
}

/**
 * Sort records across multiple datasets.
 *
 * When `indices` is provided (filtered search results), only those records
 * are fetched and sorted — NOT the entire 2M-record table. This makes
 * sorting after a search effectively instant.
 */
export function sortRecords(
  datasets: { id: string; offset: number; count: number }[],
  column: string,
  direction: 'asc' | 'desc',
  indices: number[] | null,
): { indices: number[]; timeTaken: number } {
  const start = performance.now()

  const pairs: { absIdx: number; value: unknown }[] = []

  for (const ds of datasets) {
    try {
      const db = getDB(ds.id)

      if (indices !== null) {
        // ── Filtered sort: only query the records we actually need ──
        const localIndices = indices
          .filter(i => i >= ds.offset && i < ds.offset + ds.count)
          .map(i => i - ds.offset)

        if (localIndices.length === 0) continue

        let rows: { idx: number; val: unknown }[]

        if (localIndices.length <= 500) {
          // Small set – use IN clause
          const placeholders = localIndices.map(() => '?').join(',')
          rows = db.prepare(
            `SELECT idx, json_extract(data, ?) as val FROM records WHERE idx IN (${placeholders})`,
          ).all(`$.${column}`, ...localIndices) as { idx: number; val: unknown }[]
        } else {
          // Larger set – use temp table join
          db.exec('CREATE TEMP TABLE IF NOT EXISTS _sort_idx (i INTEGER PRIMARY KEY)')
          db.exec('DELETE FROM _sort_idx')
          const ins = db.prepare('INSERT INTO _sort_idx VALUES (?)')
          db.transaction((idxs: number[]) => {
            for (const i of idxs) ins.run(i)
          })(localIndices)

          rows = db.prepare(
            `SELECT r.idx, json_extract(r.data, ?) as val
             FROM records r INNER JOIN _sort_idx t ON r.idx = t.i`,
          ).all(`$.${column}`) as { idx: number; val: unknown }[]
        }

        for (const row of rows) {
          pairs.push({ absIdx: row.idx + ds.offset, value: row.val })
        }
      } else {
        // ── Unfiltered sort: scan all records ──
        const rows = db.prepare(
          `SELECT idx, json_extract(data, ?) as val FROM records ORDER BY idx`,
        ).all(`$.${column}`) as { idx: number; val: unknown }[]

        for (const row of rows) {
          pairs.push({ absIdx: row.idx + ds.offset, value: row.val })
        }
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
