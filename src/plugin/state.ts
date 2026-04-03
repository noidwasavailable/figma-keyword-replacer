import {
	DEFAULT_COLLECTION_NAME,
	DEFAULT_ICON_FONT_STYLE,
	DOC_SETTINGS_KEY,
} from "./constants";
import type { DocSettings, PluginRuntimeState } from "./types";

type PartialDocSettings = Partial<DocSettings>;

function toNonEmptyString(value: unknown, fallback: string): string {
	const s = String(value ?? "").trim();
	return s.length > 0 ? s : fallback;
}

function sanitizeDocSettings(input: unknown): DocSettings {
	const raw =
		input && typeof input === "object"
			? (input as Partial<Record<keyof DocSettings, unknown>>)
			: {};

	return {
		collection: toNonEmptyString(raw.collection, DEFAULT_COLLECTION_NAME),
		iconFontFamily: String(raw.iconFontFamily ?? "").trim(),
		iconFontStyle: toNonEmptyString(raw.iconFontStyle, DEFAULT_ICON_FONT_STYLE),
	};
}

export function getDefaultDocSettings(): DocSettings {
	return {
		collection: DEFAULT_COLLECTION_NAME,
		iconFontFamily: "",
		iconFontStyle: DEFAULT_ICON_FONT_STYLE,
	};
}

export function loadDocSettings(): DocSettings {
	try {
		const raw = figma.root.getPluginData(DOC_SETTINGS_KEY);
		if (!raw) return getDefaultDocSettings();

		const parsed = JSON.parse(raw);
		return sanitizeDocSettings(parsed);
	} catch (error) {
		console.warn("Failed to load doc settings", error);
		return getDefaultDocSettings();
	}
}

export function saveDocSettings(settings: PartialDocSettings): DocSettings {
	const normalized = sanitizeDocSettings({
		...getDefaultDocSettings(),
		...settings,
	});

	try {
		figma.root.setPluginData(DOC_SETTINGS_KEY, JSON.stringify(normalized));
	} catch (error) {
		console.warn("Failed to save doc settings", error);
	}

	return normalized;
}

export function createRuntimeState(
	overrides?: Partial<PluginRuntimeState>,
): PluginRuntimeState {
	const docSettings = loadDocSettings();

	return {
		featureEnabled: true,
		chosenCollection: docSettings.collection,
		iconFontFamily: docSettings.iconFontFamily,
		iconFontStyle: docSettings.iconFontStyle,
		activeNodeOriginalText: "",
		lastSelectedNodeId: null,
		processing: false,
		...overrides,
	};
}

export function patchRuntimeState(
	state: PluginRuntimeState,
	patch: Partial<PluginRuntimeState>,
): PluginRuntimeState {
	return { ...state, ...patch };
}

export function toDocSettingsFromRuntime(
	state: PluginRuntimeState,
): DocSettings {
	return sanitizeDocSettings({
		collection: state.chosenCollection,
		iconFontFamily: state.iconFontFamily,
		iconFontStyle: state.iconFontStyle,
	});
}
