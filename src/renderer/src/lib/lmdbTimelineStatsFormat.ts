import type { TFunction } from 'i18next'

/** Human-readable span between two timestamps (for stats line). */
export function formatLmdbTimelineDuration(ms: number, t: TFunction): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return t('lmdbTimeline.durSubSecond')
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)
  if (day > 0) {
    const hours = hr % 24
    return hours > 0
      ? t('lmdbTimeline.durDaysHours', { days: day, hours: hours })
      : t('lmdbTimeline.durDays', { days: day })
  }
  if (hr > 0) {
    const minutes = min % 60
    return minutes > 0
      ? t('lmdbTimeline.durHoursMinutes', { hours: hr, minutes: minutes })
      : t('lmdbTimeline.durHours', { hours: hr })
  }
  if (min > 0) {
    const seconds = sec % 60
    return seconds > 0
      ? t('lmdbTimeline.durMinutesSeconds', { minutes: min, seconds: seconds })
      : t('lmdbTimeline.durMinutes', { minutes: min })
  }
  return t('lmdbTimeline.durSeconds', { seconds: sec })
}

/**
 * Compact range: same calendar day → one date + time–time; otherwise full start → end.
 */
export function formatLmdbTimelineRangeLine(
  minMs: number,
  maxMs: number,
  locale: string,
  t: TFunction
): string {
  const min = new Date(minMs)
  const max = new Date(maxMs)
  const sameCalendarDay =
    min.getFullYear() === max.getFullYear() &&
    min.getMonth() === max.getMonth() &&
    min.getDate() === max.getDate()

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const timeFmt = new Intl.DateTimeFormat(locale, { timeStyle: 'short' })
  const duration = formatLmdbTimelineDuration(maxMs - minMs, t)

  if (sameCalendarDay) {
    return t('lmdbTimeline.statsRangeSameDay', {
      date: dateFmt.format(min),
      timeStart: timeFmt.format(min),
      timeEnd: timeFmt.format(max),
      duration
    })
  }
  return t('lmdbTimeline.statsRangeMultiDay', {
    from: `${dateFmt.format(min)} ${timeFmt.format(min)}`,
    to: `${dateFmt.format(max)} ${timeFmt.format(max)}`,
    duration
  })
}
