import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import ts from "typescript";

const projectRoot = resolve(import.meta.dir, "..");

const paths = {
	distDir: join(projectRoot, "dist"),

	// Plugin code entrypoint (can import many internal modules)
	codeEntry: join(projectRoot, "src", "code.ts"),
	codeOut: join(projectRoot, "dist", "code.js"),

	// UI files (ui.ts is optional)
	uiEntry: join(projectRoot, "src", "ui.ts"),
	uiTemplate: join(projectRoot, "src", "ui.html"),
	uiOut: join(projectRoot, "dist", "ui.html"),

	manifestIn: join(projectRoot, "manifest.json"),
	manifestOut: join(projectRoot, "dist", "manifest.json"),
};

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function ensureDistDir(): Promise<void> {
	await mkdir(paths.distDir, { recursive: true });
}

function injectUiScript(templateHtml: string, bundledUiJs: string): string {
	const scriptTag = `<script>\n${bundledUiJs}\n</script>`;

	// Preferred marker replacement
	if (templateHtml.includes("__UI_SCRIPT__")) {
		return templateHtml.replace("__UI_SCRIPT__", bundledUiJs);
	}

	// Replace the last inline script directly before </body> if present
	const replaceTrailingScript = templateHtml.replace(
		/<script\b[^>]*>[\s\S]*?<\/script>\s*(?=<\/body>)/i,
		`${scriptTag}\n`,
	);

	if (replaceTrailingScript !== templateHtml) {
		return replaceTrailingScript;
	}

	// Fallback: inject before </body>
	if (templateHtml.includes("</body>")) {
		return templateHtml.replace("</body>", `${scriptTag}\n</body>`);
	}

	// Last resort: append script
	return `${templateHtml}\n${scriptTag}\n`;
}

function createFallbackUiHtml(bundledUiJs?: string): string {
	const script = bundledUiJs ? `<script>\n${bundledUiJs}\n</script>` : "";
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Keyword Replacer</title>
  </head>
  <body>
${script}
  </body>
</html>
`;
}

function downlevelJavaScriptForFigma(source: string, fileName: string): string {
	const result = ts.transpileModule(source, {
		fileName,
		reportDiagnostics: true,
		compilerOptions: {
			target: ts.ScriptTarget.ES2017,
			module: ts.ModuleKind.ESNext,
			sourceMap: false,
			inlineSourceMap: false,
			removeComments: true,
		},
	});

	if (result.diagnostics && result.diagnostics.length > 0) {
		const formatted = ts.formatDiagnosticsWithColorAndContext(
			result.diagnostics,
			{
				getCanonicalFileName: (f) => f,
				getCurrentDirectory: () => process.cwd(),
				getNewLine: () => "\n",
			},
		);
		throw new Error(`Failed to downlevel ${fileName}:\n${formatted}`);
	}

	return result.outputText;
}

async function bundlePluginCode(): Promise<void> {
	if (!(await pathExists(paths.codeEntry))) {
		throw new Error(`Plugin entrypoint not found: ${paths.codeEntry}`);
	}

	const result = await Bun.build({
		entrypoints: [paths.codeEntry],
		target: "browser",
		format: "esm",
		minify: true,
		tsconfig: "tsconfig.json",
	});

	if (!result.success || result.outputs.length === 0) {
		throw new Error(
			`Failed to bundle plugin code: ${JSON.stringify(result.logs, null, 2)}`,
		);
	}

	const jsOutput =
		result.outputs.find((o) => o.kind === "entry-point") ?? result.outputs[0];
	const jsText = await jsOutput.text();
	const downleveledJs = downlevelJavaScriptForFigma(jsText, "code.js");

	await Bun.write(paths.codeOut, downleveledJs);
}

async function bundleUiHtml(): Promise<
	"bundled-ts" | "template-only" | "generated-fallback"
> {
	const hasUiEntry = await pathExists(paths.uiEntry);
	const hasUiTemplate = await pathExists(paths.uiTemplate);

	if (!hasUiEntry && hasUiTemplate) {
		// No TS UI entrypoint: keep template as-is (supports inline-script UI).
		const templateHtml = await readFile(paths.uiTemplate, "utf8");
		await writeFile(paths.uiOut, templateHtml, "utf8");
		return "template-only";
	}

	if (!hasUiEntry && !hasUiTemplate) {
		// No UI assets at all: generate minimal fallback file.
		await writeFile(paths.uiOut, createFallbackUiHtml(), "utf8");
		return "generated-fallback";
	}

	// ui.ts exists -> bundle and inject into template (or fallback template).
	const result = await Bun.build({
		entrypoints: [paths.uiEntry],
		target: "browser",
		format: "iife",
		minify: true,
		tsconfig: "tsconfig.json",
	});

	if (!result.success || result.outputs.length === 0) {
		throw new Error(
			`Failed to bundle UI code: ${JSON.stringify(result.logs, null, 2)}`,
		);
	}

	const uiBundle =
		result.outputs.find((o) => o.kind === "entry-point") ?? result.outputs[0];
	const uiJs = await uiBundle.text();
	const downleveledUiJs = downlevelJavaScriptForFigma(uiJs, "ui.js");

	const templateHtml = hasUiTemplate
		? await readFile(paths.uiTemplate, "utf8")
		: createFallbackUiHtml();

	const finalHtml = injectUiScript(templateHtml, downleveledUiJs);
	await writeFile(paths.uiOut, finalHtml, "utf8");

	return "bundled-ts";
}

async function copyManifestToDist(): Promise<void> {
	if (!(await pathExists(paths.manifestIn))) {
		throw new Error(`Manifest file not found: ${paths.manifestIn}`);
	}

	await copyFile(paths.manifestIn, paths.manifestOut);
}

async function main(): Promise<void> {
	await ensureDistDir();

	await bundlePluginCode();
	const uiMode = await bundleUiHtml();
	await copyManifestToDist();

	console.log("Built FigPlugin outputs:", {
		code: "dist/code.js",
		ui: "dist/ui.html",
		manifest: "dist/manifest.json",
		uiMode,
	});
}

await main();
