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
 * Utility for tests:
 * Find the first matching variable name from a list, or null.
 */
export function findMatchingVariableName(variableNames, key) {
  for (const name of variableNames ?? []) {
    if (isVariableNameMatch(name, key)) return name;
  }
  return null;
}
