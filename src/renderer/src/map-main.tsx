import './styles/globals.css'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { useTranslation } from 'react-i18next'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Feature, GeoJsonObject } from 'geojson'
import type { GeoJsonMapLayerEntry } from '../../preload/types'
import {
  GEO_MAP_DEFAULT_LAYER_COLORS,
  lineStrokeColorFromGeometry,
  normalizeMapColorHex
} from '../../common/geoMapColors'
import {
  DEFAULT_GEO_MAP_CONTROL_POSITION,
  type GeoMapControlPosition,
  normalizeGeoMapControlPosition
} from '../../common/geoMapControlPosition'
import { normalizeGeoMapIconId } from '../../common/geoMapIcons'
import { getGeoMapLucideComponent } from '@/lib/geoMapLucideComponents'
import i18n from '@/i18n/config'
import { normalizeAppLocale } from '../../common/appLocale'
import './map-window.css'

function layerAccentForPointsAndPolygons(entry: GeoJsonMapLayerEntry, index: number): string {
  const custom = normalizeMapColorHex(entry.mapColor)
  if (custom) return custom
  return GEO_MAP_DEFAULT_LAYER_COLORS[index % GEO_MAP_DEFAULT_LAYER_COLORS.length]!
}

function leafletLucideDivIcon(mapIcon: string | undefined, bg: string): L.DivIcon {
  const id = normalizeGeoMapIconId(mapIcon)
  const Icon = getGeoMapLucideComponent(id)
  const svgHtml = renderToStaticMarkup(
    React.createElement(Icon, {
      size: 20,
      color: '#ffffff',
      strokeWidth: 2,
      'aria-hidden': true
    })
  )
  const html = `<div class="geo-map-marker-disk" style="--geo-marker-bg:${escapeHtmlAttr(
    bg
  )}">${svgHtml}</div>`
  return L.divIcon({
    className: 'geo-map-marker-root',
    html,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -32]
  })
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function buildGeoLoadKey(layerList: GeoJsonMapLayerEntry[]): string {
  return layerList
    .map((l) => [l.id, l.relativePath, l.mapIcon ?? '', l.mapColor ?? ''].join('\t'))
    .join('\n')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatPrimitiveForPopup(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

const GEO_POPUP_MAX_DEPTH = 8

function formatPropertiesAccordionHtml(obj: Record<string, unknown>, depth: number): string {
  if (depth > GEO_POPUP_MAX_DEPTH) {
    return '<span class="geo-popup-trunc">…</span>'
  }
  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b))
  return keys
    .map((k) => {
      const v = obj[k]
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return `<details class="geo-popup-nested"><summary>${escapeHtml(k)}</summary><div class="geo-popup-nested-body">${formatPropertiesAccordionHtml(v as Record<string, unknown>, depth + 1)}</div></details>`
      }
      if (Array.isArray(v)) {
        return `<details class="geo-popup-nested"><summary>${escapeHtml(k)} · [${v.length}]</summary><pre class="geo-popup-pre">${escapeHtml(JSON.stringify(v, null, 2))}</pre></details>`
      }
      return `<div class="geo-popup-kv"><span class="geo-popup-k">${escapeHtml(k)}</span> <span class="geo-popup-v">${escapeHtml(formatPrimitiveForPopup(v))}</span></div>`
    })
    .join('')
}

function buildFeaturePopupHtml(
  layerLabel: string,
  properties: Record<string, unknown> | null | undefined,
  propertiesTitle: string
): string {
  const head = `<div class="geo-popup"><strong class="geo-popup-title">${escapeHtml(layerLabel)}</strong>`
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return `${head}</div>`
  }
  const keys = Object.keys(properties)
  if (keys.length === 0) {
    return `${head}</div>`
  }
  const body = `<details class="geo-popup-root-details"><summary>${escapeHtml(propertiesTitle)}</summary><div class="geo-popup-root-body">${formatPropertiesAccordionHtml(properties, 0)}</div></details>`
  return `${head}${body}</div>`
}

function applyLeafletZoomControlLabels(map: L.Map, translate: (key: string) => string): void {
  const root = map.getContainer()
  const zIn = translate('map.zoomIn')
  const zOut = translate('map.zoomOut')
  const toolbar = translate('map.zoomToolbarAria')
  root.querySelector('.leaflet-control-zoom-in')?.setAttribute('title', zIn)
  root.querySelector('.leaflet-control-zoom-out')?.setAttribute('title', zOut)
  root.querySelector('.leaflet-control-zoom-in')?.setAttribute('aria-label', zIn)
  root.querySelector('.leaflet-control-zoom-out')?.setAttribute('aria-label', zOut)
  const bar = root.querySelector('.leaflet-control-zoom')
  bar?.setAttribute('role', 'toolbar')
  bar?.setAttribute('aria-label', toolbar)
}

function MapApp(): JSX.Element {
  const { t, i18n: i18nInstance } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const featureGroupRef = useRef<L.FeatureGroup | null>(null)
  const geoByIdRef = useRef<Map<string, L.GeoJSON>>(new Map())
  const visibleRef = useRef<Record<string, boolean>>({})

  const [layers, setLayers] = useState<GeoJsonMapLayerEntry[]>([])
  const [toolbarEdge, setToolbarEdge] = useState<GeoMapControlPosition>(
    DEFAULT_GEO_MAP_CONTROL_POSITION
  )
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [visible, setVisible] = useState<Record<string, boolean>>({})

  visibleRef.current = visible

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
    setToolbarEdge(normalizeGeoMapControlPosition(snap.geoJsonMapToolbarPosition))
  }, [])

  useEffect(() => {
    void loadLayerList()
    const unsub = window.api.subscribeGeoJsonMapLayersChanged(() => {
      void loadLayerList()
    })
    return unsub
  }, [loadLayerList])

  useEffect(() => {
    setVisible((prev) => {
      const next: Record<string, boolean> = {}
      for (const l of layers) {
        next[l.id] = prev[l.id] ?? true
      }
      return next
    })
  }, [layers])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: false }).setView([20, 0], 2)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map)
    const zIn = i18nInstance.t('map.zoomIn')
    const zOut = i18nInstance.t('map.zoomOut')
    L.control.zoom({ zoomInTitle: zIn, zoomOutTitle: zOut }).addTo(map)
    const fg = L.featureGroup().addTo(map)
    mapRef.current = map
    featureGroupRef.current = fg
    map.whenReady(() => {
      applyLeafletZoomControlLabels(map, (key) => i18nInstance.t(key))
    })
    return (): void => {
      map.remove()
      mapRef.current = null
      featureGroupRef.current = null
    }
  }, [i18nInstance])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    applyLeafletZoomControlLabels(map, (key) => t(key))
  }, [t, i18nInstance.language])

  const geoLoadKey = useMemo(() => buildGeoLoadKey(layers), [layers])

  useEffect(() => {
    const map = mapRef.current
    const fg = featureGroupRef.current
    if (!map || !fg) return
    const propertiesTitle = t('map.popupProperties')

    let cancelled = false
    void (async () => {
      fg.clearLayers()
      geoByIdRef.current.clear()
      setError(null)
      if (layers.length === 0) {
        map.setView([20, 0], 2)
        return
      }
      setStatus('Loading…')
      for (let i = 0; i < layers.length; i++) {
        if (cancelled) return
        const entry = layers[i]!
        const accent = layerAccentForPointsAndPolygons(entry, i)
        const res = await window.api.readGeoJsonFileText(entry.relativePath)
        if (!res.ok) {
          setError(res.error)
          continue
        }
        try {
          const data = JSON.parse(res.text) as GeoJsonObject
          const gj = L.geoJSON(data, {
            style(feature: Feature | undefined) {
              const g = feature?.geometry
              if (!g) return {}
              if (g.type === 'LineString' || g.type === 'MultiLineString') {
                const c = lineStrokeColorFromGeometry(entry.id, g)
                return { color: c, weight: 3, opacity: 0.92 }
              }
              if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
                return {
                  color: accent,
                  fillColor: accent,
                  weight: 2,
                  opacity: 0.92,
                  fillOpacity: 0.22
                }
              }
              return {}
            },
            pointToLayer(_feature, latlng) {
              return L.marker(latlng, {
                icon: leafletLucideDivIcon(entry.mapIcon, accent)
              })
            },
            onEachFeature(feat, lay) {
              const props =
                feat.properties !== null &&
                feat.properties !== undefined &&
                typeof feat.properties === 'object' &&
                !Array.isArray(feat.properties)
                  ? (feat.properties as Record<string, unknown>)
                  : undefined
              lay.bindPopup(buildFeaturePopupHtml(entry.label, props, propertiesTitle))
            }
          })
          geoByIdRef.current.set(entry.id, gj)
          if (visibleRef.current[entry.id] !== false) {
            gj.addTo(fg)
          }
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
  }, [geoLoadKey, layers, t])

  useEffect(() => {
    const fg = featureGroupRef.current
    if (!fg) return
    for (const l of layers) {
      const gj = geoByIdRef.current.get(l.id)
      if (!gj) continue
      if (visible[l.id] === false) {
        fg.removeLayer(gj)
      } else if (!fg.hasLayer(gj)) {
        gj.addTo(fg)
      }
    }
  }, [visible, layers])

  const toggleLayer = useCallback((id: string): void => {
    setVisible((prev) => {
      const curOn = prev[id] !== false
      return { ...prev, [id]: !curOn }
    })
  }, [])

  return (
    <div className="map-app">
      <header className="map-app-header">
        {status ? <span className="map-app-status">{status}</span> : null}
      </header>
      {error ? <div className="map-app-error">{error}</div> : null}
      <div className="map-app-body">
        <div className="map-app-map-wrap">
          <div ref={containerRef} className="map-app-leaflet" />
          {layers.length > 0 ? (
            <div
              className="map-app-layer-overlay"
              aria-label={t('map.layerToolbarsAria')}
            >
              <div
                className={`map-layer-toolbar map-layer-toolbar--${toolbarEdge}`}
                role="toolbar"
              >
                {layers.map((layer) => {
                  const layerIndex = layers.findIndex((x) => x.id === layer.id)
                  const resolvedColor =
                    normalizeMapColorHex(layer.mapColor) ??
                    GEO_MAP_DEFAULT_LAYER_COLORS[
                      layerIndex >= 0
                        ? layerIndex % GEO_MAP_DEFAULT_LAYER_COLORS.length
                        : 0
                    ]!
                  const iconId = normalizeGeoMapIconId(layer.mapIcon)
                  const MapIcon = getGeoMapLucideComponent(iconId)
                  const on = visible[layer.id] !== false
                  return (
                    <button
                      key={layer.id}
                      type="button"
                      className={`map-layer-chip ${on ? '' : 'map-layer-chip--off'}`}
                      onClick={() => toggleLayer(layer.id)}
                      title={layer.label}
                      aria-pressed={on}
                      aria-label={t('map.layerToggleAria', { name: layer.label })}
                    >
                      <span
                        className="map-layer-chip-icon"
                        style={{ background: resolvedColor }}
                      >
                        <MapIcon size={18} strokeWidth={2} className="map-layer-chip-svg" />
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

async function bootstrapMapWindow(): Promise<void> {
  try {
    const snap = await window.api.getConfigSnapshot()
    const lng = normalizeAppLocale(snap.locale)
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
