import type { ComponentType } from 'react'
import type { FurnitureType } from '../layout/types'
import * as P from './pieces'

export interface CatalogEntry {
  label: string
  /** Width (x) and depth (z) in tiles, used for the selection highlight. */
  footprint: [number, number]
  /** Hangs on an outer wall: hidden while the camera is behind it (wall cut away). */
  wallMounted?: boolean
  component: ComponentType<P.PieceProps>
}

export const furnitureCatalog: Record<FurnitureType, CatalogEntry> = {
  bookshelf: { label: 'Bookshelf', footprint: [1.2, 0.4], component: P.Bookshelf },
  sofa: { label: 'Sofa', footprint: [2, 0.9], component: P.Sofa },
  armchair: { label: 'Armchair', footprint: [1, 0.9], component: P.Armchair },
  coffeeCounter: { label: 'Coffee counter', footprint: [2.5, 0.8], component: P.CoffeeCounter },
  cafeTable: { label: 'Café table', footprint: [0.9, 0.9], component: P.CafeTable },
  stool: { label: 'Stool', footprint: [0.4, 0.4], component: P.Stool },
  meetingTable: { label: 'Meeting table', footprint: [3, 1.4], component: P.MeetingTable },
  chair: { label: 'Chair', footprint: [0.5, 0.5], component: P.Chair },
  filingCabinet: { label: 'Filing cabinet', footprint: [0.5, 0.6], component: P.FilingCabinet },
  statusBoard: { label: 'Status board', footprint: [2.2, 0.15], component: P.StatusBoard, wallMounted: true },
  whiteboard: { label: 'Whiteboard', footprint: [1.7, 0.6], component: P.Whiteboard },
  plant: { label: 'Plant', footprint: [0.5, 0.5], component: P.Plant },
  rug: { label: 'Rug', footprint: [2.4, 1.6], component: P.Rug },
  floorLamp: { label: 'Floor lamp', footprint: [0.45, 0.45], component: P.FloorLamp },
  serverRack: { label: 'Server rack', footprint: [0.6, 0.8], component: P.ServerRack },
  coffeeTable: { label: 'Coffee table', footprint: [1.1, 0.6], component: P.CoffeeTable },
  arcade: { label: 'Arcade cabinet', footprint: [0.7, 0.8], component: P.Arcade },
  beanBag: { label: 'Bean bag', footprint: [0.8, 0.8], component: P.BeanBag },
}
