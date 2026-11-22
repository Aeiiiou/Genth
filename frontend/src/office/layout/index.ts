import raw from './office.layout.json'
import type { OfficeLayout, Rotation, Vec2, Wall } from './types'

export const layout = raw as OfficeLayout

export const roomById = new Map(layout.rooms.map((r) => [r.id, r]))
export const workstationById = new Map(layout.workstations.map((w) => [w.id, w]))
export const furnitureById = new Map(layout.furniture.map((f) => [f.id, f]))
export const agentById = new Map(layout.agents.map((a) => [a.id, a]))

export const deg = (r: Rotation | undefined) => ((r ?? 0) * Math.PI) / 180

/** Rotate a local (x, z) offset by an item rotation (front = +z at 0°). */
export function rotateOffset([x, z]: Vec2, rotation: Rotation | undefined): Vec2 {
  const t = deg(rotation)
  return [x * Math.cos(t) + z * Math.sin(t), -x * Math.sin(t) + z * Math.cos(t)]
}

function inside(room: { origin: Vec2; size: Vec2 }, [x, z]: Vec2) {
  return (
    x >= room.origin[0] &&
    x <= room.origin[0] + room.size[0] &&
    z >= room.origin[1] &&
    z <= room.origin[1] + room.size[1]
  )
}

/** Returns human-readable problems with the layout (empty when valid). */
export function validateLayout(l: OfficeLayout): string[] {
  const problems: string[] = []
  const rooms = new Map(l.rooms.map((r) => [r.id, r]))
  const agents = new Map(l.agents.map((a) => [a.id, a]))
  const stations = new Map(l.workstations.map((w) => [w.id, w]))

  const ids = new Set<string>()
  for (const { id } of [...l.rooms, ...l.walls, ...l.workstations, ...l.furniture]) {
    if (ids.has(id)) problems.push(`duplicate id "${id}"`)
    ids.add(id)
  }
  for (const item of [...l.workstations, ...l.furniture]) {
    const room = rooms.get(item.roomId)
    if (!room) problems.push(`${item.id}: unknown room "${item.roomId}"`)
    else if (!inside(room, item.position)) problems.push(`${item.id}: outside room "${room.id}"`)
  }
  for (const w of l.walls) {
    if (w.from[0] !== w.to[0] && w.from[1] !== w.to[1]) problems.push(`${w.id}: wall must be axis-aligned`)
  }
  for (const ws of l.workstations) {
    if (ws.assignedAgentId && !agents.has(ws.assignedAgentId)) {
      problems.push(`${ws.id}: unknown agent "${ws.assignedAgentId}"`)
    }
  }
  for (const a of l.agents) {
    const ws = stations.get(a.workstationId)
    if (!ws) problems.push(`${a.id}: unknown workstation "${a.workstationId}"`)
    else if (ws.assignedAgentId !== a.id) problems.push(`${a.id}: workstation "${ws.id}" is not assigned to it`)
  }
  return problems
}

if (import.meta.env.DEV) {
  const problems = validateLayout(layout)
  if (problems.length) console.warn('[office layout]', problems)
}

/** Chair position relative to a workstation's desk centre, in its local space. */
export const SEAT_OFFSET: Vec2 = [0, 0.78]

/** Stable pseudo-random number in [0, 1) from a string and index. */
export function hash(seed: string, i = 0) {
  let h = 2166136261 ^ i
  for (let c = 0; c < seed.length; c++) h = Math.imul(h ^ seed.charCodeAt(c), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

/** Splits a wall into solid pieces around its door openings, as [start, end] offsets along it. */
export function solidSpans(length: number, doors: Wall['doors'] = []) {
  const spans: [number, number][] = []
  let cursor = 0
  for (const door of [...doors].sort((a, b) => a.at - b.at)) {
    if (door.at > cursor) spans.push([cursor, door.at])
    cursor = Math.max(cursor, door.at + door.width)
  }
  if (cursor < length) spans.push([cursor, length])
  return spans
}

/** Chair position of a workstation in tile coordinates. */
export function seatOf(workstationId: string): Vec2 | undefined {
  const ws = workstationById.get(workstationId)
  if (!ws) return undefined
  const [ox, oz] = rotateOffset(SEAT_OFFSET, ws.rotation)
  return [ws.position[0] + ox, ws.position[1] + oz]
}
