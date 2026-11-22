import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { type Group, MathUtils, Vector3 } from 'three'
import { furnitureCatalog } from '../furniture/catalog'
import { layout } from '../layout'
import type { Wall as WallData } from '../layout/types'

const THICKNESS = 0.15
const OUTER_TALL = 2.8
const OUTER_CUT = 0.35
const GLASS_HEIGHT = 1.1
const RAIL = 0.07
/** Windows hide once a cut-away outer wall drops below this height. */
const WINDOW_MIN_HEIGHT = 1.8

const OUTER_BODY = '#27346a'
const OUTER_TRIM = '#3b4c8f'
const WINDOW = '#7fc4ff'
const GLASS = '#8fd0ff'
const RAIL_COLOR = '#4fa8ff'

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

interface Piece {
  key: number
  x: number
  z: number
  sx: number
  sz: number
  len: number
}

function wallPieces(wall: WallData): { pieces: Piece[]; horizontal: boolean } {
  const horizontal = wall.from[1] === wall.to[1]
  const start = horizontal ? Math.min(wall.from[0], wall.to[0]) : Math.min(wall.from[1], wall.to[1])
  const length = Math.abs(horizontal ? wall.to[0] - wall.from[0] : wall.to[1] - wall.from[1])
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
      len,
    }
  })
  return { pieces, horizontal }
}

/** Glass partition: transparent pane between a floor rail and a top rail. */
function GlassWall({ wall }: { wall: WallData }) {
  const { pieces } = wallPieces(wall)
  return (
    <group>
      {pieces.map((p) => (
        <group key={p.key} position={[p.x, 0, p.z]}>
          <mesh position={[0, GLASS_HEIGHT / 2, 0]} renderOrder={2}>
            <boxGeometry args={[p.sx * 0.999, GLASS_HEIGHT, p.sz * 0.4]} />
            <meshStandardMaterial color={GLASS} transparent opacity={0.22} roughness={0.1} depthWrite={false} />
          </mesh>
          <mesh position={[0, RAIL / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[p.sx, RAIL, p.sz]} />
            <meshStandardMaterial color={RAIL_COLOR} roughness={0.6} />
          </mesh>
          <mesh position={[0, GLASS_HEIGHT, 0]} castShadow>
            <boxGeometry args={[p.sx, RAIL, p.sz]} />
            <meshStandardMaterial color={RAIL_COLOR} emissive={RAIL_COLOR} emissiveIntensity={0.35} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Positions along a wall (world x or z) occupied by wall-mounted furniture, as [from, to]. */
function mountedSpans(wall: WallData, horizontal: boolean): [number, number][] {
  const line = horizontal ? wall.from[1] : wall.from[0]
  return layout.furniture
    .filter((f) => furnitureCatalog[f.type].wallMounted && Math.abs((horizontal ? f.position[1] : f.position[0]) - line) < 0.4)
    .map((f) => {
      const c = horizontal ? f.position[0] : f.position[1]
      const half = furnitureCatalog[f.type].footprint[0] / 2 + 0.2
      return [c - half, c + half]
    })
}

/** Window panes along an outer wall, on its inner face, skipping wall-mounted furniture. */
function Windows({ piece, horizontal, inward, blocked }: { piece: Piece; horizontal: boolean; inward: [number, number]; blocked: [number, number][] }) {
  const count = Math.max(0, Math.floor(piece.len / 2.4))
  const spacing = piece.len / count
  const offset = THICKNESS / 2 + 0.006
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const along = -piece.len / 2 + spacing * (i + 0.5)
        const at = (horizontal ? piece.x : piece.z) + along
        if (blocked.some(([a, b]) => at + 0.75 > a && at - 0.75 < b)) return null
        const x = piece.x + (horizontal ? along : inward[0] * offset)
        const z = piece.z + (horizontal ? inward[1] * offset : along)
        return (
          <group key={i} position={[x, 1.6, z]} rotation={[0, horizontal ? 0 : Math.PI / 2, 0]}>
            <mesh>
              <boxGeometry args={[1.5, 1.1, 0.01]} />
              <meshStandardMaterial color="#1b2550" />
            </mesh>
            {[-0.37, 0.37].map((dx) =>
              [-0.26, 0.26].map((dy) => (
                <mesh key={`${dx}${dy}`} position={[dx, dy, 0.008]}>
                  <boxGeometry args={[0.66, 0.46, 0.01]} />
                  <meshStandardMaterial color={WINDOW} emissive={WINDOW} emissiveIntensity={0.55} />
                </mesh>
              )),
            )}
          </group>
        )
      })}
    </>
  )
}

/** Outer wall that drops to a low cut while it sits between the camera and the office. */
function OuterWall({ wall }: { wall: WallData }) {
  const { pieces, horizontal } = wallPieces(wall)
  const normal = outwardNormal(wall)
  const inward: [number, number] = [-normal[0], -normal[1]]
  const blocked = mountedSpans(wall, horizontal)

  const body = useRef<Group>(null)
  const trim = useRef<Group>(null)
  const windows = useRef<Group>(null)
  const height = useRef(OUTER_TALL)

  useFrame((state, dt) => {
    if (!body.current || !trim.current || !windows.current) return
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
    body.current.scale.y = height.current / OUTER_TALL
    trim.current.position.y = height.current + 0.02
    windows.current.visible = height.current > WINDOW_MIN_HEIGHT
  })

  return (
    <group>
      <group ref={body}>
        {pieces.map((p) => (
          <mesh key={p.key} position={[p.x, OUTER_TALL / 2, p.z]} castShadow receiveShadow>
            <boxGeometry args={[p.sx, OUTER_TALL, p.sz]} />
            <meshStandardMaterial color={OUTER_BODY} roughness={0.9} />
          </mesh>
        ))}
      </group>
      <group ref={windows}>
        {pieces.map((p) => (
          <Windows key={p.key} piece={p} horizontal={horizontal} inward={inward} blocked={blocked} />
        ))}
      </group>
      <group ref={trim} position={[0, OUTER_TALL + 0.02, 0]}>
        {pieces.map((p) => (
          <mesh key={p.key} position={[p.x, 0, p.z]}>
            <boxGeometry args={[p.sx + 0.02, 0.06, p.sz + 0.02]} />
            <meshStandardMaterial color={OUTER_TRIM} roughness={0.8} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

export function Wall({ wall }: { wall: WallData }) {
  return wall.kind === 'outer' ? <OuterWall wall={wall} /> : <GlassWall wall={wall} />
}
