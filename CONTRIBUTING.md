# Contributing to Nootion

Thanks for your interest! Nootion is open source, but **not open to code contributions**: pull requests
are not accepted and will be closed. This keeps the project in the hands of a single author, who stays free to
decide its future. Bug reports, ideas and feedback are very welcome, and so is forking it under the terms of
the [AGPL-3.0](LICENSE).

## Reporting a bug or suggesting an idea

Open an issue with the matching template. For a bug, include the version (at the bottom of the Administration page),
your setup and the steps to reproduce it.

For a security issue, don't open a public issue: see [SECURITY.md](SECURITY.md).

## Building it yourself

Requirements: Node.js 22 and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev          # server on :3000, interface on http://localhost:5173
pnpm test         # automated tests
pnpm typecheck
```

Code layout:

```
apps/server          Fastify API + Drizzle + SQLite (tests in apps/server/test)
apps/web             React + Vite + Tailwind + TipTap interface
packages/shared      Types, validation, formula and view engines, translations, shared by both
apps/server/plugins  Plugins that ship with the app (see docs/PLUGINS.md)
```

After changing `apps/server/src/db/schema.ts`, create the migration with
`pnpm --filter @nootion/server db:generate`. Migrations are applied at startup.

## Translations

To ask for a new language, open an issue. For reference, here is how the interface texts work:

Every text shown to users goes through `t("key")` (from `@nootion/shared`), never a literal string.
The catalogues live in `packages/shared/src/i18n/`:

- `en.ts` is the reference: add new keys there first.
- `fr.ts` must have exactly the same keys (TypeScript and a test check it).
- `{name}` placeholders are filled from the second argument of `t()`; a message with `{ one, other }` forms is
  chosen by the `count` parameter.

To add a language: copy `fr.ts` to `<code>.ts`, translate it, then add the code to `LOCALES`, `LOCALE_NAMES`
and the catalogues in `packages/shared/src/i18n/index.ts` (and Zod's locale in `i18n/zod.ts` if it has one).

## License

Nootion is published under the [AGPL-3.0](LICENSE) license.
