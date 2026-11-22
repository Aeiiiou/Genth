import { describe, expect, it } from 'vitest'
import { deskSpot, ELEVATOR_CENTER, layout, spotPositions, validateLayout, visitSpot } from '../layout'
import type { OfficeLayout, SpotPosition, Vec2 } from '../layout/types'
import { buildNavGrid, cellOf, crossesWall, findPath, isBlocked } from './navGrid'
import { navGrids, planRoute, type Waypoint } from './route'

const desks = layout.agents.map((a) => [a.id, deskSpot(a.id)!] as const)
const named = Object.entries(layout.spots).flatMap(([name, list]) => list.map((p, i) => [`${name}[${i}]`, p] as const))
const visits = layout.agents.map((a) => [`visit:${a.id}`, visitSpot(a.id)!] as const)

function assertRoute(from: SpotPosition, to: SpotPosition) {
  const route = planRoute(from, to)
  expect(route, `no route ${JSON.stringify(from)} → ${JSON.stringify(to)}`).not.toBeNull()
  let pos: Vec2 = from.at
  let floor = from.floor
  for (const w of route as Waypoint[]) {
    if (w.kind === 'ride') {
      expect(pos, 'rides start inside the elevator').toEqual(ELEVATOR_CENTER)
      floor = w.floor
      continue
    }
    expect(w.floor).toBe(floor)
    expect(crossesWall(navGrids.get(floor)!, pos, w.at), `leg crosses a wall on floor ${floor}`).toBe(false)
    pos = w.at
  }
  expect(floor).toBe(to.floor)
  expect(pos).toEqual(to.at)
}

describe('office layout', () => {
  it('is valid', () => {
    expect(validateLayout(layout)).toEqual([])
  })

  it('names one desk per agent and a spot for every backend spot name', () => {
    for (const [id, d] of desks) expect(d, id).toBeDefined()
    for (const name of ['meeting', 'meeting_head', 'presenter', 'cafe', 'gaming', 'lounge', 'lobby', 'records'] as const) {
      expect(spotPositions(name, 'github').length, name).toBeGreaterThan(0)
    }
  })

  it.each([...named, ...visits])('%s is on a free cell or a seat', (_name, p) => {
    // Seats (chairs, stools, sofas) are furniture, so their cell may be blocked; standing spots must be free.
    if (!p.seated) expect(isBlocked(navGrids.get(p.floor)!, cellOf(navGrids.get(p.floor)!, p.at))).toBe(false)
  })
})

describe('routes between floors', () => {
  it.each(desks)('%s can reach every spot and get back to its desk', (_id, desk) => {
    for (const [, spot] of [...named, ...visits]) {
      assertRoute(desk, spot)
      assertRoute(spot, desk)
    }
  })

  it('everyone can reach everyone else’s desk', () => {
    for (const [, a] of desks) for (const [, b] of desks) if (a !== b) assertRoute(a, b)
  })

  it('uses the elevator only when changing floors', () => {
    const [, boss] = desks.find(([id]) => id === 'supervisor')!
    const [, medg] = desks.find(([id]) => id === 'github')!
    const [, liled] = desks.find(([id]) => id === 'summary')!
    expect(planRoute(medg, liled)!.some((w) => w.kind === 'ride')).toBe(false)
    expect(planRoute(medg, boss)!.filter((w) => w.kind === 'ride')).toEqual([{ kind: 'ride', floor: boss.floor }])
  })
})

describe('findPath', () => {
  const room: OfficeLayout = {
    size: { width: 6, depth: 4 },
    floors: [{ level: 0, name: 'G', short: 'G' }],
    elevator: { origin: [0, 0], size: [1, 1], door: { at: 0, width: 1 } },
    rooms: [],
    workstations: [],
    furniture: [],
    agents: [],
    spots: { meeting: [], meeting_head: [], presenter: [], cafe: [], gaming: [], lounge: [], lobby: [], records: [] },
    // A wall down the middle with a door near the bottom.
    walls: [{ id: 'mid', floor: 0, kind: 'partition', from: [3, 0], to: [3, 4], doors: [{ at: 2.6, width: 1.4 }] }],
  }
  const small = buildNavGrid(room)

  it('routes through the doorway instead of the wall', () => {
    const path = findPath(small, [1.25, 0.75], [4.75, 0.75])!
    const legs = [[1.25, 0.75] as Vec2, ...path]
    for (let k = 1; k < legs.length; k++) expect(crossesWall(small, legs[k - 1], legs[k])).toBe(false)
    expect(path.some(([, z]) => z > 2.6)).toBe(true)
  })

  it('returns null when the door is closed off', () => {
    const closed = buildNavGrid({ ...room, walls: [{ id: 'mid', floor: 0, kind: 'partition', from: [3, 0], to: [3, 4] }] })
    expect(findPath(closed, [1.25, 0.75], [4.75, 0.75])).toBeNull()
  })

  it('returns just the target when already in the goal cell', () => {
    expect(findPath(small, [1.2, 1.2], [1.3, 1.3])).toEqual([[1.3, 1.3]])
  })
})
