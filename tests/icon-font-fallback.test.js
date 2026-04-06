import { describe, expect, test } from "bun:test";
import {
	buildIconGlyphToTokenAliasMapForTests,
	buildIconGlyphToTokenMapFromSeedForTests,
	isFontMatchForTests,
	simulateFallbackIconFontGlyphRecoveryForTests,
} from "./keyword-utils.js";

describe("buildIconGlyphToTokenAliasMapForTests", () => {
	test("glyph collisions are treated as aliases with deterministic canonical key", () => {
		const map = buildIconGlyphToTokenAliasMapForTests([
			{ tokenKey: "icon/shield", glyph: "w" },
			{ tokenKey: "icon/defense", glyph: "w" },
			{ tokenKey: "icon/attack", glyph: "q" },
		]);

		expect(map.w).toBe("icon/defense");
		expect(map.q).toBe("icon/attack");
	});

	test("returns empty map for empty entries", () => {
		expect(buildIconGlyphToTokenAliasMapForTests([])).toEqual({});
	});

	test("returns empty map for null/undefined entries", () => {
		expect(buildIconGlyphToTokenAliasMapForTests(null)).toEqual({});
		expect(buildIconGlyphToTokenAliasMapForTests(undefined)).toEqual({});
	});

	test("skips entries with missing tokenKey or glyph", () => {
		const map = buildIconGlyphToTokenAliasMapForTests([
			{ tokenKey: "icon/attack", glyph: "" },
			{ tokenKey: "", glyph: "q" },
			{ tokenKey: "icon/defense", glyph: "w" },
		]);

		expect(Object.keys(map)).toHaveLength(1);
		expect(map.w).toBe("icon/defense");
	});

	test("ignores non-icon token keys", () => {
		const map = buildIconGlyphToTokenAliasMapForTests([
			{ tokenKey: "character", glyph: "c" },
			{ tokenKey: "icon/attack", glyph: "q" },
		]);

		expect(map.c).toBeUndefined();
		expect(map.q).toBe("icon/attack");
	});
});

describe("seed-based glyph-to-token map building", () => {
	test("seed values are correctly included in the glyph map", () => {
		const map = buildIconGlyphToTokenMapFromSeedForTests(
			{
				"icon/defense": "◆",
				"icon/attack": "✦",
			},
			[],
		);

		expect(map["◆"]).toBe("icon/defense");
		expect(map["✦"]).toBe("icon/attack");
	});

	test("seed values and extra entries are merged", () => {
		const map = buildIconGlyphToTokenMapFromSeedForTests(
			{ "icon/defense": "◆" },
			[{ tokenKey: "icon/attack", glyph: "✦" }],
		);

		expect(map["◆"]).toBe("icon/defense");
		expect(map["✦"]).toBe("icon/attack");
	});

	test("seed collision resolves to deterministic canonical key", () => {
		const map = buildIconGlyphToTokenMapFromSeedForTests(
			{
				"icon/shield": "w",
				"icon/defense": "w",
			},
			[],
		);

		// Deterministic: alphabetically smaller key wins
		expect(map.w).toBe("icon/defense");
	});

	test("non-icon seed keys are ignored", () => {
		const map = buildIconGlyphToTokenMapFromSeedForTests(
			{
				character: "Bob",
				"icon/defense": "◆",
			},
			[],
		);

		expect(map["◆"]).toBe("icon/defense");
		expect(map.Bob).toBeUndefined();
	});

	test("empty seed still works when extra entries provided", () => {
		const map = buildIconGlyphToTokenMapFromSeedForTests({}, [
			{ tokenKey: "icon/fire", glyph: "🔥" },
		]);

		expect(map["🔥"]).toBe("icon/fire");
	});
});

describe("fallback icon-font glyph recovery simulation", () => {
	test("only replaces glyphs inside icon-font segments", () => {
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
				{
					start: 4,
					end: 5,
					fontName: { family: "Game Icons", style: "Regular" },
				},
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
				{
					start: 1,
					end: 2,
					fontName: { family: "Game Icons", style: "Solid" },
				},
			],
		});

		expect(result.changed).toBe(true);
		expect(result.text).toBe("X@icon/defense");
	});

	test("handles adjacent glyphs in one icon-font segment", () => {
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
				{
					start: 0,
					end: 2,
					fontName: { family: "Game Icons", style: "Regular" },
				},
			],
		});

		expect(result.changed).toBe(true);
		expect(result.text).toBe("@icon/attack@icon/defense");
		expect(result.replacements).toHaveLength(2);
	});
});

describe("fallback scan with multi-character glyphs", () => {
	test("handles surrogate-pair emoji glyphs", () => {
		const text = "ATK 🗡️ DEF 🛡️";
		const swordEnd = 4 + "🗡️".length;
		const shieldStart = swordEnd + " DEF ".length;
		const shieldEnd = shieldStart + "🛡️".length;

		const result = simulateFallbackIconFontGlyphRecoveryForTests({
			text,
			iconFontFamily: "Game Icons",
			iconFontStyle: "Regular",
			glyphToToken: {
				"🗡️": "icon/attack",
				"🛡️": "icon/defense",
			},
			segments: [
				{ start: 0, end: 4, fontName: { family: "Inter", style: "Regular" } },
				{
					start: 4,
					end: swordEnd,
					fontName: { family: "Game Icons", style: "Regular" },
				},
				{ start: swordEnd, end: shieldStart, fontName: { family: "Inter", style: "Regular" } },
				{
					start: shieldStart,
					end: shieldEnd,
					fontName: { family: "Game Icons", style: "Regular" },
				},
			],
		});

		expect(result.changed).toBe(true);
		expect(result.text).toBe("ATK @icon/attack DEF @icon/defense");
		expect(result.replacements).toHaveLength(2);
	});

	test("multi-char glyph strings are matched greedily (longest first)", () => {
		const text = "ab";
		const result = simulateFallbackIconFontGlyphRecoveryForTests({
			text,
			iconFontFamily: "Game Icons",
			iconFontStyle: "Regular",
			glyphToToken: {
				a: "icon/single",
				ab: "icon/double",
			},
			segments: [
				{
					start: 0,
					end: 2,
					fontName: { family: "Game Icons", style: "Regular" },
				},
			],
		});

		expect(result.changed).toBe(true);
		expect(result.text).toBe("@icon/double");
		expect(result.replacements).toHaveLength(1);
	});
});

describe("fallback scan boundary safety", () => {
	test("same character in normal font is NOT replaced", () => {
		const text = "w in normal text and w in icon font";
		const iconW = text.lastIndexOf("w");
		const result = simulateFallbackIconFontGlyphRecoveryForTests({
			text,
			iconFontFamily: "Game Icons",
			iconFontStyle: "Regular",
			glyphToToken: { w: "icon/defense" },
			segments: [
				{
					start: 0,
					end: iconW,
					fontName: { family: "Inter", style: "Regular" },
				},
				{
					start: iconW,
					end: iconW + 1,
					fontName: { family: "Game Icons", style: "Regular" },
				},
				{
					start: iconW + 1,
					end: text.length,
					fontName: { family: "Inter", style: "Regular" },
				},
			],
		});

		expect(result.changed).toBe(true);
		expect(result.replacements).toHaveLength(1);
		expect(result.replacements[0].start).toBe(iconW);
		// The normal "w" characters should remain untouched
		expect(result.text.startsWith("w in normal text and ")).toBe(true);
	});

	test("empty glyph map produces no changes", () => {
		const text = "some text";
		const result = simulateFallbackIconFontGlyphRecoveryForTests({
			text,
			iconFontFamily: "Game Icons",
			iconFontStyle: "Regular",
			glyphToToken: {},
			segments: [
				{
					start: 0,
					end: text.length,
					fontName: { family: "Game Icons", style: "Regular" },
				},
			],
		});

		expect(result.changed).toBe(false);
		expect(result.text).toBe(text);
	});

	test("no icon font family means no recovery", () => {
		const text = "w";
		const result = simulateFallbackIconFontGlyphRecoveryForTests({
			text,
			iconFontFamily: "",
			iconFontStyle: "Regular",
			glyphToToken: { w: "icon/defense" },
			segments: [
				{
					start: 0,
					end: 1,
					fontName: { family: "Game Icons", style: "Regular" },
				},
			],
		});

		expect(result.changed).toBe(false);
	});

	test("no segments produces no changes", () => {
		const text = "w";
		const result = simulateFallbackIconFontGlyphRecoveryForTests({
			text,
			iconFontFamily: "Game Icons",
			iconFontStyle: "Regular",
			glyphToToken: { w: "icon/defense" },
			segments: [],
		});

		expect(result.changed).toBe(false);
		expect(result.text).toBe(text);
	});

	test("glyph not in map is not replaced even in icon-font segment", () => {
		const text = "xyz";
		const result = simulateFallbackIconFontGlyphRecoveryForTests({
			text,
			iconFontFamily: "Game Icons",
			iconFontStyle: "Regular",
			glyphToToken: { w: "icon/defense" },
			segments: [
				{
					start: 0,
					end: 3,
					fontName: { family: "Game Icons", style: "Regular" },
				},
			],
		});

		expect(result.changed).toBe(false);
		expect(result.text).toBe(text);
	});

	test("zero-length segment is skipped", () => {
		const text = "w";
		const result = simulateFallbackIconFontGlyphRecoveryForTests({
			text,
			iconFontFamily: "Game Icons",
			iconFontStyle: "Regular",
			glyphToToken: { w: "icon/defense" },
			segments: [
				{
					start: 0,
					end: 0,
					fontName: { family: "Game Icons", style: "Regular" },
				},
			],
		});

		expect(result.changed).toBe(false);
		expect(result.text).toBe(text);
	});
});
