/// <reference lib="dom" />

import {
	AUTOCOMPLETE_MAX_RESULTS,
	PLUGIN_COLLECTION_NAME,
	PLUGIN_MESSAGE_ID,
	PLUGIN_WINDOW_HEIGHT,
	PLUGIN_WINDOW_HEIGHT_MIN,
	PLUGIN_WINDOW_WIDTH,
	PLUGIN_WINDOW_WIDTH_MIN,
} from "./CONSTANTS";
import type { PluginMessage } from "./plugin/types";
import USER_MESSAGES from "./USER_MESSAGES";

type AutocompleteTarget = {
	wordStart?: number;
	wordEnd?: number;
	nodeId?: string;
} | null;

function getRequiredElement<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id);
	if (!el) {
		throw new Error(
			`UI initialization failed: missing required DOM element "${id}".`,
		);
	}
	return el as T;
}

const collectionEl = getRequiredElement<HTMLSelectElement>("collection");
const iconFontFamilyEl =
	getRequiredElement<HTMLInputElement>("icon-font-family");
const iconFontStyleEl = getRequiredElement<HTMLInputElement>("icon-font-style");
const toggleEl = getRequiredElement<HTMLInputElement>("toggle");
const statusEl = getRequiredElement<HTMLDivElement>("status");
const runBtn = getRequiredElement<HTMLButtonElement>("run");
const restoreBtn = getRequiredElement<HTMLButtonElement>("restore");
const runPageBtn = getRequiredElement<HTMLButtonElement>("run-page");
const restorePageBtn = getRequiredElement<HTMLButtonElement>("restore-page");
const recoverStaleBtn = getRequiredElement<HTMLButtonElement>("recover-stale");
const recoverStalePageBtn =
	getRequiredElement<HTMLButtonElement>("recover-stale-page");
const minimizeBtn = getRequiredElement<HTMLButtonElement>("minimize");
const closeBtn = getRequiredElement<HTMLButtonElement>("close");
const maximizeBtn = getRequiredElement<HTMLButtonElement>("maximize");
const autocompletePanel =
	getRequiredElement<HTMLDivElement>("autocomplete-panel");

parent.postMessage({ pluginMessage: { type: "init" } }, "*");

let allVariablesForAutocomplete: string[] = [];
let currentAutocompleteTarget: AutocompleteTarget = null;

function collectFuzzyMatchPositions(
	candidate: string,
	query: string,
): number[] | null {
	const c = String(candidate || "").toLowerCase();
	const q = String(query || "")
		.toLowerCase()
		.trim();
	if (!q) return [];
	if (!c) return null;

	const positions: number[] = [];
	let qi = 0;

	for (let i = 0; i < c.length && qi < q.length; i++) {
		if (c[i] === q[qi]) {
			positions.push(i);
			qi++;
		}
	}

	if (qi !== q.length) return null;
	return positions;
}

function computeFuzzyScore(
	candidate: string,
	query: string,
	positions: number[] | null,
): number {
	const c = String(candidate || "").toLowerCase();
	const q = String(query || "")
		.toLowerCase()
		.trim();

	if (!q) return 1;
	if (!c || !positions) return -Infinity;

	let score = 0;

	if (c === q) score += 1000;
	if (c.startsWith(q)) score += 700;
	if (c.includes(`/${q}`) || c.includes(`-${q}`) || c.includes(`_${q}`))
		score += 250;
	if (c.includes(q)) score += 200;

	for (let i = 1; i < positions.length; i++) {
		if (positions[i] === positions[i - 1] + 1) {
			score += 35;
		}

		const prevIdx = positions[i] - 1;
		const prevChar = prevIdx >= 0 ? c[prevIdx] : "";
		if (
			positions[i] === 0 ||
			prevChar === "/" ||
			prevChar === "-" ||
			prevChar === "_"
		) {
			score += 20;
		}
	}

	score += positions.length * 25;
	score -= Math.max(0, c.length - q.length) * 0.5;

	return score;
}

function escapeHtml(text: string): string {
	return String(text || "")
		.split("&")
		.join("&amp;")
		.split("<")
		.join("&lt;")
		.split(">")
		.join("&gt;")
		.split('"')
		.join("&quot;")
		.split("'")
		.join("&#39;");
}

function buildHighlightedLabel(name: string, positions: number[]): string {
	const posSet = new Set(positions || []);
	let html = "@";
	for (let i = 0; i < name.length; i++) {
		const ch = escapeHtml(name[i]);
		if (posSet.has(i)) {
			html += `<span style="font-weight: 700; color: var(--figma-color-text-brand);">${ch}</span>`;
		} else {
			html += ch;
		}
	}
	return html;
}

function getAutocompleteMatches(variables: string[], query: string) {
	const q = String(query || "")
		.toLowerCase()
		.trim();
	const ranked: Array<{ name: string; score: number; positions: number[] }> =
		[];

	for (const name of variables || []) {
		const positions = collectFuzzyMatchPositions(name, q);
		const score = computeFuzzyScore(name, q, positions);
		if (score > -Infinity) {
			ranked.push({ name, score, positions: positions || [] });
		}
	}

	ranked.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (a.name.length !== b.name.length) return a.name.length - b.name.length;
		return a.name.localeCompare(b.name);
	});

	return ranked.slice(0, AUTOCOMPLETE_MAX_RESULTS);
}

window.addEventListener("message", (event: MessageEvent) => {
	const data = event.data as { pluginMessage?: PluginMessage } | null;
	const msg = data?.pluginMessage;
	if (!msg) return;

	if (msg.type === "init") {
		if (msg.autocompleteVars) {
			allVariablesForAutocomplete = msg.autocompleteVars;
		}

		collectionEl.innerHTML = "";
		(msg.collections || []).forEach((name: string) => {
			const opt = document.createElement("option");
			opt.value = name;
			opt.textContent = name;
			collectionEl.appendChild(opt);
		});

		const createOpt = document.createElement("option");
		createOpt.value = PLUGIN_COLLECTION_NAME;
		createOpt.textContent = `Create "${PLUGIN_COLLECTION_NAME}"`;
		collectionEl.appendChild(createOpt);

		toggleEl.checked = !!msg.enabled;
		if (msg.collection) collectionEl.value = msg.collection;
		if (msg.iconFontFamily) iconFontFamilyEl.value = msg.iconFontFamily;
		if (msg.iconFontStyle) iconFontStyleEl.value = msg.iconFontStyle;
		statusEl.textContent = `Feature ${toggleEl.checked ? "ON" : "OFF"} • collection: ${collectionEl.value}`;

		parent.postMessage(
			{
				pluginMessage: {
					type: PLUGIN_MESSAGE_ID.RESIZE,
					width: PLUGIN_WINDOW_WIDTH,
					height: PLUGIN_WINDOW_HEIGHT,
				},
			},
			"*",
		);
	} else if (msg.type === PLUGIN_MESSAGE_ID.AUTOCOMPLETE_QUERY) {
		const matches = getAutocompleteMatches(
			allVariablesForAutocomplete,
			msg.query ?? "",
		);

		if (matches.length > 0) {
			autocompletePanel.innerHTML = "";
			autocompletePanel.style.display = "block";
			currentAutocompleteTarget = {
				wordStart: msg.wordStart,
				wordEnd: msg.wordEnd,
				nodeId: msg.nodeId,
			};

			if (document.body.classList.contains("minimized")) {
				parent.postMessage(
					{
						pluginMessage: {
							type: "resize",
							width: Math.max(PLUGIN_WINDOW_WIDTH_MIN, 250),
							height: 200,
						},
					},
					"*",
				);
			}

			matches.forEach((match) => {
				const div = document.createElement("div");
				div.className = "ac-item";
				div.innerHTML = buildHighlightedLabel(match.name, match.positions);
				div.onclick = () => {
					parent.postMessage(
						{
							pluginMessage: {
								type: PLUGIN_MESSAGE_ID.AUTOCOMPLETE_APPLY,
								text: `@${match.name}`,
								...currentAutocompleteTarget,
							},
						},
						"*",
					);
				};
				autocompletePanel.appendChild(div);
			});
		} else {
			autocompletePanel.style.display = "none";
			currentAutocompleteTarget = null;
			if (document.body.classList.contains("minimized")) {
				parent.postMessage(
					{
						pluginMessage: {
							type: PLUGIN_MESSAGE_ID.RESIZE,
							width: PLUGIN_WINDOW_WIDTH_MIN,
							height: PLUGIN_WINDOW_HEIGHT_MIN,
						},
					},
					"*",
				);
			}
		}
	} else if (msg.type === PLUGIN_MESSAGE_ID.AUTOCOMPLETE_CLOSE) {
		autocompletePanel.style.display = "none";
		currentAutocompleteTarget = null;
		if (document.body.classList.contains("minimized")) {
			parent.postMessage(
				{
					pluginMessage: {
						type: PLUGIN_MESSAGE_ID.RESIZE,
						width: PLUGIN_WINDOW_WIDTH_MIN,
						height: PLUGIN_WINDOW_HEIGHT_MIN,
					},
				},
				"*",
			);
		}
	} else if (msg.type === PLUGIN_MESSAGE_ID.STATUS) {
		statusEl.textContent = msg.text ?? "";
	} else if (msg.type === PLUGIN_MESSAGE_ID.RUN_RESULT) {
		const count = Array.isArray(msg.results) ? msg.results.length : 0;
		statusEl.textContent = `Done: ${count} nodes processed.`;
	}
});

function sendSettings() {
	parent.postMessage(
		{
			pluginMessage: {
				type: "set",
				enabled: toggleEl.checked,
				collection: collectionEl.value,
				iconFontFamily: iconFontFamilyEl.value,
				iconFontStyle: iconFontStyleEl.value,
			},
		},
		"*",
	);
	statusEl.textContent = `Feature ${toggleEl.checked ? "ON" : "OFF"} • collection: ${collectionEl.value}`;
}

collectionEl.onchange = sendSettings;
iconFontFamilyEl.onchange = sendSettings;
iconFontStyleEl.onchange = sendSettings;
toggleEl.onchange = sendSettings;

runBtn.onclick = () => {
	parent.postMessage(
		{ pluginMessage: { type: PLUGIN_MESSAGE_ID.RUN_ON_SELECTION } },
		"*",
	);
	statusEl.textContent = USER_MESSAGES.FEEDBACK.RUN_ON_SELECTION;
};

restoreBtn.onclick = () => {
	parent.postMessage(
		{ pluginMessage: { type: PLUGIN_MESSAGE_ID.RESTORE_ON_SELECTION } },
		"*",
	);
	statusEl.textContent = USER_MESSAGES.FEEDBACK.RESTORE_ON_SELECTION;
};

runPageBtn.onclick = () => {
	parent.postMessage(
		{ pluginMessage: { type: PLUGIN_MESSAGE_ID.RUN_ON_PAGE } },
		"*",
	);
	statusEl.textContent = USER_MESSAGES.FEEDBACK.RUN_ON_PAGE;
};

restorePageBtn.onclick = () => {
	parent.postMessage(
		{ pluginMessage: { type: PLUGIN_MESSAGE_ID.RESTORE_ON_PAGE } },
		"*",
	);
	statusEl.textContent = USER_MESSAGES.FEEDBACK.RESTORE_ON_PAGE;
};

recoverStaleBtn.onclick = () => {
	parent.postMessage(
		{ pluginMessage: { type: PLUGIN_MESSAGE_ID.RECOVER_STALE_ON_SELECTION } },
		"*",
	);
	statusEl.textContent = USER_MESSAGES.FEEDBACK.RECOVER_STALE_ON_SELECTION;
};

recoverStalePageBtn.onclick = () => {
	parent.postMessage(
		{ pluginMessage: { type: PLUGIN_MESSAGE_ID.RECOVER_STALE_ON_PAGE } },
		"*",
	);
	statusEl.textContent = USER_MESSAGES.FEEDBACK.RECOVER_STALE_ON_PAGE;
};

minimizeBtn.onclick = () => {
	document.body.classList.add("minimized");
	parent.postMessage(
		{
			pluginMessage: {
				type: PLUGIN_MESSAGE_ID.RESIZE,
				width: PLUGIN_WINDOW_WIDTH_MIN,
				height: PLUGIN_WINDOW_HEIGHT_MIN,
			},
		},
		"*",
	);
};

maximizeBtn.onclick = () => {
	document.body.classList.remove("minimized");
	parent.postMessage(
		{
			pluginMessage: {
				type: PLUGIN_MESSAGE_ID.RESIZE,
				width: PLUGIN_WINDOW_WIDTH,
				height: PLUGIN_WINDOW_HEIGHT,
			},
		},
		"*",
	);
};

closeBtn.onclick = () => {
	parent.postMessage({ pluginMessage: { type: PLUGIN_MESSAGE_ID.CLOSE } }, "*");
};
