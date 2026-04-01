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
 * Utility for tests:
 * Find the first matching variable name from a list, or null.
 */
export function findMatchingVariableName(variableNames, key) {
  for (const name of variableNames ?? []) {
    if (isVariableNameMatch(name, key)) return name;
  }
  return null;
}
