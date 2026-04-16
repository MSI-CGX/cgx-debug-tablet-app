import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { LmdbTimelineRow } from '../../../preload/types'
import { Button } from '@/components/ui/button'
import {
  collectNumericFieldPaths,
  getNumericAtPath,
  seriesDataKey
} from '@/lib/lmdbTimelineChartFields'
import {
  formatLmdbTimelineRangeLine
} from '@/lib/lmdbTimelineStatsFormat'

type ViewMode = 'table' | 'chart'

const SERIES_COLORS = [
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#fb7185',
  '#2dd4bf',
  '#818cf8',
  '#facc15',
  '#4ade80'
]

const DEFAULT_SERIES_PREFERENCE = [
  'rpm',
  'lat',
  'lng',
  'snh',
  'winchPressure',
  'sprocket',
  'sensors',
  'quality',
  'signalQuality',
  'engine',
  'tiller',
  'winch',
  'task',
  'v'
]

type LmdbTimelineViewerProps = {
  rootPath: string
  relativePath: string
}

export default function LmdbTimelineViewer({
  rootPath,
  relativePath
}: LmdbTimelineViewerProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const [boundsError, setBoundsError] = useState<string | null>(null)
  const [minMs, setMinMs] = useState(0)
  const [maxMs, setMaxMs] = useState(0)
  const [rangeStart, setRangeStart] = useState(0)
  const [rangeEnd, setRangeEnd] = useState(0)
  const [rows, setRows] = useState<LmdbTimelineRow[]>([])
  const [queryError, setQueryError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loadingBounds, setLoadingBounds] = useState(true)
  const [loadingRows, setLoadingRows] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [selectedSeries, setSelectedSeries] = useState<string[]>([])
  const [totalDbEntries, setTotalDbEntries] = useState(0)
  const [entriesWithTime, setEntriesWithTime] = useState(0)
  const [timelineSettingsRev, setTimelineSettingsRev] = useState(0)

  useEffect(() => {
    const unsub = window.api.subscribeLmdbTimelineSettingsChanged(() => {
      setTimelineSettingsRev((n) => n + 1)
    })
    return unsub
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoadingBounds(true)
    setBoundsError(null)
    void (async () => {
      const res = await window.api.lmdbTimelineBounds(rootPath, relativePath)
      if (cancelled) return
      setLoadingBounds(false)
      if (res.error) {
        setBoundsError(res.error)
        return
      }
      setMinMs(res.minMs)
      setMaxMs(res.maxMs)
      setRangeStart(res.minMs)
      setRangeEnd(res.maxMs)
      setTotalDbEntries(res.totalDbEntries)
      setEntriesWithTime(res.entryCount)
    })()
    return () => {
      cancelled = true
    }
  }, [rootPath, relativePath, timelineSettingsRev])

  const fetchRows = useCallback(async (): Promise<void> => {
    setLoadingRows(true)
    setQueryError(null)
    try {
      const res = await window.api.lmdbTimelineQuery(rootPath, relativePath, rangeStart, rangeEnd)
      if (res.error) {
        setRows([])
        setQueryError(res.error)
        setTruncated(false)
        return
      }
      setRows(res.rows)
      setTruncated(res.truncated)
    } finally {
      setLoadingRows(false)
    }
  }, [rootPath, relativePath, rangeStart, rangeEnd])

  useEffect(() => {
    if (loadingBounds || boundsError) return
    const h = window.setTimeout(() => {
      void fetchRows()
    }, 280)
    return () => window.clearTimeout(h)
  }, [loadingBounds, boundsError, fetchRows])

  const availableSeries = useMemo(() => collectNumericFieldPaths(rows), [rows])

  useEffect(() => {
    setSelectedSeries((prev) => {
      const kept = prev.filter((p) => availableSeries.includes(p))
      if (kept.length > 0) return kept
      const picked: string[] = []
      for (const q of DEFAULT_SERIES_PREFERENCE) {
        if (availableSeries.includes(q)) picked.push(q)
        if (picked.length >= 5) break
      }
      return picked.length > 0 ? picked : availableSeries.slice(0, 5)
    })
  }, [availableSeries])

  const chartFlatData = useMemo(() => {
    return rows.map((r) => {
      const pt: Record<string, number | undefined> = { t: r.timeMs }
      for (const path of selectedSeries) {
        const v = getNumericAtPath(r.value, path)
        if (v !== null) pt[seriesDataKey(path)] = v
      }
      return pt as Record<string, number>
    })
  }, [rows, selectedSeries])

  /** X-axis matches the selected time window; pad when start === end so Recharts can render. */
  const chartTimeDomain = useMemo((): [number, number] => {
    const lo = Math.min(rangeStart, rangeEnd)
    const hi = Math.max(rangeStart, rangeEnd)
    if (hi > lo) return [lo, hi]
    return [lo - 1, hi + 1]
  }, [rangeStart, rangeEnd])

  const toggleSeries = useCallback((path: string): void => {
    setSelectedSeries((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    )
  }, [])

  /** True span of timed data in the DB (oldest → newest). */
  const spanMs = Math.max(0, maxMs - minMs)
  /** ~8000 steps across the window so the slider maps linearly in time without huge DOM step counts. */
  const sliderStepMs = useMemo(() => {
    if (spanMs <= 0) return 1
    const targetSteps = 8000
    return Math.max(1, Math.ceil(spanMs / targetSteps))
  }, [spanMs])

  const onStartSlider = (v: number): void => {
    const next = v
    setRangeStart(Math.min(next, rangeEnd))
  }

  const onEndSlider = (v: number): void => {
    const next = v
    setRangeEnd(Math.max(next, rangeStart))
  }

  const startPct =
    spanMs > 0 ? ((rangeStart - minMs) / spanMs) * 100 : 50
  const endPct = spanMs > 0 ? ((rangeEnd - minMs) / spanMs) * 100 : 50

  const statsCountLine = useMemo(() => {
    if (totalDbEntries === entriesWithTime) {
      return t('lmdbTimeline.statsCountFull', { count: totalDbEntries })
    }
    return t('lmdbTimeline.statsCountPartial', {
      total: totalDbEntries,
      timed: entriesWithTime,
      untimed: Math.max(0, totalDbEntries - entriesWithTime)
    })
  }, [t, totalDbEntries, entriesWithTime])

  const statsRangeLine = useMemo(
    () => formatLmdbTimelineRangeLine(minMs, maxMs, i18n.language, t),
    [minMs, maxMs, i18n.language, t]
  )

  const statsRangeTitle = useMemo(() => {
    return `${new Date(minMs).toISOString()} → ${new Date(maxMs).toISOString()}`
  }, [minMs, maxMs])

  if (loadingBounds) {
    return <p className="muted">{t('lmdbTimeline.loadingBounds')}</p>
  }

  if (boundsError) {
    return <div className="banner error">{boundsError}</div>
  }

  const dualStyle = {
    '--lmdb-start-pct': String(Math.min(startPct, endPct)),
    '--lmdb-end-pct': String(Math.max(startPct, endPct))
  } as React.CSSProperties

  return (
    <div className="lmdb-timeline-viewer">
      <div className="lmdb-timeline-toolbar" role="group" aria-label={t('lmdbTimeline.rangeLabel')}>
        <div className="lmdb-timeline-stats">
          <div className="lmdb-timeline-stats-count">{statsCountLine}</div>
          <div className="lmdb-timeline-stats-range" title={statsRangeTitle}>
            {statsRangeLine}
          </div>
        </div>
        <div className="lmdb-timeline-range-bar">
          <div className="lmdb-timeline-dual-col">
            <div className="lmdb-timeline-dual-wrap" style={dualStyle}>
              <div className="lmdb-timeline-dual-bg" aria-hidden />
              <input
                type="range"
                min={minMs}
                max={maxMs}
                step={sliderStepMs}
                value={rangeStart}
                disabled={spanMs <= 0}
                onChange={(e) => onStartSlider(Number(e.target.value))}
                aria-label={t('lmdbTimeline.rangeStart')}
              />
              <input
                type="range"
                min={minMs}
                max={maxMs}
                step={sliderStepMs}
                value={rangeEnd}
                disabled={spanMs <= 0}
                onChange={(e) => onEndSlider(Number(e.target.value))}
                aria-label={t('lmdbTimeline.rangeEnd')}
              />
            </div>
            <div className="lmdb-timeline-dual-times">
              <time dateTime={new Date(rangeStart).toISOString()}>
                {t('lmdbTimeline.rangeStart')}: {new Date(rangeStart).toLocaleString()}
              </time>
              <time dateTime={new Date(rangeEnd).toISOString()}>
                {t('lmdbTimeline.rangeEnd')}: {new Date(rangeEnd).toLocaleString()}
              </time>
            </div>
          </div>
          <div className="lmdb-timeline-view-toggle">
            <Button
              type="button"
              size="sm"
              variant={viewMode === 'table' ? 'default' : 'outline'}
              onClick={() => setViewMode('table')}
            >
              {t('lmdbTimeline.viewTable')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === 'chart' ? 'default' : 'outline'}
              onClick={() => setViewMode('chart')}
            >
              {t('lmdbTimeline.viewChart')}
            </Button>
          </div>
        </div>
      </div>

      {queryError ? <div className="banner error">{queryError}</div> : null}
      {truncated ? (
        <p className="muted small lmdb-timeline-trunc">{t('lmdbTimeline.truncated')}</p>
      ) : null}
      {loadingRows ? <p className="muted">{t('lmdbTimeline.loadingRows')}</p> : null}

      {!loadingRows && viewMode === 'table' ? (
        <div className="lmdb-timeline-table-wrap">
          <table className="lmdb-timeline-table">
            <thead>
              <tr>
                <th>{t('lmdbTimeline.colTime')}</th>
                <th>{t('lmdbTimeline.colKey')}</th>
                <th>{t('lmdbTimeline.colValue')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.keyStr}:${r.timeMs}:${i}`}>
                  <td>
                    <time dateTime={new Date(r.timeMs).toISOString()}>
                      {new Date(r.timeMs).toLocaleString()}
                    </time>
                  </td>
                  <td className="lmdb-timeline-mono">{r.keyStr}</td>
                  <td className="lmdb-timeline-mono lmdb-timeline-value">
                    {typeof r.value === 'string'
                      ? r.value
                      : JSON.stringify(r.value, null, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && !queryError ? (
            <p className="muted">{t('lmdbTimeline.emptyRange')}</p>
          ) : null}
        </div>
      ) : null}

      {!loadingRows && viewMode === 'chart' ? (
        <div className="lmdb-timeline-chart-wrap">
          {availableSeries.length === 0 ? (
            <p className="muted">{t('lmdbTimeline.chartNoNumeric')}</p>
          ) : (
            <>
              <div className="lmdb-timeline-chart-area">
                {selectedSeries.length === 0 ? (
                  <p className="muted">{t('lmdbTimeline.chartPickSeries')}</p>
                ) : rows.length === 0 ? (
                  <p className="muted">{t('lmdbTimeline.emptyRange')}</p>
                ) : (
                  <ResponsiveContainer width="100%" height={360}>
                    <LineChart
                      data={chartFlatData}
                      margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="t"
                        type="number"
                        domain={chartTimeDomain}
                        stroke="var(--muted-foreground)"
                        tickFormatter={(ms) =>
                          new Date(ms as number).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        }
                      />
                      <YAxis stroke="var(--muted-foreground)" domain={['auto', 'auto']} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--card)',
                          border: '1px solid var(--border)',
                          borderRadius: 8
                        }}
                        labelFormatter={(ms) => new Date(ms as number).toISOString()}
                      />
                      <Legend />
                      {selectedSeries.map((path, i) => (
                        <Line
                          key={path}
                          type="monotone"
                          dataKey={seriesDataKey(path)}
                          name={path}
                          stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="lmdb-timeline-series-panel">
                <p className="lmdb-timeline-series-hint muted small">{t('lmdbTimeline.chartSeriesHint')}</p>
                <div className="lmdb-timeline-series-grid" role="group" aria-label={t('lmdbTimeline.chartSeriesAria')}>
                  {availableSeries.map((path) => {
                    const on = selectedSeries.includes(path)
                    return (
                      <Button
                        key={path}
                        type="button"
                        size="sm"
                        variant={on ? 'default' : 'outline'}
                        className="lmdb-timeline-series-btn"
                        aria-pressed={on}
                        onClick={() => toggleSeries(path)}
                      >
                        <span className="lmdb-timeline-series-name">{path}</span>
                      </Button>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
