import { memo, useMemo } from 'react'
import { Check, CircleDot, GitBranch, LoaderCircle } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { GitStatus, ProjectRecord, RuntimeInfo, TranscriptMessage } from '@/types/api'
import { MarkdownText } from '../MarkdownText'

interface SummaryPanelProps {
  /** Active harness agent name ("Prime Agent" / "OMP"). */
  agentName?: string
  /** Short harness name for working copy ("Prime" / "OMP"). */
  shortName?: string
  project?: ProjectRecord
  runtime?: RuntimeInfo | null
  messages: TranscriptMessage[]
  git: GitStatus
}

export interface TranscriptSummary {
  toolCount: number
  lastText?: string
}

/** One pass for the tool count; one reverse walk that stops at the first text part. */
export function summarizeTranscript(messages: TranscriptMessage[]): TranscriptSummary {
  let toolCount = 0
  for (const message of messages) {
    for (const part of message.parts) if (part.type === 'toolCall') toolCount += 1
  }
  let lastText: string | undefined
  for (let index = messages.length - 1; index >= 0 && lastText === undefined; index -= 1) {
    const parts = messages[index].parts
    for (let cursor = parts.length - 1; cursor >= 0; cursor -= 1) {
      const part = parts[cursor]
      if (part.type === 'text') {
        lastText = part.text
        break
      }
    }
  }
  return { toolCount, lastText }
}

export const SummaryPanel = memo(function SummaryPanel({ agentName = 'Prime Agent', shortName = 'Prime', project, runtime, messages, git }: SummaryPanelProps) {
  const { t } = useI18n()
  const { toolCount, lastText } = useMemo(() => summarizeTranscript(messages), [messages])
  const active = Boolean(runtime?.isStreaming || runtime?.isCompacting)
  return (
    <div className="inspector-scroll scroll-area summary-panel">
      <section className="summary-hero">
        <span className={`run-state ${active ? 'is-running' : ''}`}>{active ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}{runtime?.isCompacting ? t('inspector.summary.compactingContext') : active ? t('inspector.summary.agentWorking', { name: shortName }) : t('inspector.summary.ready')}</span>
        <h2>{runtime?.isCompacting ? t('inspector.summary.compactingHeading') : active ? t('inspector.summary.workingHeading') : t('inspector.summary.overviewHeading')}</h2>
        <MarkdownText text={lastText !== undefined ? lastText.slice(0, 220) : t('inspector.summary.emptyText')} />
      </section>
      <section className="summary-section"><h3>{t('inspector.summary.workspaceHeading')}</h3><dl className="detail-list"><div><dt>{t('inspector.summary.projectLabel')}</dt><dd>{project?.name ?? t('inspector.summary.noProject')}</dd></div><div><dt>{t('inspector.summary.branchLabel')}</dt><dd><GitBranch size={12} />{git.branch ?? project?.gitBranch ?? '—'}</dd></div><div><dt>{t('inspector.summary.environmentLabel')}</dt><dd>{t('inspector.summary.environmentLocal')}</dd></div><div><dt>{t('inspector.summary.workingDirectoryLabel')}</dt><dd title={project?.primaryFolder} className="mono truncate">{project?.primaryFolder ?? '—'}</dd></div></dl></section>
      <section className="summary-section"><h3>{t('inspector.summary.progressHeading')}</h3><div className="progress-list"><div><Check size={13} /><span>{t('inspector.summary.loadedContext')}</span></div><div><Check size={13} /><span>{t('inspector.summary.toolCallsRecorded', { count: toolCount })}</span></div><div className={git.files.length ? 'is-current' : ''}><CircleDot size={13} /><span>{git.files.length ? t('inspector.summary.filesReadyToReview', { count: git.files.length }) : git.isRepo ? t('inspector.summary.noUncommittedChanges') : t('inspector.summary.noGitRepo')}</span></div></div></section>
      <section className="summary-section"><h3>{t('inspector.summary.contextHeading')}</h3><div className="context-meter"><div><span>{t('inspector.summary.sessionContextLabel')}</span><span>{t('inspector.summary.managedLabel')}</span></div><small>{t('inspector.summary.contextManagedBy', { agentName })}</small></div></section>
    </div>
  )
})
