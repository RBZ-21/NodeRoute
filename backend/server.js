const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// --- Mock data ---
const drivers = [
  { id: 1, name: 'Marcus Johnson', status: 'On Duty', location: 'Downtown', deliveries: 8 },
  { id: 2, name: 'Sarah Chen',    status: 'Off Duty', location: 'Midtown',   deliveries: 5 },
  { id: 3, name: 'Jamal Rivera',  status: 'On Duty', location: 'Eastside',  deliveries: 11 },
  { id: 4, name: 'Priya Patel',   status: 'On Duty', location: 'Westside',  deliveries: 3 },
];

const deliveries = [
  { id: 'D-1001', customer: 'Alex Turner',   address: '42 Oak St',       status: 'Delivered',   driver: 'Marcus Johnson', time: '10:14 AM', eta: null },
  { id: 'D-1002', customer: 'Bella Nguyen',  address: '88 Pine Ave',     status: 'In Transit',  driver: 'Jamal Rivera',  time: null,       eta: '11:30 AM' },
  { id: 'D-1003', customer: 'Carlos Diaz',   address: '7 Maple Blvd',    status: 'Pending',     driver: null,            time: null,       eta: '12:00 PM' },
  { id: 'D-1004', customer: 'Diana Park',    address: '310 Elm Rd',      status: 'In Transit',  driver: 'Priya Patel',   time: null,       eta: '11:45 AM' },
  { id: 'D-1005', customer: 'Ethan Brooks',  address: '19 Cedar Ln',     status: 'Delivered',   driver: 'Sarah Chen',    time: '9:52 AM',  eta: null },
  { id: 'D-1006', customer: 'Fatima Hassan', address: '55 Birch Way',    status: 'Pending',     driver: null,            time: null,       eta: '1:00 PM' },
  { id: 'D-1007', customer: 'George Kim',    address: '201 Spruce Dr',   status: 'In Transit',  driver: 'Marcus Johnson', time: null,      eta: '12:15 PM' },
  { id: 'D-1008', customer: 'Hannah Scott',  address: '93 Walnut St',    status: 'Failed',      driver: 'Jamal Rivera',  time: '10:40 AM', eta: null },
];

// --- Routes ---
app.get('/api/drivers', (req, res) => res.json(drivers));
app.get('/api/deliveries', (req, res) => res.json(deliveries));

app.get('/api/stats', (req, res) => {
  res.json({
    total:      deliveries.length,
    delivered:  deliveries.filter(d => d.status === 'Delivered').length,
    inTransit:  deliveries.filter(d => d.status === 'In Transit').length,
    pending:    deliveries.filter(d => d.status === 'Pending').length,
    failed:     deliveries.filter(d => d.status === 'Failed').length,
    driversOnDuty: drivers.filter(d => d.status === 'On Duty').length,
  });
});

// Fallback — serve the SPA
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

app.listen(3001, () => {
  console.log('DeliverHub API running → http://localhost:3001');
});
