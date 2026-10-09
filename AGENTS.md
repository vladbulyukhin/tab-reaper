# Repository Guidelines

- `src/` contains the extension (`background/`, `popup/`, `api/`, `common/`); `tests/` contains Chrome Playwright tests; `landing/` is a separate site.
- Use the root `pnpm-lock.yaml` and the pnpm version declared in `package.json`.
- Check changes with `pnpm lint`, `pnpm typecheck`, `pnpm test:unit:ci`, and `pnpm test:e2e` as appropriate. `pnpm test:e2e` builds the Chrome extension first.
- `pnpm build:safari:macos`, `pnpm verify:safari:macos`, and `pnpm test:safari:build` produce and check the Safari macOS payload. The private Apple wrapper adapts its manifest for iOS.
- Keep changes feature-local, follow Biome formatting, and update unit/E2E tests when behavior changes.
- Use conventional-style commit prefixes such as `feat:`, `fix:`, or `chore:`. Include a concise summary and UI screenshots when opening a PR.
