/**
 * apple-ads-mcp-server: an open-source MCP server for the Apple Ads Platform API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * OAuth 2 client credentials for the Apple Ads Platform API: the client secret
 * is an ES256 JWT signed with the API user's private key, exchanged for a
 * one-hour access token. Tokens live in memory only and are never logged.
 */
import { sign, type KeyObject } from "node:crypto";
import { APPLE_TOKEN_AUDIENCE, APPLE_TOKEN_SCOPE, APPLE_TOKEN_URL, MAX_TOKEN_RESPONSE_BYTES, TOKEN_TIMEOUT_MS } from "./endpoints.js";
import { AppleAdsError, readBounded } from "./errors.js";

export type AppleSigningConfig = { clientId: string; teamId: string; keyId: string; privateKey: KeyObject };

/** Lifetime of each client secret. Apple accepts up to 180 days; a fresh short one is signed per token request. */
export const CLIENT_SECRET_TTL_SECONDS = 300;
/** Renew an access token this long before Apple's stated expiry. */
const EXPIRY_MARGIN_MS = 60_000;

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Sign a fresh, short-lived ES256 client secret. */
export function appleClientSecret(config: AppleSigningConfig, now = Math.floor(Date.now() / 1000)): string {
  const input = `${encode({ alg: "ES256", kid: config.keyId })}.${encode({ iss: config.teamId, sub: config.clientId, aud: APPLE_TOKEN_AUDIENCE, iat: now, exp: now + CLIENT_SECRET_TTL_SECONDS })}`;
  const signature = sign("sha256", Buffer.from(input), { key: config.privateKey, dsaEncoding: "ieee-p1363" });
  return `${input}.${signature.toString("base64url")}`;
}

const OAUTH_ERRORS = new Set(["invalid_request", "invalid_client", "invalid_grant", "unauthorized_client", "unsupported_grant_type", "invalid_scope"]);

/** Request an access token once. No retry: a refused request needs a configuration fix. */
export async function requestAccessToken(config: AppleSigningConfig): Promise<{ accessToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: appleClientSecret(config),
    scope: APPLE_TOKEN_SCOPE,
  });
  let response: Response;
  try {
    response = await fetch(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body, signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS), redirect: "error",
    });
  } catch { throw new AppleAdsError(0, "TOKEN_TRANSPORT_ERROR", false, "The token request did not complete. Check the network and retry."); }
  let payload: { access_token?: unknown; expires_in?: unknown; token_type?: unknown; error?: unknown } | null = null;
  try { payload = JSON.parse(await readBounded(response, MAX_TOKEN_RESPONSE_BYTES)); } catch { payload = null; }
  const accessToken = payload?.access_token, expiresIn = Number(payload?.expires_in);
  const bearer = payload?.token_type === undefined || String(payload.token_type).toLowerCase() === "bearer";
  if (!response.ok || typeof accessToken !== "string" || !accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0 || !bearer) {
    // Report Apple's standard OAuth error code only. The body is never relayed.
    const code = typeof payload?.error === "string" && OAUTH_ERRORS.has(payload.error) ? payload.error : undefined;
    throw new AppleAdsError(response.status, code ? `TOKEN_${code.toUpperCase()}` : "TOKEN_EXCHANGE_FAILED", false,
      "Apple refused the client credentials. Check APPLE_ADS_CLIENT_ID, APPLE_ADS_TEAM_ID and APPLE_ADS_KEY_ID, and that the public key uploaded under Account Settings > API matches the private key.");
  }
  return { accessToken, expiresIn };
}

/** Caches one access token in memory and shares a single renewal between concurrent callers. */
export class AppleTokenProvider {
  private cached?: { token: string; expiresAt: number };
  private pending?: Promise<string>;
  constructor(private readonly config: AppleSigningConfig, private readonly now: () => number = Date.now) {}

  async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt - EXPIRY_MARGIN_MS > this.now()) return this.cached.token;
    this.pending ??= requestAccessToken(this.config)
      .then(({ accessToken, expiresIn }) => {
        this.cached = { token: accessToken, expiresAt: this.now() + expiresIn * 1000 };
        return accessToken;
      })
      .finally(() => { this.pending = undefined; });
    return this.pending;
  }

  /** Forget a token Apple rejected, so the next call requests a new one. */
  invalidate(token: string): void {
    if (this.cached?.token === token) this.cached = undefined;
  }

  /** Values that must never appear in tool output. */
  secrets(): string[] {
    return this.cached ? [this.cached.token] : [];
  }
}
