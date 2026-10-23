#!/usr/bin/env node
/**
 * apple-ads-mcp-server: an open-source MCP server for the Apple Ads Platform API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * stdout carries the MCP protocol. Everything else goes to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { nodeRuntimeWarning } from "./runtime-check.js";
import { createServer } from "./server.js";

const warning = nodeRuntimeWarning();
if (warning) console.error(`[apple-ads-mcp] ${warning}`);
try { await createServer(loadConfig()).connect(new StdioServerTransport()); }
catch (error) { console.error(`[apple-ads-mcp] ${error instanceof Error ? error.message : "Apple Ads server failed to start."}`); process.exitCode = 1; }
