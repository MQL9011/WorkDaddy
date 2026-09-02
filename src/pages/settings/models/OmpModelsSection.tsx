import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Modal } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import type {
  CreateOmpProviderDraft,
  DiscoveredModel,
  DiscoverOmpModelsInput,
  OmpCatalogProviderOption,
  OmpModelDraft,
  OmpModelsSnapshot,
  OmpProviderRow,
  PrimeModelCatalog,
  SaveOmpProviderDraft,
} from '@/types/api'
import { CustomProviderCard } from './CustomProviderCard'
import { ProviderEditor } from './ProviderEditor'

interface OmpModelsSectionProps {
  catalog: PrimeModelCatalog | null
  onRefresh(): Promise<void>
  onList(): Promise<OmpModelsSnapshot>
  onSave(draft: SaveOmpProviderDraft): Promise<OmpModelsSnapshot>
  onCreate(draft: CreateOmpProviderDraft): Promise<OmpModelsSnapshot>
  onDelete(providerId: string): Promise<OmpModelsSnapshot>
  onDiscover(input: DiscoverOmpModelsInput): Promise<readonly DiscoveredModel[]>
}

function rowUsable(row: OmpProviderRow): boolean {
  return row.configured || row.keylessAuth
}

export function OmpModelsSection({ catalog, onRefresh, onList, onSave, onCreate, onDelete, onDiscover }: OmpModelsSectionProps) {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState<OmpModelsSnapshot | null>(null)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState<string | undefined>()
  const [addingCustom, setAddingCustom] = useState(false)
  const [addingCatalog, setAddingCatalog] = useState<OmpCatalogProviderOption | undefined>()
  const [pickingCatalog, setPickingCatalog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<OmpProviderRow | undefined>()
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [status, setStatus] = useState('')

  const load = async () => {
    try {
      setLoadError('')
      setSnapshot(await onList())
    } catch (failure) {
      setLoadError(errorMessage(failure) || t('settings.modelsPage.loadFailed'))
    }
  }

  useEffect(() => { void load() }, [])

  const rows = snapshot?.rows ?? []
  const availableCatalog = snapshot?.availableCatalog ?? []
  const inheritedByProvider = useMemo(() => {
    const map = new Map<string, OmpModelDraft[]>()
    for (const model of catalog?.models ?? []) {
      const drafts = map.get(model.provider) ?? []
      drafts.push({ id: model.id, name: model.name, contextWindow: model.contextWindow || undefined, maxTokens: model.maxTokens || undefined })
      map.set(model.provider, drafts)
    }
    return map
  }, [catalog])

  const taken = useMemo(() => new Set(rows.map((row) => row.id)), [rows])

  const persist = async (action: () => Promise<OmpModelsSnapshot>, message?: string) => {
    const next = await action()
    setSnapshot(next)
    await onRefresh()
    if (message) setStatus(message)
    return next
  }

  const closeEditor = (changed: boolean, provider?: string) => {
    setEditing(undefined)
    setAddingCustom(false)
    setAddingCatalog(undefined)
    if (changed && provider) setStatus(t('settings.modelsPage.savedProvider', { provider }))
    if (changed) void load()
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      await persist(() => onDelete(deleteTarget.id))
      setDeleteTarget(undefined)
    } catch (failure) {
      setDeleteError(errorMessage(failure))
    } finally {
      setDeleting(false)
    }
  }

  const catalogDraftRow = (option: OmpCatalogProviderOption): OmpProviderRow => ({
    id: option.id,
    displayName: option.displayName,
    kind: 'catalog',
    configured: false,
    keylessAuth: false,
    removable: true,
    modelsOverridden: false,
    models: [],
  })

  const showAddActions = !addingCatalog && !addingCustom && !editing

  return (
    <section className="settings-group models-settings">
      <div className="settings-group__heading">
        <h2>{t('settings.modelsPage.groupTitle')}</h2>
        {showAddActions ? (
          <div className="provider-heading-actions">
            <button
              type="button"
              className="button button--compact"
              disabled={!availableCatalog.length}
              onClick={() => setPickingCatalog(true)}
            >
              {t('settings.modelsPage.catalogAdd')}
            </button>
            <button
              type="button"
              className="button button--compact"
              onClick={() => { setEditing(undefined); setAddingCustom(true) }}
            >
              {t('settings.modelsPage.customAdd')}
            </button>
          </div>
        ) : null}
      </div>
      {loadError ? <p className="settings-error" role="alert">{loadError}</p> : null}
      {status ? <p className="models-card__status" role="status">{status}</p> : null}
      {!rows.length && !addingCatalog && !addingCustom ? (
        <p className="models-empty">{t('settings.modelsPage.empty')}</p>
      ) : null}
      <div className="models-rows">
        {rows.map((row) => {
          if (editing === row.id) {
            return (
              <ProviderEditor
                key={`${row.id}-edit`}
                row={row}
                inheritedModels={inheritedByProvider.get(row.id) ?? []}
                onSave={(draft) => persist(() => onSave(draft)).then(() => undefined)}
                onDiscover={onDiscover}
                onClose={(changed) => closeEditor(changed, row.displayName)}
              />
            )
          }
          return (
            <div className="models-row" key={row.id}>
              <span className={`models-row__dot${rowUsable(row) ? ' is-ok' : ' is-missing'}`} title={rowUsable(row) ? t('settings.modelsPage.credentialConfigured') : t('settings.modelsPage.credentialMissing')} />
              <div className="models-row__identity">
                <strong>{row.displayName}</strong>
                <small>{row.kind === 'custom' ? t('settings.modelsPage.customTag') : row.id}</small>
              </div>
              <div className="models-row__actions">
                <button type="button" className="button" disabled={addingCustom || Boolean(addingCatalog)} onClick={() => { setAddingCustom(false); setAddingCatalog(undefined); setEditing(row.id) }}>{t('settings.modelsPage.edit')}</button>
                {row.removable ? (
                  <button type="button" className="button" disabled={addingCustom || Boolean(addingCatalog) || Boolean(editing)} onClick={() => { setDeleteError(''); setDeleteTarget(row) }}>{t('settings.modelsPage.remove')}</button>
                ) : null}
              </div>
            </div>
          )
        })}
        {addingCatalog ? (
          <ProviderEditor
            key={`${addingCatalog.id}-add`}
            row={catalogDraftRow(addingCatalog)}
            inheritedModels={inheritedByProvider.get(addingCatalog.id) ?? []}
            setup
            onSave={(draft) => persist(() => onSave(draft), t('settings.modelsPage.savedProvider', { provider: addingCatalog.displayName })).then(() => undefined)}
            onDiscover={onDiscover}
            onClose={(changed) => closeEditor(changed, addingCatalog.displayName)}
          />
        ) : null}
        {addingCustom ? (
          <CustomProviderCard
            taken={taken}
            onCreate={(draft) => persist(() => onCreate(draft)).then(() => undefined)}
            onDiscover={onDiscover}
            onClose={(changed) => closeEditor(changed)}
          />
        ) : null}
      </div>

      {pickingCatalog ? (
        <Modal
          title={t('settings.modelsPage.catalogPickTitle')}
          onClose={() => setPickingCatalog(false)}
        >
          <p className="modal-intro">{t('settings.modelsPage.catalogPickDescription')}</p>
          <div className="models-catalog-pick">
            {availableCatalog.map((option) => (
              <button
                key={option.id}
                type="button"
                className="models-catalog-pick__item"
                aria-label={option.displayName}
                onClick={() => {
                  setPickingCatalog(false)
                  setAddingCatalog(option)
                }}
              >
                <span className="models-catalog-pick__identity">
                  <strong>{option.displayName}</strong>
                  <small>{option.id}</small>
                </span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        </Modal>
      ) : null}

      {deleteTarget ? (
        <Modal
          title={t('settings.modelsPage.deleteTitle', { provider: deleteTarget.displayName })}
          onClose={() => { if (!deleting) setDeleteTarget(undefined) }}
          footer={(
            <>
              <button type="button" className="button" disabled={deleting} onClick={() => setDeleteTarget(undefined)}>{t('common.cancel')}</button>
              <button type="button" className="button button--danger" disabled={deleting} onClick={() => void confirmDelete()}>
                {deleting ? t('settings.modelsPage.deleting', { provider: deleteTarget.displayName }) : t('settings.modelsPage.deleteConfirm', { provider: deleteTarget.displayName })}
              </button>
            </>
          )}
        >
          <p>{deleteTarget.configured ? t('settings.modelsPage.deleteDescriptionWithCredential', { provider: deleteTarget.displayName }) : t('settings.modelsPage.deleteDescription', { provider: deleteTarget.displayName })}</p>
          {deleteError ? <p className="settings-error" role="alert">{deleteError}</p> : null}
        </Modal>
      ) : null}
    </section>
  )
}
