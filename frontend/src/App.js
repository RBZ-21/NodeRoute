import logo from './logo.svg';

function App() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '32px',
        background: 'linear-gradient(135deg, #050d2a 0%, #0f2244 55%, #050d2a 100%)',
        color: '#fff',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          width: 'min(760px, 100%)',
          background: 'rgba(13, 27, 62, 0.9)',
          border: '1px solid #1a2f5e',
          borderRadius: '24px',
          padding: '40px',
          textAlign: 'center',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)',
        }}
      >
        <img
          src={logo}
          alt="NodeRoute"
          style={{ width: 'min(360px, 100%)', height: 'auto', display: 'block', margin: '0 auto 24px' }}
        />
        <h1 style={{ fontSize: 'clamp(32px, 5vw, 48px)', marginBottom: '12px', letterSpacing: '-0.04em' }}>
          NodeRoute
        </h1>
        <p style={{ fontSize: '18px', lineHeight: 1.6, color: '#c7d2fe', marginBottom: '18px' }}>
          Delivery operations, customer service, inventory, and routing tools in one place.
        </p>
        <p style={{ fontSize: '14px', lineHeight: 1.7, color: '#8899bb' }}>
          Use the static pages in `frontend/` for the full working experience.
        </p>
      </div>
    </div>
  );
}

export default App;
