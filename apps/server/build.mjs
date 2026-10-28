import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/index.js",
  // Native modules and fastify plugins stay in node_modules.
  packages: "external",
  // Workspace packages are TypeScript sources: bundle them.
  alias: { "@nootion/shared": "../../packages/shared/src/index.ts" },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
