import { type WatchListener, watch } from "node:fs";
import { resolve } from "node:path";
import { main } from "./build";

const WATCH_ROOT = resolve(import.meta.dir, "..", "src");
const DEBOUNCE_MS = 120;

let init = true;
let changeSource = "initial build";
let duplicateBuildCount = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let building = false;
let rebuildQueued = false;
const pendingFiles = new Set<string>();

const formatPendingFiles = () => {
	if (pendingFiles.size === 0) return "unknown";
	return Array.from(pendingFiles).slice(0, 5).join(", ");
};

const runBuild = async (filename: string | null) => {
	if (building) {
		rebuildQueued = true;
		return;
	}

	building = true;

	do {
		rebuildQueued = false;

		await Bun.$`clear`;

		if (init) {
			console.log("Watching for changes...");
			console.log("Running initial build...");
			init = false;
		}

		console.log(
			`${duplicateBuildCount > 0 ? `[${duplicateBuildCount + 1}x]` : ""} Change detected in: ${formatPendingFiles()}`,
		);

		pendingFiles.clear();

		const buildResult = await main();
		console.log(buildResult);

		if (filename === changeSource) duplicateBuildCount++;
		changeSource = filename ?? "unknown";
	} while (rebuildQueued);

	building = false;
};

const scheduleBuild = (filename: string | null) => {
	if (debounceTimer) clearTimeout(debounceTimer);

	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		void runBuild(filename);
	}, DEBOUNCE_MS);
};

const buildWatch: WatchListener<string> = (event, filename) => {
	// fs.watch can emit duplicate bursts (change/rename pairs) for a single save.
	// We collect all events for a short window and run one rebuild.
	if (filename) pendingFiles.add(filename);
	else pendingFiles.add(`${event}:unknown`);

	scheduleBuild(filename);
};

void runBuild("init");

const watcher = watch(
	WATCH_ROOT,
	{
		recursive: true,
	},
	buildWatch,
);

process.on("SIGINT", () => {
	console.log("Closing watcher...");
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	watcher.close();
	process.exit(0);
});
