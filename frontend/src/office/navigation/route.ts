/**
 * Routes across floors: walk to the elevator, ride it, walk out on the destination floor.
 */
import { allWalls, ELEVATOR_CENTER, layout } from '../layout'
import type { Vec2 } from '../layout/types'
import { buildNavGrid, findPath, type NavGrid } from './navGrid'

export interface Place {
  floor: number
  at: Vec2
}

/** A route step: walk to a point on a floor, or ride the elevator to a floor. */
export type Waypoint = { kind: 'walk'; floor: number; at: Vec2 } | { kind: 'ride'; floor: number }

export const navGrids: ReadonlyMap<number, NavGrid> = new Map(
  layout.floors.map((f) => [f.level, buildNavGrid(layout, f.level, allWalls)]),
)

function walk(floor: number, from: Vec2, to: Vec2): Waypoint[] | null {
  const grid = navGrids.get(floor)
  if (!grid) return null
  const path = findPath(grid, from, to)
  return path && path.map((at) => ({ kind: 'walk' as const, floor, at }))
}

/** Waypoints from `from` to `to` (excluding the start), or null if unreachable. */
export function planRoute(from: Place, to: Place): Waypoint[] | null {
  if (from.floor === to.floor) return walk(from.floor, from.at, to.at)
  const toLift = walk(from.floor, from.at, ELEVATOR_CENTER)
  const fromLift = walk(to.floor, ELEVATOR_CENTER, to.at)
  if (!toLift || !fromLift) return null
  return [...toLift, { kind: 'ride', floor: to.floor }, ...fromLift]
}

const WALK_SPEED = 2.2
/** Elevator speed in floors per second, plus time for doors. */
export const ELEVATOR_SECONDS_PER_FLOOR = 1.6
const ELEVATOR_DOOR_SECONDS = 1.2

/** Rough travel time for a route, used to pace idle-life activities. */
export function routeSeconds(from: Place, route: Waypoint[]): number {
  let t = 0
  let pos = from.at
  let floor = from.floor
  for (const w of route) {
    if (w.kind === 'ride') {
      t += Math.abs(w.floor - floor) * ELEVATOR_SECONDS_PER_FLOOR + ELEVATOR_DOOR_SECONDS
      floor = w.floor
    } else {
      t += Math.hypot(w.at[0] - pos[0], w.at[1] - pos[1]) / WALK_SPEED
      pos = w.at
    }
  }
  return t
}
