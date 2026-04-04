export const BACKUP_SCHEMA_VERSION = 2 as const;

export interface BackupReplacement {
	start: number;
	len: number;
	originalText: string;
	originalFont?: FontName | null;
	tokenKey?: string;
	valueAtSave?: string;
	variableId?: string;
}

export interface BackupPayloadV2 {
	schemaVersion: typeof BACKUP_SCHEMA_VERSION;
	original: string;
	snapshot: Record<string, string>;
	collection: string;
	replacements: BackupReplacement[];
	mappingHash: string;
	replacedTextHash: string;
	ts: number;
}

export interface LegacyBackupPayload {
	schemaVersion?: number;
	original?: string;
	snapshot?: Record<string, string>;
	collection?: string;
	replacements?: Array<Partial<BackupReplacement>>;
	mappingHash?: string;
	replacedTextHash?: string;
	ts?: number;
}

export type AnyBackupPayload = BackupPayloadV2 | LegacyBackupPayload;

export interface DocSettings {
	collection: string;
	iconFontFamily: string;
	iconFontStyle: string;
}

export interface PluginRuntimeState {
	featureEnabled: boolean;
	chosenCollection: string;
	iconFontFamily: string;
	iconFontStyle: string;
	activeNodeOriginalText: string;
	lastSelectedNodeId: string | null;
	processing: boolean;
}

export type PluginMessage = {
	type?: string;
	autocompleteVars?: string[];
	collections?: string[];
	enabled?: boolean;
	collection?: string;
	iconFontFamily?: string;
	iconFontStyle?: string;
	query?: string;
	wordStart?: number;
	wordEnd?: number;
	nodeId?: string;
	text?: string;
	results?: unknown[];
};
