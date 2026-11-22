import { agentById, deg, SEAT_OFFSET } from '../layout'
import type { Workstation as WorkstationData } from '../layout/types'
import { Selectable } from '../Selectable'
import { Chair, Desk, Monitor } from './pieces'

export function Workstation({ ws }: { ws: WorkstationData }) {
  const agent = ws.assignedAgentId ? agentById.get(ws.assignedAgentId) : undefined
  return (
    <Selectable
      kind="workstation"
      id={ws.id}
      footprint={[1.7, 1.9]}
      footprintOffset={[0, 0.4]}
      position={[ws.position[0], 0, ws.position[1]]}
      rotationY={deg(ws.rotation)}
    >
      <Desk />
      <group position={[0, 0, -0.15]}>
        <Monitor screen={agent?.color ?? '#000000'} on={!!agent} />
      </group>
      <mesh position={[0, 0.775, 0.17]} castShadow>
        <boxGeometry args={[0.45, 0.02, 0.15]} />
        <meshStandardMaterial color="#d8dbe0" />
      </mesh>
      <group position={[SEAT_OFFSET[0], 0, SEAT_OFFSET[1]]} rotation={[0, Math.PI, 0]}>
        <Chair />
      </group>
    </Selectable>
  )
}
