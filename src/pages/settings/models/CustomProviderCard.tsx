import { useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import type { CreateOmpProviderDraft, DiscoveredModel, DiscoverOmpModelsInput, OmpDiscoverableApi, OmpModelDraft } from '@/types/api'
import { apiKeyFailure } from './apiKey'
import { ModelListEditor } from './ModelListEditor'

const APIS: OmpDiscoverableApi[] = ['openai-completions', 'openai-responses']
const ROUTE_PATTERN = /^[a-z][a-z0-9-]*$/

interface CustomProviderCardProps {
  taken: ReadonlySet<string>
  onCreate(draft: CreateOmpProviderDraft): Promise<void>
  onDiscover(input: DiscoverOmpModelsInput): Promise<readonly DiscoveredModel[]>
  onClose(changed: boolean): void
}

export function CustomProviderCard({ taken, onCreate, onDiscover, onClose }: CustomProviderCardProps) {
  const { t } = useI18n()
  const [id, setId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [api, setApi] = useState<OmpDiscoverableApi>('openai-completions')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<OmpModelDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [fetchBusy, setFetchBusy] = useState(false)
  const [error, setError] = useState('')
  const [fetchError, setFetchError] = useState('')

  const create = async () => {
    if (!ROUTE_PATTERN.test(id.trim())) {
      setError(t('settings.modelsPage.customRouteInvalid'))
      return
    }
    if (taken.has(id.trim())) {
      setError(t('settings.modelsPage.customRouteTaken'))
      return
    }
    if (!baseUrl.trim()) {
      setError(t('settings.modelsPage.customNeedsBaseUrl'))
      return
    }
    if (models.length === 0 || models.some((model) => !model.id.trim())) {
      setError(t('settings.modelsPage.customNeedsModels'))
      return
    }
    const keyError = apiKeyFailure(apiKey, false)
    if (keyError) {
      setError(t(keyError === 'keyBlank' ? 'settings.modelsPage.keyBlankNew' : 'settings.modelsPage.keyIllegalCharacters'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await onCreate({
        id: id.trim(),
        displayName: displayName.trim() || undefined,
        baseUrl: baseUrl.trim(),
        api,
        apiKey: apiKey.trim() || undefined,
        models: models.map((model) => ({
          id: model.id.trim(),
          name: model.name?.trim() || undefined,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
        })),
      })
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
      return await onDiscover({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined })
    } catch (failure) {
      setFetchError(errorMessage(failure))
      return []
    } finally {
      setFetchBusy(false)
    }
  }

  return (
    <div className="models-card">
      <div className="models-card__header">
        <strong>{t('settings.modelsPage.customTitle')}</strong>
        <button type="button" className="button" disabled={busy} onClick={() => onClose(false)}>{t('settings.modelsPage.close')}</button>
      </div>
      <label className="models-card__field">
        <span>{t('settings.modelsPage.customRoute')}</span>
        <input value={id} disabled={busy} onChange={(event) => setId(event.target.value)} />
        <small>{t('settings.modelsPage.customRouteHint')}</small>
      </label>
      <label className="models-card__field">
        <span>{t('settings.modelsPage.customDisplayName')}</span>
        <input value={displayName} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label className="models-card__field">
        <span>{t('settings.modelsPage.baseUrl')}</span>
        <input value={baseUrl} placeholder={t('settings.modelsPage.customBaseUrlPlaceholder')} disabled={busy} onChange={(event) => setBaseUrl(event.target.value)} />
      </label>
      <label className="models-card__field">
        <span>{t('settings.modelsPage.customApi')}</span>
        <select value={api} disabled={busy} onChange={(event) => setApi(event.target.value as OmpDiscoverableApi)}>
          {APIS.map((value) => (
            <option key={value} value={value}>{value === 'openai-completions' ? t('settings.modelsPage.customApiOpenaiCompletions') : t('settings.modelsPage.customApiOpenaiResponses')}</option>
          ))}
        </select>
      </label>
      <label className="models-card__field">
        <span>{t('settings.modelsPage.keyInput')}</span>
        <input type="password" autoComplete="off" spellCheck={false} value={apiKey} placeholder={t('settings.modelsPage.keyPlaceholderNative')} disabled={busy} onChange={(event) => setApiKey(event.target.value)} />
      </label>
      <span className="models-card__label">{t('settings.modelsPage.models')}</span>
      <ModelListEditor
        models={models}
        overridden
        disabled={busy}
        fetchBusy={fetchBusy}
        fetchError={fetchError}
        canFetch={Boolean(baseUrl.trim())}
        onChange={setModels}
        onReset={() => setModels([])}
        onFetch={fetchModels}
      />
      {error ? <p className="settings-error" role="alert">{error}</p> : null}
      <div className="models-card__actions">
        <button type="button" className="button" disabled={busy} onClick={() => onClose(false)}>{t('common.cancel')}</button>
        <button type="button" className="button button--primary" disabled={busy} onClick={() => void create()}>
          {busy ? t('settings.modelsPage.creating') : t('settings.modelsPage.create')}
        </button>
      </div>
    </div>
  )
}
