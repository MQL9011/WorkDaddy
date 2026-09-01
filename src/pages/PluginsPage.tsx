import { AlertTriangle, ArrowLeft, BookOpen, Check, ChevronRight, FileCode2, FileText, GitFork, Globe2, Package, Palette, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Trash2, WandSparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CapabilityMutationInput, ExtensionInstallInput, HarnessId, McpConnectionInput, McpStateInput, PluginWarning, SkillRecord } from '@/types/api'
import { HARNESS_SHORT_NAMES } from '@/lib/harness'
import { NETWORK_MCP_UNAVAILABLE_DETAIL } from '@/lib/mcp-policy'
import { EmptyState, Modal } from '@/components/ui'
import { useI18n, type MessageKey } from '@/lib/i18n'

const MCP_STDIO_HELP_KEYS: Record<HarnessId, MessageKey> = {
  omp: 'page.plugins.mcpStdioHelp.omp',
}

type DirectoryTab = 'plugins' | 'skills'
type AddKind = 'mcp' | 'bundle' | 'extension'
type McpScope = 'user' | 'project'

const PACKAGE_LABEL_KEYS: Record<HarnessId, MessageKey> = { omp: 'page.plugins.packageLabel.omp' }
const PACKAGE_HELP_KEYS: Record<HarnessId, MessageKey> = {
  omp: 'page.plugins.packageHelp.omp',
}
const GITHUB_ISSUES_URL = 'https://github.com/am-will/gooey-pi/issues/new'

function capabilityDetailId(skill: SkillRecord): string {
  return `capability-detail-${skill.id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 128)}`
}

function SkillIcon({ skill }: { skill: SkillRecord }) {
  const common = { size: 16 }
  if (skill.icon === 'github') return <GitFork {...common}/>
  if (skill.icon === 'palette') return <Palette {...common}/>
  if (skill.icon === 'book-open') return <BookOpen {...common}/>
  if (skill.kind === 'mcp') return <Globe2 {...common}/>
  if (skill.kind === 'prompt') return <FileText {...common}/>
  if (skill.kind === 'skill') return <WandSparkles {...common}/>
  return <Package {...common}/>
}

interface PluginsPageProps {
  harness: HarnessId
  skills: SkillRecord[]
  warnings: PluginWarning[]
  loading: boolean
  activeProjectPath?: string
  onRefresh(): Promise<void>
  askUserEnabled: boolean
  onSetAskUserEnabled(enabled: boolean): Promise<void>
  browserEnabled: boolean
  onSetBrowserEnabled(enabled: boolean): Promise<void>
  onOpenExternal(url: string): void
  onInstall(source: string): Promise<{ ok: boolean; output: string }>
  onInstallExtension(input: ExtensionInstallInput): Promise<{ ok: boolean; output: string }>
  onConnectMcp(input: McpConnectionInput): Promise<{ ok: boolean; output: string }>
  onSetMcpEnabled(input: McpStateInput): Promise<{ ok: boolean; output: string }>
  onMutateCapability?(input: CapabilityMutationInput): Promise<{ ok: boolean; output: string }>
}

export function PluginsPage({ harness, skills, warnings, loading, activeProjectPath, askUserEnabled, onSetAskUserEnabled, browserEnabled, onSetBrowserEnabled, onOpenExternal, onRefresh, onInstall, onInstallExtension, onConnectMcp, onSetMcpEnabled, onMutateCapability: onMutateCapabilityProp }: PluginsPageProps) {
  const { t } = useI18n()
  const onMutateCapability = onMutateCapabilityProp ?? (async () => ({ ok: false, output: t('page.plugins.capabilityUnavailable') }))
  const [tab, setTab] = useState<DirectoryTab>('plugins')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [addKind, setAddKind] = useState<AddKind | null>(null)
  const [source, setSource] = useState('')
  const [mcpName, setMcpName] = useState('')
  const [mcpCommand, setMcpCommand] = useState('')
  const [mcpArgs, setMcpArgs] = useState('')
  const [mcpScope, setMcpScope] = useState<McpScope>('user')
  const [result, setResult] = useState('')
  const [adding, setAdding] = useState(false)
  const [askUserUpdating, setAskUserUpdating] = useState(false)
  const [browserUpdating, setBrowserUpdating] = useState(false)
  const [capabilityUpdating, setCapabilityUpdating] = useState('')
  const [confirmDisable, setConfirmDisable] = useState<SkillRecord | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<SkillRecord | null>(null)
  const [capabilityAlert, setCapabilityAlert] = useState('')

  const visible = useMemo(() => skills.map((skill) => skill.id === 'gooeypi-ask-user'
    ? { ...skill, enabled: askUserEnabled }
    : skill.id === 'omp-work-browser' ? { ...skill, enabled: browserEnabled } : skill).filter((skill) => {
    const capability = skill.id === 'omp-work-browser' || skill.kind !== 'skill' && skill.kind !== 'prompt'
    return (tab === 'plugins' ? capability : !capability)
      && (filter === 'all' || filter === 'installed' && skill.enabled || filter === skill.location)
      && `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase())
  }), [askUserEnabled, browserEnabled, skills, tab, filter, query])

  const canAdd = addKind === 'bundle'
    ? Boolean(source.trim())
    : addKind === 'extension'
      ? Boolean(source.trim() && (mcpScope !== 'project' || activeProjectPath))
    : addKind === 'mcp' && Boolean(
      mcpName.trim()
      && mcpCommand.trim()
      && (mcpScope !== 'project' || activeProjectPath),
    )

  const add = async () => {
    if (!canAdd) return
    setAdding(true)
    setResult('')
    try {
      const response = addKind === 'bundle'
        ? await onInstall(source.trim())
        : addKind === 'extension'
          ? await onInstallExtension({ source: source.trim(), scope: mcpScope, projectPath: mcpScope === 'project' ? activeProjectPath : undefined })
          : await onConnectMcp({ name: mcpName.trim(), scope: mcpScope, projectPath: mcpScope === 'project' ? activeProjectPath : undefined, type: 'stdio', command: mcpCommand.trim(), args: mcpArgs.split('\n').map((arg) => arg.trim()).filter(Boolean) })
      setResult(response.output)
      if (response.ok) {
        setSource('')
        setMcpName('')
        setMcpCommand('')
        setMcpArgs('')
        if (addKind === 'mcp' || addKind === 'bundle') await onRefresh()
      }
    } finally {
      setAdding(false)
    }
  }

  const selectAddKind = (value: AddKind | null) => { setAddKind(value); setSource(''); setResult('') }
  const openAdd = () => { setResult(''); setAddKind(null); setAddOpen(true) }
  const setAskUser = async (enabled: boolean) => {
    if (askUserUpdating) return
    setAskUserUpdating(true)
    try {
      await onSetAskUserEnabled(enabled)
      await onRefresh()
    } finally {
      setAskUserUpdating(false)
    }
  }
  const setBrowser = async (enabled: boolean) => {
    if (browserUpdating) return
    setBrowserUpdating(true)
    try {
      await onSetBrowserEnabled(enabled)
      await onRefresh()
    } finally {
      setBrowserUpdating(false)
    }
  }
  const setMcp = async (skill: SkillRecord, enabled: boolean) => {
    if (capabilityUpdating) return
    setCapabilityUpdating(skill.id)
    setCapabilityAlert('')
    try {
      const response = await onSetMcpEnabled({ name: skill.name, scope: skill.location === 'project' ? 'project' : 'user', projectPath: skill.location === 'project' ? activeProjectPath : undefined, enabled })
      if (!response.ok) setCapabilityAlert(response.output)
    } finally {
      setCapabilityUpdating('')
    }
  }
  const disableCapability = async (skill: SkillRecord) => {
    setConfirmDisable(null)
    if (skill.id === 'gooeypi-ask-user') await setAskUser(false)
    else if (skill.id === 'omp-work-browser') await setBrowser(false)
    else if (skill.kind === 'mcp') await setMcp(skill, false)
    else if (skill.kind === 'package') await mutate(skill, 'disable')
  }
  const mutate = async (skill: SkillRecord, action: CapabilityMutationInput['action']) => {
    setCapabilityUpdating(skill.id)
    setCapabilityAlert('')
    try {
      const response = await onMutateCapability({
        kind: skill.kind === 'mcp' ? 'mcp' : 'package',
        action,
        name: skill.name,
        ...(skill.kind === 'mcp' && action === 'remove' && skill.definitionKey !== undefined ? { definitionKey: skill.definitionKey } : {}),
        ...(skill.kind === 'package' ? { source: skill.source } : {}),
        scope: skill.location === 'project' ? 'project' : 'user',
        projectPath: skill.location === 'project' ? activeProjectPath : undefined,
      })
      if (!response.ok) setCapabilityAlert(response.output)
    } finally {
      setCapabilityUpdating('')
    }
  }
  const removeCapability = async (skill: SkillRecord) => {
    setConfirmRemove(null)
    await mutate(skill, 'remove')
  }
  const mcpStatusDetail = (skill: SkillRecord): string | undefined => {
    if (skill.kind !== 'mcp') return undefined
    if (skill.availability?.available === false) return skill.availability.detail
    return undefined
  }
  const capabilityControl = (skill: SkillRecord) => {
    if (skill.kind === 'mcp' && skill.availability?.available === false) {
      const external = skill.availability.detail.includes('managed outside WorkDaddy')
      const label = external ? t('page.plugins.externallyManaged', { name: skill.name }) : t('page.plugins.unavailableName', { name: skill.name })
      return <span className="plugin-toggle" role="img" aria-label={label} aria-describedby={capabilityDetailId(skill)}><ShieldCheck aria-hidden="true" size={14}/></span>
    }
    const isBrowser = skill.id === 'omp-work-browser'
    const actionable = skill.id === 'gooeypi-ask-user' || isBrowser || skill.kind === 'mcp' || skill.kind === 'package'
    if (!actionable) return <span className={skill.enabled ? 'plugin-toggle is-enabled' : 'plugin-toggle'} aria-label={skill.enabled ? t('page.plugins.enabledName', { name: skill.name }) : t('page.plugins.unavailableName', { name: skill.name })}>{skill.enabled ? <Check size={14}/> : <Plus size={14}/>}</span>
    const updating = skill.id === 'gooeypi-ask-user' ? askUserUpdating
      : isBrowser ? browserUpdating
        : capabilityUpdating === skill.id
    const enable = () => {
      if (skill.id === 'gooeypi-ask-user') return setAskUser(true)
      if (isBrowser) return setBrowser(true)
      if (skill.kind === 'package') return mutate(skill, 'enable')
      return setMcp(skill, true)
    }
    return <button type="button" className={skill.enabled ? 'plugin-toggle is-enabled' : 'plugin-toggle'} aria-label={skill.enabled ? t('page.plugins.disableName', { name: skill.name }) : t('page.plugins.enableName', { name: skill.name })} aria-pressed={skill.enabled} disabled={updating} title={skill.availability?.detail} onClick={() => { if (skill.enabled) setConfirmDisable(skill); else void enable() }}>{updating ? <RefreshCw className="spin" size={14}/> : skill.enabled ? <><Check className="plugin-toggle__check" size={14}/><X className="plugin-toggle__disable" size={14}/></> : <Plus className="plugin-toggle__plus" size={14}/>}</button>
  }

  return (
    <div className="page plugin-page scroll-area">
      <div className="page-container plugin-container">
        <header className="plugin-header">
          <div><span className="eyebrow">{t('page.plugins.eyebrow', { name: HARNESS_SHORT_NAMES[harness] })}</span><h1>{t('page.plugins.title', { name: HARNESS_SHORT_NAMES[harness] })}</h1><p>{t('page.plugins.subtitle')}</p></div>
          <div>
            <button type="button" className="button" onClick={() => void onRefresh()}><RefreshCw className={loading ? 'spin' : ''} size={13}/> {t('page.plugins.refresh')}</button>
            <button type="button" className="button" onClick={() => setFilter('installed')}><Settings2 size={13}/> {t('page.plugins.manage')}</button>
            <button type="button" className="button button--primary" onClick={openAdd}><Plus size={14}/> {t('common.add')}</button>
          </div>
        </header>
        <div className="directory-tabs">
          <button type="button" className={tab === 'plugins' ? 'is-active' : ''} onClick={() => setTab('plugins')}>{t('nav.capabilities')}</button>
          <button type="button" className={tab === 'skills' ? 'is-active' : ''} onClick={() => setTab('skills')}>{t('nav.skills')}</button>
        </div>
        <div className="directory-tools">
          <label className="page-search"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'plugins' ? t('page.plugins.searchCapabilities') : t('page.plugins.searchSkills')}/></label>
          <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t('page.plugins.directoryFilterAria')}>
            <option value="all">{t('page.plugins.filter.all')}</option><option value="installed">{t('page.plugins.filter.installed')}</option><option value="bundled">{t('page.plugins.filter.bundled')}</option><option value="user">{t('page.plugins.filter.personal')}</option><option value="project">{t('page.plugins.filter.project')}</option><option value="system">{t('page.plugins.filter.system')}</option>
          </select>
        </div>
        {warnings.map((warning) => (
          <p key={`${warning.scope}:${warning.path}`} className="page-inline-error" role="alert">
            <AlertTriangle size={13} /> {warning.scope === 'project' ? t('page.plugins.filter.project') : t('page.plugins.filter.personal')} {warning.message} ({warning.path})
          </p>
        ))}
        {capabilityAlert ? <p className="page-inline-error" role="alert"><AlertTriangle size={13}/> {capabilityAlert}</p> : null}
        <p className="connection-warning"><ShieldCheck size={13}/> {NETWORK_MCP_UNAVAILABLE_DETAIL}</p>
        <div className="directory-heading"><h2>{filter === 'installed' ? t('page.plugins.installed') : tab === 'plugins' ? t('nav.capabilities') : t('nav.skills')}</h2><span>{t('page.plugins.shownCount', { count: visible.length })}</span></div>
        {visible.length ? (
          <div className="directory-list">{visible.map((skill) => {
            const statusDetail = mcpStatusDetail(skill)
            return <article key={skill.id}>
              <span className={`directory-icon directory-icon--${skill.kind}`}><SkillIcon skill={skill}/></span>
              <div><div><h3>{skill.name}</h3><span>{skill.location}</span></div><p id={statusDetail ? capabilityDetailId(skill) : undefined}>{skill.description}{statusDetail ? ` ${statusDetail}` : ''}</p></div>
              <div className="capability-actions">
                {skill.kind === 'package' || skill.kind === 'mcp' && skill.location !== 'bundled' && skill.location !== 'system' && skill.definitionRemovalAvailable !== false ? <button type="button" className="plugin-remove" aria-label={t('page.plugins.removeName', { name: skill.name })} disabled={capabilityUpdating === skill.id} onClick={() => setConfirmRemove(skill)}><Trash2 size={13}/></button> : null}
                {capabilityControl(skill)}
              </div>
            </article>
          })}</div>
        ) : <EmptyState icon={<Sparkles size={23}/>} title={t('page.plugins.emptyTitle')}>{t('page.plugins.emptyBody', { name: HARNESS_SHORT_NAMES[harness] })}</EmptyState>}

        {confirmDisable ? <Modal title={t('page.plugins.confirmDisable.title', { name: confirmDisable.name })} onClose={() => setConfirmDisable(null)} footer={<><button type="button" className="button" onClick={() => setConfirmDisable(null)}>{t('common.cancel')}</button><button type="button" className="button button--danger" onClick={() => void disableCapability(confirmDisable)}>{t('page.plugins.confirmDisable.confirm')}</button></>}><p className="modal-intro">{t('page.plugins.confirmDisable.body')}</p></Modal> : null}
        {confirmRemove ? <Modal title={t('page.plugins.confirmRemove.title', { name: confirmRemove.name })} onClose={() => setConfirmRemove(null)} footer={<><button type="button" className="button" onClick={() => setConfirmRemove(null)}>{t('common.cancel')}</button><button type="button" className="button button--danger" onClick={() => void removeCapability(confirmRemove)}>{t('page.plugins.confirmRemove.confirm')}</button></>}><p className="modal-intro">{t('page.plugins.confirmRemove.body', { detail: confirmRemove.kind === 'mcp' ? t('page.plugins.confirmRemove.detailMcp') : t('page.plugins.confirmRemove.detailPackage') })}</p></Modal> : null}

        {addOpen ? (
          <Modal
            title={addKind ? (addKind === 'mcp' ? t('page.plugins.addTitle.mcp') : addKind === 'extension' ? t('page.plugins.addTitle.extension') : t('page.plugins.addTitle.package', { label: t(PACKAGE_LABEL_KEYS[harness]).toLowerCase() })) : t('page.plugins.addTitle.generic', { name: HARNESS_SHORT_NAMES[harness] })}
            onClose={() => setAddOpen(false)}
            footer={addKind
              ? <><button type="button" className="button" onClick={() => selectAddKind(null)}><ArrowLeft size={13}/> {t('common.back')}</button><button type="button" className="button button--primary" disabled={!canAdd || adding} onClick={() => void add()}>{adding ? (addKind === 'mcp' ? t('page.plugins.saving') : t('page.plugins.installing')) : (addKind === 'mcp' ? t('page.plugins.saveLocalServer') : addKind === 'extension' ? t('page.plugins.installExtension') : t('page.plugins.installPlugin'))}</button></>
              : <button type="button" className="button" onClick={() => setAddOpen(false)}>{t('common.cancel')}</button>}
          >
            {addKind === null ? (
              <div className="capability-choice-list">
                <button type="button" onClick={() => selectAddKind('mcp')}>
                  <span><Globe2 size={17}/></span><span><strong>{t('page.plugins.choice.mcp.title')}</strong><small>{t('page.plugins.choice.mcp.desc')}</small></span><ChevronRight size={15}/>
                </button>
                <button type="button" onClick={() => selectAddKind('bundle')}>
                  <span><Package size={17}/></span><span><strong>{t('page.plugins.choice.bundle.title')}</strong><small>{t(PACKAGE_HELP_KEYS[harness])}</small></span><ChevronRight size={15}/>
                </button>
                <button type="button" onClick={() => selectAddKind('extension')}>
                  <span><FileCode2 size={17}/></span><span><strong>{t('page.plugins.choice.extension.title')}</strong><small>{t('page.plugins.choice.extension.desc', { name: HARNESS_SHORT_NAMES[harness] })}</small></span><ChevronRight size={15}/>
                </button>
                <p className="capability-compatibility-note"><AlertTriangle size={13}/><span>{t('page.plugins.compatNote.text')} <button type="button" onClick={() => onOpenExternal(GITHUB_ISSUES_URL)}>{t('page.plugins.compatNote.link')}</button>.</span></p>
              </div>
            ) : addKind === 'bundle' ? (
              <div className="add-tool-form">
                <p className="modal-intro">{t(PACKAGE_HELP_KEYS[harness])} {t('page.plugins.bundle.notMcpNote')}</p>
                <label className="field"><span>{t('page.plugins.bundle.sourceLabel', { label: t(PACKAGE_LABEL_KEYS[harness]) })}</span><input autoFocus value={source} onChange={(event) => setSource(event.target.value)} placeholder="plugin-name@marketplace"/></label>
                <small className="field-help">{t('page.plugins.bundle.examplesPrefix')} <code>name@marketplace</code>{t('page.plugins.bundle.examplesSuffix')}</small>
              </div>
            ) : addKind === 'extension' ? (
              <div className="add-tool-form">
                <p className="modal-intro">{t('page.plugins.extension.intro')}</p>
                <label className="field"><span>{t('page.plugins.extension.fileLabel')}</span><input autoFocus value={source} onChange={(event) => setSource(event.target.value)} placeholder="/absolute/path/to/my-extension.ts"/></label>
                <small className="field-help">{t('page.plugins.extension.fileHelpPrefix')} <code>.ts</code>, <code>.js</code>, <code>.mjs</code>, {t('page.plugins.extension.fileHelpOr')} <code>.cjs</code> {t('page.plugins.extension.fileHelpSuffix')}</small>
                <label className="field"><span>{t('page.plugins.availableIn')}</span><select value={mcpScope} onChange={(event) => setMcpScope(event.target.value as McpScope)}><option value="user">{t('page.plugins.scope.allProjects')}</option><option value="project" disabled={!activeProjectPath}>{t('page.plugins.scope.currentProject')}</option></select></label>
                <p className="connection-warning"><ShieldCheck size={13}/> {t('page.plugins.extension.warning')}</p>
              </div>
            ) : (
              <div className="add-tool-form">
                <p className="modal-intro">{t('page.plugins.mcp.intro')}</p>
                <label className="field"><span>{t('page.plugins.mcp.serverNameLabel')}</span><input autoFocus value={mcpName} onChange={(event) => setMcpName(event.target.value)} placeholder="my-local-tools"/></label>
                <p className="field-help">{t(MCP_STDIO_HELP_KEYS[harness])}</p>
                <label className="field"><span>{t('page.plugins.mcp.executableLabel')}</span><input value={mcpCommand} onChange={(event) => setMcpCommand(event.target.value)} placeholder="npx"/></label>
                <label className="field"><span>{t('page.plugins.mcp.argumentsLabel')} <small>{t('page.plugins.mcp.onePerLine')}</small></span><textarea value={mcpArgs} onChange={(event) => setMcpArgs(event.target.value)} rows={3} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path/to/project'}/></label>
                <label className="field"><span>{t('page.plugins.availableIn')}</span><select value={mcpScope} onChange={(event) => setMcpScope(event.target.value as McpScope)}><option value="user">{t('page.plugins.scope.allProjects')}</option><option value="project" disabled={!activeProjectPath}>{t('page.plugins.scope.currentProject')}</option></select></label>
                <p className="connection-warning"><ShieldCheck size={13}/> {t('page.plugins.mcp.warning')}</p>
              </div>
            )}
            {result ? <pre className="install-output" role="status">{result}</pre> : null}
          </Modal>
        ) : null}
      </div>
    </div>
  )
}
