import { DEFAULT_ICON_FONT_STYLE } from "./constants";

export type DebugLog = (...args: unknown[]) => void;

function isFontName(value: unknown): value is FontName {
	if (!value || typeof value !== "object") return false;

	const maybeFont = value as Partial<FontName>;
	return (
		typeof maybeFont.family === "string" &&
		maybeFont.family.length > 0 &&
		typeof maybeFont.style === "string" &&
		maybeFont.style.length > 0
	);
}

export function normalizeFontToken(value: unknown): string {
	return String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ");
}

export function isFontMatch(
	font: unknown,
	family: string,
	style?: string,
	allowFamilyFallback = false,
): boolean {
	if (!isFontName(font)) return false;
	if (!family) return false;

	const fontFamily = normalizeFontToken(font.family);
	const targetFamily = normalizeFontToken(family);

	if (!fontFamily || !targetFamily || fontFamily !== targetFamily) return false;

	const hasTargetStyle = Boolean(String(style ?? "").trim());
	if (!hasTargetStyle) return true;

	const fontStyle = normalizeFontToken(font.style);
	const targetStyle = normalizeFontToken(style);

	if (fontStyle === targetStyle) return true;
	return Boolean(allowFamilyFallback);
}

export async function safeLoadFonts(
	fonts: ReadonlyArray<unknown> | null | undefined,
): Promise<boolean> {
	try {
		const unique: FontName[] = [];
		const seen = new Set<string>();

		for (const raw of fonts ?? []) {
			if (!isFontName(raw)) continue;

			const key = `${raw.family}__${raw.style}`;
			if (seen.has(key)) continue;

			seen.add(key);
			unique.push(raw);
		}

		for (const font of unique) {
			try {
				await figma.loadFontAsync(font);
			} catch (_error) {
				return false;
			}
		}

		return true;
	} catch (_error) {
		return false;
	}
}

export async function safeLoadFontsForNode(
	node: BaseNode | null | undefined,
	debugLog?: DebugLog,
): Promise<boolean> {
	try {
		if (!node || node.type !== "TEXT") return false;

		if (node.hasMissingFont) {
			debugLog?.("Skipping text mutation due to missing font", {
				nodeId: node.id,
			});
			return false;
		}

		const textLength = node.characters.length;
		if (textLength <= 0) return true;

		const fonts = node.getRangeAllFontNames(0, textLength) || [];
		return await safeLoadFonts(fonts);
	} catch (_error) {
		return false;
	}
}

export async function loadIconFontIfConfigured(
	iconFontFamily: string,
	iconFontStyle = DEFAULT_ICON_FONT_STYLE,
): Promise<boolean> {
	const family = String(iconFontFamily ?? "").trim();
	if (!family) return false;

	try {
		await figma.loadFontAsync({
			family,
			style: String(iconFontStyle ?? "").trim() || DEFAULT_ICON_FONT_STYLE,
		});
		return true;
	} catch (error) {
		console.warn("Failed to load icon font", error);
		return false;
	}
}

export function pickNormalFontFromNodeSegments(
	node: TextNode,
	iconFontFamily: string,
	iconFontStyle: string,
): FontName | null {
	try {
		const segments = node.getStyledTextSegments(["fontName"]);

		for (const segment of segments) {
			const font = segment.fontName;
			if (!isFontName(font)) continue;

			if (!iconFontFamily) return font;

			if (!isFontMatch(font, iconFontFamily, iconFontStyle, true)) {
				return font;
			}
		}
	} catch (_error) {
		// ignore
	}

	return null;
}
