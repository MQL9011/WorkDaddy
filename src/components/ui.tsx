import { Check, ChevronDown, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/lib/i18n'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'small' | 'regular'
}

export function IconButton({ label, size = 'regular', className = '', children, ...props }: IconButtonProps) {
  return (
    <button type="button" className={`icon-button icon-button--${size} ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  )
}

export function BrowserGlobe({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="browser-globe"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="3.65" ry="9" />
      <path d="M3 12h18" />
    </svg>
  )
}

export interface MenuSelectOption {
  value: string
  label: string
  disabled?: boolean
  /** Secondary line under the label (e.g. "Connect provider"). */
  hint?: string
}

export interface MenuSelectGroup {
  key: string
  /** Uppercase heading above the group's options; omit for an ungrouped leading section. */
  heading?: string
  options: MenuSelectOption[]
}

interface MenuSelectProps {
  label: string
  icon?: ReactNode
  compact?: boolean
  value: string
  valueLabel: ReactNode
  groups: readonly MenuSelectGroup[]
  disabled?: boolean
  align?: 'start' | 'end'
  onChange(value: string): void
}

/** Custom-styled dropdown replacing a native `<select>` so the popup matches the app's own menu chrome. */
export function MenuSelect({ label, icon, compact, value, valueLabel, groups, disabled, align = 'start', onChange }: MenuSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || rootRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className={`menu-select ${compact ? 'menu-select--compact' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="menu-select__trigger"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => { setOpen((current) => !current) }}
      >
        {icon ? <span className="menu-select__icon" aria-hidden="true">{icon}</span> : null}
        <span className="menu-select__value">{valueLabel}</span>
        <ChevronDown className="menu-select__chevron" size={12} aria-hidden="true" />
      </button>
      {open ? (
        <div className={`menu-select__menu ${align === 'end' ? 'menu-select__menu--end' : ''}`} id={menuId} role="menu" aria-label={label}>
          {groups.map((group) => (
            <div className="menu-select__group" key={group.key} role="group" aria-label={group.heading}>
              {group.heading ? <div className="menu-select__heading">{group.heading}</div> : null}
              {group.options.map((option) => {
                const selected = option.value === value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`menu-select__option ${selected ? 'is-selected' : ''}`}
                    disabled={option.disabled}
                    onClick={() => { setOpen(false); onChange(option.value) }}
                  >
                    <span className="menu-select__option-label">
                      {option.label}
                      {option.hint ? <small>{option.hint}</small> : null}
                    </span>
                    {selected ? <Check className="menu-select__check" size={13} aria-hidden="true" /> : null}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange(value: T): void
  label: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? 'is-active' : ''}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-state__icon">{icon}</div> : null}
      <h2>{title}</h2>
      <p>{children}</p>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  )
}

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void): RefObject<T | null> {
  const containerRef = useRef<T>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape
  useEffect(() => {
    if (!active || !containerRef.current) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const container = containerRef.current
    const focusInitial = () => {
      const preferred = container.querySelector<HTMLElement>('[autofocus]')
      const first = preferred ?? container.querySelector<HTMLElement>(focusableSelector)
      first?.focus()
    }
    const frame = requestAnimationFrame(focusInitial)
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.target instanceof Node) || !container.contains(event.target)) return
      if (event.key === 'Escape' && escapeRef.current) { event.preventDefault(); escapeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter((item) => !item.hidden && item.getClientRects().length > 0)
      if (!items.length) { event.preventDefault(); container.focus(); return }
      const first = items[0]; const last = items.at(-1)!
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown, true)
      const restore = previousFocus.current
      requestAnimationFrame(() => { if (restore?.isConnected) restore.focus() })
    }
  }, [active])
  return containerRef
}

// Overlays (modals, the command palette) share one refcount so stacked or
// sibling overlays only toggle the app shell's inert state on 0<->1 transitions.
let appShellOverlayCount = 0

export function useAppShellOverlay(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const shell = document.querySelector<HTMLElement>('.app-shell')
    if (!shell) return
    appShellOverlayCount += 1
    if (appShellOverlayCount === 1) { shell.inert = true; shell.setAttribute('aria-hidden', 'true') }
    return () => {
      appShellOverlayCount -= 1
      if (appShellOverlayCount === 0) { shell.inert = false; shell.removeAttribute('aria-hidden') }
    }
  }, [active])
}

export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose(): void; footer?: ReactNode }) {
  const { t } = useI18n()
  const titleId = useId()
  const modalRef = useFocusTrap<HTMLElement>(true, onClose)
  useAppShellOverlay(true)
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal__header"><h2 id={titleId}>{title}</h2><IconButton label={t('common.close')} onClick={onClose}><X size={16} /></IconButton></div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </section>
    </div>, document.body
  )
}

export function OmpMark({ size = 24 }: { size?: number }) {
  // "Precision geometric" mark: an O built on a 24-unit grid, broken for 40° on
  // the right with a detached stroke sitting in the gap. Below 20px the ring
  // closes and thickens so the shape still reads at tray/favicon sizes — see
  // assets/brand for the spec.
  const small = size <= 20
  return (
    <span className="omp-mark" style={{ width: size, height: size }} role="img" aria-label="WorkDaddy">
      <svg viewBox="0 0 96 96" fill="none" focusable="false" aria-hidden="true">
        {small ? (
          <circle cx="48" cy="48" r="29" stroke="currentColor" strokeWidth={14} />
        ) : (
          <g stroke="currentColor" strokeWidth={12} strokeLinecap="butt">
            <path d="M73.44 63.90 A30 30 0 1 1 77.71 43.82" />
            <path d="M77.71 52.18 A30 30 0 0 1 76.19 58.26" />
          </g>
        )}
      </svg>
    </span>
  )
}

export function AppMark({ size = 24 }: { size?: number }) {
  return (
    <span className="app-mark" style={{ width: size, height: size }} role="img" aria-label="WorkDaddy">
      <svg viewBox="0 0 96 96" fill="none" focusable="false" aria-hidden="true">
        <rect x="0" y="0" width="96" height="96" fill="#111318" />
        <g transform="translate(11.52 11.52) scale(0.76)" stroke="#F4F2EE" strokeWidth={12} strokeLinecap="butt">
          <path d="M73.44 63.90 A30 30 0 1 1 77.71 43.82" />
          <path d="M77.71 52.18 A30 30 0 0 1 76.19 58.26" />
        </g>
      </svg>
    </span>
  )
}
