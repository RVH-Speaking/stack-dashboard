/** Closed public DTO. No account identifiers, arbitrary strings or quota totals. */
import { validate } from './validate.mjs';
export const METER_ALIASES = Object.freeze(['CLAUDE1', 'CLAUDE2', 'CLAUDE3', 'CLAUDE4', 'CPT1', 'CPT2', 'GEMINI1']);
export const METER_STALE_MS = 300_000;
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
        "subscription_renewal_at",
        "credit_expires_at"
      ],
      "properties": {
        "model_alias": {
          "enum": [
            "UNKNOWN",
            "CLAUDE_ALL",
            "SONNET",
            "OPUS",
            "HAIKU",
            "CODEX_ALL",
            "GEMINI_ALL"
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
const unknown = alias => ({ alias, identity_binding_status: 'UNKNOWN', source_kind: 'UNKNOWN',
  quality: 'UNKNOWN', reason: 'INVALID_FEED', limitation: 'UNKNOWN', freshness: 'ONBEKEND',
  last_success_at: null, attempted_at: null, windows: [] });
const dates = ['reset_at', 'subscription_renewal_at', 'credit_expires_at'];

/** Publication never renews source evidence. B0 has no authenticated Gemini binding proof. */
export function parseMeterFeed(raw, { now = new Date(), fallback = false } = {}) {
  const empty = { available: false, published_at: null, lanes: METER_ALIASES.map(unknown) };
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
        const key = `${w.quota_group}/${w.window_alias}`;
        const signature = JSON.stringify([lane.source_kind, lane.last_success_at, lane.quality,
          lane.identity_binding_status, lane.reason, lane.limitation, w.remaining_percent, ...dates.map(k => w[k])]);
        const entries = pots.get(key) ?? [];
        entries.push({ alias, signature }); pots.set(key, entries);
      }
    }
    for (const entries of pots.values()) {
      if (new Set(entries.map(e => e.signature)).size > 1) entries.forEach(e => conflicts.add(e.alias));
    }
    return { available: true, published_at: raw.published_at,
      lanes: METER_ALIASES.map(alias => {
        const lane = raw.lanes[alias];
        const sourceOk = alias.startsWith('CLAUDE') ? lane.source_kind === 'CLAUDE_SUBSCRIPTION'
          : alias.startsWith('CPT') ? lane.source_kind === 'CODEX_SUBSCRIPTION'
            : ['GEMINI_API_KEY', 'GEMINI_CODE_ASSIST', 'GEMINI_VERTEX'].includes(lane.source_kind);
        const modelOk = lane.windows.every(w => alias.startsWith('CLAUDE')
          ? ['CLAUDE_ALL', 'SONNET', 'OPUS', 'HAIKU'].includes(w.model_alias)
          : w.model_alias === (alias.startsWith('CPT') ? 'CODEX_ALL' : 'GEMINI_ALL'));
        const measured = timestamp(lane.last_success_at); const attempted = timestamp(lane.attempted_at);
        let reason = lane.reason;
        if (conflicts.has(alias)) reason = 'SHARED_POT_CONFLICT';
        else if ((!sourceOk && lane.source_kind !== 'UNKNOWN') || !modelOk || lane.identity_binding_status === 'MISMATCH') reason = 'BINDING_MISMATCH';
        else if (alias === 'GEMINI1') reason = 'BINDING_UNPROVEN';
        else if (reason === 'NONE') {
          if (!sourceOk || lane.identity_binding_status !== 'PROVEN') reason = 'BINDING_UNPROVEN';
          else if (lane.quality !== 'VERIFIED' || lane.limitation !== 'NONE') reason = 'SOURCE_ERROR';
          else if (measured === null || attempted === null || measured > attempted || attempted > nowMs) reason = 'INVALID_TIME';
          else if (fallback || nowMs - measured > METER_STALE_MS) reason = 'STALE';
        }
        const current = reason === 'NONE' && lane.quality === 'VERIFIED';
        // A stale value is still a proven historical observation when the only
        // failed gate is its age. Keep that observation available to the view,
        // while countdowns and every genuinely unknown/error state stay closed.
        const historical = reason === 'STALE' && lane.quality === 'VERIFIED';
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
              remaining_percent: known || (historical && identified) ? w.remaining_percent : null };
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
