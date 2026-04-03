import {
	BACKUP_SCHEMA_VERSION,
	DEFAULT_COLLECTION_NAME,
	PLUGIN_DATA_KEY,
} from "./constants";
import type {
	AnyBackupPayload,
	BackupPayloadV2,
	BackupReplacement,
	LegacyBackupPayload,
} from "./types";
import {
	computeIconMappingHashFromEntries,
	hashStringFNV1a,
	isIconTokenKey,
	normalizeTokenKey,
} from "./utils";

type NodeWithPluginData = PluginDataMixin & {
	characters?: string;
};

export type BackupMeta = {
	mappingHash?: string;
	replacedTextHash?: string;
};

function normalizeReplacement(
	rep: Partial<BackupReplacement>,
): BackupReplacement {
	return {
		start: Number.isFinite(rep.start) ? Number(rep.start) : -1,
		len: Number.isFinite(rep.len) ? Number(rep.len) : -1,
		originalText: String(rep.originalText ?? ""),
		originalFont: rep.originalFont ? rep.originalFont : null,
		tokenKey: normalizeTokenKey(rep.tokenKey ?? ""),
		valueAtSave:
			typeof rep.valueAtSave === "string"
				? rep.valueAtSave
				: String(rep.valueAtSave ?? ""),
		variableId: String(rep.variableId ?? ""),
	};
}

function isValidBackupV2(payload: unknown): payload is BackupPayloadV2 {
	if (!payload || typeof payload !== "object") return false;
	const p = payload as BackupPayloadV2;
	return (
		p.schemaVersion === BACKUP_SCHEMA_VERSION &&
		typeof p.original === "string" &&
		typeof p.collection === "string" &&
		typeof p.snapshot === "object" &&
		p.snapshot !== null &&
		Array.isArray(p.replacements) &&
		typeof p.mappingHash === "string" &&
		typeof p.replacedTextHash === "string" &&
		typeof p.ts === "number"
	);
}

export function saveNodeBackup(
	node: NodeWithPluginData,
	originalText: string,
	snapshot: Record<string, string> | undefined,
	collectionName: string | undefined,
	replacements: BackupReplacement[] | undefined,
	meta?: BackupMeta,
): void {
	const payload: BackupPayloadV2 = {
		schemaVersion: BACKUP_SCHEMA_VERSION,
		original: String(originalText ?? ""),
		snapshot: snapshot ?? {},
		collection: collectionName || DEFAULT_COLLECTION_NAME,
		replacements: Array.isArray(replacements) ? replacements : [],
		mappingHash: meta?.mappingHash || "",
		replacedTextHash: meta?.replacedTextHash || "",
		ts: Date.now(),
	};

	try {
		node.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(payload));
	} catch (error) {
		console.warn("Failed to set plugin data", error);
	}
}

export function readNodeBackup(
	node: NodeWithPluginData,
): AnyBackupPayload | null {
	try {
		const raw = node.getPluginData(PLUGIN_DATA_KEY);
		if (!raw) return null;

		const parsed = JSON.parse(raw) as AnyBackupPayload;
		if (!parsed || typeof parsed !== "object") return null;

		return parsed;
	} catch (error) {
		console.warn("Failed to read plugin data", error);
		return null;
	}
}

export function clearNodeBackup(node: NodeWithPluginData): void {
	try {
		node.setPluginData(PLUGIN_DATA_KEY, "");
	} catch (error) {
		console.warn("clear plugin data failed", error);
	}
}

export function migrateBackupPayload(
	node: NodeWithPluginData,
	backup: AnyBackupPayload | null,
): BackupPayloadV2 | null {
	if (!backup) return null;

	if (isValidBackupV2(backup)) return backup;

	const legacy = backup as LegacyBackupPayload;
	const legacyReplacements = Array.isArray(legacy.replacements)
		? legacy.replacements
		: [];

	if (legacyReplacements.length === 0) {
		const passthrough: BackupPayloadV2 = {
			schemaVersion: BACKUP_SCHEMA_VERSION,
			original: String(legacy.original ?? ""),
			snapshot: legacy.snapshot ?? {},
			collection: String(legacy.collection ?? DEFAULT_COLLECTION_NAME),
			replacements: [],
			mappingHash: String(legacy.mappingHash ?? ""),
			replacedTextHash:
				String(legacy.replacedTextHash ?? "") ||
				hashStringFNV1a(String(node.characters ?? "")),
			ts: Number.isFinite(legacy.ts) ? Number(legacy.ts) : Date.now(),
		};

		try {
			node.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(passthrough));
		} catch (error) {
			console.warn("Failed to persist migrated backup", error);
		}

		return passthrough;
	}

	const snapshot = legacy.snapshot ?? {};
	const migratedReplacements: BackupReplacement[] = legacyReplacements.map(
		(rep) => {
			const originalText = String(rep.originalText ?? "");
			const tokenKey = normalizeTokenKey(
				originalText.startsWith("@")
					? originalText.slice(1)
					: (rep.tokenKey ?? ""),
			);
			const valueAtSave =
				typeof snapshot[tokenKey] === "string" ? snapshot[tokenKey] : "";

			return normalizeReplacement({
				...rep,
				originalText,
				tokenKey,
				valueAtSave,
				variableId: String(rep.variableId ?? ""),
			});
		},
	);

	const iconEntries = migratedReplacements
		.filter((rep) => isIconTokenKey(rep.tokenKey))
		.map((rep) => ({
			key: rep.tokenKey ?? "",
			value: rep.valueAtSave ?? "",
			variableId: rep.variableId ?? "",
		}));

	const migrated: BackupPayloadV2 = {
		schemaVersion: BACKUP_SCHEMA_VERSION,
		original: String(legacy.original ?? ""),
		snapshot,
		collection: String(legacy.collection ?? DEFAULT_COLLECTION_NAME),
		replacements: migratedReplacements,
		mappingHash:
			String(legacy.mappingHash ?? "") ||
			computeIconMappingHashFromEntries(iconEntries),
		replacedTextHash:
			String(legacy.replacedTextHash ?? "") ||
			hashStringFNV1a(String(node.characters ?? "")),
		ts: Number.isFinite(legacy.ts) ? Number(legacy.ts) : Date.now(),
	};

	try {
		node.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(migrated));
	} catch (error) {
		console.warn("Failed to persist migrated backup", error);
	}

	return migrated;
}

export function isBackupApplicable(
	node: TextNode,
	backup: AnyBackupPayload | null,
): boolean {
	const migrated = migrateBackupPayload(node, backup);
	if (!migrated) return false;
	if (
		!Array.isArray(migrated.replacements) ||
		migrated.replacements.length === 0
	) {
		return false;
	}

	const currentText = node.characters;

	if (
		migrated.schemaVersion === BACKUP_SCHEMA_VERSION &&
		migrated.replacedTextHash &&
		migrated.replacedTextHash !== hashStringFNV1a(currentText)
	) {
		return false;
	}

	for (const rawRep of migrated.replacements) {
		const rep = normalizeReplacement(rawRep);

		if (
			rep.start < 0 ||
			rep.len < 0 ||
			rep.start + rep.len > currentText.length
		) {
			return false;
		}

		if (!rep.originalText.startsWith("@")) return false;

		const expectedValue =
			typeof rep.valueAtSave === "string" ? rep.valueAtSave : "";
		const actualValue = currentText.slice(rep.start, rep.start + rep.len);

		if (actualValue !== expectedValue) return false;
	}

	return true;
}
