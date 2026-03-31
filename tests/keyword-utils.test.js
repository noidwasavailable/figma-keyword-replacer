import { describe, test, expect } from "bun:test";
import {
  PLACEHOLDER_REGEX,
  extractPlaceholders,
  normalizeVariableName,
  isVariableNameMatch,
  findMatchingVariableName,
  isBackupApplicable,
  shouldRejectStaleBackup,
  restoreFromBackupSimulation,
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

describe("stale backup corruption safeguards", () => {
  test("accepts a valid backup when current text still contains expected replacement values", () => {
    const currentText = "Target a friendly ◆. Move it to an empty adjacent tile.";
    const backup = {
      snapshot: { "icon/defense": "◆" },
      replacements: [
        {
          start: "Target a friendly ".length,
          len: "◆".length,
          originalText: "@icon/defense",
        },
      ],
    };

    expect(isBackupApplicable(currentText, backup)).toBe(true);
    expect(shouldRejectStaleBackup(currentText, backup)).toBe(false);
  });

  test("rejects stale backup when user text no longer matches snapshot value at saved range", () => {
    const currentText = "Target a friendly character. Move it to an empty adjacent tile.";
    const backup = {
      snapshot: { "icon/defense": "◆" },
      replacements: [
        {
          // stale range accidentally points inside "character"
          start: "Target a friendly charact".length,
          len: "◆".length,
          originalText: "@icon/defense",
        },
      ],
    };

    expect(isBackupApplicable(currentText, backup)).toBe(false);
    expect(shouldRejectStaleBackup(currentText, backup)).toBe(true);
  });

  test("rejects backup entries with invalid original placeholder text", () => {
    const currentText = "Target a friendly ◆.";
    const backup = {
      snapshot: { "icon/defense": "◆" },
      replacements: [
        {
          start: "Target a friendly ".length,
          len: 1,
          originalText: "icon/defense",
        },
      ],
    };

    expect(isBackupApplicable(currentText, backup)).toBe(false);
  });

  test("rejects backup when replacement range is out of bounds", () => {
    const currentText = "short";
    const backup = {
      snapshot: { "icon/defense": "◆" },
      replacements: [
        {
          start: 999,
          len: 1,
          originalText: "@icon/defense",
        },
      ],
    };

    expect(isBackupApplicable(currentText, backup)).toBe(false);
  });
});

describe("backup restore lifecycle simulation", () => {
  test("restores a valid replaced token back to placeholder", () => {
    const currentText = "Target a friendly ◆. Move it to an empty adjacent tile.";
    const backup = {
      snapshot: { "icon/defense": "◆" },
      replacements: [
        {
          start: "Target a friendly ".length,
          len: 1,
          originalText: "@icon/defense",
        },
      ],
    };

    const result = restoreFromBackupSimulation(currentText, backup);
    expect(result.restored).toBe(true);
    expect(result.text).toBe(
      "Target a friendly @icon/defense. Move it to an empty adjacent tile.",
    );
  });

  test("stale backup is ignored and does not inject placeholder into plain text", () => {
    const currentText =
      "Target a friendly character. Move it to an empty adjacent tile.";
    const backup = {
      snapshot: { "icon/defense": "◆" },
      replacements: [
        {
          start: "Target a friendly charact".length,
          len: 1,
          originalText: "@icon/defense",
        },
      ],
    };

    const result = restoreFromBackupSimulation(currentText, backup);
    expect(result.restored).toBe(false);
    expect(result.text).toBe(currentText);
    expect(result.text).not.toContain("charact@icon/defenser");
    expect(result.text).not.toContain("@icon/defense");
  });

  test("applies multiple restores right-to-left without index corruption", () => {
    const currentText = "Use ◆ then ✦ now.";
    const backup = {
      snapshot: {
        "icon/defense": "◆",
        "icon/attack": "✦",
      },
      replacements: [
        {
          start: currentText.indexOf("◆"),
          len: 1,
          originalText: "@icon/defense",
        },
        {
          start: currentText.indexOf("✦"),
          len: 1,
          originalText: "@icon/attack",
        },
      ],
    };

    const result = restoreFromBackupSimulation(currentText, backup);
    expect(result.restored).toBe(true);
    expect(result.text).toBe("Use @icon/defense then @icon/attack now.");
  });
});

describe("no-corruption invariants", () => {
  test("never injects @icon/defense into normal words from stale ranges", () => {
    const words = ["character", "architecture", "searcher", "teacher", "matcher"];

    for (const word of words) {
      const text = `Target a friendly ${word}.`;
      const backup = {
        snapshot: { "icon/defense": "◆" },
        replacements: [
          {
            start: "Target a friendly ".length + Math.max(0, word.length - 2),
            len: 1,
            originalText: "@icon/defense",
          },
        ],
      };

      const result = restoreFromBackupSimulation(text, backup);
      expect(result.restored).toBe(false);
      expect(result.text).toBe(text);
      expect(result.text).not.toContain("@icon/defense");
    }
  });
});
