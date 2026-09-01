import { AlertTriangle, ChevronRight, File, FileText, Folder, FolderOpen, RefreshCw, Search, WandSparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { HarnessId, PluginWarning, SkillDocument, SkillRecord } from '@/types/api'
import { HARNESS_SHORT_NAMES } from '@/lib/harness'
import { EmptyState, Modal } from '@/components/ui'
import { MarkdownText } from '@/components/MarkdownText'
import { useI18n, type MessageKey } from '@/lib/i18n'

type LocationFilter = 'all' | SkillRecord['location']
const LOCATION_ORDER: SkillRecord['location'][] = ['project', 'user', 'bundled', 'system']
const LOCATION_LABEL_KEYS: Record<SkillRecord['location'], MessageKey> = {
  project: 'page.skills.location.project',
  user: 'page.skills.location.personal',
  bundled: 'page.skills.location.bundled',
  system: 'page.skills.location.system',
}

interface SkillsPageProps {
  harness: HarnessId
  skills: SkillRecord[]
  warnings: PluginWarning[]
  loading: boolean
  onRefresh(): Promise<void>
  onReveal(path: string): void
  onReadDocument(path: string): Promise<SkillDocument>
}

export function SkillsPage({ harness, skills, warnings, loading, onRefresh, onReveal, onReadDocument }: SkillsPageProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('all')
  const [selected, setSelected] = useState<SkillRecord | null>(null)

  const matching = useMemo(() => skills.filter((skill) => (skill.kind === 'skill' || skill.kind === 'prompt') && skill.id !== 'omp-work-browser'), [skills])

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const skill of matching) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1)
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name))
  }, [matching])

  const normalizedQuery = query.trim().toLowerCase()
  const visible = useMemo(() => matching.filter((skill) => (locationFilter === 'all' || skill.location === locationFilter)
    && (!normalizedQuery || `${skill.name} ${skill.description}`.toLowerCase().includes(normalizedQuery))), [matching, locationFilter, normalizedQuery])

  const groups = useMemo(() => LOCATION_ORDER
    .map((location) => ({ location, items: visible.filter((skill) => skill.location === location) }))
    .filter((group) => group.items.length > 0), [visible])

  return (
    <div className="page scroll-area">
      <div className="page-container">
        <header className="page-header">
          <div><span className="eyebrow">{t('page.skills.eyebrow', { name: HARNESS_SHORT_NAMES[harness] })}</span><h1>{t('nav.skills')}</h1><p>{t('page.skills.subtitle', { name: HARNESS_SHORT_NAMES[harness] })}</p></div>
          <button type="button" className="button" onClick={() => void onRefresh()}><RefreshCw className={loading ? 'spin' : ''} size={13}/> {t('page.skills.refresh')}</button>
        </header>
        <div className="page-tools">
          <label className="page-search"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('page.skills.searchPlaceholder')}/></label>
          <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value as LocationFilter)} aria-label={t('page.skills.sourceAria')}>
            <option value="all">{t('page.skills.filter.all')}</option>
            <option value="project">{t(LOCATION_LABEL_KEYS.project)}</option>
            <option value="user">{t(LOCATION_LABEL_KEYS.user)}</option>
            <option value="bundled">{t(LOCATION_LABEL_KEYS.bundled)}</option>
            <option value="system">{t(LOCATION_LABEL_KEYS.system)}</option>
          </select>
        </div>
        {warnings.map((warning) => (
          <p key={`${warning.scope}:${warning.path}`} className="page-inline-error" role="alert">
            <AlertTriangle size={13} /> {warning.scope === 'project' ? t(LOCATION_LABEL_KEYS.project) : t(LOCATION_LABEL_KEYS.user)} {warning.message} ({warning.path})
          </p>
        ))}
        {groups.length ? groups.map((group) => (
          <section key={group.location} className="skill-group">
            <div className="skill-group__heading"><h2>{t(LOCATION_LABEL_KEYS[group.location])}</h2><span>{group.items.length}</span></div>
            <div className="skill-list">{group.items.map((skill) => (
              <button type="button" key={skill.id} className="skill-row" onClick={() => setSelected(skill)}>
                <span className="skill-row__icon">{skill.kind === 'prompt' ? <FileText size={16}/> : <WandSparkles size={16}/>}</span>
                <span className="skill-row__body">
                  <span className="skill-row__title"><strong>{skill.name}</strong>{duplicateNames.has(skill.name) ? <span className="skill-row__duplicate" title={t('page.skills.duplicateTitle')}><AlertTriangle size={11}/> {t('page.skills.duplicateLabel')}</span> : null}</span>
                  <small>{skill.description}</small>
                </span>
                <ChevronRight size={15}/>
              </button>
            ))}</div>
          </section>
        )) : <EmptyState icon={<WandSparkles size={23}/>} title={t('page.skills.emptyTitle')}>{normalizedQuery || locationFilter !== 'all' ? t('page.skills.emptyBody.filtered') : t('page.skills.emptyBody.default')}</EmptyState>}
      </div>
      {selected ? <SkillDetailModal skill={selected} onClose={() => setSelected(null)} onReveal={onReveal} onReadDocument={onReadDocument} /> : null}
    </div>
  )
}

function SkillDetailModal({ skill, onClose, onReveal, onReadDocument }: { skill: SkillRecord; onClose(): void; onReveal(path: string): void; onReadDocument(path: string): Promise<SkillDocument> }) {
  const { t } = useI18n()
  const [document, setDocument] = useState<SkillDocument | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setDocument(null)
    if (!skill.path) { setLoading(false); setError(t('page.skills.detail.noFile')); return }
    onReadDocument(skill.path)
      .then((doc) => { if (!cancelled) setDocument(doc) })
      .catch((thrown) => { if (!cancelled) setError(thrown instanceof Error ? thrown.message : t('page.skills.detail.readError')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [skill.path, onReadDocument, t])

  const nestedWarnings = document?.files.filter((file) => file.hasNestedSkill) ?? []

  return (
    <Modal title={skill.name} onClose={onClose} footer={skill.path ? <button type="button" className="button" onClick={() => onReveal(skill.path!)}><FolderOpen size={13}/> {t('page.skills.detail.reveal')}</button> : undefined}>
      {loading ? <p className="settings-empty">{t('common.loading')}</p>
        : error ? <p className="page-inline-error" role="alert"><AlertTriangle size={13}/> {error}</p>
        : document ? (
          <div className="skill-detail">
            <dl className="skill-detail__meta">
              <div><dt>{t('page.skills.detail.description')}</dt><dd>{document.frontmatter.description || skill.description || '—'}</dd></div>
              {document.frontmatter.globs ? <div><dt>{t('page.skills.detail.globs')}</dt><dd className="mono">{document.frontmatter.globs}</dd></div> : null}
              {document.frontmatter.alwaysApply ? <div><dt>{t('page.skills.detail.alwaysApply')}</dt><dd>{document.frontmatter.alwaysApply}</dd></div> : null}
              {document.frontmatter.disableModelInvocation ? <div><dt>{t('page.skills.detail.disableModelInvocation')}</dt><dd>{document.frontmatter.disableModelInvocation}</dd></div> : null}
            </dl>
            {nestedWarnings.length ? (
              <p className="page-inline-error" role="alert">
                <AlertTriangle size={13}/> {t('page.skills.detail.nestedWarningPrefix', { names: nestedWarnings.map((file) => file.name).join(', '), count: nestedWarnings.length })} <code>skills/{skill.name}/SKILL.md</code> {t('page.skills.detail.nestedWarningSuffix')}
              </p>
            ) : null}
            {document.body.trim() ? <div className="skill-detail__body"><MarkdownText text={document.body} /></div> : null}
            {document.truncated ? <p className="skill-detail__truncated">{t('page.skills.detail.truncated')}</p> : null}
            {document.files.length ? (
              <div className="skill-detail__files">
                <h3>{t('page.skills.detail.files')}</h3>
                <ul>{document.files.map((file) => (
                  <li key={file.name}>
                    {file.isDirectory ? <Folder size={13}/> : <File size={13}/>} {file.name}
                    {file.hasNestedSkill ? <AlertTriangle size={11} className="skill-detail__nested-warning" aria-label={t('page.skills.detail.nestedFileAria')}/> : null}
                  </li>
                ))}</ul>
              </div>
            ) : null}
          </div>
        ) : null}
    </Modal>
  )
}
