import { systemConfig } from '../db/db';

/**
 * Canonical reader for runtime-mutable admin configuration.
 *
 * Reads a positive-integer value from the `system_config_current` view.
 * Consumers use this for admin-configurable thresholds. Falls back when
 * the key is missing or the stored value does not parse to a finite
 * positive integer. Never queries the raw `system_config` table.
 */
export function readIntConfig(key: string, fallback: number): number {
  const row = systemConfig.getValueByKey.get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  const parsed = parseInt(row.value_json, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
