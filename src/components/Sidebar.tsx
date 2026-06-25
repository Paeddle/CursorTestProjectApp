import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { PRINT_STATION_ROUTE_PATH } from './LabelPrintStation'
import './Sidebar.css'

interface SidebarProps {
  activePage: string
  onNavigate: (page: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

function Sidebar({ activePage, onNavigate, open, onOpenChange }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const menuItems = [
    { id: 'tracking', label: 'Order Tracking', icon: '📦' },
    { id: 'order-history', label: 'Order History', icon: '📋' },
    { id: 'non-inventory-orders', label: 'Non-Inventory Orders', icon: '🧾' },
    { id: 'po-info', label: 'PO Info', icon: '📥' },
    { id: 'label-studio', label: 'Label Studio', icon: '🏷️' },
    { id: 'print-station', label: 'Print Station', icon: '🖨️' },
    { id: 'wire', label: 'Wire Tracker', icon: '🔌' },
    { id: 'purchase-list', label: 'Purchase List', icon: '📑' },
    { id: 'items', label: 'Items', icon: '📦' },
    { id: 'ebay', label: 'eBay', icon: '🛒' },
    { id: 'scanners', label: 'Scanners', icon: '📱' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
  ]

  const closeAfterNavigate = () => {
    onOpenChange(false)
  }

  const goToInAppPage = (pageId: string) => {
    if (location.pathname !== '/') {
      navigate('/')
    }
    onNavigate(pageId)
    closeAfterNavigate()
  }

  return (
    <>
      <button
        type="button"
        className={`nav-toggle${open ? ' nav-toggle--open' : ''}`}
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-expanded={open}
        aria-controls="app-sidebar"
        onClick={() => onOpenChange(!open)}
      >
        <span className="nav-toggle-icon" aria-hidden>
          {open ? '✕' : '☰'}
        </span>
      </button>

      {open && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => onOpenChange(false)}
        />
      )}

      <nav
        id="app-sidebar"
        className={`sidebar${open ? ' sidebar--open' : ''}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-header">
          <h2 className="sidebar-logo">Order Tracker</h2>
        </div>
        <ul className="sidebar-menu">
            {menuItems.map(item =>
              item.id === 'print-station' ? (
                <li key={item.id}>
                  <NavLink
                    to={PRINT_STATION_ROUTE_PATH}
                    className={({ isActive }) => `menu-item ${isActive ? 'active' : ''}`}
                    onClick={closeAfterNavigate}
                  >
                    <span className="menu-icon">{item.icon}</span>
                    <span className="menu-label">{item.label}</span>
                  </NavLink>
                </li>
              ) : (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`menu-item ${location.pathname === '/' && activePage === item.id ? 'active' : ''}`}
                    onClick={() => goToInAppPage(item.id)}
                  >
                    <span className="menu-icon">{item.icon}</span>
                    <span className="menu-label">{item.label}</span>
                  </button>
                </li>
              )
            )}
          </ul>
      </nav>
    </>
  )
}

export default Sidebar
