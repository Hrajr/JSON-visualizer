/**
 * Format a camelCase/PascalCase/snake_case key into human-readable Title Case.
 *
 * Examples:
 *   SomeProperty     → Some Property
 *   SomeRandomProperty → Some Random Property
 *   someProperty     → Some Property
 *   some_property    → Some Property
 *   firstName        → First Name
 *   HTMLParser       → HTML Parser
 *   userID           → User ID
 */
export function formatColumnName(key: string): string {
  // Replace underscores with spaces
  let result = key.replace(/_/g, ' ')
  // Insert space between lowercase and uppercase: "someProperty" → "some Property"
  result = result.replace(/([a-z])([A-Z])/g, '$1 $2')
  // Insert space between consecutive uppercase and uppercase+lowercase: "HTMLParser" → "HTML Parser"
  result = result.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  // Capitalize first letter of each word
  result = result.replace(/\b\w/g, (c) => c.toUpperCase())
  return result
}
