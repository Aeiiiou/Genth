/**
 * Office layout schema. Coordinates are in floor tiles (1 tile = 1 world unit).
 * x grows east, z grows south; the camera looks from the south-east by default.
 * Rotations are degrees around the vertical axis. At 0° an item's front faces +z (south).
 */

export type Vec2 = [number, number]
export type Rotation = 0 | 90 | 180 | 270

export interface OfficeLayout {
  size: { width: number; depth: number }
  rooms: Room[]
  walls: Wall[]
  workstations: Workstation[]
  furniture: FurnitureItem[]
  agents: Agent[]
}

export interface Room {
  id: string
  name: string
  purpose: string
  /** North-west corner in tiles. */
  origin: Vec2
  size: Vec2
  floorColor: string
}

/** Outer walls cut away automatically when they sit between the camera and the office. */
export type WallKind = 'outer' | 'partition'

export interface Wall {
  id: string
  kind: WallKind
  /** Axis-aligned segment endpoints in tiles. */
  from: Vec2
  to: Vec2
  doors?: { at: number; width: number }[]
}

export interface Workstation {
  id: string
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

export interface FurnitureItem {
  id: string
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
