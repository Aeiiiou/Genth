/**
 * Procedural low-poly furniture. Every piece is centred on its footprint at floor level
 * (y = 0) with its front facing +z. Swappable for GLB models in a later phase.
 */
import { hash } from '../layout'
import { Blob, Box, Cyl } from './primitives'

export interface PieceProps {
  /** Seed for per-instance variation (colours, book heights). */
  seed: string
}

const WOOD = '#b08a5a'
const WOOD_DARK = '#6e5440'
const METAL = '#4a505a'

export function Desk() {
  const legs: [number, number][] = [
    [-0.74, -0.34],
    [0.74, -0.34],
    [-0.74, 0.34],
    [0.74, 0.34],
  ]
  return (
    <group>
      <Box size={[1.6, 0.05, 0.8]} position={[0, 0.74, 0]} color={WOOD} />
      {legs.map(([x, z]) => (
        <Box key={`${x}${z}`} size={[0.05, 0.72, 0.05]} position={[x, 0.36, z]} color={WOOD_DARK} />
      ))}
    </group>
  )
}

export function Monitor({ screen, on }: { screen: string; on: boolean }) {
  return (
    <group>
      <Box size={[0.26, 0.02, 0.18]} position={[0, 0.775, 0]} color={METAL} />
      <Cyl radius={0.025} height={0.2} position={[0, 0.88, 0]} color={METAL} />
      <Box size={[0.74, 0.44, 0.04]} position={[0, 1.12, 0]} color="#22262d" />
      <Box
        size={[0.68, 0.38, 0.005]}
        position={[0, 1.12, 0.022]}
        color={on ? screen : '#111418'}
        emissive={on ? screen : undefined}
        emissiveIntensity={0.9}
        shadow={false}
      />
    </group>
  )
}

export function Chair() {
  return (
    <group>
      <Cyl radius={0.25} height={0.04} position={[0, 0.03, 0]} color={METAL} />
      <Cyl radius={0.03} height={0.38} position={[0, 0.23, 0]} color={METAL} />
      <Box size={[0.48, 0.07, 0.48]} position={[0, 0.46, 0]} color="#3d4451" />
      <Box size={[0.48, 0.5, 0.06]} position={[0, 0.78, -0.22]} color="#3d4451" />
    </group>
  )
}

const BOOK_COLORS = ['#c0504d', '#4f81bd', '#9bbb59', '#8064a2', '#f79646', '#2c4d75', '#d9b44a', '#7f6a5a']

export function Bookshelf({ seed }: PieceProps) {
  const shelves = [0.05, 0.5, 0.95, 1.4, 1.85]
  const books: { x: number; y: number; w: number; h: number; c: string }[] = []
  for (let s = 0; s < 4; s++) {
    let x = -0.53
    let i = 0
    while (x < 0.5) {
      const r = hash(seed, s * 100 + i)
      const w = 0.06 + r * 0.05
      if (x + w > 0.55) break
      if (r > 0.12) {
        const h = 0.26 + hash(seed, s * 100 + i + 50) * 0.12
        books.push({ x: x + w / 2, y: shelves[s] + 0.02 + h / 2, w: w - 0.008, h, c: BOOK_COLORS[Math.floor(r * 97) % BOOK_COLORS.length] })
      }
      x += w
      i++
    }
  }
  return (
    <group>
      <Box size={[0.05, 1.9, 0.4]} position={[-0.575, 0.95, 0]} color={WOOD_DARK} />
      <Box size={[0.05, 1.9, 0.4]} position={[0.575, 0.95, 0]} color={WOOD_DARK} />
      <Box size={[1.2, 1.9, 0.03]} position={[0, 0.95, -0.185]} color={WOOD_DARK} />
      {shelves.map((y) => (
        <Box key={y} size={[1.15, 0.04, 0.38]} position={[0, y, 0]} color={WOOD} />
      ))}
      {books.map((b, i) => (
        <Box key={i} size={[b.w, b.h, 0.27]} position={[b.x, b.y, 0.02]} color={b.c} shadow={false} />
      ))}
    </group>
  )
}

function Couch({ width, color }: { width: number; color: string }) {
  const armX = width / 2 - 0.11
  return (
    <group>
      <Box size={[width, 0.42, 0.85]} position={[0, 0.21, 0]} color={color} />
      <Box size={[width - 0.44, 0.12, 0.62]} position={[0, 0.48, 0.08]} color={color} />
      <Box size={[width, 0.55, 0.22]} position={[0, 0.62, -0.32]} color={color} />
      <Box size={[0.22, 0.62, 0.85]} position={[-armX, 0.31, 0]} color={color} />
      <Box size={[0.22, 0.62, 0.85]} position={[armX, 0.31, 0]} color={color} />
    </group>
  )
}

export const Sofa = () => <Couch width={2} color="#3f7f8c" />
export const Armchair = () => <Couch width={1} color="#a8574a" />

export function CoffeeCounter() {
  return (
    <group>
      <Box size={[2.4, 0.95, 0.7]} position={[0, 0.475, 0]} color="#6b4f3a" />
      <Box size={[2.5, 0.06, 0.78]} position={[0, 0.98, 0]} color="#ece6da" />
      <Box size={[0.5, 0.42, 0.36]} position={[-0.6, 1.22, -0.1]} color="#b9bec4" />
      <Box size={[0.08, 0.05, 0.02]} position={[-0.6, 1.3, 0.085]} color="#7cff9a" emissive="#7cff9a" shadow={false} />
      <Cyl radius={0.05} height={0.1} position={[0.1, 1.06, 0.15]} color="#ffffff" />
      <Cyl radius={0.05} height={0.1} position={[0.25, 1.06, 0.12]} color="#ffffff" />
      <Box size={[0.6, 0.3, 0.4]} position={[0.75, 1.16, -0.05]} color="#cfe8ff" transparent opacity={0.35} />
      <Box size={[0.5, 0.06, 0.3]} position={[0.75, 1.05, -0.05]} color="#d9a066" />
    </group>
  )
}

export function CafeTable() {
  return (
    <group>
      <Cyl radius={0.25} height={0.03} position={[0, 0.015, 0]} color={METAL} />
      <Cyl radius={0.035} height={0.72} position={[0, 0.37, 0]} color={METAL} />
      <Cyl radius={0.42} height={0.04} position={[0, 0.74, 0]} color="#f2efe9" />
    </group>
  )
}

export function Stool() {
  return (
    <group>
      <Cyl radius={0.17} height={0.03} position={[0, 0.015, 0]} color={METAL} />
      <Cyl radius={0.03} height={0.6} position={[0, 0.3, 0]} color={METAL} />
      <Cyl radius={0.2} height={0.06} position={[0, 0.62, 0]} color="#c96b4a" />
    </group>
  )
}

export function MeetingTable() {
  return (
    <group>
      <Box size={[3, 0.06, 1.4]} position={[0, 0.74, 0]} color="#7a5a40" />
      <Box size={[0.3, 0.71, 0.8]} position={[-0.9, 0.355, 0]} color={WOOD_DARK} />
      <Box size={[0.3, 0.71, 0.8]} position={[0.9, 0.355, 0]} color={WOOD_DARK} />
    </group>
  )
}

export function FilingCabinet() {
  return (
    <group>
      <Box size={[0.5, 1.3, 0.6]} position={[0, 0.65, 0]} color="#8b98a5" />
      {[0.25, 0.65, 1.05].map((y) => (
        <group key={y}>
          <Box size={[0.44, 0.36, 0.01]} position={[0, y, 0.302]} color="#9eabb8" shadow={false} />
          <Box size={[0.14, 0.03, 0.03]} position={[0, y + 0.1, 0.315]} color={METAL} shadow={false} />
        </group>
      ))}
    </group>
  )
}

const BAR_COLORS = ['#5bd67a', '#f2b84b', '#5aa9ff', '#5bd67a', '#e86a5a']

/** Wall-mounted display; place it against a tall (back) wall. */
export function StatusBoard({ seed }: PieceProps) {
  return (
    <group>
      <Box size={[2.2, 1.2, 0.06]} position={[0, 1.75, 0]} color="#2b3340" />
      <Box size={[2.0, 1.0, 0.01]} position={[0, 1.75, 0.032]} color="#16283d" emissive="#16283d" emissiveIntensity={0.6} shadow={false} />
      {[0, 1, 2, 3, 4].map((i) => {
        const w = 0.4 + hash(seed, i) * 1.3
        return (
          <Box
            key={i}
            size={[w, 0.1, 0.012]}
            position={[-0.9 + w / 2, 2.1 - i * 0.17, 0.04]}
            color={BAR_COLORS[i]}
            emissive={BAR_COLORS[i]}
            emissiveIntensity={0.8}
            shadow={false}
          />
        )
      })}
    </group>
  )
}

export function Whiteboard({ seed }: PieceProps) {
  return (
    <group>
      <Box size={[0.05, 1.9, 0.05]} position={[-0.82, 0.95, 0]} color={METAL} />
      <Box size={[0.05, 1.9, 0.05]} position={[0.82, 0.95, 0]} color={METAL} />
      <Box size={[0.06, 0.05, 0.6]} position={[-0.82, 0.025, 0]} color={METAL} />
      <Box size={[0.06, 0.05, 0.6]} position={[0.82, 0.025, 0]} color={METAL} />
      <Box size={[1.6, 1, 0.05]} position={[0, 1.35, 0]} color="#f7f7f4" />
      {[0, 1, 2].map((i) => {
        const w = 0.4 + hash(seed, i) * 0.8
        return (
          <Box key={i} size={[w, 0.04, 0.01]} position={[-0.65 + w / 2, 1.65 - i * 0.22, 0.03]} color={['#2f6fd6', '#d64a3a', '#2a2a2a'][i]} shadow={false} />
        )
      })}
    </group>
  )
}

export function Plant() {
  return (
    <group>
      <Cyl radius={0.2} radiusBottom={0.15} height={0.35} position={[0, 0.175, 0]} color="#b5694a" />
      <Cyl radius={0.18} height={0.02} position={[0, 0.35, 0]} color="#4a3628" />
      <Blob radius={0.3} position={[0, 0.68, 0]} color="#4f8f4a" />
      <Blob radius={0.24} position={[0.13, 0.92, 0.05]} color="#5fa055" />
      <Blob radius={0.2} position={[-0.11, 0.86, -0.08]} color="#467f42" />
    </group>
  )
}

const RUG_COLORS = ['#9b5d5d', '#5d7b9b', '#8a7a5a', '#6b8e6b', '#7d6b91']

export function Rug({ seed }: PieceProps) {
  const color = RUG_COLORS[Math.floor(hash(seed) * RUG_COLORS.length)]
  return (
    <group>
      <Box size={[2.4, 0.02, 1.6]} position={[0, 0.01, 0]} color={color} shadow={false} />
      <Box size={[2.0, 0.022, 1.2]} position={[0, 0.011, 0]} color="#efe6d4" shadow={false} transparent opacity={0.25} />
    </group>
  )
}

export function FloorLamp() {
  return (
    <group>
      <Cyl radius={0.18} height={0.04} position={[0, 0.02, 0]} color={METAL} />
      <Cyl radius={0.025} height={1.5} position={[0, 0.77, 0]} color={METAL} />
      <Cyl radius={0.17} radiusBottom={0.26} height={0.3} position={[0, 1.62, 0]} color="#f3e3b5" emissive="#ffd27a" emissiveIntensity={0.7} />
      <pointLight position={[0, 1.5, 0]} color="#ffcf87" intensity={6} distance={6} decay={2} />
    </group>
  )
}

export function ServerRack() {
  return (
    <group>
      <Box size={[0.6, 1.9, 0.8]} position={[0, 0.95, 0]} color="#2a2f38" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <group key={i}>
          <Box size={[0.5, 0.18, 0.01]} position={[0, 0.35 + i * 0.26, 0.402]} color="#3a414d" shadow={false} />
          <Box
            size={[0.04, 0.03, 0.01]}
            position={[0.18, 0.35 + i * 0.26, 0.41]}
            color={i % 3 === 0 ? '#5aa9ff' : '#5bd67a'}
            emissive={i % 3 === 0 ? '#5aa9ff' : '#5bd67a'}
            emissiveIntensity={1.5}
            shadow={false}
          />
        </group>
      ))}
    </group>
  )
}

export function CoffeeTable() {
  const legs: [number, number][] = [
    [-0.5, -0.25],
    [0.5, -0.25],
    [-0.5, 0.25],
    [0.5, 0.25],
  ]
  return (
    <group>
      <Box size={[1.1, 0.06, 0.6]} position={[0, 0.4, 0]} color="#8b6a4e" />
      {legs.map(([x, z]) => (
        <Box key={`${x}${z}`} size={[0.05, 0.37, 0.05]} position={[x, 0.185, z]} color={WOOD_DARK} />
      ))}
    </group>
  )
}

export function Arcade() {
  return (
    <group>
      <Box size={[0.7, 1.7, 0.7]} position={[0, 0.85, 0]} color="#5a3e8c" />
      <Box size={[0.55, 0.42, 0.02]} position={[0, 1.3, 0.355]} color="#ff5fa2" emissive="#ff5fa2" emissiveIntensity={0.9} shadow={false} />
      <Box size={[0.7, 0.08, 0.3]} position={[0, 0.98, 0.45]} color="#3b2860" />
      <Cyl radius={0.04} height={0.04} position={[-0.12, 1.04, 0.45]} color="#ffd34d" />
      <Cyl radius={0.04} height={0.04} position={[0.12, 1.04, 0.45]} color="#4dd2ff" />
    </group>
  )
}
