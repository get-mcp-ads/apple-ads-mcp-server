/**
 * The README documents every tool and resource by name. A tool renamed in the
 * code and not in the README is a documentation bug, and this test fails on it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const pem = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

async function introspect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../dist/cli.js", import.meta.url).pathname],
    env: { PATH: process.env.PATH ?? "", APPLE_ADS_CLIENT_ID: "SEARCHADS.readme", APPLE_ADS_TEAM_ID: "SEARCHADS.readme", APPLE_ADS_KEY_ID: "readme", APPLE_ADS_PRIVATE_KEY: pem, APPLE_ADS_AD_ACCOUNT_IDS: "100", APPLE_ADS_ENABLE_WRITES: "true" },
  });
  const client = new Client({ name: "readme-check", version: "1" }, { capabilities: {} });
  await client.connect(transport);
  const definitions = (await client.listTools()).tools;
  const resources = (await client.listResources()).resources.map(r => r.uri);
  await client.close();
  return { tools: definitions.map(t => t.name), resources, definitions };
}

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
let cached;
const live = () => (cached ??= introspect());

test("README documents every tool the server exposes, and no other", async () => {
  const { tools } = await live();
  const cited = new Set([...README.matchAll(/`(apple_ads_[a-z_]+)`/g)].map(m => m[1]));
  const undocumented = tools.filter(t => !cited.has(t));
  assert.deepEqual(undocumented, [], `Tools missing from README: ${undocumented.join(", ")}`);
  const invented = [...cited].filter(c => !tools.includes(c));
  assert.deepEqual(invented, [], `README cites tools that do not exist: ${invented.join(", ")}`);
});

test("README documents every resource the server exposes, and no other", async () => {
  const { resources } = await live();
  const cited = new Set([...README.matchAll(/`(apple-ads:\/\/[a-z0-9-]+)`/g)].map(m => m[1]));
  assert.deepEqual(resources.filter(r => !cited.has(r)), [], "Resources missing from README");
  assert.deepEqual([...cited].filter(c => !resources.includes(c)), [], "README cites resources that do not exist");
});

test("README tool counts match reality", async () => {
  const { tools, resources, definitions } = await live();
  const writes = definitions.filter(t => !t.annotations.readOnlyHint).map(t => t.name);
  const reads = tools.filter(t => !writes.includes(t));
  assert.equal(reads.length, 9, "read tool count changed, update the README");
  assert.equal(writes.length, 11, "write tool count changed, update the README");
  assert.equal(resources.length, 2, "resource count changed, update the README");
  assert.match(README, new RegExp(`\\*\\*${reads.length} read tools\\*\\* · \\*\\*${writes.length} write tools\\*\\*, disabled by default\\.`));
  assert.match(README, new RegExp(`<b>${reads.length} read tools</b>`));
  assert.match(README, new RegExp(`<b>${writes.length} write tools</b>`));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.description, new RegExp(`${reads.length} read tools, ${writes.length} opt-in`));
  const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
  assert.equal(server.description, pkg.description);
});

test("README documents every environment variable the server reads", () => {
  const source = readdirSync(new URL("../src/", import.meta.url)).filter(f => f.endsWith(".ts")).map(f => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")).join("\n");
  const used = [...new Set([...source.matchAll(/env\.(APPLE_ADS_[A-Z_]+)/g)].map(m => m[1]))];
  assert.ok(used.length >= 7);
  const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
  const declared = server.packages[0].environmentVariables.map(v => v.name);
  for (const name of used) {
    assert.ok(README.includes(`\`${name}\``), `${name} is missing from the README configuration table`);
    assert.ok(declared.includes(name), `${name} is missing from server.json`);
  }
});

test("published prose uses no em dashes", () => {
  const files = ["README.md", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md", "RELEASING.md", "SOURCE_SYNC.md", "NOTICE", ".env.example", "server.json", "package.json"];
  const walk = (dir, acc = []) => {
    for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, acc);
      else if (/\.(ts|mjs)$/.test(entry.name)) acc.push(`${dir}/${entry.name}`);
    }
    return acc;
  };
  const emDash = String.fromCharCode(0x2014);
  const offenders = [];
  for (const file of [...files, ...walk("src"), ...walk("scripts"), ...walk("test")]) {
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n").forEach((line, i) => {
      if (line.includes(emDash)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `Em dashes are not used in this project. Rewrite the sentence instead of swapping the character. Found at: ${offenders.join(", ")}`);
});
