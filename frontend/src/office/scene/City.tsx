/**
 * Night-time city around the office: ground, a ring road with moving cars, sidewalks, trees,
 * street lamps and a street of shops (see Street.tsx). Purely decorative: nothing here is
 * clickable or casts shadows, to keep it cheap.
 */
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'
import { hash, layout } from '../layout'
import { Street } from './Street'

const { width: W, depth: D } = layout.size
const SIDEWALK = 2.2
const ROAD = 4.4
/** Inner edge of the road ring, around the building plus sidewalk. */
const R0 = { x0: -SIDEWALK, z0: -SIDEWALK, x1: W + SIDEWALK, z1: D + SIDEWALK }
const R1 = { x0: R0.x0 - ROAD, z0: R0.z0 - ROAD, x1: R0.x1 + ROAD, z1: R0.z1 + ROAD }
const GROUND_Y = -0.12

const CAR_COLORS = ['#e05a4f', '#f2c14b', '#4f9de0', '#e8e8e8', '#5bd67a', '#b06be0', '#ff8a3d', '#2b2f3a']

/** Point and heading at distance `s` along a rectangular loop (clockwise when `reverse` is false). */
function onLoop(s: number, r: { x0: number; z0: number; x1: number; z1: number }, reverse: boolean) {
  const w = r.x1 - r.x0
  const d = r.z1 - r.z0
  const per = 2 * (w + d)
  let t = ((s % per) + per) % per
  if (reverse) t = per - t
  let x: number, z: number, heading: number
  if (t < w) [x, z, heading] = [r.x0 + t, r.z0, Math.PI / 2]
  else if (t < w + d) [x, z, heading] = [r.x1, r.z0 + (t - w), 0]
  else if (t < 2 * w + d) [x, z, heading] = [r.x1 - (t - w - d), r.z1, -Math.PI / 2]
  else [x, z, heading] = [r.x0, r.z1 - (t - 2 * w - d), Math.PI]
  return { x, z, heading: reverse ? heading + Math.PI : heading }
}

function Car({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.32, 0]}>
        <boxGeometry args={[0.9, 0.34, 1.9]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.62, -0.1]}>
        <boxGeometry args={[0.78, 0.3, 1.0]} />
        <meshStandardMaterial color="#9fc6ff" emissive="#3b5a8a" emissiveIntensity={0.4} roughness={0.2} />
      </mesh>
      {[-0.3, 0.3].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.32, 0.96]}>
            <boxGeometry args={[0.2, 0.1, 0.02]} />
            <meshStandardMaterial color="#fff6d8" emissive="#fff3c4" emissiveIntensity={2} />
          </mesh>
          <mesh position={[x, 0.32, -0.96]}>
            <boxGeometry args={[0.2, 0.08, 0.02]} />
            <meshStandardMaterial color="#ff4040" emissive="#ff2020" emissiveIntensity={1.6} />
          </mesh>
        </group>
      ))}
      {[-0.42, 0.42].flatMap((x) =>
        [-0.6, 0.6].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.14, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.14, 0.14, 0.1, 10]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        )),
      )}
    </group>
  )
}

const CARS = CAR_COLORS.map((color, i) => ({
  color,
  reverse: i % 2 === 1,
  speed: 3 + hash('cs', i) * 2.5,
  offset: hash('co', i) * 200,
}))

function Traffic() {
  const refs = useRef<(Group | null)[]>([])
  const time = useRef(0)
  // Lanes: clockwise on the outer half of the road, counter-clockwise on the inner half.
  const outer = { x0: R1.x0 + 1.1, z0: R1.z0 + 1.1, x1: R1.x1 - 1.1, z1: R1.z1 - 1.1 }
  const inner = { x0: R0.x0 - 1.1, z0: R0.z0 - 1.1, x1: R0.x1 + 1.1, z1: R0.z1 + 1.1 }

  useFrame((_, dt) => {
    time.current += Math.min(dt, 0.1)
    CARS.forEach((car, i) => {
      const g = refs.current[i]
      if (!g) return
      const p = onLoop(car.offset + time.current * car.speed, car.reverse ? inner : outer, car.reverse)
      g.position.set(p.x, GROUND_Y + 0.02, p.z)
      g.rotation.y = p.heading
    })
  })

  return (
    <group>
      {CARS.map((car, i) => (
        <group key={i} ref={(g) => void (refs.current[i] = g)}>
          <Car color={car.color} />
        </group>
      ))}
    </group>
  )
}

function Road() {
  const w = R1.x1 - R1.x0
  const d = R1.z1 - R1.z0
  const mid = { x0: (R0.x0 + R1.x0) / 2, z0: (R0.z0 + R1.z0) / 2, x1: (R0.x1 + R1.x1) / 2, z1: (R0.z1 + R1.z1) / 2 }
  const dashes: [number, number, boolean][] = []
  for (let x = mid.x0 + 1; x < mid.x1; x += 2.4) dashes.push([x, mid.z0, true], [x, mid.z1, true])
  for (let z = mid.z0 + 1; z < mid.z1; z += 2.4) dashes.push([mid.x0, z, false], [mid.x1, z, false])
  return (
    <group>
      {/* Asphalt ring = big dark slab with the sidewalk/building block on top. */}
      <mesh position={[(R1.x0 + R1.x1) / 2, GROUND_Y - 0.01, (R1.z0 + R1.z1) / 2]} receiveShadow>
        <boxGeometry args={[w, 0.02, d]} />
        <meshStandardMaterial color="#20243a" roughness={1} />
      </mesh>
      <mesh position={[W / 2, GROUND_Y + 0.02, D / 2]} receiveShadow>
        <boxGeometry args={[R0.x1 - R0.x0, 0.06, R0.z1 - R0.z0]} />
        <meshStandardMaterial color="#3a4064" roughness={1} />
      </mesh>
      {dashes.map(([x, z, horizontal], i) => (
        <mesh key={i} position={[x, GROUND_Y + 0.005, z]}>
          <boxGeometry args={horizontal ? [1.1, 0.01, 0.12] : [0.12, 0.01, 1.1]} />
          <meshStandardMaterial color="#e8d27a" emissive="#5a4a1a" emissiveIntensity={0.4} />
        </mesh>
      ))}
    </group>
  )
}

function Trees() {
  const spots: [number, number][] = []
  for (let x = R0.x0 + 1; x < R0.x1; x += 4.5) spots.push([x, R0.z0 + 0.8], [x, R0.z1 - 0.8])
  for (let z = R0.z0 + 4; z < R0.z1 - 2; z += 4.5) spots.push([R0.x0 + 0.8, z], [R0.x1 - 0.8, z])
  return (
    <group>
      {spots.map(([x, z], i) =>
        i % 3 === 2 ? (
          <group key={i} position={[x, GROUND_Y + 0.05, z]}>
            <mesh position={[0, 1.4, 0]}>
              <cylinderGeometry args={[0.05, 0.06, 2.8, 6]} />
              <meshStandardMaterial color="#3a4064" />
            </mesh>
            <mesh position={[0, 2.85, 0]}>
              <sphereGeometry args={[0.18, 8, 6]} />
              <meshStandardMaterial color="#fff1c2" emissive="#ffd98a" emissiveIntensity={2} />
            </mesh>
          </group>
        ) : (
          <group key={i} position={[x, GROUND_Y + 0.05, z]}>
            <mesh position={[0, 0.5, 0]}>
              <cylinderGeometry args={[0.08, 0.1, 1, 6]} />
              <meshStandardMaterial color="#5a3e2b" />
            </mesh>
            <mesh position={[0, 1.4, 0]}>
              <icosahedronGeometry args={[0.7, 0]} />
              <meshStandardMaterial color="#2f7d4a" flatShading />
            </mesh>
          </group>
        ),
      )}
    </group>
  )
}

export function City() {
  return (
    <group raycast={() => null}>
      <mesh position={[W / 2, GROUND_Y - 0.05, D / 2]} receiveShadow>
        <boxGeometry args={[220, 0.05, 220]} />
        <meshStandardMaterial color="#141c34" roughness={1} />
      </mesh>
      <Road />
      <Trees />
      <Street road={R1} groundY={GROUND_Y} />
      <Traffic />
    </group>
  )
}
