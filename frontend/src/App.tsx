import { OfficeCanvas } from './office/scene/OfficeCanvas'
import { AgentStatusBar } from './panels/AgentStatusBar'
import { InspectorPanel } from './panels/InspectorPanel'
import { ViewControls } from './panels/ViewControls'

export default function App() {
  return (
    <main className="app">
      <OfficeCanvas />
      <header className="panel brand">
        <strong>GENTH</strong>
        <span>Virtual Office</span>
      </header>
      <InspectorPanel />
      <AgentStatusBar />
      <ViewControls />
    </main>
  )
}
