// Helpers for gathering text nodes from either the current selection or page.

export interface GatherTextNodesOptions {
	/**
	 * If true and there is an active selection, only inspect selected nodes.
	 * If false (or when selection is empty), scan the whole page.
	 */
	useSelectionOnly?: boolean;

	/**
	 * Optional page override. Defaults to figma.currentPage.
	 */
	page?: PageNode;
}

function hasFindAll(node: SceneNode): node is SceneNode & ChildrenMixin {
	return "findAll" in node && typeof node.findAll === "function";
}

/**
 * Collect all text nodes from a set of root scene nodes, including nested descendants.
 * Results are de-duplicated by node id.
 */
export function collectTextNodesFromRoots(
	roots: ReadonlyArray<SceneNode>,
): TextNode[] {
	const out: TextNode[] = [];
	const seen = new Set<string>();

	const pushIfText = (node: SceneNode) => {
		if (node.type !== "TEXT") return;
		if (seen.has(node.id)) return;

		seen.add(node.id);
		out.push(node);
	};

	for (const root of roots) {
		pushIfText(root);

		if (hasFindAll(root)) {
			const nested = root.findAll(
				(n: SceneNode) => n.type === "TEXT",
			) as TextNode[];
			for (const textNode of nested) {
				if (seen.has(textNode.id)) continue;
				seen.add(textNode.id);
				out.push(textNode);
			}
		}
	}

	return out;
}

/**
 * Gather text nodes from selection or page.
 * - If `useSelectionOnly` is true and there is selection: scan selection roots.
 * - Otherwise: scan the whole page.
 */
export function gatherTextNodesFromSelectionOrPage(
	options: GatherTextNodesOptions = {},
): TextNode[] {
	const page = options.page ?? figma.currentPage;
	const useSelectionOnly = options.useSelectionOnly ?? true;

	if (useSelectionOnly && page.selection.length > 0) {
		return collectTextNodesFromRoots(page.selection);
	}

	const all = page.findAll((n) => n.type === "TEXT") as TextNode[];
	// page.findAll is already flat, but we still dedupe defensively.
	const out: TextNode[] = [];
	const seen = new Set<string>();

	for (const node of all) {
		if (seen.has(node.id)) continue;
		seen.add(node.id);
		out.push(node);
	}

	return out;
}
