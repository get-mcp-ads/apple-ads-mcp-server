/**
 * apple-ads-mcp-server: an open-source MCP server for the Apple Ads Platform API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * Every host this server can reach is listed in this file and nowhere else.
 * A test fails the build when another host appears in src/.
 */

/** Apple Ads Platform API, version 1. Every API request goes to this origin. */
export const APPLE_API_BASE = "https://api.ads.apple.com/v1";

/** Apple's OAuth 2 token endpoint for the client credentials grant. */
export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/oauth2/token";

/** Audience claim of the client secret JWT. An identifier, never a request target. */
export const APPLE_TOKEN_AUDIENCE = "https://appleid.apple.com";

/** OAuth scope Apple grants to Apple Ads API users. */
export const APPLE_TOKEN_SCOPE = "searchadsorg";

/** Request timeouts and response size bounds. */
export const API_TIMEOUT_MS = 25_000;
export const TOKEN_TIMEOUT_MS = 20_000;
export const MAX_API_RESPONSE_BYTES = 8_000_000;
export const MAX_TOKEN_RESPONSE_BYTES = 64_000;
