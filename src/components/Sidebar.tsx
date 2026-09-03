import {
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  MessageCircleQuestion,
  NotebookPen,
  PackageOpen,
  PanelLeftClose,
  MoreHorizontal,
  Search,
  Settings,
  SquarePen,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import { memo, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import type { AppMeta, AppUpdateState, HarnessId, ProjectRecord, SessionRecord, WorkspaceView } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { HARNESS_PRODUCT_NAMES, HARNESS_SHORT_NAMES } from '@/lib/harness'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { sessionAttentionSignature } from '@/app/session-attention'
import { IconButton, Modal, OmpMark, useFocusTrap } from './ui'

export interface SidebarProps {
  projects: ProjectRecord[]
  sessions: SessionRecord[]
  activeProjectId?: string
  activeSessionId?: string
  activeView: WorkspaceView
  activeHarness?: HarnessId
  harnesses?: AppMeta['harnesses'] | null
  clearedAttention?: Record<string, string>
  updateState?: AppUpdateState
  onUpdateAction?(): void | Promise<void>
  onSelectHarness?(harness: HarnessId): void
  onSelectProject(project: ProjectRecord): void
  onSelectSession(session: SessionRecord): void
  onNavigate(view: WorkspaceView): void
  onNewSession(project?: ProjectRecord): void
  onAddProject(): void
  onRemoveProject(project: ProjectRecord): void
  onClose(): void
  onOpenPalette(): void
  onRenameSession(session: SessionRecord, title: string): Promise<void>
  onDeleteSession(session: SessionRecord): Promise<void>
  overlay?: boolean
  platform?: NodeJS.Platform
}

const statusLabelKey: Record<SessionRecord['status'], MessageKey> = {
  idle: 'sidebar.status.idle', running: 'sidebar.status.running', waiting: 'sidebar.status.waiting', complete: 'sidebar.status.finished', failed: 'sidebar.status.failed', unknown: 'sidebar.status.unknown',
}

export const SIDEBAR_SESSION_LIMIT = 7

export interface SidebarIndexStats {
  projectPaths: number
  sessionScans: number
}

export function indexSidebarSessions(
  projects: ProjectRecord[],
  sessions: SessionRecord[],
  stats?: SidebarIndexStats,
): { activeSessions: SessionRecord[]; sessionsByProject: Map<string, SessionRecord[]> } {
  const activeSessions: SessionRecord[] = []
  const owners = new Map<string, string[]>()
  const sessionsByProject = new Map(projects.map((project) => [project.id, [] as SessionRecord[]]))
  for (const project of projects) for (const path of new Set([project.path, ...project.folders])) {
    if (stats) stats.projectPaths += 1
    const entries = owners.get(path) ?? []
    entries.push(project.id)
    owners.set(path, entries)
  }
  for (const session of sessions) {
    if (stats) stats.sessionScans += 1
    if (session.archived) continue
    activeSessions.push(session)
    for (const projectId of owners.get(session.projectPath) ?? []) sessionsByProject.get(projectId)?.push(session)
  }
  const compareByLastUserMessage = (left: SessionRecord, right: SessionRecord) => {
    const difference = Date.parse(right.lastUserMessageAt ?? right.createdAt) - Date.parse(left.lastUserMessageAt ?? left.createdAt)
    return difference || right.createdAt.localeCompare(left.createdAt) || left.filePath.localeCompare(right.filePath)
  }
  activeSessions.sort(compareByLastUserMessage)
  for (const projectSessions of sessionsByProject.values()) projectSessions.sort(compareByLastUserMessage)
  return { activeSessions, sessionsByProject }
}

export function boundedSidebarSessions(sessions: SessionRecord[]): SessionRecord[] {
  return sessions.slice(0, SIDEBAR_SESSION_LIMIT)
}


function SessionStatusMark({ status, attention }: { status: SessionRecord['status']; attention: boolean }) {
  const { t } = useI18n()
  const title = status === 'failed' && !attention ? t('sidebar.status.failedCleared') : t(statusLabelKey[status])
  if (status === 'running') return <span className="session-status-mark session-status-mark--running" title={t(statusLabelKey[status])}><LoaderCircle className="spin" size={13} /></span>
  if (status === 'waiting') return <span className="session-status-mark session-status-mark--waiting" title={t(statusLabelKey[status])}><MessageCircleQuestion size={12} /></span>
  if (status === 'complete') return <span className="session-status-mark session-status-mark--complete" title={t(statusLabelKey[status])}><CheckCircle2 size={12} /></span>
  return <span className={`session-status-mark session-status-mark--${status}`} title={title}><span /></span>
}

const HARNESS_MARKS: Record<HarnessId, (props: { size?: number }) => ReactElement> = { omp: OmpMark }

function HarnessMark({ harness, size }: { harness: HarnessId; size: number }) {
  const Mark = HARNESS_MARKS[harness]
  return <Mark size={size} />
}

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string

function updateControlCopy(state: AppUpdateState, t: Translate): { label: string; title: string } {
  const version = state.version ? ` ${state.version}` : ''
  switch (state.phase) {
    case 'checking': return { label: t('sidebar.update.checking.label'), title: t('sidebar.update.checking.title') }
    case 'available': return { label: t('sidebar.update.download.label', { version }), title: t('sidebar.update.download.title', { version }) }
    case 'downloading': return {
      label: state.percent === undefined ? t('sidebar.update.downloading.label', { version }) : t('sidebar.update.downloading.labelPercent', { version, percent: state.percent }),
      title: t('sidebar.update.downloading.title', { version }),
    }
    case 'downloaded': return { label: t('sidebar.update.downloaded.label', { version }), title: t('sidebar.update.downloaded.title', { version }) }
    case 'not-available': return { label: t('sidebar.update.notAvailable.label'), title: t('sidebar.update.notAvailable.title') }
    case 'error': return { label: t('sidebar.update.error.label', { version }), title: state.message ?? t('sidebar.update.error.title') }
    case 'unsupported': return { label: t('sidebar.update.unsupported.label'), title: state.message ?? t('sidebar.update.unsupported.title') }
    default: return { label: t('sidebar.update.default.label'), title: t('sidebar.update.default.title') }
  }
}

/** Announced without the percentage so progress ticks do not spam assistive tech. */
function updateAnnouncement(state: AppUpdateState, t: Translate): string {
  const version = state.version ? ` ${state.version}` : ''
  switch (state.phase) {
    case 'available': return t('sidebar.update.announce.available', { version })
    case 'downloading': return t('sidebar.update.announce.downloading', { version })
    case 'downloaded': return t('sidebar.update.announce.downloaded', { version })
    case 'error': return t('sidebar.update.announce.error', { detail: state.message ?? t('common.tryAgain') })
    default: return ''
  }
}

function updateConfirmCopy(state: AppUpdateState, t: Translate): { title: string; body: string } {
  if (state.phase === 'downloaded') return {
    title: t('sidebar.update.confirmRestart.title'),
    body: t('sidebar.update.confirmRestart.body'),
  }
  return {
    title: t('sidebar.update.confirmDownload.title'),
    body: t('sidebar.update.confirmDownload.body'),
  }
}

/** Manual "Check for Updates…" already lives in the app menu, so the sidebar control only needs to surface a concrete update to act on. */
function hasVisibleUpdate(state: AppUpdateState): boolean {
  return state.phase === 'available' || state.phase === 'downloading' || state.phase === 'downloaded'
    || (state.phase === 'error' && Boolean(state.version))
}

async function copySessionUuid(id: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(id)
      return
    } catch {
      // Fall back to the document copy command when clipboard permission is unavailable.
    }
  }
  const input = document.createElement('textarea')
  input.value = id
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('Copy is unavailable')
}

function SidebarView({ projects, sessions, activeProjectId, activeSessionId, activeView, activeHarness = 'omp', clearedAttention = {}, updateState = { phase: 'unsupported' }, onUpdateAction, onSelectProject, onSelectSession, onNavigate, onNewSession, onAddProject, onRemoveProject, onClose, onOpenPalette, onRenameSession, onDeleteSession, overlay = false, platform = 'darwin' }: SidebarProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [searchOpen, setSearchOpen] = useState(false)
  const sidebarRef = useFocusTrap<HTMLElement>(overlay, onClose)
  const [projectMenu, setProjectMenu] = useState<string | null>(null)
  const [sessionMenu, setSessionMenu] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<SessionRecord | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SessionRecord | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ProjectRecord | null>(null)
  const [confirmUpdate, setConfirmUpdate] = useState(false)
  const { activeSessions, sessionsByProject } = useMemo(() => indexSidebarSessions(projects, sessions), [projects, sessions])
  const needsAttention = (session: SessionRecord) => {
    const signature = sessionAttentionSignature(session)
    return Boolean(signature && clearedAttention[session.id] !== signature)
  }
  const unreadCount = activeSessions.reduce((count, session) => count + Number(needsAttention(session)), 0)
  const newSessionShortcut = shortcutLabel(platform, ['Primary', 'N'])
  const sidebarShortcut = shortcutLabel(platform, ['Primary', 'B'])
  const commandsShortcut = shortcutLabel(platform, ['Primary', 'K'])
  const settingsShortcut = shortcutLabel(platform, ['Primary', ','])
  const updateCopy = updateControlCopy(updateState, t)
  const updateConfirm = updateConfirmCopy(updateState, t)
  const updateBusy = updateState.phase === 'checking' || updateState.phase === 'downloading'
  const updateIndeterminate = updateState.phase === 'downloading' && updateState.percent === undefined
  const updateVisible = hasVisibleUpdate(updateState)
  useEffect(() => {
    if (!projectMenu) return
    const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.project-group')) setProjectMenu(null) }
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setProjectMenu(null) } }
    document.addEventListener('pointerdown', dismiss, true); document.addEventListener('keydown', dismissOnEscape, true)
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', dismissOnEscape, true) }
  }, [projectMenu])
  useEffect(() => {
    if (!sessionMenu) return
    const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.session-row-wrap')) setSessionMenu(null) }
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setSessionMenu(null) } }
    document.addEventListener('pointerdown', dismiss, true); document.addEventListener('keydown', dismissOnEscape, true)
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', dismissOnEscape, true) }
  }, [sessionMenu])
  const normalized = query.trim().toLowerCase()
  const visibleProjects = useMemo(() => projects.filter((project) => !normalized || project.name.toLowerCase().includes(normalized) || (sessionsByProject.get(project.id) ?? []).some((session) => `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized))), [projects, sessionsByProject, normalized])

  return (
    <aside ref={sidebarRef} className="sidebar" aria-label={t('sidebar.nav.aria')} tabIndex={overlay ? -1 : undefined}>
      <div className="sidebar__titlebar drag-region">
        <div className="traffic-light-clearance" aria-hidden="true" />
        <div className="sidebar__brand no-drag" title={HARNESS_PRODUCT_NAMES[activeHarness]}>
          <HarnessMark harness={activeHarness} size={24} />
          <span className="brand-switcher__name"><strong>{HARNESS_SHORT_NAMES[activeHarness]}</strong><small>Work</small></span>
        </div>
        <div className="sidebar__title-actions no-drag">
          <IconButton label={t('sidebar.newSession.withShortcut', { shortcut: newSessionShortcut })} onClick={() => onNewSession()}><NotebookPen size={16} /></IconButton>
          <IconButton label={t('layout.hideSidebar', { shortcut: sidebarShortcut })} onClick={onClose}><PanelLeftClose size={16} /></IconButton>
        </div>
      </div>

      <nav className="sidebar__primary" aria-label={t('sidebar.nav.primaryAria')}>
        <button type="button" className="sidebar__new-session" title={t('sidebar.newSession.withShortcut', { shortcut: newSessionShortcut })} onClick={() => onNewSession()}><NotebookPen size={15} /><span>{t('sidebar.newSession')}</span><kbd>{newSessionShortcut}</kbd></button>
        <button type="button" title={t('common.search')} onClick={() => { setSearchOpen((open) => !open); window.setTimeout(() => document.getElementById('session-search')?.focus(), 0) }} className={searchOpen ? 'is-active' : ''}><Search size={15} /><span>{t('common.search')}</span></button>
        {searchOpen ? (
          <div className="sidebar-search">
            <Search size={13} />
            <input id="session-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('sidebar.search.placeholder')} aria-label={t('sidebar.search.aria')} />
            {query ? <button type="button" title={t('sidebar.search.clear')} aria-label={t('sidebar.search.clear')} onClick={() => setQuery('')}>×</button> : null}
          </div>
        ) : null}
        <button type="button" title={t('nav.projects')} className={activeView === 'projects' ? 'is-active' : ''} onClick={() => onNavigate('projects')}><Folder size={15} /><span>{t('nav.projects')}</span></button>
        <button type="button" title={t('nav.activity')} className={activeView === 'activity' ? 'is-active' : ''} onClick={() => onNavigate('activity')}><Bell size={15} /><span>{t('nav.activity')}</span>{unreadCount ? <span className="nav-count">{unreadCount}</span> : null}</button>
        <button type="button" title={t('nav.capabilities')} className={activeView === 'plugins' ? 'is-active' : ''} onClick={() => onNavigate('plugins')}><PackageOpen size={15} /><span>{t('nav.capabilities')}</span></button>
      </nav>

      <div className="sidebar__scroll scroll-area">
        <div className="sidebar__section-heading"><span>{t('nav.projects')}</span><IconButton size="small" label={t('sidebar.addProject')} onClick={onAddProject}><FolderPlus size={13} /></IconButton></div>
        {visibleProjects.length === 0 ? <p className="sidebar__empty">{t('sidebar.noMatchingWork')}</p> : null}
        {visibleProjects.map((project) => {
          const projectSessions = (sessionsByProject.get(project.id) ?? []).filter((session) => !normalized || `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized) || project.name.toLowerCase().includes(normalized))
          const isCollapsed = collapsed[project.id] ?? false
          const running = projectSessions.some((session) => session.status === 'running')
          return (
            <div className="project-group" key={project.id}>
              <div
                className={`project-row ${activeProjectId === project.id && activeView === 'session' ? 'is-selected' : ''}`}
                onContextMenu={(event) => { event.preventDefault(); setProjectMenu(project.id) }}
              >
                <button className="project-row__collapse" type="button" aria-label={t(isCollapsed ? 'sidebar.project.expand' : 'sidebar.project.collapse', { name: project.name })} title={t(isCollapsed ? 'sidebar.project.expand' : 'sidebar.project.collapse', { name: project.name })} onClick={() => { setProjectMenu(null); setCollapsed((value) => ({ ...value, [project.id]: !isCollapsed })) }}>
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                <button className="project-row__main" type="button" onClick={() => { setProjectMenu(null); onSelectProject(project) }} title={project.path}>
                  {activeProjectId === project.id ? <FolderOpen size={14} /> : <Folder size={14} />}
                  <span>{project.name}</span>
                </button>
                <IconButton size="small" className="project-row__new-session row-action" label={t('sidebar.project.newSessionIn', { name: project.name })} onClick={() => { setProjectMenu(null); onNewSession(project) }}><NotebookPen size={13} /></IconButton>
                {running ? <span className="project-working" title={t('sidebar.agentWorking')}><LoaderCircle className="spin" size={13} /></span> : null}
                {projectMenu === project.id ? <div className="project-row__menu" role="menu" aria-label={t('sidebar.project.optionsAria', { name: project.name })}><button type="button" role="menuitem" onClick={() => { setProjectMenu(null); setRemoveTarget(project) }}><Trash2 size={12} /> {t('sidebar.project.remove')}</button></div> : null}
              </div>
              {!isCollapsed ? (
                <div className="session-list">
                  {boundedSidebarSessions(projectSessions).map((session) => (
                    <div key={session.id} className={`session-row-wrap session-row-wrap--${session.status} ${needsAttention(session) ? 'has-attention' : ''} ${activeSessionId === session.id && activeView === 'session' ? 'is-selected' : ''}`}>
                      <button type="button" title={session.title} className="session-row" onClick={() => { setSessionMenu(null); onSelectSession(session) }} onContextMenu={(event) => { event.preventDefault(); setSessionMenu(session.id) }}>
                        <SessionStatusMark status={session.status} attention={needsAttention(session)} />
                        <span className="session-row__text"><span className="session-row__title">{session.title}</span><span className="session-row__meta">{session.status === 'running' ? t('sidebar.session.working') : session.status === 'waiting' ? t('sidebar.session.needsAttention') : session.status === 'complete' ? t('sidebar.status.finished') : formatRelative(session.updatedAt)}</span></span>
                      </button>
                      <IconButton
                        size="small"
                        className="session-row__archive"
                        label={t('sidebar.session.delete', { title: session.title })}
                        onClick={() => {
                          setSessionMenu(null)
                          setDeleteTarget(session)
                        }}
                      ><Trash2 size={13}/></IconButton>
                      <IconButton size="small" className="session-row__more" label={t('sidebar.session.optionsAria', { title: session.title })} onClick={() => setSessionMenu((current) => current === session.id ? null : session.id)}><MoreHorizontal size={13}/></IconButton>
                      {sessionMenu === session.id ? <div className="session-row__menu" aria-label={t('sidebar.session.optionsMenuAria')}><button type="button" onClick={() => { void copySessionUuid(session.id); setSessionMenu(null) }}><Copy size={12}/> {t('sidebar.session.copyUuid')}</button><button type="button" onClick={() => { setRenameTarget(session); setRenameValue(session.title); setSessionMenu(null) }}><SquarePen size={12}/> {t('common.rename')}</button></div> : null}
                    </div>
                  ))}
                  {projectSessions.length === 0 ? <button type="button" title={t('sidebar.project.newSessionIn', { name: project.name })} className="session-row session-row--empty" onClick={() => { setProjectMenu(null); onNewSession(project) }}><NotebookPen size={12} /> {t('sidebar.newSession')}</button> : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="sidebar__footer">
        <button type="button" title={t('sidebar.commands')} onClick={onOpenPalette}><Search size={15} /><span>{t('sidebar.commands')}</span><kbd>{commandsShortcut}</kbd></button>
        <button type="button" title={t('nav.skills')} className={activeView === 'skills' ? 'is-active' : ''} onClick={() => onNavigate('skills')}><WandSparkles size={15} /><span>{t('nav.skills')}</span></button>
        <div className="sidebar__footer-row">
          <button type="button" title={t('nav.settings')} className={activeView === 'settings' ? 'is-active' : ''} onClick={() => onNavigate('settings')}><Settings size={15} /><span>{t('nav.settings')}</span><kbd>{settingsShortcut}</kbd></button>
          {updateVisible ? (
            <>
              <span className="sr-only" role="status" aria-live="polite">{updateAnnouncement(updateState, t)}</span>
              <button
                type="button"
                className={`sidebar-update sidebar-update--${updateState.phase} ${updateIndeterminate ? 'sidebar-update--indeterminate' : ''}`}
                title={updateCopy.title}
                aria-label={updateCopy.title}
                disabled={updateBusy}
                onClick={() => {
                  if (updateState.phase === 'available' || updateState.phase === 'downloaded') setConfirmUpdate(true)
                  else void onUpdateAction?.()
                }}
              >
                <span className="sidebar-update__icon" style={{ '--update-progress': `${updateState.percent ?? 0}%` } as CSSProperties}><Download size={12} /></span>
              </button>
            </>
          ) : null}
        </div>
      </div>
      {renameTarget ? <Modal title={t('sidebar.renameSession.title')} onClose={() => setRenameTarget(null)} footer={<><button type="button" className="button" onClick={() => setRenameTarget(null)}>{t('common.cancel')}</button><button type="button" className="button button--primary" disabled={!renameValue.trim()} onClick={() => { const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) }}>{t('common.rename')}</button></>}><label className="field"><span>{t('sidebar.renameSession.fieldLabel')}</span><input autoFocus value={renameValue} maxLength={200} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && renameValue.trim()) { event.preventDefault(); const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) } }}/></label></Modal> : null}
      {deleteTarget ? <Modal title={t('sidebar.session.deleteTitle')} onClose={() => setDeleteTarget(null)} footer={<><button type="button" className="button" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button><button type="button" className="button button--danger" onClick={() => { const target = deleteTarget; setDeleteTarget(null); void onDeleteSession(target) }}>{t('common.delete')}</button></>}><p>{t('sidebar.session.deleteBody', { title: deleteTarget.title })}</p></Modal> : null}
      {removeTarget ? <Modal title={t('sidebar.project.remove')} onClose={() => setRemoveTarget(null)} footer={<><button type="button" className="button" onClick={() => setRemoveTarget(null)}>{t('common.cancel')}</button><button type="button" className="button button--danger" onClick={() => { const target = removeTarget; setRemoveTarget(null); onRemoveProject(target) }}>{t('common.remove')}</button></>}><p>{t('sidebar.removeProject.body', { name: removeTarget.name, product: HARNESS_PRODUCT_NAMES[activeHarness] })}</p></Modal> : null}
      {confirmUpdate ? <Modal title={updateConfirm.title} onClose={() => setConfirmUpdate(false)} footer={<><button type="button" className="button" onClick={() => setConfirmUpdate(false)}>{t('common.no')}</button><button type="button" className="button button--primary" onClick={() => { setConfirmUpdate(false); void onUpdateAction?.() }}>{t('common.yes')}</button></>}><p>{updateConfirm.body}</p></Modal> : null}
    </aside>
  )
}

export function areSidebarPropsEqual(previous: SidebarProps, next: SidebarProps): boolean {
  return previous.projects === next.projects
    && previous.sessions === next.sessions
    && previous.activeProjectId === next.activeProjectId
    && previous.activeSessionId === next.activeSessionId
    && previous.activeView === next.activeView
    && previous.activeHarness === next.activeHarness
    && previous.harnesses === next.harnesses
    && previous.clearedAttention === next.clearedAttention
    && previous.updateState === next.updateState
    && previous.onUpdateAction === next.onUpdateAction
    && previous.onSelectHarness === next.onSelectHarness
    && previous.onSelectProject === next.onSelectProject
    && previous.onSelectSession === next.onSelectSession
    && previous.onNavigate === next.onNavigate
    && previous.onNewSession === next.onNewSession
    && previous.onAddProject === next.onAddProject
    && previous.onRemoveProject === next.onRemoveProject
    && previous.onClose === next.onClose
    && previous.onOpenPalette === next.onOpenPalette
    && previous.onRenameSession === next.onRenameSession
    && previous.onDeleteSession === next.onDeleteSession
    && previous.overlay === next.overlay
    && previous.platform === next.platform
}

export const Sidebar = memo(SidebarView, areSidebarPropsEqual)
