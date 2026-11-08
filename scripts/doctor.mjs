#!/usr/bin/env node
// Checks the local configuration without contacting Apple. Prints variable
// names and their presence only, never a value.
const required = ["APPLE_ADS_CLIENT_ID", "APPLE_ADS_TEAM_ID", "APPLE_ADS_KEY_ID", "APPLE_ADS_AD_ACCOUNT_IDS"];
const keySources = ["APPLE_ADS_PRIVATE_KEY", "APPLE_ADS_PRIVATE_KEY_PATH"];
const optional = ["APPLE_ADS_ENABLE_WRITES"];
const present = (name) => typeof process.env[name] === "string" && process.env[name].trim().length > 0;

let runtimeWarning;
let configuration = { ok: false, error: "Run npm run build first: the configuration check uses dist/." };
try {
  const { loadConfig, nodeRuntimeWarning } = await import("../dist/index.js");
  runtimeWarning = nodeRuntimeWarning();
  try {
    const config = loadConfig();
    configuration = { ok: true, allowedAccounts: config.allowedAccountIds.length, writesEnabled: config.enableWrites };
  } catch (error) {
    configuration = { ok: false, error: error instanceof Error ? error.message : "Invalid configuration." };
  }
} catch { /* dist/ is missing. */ }

const result = {
  package: "@getmcpads/apple-ads-mcp-server",
  ok: configuration.ok && !runtimeWarning,
  node: { version: process.versions.node, warning: runtimeWarning ?? null },
  configuration,
  variables: {
    required: required.map((name) => ({ name, present: present(name) })),
    privateKey: keySources.map((name) => ({ name, present: present(name) })),
    optional: optional.map((name) => ({ name, present: present(name) })),
  },
  note: "Set the four required variables and exactly one of APPLE_ADS_PRIVATE_KEY or APPLE_ADS_PRIVATE_KEY_PATH. This check does not contact Apple.",
};

if (runtimeWarning) console.error(`[apple-ads-mcp] ${runtimeWarning}`);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
