import { afterEach, describe, expect, it, vi } from "vitest";
import { verify } from "node:crypto";
import { appleClientSecret, AppleTokenProvider, requestAccessToken } from "../../src/auth.js";
import { AppleAdsClient } from "../../src/client.js";
import { APPLE_API_BASE, APPLE_TOKEN_URL } from "../../src/endpoints.js";
import { nextOffset, validateAppleReport } from "../../src/tools.js";
import { collect, publicKey, signing } from "./catalogue";

const token = "secret-test-token-never-log";
const account = "24166290";
const campaign = { id: 11, adAccountId: Number(account), name: "Test", status: "PAUSED", dailyBudget: { value: { amount: "1.00", currency: "EUR" } } };
const adgroup = { id: 21, campaignId: 11, name: "Group", status: "PAUSED" };
const keyword = { id: 31, adGroupId: 21, text: "maps", status: "PAUSED" };
const ad = { id: 41, adGroupId: 21, name: "Ad", status: "ENABLED" };
const envelope = (result: unknown, pagination?: unknown) => Response.json({ result, ...(pagination ? { pagination } : {}) });
const data = (result: any) => JSON.parse(result.content[0].text);
type Route = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Mock fetch: a valid token endpoint plus the given API routes. Every call must refuse redirects. */
function mock(route: Route = () => { throw new Error("Unexpected API request"); }) {
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    if (url === APPLE_TOKEN_URL) return Response.json({ access_token: token, token_type: "Bearer", expires_in: 3600, scope: "searchadsorg" });
    expect(url.startsWith(`${APPLE_API_BASE}/`)).toBe(true);
    return route(url, init);
  });
  vi.stubGlobal("fetch", fetcher);
  const api = () => fetcher.mock.calls.filter(([url]) => url !== APPLE_TOKEN_URL) as [string, RequestInit][];
  return { fetcher, api, mutations: () => api().filter(([url, init]) => init.method === "PUT" || (init.method === "POST" && !url.endsWith("/query"))) };
}
/** Entity reads by path, as the parent checks perform them. */
const entities: Route = url => {
  const path = url.slice(APPLE_API_BASE.length);
  if (path === "/campaigns/11") return envelope(campaign);
  if (path === "/adgroups/21") return envelope(adgroup);
  if (path === "/keywords/31") return envelope(keyword);
  if (path === "/ads/41") return envelope(ad);
  if (path === `/ad-accounts/${account}`) return envelope({ id: Number(account), name: "Account", currency: "EUR", timezone: "Europe/Paris" });
  throw new Error(`Unexpected ${path}`);
};
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("OAuth client credentials", () => {
  it("signs a valid ES256 client secret bound to Apple, client, team and a five-minute expiry", () => {
    const jwt = appleClientSecret(signing, 1000);
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: "test-key" });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({ iss: "SEARCHADS.test-team", sub: "SEARCHADS.test-client", aud: "https://appleid.apple.com", iat: 1000, exp: 1300 });
    expect(verify("SHA256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
  });
  it("requests a client_credentials token with the searchadsorg scope from Apple's token endpoint", async () => {
    const { fetcher } = mock();
    expect(await requestAccessToken(signing)).toEqual({ accessToken: token, expiresIn: 3600 });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://appleid.apple.com/auth/oauth2/token");
    expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const body = init.body as URLSearchParams;
    expect(Object.fromEntries(body)).toMatchObject({ grant_type: "client_credentials", client_id: "SEARCHADS.test-client", scope: "searchadsorg" });
    expect(body.get("client_secret")!.split(".")).toHaveLength(3);
  });
  it("caches the token and shares one renewal between concurrent callers", async () => {
    const { fetcher } = mock();
    let now = 0;
    const provider = new AppleTokenProvider(signing, () => now);
    expect(await Promise.all([provider.token(), provider.token(), provider.token()])).toEqual([token, token, token]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 3_500_000; await provider.token();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 3_550_000; await provider.token();
    expect(fetcher).toHaveBeenCalledTimes(2);
    provider.invalidate(token); await provider.token();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([
    [Response.json({ error: "invalid_client", error_description: token }, { status: 401 }), "TOKEN_INVALID_CLIENT"],
    [Response.json({ error: token }, { status: 400 }), "TOKEN_EXCHANGE_FAILED"],
    [new Response(`<html>${token}</html>`, { status: 200 }), "TOKEN_EXCHANGE_FAILED"],
    [Response.json({ access_token: token, expires_in: 0 }), "TOKEN_EXCHANGE_FAILED"],
    [Response.json({ access_token: token, expires_in: 3600, token_type: "mac" }), "TOKEN_EXCHANGE_FAILED"],
  ])("refuses a bad token response once, without relaying its body (%#)", async (response, code) => {
    const fetcher = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetcher);
    const error = await requestAccessToken(signing).catch(e => e);
    expect(error.message).toContain(code);
    expect(error.message).not.toContain(token);
    expect(error.message).toContain("APPLE_ADS_CLIENT_ID");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports a token transport failure or redirect without detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError(`redirect to https://evil.test/?t=${token}`)));
    const error = await requestAccessToken(signing).catch(e => e);
    expect(error.message).toContain("TOKEN_TRANSPORT_ERROR");
    expect(error.message).not.toMatch(/evil|secret-test/);
  });
});

describe("Apple Ads Platform API requests", () => {
  it("uses the v1 origin, a bearer token and the adAccountId context", async () => {
    const { api } = mock(() => envelope(campaign));
    await new AppleAdsClient(signing, [account]).request("/campaigns/11", account);
    expect(api()[0]).toMatchObject([`${APPLE_API_BASE}/campaigns/11`, { method: "GET", headers: { Authorization: `Bearer ${token}`, "X-AP-Context": `adAccountId=${account}` }, redirect: "error" }]);
  });
  it("rejects foreign paths, unlisted accounts and context-free account requests before any network access", async () => {
    const { fetcher } = mock();
    const client = new AppleAdsClient(signing, [account]);
    await expect(client.request("//attacker.test", account)).rejects.toThrow("Invalid");
    await expect(client.request("/campaigns?x=1", account)).rejects.toThrow("Invalid");
    await expect(client.request("/campaigns/11", "999")).rejects.toThrow("APPLE_ADS_AD_ACCOUNT_IDS");
    await expect(client.request("/campaigns/11")).rejects.toThrow("needs an ad account");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends /me, /acls and ad account creation without a context header", async () => {
    const { api } = mock(() => envelope({ acls: [] }));
    const client = new AppleAdsClient(signing, [account]);
    await client.request("/me"); await client.request("/acls"); await client.request("/ad-accounts", undefined, {}, "POST", true);
    expect(api().every(([, init]) => (init.headers as Record<string, string>)["X-AP-Context"] === undefined)).toBe(true);
  });
  it.each([[400, "VALIDATION_ERROR"], [401, "AUTHORIZATION_EXPIRED"], [403, "PERMISSION_DENIED"], [404, "NOT_FOUND"], [429, "RATE_LIMITED"], [500, "REQUEST_FAILED"], [503, "REQUEST_FAILED"]])("maps HTTP %s to %s, redacts the body and never retries a write", async (status, code) => {
    const { api } = mock(() => new Response(token, { status }));
    const error = await new AppleAdsClient(signing, [account]).request("/campaigns", account, {}, "POST", true).catch(e => e);
    expect(error.message).toContain(code);
    expect(error.message).not.toContain(token);
    expect(error.uncertain).toBe(status >= 500);
    expect(api()).toHaveLength(1);
  });
  it("treats HTTP 200 with an error body as a failure, and as uncertain for a write", async () => {
    mock(() => Response.json({ error: { code: "INTERNAL", message: token } }));
    const client = new AppleAdsClient(signing, [account]);
    const read = await client.request("/campaigns/11", account).catch(e => e);
    expect(read.message).toContain("INVALID_RESPONSE"); expect(read.uncertain).toBe(false); expect(read.message).not.toContain(token);
    const write = await client.request("/campaigns", account, {}, "POST", true).catch(e => e);
    expect(write.uncertain).toBe(true); expect(write.message).toContain("may have completed");
  });
  it("states the rate-limit wait from Retry-After", async () => {
    mock(() => new Response("{}", { status: 429, headers: { "Retry-After": "37", "RateLimit-Reset": "50" } }));
    await expect(new AppleAdsClient(signing, [account]).request("/campaigns/11", account)).rejects.toThrow("Wait 37 seconds");
  });
  it("replays a read once after a 401 with a renewed token, and never replays a write", async () => {
    let calls = 0;
    const { fetcher, api } = mock(() => (++calls === 1 ? new Response("{}", { status: 401 }) : envelope(campaign)));
    const client = new AppleAdsClient(signing, [account]);
    expect((await client.request("/campaigns/11", account)).result).toEqual(campaign);
    expect(api()).toHaveLength(2);
    expect(fetcher.mock.calls.filter(([url]) => url === APPLE_TOKEN_URL)).toHaveLength(2);
    calls = 0; fetcher.mockClear();
    await expect(client.request("/campaigns", account, {}, "POST", true)).rejects.toThrow("AUTHORIZATION_EXPIRED");
    expect(api()).toHaveLength(1);
  });
  it("flags a failed or redirected creation as uncertain without replay", async () => {
    const { api } = mock(() => { throw new TypeError(`redirected to https://evil.test/${token}`); });
    const error = await new AppleAdsClient(signing, [account]).request("/campaigns", account, {}, "POST", true).catch(e => e);
    expect(error.message).toContain("may have completed");
    expect(error.message).not.toMatch(/evil|secret-test/);
    expect(api()).toHaveLength(1);
  });
  it("bounds the response size", async () => {
    const chunk = new Uint8Array(1_000_000);
    mock(() => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 9; i++) c.enqueue(chunk); c.close(); } })));
    await expect(new AppleAdsClient(signing, [account]).request("/campaigns/11", account)).rejects.toThrow("RESPONSE_TOO_LARGE");
  });
  it("exposes validation codes and paths without echoing provider messages or values", async () => {
    mock(() => Response.json({ error: { code: "VALIDATION_ERROR", message: token, details: [
      { code: "INVALID_FIELD_ATTRIBUTE", message: token, info: { fields: ["filters[0].field", token], invalidFields: [token] } },
      { code: token, info: { field: token } },
      { code: "INVALID_VALUE_FIELD", info: { field: "timeRange.granularity" } },
    ] } }, { status: 400 }));
    const error = await new AppleAdsClient(signing, [account]).request("/reports/apps/campaigns/query", account, {}).catch(e => e);
    expect(error.message).toContain("INVALID_FIELD_ATTRIBUTE at filters[0].field");
    expect(error.message).toContain("INVALID_VALUE_FIELD at timeRange.granularity");
    expect(error.message).not.toContain(token);
  });
});

describe("account allowlist", () => {
  it("refuses every tool on an unlisted account before any request, token included", async () => {
    const { fetcher } = mock();
    const { tools } = collect([account]);
    const superset: Record<string, unknown> = { adAccountId: "999", campaignId: "11", adGroupId: "21", adId: "41", entityId: "11", adamId: "1", name: "X", text: "x", matchType: "EXACT", status: "PAUSED", bid: { amount: "1", currency: "EUR" }, dailyBudget: { amount: "1", currency: "EUR" }, countries: ["FR"], campaignIds: ["11"], startDate: "2026-01-01", endDate: "2026-01-02", confirm: true };
    const scoped = tools.filter(t => t.name !== "apple_ads_list_ad_accounts");
    expect(scoped).toHaveLength(19);
    for (const t of scoped) {
      const args = Object.fromEntries(Object.entries(superset).filter(([key]) => key in t.shape));
      await expect(t.handler(args), t.name).rejects.toThrow("APPLE_ADS_AD_ACCOUNT_IDS");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("filters account discovery to the configured accounts", async () => {
    mock(url => {
      expect(url).toBe(`${APPLE_API_BASE}/acls`);
      return envelope({ acls: [{ adAccount: { id: Number(account), name: "Allowed", orgId: 42 }, roles: ["Admin"] }, { adAccount: { id: 777, name: "Private client", orgId: 42 }, roles: ["Admin"] }] });
    });
    const result = data(await collect([account, "555"]).tool("list_ad_accounts").handler({}));
    expect(result.acls).toEqual([{ adAccount: { id: Number(account), name: "Allowed", orgId: 42 }, roles: ["Admin"] }]);
    expect(result.notAccessible).toEqual(["555"]);
    expect(JSON.stringify(result)).not.toContain("Private client");
  });
  it.each([false, true])("refuses a foreign parent before any mutation, confirm=%s", async confirm => {
    const { mutations } = mock(() => envelope({ ...campaign, adAccountId: 999 }));
    await expect(collect().tool("create_adgroup").handler({ adAccountId: account, campaignId: "11", name: "Test", bid: { amount: "1", currency: "EUR" }, confirm })).rejects.toThrow("does not belong");
    expect(mutations()).toHaveLength(0);
  });
  it("checks the whole parent chain of keywords and ads", async () => {
    mock(url => url.endsWith("/campaigns/11") ? envelope({ ...campaign, adAccountId: 999 }) : entities(url, {}));
    await expect(collect().tool("update_keyword").handler({ adAccountId: account, entityId: "31", status: "PAUSED" })).rejects.toThrow("does not belong");
    await expect(collect().tool("rename_ad").handler({ adAccountId: account, adId: "41", name: "New" })).rejects.toThrow("does not belong");
  });
});

describe("writes", () => {
  const previews: [string, Record<string, unknown>][] = [
    ["create_campaign", { name: "Test", adamId: "123", dailyBudget: { amount: "1.00", currency: "EUR" }, countries: ["FR"] }],
    ["create_adgroup", { campaignId: "11", name: "Test", bid: { amount: "1", currency: "EUR" } }],
    ["create_keyword", { adGroupId: "21", text: "maps", matchType: "EXACT", bid: { amount: "0.5", currency: "EUR" } }],
    ["create_account", { name: "New account" }],
    ["update_campaign", { entityId: "11", status: "ENABLED" }],
    ["update_adgroup", { entityId: "21", name: "Renamed" }],
    ["update_keyword", { entityId: "31", bid: { amount: "2", currency: "EUR" } }],
    ["rename_campaign", { campaignId: "11", name: "Renamed" }],
    ["rename_adgroup", { adGroupId: "21", name: "Renamed" }],
    ["rename_ad", { adId: "41", name: "Renamed" }],
    ["rename_ad_account", { name: "Renamed" }],
  ];
  it("covers every write tool", () => {
    expect(collect().tools.filter(t => t.write).map(t => t.name).sort()).toEqual(previews.map(([n]) => `apple_ads_${n}`).sort());
  });
  it.each(previews)("%s previews without a mutation", async (name, args) => {
    const { mutations } = mock(url => url.endsWith("/me") ? envelope({ orgId: 42 }) : url.endsWith("/acls") ? envelope({ acls: [{ adAccount: { id: Number(account), orgId: 42, name: "A" }, roles: ["Admin"] }] }) : entities(url, {}));
    expect(data(await collect().tool(name).handler({ adAccountId: account, ...args }))).toMatchObject({ applied: false, action: `apple_ads_${name}` });
    expect(mutations()).toHaveLength(0);
  });
  it("forces PAUSED on creation and rejects a status argument", async () => {
    const { mutations } = mock((url, init) => init.method === "POST" ? envelope({ id: 11, ...JSON.parse(String(init.body)) }) : entities(url, init));
    const args = { adAccountId: account, name: "Test", adamId: "123", dailyBudget: { amount: "1.00", currency: "EUR" }, countries: ["FR"] };
    const applied = data(await collect().tool("create_campaign").handler({ ...args, confirm: true }));
    expect(applied).toMatchObject({ applied: true, result: { status: "PAUSED" } });
    expect(JSON.parse(String(mutations()[0][1].body))).toMatchObject({ status: "PAUSED", dailyBudget: { value: args.dailyBudget }, adAccountId: Number(account) });
    await expect(collect().tool("create_campaign").handler({ ...args, status: "ENABLED" })).rejects.toThrow();
    await expect(collect().tool("create_campaign").handler({ ...args, dailyBudget: { amount: "1.00", currency: "USD" } })).rejects.toThrow("currency");
  });
  it("binds confirmation to resource state and the exact requested change", async () => {
    const { mutations } = mock((url, init) => init.method === "PUT" ? envelope({ ...campaign, name: "Renamed" }) : entities(url, init));
    const args = { adAccountId: account, entityId: "11", name: "Renamed" };
    const preview = data(await collect().tool("update_campaign").handler(args));
    expect(preview.expectedSnapshot).toMatch(/^[a-f0-9]{64}$/);
    await expect(collect().tool("update_campaign").handler({ ...args, confirm: true })).rejects.toThrow("snapshot");
    await expect(collect().tool("update_campaign").handler({ ...args, name: "Changed", confirm: true, expectedSnapshot: preview.expectedSnapshot })).rejects.toThrow("stale");
    expect(mutations()).toHaveLength(0);
    expect(data(await collect().tool("update_campaign").handler({ ...args, confirm: true, expectedSnapshot: preview.expectedSnapshot })).applied).toBe(true);
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0][0]).toBe(`${APPLE_API_BASE}/campaigns/11`);
    expect(JSON.parse(String(mutations()[0][1].body))).toEqual({ name: "Renamed" });
  });
  it("flags activation as able to spend", async () => {
    mock(entities);
    expect(data(await collect().tool("update_adgroup").handler({ adAccountId: account, entityId: "21", status: "ENABLED" })).activationMaySpend).toBe(true);
    expect(data(await collect().tool("update_adgroup").handler({ adAccountId: account, entityId: "21", status: "PAUSED" })).activationMaySpend).toBe(false);
  });
  it("renames send the name alone, and an ad account rename never sends delegations", async () => {
    const { mutations } = mock((url, init) => init.method === "PUT" ? envelope({ id: Number(account), name: "Renamed" }) : entities(url, init));
    await collect().tool("rename_ad_account").handler({ adAccountId: account, name: "Renamed", confirm: true });
    await collect().tool("rename_ad").handler({ adAccountId: account, adId: "41", name: "Renamed", confirm: true });
    expect(mutations().map(([url, init]) => [url.slice(APPLE_API_BASE.length), init.method, JSON.parse(String(init.body))])).toEqual([
      [`/ad-accounts/${account}`, "PUT", { name: "Renamed" }],
      ["/ads/41", "PUT", { name: "Renamed" }],
    ]);
  });
  it("creates an ad account only in the anchor organization, without a context header", async () => {
    const { mutations } = mock(url => url.endsWith("/me") ? envelope({ orgId: 42 }) : url.endsWith("/acls") ? envelope({ acls: [{ adAccount: { id: Number(account), orgId: 42, name: "A" }, roles: ["Admin"] }] }) : envelope({ id: 999 }));
    await collect().tool("create_account").handler({ adAccountId: account, name: "Test account", confirm: true });
    const [url, init] = mutations()[0];
    expect(url).toBe(`${APPLE_API_BASE}/ad-accounts`);
    expect((init.headers as Record<string, string>)["X-AP-Context"]).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({ name: "Test account", productFeatures: ["APPSTORE_APP_MANUAL"] });
  });
  it("rejects cross-organization account creation", async () => {
    const { mutations } = mock(url => url.endsWith("/me") ? envelope({ orgId: 42 }) : envelope({ acls: [{ adAccount: { id: Number(account), orgId: 99 }, roles: ["Admin"] }] }));
    await expect(collect().tool("create_account").handler({ adAccountId: account, name: "Test", confirm: true })).rejects.toThrow("anchor");
    expect(mutations()).toHaveLength(0);
  });
});

describe("reads, reports and pagination", () => {
  it("preserves native report currency, attribution metrics, grand totals and pagination", async () => {
    const native = { rows: [{ metadata: { id: 11 }, totalMetrics: { localSpend: { amount: "1.25", currency: "EUR" }, tapInstalls: 1, viewInstalls: 2 } }], summary: { grandTotal: { localSpend: { amount: "9.99", currency: "EUR" } } } };
    const pagination = { offset: 0, pageSize: 1, totalCount: 10 };
    const { api } = mock(url => url.endsWith("/query") ? envelope(native, pagination) : entities(url, {}));
    const result = data(await collect().tool("get_report").handler({ adAccountId: account, campaignIds: ["11"], startDate: "2025-01-01", endDate: "2025-01-31", limit: 1 }));
    expect(result.result).toEqual(native); expect(result.pagination).toEqual(pagination); expect(result.nextOffset).toBe(1);
    expect(api()[1][0]).toBe(`${APPLE_API_BASE}/reports/apps/campaigns/query`);
    expect(JSON.parse(String(api()[1][1].body))).toMatchObject({ filters: [{ field: "id", operator: "IN", value: ["11"] }], timeRange: { start: "2025-01-01", end: "2025-01-31", timeZone: "ORTZ" }, pagination: { offset: 0, pageSize: 1 }, options: { includeRows: ["GRAND_TOTAL"] } });
  });
  it.each(["adgroups", "ads", "keywords", "searchterms"])("uses a scalar campaign parent for %s and rejects multiple campaigns before HTTP", async level => {
    const { api, fetcher } = mock(url => url.endsWith("/query") ? envelope({ rows: [] }) : entities(url, {}));
    const args = { adAccountId: account, campaignIds: ["11"], level, startDate: "2026-01-01", endDate: "2026-09-15" };
    await collect().tool("get_report").handler(args);
    expect(JSON.parse(String(api()[1][1].body)).filters).toEqual([{ field: "campaignId", operator: "EQUALS", value: "11" }]);
    fetcher.mockClear();
    await expect(collect().tool("get_report").handler({ ...args, campaignIds: ["11", "12"] })).rejects.toThrow("exactly one campaignId");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("accepts live-verified historical granularity and rejects invalid ranges and groupings", () => {
    const now = Date.parse("2026-09-15");
    for (const granularity of ["DAILY", "WEEKLY", "MONTHLY"]) expect(() => validateAppleReport({ startDate: "2026-01-01", endDate: "2026-09-15", granularity }, now)).not.toThrow();
    expect(() => validateAppleReport({ startDate: "2026-09-16", endDate: "2026-09-15" }, now)).toThrow("ordered date");
    expect(() => validateAppleReport({ startDate: "2026-09-15", endDate: "2026-09-16" }, now)).toThrow("ordered date");
    expect(() => validateAppleReport({ startDate: "2026-09-01", endDate: "2026-09-02", level: "searchterms", timeZone: "UTC", campaignIds: ["1"] }, now)).toThrow("ORTZ");
    expect(() => validateAppleReport({ startDate: "2026-09-01", endDate: "2026-09-02", level: "ads", campaignIds: ["1"], groupBy: ["gender"] }, now)).toThrow("grouping");
    expect(() => validateAppleReport({ startDate: "2025-01-01", endDate: "2025-01-31" }, now)).not.toThrow();
  });
  it("pages campaigns with native pagination and a nextOffset that ends on the last page", async () => {
    const { api } = mock((_url, init) => {
      const { pagination } = JSON.parse(String(init.body));
      const rows = [{ id: 1 }, { id: 2 }, { id: 3 }].slice(pagination.offset, pagination.offset + pagination.pageSize);
      return envelope(rows, { offset: pagination.offset, pageSize: rows.length, totalCount: 3 });
    });
    const first = data(await collect().tool("get_campaigns").handler({ adAccountId: account, limit: 2, status: "PAUSED" }));
    expect(first).toMatchObject({ result: [{ id: 1 }, { id: 2 }], pagination: { totalCount: 3 }, nextOffset: 2 });
    expect(JSON.parse(String(api()[0][1].body))).toEqual({ pagination: { offset: 0, pageSize: 2, fetchTotalCount: true }, filters: [{ field: "status", operator: "EQUALS", value: "PAUSED" }] });
    const last = data(await collect().tool("get_campaigns").handler({ adAccountId: account, limit: 2, offset: 2 }));
    expect(last).toMatchObject({ result: [{ id: 3 }], nextOffset: null });
  });
  it("computes nextOffset defensively", () => {
    expect(nextOffset({ result: {}, pagination: { offset: 0, pageSize: 0, totalCount: 0 } }, 0)).toEqual({ nextOffset: null });
    expect(nextOffset({ result: [] , pagination: { totalCount: 5 } }, 0)).toEqual({ nextOffset: null });
    expect(nextOffset({ result: [{}] }, 0)).toEqual({});
  });
  it("verifies parents before listing children", async () => {
    const { api } = mock(url => url.endsWith("/query") ? envelope([], { offset: 0, pageSize: 0, totalCount: 0 }) : entities(url, {}));
    await collect().tool("get_keywords").handler({ adAccountId: account, adGroupId: "21" });
    expect(api().map(([url]) => url.slice(APPLE_API_BASE.length))).toEqual(["/adgroups/21", "/campaigns/11", "/keywords/query"]);
    expect(JSON.parse(String(api()[2][1].body)).filters).toEqual([{ field: "adGroupId", operator: "EQUALS", value: "21" }]);
  });
  it("redacts the access token if Apple ever echoes it", async () => {
    mock(() => envelope({ id: Number(account), note: `Bearer ${token}` }));
    const text = (await collect().tool("get_account").handler({ adAccountId: account })).content[0].text;
    expect(text).not.toContain(token);
    expect(text).toContain("[REDACTED]");
  });
});
