import {
  GitBranch,
  PanelLeft,
  PanelRight,
  Terminal,
} from 'lucide-react'
import type { ApplicationMenuName, ProjectRecord, WorkspaceView } from '@/types/api'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { BrowserGlobe, IconButton } from './ui'
import type { MouseEvent } from 'react'

const viewTitles: Record<Exclude<WorkspaceView, 'session'>, MessageKey> = {
  projects: 'nav.projects', activity: 'nav.activity', plugins: 'nav.capabilities', skills: 'nav.skills', settings: 'nav.settings',
}

const windowsMenus: ReadonlyArray<{ name: ApplicationMenuName; label: MessageKey }> = [
  { name: 'file', label: 'titlebar.menu.file' },
  { name: 'edit', label: 'titlebar.menu.edit' },
  { name: 'view', label: 'titlebar.menu.view' },
  { name: 'window', label: 'titlebar.menu.window' },
  { name: 'help', label: 'titlebar.menu.help' },
]

function openApplicationMenu(menu: ApplicationMenuName, event: MouseEvent<HTMLButtonElement>): void {
  const rect = event.currentTarget.getBoundingClientRect()
  void window.prime?.app.popupMenu?.(menu, rect.left, rect.bottom).catch(() => undefined)
}

interface TitleToolbarProps {
  project?: ProjectRecord
  view: WorkspaceView
  /** Active harness product name; the session view's fallback title. */
  productName?: string
  sidebarOpen: boolean
  inspectorOpen: boolean
  terminalOpen: boolean
  onToggleSidebar(): void
  onToggleInspector(): void
  onToggleTerminal(): void
  onOpenBrowser(): void
  platform?: NodeJS.Platform
}

export function TitleToolbar({ project, view, productName = 'Prime Work', sidebarOpen, inspectorOpen, terminalOpen, onToggleSidebar, onToggleInspector, onToggleTerminal, onOpenBrowser, platform = 'darwin' }: TitleToolbarProps) {
  const { t } = useI18n()
  const sidebarShortcut = shortcutLabel(platform, ['Primary', 'B'])
  const terminalShortcut = shortcutLabel(platform, ['Primary', 'J'])
  const browserShortcut = shortcutLabel(platform, ['Primary', 'Shift', 'B'])
  return (
    <header className="title-toolbar drag-region">
      {!sidebarOpen && platform === 'darwin' ? <div className="traffic-light-clearance traffic-light-clearance--toolbar" aria-hidden="true" /> : null}
      {platform === 'win32' ? <nav className="windows-app-menu" aria-label={t('titlebar.appMenuAria')}>
        {windowsMenus.map(({ name, label }) => <button key={name} type="button" className="windows-app-menu__button" onClick={(event) => openApplicationMenu(name, event)}>{t(label)}</button>)}
      </nav> : null}
      <div className="title-toolbar__nav no-drag">
        {!sidebarOpen ? <IconButton label={t('layout.showSidebar', { shortcut: sidebarShortcut })} onClick={onToggleSidebar}><PanelLeft size={16} /></IconButton> : null}
      </div>
      <div className="title-toolbar__identity">
        <strong>{project?.name ?? (view === 'session' ? productName : t(viewTitles[view]))}</strong>
        {project?.gitBranch && view === 'session' ? <span className="branch-pill"><GitBranch size={12} />{project.gitBranch}</span> : null}
      </div>
      <div className="title-toolbar__actions no-drag">
        {view === 'session' ? <IconButton className={terminalOpen ? 'is-active' : ''} label={t('layout.toggleTerminal', { shortcut: terminalShortcut })} onClick={onToggleTerminal}><Terminal size={17} /></IconButton> : null}
        {view === 'session' ? <IconButton label={t('layout.openBrowser', { shortcut: browserShortcut })} onClick={onOpenBrowser}><BrowserGlobe size={18} /></IconButton> : null}
        {view === 'session' ? <IconButton className={inspectorOpen ? 'is-active' : ''} label={t('layout.toggleInspector')} onClick={onToggleInspector}><PanelRight size={16} /></IconButton> : null}
        {view !== 'session' && sidebarOpen ? <IconButton label={t('layout.hideSidebar', { shortcut: sidebarShortcut })} onClick={onToggleSidebar}><PanelLeft size={16} /></IconButton> : null}
      </div>
    </header>
  )
}
