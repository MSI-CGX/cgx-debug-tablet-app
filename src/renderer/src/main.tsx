import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import './assets/main.css'
import i18n from './i18n/config'

async function bootstrap(): Promise<void> {
  try {
    const snap = await window.api.getConfigSnapshot()
    const lng = snap.locale === 'fr' ? 'fr' : 'en'
    await i18n.changeLanguage(lng)
    document.documentElement.lang = lng
  } catch {
    await i18n.changeLanguage('en')
    document.documentElement.lang = 'en'
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
