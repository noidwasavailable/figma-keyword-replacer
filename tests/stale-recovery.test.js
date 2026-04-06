import { describe, expect, test } from "bun:test";
import {
	findBestRecoveryCandidateForTests,
	isFontMatchForTests,
	normalizeFontTokenForTests,
	stripTrailingPunctuationForTests,
} from "./keyword-utils.js";

describe("stripTrailingPunctuationForTests", () => {
	test("strips trailing punctuation", () => {
		expect(stripTrailingPunctuationForTests("w.")).toBe("w");
		expect(stripTrailingPunctuationForTests("q!?")).toBe("q");
		expect(stripTrailingPunctuationForTests("x")).toBe("x");
	});

	test("handles empty string", () => {
		expect(stripTrailingPunctuationForTests("")).toBe("");
	});

	test("handles null/undefined", () => {
		expect(stripTrailingPunctuationForTests(null)).toBe("");
		expect(stripTrailingPunctuationForTests(undefined)).toBe("");
	});

	test("only strips trailing, not leading or mid-string punctuation", () => {
		expect(stripTrailingPunctuationForTests(".hello.")).toBe(".hello");
		expect(stripTrailingPunctuationForTests("a.b")).toBe("a.b");
	});
});

describe("findBestRecoveryCandidateForTests", () => {
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

		const bestNearFirst = findBestRecoveryCandidateForTests(
			text,
			["w"],
			firstW,
			24,
		);
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

	test("returns null for empty candidates list", () => {
		expect(findBestRecoveryCandidateForTests("hello", [], 0, 24)).toBeNull();
	});

	test("returns null for null/undefined candidates", () => {
		expect(findBestRecoveryCandidateForTests("hello", null, 0, 24)).toBeNull();
	});

	test("returns null for empty text", () => {
		expect(findBestRecoveryCandidateForTests("", ["w"], 0, 24)).toBeNull();
	});

	test("prefers longer candidate at equal distance", () => {
		const text = "xxab";
		// Both "a" and "ab" start at index 2, anchor at 2
		const best = findBestRecoveryCandidateForTests(
			text,
			["a", "ab"],
			2,
			24,
		);
		expect(best).not.toBeNull();
		// exact anchor match returns first hit immediately
		expect(best.start).toBe(2);
	});
});

describe("normalizeFontTokenForTests", () => {
	test("trims, lowercases, and collapses whitespace", () => {
		expect(normalizeFontTokenForTests("  Game  Icons  ")).toBe("game icons");
		expect(normalizeFontTokenForTests("Inter")).toBe("inter");
	});

	test("handles null/undefined/empty", () => {
		expect(normalizeFontTokenForTests(null)).toBe("");
		expect(normalizeFontTokenForTests(undefined)).toBe("");
		expect(normalizeFontTokenForTests("")).toBe("");
	});
});

describe("isFontMatchForTests", () => {
	test("exact family+style match returns true", () => {
		expect(
			isFontMatchForTests(
				{ family: "Game Icons", style: "Regular" },
				"Game Icons",
				"Regular",
				false,
			),
		).toBe(true);
	});

	test("family-only fallback matches when style differs and fallback enabled", () => {
		expect(
			isFontMatchForTests(
				{ family: "Game Icons", style: "Solid" },
				"Game Icons",
				"Regular",
				true,
			),
		).toBe(true);
	});

	test("rejects style mismatch when allowFamilyFallback is false", () => {
		expect(
			isFontMatchForTests(
				{ family: "Game Icons", style: "Solid" },
				"Game Icons",
				"Regular",
				false,
			),
		).toBe(false);
	});

	test("returns false for null/missing font object", () => {
		expect(isFontMatchForTests(null, "Game Icons", "Regular")).toBe(false);
		expect(isFontMatchForTests(undefined, "Game Icons", "Regular")).toBe(false);
	});

	test("returns false when family is empty", () => {
		expect(
			isFontMatchForTests(
				{ family: "Game Icons", style: "Regular" },
				"",
				"Regular",
			),
		).toBe(false);
	});

	test("family match with no target style returns true", () => {
		expect(
			isFontMatchForTests(
				{ family: "Game Icons", style: "Bold" },
				"Game Icons",
				"",
			),
		).toBe(true);
	});

	test("is case-insensitive for family and style", () => {
		expect(
			isFontMatchForTests(
				{ family: "game icons", style: "REGULAR" },
				"Game Icons",
				"regular",
				false,
			),
		).toBe(true);
	});
});
