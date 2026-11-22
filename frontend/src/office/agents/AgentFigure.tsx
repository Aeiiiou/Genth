import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type Group, MathUtils } from 'three'
import { livePositions, useAgentMotion } from '../../state/agentMotion'
import { useOfficeStore } from '../../state/officeStore'
import { deg, seatOf, workstationById } from '../layout'
import type { Agent, Vec2 } from '../layout/types'
import { Selectable } from '../Selectable'

const SKIN = '#f1c9a5'
const PANTS = '#2b3354'
/** Walking speed in tiles per second. */
const SPEED = 2.2
const TURN_RATE = 10
const POSE_RATE = 8
const STRIDE_RATE = 9

/** Joint angles (radians, around the x axis; negative swings forward). */
const POSES = {
  seated: { leg: -1.45, arm: -1.2 },
  standing: { leg: 0, arm: 0 },
}

/** Shortest signed angle from a to b. */
function angleDelta(a: number, b: number) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a))
}

/**
 * An agent: walks the paths planned by the motion store, sits at its desk, and shows its status
 * bubble. All per-frame animation goes through refs; React only re-renders when a new walk starts.
 */
export function AgentFigure({ agent }: { agent: Agent }) {
  const ws = workstationById.get(agent.workstationId)
  const seat = seatOf(agent.workstationId)
  const active = useOfficeStore((s) => s.selected?.kind === 'agent' && s.selected.id === agent.id)
  const status = useOfficeStore((s) => s.agentStatus[agent.id])
  const motion = useAgentMotion((s) => s.motions[agent.id])

  // Seated agents face the desk, i.e. opposite to the workstation's front.
  const deskHeading = deg(ws?.rotation) + Math.PI

  const root = useRef<Group>(null)
  const facing = useRef<Group>(null)
  const legs = useRef<(Group | null)[]>([])
  const arms = useRef<(Group | null)[]>([])
  const sim = useRef({
    pos: (seat ?? [0, 0]) as Vec2,
    heading: deskHeading,
    nonce: 0,
    next: 0,
    stride: 0,
    seatedness: 1, // 1 = sitting, 0 = standing
  })

  // frameloop="demand": a new walk must request a frame to get the animation going.
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => invalidate(), [motion?.nonce, invalidate])

  useFrame((state, dt) => {
    if (!root.current || !facing.current || !motion) return
    const s = sim.current
    if (motion.nonce !== s.nonce) {
      s.nonce = motion.nonce
      s.next = 0
    }

    let busy = false
    const walking = s.next < motion.path.length
    let targetHeading = s.heading

    if (walking) {
      const [tx, tz] = motion.path[s.next]
      const dx = tx - s.pos[0]
      const dz = tz - s.pos[1]
      const dist = Math.hypot(dx, dz)
      const step = SPEED * dt
      if (dist <= step) {
        s.pos = [tx, tz]
        s.next++
      } else {
        s.pos = [s.pos[0] + (dx / dist) * step, s.pos[1] + (dz / dist) * step]
      }
      if (dist > 1e-3) targetHeading = Math.atan2(dx, dz)
      s.stride += dt * STRIDE_RATE
      busy = true
    } else if (motion.seated) {
      targetHeading = deskHeading
    }

    // Turn smoothly toward the target heading.
    const turn = angleDelta(s.heading, targetHeading)
    if (Math.abs(turn) > 1e-3) {
      s.heading += turn * Math.min(1, dt * TURN_RATE)
      busy = true
    }

    // Blend between sitting and standing.
    const sitTarget = !walking && motion.seated ? 1 : 0
    if (Math.abs(s.seatedness - sitTarget) > 1e-3) {
      s.seatedness = MathUtils.lerp(s.seatedness, sitTarget, Math.min(1, dt * POSE_RATE))
      busy = true
    } else {
      s.seatedness = sitTarget
    }

    const swing = walking ? Math.sin(s.stride) : 0
    const legBase = MathUtils.lerp(POSES.standing.leg, POSES.seated.leg, s.seatedness)
    const armBase = MathUtils.lerp(POSES.standing.arm, POSES.seated.arm, s.seatedness)
    legs.current.forEach((l, i) => l && (l.rotation.x = legBase + swing * 0.55 * (i ? -1 : 1)))
    arms.current.forEach((a, i) => a && (a.rotation.x = armBase + swing * 0.5 * (i ? 1 : -1)))

    root.current.position.set(s.pos[0], walking ? Math.abs(Math.sin(s.stride)) * 0.04 : 0, s.pos[1])
    facing.current.rotation.y = s.heading
    livePositions.set(agent.id, s.pos)

    if (busy) state.invalidate()
  })

  if (!ws || !seat) return null

  return (
    <group ref={root} position={[seat[0], 0, seat[1]]}>
      <group ref={facing} rotation={[0, deskHeading, 0]}>
        <Selectable kind="agent" id={agent.id} footprint={[0.6, 0.6]}>
          {[-0.1, 0.1].map((x, i) => (
            <group key={x} ref={(g) => void (legs.current[i] = g)} position={[x, 0.55, 0]} rotation={[POSES.seated.leg, 0, 0]}>
              <mesh position={[0, -0.26, 0]} castShadow>
                <capsuleGeometry args={[0.075, 0.38, 3, 8]} />
                <meshStandardMaterial color={PANTS} roughness={0.8} />
              </mesh>
            </group>
          ))}
          <mesh position={[0, 0.82, 0]} castShadow>
            <capsuleGeometry args={[0.19, 0.3, 4, 12]} />
            <meshStandardMaterial color={agent.color} roughness={0.7} />
          </mesh>
          <mesh position={[0, 1.27, 0]} castShadow>
            <sphereGeometry args={[0.17, 16, 12]} />
            <meshStandardMaterial color={SKIN} roughness={0.7} />
          </mesh>
          {[-0.25, 0.25].map((x, i) => (
            <group key={x} ref={(g) => void (arms.current[i] = g)} position={[x, 1.0, 0]} rotation={[POSES.seated.arm, 0, 0]}>
              <mesh position={[0, -0.17, 0]} castShadow>
                <capsuleGeometry args={[0.055, 0.24, 3, 8]} />
                <meshStandardMaterial color={agent.color} roughness={0.7} />
              </mesh>
            </group>
          ))}
        </Selectable>
      </group>
      <Html position={[0, 1.7, 0]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
        <div className={active ? 'bubble bubble--active' : 'bubble'}>
          <span className="bubble__name" style={{ color: agent.color }}>
            {agent.name}
          </span>
          {status && (
            <span className="bubble__status">
              <span className={'dot dot--' + status.tone} />
              {status.text}
            </span>
          )}
        </div>
      </Html>
    </group>
  )
}
