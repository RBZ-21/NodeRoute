// Only re-export types that have no naming conflicts.
// driver.types, orders.types, and portal.types still live in src/pages/
// and should be imported directly from there until those pages are migrated.
export * from './inventory.types';
