// Keyword Replacer - code.js
// Searches text nodes for @keyword, replaces with STRING variable values on edit exit,
// and restores @keyword when node is selected (edit start). Uses node pluginData to store backups.

/* CONFIG */
const PLACEHOLDER_REGEX = /@[\w-]+(?:\/[\w-]+)*\b/g;
const PLUGIN_DATA_KEY = "prr:backup"; // stores JSON backup payload (versioned)
const DOC_SETTINGS_KEY = "prr:settings";
const DEFAULT_COLLECTION_NAME = "Keywords";
const DEBUG_LOGS = false;
const BACKUP_SCHEMA_VERSION = 2;

/* Utility: safe get/create collection */
async function getOrCreateCollection(name) {
  const localCollections =
    await figma.variables.getLocalVariableCollectionsAsync();
  let collection = localCollections.find((c) => c.name === name);
  if (!collection) {
    collection = figma.variables.createVariableCollection(name);
  }
  return collection;
}

/* Utility: find STRING variable inside a collection (or any collection) */
async function findStringVariable(collection, key) {
  const vars = await figma.variables.getLocalVariablesAsync('STRING');
  const normalize = (s) => String(s || "").trim().toLowerCase().replace(/^@/, "");
  const normalizedKey = normalize(key);
  return (
    vars.find(
      (v) =>
        v.variableCollectionId === collection.id &&
        normalize(v.name) === normalizedKey,
    ) || null
  );
}

/* Resolve variable value (string) for a consumer node if possible */
async function resolveVariableValue(variable, consumer) {
  try {
    if (consumer && typeof variable.resolveForConsumer === "function") {
      const resolved = variable.resolveForConsumer(consumer);
      return resolved.value ? resolved.value : "";
    } else {
      const vals = variable.valuesByMode || {};
      const firstKey = Object.keys(vals)[0];
      const v = vals[firstKey];
      return typeof v === "string" ? v : String(v ? v : "");
    }
  } catch (e) {
    console.warn("resolveVariableValue error", e);
    return "";
  }
}

/* Save backup to node pluginData */
function saveNodeBackup(
  node,
  originalText,
  snapshot,
  collectionName,
  replacements,
  meta,
) {
  const payload = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    original: originalText,
    snapshot: snapshot || {},
    collection: collectionName || DEFAULT_COLLECTION_NAME,
    replacements: replacements || [],
    mappingHash: (meta && meta.mappingHash) || "",
    replacedTextHash: (meta && meta.replacedTextHash) || "",
    ts: Date.now(),
  };
  try {
    node.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("Failed to set plugin data", e);
  }
}

/* Read backup from node pluginData */
function readNodeBackup(node) {
  try {
    const raw = node.getPluginData(PLUGIN_DATA_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Failed to read plugin data", e);
    return null;
  }
}

/* Clear backup */
function clearNodeBackup(node) {
  try {
    node.setPluginData(PLUGIN_DATA_KEY, "");
  } catch (e) {
    console.warn("clear plugin data failed", e);
  }
}

function debugLog(...args) {
  if (!DEBUG_LOGS) return;
  console.log("[PRR]", ...args);
}

function normalizeTokenKey(input) {
  return String(input || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function isIconTokenKey(key) {
  return normalizeTokenKey(key).startsWith("icon/");
}

// Fast deterministic hash for backup integrity checks
function hashStringFNV1a(str) {
  let h = 0x811c9dc5;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h +=
      (h << 1) +
      (h << 4) +
      (h << 7) +
      (h << 8) +
      (h << 24);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function computeIconMappingHashFromEntries(entries) {
  const normalized = (entries || [])
    .filter(Boolean)
    .map((entry) => {
      const key = normalizeTokenKey(entry.key);
      const value = String(entry.value || "");
      const variableId = String(entry.variableId || "");
      return `${key}|${value}|${variableId}`;
    })
    .sort();
  return hashStringFNV1a(normalized.join("||"));
}

async function computeCurrentIconMappingHash(collectionName, iconKeys, consumer) {
  const normalizedKeys = [...new Set((iconKeys || []).map(normalizeTokenKey))]
    .filter((k) => k.startsWith("icon/"));

  if (normalizedKeys.length === 0) return "";

  const collection = await getOrCreateCollection(
    collectionName || DEFAULT_COLLECTION_NAME,
  );

  const entries = [];
  for (const key of normalizedKeys) {
    const variable = await findStringVariable(collection, key);
    if (!variable) continue;

    const value = await resolveVariableValue(variable, consumer);
    entries.push({
      key,
      value: typeof value === "string" ? value : String(value || ""),
      variableId: variable.id || "",
    });
  }

  return computeIconMappingHashFromEntries(entries);
}

function migrateBackupPayload(node, backup) {
  if (!backup) return null;
  if (backup.schemaVersion === BACKUP_SCHEMA_VERSION) return backup;

  const legacyReplacements = Array.isArray(backup.replacements)
    ? backup.replacements
    : [];
  if (!legacyReplacements.length) return backup;

  const snapshot = backup.snapshot || {};
  const migratedReplacements = legacyReplacements.map((rep) => {
    const originalText = String(rep.originalText || "");
    const tokenKey = normalizeTokenKey(
      originalText.startsWith("@")
        ? originalText.slice(1)
        : rep.tokenKey || "",
    );
    const valueAtSave =
      typeof snapshot[tokenKey] === "string" ? snapshot[tokenKey] : "";

    return Object.assign({}, rep, {
      tokenKey: tokenKey,
      valueAtSave: valueAtSave,
      variableId: rep.variableId || "",
    });
  });

  const iconEntries = migratedReplacements
    .filter((rep) => isIconTokenKey(rep.tokenKey))
    .map((rep) => ({
      key: rep.tokenKey,
      value: rep.valueAtSave,
      variableId: rep.variableId || "",
    }));

  const migrated = Object.assign({}, backup, {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    replacements: migratedReplacements,
    mappingHash:
      backup.mappingHash || computeIconMappingHashFromEntries(iconEntries),
    replacedTextHash:
      backup.replacedTextHash || hashStringFNV1a(String(node.characters || "")),
  });

  try {
    node.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(migrated));
  } catch (e) {
    console.warn("Failed to persist migrated backup", e);
  }

  return migrated;
}

function isBackupApplicable(node, backup) {
  if (!backup || !Array.isArray(backup.replacements) || backup.replacements.length === 0) {
    return false;
  }

  const currentText = node.characters;

  if (
    backup.schemaVersion === BACKUP_SCHEMA_VERSION &&
    backup.replacedTextHash &&
    backup.replacedTextHash !== hashStringFNV1a(currentText)
  ) {
    return false;
  }

  for (const rep of backup.replacements) {
    if (!rep || typeof rep.start !== "number" || typeof rep.len !== "number") {
      return false;
    }

    if (rep.start < 0 || rep.len < 0 || rep.start + rep.len > currentText.length) {
      return false;
    }

    const originalText = String(rep.originalText || "");
    if (!originalText.startsWith("@")) {
      return false;
    }

    const expectedValue = String(
      typeof rep.valueAtSave === "string"
        ? rep.valueAtSave
        : "",
    );

    const actualValue = currentText.slice(rep.start, rep.start + rep.len);
    if (actualValue !== expectedValue) {
      return false;
    }
  }

  return true;
}

/* Replace placeholders in a TextNode with variable values, save backup */
async function replacePlaceholdersInNode(node, collectionName) {
  const text = node.characters;
  let m;
  const matches = [];
  while ((m = PLACEHOLDER_REGEX.exec(text)) !== null) {
    const token = m[0];
    matches.push({
      key: token.slice(1),
      start: m.index,
      len: token.length,
      text: token,
    });
  }
  if (!matches.length) {
    // Clear backup if no placeholders are found to prevent restoring stale data
    clearNodeBackup(node);
    return { changed: false };
  }

  const collection = await getOrCreateCollection(
    collectionName || DEFAULT_COLLECTION_NAME,
  );

  const snapshot = {};
  const replacements = [];
  const ops = [];
  const iconHashEntries = [];
  let runningDelta = 0;
  let hasIconReplacement = false;

  for (const mm of matches) {
    const variable = await findStringVariable(collection, mm.key);
    if (!variable) continue;
    let resolvedValue = null;

    if (variable) {
      const val = await resolveVariableValue(variable, node);
      resolvedValue = typeof val === "string" ? val : String(val || "");
    }

    // If variable not found, skip replacement
    if (resolvedValue === null) {
      continue;
    }

    snapshot[mm.key] = resolvedValue;

    const tokenKey = normalizeTokenKey(mm.key);

    // Check if this is an icon
    const isIcon = isIconTokenKey(tokenKey);
    if (isIcon) hasIconReplacement = true;

    // Capture original font for restoration
    let originalFont = null;
    try {
      const f = node.getRangeFontName(mm.start, mm.start + 1);
      if (f && f !== figma.mixed) {
        originalFont = f;
      }
    } catch (e) {
      /* ignore */
    }

    // Track for restoration
    const finalStart = mm.start + runningDelta;
    replacements.push({
      start: finalStart,
      len: resolvedValue.length,
      originalText: mm.text,
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

    // Track for replacement
    ops.push({
      start: mm.start,
      removeLen: mm.len,
      insertText: resolvedValue,
      isIcon,
      originalFont, // Store original font for replacement
    });

    runningDelta += resolvedValue.length - mm.len;
  }

  if (ops.length === 0) {
    clearNodeBackup(node);
    return { changed: false };
  }

  // Load fonts to avoid errors when setting characters
  await safeLoadFontsForNode(node);
  // Also load icon font if needed
  let iconFontLoaded = false;
  if (hasIconReplacement && iconFontFamily) {
    try {
      await figma.loadFontAsync({
        family: iconFontFamily,
        style: iconFontStyle || "Regular",
      });
      iconFontLoaded = true;
    } catch (e) {
      console.warn("Failed to load icon font", e);
    }
  }

  // Apply replacements in reverse order to preserve indices
  // ops contains original indices, which are valid if we work right-to-left
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    if (op.insertText.length > 0) {
      // Insert new text, inheriting style from character at op.start
      node.insertCharacters(op.start, op.insertText, "BEFORE");

      const insertEnd = op.start + op.insertText.length;

      if (op.isIcon && iconFontLoaded) {
        node.setRangeFontName(op.start, insertEnd, {
          family: iconFontFamily,
          style: iconFontStyle || "Regular",
        });
      } else if (op.originalFont) {
        // Explicitly apply the original font to the replaced text
        try {
          node.setRangeFontName(op.start, insertEnd, op.originalFont);
        } catch (e) {
          console.warn("Failed to set replaced font", e);
        }
      }
    }
    // Delete old text.
    // If we inserted, old text is shifted by insertText.length.
    const delStart = op.start + op.insertText.length;
    node.deleteCharacters(delStart, delStart + op.removeLen);
  }

  const mappingHash = computeIconMappingHashFromEntries(iconHashEntries);
  const replacedTextHash = hashStringFNV1a(node.characters);

  // Save backup after final text is applied so hash reflects the true replaced state
  saveNodeBackup(node, text, snapshot, collection.name, replacements, {
    mappingHash,
    replacedTextHash,
  });

  return { changed: true, snapshot };
}

/* Restore original placeholder text in node if pluginData exists */
async function restorePlaceholdersInNode(node) {
  let backup = readNodeBackup(node);
  if (!backup) return { restored: false };

  backup = migrateBackupPayload(node, backup);
  if (!backup) return { restored: false };

  const applicable = isBackupApplicable(node, backup);
  if (!applicable) {
    debugLog("Skipping restore due to stale/invalid backup", {
      nodeId: node.id,
      nodeText: node.characters,
      backup,
    });
    clearNodeBackup(node);
    return { restored: false };
  }

  const backupIconKeys = (backup.replacements || [])
    .map((rep) => normalizeTokenKey(rep.tokenKey || rep.originalText))
    .filter((key) => isIconTokenKey(key));

  if (backup.mappingHash && backupIconKeys.length > 0) {
    try {
      const currentHash = await computeCurrentIconMappingHash(
        backup.collection || DEFAULT_COLLECTION_NAME,
        backupIconKeys,
        node,
      );
      if (currentHash && currentHash !== backup.mappingHash) {
        debugLog("Detected icon mapping drift; proceeding with placeholder restore safely", {
          nodeId: node.id,
          backupHash: backup.mappingHash,
          currentHash,
        });
      }
    } catch (e) {
      console.warn("Failed mapping-hash validation during restore", e);
    }
  }

  debugLog("Restoring placeholders from backup", {
    nodeId: node.id,
    replacementCount: backup.replacements.length,
  });

  // Load fonts
  await safeLoadFontsForNode(node);

  // If we have precise replacement tracking, use it to restore styles
  if (backup.replacements && Array.isArray(backup.replacements)) {
    // Sort descending by start index to apply changes right-to-left
    const reps = [...backup.replacements].sort((a, b) => b.start - a.start);

    // Load original fonts for restoration
    const fontsToLoad = [];
    for (const rep of reps) {
      if (rep.originalFont) fontsToLoad.push(rep.originalFont);
    }
    await safeLoadFonts(fontsToLoad);

    for (const rep of reps) {
      if (
        typeof rep.start !== "number" ||
        typeof rep.len !== "number" ||
        rep.start < 0 ||
        rep.len < 0 ||
        rep.start + rep.len > node.characters.length
      ) {
        debugLog("Invalid replacement range during restore; clearing backup", {
          nodeId: node.id,
          rep,
          textLength: node.characters.length,
        });
        clearNodeBackup(node);
        return { restored: false };
      }

      // Insert placeholder
      node.insertCharacters(rep.start, rep.originalText, "BEFORE");

      if (rep.originalFont) {
        try {
          node.setRangeFontName(
            rep.start,
            rep.start + rep.originalText.length,
            rep.originalFont,
          );
        } catch (e) {
          console.warn("Failed to restore font", e);
        }
      }

      // Delete value
      // The value is now shifted by placeholder length
      const delStart = rep.start + rep.originalText.length;
      node.deleteCharacters(delStart, delStart + rep.len);
    }
    clearNodeBackup(node);
    return { restored: true };
  }

  // Fallback for legacy backups (resets styling)
  if (backup.original) {
    node.characters = backup.original;
    clearNodeBackup(node);
    return { restored: true };
  }

  return { restored: false };
}

/* Helper: load a list of fonts safely */
async function safeLoadFonts(fonts) {
  try {
    const unique = [];
    const seen = new Set();
    for (const f of fonts) {
      const k = `${f.family}__${f.style}`;
      if (!seen.has(k)) {
        seen.add(k);
        unique.push(f);
      }
    }
    const promises = unique.map((f) => figma.loadFontAsync(f).catch(() => {}));
    if (promises.length) await Promise.all(promises);
  } catch (e) {
    // ignore
  }
}

/* Load fonts used by a text node; safe wrapper */
async function safeLoadFontsForNode(node) {
  try {
    const segments = node.getStyledTextSegments(["fontName"]);
    const fonts = [];
    for (const seg of segments) {
      const font = seg.fontName;
      if (typeof font === "object" && font.family && font.style) {
        fonts.push(font);
      }
    }
    await safeLoadFonts(fonts);
  } catch (e) {
    // ignore
  }
}

/* Helper: gather text nodes from selection or page (we operate on selection only for perf) */
function gatherTextNodesFromSelectionOrPage(useSelectionOnly = true) {
  const nodes = [];
  if (useSelectionOnly && figma.currentPage.selection.length) {
    const selection = figma.currentPage.selection;
    for (const item of selection) {
      if (item.type === "TEXT") nodes.push(item);
      if (typeof item.findAll === "function") {
        const found = item.findAll((n) => n.type === "TEXT") || [];
        for (const f of found) nodes.push(f);
      }
    }
  } else {
    const all = figma.currentPage.findAll((n) => n.type === "TEXT") || [];
    for (const t of all) nodes.push(t);
  }
  return nodes;
}

/* Debounce helper */
function debounce(fn, wait) {
  let t;
  return function (...a) {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(this, a), wait);
  };
}

/* STATE within plugin runtime */
let featureEnabled = true;
let chosenCollection = DEFAULT_COLLECTION_NAME;
let iconFontFamily = "";
let iconFontStyle = "Regular";
let activeNodeOriginalText = "";

// Load document-wide settings
try {
  const savedRaw = figma.root.getPluginData(DOC_SETTINGS_KEY);
  if (savedRaw) {
    const saved = JSON.parse(savedRaw);
    if (saved.collection) chosenCollection = saved.collection;
    if (saved.iconFontFamily) iconFontFamily = saved.iconFontFamily;
    if (saved.iconFontStyle) iconFontStyle = saved.iconFontStyle;
  }
} catch (e) {
  console.warn("Failed to load doc settings", e);
}

let lastSelectedNodeId = null;
let processing = false;

/* Selection change handler - determines edit start/finish
   Strategy:
   - If lastSelectedNodeId is a TextNode and selection changed away -> consider "edit finish" on that node and run replacement.
   - If new selection is a single TextNode -> consider "edit start" for that node and run restore (so user sees @placeholders).
*/
async function handleSelectionChange() {
  if (!featureEnabled) return;

  // small guard
  if (processing) return;

  const sel = figma.currentPage.selection;
  const newSelectedNode =
    sel.length === 1 && sel[0].type === "TEXT" ? sel[0] : null;
  const newId = newSelectedNode ? newSelectedNode.id : null;

  debugLog("selectionchange", {
    lastSelectedNodeId,
    newId,
    selectionCount: sel.length,
  });

  // If we had a last selected text node that is no longer selected, treat that as edit-finish
  if (lastSelectedNodeId && lastSelectedNodeId !== newId) {
    try {
      processing = true;
      const prevNode = await figma.getNodeByIdAsync(lastSelectedNodeId);
      if (prevNode && prevNode.type === "TEXT") {
        debugLog("Replacing placeholders on deselected node", {
          nodeId: prevNode.id,
          textBefore: prevNode.characters,
        });
        // Replace placeholders -> values
        const result = await replacePlaceholdersInNode(prevNode, chosenCollection);
        debugLog("Replace result", { nodeId: prevNode.id, result });
      }
    } catch (e) {
      console.warn("Error processing previous node on selection change", e);
    } finally {
      processing = false;
    }
  }

  // If new selection is a text node, restore placeholders (edit-start)
  if (newSelectedNode && newId !== lastSelectedNodeId) {
    try {
      processing = true;
      debugLog("Attempting restore on newly selected node", {
        nodeId: newSelectedNode.id,
        textBefore: newSelectedNode.characters,
      });
      const result = await restorePlaceholdersInNode(newSelectedNode);
      debugLog("Restore result", { nodeId: newSelectedNode.id, result });
    } catch (e) {
      console.warn("Error restoring node on selection change", e);
    } finally {
      processing = false;
    }
  }

  if (newSelectedNode) {
    activeNodeOriginalText = newSelectedNode.characters;
  } else {
    activeNodeOriginalText = "";
    figma.ui.postMessage({ type: "autocomplete-close" });
  }

  lastSelectedNodeId = newId;
}

figma.loadAllPagesAsync().then(() => {
  figma.on("documentchange", async (event) => {
    if (!featureEnabled || !lastSelectedNodeId) return;

    for (const change of event.documentChanges) {
      if (change.type === "PROPERTY_CHANGE" && change.id === lastSelectedNodeId && change.properties.includes("characters")) {
        const node = await figma.getNodeByIdAsync(lastSelectedNodeId);
        if (!node || node.type !== "TEXT") continue;

        const hadBackup = Boolean(readNodeBackup(node));
        if (hadBackup) {
          clearNodeBackup(node);
          debugLog("Cleared stale backup after direct text edit", { nodeId: node.id });
        }

        handleTextEditForAutocomplete(node, activeNodeOriginalText, node.characters);
        activeNodeOriginalText = node.characters;
      }
    }
  });
});

function handleTextEditForAutocomplete(node, oldText, newText) {
  if (newText === oldText) return;

  let startDiff = 0;
  while (startDiff < oldText.length && startDiff < newText.length && oldText[startDiff] === newText[startDiff]) {
    startDiff++;
  }

  let oldEndDiff = oldText.length - 1;
  let newEndDiff = newText.length - 1;
  while (oldEndDiff >= startDiff && newEndDiff >= startDiff && oldText[oldEndDiff] === newText[newEndDiff]) {
    oldEndDiff--;
    newEndDiff--;
  }

  const cursorApprox = newEndDiff + 1;

  let wordStart = cursorApprox;
  while (wordStart > 0) {
    const prevChar = newText[wordStart - 1];
    if (/\s/.test(prevChar)) break;
    if (prevChar === '@') {
      wordStart--;
      break;
    }
    wordStart--;
  }

  let wordEnd = cursorApprox;
  while (wordEnd < newText.length) {
    const char = newText[wordEnd];
    if (/\s/.test(char)) break;
    if (char === '@' && wordEnd > wordStart) break;
    wordEnd++;
  }

  const word = newText.substring(wordStart, wordEnd);

  if (word.startsWith("@") && word.length > 0) {
    figma.ui.postMessage({
      type: "autocomplete-query",
      query: word.substring(1),
      wordStart: wordStart,
      wordEnd: wordEnd,
      nodeId: node.id
    });
  } else {
    figma.ui.postMessage({ type: "autocomplete-close" });
  }
}

/* Debounced selection handler to avoid flapping */
const debouncedSelectionHandler = debounce(handleSelectionChange, 200);

/* UI messaging */
figma.showUI(__html__, { width: 420, height: 530, themeColors: true });

async function sendInitStateToUI() {
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  let autocompleteVars = [];
  try {
    const chosenColObj = cols.find(c => c.name === chosenCollection) || cols[0];
    if (chosenColObj) {
      const vars = await figma.variables.getLocalVariablesAsync("STRING");
      autocompleteVars = vars.filter(v => v.variableCollectionId === chosenColObj.id).map(v => v.name);
    }
  } catch (e) {
    console.warn("Failed fetching autocomplete vars", e);
  }

  figma.ui.postMessage({
    type: "init",
    collections: cols.map((c) => c.name),
    enabled: featureEnabled,
    collection: chosenCollection,
    iconFontFamily,
    iconFontStyle,
    autocompleteVars,
  });
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === "init") {
    await sendInitStateToUI();
    return;
  }
  if (msg.type === "set") {
    const previousCollection = chosenCollection;
    if (typeof msg.enabled === "boolean") featureEnabled = msg.enabled;
    if (typeof msg.collection === "string") chosenCollection = msg.collection;
    if (typeof msg.iconFontFamily === "string")
      iconFontFamily = msg.iconFontFamily;
    if (typeof msg.iconFontStyle === "string")
      iconFontStyle = msg.iconFontStyle;

    // Save document-wide
    figma.root.setPluginData(
      DOC_SETTINGS_KEY,
      JSON.stringify({
        collection: chosenCollection,
        iconFontFamily,
        iconFontStyle,
      }),
    );

    figma.ui.postMessage({
      type: "status",
      text: `Feature ${featureEnabled ? "ON" : "OFF"}, collection: ${chosenCollection}`,
    });

    if (previousCollection !== chosenCollection) {
      await sendInitStateToUI();
    }
    return;
  }
  if (msg.type === "run-on-selection") {
    // manual run: replace placeholders on selected text nodes
    const nodes = gatherTextNodesFromSelectionOrPage(true);
    const results = [];
    for (const n of nodes) {
      const r = await replacePlaceholdersInNode(n, chosenCollection);
      results.push({ id: n.id, changed: r.changed });
    }
    figma.ui.postMessage({ type: "run-result", results });
    return;
  }
  if (msg.type === "restore-on-selection") {
    const nodes = gatherTextNodesFromSelectionOrPage(true);
    const results = [];
    for (const n of nodes) {
      const r = await restorePlaceholdersInNode(n);
      results.push({ id: n.id, restored: r.restored });
    }
    figma.ui.postMessage({ type: "run-result", results });
    return;
  }
  if (msg.type === "run-on-page") {
    const nodes = gatherTextNodesFromSelectionOrPage(false);
    const results = [];
    for (const n of nodes) {
      const r = await replacePlaceholdersInNode(n, chosenCollection);
      results.push({ id: n.id, changed: r.changed });
    }
    figma.ui.postMessage({ type: "run-result", results });
    return;
  }
  if (msg.type === "restore-on-page") {
    const nodes = gatherTextNodesFromSelectionOrPage(false);
    const results = [];
    for (const n of nodes) {
      const r = await restorePlaceholdersInNode(n);
      results.push({ id: n.id, restored: r.restored });
    }
    figma.ui.postMessage({ type: "run-result", results });
    return;
  }
  if (msg.type === "autocomplete-apply") {
    try {
      const { text, wordStart, wordEnd, nodeId } = msg;
      const node = await figma.getNodeByIdAsync(nodeId);
      if (node && node.type === "TEXT") {
        await safeLoadFontsForNode(node);
        node.deleteCharacters(wordStart, wordEnd);
        node.insertCharacters(wordStart, text, "BEFORE");

        activeNodeOriginalText = node.characters;

        figma.ui.postMessage({ type: "autocomplete-close" });
      }
    } catch (e) {
      console.warn("Failed to apply autocomplete", e);
    }
    return;
  }
  if (msg.type === "resize") {
    figma.ui.resize(msg.width, msg.height);
    return;
  }
  if (msg.type === "hide") {
    figma.ui.hide();
    return;
  }
  if (msg.type === "close") {
    figma.closePlugin();
    return;
  }
};

/* Register event listeners */
figma.on("selectionchange", () => {
  debouncedSelectionHandler();
});

/* When UI opens, send initial data */
(async () => {
  await sendInitStateToUI();
})();
