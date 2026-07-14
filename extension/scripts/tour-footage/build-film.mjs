// Bundle film.ts with the same esbuild-svelte setup as extension/build.mjs
// (esbuild + esbuild-svelte resolve from extension/node_modules).
import { build, transform } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const harness = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url)).replace(
  /\/$/,
  ""
);
const pkg = (path) => `${repoRoot}/packages/${path}`;

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

await build({
  entryPoints: { film: `${harness}/film.ts` },
  outdir: `${harness}/site`,
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
});

await cp(pkg("editor/src/styles.css"), `${harness}/site/editor.css`);
console.log("film page built");
