import { ArrowUp, AtSign, Brain, Check, ChevronDown, Clock3, Command, Edit3, FolderGit2, Gauge, ImageIcon, MessageCirclePlus, Paperclip, Plus, Square, SquareTerminal, Trash2, X, Zap } from 'lucide-react'
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  BrowserAnnotation,
  GitWorktree,
  MessageEnterAction,
  PrimeContextUsage,
  PrimeModelDescriptor,
  PrimeProviderDescriptor,
  PrimeThinkingLevel,
  PromptDeliveryIntent,
  PromptImage,
  QueuedPrompt,
  SessionRecord,
  SkillRecord,
  TerminalPromptContext,
  TerminalSelectionContext,
} from '@/types/api'
import { appendAnnotationsToPrompt } from '@/lib/browser-annotations'
import { appendCapabilityRouting } from '@/lib/capability-mentions'
import { appendTerminalContextToPrompt } from '@/lib/terminal-context'
import { appendSessionRouting, findSessionMentions } from '@/lib/session-mentions'
import { takeComposerDraft } from '@/lib/composer-draft'
import { messageActionForKey } from '@/lib/message-shortcuts'
import { useComposerImages } from '@/hooks/useComposerImages'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { IconButton, MenuSelect, type MenuSelectGroup } from './ui'

interface ComposerProps {
  busy: boolean
  submitting?: boolean
  loading?: boolean
  disabled?: boolean
  model: string
  effort: PrimeThinkingLevel
  modelsByProvider: ReadonlyMap<string, PrimeModelDescriptor[]>
  providers: PrimeProviderDescriptor[]
  reasoningLevels: PrimeThinkingLevel[]
  fast: boolean
  fastSupported: boolean
  fastAvailable: boolean
  /** Active harness agent name for tooltips ("Prime Agent" / "OMP"). */
  agentName?: string
  /** Active harness short name for inline copy ("Prime" / "OMP"). */
  shortName?: string
  imageInputSupported: boolean
  /** Primary action for Enter; Ctrl/Cmd+Enter selects the opposite action. */
  messageEnterAction?: MessageEnterAction
  contextUsage?: PrimeContextUsage
  skills: SkillRecord[]
  /** Other sidebar sessions in the active project, available as @title references. */
  sessions?: SessionRecord[]
  /** Browser annotations auto-attach as a composer attachment while any exist. */
  annotations?: BrowserAnnotation[]
  /** The active terminal is visible as context; selected text expands this attachment. */
  terminalSelection?: TerminalSelectionContext
  /** Reads the active xterm buffer only at submit time, avoiding output-driven renderer updates. */
  getTerminalContext?(): TerminalPromptContext | undefined
  /** Messages accepted by Prime but waiting for a turn boundary. */
  queuedMessages?: QueuedPrompt[]
  onDeleteQueuedMessage?(message: QueuedPrompt): void
  onEditQueuedMessage?(message: QueuedPrompt): void
  /** Each bump submits the current draft immediately (Ctrl/Cmd+Enter from the annotation popover). */
  sendSignal?: number
  onModelChange(value: string): void
  onEffortChange(value: PrimeThinkingLevel): void
  onFastChange(value: boolean): void
  worktrees?: GitWorktree[]
  activeWorktreePath?: string
  /** Branch/worktree name shown before or without the linked-worktree catalog. */
  checkoutLabel?: string
  worktreesLoading?: boolean
  onOpenWorktree?(worktree: GitWorktree): Promise<void> | void
  onCreateWorktree?(branch: string): Promise<void> | void
  onSend(prompt: string, images: PromptImage[], intent: PromptDeliveryIntent): Promise<void> | void
  onStop(): Promise<void> | void
  onRemoveAnnotation?(id: string): void
  /** Called after a send that included the annotations, and by the attachment's remove control. */
  onClearAnnotations?(): void
  onClearTerminalSelection?(): void
}

const commands: { command: string; detailKey: MessageKey }[] = [
  { command: '/review', detailKey: 'composer.commands.review' },
  { command: '/plan', detailKey: 'composer.commands.plan' },
  { command: '/compact', detailKey: 'composer.commands.compact' },
  { command: '/status', detailKey: 'composer.commands.status' },
]

const reasoningLabelKeys: Record<PrimeThinkingLevel, MessageKey> = {
  off: 'composer.reasoning.off',
  minimal: 'composer.reasoning.minimal',
  low: 'composer.reasoning.low',
  medium: 'composer.reasoning.standard',
  high: 'composer.reasoning.high',
  xhigh: 'composer.reasoning.extraHigh',
  max: 'composer.reasoning.max',
}

const MAX_IMAGE_PROMPT_BYTES = 2 * 1024 * 1024

const EMPTY_ANNOTATIONS: BrowserAnnotation[] = []
const noop = () => undefined

export const Composer = memo(function Composer({
  busy,
  submitting = false,
  loading = false,
  disabled,
  model,
  effort,
  modelsByProvider,
  providers,
  reasoningLevels,
  fast,
  fastSupported,
  fastAvailable,
  agentName = 'OMP',
  shortName = 'OMP',
  imageInputSupported,
  messageEnterAction = 'queue',
  contextUsage,
  skills,
  sessions = [],
  annotations = EMPTY_ANNOTATIONS,
  terminalSelection,
  getTerminalContext,
  queuedMessages = [],
  onDeleteQueuedMessage,
  onEditQueuedMessage,
  sendSignal = 0,
  onModelChange,
  onEffortChange,
  onFastChange,
  worktrees = [],
  activeWorktreePath,
  checkoutLabel,
  worktreesLoading = false,
  onOpenWorktree,
  onCreateWorktree,
  onSend,
  onStop,
  onRemoveAnnotation = noop,
  onClearAnnotations = noop,
  onClearTerminalSelection = noop,
}: ComposerProps) {
  const { t } = useI18n()
  const [value, setValue] = useState(takeComposerDraft)
  const [menu, setMenu] = useState<'add' | 'mention' | 'command' | null>(null)
  const [sessionReferenceIds, setSessionReferenceIds] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const [annotationsOpen, setAnnotationsOpen] = useState(false)
  const [terminalSelectionOpen, setTerminalSelectionOpen] = useState(false)
  const imageAttachments = useComposerImages({ shortName })
  const { images, imagesRef, unsupportedFiles, unsupportedFilesRef, error: attachmentError, setError: setAttachmentError, processing: processingImages } = imageAttachments
  const [worktreeMenuOpen, setWorktreeMenuOpen] = useState(false)
  const [creatingWorktree, setCreatingWorktree] = useState(false)
  const [worktreeBranch, setWorktreeBranch] = useState('')
  const [worktreeError, setWorktreeError] = useState('')
  const menuId = useId()
  const worktreeMenuId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const worktreeMenuRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const acceptedMentionRef = useRef<{ start: number; text: string } | null>(null)
  const submittingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageStatusId = useId()
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations
  const mountedRef = useRef(true)
  const enabledSkills = useMemo(() => skills.filter((skill) => skill.enabled), [skills])

  useEffect(() => {
    const mentionMatch = /(?:^|\s)@([^@\n]*)$/.exec(value)
    const mentionStart = mentionMatch ? value.length - mentionMatch[1].length - 1 : -1
    const acceptedMention = acceptedMentionRef.current
    const suppressAcceptedMention = Boolean(
      mentionMatch
      && acceptedMention
      && mentionStart === acceptedMention.start
      && value.slice(acceptedMention.start, acceptedMention.start + acceptedMention.text.length) === acceptedMention.text,
    )
    if (acceptedMention && !suppressAcceptedMention) acceptedMentionRef.current = null
    setMenu(value.startsWith('/') && !value.includes(' ') ? 'command' : mentionMatch && !suppressAcceptedMention ? 'mention' : null)
  }, [value])
  useEffect(() => {
    setSessionReferenceIds((current) => {
      if (!current.size) return current
      const mentionedTitles = new Set(findSessionMentions(value, sessions, current).map(({ session }) => session.title.trim().toLocaleLowerCase()))
      const next = new Map([...current].filter(([title]) => mentionedTitles.has(title)))
      return next.size === current.size ? current : next
    })
  }, [sessions, value])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  useEffect(() => {
    if (annotations.length === 0) setAnnotationsOpen(false)
  }, [annotations.length])
  useEffect(() => {
    if (!terminalSelection?.text) setTerminalSelectionOpen(false)
  }, [terminalSelection?.text])

  useEffect(() => {
    if (!menu) return
    const close = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node) || menuRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-composer-menu-trigger]')) return
      setMenu(null)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onEscape)
    }
  }, [menu])

  useEffect(() => {
    if (!worktreeMenuOpen) return
    const close = (event: MouseEvent) => {
      if (!worktreeMenuRef.current?.contains(event.target as Node)) setWorktreeMenuOpen(false)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWorktreeMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onEscape)
    }
  }, [worktreeMenuOpen])
  const activeWorktree = worktrees.find((worktree) => worktree.path === activeWorktreePath)
    ?? worktrees.find((worktree) => worktree.current)
  const worktreeLabel = activeWorktree?.branch ?? activeWorktree?.name ?? checkoutLabel ?? t('composer.worktree.checkoutFallback')
  const createWorktree = async () => {
    const branch = worktreeBranch.trim()
    if (!branch || !onCreateWorktree || creatingWorktree) return
    setCreatingWorktree(true)
    setWorktreeError('')
    try {
      await onCreateWorktree(branch)
      setWorktreeBranch('')
      setWorktreeMenuOpen(false)
    } catch (error) {
      setWorktreeError(error instanceof Error ? error.message : t('composer.worktree.createError'))
    } finally {
      setCreatingWorktree(false)
    }
  }

  // Ctrl/Cmd+Enter in the annotation popover bumps sendSignal to submit the
  // draft (with the just-saved annotation) without switching focus here.
  const lastSendSignalRef = useRef(sendSignal)
  useEffect(() => {
    if (sendSignal === lastSendSignalRef.current) return
    lastSendSignalRef.current = sendSignal
    void submit()
  }, [sendSignal])

  const submit = async (intent: PromptDeliveryIntent = 'queue', valueOverride?: string) => {
    const currentImages = imagesRef.current
    const currentUnsupportedFiles = unsupportedFilesRef.current
    const currentAnnotations = annotationsRef.current
    const currentTerminalContext = terminalSelection?.text ? getTerminalContext?.() : undefined
    const hasTerminalSelection = Boolean(currentTerminalContext?.text)
    const draftValue = valueOverride ?? value
    const prompt = draftValue.trim() || (currentImages.length > 0
      ? (currentImages.length === 1 ? '[Attached image]' : '[Attached images]')
      : currentUnsupportedFiles.length > 0 ? (currentUnsupportedFiles.length === 1 ? '[Attached file]' : '[Attached files]')
        : currentAnnotations.length > 0 ? '[Page annotations]' : '[Terminal selection]')
    if ((!draftValue.trim() && currentImages.length === 0 && currentUnsupportedFiles.length === 0 && currentAnnotations.length === 0 && !hasTerminalSelection) || loading || disabled || (intent !== 'steer' && !busy && (submitting || submittingRef.current))) return
    if (imageAttachments.hasPending()) {
      setAttachmentError(t('composer.attachment.waitProcessing'))
      return
    }
    if (currentUnsupportedFiles.length > 0) {
      const first = currentUnsupportedFiles[0]
      const remainder = currentUnsupportedFiles.length - 1
      setAttachmentError(
        remainder > 0
          ? t('composer.attachment.unsupportedMultiple', { name: first.name, count: remainder })
          : t('composer.attachment.unsupportedSingle', { name: first.name }),
      )
      return
    }
    if (currentImages.length > 0 && !imageInputSupported) {
      setAttachmentError(t('composer.attachment.imagesNotSupported'))
      return
    }
    const submittedImages = currentImages.map(({ type, data, mimeType }) => ({ type, data, mimeType }))
    // Recognized @ mentions carry explicit routing semantics; annotations then
    // ride along inside the prompt as their own delimited plain-text block.
    const referencedSessions = findSessionMentions(prompt, sessions, sessionReferenceIds)
    const sessionTitles = new Set(referencedSessions.map(({ session }) => session.title.trim().toLocaleLowerCase()))
    const promptWithSessions = appendSessionRouting(prompt, sessions, sessionReferenceIds)
    // If a session and capability share a display name, the session chosen
    // from the combined menu wins instead of silently routing both.
    const promptWithCapabilities = appendCapabilityRouting(promptWithSessions, enabledSkills.filter((skill) => !sessionTitles.has(skill.name.trim().toLocaleLowerCase())))
    const promptWithAnnotations = appendAnnotationsToPrompt(promptWithCapabilities, currentAnnotations)
    const promptWithContext = appendTerminalContextToPrompt(promptWithAnnotations, currentTerminalContext)
    const frame = `${JSON.stringify({ type: intent === 'steer' ? 'steer' : 'follow_up', message: promptWithContext, ...(submittedImages.length ? { images: submittedImages } : {}), id: '00000000-0000-0000-0000-000000000000' })}\n`
    if (new TextEncoder().encode(frame).byteLength > MAX_IMAGE_PROMPT_BYTES) {
      setAttachmentError(t('composer.attachment.tooLarge'))
      return
    }
    submittingRef.current = true
    const submittedValue = draftValue
    const submittedComposerImages = currentImages
    setValue('')
    imageAttachments.clear()
    setAttachmentError('')
    setMenu(null)
    try {
      await onSend(promptWithContext, submittedImages, intent)
      // The annotations were delivered: clear the attachment and page markers.
      if (currentAnnotations.length > 0) onClearAnnotations()
    } catch {
      if (mountedRef.current) {
        setValue((current) => current || submittedValue)
        const restoration = imageAttachments.restoreWithinLimits(submittedComposerImages)
        if (restoration.omitted > 0) {
          const suffix = restoration.restored > 0 ? t('composer.restore.suffixWithImages', { count: restoration.restored }) : ''
          setAttachmentError(t('composer.restore.failed', { suffix, count: restoration.omitted }))
        } else if (submittedComposerImages.length > 0) {
          setAttachmentError(t('composer.restore.withImages'))
        } else {
          setAttachmentError(t('composer.restore.draftOnly'))
        }
      }
    } finally {
      submittingRef.current = false
      if (mountedRef.current) textareaRef.current?.focus()
    }
  }

  const insertAtCaret = (textarea: HTMLTextAreaElement, text: string) => {
    const start = textarea.selectionStart ?? textarea.value.length
    const end = textarea.selectionEnd ?? textarea.value.length
    textarea.setRangeText(text, start, end, 'end')
    setValue(textarea.value)
  }
  const insert = (text: string) => {
    const textarea = textareaRef.current
    if (textarea) insertAtCaret(textarea, text)
    else setValue((current) => `${current}${text}`)
    setMenu(null)
    textarea?.focus()
  }
  const insertMention = (label: string, session?: SessionRecord) => {
    const textarea = textareaRef.current
    const match = /(?:^|\s)@([^@\n]*)$/.exec(value)
    if (!match) { insert(`@${label} `); return }
    const query = match[1]
    const start = value.length - query.length
    const mentionStart = start - 1
    const acceptedText = `@${label} `
    if (textarea) {
      textarea.setRangeText(`${label} `, start, value.length, 'end')
      acceptedMentionRef.current = { start: mentionStart, text: acceptedText }
      setValue(textarea.value)
    } else {
      acceptedMentionRef.current = { start: mentionStart, text: acceptedText }
      setValue(`${value.slice(0, start)}${label} `)
    }
    if (session) {
      const key = session.title.trim().toLocaleLowerCase()
      setSessionReferenceIds((current) => new Map(current).set(key, session.id))
    }
    setMenu(null)
    textarea?.focus()
  }

  const mentionQuery = /(?:^|\s)@([^@\n]*)$/.exec(value)?.[1]?.toLocaleLowerCase().trim() ?? ''

  const suggestions =
    menu === 'command'
      ? commands
          .filter((item) => item.command.startsWith(value))
          .map((item) => ({
            key: item.command,
            label: item.command,
            detail: t(item.detailKey),
            icon: <Command size={14} />,
            choose: () => {
              setValue(`${item.command} `)
              setMenu(null)
              textareaRef.current?.focus()
            },
          }))
      : menu === 'mention'
        ? [
            ...sessions.filter((session) => session.title.toLocaleLowerCase().includes(mentionQuery)).slice(0, 6).map((session) => ({
              key: `session:${session.harness}:${session.id}`,
              label: `@${session.title}`,
              detail: t('composer.mention.sessionDetail', { harness: session.harness.toUpperCase(), status: session.status }),
              icon: <MessageCirclePlus size={14} />,
              choose: () => insertMention(session.title, session),
            })),
            ...enabledSkills.filter((skill) => skill.name.toLocaleLowerCase().includes(mentionQuery)).slice(0, 6).map((skill) => ({
              key: `skill:${skill.id}`,
              label: `@${skill.name}`,
              detail: skill.description,
              icon: <AtSign size={14} />,
              choose: () => insertMention(skill.name),
            })),
          ].slice(0, 8)
        : menu === 'add'
          ? [
              { key: 'files', label: t('composer.addMenu.filesLabel'), detail: t('composer.addMenu.filesDetail'), icon: <Paperclip size={14} />, choose: () => { setMenu(null); fileInputRef.current?.click() } },
              { key: 'mention', label: t('composer.addMenu.mentionLabel'), detail: t('composer.addMenu.mentionDetail'), icon: <AtSign size={14} />, choose: () => insert('@') },
            ]
          : []

  useEffect(() => {
    setActiveSuggestion(0)
  }, [menu, value, suggestions.length])
  const chooseSuggestion = (index: number) => suggestions[index]?.choose()
  // The group tree only depends on catalog identity, not on per-keystroke state.
  const modelGroups = useMemo<MenuSelectGroup[]>(
    () => [
      { key: 'auto', options: [{ value: 'auto', label: t('composer.model.auto') }] },
      ...providers
        .filter((provider) => provider.enabled && (modelsByProvider.get(provider.id)?.length ?? 0) > 0)
        .map((provider) => ({
          key: provider.id,
          heading: `${provider.name}${provider.configured ? '' : ` · ${t('composer.provider.notConnected')}`}`,
          options: (modelsByProvider.get(provider.id) ?? []).map((candidate) => ({
            value: candidate.key,
            label: candidate.name,
            disabled: !candidate.available,
            ...candidate.available ? {} : { hint: t('composer.provider.connectProvider') },
          })),
        })),
    ],
    [modelsByProvider, providers, t],
  )
  const modelValueLabel = useMemo(() => {
    if (model === 'auto') return t('composer.model.auto')
    for (const candidates of modelsByProvider.values()) {
      const found = candidates.find((candidate) => candidate.key === model)
      if (found) return found.name
    }
    return model
  }, [model, modelsByProvider, t])
  const effortGroups = useMemo<MenuSelectGroup[]>(
    () => [{ key: 'effort', options: reasoningLevels.map((level) => ({ value: level, label: t(reasoningLabelKeys[level]) })) }],
    [reasoningLevels, t],
  )
  const contextPercent = contextUsage?.percent === null || contextUsage?.percent === undefined ? null : Math.min(100, Math.max(0, contextUsage.percent))
  const contextLabel =
    contextUsage && contextUsage.tokens !== null
      ? t('composer.context.tokensLabel', { tokens: contextUsage.tokens.toLocaleString('en-US'), contextWindow: contextUsage.contextWindow.toLocaleString('en-US') })
      : t('composer.context.unavailable')
  const contextDisplayPercent = contextPercent === null ? null : Math.min(99, Math.round(contextPercent))
  const contextStyle = { '--context-percent': `${contextPercent ?? 0}%` } as CSSProperties
  const sendQueuedMessageImmediately = async (queued: QueuedPrompt) => {
    onDeleteQueuedMessage?.(queued)
    try {
      await onSend(queued.text, [], 'steer')
    } catch {
      // sendPrompt reports failures itself; there is no composer draft to restore.
    }
  }

  return (
    <div className="composer-wrap">
      {queuedMessages.length ? (
        <section className="composer-queue" aria-label={t('composer.queue.title')} aria-live="polite">
          <div className="composer-queue__header">
            <span><Clock3 size={13} />{t('composer.queue.title')}</span>
            <strong>{queuedMessages.length}</strong>
          </div>
          <div className="composer-queue__list">
            {queuedMessages.map((queued) => (
              <div className="composer-queue__item" key={queued.id}>
                <span className="composer-queue__text">{queued.text}</span>
                <span className="composer-queue__actions">
                  <button type="button" className="composer-queue__action" aria-label={t('composer.queue.sendNowAria', { text: queued.text })} title={t('composer.queue.sendNow')} onClick={() => { void sendQueuedMessageImmediately(queued) }}><ArrowUp size={13} /></button>
                  <button type="button" className="composer-queue__action" aria-label={t('composer.queue.editAria', { text: queued.text })} title={t('composer.queue.edit')} onClick={() => { onEditQueuedMessage?.(queued); setValue(queued.text); requestAnimationFrame(() => textareaRef.current?.focus()) }}><Edit3 size={13} /></button>
                  <button type="button" className="composer-queue__action composer-queue__action--delete" aria-label={t('composer.queue.deleteAria', { text: queued.text })} title={t('composer.queue.delete')} onClick={() => onDeleteQueuedMessage?.(queued)}><Trash2 size={13} /></button>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <div
        className={`composer ${busy || submitting ? 'composer--busy' : ''} ${imageAttachments.dragging ? 'composer--image-dragging' : ''}`}
        {...imageAttachments.dragHandlers}
      >
        {imageAttachments.dragging ? <div className="composer-drop-feedback" aria-hidden="true"><Paperclip size={18} />{t('composer.drop.hint')}</div> : null}
        <div className="composer-input">
          <textarea
            ref={textareaRef}
            value={value}
            disabled={disabled || loading}
            rows={2}
            placeholder={disabled ? t('composer.placeholder.disabled') : loading ? t('composer.placeholder.loading') : submitting ? t('composer.placeholder.starting', { shortName }) : t('composer.placeholder.default', { shortName })}
            aria-label={t('composer.input.aria', { shortName })}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={Boolean(menu && suggestions.length)}
            aria-controls={menu ? menuId : undefined}
            aria-activedescendant={menu && suggestions.length ? `${menuId}-option-${activeSuggestion}` : undefined}
            onChange={(event) => setValue(event.target.value)}
            onPaste={(event) => {
              const files = [...event.clipboardData.items]
                .filter((item) => item.kind === 'file')
                .flatMap((item) => {
                  const file = item.getAsFile()
                  return file ? [file] : []
                })
              if (!files.length) return
              const pastedText = event.clipboardData.getData('text/plain')
              event.preventDefault()
              if (pastedText) insertAtCaret(event.currentTarget, pastedText)
              void imageAttachments.ingest(files)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Backspace') acceptedMentionRef.current = null
              if (menu && suggestions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault()
                setActiveSuggestion((current) => (event.key === 'ArrowDown' ? (current + 1) % suggestions.length : (current - 1 + suggestions.length) % suggestions.length))
                return
              }
              if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && menu && suggestions.length) {
                event.preventDefault()
                chooseSuggestion(activeSuggestion)
                return
              }
              const intent = messageActionForKey(
                {
                  key: event.key,
                  ctrlKey: event.ctrlKey,
                  metaKey: event.metaKey,
                  altKey: event.altKey,
                  shiftKey: event.shiftKey,
                  isComposing: event.nativeEvent.isComposing,
                },
                messageEnterAction,
              )
              if (intent) {
                event.preventDefault()
                void submit(intent)
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setMenu(null)
              }
            }}
          />
        </div>
        {menu && suggestions.length ? (
          <div ref={menuRef} id={menuId} className="composer-menu" role="listbox" aria-label={menu === 'command' ? t('composer.menu.commands') : menu === 'mention' ? t('composer.menu.sessionsAndSkills') : t('composer.menu.addContext')}>
            {suggestions.map((suggestion, index) => (
              <button
                id={`${menuId}-option-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={activeSuggestion === index}
                className={activeSuggestion === index ? 'is-active' : ''}
                key={suggestion.key}
                onMouseEnter={() => setActiveSuggestion(index)}
                onClick={suggestion.choose}
              >
                {suggestion.icon}
                <span>
                  <strong>{suggestion.label}</strong>
                  <small>{suggestion.detail}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {annotationsOpen && annotations.length ? (
          <div className="composer-annotations" role="region" aria-label={t('composer.annotations.detailsAria')}>
            {annotations.map((annotation, index) => {
              return (
                <div className="composer-annotation" key={annotation.id}>
                  <span className="composer-annotation__badge" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="composer-annotation__body">
                    <p>{annotation.comment}</p>
                    {annotation.stale ? <small>{t('composer.annotations.stale')}</small> : null}
                  </div>
                  <button type="button" aria-label={t('composer.annotations.removeAria', { index: index + 1 })} onClick={() => onRemoveAnnotation(annotation.id)}>
                    <X size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}
        {terminalSelectionOpen && terminalSelection?.text ? (
          <div className="composer-terminal-selection" role="region" aria-label={t('composer.terminal.selectionAria')}>
            <div>
              <SquareTerminal size={14} aria-hidden="true" />
              <strong>{terminalSelection.label}</strong>
              {terminalSelection.truncated ? <small>{t('composer.terminal.truncated')}</small> : null}
            </div>
            <pre>{terminalSelection.text}</pre>
          </div>
        ) : null}
        {images.length || unsupportedFiles.length || annotations.length || terminalSelection?.text ? (
          <div className="composer-attachments" aria-label={t('composer.attachments.aria')}>
            {annotations.length ? (
              <div className="composer-attachment composer-attachment--annotations" title={t('composer.attachments.annotationsCount', { count: annotations.length })}>
                <button
                  type="button"
                  className="composer-attachment__expand"
                  aria-expanded={annotationsOpen}
                  aria-label={t('composer.attachments.inspectAnnotations', { count: annotations.length })}
                  onClick={() => setAnnotationsOpen((open) => !open)}
                >
                  <MessageCirclePlus size={13} />
                  <span>{annotations.length}</span>
                  <ChevronDown size={11} className={annotationsOpen ? 'is-open' : ''} />
                </button>
                <button
                  type="button"
                  className="composer-attachment__clear"
                  aria-label={t('composer.attachments.removeAnnotations')}
                  onClick={() => {
                    setAnnotationsOpen(false)
                    onClearAnnotations()
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}
            {terminalSelection?.text ? (
              <div className="composer-attachment composer-attachment--terminal has-selection" title={t('composer.attachments.selectedTextFrom', { label: terminalSelection.label })}>
                <button
                  type="button"
                  className="composer-attachment__expand"
                  aria-expanded={terminalSelectionOpen}
                  aria-label={t('composer.attachments.inspectSelectedText', { label: terminalSelection.label })}
                  onClick={() => setTerminalSelectionOpen((open) => !open)}
                >
                  <SquareTerminal size={13} />
                  <span>{terminalSelection.label}</span>
                  <small>{t('composer.attachments.selected')}</small><ChevronDown size={11} className={terminalSelectionOpen ? 'is-open' : ''} />
                </button>
                <button type="button" className="composer-attachment__clear" aria-label={t('composer.attachments.clearTerminalSelection')} onClick={onClearTerminalSelection}><X size={12} /></button>
              </div>
            ) : null}
            {images.map((image) => (
              <div className="composer-attachment" key={image.id}>
                <img src={`data:${image.mimeType};base64,${image.data}`} alt="" />
                <span>
                  <ImageIcon size={12} />
                  {image.name}
                </span>
                <button
                  type="button"
                  aria-label={t('composer.attachments.removeNamed', { name: image.name })}
                  onClick={() => imageAttachments.remove(image.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {unsupportedFiles.map((file) => (
              <div className="composer-attachment" key={file.id}>
                <span>
                  <Paperclip size={12} />
                  {file.name}
                </span>
                <button
                  type="button"
                  aria-label={t('composer.attachments.removeNamed', { name: file.name })}
                  onClick={() => imageAttachments.remove(file.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {attachmentError ? (
          <p className="composer-attachment-error" role="alert">
            {attachmentError}
          </p>
        ) : null}
        <p id={imageStatusId} className="sr-only" role="status" aria-live="polite">
          {imageAttachments.dragging ? t('composer.status.dropHint') : processingImages ? t('composer.status.addingFiles') : images.length + unsupportedFiles.length ? t('composer.status.filesAttached', { count: images.length + unsupportedFiles.length }) : ''}
        </p>
        <div className="composer__footer">
          <div className="composer__controls">
            <IconButton
              label={t('composer.menu.addContext')}
              data-composer-menu-trigger
              aria-expanded={menu === 'add'}
              aria-controls={menu === 'add' ? menuId : undefined}
              onClick={() => {
                setMenu((current) => (current === 'add' ? null : 'add'))
                requestAnimationFrame(() => textareaRef.current?.focus())
              }}
            >
              <Plus size={17} />
            </IconButton>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              multiple
              tabIndex={-1}
              aria-label={t('composer.attach.chooseFilesAria')}
              aria-describedby={imageStatusId}
              disabled={disabled || loading || submitting}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? [])
                event.currentTarget.value = ''
                void imageAttachments.ingest(files)
              }}
            />
            <MenuSelect
              label={t('composer.select.model')}
              compact
              icon={<Brain size={14} />}
              value={model}
              valueLabel={modelValueLabel}
              groups={modelGroups}
              onChange={onModelChange}
            />
            <MenuSelect
              label={t('composer.select.reasoningEffort')}
              compact
              icon={<Gauge size={12} />}
              value={effort}
              valueLabel={t(reasoningLabelKeys[effort])}
              groups={effortGroups}
              onChange={(value) => { onEffortChange(value as PrimeThinkingLevel) }}
            />
            {fastSupported ? (
              <button
                type="button"
                className={`fast-mode-toggle ${fast ? 'is-active' : ''}`}
                aria-pressed={fast}
                disabled={!fastAvailable}
                title={fastAvailable ? t('composer.fastMode.enabledTitle', { agentName }) : t('composer.fastMode.disabledTitle', { agentName })}
                onClick={() => onFastChange(!fast)}
              >
                <Zap size={12} fill={fast ? 'currentColor' : 'none'} /> <span className="fast-mode-toggle__label">{t('composer.fastMode.label')}</span>
              </button>
            ) : null}
            <div className="worktree-picker" ref={worktreeMenuRef}>
              <button
                type="button"
                className="permissions-chip worktree-picker__trigger"
                aria-label={t('composer.worktree.checkoutAria', { label: worktreeLabel })}
                aria-expanded={worktreeMenuOpen}
                aria-controls={worktreeMenuOpen ? worktreeMenuId : undefined}
                disabled={!onOpenWorktree && !onCreateWorktree}
                onClick={() => setWorktreeMenuOpen((open) => !open)}
              >
                <FolderGit2 size={12} />
                <span className="worktree-picker__label">{worktreeLabel}</span>
                <ChevronDown className="worktree-picker__chevron" size={11} />
              </button>
              {worktreeMenuOpen ? (
                <div className="worktree-picker__menu" id={worktreeMenuId} role="menu" aria-label={t('composer.worktree.menuAria')}>
                  <div className="worktree-picker__heading">{t('composer.worktree.heading')}</div>
                  <div className="worktree-picker__options">
                    {worktreesLoading ? <span className="worktree-picker__empty">{t('common.loading')}</span> : worktrees.length === 0 ? <span className="worktree-picker__empty">{t('composer.worktree.empty')}</span> : worktrees.map((worktree) => {
                      const selected = worktree.path === activeWorktreePath || (!activeWorktreePath && worktree.current)
                      const label = worktree.branch ?? worktree.name
                      return (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          className={`worktree-picker__option ${selected ? 'is-active' : ''}`}
                          key={worktree.path}
                          onClick={() => {
                            if (selected) { setWorktreeMenuOpen(false); return }
                            setWorktreeMenuOpen(false)
                            if (onOpenWorktree) void Promise.resolve(onOpenWorktree(worktree)).catch(() => undefined)
                          }}
                        >
                          <span className="worktree-picker__check">{selected ? <Check size={13} /> : null}</span>
                          <span className="worktree-picker__option-copy">
                            <strong>{label}</strong>
                            <span title={worktree.path}>{worktree.path}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  {onCreateWorktree ? (
                    <form className="worktree-picker__create" onSubmit={(event) => { event.preventDefault(); void createWorktree() }}>
                      <label htmlFor={`${worktreeMenuId}-branch`}>{t('composer.worktree.createLabel')}</label>
                      <div>
                        <input id={`${worktreeMenuId}-branch`} value={worktreeBranch} placeholder={t('composer.worktree.branchPlaceholder')} onChange={(event) => { setWorktreeBranch(event.target.value); setWorktreeError('') }} />
                        <button type="submit" disabled={!worktreeBranch.trim() || creatingWorktree}>{creatingWorktree ? t('composer.worktree.creating') : t('composer.worktree.create')}</button>
                      </div>
                      {worktreeError ? <span role="alert">{worktreeError}</span> : null}
                    </form>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="composer__actions">
            <span
              className={`context-usage-dial ${contextPercent === null ? 'is-unavailable' : contextPercent >= 95 ? 'is-critical' : contextPercent >= 80 ? 'is-warning' : ''}`}
              role="meter"
              tabIndex={0}
              aria-label={t('composer.context.usageAria')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={contextPercent === null ? undefined : Math.round(contextPercent)}
              aria-valuetext={contextLabel}
              title={contextLabel}
              data-tooltip={contextLabel}
              style={contextStyle}
            >
              <span>{contextDisplayPercent ?? '—'}</span>
            </span>
            {busy ? (
              <button type="button" className="send-button send-button--stop" aria-label={t('composer.actions.stopAria')} onClick={() => void onStop()}>
                <Square size={10} fill="currentColor" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className="send-button"
                aria-label={t('composer.actions.sendAria')}
                disabled={(!value.trim() && images.length === 0 && unsupportedFiles.length === 0 && annotations.length === 0 && !terminalSelection?.text) || processingImages || submitting || loading || disabled}
                onClick={() => void submit()}
              >
                <ArrowUp size={17} />
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="composer-note">{t('composer.note', { shortName })}</p>
    </div>
  )
})
