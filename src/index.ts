import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.OUTREACHPILOT_API_KEY;
const API_URL = process.env.OUTREACHPILOT_API_URL || "https://api.useoutreachpilot.com/v1";

if (!API_KEY) {
    console.error("Please set OUTREACHPILOT_API_KEY in your environment variables via .env");
    process.exit(1);
}

const server = new Server(
    {
        name: "OutreachPilot MCP Server",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// Define the available tools
const TOOLS: Tool[] = [
    {
        name: "search_contacts",
        description: "Search your OutreachPilot CRM for contacts matching specific criteria.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The search query (name, company, role).",
                },
                limit: {
                    type: "number",
                    description: "Max number of contacts to return.",
                    default: 10,
                },
            },
            required: ["query"],
        },
    },
    {
        name: "create_campaign",
        description: "Create a new multi-channel outbound campaign in OutreachPilot.",
        inputSchema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "The name of the campaign.",
                },
                targetAudience: {
                    type: "string",
                    description: "A description of the ideal customer profile to target.",
                },
            },
            required: ["name", "targetAudience"],
        },
    },
    {
        name: "send_pilot_message",
        description: "Send a natural language instruction to the internal OutreachPilot AI Assistant.",
        inputSchema: {
            type: "object",
            properties: {
                instruction: {
                    type: "string",
                    description: "Natural language instruction for the Pilot (e.g., 'Draft a follow up email to John Doe').",
                },
            },
            required: ["instruction"],
        },
    },
];

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
}));

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        // --------------------------------------------------------------------------
        // NOTE: This server acts as the middleware. In production, these fetch
        // calls would hit the public OutreachPilot API. Here, they are simulated
        // API wrappers to demonstrate the MCP capabilities.
        // --------------------------------------------------------------------------

        if (name === "search_contacts") {
            const query = typeof args?.query === 'string' ? args.query : '';

            const response = await fetch(`${API_URL}/contacts/search?q=${encodeURIComponent(query)}`, {
                headers: { Authorization: `Bearer ${API_KEY}` },
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
            };
        }

        if (name === "create_campaign") {
            const payload = {
                name: args?.name,
                target_audience: args?.targetAudience,
            };

            const response = await fetch(`${API_URL}/campaigns`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                content: [{ type: "text", text: `Campaign successfully created. ID: ${data.id}. Status: Pending review.` }],
            };
        }

        if (name === "send_pilot_message") {
            const payload = { instruction: args?.instruction };

            const response = await fetch(`${API_URL}/pilot/execute`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                content: [{ type: "text", text: data.result_text }],
            };
        }

        throw new Error(`Unknown tool: ${name}`);

    } catch (error: any) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error executing tool '${name}': ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});

// Start the server using stdio transport (required for MCP clients like Claude)
async function start() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("OutreachPilot MCP Server is running over stdin/stdout.");
}

start().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
