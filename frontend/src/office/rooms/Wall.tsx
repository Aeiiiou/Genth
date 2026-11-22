import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { type Group, MathUtils, Vector3 } from 'three'
import { layout } from '../layout'
import type { Wall as WallData } from '../layout/types'

const THICKNESS = 0.15
const OUTER_TALL = 2.8
const OUTER_CUT = 0.35
const PARTITION = 1.2
const COLORS = {
  outer: { body: '#efe8dc', trim: '#cfc4b2' },
  partition: { body: '#e7e0d3', trim: '#bfb3a0' },
}

const camDir = new Vector3()

/** Splits a wall into solid pieces around its door openings. Returns [start, end] offsets. */
function solidSpans(length: number, doors: WallData['doors'] = []) {
  const spans: [number, number][] = []
  let cursor = 0
  for (const door of [...doors].sort((a, b) => a.at - b.at)) {
    if (door.at > cursor) spans.push([cursor, door.at])
    cursor = Math.max(cursor, door.at + door.width)
  }
  if (cursor < length) spans.push([cursor, length])
  return spans
}

/** Outward normal (x, z) of an outer wall, judged from which side of the office it sits on. */
function outwardNormal(wall: WallData): [number, number] {
  const { width, depth } = layout.size
  if (wall.from[1] === wall.to[1]) return wall.from[1] < depth / 2 ? [0, -1] : [0, 1]
  return wall.from[0] < width / 2 ? [-1, 0] : [1, 0]
}

export function Wall({ wall }: { wall: WallData }) {
  const isOuter = wall.kind === 'outer'
  const colors = COLORS[wall.kind]
  const baseHeight = isOuter ? OUTER_TALL : PARTITION
  const horizontal = wall.from[1] === wall.to[1]
  const start = horizontal ? Math.min(wall.from[0], wall.to[0]) : Math.min(wall.from[1], wall.to[1])
  const length = Math.abs(horizontal ? wall.to[0] - wall.from[0] : wall.to[1] - wall.from[1])
  const normal = isOuter ? outwardNormal(wall) : null

  const body = useRef<Group>(null)
  const trim = useRef<Group>(null)
  const height = useRef(baseHeight)

  // Outer walls between the camera and the office drop to a low cut so rooms stay visible.
  useFrame((state, dt) => {
    if (!normal || !body.current || !trim.current) return
    state.camera.getWorldDirection(camDir)
    // camDir points into the scene; the camera sits on the wall's outer side when it points inward.
    const inFront = -(camDir.x * normal[0] + camDir.z * normal[1]) > 0.05
    const target = inFront ? OUTER_CUT : OUTER_TALL
    if (Math.abs(height.current - target) < 0.005) {
      if (height.current === target) return
      height.current = target
    } else {
      height.current = MathUtils.lerp(height.current, target, Math.min(1, dt * 8))
      state.invalidate()
    }
    body.current.scale.y = height.current / baseHeight
    trim.current.position.y = height.current + 0.02
  })

  const pieces = solidSpans(length, wall.doors).map(([a, b]) => {
    // Extend outer ends by half the thickness so corners close cleanly.
    const a2 = a === 0 ? a - THICKNESS / 2 : a
    const b2 = b === length ? b + THICKNESS / 2 : b
    const mid = start + (a2 + b2) / 2
    const len = b2 - a2
    return {
      key: a,
      x: horizontal ? mid : wall.from[0],
      z: horizontal ? wall.from[1] : mid,
      sx: horizontal ? len : THICKNESS,
      sz: horizontal ? THICKNESS : len,
    }
  })

  return (
    <group>
      <group ref={body}>
        {pieces.map((p) => (
          <mesh key={p.key} position={[p.x, baseHeight / 2, p.z]} castShadow receiveShadow>
            <boxGeometry args={[p.sx, baseHeight, p.sz]} />
            <meshStandardMaterial color={colors.body} roughness={0.95} />
          </mesh>
        ))}
      </group>
      <group ref={trim} position={[0, baseHeight + 0.02, 0]}>
        {pieces.map((p) => (
          <mesh key={p.key} position={[p.x, 0, p.z]}>
            <boxGeometry args={[p.sx + 0.02, 0.04, p.sz + 0.02]} />
            <meshStandardMaterial color={colors.trim} roughness={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
