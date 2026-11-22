import { Html } from '@react-three/drei'
import { useOfficeStore } from '../../state/officeStore'
import { FurniturePiece } from '../furniture/FurniturePiece'
import { Workstation } from '../furniture/Workstation'
import { allWalls, floorByLevel, FLOOR_HEIGHT, layout } from '../layout'
import { Room } from '../rooms/Room'
import { Wall } from '../rooms/Wall'

const { width: W, depth: D } = layout.size
const SLAB = 0.22
const { origin: eo, size: es, door } = layout.elevator

/** Elevator car standing at a floor: platform, light and floor display. */
function ElevatorCar({ level }: { level: number }) {
  const [x0, z0] = eo
  const cx = x0 + es[0] / 2
  const cz = z0 + es[1] / 2
  const doorZ = z0 + door.at + door.width / 2
  return (
    <group>
      <mesh position={[cx, 0.02, cz]} receiveShadow>
        <boxGeometry args={[es[0] - 0.1, 0.04, es[1] - 0.1]} />
        <meshStandardMaterial color="#3a4470" metalness={0.4} roughness={0.5} />
      </mesh>
      {/* No ceiling panel: we look down into the car, so riders stay visible. */}
      <pointLight position={[cx, 2.2, cz]} color="#ffeccc" intensity={3} distance={4} decay={2} />
      {/* Floor display above the door, outside the shaft. */}
      <Html position={[x0 + es[0] + 0.1, 2.75, doorZ]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className="lift-sign">▲▼ {floorByLevel.get(level)?.short}</div>
      </Html>
    </group>
  )
}

/** The floor you're looking at: rooms, walls, desks, furniture and the elevator car. */
function FloorInterior({ level }: { level: number }) {
  return (
    <group position={[0, level * FLOOR_HEIGHT, 0]}>
      {layout.rooms
        .filter((r) => r.floor === level)
        .map((r) => (
          <Room key={r.id} room={r} />
        ))}
      {allWalls
        .filter((w) => w.floor === level)
        .map((w) => (
          <Wall key={w.id} wall={w} />
        ))}
      {layout.workstations
        .filter((ws) => ws.floor === level)
        .map((ws) => (
          <Workstation key={ws.id} ws={ws} />
        ))}
      {layout.furniture
        .filter((f) => f.floor === level)
        .map((f) => (
          <FurniturePiece key={f.id} item={f} />
        ))}
      <ElevatorCar level={level} />
    </group>
  )
}

/** A floor below the one in focus, seen from outside: slab and full-height walls with lit windows. */
function FloorShell({ level }: { level: number }) {
  return (
    <group position={[0, level * FLOOR_HEIGHT, 0]}>
      <mesh position={[W / 2, -SLAB / 2, D / 2]} receiveShadow castShadow>
        <boxGeometry args={[W + 0.15, SLAB, D + 0.15]} />
        <meshStandardMaterial color="#1e2648" roughness={1} />
      </mesh>
      {allWalls
        .filter((w) => w.floor === level && w.kind === 'outer')
        .map((w) => (
          <Wall key={w.id} wall={w} solid />
        ))}
    </group>
  )
}

/**
 * The building in cutaway: floors below the focused one as solid storeys, the focused floor open,
 * floors above hidden so you can look in.
 */
export function Building() {
  const focus = useOfficeStore((s) => s.focusFloor)
  return (
    <group>
      {layout.floors
        .filter((f) => f.level <= focus)
        .map((f) => (f.level === focus ? <FloorInterior key={f.level} level={f.level} /> : <FloorShell key={f.level} level={f.level} />))}
    </group>
  )
}
