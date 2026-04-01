import { describe, test, expect } from "bun:test";
import {
  PLACEHOLDER_REGEX,
  BACKUP_SCHEMA_VERSION,
  extractPlaceholders,
  normalizeVariableName,
  isVariableNameMatch,
  findMatchingVariableName,
  isBackupApplicable,
  shouldRejectStaleBackup,
  restoreFromBackupSimulation,
  hashStringFNV1a,
  computeIconMappingHashFromEntries,
  migrateBackupPayloadForTests,
  resolvePlaceholdersInText,
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

  test("matches simple @keyword without slash segment", () => {
    const input = "This is @character";
    const matches = extractPlaceholders(input);

    expect(matches).toHaveLength(1);
    expect(matches[0].key).toBe("character");
    expect(matches[0].text).toBe("@character");
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

describe("pattern matching and replacement with adjacent/punctuated placeholders", () => {
  test("resolves adjacent placeholders without whitespace: @keyword1@keyword2", () => {
    const input = "@keyword1@keyword2";
    const result = resolvePlaceholdersInText(input, {
      keyword1: "value1",
      keyword2: "value2",
    });

    expect(result.changed).toBe(true);
    expect(result.text).toBe("value1value2");
    expect(result.replacements.map((r) => r.key)).toEqual([
      "keyword1",
      "keyword2",
    ]);
  });

  test("resolves placeholders delimited by punctuation: @keyword1:@keyword2", () => {
    const input = "@keyword1:@keyword2";
    const result = resolvePlaceholdersInText(input, {
      keyword1: "value1",
      keyword2: "value2",
    });

    expect(result.changed).toBe(true);
    expect(result.text).toBe("value1:value2");
  });

  test('resolves placeholder after prefix punctuation: "When I draw:@keyword1"', () => {
    const input = "When I draw:@keyword1";
    const result = resolvePlaceholdersInText(input, {
      keyword1: "value1",
    });

    expect(result.changed).toBe(true);
    expect(result.text).toBe("When I draw:value1");
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

describe("v2 backup migration and integrity checks", () => {
  test("migrates legacy backup to schema v2 with derived replacement fields", () => {
    const currentText = "Target ◆ now.";
    const legacy = {
      snapshot: { "icon/defense": "◆" },
      replacements: [
        {
          start: "Target ".length,
          len: 1,
          originalText: "@icon/defense",
        },
      ],
    };

    const migrated = migrateBackupPayloadForTests(currentText, legacy);

    expect(migrated.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(migrated.replacements).toHaveLength(1);
    expect(migrated.replacements[0].tokenKey).toBe("icon/defense");
    expect(migrated.replacements[0].valueAtSave).toBe("◆");
    expect(migrated.replacements[0].variableId).toBe("");
    expect(typeof migrated.mappingHash).toBe("string");
    expect(typeof migrated.replacedTextHash).toBe("string");
  });

  test("v2 backup rejects restore when replacedTextHash does not match current text", () => {
    const backup = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      replacedTextHash: hashStringFNV1a("Target ◆ now."),
      replacements: [
        {
          start: "Target ".length,
          len: 1,
          originalText: "@icon/defense",
          valueAtSave: "◆",
        },
      ],
    };

    expect(isBackupApplicable("Target ✦ now.", backup)).toBe(false);
  });

  test("v2 backup can validate with valueAtSave even when snapshot is missing", () => {
    const currentText = "Use ◆ now.";
    const backup = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      replacedTextHash: hashStringFNV1a(currentText),
      replacements: [
        {
          start: "Use ".length,
          len: 1,
          originalText: "@icon/defense",
          valueAtSave: "◆",
        },
      ],
    };

    expect(isBackupApplicable(currentText, backup)).toBe(true);
  });

  test("restore simulation supports legacy backup by migrating first", () => {
    const currentText = "Use ◆ now.";
    const legacy = {
      snapshot: { "icon/defense": "◆" },
      replacements: [
        {
          start: "Use ".length,
          len: 1,
          originalText: "@icon/defense",
        },
      ],
    };

    const result = restoreFromBackupSimulation(currentText, legacy);
    expect(result.restored).toBe(true);
    expect(result.text).toBe("Use @icon/defense now.");
  });

  test("icon mapping hash is deterministic regardless of entry order", () => {
    const a = computeIconMappingHashFromEntries([
      { key: "icon/grass", value: "a", variableId: "1" },
      { key: "icon/water", value: "f", variableId: "2" },
    ]);
    const b = computeIconMappingHashFromEntries([
      { key: "icon/water", value: "f", variableId: "2" },
      { key: "icon/grass", value: "a", variableId: "1" },
    ]);

    expect(a).toBe(b);
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
