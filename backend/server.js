const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Allow frontend to call backend (Cross-Origin Resource Sharing)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

// --- Mock data ---
const drivers = [
  { id: 1, name: 'Marcus Johnson', status: 'On Duty',  location: 'Downtown', deliveries: 8 },
  { id: 2, name: 'Sarah Chen',     status: 'Off Duty', location: 'Midtown',  deliveries: 5 },
  { id: 3, name: 'James Rivera',   status: 'On Duty',  location: 'Uptown',   deliveries: 6 },
  { id: 4, name: 'Priya Patel',    status: 'On Duty',  location: 'Eastside', deliveries: 4 },
];

const deliveries = [
  { id: 'ORD-001', customer: 'The Ocean Room',      address: '55 Market St',    status: 'Delivered',  driver: 'Marcus Johnson', time: '11:30 AM' },
  { id: 'ORD-002', customer: 'Husk Restaurant',     address: '76 Queen St',     status: 'In Transit', driver: 'Sarah Chen',     eta: '1:15 PM' },
  { id: 'ORD-003', customer: 'FIG',                 address: '232 Meeting St',  status: 'Pending',    driver: null,             eta: null },
  { id: 'ORD-004', customer: 'Halls Chophouse',     address: '434 King St',     status: 'In Transit', driver: 'James Rivera',   eta: '12:45 PM' },
  { id: 'ORD-005', customer: 'Zero Restaurant',     address: '140 East Bay St', status: 'Failed',     driver: 'Priya Patel',    time: '10:00 AM' },
  { id: 'ORD-006', customer: 'Edmund\'s Oast',      address: '1081 Morrison Dr',status: 'Delivered',  driver: 'Marcus Johnson', time: '10:45 AM' },
];

// --- Routes ---
app.get('/', (req, res) => {
  res.send('DeliverHub Backend is Running!');
});

app.get('/api/drivers', (req, res) => {
  res.json(drivers);
});

app.get('/api/deliveries', (req, res) => {
  res.json(deliveries);
});

app.get('/api/stats', (req, res) => {
  res.json({
    total:        deliveries.length,
    delivered:    deliveries.filter(d => d.status === 'Delivered').length,
    inTransit:    deliveries.filter(d => d.status === 'In Transit').length,
    pending:      deliveries.filter(d => d.status === 'Pending').length,
    failed:       deliveries.filter(d => d.status === 'Failed').length,
    driversOnDuty: drivers.filter(d => d.status === 'On Duty').length,
  });
});

app.listen(3001, () => {
  console.log('DeliverHub backend running on http://localhost:3001');
});
