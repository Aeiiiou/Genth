import { create } from 'zustand'
import { agentById, layout, seatOf } from '../office/layout'
import type { SpotName, Vec2 } from '../office/layout/types'
import { buildNavGrid, findPath } from '../office/navigation/navGrid'

const navGrid = buildNavGrid(layout)

/**
 * Where each agent is right now, written every frame by its figure. Kept outside React state so
 * walking doesn't re-render anything; read when planning the next path.
 */
export const livePositions = new Map<string, Vec2>()

export interface Motion {
  /** Waypoints still to walk, in tile coordinates. Changing `nonce` restarts the walk. */
  path: Vec2[]
  nonce: number
  spot: SpotName
  slot: number
  /** Sit down at the end (the agent's own desk). */
  seated: boolean
}

interface MotionState {
  motions: Record<string, Motion>
  moveTo: (agentId: string, spot: SpotName) => void
}

function seat(agentId: string): Vec2 {
  const agent = agentById.get(agentId)
  return (agent && seatOf(agent.workstationId)) ?? [layout.size.width / 2, layout.size.depth / 2]
}

const initial: Record<string, Motion> = Object.fromEntries(
  layout.agents.map((a) => [a.id, { path: [], nonce: 0, spot: 'desk', slot: 0, seated: true }]),
)

export const useAgentMotion = create<MotionState>()((set, get) => ({
  motions: initial,
  moveTo: (agentId, spot) => {
    const motions = get().motions
    const current = motions[agentId]
    if (!current || (current.spot === spot && spot === 'desk')) return

    let target: Vec2
    let slot = 0
    if (spot === 'desk') {
      target = seat(agentId)
    } else {
      // Take the first standing position at this spot that no other agent holds.
      const taken = new Set(
        Object.entries(motions)
          .filter(([id, m]) => id !== agentId && m.spot === spot)
          .map(([, m]) => m.slot),
      )
      const slots = layout.spots[spot]
      slot = slots.findIndex((_, i) => !taken.has(i))
      if (slot < 0) slot = 0
      target = slots[slot]
    }

    const from = livePositions.get(agentId) ?? seat(agentId)
    const path = findPath(navGrid, from, target) ?? [target]
    set({
      motions: {
        ...motions,
        [agentId]: { path, nonce: current.nonce + 1, spot, slot, seated: spot === 'desk' },
      },
    })
  },
}))
