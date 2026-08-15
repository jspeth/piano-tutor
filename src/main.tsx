import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Latin-only entry points: no Cyrillic/Greek/Vietnamese subsets ship.
// (The variable Archivo package doesn't split a subset-only css file, but
// unicode-range on each @font-face means the browser only ever fetches the
// latin woff2 for this Latin-only app.)
import '@fontsource-variable/archivo/wght.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './index.css'
import App from './App.tsx'
import { initTheme } from './lib/theme'

// Applies the stored theme preference to <html> before the first paint, so
// there's no flash of the wrong theme while React boots.
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
