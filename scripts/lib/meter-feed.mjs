/** Closed public DTO. No account identifiers, arbitrary strings or quota totals. */
import { validate } from './validate.mjs';
export const METER_ALIASES = Object.freeze(['CLAUDE1', 'CLAUDE2', 'CLAUDE3', 'CLAUDE4', 'CPT1', 'CPT2', 'GEMINI1']);
export const METER_STALE_MS = 720_000;
export const PROCESSOR_STALE_MS = 1_200_000;
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const METER_FEED_SCHEMA = freeze({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "meter-feed.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "version",
    "published_at",
    "lanes"
  ],
  "properties": {
    "version": {
      "const": 2
    },
    "published_at": {
      "type": [
        "string",
        "null"
      ],
      "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
    },
    "processor": {
      "$ref": "#/$defs/Processor"
    },
    "lanes": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "CLAUDE1",
        "CLAUDE2",
        "CLAUDE3",
        "CLAUDE4",
        "CPT1",
        "CPT2",
        "GEMINI1"
      ],
      "properties": {
        "CLAUDE1": {
          "$ref": "#/$defs/Lane"
        },
        "CLAUDE2": {
          "$ref": "#/$defs/Lane"
        },
        "CLAUDE3": {
          "$ref": "#/$defs/Lane"
        },
        "CLAUDE4": {
          "$ref": "#/$defs/Lane"
        },
        "CPT1": {
          "$ref": "#/$defs/Lane"
        },
        "CPT2": {
          "$ref": "#/$defs/Lane"
        },
        "GEMINI1": {
          "$ref": "#/$defs/Lane"
        }
      }
    }
  },
  "$defs": {
    "Processor": {
      "type": "object",
      "additionalProperties": false,
      "required": ["host_alias", "host_kind", "observed_at", "published_at", "freshness",
        "capacity_cores", "cpu_busy_percent", "busy_sample_seconds", "load_1m_per_capacity",
        "queue_pressure", "overload", "memory_pressure", "measurement_mode", "status_reason"],
      "properties": {
        "host_alias": { "enum": ["LOCAL_HOST", "CLOUD_HOST", "UNKNOWN"] },
        "host_kind": { "enum": ["LOCAL", "CLOUD", "UNKNOWN"] },
        "observed_at": { "type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" },
        "published_at": { "type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" },
        "freshness": { "enum": ["CURRENT", "VEROUDERD", "UNKNOWN"] },
        "capacity_cores": { "type": ["integer", "null"], "minimum": 1 },
        "cpu_busy_percent": { "type": ["number", "null"], "minimum": 0 },
        "busy_sample_seconds": { "type": ["integer", "null"], "minimum": 1 },
        "load_1m_per_capacity": { "type": ["number", "null"], "minimum": 0 },
        "queue_pressure": { "enum": ["NORMAL", "ELEVATED", "SATURATED", "UNKNOWN"] },
        "overload": { "enum": ["NORMAL", "HIGH", "OVERLOADED", "UNKNOWN"] },
        "memory_pressure": { "enum": ["NORMAL", "WARN", "CRITICAL", "UNKNOWN"] },
        "measurement_mode": { "enum": ["SCHEDULED", "ON_DEMAND", "UNKNOWN"] },
        "status_reason": { "enum": ["NONE", "STALE", "UNSUPPORTED", "SOURCE_ERROR", "INVALID_TIME", "INVALID_FEED", "INSUFFICIENT_SAMPLES", "QUEUE_OR_IO_PRESSURE"] }
      }
    },
    "Lane": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "identity_binding_status",
        "source_kind",
        "quality",
        "reason",
        "limitation",
        "last_success_at",
        "attempted_at",
        "windows"
      ],
      "properties": {
        "identity_binding_status": {
          "enum": [
            "PROVEN",
            "UNKNOWN",
            "MISMATCH"
          ]
        },
        "source_kind": {
          "enum": [
            "CLAUDE_SUBSCRIPTION",
            "CODEX_SUBSCRIPTION",
            "GEMINI_API_KEY",
            "GEMINI_CODE_ASSIST",
            "GEMINI_VERTEX",
            "UNKNOWN"
          ]
        },
        "quality": {
          "enum": [
            "VERIFIED",
            "UNKNOWN",
            "ERROR"
          ]
        },
        "reason": {
          "enum": [
            "NONE",
            "NO_SOURCE",
            "BINDING_UNPROVEN",
            "BINDING_MISMATCH",
            "SOURCE_ERROR",
            "STALE",
            "INVALID_FEED",
            "SHARED_POT_CONFLICT",
            "INVALID_TIME"
          ]
        },
        "limitation": {
          "enum": [
            "NONE",
            "SOURCE_LIMITED",
            "BINDING_UNPROVEN",
            "UNKNOWN"
          ]
        },
        "last_success_at": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
        },
        "attempted_at": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
        },
        "windows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Window"
          }
        }
      }
    },
    "Window": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "model_alias",
        "window_alias",
        "quota_group",
        "remaining_percent",
        "reset_at",
        "resets_remaining",
        "subscription_renewal_at",
        "credit_expires_at"
      ],
      "properties": {
        "model_alias": {
          "enum": [
            "UNKNOWN",
            "CLAUDE_ALL",
            "FABLE",
            "SONNET",
            "OPUS",
            "HAIKU",
            "CODEX_ALL",
            "CODEX_SPARK",
            "GEMINI_ALL",
            "GEMINI_PRO",
            "GEMINI_FLASH",
            "GEMINI_FLASH_LITE"
          ]
        },
        "window_alias": {
          "enum": [
            "UNKNOWN",
            "FIVE_HOUR",
            "DAILY",
            "WEEKLY",
            "MONTHLY"
          ]
        },
        "quota_group": {
          "enum": [
            "UNKNOWN",
            "LANE_LOCAL",
            "SHARED_1",
            "SHARED_2",
            "SHARED_3",
            "SHARED_4",
            "SHARED_5",
            "SHARED_6",
            "SHARED_7"
          ]
        },
        "remaining_percent": {
          "enum": [
            null,
            0,
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8,
            9,
            10,
            11,
            12,
            13,
            14,
            15,
            16,
            17,
            18,
            19,
            20,
            21,
            22,
            23,
            24,
            25,
            26,
            27,
            28,
            29,
            30,
            31,
            32,
            33,
            34,
            35,
            36,
            37,
            38,
            39,
            40,
            41,
            42,
            43,
            44,
            45,
            46,
            47,
            48,
            49,
            50,
            51,
            52,
            53,
            54,
            55,
            56,
            57,
            58,
            59,
            60,
            61,
            62,
            63,
            64,
            65,
            66,
            67,
            68,
            69,
            70,
            71,
            72,
            73,
            74,
            75,
            76,
            77,
            78,
            79,
            80,
            81,
            82,
            83,
            84,
            85,
            86,
            87,
            88,
            89,
            90,
            91,
            92,
            93,
            94,
            95,
            96,
            97,
            98,
            99,
            100
          ]
        },
        "reset_at": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
        },
        "resets_remaining": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "subscription_renewal_at": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
        },
        "credit_expires_at": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
        }
      }
    }
  }
});

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}
export function meterMeasurementIsStale(lastSuccessAt, nowMs) {
  const measured = timestamp(lastSuccessAt);
  return measured !== null && Number.isFinite(nowMs) && nowMs - measured >= METER_STALE_MS;
}
const unknown = alias => ({ alias, identity_binding_status: 'UNKNOWN', source_kind: 'UNKNOWN',
  quality: 'UNKNOWN', reason: 'INVALID_FEED', limitation: 'UNKNOWN', freshness: 'ONBEKEND',
  last_success_at: null, attempted_at: null, windows: [] });
const dates = ['reset_at', 'subscription_renewal_at', 'credit_expires_at'];
const unknownProcessor = () => ({ host_alias: 'UNKNOWN', host_kind: 'UNKNOWN', observed_at: null,
  published_at: null, freshness: 'UNKNOWN', capacity_cores: null, cpu_busy_percent: null,
  busy_sample_seconds: null, load_1m_per_capacity: null, queue_pressure: 'UNKNOWN',
  overload: 'UNKNOWN', memory_pressure: 'UNKNOWN', measurement_mode: 'UNKNOWN',
  status_reason: 'INVALID_FEED' });

function parseProcessor(raw, nowMs, fallback) {
  if (raw === undefined) return unknownProcessor();
  const observed = timestamp(raw.observed_at); const published = timestamp(raw.published_at);
  const identityOk = raw.host_alias !== 'UNKNOWN' && raw.host_kind !== 'UNKNOWN';
  const valuesOk = raw.capacity_cores !== null && raw.cpu_busy_percent !== null
    && raw.busy_sample_seconds !== null && raw.load_1m_per_capacity !== null
    && [raw.capacity_cores, raw.cpu_busy_percent, raw.busy_sample_seconds, raw.load_1m_per_capacity].every(Number.isFinite)
    && raw.capacity_cores <= 4096 && raw.cpu_busy_percent <= 100
    && raw.busy_sample_seconds <= 300 && raw.load_1m_per_capacity <= 1000;
  const measurementOk = raw.measurement_mode !== 'UNKNOWN';
  const inputCurrent = raw.freshness === 'CURRENT' && ['NONE', 'QUEUE_OR_IO_PRESSURE'].includes(raw.status_reason);
  const inputHistorical = raw.freshness === 'VEROUDERD' && raw.status_reason === 'STALE';
  if (!identityOk || !valuesOk || !measurementOk || observed === null || published === null
      || observed > published || published > nowMs || (!inputCurrent && !inputHistorical)) return unknownProcessor();
  const stale = inputHistorical || fallback || nowMs - observed > PROCESSOR_STALE_MS;
  return { ...raw, freshness: stale ? 'VEROUDERD' : 'CURRENT',
    overload: stale ? 'UNKNOWN' : raw.overload, status_reason: stale ? 'STALE' : raw.status_reason };
}

/** Publication never renews source evidence. B0 has no authenticated Gemini binding proof. */
export function parseMeterFeed(raw, { now = new Date(), fallback = false } = {}) {
  const empty = { available: false, published_at: null, processor: unknownProcessor(), lanes: METER_ALIASES.map(unknown) };
  try {
    if (new TextEncoder().encode(JSON.stringify(raw)).length > 32768 || validate(METER_FEED_SCHEMA, raw).length) return empty;
    const nowMs = now instanceof Date ? now.getTime() : NaN;
    if (!Number.isFinite(nowMs)) return empty;
    const allDates = [raw.published_at];
    for (const lane of Object.values(raw.lanes)) {
      allDates.push(lane.last_success_at, lane.attempted_at);
      if (lane.windows.length > 32) return empty;
      const seen = new Set();
      for (const w of lane.windows) {
        const key = `${w.model_alias}/${w.window_alias}`;
        if (seen.has(key)) return empty;
        seen.add(key); allDates.push(...dates.map(k => w[k]));
      }
    }
    if (allDates.some(v => v !== null && timestamp(v) === null)) return empty;
    if (raw.published_at !== null && timestamp(raw.published_at) > nowMs) return empty;
    // One shared pot/window must describe one observation, including its source age.
    // Compare before suppressing stale/error data so no conflicting participant is promoted.
    const pots = new Map(); const conflicts = new Set();
    for (const [alias, lane] of Object.entries(raw.lanes)) {
      for (const w of lane.windows) {
        if (!w.quota_group.startsWith('SHARED_')) continue;
        const key = `${w.quota_group}/${w.model_alias}/${w.window_alias}`;
        const signature = JSON.stringify([lane.source_kind, lane.last_success_at, lane.quality,
          lane.identity_binding_status, lane.reason, lane.limitation, w.remaining_percent,
          w.resets_remaining, ...dates.map(k => w[k])]);
        const entries = pots.get(key) ?? [];
        entries.push({ alias, signature }); pots.set(key, entries);
      }
    }
    for (const entries of pots.values()) {
      if (new Set(entries.map(e => e.signature)).size > 1) entries.forEach(e => conflicts.add(e.alias));
    }
    return { available: true, published_at: raw.published_at, processor: parseProcessor(raw.processor, nowMs, fallback),
      lanes: METER_ALIASES.map(alias => {
        const lane = raw.lanes[alias];
        const sourceOk = alias.startsWith('CLAUDE') ? lane.source_kind === 'CLAUDE_SUBSCRIPTION'
          : alias.startsWith('CPT') ? lane.source_kind === 'CODEX_SUBSCRIPTION'
            : ['GEMINI_API_KEY', 'GEMINI_CODE_ASSIST', 'GEMINI_VERTEX'].includes(lane.source_kind);
        const modelOk = lane.windows.every(w => alias.startsWith('CLAUDE')
          ? ['CLAUDE_ALL', 'FABLE', 'SONNET', 'OPUS', 'HAIKU'].includes(w.model_alias)
          : alias.startsWith('CPT') ? ['CODEX_ALL', 'CODEX_SPARK'].includes(w.model_alias)
            : ['GEMINI_ALL', 'GEMINI_PRO', 'GEMINI_FLASH', 'GEMINI_FLASH_LITE'].includes(w.model_alias));
        const measured = timestamp(lane.last_success_at); const attempted = timestamp(lane.attempted_at);
        const timeOk = measured !== null && attempted !== null && measured <= attempted && attempted <= nowMs;
        // A sanitized publisher roundtrip represents an earlier verified observation as
        // quality=UNKNOWN + reason=STALE. Accept exactly that closed historical form so another
        // build cannot erase it. UNKNOWN without explicit STALE proof remains unknown.
        const priorStaleProof = lane.reason === 'STALE'
          && ['VERIFIED', 'UNKNOWN'].includes(lane.quality)
          && sourceOk && lane.identity_binding_status === 'PROVEN'
          && ['NONE', 'SOURCE_LIMITED'].includes(lane.limitation) && timeOk;
        const freshProof = lane.reason === 'NONE' && lane.quality === 'VERIFIED'
          && sourceOk && lane.identity_binding_status === 'PROVEN'
          && lane.limitation === 'NONE' && timeOk;
        let reason = lane.reason;
        if (conflicts.has(alias)) reason = 'SHARED_POT_CONFLICT';
        else if ((!sourceOk && lane.source_kind !== 'UNKNOWN') || !modelOk || lane.identity_binding_status === 'MISMATCH') reason = 'BINDING_MISMATCH';
        else if (alias === 'GEMINI1') reason = 'BINDING_UNPROVEN';
        else if (reason === 'STALE' && !priorStaleProof) {
          if (!sourceOk || lane.identity_binding_status !== 'PROVEN') reason = 'BINDING_UNPROVEN';
          else if (!timeOk) reason = 'INVALID_TIME';
          else reason = 'SOURCE_ERROR';
        }
        else if (reason === 'NONE') {
          if (!sourceOk || lane.identity_binding_status !== 'PROVEN') reason = 'BINDING_UNPROVEN';
          else if (lane.quality !== 'VERIFIED' || lane.limitation !== 'NONE') reason = 'SOURCE_ERROR';
          else if (!timeOk) reason = 'INVALID_TIME';
          else if (fallback || meterMeasurementIsStale(lane.last_success_at, nowMs)) reason = 'STALE';
        }
        const current = reason === 'NONE' && lane.quality === 'VERIFIED';
        // A stale value is still a proven historical observation when the only
        // failed gate is its age. Keep that observation available to the view,
        // while countdowns and every genuinely unknown/error state stay closed.
        const historical = reason === 'STALE' && (priorStaleProof || freshProof);
        const validTime = measured !== null && measured <= nowMs;
        return { alias, identity_binding_status: reason === 'BINDING_MISMATCH' ? 'MISMATCH'
            : alias === 'GEMINI1' ? 'UNKNOWN' : lane.identity_binding_status,
          source_kind: lane.source_kind, quality: current ? 'VERIFIED' : 'UNKNOWN', reason,
          limitation: alias === 'GEMINI1' ? 'BINDING_UNPROVEN' : lane.limitation,
          freshness: current ? 'CURRENT' : reason === 'STALE' ? 'VEROUDERD' : 'ONBEKEND',
          last_success_at: validTime ? lane.last_success_at : null,
          attempted_at: attempted !== null && attempted <= nowMs ? lane.attempted_at : null,
          windows: lane.windows.map(w => {
            const identified = w.window_alias !== 'UNKNOWN' && w.quota_group !== 'UNKNOWN';
            const known = current && identified && (w.reset_at === null || timestamp(w.reset_at) > nowMs);
            const result = { model_alias: w.model_alias, window_alias: w.window_alias, quota_group: w.quota_group,
              remaining_percent: known || (historical && identified) ? w.remaining_percent : null,
              resets_remaining: known || (historical && identified) ? w.resets_remaining : null };
            for (const key of dates) result[key] = historical && identified
              ? w[key]
              : known && timestamp(w[key]) > nowMs ? w[key] : null;
            result.countdown_seconds = current && result.reset_at !== null
              ? Math.ceil((timestamp(result.reset_at) - nowMs) / 1000)
              : null;
            return result;
          }) };
      }) };
  } catch { return empty; }
}
