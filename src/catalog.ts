/**
 * apple-ads-mcp-server: an open-source MCP server for the Apple Ads Platform API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * Native report metrics and dimensions, synchronized from the getmcpads gateway.
 */

/** Count metrics that can be summed across rows. Ratios and money ratios cannot. */
export const APPLE_ADDITIVE_METRICS = [
  "impressions", "taps", "tapInstalls", "viewInstalls", "totalInstalls",
  "tapNewDownloads", "tapRedownloads", "viewNewDownloads", "viewRedownloads",
  "totalNewDownloads", "totalRedownloads",
  "tapPreOrdersPlaced", "viewPreOrdersPlaced", "totalPreOrdersPlaced",
];

export const APPLE_REPORT_DIMENSIONS = ["deviceClass", "ageRange", "gender", "countryCode", "adminArea", "locality", "storefront", "countryOrRegion"] as const;

const metrics: { key: string; format?: "json"; description: string }[] = [
  { key: "impressions", description: "Native Apple ad impressions." },
  { key: "taps", description: "Native Apple ad taps." },
  { key: "localSpend", format: "json", description: "Native spend money object; preserves amount and account currency." },
  { key: "ttr", description: "Native tap-through rate. Do not sum or average row rates to calculate a total." },
  { key: "cpt", format: "json", description: "Native cost per tap money object; preserves amount and currency." },
  { key: "tapInstalls", description: "Native tap-attributed installs, kept separate from total installs." },
  { key: "totalInstalls", description: "Native total attributed installs, including Apple's supported attribution types." },
  { key: "tapNewDownloads", description: "Native new downloads attributed to an ad tap." },
  { key: "tapRedownloads", description: "Native redownloads attributed to an ad tap." },
];

export const APPLE_REPORT_CATALOG = {
  metrics: metrics.map(metric => ({ ...metric, additive: APPLE_ADDITIVE_METRICS.includes(metric.key) })),
  additiveMetrics: APPLE_ADDITIVE_METRICS,
  dimensions: APPLE_REPORT_DIMENSIONS.map(key => ({
    key,
    description: "Apple report grouping. Availability depends on the report level; apple_ads_get_report validates compatible dimensions.",
  })),
  levels: {
    campaigns: { campaignIds: "1 to 20", groupBy: [...APPLE_REPORT_DIMENSIONS] },
    adgroups: { campaignIds: "exactly 1", groupBy: [...APPLE_REPORT_DIMENSIONS] },
    ads: { campaignIds: "exactly 1", groupBy: ["storefront", "countryOrRegion"] },
    keywords: { campaignIds: "exactly 1", groupBy: ["deviceClass", "storefront", "countryOrRegion"] },
    searchterms: { campaignIds: "exactly 1", groupBy: ["deviceClass", "storefront", "countryOrRegion"], timeZone: "ORTZ only" },
  },
  notes: [
    "Omit fields to receive every native metric; Apple validates field availability.",
    "Money metrics are objects with a decimal amount in major units and the account currency.",
    "Sum only additive metrics. Recompute ratios from their summed numerators and denominators.",
  ],
};
