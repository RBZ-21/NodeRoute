function pad(value) {
  return String(value).padStart(2, '0');
}

function generatePurchaseOrderNumber(date = new Date()) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `PO-${year}${month}${day}-${hours}${minutes}${seconds}-${random}`;
}

module.exports = {
  generatePurchaseOrderNumber,
};
