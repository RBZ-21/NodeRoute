/**
 * Identity key for a stop/customer/order location, used to dedupe stops that
 * resolve to the same place. Shared by the routes page (stop options, batch
 * filtering) and the Add-Stops modal.
 */
export function normalizedLocationKey(name: string | undefined, address: string | undefined) {
  return `${String(name || '').trim().toLowerCase()}|${String(address || '').trim().toLowerCase()}`;
}
