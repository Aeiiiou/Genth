/**
 * The street around the office: a row of low, colourful shops on every side of the ring road,
 * facing the traffic, with lit shop windows, striped awnings, glowing signs and cluttered rooftops,
 * plus an outer sidewalk with street lamps. Kept lower than the office so it never blocks the view.
 */
import { useEffect, useMemo } from 'react'
import { CanvasTexture, SRGBColorSpace } from 'three'
import { hash } from '../layout'

export interface Ring {
  x0: number
  z0: number
  x1: number
  z1: number
}

const SHOP_NAMES = [
  'CAFE', 'PIZZA', 'BOOKS', 'GYM', 'RAMEN', 'BAKERY', 'ARCADE', 'FLOWERS', 'MART', 'TEA', 'BURGER',
  'PHARMACY', 'LAUNDRY', 'SALON', 'BBQ', 'DONUTS', 'MUSIC', 'TACOS', 'SUSHI', 'HARDWARE', 'GAMES', 'JUICE',
]
const WALLS = ['#e8a87c', '#7fb2c9', '#c38dd1', '#e6c36a', '#8fc98f', '#e07a7a', '#7a8fe0', '#d9a3b8', '#9fd1c4', '#f0b3a0']
const AWNINGS: [string, string][] = [
  ['#e05a4f', '#fff3e6'],
  ['#2f8a84', '#e8fff8'],
  ['#4f86e0', '#eef4ff'],
  ['#e0a84f', '#fff8e6'],
  ['#8a5aa6', '#f6eeff'],
  ['#3f9a45', '#effff0'],
]
const NEON = ['#ff5fa2', '#5ff2ff', '#ffd34d', '#7cff9a', '#ff8a3d', '#c48bff']

const STOREY = 2.4
const OUTER_SIDEWALK = 2.4
const GAP = 0.6

/** Neon sign texture with the shop's name. */
function useSignTexture(text: string, color: string) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 64
    const g = c.getContext('2d')!
    g.fillStyle = '#141a33'
    g.fillRect(0, 0, 256, 64)
    g.strokeStyle = color
    g.lineWidth = 4
    g.strokeRect(4, 4, 248, 56)
    g.font = 'bold 34px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.shadowColor = color
    g.shadowBlur = 10
    g.fillStyle = color
    g.fillText(text, 128, 34)
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    return t
  }, [text, color])
  useEffect(() => () => tex.dispose(), [tex])
  return tex
}

interface ShopSpec {
  /** Centre of the front face, on the sidewalk line. */
  x: number
  z: number
  /** Rotation so the shop's front (+z) faces the road. */
  rotY: number
  w: number
  d: number
  floors: number
  i: number
}

function Shop({ spec }: { spec: ShopSpec }) {
  const { w, d, floors, i } = spec
  const h = floors * STOREY + 0.3
  const wall = WALLS[Math.floor(hash('wall', i) * WALLS.length)]
  const [awnA, awnB] = AWNINGS[Math.floor(hash('awn', i) * AWNINGS.length)]
  const neon = NEON[Math.floor(hash('neon', i) * NEON.length)]
  const name = SHOP_NAMES[i % SHOP_NAMES.length]
  const sign = useSignTexture(name, neon)
  const stripes = Math.max(4, Math.round(w / 0.5))
  const windowCols = Math.max(1, Math.floor(w / 1.6))
  const front = d / 2

  return (
    // Origin at the centre of the footprint; the front face is at +z = d/2.
    <group position={[spec.x, 0, spec.z]} rotation={[0, spec.rotY, 0]}>
      <group position={[0, 0, -front]}>
        {/* Body and a darker base course. */}
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color={wall} roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.25, front + 0.01]}>
          <boxGeometry args={[w, 0.5, 0.04]} />
          <meshStandardMaterial color="#3a3550" />
        </mesh>

        {/* Shop window and door, lit warm from inside. */}
        <mesh position={[-w * 0.12, 1.15, front + 0.02]}>
          <boxGeometry args={[w * 0.58, 1.3, 0.04]} />
          <meshStandardMaterial color="#ffe2a8" emissive="#ffcc7a" emissiveIntensity={0.9} />
        </mesh>
        <mesh position={[-w * 0.12, 1.15, front + 0.045]}>
          <boxGeometry args={[0.05, 1.3, 0.02]} />
          <meshStandardMaterial color="#2a2540" />
        </mesh>
        <mesh position={[w * 0.33, 1.0, front + 0.02]}>
          <boxGeometry args={[0.8, 1.6, 0.04]} />
          <meshStandardMaterial color="#5a3e2b" />
        </mesh>
        <mesh position={[w * 0.33, 1.05, front + 0.045]}>
          <boxGeometry args={[0.5, 0.7, 0.02]} />
          <meshStandardMaterial color="#ffe2a8" emissive="#ffcc7a" emissiveIntensity={0.6} />
        </mesh>

        {/* Striped awning, tilted out over the sidewalk. */}
        <group position={[-w * 0.05, 2.05, front + 0.45]} rotation={[0.35, 0, 0]}>
          {Array.from({ length: stripes }, (_, s) => (
            <mesh key={s} position={[-w * 0.45 + (s + 0.5) * ((w * 0.9) / stripes), 0, 0]}>
              <boxGeometry args={[(w * 0.9) / stripes, 0.04, 0.95]} />
              <meshStandardMaterial color={s % 2 ? awnB : awnA} roughness={0.8} />
            </mesh>
          ))}
        </group>

        {/* Glowing sign above the awning. */}
        <mesh position={[0, 2.62, front + 0.06]}>
          <planeGeometry args={[Math.min(w * 0.8, 3.4), 0.7]} />
          <meshStandardMaterial map={sign} emissiveMap={sign} emissive="#ffffff" emissiveIntensity={1.1} />
        </mesh>

        {/* Upper-floor windows. */}
        {Array.from({ length: floors - 1 }, (_, f) =>
          Array.from({ length: windowCols }, (_, k) => {
            const lit = hash('lit', i * 31 + f * 7 + k) > 0.35
            const x = -w / 2 + (k + 0.5) * (w / windowCols)
            return (
              <mesh key={`${f}-${k}`} position={[x, STOREY * (f + 1) + 1.15, front + 0.02]}>
                <boxGeometry args={[0.8, 0.9, 0.04]} />
                <meshStandardMaterial
                  color={lit ? '#ffe9b8' : '#2b3157'}
                  emissive={lit ? '#ffd88a' : '#000000'}
                  emissiveIntensity={lit ? 0.7 : 0}
                />
              </mesh>
            )
          }),
        )}

        {/* Back of the shop (seen from the office side when rotated): windows on every floor and a back door. */}
        {Array.from({ length: floors }, (_, f) =>
          Array.from({ length: windowCols }, (_, k) => {
            if (f === 0 && k === 0) return null // the back door goes here
            const lit = hash('back', i * 37 + f * 11 + k) > 0.45
            const x = -w / 2 + (k + 0.5) * (w / windowCols)
            return (
              <mesh key={`b${f}-${k}`} position={[x, STOREY * f + 1.25, -front - 0.02]}>
                <boxGeometry args={[0.7, 0.8, 0.04]} />
                <meshStandardMaterial
                  color={lit ? '#ffe9b8' : '#2b3157'}
                  emissive={lit ? '#ffd88a' : '#000000'}
                  emissiveIntensity={lit ? 0.6 : 0}
                />
              </mesh>
            )
          }),
        )}
        <mesh position={[-w / 2 + w / windowCols / 2, 0.85, -front - 0.02]}>
          <boxGeometry args={[0.7, 1.5, 0.04]} />
          <meshStandardMaterial color="#4a4466" />
        </mesh>
        <mesh position={[-w / 2 + w / windowCols / 2, 1.75, -front - 0.04]}>
          <boxGeometry args={[0.12, 0.12, 0.04]} />
          <meshStandardMaterial color="#fff1c2" emissive="#ffd98a" emissiveIntensity={1.5} />
        </mesh>

        {/* Roof: parapet plus AC units, a water tank or a little garden. */}
        <mesh position={[0, h + 0.12, 0]}>
          <boxGeometry args={[w + 0.12, 0.24, d + 0.12]} />
          <meshStandardMaterial color="#4a4466" />
        </mesh>
        {hash('ac', i) > 0.3 && (
          <mesh position={[w * 0.2, h + 0.45, -d * 0.15]}>
            <boxGeometry args={[0.8, 0.5, 0.6]} />
            <meshStandardMaterial color="#c8ccd8" />
          </mesh>
        )}
        {hash('tank', i) > 0.55 ? (
          <group position={[-w * 0.25, h + 0.25, -d * 0.2]}>
            <mesh position={[0, 0.65, 0]}>
              <cylinderGeometry args={[0.45, 0.45, 0.9, 12]} />
              <meshStandardMaterial color="#5a8ab0" />
            </mesh>
            {[-0.3, 0.3].map((x) => (
              <mesh key={x} position={[x, 0.1, 0]}>
                <boxGeometry args={[0.06, 0.4, 0.06]} />
                <meshStandardMaterial color="#3a3550" />
              </mesh>
            ))}
          </group>
        ) : (
          [-0.4, 0.4].map((x) => (
            <mesh key={x} position={[-w * 0.2 + x, h + 0.5, 0]}>
              <icosahedronGeometry args={[0.35, 0]} />
              <meshStandardMaterial color="#3f9a45" flatShading />
            </mesh>
          ))
        )}
      </group>
    </group>
  )
}

/** Shops packed along one straight side, facing the road. */
function sideShops(start: Vec, end: Vec, rotY: number, salt: number): ShopSpec[] {
  const len = Math.hypot(end[0] - start[0], end[1] - start[1])
  const dir: Vec = [(end[0] - start[0]) / len, (end[1] - start[1]) / len]
  const specs: ShopSpec[] = []
  let t = 0
  let i = salt
  while (t < len) {
    const w = 4 + hash('w', i) * 3
    if (t + w > len) break
    const c = t + w / 2
    specs.push({
      x: start[0] + dir[0] * c,
      z: start[1] + dir[1] * c,
      rotY,
      w,
      d: 4 + hash('d', i) * 2,
      floors: 1 + Math.floor(hash('f', i) * 3),
      i,
    })
    t += w + GAP + (hash('gap', i) > 0.8 ? 1.4 : 0)
    i++
  }
  return specs
}

type Vec = [number, number]

function Lamps({ ring }: { ring: Ring }) {
  const spots: Vec[] = []
  for (let x = ring.x0 + 2; x < ring.x1 - 1; x += 6) spots.push([x, ring.z0 - 0.4], [x, ring.z1 + 0.4])
  for (let z = ring.z0 + 4; z < ring.z1 - 2; z += 6) spots.push([ring.x0 - 0.4, z], [ring.x1 + 0.4, z])
  return (
    <group>
      {spots.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 1.4, 0]}>
            <cylinderGeometry args={[0.05, 0.06, 2.8, 6]} />
            <meshStandardMaterial color="#3a4064" />
          </mesh>
          <mesh position={[0, 2.85, 0]}>
            <sphereGeometry args={[0.18, 8, 6]} />
            <meshStandardMaterial color="#fff1c2" emissive="#ffd98a" emissiveIntensity={2} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Shops and the outer sidewalk around a ring road whose outer edge is `road`. */
export function Street({ road, groundY }: { road: Ring; groundY: number }) {
  const shops = useMemo(() => {
    // The shop fronts line up along the outer edge of the outer sidewalk.
    const s = { x0: road.x0 - OUTER_SIDEWALK, z0: road.z0 - OUTER_SIDEWALK, x1: road.x1 + OUTER_SIDEWALK, z1: road.z1 + OUTER_SIDEWALK }
    return [
      ...sideShops([s.x0 - 6, s.z0], [s.x1 + 6, s.z0], 0, 0), // north side, facing south
      ...sideShops([s.x1 + 6, s.z1], [s.x0 - 6, s.z1], Math.PI, 100), // south side, facing north
      ...sideShops([s.x0, s.z1 - 1], [s.x0, s.z0 + 1], Math.PI / 2, 200), // west side, facing east
      ...sideShops([s.x1, s.z0 + 1], [s.x1, s.z1 - 1], -Math.PI / 2, 300), // east side, facing west
    ]
  }, [road])

  const ow = road.x1 - road.x0 + OUTER_SIDEWALK * 2
  const od = road.z1 - road.z0 + OUTER_SIDEWALK * 2
  const cx = (road.x0 + road.x1) / 2
  const cz = (road.z0 + road.z1) / 2

  return (
    <group position={[0, groundY, 0]}>
      {/* Outer sidewalk: a light frame around the road. */}
      {[
        [cx, road.z0 - OUTER_SIDEWALK / 2, ow, OUTER_SIDEWALK],
        [cx, road.z1 + OUTER_SIDEWALK / 2, ow, OUTER_SIDEWALK],
        [road.x0 - OUTER_SIDEWALK / 2, cz, OUTER_SIDEWALK, od],
        [road.x1 + OUTER_SIDEWALK / 2, cz, OUTER_SIDEWALK, od],
      ].map(([x, z, w, d], k) => (
        <mesh key={k} position={[x, 0.03, z]} receiveShadow>
          <boxGeometry args={[w, 0.06, d]} />
          <meshStandardMaterial color="#3a4064" roughness={1} />
        </mesh>
      ))}
      <Lamps ring={road} />
      {shops.map((spec) => (
        <Shop key={spec.i} spec={spec} />
      ))}
    </group>
  )
}
