import { PanelRightClose } from 'lucide-react'
import type { BrowserAnnotationsApi } from '@/hooks/useBrowserAnnotations'
import type { StampedPointerEvent } from '@/hooks/useAgentBrowserTabs'
import { useI18n, type MessageKey } from '@/lib/i18n'
import type { AgentBrowserTabRecord, GitStatus, InspectorTab, ProjectRecord, RuntimeInfo, TranscriptMessage } from '@/types/api'
import type { AgentSlotRect } from './AgentBrowserLayer'
import { BrowserPanel } from './inspector/BrowserPanel'
import { ChangesPanel } from './inspector/ChangesPanel'
import { FilesPanel } from './inspector/FilesPanel'
import { SummaryPanel } from './inspector/SummaryPanel'
import { IconButton, useFocusTrap } from './ui'

interface InspectorProps {
  platform?: NodeJS.Platform
  activeTab: InspectorTab
  onTabChange(tab: InspectorTab): void
  onClose(): void
  /** Active harness agent name ("Prime Agent" / "OMP"). */
  agentName?: string
  /** Short harness name for working copy ("Prime" / "OMP"). */
  shortName?: string
  project?: ProjectRecord
  cwd?: string
  runtime?: RuntimeInfo | null
  messages: TranscriptMessage[]
  git: GitStatus
  browserHome: string
  browserAnnotations: BrowserAnnotationsApi
  agentBrowserTabs: AgentBrowserTabRecord[]
  activeAgentTabId: string | null
  agentPreviewSelected: boolean
  onSelectAgentTab(tabId: string): void
  onCloseAgentTab(tabId: string): void
  onShowBrowserPreview(): void
  onAgentSlotRect(rect: AgentSlotRect | null): void
  agentSessionKey?: string
  onPreviewContext(webContentsId: number | null, sessionFile: string | null): void
  previewPointerEvent: StampedPointerEvent | null
  onNavigateAgentTab(tabId: string, action: 'back' | 'forward' | 'reload'): void
  onRefreshGit(): Promise<void> | void
  onOpenExternal(url: string): void
  onRevealPath(path: string): void
  overlay?: boolean
}

const tabs: Array<{ id: InspectorTab; labelKey: MessageKey }> = [{ id: 'summary', labelKey: 'inspector.tabs.summary' }, { id: 'changes', labelKey: 'inspector.tabs.changes' }, { id: 'browser', labelKey: 'inspector.tabs.browser' }, { id: 'files', labelKey: 'inspector.tabs.files' }]

export function Inspector({ activeTab, onTabChange, onClose, agentName, shortName, project, cwd, runtime, messages, git, browserHome, browserAnnotations, agentBrowserTabs, activeAgentTabId, agentPreviewSelected, onSelectAgentTab, onCloseAgentTab, onShowBrowserPreview, onAgentSlotRect, agentSessionKey, onPreviewContext, previewPointerEvent, onNavigateAgentTab, onRefreshGit, onOpenExternal, onRevealPath, overlay = false, platform = 'darwin' }: InspectorProps) {
  const { t } = useI18n()
  const inspectorRef = useFocusTrap<HTMLElement>(overlay, onClose)
  const moveTab = (current: number, key: string) => {
    let next = current
    if (key === 'ArrowRight') next = (current + 1) % tabs.length
    else if (key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length
    else if (key === 'Home') next = 0
    else if (key === 'End') next = tabs.length - 1
    else return
    const tab = tabs[next]
    onTabChange(tab.id)
    requestAnimationFrame(() => document.getElementById(`inspector-tab-${tab.id}`)?.focus())
  }
  return <aside ref={inspectorRef} className="inspector" aria-label={t('inspector.aria.panel')} tabIndex={overlay ? -1 : undefined}>
    <div className="inspector__tabs" role="tablist" aria-label={t('inspector.aria.tabsList')}>
      {tabs.map((tab, index) => <button id={`inspector-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`inspector-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} className={activeTab === tab.id ? 'is-active' : ''} key={tab.id} onKeyDown={(event) => { if (['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) { event.preventDefault(); moveTab(index, event.key) } }} onClick={() => onTabChange(tab.id)}>{t(tab.labelKey)}{tab.id === 'changes' && git.files.length ? <span>{git.files.length}</span> : null}</button>)}
      <span className="inspector__tab-spacer"/>
      <IconButton label={t('inspector.actions.close')} onClick={onClose}><PanelRightClose size={15}/></IconButton>
    </div>
    <div id={`inspector-panel-${activeTab}`} className="inspector__body" role="tabpanel" aria-labelledby={`inspector-tab-${activeTab}`} tabIndex={0}>
      {activeTab === 'summary' ? <SummaryPanel agentName={agentName} shortName={shortName} project={project} runtime={runtime} messages={messages} git={git}/> : null}
      {activeTab === 'changes' ? <ChangesPanel key={cwd ?? 'no-workspace'} cwd={cwd} git={git} onRefreshGit={onRefreshGit}/> : null}
      {activeTab === 'browser' ? <BrowserPanel platform={platform} home={browserHome} onOpenExternal={onOpenExternal} annotations={browserAnnotations} agentTabs={agentBrowserTabs} activeAgentTabId={activeAgentTabId} previewSelected={agentPreviewSelected} onSelectAgentTab={onSelectAgentTab} onCloseAgentTab={onCloseAgentTab} onShowPreview={onShowBrowserPreview} onAgentSlotRect={onAgentSlotRect} agentSessionKey={agentSessionKey} onPreviewContext={onPreviewContext} previewPointerEvent={previewPointerEvent} onNavigateAgentTab={onNavigateAgentTab}/> : null}
      {activeTab === 'files' ? <FilesPanel project={project} git={git} onReveal={onRevealPath}/> : null}
    </div>
  </aside>
}
