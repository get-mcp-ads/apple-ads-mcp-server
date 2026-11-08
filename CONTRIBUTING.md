# Contributing

Thanks for considering a contribution. This project is maintained by
[GetMCPAds](https://www.getmcpads.com) and is open to outside patches.

## Getting set up

Use Node.js 22.23.4, 24.22.1, 26.12.1 or a newer release.

```bash
git clone https://github.com/get-mcp-ads/apple-ads-mcp-server.git
cd apple-ads-mcp-server
npm ci
cp .env.example .env
```

Then run the checks:

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

All four must pass. CI runs them on Node 22, 24 and 26.

## Ground rules

**Never commit a key or a token.** `.env` is gitignored. Before opening a PR,
reread your diff for anything that looks like `BEGIN PRIVATE KEY`,
`BEGIN EC PRIVATE KEY` or a bearer token.

**Tests use synthetic data and a mocked `fetch`.** Do not add a test that needs
live credentials to pass; CI has none. Generate throwaway keys in the test.

**Keep the account allowlist in front of every request.** A new tool takes
`adAccountId`, and its parents are verified against that account before any
change.

**Write tools must preview first.** A new write accepts `confirm`, returns a
preview when it is not `true`, creates entities paused and is never retried
automatically after an uncertain outcome.

**Keep the hosts in one place.** Every Apple host is declared in
`src/endpoints.ts`. One test fails if a `fetch` omits `redirect: "error"`, and
another fails if a new host appears in the source.

**Keep it self-contained.** Runtime dependencies are `@modelcontextprotocol/sdk`
and `zod`. Adding a third needs a good reason.

**Keep the README accurate.** A test checks that every tool and resource is
documented and that the counts match the code. Write in English, in plain
declarative sentences, without em dashes.

## Reporting bugs

Open an issue with what you called, what you expected and what you got.
Redact IDs, keys and tokens. For anything security-related, do not open an
issue. See [SECURITY.md](SECURITY.md).

## Licence

By contributing, you agree that your contributions are licensed under the
Apache License 2.0, as stated in [LICENSE](LICENSE).
