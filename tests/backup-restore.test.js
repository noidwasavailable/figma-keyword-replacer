import { describe, expect, test } from "bun:test";
import {
	BACKUP_SCHEMA_VERSION,
	computeIconMappingHashFromEntries,
	hashStringFNV1a,
	isBackupApplicable,
	migrateBackupPayloadForTests,
	restoreFromBackupSimulation,
	shouldRejectStaleBackup,
} from "./keyword-utils.js";

describe("stale backup corruption safeguards", () => {
	test("accepts a valid backup when current text still contains expected replacement values", () => {
		const currentText =
			"Target a friendly ◆. Move it to an empty adjacent tile.";
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
		const currentText =
			"Target a friendly character. Move it to an empty adjacent tile.";
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

	test("returns false for null/undefined backup", () => {
		expect(isBackupApplicable("some text", null)).toBe(false);
		expect(isBackupApplicable("some text", undefined)).toBe(false);
	});

	test("returns false for backup with empty replacements array", () => {
		expect(
			isBackupApplicable("some text", {
				snapshot: {},
				replacements: [],
			}),
		).toBe(false);
	});

	test("shouldRejectStaleBackup is inverse of isBackupApplicable", () => {
		const text = "Use ◆ now.";
		const validBackup = {
			snapshot: { "icon/defense": "◆" },
			replacements: [
				{
					start: "Use ".length,
					len: 1,
					originalText: "@icon/defense",
				},
			],
		};

		expect(shouldRejectStaleBackup(text, validBackup)).toBe(
			!isBackupApplicable(text, validBackup),
		);
	});
});

describe("backup restore lifecycle simulation", () => {
	test("restores a valid replaced token back to placeholder", () => {
		const currentText =
			"Target a friendly ◆. Move it to an empty adjacent tile.";
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

	test("returns unchanged text for empty replacements", () => {
		const text = "Hello world";
		const result = restoreFromBackupSimulation(text, {
			snapshot: {},
			replacements: [],
		});
		expect(result.restored).toBe(false);
		expect(result.text).toBe(text);
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

	test("migrateBackupPayloadForTests returns null for null input", () => {
		expect(migrateBackupPayloadForTests("text", null)).toBeNull();
	});

	test("migrateBackupPayloadForTests passes through already-v2 backup", () => {
		const v2 = {
			schemaVersion: BACKUP_SCHEMA_VERSION,
			replacements: [
				{
					start: 0,
					len: 1,
					originalText: "@icon/defense",
					valueAtSave: "◆",
				},
			],
		};

		const result = migrateBackupPayloadForTests("◆", v2);
		expect(result).toBe(v2);
	});
});

describe("hashStringFNV1a", () => {
	test("returns deterministic hash for same input", () => {
		expect(hashStringFNV1a("hello")).toBe(hashStringFNV1a("hello"));
	});

	test("returns different hashes for different inputs", () => {
		expect(hashStringFNV1a("hello")).not.toBe(hashStringFNV1a("world"));
	});

	test("handles null/undefined/empty gracefully", () => {
		expect(typeof hashStringFNV1a(null)).toBe("string");
		expect(hashStringFNV1a(null)).toBe(hashStringFNV1a(undefined));
		expect(hashStringFNV1a("")).toBe(hashStringFNV1a(null));
	});

	test("returns 8-character hex string", () => {
		expect(hashStringFNV1a("test")).toMatch(/^[0-9a-f]{8}$/);
	});
});

describe("no-corruption invariants", () => {
	test("never injects @icon/defense into normal words from stale ranges", () => {
		const words = [
			"character",
			"architecture",
			"searcher",
			"teacher",
			"matcher",
		];

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
