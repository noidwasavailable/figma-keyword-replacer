import { startPluginController } from "./plugin/controller";

void startPluginController().catch((error) => {
	console.error("Failed to start plugin controller", error);
	figma.notify("Keyword Replacer failed to start. Check console for details.");
});
