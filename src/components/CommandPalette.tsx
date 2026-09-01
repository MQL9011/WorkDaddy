import { Bell, Folder, LayoutPanelLeft, Lock, NotebookPen, PackageOpen, Search, Settings, Terminal, WandSparkles, } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { WorkspaceView } from '@/types/api'
import { useI18n } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { BrowserGlobe, useAppShellOverlay, useFocusTrap } from './ui'

interface Command { id:string; label:string; detail:string; shortcut?:string; icon:ReactNode; run():void }

export function CommandPalette({ open, onClose, onNavigate, onNewSession, onToggleSidebar, onToggleTerminal, onOpenBrowser, onVaultDemo, platform = 'darwin' }: { open:boolean; onClose():void; onNavigate(view:WorkspaceView):void; onNewSession():void; onToggleSidebar():void; onToggleTerminal():void; onOpenBrowser():void; onVaultDemo?():void; platform?:NodeJS.Platform }) {
  const { t } = useI18n()
  const [query,setQuery]=useState('')
  const [active,setActive]=useState(0)
  const inputRef=useRef<HTMLInputElement>(null)
  const paletteRef=useFocusTrap<HTMLDivElement>(open,onClose)
  const commands:Command[]=[
    {id:'new',label:t('palette.newSession.label'),detail:t('palette.newSession.detail'),shortcut:shortcutLabel(platform, ['Primary', 'N']),icon:<NotebookPen size={14}/>,run:onNewSession},
    {id:'projects',label:t('palette.projects.label'),detail:t('palette.projects.detail'),icon:<Folder size={14}/>,run:()=>onNavigate('projects')},
    {id:'activity',label:t('palette.activity.label'),detail:t('palette.activity.detail'),icon:<Bell size={14}/>,run:()=>onNavigate('activity')},
    {id:'plugins',label:t('palette.plugins.label'),detail:t('palette.plugins.detail'),icon:<PackageOpen size={14}/>,run:()=>onNavigate('plugins')},
    {id:'skills',label:t('palette.skills.label'),detail:t('palette.skills.detail'),icon:<WandSparkles size={14}/>,run:()=>onNavigate('skills')},
    {id:'browser',label:t('palette.browser.label'),detail:t('palette.browser.detail'),shortcut:shortcutLabel(platform, ['Primary', 'Shift', 'B']),icon:<BrowserGlobe size={14}/>,run:onOpenBrowser},
    {id:'terminal',label:t('palette.terminal.label'),detail:t('palette.terminal.detail'),shortcut:shortcutLabel(platform, ['Primary', 'J']),icon:<Terminal size={14}/>,run:onToggleTerminal},
    {id:'sidebar',label:t('palette.sidebar.label'),detail:t('palette.sidebar.detail'),shortcut:shortcutLabel(platform, ['Primary', 'B']),icon:<LayoutPanelLeft size={14}/>,run:onToggleSidebar},
    {id:'settings',label:t('palette.settings.label'),detail:t('palette.settings.detail'),shortcut:shortcutLabel(platform, ['Primary', ',']),icon:<Settings size={14}/>,run:()=>onNavigate('settings')},
    // PoC-only, not localized: sends the encrypted code-review command so the
    // vault_read decryption tool can be exercised from the real app shell.
    ...(onVaultDemo ? [{id:'vault-demo',label:'Vault demo: code review',detail:'Send the encrypted code-review command (tests vault_read)',icon:<Lock size={14}/>,run:onVaultDemo}] : []),
  ]
  const visible=commands.filter((command)=>`${command.label} ${command.detail}`.toLowerCase().includes(query.toLowerCase()))
  useEffect(()=>{if(open){setQuery('');setActive(0);requestAnimationFrame(()=>inputRef.current?.focus())}},[open])
  useEffect(()=>setActive(0),[query])
  useAppShellOverlay(open)
  if(!open)return null
  const choose=(command?:Command)=>{if(!command)return;command.run();onClose()}
  return createPortal(<div className="palette-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}><div ref={paletteRef} className="command-palette" role="dialog" aria-modal="true" aria-label={t('palette.dialogAria')} tabIndex={-1}><div className="command-search"><Search size={16}/><input ref={inputRef} value={query} role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={visible[active] ? `command-${visible[active].id}` : undefined} onChange={(event)=>setQuery(event.target.value)} placeholder={t('palette.searchPlaceholder')} onKeyDown={(event)=>{if(event.key==='ArrowDown'){event.preventDefault();setActive((value)=>Math.min(visible.length-1,value+1))}if(event.key==='ArrowUp'){event.preventDefault();setActive((value)=>Math.max(0,value-1))}if(event.key==='Enter'){event.preventDefault();choose(visible[active])}if(event.key==='Escape')onClose()}}/><button type="button" onClick={onClose} aria-label={t('palette.closeAria')}><kbd>esc</kbd></button></div><div id="command-results" className="command-results" role="listbox" aria-label={t('palette.commandsLabel')}><div className="command-section-label">{t('palette.commandsLabel')}</div>{visible.map((command,index)=><button id={`command-${command.id}`} type="button" role="option" aria-selected={index===active} key={command.id} className={index===active?'is-active':''} onMouseEnter={()=>setActive(index)} onClick={()=>choose(command)}><span>{command.icon}</span><span><strong>{command.label}</strong><small>{command.detail}</small></span>{command.shortcut?<kbd>{command.shortcut}</kbd>:null}</button>)}{visible.length===0?<p>{t('palette.noMatch', { query })}</p>:null}</div><footer><span>{t('palette.footerNavigate')}</span><span>{t('palette.footerOpen')}</span><span>{t('palette.footerClose')}</span></footer> </div></div>,document.body)
}
