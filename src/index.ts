import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Env type for Wrangler bindings (vars from wrangler.jsonc)
type Env = {
  API_BASE: string; // e.g., "https://api-advisor.onrender.com"
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

    // ---------------- Tools - FastAPI) ----------------

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

	// 4) Get asset starting with __
	this.server.tool(
	"search_assets",
	"Find assets by ticker/name prefix (case-insensitive).",
	{ q: z.string().min(1), limit: z.number().int().min(1).max(100).default(10) },
	async ({ q, limit }) => {
		const API_BASE = (this.env.API_BASE || "").replace(/\/+$/, "");
		const qs = new URLSearchParams({ q, limit: String(limit) });
		const res = await fetch(`${API_BASE}/search?${qs.toString()}`, {
		cf: { cacheTtl: 0, cacheEverything: false },
		headers: { "cache-control": "no-store" },
		});
		if (!res.ok) {
		return { content: [{ type: "text", text: `Backend /search failed: ${res.status}` }] };
		}
		const data = await res.json();
		const items = Array.isArray(data?.items) ? data.items : [];
		return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
	}
	);

	this.server.tool(
	"ingest_from_finnhub",
	"Ingest company profiles from Finnhub for up to 50 tickers.",
	{ tickers: z.array(z.string()).min(1).max(50) },
	async ({ tickers }) => {              // ← remove ", extra"
		const API_BASE = (this.env.API_BASE || "").replace(/\/+$/, "");
		const cleaned = Array.from(new Set(
		tickers.map(t => t.trim().toUpperCase()).filter(Boolean)
		)).slice(0, 50);

		if (!cleaned.length) {
		return { content: [{ type: "text", text: "No valid tickers provided." }] };
		}

		const qs = cleaned.map(t => `tickers=${encodeURIComponent(t)}`).join("&");
		const res = await fetch(`${API_BASE}/ingest/finnhub?${qs}`, {
		cf: { cacheTtl: 0, cacheEverything: false },
		headers: { "cache-control": "no-store" },
		});
		if (!res.ok) {
		const body = await res.text().catch(() => "");
		return { content: [{ type: "text", text: `Backend /ingest/finnhub ${res.status}: ${body.slice(0,200)}` }] };
		}
		const data = await res.json();
		return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
	}
	);
	this.server.tool(
	"run_fundamentals",
	"Run fundamentals_v0 analyzer for a ticker (ret JSON report).",
	{ ticker: z.string().min(1) },
	async ({ ticker }) => {
		const API_BASE = (this.env.API_BASE || "").replace(/\/+$/, "");
		const res = await fetch(`${API_BASE}/analyze/fundamentals?ticker=${encodeURIComponent(ticker)}`, {
		cf: { cacheTtl: 0, cacheEverything: false },
		headers: { "cache-control": "no-store" },
		});
		if (!res.ok) {
		const body = await res.text().catch(() => "");
		return { content: [{ type: "text", text: `Backend /analyze/fundamentals ${res.status}: ${body.slice(0,200)}` }] };
		}
		const data = await res.json();
		return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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


