import type { Driver } from '../hooks/useRoutes';

/**
 * Identity key for a stop/customer/order location, used to dedupe stops that
 * resolve to the same place. Shared by the routes page (stop options, batch
 * filtering) and the Add-Stops modal.
 */
export function normalizedLocationKey(name: string | undefined, address: string | undefined) {
  return `${String(name || '').trim().toLowerCase()}|${String(address || '').trim().toLowerCase()}`;
}

export function normalizeDriverKey(value: string | undefined) {
  return String(value || '').trim().toLowerCase();
}

export function driverDisplayName(driver: Driver | undefined) {
  return String(driver?.name || driver?.email || '').trim();
}

/**
 * Reconcile a free-text driver entry against the saved driver users. Returns
 * the canonical name + linked user id when the input unambiguously maps to a
 * driver (or an empty assignment when blank), or null when it cannot be linked.
 * Shared by the create form, the edit panel, and the AI-assignment apply path.
 */
export function resolveDriverSelection(drivers: Driver[], driverInput: string, selectedDriverId: string) {
  const trimmedInput = String(driverInput || '').trim();
  if (!trimmedInput) {
    return { driverName: '', driverId: undefined as string | undefined };
  }

  const normalizedInput = normalizeDriverKey(trimmedInput);
  const selectedDriver = drivers.find((driver) => String(driver.id) === String(selectedDriverId || ''));
  if (
    selectedDriver &&
    (
      normalizeDriverKey(selectedDriver.name) === normalizedInput
      || normalizeDriverKey(selectedDriver.email) === normalizedInput
    )
  ) {
    return {
      driverName: driverDisplayName(selectedDriver) || trimmedInput,
      driverId: selectedDriver.id,
    };
  }

  const exactMatches = drivers.filter((driver) =>
    normalizeDriverKey(driver.name) === normalizedInput
    || normalizeDriverKey(driver.email) === normalizedInput,
  );
  if (exactMatches.length === 1) {
    return {
      driverName: driverDisplayName(exactMatches[0]) || trimmedInput,
      driverId: exactMatches[0].id,
    };
  }

  return null;
}
