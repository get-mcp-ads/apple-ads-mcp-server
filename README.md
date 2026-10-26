<div align="center">

# Apple Ads MCP server

### Bring your Apple Ads accounts into your MCP client.

Read App Store campaigns and performance and prepare changes for explicitly selected ad accounts.

[![Release](https://img.shields.io/github/v/release/get-mcp-ads/apple-ads-mcp-server?color=2448e5)](https://github.com/get-mcp-ads/apple-ads-mcp-server/releases/latest)
[![CI](https://github.com/get-mcp-ads/apple-ads-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/get-mcp-ads/apple-ads-mcp-server/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22.23.4%20%7C%2024.22.1%20%7C%20%E2%89%A526.12.1-brightgreen.svg)](package.json)

[Watch the film](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4) · [What's new](#whats-new) · [Install](#install-this-release) · [Tool reference](#tools) · [Try hosted getmcpads](https://www.getmcpads.com/tools/apple-ads?utm_source=github&utm_medium=readme&utm_campaign=apple-ads)

[![Watch the getmcpads film: every ad account in one conversation with your AI assistant](https://www.getmcpads.com/home/film/brand-film-poster-promise.webp)](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4)

**[Play the 45-second film](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4)**

</div>

The film shows hosted getmcpads with sample data. Its MCP Apps, from creative galleries and alerts to Google Sheets exports and bulk launches, belong to the hosted product. This repository provides the standalone native API tools.

**9 read tools** · **11 write tools**, disabled by default.

Run locally with your own platform credentials and a client that supports stdio MCP, such as Claude Desktop, Claude Code or Cursor. Your requests go directly to the platform. For managed connections, including supported ChatGPT setups, use the hosted option.

## What's new

<!-- release-history:start -->
**[v1.0.1: Zod 4 security update](https://github.com/get-mcp-ads/apple-ads-mcp-server/releases/tag/v1.0.1) · October 26, 2026**

- Update `zod` to 4.6.7. Every Zod release before 4.6.6 is covered by the high-severity advisory GHSA-mrhx-c7xc-m3w5: validating an oversized constrained collection can exhaust memory, and no Zod 3 release carries the fix. `npm audit --omit=dev` reports no vulnerability again.
- Keep the Zod 3 validation behaviour. A parameter default is still validated and completed before use, so an omitted object must still supply its required fields.
- Keep each parameter's own description when the parameter is optional or has a default. Zod 4 stores a description on the wrapped schema only, so the shared fallback description could otherwise replace it.
- Tool names, parameters and descriptions published over MCP are unchanged. `server-card.json` is regenerated with Zod 4's JSON Schema output, which spells some constraints differently.

**Earlier releases**

| Version | Date | Highlights |
| --- | --- | --- |
| 1.0.0 | October 23, 2026 | First standalone release |

[Full changelog](CHANGELOG.md) · [All releases](https://github.com/get-mcp-ads/apple-ads-mcp-server/releases)
<!-- release-history:end -->

Source synchronization: [SOURCE_SYNC.md](SOURCE_SYNC.md).

### Upgrade notes

Requires **Node.js 22.23.4, 24.22.1 or 26.12.1**, or a newer release of those lines, which carry the October 2026 security fixes. The server writes a warning to stderr when it starts on an older runtime. CI covers Node 22, 24 and 26. Writes remain optional and require explicit confirmation. Hosted alerts, creative integrations and MCP Apps UI are outside this release.

## Install this release

This is a GitHub source release. npm and MCP Registry versions are published separately. The commands below select this exact version. Once the npm package is published, `npx -y @getmcpads/apple-ads-mcp-server` runs the version currently available on npm.

```bash
git clone --branch v1.0.1 --depth 1 https://github.com/get-mcp-ads/apple-ads-mcp-server.git
cd apple-ads-mcp-server
npm ci
npm run build
```

Configure your MCP client to run `node` with the absolute path to `dist/cli.js` and the platform credentials documented below. For Claude Desktop:

```json
{
  "mcpServers": {
    "apple-ads": {
      "command": "node",
      "args": ["/absolute/path/to/apple-ads-mcp-server/dist/cli.js"],
      "env": {
        "APPLE_ADS_CLIENT_ID": "SEARCHADS.your-client-id",
        "APPLE_ADS_TEAM_ID": "SEARCHADS.your-team-id",
        "APPLE_ADS_KEY_ID": "your-key-id",
        "APPLE_ADS_PRIVATE_KEY_PATH": "/absolute/path/to/private-key.pem",
        "APPLE_ADS_AD_ACCOUNT_IDS": "123456789"
      }
    }
  }
}
```

`npm run doctor` checks the configuration and the Node.js release without contacting Apple.

> **Prefer a managed connection?** [Use Apple Ads with hosted getmcpads](https://www.getmcpads.com/tools/apple-ads?utm_source=github&utm_medium=readme&utm_campaign=apple-ads). Connect your account, select the data your assistant may access and use the hosted MCP connection. See the site for current features and plans.

## Configuration

The Apple Ads Platform API uses OAuth 2 client credentials. The client secret is a short-lived JWT that this server signs with your private key, then exchanges for an access token valid for one hour. Follow [Apple's OAuth guide](https://developer.apple.com/documentation/apple-ads-platform-api/implementing-oauth-for-the-apple-ads-platform-api):

1. Generate an EC P-256 key pair and keep the private key secret:
   ```bash
   openssl ecparam -genkey -name prime256v1 -noout -out private-key.pem
   openssl ec -in private-key.pem -pubout -out public-key.pem
   ```
2. In Apple Ads, signed in as the API user, open **Account Settings > API**, paste the public key and save.
3. Copy the `clientId`, `teamId` and `keyId` shown above the public key field.

Provide these environment variables through the client's secret configuration:

| Variable | Purpose |
|---|---|
| `APPLE_ADS_CLIENT_ID` | The `clientId` from Account Settings > API. |
| `APPLE_ADS_TEAM_ID` | The `teamId` from Account Settings > API. |
| `APPLE_ADS_KEY_ID` | The `keyId` from Account Settings > API. |
| `APPLE_ADS_PRIVATE_KEY_PATH` | Absolute path to the unencrypted PEM private key. Set this or `APPLE_ADS_PRIVATE_KEY`. |
| `APPLE_ADS_PRIVATE_KEY` | The PEM text itself, as an alternative to the path. Escaped `\n` line breaks are accepted. |
| `APPLE_ADS_AD_ACCOUNT_IDS` | Required comma-separated ad account IDs, from 1 to 200. Every request is restricted to these accounts. |
| `APPLE_ADS_ENABLE_WRITES` | Defaults to `false`. Only the exact value `true` exposes writes. |

The key is read once at startup and kept in memory. Both the PKCS #8 and the SEC1 PEM formats are accepted. This package runs no OAuth browser flow and writes nothing to disk. Account-scoped requests carry the header `X-AP-Context: adAccountId=<id>`, as the Platform API requires. Call `apple_ads_list_ad_accounts` first: it confirms which configured accounts the API user can reach and with which roles.

## Safety and coverage

Writes preview by default. Review the exact account, target and parameters before repeating the call with `confirm: true`.
Update previews return an `expectedSnapshot` of the resource and the change. The confirmed call must pass it back, so a resource that changed in between is not overwritten.
Campaigns, ad groups and keywords are created paused. Setting a status to `ENABLED` can spend advertising budget, and previews flag it with `activationMaySpend`.
Do not retry a write automatically when its result is uncertain. Read the entity and reconcile it first. The only automatic replay is a read sent once more after the access token is renewed.
The account allowlist applies before dispatch and filters account discovery. Parent chains are checked, so a keyword or an ad from another ad account is refused. Unknown arguments are rejected.

Requests go only to `api.ads.apple.com` and `appleid.apple.com`. Redirects are refused, requests time out and responses are size-bounded. Error messages carry Apple's status, a fixed code and vetted validation paths, never provider text, which can echo values or credentials.
Money uses Apple's native objects: a decimal amount in major units with the account currency, such as `{"amount":"1.50","currency":"EUR"}`. Native pagination, attribution metrics, report totals and grand totals are preserved. List and report responses add `nextOffset`, which is `null` on the last page.

This server uses the [Apple Ads Platform API](https://developer.apple.com/documentation/apple-ads-platform-api) v1. Apple states in its [changelog](https://developer.apple.com/documentation/apple-ads-platform-api/changelog-apple-ads-platform-api) that the Platform API supersedes the Campaign Management API, which will be sunset on January 26, 2027.
It exposes the reviewed subset synchronized from the hosted gateway: App Store search-results campaigns, ad groups, keywords, ad renames, apps and reports. Negative keywords, creatives, product pages, budget orders, bulk operations, insights, recommendations and Apple Maps ads are not included.
Use `tools/list` or [server-card.json](server-card.json) for exact schemas.

## Hosted option

[getmcpads for Apple Ads](https://www.getmcpads.com/tools/apple-ads) manages the hosted connection and account selection.
Hosted and source releases can differ. Contact: hello@getmcpads.com.

## Development

```bash
npm run typecheck
npm run lint
npm run build
npm test
npm run catalog
```

All tests run offline with synthetic responses and a mocked `fetch`. No live account is read or changed.

## Tools

Every tool is listed below. See [server-card.json](server-card.json) for complete parameter and output schemas.

<details>
<summary><b>9 read tools</b></summary>

| Tool | Purpose |
| --- | --- |
| `apple_ads_list_ad_accounts` | List the configured ad accounts the API user can access, with organization and roles |
| `apple_ads_get_account` | Read an ad account, including currency, timezone and billing configuration |
| `apple_ads_get_campaigns` | Read a page of campaigns, optionally filtered by status |
| `apple_ads_get_campaign` | Read one campaign and verify that it belongs to the ad account |
| `apple_ads_get_adgroups` | Read a page of the ad groups of one campaign |
| `apple_ads_get_keywords` | Read a page of the positive keywords of one ad group |
| `apple_ads_get_app` | Read App Store app metadata available to the ad account |
| `apple_ads_get_app_eligibility` | Check an app's advertising eligibility and storefronts before creating a campaign |
| `apple_ads_get_report` | Read campaign, ad group, ad, keyword or search-term performance with native totals |

</details>

<details>
<summary><b>11 write tools</b></summary>

Disabled by default. Calls preview unless explicitly confirmed. Check the configuration and exact schema before use.

| Tool | Purpose |
| --- | --- |
| `apple_ads_create_campaign` | Create a paused App Store search-results campaign for an eligible app |
| `apple_ads_create_adgroup` | Create a paused manual cost-per-tap ad group under a verified campaign |
| `apple_ads_create_keyword` | Create a paused positive keyword in a verified ad group |
| `apple_ads_create_account` | Create an ad account in the API user's organization |
| `apple_ads_update_campaign` | Change a campaign's name, status or daily budget, bound to the preview snapshot |
| `apple_ads_update_adgroup` | Change an ad group's name or status, bound to the preview snapshot |
| `apple_ads_update_keyword` | Change a keyword's status or bid, bound to the preview snapshot |
| `apple_ads_rename_campaign` | Rename a campaign |
| `apple_ads_rename_adgroup` | Rename an ad group |
| `apple_ads_rename_ad` | Rename an ad |
| `apple_ads_rename_ad_account` | Rename an ad account, sending the name alone |

</details>

### Resources

| Resource | Content |
| --- | --- |
| `apple-ads://guide` | Account scope, money units, report rules, pagination and write safety |
| `apple-ads://report-catalog` | Native report metrics, additive metrics, grouping dimensions and the rules of each report level |

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

## More from getmcpads

[Meta Ads](https://github.com/get-mcp-ads/meta-ads-mcp-server) · [Google Ads](https://github.com/get-mcp-ads/google-ads-mcp-server) · [Google Analytics 4](https://github.com/get-mcp-ads/google-analytics-mcp-server) · [Google Search Console](https://github.com/get-mcp-ads/google-search-console-mcp-server) · [TikTok Ads](https://github.com/get-mcp-ads/tiktok-ads-mcp-server) · [Pinterest Ads](https://github.com/get-mcp-ads/pinterest-ads-mcp-server) · [X Ads](https://github.com/get-mcp-ads/x-ads-mcp-server)

Maintained by **Emmanuel** at [getmcpads](https://www.getmcpads.com). Questions: [hello@getmcpads.com](mailto:hello@getmcpads.com).
