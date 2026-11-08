/**
 * apple-ads-mcp-server: an open-source MCP server for the Apple Ads Platform API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Error raised for every failed Apple request. The message is built from a
 * fixed code, the HTTP status and vetted diagnostics only: provider messages
 * and values can echo tokens or user data, so they never reach the model.
 */
export class AppleAdsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly uncertain = false,
    diagnostic = "",
  ) {
    super(`Apple Ads ${code} (HTTP ${status}).${diagnostic ? ` ${diagnostic}` : ""}${uncertain ? " The write may have completed. Read the resource before retrying." : ""}`);
    this.name = "AppleAdsError";
  }
}

const VALIDATION_CODES = new Set(["INVALID_FIELD_ATTRIBUTE", "INVALID_VALUE_FIELD", "MISSING_REQUIRED_FIELD", "INVALID_DATE_RANGE"]);
const SAFE_PATH = /^(?:filters(?:\[\d{1,3}\])?(?:\.(?:field|operator|value|values))?|timeRange(?:\.(?:start|end|timeZone|granularity))?|pagination(?:\.(?:offset|pageSize))?|fields(?:\[\d{1,3}\])?|groupBy(?:\[\d{1,3}\])?|options(?:\.includeRows)?)$/;

/** Only known validation codes and schema paths, never provider messages or values. */
export function validationDiagnostic(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const details = (error as { details?: unknown }).details;
  if (!Array.isArray(details)) return "";
  const issues = details.slice(0, 5).flatMap(detail => {
    if (!detail || !VALIDATION_CODES.has(detail.code)) return [];
    const paths = [...(Array.isArray(detail.info?.fields) ? detail.info.fields : []), detail.info?.field]
      .filter((path): path is string => typeof path === "string" && SAFE_PATH.test(path));
    return [`${detail.code}${paths.length ? ` at ${[...new Set(paths)].join(", ")}` : ""}`];
  });
  return issues.length ? `${issues.join("; ")}. Review these request fields before retrying.` : "";
}

/** Seconds to wait from a numeric Retry-After or RateLimit-Reset header, bounded. */
export function retryAfterSeconds(headers: Headers): number | undefined {
  for (const name of ["retry-after", "ratelimit-reset"]) {
    const value = headers.get(name);
    if (value && /^\d{1,5}$/.test(value.trim())) return Math.min(Number(value), 3600);
  }
  return undefined;
}

export class ResponseTooLargeError extends Error {}

/** Read a response body up to a byte limit, cancelling the stream beyond it. */
export async function readBounded(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError();
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}
