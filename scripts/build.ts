import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import ts from "typescript";

const projectRoot = resolve(import.meta.dir, "..");

const paths = {
	distDir: join(projectRoot, "dist"),

	// Backend plugin code
	codeEntry: join(projectRoot, "src", "code.ts"),
	codeOut: join(projectRoot, "dist", "code.js"),

	// UI (single standalone HTML output)
	uiEntry: join(projectRoot, "src", "ui.html"),
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

async function ensureCleanDistDir(): Promise<void> {
	await rm(paths.distDir, { recursive: true, force: true });
	await mkdir(paths.distDir, { recursive: true });
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

async function buildPluginCode(): Promise<void> {
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

async function buildStandaloneUiHtml(): Promise<void> {
	if (!(await pathExists(paths.uiEntry))) {
		throw new Error(`UI HTML entrypoint not found: ${paths.uiEntry}`);
	}

	const result = await Bun.build({
		entrypoints: [paths.uiEntry],
		compile: true,
		target: "browser",
		outdir: paths.distDir,
		minify: true,
		tsconfig: "tsconfig.json",
	});

	if (!result.success) {
		throw new Error(
			`Failed to compile standalone UI HTML: ${JSON.stringify(result.logs, null, 2)}`,
		);
	}

	if (!(await pathExists(paths.uiOut))) {
		throw new Error(`Standalone UI output not found: ${paths.uiOut}`);
	}
}

async function copyManifestToDist(): Promise<void> {
	if (!(await pathExists(paths.manifestIn))) {
		throw new Error(`Manifest file not found: ${paths.manifestIn}`);
	}

	await copyFile(paths.manifestIn, paths.manifestOut);
}

export async function main(): Promise<void> {
	await ensureCleanDistDir();

	await buildPluginCode();
	await buildStandaloneUiHtml();
	await copyManifestToDist();

	console.log("Built FigPlugin outputs:", {
		code: "dist/code.js",
		ui: "dist/ui.html",
		manifest: "dist/manifest.json",
		uiMode: "standalone-html",
	});
}

if (import.meta.path === Bun.main) await main();
