import type { CreateOmpProviderDraft, DiscoveredModel, DiscoverOmpModelsInput, HarnessId, OmpModelsSnapshot, PrimeModelCatalog, SaveOmpProviderDraft } from '@/types/api'
import { useI18n } from '@/lib/i18n'
import { OmpModelsSection } from './models/OmpModelsSection'

interface ProviderSettingsProps {
  harness?: HarnessId
  catalog: PrimeModelCatalog | null
  onRefresh(): Promise<void>
  onSetEnabled(providerId: string, enabled: boolean): Promise<void>
  onSetAllEnabled(): Promise<void>
  onSetAllDisabled(): Promise<void>
  onSetModelEnabled(modelKey: string, enabled: boolean): Promise<void>
  onListModelProviders(): Promise<OmpModelsSnapshot>
  onSaveProvider(draft: SaveOmpProviderDraft): Promise<OmpModelsSnapshot>
  onCreateCustomProvider(draft: CreateOmpProviderDraft): Promise<OmpModelsSnapshot>
  onDeleteCustomProvider(providerId: string): Promise<OmpModelsSnapshot>
  onDiscoverModels(input: DiscoverOmpModelsInput): Promise<readonly DiscoveredModel[]>
  onOpenDocs(): void
}

export function ProviderSettings({
  catalog,
  onRefresh,
  onListModelProviders,
  onSaveProvider,
  onCreateCustomProvider,
  onDeleteCustomProvider,
  onDiscoverModels,
}: ProviderSettingsProps) {
  return (
    <OmpModelsSection
      catalog={catalog}
      onRefresh={onRefresh}
      onList={onListModelProviders}
      onSave={onSaveProvider}
      onCreate={onCreateCustomProvider}
      onDelete={onDeleteCustomProvider}
      onDiscover={onDiscoverModels}
    />
  )
}

/** The Models settings page: heading plus the provider editor. */
export function ProvidersSettings(props: ProviderSettingsProps) {
  const { t } = useI18n()
  return (
    <>
      <header><h1>{t('settings.models')}</h1><p>{t('settings.modelsPage.intro')}</p></header>
      <ProviderSettings {...props} />
    </>
  )
}
