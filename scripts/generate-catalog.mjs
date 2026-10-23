import { createServer } from "../dist/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
// A throwaway key: listing tools signs nothing and calls nothing.
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const config = { clientId: "SEARCHADS.catalogue-placeholder", teamId: "SEARCHADS.catalogue-placeholder", keyId: "catalogue-placeholder", privateKey, allowedAccountIds: ["100"], enableWrites: true };
const server = createServer(config);
const client = new Client({ name: "catalogue-builder", version: "1" });
const [a, b] = InMemoryTransport.createLinkedPair();
// This command must never access a provider, even accidentally.
globalThis.fetch = async () => { throw new Error("Catalogue generation must stay offline"); };
await server.connect(a); await client.connect(b);
const tools = (await client.listTools()).tools;
const resources = (await client.listResources()).resources;
const card = { serverInfo: { name: pkg.name, title: pkg.description, version: pkg.version, websiteUrl: pkg.homepage, icons: [{ src: "https://mcp.getmcpads.com/icon.svg", mimeType: "image/svg+xml" }] }, tools, resources, prompts: [] };
writeFileSync(new URL("../server-card.json", import.meta.url), JSON.stringify(card, null, 2) + "\n");
console.log(JSON.stringify({ tools: tools.length, reads: tools.filter(t => t.annotations.readOnlyHint).length, writes: tools.filter(t => !t.annotations.readOnlyHint).length, resources: resources.length }));
await client.close(); await server.close();
