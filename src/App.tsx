import { useState, useEffect } from 'react'
import './App.css'
import { csvService, TrackingInfo, POItem } from './services/csvService'
import Sidebar from './components/Sidebar'
import Analytics from './components/Analytics'
import POInfo from './components/POInfo'
type SortDirection = 'asc' | 'desc' | null
type ItemSortColumn = 'po_number' | 'job_or_customer' | 'item_name' | 'quantity'
type OrderSortColumn = 'po_number' | 'job_or_customer' | 'item_name' | 'quantity'

function App() {
  const [activePage, setActivePage] = useState('tracking')
  const [trackings, setTrackings] = useState<TrackingInfo[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [selectedTracking, setSelectedTracking] = useState<TrackingInfo | null>(null)
  const [poItemsMap, setPoItemsMap] = useState<Map<string, POItem[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'orders' | 'items'>('items')
  const [itemSearchColumn, setItemSearchColumn] = useState<'all' | 'po_number' | 'job_or_customer' | 'item_name' | 'quantity'>('all')
  const [jobCustomerFilter, setJobCustomerFilter] = useState<string>('')
  const [itemSortColumn, setItemSortColumn] = useState<ItemSortColumn | null>(null)
  const [itemSortDirection, setItemSortDirection] = useState<SortDirection>(null)
  const [orderSortColumn, setOrderSortColumn] = useState<OrderSortColumn | null>(null)
  const [orderSortDirection, setOrderSortDirection] = useState<SortDirection>(null)

  useEffect(() => {
    loadTrackings()
    loadPOItems()
  }, [])

  // Clear status filter when switching to order history (since all are delivered)
  // Also clear when switching to items view
  useEffect(() => {
    if (activePage === 'order-history' || viewMode === 'items') {
      setStatusFilter([])
    }
  }, [activePage, viewMode])

  const loadPOItems = async () => {
    try {
      const itemsMap = await csvService.loadPOItems()
      setPoItemsMap(itemsMap)
    } catch (err: any) {
      console.error('Error loading PO items:', err)
    }
  }

  const loadTrackings = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await csvService.loadTrackings()
      setTrackings(data)
    } catch (err: any) {
      setError(err.message || 'Failed to load tracking data from CSV')
      console.error('Error loading trackings:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleRefreshData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [trackingsData, itemsMap] = await Promise.all([
        csvService.loadTrackings(),
        csvService.loadPOItems(),
      ])
      setTrackings(trackingsData)
      setPoItemsMap(itemsMap)
    } catch (err: any) {
      setError(err.message || 'Failed to load data from CSV')
      console.error('Error loading data:', err)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (tag: string) => {
    switch (tag?.toLowerCase()) {
      case 'delivered': return '#10b981'
      case 'in_transit': return '#3b82f6'
      case 'pending': return '#f59e0b'
      case 'exception': return '#ef4444'
      case 'out_for_delivery': return '#8b5cf6'
      default: return '#6b7280'
    }
  }

  const getStatusLabel = (tag: string) => {
    return tag?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown'
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A'

    const trimmed = dateString.trim()
    if (!trimmed) return 'N/A'

    // Handle date-only strings (e.g., 2025-11-13) without timezone shifts
    const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch
      const date = new Date(Number(year), Number(month) - 1, Number(day))
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    }

    try {
      const date = new Date(trimmed)
      if (isNaN(date.getTime())) return dateString
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return dateString
    }
  }

  const getTrackingUrl = (trackingNumber: string, carrier: string): string | null => {
    if (!trackingNumber || !carrier) return null

    const normalizedCarrier = carrier.toLowerCase().trim()
    const encodedTracking = encodeURIComponent(trackingNumber)

    switch (normalizedCarrier) {
      case 'ups':
        return `https://www.ups.com/track?tracknum=${encodedTracking}`
      case 'fedex':
      case 'fedex express':
      case 'fedex ground':
        return `https://www.fedex.com/fedextrack/?trknbr=${encodedTracking}`
      case 'usps':
        return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${encodedTracking}`
      case 'dhl':
        return `https://www.dhl.com/en/express/tracking.html?AWB=${encodedTracking}`
      case 'amazon':
      case 'amazon logistics':
        return `https://www.amazon.com/progress-tracker/package/${encodedTracking}`
      case 'ontrac':
        return `https://www.ontrac.com/tracking-results?tracking_number=${encodedTracking}`
      case 'lasership':
        return `https://lasership.com/track/${encodedTracking}`
      default:
        // Try generic tracking search
        return `https://www.google.com/search?q=${encodedTracking}+tracking`
    }
  }

  // Filter trackings based on search term and status filter
  const filterTrackings = (trackings: TrackingInfo[], search: string, statuses: string[]): TrackingInfo[] => {
    let filtered = trackings

    // Apply status filter (multiple statuses)
    if (statuses.length > 0) {
      filtered = filtered.filter(tracking => statuses.includes(tracking.tag))
    }

    // Apply search filter - search across ALL fields including additional CSV fields
    if (search.trim()) {
      const searchLower = search.toLowerCase().trim()
      filtered = filtered.filter(tracking => {
        // Get all values from the tracking object
        const allFieldValues: (string | number | undefined)[] = []
        
        // Add all standard fields
        allFieldValues.push(
          tracking.tracking_number,
          tracking.order_id,
          tracking.po_number,
          tracking.job_or_customer,
          tracking.from_company,
          tracking.recipient_name,
          tracking.destination_city,
          tracking.destination_state,
          tracking.slug,
          tracking.tag,
          tracking.title,
          tracking.checkpoint_message,
          tracking.checkpoint_location,
          formatDate(tracking.last_updated_at),
          formatDate(tracking.estimated_delivery),
          formatDate(tracking.checkpoint_date),
        )

        // Add all additional fields from the second CSV dynamically
        Object.keys(tracking).forEach(key => {
          const value = tracking[key]
          // Skip internal/system fields and already included fields
          if (key !== 'id' && 
              !['id', 'tracking_number', 'order_id', 'po_number', 'job_or_customer', 'from_company', 
                'recipient_name', 'destination_city', 'destination_state', 'slug', 
                'tag', 'title', 'checkpoint_message', 'checkpoint_location', 
                'last_updated_at', 'estimated_delivery', 'checkpoint_date'].includes(key)) {
            if (value !== null && value !== undefined && value !== '') {
              allFieldValues.push(value)
            }
          }
        })

        // Convert all values to strings and search
        const searchableFields = allFieldValues
          .filter(Boolean)
          .map(field => String(field).toLowerCase())

        return searchableFields.some(field => field.includes(searchLower))
      })
    }

    return filtered
  }

  const toggleStatusFilter = (status: string) => {
    setStatusFilter(prev => {
      if (prev.includes(status)) {
        return prev.filter(s => s !== status)
      } else {
        return [...prev, status]
      }
    })
  }

  // Get additional columns from the first tracking (fields that aren't standard columns)
  const getAdditionalColumns = (): string[] => {
    if (trackings.length === 0) return []
    
    const standardFields = new Set([
      'id', 'tracking_number', 'slug', 'tag', 'title', 'order_id', 'po_number', 'job_or_customer',
      'destination_city', 'destination_state', 'last_updated_at', 'estimated_delivery',
      'checkpoint_message', 'checkpoint_location', 'checkpoint_date',
      'recipient_name', 'from_company'
    ])
    
    const firstTracking = trackings[0]
    return Object.keys(firstTracking)
      .filter(key => !standardFields.has(key) && firstTracking[key] !== null && firstTracking[key] !== '')
      .slice(0, 3) // Limit to 3 additional columns to keep table manageable
  }

  const additionalColumns = getAdditionalColumns()

  // Filter trackings based on active page
  let trackingsToShow = trackings
  if (activePage === 'tracking') {
    // Exclude delivered orders from tracking page
    trackingsToShow = trackings.filter(t => t.tag?.toLowerCase() !== 'delivered')
  } else if (activePage === 'order-history') {
    // Show only delivered orders in order history
    trackingsToShow = trackings.filter(t => t.tag?.toLowerCase() === 'delivered')
  }

  // Filter by Job or Customer (from actions bar menu)
  const trackingsAfterCustomerFilter = jobCustomerFilter
    ? trackingsToShow.filter(t => (t.job_or_customer || '').trim() === jobCustomerFilter)
    : trackingsToShow

  const filteredTrackings = filterTrackings(trackingsAfterCustomerFilter, searchTerm, statusFilter)

  // Unique job/customer values for the filter dropdown (from trackings)
  const uniqueJobCustomers = [...new Set(trackings.map(t => (t.job_or_customer || '').trim()).filter(Boolean))].sort()

  const formatColumnName = (key: string): string => {
    return key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
  }

  // Get all items from PO items map, optionally filtered by order status
  const getAllItems = (onlyDelivered?: boolean): POItem[] => {
    const allItems: POItem[] = []
    
    if (onlyDelivered === true) {
      // Only get items from delivered orders
      const deliveredPONumbers = new Set(
        trackings
          .filter(t => t.tag?.toLowerCase() === 'delivered' && t.po_number)
          .map(t => t.po_number!.toLowerCase())
      )
      
      poItemsMap.forEach((items, poNumber) => {
        if (deliveredPONumbers.has(poNumber.toLowerCase())) {
          allItems.push(...items)
        }
      })
    } else if (onlyDelivered === false) {
      // Get items from non-delivered orders
      const nonDeliveredPONumbers = new Set(
        trackings
          .filter(t => t.tag?.toLowerCase() !== 'delivered' && t.po_number)
          .map(t => t.po_number!.toLowerCase())
      )
      
      poItemsMap.forEach((items, poNumber) => {
        if (nonDeliveredPONumbers.has(poNumber.toLowerCase())) {
          allItems.push(...items)
        }
      })
    } else {
      // Get all items (no filter)
      poItemsMap.forEach((items) => {
        allItems.push(...items)
      })
    }
    
    return allItems
  }

  // Filter items based on search term and selected column
  const filterItems = (items: POItem[], search: string, column: typeof itemSearchColumn): POItem[] => {
    if (!search.trim()) return items
    
    const searchLower = search.toLowerCase().trim()
    return items.filter(item => {
      if (column === 'all') {
        // Search all item fields
        const searchableFields = [
          item.po_number,
          item.job_or_customer,
          item.item_name,
          String(item.quantity),
        ].filter(Boolean).map(f => String(f).toLowerCase())
        
        return searchableFields.some(field => field.includes(searchLower))
      } else {
        // Search only the selected column
        let fieldValue: string = ''
        switch (column) {
          case 'po_number':
            fieldValue = item.po_number || ''
            break
          case 'job_or_customer':
            fieldValue = item.job_or_customer || ''
            break
          case 'item_name':
            fieldValue = item.item_name || ''
            break
          case 'quantity':
            fieldValue = String(item.quantity || '')
            break
        }
        return fieldValue.toLowerCase().includes(searchLower)
      }
    })
  }

  const getPONumberNumeric = (poNumber: string): number => {
    const digits = (poNumber || '').replace(/[^\d]/g, '')
    const n = Number(digits)
    return Number.isFinite(n) ? n : 0
  }

  const getQuantityNumeric = (quantity: POItem['quantity']): number => {
    if (typeof quantity === 'number') return Number.isFinite(quantity) ? quantity : 0
    const cleaned = String(quantity || '').replace(/,/g, '').trim()
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : 0
  }

  const sortItems = (items: POItem[], column: ItemSortColumn | null, direction: SortDirection): POItem[] => {
    if (!column || !direction) return items

    return [...items].sort((a, b) => {
      if (column === 'po_number') {
        const aNum = getPONumberNumeric(a.po_number)
        const bNum = getPONumberNumeric(b.po_number)
        return direction === 'asc' ? aNum - bNum : bNum - aNum
      }

      if (column === 'quantity') {
        const aNum = getQuantityNumeric(a.quantity)
        const bNum = getQuantityNumeric(b.quantity)
        return direction === 'asc' ? aNum - bNum : bNum - aNum
      }

      const aVal = (column === 'job_or_customer' ? a.job_or_customer : a.item_name) || ''
      const bVal = (column === 'job_or_customer' ? b.job_or_customer : b.item_name) || ''
      return direction === 'asc'
        ? aVal.localeCompare(bVal, undefined, { sensitivity: 'base' })
        : bVal.localeCompare(aVal, undefined, { sensitivity: 'base' })
    })
  }

  const handleItemSort = (column: ItemSortColumn) => {
    if (itemSortColumn === column) {
      if (itemSortDirection === 'asc') {
        setItemSortDirection('desc')
      } else if (itemSortDirection === 'desc') {
        setItemSortColumn(null)
        setItemSortDirection(null)
      } else {
        setItemSortDirection('asc')
      }
    } else {
      setItemSortColumn(column)
      setItemSortDirection('asc')
    }
  }

  const handleOrderSort = (column: OrderSortColumn) => {
    if (orderSortColumn === column) {
      if (orderSortDirection === 'asc') {
        setOrderSortDirection('desc')
      } else if (orderSortDirection === 'desc') {
        setOrderSortColumn(null)
        setOrderSortDirection(null)
      } else {
        setOrderSortDirection('asc')
      }
    } else {
      setOrderSortColumn(column)
      setOrderSortDirection('asc')
    }
  }

  // Find order by PO number
  const findOrderByPONumber = (poNumber: string): TrackingInfo | null => {
    return trackings.find(t => 
      t.po_number?.toLowerCase() === poNumber.toLowerCase()
    ) || null
  }

  const getOrderItemSummary = (poNumber?: string) => {
    const key = (poNumber || '').toLowerCase()
    const items = key ? poItemsMap.get(key) || [] : []

    const itemNames = items
      .map(i => (i.item_name || '').trim())
      .filter(Boolean)

    const distinctNames: string[] = []
    const seen = new Set<string>()
    for (const n of itemNames) {
      const k = n.toLowerCase()
      if (!seen.has(k)) {
        seen.add(k)
        distinctNames.push(n)
      }
    }

    let itemNameDisplay = 'N/A'
    if (distinctNames.length === 1) itemNameDisplay = distinctNames[0]
    else if (distinctNames.length > 1) itemNameDisplay = `${distinctNames[0]} +${distinctNames.length - 1} more`

    const totalQuantity = items.reduce((sum, i) => sum + getQuantityNumeric(i.quantity), 0)

    return { itemNameDisplay, totalQuantity }
  }

  const sortOrders = (
    rows: Array<{ tracking: TrackingInfo; poNumber: string; customer: string; itemNameDisplay: string; totalQuantity: number }>,
    column: OrderSortColumn | null,
    direction: SortDirection
  ) => {
    if (!column || !direction) return rows

    return [...rows].sort((a, b) => {
      if (column === 'po_number') {
        const aNum = getPONumberNumeric(a.poNumber)
        const bNum = getPONumberNumeric(b.poNumber)
        return direction === 'asc' ? aNum - bNum : bNum - aNum
      }

      if (column === 'quantity') {
        return direction === 'asc' ? a.totalQuantity - b.totalQuantity : b.totalQuantity - a.totalQuantity
      }

      const aVal = column === 'job_or_customer' ? a.customer : a.itemNameDisplay
      const bVal = column === 'job_or_customer' ? b.customer : b.itemNameDisplay
      return direction === 'asc'
        ? aVal.localeCompare(bVal, undefined, { sensitivity: 'base' })
        : bVal.localeCompare(aVal, undefined, { sensitivity: 'base' })
    })
  }

  // Handle item click - find and show the order
  const handleItemClick = (item: POItem) => {
    const order = findOrderByPONumber(item.po_number)
    if (order) {
      setSelectedTracking(order)
    }
  }

  // Get items based on active page
  const allItems = activePage === 'order-history' 
    ? getAllItems(true) // Only delivered orders' items
    : getAllItems(false) // Only non-delivered orders' items
  const itemsAfterCustomerFilter = jobCustomerFilter
    ? allItems.filter(i => (i.job_or_customer || '').trim() === jobCustomerFilter)
    : allItems
  const filteredItems = filterItems(itemsAfterCustomerFilter, searchTerm, itemSearchColumn)
  const sortedItems = sortItems(filteredItems, itemSortColumn, itemSortDirection)

  // Group Orders view by PO Number (one row per PO)
  const groupedOrdersMap = new Map<
    string,
    { tracking: TrackingInfo; poNumber: string; customer: string; itemNameDisplay: string; totalQuantity: number }
  >()

  for (const tracking of filteredTrackings) {
    const poNumber = (tracking.po_number || '').trim()
    if (!poNumber) continue

    const key = poNumber.toLowerCase()
    if (groupedOrdersMap.has(key)) continue

    const customer = (tracking.job_or_customer || '').trim()
    const { itemNameDisplay, totalQuantity } = getOrderItemSummary(poNumber)
    groupedOrdersMap.set(key, { tracking, poNumber, customer, itemNameDisplay, totalQuantity })
  }

  const groupedOrders = Array.from(groupedOrdersMap.values())
  const sortedOrders = sortOrders(groupedOrders, orderSortColumn, orderSortDirection)

  return (
    <div className="app">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <div className="main-content">
        {activePage === 'analytics' ? (
          <Analytics poItemsMap={poItemsMap} trackings={trackings} />
        ) : activePage === 'po-info' ? (
          <POInfo />
        ) : (
        <>
        <header className="header">
          <h1>
            {activePage === 'order-history' ? 'Order History' : 'Order Tracker'}
          </h1>
          <p className="subtitle">
            {activePage === 'order-history'
              ? 'View all delivered orders'
              : 'Track all your orders from CSV data'}
          </p>
        </header>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        <>
            {(activePage === 'tracking' || activePage === 'order-history') && (
          <div className="view-toggle-section">
            <button
              className={`view-toggle-button ${viewMode === 'orders' ? 'active' : ''}`}
              onClick={() => setViewMode('orders')}
            >
              📦 Orders
            </button>
            <button
              className={`view-toggle-button ${viewMode === 'items' ? 'active' : ''}`}
              onClick={() => setViewMode('items')}
            >
              📋 Items
            </button>
          </div>
        )}

        <div className="search-section">
          {((activePage === 'tracking' || activePage === 'order-history') && viewMode === 'items') && (
            <select
              className="search-column-select"
              value={itemSearchColumn}
              onChange={(e) => setItemSearchColumn(e.target.value as typeof itemSearchColumn)}
            >
              <option value="all">All Columns</option>
              <option value="po_number">PO Number</option>
              <option value="job_or_customer">Customer</option>
              <option value="item_name">Item Name</option>
              <option value="quantity">Quantity</option>
            </select>
          )}
          <input
            type="text"
            className="search-input"
            placeholder={
              ((activePage === 'tracking' || activePage === 'order-history') && viewMode === 'items')
                ? itemSearchColumn === 'all'
                  ? "Search all columns..."
                  : `Search by ${itemSearchColumn.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}...`
                : "Search by tracking number, order number, PO number, company, recipient, carrier, status, or any field..."
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              className="clear-search-button"
              onClick={() => setSearchTerm('')}
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {activePage !== 'order-history' && viewMode === 'orders' && (
          <div className="status-filters">
            <button
              className={`status-filter-button ${statusFilter.length === 0 ? 'active' : ''}`}
              onClick={() => setStatusFilter([])}
            >
              All
            </button>
            <button
              className={`status-filter-button ${statusFilter.includes('in_transit') ? 'active' : ''}`}
              onClick={() => toggleStatusFilter('in_transit')}
              style={{ backgroundColor: statusFilter.includes('in_transit') ? '#3b82f6' : undefined }}
            >
              In Transit
            </button>
            <button
              className={`status-filter-button ${statusFilter.includes('out_for_delivery') ? 'active' : ''}`}
              onClick={() => toggleStatusFilter('out_for_delivery')}
              style={{ backgroundColor: statusFilter.includes('out_for_delivery') ? '#8b5cf6' : undefined }}
            >
              Out For Delivery
            </button>
          </div>
        )}

        <div className="actions-bar">
          <button 
            className="refresh-button"
            onClick={handleRefreshData}
            disabled={loading}
          >
            Refresh Data
          </button>
          {(activePage === 'tracking' || activePage === 'order-history') && (
            <label className="filter-menu-label">
              <span className="filter-menu-text">Filter by Customer:</span>
              <select
                className="filter-select"
                value={jobCustomerFilter}
                onChange={(e) => setJobCustomerFilter(e.target.value)}
                title="Show only orders or items for this job/customer"
              >
                <option value="">All Customers</option>
                {uniqueJobCustomers.map(name => (
                  <option key={name} value={name}>
                    {name.length > 45 ? name.slice(0, 42) + '...' : name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="tracking-count">
            {((activePage === 'tracking' || activePage === 'order-history') && viewMode === 'items')
              ? `${filteredItems.length} ${filteredItems.length === 1 ? 'item' : 'items'}${(searchTerm || jobCustomerFilter) ? ` (of ${itemsAfterCustomerFilter.length} total)` : ''}`
              : `${filteredTrackings.length} ${filteredTrackings.length === 1 ? 'order' : 'orders'}${(statusFilter.length > 0 || searchTerm || jobCustomerFilter) ? ` (of ${trackingsAfterCustomerFilter.length} total)` : ''}`
            }
          </span>
        </div>

        <div className="trackings-container">
          {loading && trackings.length === 0 ? (
            <div className="loading-state">
              <p>Loading your orders from CSV...</p>
            </div>
          ) : ((activePage === 'tracking' || activePage === 'order-history') && viewMode === 'items') ? (
            // Items view
            sortedItems.length === 0 ? (
              <div className="empty-state">
                <p>No items match your search. Try adjusting your search term.</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="trackings-table">
                  <thead>
                    <tr>
                      <th onClick={() => handleItemSort('po_number')} className="sortable">
                        PO Number
                        {itemSortColumn === 'po_number' && (
                          <span className="sort-indicator">
                            {itemSortDirection === 'asc' ? ' ↑' : itemSortDirection === 'desc' ? ' ↓' : ''}
                          </span>
                        )}
                      </th>
                      <th onClick={() => handleItemSort('job_or_customer')} className="sortable">
                        Customer
                        {itemSortColumn === 'job_or_customer' && (
                          <span className="sort-indicator">
                            {itemSortDirection === 'asc' ? ' ↑' : itemSortDirection === 'desc' ? ' ↓' : ''}
                          </span>
                        )}
                      </th>
                      <th onClick={() => handleItemSort('item_name')} className="sortable">
                        Item Name
                        {itemSortColumn === 'item_name' && (
                          <span className="sort-indicator">
                            {itemSortDirection === 'asc' ? ' ↑' : itemSortDirection === 'desc' ? ' ↓' : ''}
                          </span>
                        )}
                      </th>
                      <th onClick={() => handleItemSort('quantity')} className="sortable">
                        Quantity
                        {itemSortColumn === 'quantity' && (
                          <span className="sort-indicator">
                            {itemSortDirection === 'asc' ? ' ↑' : itemSortDirection === 'desc' ? ' ↓' : ''}
                          </span>
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((item, index) => {
                      const order = findOrderByPONumber(item.po_number)
                      return (
                        <tr
                          key={`${item.po_number}-${index}`}
                          onClick={() => handleItemClick(item)}
                          className="clickable-row"
                          style={{ cursor: order ? 'pointer' : 'default' }}
                          title={order ? 'Click to view order details' : 'No order found for this PO number'}
                        >
                          <td>{item.po_number}</td>
                          <td>{item.job_or_customer || 'N/A'}</td>
                          <td>{item.item_name || 'N/A'}</td>
                          <td>{item.quantity || 'N/A'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : trackings.length === 0 ? (
            <div className="empty-state">
              <p>No orders found. Make sure po_line_report.csv exists in the public folder.</p>
            </div>
          ) : activePage === 'order-history' && trackingsToShow.length === 0 ? (
            <div className="empty-state">
              <p>No delivered orders found.</p>
            </div>
          ) : filteredTrackings.length === 0 ? (
            <div className="empty-state">
              <p>No orders match your filters. Try adjusting your search or status filter.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="trackings-table">
                <thead>
                  <tr>
                    <th onClick={() => handleOrderSort('po_number')} className="sortable">
                      PO Number
                      {orderSortColumn === 'po_number' && (
                        <span className="sort-indicator">
                          {orderSortDirection === 'asc' ? ' ↑' : orderSortDirection === 'desc' ? ' ↓' : ''}
                        </span>
                      )}
                    </th>
                    <th onClick={() => handleOrderSort('job_or_customer')} className="sortable">
                      Customer
                      {orderSortColumn === 'job_or_customer' && (
                        <span className="sort-indicator">
                          {orderSortDirection === 'asc' ? ' ↑' : orderSortDirection === 'desc' ? ' ↓' : ''}
                        </span>
                      )}
                    </th>
                    <th onClick={() => handleOrderSort('item_name')} className="sortable">
                      Item Name
                      {orderSortColumn === 'item_name' && (
                        <span className="sort-indicator">
                          {orderSortDirection === 'asc' ? ' ↑' : orderSortDirection === 'desc' ? ' ↓' : ''}
                        </span>
                      )}
                    </th>
                    <th onClick={() => handleOrderSort('quantity')} className="sortable">
                      Quantity
                      {orderSortColumn === 'quantity' && (
                        <span className="sort-indicator">
                          {orderSortDirection === 'asc' ? ' ↑' : orderSortDirection === 'desc' ? ' ↓' : ''}
                        </span>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedOrders.map(({ tracking, poNumber, customer, itemNameDisplay, totalQuantity }) => (
                    <tr
                      key={tracking.id}
                      onClick={() => setSelectedTracking(tracking)}
                      className="clickable-row"
                      title="Click to view PO details"
                    >
                      <td>{poNumber || 'N/A'}</td>
                      <td>{customer || 'N/A'}</td>
                      <td>{itemNameDisplay}</td>
                      <td>{totalQuantity || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>
        </>
        )}

        {selectedTracking && (
          <div className="modal-overlay" onClick={() => setSelectedTracking(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Order Details</h2>
                <button 
                  className="modal-close-button"
                  onClick={() => setSelectedTracking(null)}
                >
                  ×
                </button>
              </div>
              <div className="modal-body">
                <div className="modal-section">
                  <h3>Tracking Information</h3>
                  <div className="modal-grid">
                    <div className="modal-field">
                      <strong>Tracking Number:</strong>
                      {getTrackingUrl(selectedTracking.tracking_number, selectedTracking.slug) ? (
                        <a 
                          href={getTrackingUrl(selectedTracking.tracking_number, selectedTracking.slug)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tracking-link"
                        >
                          {selectedTracking.tracking_number}
                        </a>
                      ) : (
                        <span>{selectedTracking.tracking_number}</span>
                      )}
                    </div>
                    <div className="modal-field">
                      <strong>Order Number:</strong>
                      <span>{selectedTracking.order_id || 'N/A'}</span>
                    </div>
                    <div className="modal-field">
                      <strong>PO Number:</strong>
                      <span>{selectedTracking.po_number || 'N/A'}</span>
                    </div>
                    <div className="modal-field">
                      <strong>Job or Customer:</strong>
                      <span>{selectedTracking.job_or_customer || 'N/A'}</span>
                    </div>
                    <div className="modal-field">
                      <strong>Carrier:</strong>
                      <span>{selectedTracking.slug ? selectedTracking.slug.toUpperCase() : 'N/A'}</span>
                    </div>
                    <div className="modal-field">
                      <strong>Status:</strong>
                      <span 
                        className="status-badge-modal"
                        style={{ backgroundColor: getStatusColor(selectedTracking.tag) }}
                      >
                        {getStatusLabel(selectedTracking.tag)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="modal-section">
                  <h3>Company & Recipient</h3>
                  <div className="modal-grid">
                    <div className="modal-field">
                      <strong>From Company:</strong>
                      <span>{selectedTracking.from_company || 'N/A'}</span>
                    </div>
                    <div className="modal-field">
                      <strong>Recipient:</strong>
                      <span>{selectedTracking.recipient_name || 'N/A'}</span>
                    </div>
                    {selectedTracking.destination_city && selectedTracking.destination_state && (
                      <div className="modal-field">
                        <strong>Location:</strong>
                        <span>{selectedTracking.destination_city}, {selectedTracking.destination_state}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="modal-section">
                  <h3>Dates</h3>
                  <div className="modal-grid">
                    <div className="modal-field">
                      <strong>Ship Date:</strong>
                      <span>{selectedTracking.last_updated_at ? formatDate(selectedTracking.last_updated_at) : 'N/A'}</span>
                    </div>
                    <div className="modal-field">
                      <strong>Estimated Delivery:</strong>
                      <span>{selectedTracking.estimated_delivery ? formatDate(selectedTracking.estimated_delivery) : 'N/A'}</span>
                    </div>
                  </div>
                </div>

                {additionalColumns.length > 0 && (
                  <div className="modal-section">
                    <h3>Additional Information</h3>
                    <div className="modal-grid">
                      {additionalColumns.map(column => (
                        <div key={column} className="modal-field">
                          <strong>{formatColumnName(column)}:</strong>
                          <span>{selectedTracking[column] || 'N/A'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTracking.po_number && poItemsMap.has(selectedTracking.po_number.toLowerCase()) && (
                  <div className="modal-section">
                    <h3>PO Items</h3>
                    <div className="po-items-table-wrapper">
                      <table className="po-items-table">
                        <thead>
                          <tr>
                            <th>Customer</th>
                            <th>Item Name</th>
                            <th>Quantity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {poItemsMap.get(selectedTracking.po_number.toLowerCase())?.map((item, index) => (
                            <tr key={index}>
                              <td>{item.job_or_customer || 'N/A'}</td>
                              <td>{item.item_name}</td>
                              <td>{item.quantity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {Object.keys(selectedTracking).filter(key => 
                  !['id', 'tracking_number', 'slug', 'tag', 'order_id', 'po_number', 'job_or_customer',
                    'destination_city', 'destination_state', 'last_updated_at', 'estimated_delivery',
                    'checkpoint_message', 'checkpoint_location', 'checkpoint_date',
                    'recipient_name', 'from_company', 'title'].includes(key) &&
                  !additionalColumns.includes(key) &&
                  selectedTracking[key] !== null &&
                  selectedTracking[key] !== ''
                ).length > 0 && (
                  <div className="modal-section">
                    <h3>Other Details</h3>
                    <div className="modal-grid">
                      {Object.keys(selectedTracking).filter(key => 
                        !['id', 'tracking_number', 'slug', 'tag', 'order_id', 'po_number', 'job_or_customer',
                          'destination_city', 'destination_state', 'last_updated_at', 'estimated_delivery',
                          'checkpoint_message', 'checkpoint_location', 'checkpoint_date',
                          'recipient_name', 'from_company', 'title'].includes(key) &&
                        !additionalColumns.includes(key) &&
                        selectedTracking[key] !== null &&
                        selectedTracking[key] !== ''
                      ).map(key => (
                        <div key={key} className="modal-field">
                          <strong>{formatColumnName(key)}:</strong>
                          <span>{String(selectedTracking[key])}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTracking.checkpoint_message && (
                  <div className="modal-section">
                    <h3>Latest Update</h3>
                    <div className="checkpoint-info">
                      <div className="checkpoint-message">{selectedTracking.checkpoint_message}</div>
                      {selectedTracking.checkpoint_location && (
                        <div className="checkpoint-location">{selectedTracking.checkpoint_location}</div>
                      )}
                      {selectedTracking.checkpoint_date && (
                        <div className="checkpoint-date">{formatDate(selectedTracking.checkpoint_date)}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
