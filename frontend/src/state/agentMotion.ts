import { create } from 'zustand'
import { deskSpot, layout, spotPositions } from '../office/layout'
import type { SpotName, SpotPosition } from '../office/layout/types'
import { type Place, planRoute, routeSeconds, type Waypoint } from '../office/navigation/route'

/**
 * Where each agent is right now, written every frame by its figure. Kept outside React state so
 * walking doesn't re-render anything; read when planning the next route.
 */
export const livePlaces = new Map<string, Place>()

export interface Motion {
  /** Steps still to take. Changing `nonce` restarts the walk. */
  route: Waypoint[]
  nonce: number
  spot: SpotName
  slot: number
  /** Pose and heading on arrival. */
  seated: boolean
  facing: number | null
}

interface MotionState {
  motions: Record<string, Motion>
  /** Floor each agent is on (updated when it changes, not every frame). */
  floors: Record<string, number>
  /** Sends an agent to a spot. Returns the estimated travel time in seconds. */
  moveTo: (agentId: string, spot: SpotName) => number
  setFloor: (agentId: string, floor: number) => void
}

function fallbackDesk(agentId: string): SpotPosition {
  return deskSpot(agentId) ?? { floor: 0, at: [layout.size.width / 2, layout.size.depth / 2] }
}

const initialMotions: Record<string, Motion> = Object.fromEntries(
  layout.agents.map((a) => {
    const d = fallbackDesk(a.id)
    return [a.id, { route: [], nonce: 0, spot: 'desk', slot: 0, seated: true, facing: d.facing ?? null }]
  }),
)

export const useAgentMotion = create<MotionState>()((set, get) => ({
  motions: initialMotions,
  floors: Object.fromEntries(layout.agents.map((a) => [a.id, fallbackDesk(a.id).floor])),

  moveTo: (agentId, spot) => {
    const { motions } = get()
    const current = motions[agentId]
    if (!current) return 0

    const positions = spotPositions(spot, agentId)
    if (!positions.length) return 0
    // Take the first position at this spot no other agent holds (shared spots like the meeting room).
    const taken = new Set(
      Object.entries(motions)
        .filter(([id, m]) => id !== agentId && m.spot === spot)
        .map(([, m]) => m.slot),
    )
    let slot = positions.findIndex((_, i) => !taken.has(i))
    if (slot < 0) slot = 0
    if (current.spot === spot && current.slot === slot && current.route.length === 0) return 0
    const target = positions[slot]

    const from = livePlaces.get(agentId) ?? fallbackDesk(agentId)
    const route = planRoute(from, target) ?? [{ kind: 'walk' as const, floor: target.floor, at: target.at }]
    set({
      motions: {
        ...motions,
        [agentId]: {
          route,
          nonce: current.nonce + 1,
          spot,
          slot,
          seated: !!target.seated,
          facing: target.facing ?? null,
        },
      },
    })
    return routeSeconds(from, route)
  },

  setFloor: (agentId, floor) => {
    if (get().floors[agentId] !== floor) set((s) => ({ floors: { ...s.floors, [agentId]: floor } }))
  },
}))
