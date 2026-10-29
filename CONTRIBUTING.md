# Contributing to Nootion

Thanks for your interest! Bug reports, ideas and pull requests are welcome.

## Reporting a bug or suggesting an idea

Open an issue with the matching template. For a bug, include the version (at the bottom of the Administration page),
your setup and the steps to reproduce it.

For a security issue, don't open a public issue: see [SECURITY.md](SECURITY.md).

## Setting up

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

## Proposing a change

1. For a large change, open an issue first to discuss it.
2. Create a branch and keep the pull request focused on one topic.
3. Add tests when you can, especially for access rights (`permissions.ts`):
   every route that reads or changes a page must check the user's role on the server.
4. Make sure `pnpm typecheck` and `pnpm test` pass (CI runs them again).
5. Add a line to [CHANGELOG.md](CHANGELOG.md) under an "Unreleased" section.

Code, comments and documentation are in English.

## Translations

Every text shown to users goes through `t("key")` (from `@nootion/shared`), never a literal string.
The catalogues live in `packages/shared/src/i18n/`:

- `en.ts` is the reference: add new keys there first.
- `fr.ts` must have exactly the same keys (TypeScript and a test check it).
- `{name}` placeholders are filled from the second argument of `t()`; a message with `{ one, other }` forms is
  chosen by the `count` parameter.

To add a language: copy `fr.ts` to `<code>.ts`, translate it, then add the code to `LOCALES`, `LOCALE_NAMES`
and the catalogues in `packages/shared/src/i18n/index.ts` (and Zod's locale in `i18n/zod.ts` if it has one).

## License

By contributing, you agree that your contribution is published under the [AGPL-3.0](LICENSE) license.
