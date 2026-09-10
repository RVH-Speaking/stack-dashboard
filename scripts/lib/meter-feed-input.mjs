import { parseMeterFeed } from './meter-feed.mjs';
export const METER_MAX_BYTES = 32_768;
/** Browser-safe input; no cache, filesystem, provider error or source path in output. */
export function meterFeedFromText(text, options = {}) {
  try {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > METER_MAX_BYTES) return parseMeterFeed(null, options);
    return parseMeterFeed(JSON.parse(text), options);
  } catch { return parseMeterFeed(null, options); }
}
