import './ShsAppNav.css'

export type ShsAppId = 'reorder' | 'wire' | 'parts'

const LINKS: { id: ShsAppId; href: string; label: string }[] = [
  { id: 'reorder', href: '/reorder/portal', label: 'Re-order Portal' },
  { id: 'wire', href: '/wire/', label: 'Wire Tracker' },
  { id: 'parts', href: '/parts/', label: 'Parts Tracker' },
]

export default function ShsAppNav({ current }: { current: ShsAppId }) {
  return (
    <nav className="shs-app-nav" aria-label="Switch app">
      {LINKS.map((link) => {
        const active = link.id === current
        return (
          <a
            key={link.id}
            className={`shs-app-nav-link${active ? ' is-current' : ''}`}
            href={link.href}
            aria-current={active ? 'page' : undefined}
          >
            {link.label}
          </a>
        )
      })}
    </nav>
  )
}
