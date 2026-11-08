import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, validateConfig } from "../src/config.ts";

const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pkcs8 = ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const sec1 = ec.privateKey.export({ type: "sec1", format: "pem" }).toString();
const env = { APPLE_ADS_CLIENT_ID: "SEARCHADS.client-fixture", APPLE_ADS_TEAM_ID: "SEARCHADS.team-fixture", APPLE_ADS_KEY_ID: "key-fixture", APPLE_ADS_PRIVATE_KEY: pkcs8, APPLE_ADS_AD_ACCOUNT_IDS: "100, 200,100" };
const secretFree = (fn, secret = "PRIVATE KEY") => assert.throws(fn, e => e instanceof Error && !e.message.includes(secret) && !e.message.includes("SEARCHADS.") && e.message.length > 20);

test("a complete environment loads, deduplicates accounts and keeps writes off", () => {
  const config = loadConfig(env);
  assert.deepEqual(config.allowedAccountIds, ["100", "200"]);
  assert.equal(config.enableWrites, false);
  assert.equal(config.privateKey.asymmetricKeyDetails.namedCurve, "prime256v1");
  assert.equal(JSON.stringify(config).includes("PRIVATE KEY"), false, "the PEM text is not retained");
});

test("writes need the exact value true", () => {
  assert.equal(loadConfig({ ...env, APPLE_ADS_ENABLE_WRITES: "true" }).enableWrites, true);
  assert.equal(loadConfig({ ...env, APPLE_ADS_ENABLE_WRITES: "false" }).enableWrites, false);
  for (const value of ["1", "yes", "TRUE", "on"]) assert.throws(() => loadConfig({ ...env, APPLE_ADS_ENABLE_WRITES: value }), /exact value true/);
});

test("missing or invalid variables are named without echoing values", () => {
  secretFree(() => loadConfig({}));
  assert.throws(() => loadConfig({}), /APPLE_ADS_CLIENT_ID.*APPLE_ADS_TEAM_ID.*APPLE_ADS_KEY_ID.*APPLE_ADS_PRIVATE_KEY.*APPLE_ADS_AD_ACCOUNT_IDS/s);
  for (const ids of ["", "abc", "0", "12-34", "../100", Array.from({ length: 201 }, (_, i) => i + 1).join(",")]) {
    assert.throws(() => loadConfig({ ...env, APPLE_ADS_AD_ACCOUNT_IDS: ids }), /APPLE_ADS_AD_ACCOUNT_IDS/, ids);
  }
  secretFree(() => loadConfig({ ...env, APPLE_ADS_CLIENT_ID: "SEARCHADS.bad value/../" }));
});

test("the private key comes from exactly one source and must be EC P-256", () => {
  secretFree(() => loadConfig({ ...env, APPLE_ADS_PRIVATE_KEY_PATH: "/tmp/key.pem" }));
  assert.throws(() => loadConfig({ ...env, APPLE_ADS_PRIVATE_KEY_PATH: "/tmp/key.pem" }), /not both/);
  secretFree(() => loadConfig({ ...env, APPLE_ADS_PRIVATE_KEY: "not a key" }));
  secretFree(() => loadConfig({ ...env, APPLE_ADS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" }), "AAAA");
  const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.throws(() => loadConfig({ ...env, APPLE_ADS_PRIVATE_KEY: rsa }), /P-256/);
  const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.throws(() => loadConfig({ ...env, APPLE_ADS_PRIVATE_KEY: p384 }), /P-256/);
  assert.throws(() => validateConfig({ ...loadConfig(env), privateKey: ec.publicKey }), /P-256/);
});

test("PEM text with escaped newlines, SEC1 keys and key files are accepted", () => {
  assert.ok(loadConfig({ ...env, APPLE_ADS_PRIVATE_KEY: pkcs8.replace(/\n/g, "\\n") }).privateKey);
  assert.ok(loadConfig({ ...env, APPLE_ADS_PRIVATE_KEY: sec1 }).privateKey, "openssl ecparam writes SEC1 keys");
  const dir = mkdtempSync(join(tmpdir(), "apple-ads-key-"));
  const file = join(dir, "private-key.pem");
  writeFileSync(file, sec1, { mode: 0o600 });
  const { APPLE_ADS_PRIVATE_KEY: _inline, ...rest } = env;
  assert.ok(loadConfig({ ...rest, APPLE_ADS_PRIVATE_KEY_PATH: file }).privateKey);
  assert.throws(() => loadConfig({ ...rest, APPLE_ADS_PRIVATE_KEY_PATH: join(dir, "missing.pem") }), /APPLE_ADS_PRIVATE_KEY_PATH/);
});
