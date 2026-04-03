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
  stripTrailingPunctuationForTests,
  findBestRecoveryCandidateForTests,
  buildIconGlyphToTokenAliasMapForTests,
  simulateFallbackIconFontGlyphRecoveryForTests,
  isFontMatchForTests,
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

describe("stale recovery helper behaviors", () => {
  test("strips trailing punctuation from stale recovery candidates", () => {
    expect(stripTrailingPunctuationForTests("w.")).toBe("w");
    expect(stripTrailingPunctuationForTests("q!?")).toBe("q");
    expect(stripTrailingPunctuationForTests("x")).toBe("x");
  });

  test("finds candidate by using punctuation-stripped variant near anchor", () => {
    const text = "I gain +1q for each tinker in play.w";
    const anchor = text.lastIndexOf("w");
    const best = findBestRecoveryCandidateForTests(text, ["w."], anchor, 24);

    expect(best).not.toBeNull();
    expect(best).toEqual({
      start: anchor,
      len: 1,
      value: "w",
    });
  });

  test("prefers nearest candidate within recovery window", () => {
    const text = "aaa w bbb w ccc";
    const firstW = text.indexOf("w");
    const secondW = text.lastIndexOf("w");

    const bestNearSecond = findBestRecoveryCandidateForTests(
      text,
      ["w"],
      secondW,
      24,
    );

    expect(bestNearSecond).not.toBeNull();
    expect(bestNearSecond.start).toBe(secondW);
    expect(bestNearSecond.len).toBe(1);

    const bestNearFirst = findBestRecoveryCandidateForTests(text, ["w"], firstW, 24);
    expect(bestNearFirst).not.toBeNull();
    expect(bestNearFirst.start).toBe(firstW);
  });

  test("returns null when no candidate appears in the allowed window", () => {
    const text = "prefix w suffix";
    const anchorFarAway = text.length - 1;
    const best = findBestRecoveryCandidateForTests(
      text,
      ["w"],
      anchorFarAway,
      1,
    );

    expect(best).toBeNull();
  });
});

describe("alias glyph map and icon-font fallback scan simulation", () => {
  test("glyph collisions are treated as aliases with deterministic canonical key", () => {
    const map = buildIconGlyphToTokenAliasMapForTests([
      { tokenKey: "icon/shield", glyph: "w" },
      { tokenKey: "icon/defense", glyph: "w" },
      { tokenKey: "icon/attack", glyph: "q" },
    ]);

    expect(map.w).toBe("icon/defense");
    expect(map.q).toBe("icon/attack");
  });

  test("fallback scan only replaces glyphs inside icon-font segments", () => {
    const text = "ATK w DEF q";
    const result = simulateFallbackIconFontGlyphRecoveryForTests({
      text,
      iconFontFamily: "Game Icons",
      iconFontStyle: "Regular",
      glyphToToken: {
        w: "icon/defense",
        q: "icon/attack",
      },
      segments: [
        { start: 0, end: 4, fontName: { family: "Inter", style: "Regular" } },
        { start: 4, end: 5, fontName: { family: "Game Icons", style: "Regular" } },
        { start: 5, end: 11, fontName: { family: "Inter", style: "Regular" } },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.text).toBe("ATK @icon/defense DEF q");
    expect(result.replacements).toHaveLength(1);
    expect(result.replacements[0].glyph).toBe("w");
  });

  test("family-only font fallback still matches when style differs", () => {
    expect(
      isFontMatchForTests(
        { family: "Game Icons", style: "Solid" },
        "Game Icons",
        "Regular",
        true,
      ),
    ).toBe(true);

    const text = "Xw";
    const result = simulateFallbackIconFontGlyphRecoveryForTests({
      text,
      iconFontFamily: "Game Icons",
      iconFontStyle: "Regular",
      glyphToToken: { w: "icon/defense" },
      segments: [
        { start: 0, end: 1, fontName: { family: "Inter", style: "Regular" } },
        { start: 1, end: 2, fontName: { family: "Game Icons", style: "Solid" } },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.text).toBe("X@icon/defense");
  });

  test("fallback scan handles adjacent glyphs in one icon-font segment", () => {
    const text = "qw";
    const result = simulateFallbackIconFontGlyphRecoveryForTests({
      text,
      iconFontFamily: "Game Icons",
      iconFontStyle: "Regular",
      glyphToToken: {
        q: "icon/attack",
        w: "icon/defense",
      },
      segments: [
        { start: 0, end: 2, fontName: { family: "Game Icons", style: "Regular" } },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.text).toBe("@icon/attack@icon/defense");
    expect(result.replacements).toHaveLength(2);
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
