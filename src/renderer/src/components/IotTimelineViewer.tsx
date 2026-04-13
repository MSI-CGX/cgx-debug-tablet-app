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
import type { IotTimelineRow } from '../../../preload/types'
import { Button } from '@/components/ui/button'
import {
  collectNumericFieldPaths,
  getNumericAtPath,
  seriesDataKey
} from '@/lib/iotTimelineChartFields'
import {
  formatIotTimelineRangeLine
} from '@/lib/iotTimelineStatsFormat'

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

type IotTimelineViewerProps = {
  rootPath: string
  relativePath: string
}

export default function IotTimelineViewer({
  rootPath,
  relativePath
}: IotTimelineViewerProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const [boundsError, setBoundsError] = useState<string | null>(null)
  const [minMs, setMinMs] = useState(0)
  const [maxMs, setMaxMs] = useState(0)
  const [rangeStart, setRangeStart] = useState(0)
  const [rangeEnd, setRangeEnd] = useState(0)
  const [rows, setRows] = useState<IotTimelineRow[]>([])
  const [queryError, setQueryError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loadingBounds, setLoadingBounds] = useState(true)
  const [loadingRows, setLoadingRows] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [selectedSeries, setSelectedSeries] = useState<string[]>([])
  const [totalDbEntries, setTotalDbEntries] = useState(0)
  const [entriesWithTime, setEntriesWithTime] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoadingBounds(true)
    setBoundsError(null)
    void (async () => {
      const res = await window.api.iotTimelineBounds(rootPath, relativePath)
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
  }, [rootPath, relativePath])

  const fetchRows = useCallback(async (): Promise<void> => {
    setLoadingRows(true)
    setQueryError(null)
    try {
      const res = await window.api.iotTimelineQuery(rootPath, relativePath, rangeStart, rangeEnd)
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

  const toggleSeries = useCallback((path: string): void => {
    setSelectedSeries((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    )
  }, [])

  const span = Math.max(1, maxMs - minMs)

  const onStartSlider = (v: number): void => {
    const next = minMs + (v / 100) * span
    setRangeStart(Math.min(next, rangeEnd))
  }

  const onEndSlider = (v: number): void => {
    const next = minMs + (v / 100) * span
    setRangeEnd(Math.max(next, rangeStart))
  }

  const startPct = span > 0 ? ((rangeStart - minMs) / span) * 100 : 0
  const endPct = span > 0 ? ((rangeEnd - minMs) / span) * 100 : 100

  const statsCountLine = useMemo(() => {
    if (totalDbEntries === entriesWithTime) {
      return t('iotTimeline.statsCountFull', { count: totalDbEntries })
    }
    return t('iotTimeline.statsCountPartial', {
      total: totalDbEntries,
      timed: entriesWithTime,
      untimed: Math.max(0, totalDbEntries - entriesWithTime)
    })
  }, [t, totalDbEntries, entriesWithTime])

  const statsRangeLine = useMemo(
    () => formatIotTimelineRangeLine(minMs, maxMs, i18n.language, t),
    [minMs, maxMs, i18n.language, t]
  )

  const statsRangeTitle = useMemo(() => {
    return `${new Date(minMs).toISOString()} → ${new Date(maxMs).toISOString()}`
  }, [minMs, maxMs])

  if (loadingBounds) {
    return <p className="muted">{t('iotTimeline.loadingBounds')}</p>
  }

  if (boundsError) {
    return <div className="banner error">{boundsError}</div>
  }

  const dualStyle = {
    '--iot-start-pct': String(Math.min(startPct, endPct)),
    '--iot-end-pct': String(Math.max(startPct, endPct))
  } as React.CSSProperties

  return (
    <div className="iot-timeline-viewer">
      <div className="iot-timeline-toolbar" role="group" aria-label={t('iotTimeline.rangeLabel')}>
        <div className="iot-timeline-stats">
          <div className="iot-timeline-stats-count">{statsCountLine}</div>
          <div className="iot-timeline-stats-range" title={statsRangeTitle}>
            {statsRangeLine}
          </div>
        </div>
        <div className="iot-timeline-range-bar">
          <div className="iot-timeline-dual-col">
            <div className="iot-timeline-dual-wrap" style={dualStyle}>
              <div className="iot-timeline-dual-bg" aria-hidden />
              <input
                type="range"
                min={0}
                max={100}
                step={0.05}
                value={startPct}
                onChange={(e) => onStartSlider(Number(e.target.value))}
                aria-label={t('iotTimeline.rangeStart')}
              />
              <input
                type="range"
                min={0}
                max={100}
                step={0.05}
                value={endPct}
                onChange={(e) => onEndSlider(Number(e.target.value))}
                aria-label={t('iotTimeline.rangeEnd')}
              />
            </div>
            <div className="iot-timeline-dual-times">
              <time dateTime={new Date(rangeStart).toISOString()}>
                {t('iotTimeline.rangeStart')}: {new Date(rangeStart).toLocaleString()}
              </time>
              <time dateTime={new Date(rangeEnd).toISOString()}>
                {t('iotTimeline.rangeEnd')}: {new Date(rangeEnd).toLocaleString()}
              </time>
            </div>
          </div>
          <div className="iot-timeline-view-toggle">
            <Button
              type="button"
              size="sm"
              variant={viewMode === 'table' ? 'default' : 'outline'}
              onClick={() => setViewMode('table')}
            >
              {t('iotTimeline.viewTable')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === 'chart' ? 'default' : 'outline'}
              onClick={() => setViewMode('chart')}
            >
              {t('iotTimeline.viewChart')}
            </Button>
          </div>
        </div>
      </div>

      {queryError ? <div className="banner error">{queryError}</div> : null}
      {truncated ? (
        <p className="muted small iot-timeline-trunc">{t('iotTimeline.truncated')}</p>
      ) : null}
      {loadingRows ? <p className="muted">{t('iotTimeline.loadingRows')}</p> : null}

      {!loadingRows && viewMode === 'table' ? (
        <div className="iot-timeline-table-wrap">
          <table className="iot-timeline-table">
            <thead>
              <tr>
                <th>{t('iotTimeline.colTime')}</th>
                <th>{t('iotTimeline.colKey')}</th>
                <th>{t('iotTimeline.colValue')}</th>
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
                  <td className="iot-timeline-mono">{r.keyStr}</td>
                  <td className="iot-timeline-mono iot-timeline-value">
                    {typeof r.value === 'string'
                      ? r.value
                      : JSON.stringify(r.value, null, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && !queryError ? (
            <p className="muted">{t('iotTimeline.emptyRange')}</p>
          ) : null}
        </div>
      ) : null}

      {!loadingRows && viewMode === 'chart' ? (
        <div className="iot-timeline-chart-wrap">
          {availableSeries.length === 0 ? (
            <p className="muted">{t('iotTimeline.chartNoNumeric')}</p>
          ) : (
            <>
              <div className="iot-timeline-chart-area">
                {selectedSeries.length === 0 ? (
                  <p className="muted">{t('iotTimeline.chartPickSeries')}</p>
                ) : rows.length === 0 ? (
                  <p className="muted">{t('iotTimeline.emptyRange')}</p>
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
                        domain={['dataMin', 'dataMax']}
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
              <div className="iot-timeline-series-panel">
                <p className="iot-timeline-series-hint muted small">{t('iotTimeline.chartSeriesHint')}</p>
                <div className="iot-timeline-series-grid" role="group" aria-label={t('iotTimeline.chartSeriesAria')}>
                  {availableSeries.map((path) => {
                    const on = selectedSeries.includes(path)
                    return (
                      <Button
                        key={path}
                        type="button"
                        size="sm"
                        variant={on ? 'default' : 'outline'}
                        className="iot-timeline-series-btn"
                        aria-pressed={on}
                        onClick={() => toggleSeries(path)}
                      >
                        <span className="iot-timeline-series-name">{path}</span>
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
