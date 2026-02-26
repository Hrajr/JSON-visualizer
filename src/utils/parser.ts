/**
 * Shared parser logic – extracts JSON objects from a text chunk.
 *
 * Strategy: scan character-by-character tracking brace depth.
 * Handles:
 *  - Nested braces inside strings (ignored via quote tracking)
 *  - Escaped quotes inside strings (\")
 *  - Whitespace / newlines between objects
 *
 * Returns { objects, remainder } where remainder is any incomplete
 * trailing text that should be prepended to the next chunk.
 */

export interface ExtractResult {
  /** Successfully extracted raw JSON strings */
  jsonStrings: string[]
  /** Leftover text that may be the start of an incomplete object */
  remainder: string
}

export function extractJsonObjects(text: string): ExtractResult {
  const jsonStrings: string[] = []
  let depth = 0
  let inString = false
  let escape = false
  let objectStart = -1

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (escape) {
      escape = false
      continue
    }

    if (ch === '\\' && inString) {
      escape = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === '{') {
      if (depth === 0) {
        objectStart = i
      }
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && objectStart !== -1) {
        jsonStrings.push(text.substring(objectStart, i + 1))
        objectStart = -1
      }
      // depth < 0 means malformed; reset
      if (depth < 0) depth = 0
    }
  }

  // Everything from objectStart onward is an incomplete object
  const remainder = objectStart !== -1 ? text.substring(objectStart) : ''

  return { jsonStrings, remainder }
}

/**
 * Build a search string for a record: lowercase concatenation of all values.
 */
export function buildSearchString(record: Record<string, unknown>): string {
  const parts: string[] = []
  for (const val of Object.values(record)) {
    if (val !== null && val !== undefined) {
      parts.push(String(val))
    }
  }
  return parts.join(' ').toLowerCase()
}
