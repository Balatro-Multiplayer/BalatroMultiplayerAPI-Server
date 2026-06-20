export function BalatroSwirl() {
  return (
    <div
      aria-hidden='true'
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        overflow: 'hidden',
        background: 'var(--bal-panel-dark)',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '-60%',
          width: '220%',
          height: '220%',
          background: `
            radial-gradient(ellipse at 25% 15%, #a61a1fdc 0%, transparent 45%),
            radial-gradient(ellipse at 75% 85%, #ec2d33c8 0%, transparent 45%),
            radial-gradient(ellipse at 55% 45%, #0081d3f0 0%, transparent 55%),
            radial-gradient(ellipse at 85% 25%, #a61a1f8c 0%, transparent 35%),
            radial-gradient(ellipse at 15% 75%, #634d8464 0%, transparent 40%)
          `,
          animation: 'swirl1 22s ease-in-out infinite',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: '-30%',
          width: '160%',
          height: '160%',
          background: `
            radial-gradient(circle at 65% 35%, #ec2d3399 0%, transparent 35%),
            radial-gradient(circle at 30% 70%, #0081d3aa 0%, transparent 40%)
          `,
          animation: 'swirl2 17s ease-in-out infinite',
          mixBlendMode: 'screen',
        }}
      />
    </div>
  )
}
