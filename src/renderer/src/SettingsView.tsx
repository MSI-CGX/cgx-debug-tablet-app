import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type {
  AppLocale,
  ConfigSnapshot,
  ExtensionPreviewKind,
  GeoJsonMapLayerEntry,
  LogHighlightRule,
  LmdbTimelineKeyRule
} from '../../preload/types'
import { Button } from '@/components/ui/button'
import i18n from '@/i18n/config'
import { normalizeExcludedPathLine } from '../../common/configExcludedPaths'

type SettingsViewProps = {
  onConfigChanged: () => Promise<void>
}

export default function SettingsView({ onConfigChanged }: SettingsViewProps): JSX.Element {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ConfigSnapshot | null>(null)
  const [lmdbInput, setLmdbInput] = useState('')
  const [lmdbRuleRows, setLmdbRuleRows] = useState<LmdbTimelineKeyRule[]>([])
  const [lmdbPreview, setLmdbPreview] = useState<string>('')
  const [extRows, setExtRows] = useState<{ ext: string; kind: ExtensionPreviewKind }[]>([])
  const [logRuleRows, setLogRuleRows] = useState<LogHighlightRule[]>([])
  const [logForAllText, setLogForAllText] = useState(false)
  const [ignoredExtInput, setIgnoredExtInput] = useState('')
  const [configFormExcludedInput, setConfigFormExcludedInput] = useState('')
  const [geoJsonLayers, setGeoJsonLayers] = useState<GeoJsonMapLayerEntry[]>([])

  const load = useCallback(async () => {
    const snap = await window.api.getConfigSnapshot()
    setConfig(snap)
    setLmdbInput(snap.lmdbPath)
    setLmdbRuleRows((snap.lmdbTimelineKeyRules ?? []).map((r) => ({ ...r })))
    setExtRows(
      Object.entries(snap.extensionPreviewMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ext, kind]) => ({ ext, kind }))
    )
    setLogRuleRows(snap.logHighlightRules.map((r) => ({ ...r })))
    setLogForAllText(snap.logHighlightForAllTextFiles)
    setGeoJsonLayers(snap.geoJsonMapLayers ?? [])
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

  useEffect(() => {
    const unsub = window.api.subscribeFileBindingsChanged(() => {
      void load()
    })
    return unsub
  }, [load])

  useEffect(() => {
    const unsub = window.api.subscribeLogRulesChanged(() => {
      void load()
    })
    return unsub
  }, [load])

  useEffect(() => {
    const unsub = window.api.subscribeGeoJsonMapLayersChanged(() => {
      void load()
    })
    return unsub
  }, [load])

  useEffect(() => {
    const unsub = window.api.subscribeWorkspaceConfigFileChanged(() => {
      void load()
    })
    return unsub
  }, [load])

  useEffect(() => {
    const unsub = window.api.subscribeConfigFormExcludedPathsChanged(() => {
      void load()
    })
    return unsub
  }, [load])

  const handleClearWorkspaceConfig = async (): Promise<void> => {
    await window.api.setWorkspaceConfigFile(null)
    await onConfigChanged()
    await load()
  }

  const handleRemoveGeoLayer = async (id: string): Promise<void> => {
    await window.api.removeGeoJsonMapLayer(id)
    await onConfigChanged()
    await load()
  }

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

  const handleSaveLmdbSettings = async (): Promise<void> => {
    await window.api.setLmdbPath(lmdbInput)
    const rules = lmdbRuleRows.filter((r) => r.lmdbPath.trim() !== '' && r.keyRegex.trim() !== '')
    await window.api.setLmdbTimelineKeyRules(rules)
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

  const handleSaveExtensions = async (): Promise<void> => {
    const map: Record<string, ExtensionPreviewKind> = {}
    for (const row of extRows) {
      const key = row.ext
        .replace(/^\./, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
      if (!key) continue
      map[key] = row.kind
    }
    await window.api.setExtensionPreviewMap(map)
    await onConfigChanged()
    await load()
  }

  const handleResetExtensions = async (): Promise<void> => {
    await window.api.resetExtensionDefaults()
    await onConfigChanged()
    await load()
  }

  const handleSaveLogRules = async (): Promise<void> => {
    await window.api.setLogHighlightRules({
      rules: logRuleRows,
      forAllTextFiles: logForAllText
    })
    await onConfigChanged()
    await load()
  }

  const handleResetLogRules = async (): Promise<void> => {
    await window.api.resetLogHighlightRules()
    await onConfigChanged()
    await load()
  }

  const currentLocale: AppLocale = config?.locale === 'fr' ? 'fr' : 'en'

  const ignored = config?.ignoredFolderNames ?? []
  const ignoredExts = config?.ignoredFileExtensions ?? []

  const handleAddIgnoredExt = async (): Promise<void> => {
    const raw = ignoredExtInput
      .trim()
      .replace(/^\./, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    if (!raw) return
    const next = [...new Set([...ignoredExts, raw])].sort()
    await window.api.setIgnoredFileExtensions(next)
    setIgnoredExtInput('')
    await onConfigChanged()
    await load()
  }

  const handleRemoveIgnoredExt = async (ext: string): Promise<void> => {
    const next = ignoredExts.filter((e) => e !== ext)
    await window.api.setIgnoredFileExtensions(next)
    await onConfigChanged()
    await load()
  }

  const handleClearAllIgnoredExts = async (): Promise<void> => {
    if (ignoredExts.length === 0) return
    const ok = window.confirm(t('confirm.clearIgnoredExtensions'))
    if (!ok) return
    await window.api.setIgnoredFileExtensions([])
    await onConfigChanged()
    await load()
  }

  const configFormExcludedPaths = config?.configFormExcludedPaths ?? []

  const handleAddConfigFormExcluded = async (): Promise<void> => {
    const n = normalizeExcludedPathLine(configFormExcludedInput)
    if (!n) return
    const next = [...new Set([...configFormExcludedPaths, n])].sort((a, b) =>
      a.localeCompare(b)
    )
    await window.api.setConfigFormExcludedPaths(next)
    setConfigFormExcludedInput('')
    await onConfigChanged()
    await load()
  }

  const handleRemoveConfigFormExcluded = async (path: string): Promise<void> => {
    const next = configFormExcludedPaths.filter((p) => p !== path)
    await window.api.setConfigFormExcludedPaths(next)
    await onConfigChanged()
    await load()
  }

  const handleClearAllConfigFormExcluded = async (): Promise<void> => {
    if (configFormExcludedPaths.length === 0) return
    const ok = window.confirm(t('confirm.clearConfigFormExcluded'))
    if (!ok) return
    await window.api.setConfigFormExcludedPaths([])
    await onConfigChanged()
    await load()
  }

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
        <>
          {config.workspaceRoot ? (
            <p className="muted small settings-workspace-path" title={config.workspaceRoot}>
              {t('settings.workspaceRootLabel')}{' '}
              <code className="settings-workspace-code">{config.workspaceRoot}</code>
            </p>
          ) : null}
          <p className="config-path settings-store-path" title={config.storePath}>
            {t('settings.storeFile')} {config.storePath}
          </p>
          <p className="muted small settings-store-key-hint">
            {t('settings.storeKeyHint')}{' '}
            <strong>
              {config.hasStoreKey ? t('settings.storeKeyOk') : t('settings.storeKeyMissing')}
            </strong>
          </p>
        </>
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
        <div className="settings-section-head">
          <h3>{t('settings.ignoredExtTitle')}</h3>
          {ignoredExts.length > 0 && (
            <Button type="button" variant="destructive" size="sm" onClick={handleClearAllIgnoredExts}>
              {t('settings.clearAllIgnoredExt')}
            </Button>
          )}
        </div>
        <p className="muted small">{t('settings.ignoredExtHint')}</p>
        <div className="row settings-ignored-ext-add">
          <input
            type="text"
            className="input"
            placeholder={t('settings.ignoredExtPlaceholder')}
            value={ignoredExtInput}
            onChange={(e) => setIgnoredExtInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleAddIgnoredExt()
              }
            }}
            aria-label={t('settings.ignoredExtPlaceholder')}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => void handleAddIgnoredExt()}>
            {t('settings.addIgnoredExt')}
          </Button>
        </div>
        <ul className="settings-list">
          {ignoredExts.map((ext) => (
            <li key={ext} className="settings-list-item">
              <span className="tag">.{ext}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleRemoveIgnoredExt(ext)}
              >
                {t('settings.removeIgnoredExt')}
              </Button>
            </li>
          ))}
        </ul>
        {ignoredExts.length === 0 && <p className="muted">{t('settings.ignoredExtEmpty')}</p>}
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>{t('settings.extensionTitle')}</h3>
          <div className="row settings-ext-head-actions">
            <Button type="button" variant="outline" size="sm" onClick={handleResetExtensions}>
              {t('settings.resetExtensions')}
            </Button>
            <Button type="button" size="sm" onClick={handleSaveExtensions}>
              {t('settings.saveExtensions')}
            </Button>
          </div>
        </div>
        <p className="muted small">{t('settings.extensionHint')}</p>
        <ul className="settings-list settings-ext-list">
          {extRows.map((row, index) => (
            <li key={`${index}:${row.ext}`} className="settings-list-item settings-ext-row">
              <input
                type="text"
                className="input settings-ext-input"
                placeholder={t('settings.extPlaceholder')}
                value={row.ext}
                onChange={(e) => {
                  const next = [...extRows]
                  next[index] = { ...row, ext: e.target.value }
                  setExtRows(next)
                }}
                aria-label={t('settings.extensionTitle')}
              />
              <select
                className="input settings-ext-select"
                value={row.kind}
                onChange={(e) => {
                  const next = [...extRows]
                  next[index] = {
                    ...row,
                    kind: e.target.value === 'image' ? 'image' : 'text'
                  }
                  setExtRows(next)
                }}
              >
                <option value="text">{t('settings.kindText')}</option>
                <option value="image">{t('settings.kindImage')}</option>
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setExtRows(extRows.filter((_, i) => i !== index))}
              >
                {t('settings.removeExtension')}
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setExtRows([...extRows, { ext: '', kind: 'text' }])}
        >
          {t('settings.addExtension')}
        </Button>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>{t('settings.logsTitle')}</h3>
          <div className="row settings-ext-head-actions">
            <Button type="button" variant="outline" size="sm" onClick={handleResetLogRules}>
              {t('settings.resetLogRules')}
            </Button>
            <Button type="button" size="sm" onClick={handleSaveLogRules}>
              {t('settings.saveLogRules')}
            </Button>
          </div>
        </div>
        <p className="muted small">{t('settings.logsHint')}</p>
        <label className="settings-checkbox-row">
          <input
            type="checkbox"
            checked={logForAllText}
            onChange={(e) => setLogForAllText(e.target.checked)}
          />
          <span>{t('settings.logForAllTextLabel')}</span>
        </label>
        <ul className="settings-list">
          {logRuleRows.map((row, index) => (
            <li key={row.id} className="settings-list-item settings-log-row">
              <input
                type="text"
                className="input settings-log-match"
                placeholder={t('settings.logMatchPlaceholder')}
                value={row.match}
                onChange={(e) => {
                  const next = [...logRuleRows]
                  next[index] = { ...row, match: e.target.value }
                  setLogRuleRows(next)
                }}
                aria-label={t('settings.logMatchPlaceholder')}
              />
              <input
                type="color"
                className="settings-log-color"
                value={/^#[0-9A-Fa-f]{6}$/.test(row.color) ? row.color : '#888888'}
                onChange={(e) => {
                  const next = [...logRuleRows]
                  next[index] = { ...row, color: e.target.value }
                  setLogRuleRows(next)
                }}
                title={t('settings.logColor')}
              />
              <input
                type="text"
                className="input settings-log-color-hex"
                value={row.color}
                onChange={(e) => {
                  const next = [...logRuleRows]
                  next[index] = { ...row, color: e.target.value }
                  setLogRuleRows(next)
                }}
                aria-label={t('settings.logColor')}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLogRuleRows(logRuleRows.filter((_, i) => i !== index))}
              >
                {t('settings.removeLogRule')}
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setLogRuleRows([
              ...logRuleRows,
              { id: crypto.randomUUID(), match: '', color: '#e8eaed' }
            ])
          }
        >
          {t('settings.addLogRule')}
        </Button>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>{t('settings.geoMapTitle')}</h3>
          <Button type="button" size="sm" onClick={() => window.api.openMapWindow()}>
            {t('settings.openMapWindow')}
          </Button>
        </div>
        <p className="muted small">{t('settings.geoMapHint')}</p>
        <ul className="settings-list">
          {geoJsonLayers.map((layer) => (
            <li key={layer.id} className="settings-list-item">
              <span className="settings-geo-path" title={layer.relativePath}>
                <span className="tag">{layer.label}</span>
                <code className="settings-geo-rel">{layer.relativePath}</code>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleRemoveGeoLayer(layer.id)}
              >
                {t('settings.removeGeoLayer')}
              </Button>
            </li>
          ))}
        </ul>
        {geoJsonLayers.length === 0 ? (
          <p className="muted">{t('settings.geoMapEmpty')}</p>
        ) : null}
      </section>

      <section className="settings-section">
        <h3>{t('settings.workspaceConfigTitle')}</h3>
        <p className="muted small">{t('settings.workspaceConfigHint')}</p>
        {config?.workspaceConfigFileRelativePath ? (
          <div className="settings-list-item settings-workspace-config-row">
            <code className="settings-geo-rel" title={config.workspaceConfigFileRelativePath}>
              {config.workspaceConfigFileRelativePath}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleClearWorkspaceConfig()}
            >
              {t('settings.workspaceConfigClear')}
            </Button>
          </div>
        ) : (
          <p className="muted">{t('settings.workspaceConfigEmpty')}</p>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>{t('settings.configFormExcludedTitle')}</h3>
          {configFormExcludedPaths.length > 0 && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void handleClearAllConfigFormExcluded()}
            >
              {t('settings.clearAllConfigFormExcluded')}
            </Button>
          )}
        </div>
        <p className="muted small">{t('settings.configFormExcludedHint')}</p>
        <div className="row settings-ignored-ext-add">
          <input
            type="text"
            className="input settings-config-excluded-input"
            placeholder={t('settings.configFormExcludedPlaceholder')}
            value={configFormExcludedInput}
            onChange={(e) => setConfigFormExcludedInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleAddConfigFormExcluded()
              }
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={t('settings.configFormExcludedPlaceholder')}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleAddConfigFormExcluded()}
          >
            {t('settings.addConfigFormExcluded')}
          </Button>
        </div>
        <ul className="settings-list">
          {configFormExcludedPaths.map((p) => (
            <li key={p} className="settings-list-item">
              <code className="settings-workspace-code" title={p}>
                {p}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleRemoveConfigFormExcluded(p)}
              >
                {t('settings.removeConfigFormExcluded')}
              </Button>
            </li>
          ))}
        </ul>
        {configFormExcludedPaths.length === 0 ? (
          <p className="muted">{t('settings.configFormExcludedEmpty')}</p>
        ) : null}
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
          <Button type="button" size="sm" onClick={handleLmdbPreview}>
            {t('settings.loadSampleKeys')}
          </Button>
        </div>
        <p className="muted small settings-lmdb-rules-intro">{t('settings.lmdbRulesIntro')}</p>
        <div className="settings-lmdb-rules-heading" role="row">
          <span className="settings-lmdb-rules-heading-path">{t('settings.lmdbRulesColumnPath')}</span>
          <span className="settings-lmdb-rules-heading-regex">{t('settings.lmdbRulesColumnRegex')}</span>
          <span className="settings-lmdb-rules-heading-actions" aria-hidden />
        </div>
        <ul className="settings-list">
          {lmdbRuleRows.map((row, index) => (
            <li key={row.id} className="settings-list-item settings-lmdb-rule-row">
              <input
                type="text"
                className="input settings-lmdb-rule-path"
                spellCheck={false}
                autoComplete="off"
                placeholder={t('settings.lmdbRulePathPlaceholder')}
                value={row.lmdbPath}
                onChange={(e) => {
                  const next = [...lmdbRuleRows]
                  next[index] = { ...row, lmdbPath: e.target.value }
                  setLmdbRuleRows(next)
                }}
                aria-label={t('settings.lmdbRulePathAria')}
              />
              <input
                type="text"
                className="input settings-lmdb-rule-regex"
                spellCheck={false}
                autoComplete="off"
                placeholder={t('settings.lmdbRuleRegexPlaceholder')}
                value={row.keyRegex}
                onChange={(e) => {
                  const next = [...lmdbRuleRows]
                  next[index] = { ...row, keyRegex: e.target.value }
                  setLmdbRuleRows(next)
                }}
                aria-label={t('settings.lmdbRuleRegexAria')}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLmdbRuleRows(lmdbRuleRows.filter((_, i) => i !== index))}
              >
                {t('settings.removeLmdbRule')}
              </Button>
            </li>
          ))}
        </ul>
        <div className="row settings-lmdb-rule-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setLmdbRuleRows([
                ...lmdbRuleRows,
                { id: crypto.randomUUID(), lmdbPath: '', keyRegex: '' }
              ])
            }
          >
            {t('settings.addLmdbRule')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleSaveLmdbSettings()}>
            {t('settings.saveLmdbSettings')}
          </Button>
        </div>
        <p className="muted small settings-lmdb-regex-hint">{t('settings.lmdbRulesHint')}</p>
        {lmdbPreview ? <pre className="lmdb-preview settings-lmdb-preview">{lmdbPreview}</pre> : null}
      </section>
    </div>
  )
}
