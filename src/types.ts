/* ── Shared types used across main thread and workers ── */

/** A single parsed JSON record. Always a flat-ish object. */
export type JsonRecord = Record<string, unknown>

/** Column definition derived from encountered keys. */
export interface ColumnDef {
  key: string
  visible: boolean
  pinned: boolean
  /** Number of records that contained this key (used for ordering). */
  frequency: number
  /** Display order index. */
  order: number
}

/** Parse error for a single record. */
export interface ParseError {
  recordIndex: number
  snippet: string
  message: string
}

/** Metadata describing a loaded dataset (persisted to localStorage). */
export interface DatasetInfo {
  id: string
  dbName: string
  fileName: string
  recordCount: number
  keys: string[]
  totalBytes: number
  loadedAt: number
}

/** Offset range for a dataset in the combined multi-dataset view. */
export interface DatasetRange {
  id: string
  dbName: string
  offset: number
  count: number
}

/* ── Worker message types ── */

/** Messages sent TO the parser worker */
export type ParserWorkerInMessage =
  | { type: 'start'; file: File; batchSize: number; maxRecords: number; dbName: string }
  | { type: 'start-url'; url: string; batchSize: number; maxRecords: number; dbName: string }
  | { type: 'cancel' }

/** Messages sent FROM the parser worker */
export type ParserWorkerOutMessage =
  | { type: 'progress'; bytesRead: number; totalBytes: number; recordsParsed: number }
  | { type: 'keys'; keys: string[] }
  | { type: 'db-flushed'; count: number }
  | { type: 'error'; error: ParseError }
  | { type: 'done'; totalRecords: number; totalErrors: number }
  | { type: 'cancelled' }
  | { type: 'limit-reached'; totalRecords: number }

/** Messages sent TO the search worker */
export type SearchWorkerInMessage =
  | { type: 'search'; query: string; propertyFilter: string; datasets: DatasetRange[] }
  | { type: 'sort'; column: string; direction: 'asc' | 'desc'; indices: number[] | null; datasets: DatasetRange[] }
  | { type: 'cancel' }

/** Messages sent FROM the search worker */
export type SearchWorkerOutMessage =
  | { type: 'result'; matchingIndices: number[] | null; timeTaken: number }
  | { type: 'sort-result'; sortedIndices: number[]; timeTaken: number }
  | { type: 'progress'; scanned: number }
  | { type: 'cancelled' }

/** Application state enum */
export type AppState = 'idle' | 'loading' | 'loaded' | 'error'
