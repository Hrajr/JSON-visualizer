import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'

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

    writeBundle(options) {
      const outDir = options.dir || 'dist'
      const absDir = path.resolve(DATA_DIR)
      const files = scanTxtFiles(absDir)
      const destDir = path.resolve(outDir, 'data')
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
      fs.writeFileSync(path.resolve(destDir, 'files.json'), JSON.stringify(files))
    },
  }
}

export default defineConfig({
  plugins: [vue(), dataFolderPlugin()],
  server: {
    port: 4200,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
})
