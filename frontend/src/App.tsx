import { useEffect } from 'react'
import { connectLive } from './api/live'
import { startIdleLife } from './office/life/idleLife'
import { OfficeCanvas } from './office/scene/OfficeCanvas'
import { AgentStatusBar } from './panels/AgentStatusBar'
import { FloorSwitcher } from './panels/FloorSwitcher'
import { InspectorPanel } from './panels/InspectorPanel'
import { ReviewPanel } from './panels/ReviewPanel'
import { RunPanel } from './panels/RunPanel'
import { ViewControls } from './panels/ViewControls'

export default function App() {
  useEffect(() => connectLive(), [])
  useEffect(() => startIdleLife(), [])

  return (
    <main className="app">
      <OfficeCanvas />
      <header className="panel brand">
        <strong>GENTH</strong>
        <span>Virtual Office</span>
      </header>
      <RunPanel />
      <InspectorPanel />
      <FloorSwitcher />
      <AgentStatusBar />
      <ViewControls />
      <ReviewPanel />
    </main>
  )
}
