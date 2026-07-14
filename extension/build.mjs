import { build, context, transform } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import { cp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const watch = process.argv.includes("--watch");
const browsers = ["chrome"];

// Share the pure-TS packages and the Svelte editor with the rest of the
// monorepo without making the extension a workspace member: esbuild compiles
// the package sources directly.
const pkg = (path) =>
  fileURLToPath(new URL(`../packages/${path}`, import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Transpile <script lang="ts"> with esbuild. verbatimModuleSyntax keeps
// component imports that are only referenced in markup (e.g. <Toolbar/>) —
// otherwise TS elides them and the component is undefined at runtime.
const typescriptPreprocess = {
  name: "ts",
  script: async ({ content, attributes }) => {
    if (attributes.lang !== "ts") return { code: content };
    const { code, map } = await transform(content, {
      loader: "ts",
      tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
    });
    return { code, map };
  },
};

// Force every `svelte` / `svelte/*` import to resolve from the repo-root install
// so mount() and the compiled components share ONE runtime copy. Without this,
// render.ts (extension/node_modules) and the editor components (root) can bind
// to two copies and mount() fails ("first_child_getter" uninitialized).
const dedupeSvelte = {
  name: "dedupe-svelte",
  setup(build) {
    build.onResolve({ filter: /^svelte(\/|$)/ }, async (args) => {
      if (args.pluginData?.deduped) return;
      const resolved = await build.resolve(args.path, {
        kind: args.kind,
        resolveDir: repoRoot,
        pluginData: { deduped: true },
      });
      if (resolved.errors.length) return { errors: resolved.errors };
      return { path: resolved.path, external: resolved.external };
    });
  },
};

/**
 * Bundle each entry point as a self-contained classic (IIFE) script. Classic
 * scripts are exempt from Chrome's strict MIME-type checking for ES modules,
 * which is what breaks module-based extension builds on some Chrome/OS setups.
 * The Svelte editor is compiled in via esbuild-svelte with scoped component
 * styles injected at runtime.
 */
const options = {
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    popup: "src/popup.ts",
    render: "src/render.ts",
    offscreen: "src/offscreen.ts",
  },
  bundle: true,
  format: "iife",
  target: "chrome110",
  logLevel: "info",
  conditions: ["browser"],
  mainFields: ["browser", "module", "main"],
  alias: {
    "@demoscope/timeline": pkg("timeline/src/index.ts"),
    "@demoscope/browser-kit": pkg("browser-kit/src/index.ts"),
    "@demoscope/editor": pkg("editor/src/index.ts"),
    "@demoscope/schema": pkg("schema/src/types.ts"),
  },
  plugins: [
    dedupeSvelte,
    esbuildSvelte({
      preprocess: typescriptPreprocess,
      compilerOptions: { css: "injected" },
    }),
  ],
};

async function copyStatic(dir) {
  await cp("assets", `${dir}/assets`, { recursive: true });
  await cp("src/popup.html", `${dir}/popup.html`);
  await cp("src/render.html", `${dir}/render.html`);
  await cp("src/offscreen.html", `${dir}/offscreen.html`);
  await cp(pkg("editor/src/styles.css"), `${dir}/editor.css`);
}

async function writeManifest(dir) {
  const base = JSON.parse(await readFile("manifest.json", "utf8"));
  await writeFile(`${dir}/manifest.json`, JSON.stringify(base, null, 2));
}

async function buildBrowser(browser) {
  const dir = `dist/${browser}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await copyStatic(dir);
  await writeManifest(dir);
  const opts = { ...options, outdir: dir };
  if (watch) {
    const ctx = await context(opts);
    await ctx.watch();
  } else {
    await build(opts);
  }
}

await rm("dist", { recursive: true, force: true });
for (const browser of browsers) await buildBrowser(browser);
if (watch) console.log("watching for changes...");
