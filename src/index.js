/**
 * OutreachPilot MCP Server
 *
 * Connects AI agents (Claude Desktop, Cursor, LangChain, etc.) to the
 * OutreachPilot platform via the Model Context Protocol (MCP).
 *
 * All tools call the real OutreachPilot public API.
 * Auth: Bearer API key via OUTREACHPILOT_API_KEY env variable.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
dotenv.config();
const API_KEY = process.env.OUTREACHPILOT_API_KEY;
const API_URL = (process.env.OUTREACHPILOT_API_URL || "https://useoutreachpilot.com").replace(/\/$/, "");
if (!API_KEY) {
    console.error("Error: OUTREACHPILOT_API_KEY environment variable is not set.");
    console.error("Create a .env file with: OUTREACHPILOT_API_KEY=op_your_key_here");
    process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper — all tools call this to hit the real API
// ─────────────────────────────────────────────────────────────────────────────
async function apiRequest(path, method = "GET", body) {
    const url = `${API_URL}${path}`;
    const headers = {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": "OutreachPilot-MCP/2.0.0",
    };
    const response = await fetch(url, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        data = text;
    }
    if (!response.ok) {
        const errData = data;
        const errMsg = errData?.error ||
            errData?.message ||
            `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(errMsg);
    }
    return data;
}
function formatResult(data) {
    return JSON.stringify(data, null, 2);
}
// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────
const TOOLS = [
    // ── CONTACTS ─────────────────────────────────────────────────────────────
    {
        name: "search_contacts",
        description: "Search your OutreachPilot CRM for contacts by name, email, or company. Returns matching contacts with their status, email, LinkedIn URL, and creation date.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Search query: name, email address, or company name.",
                },
                limit: {
                    type: "number",
                    description: "Max contacts to return. Default 20, max 200.",
                    default: 20,
                },
                status: {
                    type: "string",
                    description: "Filter by contact status: new, contacted, replied, interested, meeting_booked, not_interested, unsubscribed.",
                },
                folder_id: {
                    type: "string",
                    description: "Filter by folder ID.",
                },
            },
            required: ["query"],
        },
    },
    {
        name: "list_contacts",
        description: "List all contacts in your CRM with optional filters. Use search_contacts for keyword search. This is for paginated browsing.",
        inputSchema: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "Max contacts to return. Default 50, max 200.",
                    default: 50,
                },
                offset: {
                    type: "number",
                    description: "Offset for pagination. Default 0.",
                    default: 0,
                },
                status: {
                    type: "string",
                    description: "Filter by status: new, contacted, replied, interested, meeting_booked, not_interested, unsubscribed.",
                },
                folder_id: {
                    type: "string",
                    description: "Filter by folder ID to only return contacts in that folder.",
                },
            },
        },
    },
    {
        name: "create_contact",
        description: "Create one or more contacts in the CRM. Automatically creates the company account if a company is specified. Optionally enroll in a campaign immediately.",
        inputSchema: {
            type: "object",
            properties: {
                contacts: {
                    type: "array",
                    description: "Array of contacts to create. Each contact requires email or linkedin_url.",
                    items: {
                        type: "object",
                        properties: {
                            first_name: { type: "string" },
                            last_name: { type: "string" },
                            email: { type: "string", description: "Email address (required if no linkedin_url)." },
                            phone: { type: "string" },
                            company: { type: "string" },
                            title: { type: "string" },
                            linkedin_url: { type: "string" },
                            status: { type: "string", description: "Contact status. Default: new." },
                        },
                    },
                },
                upsert: {
                    type: "boolean",
                    description: "If true, update existing contacts instead of returning a duplicate error. Default false.",
                    default: false,
                },
                campaign_id: {
                    type: "string",
                    description: "Optional campaign ID to automatically enroll the created contacts.",
                },
            },
            required: ["contacts"],
        },
    },
    {
        name: "update_contact",
        description: "Update an existing contact's fields. You must provide the contact_id (use search_contacts to find it).",
        inputSchema: {
            type: "object",
            properties: {
                contact_id: {
                    type: "string",
                    description: "ID of the contact to update.",
                },
                first_name: { type: "string" },
                last_name: { type: "string" },
                email: { type: "string" },
                phone: { type: "string" },
                company: { type: "string" },
                title: { type: "string" },
                status: {
                    type: "string",
                    description: "New contact status: new, contacted, replied, interested, meeting_booked, not_interested, unsubscribed.",
                },
                tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "Replaces the contact's entire tag list.",
                },
            },
            required: ["contact_id"],
        },
    },
    // ── CAMPAIGNS ────────────────────────────────────────────────────────────
    {
        name: "list_campaigns",
        description: "List your outreach campaigns. Filter by status or type to find active, draft, or paused campaigns.",
        inputSchema: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "Max campaigns to return. Default 50.",
                    default: 50,
                },
                offset: {
                    type: "number",
                    description: "Pagination offset. Default 0.",
                    default: 0,
                },
                status: {
                    type: "string",
                    description: "Filter by status: draft, active, paused, completed, archived.",
                },
                type: {
                    type: "string",
                    description: "Filter by type: email, sms, voice, linkedin, multi_channel.",
                },
            },
        },
    },
    {
        name: "create_campaign",
        description: "Create a new campaign. Creates it as a draft — use update_campaign_status to activate it. For a fully AI-built campaign with email steps already written, use the pilot tool with a message like 'create a 3-step email campaign for the Austin folder'.",
        inputSchema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Campaign name.",
                },
                type: {
                    type: "string",
                    description: "Campaign type: email, sms, voice, linkedin, multi_channel. Default: email.",
                    default: "email",
                },
                config: {
                    type: "object",
                    description: "Optional configuration object (stop_on_reply, target_folder_id, etc.).",
                },
            },
            required: ["name"],
        },
    },
    {
        name: "update_campaign_status",
        description: "Pause, resume, activate, or archive a campaign.",
        inputSchema: {
            type: "object",
            properties: {
                campaign_id: {
                    type: "string",
                    description: "ID of the campaign to update.",
                },
                status: {
                    type: "string",
                    description: "New status: active, paused, draft, completed, archived.",
                },
            },
            required: ["campaign_id", "status"],
        },
    },
    // ── COMPANIES ────────────────────────────────────────────────────────────
    {
        name: "list_companies",
        description: "List company accounts in your CRM. Companies are automatically linked to contacts.",
        inputSchema: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "Max companies to return. Default 50.",
                    default: 50,
                },
                offset: {
                    type: "number",
                    description: "Pagination offset. Default 0.",
                    default: 0,
                },
                search: {
                    type: "string",
                    description: "Search company name.",
                },
                domain: {
                    type: "string",
                    description: "Filter by exact domain (e.g. 'stripe.com').",
                },
            },
        },
    },
    {
        name: "create_company",
        description: "Create a company account in the CRM.",
        inputSchema: {
            type: "object",
            properties: {
                companies: {
                    type: "array",
                    description: "Array of companies to create. Each requires name or domain.",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string", description: "Company name." },
                            domain: { type: "string", description: "Company website domain (e.g. 'stripe.com')." },
                            industry: { type: "string" },
                            size: { type: "string", description: "Company size (e.g. '10-50', '500+')." },
                        },
                    },
                },
                upsert: {
                    type: "boolean",
                    description: "Update matching companies instead of erroring. Default false.",
                    default: false,
                },
            },
            required: ["companies"],
        },
    },
    // ── CREDITS ──────────────────────────────────────────────────────────────
    {
        name: "get_credit_balance",
        description: "Check your current credit balance, monthly limit, plan tier, and when credits reset. Use this to verify you have enough credits before launching research or campaigns.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    // ── WEBHOOK MANAGEMENT ───────────────────────────────────────────────────
    {
        name: "list_webhooks",
        description: "List all active webhook subscriptions. Webhooks deliver real-time notifications when events occur (email.sent, email.replied, contact.created, etc.).",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "create_webhook",
        description: "Register a webhook to receive real-time event notifications from OutreachPilot. The webhook URL must use HTTPS.",
        inputSchema: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: "HTTPS URL to POST event payloads to.",
                },
                events: {
                    type: "array",
                    items: { type: "string" },
                    description: "Events to subscribe to: email.sent, email.opened, email.replied, email.bounced, campaign.started, campaign.completed, campaign.paused, contact.created, contact.updated, sms.sent, sms.replied.",
                },
                secret: {
                    type: "string",
                    description: "Optional signing secret for HMAC verification of payloads.",
                },
            },
            required: ["url", "events"],
        },
    },
    {
        name: "delete_webhook",
        description: "Remove a webhook subscription by its ID.",
        inputSchema: {
            type: "object",
            properties: {
                webhook_id: {
                    type: "string",
                    description: "ID of the webhook to delete (from list_webhooks).",
                },
            },
            required: ["webhook_id"],
        },
    },
    // ── PILOT AI BRIDGE ──────────────────────────────────────────────────────
    {
        name: "pilot",
        description: `The OutreachPilot AI engine. Send any natural language instruction and Pilot will execute it using its full toolkit.

Use this for complex or multi-step tasks that go beyond simple CRUD:

MESSAGING & OUTREACH
- "Draft a follow-up email to John Doe at Acme Corp"
- "Send a LinkedIn connection request to Jane Smith"
- "Write a cold email to my CEO contacts at fintech companies"

RESEARCH & LEAD GENERATION
- "Research Stripe — find buying signals and key decision makers"
- "Find 20 VP of Sales at Series B SaaS companies in Austin"
- "Enrich all contacts at Salesforce with LinkedIn profiles"
- "Find emails for all contacts at HubSpot"

CAMPAIGN BUILDING
- "Build a 3-step email campaign for the Austin SaaS folder"
- "Add a wait step of 5 days to campaign abc123"
- "Pause my cold email campaign"

CALENDAR & MEETINGS
- "What's my calendar availability for this week?"
- "Book a meeting with Jane Smith on Friday at 2pm"

ANALYTICS & REPORTING
- "Show me email stats for the last 30 days"
- "How many contacts replied to my campaigns?"
- "What's the open rate on my outbound emails?"

SYSTEM & ADMIN
- "Check if my email accounts are connected properly"
- "How many credits do I have left?"
- "What does our auto-responder prompt say?"
- "Update our knowledge base with: [text]"

VOICE DIALING
- "Start a dialing session for the Startup Founders folder"
- "What are my call stats?"`,
        inputSchema: {
            type: "object",
            properties: {
                message: {
                    type: "string",
                    description: "Natural language instruction for the OutreachPilot AI engine.",
                },
                thread_id: {
                    type: "string",
                    description: "Optional conversation thread ID for context continuity across messages.",
                },
            },
            required: ["message"],
        },
    },
];
// ─────────────────────────────────────────────────────────────────────────────
// MCP Server setup
// ─────────────────────────────────────────────────────────────────────────────
const server = new Server({
    name: "OutreachPilot MCP Server",
    version: "2.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
}));
// Execute tools
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        let result;
        switch (name) {
            // ── CONTACTS ─────────────────────────────────────────────────
            case "search_contacts": {
                const params = new URLSearchParams();
                if (args?.query)
                    params.set("search", args.query);
                if (args?.limit)
                    params.set("limit", String(args.limit));
                if (args?.status)
                    params.set("status", args.status);
                if (args?.folder_id)
                    params.set("folder_id", args.folder_id);
                result = await apiRequest(`/api/v1/contacts?${params.toString()}`);
                break;
            }
            case "list_contacts": {
                const params = new URLSearchParams();
                if (args?.limit)
                    params.set("limit", String(args.limit));
                if (args?.offset)
                    params.set("offset", String(args.offset));
                if (args?.status)
                    params.set("status", args.status);
                if (args?.folder_id)
                    params.set("folder_id", args.folder_id);
                result = await apiRequest(`/api/v1/contacts?${params.toString()}`);
                break;
            }
            case "create_contact": {
                result = await apiRequest("/api/v1/contacts", "POST", {
                    contacts: args?.contacts,
                    upsert: args?.upsert ?? false,
                    campaign_id: args?.campaign_id,
                });
                break;
            }
            case "update_contact": {
                const { contact_id, ...fields } = args;
                result = await apiRequest("/api/v1/contacts", "PATCH", {
                    contact_id,
                    ...fields,
                });
                break;
            }
            // ── CAMPAIGNS ─────────────────────────────────────────────────
            case "list_campaigns": {
                const params = new URLSearchParams();
                if (args?.limit)
                    params.set("limit", String(args.limit));
                if (args?.offset)
                    params.set("offset", String(args.offset));
                if (args?.status)
                    params.set("status", args.status);
                if (args?.type)
                    params.set("type", args.type);
                result = await apiRequest(`/api/v1/campaigns?${params.toString()}`);
                break;
            }
            case "create_campaign": {
                result = await apiRequest("/api/v1/campaigns", "POST", {
                    name: args?.name,
                    type: args?.type ?? "email",
                    config: args?.config,
                });
                break;
            }
            case "update_campaign_status": {
                result = await apiRequest("/api/v1/campaigns", "PATCH", {
                    campaign_id: args?.campaign_id,
                    status: args?.status,
                });
                break;
            }
            // ── COMPANIES ─────────────────────────────────────────────────
            case "list_companies": {
                const params = new URLSearchParams();
                if (args?.limit)
                    params.set("limit", String(args.limit));
                if (args?.offset)
                    params.set("offset", String(args.offset));
                if (args?.search)
                    params.set("search", args.search);
                if (args?.domain)
                    params.set("domain", args.domain);
                result = await apiRequest(`/api/v1/companies?${params.toString()}`);
                break;
            }
            case "create_company": {
                result = await apiRequest("/api/v1/companies", "POST", {
                    companies: args?.companies,
                    upsert: args?.upsert ?? false,
                });
                break;
            }
            // ── CREDITS ───────────────────────────────────────────────────
            case "get_credit_balance": {
                result = await apiRequest("/api/v1/credits");
                break;
            }
            // ── WEBHOOKS ──────────────────────────────────────────────────
            case "list_webhooks": {
                result = await apiRequest("/api/v1/webhooks");
                break;
            }
            case "create_webhook": {
                result = await apiRequest("/api/v1/webhooks", "POST", {
                    url: args?.url,
                    events: args?.events,
                    secret: args?.secret,
                });
                break;
            }
            case "delete_webhook": {
                result = await apiRequest(`/api/v1/webhooks?id=${encodeURIComponent(args?.webhook_id)}`, "DELETE");
                break;
            }
            // ── PILOT AI BRIDGE ───────────────────────────────────────────
            case "pilot": {
                result = await apiRequest("/api/v1/chat", "POST", {
                    message: args?.message,
                    thread_id: args?.thread_id,
                });
                break;
            }
            default:
                throw new Error(`Unknown tool: "${name}". Available tools: ${TOOLS.map(t => t.name).join(", ")}`);
        }
        return {
            content: [{ type: "text", text: formatResult(result) }],
        };
    }
    catch (error) {
        const err = error;
        return {
            content: [
                {
                    type: "text",
                    text: `Error executing tool "${name}": ${err.message}`,
                },
            ],
            isError: true,
        };
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
async function start() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`OutreachPilot MCP Server v2.0.0 started.`);
    console.error(`API URL: ${API_URL}`);
    console.error(`Tools available: ${TOOLS.map(t => t.name).join(", ")}`);
}
start().catch((error) => {
    console.error("Fatal server error:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map