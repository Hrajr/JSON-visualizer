/**
 * Database API client utility.
 *
 * All heavy data is stored in server-side SQLite databases via the Vite
 * dev server middleware (better-sqlite3). This module provides thin
 * fetch() wrappers for the /api/db/* endpoints.
 *
 * Pure helper functions (computeRanges, resolveAbsoluteIndex, generateDatasetId)
 * remain on the client side.
 */

import type { JsonRecord, DatasetInfo, DatasetRange } from '../types'

const ACTIVE_LS_KEY = 'jv-active'

// ── Unique ID generation ──

export function generateDatasetId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

// ── Active dataset IDs (browser-local UI preference) ──

export function getSavedActiveIds(): string[] {
  try {
    const raw = localStorage.getItem(ACTIVE_LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveActiveIds(ids: string[]): void {
  localStorage.setItem(ACTIVE_LS_KEY, JSON.stringify(ids))
}

// ── Server API: Dataset management ──

export async function fetchDatasets(): Promise<DatasetInfo[]> {
  const res = await fetch('/api/db/datasets')
  const metas = await res.json()
  // Convert server DatasetMeta to client DatasetInfo
  return (metas as Array<{
    id: string; fileName: string; recordCount: number;
    keys: string[]; totalBytes: number; loadedAt: number
  }>).map(m => ({
    id: m.id,
    fileName: m.fileName,
    recordCount: m.recordCount,
    keys: m.keys,
    totalBytes: m.totalBytes,
    loadedAt: m.loadedAt,
  }))
}

export async function createServerDataset(
  id: string, fileName: string, totalBytes: number,
): Promise<void> {
  await fetch('/api/db/datasets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, fileName, totalBytes }),
  })
}

export async function finalizeServerDataset(
  id: string, recordCount: number, keys: string[], totalBytes: number,
): Promise<void> {
  await fetch(`/api/db/datasets/${id}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordCount, keys, totalBytes }),
  })
}

export async function deleteServerDataset(id: string): Promise<void> {
  await fetch(`/api/db/datasets/${id}`, { method: 'DELETE' })
}

export async function deleteAllServerDatasets(): Promise<void> {
  await fetch('/api/db/datasets', { method: 'DELETE' })
}

// ── Server API: Record access ──

export async function getRecordFromServer(
  datasetId: string,
  index: number,
): Promise<JsonRecord | undefined> {
  const res = await fetch('/api/db/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasetId, index }),
  })
  const record = await res.json()
  return record ?? undefined
}

export async function getRecordsByAbsoluteIndices(
  ranges: DatasetRange[],
  absIndices: number[],
): Promise<(JsonRecord | undefined)[]> {
  if (absIndices.length === 0) return []

  const datasets = ranges.map(r => ({ id: r.id, offset: r.offset, count: r.count }))
  const res = await fetch('/api/db/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasets, indices: absIndices }),
  })
  const records = (await res.json()) as (JsonRecord | null)[]
  return records.map(r => r ?? undefined)
}

// ── Server API: Search & Sort ──

export interface QueryPageResult {
  totalCount: number
  records: { absIndex: number; data: JsonRecord }[]
  timeTaken: number
}

export async function queryPage(
  datasets: { id: string; offset: number; count: number }[],
  query: string,
  propertyFilters: string[],
  sortColumn: string,
  sortDirection: 'asc' | 'desc',
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<QueryPageResult> {
  const res = await fetch('/api/db/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasets, query, propertyFilters, sortColumn, sortDirection, page, pageSize }),
    signal,
  })
  return res.json()
}

export async function searchRecords(
  datasets: { id: string; offset: number; count: number }[],
  query: string,
  propertyFilters: string[],
): Promise<{ indices: number[]; timeTaken: number }> {
  const res = await fetch('/api/db/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasets, query, propertyFilters }),
  })
  return res.json()
}

// ── Server API: Chart data aggregation ──

export interface ColumnStats {
  key: string
  type: 'numeric' | 'categorical' | 'mixed'
  totalNonNull: number
  numeric?: {
    min: number
    max: number
    avg: number
    sum: number
    count: number
    histogram: { bucket: string; count: number }[]
  }
  topValues: { value: string; count: number }[]
}

export interface ChartDataResult {
  columns: ColumnStats[]
  totalRecords: number
  timeTaken: number
}

export async function fetchChartData(
  datasets: { id: string; offset: number; count: number }[],
  query: string,
  propertyFilters: string[],
  columns: string[],
  signal?: AbortSignal,
): Promise<ChartDataResult> {
  const res = await fetch('/api/db/chart-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasets, query, propertyFilters, columns }),
    signal,
  })
  return res.json()
}

// ── Server API: Export all matching records ──

export interface ExportResult {
  records: Record<string, unknown>[]
  totalCount: number
}

export async function fetchExportData(
  datasets: { id: string; offset: number; count: number }[],
  query: string,
  propertyFilters: string[],
  sortColumn: string,
  sortDirection: 'asc' | 'desc',
  columns: string[],
  signal?: AbortSignal,
): Promise<ExportResult> {
  const res = await fetch('/api/db/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasets, query, propertyFilters, sortColumn, sortDirection, columns }),
    signal,
  })
  return res.json()
}

export async function sortRecords(
  datasets: { id: string; offset: number; count: number }[],
  column: string,
  direction: 'asc' | 'desc',
  indices: number[] | null,
): Promise<{ indices: number[]; timeTaken: number }> {
  const res = await fetch('/api/db/sort', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasets, column, direction, indices }),
  })
  return res.json()
}

// ── Multi-dataset helpers (pure functions, no I/O) ──

export function computeRanges(datasets: DatasetInfo[]): DatasetRange[] {
  const ranges: DatasetRange[] = []
  let offset = 0
  for (const ds of datasets) {
    ranges.push({ id: ds.id, offset, count: ds.recordCount })
    offset += ds.recordCount
  }
  return ranges
}

export function resolveAbsoluteIndex(
  ranges: DatasetRange[],
  absIndex: number,
): { datasetId: string; localIndex: number } | null {
  for (const r of ranges) {
    if (absIndex >= r.offset && absIndex < r.offset + r.count) {
      return { datasetId: r.id, localIndex: absIndex - r.offset }
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
  return getRecordFromServer(r.datasetId, r.localIndex)
}
