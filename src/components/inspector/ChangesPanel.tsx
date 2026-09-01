import { ArrowDownToLine, File, FileCode2, GitBranch, LoaderCircle, RefreshCw, Sparkles, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import type { GitStatus } from '@/types/api'
import { boundLines } from '@/lib/render-bounds'
import { EmptyState, IconButton, Modal, Segmented } from '../ui'

const MAX_RENDERED_DIFF_CHARACTERS = 2 * 1024 * 1024
const MAX_RENDERED_DIFF_LINES = 4_000

function generateCommitSummary(files: GitStatus['files']): string {
  const staged = files.filter((file) => file.staged)
  if (!staged.length) return ''
  const verbs = new Set(staged.map((file) => file.status[0]))
  const verb = verbs.size === 1 && verbs.has('A') ? 'Add' : verbs.size === 1 && verbs.has('D') ? 'Remove' : 'Update'
  const names = staged.map((file) => file.path)
  const description = names.length <= 3 ? names.join(', ').replace(/, ([^,]*)$/, names.length === 2 ? ' and $1' : ', and $1') : `${names.length} files`
  return `${verb} ${description}`
}

function DiffView({ text }: { text: string }) {
  const { t } = useI18n()
  if (!text) return <div className="diff-placeholder"><FileCode2 size={22} /><span>{t('inspector.changes.diffPlaceholder')}</span></div>
  const { lines, truncated } = boundLines(text, MAX_RENDERED_DIFF_CHARACTERS, MAX_RENDERED_DIFF_LINES)
  return <pre className="diff-view">{lines.map((line, index) => <span key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'diff-line diff-line--add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-line diff-line--remove' : line.startsWith('@@') ? 'diff-line diff-line--hunk' : 'diff-line'}><i>{index + 1}</i><code>{line || ' '}</code></span>)}{truncated ? <span className="diff-line diff-line--truncated"><i>…</i><code>{t('inspector.changes.diffTruncated')}</code></span> : null}</pre>
}

export function ChangesPanel({ cwd, git, onRefreshGit }: { cwd?: string; git: GitStatus; onRefreshGit(): Promise<void> | void }) {
  const { t } = useI18n()
  const [scope, setScope] = useState<'unstaged' | 'staged'>('unstaged')
  const [selectedPath, setSelectedPath] = useState<string | undefined>(git.files[0]?.path)
  const [diff, setDiff] = useState('')
  const [loading, setLoading] = useState(false)
  const [commitOpen, setCommitOpen] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const visibleFiles = git.files.filter((file) => scope === 'staged' ? file.staged : !file.staged)
  const activeSelectedPath = visibleFiles.some((file) => file.path === selectedPath) ? selectedPath : undefined

  useEffect(() => {
    if (!visibleFiles.some((file) => file.path === selectedPath)) setSelectedPath(visibleFiles[0]?.path)
  }, [git.files, scope, selectedPath])

  useEffect(() => {
    if (!cwd || !activeSelectedPath || !window.prime) {
      setDiff(activeSelectedPath ? `diff --git a/${activeSelectedPath} b/${activeSelectedPath}
--- a/${activeSelectedPath}
+++ b/${activeSelectedPath}
@@ -18,3 +18,6 @@
 const workspace = createWorkspace()
+workspace.open()
+workspace.focus()
 return workspace` : '')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    window.prime.git.diff(cwd, activeSelectedPath, scope === 'staged').then((value) => { if (!cancelled) setDiff(value.text) }).catch(() => { if (!cancelled) setDiff(t('inspector.changes.diffLoadError')) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cwd, activeSelectedPath, scope])

  const mutate = async (kind: 'stage' | 'unstage' | 'restore', paths: string[]): Promise<boolean> => {
    if (!cwd || !window.prime) return false
    setActionError('')
    try {
      const ok = kind === 'stage'
        ? await window.prime.git.stage(cwd, paths)
        : kind === 'unstage'
          ? await window.prime.git.unstage(cwd, paths)
          : await window.prime.git.restore(cwd, paths)
      if (!ok) {
        const action = kind === 'stage' ? t('inspector.changes.actionStageVerb') : kind === 'unstage' ? t('inspector.changes.actionUnstageVerb') : t('inspector.changes.actionRestoreVerb')
        throw new Error(t('inspector.changes.mutateError', { action, count: paths.length }))
      }
      await onRefreshGit()
      return true
    } catch (error) {
      setActionError(errorMessage(error))
      return false
    }
  }

  const fillCommitSummary = () => {
    setActionError('')
    setCommitMessage(generateCommitSummary(git.files))
  }

  const commit = async () => {
    if (!cwd || !commitMessage.trim() || !window.prime) return
    setActionError('')
    try {
      const result = await window.prime.git.commit(cwd, commitMessage.trim())
      if (!result.ok) throw new Error(result.output || t('inspector.changes.commitError'))
      setCommitOpen(false); setCommitMessage(''); await onRefreshGit()
    } catch (error) { setActionError(errorMessage(error)) }
  }

  if (!git.isRepo) return <EmptyState icon={<GitBranch size={24} />} title={t('inspector.changes.noRepoTitle')}>{t('inspector.changes.noRepoBody')}</EmptyState>
  if (git.error) {
    return <EmptyState
      icon={<GitBranch size={24} />}
      title={t('inspector.changes.statusUnavailableTitle')}
      action={<button type="button" className="button" onClick={() => void onRefreshGit()}><RefreshCw size={13} /> {t('inspector.changes.tryAgain')}</button>}
    >{git.error}</EmptyState>
  }
  return (
    <div className="changes-panel">
      <div className="changes-toolbar">
        <div><strong><GitBranch size={13} /> {git.branch ?? t('inspector.changes.repositoryFallback')}</strong>{git.ahead ? <small>{t('inspector.changes.aheadCount', { count: git.ahead })}</small> : null}</div>
        <IconButton label={t('inspector.changes.refresh')} onClick={() => void onRefreshGit()}><RefreshCw size={14} /></IconButton>
      </div>
      <div className="changes-scopes"><Segmented value={scope} label={t('inspector.changes.diffScopeAria')} options={[{ value: 'unstaged', label: t('inspector.changes.unstaged') }, { value: 'staged', label: t('inspector.changes.staged') }]} onChange={(value) => { setActionError(''); setScope(value as 'unstaged' | 'staged') }} /><button type="button" className="button button--compact" disabled={!git.files.some((file) => file.staged)} onClick={() => setCommitOpen(true)}>{t('inspector.changes.commitButton')}</button></div>
      {actionError ? <p className="changes-error" role="alert">{actionError}</p> : null}
      <div className="changes-body">
        <div className="file-changes scroll-area">
          <div className="file-changes__header"><span>{t('inspector.changes.changedCount', { count: visibleFiles.length })}</span>{visibleFiles.length ? <button type="button" onClick={() => void mutate(scope === 'staged' ? 'unstage' : 'stage', visibleFiles.map((file) => file.path))}>{scope === 'staged' ? t('inspector.changes.unstageAll') : t('inspector.changes.stageAll')}</button> : null}</div>
          {visibleFiles.map((file) => <button type="button" key={file.path} className={selectedPath === file.path ? 'is-selected' : ''} onClick={() => setSelectedPath(file.path)}><File size={13} /><span title={file.path}>{file.path}</span><small className="additions">+{file.additions}</small><small className="deletions">−{file.deletions}</small><span className="file-status">{file.status}</span></button>)}
          {visibleFiles.length === 0 ? <p className="file-changes__empty">{scope === 'staged' ? t('inspector.changes.noStagedChanges') : t('inspector.changes.noUnstagedChanges')}</p> : null}
        </div>
        <div className="diff-pane scroll-area">
          {selectedPath ? <div className="diff-header"><div><FileCode2 size={13} /><span>{selectedPath}</span></div><div>{scope === 'unstaged' ? <button type="button" onClick={() => void mutate('stage', [selectedPath])}><ArrowDownToLine size={12} /> {t('inspector.changes.stage')}</button> : <button type="button" onClick={() => void mutate('unstage', [selectedPath])}><Undo2 size={12} /> {t('inspector.changes.unstage')}</button>}<button type="button" className="danger-action" onClick={() => setConfirmUndo(selectedPath)}><Undo2 size={12} /> {t('inspector.changes.undoChanges')}</button></div></div> : null}
          {loading ? <div className="diff-loading"><LoaderCircle className="spin" size={15} /> {t('inspector.changes.loadingDiff')}</div> : <DiffView text={diff} />}
        </div>
      </div>
      {commitOpen ? <Modal title={t('inspector.changes.commitModalTitle')} onClose={() => setCommitOpen(false)} footer={<><button className="button" type="button" onClick={() => setCommitOpen(false)}>{t('common.cancel')}</button><button className="button button--primary" type="button" disabled={!commitMessage.trim()} onClick={() => void commit()}>{t('inspector.changes.commitChangesButton')}</button></>}><label className="field"><span>{t('inspector.changes.commitMessageLabel')}</span><div className="commit-message-input"><input autoFocus value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder={t('inspector.changes.commitMessagePlaceholder')} /><button type="button" className="button button--compact" onClick={fillCommitSummary} title={t('inspector.changes.generateSummaryTitle')}><Sparkles size={13} /> {t('inspector.changes.generateSummaryButton')}</button></div></label><p className="muted-copy">{t('inspector.changes.commitOnBranch', { branch: git.branch ?? '' })}</p></Modal> : null}
      {confirmUndo ? <Modal title={t('inspector.changes.undoModalTitle')} onClose={() => setConfirmUndo(null)} footer={<><button className="button" type="button" onClick={() => setConfirmUndo(null)}>{t('common.cancel')}</button><button className="button button--danger" type="button" onClick={() => { const path = confirmUndo; void mutate('restore', [path]).then((ok) => { if (ok) setConfirmUndo(null) }) }}>{t('inspector.changes.undoChanges')}</button></>}><p>{t('inspector.changes.undoModalBody', { path: confirmUndo })}</p></Modal> : null}
    </div>
  )
}
