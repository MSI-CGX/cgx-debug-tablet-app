import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addMonths,
  endOfDay,
  endOfMonth,
  format,
  parse,
  startOfDay,
  startOfMonth,
  subMonths
} from 'date-fns'
import { enUS, fr } from 'date-fns/locale'
import { CalendarDays } from 'lucide-react'
import {
  Brush,
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
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  collectNumericFieldPaths,
  getNumericAtPath,
  seriesDataKey
} from '@/lib/lmdbTimelineChartFields'
import {
  formatLmdbTimelineRangeLine
} from '@/lib/lmdbTimelineStatsFormat'

/** Local calendar day [00:00, 23:59:59.999] for a `YYYY-MM-DD` string. */
function localDayBoundsMs(yyyyMmDd: string): { start: number; end: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  return {
    start: new Date(y, mo, d, 0, 0, 0, 0).getTime(),
    end: new Date(y, mo, d, 23, 59, 59, 999).getTime()
  }
}

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
  'gnssSource'
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
  /** When set, range sliders operate on this local calendar day (24 h). */
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<string | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  /** Chart-only X zoom (indices into `chartFlatData`); null = full range. */
  const [chartBrush, setChartBrush] = useState<{ start: number; end: number } | null>(null)

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

  useEffect(() => {
    setSelectedCalendarDay(null)
  }, [rootPath, relativePath])

  const dayBounds = useMemo(() => {
    if (!selectedCalendarDay) return null
    return localDayBoundsMs(selectedCalendarDay)
  }, [selectedCalendarDay])

  const sliderTrackMin = dayBounds ? dayBounds.start : minMs
  const sliderTrackMax = dayBounds ? dayBounds.end : maxMs
  const sliderTrackSpan = Math.max(0, sliderTrackMax - sliderTrackMin)

  /** When a calendar day is active, keep range inside [day ∩ DB] (e.g. after bounds refresh). */
  useEffect(() => {
    if (loadingBounds || boundsError || !dayBounds) return
    const lo = Math.max(dayBounds.start, minMs)
    const hi = Math.min(dayBounds.end, maxMs)
    if (lo <= hi) {
      setRangeStart(lo)
      setRangeEnd(hi)
    } else {
      setRangeStart(dayBounds.start)
      setRangeEnd(dayBounds.start)
    }
  }, [minMs, maxMs, loadingBounds, boundsError, dayBounds])

  /** Full database span when no calendar day is selected. */
  useEffect(() => {
    if (selectedCalendarDay !== null) return
    if (loadingBounds || boundsError) return
    setRangeStart(minMs)
    setRangeEnd(maxMs)
  }, [selectedCalendarDay, minMs, maxMs, loadingBounds, boundsError])

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

  /** Toggles: current snapshot fields first, then user-only paths so selection survives empty windows. */
  const seriesTogglePaths = useMemo(() => {
    const extra = selectedSeries.filter((p) => !availableSeries.includes(p))
    return [...availableSeries, ...extra]
  }, [availableSeries, selectedSeries])

  useEffect(() => {
    setSelectedSeries((prev) => {
      if (availableSeries.length === 0) {
        return prev
      }
      const kept = prev.filter((p) => availableSeries.includes(p))
      if (kept.length > 0) {
        return kept
      }
      if (prev.length > 0) {
        return prev
      }
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

  const chartFlatLen = chartFlatData.length
  const chartBrushLast = Math.max(0, chartFlatLen - 1)

  useEffect(() => {
    setChartBrush(null)
  }, [rangeStart, rangeEnd, rows.length])

  const chartBrushStart = chartBrush === null ? 0 : Math.min(Math.max(0, chartBrush.start), chartBrushLast)
  const chartBrushEnd =
    chartBrush === null
      ? chartBrushLast
      : Math.max(chartBrushStart, Math.min(chartBrush.end, chartBrushLast))

  const chartBrushZoomed =
    chartFlatLen > 1 && (chartBrushStart > 0 || chartBrushEnd < chartBrushLast)

  /** X-axis: full query window unless the chart brush narrowed the visible sample range. */
  const chartXDomain = useMemo((): [number, number] => {
    if (chartFlatLen === 0) {
      const lo = Math.min(rangeStart, rangeEnd)
      const hi = Math.max(rangeStart, rangeEnd)
      if (hi > lo) return [lo, hi]
      return [lo - 1, hi + 1]
    }
    if (!chartBrushZoomed) {
      const lo = Math.min(rangeStart, rangeEnd)
      const hi = Math.max(rangeStart, rangeEnd)
      if (hi > lo) return [lo, hi]
      return [lo - 1, hi + 1]
    }
    const lo = chartFlatData[chartBrushStart].t
    const hi = chartFlatData[chartBrushEnd].t
    const a = Math.min(lo, hi)
    const b = Math.max(lo, hi)
    if (b > a) return [a, b]
    return [a - 1, b + 1]
  }, [
    chartBrushEnd,
    chartBrushStart,
    chartBrushZoomed,
    chartFlatData,
    chartFlatLen,
    rangeEnd,
    rangeStart
  ])

  const resetChartBrush = useCallback((): void => {
    setChartBrush(null)
  }, [])

  const toggleSeries = useCallback((path: string): void => {
    setSelectedSeries((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    )
  }, [])

  /** Slider track: one calendar day (local) or full DB span. */
  /** ~8000 steps across the track so the slider stays light in the DOM. */
  const sliderStepMs = useMemo(() => {
    if (sliderTrackSpan <= 0) return 1
    const targetSteps = 8000
    return Math.max(1, Math.ceil(sliderTrackSpan / targetSteps))
  }, [sliderTrackSpan])

  const onStartSlider = useCallback(
    (v: number): void => {
      const lo = sliderTrackMin
      const hi = sliderTrackMax
      const next = Math.min(Math.max(v, lo), hi)
      setRangeStart(Math.min(next, rangeEnd))
    },
    [sliderTrackMin, sliderTrackMax, rangeEnd]
  )

  const onEndSlider = useCallback(
    (v: number): void => {
      const lo = sliderTrackMin
      const hi = sliderTrackMax
      const next = Math.min(Math.max(v, lo), hi)
      setRangeEnd(Math.max(next, rangeStart))
    },
    [sliderTrackMin, sliderTrackMax, rangeStart]
  )

  const startPct =
    sliderTrackSpan > 0 ? ((rangeStart - sliderTrackMin) / sliderTrackSpan) * 100 : 50
  const endPct =
    sliderTrackSpan > 0 ? ((rangeEnd - sliderTrackMin) / sliderTrackSpan) * 100 : 50

  const dayHasDataOverlap = useMemo(() => {
    if (!dayBounds) return true
    return Math.max(dayBounds.start, minMs) <= Math.min(dayBounds.end, maxMs)
  }, [dayBounds, minMs, maxMs])

  const dateFnsLocale = i18n.language.startsWith('fr') ? fr : enUS

  const selectedDateForPicker = useMemo((): Date | undefined => {
    if (!selectedCalendarDay) return undefined
    return parse(selectedCalendarDay, 'yyyy-MM-dd', new Date())
  }, [selectedCalendarDay])

  const calendarDayButtonLabel = useMemo(() => {
    if (!selectedCalendarDay) return null
    return format(
      parse(selectedCalendarDay, 'yyyy-MM-dd', new Date()),
      'PPP',
      { locale: dateFnsLocale }
    )
  }, [selectedCalendarDay, dateFnsLocale])

  /**
   * When min/max are the same instant or fall on the same local day, tight `startMonth`/`endMonth`
   * and `disabled` would lock navigation to one month and only enable one day — unusable.
   * In that case, widen month navigation and do not grey out days (query still respects data span).
   */
  const calendarBounds = useMemo(() => {
    const lo = new Date(minMs)
    const hi = new Date(maxMs)
    const span = maxMs - minMs
    const sameLocalDay = startOfDay(lo).getTime() === startOfDay(hi).getTime()
    const degenerate =
      !Number.isFinite(span) || span <= 0 || sameLocalDay || span < 24 * 60 * 60 * 1000

    const now = new Date()
    if (degenerate) {
      return {
        navStart: startOfMonth(subMonths(now, 60)),
        navEnd: endOfMonth(addMonths(now, 24)),
        defaultViewMonth: startOfMonth(now),
        disabledMatchers: undefined as
          | [{ before: Date }, { after: Date }]
          | undefined
      }
    }

    return {
      navStart: startOfMonth(lo),
      navEnd: endOfMonth(hi),
      defaultViewMonth: startOfMonth(lo),
      disabledMatchers: [{ before: startOfDay(lo) }, { after: endOfDay(hi) }] as [
        { before: Date },
        { after: Date }
      ]
    }
  }, [minMs, maxMs])

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
        <div className="lmdb-timeline-day-row">
          <span className="lmdb-timeline-day-label muted small">{t('lmdbTimeline.calendarDayLabel')}</span>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="lmdb-timeline-cal-trigger"
                aria-label={t('lmdbTimeline.calendarDayAria')}
                aria-expanded={calendarOpen}
              >
                <CalendarDays className="size-4 shrink-0" aria-hidden />
                <span>
                  {calendarDayButtonLabel ?? t('lmdbTimeline.calendarPickPlaceholder')}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="lmdb-timeline-popover">
              <Calendar
                key={`${relativePath}-${minMs}-${maxMs}-${selectedCalendarDay ?? 'none'}`}
                mode="single"
                selected={selectedDateForPicker}
                onSelect={(d) => {
                  if (d) {
                    setSelectedCalendarDay(format(d, 'yyyy-MM-dd'))
                    setCalendarOpen(false)
                  }
                }}
                locale={dateFnsLocale}
                startMonth={calendarBounds.navStart}
                endMonth={calendarBounds.navEnd}
                defaultMonth={selectedDateForPicker ?? calendarBounds.defaultViewMonth}
                disabled={calendarBounds.disabledMatchers}
                autoFocus
              />
            </PopoverContent>
          </Popover>
          {selectedCalendarDay ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="lmdb-timeline-day-clear"
              onClick={() => setSelectedCalendarDay(null)}
            >
              {t('lmdbTimeline.calendarDayClear')}
            </Button>
          ) : null}
        </div>
        {selectedCalendarDay && !dayHasDataOverlap ? (
          <p className="muted small lmdb-timeline-day-warning">{t('lmdbTimeline.dayNoDataOverlap')}</p>
        ) : null}
        <div className="lmdb-timeline-range-bar">
          <div className="lmdb-timeline-dual-col">
            <div className="lmdb-timeline-dual-wrap" style={dualStyle}>
              <div className="lmdb-timeline-dual-bg" aria-hidden />
              <input
                type="range"
                min={sliderTrackMin}
                max={sliderTrackMax}
                step={sliderStepMs}
                value={Math.min(Math.max(rangeStart, sliderTrackMin), sliderTrackMax)}
                disabled={sliderTrackSpan <= 0}
                onChange={(e) => onStartSlider(Number(e.target.value))}
                aria-label={t('lmdbTimeline.rangeStart')}
              />
              <input
                type="range"
                min={sliderTrackMin}
                max={sliderTrackMax}
                step={sliderStepMs}
                value={Math.min(Math.max(rangeEnd, sliderTrackMin), sliderTrackMax)}
                disabled={sliderTrackSpan <= 0}
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
          {availableSeries.length === 0 && selectedSeries.length === 0 ? (
            <p className="muted">{t('lmdbTimeline.chartNoNumeric')}</p>
          ) : (
            <>
              <div className="lmdb-timeline-chart-area">
                {selectedSeries.length === 0 ? (
                  <p className="muted">{t('lmdbTimeline.chartPickSeries')}</p>
                ) : rows.length === 0 ? (
                  <p className="muted">{t('lmdbTimeline.emptyRange')}</p>
                ) : (
                  <>
                    {chartFlatLen > 1 ? (
                      <div className="lmdb-timeline-chart-zoombar">
                        <p className="muted small lmdb-timeline-chart-brush-hint">
                          {t('lmdbTimeline.chartBrushHint')}
                        </p>
                        {chartBrushZoomed ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={resetChartBrush}
                          >
                            {t('lmdbTimeline.chartZoomReset')}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    <ResponsiveContainer width="100%" height={chartFlatLen > 1 ? 420 : 360}>
                    <LineChart
                      data={chartFlatData}
                      margin={{ top: 8, right: 24, left: 8, bottom: chartFlatLen > 1 ? 4 : 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="t"
                        type="number"
                        domain={chartXDomain}
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
                      {chartFlatLen > 1 ? (
                        <Brush
                          dataKey="t"
                          height={48}
                          stroke="var(--border)"
                          fill="var(--muted)"
                          travellerWidth={9}
                          startIndex={chartBrushStart}
                          endIndex={chartBrushEnd}
                          tickFormatter={(v) =>
                            new Date(v as number).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          }
                          onChange={(range) => {
                            if (range.startIndex == null || range.endIndex == null) return
                            setChartBrush({ start: range.startIndex, end: range.endIndex })
                          }}
                        />
                      ) : null}
                    </LineChart>
                  </ResponsiveContainer>
                  </>
                )}
              </div>
              <div className="lmdb-timeline-series-panel">
                <p className="lmdb-timeline-series-hint muted small">{t('lmdbTimeline.chartSeriesHint')}</p>
                <div className="lmdb-timeline-series-grid" role="group" aria-label={t('lmdbTimeline.chartSeriesAria')}>
                  {seriesTogglePaths.map((path) => {
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
