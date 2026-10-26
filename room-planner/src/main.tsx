import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initPersistence } from './store/persist'
import { useProject } from './store/project'
import { useUi } from './store/ui'

void initPersistence()

// Test hook for automated browser tests only (opt in with ?e2e=1). Nothing in the app depends on it.
if (new URLSearchParams(location.search).has('e2e')) (window as unknown as Record<string, unknown>).__rp = { useProject, useUi }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
