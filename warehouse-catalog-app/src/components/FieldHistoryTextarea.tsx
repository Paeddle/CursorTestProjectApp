import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import './FieldHistoryInput.css'

type FieldHistoryTextareaProps = {
  id?: string
  label: string
  value: string
  suggestions: string[]
  placeholder?: string
  onChange: (value: string) => void
}

export default function FieldHistoryTextarea({
  id: idProp,
  label,
  value,
  suggestions,
  placeholder,
  onChange,
}: FieldHistoryTextareaProps) {
  const autoId = useId()
  const inputId = idProp ?? autoId
  const wrapperRef = useRef<HTMLDivElement>(null)
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
    },
    [onChange]
  )

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  return (
    <div className="field-history" ref={wrapperRef}>
      <label className="field-history-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="field-history-row field-history-row-textarea">
        <textarea
          id={inputId}
          className="field-history-textarea"
          value={value}
          placeholder={placeholder}
          rows={2}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'ArrowDown' && filtered.length) {
              e.preventDefault()
              setOpen(true)
              setHighlight((h) => Math.min(h + 1, filtered.length - 1))
            }
          }}
        />
        <button
          type="button"
          className="field-history-toggle field-history-toggle-tall"
          title="Previous values"
          aria-label={`Show previous ${label} values`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
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
    </div>
  )
}
