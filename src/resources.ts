/**
 * apple-ads-mcp-server: an open-source MCP server for the Apple Ads Platform API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { APPLE_REPORT_CATALOG } from "./catalog.js";

export const GUIDE_URI = "apple-ads://guide";
export const REPORT_CATALOG_URI = "apple-ads://report-catalog";

const GUIDE = [
  "Apple Ads MCP server guide.",
  "Accounts: only the ad accounts listed in APPLE_ADS_AD_ACCOUNT_IDS are used. Each request is checked before it is sent, and apple_ads_list_ad_accounts returns only those accounts. Requests go to the Apple Ads Platform API v1 with the header X-AP-Context: adAccountId=<id>.",
  "Money: amounts are decimal strings in major units with an ISO 4217 currency, such as {\"amount\":\"1.50\",\"currency\":\"EUR\"}. They are not micro units. A budget or bid must use the account currency.",
  "Reports: apple_ads_get_report returns native rows, total metrics and the grand total. Campaign reports take up to 20 campaigns; the other levels take exactly one campaign per call. Search-term reports use ORTZ, the account reporting timezone. Sum only additive metrics and recompute ratios from summed parts. A report with no rows can return a result without a rows array and zero pagination. Ad-level rows can carry adId -1 for an ad group's default ad.",
  "Pagination: list and report tools take offset and limit. Responses keep Apple's pagination object and add nextOffset, which is null on the last page.",
  "Writes: disabled unless APPLE_ADS_ENABLE_WRITES is true. Every write previews unless confirm is true. Update previews return expectedSnapshot, which the confirmed call must pass back unchanged. Campaigns, ad groups and keywords are created PAUSED. Setting status ENABLED can spend budget. A write with an uncertain outcome is never retried; read the entity before trying again.",
  "Rate limits: an HTTP 429 error states how long to wait. Nothing is retried automatically, except a read that is replayed once after the access token is renewed.",
  "Reference: https://developer.apple.com/documentation/apple-ads-platform-api",
].join("\n\n");

export function registerAppleResources(server: McpServer): void {
  server.registerResource("Apple Ads guide", GUIDE_URI, {
    title: "Apple Ads guide", description: "Account scope, money units, report rules, pagination and write safety for this server.", mimeType: "text/plain",
  }, async () => ({ contents: [{ uri: GUIDE_URI, mimeType: "text/plain", text: GUIDE }] }));
  server.registerResource("Apple Ads report catalog", REPORT_CATALOG_URI, {
    title: "Apple Ads report catalog", description: "Native report metrics, additive metrics, grouping dimensions and the rules of each report level.", mimeType: "application/json",
  }, async () => ({ contents: [{ uri: REPORT_CATALOG_URI, mimeType: "application/json", text: JSON.stringify(APPLE_REPORT_CATALOG, null, 2) }] }));
}
