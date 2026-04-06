import { startPluginController } from "./plugin/controller";

const debug = false;

void startPluginController(debug).catch((error) => {
	console.error("Failed to start plugin controller", error);
	figma.notify("Keyword Replacer failed to start. Check console for details.");
});
