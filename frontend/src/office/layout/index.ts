import raw from './office.layout.json'
import type { OfficeLayout, Rotation, SpotName, SpotPosition, Vec2, Wall } from './types'

export const layout = raw as OfficeLayout

/** Vertical distance between floor surfaces, in world units. */
export const FLOOR_HEIGHT = 3.4
export const TOP_FLOOR = Math.max(...layout.floors.map((f) => f.level))

export const roomById = new Map(layout.rooms.map((r) => [r.id, r]))
export const workstationById = new Map(layout.workstations.map((w) => [w.id, w]))
export const furnitureById = new Map(layout.furniture.map((f) => [f.id, f]))
export const agentById = new Map(layout.agents.map((a) => [a.id, a]))
export const floorByLevel = new Map(layout.floors.map((f) => [f.level, f]))

export const deg = (r: Rotation | number | undefined) => ((r ?? 0) * Math.PI) / 180

/** Rotate a local (x, z) offset by an item rotation (front = +z at 0°). */
export function rotateOffset([x, z]: Vec2, rotation: Rotation | undefined): Vec2 {
  const t = deg(rotation)
  return [x * Math.cos(t) + z * Math.sin(t), -x * Math.sin(t) + z * Math.cos(t)]
}

// --- Elevator --------------------------------------------------------------------------------------

const { origin: eo, size: es, door } = layout.elevator
/** Where riders stand inside the car. */
export const ELEVATOR_CENTER: Vec2 = [eo[0] + es[0] / 2, eo[1] + es[1] / 2]
/** Just outside the elevator door (east side). */
export const ELEVATOR_DOOR: Vec2 = [eo[0] + es[0] + 0.5, eo[1] + door.at + door.width / 2]

// --- Generated walls ---------------------------------------------------------------------------------

function generatedWalls(floor: number): Wall[] {
  const { width: W, depth: D } = layout.size
  const [x0, z0] = eo
  const [x1, z1] = [eo[0] + es[0], eo[1] + es[1]]
  const w = (id: string, kind: Wall['kind'], from: Vec2, to: Vec2, doors?: Wall['doors']): Wall => ({
    id: `${id}-${floor}`,
    floor,
    kind,
    from,
    to,
    ...(doors ? { doors } : {}),
  })
  return [
    w('outer-n', 'outer', [0, 0], [W, 0]),
    w('outer-w', 'outer', [0, 0], [0, D]),
    w('outer-s', 'outer', [0, D], [W, D]),
    w('outer-e', 'outer', [W, 0], [W, D]),
    w('shaft-n', 'shaft', [x0, z0], [x1, z0]),
    w('shaft-s', 'shaft', [x0, z1], [x1, z1]),
    w('shaft-w', 'shaft', [x0, z0], [x0, z1]),
    w('shaft-e', 'shaft', [x1, z0], [x1, z1], [door]),
  ]
}

/** Every wall on every floor: listed partitions plus generated outer and shaft walls. */
export const allWalls: Wall[] = [...layout.floors.flatMap((f) => generatedWalls(f.level)), ...layout.walls]

// --- Spots -------------------------------------------------------------------------------------------

/** Chair position of a workstation in tile coordinates. */
export const SEAT_OFFSET: Vec2 = [0, 0.78]
/** Where a visitor stands beside someone's desk, in the workstation's local space. */
const VISIT_OFFSET: Vec2 = [1.15, 0.55]

export function seatOf(workstationId: string): Vec2 | undefined {
  const ws = workstationById.get(workstationId)
  if (!ws) return undefined
  const [ox, oz] = rotateOffset(SEAT_OFFSET, ws.rotation)
  return [ws.position[0] + ox, ws.position[1] + oz]
}

/** The agent's own chair, as a spot. */
export function deskSpot(agentId: string): SpotPosition | undefined {
  const agent = agentById.get(agentId)
  const ws = agent && workstationById.get(agent.workstationId)
  const seat = agent && seatOf(agent.workstationId)
  if (!ws || !seat) return undefined
  // Seated agents face the desk: opposite the workstation's front.
  return { floor: ws.floor, at: seat, seated: true, facing: (ws.rotation + 180) % 360 }
}

/** Standing beside another agent's desk, turned toward them. */
export function visitSpot(agentId: string): SpotPosition | undefined {
  const agent = agentById.get(agentId)
  const ws = agent && workstationById.get(agent.workstationId)
  const seat = agent && seatOf(agent.workstationId)
  if (!ws || !seat) return undefined
  const [ox, oz] = rotateOffset(VISIT_OFFSET, ws.rotation)
  const at: Vec2 = [ws.position[0] + ox, ws.position[1] + oz]
  const facing = (Math.atan2(seat[0] - at[0], seat[1] - at[1]) * 180) / Math.PI
  return { floor: ws.floor, at, facing }
}

/** All positions for a spot name ('desk' and 'visit:' resolve to a single position). */
export function spotPositions(spot: SpotName, agentId: string): SpotPosition[] {
  if (spot === 'desk') return [deskSpot(agentId)].filter((s): s is SpotPosition => !!s)
  if (spot.startsWith('visit:')) return [visitSpot(spot.slice(6))].filter((s): s is SpotPosition => !!s)
  return layout.spots[spot as keyof OfficeLayout['spots']] ?? []
}

// --- Misc --------------------------------------------------------------------------------------------

/** Splits a wall into solid pieces around its door openings, as [start, end] offsets along it. */
export function solidSpans(length: number, doors: Wall['doors'] = []) {
  const spans: [number, number][] = []
  let cursor = 0
  for (const d of [...doors].sort((a, b) => a.at - b.at)) {
    if (d.at > cursor) spans.push([cursor, d.at])
    cursor = Math.max(cursor, d.at + d.width)
  }
  if (cursor < length) spans.push([cursor, length])
  return spans
}

/** Stable pseudo-random number in [0, 1) from a string and index. */
export function hash(seed: string, i = 0) {
  let h = 2166136261 ^ i
  for (let c = 0; c < seed.length; c++) h = Math.imul(h ^ seed.charCodeAt(c), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

function inside(room: { origin: Vec2; size: Vec2 }, [x, z]: Vec2) {
  return x >= room.origin[0] && x <= room.origin[0] + room.size[0] && z >= room.origin[1] && z <= room.origin[1] + room.size[1]
}

/** Returns human-readable problems with the layout (empty when valid). */
export function validateLayout(l: OfficeLayout): string[] {
  const problems: string[] = []
  const rooms = new Map(l.rooms.map((r) => [r.id, r]))
  const agents = new Map(l.agents.map((a) => [a.id, a]))
  const stations = new Map(l.workstations.map((w) => [w.id, w]))
  const levels = new Set(l.floors.map((f) => f.level))

  const ids = new Set<string>()
  for (const { id } of [...l.rooms, ...l.walls, ...l.workstations, ...l.furniture]) {
    if (ids.has(id)) problems.push(`duplicate id "${id}"`)
    ids.add(id)
  }
  for (const item of [...l.rooms, ...l.walls, ...l.workstations, ...l.furniture]) {
    if (!levels.has(item.floor)) problems.push(`${item.id}: unknown floor ${item.floor}`)
  }
  for (const item of [...l.workstations, ...l.furniture]) {
    const room = rooms.get(item.roomId)
    if (!room) problems.push(`${item.id}: unknown room "${item.roomId}"`)
    else if (room.floor !== item.floor) problems.push(`${item.id}: room "${room.id}" is on another floor`)
    else if (!inside(room, item.position)) problems.push(`${item.id}: outside room "${room.id}"`)
  }
  for (const w of l.walls) {
    if (w.from[0] !== w.to[0] && w.from[1] !== w.to[1]) problems.push(`${w.id}: wall must be axis-aligned`)
  }
  for (const ws of l.workstations) {
    if (ws.assignedAgentId && !agents.has(ws.assignedAgentId)) problems.push(`${ws.id}: unknown agent "${ws.assignedAgentId}"`)
  }
  for (const a of l.agents) {
    const ws = stations.get(a.workstationId)
    if (!ws) problems.push(`${a.id}: unknown workstation "${a.workstationId}"`)
    else if (ws.assignedAgentId !== a.id) problems.push(`${a.id}: workstation "${ws.id}" is not assigned to it`)
  }
  for (const [name, list] of Object.entries(l.spots)) {
    list.forEach((s, i) => !levels.has(s.floor) && problems.push(`spot ${name}[${i}]: unknown floor ${s.floor}`))
  }
  return problems
}

if (import.meta.env.DEV) {
  const problems = validateLayout(layout)
  if (problems.length) console.warn('[office layout]', problems)
}
