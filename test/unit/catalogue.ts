import { generateKeyPairSync } from "node:crypto";
import { AppleAdsClient } from "../../src/client.js";
import { registerAppleReads, registerAppleWrites } from "../../src/tools.js";

export const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
export const signing = { clientId: "SEARCHADS.test-client", teamId: "SEARCHADS.test-team", keyId: "test-key", privateKey };

export type Tool = { name: string; description: string; shape: Record<string, unknown>; handler: (args: Record<string, unknown>) => Promise<any>; write: boolean };

/** Every tool with its handler, as the MCP server registers them with writes enabled. */
export function collect(allowed: string[] = ["24166290"]) {
  const tools: Tool[] = [];
  const c = { tool(name: string, description: string, shape: any, handler: any) { tools.push({ name, description, shape, handler, write: Object.hasOwn(shape, "confirm") }); } };
  const api = new AppleAdsClient(signing, allowed);
  registerAppleReads(c, api, allowed);
  registerAppleWrites(c, api, allowed);
  return { tools, api, tool: (name: string) => tools.find(t => t.name === `apple_ads_${name}`)! };
}
