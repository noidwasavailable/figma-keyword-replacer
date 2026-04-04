import { PLUGIN_MESSAGE_ID } from "../CONSTANTS";
import { clearNodeBackup, readNodeBackup } from "./backup";
import { DEBUG_LOGS, UI_DEFAULT_HEIGHT, UI_DEFAULT_WIDTH } from "./constants";
import { safeLoadFontsForNode } from "./fonts";
import { gatherTextNodesFromSelectionOrPage } from "./nodes";
import { createRuntimeState, saveDocSettings } from "./state";
import {
	recoverStaleBackupInNode,
	replacePlaceholdersInNode,
	restorePlaceholdersInNode,
} from "./text-processing";
import { debounce } from "./timing";
import { createDebugLogger } from "./utils";

type UiMessage = Record<string, unknown>;

const debugLog = createDebugLogger(DEBUG_LOGS);
let started = false;

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getSelectedSingleTextNode(): TextNode | null {
	const selection = figma.currentPage.selection;
	if (selection.length !== 1) return null;
	const node = selection[0];
	return node.type === "TEXT" ? node : null;
}

function buildProcessingOptions(state: ReturnType<typeof createRuntimeState>) {
	return {
		collectionName: state.chosenCollection,
		iconFontFamily: state.iconFontFamily,
		iconFontStyle: state.iconFontStyle,
		debugLog,
	};
}

function handleTextEditForAutocomplete(
	node: TextNode,
	oldText: string,
	newText: string,
): void {
	if (newText === oldText) return;

	let startDiff = 0;
	while (
		startDiff < oldText.length &&
		startDiff < newText.length &&
		oldText[startDiff] === newText[startDiff]
	) {
		startDiff++;
	}

	let oldEndDiff = oldText.length - 1;
	let newEndDiff = newText.length - 1;
	while (
		oldEndDiff >= startDiff &&
		newEndDiff >= startDiff &&
		oldText[oldEndDiff] === newText[newEndDiff]
	) {
		oldEndDiff--;
		newEndDiff--;
	}

	const cursorApprox = newEndDiff + 1;

	let wordStart = cursorApprox;
	while (wordStart > 0) {
		const prevChar = newText[wordStart - 1];
		if (/\s/.test(prevChar)) break;
		if (prevChar === "@") {
			wordStart--;
			break;
		}
		wordStart--;
	}

	let wordEnd = cursorApprox;
	while (wordEnd < newText.length) {
		const char = newText[wordEnd];
		if (/\s/.test(char)) break;
		if (char === "@" && wordEnd > wordStart) break;
		wordEnd++;
	}

	const word = newText.substring(wordStart, wordEnd);

	if (word.startsWith("@")) {
		figma.ui.postMessage({
			type: PLUGIN_MESSAGE_ID.AUTOCOMPLETE_QUERY,
			query: word.slice(1),
			wordStart,
			wordEnd,
			nodeId: node.id,
		});
	} else {
		figma.ui.postMessage({ type: PLUGIN_MESSAGE_ID.AUTOCOMPLETE_CLOSE });
	}
}

async function getAutocompleteVarNames(
	collectionName: string,
): Promise<string[]> {
	try {
		const cols = await figma.variables.getLocalVariableCollectionsAsync();
		const selectedCollection =
			cols.find((c) => c.name === collectionName) ?? cols[0];
		if (!selectedCollection) return [];

		const vars = await figma.variables.getLocalVariablesAsync("STRING");
		return vars
			.filter((v) => v.variableCollectionId === selectedCollection.id)
			.map((v) => v.name);
	} catch (error) {
		console.warn("Failed fetching autocomplete vars", error);
		return [];
	}
}

export async function startPluginController(): Promise<void> {
	if (started) return;
	started = true;

	const state = createRuntimeState();

	figma.showUI(__html__, {
		width: UI_DEFAULT_WIDTH,
		height: UI_DEFAULT_HEIGHT,
		themeColors: true,
	});

	async function sendInitStateToUI() {
		const cols = await figma.variables.getLocalVariableCollectionsAsync();
		const autocompleteVars = await getAutocompleteVarNames(
			state.chosenCollection,
		);

		figma.ui.postMessage({
			type: "init",
			collections: cols.map((c) => c.name),
			enabled: state.featureEnabled,
			collection: state.chosenCollection,
			iconFontFamily: state.iconFontFamily,
			iconFontStyle: state.iconFontStyle,
			autocompleteVars,
		});
	}

	async function runOnNodes(
		nodes: TextNode[],
		operation: "replace" | "restore" | "recover-stale",
	) {
		const results: Array<Record<string, unknown>> = [];

		for (const node of nodes) {
			if (operation === "replace") {
				const r = await replacePlaceholdersInNode(
					node,
					buildProcessingOptions(state),
				);
				results.push({ id: node.id, changed: r.changed });
				continue;
			}

			if (operation === "restore") {
				const r = await restorePlaceholdersInNode(
					node,
					buildProcessingOptions(state),
				);
				results.push({ id: node.id, restored: r.restored });
				continue;
			}

			const r = await recoverStaleBackupInNode(
				node,
				buildProcessingOptions(state),
			);
			results.push({
				id: node.id,
				recovered: !!r.recovered,
				recoveredCount: r.recoveredCount ?? 0,
				totalCandidates: r.totalCandidates ?? 0,
				skipped: !!r.skipped,
				reason: r.reason ?? "",
			});
		}

		figma.ui.postMessage({ type: PLUGIN_MESSAGE_ID.RUN_RESULT, results });
	}

	async function handleSelectionChange(): Promise<void> {
		if (!state.featureEnabled) return;
		if (state.processing) return;

		const newSelectedNode = getSelectedSingleTextNode();
		const newId = newSelectedNode ? newSelectedNode.id : null;

		debugLog("selectionchange", {
			lastSelectedNodeId: state.lastSelectedNodeId,
			newId,
			selectionCount: figma.currentPage.selection.length,
		});

		if (state.lastSelectedNodeId && state.lastSelectedNodeId !== newId) {
			try {
				state.processing = true;
				const prevNode = await figma.getNodeByIdAsync(state.lastSelectedNodeId);
				if (prevNode && prevNode.type === "TEXT") {
					const result = await replacePlaceholdersInNode(
						prevNode,
						buildProcessingOptions(state),
					);
					debugLog("Replace result", { nodeId: prevNode.id, result });
				}
			} catch (error) {
				console.warn(
					"Error processing previous node on selection change",
					error,
				);
			} finally {
				state.processing = false;
			}
		}

		if (newSelectedNode && newId !== state.lastSelectedNodeId) {
			try {
				state.processing = true;
				const result = await restorePlaceholdersInNode(
					newSelectedNode,
					buildProcessingOptions(state),
				);
				debugLog("Restore result", { nodeId: newSelectedNode.id, result });
			} catch (error) {
				console.warn("Error restoring node on selection change", error);
			} finally {
				state.processing = false;
			}
		}

		if (newSelectedNode) {
			state.activeNodeOriginalText = newSelectedNode.characters;
		} else {
			state.activeNodeOriginalText = "";
			figma.ui.postMessage({ type: PLUGIN_MESSAGE_ID.AUTOCOMPLETE_CLOSE });
		}

		state.lastSelectedNodeId = newId;
	}

	const debouncedSelectionHandler = debounce(handleSelectionChange, 200);

	figma.on("selectionchange", () => {
		debouncedSelectionHandler();
	});

	void figma.loadAllPagesAsync().then(() => {
		figma.on("documentchange", async (event) => {
			if (!state.featureEnabled || !state.lastSelectedNodeId) return;

			for (const change of event.documentChanges) {
				if (
					change.type === "PROPERTY_CHANGE" &&
					change.id === state.lastSelectedNodeId &&
					change.properties.includes("characters")
				) {
					const node = await figma.getNodeByIdAsync(state.lastSelectedNodeId);
					if (!node || node.type !== "TEXT") continue;

					const hadBackup = Boolean(readNodeBackup(node));
					if (hadBackup) {
						clearNodeBackup(node);
						debugLog("Cleared stale backup after direct text edit", {
							nodeId: node.id,
						});
					}

					handleTextEditForAutocomplete(
						node,
						state.activeNodeOriginalText,
						node.characters,
					);
					state.activeNodeOriginalText = node.characters;
				}
			}
		});
	});

	figma.ui.onmessage = async (raw: unknown) => {
		const msg = (raw && typeof raw === "object" ? raw : {}) as UiMessage;
		const type = asString(msg.type);

		if (type === "init") {
			await sendInitStateToUI();
			return;
		}

		if (type === "set") {
			const previousCollection = state.chosenCollection;

			if (typeof msg.enabled === "boolean") state.featureEnabled = msg.enabled;
			if (typeof msg.collection === "string")
				state.chosenCollection = msg.collection;
			if (typeof msg.iconFontFamily === "string") {
				state.iconFontFamily = msg.iconFontFamily;
			}
			if (typeof msg.iconFontStyle === "string") {
				state.iconFontStyle = msg.iconFontStyle;
			}

			saveDocSettings({
				collection: state.chosenCollection,
				iconFontFamily: state.iconFontFamily,
				iconFontStyle: state.iconFontStyle,
			});

			figma.ui.postMessage({
				type: "status",
				text: `Feature ${state.featureEnabled ? "ON" : "OFF"}, collection: ${state.chosenCollection}`,
			});

			if (previousCollection !== state.chosenCollection) {
				await sendInitStateToUI();
			}
			return;
		}

		if (type === PLUGIN_MESSAGE_ID.RUN_ON_SELECTION) {
			await runOnNodes(
				gatherTextNodesFromSelectionOrPage({ useSelectionOnly: true }),
				"replace",
			);
			return;
		}

		if (type === PLUGIN_MESSAGE_ID.RESTORE_ON_SELECTION) {
			await runOnNodes(
				gatherTextNodesFromSelectionOrPage({ useSelectionOnly: true }),
				"restore",
			);
			return;
		}

		if (type === PLUGIN_MESSAGE_ID.RUN_ON_PAGE) {
			await runOnNodes(
				gatherTextNodesFromSelectionOrPage({ useSelectionOnly: false }),
				"replace",
			);
			return;
		}

		if (type === PLUGIN_MESSAGE_ID.RESTORE_ON_PAGE) {
			await runOnNodes(
				gatherTextNodesFromSelectionOrPage({ useSelectionOnly: false }),
				"restore",
			);
			return;
		}

		if (type === PLUGIN_MESSAGE_ID.RECOVER_STALE_ON_SELECTION) {
			await runOnNodes(
				gatherTextNodesFromSelectionOrPage({ useSelectionOnly: true }),
				"recover-stale",
			);
			return;
		}

		if (type === PLUGIN_MESSAGE_ID.RECOVER_STALE_ON_PAGE) {
			await runOnNodes(
				gatherTextNodesFromSelectionOrPage({ useSelectionOnly: false }),
				"recover-stale",
			);
			return;
		}

		if (type === PLUGIN_MESSAGE_ID.AUTOCOMPLETE_APPLY) {
			const text = asString(msg.text);
			const nodeId = asString(msg.nodeId);
			const wordStart = asNumber(msg.wordStart);
			const wordEnd = asNumber(msg.wordEnd);

			if (!nodeId || wordStart === null || wordEnd === null) return;

			try {
				const node = await figma.getNodeByIdAsync(nodeId);
				if (!node || node.type !== "TEXT") return;

				const fontsReady = await safeLoadFontsForNode(node, debugLog);
				if (!fontsReady) return;

				node.deleteCharacters(wordStart, wordEnd);
				node.insertCharacters(wordStart, text, "BEFORE");

				state.activeNodeOriginalText = node.characters;
				figma.ui.postMessage({ type: PLUGIN_MESSAGE_ID.AUTOCOMPLETE_CLOSE });
			} catch (error) {
				console.warn("Failed to apply autocomplete", error);
			}
			return;
		}

		if (type === PLUGIN_MESSAGE_ID.RESIZE) {
			const width = asNumber(msg.width);
			const height = asNumber(msg.height);
			if (width !== null && height !== null) figma.ui.resize(width, height);
			return;
		}

		if (type === PLUGIN_MESSAGE_ID.HIDE) {
			figma.ui.hide();
			return;
		}

		if (type === PLUGIN_MESSAGE_ID.CLOSE) {
			figma.closePlugin();
		}
	};

	await sendInitStateToUI();
}
