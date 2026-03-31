/**
 * Pure helpers for parsing @placeholders and matching variable names.
 * This module is intentionally Figma-independent so it can be unit-tested.
 */

/**
 * Matches inline placeholders such as:
 * - "@icon/defense"
 * - "1@icon/defense"
 * - "HP:@icon/defense"
 *
 * Requires:
 * - starts with "@"
 * - at least one "/" segment after the first token
 */
export const PLACEHOLDER_REGEX = /@[\w-]+(?:\/[\w-]+)+\b/g;

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
    const expectedValue = snapshot[key];
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
 * Pure restore simulation used by tests.
 * Mirrors the plugin's right-to-left restore behavior while remaining Figma-independent.
 *
 * Returns:
 * - { restored: false, text: currentText } when backup is stale/invalid
 * - { restored: true, text: restoredText } when restore can be safely applied
 */
export function restoreFromBackupSimulation(currentText, backup) {
  const text = String(currentText ?? "");
  if (!isBackupApplicable(text, backup)) {
    return { restored: false, text };
  }

  const reps = [...backup.replacements].sort((a, b) => b.start - a.start);
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
