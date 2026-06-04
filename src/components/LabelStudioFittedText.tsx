import { useLayoutEffect, useRef, useState } from 'react'

type LabelStudioFittedTextProps = {
  text: string
  maxFontSizePx: number
  shrink: boolean
  bold: boolean
  align: 'left' | 'center' | 'right'
}

function textFitsBox(span: HTMLSpanElement, box: HTMLElement): boolean {
  return span.scrollHeight <= box.clientHeight + 1 && span.scrollWidth <= box.clientWidth + 1
}

/** Binary-search font size so wrapped text fits inside the dotted element box. */
export default function LabelStudioFittedText({
  text,
  maxFontSizePx,
  shrink,
  bold,
  align,
}: LabelStudioFittedTextProps) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [fontPx, setFontPx] = useState(() => Math.max(4, maxFontSizePx))

  useLayoutEffect(() => {
    const span = textRef.current
    const box = span?.parentElement
    if (!span || !box) return

    const ceiling = Math.max(4, Math.floor(maxFontSizePx))
    if (!shrink) {
      setFontPx(ceiling)
      return
    }

    const trySize = (size: number): boolean => {
      span.style.fontSize = `${size}px`
      span.style.lineHeight = '1.1'
      return textFitsBox(span, box)
    }

    if (trySize(ceiling)) {
      setFontPx(ceiling)
      return
    }

    let lo = 4
    let hi = ceiling
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (trySize(mid)) lo = mid
      else hi = mid - 1
    }
    setFontPx(lo)
  }, [text, maxFontSizePx, shrink])

  return (
    <span
      ref={textRef}
      className="ls-element-text"
      style={{
        fontSize: `${fontPx}px`,
        fontWeight: bold ? 700 : 400,
        textAlign: align,
      }}
    >
      {text}
    </span>
  )
}
