export type V3 = [number, number, number]

interface MaterialProps {
  color: string
  emissive?: string
  emissiveIntensity?: number
  transparent?: boolean
  opacity?: number
}

function Material({ color, emissive, emissiveIntensity = 1, transparent, opacity }: MaterialProps) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={0.85}
      metalness={0}
      emissive={emissive ?? '#000000'}
      emissiveIntensity={emissive ? emissiveIntensity : 0}
      transparent={transparent}
      opacity={opacity}
    />
  )
}

interface BoxProps extends MaterialProps {
  size: V3
  position?: V3
  rotation?: V3
  shadow?: boolean
}

/** Axis-aligned box positioned by its centre. */
export function Box({ size, position, rotation, shadow = true, ...mat }: BoxProps) {
  return (
    <mesh position={position} rotation={rotation} castShadow={shadow} receiveShadow>
      <boxGeometry args={size} />
      <Material {...mat} />
    </mesh>
  )
}

interface CylProps extends MaterialProps {
  radius: number
  radiusBottom?: number
  height: number
  position?: V3
  segments?: number
}

/** Upright cylinder positioned by its centre. */
export function Cyl({ radius, radiusBottom, height, position, segments = 20, ...mat }: CylProps) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radiusBottom ?? radius, height, segments]} />
      <Material {...mat} />
    </mesh>
  )
}

interface BlobProps {
  radius: number
  position: V3
  color: string
}

/** Low-poly foliage blob. */
export function Blob({ radius, position, color }: BlobProps) {
  return (
    <mesh position={position} castShadow>
      <icosahedronGeometry args={[radius, 0]} />
      <meshStandardMaterial color={color} roughness={0.9} flatShading />
    </mesh>
  )
}
