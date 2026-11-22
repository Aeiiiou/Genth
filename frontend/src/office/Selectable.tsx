import type { ThreeEvent } from '@react-three/fiber'
import type { ReactNode } from 'react'
import { type SelectionKind, useOfficeStore } from '../state/officeStore'
import type { V3 } from './furniture/primitives'

/** Pointer travel (px) above which a press counts as a pan, not a click. */
const DRAG_THRESHOLD = 5
const noRaycast = () => null

interface Props {
  kind: SelectionKind
  id: string
  /** Width/depth of the highlight drawn on the floor, in local space. */
  footprint: [number, number]
  footprintOffset?: [number, number]
  position?: V3
  rotationY?: number
  children: ReactNode
}

/** Makes its children hoverable and clickable, with a floor highlight when active. */
export function Selectable({ kind, id, footprint, footprintOffset = [0, 0], position, rotationY = 0, children }: Props) {
  const key = `${kind}:${id}`
  const isSelected = useOfficeStore((s) => s.selected?.kind === kind && s.selected.id === id)
  const isHovered = useOfficeStore((s) => s.hovered === key)
  const select = useOfficeStore((s) => s.select)
  const hover = useOfficeStore((s) => s.hover)

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > DRAG_THRESHOLD) return
    e.stopPropagation()
    select({ kind, id })
  }
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    hover(key)
    document.body.style.cursor = 'pointer'
  }
  const onOut = () => {
    if (useOfficeStore.getState().hovered === key) hover(null)
    document.body.style.cursor = ''
  }

  const isRoom = kind === 'room'
  const pad = isRoom ? 0 : 0.25
  const opacity = isSelected ? (isRoom ? 0.28 : 0.5) : isRoom ? 0.14 : 0.3

  return (
    <group position={position} rotation={[0, rotationY, 0]} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
      {children}
      {(isSelected || isHovered) && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[footprintOffset[0], isRoom ? 0.012 : 0.03, footprintOffset[1]]}
          raycast={noRaycast}
          renderOrder={1}
        >
          <planeGeometry args={[footprint[0] + pad, footprint[1] + pad]} />
          <meshBasicMaterial color={isSelected ? '#2f7cf6' : '#7fb2ff'} transparent opacity={opacity} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}
