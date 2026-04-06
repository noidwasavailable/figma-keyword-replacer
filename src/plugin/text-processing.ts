import {
	clearNodeBackup,
	isBackupApplicable,
	migrateBackupPayload,
	readNodeBackup,
	saveNodeBackup,
} from "./backup";
import {
	DEFAULT_COLLECTION_NAME,
	DEFAULT_ICON_FONT_STYLE,
	PLACEHOLDER_REGEX,
} from "./constants";
import {
	isFontMatch,
	loadIconFontIfConfigured,
	pickNormalFontFromNodeSegments,
	safeLoadFonts,
	safeLoadFontsForNode,
} from "./fonts";
import type { BackupPayloadV2, BackupReplacement } from "./types";
import {
	computeIconMappingHashFromEntries,
	hashStringFNV1a,
	isIconTokenKey,
	normalizeTokenKey,
} from "./utils";
import {
	buildIconGlyphToTokenMap,
	computeCurrentIconMappingHash,
	findStringVariable,
	getOrCreateCollection,
	resolveCurrentValuesForTokenKeys,
	resolveVariableValue,
} from "./variables";

export interface TextProcessingOptions {
	collectionName?: string;
	iconFontFamily?: string;
	iconFontStyle?: string;
	debugLog?: (...args: unknown[]) => void;
}

export interface ReplaceResult {
	changed: boolean;
	snapshot?: Record<string, string>;
}

export interface RestoreResult {
	restored: boolean;
	recoveredFromStale?: boolean;
	recoveredCount?: number;
	totalCandidates?: number;
}

export interface RecoverResult {
	recovered: boolean;
	recoveredCount?: number;
	totalCandidates?: number;
	fallbackRecoveredCount?: number;
	skipped?: boolean;
	reason?: string;
}

type RecoveryAttemptResult = {
	restored: boolean;
	recoveredCount: number;
	total: number;
	fallbackRecoveredCount?: number;
};

function getResolvedOptions(
	options?: TextProcessingOptions,
): Required<TextProcessingOptions> {
	return {
		collectionName: options?.collectionName || DEFAULT_COLLECTION_NAME,
		iconFontFamily: options?.iconFontFamily || "",
		iconFontStyle: options?.iconFontStyle || DEFAULT_ICON_FONT_STYLE,
		debugLog: options?.debugLog || (() => {}),
	};
}

function stripTrailingPunctuation(value: string): string {
	return String(value || "").replace(/[.,:;!?]+$/g, "");
}

function findBestRecoveryCandidate(
	text: string,
	candidates: string[],
	anchor: number,
	windowSize: number,
): { start: number; len: number; value: string } | null {
	const source = String(text || "");
	const anchorIdx = Number.isFinite(anchor) ? anchor : 0;
	const win = Number.isFinite(windowSize) ? windowSize : 24;

	let best: {
		start: number;
		len: number;
		value: string;
		distance: number;
	} | null = null;

	for (const raw of candidates || []) {
		const rawNeedle = String(raw || "");
		if (!rawNeedle) continue;

		const variants: string[] = [];
		const seen = new Set<string>();

		const addVariant = (v: string) => {
			const s = String(v || "");
			if (!s || seen.has(s)) return;
			seen.add(s);
			variants.push(s);
		};

		addVariant(rawNeedle);
		addVariant(stripTrailingPunctuation(rawNeedle));

		for (const needle of variants) {
			if (
				anchorIdx >= 0 &&
				anchorIdx + needle.length <= source.length &&
				source.slice(anchorIdx, anchorIdx + needle.length) === needle
			) {
				return { start: anchorIdx, len: needle.length, value: needle };
			}

			let idx = source.indexOf(needle);
			while (idx !== -1) {
				const distance = Math.abs(idx - anchorIdx);
				if (distance <= win) {
					if (
						!best ||
						distance < best.distance ||
						(distance === best.distance && needle.length > best.len)
					) {
						best = {
							start: idx,
							len: needle.length,
							value: needle,
							distance,
						};
					}
				}
				idx = source.indexOf(needle, idx + 1);
			}
		}
	}

	if (!best) return null;
	return { start: best.start, len: best.len, value: best.value };
}

async function fallbackRecoverByIconFontScan(
	node: TextNode,
	backup: BackupPayloadV2 | null,
	currentValuesByToken: Record<string, string>,
	options?: TextProcessingOptions,
): Promise<{ recoveredCount: number }> {
	const { iconFontFamily, iconFontStyle, collectionName } =
		getResolvedOptions(options);

	if (!iconFontFamily) return { recoveredCount: 0 };

	const glyphToToken = await buildIconGlyphToTokenMap(
		backup?.collection || collectionName || DEFAULT_COLLECTION_NAME,
		node,
		currentValuesByToken,
	);

	const usableGlyphs = Object.keys(glyphToToken).filter(
		(glyph) => !!glyphToToken[glyph],
	);
	if (usableGlyphs.length === 0) return { recoveredCount: 0 };

	usableGlyphs.sort((a, b) => b.length - a.length);

	const normalFont = pickNormalFontFromNodeSegments(
		node,
		iconFontFamily,
		iconFontStyle,
	);
	const text = String(node.characters || "");

	const ops: Array<{ start: number; len: number; placeholder: string }> = [];

	let segments: Array<{
		start: number;
		end: number;
		fontName: FontName | PluginAPI["mixed"];
	}> = [];

	try {
		segments = node.getStyledTextSegments(["fontName"]) as typeof segments;
	} catch {
		return { recoveredCount: 0 };
	}

	for (const seg of segments) {
		const segStart = seg.start;
		const segEnd = Math.min(seg.end, text.length);
		const segLen = Math.max(0, segEnd - segStart);

		if (segLen <= 0) continue;

		if (!isFontMatch(seg.fontName, iconFontFamily, iconFontStyle, true))
			continue;
		if (segEnd <= segStart) continue;

		let idx = segStart;
		while (idx < segEnd) {
			let matched = false;

			for (const glyph of usableGlyphs) {
				if (!glyph) continue;
				if (idx + glyph.length > segEnd) continue;
				if (text.slice(idx, idx + glyph.length) !== glyph) continue;

				const tokenKey = glyphToToken[glyph];
				if (!tokenKey) continue;

				ops.push({
					start: idx,
					len: glyph.length,
					placeholder: `@${tokenKey}`,
				});

				idx += glyph.length;
				matched = true;
				break;
			}

			if (!matched) idx++;
		}
	}

	if (ops.length === 0) return { recoveredCount: 0 };

	const fontsReady = await safeLoadFontsForNode(node);
	if (!fontsReady) return { recoveredCount: 0 };

	if (normalFont) {
		await safeLoadFonts([normalFont]);
	}

	ops.sort((a, b) => b.start - a.start);

	let recoveredCount = 0;
	for (const op of ops) {
		node.insertCharacters(op.start, op.placeholder, "BEFORE");

		if (normalFont) {
			try {
				node.setRangeFontName(
					op.start,
					op.start + op.placeholder.length,
					normalFont,
				);
			} catch {
				// Keep text recovery even if style application fails.
			}
		}

		const delStart = op.start + op.placeholder.length;
		node.deleteCharacters(delStart, delStart + op.len);
		recoveredCount++;
	}

	return { recoveredCount };
}

async function attemptStaleBackupRecovery(
	node: TextNode,
	backup: BackupPayloadV2 | null,
	options?: TextProcessingOptions,
): Promise<RecoveryAttemptResult> {
	const resolved = getResolvedOptions(options);
	const replacements = Array.isArray(backup?.replacements)
		? backup.replacements
		: [];

	if (replacements.length === 0) {
		return { restored: false, recoveredCount: 0, total: 0 };
	}

	const snapshot = backup?.snapshot || {};
	const iconTokenKeys: string[] = [];

	for (const rep of replacements) {
		const tokenKey = normalizeTokenKey(
			rep?.tokenKey || rep?.originalText || "",
		);
		if (tokenKey && isIconTokenKey(tokenKey)) iconTokenKeys.push(tokenKey);
	}

	const currentValuesByToken = await resolveCurrentValuesForTokenKeys(
		backup?.collection || resolved.collectionName,
		iconTokenKeys,
		node,
	);

	const fontsReady = await safeLoadFontsForNode(node, resolved.debugLog);
	if (!fontsReady) {
		return { restored: false, recoveredCount: 0, total: replacements.length };
	}

	const reps = replacements.slice().sort((a, b) => b.start - a.start);
	await safeLoadFonts(reps.map((rep) => rep.originalFont).filter(Boolean));

	let recoveredCount = 0;

	for (const rep of reps) {
		const placeholder = String(rep?.originalText || "");
		if (!placeholder.startsWith("@")) continue;

		const tokenKey = normalizeTokenKey(rep.tokenKey || placeholder);
		const candidates: string[] = [];
		const seen = new Set<string>();

		const pushCandidate = (v: unknown) => {
			const s = String(v || "");
			if (!s || seen.has(s)) return;
			seen.add(s);
			candidates.push(s);
		};

		pushCandidate(rep.valueAtSave);
		if (typeof snapshot[tokenKey] === "string")
			pushCandidate(snapshot[tokenKey]);
		if (typeof currentValuesByToken[tokenKey] === "string") {
			pushCandidate(currentValuesByToken[tokenKey]);
		}

		if (candidates.length === 0) continue;

		const best = findBestRecoveryCandidate(
			node.characters,
			candidates,
			typeof rep.start === "number" ? rep.start : 0,
			24,
		);
		if (!best) continue;

		node.insertCharacters(best.start, placeholder, "BEFORE");

		if (rep.originalFont) {
			try {
				node.setRangeFontName(
					best.start,
					best.start + placeholder.length,
					rep.originalFont,
				);
			} catch (error) {
				console.warn(
					"Failed to apply original font during stale recovery",
					error,
				);
			}
		}

		const delStart = best.start + placeholder.length;
		node.deleteCharacters(delStart, delStart + best.len);
		recoveredCount++;
	}

	let fallbackRecoveredCount = 0;

	try {
		const fallback = await fallbackRecoverByIconFontScan(
			node,
			backup,
			currentValuesByToken,
			resolved,
		);
		fallbackRecoveredCount = fallback?.recoveredCount || 0;
		recoveredCount += fallbackRecoveredCount;
	} catch (error) {
		console.warn("Fallback icon-font stale recovery failed", error);
	}

	return {
		restored: recoveredCount > 0,
		recoveredCount,
		total: reps.length,
		fallbackRecoveredCount,
	};
}

export async function replacePlaceholdersInNode(
	node: TextNode,
	options?: TextProcessingOptions,
): Promise<ReplaceResult> {
	const resolved = getResolvedOptions(options);

	const text = node.characters;
	const matches: Array<{
		key: string;
		start: number;
		len: number;
		text: string;
	}> = [];

	PLACEHOLDER_REGEX.lastIndex = 0;
	let match = PLACEHOLDER_REGEX.exec(text);

	while (match !== null) {
		const token = match[0];
		matches.push({
			key: token.slice(1),
			start: match.index,
			len: token.length,
			text: token,
		});
		match = PLACEHOLDER_REGEX.exec(text);
	}

	if (matches.length === 0) {
		clearNodeBackup(node);
		return { changed: false };
	}

	const collection = await getOrCreateCollection(resolved.collectionName);

	const snapshot: Record<string, string> = {};
	const replacements: BackupReplacement[] = [];
	const ops: Array<{
		start: number;
		removeLen: number;
		insertText: string;
		isIcon: boolean;
		originalFont: FontName | null;
	}> = [];

	const iconHashEntries: Array<{
		key: string;
		value: string;
		variableId: string;
	}> = [];
	let runningDelta = 0;
	let hasIconReplacement = false;

	for (const item of matches) {
		const variable = await findStringVariable(collection, item.key);
		if (!variable) continue;

		const value = await resolveVariableValue(variable, node);
		const resolvedValue =
			typeof value === "string" ? value : String(value || "");

		const tokenKey = normalizeTokenKey(item.key);
		snapshot[tokenKey] = resolvedValue;

		const isIcon = isIconTokenKey(tokenKey);
		if (isIcon) hasIconReplacement = true;

		let originalFont: FontName | null = null;
		try {
			if (item.start < node.characters.length) {
				const font = node.getRangeFontName(item.start, item.start + 1);
				if (font !== figma.mixed) originalFont = font;
			}
		} catch {
			// ignore
		}

		const finalStart = item.start + runningDelta;

		replacements.push({
			start: finalStart,
			len: resolvedValue.length,
			originalText: item.text,
			originalFont,
			tokenKey,
			valueAtSave: resolvedValue,
			variableId: variable.id || "",
		});

		if (isIcon) {
			iconHashEntries.push({
				key: tokenKey,
				value: resolvedValue,
				variableId: variable.id || "",
			});
		}

		ops.push({
			start: item.start,
			removeLen: item.len,
			insertText: resolvedValue,
			isIcon,
			originalFont,
		});

		runningDelta += resolvedValue.length - item.len;
	}

	if (ops.length === 0) {
		clearNodeBackup(node);
		return { changed: false };
	}

	const fontsReady = await safeLoadFontsForNode(node, resolved.debugLog);
	if (!fontsReady) {
		resolved.debugLog("Skipping replace due to missing/unloadable font", {
			nodeId: node.id,
		});
		return { changed: false };
	}

	let iconFontLoaded = false;
	if (hasIconReplacement && resolved.iconFontFamily) {
		iconFontLoaded = await loadIconFontIfConfigured(
			resolved.iconFontFamily,
			resolved.iconFontStyle,
		);
	}

	for (let i = ops.length - 1; i >= 0; i--) {
		const op = ops[i];

		if (op.insertText.length > 0) {
			node.insertCharacters(op.start, op.insertText, "BEFORE");
			const insertEnd = op.start + op.insertText.length;

			if (op.isIcon && iconFontLoaded) {
				node.setRangeFontName(op.start, insertEnd, {
					family: resolved.iconFontFamily,
					style: resolved.iconFontStyle,
				});
			} else if (op.originalFont) {
				try {
					node.setRangeFontName(op.start, insertEnd, op.originalFont);
				} catch (error) {
					console.warn("Failed to set replaced font", error);
				}
			}
		}

		const delStart = op.start + op.insertText.length;
		node.deleteCharacters(delStart, delStart + op.removeLen);
	}

	saveNodeBackup(node, text, snapshot, collection.name, replacements, {
		mappingHash: computeIconMappingHashFromEntries(iconHashEntries),
		replacedTextHash: hashStringFNV1a(node.characters),
	});

	return { changed: true, snapshot };
}

export async function restorePlaceholdersInNode(
	node: TextNode,
	options?: TextProcessingOptions,
): Promise<RestoreResult> {
	const resolved = getResolvedOptions(options);

	let backup = readNodeBackup(node);
	if (!backup) return { restored: false };

	const migrated = migrateBackupPayload(node, backup);
	if (!migrated) return { restored: false };
	backup = migrated;

	const applicable = isBackupApplicable(node, backup);
	if (!applicable) {
		resolved.debugLog(
			"Backup marked stale/invalid. Attempting icon recovery.",
			{
				nodeId: node.id,
				nodeText: node.characters,
				backup,
			},
		);

		try {
			const recovery = await attemptStaleBackupRecovery(
				node,
				migrated,
				resolved,
			);
			if (recovery.restored) {
				resolved.debugLog("Recovered placeholders from stale backup", {
					nodeId: node.id,
					recoveredCount: recovery.recoveredCount,
					total: recovery.total,
				});

				clearNodeBackup(node);
				return {
					restored: true,
					recoveredFromStale: true,
					recoveredCount: recovery.recoveredCount,
					totalCandidates: recovery.total,
				};
			}
		} catch (error) {
			console.warn("Stale backup recovery failed", error);
		}

		clearNodeBackup(node);
		return { restored: false };
	}

	const backupIconKeys = (migrated.replacements || [])
		.map((rep) => normalizeTokenKey(rep.tokenKey || rep.originalText))
		.filter((key) => isIconTokenKey(key));

	if (migrated.mappingHash && backupIconKeys.length > 0) {
		try {
			const currentHash = await computeCurrentIconMappingHash(
				migrated.collection || resolved.collectionName,
				backupIconKeys,
				node,
			);

			if (currentHash && currentHash !== migrated.mappingHash) {
				resolved.debugLog(
					"Detected icon mapping drift; proceeding with placeholder restore safely",
					{
						nodeId: node.id,
						backupHash: migrated.mappingHash,
						currentHash,
					},
				);
			}
		} catch (error) {
			console.warn("Failed mapping-hash validation during restore", error);
		}
	}

	const fontsReady = await safeLoadFontsForNode(node, resolved.debugLog);
	if (!fontsReady) {
		resolved.debugLog("Skipping restore due to missing/unloadable font", {
			nodeId: node.id,
		});
		return { restored: false };
	}

	if (Array.isArray(migrated.replacements)) {
		const reps = [...migrated.replacements].sort((a, b) => b.start - a.start);
		await safeLoadFonts(reps.map((rep) => rep.originalFont).filter(Boolean));

		for (const rep of reps) {
			if (
				typeof rep.start !== "number" ||
				typeof rep.len !== "number" ||
				rep.start < 0 ||
				rep.len < 0 ||
				rep.start + rep.len > node.characters.length
			) {
				resolved.debugLog(
					"Invalid replacement range during restore; clearing backup",
					{
						nodeId: node.id,
						rep,
						textLength: node.characters.length,
					},
				);

				clearNodeBackup(node);
				return { restored: false };
			}

			node.insertCharacters(rep.start, rep.originalText, "BEFORE");

			if (rep.originalFont) {
				try {
					node.setRangeFontName(
						rep.start,
						rep.start + rep.originalText.length,
						rep.originalFont,
					);
				} catch (error) {
					console.warn("Failed to restore font", error);
				}
			}

			const delStart = rep.start + rep.originalText.length;
			node.deleteCharacters(delStart, delStart + rep.len);
		}

		clearNodeBackup(node);
		return { restored: true };
	}

	if (migrated.original) {
		node.characters = migrated.original;
		clearNodeBackup(node);
		return { restored: true };
	}

	return { restored: false };
}

export async function recoverStaleBackupInNode(
	node: TextNode,
	options?: TextProcessingOptions,
): Promise<RecoverResult> {
	const resolved = getResolvedOptions(options);

	let backup = readNodeBackup(node);
	if (backup) {
		const migrated = migrateBackupPayload(node, backup);
		if (!migrated) {
			return { recovered: false, skipped: true, reason: "invalid-backup" };
		}
		backup = migrated;
	}

	if (backup && !isBackupApplicable(node, backup)) {
		const recovery = await attemptStaleBackupRecovery(
			node,
			backup as BackupPayloadV2,
			resolved,
		);

		clearNodeBackup(node);

		if (recovery.restored) {
			return {
				recovered: true,
				recoveredCount: recovery.recoveredCount || 0,
				totalCandidates: recovery.total || 0,
				fallbackRecoveredCount: recovery.fallbackRecoveredCount || 0,
			};
		}
	}

	const iconTokenKeys: string[] = [];
	const replacements = (backup as BackupPayloadV2 | null)?.replacements || [];
	for (const rep of replacements) {
		const tokenKey = normalizeTokenKey(rep?.tokenKey || rep?.originalText || "");
		if (tokenKey && isIconTokenKey(tokenKey)) iconTokenKeys.push(tokenKey);
	}

	const currentValuesByToken = await resolveCurrentValuesForTokenKeys(
		(backup as BackupPayloadV2 | null)?.collection || resolved.collectionName,
		iconTokenKeys,
		node,
	);

	const fallback = await fallbackRecoverByIconFontScan(
		node,
		(backup as BackupPayloadV2 | null) || null,
		currentValuesByToken,
		resolved,
	);
	const recoveredCount = fallback?.recoveredCount || 0;

	if (recoveredCount > 0) {
		clearNodeBackup(node);
		return {
			recovered: true,
			recoveredCount,
			totalCandidates: recoveredCount,
			fallbackRecoveredCount: recoveredCount,
		};
	}

	return {
		recovered: false,
		skipped: true,
		reason: backup ? "not-recoverable" : "no-backup-and-no-icon-glyphs",
	};
}
