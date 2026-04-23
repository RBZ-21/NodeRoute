const { filterRowsByContext } = require('./operating-context');

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function stopMatchesInvoice(stop, invoice) {
  const stopName = normalize(stop?.name);
  const stopAddress = normalize(stop?.address);
  const invoiceName = normalize(invoice?.customer_name);
  const invoiceAddress = normalize(invoice?.customer_address);

  return (
    (!!stopName && !!invoiceName && stopName === invoiceName) ||
    (!!stopAddress && !!invoiceAddress && stopAddress === invoiceAddress) ||
    (!!stopName && !!invoiceName && (stopName.includes(invoiceName) || invoiceName.includes(stopName))) ||
    (!!stopAddress && !!invoiceAddress && (stopAddress.includes(invoiceAddress) || invoiceAddress.includes(stopAddress)))
  );
}

function isRouteAssignedToUser(route, user) {
  return (
    String(route?.driver_id || '') === String(user?.id || '') ||
    normalize(route?.driver_email) === normalize(user?.email) ||
    normalize(route?.driver) === normalize(user?.name)
  );
}

function attachRouteContext(invoice, matchedRoute, stop) {
  return {
    ...invoice,
    route_id: invoice.route_id || matchedRoute?.id || null,
    route_name: matchedRoute?.name || null,
    stop_id: stop?.id || null,
    stop_name: stop?.name || null,
    assigned_via: stop
      ? 'stop-match'
      : invoice?.route_id && matchedRoute
        ? 'route-id'
        : 'driver-name',
    invoice_has_signature: !!invoice?.signature_data,
  };
}

async function loadDriverInvoiceScope(supabase, user, context) {
  const [routesResult, stopsResult, invoicesResult] = await Promise.all([
    supabase.from('routes').select('*').order('created_at', { ascending: false }),
    supabase.from('stops').select('*'),
    supabase.from('invoices').select('*').order('created_at', { ascending: false }),
  ]);

  if (routesResult.error) throw new Error(routesResult.error.message);
  if (stopsResult.error) throw new Error(stopsResult.error.message);
  if (invoicesResult.error) throw new Error(invoicesResult.error.message);

  const routes = filterRowsByContext(routesResult.data || [], context)
    .filter((route) => isRouteAssignedToUser(route, user));
  const stops = filterRowsByContext(stopsResult.data || [], context);
  const invoices = filterRowsByContext(invoicesResult.data || [], context);

  const routeMap = new Map(routes.map((route) => [route.id, route]));
  const routeStops = stops.filter((stop) => routes.some((route) => (route.stop_ids || []).includes(stop.id)));
  const routeIds = new Set(routes.map((route) => route.id));

  const assignedInvoices = [];
  const assignedInvoiceIds = new Set();

  for (const invoice of invoices) {
    const invoiceDriverName = normalize(invoice.driver_name);
    const stop = routeStops.find((candidate) => stopMatchesInvoice(candidate, invoice));
    const matchedRoute = stop
      ? routes.find((route) => (route.stop_ids || []).includes(stop.id)) || null
      : (invoice.route_id ? routeMap.get(invoice.route_id) || null : null);
    const matchesRoute = invoice.route_id && routeIds.has(invoice.route_id);
    const matchesDriver = invoiceDriverName && invoiceDriverName === normalize(user.name);

    if (!stop && !matchesRoute && !matchesDriver) continue;

    assignedInvoiceIds.add(invoice.id);
    assignedInvoices.push(attachRouteContext(invoice, matchedRoute, stop));
  }

  return {
    routes,
    stops: routeStops,
    invoices: assignedInvoices,
    assignedInvoiceIds,
  };
}

async function isInvoiceAssignedToDriver(supabase, user, context, invoiceId) {
  const scope = await loadDriverInvoiceScope(supabase, user, context);
  return scope.assignedInvoiceIds.has(invoiceId);
}

module.exports = {
  isRouteAssignedToUser,
  isInvoiceAssignedToDriver,
  loadDriverInvoiceScope,
  normalize,
  stopMatchesInvoice,
};
