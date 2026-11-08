/**
 * apple-ads-mcp-server: an open-source MCP server for the Apple Ads Platform API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { createPrivateKey, KeyObject } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { z } from "zod";

/** Credentials and limits, read once from the environment and kept in memory. */
export type AppleAdsConfig = {
  clientId: string;
  teamId: string;
  keyId: string;
  /** Parsed signing key. The PEM text is not retained after parsing. */
  privateKey: KeyObject;
  allowedAccountIds: string[];
  enableWrites: boolean;
};

/** Programmatic input: the private key may be PEM text or an existing KeyObject. */
export type AppleAdsConfigInput = Omit<AppleAdsConfig, "privateKey" | "enableWrites"> & {
  privateKey: string | KeyObject;
  enableWrites?: boolean;
};

const credential = z.string().trim().regex(/^[A-Za-z0-9._-]{1,200}$/);
const schema = z.object({
  clientId: credential,
  teamId: credential,
  keyId: credential,
  privateKey: z.union([z.string().min(1), z.custom<KeyObject>(value => value instanceof KeyObject)]),
  allowedAccountIds: z.array(z.string().regex(/^[1-9]\d{0,14}$/)).min(1).max(200),
  enableWrites: z.boolean().prefault(false),
}).strict();

const HINTS: Record<string, string> = {
  clientId: "APPLE_ADS_CLIENT_ID: the clientId shown in Apple Ads under Account Settings > API",
  teamId: "APPLE_ADS_TEAM_ID: the teamId shown beside it",
  keyId: "APPLE_ADS_KEY_ID: the keyId shown beside it",
  privateKey: "APPLE_ADS_PRIVATE_KEY or APPLE_ADS_PRIVATE_KEY_PATH: the EC P-256 private key whose public key you uploaded",
  allowedAccountIds: "APPLE_ADS_AD_ACCOUNT_IDS: 1 to 200 comma-separated numeric ad account IDs",
  enableWrites: "APPLE_ADS_ENABLE_WRITES: true or false",
};

/** Parse a PEM private key and require the curve Apple uses for ES256. */
export function parsePrivateKey(value: string | KeyObject): KeyObject {
  let key: KeyObject;
  if (value instanceof KeyObject) key = value;
  else {
    const pem = value.replace(/\\n/g, "\n").trim();
    if (!pem.startsWith("-----BEGIN")) throw new Error("APPLE_ADS_PRIVATE_KEY or APPLE_ADS_PRIVATE_KEY_PATH does not hold PEM text. Provide the private-key.pem file you generated, unencrypted.");
    try { key = createPrivateKey({ key: pem, format: "pem" }); }
    catch { throw new Error("The private key in APPLE_ADS_PRIVATE_KEY or APPLE_ADS_PRIVATE_KEY_PATH could not be parsed. Provide the unencrypted PEM file you generated for the API."); }
  }
  if (key.type !== "private" || key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("The private key in APPLE_ADS_PRIVATE_KEY or APPLE_ADS_PRIVATE_KEY_PATH must be an EC P-256 (prime256v1) private key, as Apple requires for ES256 client secrets.");
  }
  return key;
}

export function validateConfig(value: unknown): AppleAdsConfig {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Name the variables that need attention. Never echo a value.
    const fields = [...new Set(result.error.issues.map(issue => String(issue.path[0] ?? "")))];
    const hints = fields.map(field => HINTS[field]).filter(Boolean);
    throw new Error(`Apple Ads configuration is incomplete or invalid. Check ${hints.length ? hints.join("; ") : "the APPLE_ADS_ variables"}.`);
  }
  return {
    ...result.data,
    privateKey: parsePrivateKey(result.data.privateKey),
    allowedAccountIds: [...new Set(result.data.allowedAccountIds)],
  };
}

const MAX_KEY_FILE_BYTES = 16_384;

function readKeyFile(path: string): string {
  try {
    if (statSync(path).size > MAX_KEY_FILE_BYTES) throw new Error("too large");
    return readFileSync(path, "utf8");
  } catch {
    throw new Error("Could not read the private key file named by APPLE_ADS_PRIVATE_KEY_PATH. Use an absolute path to the PEM file.");
  }
}

/** Read the configuration from APPLE_ADS_ environment variables. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppleAdsConfig {
  const flag = (env.APPLE_ADS_ENABLE_WRITES ?? "false").trim();
  if (!["true", "false"].includes(flag)) throw new Error("APPLE_ADS_ENABLE_WRITES must be true or false. Only the exact value true exposes write tools.");
  const inline = env.APPLE_ADS_PRIVATE_KEY?.trim() || undefined;
  const path = env.APPLE_ADS_PRIVATE_KEY_PATH?.trim() || undefined;
  if (inline && path) throw new Error("Set APPLE_ADS_PRIVATE_KEY or APPLE_ADS_PRIVATE_KEY_PATH, not both.");
  return validateConfig({
    clientId: env.APPLE_ADS_CLIENT_ID ?? "",
    teamId: env.APPLE_ADS_TEAM_ID ?? "",
    keyId: env.APPLE_ADS_KEY_ID ?? "",
    // An empty key is reported together with every other missing variable.
    privateKey: inline ?? (path ? readKeyFile(path) : ""),
    allowedAccountIds: (env.APPLE_ADS_AD_ACCOUNT_IDS ?? "").split(",").map(v => v.trim()).filter(Boolean),
    enableWrites: flag === "true",
  });
}
