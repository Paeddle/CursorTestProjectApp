import { useRef, useCallback, useState, useLayoutEffect } from 'react'
import { DYMO_PAPER_TEMPLATES } from '../lib/dymoLabelXml'
import {
  printableMetricsForTemplate,
  previewFontSizePx,
} from '../lib/labelStudioGeometry'
import type { LabelStudioElement } from '../types/labelStudio'
import { isBarcodeElement, isImageElement, isTextElement, paperTemplateById } from '../types/labelStudio'
import {
  applyMove,
  applyResize,
  type ElementRect,
  type ResizeHandle,
  RESIZE_HANDLES,
} from '../lib/labelStudioCanvasGeometry'

type DragState =
  | {
      mode: 'move'
      elementId: string
      startX: number
      startY: number
      orig: ElementRect
    }
  | {
      mode: 'resize'
      elementId: string
      handle: ResizeHandle
      startX: number
      startY: number
      orig: ElementRect
      lockAspect: boolean
    }

export type LabelStudioCanvasProps = {
  paperTemplateId: string
  elements: LabelStudioElement[]
  selectedElementId: string | null
  onSelect: (id: string | null) => void
  onUpdateRect: (id: string, rect: ElementRect) => void
  renderPreview: (el: LabelStudioElement) => string
  textLineCount?: (el: LabelStudioElement) => number | undefined
  imagePreviewUrl?: (el: LabelStudioElement) => string | null
  barcodePreviewUrl?: (el: LabelStudioElement) => string | null
}

function rectFromElement(el: LabelStudioElement): ElementRect {
  return { xPct: el.xPct, yPct: el.yPct, widthPct: el.widthPct, heightPct: el.heightPct }
}

export default function LabelStudioCanvas({
  paperTemplateId,
  elements,
  selectedElementId,
  onSelect,
  onUpdateRect,
  renderPreview,
  textLineCount,
  imagePreviewUrl,
  barcodePreviewUrl,
}: LabelStudioCanvasProps) {
  const printableRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [printableHeightPx, setPrintableHeightPx] = useState(0)

  const paper = paperTemplateById(paperTemplateId, DYMO_PAPER_TEMPLATES)
  const metrics = printableMetricsForTemplate(paper)

  useLayoutEffect(() => {
    const node = printableRef.current
    if (!node) return
    const measure = () => setPrintableHeightPx(node.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    return () => ro.disconnect()
  }, [paperTemplateId])

  const onPointerMove = useCallback(
    (ev: React.PointerEvent) => {
      const drag = dragRef.current
      const area = printableRef.current
      if (!drag || !area) return

      const rect = area.getBoundingClientRect()
      const dxPct = ((ev.clientX - drag.startX) / rect.width) * 100
      const dyPct = ((ev.clientY - drag.startY) / rect.height) * 100

      if (drag.mode === 'move') {
        onUpdateRect(drag.elementId, applyMove(drag.orig, dxPct, dyPct))
      } else {
        onUpdateRect(
          drag.elementId,
          applyResize(drag.orig, drag.handle, dxPct, dyPct, drag.lockAspect)
        )
      }
    },
    [onUpdateRect]
  )

  const endDrag = useCallback(() => {
    dragRef.current = null
  }, [])

  const startMove = (el: LabelStudioElement, ev: React.PointerEvent) => {
    if ((ev.target as HTMLElement).classList.contains('ls-resize-handle')) return
    ev.preventDefault()
    ev.stopPropagation()
    onSelect(el.id)
    dragRef.current = {
      mode: 'move',
      elementId: el.id,
      startX: ev.clientX,
      startY: ev.clientY,
      orig: rectFromElement(el),
    }
    ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
  }

  const startResize = (el: LabelStudioElement, handle: ResizeHandle, ev: React.PointerEvent) => {
    ev.preventDefault()
    ev.stopPropagation()
    onSelect(el.id)
    dragRef.current = {
      mode: 'resize',
      elementId: el.id,
      handle,
      startX: ev.clientX,
      startY: ev.clientY,
      orig: rectFromElement(el),
      lockAspect: ev.shiftKey,
    }
    ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
  }

  return (
    <div
      className="label-studio-canvas"
      style={{ aspectRatio: `${metrics.widthMm} / ${metrics.heightMm}` }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerDown={() => onSelect(null)}
    >
      <div ref={printableRef} className="ls-printable-area">
        {elements.length === 0 && (
          <p className="ls-canvas-empty">Add text, image, or a barcode. Positions match what will print.</p>
        )}
        {elements.map((el, zIndex) => {
          const isSelected = selectedElementId === el.id
          const isBarcode = isBarcodeElement(el)
          const barcodeShowText = isBarcode && el.textPosition !== 'None'
          const isImage = isImageElement(el)
          const preview = renderPreview(el) || '(empty)'
          const imgSrc = isImage && imagePreviewUrl ? imagePreviewUrl(el) : null
          const qrSrc = isBarcode && barcodePreviewUrl ? barcodePreviewUrl(el) : null
          const textEl = isTextElement(el) ? el : null
          const textFitShrink =
            textEl && (textEl.textFitMode === 'ShrinkToFit' || textEl.textFitMode == null)

          return (
            <div
              key={el.id}
              className={`label-studio-canvas-element${isSelected ? ' active' : ''}${isBarcode ? ` label-studio-canvas-barcode ls-barcode-text-${el.textPosition.toLowerCase()}` : ''}${isImage ? ' label-studio-canvas-image' : ''}${textFitShrink ? ' ls-text-shrink' : ''}`}
              style={{
                left: `${el.xPct}%`,
                top: `${el.yPct}%`,
                width: `${el.widthPct}%`,
                height: `${el.heightPct}%`,
                zIndex: zIndex + 1,
                ...(textEl
                  ? {
                      fontSize: `${previewFontSizePx(textEl, printableHeightPx, paper, textLineCount?.(el))}px`,
                      fontWeight: textEl.bold ? 700 : 400,
                      textAlign: textEl.align.toLowerCase() as 'left' | 'center' | 'right',
                    }
                  : {}),
              }}
              onPointerDown={(ev) => {
                ev.stopPropagation()
                startMove(el, ev)
              }}
            >
              {isBarcode ? (
                qrSrc ? (
                  <>
                    <img
                      className={`ls-canvas-qr${barcodeShowText ? '' : ' ls-canvas-qr-full'}`}
                      src={qrSrc}
                      alt=""
                    />
                    {barcodeShowText && (
                      <span className="label-studio-barcode-caption">{preview}</span>
                    )}
                  </>
                ) : (
                  <>
                    <div className="label-studio-barcode-bars" aria-hidden />
                    {barcodeShowText && (
                      <span className="label-studio-barcode-caption">{preview}</span>
                    )}
                  </>
                )
              ) : isImage ? (
                imgSrc ? (
                  <img className="ls-canvas-image" src={imgSrc} alt="" />
                ) : (
                  <span className="ls-element-text">No image</span>
                )
              ) : (
                <span className="ls-element-text">{preview}</span>
              )}

              {isSelected &&
                RESIZE_HANDLES.map((handle) => (
                  <div
                    key={handle}
                    className={`ls-resize-handle ls-resize-${handle}`}
                    title="Drag to resize (Shift = keep proportions)"
                    onPointerDown={(ev) => startResize(el, handle, ev)}
                  />
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
