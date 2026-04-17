/** UI languages bundled in the renderer (`src/renderer/src/locales/*.json`). */
export const APP_LOCALES = ['en', 'fr', 'de', 'pt', 'es'] as const

export type AppLocale = (typeof APP_LOCALES)[number]

export function isAppLocale(value: string): value is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(value)
}

/** Maps stored config values or i18n language tags (e.g. `en-US`) to a supported locale. */
export function normalizeAppLocale(raw: string | null | undefined): AppLocale {
  if (raw == null || raw === '') return 'en'
  if (isAppLocale(raw)) return raw
  const primary = raw.split(/[-_]/)[0] ?? ''
  if (primary !== '' && isAppLocale(primary)) return primary
  return 'en'
}
