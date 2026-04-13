import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import type { GeoJsonObject } from 'geojson'
import type { GeoJsonMapLayerEntry } from '../../preload/types'
import i18n from '@/i18n/config'
import './map-window.css'

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow
})

const COLORS = ['#3388ff', '#e63e3e', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c']

function MapApp(): JSX.Element {
  const { i18n: i18nInstance } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const featureGroupRef = useRef<L.FeatureGroup | null>(null)
  const [layers, setLayers] = useState<GeoJsonMapLayerEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')

  useEffect(() => {
    const syncMapWindowTitle = (): void => {
      document.documentElement.lang = i18nInstance.language
      document.title = `${i18nInstance.t('app.openMap')} – ${i18nInstance.t('app.title')}`
    }
    syncMapWindowTitle()
    i18nInstance.on('languageChanged', syncMapWindowTitle)
    const unsubLocale = window.api.subscribeLocaleChanged((locale) => {
      void i18nInstance.changeLanguage(locale)
    })
    return (): void => {
      i18nInstance.off('languageChanged', syncMapWindowTitle)
      unsubLocale()
    }
  }, [i18nInstance])

  const loadLayerList = useCallback(async (): Promise<void> => {
    const snap = await window.api.getConfigSnapshot()
    setLayers(snap.geoJsonMapLayers ?? [])
  }, [])

  useEffect(() => {
    void loadLayerList()
    const unsub = window.api.subscribeGeoJsonMapLayersChanged(() => {
      void loadLayerList()
    })
    return unsub
  }, [loadLayerList])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current).setView([20, 0], 2)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map)
    const fg = L.featureGroup().addTo(map)
    mapRef.current = map
    featureGroupRef.current = fg
    return (): void => {
      map.remove()
      mapRef.current = null
      featureGroupRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const fg = featureGroupRef.current
    if (!map || !fg) return

    let cancelled = false
    void (async () => {
      fg.clearLayers()
      setError(null)
      if (layers.length === 0) {
        map.setView([20, 0], 2)
        return
      }
      setStatus('Loading…')
      for (let i = 0; i < layers.length; i++) {
        if (cancelled) return
        const entry = layers[i]!
        const color = COLORS[i % COLORS.length]!
        const res = await window.api.readGeoJsonFileText(entry.relativePath)
        if (!res.ok) {
          setError(res.error)
          continue
        }
        try {
          const data = JSON.parse(res.text) as GeoJsonObject
          const gj = L.geoJSON(data, {
            style: {
              color,
              weight: 2,
              opacity: 0.9,
              fillOpacity: 0.2
            },
            onEachFeature(_feat, lay) {
              lay.bindPopup(`<strong>${escapeHtml(entry.label)}</strong>`)
            }
          })
          gj.addTo(fg)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        }
      }
      if (cancelled) return
      setStatus('')
      const allBounds = fg.getBounds()
      if (allBounds.isValid()) {
        map.fitBounds(allBounds, { padding: [32, 32], maxZoom: 16 })
      }
    })()

    return (): void => {
      cancelled = true
    }
  }, [layers])

  return (
    <div className="map-app">
      <header className="map-app-header">
        {status ? <span className="map-app-status">{status}</span> : null}
      </header>
      {error ? <div className="map-app-error">{error}</div> : null}
      <div ref={containerRef} className="map-app-leaflet" />
    </div>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function bootstrapMapWindow(): Promise<void> {
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
      <MapApp />
    </React.StrictMode>
  )
}

void bootstrapMapWindow()
