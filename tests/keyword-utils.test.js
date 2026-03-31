import { describe, test, expect } from "bun:test";
import {
  PLACEHOLDER_REGEX,
  extractPlaceholders,
  normalizeVariableName,
  isVariableNameMatch,
  findMatchingVariableName,
} from "./keyword-utils.js";

describe("PLACEHOLDER_REGEX / extractPlaceholders", () => {
  test("matches inline placeholder without whitespace separator: 1@icon/defense", () => {
    const input = "ATK 1@icon/defense";
    const matches = extractPlaceholders(input);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      key: "icon/defense",
      start: input.indexOf("@icon/defense"),
      len: "@icon/defense".length,
      text: "@icon/defense",
    });
  });

  test("matches placeholder after punctuation: HP:@icon/defense", () => {
    const input = "HP:@icon/defense";
    const matches = extractPlaceholders(input);

    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("@icon/defense");
    expect(matches[0].key).toBe("icon/defense");
  });

  test("matches multiple placeholders in one string", () => {
    const input = "Use @icon/attack then @icon/defense now";
    const matches = extractPlaceholders(input);

    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.key)).toEqual(["icon/attack", "icon/defense"]);
  });

  test("does not match plain word 'character'", () => {
    const input = "This is character text";
    const matches = extractPlaceholders(input);

    expect(matches).toHaveLength(0);
  });

  test("does not match plain word 'character' in a long text", () => {
    const input = "Target a friendly character. Move it to an empty adjacent tile.";
    const matches = extractPlaceholders(input);

    expect(matches).toHaveLength(0);
  });

  test("does not match @character without slash segment", () => {
    const input = "This is @character";
    const matches = extractPlaceholders(input);

    expect(matches).toHaveLength(0);
  });

  test("regex state is reset between calls", () => {
    // Guard against global regex lastIndex bugs
    const first = extractPlaceholders("A @icon/defense");
    const second = extractPlaceholders("B @icon/attack");

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0].key).toBe("icon/attack");
  });

  test("raw regex still finds valid tokens", () => {
    const input = "x@icon/defense y";
    const raw = [...input.matchAll(PLACEHOLDER_REGEX)].map((m) => m[0]);

    expect(raw).toEqual(["@icon/defense"]);
  });
});

describe("variable-name normalization and exact matching", () => {
  test("normalizeVariableName trims, lowercases, and strips one leading @", () => {
    expect(normalizeVariableName("  @Icon/Defense  ")).toBe("icon/defense");
    expect(normalizeVariableName("icon/Defense")).toBe("icon/defense");
  });

  test("isVariableNameMatch supports with/without @ equivalence", () => {
    expect(isVariableNameMatch("@icon/defense", "icon/defense")).toBe(true);
    expect(isVariableNameMatch("icon/defense", "@icon/defense")).toBe(true);
  });

  test("isVariableNameMatch is exact (no partial/fuzzy matching)", () => {
    expect(isVariableNameMatch("icon/defense-alt", "icon/defense")).toBe(false);
    expect(isVariableNameMatch("character", "char")).toBe(false);
    expect(isVariableNameMatch("@icon/defense", "character")).toBe(false);
  });

  test("findMatchingVariableName returns only exact normalized match", () => {
    const names = ["icon/attack", "@icon/defense", "character"];

    expect(findMatchingVariableName(names, "icon/defense")).toBe("@icon/defense");
    expect(findMatchingVariableName(names, "@ICON/DEFENSE")).toBe("@icon/defense");
    expect(findMatchingVariableName(names, "char")).toBeNull();
    expect(findMatchingVariableName(names, "icon/def")).toBeNull();
  });
});
