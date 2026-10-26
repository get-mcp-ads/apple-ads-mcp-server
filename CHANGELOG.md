# Changelog

## 1.0.1 - 2026-10-26 - Zod 4 security update
- Update `zod` to 4.6.7. Every Zod release before 4.6.6 is covered by the high-severity advisory GHSA-mrhx-c7xc-m3w5: validating an oversized constrained collection can exhaust memory, and no Zod 3 release carries the fix. `npm audit --omit=dev` reports no vulnerability again.
- Keep the Zod 3 validation behaviour. A parameter default is still validated and completed before use, so an omitted object must still supply its required fields.
- Keep each parameter's own description when the parameter is optional or has a default. Zod 4 stores a description on the wrapped schema only, so the shared fallback description could otherwise replace it.
- Tool names, parameters and descriptions published over MCP are unchanged. `server-card.json` is regenerated with Zod 4's JSON Schema output, which spells some constraints differently.

## 1.0.0 - 2026-10-23 - First standalone release
- Create the first standalone server for the Apple Ads Platform API v1, synchronized with getmcpads gateway revision 3e1c2c8.
- Expose 9 read tools, 11 opt-in write tools and 2 resources, keeping the gateway tool names and the `apple_ads_` prefix.
- Add `apple_ads_list_ad_accounts`, which replaces the hosted account selection and returns configured accounts only.
- Sign OAuth 2 client credentials locally with an EC P-256 key read from the environment. Access tokens stay in memory.
- Require an ad account allowlist, default to read-only, preview every write, bind updates to a snapshot and create entities paused.
- Use fixed Apple hosts, refuse redirects, bound responses, time out requests and never retry an uncertain write.
- Require Node.js 22.23.4, 24.22.1, 26.12.1 or a newer release, and warn on stderr when started on an older runtime.
- No hosted alerts, creative UI or MCP Apps integrations.
