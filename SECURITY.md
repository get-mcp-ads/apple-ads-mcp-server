# Security Policy

This server holds a private key that can read, and when writes are enabled
modify, live advertising accounts. We take reports seriously.

## Reporting a vulnerability

Do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting on this repository:
[Report a vulnerability](https://github.com/get-mcp-ads/apple-ads-mcp-server/security/advisories/new),
or write to hello@getmcpads.com. Do not include live keys, tokens or customer data.

We aim to acknowledge a report within 3 business days and to ship a fix or a
documented mitigation within 30 days. We will credit you in the advisory unless
you ask us not to.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## What this server does with your credentials

- The private key is read once at startup, from `APPLE_ADS_PRIVATE_KEY` or the
  file named by `APPLE_ADS_PRIVATE_KEY_PATH`, parsed into an in-memory key
  object and never written, logged or returned.
- Each token request signs a fresh client secret that expires after five
  minutes. The access token Apple returns lives in memory for its one-hour
  lifetime and is redacted from tool output.
- Two hosts are contacted: `api.ads.apple.com` and `appleid.apple.com`, both
  declared in `src/endpoints.ts`. A test fails the build if another host
  appears in the source.
- No fetch follows a redirect. Every outbound call sets `redirect: "error"`, so
  a redirect cannot forward your token to another host. A test fails the build
  if any fetch omits it.
- Requests time out and responses are size-bounded.
- Error messages carry the HTTP status, a fixed code and vetted validation
  paths only. Provider error text is never relayed, since it can echo values
  or credentials.
- No telemetry, no analytics, no phone-home.

## Account scope and writes

- Every tool requires an ad account from `APPLE_ADS_AD_ACCOUNT_IDS`. The check
  runs before any request, and account discovery is filtered to that list.
- Campaign, ad group, keyword and ad parents are verified against the selected
  ad account before a read of children or any change.
- Writes are registered only when `APPLE_ADS_ENABLE_WRITES` is exactly `true`.
  Each write previews unless `confirm` is `true`, and updates must pass back
  the snapshot returned by their preview.
- A write whose outcome is uncertain is never retried automatically.

## Handling your key safely

- Use a dedicated API user with the least access your work needs.
- Keep the private key file readable by your user only (`chmod 600`).
- Your MCP client config file is usually plain text on disk. Prefer
  `APPLE_ADS_PRIVATE_KEY_PATH` over pasting the key, and never commit either.
- If the key may have been exposed, generate a new key pair and upload the new
  public key under Account Settings > API.

## Scope

Vulnerabilities in the Apple Ads API itself are not in scope here; report
those to Apple.
