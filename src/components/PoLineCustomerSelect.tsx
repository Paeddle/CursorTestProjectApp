import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const btnRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(
    null
  )

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setMenuPos(null)
      return
    }
    const update = () => {
      const rect = btnRef.current!.getBoundingClientRect()
      setMenuPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 256),
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (document.getElementById('po-info-customer-picker-menu')?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (breakdown.length <= 1) return null

  const label = selectedCustomer ? shortCustomerLabel(selectedCustomer) : 'Select customer'

  const menu =
    open && menuPos
      ? createPortal(
          <ul
            id="po-info-customer-picker-menu"
            className="po-info-customer-picker-menu po-info-customer-picker-menu--portal"
            role="listbox"
            style={{
              position: 'fixed',
              top: menuPos.top,
              left: menuPos.left,
              minWidth: menuPos.width,
              zIndex: 2500,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {breakdown.map((c) => (
              <li
                key={c.job_or_customer}
                role="option"
                aria-selected={selectedCustomer === c.job_or_customer}
              >
                <button
                  type="button"
                  className={
                    selectedCustomer === c.job_or_customer
                      ? 'po-info-customer-picker-option is-selected'
                      : 'po-info-customer-picker-option'
                  }
                  onMouseDown={(e) => e.preventDefault()}
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
          </ul>,
          document.body
        )
      : null

  return (
    <div
      className="po-info-customer-picker"
      ref={wrapRef}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={btnRef}
        type="button"
        className={`po-info-customer-picker-btn${selectedCustomer ? '' : ' po-info-customer-picker-btn--needs'}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <span className="po-info-customer-picker-caret" aria-hidden>
          ▾
        </span>
      </button>
      {menu}
    </div>
  )
}
