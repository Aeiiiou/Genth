import { describe, expect, it } from 'vitest'
import { layout, seatOf } from '../layout'
import type { OfficeLayout, Vec2 } from '../layout/types'
import { buildNavGrid, cellOf, crossesWall, findPath, isBlocked } from './navGrid'

const grid = buildNavGrid(layout)
const seats = layout.agents.map((a) => [a.id, seatOf(a.workstationId)!] as const)
const spots = Object.entries(layout.spots).flatMap(([name, list]) => list.map((p, i) => [`${name}[${i}]`, p] as const))

function assertValidPath(from: Vec2, to: Vec2) {
  const path = findPath(grid, from, to)
  expect(path, `no path ${from} → ${to}`).not.toBeNull()
  const points = [from, ...path!]
  for (let k = 1; k < points.length; k++) {
    expect(crossesWall(grid, points[k - 1], points[k]), `path ${from} → ${to} crosses a wall at leg ${k}`).toBe(false)
  }
  expect(path!.at(-1)).toEqual(to)
}

describe('office navigation', () => {
  it.each(spots)('spot %s is on a free cell', (_name, p) => {
    expect(isBlocked(grid, cellOf(grid, p))).toBe(false)
  })

  it.each(seats)('%s can walk from its desk to every spot and back', (_id, seat) => {
    for (const [, spot] of spots) {
      assertValidPath(seat, spot)
      assertValidPath(spot, seat)
    }
  })

  it('agents can reach each other’s desks', () => {
    for (const [, a] of seats) for (const [, b] of seats) if (a !== b) assertValidPath(a, b)
  })
})

describe('findPath', () => {
  const room: OfficeLayout = {
    size: { width: 6, depth: 4 },
    rooms: [],
    workstations: [],
    furniture: [],
    agents: [],
    spots: { meeting: [], cafe: [], lounge: [], commons: [] },
    // A wall down the middle with a door near the bottom.
    walls: [{ id: 'mid', kind: 'partition', from: [3, 0], to: [3, 4], doors: [{ at: 2.6, width: 1.4 }] }],
  }
  const small = buildNavGrid(room)

  it('routes through the doorway instead of the wall', () => {
    const path = findPath(small, [1.25, 0.75], [4.75, 0.75])!
    const legs = [[1.25, 0.75] as Vec2, ...path]
    for (let k = 1; k < legs.length; k++) expect(crossesWall(small, legs[k - 1], legs[k])).toBe(false)
    expect(path.some(([, z]) => z > 2.6)).toBe(true)
  })

  it('returns null when the door is closed off', () => {
    const closed = buildNavGrid({ ...room, walls: [{ id: 'mid', kind: 'partition', from: [3, 0], to: [3, 4] }] })
    expect(findPath(closed, [1.25, 0.75], [4.75, 0.75])).toBeNull()
  })

  it('returns just the target when already in the goal cell', () => {
    expect(findPath(small, [1.2, 1.2], [1.3, 1.3])).toEqual([[1.3, 1.3]])
  })
})
