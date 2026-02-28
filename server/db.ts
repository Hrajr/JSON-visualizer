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
const migratedDBs = new Set<string>()
const propIndexBuilt = new Map<string, Set<string>>()

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
  if (db) { db.close(); openDBs.delete(id); migratedDBs.delete(id); propIndexBuilt.delete(id) }
}

function closeAllDBs(): void {
  for (const [, db] of openDBs) db.close()
  openDBs.clear()
  migratedDBs.clear()
  propIndexBuilt.clear()
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

/**
 * Build a compact pipe-delimited string of property keys that have
 * non-null, non-empty values.  e.g. "|name|age|city|"
 * Used for fast property-existence filtering without parsing JSON.
 */
function buildPropKeys(record: Record<string, unknown>): string {
  const keys: string[] = []
  for (const [key, val] of Object.entries(record)) {
    if (val !== null && val !== undefined && val !== '') {
      keys.push(key)
    }
  }
  return keys.length > 0 ? '|' + keys.join('|') + '|' : ''
}

/**
 * Ensure the `prop_keys` column exists on the records table.
 * Only adds the column if missing — NO backfill. Property filtering
 * uses the separate _prop_cache index instead (see ensurePropIndex).
 */
function ensurePropKeys(db: Database.Database, id: string): void {
  if (migratedDBs.has(id)) return
  const cols = db.prepare("PRAGMA table_info('records')").all() as { name: string }[]
  if (!cols.some(c => c.name === 'prop_keys')) {
    db.exec("ALTER TABLE records ADD COLUMN prop_keys TEXT NOT NULL DEFAULT ''")
  }
  migratedDBs.add(id)
}

/**
 * Ensure a per-property index exists for fast property-existence filtering.
 *
 * Uses a `_prop_cache(prop, idx)` table with a compound PRIMARY KEY.
 * Built lazily per property via a single INSERT...SELECT that runs
 * entirely inside SQLite's C engine — no JS per-row overhead.
 *
 * First filter on a new property: ~3-8 seconds per 1M rows.
 * All subsequent queries on the same property: instant (indexed lookup).
 */
function ensurePropIndex(db: Database.Database, datasetId: string, prop: string): void {
  let indexed = propIndexBuilt.get(datasetId)
  if (indexed?.has(prop)) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS _prop_cache (
      prop TEXT NOT NULL,
      idx INTEGER NOT NULL,
      PRIMARY KEY (prop, idx)
    ) WITHOUT ROWID
  `)
  db.exec('CREATE TABLE IF NOT EXISTS _prop_cache_done (prop TEXT PRIMARY KEY)')

  // Check if already built (persisted from a previous run)
  const done = db.prepare('SELECT 1 FROM _prop_cache_done WHERE prop = ?').get(prop)

  if (!done) {
    const start = performance.now()
    // Single SQL statement — all scanning + filtering in C, no JS overhead
    db.prepare(
      `INSERT INTO _prop_cache (prop, idx)
       SELECT ?, idx FROM records
       WHERE NULLIF(json_extract(data, ?), '') IS NOT NULL`,
    ).run(prop, `$.${prop}`)
    db.prepare('INSERT OR IGNORE INTO _prop_cache_done VALUES (?)').run(prop)
    const ms = (performance.now() - start).toFixed(0)
    console.log(`[SQLite] Built prop index "${prop}" on ${datasetId} (${ms}ms)`)
  }

  if (!indexed) { indexed = new Set(); propIndexBuilt.set(datasetId, indexed) }
  indexed.add(prop)
}

/** Create a new dataset database with the records table + FTS5 index. */
export function createDataset(id: string, fileName: string, totalBytes: number): void {
  const db = getDB(id)
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      idx INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      search_text TEXT NOT NULL,
      prop_keys TEXT NOT NULL DEFAULT ''
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

  // Ensure table exists (with prop_keys column)
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      idx INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      search_text TEXT NOT NULL,
      prop_keys TEXT NOT NULL DEFAULT ''
    )
  `)
  ensurePropKeys(db, id)

  const insert = db.prepare(
    'INSERT OR REPLACE INTO records (idx, data, search_text, prop_keys) VALUES (?, ?, ?, ?)',
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
      const propKeys = buildPropKeys(record)
      insert.run(startIndex + i, data, searchText, propKeys)
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
 * Each word gets a prefix wildcard (*) so partial terms match:
 * e.g. "tes" matches "test", "tesla", etc.
 * Multi-word terms use implicit AND: "john mad" matches records
 * containing words starting with "john" AND "mad".
 * Special FTS5 characters are stripped to prevent query syntax errors.
 */
function escapeFtsTerm(term: string): string {
  const words = term.trim().split(/\s+/).filter(Boolean)
  return words
    .map(w => {
      // Strip characters that have special meaning in FTS5 queries
      const clean = w.replace(/["*^():{}<>.+\-~@#$%&|!\[\]\\\/]/g, '')
      return clean.length > 0 ? clean + '*' : ''
    })
    .filter(Boolean)
    .join(' ')
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

      // Property-existence checks — direct json_extract, no pre-computation
      const propConditions: string[] = []
      const propParams: unknown[] = []
      if (propertyFilters.length > 0) {
        for (const prop of propertyFilters) {
          propConditions.push("json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) != ''")
          propParams.push(`$.${prop}`, `$.${prop}`)
        }
      }

      let rows: { idx: number }[]

      const ftsQuery = hasFts && terms.length > 0
        ? terms.map(escapeFtsTerm).filter(Boolean).join(' ')
        : ''

      if (ftsQuery) {
        // ── Fast path: FTS5 indexed search ──
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

// ── Chart data aggregation ──

export interface ColumnStats {
  key: string
  type: 'numeric' | 'categorical' | 'mixed'
  totalNonNull: number
  /** Numeric stats (only for numeric/mixed types) */
  numeric?: {
    min: number
    max: number
    avg: number
    sum: number
    count: number
    histogram: { bucket: string; count: number }[]
  }
  /** Top value counts for categorical display */
  topValues: { value: string; count: number }[]
}

/**
 * Aggregate chart data for selected columns across filtered/searched records.
 *
 * Strategy: extract all column values into a TEMP TABLE in a single pass
 * (one json_extract per column per row), then run fast stats / GROUP BY /
 * histogram queries on the temp table with zero JSON parsing overhead.
 * This makes charting 1–2M records take seconds instead of minutes.
 */
export function aggregateChartData(
  datasets: { id: string; offset: number; count: number }[],
  query: string,
  propertyFilters: string[],
  columns: string[],
  maxTopValues = 20,
  histogramBuckets = 15,
  isCancelled?: () => boolean,
): { columns: ColumnStats[]; totalRecords: number; timeTaken: number } {
  const start = performance.now()
  const trimmedQuery = query.trim().toLowerCase()
  const terms = trimmedQuery
    ? trimmedQuery.split(',').map(t => t.trim()).filter(Boolean)
    : []

  // Per-column accumulators for multi-dataset merging
  interface ColAccum {
    totalNonNull: number
    numericCount: number
    numMin: number
    numMax: number
    numSum: number
    valueCounts: Map<string, number>
  }
  const accums = new Map<string, ColAccum>()
  for (const col of columns) {
    accums.set(col, {
      totalNonNull: 0, numericCount: 0,
      numMin: Infinity, numMax: -Infinity, numSum: 0,
      valueCounts: new Map(),
    })
  }
  let totalRecords = 0

  for (const ds of datasets) {
    // Check if client disconnected before processing each dataset
    if (isCancelled?.()) {
      console.log('[SQLite] Chart aggregation cancelled — client disconnected')
      break
    }
    try {
      const db = getDB(ds.id)
      const { conditions, params } = buildWhereClause(db, ds.id, terms, propertyFilters)
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      // ── Step 1: Create temp table and extract all column values in ONE pass ──
      const colDefs = columns.map((_, i) => `c${i}`).join(', ')
      db.exec(`DROP TABLE IF EXISTS _chart_extract`)
      db.exec(`CREATE TEMP TABLE _chart_extract (${columns.map((_, i) => `c${i}`).join(', ')})`)

      // Single INSERT that does one json_extract per column per row
      const jsonExtracts = columns.map((col, i) => `json_extract(data, ?)`).join(', ')
      const jsonParams = columns.map(c => `$.${c}`)

      db.prepare(
        `INSERT INTO _chart_extract (${colDefs})
         SELECT ${jsonExtracts} FROM records ${where}`,
      ).run(...jsonParams, ...params)

      // Get total inserted count
      const countRow = db.prepare(
        `SELECT COUNT(*) as cnt FROM _chart_extract`,
      ).get() as { cnt: number }
      totalRecords += countRow.cnt

      // ── Step 2: Per-column aggregation on temp table (no JSON parsing) ──
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]
        const acc = accums.get(col)!
        const cName = `c${i}`

        // Numeric stats in one fast query on extracted values
        const stats = db.prepare(
          `SELECT
             COUNT(*) as non_null,
             SUM(CASE WHEN typeof(${cName}) IN ('integer','real') THEN 1 ELSE 0 END) as num_count,
             MIN(CASE WHEN typeof(${cName}) IN ('integer','real') THEN ${cName} END) as num_min,
             MAX(CASE WHEN typeof(${cName}) IN ('integer','real') THEN ${cName} END) as num_max,
             SUM(CASE WHEN typeof(${cName}) IN ('integer','real') THEN CAST(${cName} AS REAL) ELSE 0 END) as num_sum
           FROM _chart_extract
           WHERE ${cName} IS NOT NULL AND ${cName} != ''`,
        ).get() as {
          non_null: number; num_count: number
          num_min: number | null; num_max: number | null; num_sum: number
        }

        acc.totalNonNull += stats.non_null
        acc.numericCount += stats.num_count
        if (stats.num_min !== null && stats.num_min < acc.numMin) acc.numMin = stats.num_min
        if (stats.num_max !== null && stats.num_max > acc.numMax) acc.numMax = stats.num_max
        acc.numSum += stats.num_sum

        // Top value distribution via GROUP BY on extracted column
        const topRows = db.prepare(
          `SELECT CAST(${cName} AS TEXT) as val, COUNT(*) as cnt
           FROM _chart_extract
           WHERE ${cName} IS NOT NULL AND ${cName} != ''
           GROUP BY val ORDER BY cnt DESC LIMIT ?`,
        ).all(maxTopValues + 10) as { val: string; cnt: number }[]

        for (const row of topRows) {
          if (row.val === null) continue
          acc.valueCounts.set(row.val, (acc.valueCounts.get(row.val) || 0) + row.cnt)
        }
      }

      // Clean up temp table
      db.exec(`DROP TABLE IF EXISTS _chart_extract`)
    } catch (err) {
      console.error(`[SQLite] Chart aggregation error on dataset ${ds.id}:`, err)
    }
  }

  // ── Step 3: Build final stats per column ──
  const result: ColumnStats[] = []

  for (const col of columns) {
    const acc = accums.get(col)!
    const isNumeric = acc.numericCount > acc.totalNonNull * 0.7
    const type: ColumnStats['type'] = isNumeric
      ? (acc.numericCount === acc.totalNonNull ? 'numeric' : 'mixed')
      : 'categorical'

    const sortedValues = [...acc.valueCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxTopValues)
      .map(([value, count]) => ({ value, count }))

    const stats: ColumnStats = {
      key: col,
      type,
      totalNonNull: acc.totalNonNull,
      topValues: sortedValues,
    }

    // Numeric histogram (needs a second mini temp table for this column)
    if (acc.numericCount > 0 && acc.numMin !== Infinity) {
      const min = acc.numMin
      const max = acc.numMax
      const avg = acc.numSum / acc.numericCount
      const histogram: { bucket: string; count: number }[] = []

      if (max > min) {
        const bucketSize = (max - min) / histogramBuckets
        const bucketCounts = new Array(histogramBuckets).fill(0)

        // Re-extract only this numeric column for histogram bucketing
        for (const ds of datasets) {
          if (isCancelled?.()) break
          try {
            const db = getDB(ds.id)
            const { conditions, params } = buildWhereClause(db, ds.id, terms, propertyFilters)
            const jsonPath = `$.${col}`

            // Build WHERE that includes search/filter + numeric type check
            const numericCond = `typeof(json_extract(data, ?)) IN ('integer','real')`
            const histWhere = conditions.length > 0
              ? `WHERE ${conditions.join(' AND ')} AND ${numericCond}`
              : `WHERE ${numericCond}`

            // Extract numeric values into a minimal temp table
            db.exec(`DROP TABLE IF EXISTS _hist_vals`)
            db.exec(`CREATE TEMP TABLE _hist_vals (v REAL)`)
            db.prepare(
              `INSERT INTO _hist_vals (v)
               SELECT CAST(json_extract(data, ?) AS REAL)
               FROM records ${histWhere}`,
            ).run(jsonPath, ...params, jsonPath)

            // Bucket via integer division on the temp table
            const rows = db.prepare(
              `SELECT
                 MIN(CAST((v - ?) / ? AS INTEGER), ?) as bucket,
                 COUNT(*) as cnt
               FROM _hist_vals
               GROUP BY bucket`,
            ).all(min, bucketSize, histogramBuckets - 1) as { bucket: number; cnt: number }[]

            for (const row of rows) {
              const idx = Math.max(0, Math.min(row.bucket, histogramBuckets - 1))
              bucketCounts[idx] += row.cnt
            }

            db.exec(`DROP TABLE IF EXISTS _hist_vals`)
          } catch {
            // skip histogram for this dataset on error
          }
        }

        for (let i = 0; i < histogramBuckets; i++) {
          const lo = min + i * bucketSize
          const hi = lo + bucketSize
          histogram.push({
            bucket: `${lo.toFixed(1)} – ${hi.toFixed(1)}`,
            count: bucketCounts[i],
          })
        }
      } else {
        histogram.push({ bucket: String(min), count: acc.numericCount })
      }

      stats.numeric = { min, max, avg, sum: acc.numSum, count: acc.numericCount, histogram }
    }

    result.push(stats)
  }

  return { columns: result, totalRecords, timeTaken: performance.now() - start }
}

// ── Server-side paginated query ──

export interface QueryResult {
  totalCount: number
  records: { absIndex: number; data: Record<string, unknown> }[]
  timeTaken: number
}

/**
 * Build WHERE clause components from search terms and property filters.
 * Returns { conditions, params, ftsQuery } for use in SQL construction.
 */
function buildWhereClause(
  dbInstance: Database.Database,
  datasetId: string,
  terms: string[],
  propertyFilters: string[],
): {
  conditions: string[]
  params: unknown[]
  ftsQuery: string | null
  hasFts: boolean
} {
  const hasFts = !!dbInstance.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='records_fts'",
  ).get()

  const conditions: string[] = []
  const params: unknown[] = []
  let ftsQuery: string | null = null

  // Search terms
  if (terms.length > 0 && hasFts) {
    ftsQuery = terms.map(escapeFtsTerm).filter(Boolean).join(' ')
    if (ftsQuery) {
      conditions.push('idx IN (SELECT rowid FROM records_fts WHERE records_fts MATCH ?)')
      params.push(ftsQuery)
    } else {
      // All terms were special chars only — fall back to LIKE
      for (const term of terms) {
        conditions.push('search_text LIKE ?')
        params.push(`%${term}%`)
      }
    }
  } else if (terms.length > 0) {
    for (const term of terms) {
      conditions.push('search_text LIKE ?')
      params.push(`%${term}%`)
    }
  }

  // Property filters — direct json_extract in WHERE clause.
  // SQLite's json_extract runs in C and with LIMIT stops early.
  if (propertyFilters.length > 0) {
    for (const prop of propertyFilters) {
      conditions.push("json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) != ''")
      params.push(`$.${prop}`, `$.${prop}`)
    }
  }

  return { conditions, params, ftsQuery, hasFts }
}

/**
 * Server-side paginated query — search + filter + sort + LIMIT/OFFSET.
 *
 * Returns only the records for the requested page plus the total count of
 * matching records. No huge index arrays are ever sent to the client.
 *
 * Handles multi-dataset by querying each dataset, merging and paginating
 * the combined results.
 */
export function queryRecords(
  datasets: { id: string; offset: number; count: number }[],
  query: string,
  propertyFilters: string[],
  sortColumn: string,
  sortDirection: 'asc' | 'desc',
  page: number,
  pageSize: number,
  isCancelled?: () => boolean,
): QueryResult {
  const start = performance.now()
  const trimmedQuery = query.trim().toLowerCase()
  const terms = trimmedQuery
    ? trimmedQuery.split(',').map(t => t.trim()).filter(Boolean)
    : []

  const hasFilter = terms.length > 0 || propertyFilters.length > 0
  const hasSort = sortColumn !== ''

  // ── Single dataset fast path (most common) ──
  if (datasets.length === 1) {
    const ds = datasets[0]
    try {
      const db = getDB(ds.id)
      const { conditions, params } = buildWhereClause(db, ds.id, terms, propertyFilters)
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      // Count matching records — skip expensive COUNT(*) when no filter
      let totalCount: number
      if (!hasFilter) {
        totalCount = ds.count
      } else {
        const countRow = db.prepare(
          `SELECT COUNT(*) as cnt FROM records ${where}`,
        ).get(...params) as { cnt: number }
        totalCount = countRow.cnt
      }

      // Build ORDER BY
      let orderBy = 'ORDER BY idx'
      const orderParams: unknown[] = []
      if (hasSort) {
        orderBy = `ORDER BY json_extract(data, ?) ${sortDirection === 'desc' ? 'DESC' : 'ASC'}, idx`
        orderParams.push(`$.${sortColumn}`)
      }

      // Fetch page
      const offset = (page - 1) * pageSize
      const rows = db.prepare(
        `SELECT idx, data FROM records ${where} ${orderBy} LIMIT ? OFFSET ?`,
      ).all(...params, ...orderParams, pageSize, offset) as { idx: number; data: string }[]

      const records = rows.map(row => ({
        absIndex: row.idx + ds.offset,
        data: JSON.parse(row.data) as Record<string, unknown>,
      }))

      return { totalCount, records, timeTaken: performance.now() - start }
    } catch (err) {
      console.error(`[SQLite] Query error on dataset ${ds.id}:`, err)
      return { totalCount: 0, records: [], timeTaken: performance.now() - start }
    }
  }

  // ── Multi-dataset path ──
  // Strategy: per-dataset SQL COUNT + LIMIT/OFFSET.
  // Never collect all matching indices into memory.

  let totalCount = 0

  // Phase 1: Get per-dataset filtered counts
  const dsCounts: { ds: typeof datasets[0]; count: number }[] = []
  for (const ds of datasets) {
    if (isCancelled?.()) {
      return { totalCount: 0, records: [], timeTaken: performance.now() - start }
    }
    try {
      const db = getDB(ds.id)
      const { conditions, params } = buildWhereClause(db, ds.id, terms, propertyFilters)
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      let cnt: number
      if (!hasFilter) {
        cnt = ds.count
      } else {
        const countRow = db.prepare(
          `SELECT COUNT(*) as cnt FROM records ${where}`,
        ).get(...params) as { cnt: number }
        cnt = countRow.cnt
      }
      totalCount += cnt
      dsCounts.push({ ds, count: cnt })
    } catch (err) {
      console.error(`[SQLite] Query error on dataset ${ds.id}:`, err)
    }
  }

  // Phase 2: If no sort, use efficient cross-dataset LIMIT/OFFSET
  if (!hasSort) {
    const pageStart = (page - 1) * pageSize
    const allRecords: { absIndex: number; data: Record<string, unknown> }[] = []
    let cumOffset = 0

    for (const { ds, count } of dsCounts) {
      if (isCancelled?.()) break
      const dsStart = cumOffset
      const dsEnd = cumOffset + count
      cumOffset += count

      // Skip datasets that don't overlap with the requested page
      if (pageStart + pageSize <= dsStart || pageStart >= dsEnd) continue

      const localOffset = Math.max(0, pageStart - dsStart)
      const localLimit = Math.min(pageSize - allRecords.length, dsEnd - Math.max(pageStart, dsStart))
      if (localLimit <= 0) continue

      try {
        const db = getDB(ds.id)
        const { conditions, params } = buildWhereClause(db, ds.id, terms, propertyFilters)
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

        const rows = db.prepare(
          `SELECT idx, data FROM records ${where} ORDER BY idx LIMIT ? OFFSET ?`,
        ).all(...params, localLimit, localOffset) as { idx: number; data: string }[]

        for (const row of rows) {
          allRecords.push({
            absIndex: row.idx + ds.offset,
            data: JSON.parse(row.data),
          })
        }
      } catch (err) {
        console.error(`[SQLite] Query error on dataset ${ds.id}:`, err)
      }

      if (allRecords.length >= pageSize) break
    }

    return { totalCount, records: allRecords, timeTaken: performance.now() - start }
  }

  // Phase 3: With sort — need to merge-sort across datasets.
  // Fetch (pageStart + pageSize) from EACH dataset sorted by sortColumn,
  // merge, then take the page slice. Only fetch data for final page.
  const needed = (page - 1) * pageSize + pageSize
  const perDsEntries: { absIndex: number; dsId: string; localIdx: number; sortVal: unknown }[][] = []

  for (const { ds } of dsCounts) {
    if (isCancelled?.()) {
      return { totalCount, records: [], timeTaken: performance.now() - start }
    }
    try {
      const db = getDB(ds.id)
      const { conditions, params } = buildWhereClause(db, ds.id, terms, propertyFilters)
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      // Only fetch 'needed' rows from each dataset, already sorted in SQL
      const dir = sortDirection === 'desc' ? 'DESC' : 'ASC'
      const rows = db.prepare(
        `SELECT idx, json_extract(data, ?) as sort_val FROM records ${where}
         ORDER BY json_extract(data, ?) ${dir}, idx LIMIT ?`,
      ).all(`$.${sortColumn}`, ...params, `$.${sortColumn}`, needed) as { idx: number; sort_val: unknown }[]

      const entries = rows.map(row => ({
        absIndex: row.idx + ds.offset,
        dsId: ds.id,
        localIdx: row.idx,
        sortVal: row.sort_val,
      }))
      perDsEntries.push(entries)
    } catch (err) {
      console.error(`[SQLite] Query error on dataset ${ds.id}:`, err)
    }
  }

  // Merge all datasets' sorted results
  const merged = perDsEntries.flat()
  const mult = sortDirection === 'asc' ? 1 : -1
  merged.sort((a, b) => {
    const av = a.sortVal
    const bv = b.sortVal
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return mult * (av - bv)
    return mult * String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true })
  })

  // Paginate the merged results
  const offset = (page - 1) * pageSize
  const pageEntries = merged.slice(offset, offset + pageSize)

  // Fetch full data only for the page records
  const groupedByDs = new Map<string, { absIndex: number; localIdx: number }[]>()
  for (const entry of pageEntries) {
    let arr = groupedByDs.get(entry.dsId)
    if (!arr) { arr = []; groupedByDs.set(entry.dsId, arr) }
    arr.push({ absIndex: entry.absIndex, localIdx: entry.localIdx })
  }

  const dataMap = new Map<number, Record<string, unknown>>()
  for (const [dsId, items] of groupedByDs) {
    const localIndices = items.map(it => it.localIdx)
    const records = getRecords(dsId, localIndices)
    for (let j = 0; j < items.length; j++) {
      if (records[j]) dataMap.set(items[j].absIndex, records[j]!)
    }
  }

  const pageRecords = pageEntries.map(entry => ({
    absIndex: entry.absIndex,
    data: dataMap.get(entry.absIndex) ?? {},
  }))

  return { totalCount, records: pageRecords, timeTaken: performance.now() - start }
}

/**
 * Export ALL matching records for the given columns.
 * Used by CSV/PDF export. Fetches in internal batches to avoid OOM.
 * Only extracts the requested columns, not the full JSON blob.
 */
export function exportRecords(
  datasets: { id: string; offset: number; count: number }[],
  query: string,
  propertyFilters: string[],
  sortColumn: string,
  sortDirection: 'asc' | 'desc',
  columns: string[],
  isCancelled?: () => boolean,
): { records: Record<string, unknown>[]; totalCount: number } {
  const trimmedQuery = query.trim().toLowerCase()
  const terms = trimmedQuery
    ? trimmedQuery.split(',').map(t => t.trim()).filter(Boolean)
    : []

  const hasSort = sortColumn !== ''
  const allRecords: { absIndex: number; sortVal?: unknown; data: Record<string, unknown> }[] = []

  for (const ds of datasets) {
    if (isCancelled?.()) break
    try {
      const db = getDB(ds.id)
      const { conditions, params } = buildWhereClause(db, ds.id, terms, propertyFilters)
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      // Only extract the columns we need (plus sort column if sorting)
      const jsonExtracts = columns.map(c => `json_extract(data, ?) as [${c}]`).join(', ')
      const jsonParams = columns.map(c => `$.${c}`)

      let orderBy = 'ORDER BY idx'
      const orderParams: unknown[] = []
      let sortExtract = ''
      if (hasSort && !columns.includes(sortColumn)) {
        sortExtract = `, json_extract(data, ?) as [__sort__]`
        orderParams.push(`$.${sortColumn}`)
      }
      if (hasSort) {
        orderBy = `ORDER BY json_extract(data, ?) ${sortDirection === 'desc' ? 'DESC' : 'ASC'}, idx`
        orderParams.push(`$.${sortColumn}`)
      }

      const sql = `SELECT idx, ${jsonExtracts}${sortExtract} FROM records ${where} ${orderBy}`
      const rows = db.prepare(sql).all(
        ...jsonParams, ...(sortExtract ? [orderParams[0]] : []), ...params,
        ...(hasSort ? [orderParams[orderParams.length - 1]] : []),
      ) as Record<string, unknown>[]

      for (const row of rows) {
        const data: Record<string, unknown> = {}
        for (const col of columns) {
          data[col] = row[col]
        }
        allRecords.push({
          absIndex: (row.idx as number) + ds.offset,
          sortVal: hasSort ? (row[sortColumn] ?? row['__sort__']) : undefined,
          data,
        })
      }
    } catch (err) {
      console.error(`[SQLite] Export error on dataset ${ds.id}:`, err)
    }
  }

  // If multi-dataset + sort, merge-sort across datasets
  if (datasets.length > 1 && hasSort) {
    const mult = sortDirection === 'asc' ? 1 : -1
    allRecords.sort((a, b) => {
      const av = a.sortVal
      const bv = b.sortVal
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return mult * (av - bv)
      return mult * String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true })
    })
  }

  return {
    records: allRecords.map(r => r.data),
    totalCount: allRecords.length,
  }
}
