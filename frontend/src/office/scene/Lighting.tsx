/** Cool evening ambience with a warm key light, so neon screens and lamps read clearly. */
export function Lighting() {
  return (
    <>
      <hemisphereLight args={['#c9d4ff', '#2a2f52', 1.5]} />
      <ambientLight intensity={0.3} color="#b8c4ff" />
      <directionalLight
        position={[9, 22, 12]}
        intensity={2}
        color="#ffe9cf"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-near={1}
        shadow-camera-far={70}
      />
    </>
  )
}
