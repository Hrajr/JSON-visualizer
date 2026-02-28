import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import * as db from './server/db'

/**
 * Vite plugin that serves a JSON list of .txt files in public/data/
 * at the endpoint /api/data-files.
 * Works in both dev (middleware) and build (generates data/files.json).
 */
function dataFolderPlugin(): Plugin {
  const DATA_DIR = 'public/data'

  function scanTxtFiles(dir: string): string[] {
    try {
      return fs.readdirSync(dir)
        .filter(f => f.toLowerCase().endsWith('.txt'))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    } catch {
      return []
    }
  }

  return {
    name: 'data-folder-listing',

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/data-files') {
          const absDir = path.resolve(DATA_DIR)
          const files = scanTxtFiles(absDir)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(files))
          return
        }
        next()
      })
    },

    writeBundle(_options, _bundle) {
      const outDir = 'dist'
      const absDir = path.resolve(DATA_DIR)
      const files = scanTxtFiles(absDir)
      const destDir = path.resolve(outDir, 'data')
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
      fs.writeFileSync(path.resolve(destDir, 'files.json'), JSON.stringify(files))
    },
  }
}

// ── SQLite API middleware ──

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8')
        resolve(raw ? JSON.parse(raw) : null)
      } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function sqliteApiPlugin(): Plugin {
  return {
    name: 'sqlite-api',
    configureServer(server) {
      // Increase incoming request body size (default is ~1MB; we may send large batches)
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/api/db')) return next()

        const url = new URL(req.url, 'http://localhost')
        const pathname = url.pathname

        try {
          // ── GET /api/db/datasets ──
          if (pathname === '/api/db/datasets' && req.method === 'GET') {
            sendJson(res, db.getDatasets())
            return
          }

          // ── POST /api/db/datasets ── create a new dataset
          if (pathname === '/api/db/datasets' && req.method === 'POST') {
            const body = (await parseJsonBody(req)) as {
              id: string; fileName: string; totalBytes: number
            }
            db.createDataset(body.id, body.fileName, body.totalBytes)
            sendJson(res, { ok: true })
            return
          }

          // ── DELETE /api/db/datasets ── delete ALL datasets
          if (pathname === '/api/db/datasets' && req.method === 'DELETE') {
            db.deleteAllDatasets()
            sendJson(res, { ok: true })
            return
          }

          // ── Dataset-specific routes: /api/db/datasets/:id/...
          const dsMatch = pathname.match(/^\/api\/db\/datasets\/([^/]+)(.*)$/)
          if (dsMatch) {
            const dsId = dsMatch[1]
            const subPath = dsMatch[2] || ''

            // DELETE /api/db/datasets/:id
            if (req.method === 'DELETE' && subPath === '') {
              db.deleteDataset(dsId)
              sendJson(res, { ok: true })
              return
            }

            // POST /api/db/datasets/:id/records  (bulk insert)
            if (req.method === 'POST' && subPath === '/records') {
              const body = (await parseJsonBody(req)) as {
                records: Record<string, unknown>[]; startIndex: number
              }
              const count = db.insertRecords(dsId, body.records, body.startIndex)
              sendJson(res, { count })
              return
            }

            // POST /api/db/datasets/:id/finalize
            if (req.method === 'POST' && subPath === '/finalize') {
              const body = (await parseJsonBody(req)) as {
                recordCount: number; keys: string[]; totalBytes: number
              }
              db.finalizeDataset(dsId, body.recordCount, body.keys, body.totalBytes)
              sendJson(res, { ok: true })
              return
            }
          }

          // ── POST /api/db/records  (fetch by absolute indices, multi-dataset)
          if (pathname === '/api/db/records' && req.method === 'POST') {
            const body = (await parseJsonBody(req)) as {
              datasets: { id: string; offset: number; count: number }[]
              indices: number[]
            }
            const records = db.getRecordsByAbsoluteIndices(body.datasets, body.indices)
            sendJson(res, records)
            return
          }

          // ── POST /api/db/record  (single record from a dataset)
          if (pathname === '/api/db/record' && req.method === 'POST') {
            const body = (await parseJsonBody(req)) as { datasetId: string; index: number }
            const record = db.getRecord(body.datasetId, body.index)
            sendJson(res, record)
            return
          }

          // ── POST /api/db/search
          if (pathname === '/api/db/search' && req.method === 'POST') {
            const body = (await parseJsonBody(req)) as {
              datasets: { id: string; offset: number; count: number }[]
              query: string
              propertyFilters: string[]
            }
            const result = db.searchRecords(body.datasets, body.query, body.propertyFilters)
            sendJson(res, result)
            return
          }

          // ── POST /api/db/sort
          if (pathname === '/api/db/sort' && req.method === 'POST') {
            const body = (await parseJsonBody(req)) as {
              datasets: { id: string; offset: number; count: number }[]
              column: string
              direction: 'asc' | 'desc'
              indices: number[] | null
            }
            const result = db.sortRecords(body.datasets, body.column, body.direction, body.indices)
            sendJson(res, result)
            return
          }

          // ── POST /api/db/query (server-side paginated query)
          if (pathname === '/api/db/query' && req.method === 'POST') {
            const body = (await parseJsonBody(req)) as {
              datasets: { id: string; offset: number; count: number }[]
              query: string
              propertyFilters: string[]
              sortColumn: string
              sortDirection: 'asc' | 'desc'
              page: number
              pageSize: number
            }
            const result = db.queryRecords(
              body.datasets, body.query, body.propertyFilters,
              body.sortColumn, body.sortDirection, body.page, body.pageSize,
            )
            sendJson(res, result)
            return
          }

          // ── POST /api/db/chart-data (aggregate data for charts)
          if (pathname === '/api/db/chart-data' && req.method === 'POST') {
            const body = (await parseJsonBody(req)) as {
              datasets: { id: string; offset: number; count: number }[]
              query: string
              propertyFilters: string[]
              columns: string[]
            }
            const result = db.aggregateChartData(
              body.datasets, body.query, body.propertyFilters, body.columns,
            )
            sendJson(res, result)
            return
          }

          // Unknown route
          sendJson(res, { error: 'Not found' }, 404)
        } catch (err) {
          console.error('[SQLite API]', err)
          sendJson(res, { error: String(err) }, 500)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), dataFolderPlugin(), sqliteApiPlugin()],
  server: {
    port: 4200,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
})
