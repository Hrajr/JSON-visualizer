import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 4200,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
})
