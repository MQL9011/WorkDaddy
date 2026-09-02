import { useMemo, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import type { DiscoveredModel, DiscoverOmpModelsInput, OmpModelDraft, OmpProviderRow, SaveOmpProviderDraft } from '@/types/api'
import { apiKeyFailure } from './apiKey'
import { ModelListEditor } from './ModelListEditor'

interface ProviderEditorProps {
  row: OmpProviderRow
  inheritedModels: readonly OmpModelDraft[]
  setup?: boolean
  onSave(draft: SaveOmpProviderDraft): Promise<void>
  onDiscover(input: DiscoverOmpModelsInput): Promise<readonly DiscoveredModel[]>
  onClose(changed: boolean): void
}

export function ProviderEditor({ row, inheritedModels, setup = false, onSave, onDiscover, onClose }: ProviderEditorProps) {
  const { t } = useI18n()
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(row.baseUrl ?? '')
  const [customized, setCustomized] = useState(false)
  const [overridden, setOverridden] = useState(row.modelsOverridden)
  const [models, setModels] = useState<OmpModelDraft[]>(() => row.modelsOverridden ? row.models.map((model) => ({ ...model })) : inheritedModels.map((model) => ({ ...model })))
  const [busy, setBusy] = useState(false)
  const [fetchBusy, setFetchBusy] = useState(false)
  const [error, setError] = useState('')
  const [fetchError, setFetchError] = useState('')
  const [saved, setSaved] = useState(false)

  const keyRequired = Boolean(setup) && !row.configured && !row.keylessAuth
  const keyError = apiKeyFailure(apiKey, keyRequired)

  const validateModels = (): string => {
    const seen = new Set<string>()
    for (const model of models) {
      if (!model.id.trim()) return t('settings.modelsPage.modelIdRequired')
      if (seen.has(model.id.trim())) return t('settings.modelsPage.modelIdDuplicate')
      seen.add(model.id.trim())
      if (model.name !== undefined && !model.name.trim()) return t('settings.modelsPage.modelNameInvalid')
    }
    return ''
  }

  const apply = async () => {
    if (keyError) {
      setError(t(keyError === 'keyBlank' ? (row.kind === 'custom' && !setup ? 'settings.modelsPage.keyBlankNew' : 'settings.modelsPage.keyBlank') : 'settings.modelsPage.keyIllegalCharacters'))
      return
    }
    const modelsError = overridden ? validateModels() : ''
    if (modelsError) {
      setError(modelsError)
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSave({
        providerId: row.id,
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        models: overridden ? models.map((model) => ({
          id: model.id.trim(),
          name: model.name?.trim() || undefined,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
        })) : undefined,
        resetModels: row.modelsOverridden && !overridden,
      })
      setSaved(true)
      onClose(true)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const fetchModels = async (): Promise<readonly DiscoveredModel[]> => {
    if (!baseUrl.trim()) {
      setFetchError(t('settings.modelsPage.fetchNeedsBaseUrl'))
      return []
    }
    setFetchBusy(true)
    setFetchError('')
    try {
      const found = await onDiscover({ providerId: row.id, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined })
      if (!overridden) setOverridden(true)
      return found
    } catch (failure) {
      setFetchError(errorMessage(failure))
      return []
    } finally {
      setFetchBusy(false)
    }
  }

  const heading = useMemo(() => setup ? row.displayName : t('settings.modelsPage.editProvider', { provider: row.displayName }), [row.displayName, setup, t])

  return (
    <div className="models-card">
      <div className="models-card__header">
        <strong>{heading}</strong>
        <button type="button" className="button" disabled={busy} onClick={() => onClose(false)}>{t('settings.modelsPage.close')}</button>
      </div>
      <label className="models-card__field">
        <span>{t('settings.modelsPage.keyInput')}</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder={row.configured ? t('settings.modelsPage.keyStored') : row.kind === 'custom' ? t('settings.modelsPage.keyPlaceholderNative') : t('settings.modelsPage.keyPlaceholder')}
          disabled={busy}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <button type="button" className={`models-card__fold${customized ? ' is-open' : ''}`} onClick={() => setCustomized((current) => !current)}>
        {t('settings.modelsPage.customized')}
      </button>
      {customized ? (
        <div className="models-card__custom">
          <label className="models-card__field">
            <span>{t('settings.modelsPage.baseUrl')}</span>
            <input value={baseUrl} disabled={busy} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <span className="models-card__label">{t('settings.modelsPage.models')}</span>
          <ModelListEditor
            models={models}
            overridden={overridden}
            disabled={busy}
            fetchBusy={fetchBusy}
            fetchError={fetchError}
            canFetch={Boolean(baseUrl.trim())}
            onChange={(next) => { setOverridden(true); setModels(next) }}
            onReset={() => { setOverridden(false); setModels(inheritedModels.map((model) => ({ ...model }))) }}
            onFetch={fetchModels}
          />
        </div>
      ) : null}
      {error ? <p className="settings-error" role="alert">{error}</p> : null}
      {saved ? <p className="models-card__status" role="status">{t('settings.modelsPage.savedProvider', { provider: row.displayName })}</p> : null}
      <div className="models-card__actions">
        <button type="button" className="button" disabled={busy} onClick={() => onClose(false)}>{t('common.cancel')}</button>
        <button type="button" className="button button--primary" disabled={busy} onClick={() => void apply()}>
          {busy ? t('settings.modelsPage.applying') : t('settings.modelsPage.apply')}
        </button>
      </div>
    </div>
  )
}
