import { build } from "esbuild";

await build({
  // The server, and the command that moves attached files between the data folder and a bucket.
  entryPoints: ["src/index.ts", "src/files-move.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outdir: "dist",
  // Native modules and fastify plugins stay in node_modules.
  packages: "external",
  // Workspace packages are TypeScript sources: bundle them.
  alias: { "@nootion/shared": "../../packages/shared/src/index.ts" },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
