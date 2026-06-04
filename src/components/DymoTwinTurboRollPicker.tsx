import {
  dymoTwinTurboRollLabel,
  type DymoTwinTurboRoll,
} from '../lib/dymoPrintParams'
import './DymoTwinTurboRollPicker.css'

type Props = {
  value: DymoTwinTurboRoll
  onChange: (roll: DymoTwinTurboRoll) => void
  className?: string
  id?: string
}

export default function DymoTwinTurboRollPicker({ value, onChange, className, id }: Props) {
  return (
    <label className={`dymo-roll-picker${className ? ` ${className}` : ''}`}>
      <span className="dymo-roll-picker-label">Label roll side</span>
      <select
        id={id}
        className="dymo-roll-picker-select"
        value={value}
        onChange={(e) => onChange(e.target.value as DymoTwinTurboRoll)}
        title="For Twin Turbo and other dual-roll LabelWriters"
      >
        <option value="Auto">{dymoTwinTurboRollLabel('Auto')}</option>
        <option value="Left">{dymoTwinTurboRollLabel('Left')}</option>
        <option value="Right">{dymoTwinTurboRollLabel('Right')}</option>
      </select>
      <span className="dymo-roll-picker-hint">
        Twin Turbo / dual-roll only — ignored on single-roll printers.
      </span>
    </label>
  )
}
