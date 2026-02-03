const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('DeliverHub Backend is Running!');
});

app.get('/drivers', (req, res) => {
  res.json([
    { id: 1, name: 'Marcus Johnson', status: 'On Duty' },
    { id: 2, name: 'Sarah Chen', status: 'Off Duty' }
  ]);
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
