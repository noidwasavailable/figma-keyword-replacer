import { DEFAULT_COLLECTION_NAME } from "./constants";
import {
	computeIconMappingHashFromEntries,
	isIconTokenKey,
	normalizeTokenKey,
} from "./utils";

export type VariableConsumer = SceneNode | null | undefined;

export async function getOrCreateCollection(
	name: string = DEFAULT_COLLECTION_NAME,
): Promise<VariableCollection> {
	const localCollections =
		await figma.variables.getLocalVariableCollectionsAsync();
	const existing = localCollections.find((c) => c.name === name);
	if (existing) return existing;
	return figma.variables.createVariableCollection(name);
}

export async function findStringVariable(
	collection: VariableCollection,
	key: string,
): Promise<Variable | null> {
	const vars = await figma.variables.getLocalVariablesAsync("STRING");
	const normalizedKey = normalizeTokenKey(key);

	return (
		vars.find(
			(v) =>
				v.variableCollectionId === collection.id &&
				normalizeTokenKey(v.name) === normalizedKey,
		) ?? null
	);
}

export async function resolveVariableValue(
	variable: Variable,
	consumer?: VariableConsumer,
): Promise<string> {
	try {
		const maybeResolver = variable as Variable & {
			resolveForConsumer?: (node: SceneNode) => { value: unknown };
		};

		if (consumer && typeof maybeResolver.resolveForConsumer === "function") {
			const resolved = maybeResolver.resolveForConsumer(consumer);
			return typeof resolved.value === "string"
				? resolved.value
				: String(resolved.value ?? "");
		}

		const vals = (variable.valuesByMode ?? {}) as Record<string, unknown>;
		const firstKey = Object.keys(vals)[0];
		const value = firstKey ? vals[firstKey] : "";
		return typeof value === "string" ? value : String(value ?? "");
	} catch (error) {
		console.warn("resolveVariableValue error", error);
		return "";
	}
}

export async function resolveCurrentValuesForTokenKeys(
	collectionName: string | undefined,
	tokenKeys: string[],
	consumer?: VariableConsumer,
): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	const seen = new Set<string>();

	for (const key of tokenKeys ?? []) {
		const normalized = normalizeTokenKey(key);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
	}

	if (seen.size === 0) return out;

	const collection = await getOrCreateCollection(
		collectionName || DEFAULT_COLLECTION_NAME,
	);

	for (const key of seen) {
		const variable = await findStringVariable(collection, key);
		if (!variable) continue;
		out[key] = await resolveVariableValue(variable, consumer);
	}

	return out;
}

export async function computeCurrentIconMappingHash(
	collectionName: string | undefined,
	iconKeys: string[],
	consumer?: VariableConsumer,
): Promise<string> {
	const normalizedIconKeys = [
		...new Set((iconKeys ?? []).map((k) => normalizeTokenKey(k))),
	].filter((k) => isIconTokenKey(k));

	if (normalizedIconKeys.length === 0) return "";

	const collection = await getOrCreateCollection(
		collectionName || DEFAULT_COLLECTION_NAME,
	);

	const entries: Array<{ key: string; value: string; variableId: string }> = [];

	for (const key of normalizedIconKeys) {
		const variable = await findStringVariable(collection, key);
		if (!variable) continue;

		const value = await resolveVariableValue(variable, consumer);
		entries.push({
			key,
			value: typeof value === "string" ? value : String(value ?? ""),
			variableId: variable.id || "",
		});
	}

	return computeIconMappingHashFromEntries(entries);
}

export async function buildIconGlyphToTokenMap(
	collectionName: string | undefined,
	consumer?: VariableConsumer,
	seedValuesByToken?: Record<string, string>,
): Promise<Record<string, string>> {
	const map: Record<string, string> = {};

	const markGlyphToken = (glyph: string, tokenKey: string) => {
		const g = String(glyph ?? "");
		const key = normalizeTokenKey(tokenKey);

		if (!g || !key || !isIconTokenKey(key)) return;

		if (!(g in map)) {
			map[g] = key;
			return;
		}

		if (map[g] !== key) {
			map[g] = map[g] < key ? map[g] : key;
		}
	};

	const seeded = seedValuesByToken ?? {};
	for (const tokenKey in seeded) {
		if (!(tokenKey in seeded)) continue;
		markGlyphToken(seeded[tokenKey], tokenKey);
	}

	const collection = await getOrCreateCollection(
		collectionName || DEFAULT_COLLECTION_NAME,
	);
	const vars = await figma.variables.getLocalVariablesAsync("STRING");

	for (const variable of vars) {
		if (!variable || variable.variableCollectionId !== collection.id) continue;

		const key = normalizeTokenKey(variable.name);
		if (!isIconTokenKey(key)) continue;

		const value = await resolveVariableValue(variable, consumer);
		markGlyphToken(value, key);
	}

	return map;
}
