import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import './FieldHistoryInput.css'

type FieldHistoryInputProps = {
  id?: string
  label: string
  value: string
  suggestions: string[]
  placeholder?: string
  type?: 'text' | 'number'
  inputMode?: 'text' | 'numeric' | 'decimal'
  autoFocus?: boolean
  onChange: (value: string) => void
  onEnter?: () => void
  onBlurExtra?: () => void
}

export default function FieldHistoryInput({
  id: idProp,
  label,
  value,
  suggestions,
  placeholder,
  type = 'text',
  inputMode,
  autoFocus,
  onChange,
  onEnter,
  onBlurExtra,
}: FieldHistoryInputProps) {
  const autoId = useId()
  const inputId = idProp ?? autoId
  const listId = `${inputId}-list`
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    const base = suggestions.filter(Boolean)
    if (!q) return base
    return base.filter((s) => s.toLowerCase().includes(q))
  }, [suggestions, value])

  const showDropdown = open && filtered.length > 0

  const pick = useCallback(
    (next: string) => {
      onChange(next)
      setOpen(false)
      setHighlight(0)
      inputRef.current?.focus()
    },
    [onChange]
  )

  useEffect(() => {
    if (!open) setHighlight(0)
  }, [open, filtered.length])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'Enter') {
      if (showDropdown && filtered[highlight]) {
        e.preventDefault()
        pick(filtered[highlight])
        return
      }
      onEnter?.()
      return
    }
    if (e.key === 'F4' || (e.altKey && e.key === 'ArrowDown')) {
      e.preventDefault()
      setOpen((v) => !v)
    }
  }

  return (
    <div className="field-history" ref={wrapperRef}>
      <label className="field-history-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="field-history-row">
        <input
          ref={inputRef}
          id={inputId}
          type={type}
          className="field-history-input"
          list={listId}
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete="off"
          autoFocus={autoFocus}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120)
            onBlurExtra?.()
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="field-history-toggle"
          title="Previous values (Alt+↓)"
          aria-label={`Show previous ${label} values`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setOpen((v) => !v)
            inputRef.current?.focus()
          }}
        >
          ▾
        </button>
      </div>
      {showDropdown ? (
        <ul className="field-history-menu" role="listbox">
          {filtered.map((option, i) => (
            <li key={option}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={`field-history-option${i === highlight ? ' field-history-option-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(option)}
                onMouseEnter={() => setHighlight(i)}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}
