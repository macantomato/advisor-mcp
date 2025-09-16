import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Env type for Wrangler bindings (vars from wrangler.jsonc)
type Env = {
  API_BASE: string; // e.g., "https://api-advisor.onrender.com" (no trailing slash)
};

// Define our MCP agent with tools
export class MyMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "Advisor MCP",
    version: "0.1.0",
  });

  async init() {
    // Normalize API base (remove trailing slashes)
    const API_BASE = (this.env.API_BASE || "").replace(/\/+$/, "");
	if (!API_BASE) {
      // Fail fast: misconfiguration
      this.server.tool(
        "config_error",
        {},
        async () => ({
          content: [
            { type: "text", text: "Missing API_BASE env var. Set it in wrangler.jsonc under 'vars'." },
          ],
        })
      );
      return;
    }
	

    // ---------------- Existing demo tools ----------------
    this.server.tool("add", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }));

    this.server.tool(
      "calculate",
      {
        operation: z.enum(["add", "subtract", "multiply", "divide"]),
        a: z.number(),
        b: z.number(),
      },
      async ({ operation, a, b }) => {
        let result: number;
        switch (operation) {
          case "add":
            result = a + b;
            break;
          case "subtract":
            result = a - b;
            break;
          case "multiply":
            result = a * b;
            break;
          case "divide":
            if (b === 0) {
              return {
                content: [{ type: "text", text: "Error: Cannot divide by zero" }],
              };
            }
            result = a / b;
            break;
        }
        return { content: [{ type: "text", text: String(result) }] };
      },
    );

    // ---------------- New tools (talk to your FastAPI) ----------------

    // 1) list_universe
    this.server.tool(
		"list_universe",
		"List tickers and sectors from the backend (Neo4j via FastAPI). Optional sector and limit.",
	{
		sector: z.string().optional(),
		limit: z.number().int().min(1).max(500).default(100),
	},
	async ({ sector, limit }) => {
		const API_BASE = (this.env.API_BASE || "").replace(/\/+$/, "");
		const qs = new URLSearchParams({ limit: String(limit) });
		if (sector && sector.trim()) qs.set("sector", sector.trim());
		const url = `${API_BASE}/universe?${qs.toString()}`;
		const res = await fetch(url, {
		cf: { cacheTtl: 0, cacheEverything: false },
		headers: { "cache-control": "no-store" },
		});
		if (!res.ok) {
		return { content: [{ type: "text", text: `Backend /universe failed: ${res.status}` }] };
		}
		const data = await res.json();
		const items = Array.isArray(data?.items) ? data.items : [];
		return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
		}
	);


    // 2) explain_universe
    this.server.tool(
      "explain_universe",
      "Get a short educational rationale via the LLM.",
      { risk: z.number().min(1).max(5).default(3), universe: z.array(z.string()).default([]) },
      async ({ risk, universe }) => {
        const res = await fetch(`${API_BASE}/explain`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ risk, universe }),
        });
        if (!res.ok) {
          return {
            content: [{ type: "text", text: `Backend /explain failed: ${res.status}` }],
          };
        }
        const data = await res.json();
        const text = data?.rationale ?? "No rationale.";
        return { content: [{ type: "text", text }] };
      }
    );

	// 3) Asset details
	this.server.tool(
	"get_asset_details",
	"Fetch one asset's basic details (ticker, name, sector).",
	{ ticker: z.string().min(1) },
	async ({ ticker }) => {
		const API_BASE = (this.env.API_BASE || "").replace(/\/+$/, "");
		const res = await fetch(`${API_BASE}/asset/${encodeURIComponent(ticker)}`, {
		cf: { cacheTtl: 0, cacheEverything: false },
		headers: { "cache-control": "no-store" },
		});
		if (!res.ok) {
		return { content: [{ type: "text", text: `Backend /asset failed: ${res.status}` }] };
		}
		const data = await res.json();
		return { content: [{ type: "text", text: JSON.stringify(data.item, null, 2) }] };
	}
	);
  }
}

// Keep SSE and HTTP endpoints
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};


