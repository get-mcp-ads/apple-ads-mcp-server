/**
 * apple-ads-mcp-server: an open-source MCP server for the Apple Ads Platform API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppleAdsClient } from "./client.js";
import { validateConfig, type AppleAdsConfig, type AppleAdsConfigInput } from "./config.js";
import { registerAppleResources } from "./resources.js";
import { installToolQuality } from "./tool-quality.js";
import { registerAppleReads, registerAppleWrites } from "./tools.js";

export const PACKAGE_VERSION = "1.0.0";

export function createServer(input: AppleAdsConfig | AppleAdsConfigInput): McpServer {
  const config = validateConfig(input);
  const server = new McpServer({
    name: "apple-ads-mcp", version: PACKAGE_VERSION, title: "Apple Ads", websiteUrl: "https://www.getmcpads.com/tools/apple-ads",
    icons: [{ src: "https://mcp.getmcpads.com/icon.svg", mimeType: "image/svg+xml" }],
  });
  installToolQuality(server);
  const api = new AppleAdsClient(config, config.allowedAccountIds);
  registerAppleReads(server as never, api, config.allowedAccountIds);
  if (config.enableWrites) registerAppleWrites(server as never, api, config.allowedAccountIds);
  registerAppleResources(server);
  return server;
}
