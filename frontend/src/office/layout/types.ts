/**
 * Office layout schema. Coordinates are in floor tiles (1 tile = 1 world unit).
 * x grows east, z grows south; the camera looks from the south-east by default.
 * Rotations are degrees around the vertical axis. At 0° an item's front faces +z (south).
 * Every placed thing names the floor it's on (0 = ground). All floors share one footprint.
 */

export type Vec2 = [number, number]
export type Rotation = 0 | 90 | 180 | 270

export interface OfficeLayout {
  size: { width: number; depth: number }
  floors: Floor[]
  /** One shaft through every floor. Outer and shaft walls are generated, not listed in `walls`. */
  elevator: Elevator
  rooms: Room[]
  walls: Wall[]
  workstations: Workstation[]
  furniture: FurnitureItem[]
  agents: Agent[]
  /** Positions per named spot the backend (or idle life) can send agents to; one agent per position. */
  spots: Record<NamedSpot, SpotPosition[]>
}

export interface Floor {
  level: number
  name: string
  /** Short label for the floor switcher, e.g. "G", "2F". */
  short: string
}

export interface Elevator {
  /** North-west corner and size of the shaft, in tiles. */
  origin: Vec2
  size: Vec2
  /** Door opening on the shaft's east side: offset from the shaft's north edge, and width. */
  door: { at: number; width: number }
}

/**
 * Places an agent can be sent. 'desk' is the agent's own chair; 'visit:<agentId>' is a standing
 * spot beside another agent's desk. The rest are listed in the layout.
 */
export type NamedSpot = 'meeting' | 'meeting_head' | 'presenter' | 'cafe' | 'gaming' | 'lounge' | 'lobby' | 'records'
export type SpotName = 'desk' | NamedSpot | `visit:${string}`

export interface SpotPosition {
  floor: number
  at: Vec2
  /** Sit down here (chairs, stools, sofas) instead of standing. */
  seated?: boolean
  /** Direction to face on arrival, degrees; 0 faces +z (south), 90 faces +x (east). */
  facing?: number
}

export interface Room {
  id: string
  floor: number
  name: string
  purpose: string
  /** North-west corner in tiles. */
  origin: Vec2
  size: Vec2
  floorColor: string
  /** Second checker-tile colour. Defaults to a slightly darker floorColor. */
  floorAccent?: string
}

/** Outer walls cut away automatically when they sit between the camera and the office. */
export type WallKind = 'outer' | 'partition' | 'shaft'

export interface Wall {
  id: string
  floor: number
  kind: WallKind
  /** Axis-aligned segment endpoints in tiles. */
  from: Vec2
  to: Vec2
  doors?: { at: number; width: number }[]
}

export interface Workstation {
  id: string
  floor: number
  roomId: string
  /** Desk centre in tiles. The seated agent faces the desk (local -z). */
  position: Vec2
  rotation: Rotation
  assignedAgentId: string | null
  label: string
}

export type FurnitureType =
  | 'bookshelf'
  | 'sofa'
  | 'armchair'
  | 'coffeeCounter'
  | 'cafeTable'
  | 'stool'
  | 'meetingTable'
  | 'chair'
  | 'filingCabinet'
  | 'statusBoard'
  | 'whiteboard'
  | 'plant'
  | 'rug'
  | 'floorLamp'
  | 'serverRack'
  | 'coffeeTable'
  | 'arcade'
  | 'beanBag'
  | 'pingPong'
  | 'receptionDesk'

export interface FurnitureItem {
  id: string
  floor: number
  type: FurnitureType
  roomId: string
  position: Vec2
  rotation?: Rotation
  label?: string
}

export interface Agent {
  id: string
  name: string
  role: string
  color: string
  workstationId: string
  usesLLM: boolean
}
