import { Canvas } from '@react-three/fiber'
import { useRef } from 'react'
import { useOfficeStore } from '../../state/officeStore'
import { AgentFigure } from '../agents/AgentFigure'
import { layout } from '../layout'
import { Building } from './Building'
import { CameraRig } from './CameraRig'
import { City } from './City'
import { Lighting } from './Lighting'

const { width: W, depth: D } = layout.size
const BACKGROUND = '#121830'

function Office() {
  return (
    // Layout uses tile coordinates from the north-west corner; centre it on the origin.
    <group position={[-W / 2, 0, -D / 2]}>
      <City />
      <Building />
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
        camera={{ position: [40, 40, 40], zoom: 30, near: 0.1, far: 300 }}
        onPointerMissed={(e) => {
          // Clicking empty space clears the selection, but finishing a pan should not.
          const start = down.current
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return
          select(null)
        }}
      >
        <color attach="background" args={[BACKGROUND]} />
        <fog attach="fog" args={[BACKGROUND, 90, 170]} />
        <Lighting />
        <CameraRig />
        <Office />
      </Canvas>
    </div>
  )
}
