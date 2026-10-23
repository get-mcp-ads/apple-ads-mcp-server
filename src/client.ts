/**
 * apple-ads-mcp-server: an open-source MCP server for the Apple Ads Platform API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { AppleTokenProvider, type AppleSigningConfig } from "./auth.js";
import { API_TIMEOUT_MS, APPLE_API_BASE, MAX_API_RESPONSE_BYTES } from "./endpoints.js";
import { AppleAdsError, readBounded, ResponseTooLargeError, retryAfterSeconds, validationDiagnostic } from "./errors.js";

export type AppleEnvelope<T> = { result: T; pagination?: Record<string, unknown> };
export type AppleAcl = { adAccount: { id: number; name: string; orgId: number }; roles: string[] };
type Method = "GET" | "POST" | "PUT";

const ACCOUNT_ID = /^[1-9]\d{0,14}$/;
/** The only requests Apple serves without an ad account context. */
const CONTEXT_FREE = new Set(["GET /me", "GET /acls", "POST /ad-accounts"]);

const HINTS: Record<number, string> = {
  401: "Apple rejected the access token. Check that the API user still exists and that its key was not replaced.",
  403: "The API user's role does not allow this action on this ad account.",
  404: "Apple found no such resource in this ad account.",
};

export class AppleAdsClient {
  private readonly tokens: AppleTokenProvider;
  constructor(config: AppleSigningConfig, private readonly allowedAccountIds: readonly string[], tokens?: AppleTokenProvider) {
    this.tokens = tokens ?? new AppleTokenProvider(config);
  }

  /** Values that must never appear in tool output. */
  secrets(): string[] { return this.tokens.secrets(); }

  /**
   * Call one fixed API path. Account-scoped requests carry X-AP-Context and
   * must name an allowed account; the check runs before any network access.
   */
  async request<T = Record<string, any>>(path: string, accountId?: string, body?: unknown, method: Method = body === undefined ? "GET" : "POST", write = false): Promise<AppleEnvelope<T>> {
    // Fixed origin and path only. No arbitrary URL, query injection or redirects.
    if (!/^\/[a-z0-9/-]+$/.test(path) || path.includes("//")) throw new Error("Invalid Apple Ads request path.");
    if (accountId === undefined) {
      if (!CONTEXT_FREE.has(`${method} ${path}`)) throw new Error("This Apple Ads request needs an ad account.");
    } else if (!ACCOUNT_ID.test(accountId) || !this.allowedAccountIds.includes(accountId)) {
      throw new Error("This Apple Ads ad account is not in APPLE_ADS_AD_ACCOUNT_IDS.");
    }
    const token = await this.tokens.token();
    try {
      return await this.send<T>(token, path, accountId, body, method, write);
    } catch (error) {
      if (!(error instanceof AppleAdsError) || error.status !== 401) throw error;
      this.tokens.invalidate(token);
      // A read is replayed once with a renewed token. A write is not replayed.
      if (write) throw error;
      return this.send<T>(await this.tokens.token(), path, accountId, body, method, write);
    }
  }

  private async send<T>(token: string, path: string, accountId: string | undefined, body: unknown, method: Method, write: boolean): Promise<AppleEnvelope<T>> {
    let response: Response;
    try {
      response = await fetch(APPLE_API_BASE + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json",
          ...(accountId ? { "X-AP-Context": `adAccountId=${accountId}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(API_TIMEOUT_MS), redirect: "error",
      });
    } catch { throw new AppleAdsError(0, "TRANSPORT_ERROR", write, "The request did not complete or was redirected. Redirects are never followed."); }
    let payload: (AppleEnvelope<T> & { error?: unknown }) | null = null;
    try { payload = JSON.parse(await readBounded(response, MAX_API_RESPONSE_BYTES)); }
    catch (error) {
      if (error instanceof ResponseTooLargeError) throw new AppleAdsError(response.status, "RESPONSE_TOO_LARGE", write, "Narrow the date range or lower limit.");
      payload = null;
    }
    // Apple can answer HTTP 200 with an error body. Treat that as a failure too.
    if (!response.ok || !payload || typeof payload !== "object" || payload.error || !("result" in payload)) {
      const status = response.status;
      const code = status === 400 ? "VALIDATION_ERROR" : status === 401 ? "AUTHORIZATION_EXPIRED" : status === 403 ? "PERMISSION_DENIED"
        : status === 404 ? "NOT_FOUND" : status === 429 ? "RATE_LIMITED" : response.ok ? "INVALID_RESPONSE" : "REQUEST_FAILED";
      const wait = status === 429 ? retryAfterSeconds(response.headers) : undefined;
      const diagnostic = status === 400 ? validationDiagnostic(payload?.error)
        : status === 429 ? `Wait ${wait ?? "a few"} seconds before retrying.` : HINTS[status] ?? "";
      throw new AppleAdsError(status, code, write && (status >= 500 || response.ok), diagnostic);
    }
    return payload;
  }

  async acls(): Promise<AppleAcl[]> {
    const { result } = await this.request<{ acls: AppleAcl[] }>("/acls");
    if (!Array.isArray(result?.acls)) throw new AppleAdsError(200, "INVALID_ACLS");
    return result.acls;
  }
}
