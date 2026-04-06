import { describe, expect, test } from "bun:test";
import {
	findMatchingVariableName,
	isVariableNameMatch,
	normalizeVariableName,
} from "./keyword-utils.js";

describe("normalizeVariableName", () => {
	test("trims, lowercases, and strips one leading @", () => {
		expect(normalizeVariableName("  @Icon/Defense  ")).toBe("icon/defense");
		expect(normalizeVariableName("icon/Defense")).toBe("icon/defense");
	});

	test("handles null/undefined/empty gracefully", () => {
		expect(normalizeVariableName(null)).toBe("");
		expect(normalizeVariableName(undefined)).toBe("");
		expect(normalizeVariableName("")).toBe("");
	});

	test("coerces non-string values", () => {
		expect(normalizeVariableName(42)).toBe("42");
		expect(normalizeVariableName(0)).toBe("0");
	});

	test("only strips a single leading @, not double @@", () => {
		expect(normalizeVariableName("@@icon/defense")).toBe("@icon/defense");
	});
});

describe("isVariableNameMatch", () => {
	test("supports with/without @ equivalence", () => {
		expect(isVariableNameMatch("@icon/defense", "icon/defense")).toBe(true);
		expect(isVariableNameMatch("icon/defense", "@icon/defense")).toBe(true);
	});

	test("is exact (no partial/fuzzy matching)", () => {
		expect(isVariableNameMatch("icon/defense-alt", "icon/defense")).toBe(false);
		expect(isVariableNameMatch("character", "char")).toBe(false);
		expect(isVariableNameMatch("@icon/defense", "character")).toBe(false);
	});

	test("treats empty strings as equal", () => {
		expect(isVariableNameMatch("", "")).toBe(true);
	});

	test("empty vs non-empty returns false", () => {
		expect(isVariableNameMatch("", "icon/defense")).toBe(false);
		expect(isVariableNameMatch("icon/defense", "")).toBe(false);
	});
});

describe("findMatchingVariableName", () => {
	test("returns only exact normalized match", () => {
		const names = ["icon/attack", "@icon/defense", "character"];

		expect(findMatchingVariableName(names, "icon/defense")).toBe(
			"@icon/defense",
		);
		expect(findMatchingVariableName(names, "@ICON/DEFENSE")).toBe(
			"@icon/defense",
		);
		expect(findMatchingVariableName(names, "char")).toBeNull();
		expect(findMatchingVariableName(names, "icon/def")).toBeNull();
	});

	test("returns null for empty list", () => {
		expect(findMatchingVariableName([], "icon/defense")).toBeNull();
	});

	test("returns null for null/undefined list", () => {
		expect(findMatchingVariableName(null, "icon/defense")).toBeNull();
		expect(findMatchingVariableName(undefined, "icon/defense")).toBeNull();
	});

	test("returns first match when duplicates exist", () => {
		const names = ["@icon/defense", "icon/defense"];
		expect(findMatchingVariableName(names, "icon/defense")).toBe(
			"@icon/defense",
		);
	});
});
