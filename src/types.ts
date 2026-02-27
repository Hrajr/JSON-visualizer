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

/* ── Worker message types ── */

/** Messages sent TO the parser worker */
export type ParserWorkerInMessage =
  | { type: 'start'; file: File; batchSize: number; maxRecords: number }
  | { type: 'start-url'; url: string; batchSize: number; maxRecords: number }
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
  | { type: 'search'; query: string; propertyFilter: string }
  | { type: 'cancel' }

/** Messages sent FROM the search worker */
export type SearchWorkerOutMessage =
  | { type: 'result'; matchingIndices: number[]; timeTaken: number }
  | { type: 'progress'; scanned: number }
  | { type: 'cancelled' }

/** Application state enum */
export type AppState = 'idle' | 'loading' | 'loaded' | 'error'
