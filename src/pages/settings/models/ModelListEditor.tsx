import { useState } from 'react'
import { Modal } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import type { DiscoveredModel, OmpModelDraft } from '@/types/api'
import { formatCapacity, parseCapacity } from './capacity'

interface ModelListEditorProps {
  models: readonly OmpModelDraft[]
  overridden: boolean
  disabled: boolean
  fetchBusy: boolean
  fetchError: string
  canFetch: boolean
  onChange(models: OmpModelDraft[]): void
  onReset(): void
  onFetch(): Promise<readonly DiscoveredModel[]>
}

export function ModelListEditor({
  models, overridden, disabled, fetchBusy, fetchError, canFetch, onChange, onReset, onFetch,
}: ModelListEditorProps) {
  const { t } = useI18n()
  const [candidates, setCandidates] = useState<readonly DiscoveredModel[] | undefined>()
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())

  const runFetch = async () => {
    const found = await onFetch()
    const known = new Set(models.map((model) => model.id))
    setCandidates(found)
    setPicked(new Set(found.filter((model) => !known.has(model.id)).map((model) => model.id)))
  }

  const adoptPicked = () => {
    if (!candidates) return
    const adopted = candidates.filter((candidate) => picked.has(candidate.id)).map((candidate) => ({
      id: candidate.id,
      name: candidate.name === candidate.id ? undefined : candidate.name,
    }))
    const known = new Set(models.map((model) => model.id))
    onChange([...models, ...adopted.filter((model) => !known.has(model.id))])
    setCandidates(undefined)
    setPicked(new Set())
  }

  const update = (index: number, patch: Partial<OmpModelDraft>) => {
    onChange(models.map((model, current) => current === index ? { ...model, ...patch } : model))
  }

  const allPicked = Boolean(candidates?.length && candidates.every((candidate) => picked.has(candidate.id)))

  return (
    <div className="models-editor">
      <div className="models-editor__heading">
        <span>{overridden ? t('settings.modelsPage.modelsCustomized') : t('settings.modelsPage.modelsInherited')}</span>
        <div className="models-editor__heading-actions">
          {overridden ? <button type="button" className="button" disabled={disabled} onClick={onReset}>{t('settings.modelsPage.resetModels')}</button> : null}
          <button type="button" className="button" disabled={disabled || fetchBusy || !canFetch} onClick={() => void runFetch()}>
            {fetchBusy ? t('settings.modelsPage.fetching') : t('settings.modelsPage.fetchModels')}
          </button>
        </div>
      </div>
      {fetchError ? <p className="settings-error" role="alert">{fetchError}</p> : null}
      {models.length === 0 ? <p className="models-editor__empty">{t('settings.modelsPage.modelsEmpty')}</p> : null}
      {models.map((model, index) => {
        const open = expanded.has(index)
        return (
          <div className="models-editor__row" key={`${model.id}-${index}`}>
            <label>
              <span>{t('settings.modelsPage.modelId')}</span>
              <input value={model.id} disabled={disabled} onChange={(event) => update(index, { id: event.target.value })} />
            </label>
            <label>
              <span>{t('settings.modelsPage.modelName')}</span>
              <input value={model.name ?? ''} placeholder={t('settings.modelsPage.modelNamePlaceholder')} disabled={disabled} onChange={(event) => update(index, { name: event.target.value || undefined })} />
            </label>
            <button type="button" className="button" disabled={disabled} onClick={() => setExpanded((current) => {
              const next = new Set(current)
              if (next.has(index)) next.delete(index)
              else next.add(index)
              return next
            })}>{t('settings.modelsPage.modelAdvanced')}</button>
            <button type="button" className="button" disabled={disabled} aria-label={t('settings.modelsPage.removeModel')} onClick={() => onChange(models.filter((_, current) => current !== index))}>{t('settings.modelsPage.removeModel')}</button>
            {open ? (
              <div className="models-editor__advanced">
                <label>
                  <span>{t('settings.modelsPage.contextWindow')}</span>
                  <input value={model.contextWindow ? formatCapacity(model.contextWindow) : ''} placeholder={t('settings.modelsPage.capacityPlaceholder')} disabled={disabled} onChange={(event) => {
                    const parsed = parseCapacity(event.target.value)
                    update(index, { contextWindow: parsed === undefined || Number.isNaN(parsed) ? undefined : parsed })
                  }} />
                </label>
                <label>
                  <span>{t('settings.modelsPage.maxTokens')}</span>
                  <input value={model.maxTokens ? formatCapacity(model.maxTokens) : ''} placeholder={t('settings.modelsPage.capacityPlaceholder')} disabled={disabled} onChange={(event) => {
                    const parsed = parseCapacity(event.target.value)
                    update(index, { maxTokens: parsed === undefined || Number.isNaN(parsed) ? undefined : parsed })
                  }} />
                </label>
              </div>
            ) : null}
          </div>
        )
      })}
      <button type="button" className="button" disabled={disabled} onClick={() => onChange([...models, { id: '' }])}>{t('settings.modelsPage.addModel')}</button>

      {candidates ? (
        <Modal
          title={t('settings.modelsPage.fetchTitle')}
          onClose={() => { setCandidates(undefined); setPicked(new Set()) }}
          footer={(
            <>
              <button type="button" className="button" onClick={() => { setCandidates(undefined); setPicked(new Set()) }}>{t('common.cancel')}</button>
              <button type="button" className="button button--primary" disabled={picked.size === 0} onClick={adoptPicked}>{t('settings.modelsPage.fetchAdopt')}</button>
            </>
          )}
        >
          <p>{t('settings.modelsPage.fetchDescription')}</p>
          {candidates.length === 0 ? <p>{t('settings.modelsPage.fetchEmpty')}</p> : (
            <>
              <button type="button" className="button" onClick={() => setPicked(allPicked ? new Set() : new Set(candidates.map((candidate) => candidate.id)))}>
                {t(allPicked ? 'settings.modelsPage.fetchDeselectAll' : 'settings.modelsPage.fetchSelectAll')}
              </button>
              <ul className="models-fetch-list">
                {candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={picked.has(candidate.id)}
                        onChange={() => setPicked((current) => {
                          const next = new Set(current)
                          if (next.has(candidate.id)) next.delete(candidate.id)
                          else next.add(candidate.id)
                          return next
                        })}
                      />
                      <strong>{candidate.name}</strong>
                      <small>{candidate.id}</small>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Modal>
      ) : null}
    </div>
  )
}
