import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const cli = new URL("../dist/cli.js", import.meta.url).pathname;
const pem = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const base = { PATH: process.env.PATH ?? "", APPLE_ADS_CLIENT_ID: "SEARCHADS.smoke", APPLE_ADS_TEAM_ID: "SEARCHADS.smoke", APPLE_ADS_KEY_ID: "smoke", APPLE_ADS_PRIVATE_KEY: pem, APPLE_ADS_AD_ACCOUNT_IDS: "100" };

test("the stdio server starts read-only by default", async () => {
  const client = new Client({ name: "apple-ads-smoke", version: "0.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli], env: base, stderr: "pipe" });
  try {
    await client.connect(transport, { timeout: 15000 });
    const tools = (await client.listTools(undefined, { timeout: 15000 })).tools;
    assert.equal(tools.length, 9);
    assert.ok(tools.every(t => t.annotations.readOnlyHint));
    for (const name of ["apple_ads_list_ad_accounts", "apple_ads_get_report", "apple_ads_get_campaigns"]) assert.ok(tools.some(t => t.name === name), name);
    const resources = (await client.listResources(undefined, { timeout: 15000 })).resources.map(r => r.uri);
    assert.deepEqual(resources.sort(), ["apple-ads://guide", "apple-ads://report-catalog"]);
    const guide = await client.readResource({ uri: "apple-ads://guide" });
    assert.match(guide.contents[0].text, /APPLE_ADS_AD_ACCOUNT_IDS/);
  } finally { await transport.close().catch(() => undefined); }
});

test("a configuration error exits with a message on stderr and nothing on stdout", () => {
  for (const env of [{ PATH: base.PATH }, { ...base, APPLE_ADS_ENABLE_WRITES: "1" }, { ...base, APPLE_ADS_PRIVATE_KEY: "not a key" }]) {
    const run = spawnSync(process.execPath, [cli], { env, input: "", encoding: "utf8", timeout: 15000 });
    assert.equal(run.status, 1);
    assert.equal(run.stdout, "", "stdout is the MCP channel");
    assert.match(run.stderr, /\[apple-ads-mcp\] .*APPLE_ADS_/);
    assert.doesNotMatch(run.stderr, /BEGIN PRIVATE KEY|SEARCHADS\.smoke/);
  }
});
