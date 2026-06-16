import { useLayoutEffect, useRef, useState } from 'react'
import { fittedPreviewLayout, splitPreviewTextLines } from '../lib/labelStudioTextFit'

type LabelStudioFittedTextProps = {
  text: string
  maxFontSizePx: number
  shrink: boolean
  bold: boolean
  align: 'left' | 'center' | 'right'
  /** Single-line barcode numbers */
  nowrap?: boolean
  className?: string
}

/** Binary-search font size with word wrap — mirrors DYMO AlwaysFit / ShrinkToFit on print. */
export default function LabelStudioFittedText({
  text,
  maxFontSizePx,
  shrink,
  bold,
  align,
  nowrap = false,
  className = '',
}: LabelStudioFittedTextProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState(() => ({
    fontPx: Math.max(4, maxFontSizePx),
    displayLines: splitPreviewTextLines(text),
    lineHeightPx: Math.max(4, maxFontSizePx) * 1.1,
  }))

  useLayoutEffect(() => {
    const box = hostRef.current
    if (!box) return

    const lines = nowrap ? [text.replace(/\s+/g, ' ').trim()] : splitPreviewTextLines(text)
    const boxSize = {
      w: Math.max(1, box.clientWidth),
      h: Math.max(1, box.clientHeight),
    }
    setLayout(
      fittedPreviewLayout(lines, boxSize, maxFontSizePx, bold, shrink && !nowrap, !nowrap)
    )
  }, [text, maxFontSizePx, shrink, bold, nowrap, align])

  const hostJustify =
    align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'

  return (
    <div
      ref={hostRef}
      className={`ls-fitted-text-host${className ? ` ${className}` : ''}`}
      style={{ justifyContent: hostJustify }}
    >
      <span
        className="ls-element-text ls-fitted-text-block"
        style={{
          fontSize: `${layout.fontPx}px`,
          fontWeight: bold ? 700 : 400,
          textAlign: align,
          lineHeight: `${layout.lineHeightPx}px`,
          whiteSpace: nowrap ? 'nowrap' : 'normal',
          fontFamily: nowrap ? 'monospace' : undefined,
        }}
      >
        {layout.displayLines.map((line, i) => (
          <span key={i} className="ls-fitted-text-line" style={{ display: 'block' }}>
            {line || '\u00a0'}
          </span>
        ))}
      </span>
    </div>
  )
}
