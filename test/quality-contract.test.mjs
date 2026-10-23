import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createServer } from "../dist/index.js";
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const fixture = { clientId: "SEARCHADS.metadata-fixture", teamId: "SEARCHADS.metadata-fixture", keyId: "metadata-fixture", privateKey, allowedAccountIds: ["100"] };
async function connect(enableWrites, callback) {
  const server = createServer({ ...fixture, enableWrites });
  const client = new Client({ name: "quality-contract", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try { await callback(client, server); } finally { await client.close(); await server.close(); }
}
test("metadata is complete over MCP; write tools require explicit opt-in", async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => { throw new Error("Metadata must not access a provider"); };
  try {
    for (const enabled of [false, true]) await connect(enabled, async client => {
      const tools = (await client.listTools()).tools;
      assert.equal(new Set(tools.map(t => t.name)).size, tools.length, "duplicate tools");
      assert.ok(tools.every(t => t.name.startsWith("apple_ads_")), "gateway prefix");
      for (const tool of tools) {
        assert.ok(tool.description.length > 20, tool.name);
        assert.ok(tool.outputSchema?.required.includes("result"), tool.name);
        assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", tool.name);
        if (!enabled) assert.equal(tool.annotations.readOnlyHint, true, tool.name);
        if (!tool.annotations.readOnlyHint) {
          assert.ok(tool.inputSchema.properties.confirm, tool.name);
          assert.equal(tool.inputSchema.properties.confirm.default, false, tool.name);
          assert.equal(tool.annotations.idempotentHint, false, tool.name);
        } else assert.equal(tool.inputSchema.properties?.confirm, undefined, tool.name);
        for (const [key, schema] of Object.entries(tool.inputSchema.properties || {})) assert.ok(schema.description, `${tool.name}.${key}`);
      }
      assert.equal(tools.filter(t => !t.annotations.readOnlyHint).length, enabled ? 11 : 0);
      assert.equal(client.getServerVersion().websiteUrl, pkg.homepage);
      assert.equal(client.getServerVersion().version, pkg.version);
    });
  } finally { globalThis.fetch = original; }
});
test("structured output preserves text, JSON arrays and errors through the SDK", async () => {
  await connect(false, async (client, server) => {
    server.tool("quality_fixture", "Fixture that checks the actual SDK response contract.", { mode: z.enum(["json", "text", "error"]).describe("Fixture response type.") }, async ({ mode }) => ({ ...(mode === "error" ? { isError: true } : {}), content: [{ type: "text", text: mode === "json" ? '[{"localSpend":{"amount":"0","currency":"EUR"}}]' : mode }] }));
    for (const mode of ["json", "text", "error"]) {
      const out = await client.callTool({ name: "quality_fixture", arguments: { mode } });
      if (mode === "error") { assert.equal(out.isError, true); assert.equal(out.structuredContent, undefined); }
      else { assert.equal(out.isError, undefined); assert.deepEqual(out.structuredContent.result, mode === "json" ? [{ localSpend: { amount: "0", currency: "EUR" } }] : "text"); }
    }
  });
});
test("a foreign account is refused over MCP before any network access", async () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error("unexpected"); };
  try {
    await connect(true, async client => {
      for (const [name, args] of [["apple_ads_get_account", { adAccountId: "999" }], ["apple_ads_rename_ad_account", { adAccountId: "999", name: "X", confirm: true }]]) {
        const out = await client.callTool({ name, arguments: args });
        assert.equal(out.isError, true, name);
        assert.match(JSON.stringify(out.content), /APPLE_ADS_AD_ACCOUNT_IDS/, name);
      }
    });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
test("reads, a preview and a confirmed paused creation run through the SDK", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([url, init]);
    assert.equal(init.redirect, "error");
    if (url === "https://appleid.apple.com/auth/oauth2/token") return Response.json({ access_token: "fixture-access-token", token_type: "Bearer", expires_in: 3600 });
    assert.equal(init.headers["X-AP-Context"], "adAccountId=100");
    assert.equal(init.headers.Authorization, "Bearer fixture-access-token");
    if (url === "https://api.ads.apple.com/v1/ad-accounts/100") return Response.json({ result: { id: 100, currency: "EUR", timezone: "Europe/Paris" } });
    if (url === "https://api.ads.apple.com/v1/campaigns" && init.method === "POST") return Response.json({ result: { id: 11, ...JSON.parse(init.body) } });
    throw new Error("Unexpected API request");
  };
  try {
    await connect(true, async client => {
      const account = await client.callTool({ name: "apple_ads_get_account", arguments: { adAccountId: "100" } });
      assert.equal(account.isError, undefined);
      assert.equal(account.structuredContent.result.result.currency, "EUR");
      const args = { adAccountId: "100", name: "MCP test", adamId: "123", dailyBudget: { amount: "1.00", currency: "EUR" }, countries: ["FR"] };
      const preview = await client.callTool({ name: "apple_ads_create_campaign", arguments: args });
      assert.equal(preview.structuredContent.result.applied, false);
      assert.equal(preview.structuredContent.result.preview.status, "PAUSED");
      assert.equal(calls.filter(([, init]) => init.method === "POST" && !init.body?.toString().includes("client_credentials")).length, 0);
      const applied = await client.callTool({ name: "apple_ads_create_campaign", arguments: { ...args, confirm: true } });
      assert.equal(applied.isError, undefined);
      assert.equal(applied.structuredContent.result.result.status, "PAUSED");
      assert.equal(calls.filter(([url, init]) => url.endsWith("/v1/campaigns") && init.method === "POST").length, 1);
      assert.equal(calls.filter(([url]) => url.includes("appleid.apple.com")).length, 1, "the access token is reused");
    });
  } finally { globalThis.fetch = original; }
});
