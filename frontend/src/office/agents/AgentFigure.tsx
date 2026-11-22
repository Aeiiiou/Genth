import { Html } from '@react-three/drei'
import { deg, rotateOffset, SEAT_OFFSET, workstationById } from '../layout'
import type { Agent } from '../layout/types'
import { useOfficeStore } from '../../state/officeStore'
import { Selectable } from '../Selectable'

const SKIN = '#f1c9a5'

/**
 * Static seated placeholder. Phase 2 drives position/animation from backend events;
 * Phase 8 replaces the shapes with a proper character model.
 */
export function AgentFigure({ agent }: { agent: Agent }) {
  const ws = workstationById.get(agent.workstationId)
  const active = useOfficeStore((s) => s.selected?.kind === 'agent' && s.selected.id === agent.id)
  if (!ws) return null

  const [ox, oz] = rotateOffset(SEAT_OFFSET, ws.rotation)
  // Seated agents face the desk, i.e. opposite to the workstation's front.
  const facing = deg(ws.rotation) + Math.PI

  return (
    <Selectable
      kind="agent"
      id={agent.id}
      footprint={[0.6, 0.6]}
      position={[ws.position[0] + ox, 0, ws.position[1] + oz]}
      rotationY={facing}
    >
      <mesh position={[0, 0.82, 0]} castShadow>
        <capsuleGeometry args={[0.19, 0.3, 4, 12]} />
        <meshStandardMaterial color={agent.color} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.27, 0]} castShadow>
        <sphereGeometry args={[0.17, 16, 12]} />
        <meshStandardMaterial color={SKIN} roughness={0.7} />
      </mesh>
      {/* Arms reaching toward the keyboard. */}
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} position={[x, 0.9, 0.2]} rotation={[-1.1, 0, 0]} castShadow>
          <capsuleGeometry args={[0.055, 0.26, 3, 8]} />
          <meshStandardMaterial color={agent.color} roughness={0.7} />
        </mesh>
      ))}
      <Html position={[0, 1.75, 0]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
        <div className={`agent-tag${active ? ' agent-tag--active' : ''}`} style={{ borderColor: agent.color }}>
          <span className="agent-tag__dot" style={{ background: agent.color }} />
          {agent.name}
        </div>
      </Html>
    </Selectable>
  )
}
