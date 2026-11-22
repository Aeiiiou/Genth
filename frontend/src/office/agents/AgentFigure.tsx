import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { type Group, MathUtils } from 'three'
import { livePlaces, useAgentMotion } from '../../state/agentMotion'
import { useOfficeStore } from '../../state/officeStore'
import { deg, deskSpot, FLOOR_HEIGHT } from '../layout'
import type { Agent, Vec2 } from '../layout/types'
import { ELEVATOR_SECONDS_PER_FLOOR } from '../navigation/route'
import { Selectable } from '../Selectable'

const SKIN = '#f1c9a5'
const PANTS = '#2b3354'
/** Walking speed in tiles per second. */
const SPEED = 2.2
const LIFT_SPEED = FLOOR_HEIGHT / ELEVATOR_SECONDS_PER_FLOOR
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
 * An agent: walks the routes planned by the motion store (riding the elevator between floors),
 * sits or stands on arrival, and shows its status and speech. Per-frame animation goes through
 * refs; React only re-renders when a new walk starts, the agent changes floor, or it speaks.
 */
export function AgentFigure({ agent }: { agent: Agent }) {
  const home = deskSpot(agent.id)
  const active = useOfficeStore((s) => s.selected?.kind === 'agent' && s.selected.id === agent.id)
  const status = useOfficeStore((s) => s.agentStatus[agent.id])
  const speech = useOfficeStore((s) => s.speech[agent.id])
  const focusFloor = useOfficeStore((s) => s.focusFloor)
  const motion = useAgentMotion((s) => s.motions[agent.id])
  const floor = useAgentMotion((s) => s.floors[agent.id])
  const setFloor = useAgentMotion((s) => s.setFloor)

  const saying = speech?.text ?? null

  const root = useRef<Group>(null)
  const facing = useRef<Group>(null)
  const legs = useRef<(Group | null)[]>([])
  const arms = useRef<(Group | null)[]>([])
  const sim = useRef({
    pos: (home?.at ?? [0, 0]) as Vec2,
    y: (home?.floor ?? 0) * FLOOR_HEIGHT,
    heading: deg(home?.facing),
    nonce: 0,
    next: 0,
    stride: 0,
    seatedness: 1, // 1 = sitting, 0 = standing
  })

  useFrame((_, rawDt) => {
    if (!root.current || !facing.current || !motion) return
    const dt = Math.min(rawDt, 0.1) // don't teleport after the tab was in the background
    const s = sim.current
    if (motion.nonce !== s.nonce) {
      s.nonce = motion.nonce
      s.next = 0
    }

    const step = motion.route[s.next]
    const moving = step !== undefined
    let walking = false
    let targetHeading = s.heading

    if (step?.kind === 'ride') {
      const targetY = step.floor * FLOOR_HEIGHT
      const dy = targetY - s.y
      if (Math.abs(dy) <= LIFT_SPEED * dt) {
        s.y = targetY
        s.next++
      } else {
        s.y += Math.sign(dy) * LIFT_SPEED * dt
      }
      targetHeading = Math.PI / 2 // face the door while riding
    } else if (step?.kind === 'walk') {
      s.y = step.floor * FLOOR_HEIGHT
      const [tx, tz] = step.at
      const dx = tx - s.pos[0]
      const dz = tz - s.pos[1]
      const dist = Math.hypot(dx, dz)
      if (dist <= SPEED * dt) {
        s.pos = [tx, tz]
        s.next++
      } else {
        s.pos = [s.pos[0] + (dx / dist) * SPEED * dt, s.pos[1] + (dz / dist) * SPEED * dt]
      }
      if (dist > 1e-3) targetHeading = Math.atan2(dx, dz)
      s.stride += dt * STRIDE_RATE
      walking = true
    } else if (motion.facing !== null) {
      targetHeading = deg(motion.facing)
    }

    s.heading += angleDelta(s.heading, targetHeading) * Math.min(1, dt * TURN_RATE)

    const sitTarget = !moving && motion.seated ? 1 : 0
    s.seatedness = Math.abs(s.seatedness - sitTarget) < 1e-3 ? sitTarget : MathUtils.lerp(s.seatedness, sitTarget, Math.min(1, dt * POSE_RATE))

    const swing = walking ? Math.sin(s.stride) : 0
    const legBase = MathUtils.lerp(POSES.standing.leg, POSES.seated.leg, s.seatedness)
    const armBase = MathUtils.lerp(POSES.standing.arm, POSES.seated.arm, s.seatedness)
    legs.current.forEach((l, i) => l && (l.rotation.x = legBase + swing * 0.55 * (i ? -1 : 1)))
    arms.current.forEach((a, i) => a && (a.rotation.x = armBase + swing * 0.5 * (i ? 1 : -1)))

    root.current.position.set(s.pos[0], s.y + (walking ? Math.abs(Math.sin(s.stride)) * 0.04 : 0), s.pos[1])
    facing.current.rotation.y = s.heading

    const currentFloor = Math.round(s.y / FLOOR_HEIGHT)
    livePlaces.set(agent.id, { floor: currentFloor, at: s.pos })
    if (currentFloor !== floor) setFloor(agent.id, currentFloor)
  })

  if (!home) return null
  const visible = floor === focusFloor

  return (
    <group ref={root} position={[home.at[0], home.floor * FLOOR_HEIGHT, home.at[1]]} visible={visible}>
      <group ref={facing} rotation={[0, deg(home.facing), 0]}>
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
      {visible && (
        <Html position={[0, 1.7, 0]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
          <div className={active ? 'bubble bubble--active' : 'bubble'}>
            {saying && <span className="bubble__speech">{saying}</span>}
            <span className="bubble__name" style={{ color: agent.color }}>
              {agent.name}
            </span>
            {/* Status only while working (or selected) keeps crowded rooms readable; the bar shows all. */}
            {status && (active || status.tone === 'busy' || status.tone === 'error') && (
              <span className="bubble__status">
                <span className={'dot dot--' + status.tone} />
                {status.text}
              </span>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}
