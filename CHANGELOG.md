# Changelog

## 1.0.0 - 2026-10-23

- Create the first standalone server for the Apple Ads Platform API v1, synchronized with getmcpads gateway revision 3e1c2c8.
- Expose 9 read tools, 11 opt-in write tools and 2 resources, keeping the gateway tool names and the `apple_ads_` prefix.
- Add `apple_ads_list_ad_accounts`, which replaces the hosted account selection and returns configured accounts only.
- Sign OAuth 2 client credentials locally with an EC P-256 key read from the environment. Access tokens stay in memory.
- Require an ad account allowlist, default to read-only, preview every write, bind updates to a snapshot and create entities paused.
- Use fixed Apple hosts, refuse redirects, bound responses, time out requests and never retry an uncertain write.
- Require Node.js 22.23.4, 24.22.1, 26.12.1 or a newer release, and warn on stderr when started on an older runtime.
- No hosted alerts, creative UI or MCP Apps integrations.
