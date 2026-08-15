import { setThemePreference, useThemePreference, type ThemePreference } from '../lib/theme'
import './ThemeToggle.css'

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** Three-way theme preference toggle, persisted to localStorage by `lib/theme.ts`. */
export function ThemeToggle() {
  const preference = useThemePreference()
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          className={preference === value ? 'active' : ''}
          onClick={() => setThemePreference(value)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
