/**
 * useTheme – composable for toggling dark/light mode.
 * Uses Tailwind's 'class' strategy: toggles 'dark' on <html>.
 * Persists preference to localStorage.
 */

import { ref, watchEffect } from 'vue'

const isDark = ref(
  typeof localStorage !== 'undefined'
    ? localStorage.getItem('theme') === 'dark'
    : false
)

// Apply immediately on module load
if (typeof document !== 'undefined') {
  document.documentElement.classList.toggle('dark', isDark.value)
}

export function useTheme() {
  watchEffect(() => {
    document.documentElement.classList.toggle('dark', isDark.value)
    localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
  })

  function toggle() {
    isDark.value = !isDark.value
  }

  return { isDark, toggle }
}
