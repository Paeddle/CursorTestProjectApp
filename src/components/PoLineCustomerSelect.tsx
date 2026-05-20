import { useEffect, useRef, useState } from 'react'
import type { CustomerQtyBreakdown } from '../lib/poLineAggregate'

type Props = {
  breakdown: CustomerQtyBreakdown[]
  selectedCustomer: string | null
  onSelect: (jobOrCustomer: string) => void
}

function shortCustomerLabel(jobOrCustomer: string): string {
  const t = jobOrCustomer.trim()
  const i = t.indexOf(':')
  return (i >= 0 ? t.slice(0, i) : t).trim() || t
}

export default function PoLineCustomerSelect({
  breakdown,
  selectedCustomer,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (breakdown.length <= 1) return null

  return (
    <div className="po-info-customer-picker" ref={wrapRef}>
      <button
        type="button"
        className="po-info-customer-picker-btn"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        {selectedCustomer ? shortCustomerLabel(selectedCustomer) : 'Multiple customers'}
        <span className="po-info-customer-picker-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className="po-info-customer-picker-menu" role="listbox">
          {breakdown.map((c) => (
            <li key={c.job_or_customer} role="option" aria-selected={selectedCustomer === c.job_or_customer}>
              <button
                type="button"
                className={
                  selectedCustomer === c.job_or_customer
                    ? 'po-info-customer-picker-option is-selected'
                    : 'po-info-customer-picker-option'
                }
                onClick={() => {
                  onSelect(c.job_or_customer)
                  setOpen(false)
                }}
              >
                <span className="po-info-customer-picker-option-name">{c.job_or_customer}</span>
                <span className="po-info-customer-picker-option-qty">Req: {c.quantity}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
