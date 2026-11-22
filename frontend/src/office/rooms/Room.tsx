import { Html } from '@react-three/drei'
import type { Room as RoomData } from '../layout/types'
import { useOfficeStore } from '../../state/officeStore'
import { Selectable } from '../Selectable'

export function Room({ room }: { room: RoomData }) {
  const [w, d] = room.size
  const cx = room.origin[0] + w / 2
  const cz = room.origin[1] + d / 2
  const active = useOfficeStore((s) => s.selected?.kind === 'room' && s.selected.id === room.id)

  return (
    <Selectable kind="room" id={room.id} footprint={[w, d]} position={[cx, 0, cz]}>
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[w, 0.1, d]} />
        <meshStandardMaterial color={room.floorColor} roughness={0.95} />
      </mesh>
      <Html position={[0, 0.05, d / 2 - 0.45]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`room-label${active ? ' room-label--active' : ''}`}>{room.name}</div>
      </Html>
    </Selectable>
  )
}
