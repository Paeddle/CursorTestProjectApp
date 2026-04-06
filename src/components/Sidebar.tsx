import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { WIRE_ROUTE_PATH } from '../modules/wire'
import './Sidebar.css'

interface SidebarProps {
  activePage: string
  onNavigate: (page: string) => void
}

function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const menuItems = [
    { id: 'tracking', label: 'Order Tracking', icon: '📦' },
    { id: 'order-history', label: 'Order History', icon: '📋' },
    { id: 'po-info', label: 'PO Info', icon: '📥' },
    { id: 'wire', label: 'Wire', icon: '🔌' },
    { id: 'purchase-list', label: 'Purchase List', icon: '📑' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
  ]

  const goToInAppPage = (pageId: string) => {
    if (location.pathname !== '/') {
      navigate('/')
    }
    onNavigate(pageId)
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <h2 className="sidebar-logo">Order Tracker</h2>
      </div>
      <ul className="sidebar-menu">
        {menuItems.map(item =>
          item.id === 'wire' ? (
            <li key={item.id}>
              <NavLink
                to={WIRE_ROUTE_PATH}
                className={({ isActive }) => `menu-item ${isActive ? 'active' : ''}`}
              >
                <span className="menu-icon">{item.icon}</span>
                <span className="menu-label">{item.label}</span>
              </NavLink>
            </li>
          ) : (
            <li key={item.id}>
              <button
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
  )
}

export default Sidebar

