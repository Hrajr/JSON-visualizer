/**
 * useDataFolder – discovers .txt files in the public/data/ folder
 * and manages their selection state for batch loading.
 *
 * Fetches the file list from /api/data-files (dev) or /data/files.json (prod).
 */

import { ref, computed, type Ref } from 'vue'

export interface DataFolderFile {
  /** File name (e.g. "results.txt") */
  name: string
  /** Whether the user has selected this file for loading */
  selected: boolean
}

export function useDataFolder() {
  const files: Ref<DataFolderFile[]> = ref([])
  const isLoading = ref(false)
  const error = ref('')

  /** Fetch the list of available .txt files from the data folder. */
  async function refresh() {
    isLoading.value = true
    error.value = ''
    try {
      // Try dev API first, fall back to static JSON
      let res = await fetch('/api/data-files')
      if (!res.ok) {
        res = await fetch('/data/files.json')
      }
      if (!res.ok) {
        files.value = []
        return
      }
      const list: string[] = await res.json()
      // Preserve existing selection state for files that still exist
      const oldMap = new Map(files.value.map(f => [f.name, f.selected]))
      files.value = list.map(name => ({
        name,
        selected: oldMap.get(name) ?? false,
      }))
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      files.value = []
    } finally {
      isLoading.value = false
    }
  }

  /** Toggle selection of a specific file. */
  function toggleFile(name: string) {
    const f = files.value.find(f => f.name === name)
    if (f) f.selected = !f.selected
  }

  /** Select all files. */
  function selectAll() {
    for (const f of files.value) f.selected = true
  }

  /** Deselect all files. */
  function deselectAll() {
    for (const f of files.value) f.selected = false
  }

  /** List of selected file names. */
  const selectedFiles = computed(() =>
    files.value.filter(f => f.selected).map(f => f.name)
  )

  /** Whether any files are selected. */
  const hasSelection = computed(() => selectedFiles.value.length > 0)

  return {
    files,
    isLoading,
    error,
    selectedFiles,
    hasSelection,
    refresh,
    toggleFile,
    selectAll,
    deselectAll,
  }
}
