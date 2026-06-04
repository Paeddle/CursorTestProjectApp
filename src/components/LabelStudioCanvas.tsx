import { useRef, useCallback } from 'react'
import type { LabelStudioElement } from '../types/labelStudio'
import { isBarcodeElement, isImageElement, isTextElement } from '../types/labelStudio'
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
  elements: LabelStudioElement[]
  selectedElementId: string | null
  onSelect: (id: string | null) => void
  onUpdateRect: (id: string, rect: ElementRect) => void
  renderPreview: (el: LabelStudioElement) => string
  imagePreviewUrl?: (el: LabelStudioElement) => string | null
}

function rectFromElement(el: LabelStudioElement): ElementRect {
  return { xPct: el.xPct, yPct: el.yPct, widthPct: el.widthPct, heightPct: el.heightPct }
}

export default function LabelStudioCanvas({
  elements,
  selectedElementId,
  onSelect,
  onUpdateRect,
  renderPreview,
  imagePreviewUrl,
}: LabelStudioCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  const onPointerMove = useCallback(
    (ev: React.PointerEvent) => {
      const drag = dragRef.current
      const canvas = canvasRef.current
      if (!drag || !canvas) return

      const rect = canvas.getBoundingClientRect()
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
      ref={canvasRef}
      className="label-studio-canvas"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerDown={() => onSelect(null)}
    >
      {elements.length === 0 && (
        <p className="ls-canvas-empty">Add text, image, or a barcode, then drag and resize like Label Live.</p>
      )}
      {elements.map((el, zIndex) => {
        const isSelected = selectedElementId === el.id
        const isBarcode = isBarcodeElement(el)
        const isImage = isImageElement(el)
        const preview = renderPreview(el) || '(empty)'
        const imgSrc = isImage && imagePreviewUrl ? imagePreviewUrl(el) : null
        const textFitShrink =
          isTextElement(el) && (el.textFitMode === 'ShrinkToFit' || el.textFitMode == null)

        return (
          <div
            key={el.id}
            className={`label-studio-canvas-element${isSelected ? ' active' : ''}${isBarcode ? ' label-studio-canvas-barcode' : ''}${isImage ? ' label-studio-canvas-image' : ''}${textFitShrink ? ' ls-text-shrink' : ''}`}
            style={{
              left: `${el.xPct}%`,
              top: `${el.yPct}%`,
              width: `${el.widthPct}%`,
              height: `${el.heightPct}%`,
              zIndex: zIndex + 1,
              ...(isTextElement(el)
                ? {
                    fontSize: `${Math.max(7, el.fontSize * 0.42)}px`,
                    fontWeight: el.bold ? 700 : 400,
                    textAlign: el.align.toLowerCase() as 'left' | 'center' | 'right',
                  }
                : {}),
            }}
            onPointerDown={(ev) => {
              ev.stopPropagation()
              startMove(el, ev)
            }}
          >
            {isBarcode ? (
              <>
                <div className="label-studio-barcode-bars" aria-hidden />
                <span className="label-studio-barcode-caption">{preview}</span>
              </>
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
  )
}
