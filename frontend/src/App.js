
import { useState } from 'react';

function App() {
  const [deliveries, setDeliveries] = useState(0);

  return (
    <div style={{ padding: '40px', fontFamily: 'Arial' }}>
      <h1>🚚 DeliverHub Dashboard</h1>
      <div style={{ 
        backgroundColor: '#f0f0f0', 
        padding: '20px', 
        borderRadius: '10px',
        marginTop: '20px'
      }}>
        <h2>Active Deliveries: {deliveries}</h2>
        <button 
          onClick={() => setDeliveries(deliveries + 1)}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            marginRight: '10px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          ➕ New Delivery
        </button>
        <button 
          onClick={() => setDeliveries(deliveries - 1)}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            backgroundColor: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          ✅ Complete Delivery
        </button>
      </div>
    </div>
  );
}

export default App;
