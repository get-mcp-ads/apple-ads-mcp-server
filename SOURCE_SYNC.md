# Source synchronization

Reviewed on 2026-10-23 against getmcpads gateway revision `3e1c2c8`.

## Synchronized

- `apps/mcp/src/sources/apple_ads/tools.ts`: the 19 native tools with their names, schemas, descriptions, parent-chain checks, paused creations, snapshot-bound updates, report validation and live-verified report filters.
- `apps/mcp/src/sources/apple_ads/catalog.ts`: report metrics and grouping dimensions, served as `apple-ads://report-catalog`.
- The additive metric list from `apps/mcp/src/sources/apple_ads/alert-catalog.ts`, so the catalog states which metrics can be summed.
- `apps/mcp/src/rename.ts`: the rename preview and the name-only rename payloads.
- `packages/db/src/apple-ads.ts`: the Platform API v1 client with its fixed origin and path checks, the `X-AP-Context: adAccountId` header, HTTP 200 error bodies treated as failures, error codes, uncertain-write flags and validation diagnostics that never echo provider text, and the ES256 client secret claims.

## Adapted for a standalone server

- Authentication uses the OAuth 2 client credentials grant with the `searchadsorg` scope, as documented in Apple's OAuth guide for the Platform API. The gateway uses the service-provider authorization-code flow with stored refresh tokens instead.
- The private key is signed with `node:crypto` and accepts PKCS #8 and SEC1 PEM files.
- `apple_ads_list_ad_accounts` replaces the hosted account selection. It reads the API user's access list and returns the accounts configured in `APPLE_ADS_AD_ACCOUNT_IDS` only.
- The allowlist is checked before every request, including the parent lookups.
- A read that receives HTTP 401 is sent once more after the access token is renewed. Writes are not replayed.
- List and report responses add `nextOffset` beside Apple's native pagination object.
- HTTP 404 maps to `NOT_FOUND`, and HTTP 429 states the wait from `Retry-After` or `RateLimit-Reset`.
- Responses are size-bounded and redirects are refused with `redirect: "error"`.

## Hosted only

Alerts (`alert-catalog.ts` ratios, `alert-apple.ts`), encrypted token storage and refresh leases (`packages/db/src/apple-connection.ts`), the service-provider OAuth consent, plan gating, account selection in Sources, the client memory and change journal, the discovery meta-tools and the deferred tool lists stay in the hosted product.

Validation uses synthetic data. No live advertising write is required by the test suite. The generated server-card.json is the source of truth for this revision's tool schemas.

Maintainer: Emmanuel, getmcpads. Contact: hello@getmcpads.com.
