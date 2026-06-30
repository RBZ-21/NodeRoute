CREATE INDEX IF NOT EXISTS idx_driver_locations_updated_at
  ON driver_locations(updated_at DESC);
