export default function Page() {
  return (
    <div className='container mx-auto max-w-3xl py-8'>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '48px 24px', border: '2px dashed rgba(255,255,255,0.1)', borderRadius: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--bal-amber)' }}>Coming Soon</span>
        <span style={{ fontSize: 12, color: 'var(--bal-gray-mid)' }}>This admin panel is not yet implemented.</span>
      </div>
    </div>
  )
}
