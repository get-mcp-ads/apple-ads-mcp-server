/**
 * apple-ads-mcp-server: an open-source MCP server for the Apple Ads Platform API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * Native Apple Ads tools, synchronized from the getmcpads gateway
 * (sources/apple_ads/tools.ts) and adapted to a local account allowlist.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { AppleAdsClient } from "./client.js";
import type { ToolShape } from "./tool-quality.js";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
export type Collector = { tool(name: string, description: string, shape: ToolShape, handler: Handler): void };
type Args = Record<string, any>;

const NOT_ALLOWED = "This Apple Ads ad account is not in APPLE_ADS_AD_ACCOUNT_IDS.";
const id = z.string().regex(/^[1-9]\d{0,14}$/).describe("Apple numeric ID, as a string.");
const account = { adAccountId: id.describe("Apple Ads ad account ID from APPLE_ADS_AD_ACCOUNT_IDS. apple_ads_list_ad_accounts lists them.") };
const campaignId = id.describe("Apple campaign ID in the selected ad account.");
const adGroupId = id.describe("Apple ad group ID in the selected ad account.");
const adamId = id.describe("App Store app ID (Adam ID).");
const name = z.string().trim().min(1).max(200).describe("Name displayed in Apple Ads.");
const amount = z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/).refine(v => Number(v) > 0, "Amount must be positive.");
const money = z.object({
  amount: amount.describe("Positive decimal amount in major currency units, such as 1.50."),
  currency: z.string().regex(/^[A-Z]{3}$/).describe("Account currency, ISO 4217."),
}).strict().describe("Positive decimal amount and the ad account currency.");
const date = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "Use a real date.").describe(label);
const paging = {
  offset: z.number().int().min(0).max(1_000_000).prefault(0).describe("Zero-based number of rows to skip. Pass nextOffset from the previous page."),
  limit: z.number().int().min(1).max(1000).prefault(100).describe("Maximum number of rows to return, from 1 to 1000. Use offset for more."),
};
const confirmation = { confirm: z.boolean().prefault(false).describe("False previews. True applies the approved change once. Do not blindly retry a write after a timeout.") };
const WRITE_NOTE = " Preview by default. Ask the user to approve the exact account, target and parameters before confirm:true.";
const filter = (field: string, value: unknown) => ({ field, operator: "EQUALS", value });
const page = (a: Args) => ({ offset: a.offset, pageSize: a.limit, fetchTotalCount: true });

/** Remove any live credential that could appear in an echoed value. */
function redact(text: string, secrets: string[]): string {
  return secrets.filter(s => s.length >= 8).reduce((out, secret) => out.split(secret).join("[REDACTED]"), text);
}

/**
 * Next offset from Apple's native pagination ({ offset, pageSize, totalCount }),
 * or null on the last page. Omitted when Apple returns no total.
 */
export function nextOffset(envelope: { result?: any; pagination?: Record<string, unknown> }, offset: number): { nextOffset?: number | null } {
  const p = envelope.pagination;
  const total = Number(p?.totalCount ?? p?.totalResults);
  if (!p || !Number.isSafeInteger(total)) return {};
  const list = Array.isArray(envelope.result) ? envelope.result : Array.isArray(envelope.result?.rows) ? envelope.result.rows : undefined;
  const returned = list ? list.length : Number(p.pageSize ?? 0);
  const next = offset + returned;
  return { nextOffset: Number.isSafeInteger(returned) && returned > 0 && next < total ? next : null };
}

function tools(c: Collector, api: AppleAdsClient, allowed: readonly string[]) {
  const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: redact(JSON.stringify(data), api.secrets()) }] });
  const register = (suffix: string, description: string, shape: ToolShape, fn: (a: Args) => Promise<unknown>) => {
    const schema = z.object({ ...account, ...shape }).strict();
    c.tool(`apple_ads_${suffix}`, description, schema.shape, async args => {
      const a = schema.parse(args);
      // The allowlist is checked before any request, including parent lookups.
      if (!allowed.includes(a.adAccountId)) throw new Error(NOT_ALLOWED);
      return ok(await fn(a));
    });
  };
  return { ok, register };
}

/** Check parent chains explicitly as well as the server-enforced account header. */
async function campaign(api: AppleAdsClient, accountId: string, campaignId: string) {
  const { result } = await api.request(`/campaigns/${campaignId}`, accountId);
  if (String(result.adAccountId) !== accountId) throw new Error("Campaign does not belong to the selected Apple ad account.");
  return result;
}
async function adgroup(api: AppleAdsClient, accountId: string, adGroupId: string) {
  const { result } = await api.request(`/adgroups/${adGroupId}`, accountId);
  if (!result.campaignId) throw new Error("Ad group has no accessible parent campaign.");
  await campaign(api, accountId, String(result.campaignId));
  return result;
}
async function keyword(api: AppleAdsClient, accountId: string, keywordId: string) {
  const { result } = await api.request(`/keywords/${keywordId}`, accountId);
  if (!result.adGroupId) throw new Error("Keyword has no accessible parent ad group.");
  await adgroup(api, accountId, String(result.adGroupId));
  return result;
}
async function ad(api: AppleAdsClient, accountId: string, adId: string) {
  const { result } = await api.request(`/ads/${adId}`, accountId);
  if (!result.adGroupId) throw new Error("Ad has no accessible parent ad group.");
  await adgroup(api, accountId, String(result.adGroupId));
  return result;
}

export function registerAppleReads(c: Collector, api: AppleAdsClient, allowed: readonly string[]) {
  const { ok, register } = tools(c, api, allowed);
  c.tool("apple_ads_list_ad_accounts", "List the Apple Ads ad accounts this server may use: entries of APPLE_ADS_AD_ACCOUNT_IDS that the API user can access, with organization and roles. Other accounts are never returned. Call this first.", {}, async () => {
    const acls = (await api.acls()).filter(row => allowed.includes(String(row?.adAccount?.id)));
    const found = new Set(acls.map(row => String(row.adAccount.id)));
    return ok({ acls, notAccessible: allowed.filter(value => !found.has(value)), configuredAccountsOnly: true });
  });
  register("get_account", "Read the selected Apple ad account, including native currency, timezone and billing configuration.", {}, async a => api.request(`/ad-accounts/${a.adAccountId}`, a.adAccountId));
  register("get_campaigns", "Read a page of Apple app campaigns, including paused campaigns. Native pagination is returned with nextOffset; offset/limit do not imply a complete account export.", {
    ...paging, status: z.enum(["PAUSED", "ENABLED"]).optional().describe("Only return campaigns with this status."),
  }, async a => {
    const result = await api.request("/campaigns/query", a.adAccountId, { pagination: page(a), ...(a.status ? { filters: [filter("status", a.status)] } : {}) });
    return { ...result, ...nextOffset(result, a.offset) };
  });
  register("get_campaign", "Read one Apple campaign and verify its account membership.", { campaignId }, async a => campaign(api, a.adAccountId, a.campaignId));
  register("get_adgroups", "Read a page of ad groups belonging to one Apple campaign. Native pagination is returned with nextOffset.", { campaignId, ...paging }, async a => {
    await campaign(api, a.adAccountId, a.campaignId);
    const result = await api.request("/adgroups/query", a.adAccountId, { filters: [filter("campaignId", a.campaignId)], pagination: page(a) });
    return { ...result, ...nextOffset(result, a.offset) };
  });
  register("get_keywords", "Read a page of positive keywords belonging to one Apple ad group. Native pagination is returned with nextOffset.", { adGroupId, ...paging }, async a => {
    await adgroup(api, a.adAccountId, a.adGroupId);
    const result = await api.request("/keywords/query", a.adAccountId, { filters: [filter("adGroupId", a.adGroupId)], pagination: page(a) });
    return { ...result, ...nextOffset(result, a.offset) };
  });
  register("get_app", "Read App Store app metadata available to the selected Apple ad account.", { adamId }, async a => api.request(`/apps/${a.adamId}`, a.adAccountId));
  register("get_app_eligibility", "Check an app's advertising eligibility and available storefronts before creating a campaign.", { adamId }, async a => api.request("/eligibilities/apps/query", a.adAccountId, { filters: [filter("adamId", a.adamId)], pagination: { offset: 0, pageSize: 100 } }));
  register("get_report", "Read native Apple campaign, ad group, ad, keyword or search-term performance for explicit campaigns. Preserves spend currency, attribution metrics, timezone, native grand totals and pagination. Never sum ratios or assume a page is the entire account. Monthly/weekly/daily historical reports are supported subject to Apple retention. Omit granularity for period totals. Campaign reports accept up to 20 campaigns; other levels require exactly one campaign per call.", {
    campaignIds: z.array(id).min(1).max(20).describe("Campaign IDs: up to 20 for campaigns; exactly one for adgroups, ads, keywords or searchterms."),
    level: z.enum(["campaigns", "adgroups", "ads", "keywords", "searchterms"]).prefault("campaigns").describe("Report level: campaigns, adgroups, ads, keywords or searchterms."),
    startDate: date("First date of the reporting period, in YYYY-MM-DD format."),
    endDate: date("Last date of the reporting period, in YYYY-MM-DD format, on or after startDate and no later than today."),
    timeZone: z.enum(["ORTZ", "UTC"]).prefault("ORTZ").describe("Report timezone: account timezone (ORTZ) or UTC."),
    granularity: z.enum(["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]).optional().describe("Time breakdown of granularMetrics. Omit for totals over the whole period."),
    fields: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/).max(100)).min(1).max(100).optional().describe("Native metric names. Omit to retrieve all native metrics; Apple validates availability."),
    groupBy: z.array(z.enum(["deviceClass", "ageRange", "gender", "countryCode", "adminArea", "locality", "storefront", "countryOrRegion"])).min(1).max(3).optional().describe("Native demographic or geographic grouping dimensions."),
    ...paging,
  }, async a => {
    validateAppleReport(a);
    for (const campaignId of new Set<string>(a.campaignIds)) await campaign(api, a.adAccountId, campaignId);
    const result = await api.request(`/reports/apps/${a.level}/query`, a.adAccountId, {
      // Live v1 uses id/IN for campaigns and one scalar campaignId/EQUALS for child reports.
      filters: [a.level === "campaigns" ? { field: "id", operator: "IN", value: [...new Set(a.campaignIds)] } : filter("campaignId", a.campaignIds[0])],
      pagination: { offset: a.offset, pageSize: a.limit },
      timeRange: { start: a.startDate, end: a.endDate, timeZone: a.timeZone, ...(a.granularity ? { granularity: a.granularity } : {}) },
      ...(a.fields ? { fields: a.fields } : {}), ...(a.groupBy ? { groupBy: a.groupBy } : {}), options: { includeRows: ["GRAND_TOTAL"] },
    });
    return {
      adAccountId: a.adAccountId, campaignIds: a.campaignIds, startDate: a.startDate, endDate: a.endDate, timeZone: a.timeZone, granularity: a.granularity ?? null,
      ...result, requestedPage: { offset: a.offset, limit: a.limit }, ...nextOffset(result, a.offset),
      note: "Native totals and pagination are preserved. This page is scoped only to the requested campaigns.",
    };
  });
}

export function validateAppleReport(a: Args, now = Date.now()) {
  const start = Date.parse(a.startDate), end = Date.parse(a.endDate), day = 86_400_000;
  const today = Math.floor(now / day) * day;
  if (start > end || end > today) throw new Error("Choose an ordered date range ending no later than today.");
  if (a.level === "searchterms" && a.timeZone !== "ORTZ") throw new Error("Apple search-term reports require ORTZ.");
  // Live v1 accepts historical DAILY and current-year MONTHLY/WEEKLY reports.
  // Let Apple enforce retention rather than the contradictory documented lookbacks.
  if (a.level && a.level !== "campaigns" && a.campaignIds?.length !== 1) throw new Error("Apple adgroup, ad, keyword and search-term reports require exactly one campaignId per call. Call once per campaign; each response has its own totals and pagination.");
  const permitted = a.level === "ads" ? ["storefront", "countryOrRegion"] : ["keywords", "searchterms"].includes(a.level) ? ["deviceClass", "storefront", "countryOrRegion"] : null;
  if (permitted && a.groupBy?.some((v: string) => !permitted.includes(v))) throw new Error("This grouping is not supported for the selected Apple report level.");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/** Hash of the resource as read and the requested change, bound into the confirmation. */
export function snapshot(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function renamePreview(action: string, target: string, newName: string, details: Record<string, unknown> = {}) {
  return {
    applied: false,
    action,
    change: { target, newName, ...details },
    message: "Preview only, nothing was changed. Repeat the same call with confirm: true to apply this rename to the live account.",
  };
}

export function registerAppleWrites(c: Collector, api: AppleAdsClient, allowed: readonly string[]) {
  const { register } = tools(c, api, allowed);
  const write = (suffix: string, description: string, shape: ToolShape, fn: (a: Args) => Promise<unknown>) =>
    register(suffix, description + WRITE_NOTE, { ...shape, ...confirmation }, fn);
  const create = async (a: Args, action: string, path: string, body: Record<string, unknown>, context: string | null = a.adAccountId) => {
    if (!a.confirm) return { applied: false, action, preview: body, accountContext: a.adAccountId, note: "Repeat with confirm:true only after approval. Creations are not automatically retried. A new ad account must be added to APPLE_ADS_AD_ACCOUNT_IDS before use." };
    return { applied: true, action, ...await api.request(path, context ?? undefined, body, "POST", true) };
  };
  write("create_campaign", "Create an App Store search-results campaign in PAUSED state. Requires an eligible app, explicit currency, budget and countries. No delivery is enabled by creation.", {
    name, adamId, dailyBudget: money,
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(100).describe("Eligible target storefront country codes, such as FR."),
  }, async a => {
    const acc = await api.request(`/ad-accounts/${a.adAccountId}`, a.adAccountId);
    if (acc.result.currency !== a.dailyBudget.currency) throw new Error("Budget currency must match the Apple ad account currency.");
    return create(a, "apple_ads_create_campaign", "/campaigns", {
      name: a.name, adAccountId: Number(a.adAccountId), promotedObjectType: "APPSTORE_APP", promotedObjectId: a.adamId,
      billingEvent: "TAPS", dailyBudget: { value: a.dailyBudget }, targeting: { countryOrRegion: { include: a.countries }, supplyPlacement: { include: ["APPSTORE_SEARCH_RESULTS"] } },
      bidStrategy: { bidStrategyType: "MANUAL_CPT", bidStrategyGoal: "TAP" }, status: "PAUSED",
    });
  });
  write("create_adgroup", "Create a PAUSED manual-CPT Apple ad group under a verified campaign. Automated keyword targeting is disabled.", {
    campaignId, name, bid: money.describe("Maximum cost-per-tap bid, in the campaign currency."),
  }, async a => {
    const parent = await campaign(api, a.adAccountId, a.campaignId);
    const currency = (parent.dailyBudget as { value?: { currency?: string } } | undefined)?.value?.currency;
    if (currency && currency !== a.bid.currency) throw new Error("Bid currency must match campaign currency.");
    return create(a, "apple_ads_create_adgroup", "/adgroups", { campaignId: Number(a.campaignId), name: a.name, pricingModel: "CPT", bidStrategy: { bidStrategyType: "MANUAL_CPT", bidStrategyGoal: "TAP", bid: a.bid }, automatedKeywordsOptIn: false, status: "PAUSED" });
  });
  write("create_keyword", "Create a PAUSED positive keyword in a verified Apple ad group.", {
    adGroupId, text: z.string().trim().min(1).max(80).describe("Keyword text."),
    matchType: z.enum(["EXACT", "BROAD"]).describe("Apple keyword match type."),
    bid: money.describe("Keyword cost-per-tap bid, in the account currency."),
  }, async a => {
    await adgroup(api, a.adAccountId, a.adGroupId);
    return create(a, "apple_ads_create_keyword", "/keywords", { adGroupId: Number(a.adGroupId), text: a.text, matchType: a.matchType, bid: a.bid, status: "PAUSED" });
  });
  write("create_account", "Create an additional Apple ad account in the API user's organization. Requires a configured anchor account in that same organization and Apple account-creation permissions. Currency, timezone and billing are inherited; no app delegations or delivery are configured. Add the new ID to APPLE_ADS_AD_ACCOUNT_IDS and restart before using it.", {
    name: name.describe("Name of the new ad account, unique within the organization."),
  }, async a => {
    const [me, acls] = await Promise.all([api.request<{ orgId: number }>("/me"), api.acls()]);
    const anchor = acls.find(row => String(row.adAccount.id) === a.adAccountId);
    if (!anchor || String(anchor.adAccount.orgId) !== String(me.result.orgId)) throw new Error("Account creation requires an anchor account in the API user's organization.");
    return create(a, "apple_ads_create_account", "/ad-accounts", { name: a.name, productFeatures: ["APPSTORE_APP_MANUAL"] }, null);
  });
  for (const entity of ["campaign", "adgroup", "keyword"] as const) {
    const label = entity === "adgroup" ? "ad group" : entity;
    write(`update_${entity}`, `Update an Apple ${label}. Preview returns expectedSnapshot; confirm with that snapshot to reject changed resources or changed payloads. ENABLED may cause advertising spend.`, {
      entityId: id.describe(`Apple ${label} ID in the selected ad account.`),
      ...(entity !== "keyword" ? { name: name.optional().describe("Replacement name.") } : {}),
      status: z.enum(["PAUSED", "ENABLED"]).optional().describe("Desired status. ENABLED may cause spend if parents permit delivery."),
      ...(entity === "campaign" ? { dailyBudget: money.optional().describe("Replacement daily budget, in the account currency.") } : entity === "keyword" ? { bid: money.optional().describe("Replacement keyword bid, in the account currency.") } : {}),
      expectedSnapshot: z.string().regex(/^[a-f0-9]{64}$/).optional().describe("Snapshot returned by the preview for this exact resource and requested change; required when confirming."),
    }, async a => {
      const current = await ({ campaign, adgroup, keyword }[entity])(api, a.adAccountId, a.entityId);
      const body = { ...(a.name ? { name: a.name } : {}), ...(a.status ? { status: a.status } : {}), ...(a.dailyBudget ? { dailyBudget: { value: a.dailyBudget } } : {}), ...(a.bid ? { bid: a.bid } : {}) };
      if (!Object.keys(body).length) throw new Error("Choose at least one field to update.");
      const expectedSnapshot = snapshot({ account: a.adAccountId, entity, id: a.entityId, current, body });
      if (!a.confirm) return { applied: false, action: `apple_ads_update_${entity}`, current, change: body, expectedSnapshot, activationMaySpend: a.status === "ENABLED" };
      if (a.expectedSnapshot !== expectedSnapshot) throw new Error("Missing or stale snapshot. Preview the exact change again before confirming.");
      const response = await api.request(`/${entity === "adgroup" ? "adgroups" : `${entity}s`}/${a.entityId}`, a.adAccountId, body, "PUT", true);
      return { applied: true, action: `apple_ads_update_${entity}`, ...response, note: "Apple acknowledged the update. Read back the entity before making dependent changes." };
    });
  }
  // Renames carry only the name: Apple updates are partial, so nothing else
  // moves. An ad account rename must never send delegations, which it replaces.
  const renames = [
    ["campaign", "campaignId", "campaigns", campaign],
    ["adgroup", "adGroupId", "adgroups", adgroup],
    ["ad", "adId", "ads", ad],
    ["ad_account", null, "ad-accounts", null],
  ] as const;
  for (const [entity, param, path, read] of renames) {
    const tool = `apple_ads_rename_${entity}`;
    const label = entity === "adgroup" ? "ad group" : entity.replace("_", " ");
    write(`rename_${entity}`, `Rename an Apple ${label}. The name is the only thing that changes.`, {
      ...(param ? { [param]: id.describe(`Apple ${label} ID in the selected ad account.`) } : {}),
      name: name.describe(`New ${label} name.`),
    }, async a => {
      const target = param ? String(a[param]) : String(a.adAccountId);
      const current = read ? await read(api, a.adAccountId, target) : (await api.request(`/ad-accounts/${a.adAccountId}`, a.adAccountId)).result;
      if (!a.confirm) return renamePreview(tool, target, a.name, { currentName: current?.name ?? null });
      const response = await api.request(`/${path}/${target}`, a.adAccountId, { name: a.name }, "PUT", true);
      return { applied: true, action: tool, ...response };
    });
  }
}
