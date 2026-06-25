import './ScannersPage.css'

const SCANNERS = [
  {
    id: 'po',
    title: 'PO Package Scanner',
    description:
      'Scan barcodes and upload packing slips / paperwork for a purchase order. Data appears in the PO Info tab.',
    path: '/scanner',
    icon: '📥',
    features: ['Barcode scanning', 'Document upload', 'PO number required'],
  },
  {
    id: 'wire',
    title: 'Wire Box Scanner',
    description:
      'Scan wire box QR codes to check boxes in or out of jobs. Tracks footage and job assignments.',
    path: '/wire-scanner',
    icon: '🔌',
    features: ['QR / barcode scan', 'Check-in & check-out', 'Job + footage entry'],
  },
  {
    id: 'ebay',
    title: 'eBay Item Scanner',
    description:
      'Scan product barcodes for items you plan to sell on eBay. Scans appear in the eBay tab for enrichment.',
    path: '/ebay-scanner',
    icon: '🏷️',
    features: ['Barcode scanning', 'No PO required', 'Links to eBay tab'],
  },
] as const

function scannerHref(path: string): string {
  if (typeof window === 'undefined') return path
  return `${window.location.origin}${path}`
}

export default function ScannersPage() {
  return (
    <div className="scanners-page">
      <header className="scanners-header">
        <h1>Scanners</h1>
        <p>
          Mobile-friendly scanner apps for warehouse and field use. Open on a phone over HTTPS for
          camera access. Each scanner saves to Supabase and syncs with the main app.
        </p>
      </header>

      <div className="scanners-grid">
        {SCANNERS.map((s) => {
          const href = scannerHref(s.path)
          return (
            <article key={s.id} className="scanner-card">
              <div className="scanner-card-icon" aria-hidden>
                {s.icon}
              </div>
              <h2>{s.title}</h2>
              <p>{s.description}</p>
              <ul className="scanner-features">
                {s.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <div className="scanner-card-actions">
                <a className="scanner-btn scanner-btn-primary" href={href} target="_blank" rel="noopener noreferrer">
                  Open scanner
                </a>
                <button
                  type="button"
                  className="scanner-btn"
                  onClick={() => void navigator.clipboard?.writeText(href)}
                >
                  Copy link
                </button>
              </div>
              <code className="scanner-url">{href}</code>
            </article>
          )
        })}
      </div>
    </div>
  )
}
