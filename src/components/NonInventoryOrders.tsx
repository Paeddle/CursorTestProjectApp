import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import './NonInventoryOrders.css'

type NonInventoryOrderRow = {
  id: string
  google_row_number: number
  sheet_timestamp: string | null
  item_name: string | null
  part_number: string | null
  quantity: number | null
  item_url: string | null
  ordered: boolean
  received: boolean
  updated_at: string
}

type SyncResponse = {
  inserted?: number
  updated?: number
  deleted?: number
}

function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL) && Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)
}

export default function NonInventoryOrders() {
  const [rows, setRows] = useState<NonInventoryOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [busyRowId, setBusyRowId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const loadRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: queryError } = await supabase
        .from('non_inventory_orders')
        .select('*')
        .order('google_row_number', { ascending: true })
      if (queryError) throw new Error(queryError.message)
      setRows((data ?? []) as NonInventoryOrderRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load non-inventory orders')
    } finally {
      setLoading(false)
    }
  }, [])

  const runSync = useCallback(async () => {
    setSyncing(true)
    setError(null)
    setStatusMessage(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('non-inventory-orders-sync', {
        body: { action: 'sync' },
      })
      if (invokeError) throw new Error(invokeError.message)
      const sync = (data ?? {}) as SyncResponse
      setStatusMessage(
        `Synced sheet rows. Inserted: ${sync.inserted ?? 0}, updated: ${sync.updated ?? 0}, removed: ${sync.deleted ?? 0}.`
      )
      await loadRows()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [loadRows])

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false)
      return
    }
    void loadRows()
  }, [loadRows])

  const setOrdered = async (row: NonInventoryOrderRow, checked: boolean) => {
    setBusyRowId(row.id)
    setError(null)
    setStatusMessage(null)
    try {
      const { error: invokeError } = await supabase.functions.invoke('non-inventory-orders-sync', {
        body: {
          action: 'set_ordered',
          orderId: row.id,
          googleRowNumber: row.google_row_number,
          ordered: checked,
        },
      })
      if (invokeError) throw new Error(invokeError.message)
      await loadRows()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update ordered status')
    } finally {
      setBusyRowId(null)
    }
  }

  const setReceived = async (row: NonInventoryOrderRow, checked: boolean) => {
    if (!checked) {
      setBusyRowId(row.id)
      setError(null)
      setStatusMessage(null)
      try {
        const { error: invokeError } = await supabase.functions.invoke('non-inventory-orders-sync', {
          body: {
            action: 'set_received',
            orderId: row.id,
            googleRowNumber: row.google_row_number,
            received: false,
          },
        })
        if (invokeError) throw new Error(invokeError.message)
        await loadRows()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not update received status')
      } finally {
        setBusyRowId(null)
      }
      return
    }

    const ok = window.confirm(
      `Mark "${row.item_name || 'this item'}" as delivered? This removes it from Google Sheets and from Supabase.`
    )
    if (!ok) return

    setBusyRowId(row.id)
    setError(null)
    setStatusMessage(null)
    try {
      const { error: invokeError } = await supabase.functions.invoke('non-inventory-orders-sync', {
        body: {
          action: 'set_received',
          orderId: row.id,
          googleRowNumber: row.google_row_number,
          received: true,
        },
      })
      if (invokeError) throw new Error(invokeError.message)
      setStatusMessage('Delivered item removed from sheet and database.')
      await loadRows()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark item as delivered')
    } finally {
      setBusyRowId(null)
    }
  }

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      const haystack = [
        row.sheet_timestamp ?? '',
        row.item_name ?? '',
        row.part_number ?? '',
        row.quantity != null ? String(row.quantity) : '',
        row.item_url ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [rows, search])

  if (!isSupabaseConfigured()) {
    return (
      <section className="non-inv-page">
        <header className="non-inv-header">
          <h1>Non-Inventory Orders</h1>
        </header>
        <div className="non-inv-setup">
          Configure <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your <code>.env</code>.
        </div>
      </section>
    )
  }

  return (
    <section className="non-inv-page">
      <header className="non-inv-header">
        <h1>Non-Inventory Orders</h1>
        <p>Syncs with the Raw Data Google Sheet tab and tracks ordered/delivered status.</p>
      </header>

      <div className="non-inv-toolbar">
        <button className="non-inv-btn" onClick={() => void runSync()} disabled={syncing || loading}>
          {syncing ? 'Syncing…' : 'Sync from Google Sheets'}
        </button>
        <input
          className="non-inv-search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search item name, part number, quantity, or URL..."
        />
      </div>

      {statusMessage && <div className="non-inv-status">{statusMessage}</div>}
      {error && <div className="non-inv-error">{error}</div>}

      {loading ? (
        <div className="non-inv-empty">Loading non-inventory orders…</div>
      ) : filteredRows.length === 0 ? (
        <div className="non-inv-empty">No rows found. Click "Sync from Google Sheets" to import data.</div>
      ) : (
        <div className="non-inv-table-wrap">
          <table className="non-inv-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Item Name</th>
                <th>Part Number</th>
                <th>Qty</th>
                <th>URL</th>
                <th>Ordered</th>
                <th>Delivered</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const rowBusy = busyRowId === row.id
                return (
                  <tr key={row.id}>
                    <td>{row.sheet_timestamp || '—'}</td>
                    <td>{row.item_name || '—'}</td>
                    <td>{row.part_number || '—'}</td>
                    <td>{row.quantity ?? '—'}</td>
                    <td>
                      {row.item_url ? (
                        <a href={row.item_url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.ordered}
                        disabled={rowBusy || syncing}
                        onChange={(e) => void setOrdered(row, e.target.checked)}
                        aria-label={`Set ordered for ${row.item_name || 'item'}`}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.received}
                        disabled={rowBusy || syncing}
                        onChange={(e) => void setReceived(row, e.target.checked)}
                        aria-label={`Set delivered for ${row.item_name || 'item'}`}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
