import { describe, expect, test } from "bun:test";
import {
	extractPlaceholders,
	PLACEHOLDER_REGEX,
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
		const input =
			"Target a friendly character. Move it to an empty adjacent tile.";
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

	test("returns empty array for empty string", () => {
		expect(extractPlaceholders("")).toHaveLength(0);
	});

	test("returns empty array for null/undefined input", () => {
		expect(extractPlaceholders(null)).toHaveLength(0);
		expect(extractPlaceholders(undefined)).toHaveLength(0);
	});

	test("does not match lone '@' with no key", () => {
		expect(extractPlaceholders("hello @ world")).toHaveLength(0);
		expect(extractPlaceholders("@")).toHaveLength(0);
	});

	test("matches placeholder with hyphenated key", () => {
		const matches = extractPlaceholders("use @some-key here");
		expect(matches).toHaveLength(1);
		expect(matches[0].key).toBe("some-key");
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

	test("returns unchanged text when key has no match in resolver", () => {
		const input = "Hello @missing world";
		const result = resolvePlaceholdersInText(input, { other: "x" });

		expect(result.changed).toBe(false);
		expect(result.text).toBe(input);
	});

	test("returns unchanged for empty/null input", () => {
		expect(resolvePlaceholdersInText("", {}).changed).toBe(false);
		expect(resolvePlaceholdersInText(null, {}).changed).toBe(false);
	});

	test("supports function resolver", () => {
		const input = "Say @hello";
		const result = resolvePlaceholdersInText(input, (key) =>
			key === "hello" ? "world" : null,
		);

		expect(result.changed).toBe(true);
		expect(result.text).toBe("Say world");
	});

	test("resolves placeholder at the very start of the string", () => {
		const result = resolvePlaceholdersInText("@name is here", {
			name: "Alice",
		});

		expect(result.changed).toBe(true);
		expect(result.text).toBe("Alice is here");
	});

	test("resolves placeholder at the very end of the string", () => {
		const result = resolvePlaceholdersInText("hello @name", {
			name: "Bob",
		});

		expect(result.changed).toBe(true);
		expect(result.text).toBe("hello Bob");
	});
});
