export const PLUGIN_WINDOW_WIDTH = 400;
export const PLUGIN_WINDOW_HEIGHT = 620;

export const PLUGIN_WINDOW_WIDTH_MIN = PLUGIN_WINDOW_WIDTH - 190;
export const PLUGIN_WINDOW_HEIGHT_MIN = PLUGIN_WINDOW_HEIGHT - 540;

export const PLUGIN_COLLECTION_NAME = "KeywordReplacer (plugin)";

export const AUTOCOMPLETE_MAX_RESULTS = 10;

export const PLUGIN_MESSAGE_ID = {
	AUTOCOMPLETE_QUERY: "autocomplete-query",
	AUTOCOMPLETE_APPLY: "autocomplete-apply",
	AUTOCOMPLETE_CLOSE: "autocomplete-close",
	RUN_RESULT: "run-result",
	RUN_ON_SELECTION: "run-on-selection",
	RESTORE_ON_SELECTION: "restore-on-selection",
	RUN_ON_PAGE: "run-on-page",
	RESTORE_ON_PAGE: "restore-on-page",
	RECOVER_STALE_ON_SELECTION: "recover-stale-on-selection",
	RECOVER_STALE_ON_PAGE: "recover-stale-on-page",
	RESIZE: "resize",
	HIDE: "hide",
	CLOSE: "close",
	STATUS: "status",
} as const;
