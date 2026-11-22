import { MapControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { type ComponentRef, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { MathUtils, type OrthographicCamera, Vector3 } from 'three'
import { useOfficeStore } from '../../state/officeStore'
import { layout } from '../layout'

const { width: W, depth: D } = layout.size
const UP = new Vector3(0, 1, 0)
/** Classic isometric view: 45° around, ~35.26° down. */
const BASE_AZIMUTH = Math.PI / 4
const QUARTER = Math.PI / 2
const DISTANCE = 60
const ELEVATION = Math.atan(1 / Math.SQRT2)
const PAN_MARGIN = 2
const SMOOTHING = 10
const MIN_ZOOM_FACTOR = 0.6
const MAX_ZOOM_FACTOR = 5

function isoOffset(azimuth: number) {
  const h = Math.cos(ELEVATION) * DISTANCE
  return new Vector3(Math.sin(azimuth) * h, Math.sin(ELEVATION) * DISTANCE, Math.cos(azimuth) * h)
}

/** Zoom that fits the whole office (plus tall back walls) in the viewport. */
function fitZoom(width: number, height: number) {
  const spanW = (W + D) * Math.SQRT1_2
  const spanH = spanW * Math.sin(ELEVATION) + 2.8 * Math.cos(ELEVATION)
  return Math.min(width / (spanW + 3), height / (spanH + 3))
}

/**
 * Orthographic isometric camera: MapControls handles pan and wheel zoom; rotation snaps in
 * 90° steps (animated) and button zoom/reset animate toward a target.
 */
export function CameraRig() {
  const controls = useRef<ComponentRef<typeof MapControls>>(null)
  const get = useThree((s) => s.get)
  const size = useThree((s) => s.size)
  const fit = fitZoom(size.width, size.height)

  const viewIndex = useOfficeStore((s) => s.viewIndex)
  const zoomCommand = useOfficeStore((s) => s.zoomCommand)
  const resetNonce = useOfficeStore((s) => s.resetNonce)

  const azimuth = useRef(BASE_AZIMUTH + viewIndex * QUARTER)
  const zoomTarget = useRef<number | null>(null)

  // Initial framing (mount only; later framing goes through reset and zoom commands).
  useLayoutEffect(() => {
    const { camera, size } = get()
    camera.position.copy(isoOffset(azimuth.current))
    camera.lookAt(0, 0, 0)
    camera.zoom = fitZoom(size.width, size.height)
    camera.updateProjectionMatrix()
  }, [get])

  // frameloop="demand": a store change alone doesn't render, so kick off the rotation animation.
  useEffect(() => {
    get().invalidate()
  }, [viewIndex, get])

  useEffect(() => {
    if (zoomCommand.nonce === 0) return
    const { camera, invalidate } = get()
    const from = zoomTarget.current ?? camera.zoom
    zoomTarget.current = MathUtils.clamp(from * zoomCommand.factor, fit * MIN_ZOOM_FACTOR, fit * MAX_ZOOM_FACTOR)
    invalidate()
  }, [zoomCommand, fit, get])

  useEffect(() => {
    const c = controls.current
    if (resetNonce === 0 || !c) return
    const { camera, invalidate } = get()
    camera.position.sub(c.target)
    c.target.set(0, 0, 0)
    zoomTarget.current = fit
    invalidate()
  }, [resetNonce, fit, get])

  useFrame((state, dt) => {
    const c = controls.current
    if (!c) return
    const camera = state.camera as OrthographicCamera
    const k = Math.min(1, dt * SMOOTHING)
    let animating = false

    const diff = BASE_AZIMUTH + viewIndex * QUARTER - azimuth.current
    if (Math.abs(diff) > 1e-4) {
      const step = Math.abs(diff) < 1e-3 ? diff : diff * k
      const offset = camera.position.clone().sub(c.target).applyAxisAngle(UP, step)
      camera.position.copy(c.target).add(offset)
      azimuth.current += step
      animating = true
    }

    const z = zoomTarget.current
    if (z !== null) {
      camera.zoom = Math.abs(z - camera.zoom) < 0.01 ? z : MathUtils.lerp(camera.zoom, z, k)
      if (camera.zoom === z) zoomTarget.current = null
      camera.updateProjectionMatrix()
      animating = true
    }

    if (animating) {
      c.update()
      state.invalidate()
    }
  })

  /** Keep the view over the office. */
  const clampPan = useCallback(() => {
    const c = controls.current
    if (!c) return
    const { camera } = get()
    const t = c.target
    const x = MathUtils.clamp(t.x, -W / 2 - PAN_MARGIN, W / 2 + PAN_MARGIN)
    const z = MathUtils.clamp(t.z, -D / 2 - PAN_MARGIN, D / 2 + PAN_MARGIN)
    if (x !== t.x || z !== t.z) {
      camera.position.x += x - t.x
      camera.position.z += z - t.z
      t.set(x, t.y, z)
    }
  }, [get])

  /** Manual interaction takes over from any running zoom animation. */
  const stopZoomAnimation = useCallback(() => {
    zoomTarget.current = null
  }, [])

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableRotate={false}
      enableDamping={false}
      zoomToCursor
      minZoom={fit * MIN_ZOOM_FACTOR}
      maxZoom={fit * MAX_ZOOM_FACTOR}
      onChange={clampPan}
      onStart={stopZoomAnimation}
    />
  )
}
