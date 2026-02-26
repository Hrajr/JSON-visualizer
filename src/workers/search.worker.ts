/**
 * Search Web Worker
 *
 * Receives a search query and an array of pre-built search strings,
 * returns the indices of matching records.
 *
 * This offloads filtering from the main thread for large datasets.
 */

self.onmessage = (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'cancel') {
    // If we were mid-search we'd check a flag, but searches are fast enough
    // that we just let them complete.
    return
  }

  if (msg.type === 'search') {
    const { query, searchStrings, indices } = msg as {
      query: string
      searchStrings: string[]
      indices: number[]
    }

    const start = performance.now()
    const lowerQuery = query.toLowerCase().trim()

    if (!lowerQuery) {
      self.postMessage({
        type: 'result',
        matchingIndices: indices, // all match
        timeTaken: performance.now() - start,
      })
      return
    }

    // Split query into terms for AND matching
    const terms = lowerQuery.split(/\s+/).filter(Boolean)

    const matchingIndices: number[] = []
    for (let i = 0; i < searchStrings.length; i++) {
      const s = searchStrings[i]
      let match = true
      for (const term of terms) {
        if (!s.includes(term)) {
          match = false
          break
        }
      }
      if (match) {
        matchingIndices.push(indices[i])
      }
    }

    self.postMessage({
      type: 'result',
      matchingIndices,
      timeTaken: performance.now() - start,
    })
  }
}
