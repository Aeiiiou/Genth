export function Lighting() {
  return (
    <>
      <hemisphereLight args={['#fff6e8', '#8a7f72', 1.4]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[9, 22, 12]}
        intensity={2.2}
        color="#fff3e0"
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
