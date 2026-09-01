import { AlertTriangle, Check, Download, FolderOpen, ShieldCheck, Sparkles, Terminal as TerminalIcon } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n, type MessageKey } from '@/lib/i18n'
import type { AppMeta, AppSettings, InstalledOmp, OmpApprovalMode, OmpInstallPhase, ProjectRecord } from '@/types/api'
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
  onFinish(): void
}

export function OnboardingWizard({ meta, settings, hasProject, onUpdateSettings, onRefreshHarnesses, onInstallOmp, onSubscribeInstallProgress, onAddProject, onOpenTerminal, onOpenHarnessSettings, onFinish }: OnboardingWizardProps) {
  const { t } = useI18n()
  const ompDetected = Boolean(meta?.harnesses.omp.path)
  const [step, setStep] = useState<WizardStep>('welcome')
  const [installState, setInstallState] = useState<'idle' | OmpInstallPhase | 'done' | 'error'>('idle')
  const [installError, setInstallError] = useState('')
  const [projectError, setProjectError] = useState('')
  const [approvalMode, setApprovalMode] = useState<Exclude<OmpApprovalMode, 'inherit'>>(
    settings.ompApprovalMode === 'inherit' ? 'always-ask' : settings.ompApprovalMode,
  )
  const dialogRef = useFocusTrap<HTMLDivElement>(true)
  const installing = installState !== 'idle' && installState !== 'done' && installState !== 'error'

  const advance = () => {
    const index = STEP_ORDER.indexOf(step)
    setStep(STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)])
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
    advance()
  }

  const finishAtTerminal = () => {
    onOpenTerminal()
    onFinish()
  }

  return createPortal(
    <div className="onboarding-backdrop" role="presentation">
      <section ref={dialogRef} className="onboarding" role="dialog" aria-modal="true" aria-label={t('onboarding.dialogAria')}>
        <button type="button" className="onboarding__skip" onClick={onFinish}>{t('onboarding.skipSetup')}</button>
        <div className="onboarding__steps" aria-hidden="true">
          {STEP_ORDER.map((candidate) => <span key={candidate} className={candidate === step ? 'is-active' : STEP_ORDER.indexOf(candidate) < STEP_ORDER.indexOf(step) ? 'is-done' : ''} />)}
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
            <TerminalIcon size={30} className="onboarding__icon" />
            <h1>{t('onboarding.login.title')}</h1>
            <p>{t('onboarding.login.prefix')} <code className="mono">omp</code>{t('onboarding.login.middle')} <code className="mono">/login</code> {t('onboarding.login.suffix')}</p>
            <div className="onboarding__actions">
              <button type="button" className="button" onClick={onFinish}>{t('onboarding.login.later')}</button>
              <button type="button" className="button button--primary" autoFocus onClick={finishAtTerminal}>{t('onboarding.login.openTerminal')}</button>
            </div>
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  )
}
