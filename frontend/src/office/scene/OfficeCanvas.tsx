import { Canvas } from '@react-three/fiber'
import { useRef } from 'react'
import { useOfficeStore } from '../../state/officeStore'
import { AgentFigure } from '../agents/AgentFigure'
import { FurniturePiece } from '../furniture/FurniturePiece'
import { Workstation } from '../furniture/Workstation'
import { layout } from '../layout'
import { Room } from '../rooms/Room'
import { Wall } from '../rooms/Wall'
import { CameraRig } from './CameraRig'
import { Lighting } from './Lighting'

const { width: W, depth: D } = layout.size
const BACKGROUND = '#121830'

function Office() {
  return (
    // Layout uses tile coordinates from the north-west corner; centre it on the origin.
    <group position={[-W / 2, 0, -D / 2]}>
      <mesh position={[W / 2, -0.4, D / 2]} receiveShadow>
        <boxGeometry args={[W + 0.8, 0.6, D + 0.8]} />
        <meshStandardMaterial color="#1f2747" roughness={1} />
      </mesh>
      {layout.rooms.map((r) => (
        <Room key={r.id} room={r} />
      ))}
      {layout.walls.map((w) => (
        <Wall key={w.id} wall={w} />
      ))}
      {layout.workstations.map((ws) => (
        <Workstation key={ws.id} ws={ws} />
      ))}
      {layout.furniture.map((f) => (
        <FurniturePiece key={f.id} item={f} />
      ))}
      {layout.agents.map((a) => (
        <AgentFigure key={a.id} agent={a} />
      ))}
    </group>
  )
}

export function OfficeCanvas() {
  const select = useOfficeStore((s) => s.select)
  const down = useRef<{ x: number; y: number } | null>(null)

  return (
    <div
      className="office-canvas"
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY }
      }}
    >
      <Canvas
        orthographic
        shadows="percentage"
        dpr={[1, 2]}
        frameloop="demand"
        camera={{ position: [40, 40, 40], zoom: 30, near: 0.1, far: 300 }}
        onPointerMissed={(e) => {
          // Clicking empty space clears the selection, but finishing a pan should not.
          const start = down.current
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return
          select(null)
        }}
      >
        <color attach="background" args={[BACKGROUND]} />
        <Lighting />
        <CameraRig />
        <Office />
      </Canvas>
    </div>
  )
}
