import type { AggregatedPoLineItem } from './poLineAggregate'
import { normJob, resolveSelectedCustomer, stockJobLabel } from './poLineAggregate'

/** Unique job/customer names on a PO (for box labels and dropdowns). */
export function jobOptionsForPo(
  lines: AggregatedPoLineItem[],
  customerOverrides: Record<string, string>
): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const add = (job: string) => {
    const t = job.trim()
    if (!t) return
    const k = normJob(t)
    if (seen.has(k)) return
    seen.add(k)
    out.push(t)
  }

  for (const line of lines) {
    if (line.customerBreakdown.length > 1) {
      for (const c of line.customerBreakdown) {
        add(c.job_or_customer)
      }
      const picked = resolveSelectedCustomer(line, customerOverrides)
      if (picked) add(picked)
    } else if (line.customerBreakdown.length === 1) {
      add(line.customerBreakdown[0]!.job_or_customer)
    } else {
      add(line.job_or_customer?.trim() ? stockJobLabel(line.job_or_customer) : 'Stock')
    }
  }

  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
