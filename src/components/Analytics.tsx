import { useState, useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts'
import type { POItem } from '../services/csvService'
import './Analytics.css'

const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
]

function getQuantityNumeric(quantity: POItem['quantity']): number {
  if (typeof quantity === 'number') return Number.isFinite(quantity) ? quantity : 0
  const cleaned = String(quantity || '').replace(/,/g, '').trim()
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

export type ChartType = 'bar' | 'pie' | 'line'
export type GroupBy = 'customer' | 'item_name' | 'po_number'
export type Metric = 'quantity' | 'order_count' | 'item_count'

interface AnalyticsProps {
  poItemsMap: Map<string, POItem[]>
  trackings: { po_number?: string }[]
}

function Analytics({ poItemsMap }: AnalyticsProps) {
  const [chartType, setChartType] = useState<ChartType>('bar')
  const [groupBy, setGroupBy] = useState<GroupBy>('customer')
  const [metric, setMetric] = useState<Metric>('quantity')
  const [limit, setLimit] = useState(15)

  const allItems = useMemo(() => {
    const items: POItem[] = []
    poItemsMap.forEach((list) => items.push(...list))
    return items
  }, [poItemsMap])

  const chartData = useMemo(() => {
    const map = new Map<string, { quantity: number; orderIds: Set<string>; itemCount: number }>()

    for (const item of allItems) {
      const key =
        groupBy === 'customer'
          ? (item.job_or_customer || '').trim() || 'Unknown'
          : groupBy === 'item_name'
            ? (item.item_name || '').trim() || 'Unknown'
            : (item.po_number || '').trim() || 'Unknown'

      if (!map.has(key)) {
        map.set(key, { quantity: 0, orderIds: new Set(), itemCount: 0 })
      }
      const rec = map.get(key)!
      rec.quantity += getQuantityNumeric(item.quantity)
      rec.orderIds.add((item.po_number || '').toLowerCase())
      rec.itemCount += 1
    }

    const result = Array.from(map.entries()).map(([name, data]) => ({
      name: name.length > 25 ? name.slice(0, 22) + '...' : name,
      fullName: name,
      value:
        metric === 'quantity'
          ? data.quantity
          : metric === 'order_count'
            ? data.orderIds.size
            : data.itemCount,
    }))

    result.sort((a, b) => b.value - a.value)
    return result.slice(0, limit)
  }, [allItems, groupBy, metric, limit])

  const groupByLabel =
    groupBy === 'customer' ? 'Customer' : groupBy === 'item_name' ? 'Item Name' : 'PO Number'
  const metricLabel =
    metric === 'quantity' ? 'Total Quantity' : metric === 'order_count' ? 'Order Count' : 'Item Count'

  return (
    <div className="analytics-page">
      <header className="analytics-header">
        <h1>Analytics</h1>
        <p className="analytics-subtitle">
          Explore your PO and item data with different charts and groupings.
        </p>
      </header>

      <div className="analytics-controls">
        <label className="analytics-control">
          <span>Chart type</span>
          <select
            value={chartType}
            onChange={(e) => setChartType(e.target.value as ChartType)}
          >
            <option value="bar">Bar chart</option>
            <option value="pie">Pie chart</option>
            <option value="line">Line chart</option>
          </select>
        </label>
        <label className="analytics-control">
          <span>Group by</span>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          >
            <option value="customer">Customer</option>
            <option value="item_name">Item Name</option>
            <option value="po_number">PO Number</option>
          </select>
        </label>
        <label className="analytics-control">
          <span>Metric</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
          >
            <option value="quantity">Total Quantity</option>
            <option value="order_count">Order (PO) Count</option>
            <option value="item_count">Line Item Count</option>
          </select>
        </label>
        <label className="analytics-control">
          <span>Show top</span>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {[5, 10, 15, 20, 25, 30].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {chartData.length === 0 ? (
        <div className="analytics-empty">
          <p>No data to display. Load data from the Order Tracking or Order History tabs first.</p>
        </div>
      ) : (
        <>
          <div className="analytics-chart-wrap">
            <ResponsiveContainer width="100%" height={400}>
              {chartType === 'bar' && (
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="name"
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fill: '#e2e8f0', fontSize: 12 }}
                  />
                  <YAxis tick={{ fill: '#e2e8f0' }} />
                  <Tooltip
                    content={({ payload }) =>
                      payload?.[0] && (
                        <div className="analytics-tooltip">
                          <strong>{payload[0].payload.fullName}</strong>
                          <br />
                          {metricLabel}: {payload[0].value}
                        </div>
                      )
                    }
                  />
                  <Bar dataKey="value" name={metricLabel} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
              {chartType === 'pie' && (
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="fullName"
                    cx="50%"
                    cy="50%"
                    outerRadius={140}
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {chartData.map((_, index) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ payload }) =>
                      payload?.[0] && (
                        <div className="analytics-tooltip">
                          <strong>{payload[0].payload.fullName}</strong>
                          <br />
                          {metricLabel}: {payload[0].value}
                        </div>
                      )
                    }
                  />
                </PieChart>
              )}
              {chartType === 'line' && (
                <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="name"
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fill: '#e2e8f0', fontSize: 12 }}
                  />
                  <YAxis tick={{ fill: '#e2e8f0' }} />
                  <Tooltip
                    content={({ payload }) =>
                      payload?.[0] && (
                        <div className="analytics-tooltip">
                          <strong>{payload[0].payload.fullName}</strong>
                          <br />
                          {metricLabel}: {payload[0].value}
                        </div>
                      )
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    name={metricLabel}
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ fill: '#3b82f6' }}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>

          <div className="analytics-table-wrap">
            <h3>Data table</h3>
            <div className="table-wrapper">
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>{groupByLabel}</th>
                    <th>{metricLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((row, i) => (
                    <tr key={i}>
                      <td title={row.fullName}>{row.fullName}</td>
                      <td>{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default Analytics
