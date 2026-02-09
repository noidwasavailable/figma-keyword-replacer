// Placeholder Replace & Restore - code.js
// Searches text nodes for @keyword, replaces with STRING variable values on edit exit,
// and restores @keyword when node is selected (edit start). Uses node pluginData to store backups.

/* CONFIG */
const PLACEHOLDER_REGEX = /@([a-zA-Z0-9_\-\/]+(?:\.[a-zA-Z0-9_\-\/]+)*)/g;
const PLUGIN_DATA_KEY = "prr:backup"; // stores JSON: { original: "...", vars: {key: value}, collection: "name", replacements: [...] }
const DOC_SETTINGS_KEY = "prr:settings";
const DEFAULT_COLLECTION_NAME = "Keywords";

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
async function findStringVariable(name, collection) {
  const vars = await figma.variables.getLocalVariablesAsync("STRING");
  // Try to find in the target collection first
  let existing = vars.find(
    (v) => v.name === name && v.variableCollectionId === collection.id,
  );
  if (existing) return existing;

  return null;
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
) {
  const payload = {
    original: originalText,
    snapshot: snapshot || {},
    collection: collectionName || DEFAULT_COLLECTION_NAME,
    replacements: replacements || [],
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

/* Replace placeholders in a TextNode with variable values, save backup */
async function replacePlaceholdersInNode(node, collectionName) {
  const text = node.characters;
  let m;
  const matches = [];
  while ((m = PLACEHOLDER_REGEX.exec(text)) !== null) {
    matches.push({ key: m[1], start: m.index, len: m[0].length, text: m[0] });
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
  let runningDelta = 0;
  let hasIconReplacement = false;

  for (const mm of matches) {
    const variable = await findStringVariable(mm.key, collection);
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

    // Check if this is an icon
    const isIcon = mm.key.startsWith("icon/");
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
    });

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

  // Save backup with replacements info
  saveNodeBackup(node, text, snapshot, collection.name, replacements);

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

  return { changed: true, snapshot };
}

/* Restore original placeholder text in node if pluginData exists */
async function restorePlaceholdersInNode(node) {
  const backup = readNodeBackup(node);
  if (!backup) return { restored: false };

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
      // rep.start is where the value starts in the current (replaced) text
      // rep.len is the length of the value
      // rep.originalText is the placeholder (e.g. "@keyword")

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

  // If we had a last selected text node that is no longer selected, treat that as edit-finish
  if (lastSelectedNodeId && lastSelectedNodeId !== newId) {
    try {
      processing = true;
      const prevNode = await figma.getNodeByIdAsync(lastSelectedNodeId);
      if (prevNode && prevNode.type === "TEXT") {
        // Replace placeholders -> values
        await replacePlaceholdersInNode(prevNode, chosenCollection);
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
      await restorePlaceholdersInNode(newSelectedNode);
    } catch (e) {
      console.warn("Error restoring node on selection change", e);
    } finally {
      processing = false;
    }
  }

  lastSelectedNodeId = newId;
}

/* Debounced selection handler to avoid flapping */
const debouncedSelectionHandler = debounce(handleSelectionChange, 200);

/* UI messaging */
figma.showUI(__html__, { width: 420, height: 450, themeColors: true });

figma.ui.onmessage = async (msg) => {
  if (msg.type === "init") {
    // Send initial collections and status
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    figma.ui.postMessage({
      type: "init",
      collections: cols.map((c) => c.name),
      enabled: featureEnabled,
      collection: chosenCollection,
      iconFontFamily,
      iconFontStyle,
    });
    return;
  }
  if (msg.type === "set") {
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
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  figma.ui.postMessage({
    type: "init",
    collections: cols.map((c) => c.name),
    enabled: featureEnabled,
    collection: chosenCollection,
    iconFontFamily,
    iconFontStyle,
  });
})();
