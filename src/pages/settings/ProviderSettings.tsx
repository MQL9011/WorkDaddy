import { ChevronRight, ExternalLink, Gauge, RefreshCw, Search, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import type { HarnessId, PrimeModelCatalog, PrimeModelDescriptor } from '@/types/api'
import { HARNESS_AGENT_NAMES } from '@/lib/harness'
import { useI18n } from '@/lib/i18n'

interface ProviderSettingsProps {
  /** Active harness. OMP credentials stay CLI-owned; visibility toggles only affect WorkDaddy. */
  harness?: HarnessId
  catalog: PrimeModelCatalog | null
  onRefresh(): Promise<void>
  onSetEnabled(providerId: string, enabled: boolean): Promise<void>
  onSetAllEnabled(): Promise<void>
  onSetAllDisabled(): Promise<void>
  onSetModelEnabled(modelKey: string, enabled: boolean): Promise<void>
  onOpenDocs(): void
}

function activeFirst<T extends { enabled?: boolean }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => Number(right.enabled !== false) - Number(left.enabled !== false))
}

export function ProviderSettings({ harness = 'omp', catalog, onRefresh, onSetEnabled, onSetAllEnabled, onSetAllDisabled, onSetModelEnabled, onOpenDocs }: ProviderSettingsProps) {
  const { t } = useI18n()
  const agentName = HARNESS_AGENT_NAMES[harness]
  const [view, setView] = useState<'providers' | 'models'>('providers')
  const [query, setQuery] = useState('')
  const [busyProvider, setBusyProvider] = useState<string | null>(null)
  const [collapsedModelProviders, setCollapsedModelProviders] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState('')
  const providers = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const matches = normalized
      ? (catalog?.providers ?? []).filter((provider) => `${provider.name} ${provider.id}`.toLowerCase().includes(normalized))
      : catalog?.providers ?? []
    return activeFirst(matches)
  }, [catalog, query])
  const providerNames = useMemo(() => new Map((catalog?.providers ?? []).map((provider) => [provider.id, provider.name])), [catalog])
  const modelGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const matches = normalized
      ? (catalog?.models ?? []).filter((model) => `${model.name} ${model.id} ${model.provider} ${providerNames.get(model.provider) ?? ''}`.toLowerCase().includes(normalized))
      : catalog?.models ?? []
    const byProvider = new Map<string, PrimeModelDescriptor[]>()
    for (const model of matches) {
      const models = byProvider.get(model.provider)
      if (models) models.push(model)
      else byProvider.set(model.provider, [model])
    }
    const orderedProviders = activeFirst(catalog?.providers ?? [])
    const groups = orderedProviders.flatMap((provider) => {
      const models = byProvider.get(provider.id)
      if (!models?.length) return []
      byProvider.delete(provider.id)
      return [{ provider, models: activeFirst(models) }]
    })
    for (const [providerId, models] of byProvider) {
      groups.push({
        provider: { id: providerId, name: providerNames.get(providerId) ?? providerId, authMethod: 'external', configured: false, modelCount: models.length, availableModelCount: 0, enabled: models.some((model) => model.enabled !== false) },
        models: activeFirst(models),
      })
    }
    return groups
  }, [catalog, providerNames, query])

  const run = async (providerId: string, action: () => Promise<void>) => {
    setBusyProvider(providerId); setError('')
    try { await action() } catch (failure) { setError(errorMessage(failure)) } finally { setBusyProvider(null) }
  }

  const toggleModelProvider = (providerId: string) => setCollapsedModelProviders((current) => {
    const next = new Set(current)
    if (next.has(providerId)) next.delete(providerId)
    else next.add(providerId)
    return next
  })
  const enableAll = () => run('enable-all', onSetAllEnabled)
  const disableAll = () => run('disable-all', onSetAllDisabled)

  const providerCount = catalog?.providers.length ?? 0
  const modelCount = catalog?.models.length ?? 0
  const availableModelCount = catalog?.models.filter((model) => model.available && model.enabled !== false).length ?? 0
  const disabledCount = catalog?.providers.filter((provider) => !provider.enabled).length ?? 0

  return (
    <section className="settings-group provider-settings">
      <div className="settings-group__heading"><h2>{t('settings.providerPage.catalogTitle', { agent: agentName })}</h2><div className="provider-heading-actions">{catalog && disabledCount < providerCount ? <button type="button" className="button button--danger" disabled={Boolean(busyProvider)} onClick={() => void disableAll()}>{t('settings.providerPage.hideAll')}</button> : null}{disabledCount ? <button type="button" className="button" disabled={Boolean(busyProvider)} onClick={() => void enableAll()}>{t('settings.providerPage.showAll')}</button> : null}<button type="button" className="button button--icon" aria-label={t('settings.providerPage.refreshAria')} disabled={Boolean(busyProvider)} onClick={() => void run('refresh', onRefresh)}><RefreshCw size={13} /></button></div></div>
      <div className="provider-catalog-summary"><strong>{catalog ? t('settings.providerPage.summary.counts', { providers: providerCount.toLocaleString(), models: modelCount.toLocaleString() }) : t('settings.providerPage.summary.loading')}</strong>{catalog ? <small>{t('settings.providerPage.summary.detail', { count: availableModelCount.toLocaleString(), agent: agentName })}</small> : null}</div>
      {catalog?.warning ? <p className="provider-catalog-warning" role="status">{catalog.warning}</p> : null}
      <div className="provider-catalog-tabs" role="tablist" aria-label={t('settings.providerPage.tabsAria')}>
        <button type="button" role="tab" aria-selected={view === 'providers'} className={view === 'providers' ? 'is-active' : ''} onClick={() => { setView('providers'); setQuery('') }}>{t('settings.providers')} <span>{providerCount.toLocaleString()}</span></button>
        <button type="button" role="tab" aria-selected={view === 'models'} className={view === 'models' ? 'is-active' : ''} onClick={() => { setView('models'); setQuery('') }}>{t('settings.providerPage.modelsTab')} <span>{modelCount.toLocaleString()}</span></button>
      </div>
      <label className="provider-search"><Search size={13} /><input value={query} placeholder={view === 'providers' ? t('settings.providerPage.searchProviders') : t('settings.providerPage.searchModels')} aria-label={view === 'providers' ? t('settings.providerPage.searchProviders') : t('settings.providerPage.searchModels')} onChange={(event) => setQuery(event.target.value)} /></label>
      {error ? <p className="settings-error" role="alert">{error}</p> : null}
      {view === 'providers' ? <div className="provider-list">
        {providers.map((provider) => {
          const busy = busyProvider === provider.id
          return <div className="provider-row" key={provider.id}>
            <label className="provider-row__toggle" title={provider.enabled ? t('settings.providerPage.hideProviderIn', { agent: agentName }) : t('settings.providerPage.showProviderIn', { agent: agentName })}><input type="checkbox" aria-label={t('settings.providerPage.showProviderAria', { name: provider.name })} checked={provider.enabled} disabled={busy} onChange={(event) => void run(provider.id, () => onSetEnabled(provider.id, event.target.checked))} /><i aria-hidden="true"><span /></i></label>
            <div className="provider-row__identity"><strong>{provider.name}</strong><small>{t('settings.providerPage.providerModelsSummary', { authLabel: provider.authLabel ?? t('settings.providerPage.credentialsManagedBy', { harness }), count: provider.availableModelCount.toLocaleString() })}</small></div>
            <div className="provider-row__actions"><button type="button" className="button" onClick={onOpenDocs}><ExternalLink size={13} /> {t('settings.providerPage.credentialSetup')}</button></div>
          </div>
        })}
      </div> : <div className="provider-list provider-model-list">
        {modelGroups.map(({ provider, models }) => {
          const collapsed = collapsedModelProviders.has(provider.id)
          const contentId = `provider-models-${provider.id.replace(/[^a-z0-9_-]/gi, '-')}`
          return <div className={`provider-model-group${provider.enabled ? '' : ' is-disabled'}${collapsed ? ' is-collapsed' : ''}`} key={provider.id}>
          <button type="button" className="provider-model-group__heading" aria-expanded={!collapsed} aria-controls={contentId} onClick={() => toggleModelProvider(provider.id)}><strong>{provider.name}</strong><small>{t('settings.providerPage.modelsOnCount', { on: models.filter((model) => model.enabled !== false).length.toLocaleString(), total: models.length.toLocaleString() })}</small><ChevronRight className="provider-model-group__chevron" size={13} aria-hidden="true" /></button>
          <div id={contentId} className="provider-model-group__models" hidden={collapsed}>{models.map((model) => <div className={`provider-model-row${model.enabled === false ? ' is-disabled' : ''}`} key={model.key}>
            <div className="provider-row__identity"><strong>{model.name}</strong><small>{model.id}</small></div>
            <div className="provider-model-row__capabilities">
              {model.reasoning ? <span title={t('settings.providerPage.reasoningLevels', { count: model.availableThinkingLevels.length })}><Gauge size={11} /> {t('settings.providerPage.reasoning')}</span> : null}
              {model.fastModeSupported ? <span><Zap size={11} /> {t('settings.providerPage.fast')}</span> : null}
              <span className={model.available && model.enabled !== false ? 'is-available' : ''}>{model.enabled === false ? t('settings.providerPage.hidden') : t('settings.providerPage.shown')}</span>
            </div>
            <label className="provider-row__toggle provider-model-row__toggle" title={model.enabled === false ? t('settings.providerPage.showModelIn', { agent: agentName }) : t('settings.providerPage.hideModelIn', { agent: agentName })}><input type="checkbox" aria-label={t('settings.providerPage.showModelAria', { name: model.name })} checked={model.enabled !== false} disabled={busyProvider === `model:${model.key}`} onChange={(event) => void run(`model:${model.key}`, () => onSetModelEnabled(model.key, event.target.checked))} /><i aria-hidden="true"><span /></i></label>
          </div>)}</div>
        </div>})}
      </div>}
      {catalog && view === 'providers' && !providers.length ? <p className="settings-empty">{t('settings.providerPage.noProvidersMatch')}</p> : null}
      {catalog && view === 'models' && !modelGroups.length ? <p className="settings-empty">{t('settings.providerPage.noModelsMatch')}</p> : null}
    </section>
  )
}

const PROVIDERS_PAGE_INTRO_KEYS: Record<HarnessId, 'settings.providerPage.intro.omp'> = {
  omp: 'settings.providerPage.intro.omp',
}

/** The Providers settings page: heading plus the provider/model catalog section. */
export function ProvidersSettings(props: ProviderSettingsProps) {
  const { t } = useI18n()
  return (
    <>
      <header><h1>{t('settings.providers')}</h1><p>{t(PROVIDERS_PAGE_INTRO_KEYS[props.harness ?? 'omp'])}</p></header>
      <ProviderSettings {...props} />
    </>
  )
}
