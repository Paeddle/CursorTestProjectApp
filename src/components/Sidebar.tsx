import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { WIRE_ROUTE_PATH } from '../modules/wire'
import './Sidebar.css'

const NAV_HIDE_DELAY_MS = 2500

interface SidebarProps {
  activePage: string
  onNavigate: (page: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

function Sidebar({ activePage, onNavigate, open, onOpenChange }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const isWireOnlyLayout = location.pathname === WIRE_ROUTE_PATH
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [canHover, setCanHover] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches
  )

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => onOpenChange(false), NAV_HIDE_DELAY_MS)
  }, [clearHideTimer, onOpenChange])

  const openNav = useCallback(() => {
    clearHideTimer()
    onOpenChange(true)
  }, [clearHideTimer, onOpenChange])

  useEffect(() => () => clearHideTimer(), [clearHideTimer])

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)')
    const onChange = () => setCanHover(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const menuItems = [
    { id: 'tracking', label: 'Order Tracking', icon: '📦' },
    { id: 'order-history', label: 'Order History', icon: '📋' },
    { id: 'non-inventory-orders', label: 'Non-Inventory Orders', icon: '🧾' },
    { id: 'po-info', label: 'PO Info', icon: '📥' },
    { id: 'wire', label: 'Wire Tracker', icon: '🔌' },
    { id: 'purchase-list', label: 'Purchase List', icon: '📑' },
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

  const handleSidebarPointerLeave = () => {
    if (canHover) {
      scheduleHide()
    }
  }

  const handleSidebarPointerEnter = () => {
    if (canHover) {
      openNav()
    }
  }

  const handleRevealPointerEnter = () => {
    if (canHover) {
      openNav()
    }
  }

  const handleRevealPointerLeave = () => {
    if (canHover && open) {
      scheduleHide()
    }
  }

  return (
    <>
      {!open && canHover && (
        <div
          className="nav-reveal-zone"
          aria-hidden
          onPointerEnter={handleRevealPointerEnter}
          onPointerLeave={handleRevealPointerLeave}
        />
      )}

      <button
        type="button"
        className={`nav-toggle${open ? ' nav-toggle--open' : ''}`}
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-expanded={open}
        aria-controls="app-sidebar"
        onClick={() => (open ? onOpenChange(false) : openNav())}
      >
        <span className="nav-toggle-icon" aria-hidden>
          {open ? '✕' : '☰'}
        </span>
      </button>

      {open && !canHover && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => onOpenChange(false)}
        />
      )}

      <nav
        id="app-sidebar"
        className={`sidebar${isWireOnlyLayout ? ' sidebar-wire-only' : ''}${open ? ' sidebar--open' : ''}`}
        aria-label="Main navigation"
        onPointerEnter={handleSidebarPointerEnter}
        onPointerLeave={handleSidebarPointerLeave}
      >
        <div className="sidebar-header">
          <h2 className="sidebar-logo">{isWireOnlyLayout ? 'Wire Tracker' : 'Order Tracker'}</h2>
        </div>
        {!isWireOnlyLayout && (
          <ul className="sidebar-menu">
            {menuItems.map(item =>
              item.id === 'wire' ? (
                <li key={item.id}>
                  <NavLink
                    to={WIRE_ROUTE_PATH}
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
        )}
      </nav>
    </>
  )
}

export default Sidebar
