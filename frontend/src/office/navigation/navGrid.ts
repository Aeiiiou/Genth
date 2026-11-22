/**
 * Walkable grid and A* pathfinding over the office layout.
 *
 * The floor is split into half-tile cells. Furniture and desks block cells; walls block movement
 * *between* cells (except through doorways), so thin walls don't need cells of their own.
 */
import { furnitureCatalog } from '../furniture/catalog'
import { solidSpans } from '../layout'
import type { FurnitureType, OfficeLayout, Rotation, Vec2, Wall } from '../layout/types'

export const CELL = 0.5
/** Clearance kept around furniture so agents don't brush through it. */
const AGENT_RADIUS = 0.15
/** Clearance kept from door frames when passing through a doorway. */
const DOOR_MARGIN = 0.3
const NON_BLOCKING: ReadonlySet<FurnitureType> = new Set(['rug', 'statusBoard'])
const DESK_SIZE: Vec2 = [1.6, 0.8]
/** How many cells around a seat a route may cross furniture to get in or out of it. */
const SEAT_REACH = 2

interface WallSpan {
  horizontal: boolean
  /** z for horizontal walls, x for vertical ones. */
  line: number
  from: number
  to: number
}

export interface NavGrid {
  cols: number
  rows: number
  blocked: Uint8Array
  walls: WallSpan[]
}

type Cell = [number, number]

function rotatedSize([w, d]: Vec2, rotation: Rotation | undefined): Vec2 {
  return rotation === 90 || rotation === 270 ? [d, w] : [w, d]
}

/**
 * Walkable grid for one floor. `walls` defaults to the layout's listed walls on that floor; the app
 * passes `allWalls` so generated outer and elevator-shaft walls count too.
 */
export function buildNavGrid(layout: OfficeLayout, floor = 0, walls: Wall[] = layout.walls): NavGrid {
  const cols = Math.round(layout.size.width / CELL)
  const rows = Math.round(layout.size.depth / CELL)
  const blocked = new Uint8Array(cols * rows)

  const blockRect = (center: Vec2, size: Vec2) => {
    const hw = size[0] / 2 + AGENT_RADIUS
    const hd = size[1] / 2 + AGENT_RADIUS
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const [x, z] = cellCenter([i, j])
        if (Math.abs(x - center[0]) < hw && Math.abs(z - center[1]) < hd) blocked[j * cols + i] = 1
      }
    }
  }

  for (const f of layout.furniture) {
    if (f.floor === floor && !NON_BLOCKING.has(f.type)) blockRect(f.position, rotatedSize(furnitureCatalog[f.type].footprint, f.rotation))
  }
  for (const ws of layout.workstations) {
    if (ws.floor === floor) blockRect(ws.position, rotatedSize(DESK_SIZE, ws.rotation))
  }

  const spans: WallSpan[] = []
  for (const w of walls) {
    if (w.floor !== floor) continue
    const horizontal = w.from[1] === w.to[1]
    const start = horizontal ? Math.min(w.from[0], w.to[0]) : Math.min(w.from[1], w.to[1])
    const length = Math.abs(horizontal ? w.to[0] - w.from[0] : w.to[1] - w.from[1])
    for (const [a, b] of solidSpans(length, w.doors)) {
      spans.push({ horizontal, line: horizontal ? w.from[1] : w.from[0], from: start + a, to: start + b })
    }
  }

  return { cols, rows, blocked, walls: spans }
}

export function cellCenter([i, j]: Cell): Vec2 {
  return [(i + 0.5) * CELL, (j + 0.5) * CELL]
}

export function cellOf(grid: NavGrid, [x, z]: Vec2): Cell {
  const clamp = (v: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(v / CELL)))
  return [clamp(x, grid.cols), clamp(z, grid.rows)]
}

export function isBlocked(grid: NavGrid, [i, j]: Cell) {
  return grid.blocked[j * grid.cols + i] === 1
}

/** True when the straight segment p→q passes through a solid wall (door frames included). */
export function crossesWall(grid: NavGrid, p: Vec2, q: Vec2): boolean {
  for (const w of grid.walls) {
    const [pa, pb, qa, qb] = w.horizontal ? [p[1], p[0], q[1], q[0]] : [p[0], p[1], q[0], q[1]]
    if ((pa - w.line) * (qa - w.line) >= 0) continue // doesn't cross this wall's line
    const t = (w.line - pa) / (qa - pa)
    const at = pb + (qb - pb) * t
    if (at > w.from - DOOR_MARGIN && at < w.to + DOOR_MARGIN) return true
  }
  return false
}

const NEIGHBOURS: Cell[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

/**
 * Path from `from` to `to` in tile coordinates, excluding the start and ending exactly at `to`.
 * The start and goal cells may themselves be blocked (e.g. a chair tucked under a desk).
 * Returns null when no route exists.
 */
export function findPath(grid: NavGrid, from: Vec2, to: Vec2): Vec2[] | null {
  const { cols, rows } = grid
  const start = cellOf(grid, from)
  const goal = cellOf(grid, to)
  const idx = ([i, j]: Cell) => j * cols + i
  const startIdx = idx(start)
  const goalIdx = idx(goal)
  if (startIdx === goalIdx) return [to]

  // Seats (chairs, stools, sofas) sit inside furniture, so their cell and its neighbours are blocked.
  // When a route starts or ends on one, allow blocked cells close to it: stepping out of / into the seat.
  const near = (c: Cell, d: Cell) => Math.max(Math.abs(c[0] - d[0]), Math.abs(c[1] - d[1])) <= SEAT_REACH
  const startBlocked = isBlocked(grid, start)
  const goalBlocked = isBlocked(grid, goal)
  const passable = (c: Cell) =>
    !isBlocked(grid, c) || (goalBlocked && near(c, goal)) || (startBlocked && near(c, start)) || idx(c) === goalIdx || idx(c) === startIdx
  const canStep = (a: Cell, b: Cell) => passable(b) && !crossesWall(grid, cellCenter(a), cellCenter(b))
  const h = ([i, j]: Cell) => {
    const dx = Math.abs(i - goal[0])
    const dy = Math.abs(j - goal[1])
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
  }

  const g = new Float32Array(cols * rows).fill(Infinity)
  const came = new Int32Array(cols * rows).fill(-1)
  const closed = new Uint8Array(cols * rows)
  const open = new MinHeap()
  g[startIdx] = 0
  open.push(startIdx, h(start))

  while (open.size) {
    const cur = open.pop()
    if (cur === goalIdx) break
    if (closed[cur]) continue
    closed[cur] = 1
    const c: Cell = [cur % cols, Math.floor(cur / cols)]
    for (const [di, dj] of NEIGHBOURS) {
      const n: Cell = [c[0] + di, c[1] + dj]
      if (n[0] < 0 || n[1] < 0 || n[0] >= cols || n[1] >= rows) continue
      if (!canStep(c, n)) continue
      // No corner cutting: a diagonal needs both orthogonal moves to be open.
      if (di && dj && !(canStep(c, [c[0] + di, c[1]]) && canStep(c, [c[0], c[1] + dj]))) continue
      const ni = idx(n)
      const cost = g[cur] + (di && dj ? Math.SQRT2 : 1)
      if (cost < g[ni]) {
        g[ni] = cost
        came[ni] = cur
        open.push(ni, cost + h(n))
      }
    }
  }

  if (came[goalIdx] === -1) return null

  const cells: Cell[] = []
  for (let k = goalIdx; k !== startIdx; k = came[k]) cells.push([k % cols, Math.floor(k / cols)])
  cells.reverse()
  const points = simplify(cells).map(cellCenter)
  points[points.length - 1] = to
  return points
}

/** Drops cells in the middle of straight runs, keeping only turning points. */
function simplify(cells: Cell[]): Cell[] {
  return cells.filter((c, k) => {
    if (k === 0 || k === cells.length - 1) return true
    const [a, b] = [cells[k - 1], cells[k + 1]]
    return c[0] - a[0] !== b[0] - c[0] || c[1] - a[1] !== b[1] - c[1]
  })
}

class MinHeap {
  private items: number[] = []
  private keys: number[] = []

  get size() {
    return this.items.length
  }

  push(item: number, key: number) {
    this.items.push(item)
    this.keys.push(key)
    let i = this.items.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p] <= this.keys[i]) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): number {
    const top = this.items[0]
    const lastItem = this.items.pop()!
    const lastKey = this.keys.pop()!
    if (this.items.length) {
      this.items[0] = lastItem
      this.keys[0] = lastKey
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }

  private swap(a: number, b: number) {
    ;[this.items[a], this.items[b]] = [this.items[b], this.items[a]]
    ;[this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]]
  }
}
