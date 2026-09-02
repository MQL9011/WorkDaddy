import { AlertTriangle, Check, Download, FolderOpen, KeyRound, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n, type MessageKey } from '@/lib/i18n'
import type {
  AppMeta,
  AppSettings,
  InstalledOmp,
  OmpApprovalMode,
  OmpCatalogProviderOption,
  OmpInstallPhase,
  OmpModelsSnapshot,
  ProjectRecord,
  SaveOmpProviderDraft,
} from '@/types/api'
import { useFocusTrap } from '../ui'

type WizardStep = 'welcome' | 'omp' | 'workspace' | 'approval' | 'login'
const STEP_ORDER: WizardStep[] = ['welcome', 'omp', 'workspace', 'approval', 'login']

function approvalModeChoices(t: (key: MessageKey) => string): Array<{ value: Exclude<OmpApprovalMode, 'inherit'>; label: string; description: string }> {
  return [
    { value: 'always-ask', label: t('onboarding.approval.alwaysAsk.label'), description: t('onboarding.approval.alwaysAsk.description') },
    { value: 'write', label: t('onboarding.approval.write.label'), description: t('onboarding.approval.write.description') },
    { value: 'yolo', label: t('onboarding.approval.yolo.label'), description: t('onboarding.approval.yolo.description') },
  ]
}

function installPhaseLabel(phase: OmpInstallPhase, t: (key: MessageKey) => string): string {
  switch (phase) {
    case 'checking': return t('onboarding.omp.phase.checking')
    case 'downloading': return t('onboarding.omp.phase.downloading')
    case 'verifying': return t('onboarding.omp.phase.verifying')
    case 'installing': return t('onboarding.omp.phase.installing')
  }
}

export interface OnboardingWizardProps {
  meta: AppMeta | null
  settings: AppSettings
  hasProject: boolean
  onUpdateSettings(patch: Partial<AppSettings>): Promise<void> | void
  onRefreshHarnesses(): Promise<void>
  onInstallOmp(): Promise<InstalledOmp>
  onSubscribeInstallProgress(callback: (phase: OmpInstallPhase) => void): () => void
  onAddProject(): Promise<ProjectRecord | null>
  onOpenTerminal(): void
  onOpenHarnessSettings(): void
  onSaveProvider(draft: SaveOmpProviderDraft): Promise<OmpModelsSnapshot>
  onListModelProviders?(): Promise<OmpModelsSnapshot>
  onFinish(): void
}

export function OnboardingWizard({
  meta,
  settings,
  hasProject,
  onUpdateSettings,
  onRefreshHarnesses,
  onInstallOmp,
  onSubscribeInstallProgress,
  onAddProject,
  onOpenTerminal,
  onOpenHarnessSettings,
  onSaveProvider,
  onListModelProviders,
  onFinish,
}: OnboardingWizardProps) {
  const { t } = useI18n()
  const ompDetected = Boolean(meta?.harnesses.omp.path)
  const [step, setStep] = useState<WizardStep>('welcome')
  const [installState, setInstallState] = useState<'idle' | OmpInstallPhase | 'done' | 'error'>('idle')
  const [installError, setInstallError] = useState('')
  const [projectError, setProjectError] = useState('')
  const [providerOptions, setProviderOptions] = useState<OmpCatalogProviderOption[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('deepseek')
  const [apiKey, setApiKey] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginSaving, setLoginSaving] = useState(false)
  const [hasUsableProvider, setHasUsableProvider] = useState(false)
  const [approvalMode, setApprovalMode] = useState<Exclude<OmpApprovalMode, 'inherit'>>(
    settings.ompApprovalMode === 'inherit' ? 'always-ask' : settings.ompApprovalMode,
  )
  const dialogRef = useFocusTrap<HTMLDivElement>(true)
  const installing = installState !== 'idle' && installState !== 'done' && installState !== 'error'
  const steps = hasUsableProvider ? STEP_ORDER.filter((candidate) => candidate !== 'login') : STEP_ORDER

  useEffect(() => {
    if (!onListModelProviders) return
    let cancelled = false
    void onListModelProviders().then((snapshot) => {
      if (cancelled) return
      setHasUsableProvider(snapshot.rows.some((row) => row.configured || row.keylessAuth))
      const options = snapshot.availableCatalog.length
        ? snapshot.availableCatalog
        : snapshot.rows.filter((row) => row.kind === 'catalog').map((row) => ({ id: row.id, displayName: row.displayName }))
      setProviderOptions(options)
      setSelectedProviderId((current) => (options.some((option) => option.id === current) ? current : (options[0]?.id ?? current)))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [onListModelProviders])

  const advance = () => {
    const index = steps.indexOf(step)
    setStep(steps[Math.min(index + 1, steps.length - 1)])
  }

  const startInstall = async () => {
    setInstallState('checking')
    setInstallError('')
    const unsubscribe = onSubscribeInstallProgress((phase) => setInstallState(phase))
    try {
      await onInstallOmp()
      await onRefreshHarnesses()
      setInstallState('done')
    } catch (error) {
      setInstallState('error')
      setInstallError(error instanceof Error ? error.message : t('onboarding.omp.installErrorFallback'))
    } finally {
      unsubscribe()
    }
  }

  const chooseFolder = async () => {
    setProjectError('')
    try {
      const project = await onAddProject()
      if (project) advance()
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : t('onboarding.workspace.addFolderErrorFallback'))
    }
  }

  const saveApprovalMode = async () => {
    await onUpdateSettings({ ompApprovalMode: approvalMode })
    if (hasUsableProvider) onFinish()
    else advance()
  }

  const saveLoginKey = async () => {
    setLoginError('')
    setLoginSaving(true)
    try {
      await onSaveProvider({ providerId: selectedProviderId, apiKey })
      setApiKey('')
      onFinish()
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : t('onboarding.login.saveErrorFallback'))
    } finally {
      setLoginSaving(false)
    }
  }

  return createPortal(
    <div className="onboarding-backdrop" role="presentation">
      <section ref={dialogRef} className="onboarding" role="dialog" aria-modal="true" aria-label={t('onboarding.dialogAria')}>
        <button type="button" className="onboarding__skip" onClick={onFinish}>{t('onboarding.skipSetup')}</button>
        <div className="onboarding__steps" aria-hidden="true">
          {steps.map((candidate) => <span key={candidate} className={candidate === step ? 'is-active' : steps.indexOf(candidate) < steps.indexOf(step) ? 'is-done' : ''} />)}
        </div>

        {step === 'welcome' ? (
          <div className="onboarding__step">
            <Sparkles size={30} className="onboarding__icon" />
            <h1>{t('onboarding.welcome.title')}</h1>
            <p>{t('onboarding.welcome.description')}</p>
            <div className="onboarding__actions"><button type="button" className="button button--primary" autoFocus onClick={advance}>{t('onboarding.welcome.getStarted')}</button></div>
          </div>
        ) : null}

        {step === 'omp' ? (
          <div className="onboarding__step">
            <Download size={30} className="onboarding__icon" />
            <h1>{ompDetected ? t('onboarding.omp.installedTitle') : t('onboarding.omp.installTitle')}</h1>
            {ompDetected ? (
              <>
                <p>{t('onboarding.omp.foundAtPrefix')} <code className="mono">{meta?.harnesses.omp.path}</code>{meta?.harnesses.omp.version ? ` (${meta.harnesses.omp.version})` : ''}.</p>
                <div className="onboarding__actions"><button type="button" className="button button--primary" autoFocus onClick={advance}>{t('common.continue')}</button></div>
              </>
            ) : (
              <>
                <p>{t('onboarding.omp.notBundled')}</p>
                {installState === 'done' ? (
                  <>
                    <p className="onboarding__success"><Check size={14} /> {t('onboarding.omp.installedMessage')}</p>
                    <div className="onboarding__actions"><button type="button" className="button button--primary" onClick={advance}>{t('common.continue')}</button></div>
                  </>
                ) : installState === 'error' ? (
                  <>
                    <p className="page-inline-error" role="alert"><AlertTriangle size={13} /> {installError}</p>
                    <p className="onboarding__hint">{t('onboarding.omp.installHintPrefix')} <code className="mono">curl -fsSL https://omp.sh/install | sh</code> {t('onboarding.omp.installHintMiddle')} <code className="mono">brew install can1357/tap/omp</code> {t('onboarding.omp.installHintSuffix')}</p>
                    <div className="onboarding__actions">
                      <button type="button" className="button" onClick={onOpenHarnessSettings}>{t('onboarding.omp.configureManually')}</button>
                      <button type="button" className="button button--primary" onClick={() => void startInstall()}>{t('onboarding.tryAgain')}</button>
                    </div>
                  </>
                ) : (
                  <div className="onboarding__actions">
                    <button type="button" className="button" onClick={onOpenHarnessSettings} disabled={installing}>{t('onboarding.omp.alreadyHave')}</button>
                    <button type="button" className="button button--primary" autoFocus disabled={installing} onClick={() => void startInstall()}>
                      {installing ? installPhaseLabel(installState as OmpInstallPhase, t) : t('onboarding.omp.downloadAndInstall')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {step === 'workspace' ? (
          <div className="onboarding__step">
            <FolderOpen size={30} className="onboarding__icon" />
            <h1>{t('onboarding.workspace.title')}</h1>
            {hasProject ? (
              <>
                <p>{t('onboarding.workspace.alreadyHaveProject')}</p>
                <div className="onboarding__actions"><button type="button" className="button button--primary" autoFocus onClick={advance}>{t('common.continue')}</button></div>
              </>
            ) : (
              <>
                <p>{t('onboarding.workspace.pickFolder')}</p>
                {projectError ? <p className="page-inline-error" role="alert"><AlertTriangle size={13} /> {projectError}</p> : null}
                <div className="onboarding__actions"><button type="button" className="button button--primary" autoFocus onClick={() => void chooseFolder()}>{t('onboarding.workspace.chooseFolder')}</button></div>
              </>
            )}
          </div>
        ) : null}

        {step === 'approval' ? (
          <div className="onboarding__step">
            <ShieldCheck size={30} className="onboarding__icon" />
            <h1>{t('onboarding.approval.title')}</h1>
            <p>{t('onboarding.approval.description')}</p>
            <div className="onboarding__approval-choices" role="radiogroup" aria-label={t('onboarding.approval.radiogroupAria')}>
              {approvalModeChoices(t).map((choice) => (
                <label key={choice.value} className={choice.value === approvalMode ? 'is-active' : ''}>
                  <input type="radio" name="approval-mode" value={choice.value} checked={choice.value === approvalMode} onChange={() => setApprovalMode(choice.value)} />
                  <span><strong>{choice.label}</strong><small>{choice.description}</small></span>
                </label>
              ))}
            </div>
            <div className="onboarding__actions"><button type="button" className="button button--primary" onClick={() => void saveApprovalMode()}>{t('common.continue')}</button></div>
          </div>
        ) : null}

        {step === 'login' ? (
          <div className="onboarding__step">
            <KeyRound size={30} className="onboarding__icon" />
            <h1>{t('onboarding.login.title')}</h1>
            <p>{t('onboarding.login.description')}</p>
            <label className="onboarding__field">
              <span>{t('onboarding.login.providerLabel')}</span>
              <select
                value={selectedProviderId}
                disabled={loginSaving || providerOptions.length === 0}
                onChange={(event) => setSelectedProviderId(event.target.value)}
              >
                {(providerOptions.length ? providerOptions : [{ id: 'deepseek', displayName: 'DeepSeek' }]).map((option) => (
                  <option key={option.id} value={option.id}>{option.displayName}</option>
                ))}
              </select>
            </label>
            <label className="onboarding__field">
              <span>{t('onboarding.login.keyLabel')}</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                value={apiKey}
                placeholder={t('onboarding.login.keyPlaceholder')}
                onChange={(event) => setApiKey(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && apiKey.trim() && !loginSaving) void saveLoginKey() }}
              />
            </label>
            {loginError ? <p className="page-inline-error" role="alert"><AlertTriangle size={13} /> {loginError}</p> : null}
            <p className="onboarding__hint">{t('onboarding.login.advancedHint')}</p>
            <div className="onboarding__actions">
              <button type="button" className="button" onClick={onFinish} disabled={loginSaving}>{t('onboarding.login.later')}</button>
              <button type="button" className="button button--primary" disabled={!apiKey.trim() || loginSaving} onClick={() => void saveLoginKey()}>
                {loginSaving ? t('onboarding.login.saving') : t('onboarding.login.saveAndContinue')}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  )
}
