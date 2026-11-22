import { Html } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import { CanvasTexture, Color, NearestFilter, RepeatWrapping, SRGBColorSpace } from 'three'
import type { Room as RoomData } from '../layout/types'
import { useOfficeStore } from '../../state/officeStore'
import { Selectable } from '../Selectable'

/** A 2×2 checker (one square per floor tile) with crisp, pixel-art edges. */
function checkerTexture(a: string, b: string, width: number, depth: number) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 2
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = a
  ctx.fillRect(0, 0, 2, 2)
  ctx.fillStyle = b
  ctx.fillRect(1, 0, 1, 1)
  ctx.fillRect(0, 1, 1, 1)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.magFilter = NearestFilter
  tex.minFilter = NearestFilter
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.repeat.set(width / 2, depth / 2)
  return tex
}

export function Room({ room }: { room: RoomData }) {
  const [w, d] = room.size
  const cx = room.origin[0] + w / 2
  const cz = room.origin[1] + d / 2
  const active = useOfficeStore((s) => s.selected?.kind === 'room' && s.selected.id === room.id)

  const texture = useMemo(() => {
    const accent = room.floorAccent ?? `#${new Color(room.floorColor).multiplyScalar(0.9).getHexString()}`
    return checkerTexture(room.floorColor, accent, w, d)
  }, [room.floorColor, room.floorAccent, w, d])
  useEffect(() => () => texture.dispose(), [texture])

  return (
    <Selectable kind="room" id={room.id} footprint={[w, d]} position={[cx, 0, cz]}>
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[w, 0.1, d]} />
        <meshStandardMaterial map={texture} roughness={0.9} />
      </mesh>
      <Html position={[0, 0.05, d / 2 - 0.45]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`room-label${active ? ' room-label--active' : ''}`}>{room.name}</div>
      </Html>
    </Selectable>
  )
}
