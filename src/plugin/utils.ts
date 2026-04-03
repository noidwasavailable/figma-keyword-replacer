export type IconHashEntry = {
	key: string;
	value: string;
	variableId?: string;
};

export function createDebugLogger(enabled = false, prefix = "[PRR]") {
	return (...args: unknown[]): void => {
		if (!enabled) return;
		console.log(prefix, ...args);
	};
}

export function normalizeTokenKey(input: unknown): string {
	return String(input ?? "")
		.trim()
		.replace(/^@/, "")
		.toLowerCase();
}

export function isIconTokenKey(key: unknown): boolean {
	return normalizeTokenKey(key).startsWith("icon/");
}

/**
 * Fast deterministic hash (FNV-1a 32-bit).
 * Useful for lightweight integrity checks in plugin data.
 */
export function hashStringFNV1a(input: unknown): string {
	let h = 0x811c9dc5;
	const s = String(input ?? "");

	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
	}

	return (h >>> 0).toString(16).padStart(8, "0");
}

export function computeIconMappingHashFromEntries(
	entries: ReadonlyArray<IconHashEntry> | null | undefined,
): string {
	const normalized = (entries ?? [])
		.filter(Boolean)
		.map((entry) => {
			const key = normalizeTokenKey(entry.key);
			const value = String(entry.value ?? "");
			const variableId = String(entry.variableId ?? "");
			return `${key}|${value}|${variableId}`;
		})
		.sort();

	return hashStringFNV1a(normalized.join("||"));
}
