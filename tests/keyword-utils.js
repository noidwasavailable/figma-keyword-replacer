/**
 * Pure helpers for parsing @placeholders and matching variable names.
 * This module is intentionally Figma-independent so it can be unit-tested.
 */

/**
 * Matches inline placeholders such as:
 * - "@icon/defense"
 * - "@keyword1@keyword2"
 * - "@keyword1:@keyword2"
 * - "When I draw:@keyword1"
 *
 * Rules:
 * - starts with "@"
 * - allows simple keys (e.g. "@keyword1")
 * - also allows slash-segment keys (e.g. "@icon/defense")
 */
export const PLACEHOLDER_REGEX = /@[\w-]+(?:\/[\w-]+)*\b/g;
export const BACKUP_SCHEMA_VERSION = 2;

/**
 * Normalize a placeholder or variable name for exact comparison.
 * - trims whitespace
 * - lowercases
 * - removes a single leading "@", if present
 */
export function normalizeVariableName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

/**
 * Returns true when the names represent the same keyword.
 * Comparison is strict after normalization (no fuzzy/partial matching).
 */
export function isVariableNameMatch(variableName, key) {
  return normalizeVariableName(variableName) === normalizeVariableName(key);
}

/**
 * Extract placeholders from text.
 *
 * Returns an array of:
 * - key: placeholder without "@", used for variable lookup
 * - start: start index in original string
 * - len: placeholder length
 * - text: original placeholder token, including "@"
 */
export function extractPlaceholders(text) {
  const input = String(text ?? "");
  const out = [];
  let match;

  PLACEHOLDER_REGEX.lastIndex = 0;
  while ((match = PLACEHOLDER_REGEX.exec(input)) !== null) {
    const token = match[0];
    out.push({
      key: token.slice(1),
      start: match.index,
      len: token.length,
      text: token,
    });
  }

  return out;
}

/**
 * Resolve placeholders in a string using a resolver function or lookup object.
 *
 * - `resolveValue` can be:
 *   - function: (key, match) => value | null | undefined
 *   - object map: { [key]: value }
 *
 * Replacements are applied right-to-left so adjacent tokens like
 * "@keyword1@keyword2" are handled safely.
 */
export function resolvePlaceholdersInText(text, resolveValue) {
  const input = String(text ?? "");
  const matches = extractPlaceholders(input);
  if (matches.length === 0) {
    return { changed: false, text: input, replacements: [] };
  }

  const resolver =
    typeof resolveValue === "function"
      ? resolveValue
      : (key) => {
          if (
            resolveValue &&
            Object.prototype.hasOwnProperty.call(resolveValue, key)
          ) {
            return resolveValue[key];
          }
          return null;
        };

  let out = input;
  let changed = false;
  const replacements = [];

  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const resolved = resolver(match.key, match);

    if (resolved === null || resolved === undefined) continue;

    const value = String(resolved);
    out =
      out.slice(0, match.start) + value + out.slice(match.start + match.len);
    changed = true;

    replacements.unshift({
      key: match.key,
      start: match.start,
      len: match.len,
      text: match.text,
      value,
    });
  }

  return { changed, text: out, replacements };
}

/**
 * Validate whether a stored backup can be safely restored against current text.
 * Mirrors the plugin-side safety checks in a pure, testable form.
 */
export function isBackupApplicable(currentText, backup) {
  const text = String(currentText ?? "");
  if (
    !backup ||
    !Array.isArray(backup.replacements) ||
    backup.replacements.length === 0
  ) {
    return false;
  }

  if (
    backup.schemaVersion === BACKUP_SCHEMA_VERSION &&
    backup.replacedTextHash &&
    backup.replacedTextHash !== hashStringFNV1a(text)
  ) {
    return false;
  }

  const snapshot = backup.snapshot || {};

  for (const rep of backup.replacements) {
    if (!rep || typeof rep.start !== "number" || typeof rep.len !== "number") {
      return false;
    }

    if (rep.start < 0 || rep.len < 0 || rep.start + rep.len > text.length) {
      return false;
    }

    const originalText = String(rep.originalText || "");
    if (!originalText.startsWith("@")) {
      return false;
    }

    const key = originalText.slice(1);
    const expectedValue =
      typeof rep.valueAtSave === "string" ? rep.valueAtSave : snapshot[key];

    if (typeof expectedValue !== "string") {
      return false;
    }

    const actualValue = text.slice(rep.start, rep.start + rep.len);
    if (actualValue !== expectedValue) {
      return false;
    }
  }

  return true;
}

/**
 * Explicit helper for tests that assert stale backups are rejected.
 */
export function shouldRejectStaleBackup(currentText, backup) {
  return !isBackupApplicable(currentText, backup);
}

/**
 * Stable string hash (FNV-1a) used by v2 backups.
 */
export function hashStringFNV1a(value) {
  let h = 0x811c9dc5;
  const input = String(value ?? "");

  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }

  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic icon-mapping hash from { key, value, variableId } entries.
 */
export function computeIconMappingHashFromEntries(entries) {
  const normalized = (entries || [])
    .filter(Boolean)
    .map((entry) => {
      const key = normalizeVariableName(entry.key);
      const value = String(entry.value ?? "");
      const variableId = String(entry.variableId ?? "");
      return `${key}|${value}|${variableId}`;
    })
    .sort();

  return hashStringFNV1a(normalized.join("||"));
}

/**
 * One-way migration helper for legacy backup payloads used by tests.
 * Converts v1-style replacements/snapshot into v2-compatible fields.
 */
export function migrateBackupPayloadForTests(currentText, backup) {
  const text = String(currentText ?? "");
  if (!backup || typeof backup !== "object") return null;
  if (backup.schemaVersion === BACKUP_SCHEMA_VERSION) return backup;

  const replacements = Array.isArray(backup.replacements)
    ? backup.replacements
    : [];
  if (replacements.length === 0) return backup;

  const snapshot = backup.snapshot || {};
  const migratedReplacements = replacements.map((rep) => {
    const originalText = String(rep.originalText || "");
    const tokenKey = normalizeVariableName(
      originalText.startsWith("@") ? originalText.slice(1) : rep.tokenKey,
    );
    const valueAtSave =
      typeof snapshot[tokenKey] === "string" ? snapshot[tokenKey] : "";

    return {
      ...rep,
      tokenKey,
      valueAtSave,
      variableId: rep.variableId || "",
    };
  });

  const iconEntries = migratedReplacements
    .filter((rep) => normalizeVariableName(rep.tokenKey).startsWith("icon/"))
    .map((rep) => ({
      key: rep.tokenKey,
      value: rep.valueAtSave,
      variableId: rep.variableId || "",
    }));

  return {
    ...backup,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    replacements: migratedReplacements,
    mappingHash:
      backup.mappingHash || computeIconMappingHashFromEntries(iconEntries),
    replacedTextHash: backup.replacedTextHash || hashStringFNV1a(text),
  };
}

/**
 * Pure restore simulation used by tests.
 * Mirrors the plugin's right-to-left restore behavior while remaining Figma-independent.
 *
 * Returns:
 * - { restored: false, text: currentText } when backup is stale/invalid
 * - { restored: true, text: restoredText } when restore can be safely applied
 */
export function restoreFromBackupSimulation(currentText, backup) {
  const text = String(currentText ?? "");
  const migrated = migrateBackupPayloadForTests(text, backup);

  if (!isBackupApplicable(text, migrated)) {
    return { restored: false, text };
  }

  const reps = [...migrated.replacements].sort((a, b) => b.start - a.start);
  let out = text;

  for (const rep of reps) {
    const before = out.slice(0, rep.start);
    const after = out.slice(rep.start + rep.len);
    out = before + rep.originalText + after;
  }

  return { restored: true, text: out };
}

/**
 * Stale-recovery helper:
 * strip trailing punctuation from a value candidate.
 */
export function stripTrailingPunctuationForTests(value) {
  return String(value ?? "").replace(/[.,:;!?]+$/g, "");
}

/**
 * Stale-recovery helper:
 * find the best candidate occurrence near an anchor index.
 */
export function findBestRecoveryCandidateForTests(
  text,
  candidates,
  anchor,
  windowSize = 24,
) {
  const source = String(text ?? "");
  const anchorIdx = typeof anchor === "number" ? anchor : 0;
  const win = typeof windowSize === "number" ? windowSize : 24;

  let best = null;

  for (const raw of candidates ?? []) {
    const rawNeedle = String(raw ?? "");
    if (!rawNeedle) continue;

    const variants = [];
    const seen = new Set();

    const addVariant = (v) => {
      const s = String(v ?? "");
      if (!s || seen.has(s)) return;
      seen.add(s);
      variants.push(s);
    };

    addVariant(rawNeedle);
    addVariant(stripTrailingPunctuationForTests(rawNeedle));

    for (const needle of variants) {
      if (
        anchorIdx >= 0 &&
        anchorIdx + needle.length <= source.length &&
        source.slice(anchorIdx, anchorIdx + needle.length) === needle
      ) {
        return { start: anchorIdx, len: needle.length, value: needle };
      }

      let idx = source.indexOf(needle);
      while (idx !== -1) {
        const distance = Math.abs(idx - anchorIdx);
        if (distance <= win) {
          if (
            !best ||
            distance < best.distance ||
            (distance === best.distance && needle.length > best.len)
          ) {
            best = {
              start: idx,
              len: needle.length,
              value: needle,
              distance,
            };
          }
        }
        idx = source.indexOf(needle, idx + 1);
      }
    }
  }

  if (!best) return null;
  return { start: best.start, len: best.len, value: best.value };
}

/**
 * Normalize font tokens for tolerant family/style comparisons.
 */
export function normalizeFontTokenForTests(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Font-match simulation with optional family-only fallback.
 */
export function isFontMatchForTests(font, family, style, allowFamilyFallback = true) {
  if (!font || typeof font !== "object") return false;
  if (!family) return false;

  const fontFamily = normalizeFontTokenForTests(font.family);
  const targetFamily = normalizeFontTokenForTests(family);
  if (!fontFamily || !targetFamily || fontFamily !== targetFamily) return false;

  const hasTargetStyle = Boolean(String(style ?? "").trim());
  if (!hasTargetStyle) return true;

  const fontStyle = normalizeFontTokenForTests(font.style);
  const targetStyle = normalizeFontTokenForTests(style);
  if (fontStyle === targetStyle) return true;

  return !!allowFamilyFallback;
}

/**
 * Build glyph -> token map for fallback recovery.
 * Collisions are treated as aliases and collapse to deterministic canonical key.
 */
export function buildIconGlyphToTokenAliasMapForTests(entries) {
  const map = {};

  for (const entry of entries ?? []) {
    const tokenKey = normalizeVariableName(entry?.tokenKey ?? entry?.key);
    const glyph = String(entry?.glyph ?? entry?.value ?? "");
    if (!tokenKey.startsWith("icon/") || !glyph) continue;

    if (!Object.prototype.hasOwnProperty.call(map, glyph)) {
      map[glyph] = tokenKey;
      continue;
    }

    if (map[glyph] !== tokenKey) {
      map[glyph] = map[glyph] < tokenKey ? map[glyph] : tokenKey;
    }
  }

  return map;
}

/**
 * Pure icon-font fallback scan simulation:
 * scans only segments matching icon font and converts mapped glyphs to placeholders.
 *
 * `segments` shape:
 * - [{ start, end, fontName: { family, style } }, ...]
 */
export function simulateFallbackIconFontGlyphRecoveryForTests({
  text,
  segments,
  iconFontFamily,
  iconFontStyle,
  glyphToToken,
}) {
  const source = String(text ?? "");
  const map = glyphToToken || {};
  const usableGlyphs = Object.keys(map).filter((glyph) => Boolean(map[glyph]));
  if (!iconFontFamily || usableGlyphs.length === 0) {
    return { changed: false, text: source, replacements: [] };
  }

  usableGlyphs.sort((a, b) => b.length - a.length);

  const ops = [];

  for (const seg of segments ?? []) {
    if (!isFontMatchForTests(seg?.fontName, iconFontFamily, iconFontStyle, true)) {
      continue;
    }

    const segStart = Math.max(0, Number(seg?.start ?? 0));
    const segEnd = Math.min(source.length, Number(seg?.end ?? segStart));
    if (segEnd <= segStart) continue;

    let idx = segStart;
    while (idx < segEnd) {
      let matched = false;

      for (const glyph of usableGlyphs) {
        if (idx + glyph.length > segEnd) continue;
        if (source.slice(idx, idx + glyph.length) !== glyph) continue;

        ops.push({
          start: idx,
          len: glyph.length,
          placeholder: "@" + map[glyph],
          glyph,
        });

        idx += glyph.length;
        matched = true;
        break;
      }

      if (!matched) idx++;
    }
  }

  if (ops.length === 0) {
    return { changed: false, text: source, replacements: [] };
  }

  const sorted = [...ops].sort((a, b) => b.start - a.start);
  let out = source;

  for (const op of sorted) {
    out =
      out.slice(0, op.start) +
      op.placeholder +
      out.slice(op.start + op.len);
  }

  return { changed: true, text: out, replacements: sorted.reverse() };
}

/**
 * Utility for tests:
 * Find the first matching variable name from a list, or null.
 */
export function findMatchingVariableName(variableNames, key) {
  for (const name of variableNames ?? []) {
    if (isVariableNameMatch(name, key)) return name;
  }
  return null;
}
