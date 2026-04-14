const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

const deliveries = [
  { id: 1, restaurant: "Husk Restaurant", address: "76 Queen St, Charleston, SC 29401", driver: "Marcus Johnson", status: "delivered", time: "09:15", stopDuration: 12, distance: 2.3, onTime: true, lat: 32.7751, lng: -79.9352 },
  { id: 2, restaurant: "FIG Restaurant", address: "232 Meeting St, Charleston, SC 29401", driver: "Sarah Chen", status: "in-transit", time: "10:30", stopDuration: 8, distance: 1.8, onTime: true, lat: 32.7784, lng: -79.9378 },
  { id: 3, restaurant: "The Ordinary", address: "544 King St, Charleston, SC 29403", driver: "Marcus Johnson", status: "pending", time: "11:45", stopDuration: 15, distance: 3.1, onTime: false, lat: 32.7833, lng: -79.9441 },
  { id: 4, restaurant: "Hall's Chophouse", address: "434 King St, Charleston, SC 29403", driver: "Devon Williams", status: "delivered", time: "08:45", stopDuration: 10, distance: 2.7, onTime: true, lat: 32.7821, lng: -79.9432 },
  { id: 5, restaurant: "167 Raw", address: "289 E Bay St, Charleston, SC 29401", driver: "Sarah Chen", status: "delivered", time: "09:30", stopDuration: 7, distance: 1.5, onTime: true, lat: 32.7762, lng: -79.9319 },
  { id: 6, restaurant: "Circa 1886", address: "149 Wentworth St, Charleston, SC 29401", driver: "Jordan Martinez", status: "in-transit", time: "10:00", stopDuration: 11, distance: 2.0, onTime: true, lat: 32.7741, lng: -79.9398 },
  { id: 7, restaurant: "Chez Nous", address: "6 Payne Ct, Charleston, SC 29403", driver: "Devon Williams", status: "delivered", time: "08:00", stopDuration: 9, distance: 3.4, onTime: true, lat: 32.7798, lng: -79.9467 },
  { id: 8, restaurant: "Leon's Oyster Shop", address: "698 King St, Charleston, SC 29403", driver: "Marcus Johnson", status: "pending", time: "12:15", stopDuration: 14, distance: 3.8, onTime: false, lat: 32.7856, lng: -79.9468 },
  { id: 9, restaurant: "The Macintosh", address: "479 King St, Charleston, SC 29403", driver: "Jordan Martinez", status: "delivered", time: "09:45", stopDuration: 8, distance: 2.9, onTime: true, lat: 32.7825, lng: -79.9445 },
  { id: 10, restaurant: "Slightly North of Broad", address: "192 E Bay St, Charleston, SC 29401", driver: "Sarah Chen", status: "delivered", time: "10:15", stopDuration: 6, distance: 1.2, onTime: true, lat: 32.7748, lng: -79.9324 },
  { id: 11, restaurant: "Edmunds Oast", address: "1081 Morrison Dr, Charleston, SC 29403", driver: "Jordan Martinez", status: "pending", time: "13:00", stopDuration: 16, distance: 4.2, onTime: false, lat: 32.7912, lng: -79.9578 },
  { id: 12, restaurant: "The Darling Oyster Bar", address: "513 King St, Charleston, SC 29403", driver: "Devon Williams", status: "in-transit", time: "11:00", stopDuration: 10, distance: 3.3, onTime: true, lat: 32.7829, lng: -79.9447 }
];

const drivers = [
  { id: 1, name: "Marcus Johnson", vehicle: "Ford Transit", status: "active", phone: "(843) 555-0101", deliveries: 47, rating: 4.8 },
  { id: 2, name: "Sarah Chen", vehicle: "Sprinter Van", status: "active", phone: "(843) 555-0102", deliveries: 52, rating: 4.9 },
  { id: 3, name: "Devon Williams", vehicle: "Chevy Express", status: "active", phone: "(843) 555-0103", deliveries: 38, rating: 4.7 },
  { id: 4, name: "Jordan Martinez", vehicle: "Ford Transit", status: "active", phone: "(843) 555-0104", deliveries: 41, rating: 4.6 }
];

router.get('/stats', authenticateToken, (req, res) => {
  const completed = deliveries.filter(d => d.status === 'delivered');
  const onTimeRate = completed.length ? Math.round((completed.filter(d => d.onTime).length / completed.length) * 100) : 0;
  const activeDrivers = [...new Set(deliveries.filter(d => d.status === 'in-transit' || d.status === 'pending').map(d => d.driver))].length;
  res.json({
    totalDeliveries: deliveries.length,
    completedToday: completed.length,
    onTimeRate,
    activeDrivers,
    totalDrivers: drivers.length,
    failed: deliveries.filter(d => d.status === 'failed').length,
    pendingCount: deliveries.filter(d => d.status === 'pending').length,
    inTransitCount: deliveries.filter(d => d.status === 'in-transit').length,
    yesterday: { totalDeliveries: 10, completedToday: 8, onTimeRate: 82, activeDrivers: 3, totalDrivers: 4, failed: 1, pendingCount: 2 }
  });
});

router.get('/deliveries', authenticateToken, (req, res) => {
  if (req.user.role === 'driver') return res.json(deliveries.filter(d => d.driver === req.user.name));
  res.json(deliveries);
});

router.get('/drivers', authenticateToken, (req, res) => {
  const result = drivers.map(d => {
    const dd = deliveries.filter(del => del.driver === d.name);
    const completed = dd.filter(del => del.status === 'delivered');
    const onTimeRate = completed.length ? Math.round(completed.filter(del => del.onTime).length / completed.length * 100) : 100;
    const milesToday = parseFloat(dd.reduce((s, del) => s + del.distance, 0).toFixed(1));
    const avgStopMinutes = completed.length ? Math.round(completed.reduce((s, del) => s + del.stopDuration, 0) / completed.length) : 0;
    const avgSpeedMph = parseFloat((22 + (d.rating - 4.5) * 20).toFixed(1));
    const active = dd.find(del => del.status === 'in-transit') || dd[dd.length - 1];
    const isOnDuty = dd.some(del => del.status === 'in-transit' || del.status === 'pending');
    return {
      id: d.id, name: d.name, vehicleId: d.vehicle, phone: d.phone,
      status: isOnDuty ? 'on-duty' : 'off-duty',
      onTimeRate, totalStopsToday: completed.length, milesToday, avgStopMinutes, avgSpeedMph,
      lat: active ? active.lat : 32.7765, lng: active ? active.lng : -79.9311
    };
  });
  res.json(result);
});

router.get('/analytics', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  const completed = deliveries.filter(d => d.status === 'delivered');
  const avgStopTime = completed.reduce((s, d) => s + d.stopDuration, 0) / (completed.length || 1);
  const onTimeRate = (completed.filter(d => d.onTime).length / (completed.length || 1)) * 100;
  const peakHours = [
    { hour: '8am', count: 3 }, { hour: '9am', count: 4 }, { hour: '10am', count: 3 },
    { hour: '11am', count: 2 }, { hour: '12pm', count: 1 }, { hour: '1pm', count: 1 }
  ];
  const driverRankings = drivers.map(d => {
    const dd = deliveries.filter(del => del.driver === d.name);
    const comp = dd.filter(del => del.status === 'delivered');
    const onTime = comp.length ? parseFloat((comp.filter(del => del.onTime).length / comp.length * 100).toFixed(1)) : 100;
    const avgStop = comp.length ? parseFloat((comp.reduce((s, del) => s + del.stopDuration, 0) / comp.length).toFixed(1)) : 0;
    const miles = parseFloat(dd.reduce((s, del) => s + del.distance, 0).toFixed(1));
    return { name: d.name, stopsPerHour: parseFloat((comp.length / 8).toFixed(1)), avgStopMinutes: avgStop, avgSpeedMph: parseFloat((22 + (d.rating - 4.5) * 20).toFixed(1)), onTimeRate: onTime, milesToday: miles };
  }).sort((a, b) => b.onTimeRate - a.onTimeRate);
  res.json({ avgStopTime: avgStopTime.toFixed(1), onTimeRate: onTimeRate.toFixed(1), avgSpeed: 28.4, peakHours, driverRankings, totalDeliveries: deliveries.length, completedToday: completed.length });
});

router.patch('/deliveries/:id/status', authenticateToken, (req, res) => {
  const delivery = deliveries.find(d => d.id === parseInt(req.params.id));
  if (!delivery) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'driver' && delivery.driver !== req.user.name) return res.status(403).json({ error: 'Forbidden' });
  delivery.status = req.body.status;
  res.json(delivery);
});

module.exports = router;
