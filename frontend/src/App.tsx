import { useEffect } from 'react'
import { connectLive } from './api/live'
import { OfficeCanvas } from './office/scene/OfficeCanvas'
import { AgentStatusBar } from './panels/AgentStatusBar'
import { InspectorPanel } from './panels/InspectorPanel'
import { ReviewPanel } from './panels/ReviewPanel'
import { RunPanel } from './panels/RunPanel'
import { ViewControls } from './panels/ViewControls'

export default function App() {
  useEffect(() => connectLive(), [])

  return (
    <main className="app">
      <OfficeCanvas />
      <header className="panel brand">
        <strong>GENTH</strong>
        <span>Virtual Office</span>
      </header>
      <RunPanel />
      <InspectorPanel />
      <AgentStatusBar />
      <ViewControls />
      <ReviewPanel />
    </main>
  )
}
