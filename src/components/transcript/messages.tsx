import { Fragment, memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, Target, WandSparkles } from 'lucide-react'
import type { HarnessId, MessagePart, SkillRecord, TranscriptMessage } from '@/types/api'
import { splitAnnotationBlock } from '@/lib/browser-annotations'
import { splitCapabilityRouting } from '@/lib/capability-mentions'
import { routedSessionReferences, splitSessionRouting, type RoutedSessionReference } from '@/lib/session-mentions'
import { splitTerminalContextBlock } from '@/lib/terminal-context'
import { writeClipboardText } from '@/lib/clipboard'
import { boundText } from '@/lib/render-bounds'
import { HARNESS_SHORT_NAMES } from '@/lib/harness'
import { detectSkillHits } from '@/lib/skill-hits'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { MarkdownText } from '../MarkdownText'
import { OmpMark } from '../ui'
import { InlineText } from './syntax'
import { TranscriptImage } from './TranscriptImage'
import { ThinkingDots, WorkDisclosure, WorkTimeline } from './timeline'

type TFunction = ReturnType<typeof useI18n>['t']

function imageSource(part: Extract<MessagePart, { type: 'image' }>): string | undefined {
  if (part.dataTruncated || !part.data || !part.mimeType || !/^image\/(png|jpeg|gif|webp)$/i.test(part.mimeType) || !/^[a-z\d+/=\s]+$/i.test(part.data)) return undefined
  return `data:${part.mimeType};base64,${part.data.replace(/\s/g, '')}`
}

function renderImage(part: Extract<MessagePart, { type: 'image' }>, key: string, t: TFunction) {
  const source = imageSource(part)
  return source ? (
    <TranscriptImage key={key} source={source} alt={t('transcript.userAttachmentAlt')} />
  ) : (
    <div key={key} className="image-part image-part--unavailable">
      {t('transcript.imageUnavailable')}
    </div>
  )
}

function renderNarrative(parts: MessagePart[], keyPrefix: string, t: TFunction, streaming = false) {
  return parts.map((part, index) => {
    if (part.type === 'text') return <MarkdownText key={`${keyPrefix}-${index}`} text={part.text} streaming={streaming} />
    if (part.type === 'image') return renderImage(part, `${keyPrefix}-${index}`, t)
    return null
  })
}

function renderNarrativeWithActivity(parts: MessagePart[], keyPrefix: string, t: TFunction, showReasoning: boolean, showTools: boolean, streaming = false) {
  const groups: Array<{ activity: boolean; parts: MessagePart[] }> = []
  for (const part of parts) {
    const activity = part.type !== 'text' && part.type !== 'image'
    const current = groups.at(-1)
    if (current?.activity === activity) current.parts.push(part)
    else groups.push({ activity, parts: [part] })
  }
  return groups.map((group, index) =>
    group.activity ? (
      <WorkTimeline key={`${keyPrefix}-activity-${index}`} parts={group.parts} showReasoning={showReasoning} showTools={showTools} streaming={streaming} />
    ) : (
      <div key={`${keyPrefix}-narrative-${index}`}>{renderNarrative(group.parts, `${keyPrefix}-${index}`, t, streaming)}</div>
    ),
  )
}

function messageText(message: TranscriptMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

const COPY_MESSAGE_ARIA_KEYS = {
  assistant: 'transcript.copyMessageAria.assistant',
  agent: 'transcript.copyMessageAria.agent',
  user: 'transcript.copyMessageAria.user',
} satisfies Record<'assistant' | 'agent' | 'user', MessageKey>

function MessageActions({ message, text: suppliedText }: { message: TranscriptMessage; text?: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<number | null>(null)
  const text = suppliedText ?? messageText(message)
  const role = message.role === 'assistant' ? 'assistant' : message.role === 'agent' ? 'agent' : 'user'

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
    },
    [],
  )

  if (!text) return null

  const copyMessage = async () => {
    try {
      await writeClipboardText(text)
      setCopied(true)
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="message-actions">
      <button type="button" disabled={!text} aria-label={t(COPY_MESSAGE_ARIA_KEYS[role], { action: copied ? t('common.copied') : t('common.copy') })} onClick={() => void copyMessage()}>
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? t('common.copied') : t('common.copy')}
      </button>
    </div>
  )
}

const HARNESS_MARKS = { omp: OmpMark } satisfies Record<HarnessId, unknown>

function AssistantHarnessMark({ harness, size = 24 }: { harness: HarnessId; size?: number }) {
  const Mark = HARNESS_MARKS[harness]
  return <Mark size={size} />
}

function SkillHitCard({ skills }: { skills: SkillRecord[] }) {
  const { t } = useI18n()
  if (!skills.length) return null
  return (
    <div className="skill-hit-card" title={t('transcript.skillHit.tooltip')}>
      <WandSparkles size={12} />
      <span>{t('transcript.skillHit.possiblyUsed', { names: skills.map((skill) => skill.name).join(', ') })}</span>
    </div>
  )
}

export const AssistantMessage = memo(
  function AssistantMessage({ message, harness = 'omp', showReasoning, showTools, skills = [] }: { message: TranscriptMessage; harness?: HarnessId; showReasoning: boolean; showTools: boolean; skills?: SkillRecord[] }) {
    const { t } = useI18n()
    const skillHits = useMemo(() => detectSkillHits(message.parts, skills), [message.parts, skills])
    const isActivity = (part: MessagePart) => part.type === 'thinking' || part.type === 'toolCall' || part.type === 'toolResult' || part.type === 'agentMessage' || part.type === 'compaction'
    const isCoreActivity = (part: MessagePart) => part.type === 'thinking' || part.type === 'toolCall' || part.type === 'toolResult' || part.type === 'compaction'
    const firstActivity = message.parts.findIndex(isActivity)
    let lastActivity = -1
    let lastCoreActivity = -1
    for (let index = message.parts.length - 1; index >= 0; index -= 1) {
      if (lastActivity < 0 && isActivity(message.parts[index])) lastActivity = index
      if (isCoreActivity(message.parts[index])) {
        lastCoreActivity = index
        break
      }
    }
    const finalNarrative = lastCoreActivity < 0 ? -1 : message.parts.findIndex((part, index) => index > lastCoreActivity && (part.type === 'text' || part.type === 'image'))
    const workEnd = finalNarrative >= 0 ? finalNarrative : lastActivity + 1
    const before = firstActivity < 0 ? message.parts : message.parts.slice(0, firstActivity)
    const work = firstActivity < 0 ? [] : message.parts.slice(firstActivity, workEnd)
    const after = firstActivity < 0 ? [] : message.parts.slice(workEnd)
    const hasVisibleActivity = work.some(
      (part) => part.type === 'agentMessage' || part.type === 'compaction' || (part.type === 'thinking' && showReasoning) || ((part.type === 'toolCall' || part.type === 'toolResult') && showTools),
    )
    const hiddenMiddleNarrative = !hasVisibleActivity ? work.filter((part) => part.type === 'text' || part.type === 'image') : []
    const copyableNarrative = hasVisibleActivity ? [...before, ...after] : [...before, ...hiddenMiddleNarrative, ...after]
    const copyableText = copyableNarrative.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
    return (
      <article className="message message--assistant">
        <div className="assistant-mark">
          <AssistantHarnessMark harness={harness} />
        </div>
        <div className="message__content">
          {!message.streaming ? <SkillHitCard skills={skillHits} /> : null}
          {renderNarrative(before, 'before', t, message.streaming)}
          {hasVisibleActivity ? (
            <WorkDisclosure message={message} parts={work} showReasoning={showReasoning} showTools={showTools} />
          ) : (
            renderNarrative(hiddenMiddleNarrative, 'middle', t, message.streaming)
          )}
          {renderNarrativeWithActivity(after, 'after', t, showReasoning, showTools, message.streaming)}
          {message.streaming && !hasVisibleActivity ? (
            <div className="streaming-state" aria-live="polite">
              <ThinkingDots /> {t('transcript.assistantWorking', { name: HARNESS_SHORT_NAMES[harness] })}
            </div>
          ) : null}
          {!message.streaming ? <MessageActions message={message} text={copyableText} /> : null}
        </div>
      </article>
    )
  },
  (previous, next) => previous.message === next.message && previous.harness === next.harness && previous.showReasoning === next.showReasoning && previous.showTools === next.showTools && previous.skills === next.skills,
)

function SessionReferenceText({ text, references, onOpen }: { text: string; references: RoutedSessionReference[]; onOpen?(sessionId: string, harness: HarnessId): void }) {
  const { t } = useI18n()
  if (!references.length) return <InlineText text={text} />
  const ordered = [...references].sort((left, right) => right.label.length - left.label.length)
  const lines = text.split('\n')
  return <>{lines.map((line, lineIndex) => {
    const parts: ReactNode[] = []
    let cursor = 0
    while (cursor < line.length) {
      let foundIndex = -1
      let found: RoutedSessionReference | undefined
      for (let index = cursor; index < line.length; index += 1) {
        const before = line[index - 1]
        found = ordered.find((reference) => {
          const after = line[index + reference.label.length]
          return (before === undefined || /[\s([{"'`]/.test(before))
            && line.startsWith(reference.label, index)
            && (after === undefined || /[\s.,!?;:()[\]{}"'`]/.test(after))
        })
        if (found) { foundIndex = index; break }
      }
      if (!found || foundIndex < 0) { parts.push(line.slice(cursor)); break }
      if (foundIndex > cursor) parts.push(line.slice(cursor, foundIndex))
      const reference = found
      parts.push(<button
        type="button"
        key={`${reference.harness}:${reference.sessionId}:${foundIndex}`}
        className="session-reference"
        aria-label={t('transcript.openSessionAria', { label: reference.label.slice(1) })}
        onClick={() => onOpen?.(reference.sessionId, reference.harness)}
      >{reference.label}</button>)
      cursor = foundIndex + reference.label.length
    }
    return <Fragment key={`${lineIndex}-${line.slice(0, 12)}`}>{parts}{lineIndex < lines.length - 1 ? <br /> : null}</Fragment>
  })}</>
}

function visibleUserText(text: string): string {
  const terminal = splitTerminalContextBlock(text)
  const annotations = splitAnnotationBlock(terminal.text)
  const capability = splitCapabilityRouting(annotations.text)
  return splitSessionRouting(capability.text).text
}

function UserText({ text, onOpenSessionReference }: { text: string; onOpenSessionReference?(sessionId: string, harness: HarnessId): void }) {
  const { t } = useI18n()
  // Sent prompts can carry verbose model-facing context blocks. Keep both
  // attachments collapsed and capability routing hidden while preserving the
  // user's own message.
  const terminal = splitTerminalContextBlock(text)
  const annotations = splitAnnotationBlock(terminal.text)
  const capability = splitCapabilityRouting(annotations.text)
  const sessions = splitSessionRouting(capability.text)
  const references = routedSessionReferences(sessions.block)
  if (!sessions.block && !capability.block && !annotations.block && !terminal.block) return <InlineText text={text} />
  return (
    <>
      {sessions.text && sessions.text !== '[Page annotations]' && sessions.text !== '[Terminal selection]' ? <SessionReferenceText text={sessions.text} references={references} onOpen={onOpenSessionReference} /> : null}
      {annotations.block ? (
        <details className="user-annotations">
          <summary>{annotations.count > 0 ? t('transcript.pageAnnotationsCount', { count: annotations.count }) : t('transcript.pageAnnotations')}</summary>
          <pre>{annotations.block}</pre>
        </details>
      ) : null}
      {terminal.selection ? (
        <details className="user-annotations user-terminal-context">
          <summary>{t('transcript.selectedTextFrom', { label: terminal.label ?? t('transcript.terminalDefaultLabel') })}</summary>
          <pre>{terminal.selection}</pre>
        </details>
      ) : null}
    </>
  )
}

export const UserMessage = memo(function UserMessage({ message, onOpenSessionReference }: { message: TranscriptMessage; onOpenSessionReference?(sessionId: string, harness: HarnessId): void }) {
  const { t } = useI18n()
  const copyableText = message.parts.filter((part) => part.type === 'text').map((part) => visibleUserText(part.text)).filter(Boolean).join('\n')
  return (
    <article className="message message--user">
      <div className="user-bubble">
        {message.parts.map((part, index) => (part.type === 'text' ? <UserText key={index} text={part.text} onOpenSessionReference={onOpenSessionReference} /> : part.type === 'image' ? renderImage(part, `user-${index}`, t) : null))}
      </div>
      {message.steerState ? <div className={`message__steer-state is-${message.steerState}`} role="status">{message.steerState === 'accepted' ? t('transcript.steerState.accepted') : t('transcript.steerState.read')}</div> : null}
      <MessageActions message={message} text={copyableText} />
    </article>
  )
})

export const SteerReadMarker = memo(function SteerReadMarker({ message }: { message: TranscriptMessage }) {
  return <div className="message message--steer-read" role="status"><span>{messageText(message)}</span></div>
})

export const ActivityMessage = memo(function ActivityMessage({ message, harness = 'omp' }: { message: TranscriptMessage; harness?: HarnessId }) {
  const { t } = useI18n()
  const activityLabel = t('transcript.harnessMessageLabel', { name: HARNESS_SHORT_NAMES[harness] })
  const sourceParts: MessagePart[] =
    message.role === 'system' && !message.parts.some((part) => part.type === 'compaction')
      ? [
          { type: 'toolCall', id: message.id, name: activityLabel },
          { type: 'toolResult', name: activityLabel, text: messageText(message), isError: true },
        ]
      : message.parts
  const parts = sourceParts.flatMap((part, index) =>
    part.type === 'toolResult' && sourceParts[index - 1]?.type !== 'toolCall' ? [{ type: 'toolCall' as const, id: `${message.id}-${index}`, name: part.name ?? t('transcript.tool.genericName') }, part] : [part],
  )
  return (
    <article className="message message--activity">
      <WorkTimeline parts={parts} showReasoning showTools />
    </article>
  )
})

export const AgentMessage = memo(function AgentMessage({ message }: { message: TranscriptMessage }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const text = messageText(message)
  const label = message.agentName ? t('transcript.messageFromAgentNamed', { name: message.agentName }) : t('transcript.messageFromAgent')
  return (
    <article className={`message message--agent ${open ? 'is-open' : ''}`}>
      <button type="button" className="agent-message__summary" aria-expanded={open} aria-controls={contentId} aria-label={label} onClick={() => setOpen((value) => !value)}>
        <OmpMark size={18} />
        <span className="agent-message__label">{t('transcript.messageFromAgent')}</span>
        {message.agentName ? <span className="agent-message__name">{message.agentName}</span> : null}
        {open ? <ChevronDown className="agent-message__chevron" size={13} /> : <ChevronRight className="agent-message__chevron" size={13} />}
      </button>
      {open ? (
        <div className="agent-message__content" id={contentId}>
          <MarkdownText text={boundText(text, 40_000, t('transcript.truncated.agentMessage'))} />
          <MessageActions message={message} />
        </div>
      ) : null}
    </article>
  )
})

export const GoalMessage = memo(function GoalMessage({ message }: { message: TranscriptMessage }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const text = messageText(message)
  return (
    <article className={`message message--goal ${open ? 'is-open' : ''}`}>
      <button type="button" className="goal-message__summary" aria-expanded={open} aria-controls={contentId} aria-label={t('transcript.goalSummaryAria')} onClick={() => setOpen((value) => !value)}>
        <span className="goal-message__icon">
          <Target size={15} />
        </span>
        <span className="goal-message__label">{t('transcript.goalSummaryAria')}</span>
        {open ? <ChevronDown className="goal-message__chevron" size={13} /> : <ChevronRight className="goal-message__chevron" size={13} />}
      </button>
      {open ? (
        <div className="goal-message__content" id={contentId}>
          <MarkdownText text={boundText(text, 40_000, t('transcript.truncated.goalSummary'))} />
        </div>
      ) : null}
    </article>
  )
})
