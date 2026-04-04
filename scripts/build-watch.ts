import { watch } from "node:fs";
import { resolve } from "node:path";
import { main } from "./build";

const watcher = watch(
	resolve(import.meta.dir, "..", "src"),
	{
		recursive: true,
	},
	() => {
		console.log("Change detected. Rebuilding...");
		main();
	},
);

process.on("SIGINT", () => {
	// close watcher when Ctrl-C is pressed
	console.log("Closing watcher...");
	watcher.close();

	process.exit(0);
});
