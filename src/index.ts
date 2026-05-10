import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

const VAULT_BASE_URL = "https://vault.andrewbridgeasha.com";

function encodeVaultPath(path: string): string {
	return path
		.replace(/^\/+|\/+$/g, "")
		.split("/")
		.map(encodeURIComponent)
		.join("/");
}

async function callVault(
	relativeUrl: string,
	bearerToken: string,
	options: {
		method?: string;
		body?: string;
		accept?: string;
		contentType?: string;
	} = {},
): Promise<{ ok: boolean; status: number; text: string }> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${bearerToken}`,
	};
	if (options.accept) headers.Accept = options.accept;
	if (options.contentType) headers["Content-Type"] = options.contentType;

	const response = await fetch(`${VAULT_BASE_URL}${relativeUrl}`, {
		method: options.method || "GET",
		headers,
		body: options.body,
	});
	const text = await response.text();
	return { ok: response.ok, status: response.status, text };
}

export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Obsidian Vault",
		version: "1.0.0",
	});

	async init() {
		const bearerToken = (this.env as any).VAULT_BEARER_TOKEN;

		this.server.registerTool(
			"vault_list",
			{
				description:
					"List files and folders in a vault directory. Use empty string for vault root.",
				inputSchema: {
					path: z
						.string()
						.describe("Path to directory within vault (empty for root)"),
				},
			},
			async ({ path }) => {
				const cleanPath = encodeVaultPath(path);
				const url = cleanPath ? `/vault/${cleanPath}/` : "/vault/";
				const result = await callVault(url, bearerToken);
				if (!result.ok) {
					return {
						content: [
							{ type: "text", text: `Error ${result.status}: ${result.text}` },
						],
					};
				}
				return { content: [{ type: "text", text: result.text }] };
			},
		);

		this.server.registerTool(
			"vault_read",
			{
				description: "Read the full content of a note from the vault.",
				inputSchema: {
					path: z.string().describe("Path to note (e.g., 'folder/note.md')"),
				},
			},
			async ({ path }) => {
				const result = await callVault(
					`/vault/${encodeVaultPath(path)}`,
					bearerToken,
					{ accept: "text/markdown" },
				);
				if (!result.ok) {
					return {
						content: [
							{ type: "text", text: `Error ${result.status}: ${result.text}` },
						],
					};
				}
				return { content: [{ type: "text", text: result.text }] };
			},
		);

		this.server.registerTool(
			"vault_search",
			{
				description:
					"Full-text search across all notes in the vault. Returns matching files with surrounding context.",
				inputSchema: {
					query: z.string().describe("Search term"),
					contextLength: z
						.number()
						.optional()
						.describe("Chars of context around each match (default 100)"),
				},
			},
			async ({ query, contextLength }) => {
				const ctx = contextLength ?? 100;
				const url = `/search/simple/?query=${encodeURIComponent(query)}&contextLength=${ctx}`;
				const result = await callVault(url, bearerToken, { method: "POST" });
				if (!result.ok) {
					return {
						content: [
							{ type: "text", text: `Error ${result.status}: ${result.text}` },
						],
					};
				}
				return { content: [{ type: "text", text: result.text }] };
			},
		);

		this.server.registerTool(
			"vault_write",
			{
				description:
					"Create a new note or overwrite an existing one. Parent folders are created if needed.",
				inputSchema: {
					path: z.string().describe("Path to the note within vault"),
					content: z.string().describe("Markdown content to write"),
				},
			},
			async ({ path, content }) => {
				const cleanPath = encodeVaultPath(path);
				const result = await callVault(`/vault/${cleanPath}`, bearerToken, {
					method: "PUT",
					body: content,
					contentType: "text/markdown",
				});
				if (!result.ok) {
					return {
						content: [
							{ type: "text", text: `Error ${result.status}: ${result.text}` },
						],
					};
				}
				return {
					content: [
						{
							type: "text",
							text: `Wrote ${path} (${content.length} characters)`,
						},
					],
				};
			},
		);

		this.server.registerTool(
			"vault_append",
			{
				description:
					"Append content to the end of a note. Creates the note if it doesn't exist.",
				inputSchema: {
					path: z.string().describe("Path to the note within vault"),
					content: z.string().describe("Content to append"),
				},
			},
			async ({ path, content }) => {
				const cleanPath = encodeVaultPath(path);
				const result = await callVault(`/vault/${cleanPath}`, bearerToken, {
					method: "POST",
					body: content,
					contentType: "text/markdown",
				});
				if (!result.ok) {
					return {
						content: [
							{ type: "text", text: `Error ${result.status}: ${result.text}` },
						],
					};
				}
				return {
					content: [
						{
							type: "text",
							text: `Appended to ${path} (${content.length} characters)`,
						},
					],
				};
			},
		);

		this.server.registerTool(
			"vault_get_active",
			{
				description: "Read the note currently open and active in Obsidian.",
				inputSchema: {},
			},
			async () => {
				const result = await callVault("/active/", bearerToken, {
					accept: "text/markdown",
				});
				if (!result.ok) {
					return {
						content: [
							{ type: "text", text: `Error ${result.status}: ${result.text}` },
						],
					};
				}
				return { content: [{ type: "text", text: result.text }] };
			},
		);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		const providedToken = url.searchParams.get("token");
		const expectedToken = (env as any).MCP_AUTH_TOKEN;
		if (!providedToken || !expectedToken || providedToken !== expectedToken) {
			return new Response("Unauthorized", { status: 401 });
		}

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
