import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { AppLocale, ConfigSnapshot } from '../../preload/types'
import { Button } from '@/components/ui/button'
import i18n from '@/i18n/config'

type SettingsViewProps = {
  onConfigChanged: () => Promise<void>
}

export default function SettingsView({ onConfigChanged }: SettingsViewProps): JSX.Element {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ConfigSnapshot | null>(null)
  const [lmdbInput, setLmdbInput] = useState('')
  const [lmdbPreview, setLmdbPreview] = useState<string>('')

  const load = useCallback(async () => {
    const snap = await window.api.getConfigSnapshot()
    setConfig(snap)
    setLmdbInput(snap.lmdbPath)
    await i18n.changeLanguage(snap.locale === 'fr' ? 'fr' : 'en')
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const unsub = window.api.subscribeIgnoredFoldersChanged(() => {
      void load()
    })
    return unsub
  }, [load])

  useEffect(() => {
    const unsub = window.api.subscribeLocaleChanged((locale) => {
      void i18n.changeLanguage(locale)
    })
    return unsub
  }, [])

  const handleRemoveOne = async (name: string): Promise<void> => {
    await window.api.removeIgnoredFolderName(name)
    await onConfigChanged()
    await load()
  }

  const handleClearAll = async (): Promise<void> => {
    const names = config?.ignoredFolderNames ?? []
    if (names.length === 0) return
    const ok = window.confirm(t('confirm.clearIgnored'))
    if (!ok) return
    await window.api.clearAllIgnoredFolderNames()
    setLmdbPreview('')
    await onConfigChanged()
    await load()
  }

  const handleSaveLmdbPath = async (): Promise<void> => {
    await window.api.setLmdbPath(lmdbInput)
    await onConfigChanged()
    await load()
  }

  const handleLmdbPreview = async (): Promise<void> => {
    setLmdbPreview(t('lmdb.loading'))
    const res = await window.api.previewLmdb(lmdbInput.trim() || undefined)
    if (res.error) {
      setLmdbPreview(t('lmdb.error', { error: res.error }))
      return
    }
    if (res.keys.length === 0) {
      setLmdbPreview(t('lmdb.empty'))
      return
    }
    setLmdbPreview(res.keys.join('\n'))
  }

  const handleLanguage = async (locale: AppLocale): Promise<void> => {
    await window.api.setLocale(locale)
    await i18n.changeLanguage(locale)
  }

  const currentLocale: AppLocale = config?.locale === 'fr' ? 'fr' : 'en'

  const ignored = config?.ignoredFolderNames ?? []

  return (
    <div className="settings-page">
      <h2 className="settings-title">{t('settings.title')}</h2>
      <p className="muted settings-lead">
        <Trans i18nKey="settings.lead" components={{ bold: <strong /> }} />
      </p>

      <section className="settings-section">
        <h3>{t('settings.languageTitle')}</h3>
        <div className="row language-row">
          <Button
            type="button"
            variant={currentLocale === 'en' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleLanguage('en')}
          >
            {t('settings.langEn')}
          </Button>
          <Button
            type="button"
            variant={currentLocale === 'fr' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleLanguage('fr')}
          >
            {t('settings.langFr')}
          </Button>
        </div>
      </section>

      {config && (
        <p className="config-path settings-store-path" title={config.storePath}>
          {t('settings.storeFile')} {config.storePath}
        </p>
      )}

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>{t('settings.ignoredTitle')}</h3>
          {ignored.length > 0 && (
            <Button type="button" variant="destructive" size="sm" onClick={handleClearAll}>
              {t('settings.restoreAll')}
            </Button>
          )}
        </div>
        <p className="muted small">{t('settings.ignoredHint')}</p>
        <ul className="settings-list">
          {ignored.map((name) => (
            <li key={name} className="settings-list-item">
              <span className="tag">{name}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleRemoveOne(name)}
              >
                {t('settings.restore')}
              </Button>
            </li>
          ))}
        </ul>
        {ignored.length === 0 && <p className="muted">{t('settings.ignoredEmpty')}</p>}
      </section>

      <section className="settings-section">
        <h3>{t('settings.lmdbTitle')}</h3>
        <p className="muted small">{t('settings.lmdbHint')}</p>
        <div className="row">
          <input
            type="text"
            className="input"
            placeholder={t('settings.lmdbPlaceholder')}
            value={lmdbInput}
            onChange={(e) => setLmdbInput(e.target.value)}
          />
          <Button type="button" variant="outline" size="sm" onClick={handleSaveLmdbPath}>
            {t('settings.savePath')}
          </Button>
          <Button type="button" size="sm" onClick={handleLmdbPreview}>
            {t('settings.loadSampleKeys')}
          </Button>
        </div>
        {lmdbPreview ? <pre className="lmdb-preview settings-lmdb-preview">{lmdbPreview}</pre> : null}
      </section>
    </div>
  )
}
