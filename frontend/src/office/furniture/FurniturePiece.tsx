import { useFrame } from '@react-three/fiber'
import { type ReactNode, useRef } from 'react'
import { type Group, Vector3 } from 'three'
import { deg } from '../layout'
import type { FurnitureItem } from '../layout/types'
import { Selectable } from '../Selectable'
import { furnitureCatalog } from './catalog'

const front = new Vector3()
const camDir = new Vector3()

/** Shows its children only while the camera is in front of them (their local +z side). */
function WallMounted({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null)
  useFrame((state) => {
    const g = ref.current
    if (!g) return
    g.getWorldDirection(front)
    state.camera.getWorldDirection(camDir)
    g.visible = front.dot(camDir) < -0.05
  })
  return <group ref={ref}>{children}</group>
}

export function FurniturePiece({ item }: { item: FurnitureItem }) {
  const entry = furnitureCatalog[item.type]
  const Piece = entry.component
  const piece = <Piece seed={item.id} />
  return (
    <Selectable
      kind="furniture"
      id={item.id}
      footprint={entry.footprint}
      position={[item.position[0], 0, item.position[1]]}
      rotationY={deg(item.rotation)}
    >
      {entry.wallMounted ? <WallMounted>{piece}</WallMounted> : piece}
    </Selectable>
  )
}
