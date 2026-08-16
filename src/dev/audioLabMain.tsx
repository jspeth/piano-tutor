// Entry point for the dev-only audio-pitch lab (audio-lab.html). Not part of
// the production build: `build.rollupOptions.input` in vite.config.ts is not
// set, so `vite build` only ever bundles index.html's graph; this file is
// only ever reached when Vite serves audio-lab.html directly in dev mode.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AudioLab } from './AudioLab'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AudioLab />
  </StrictMode>,
)
