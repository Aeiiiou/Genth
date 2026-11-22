import { useEffect } from 'react'
import { useOfficeStore } from '../state/officeStore'

const ZOOM_STEP = 1.25

export function ViewControls() {
  const rotate = useOfficeStore((s) => s.rotate)
  const zoomBy = useOfficeStore((s) => s.zoomBy)
  const resetView = useOfficeStore((s) => s.resetView)
  const select = useOfficeStore((s) => s.select)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
      switch (e.key.toLowerCase()) {
        case 'q':
          rotate(-1)
          break
        case 'e':
          rotate(1)
          break
        case '=':
        case '+':
          zoomBy(ZOOM_STEP)
          break
        case '-':
          zoomBy(1 / ZOOM_STEP)
          break
        case 'r':
          resetView()
          break
        case 'escape':
          select(null)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rotate, zoomBy, resetView, select])

  return (
    <div className="panel view-controls">
      <div className="btn-row">
        <button type="button" title="Rotate left (Q)" onClick={() => rotate(-1)}>
          ⟲
        </button>
        <button type="button" title="Rotate right (E)" onClick={() => rotate(1)}>
          ⟳
        </button>
        <button type="button" title="Zoom out (-)" onClick={() => zoomBy(1 / ZOOM_STEP)}>
          −
        </button>
        <button type="button" title="Zoom in (+)" onClick={() => zoomBy(ZOOM_STEP)}>
          +
        </button>
        <button type="button" title="Reset view (R)" onClick={resetView}>
          ⌂
        </button>
      </div>
      <p className="hint">Drag to pan · scroll to zoom · Q/E rotate · R reset</p>
    </div>
  )
}
