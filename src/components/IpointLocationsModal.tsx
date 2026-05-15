import type { PoLineItem } from '../types/poIpoint'

type IpointLocationsModalProps = {
  poNumber: string
  line: PoLineItem
  jobName: string | null
  locations: string[]
  selectedLocations: Set<string>
  onToggleLocation: (locationName: string) => void
  onToggleAll: (selectAll: boolean) => void
  onPrintSelected: () => void
  onClose: () => void
  printing: boolean
}

function IpointLocationsModal({
  poNumber,
  line,
  jobName,
  locations,
  selectedLocations,
  onToggleLocation,
  onToggleAll,
  onPrintSelected,
  onClose,
  printing,
}: IpointLocationsModalProps) {
  const allSelected =
    locations.length > 0 && locations.every((loc) => selectedLocations.has(loc))
  const someSelected = locations.some((loc) => selectedLocations.has(loc))
  const selectedCount = locations.filter((loc) => selectedLocations.has(loc)).length

  return (
    <div
      className="po-info-loc-modal-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="po-info-loc-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="po-info-loc-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="po-info-loc-modal-header">
          <div>
            <h3 id="po-info-loc-modal-title">Room locations</h3>
            <p className="po-info-loc-modal-sub">
              PO {poNumber} · {line.item_name}
              {jobName ? ` · ${jobName}` : ''}
            </p>
          </div>
          <button type="button" className="po-info-loc-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="po-info-loc-modal-hint">
          Select locations to print a Dymo label for each (job name + room).
        </p>

        <div className="po-info-loc-modal-toolbar">
          <button
            type="button"
            className="po-info-loc-modal-link-btn"
            onClick={() => onToggleAll(!allSelected)}
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          <span className="po-info-loc-modal-count">
            {selectedCount} of {locations.length} selected
          </span>
        </div>

        <ul className="po-info-loc-modal-list">
          {locations.map((loc) => (
            <li key={loc}>
              <label className="po-info-loc-modal-row">
                <input
                  type="checkbox"
                  checked={selectedLocations.has(loc)}
                  onChange={() => onToggleLocation(loc)}
                />
                <span>{loc}</span>
              </label>
            </li>
          ))}
        </ul>

        <div className="po-info-loc-modal-actions">
          <button type="button" className="po-info-loc-modal-cancel" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="po-info-print-labels-btn"
            disabled={printing || !someSelected}
            onClick={onPrintSelected}
          >
            {printing ? 'Printing…' : `Print ${selectedCount} label${selectedCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default IpointLocationsModal
