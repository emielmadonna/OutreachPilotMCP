#!/usr/bin/env node

/**
 * OutreachPilot MCP Server
 *
 * Connects AI agents (Claude Desktop, Cursor, LangChain, etc.) to the
 * OutreachPilot platform via the Model Context Protocol (MCP).
 *
 * All tools call the real OutreachPilot public API.
 * Auth: Bearer API key via OUTREACHPILOT_API_KEY env variable.
 *
 * Install: npx outreachpilot-mcp
 */

import "dotenv/config";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type Tool,
} from "@modelcontextprotocol/sdk/types.js";

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

async function apiRequest(
    path: string,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
    body?: Record<string, unknown>
): Promise<unknown> {
    const url = `${API_URL}${path}`;
    const headers: Record<string, string> = {
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
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    if (!response.ok) {
        const errData = data as Record<string, unknown>;
        const errMsg =
            (errData?.error as string) ||
            (errData?.message as string) ||
            `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(errMsg);
    }

    return data;
}

function formatResult(data: unknown): string {
    return JSON.stringify(data, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS: Tool[] = [

    // ── CONTACTS ─────────────────────────────────────────────────────────────

    {
        name: "search_contacts",
        description:
            "Search your OutreachPilot CRM for contacts by name, email, or company. Returns matching contacts with their status, email, LinkedIn URL, and creation date.",
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
        description:
            "List all contacts in your CRM with optional filters. Use search_contacts for keyword search. This is for paginated browsing.",
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
        description:
            "Create one or more contacts in the CRM. Automatically creates the company account if a company is specified. Optionally enroll in a campaign immediately.",
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
        description:
            "Update an existing contact's fields. You must provide the contact_id (use search_contacts to find it).",
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

    {
        name: "get_contact",
        description:
            "Get a single contact by its ID. Returns all fields including email, phone, LinkedIn URL, company, status, tags, and custom context.",
        inputSchema: {
            type: "object",
            properties: {
                contact_id: {
                    type: "string",
                    description: "ID of the contact to retrieve.",
                },
            },
            required: ["contact_id"],
        },
    },

    {
        name: "delete_contact",
        description:
            "Permanently delete a contact from the CRM by its ID. This cannot be undone.",
        inputSchema: {
            type: "object",
            properties: {
                contact_id: {
                    type: "string",
                    description: "ID of the contact to delete.",
                },
            },
            required: ["contact_id"],
        },
    },

    // ── CAMPAIGNS ────────────────────────────────────────────────────────────

    {
        name: "list_campaigns",
        description:
            "List your outreach campaigns. Filter by status or type to find active, draft, or paused campaigns.",
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
        description:
            "Create a new campaign. Creates it as a draft — use update_campaign_status to activate it. For a fully AI-built campaign with email steps already written, use the pilot tool with a message like 'create a 3-step email campaign for the Austin folder'.",
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
        description:
            "Pause, resume, activate, or archive a campaign.",
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

    {
        name: "trigger_campaign",
        description:
            "Enroll a contact into an active campaign. Can provide a contact_id for an existing contact, or provide contact fields (email, first_name, last_name, company) to auto-create and enroll. The campaign must be active.",
        inputSchema: {
            type: "object",
            properties: {
                campaign_id: {
                    type: "string",
                    description: "ID of the active campaign to enroll the contact into.",
                },
                contact_id: {
                    type: "string",
                    description: "ID of an existing contact (use search_contacts to find it). If not provided, supply email/linkedin_url to auto-create.",
                },
                email: {
                    type: "string",
                    description: "Email of the contact. Used to find or auto-create the contact if contact_id is not provided.",
                },
                first_name: { type: "string" },
                last_name: { type: "string" },
                company: { type: "string" },
                linkedin_url: { type: "string" },
            },
            required: ["campaign_id"],
        },
    },

    {
        name: "get_campaign_status",
        description:
            "Get the status and audience statistics of a campaign. Returns total contacts enrolled, active, completed, paused, bounced, and failed counts.",
        inputSchema: {
            type: "object",
            properties: {
                campaign_id: {
                    type: "string",
                    description: "ID of the campaign to check.",
                },
            },
            required: ["campaign_id"],
        },
    },

    // ── COMPANIES ────────────────────────────────────────────────────────────

    {
        name: "list_companies",
        description:
            "List company accounts in your CRM. Companies are automatically linked to contacts.",
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
        description:
            "Create a company account in the CRM.",
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

    {
        name: "get_company",
        description:
            "Get a single company account by its ID. Returns all fields including name, domain, industry, size, and custom context.",
        inputSchema: {
            type: "object",
            properties: {
                company_id: {
                    type: "string",
                    description: "ID of the company to retrieve.",
                },
            },
            required: ["company_id"],
        },
    },

    {
        name: "update_company",
        description:
            "Update an existing company's fields. You must provide the company_id.",
        inputSchema: {
            type: "object",
            properties: {
                company_id: {
                    type: "string",
                    description: "ID of the company to update.",
                },
                name: { type: "string", description: "Updated company name." },
                domain: { type: "string", description: "Updated company domain (e.g. 'stripe.com')." },
                industry: { type: "string", description: "Updated industry." },
                size: { type: "string", description: "Updated company size (e.g. '10-50', '500+')." },
                context: { type: "object", description: "Custom metadata to merge into the company's context." },
            },
            required: ["company_id"],
        },
    },

    {
        name: "delete_company",
        description:
            "Permanently delete a company account from the CRM. Contacts linked to this company will be unlinked but not deleted.",
        inputSchema: {
            type: "object",
            properties: {
                company_id: {
                    type: "string",
                    description: "ID of the company to delete.",
                },
            },
            required: ["company_id"],
        },
    },

    // ── CREDITS ──────────────────────────────────────────────────────────────

    {
        name: "get_credit_balance",
        description:
            "Check your current credit balance, monthly limit, plan tier, and when credits reset. Use this to verify you have enough credits before launching research or campaigns.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },

    // ── WEBHOOK MANAGEMENT ───────────────────────────────────────────────────

    {
        name: "list_webhooks",
        description:
            "List all active webhook subscriptions. Webhooks deliver real-time notifications when events occur (email.sent, email.replied, contact.created, etc.).",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },

    {
        name: "create_webhook",
        description:
            "Register a webhook to receive real-time event notifications from OutreachPilot. The webhook URL must use HTTPS.",
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
        description:
            `The OutreachPilot AI engine. Send any natural language instruction and Pilot will execute it using its full toolkit.

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

    // ── RESEARCH (AGENTIC) ────────────────────────────────────────────────

    {
        name: "run_research",
        description:
            "Start an agentic research job to find companies or people matching your criteria. Returns a job_id to poll with check_research_status. Send with confirmed=false first to get a cost estimate, then confirmed=true to execute.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Natural language search criteria (e.g. 'fintech founders in NY', 'SaaS companies with 50-200 employees').",
                },
                target_type: {
                    type: "string",
                    description: "What to search for: 'companies' or 'people'. Default: companies.",
                    default: "companies",
                },
                limit: {
                    type: "number",
                    description: "Max results to find. Default 10, max 50.",
                    default: 10,
                },
                depth: {
                    type: "string",
                    description: "Research depth: 'standard' (2 credits/result), 'thorough' (3), or 'deep' (5). Default: standard.",
                    default: "standard",
                },
                confirmed: {
                    type: "boolean",
                    description: "Set to false for cost estimate, true to execute. Always get estimate first.",
                    default: false,
                },
            },
            required: ["query"],
        },
    },

    {
        name: "check_research_status",
        description:
            "Poll the status of a running research job. Returns status (pending/running/complete/error), result count, and full results when complete. Keep calling this until status is 'complete', then call import_research_results.",
        inputSchema: {
            type: "object",
            properties: {
                job_id: {
                    type: "string",
                    description: "Research job ID from run_research.",
                },
            },
            required: ["job_id"],
        },
    },

    {
        name: "import_research_results",
        description:
            "Import completed research results into the CRM as contacts. Only call after check_research_status returns 'complete'. Can auto-assign to a folder and/or enroll in a campaign.",
        inputSchema: {
            type: "object",
            properties: {
                job_id: {
                    type: "string",
                    description: "The completed research job ID.",
                },
                folder_name: {
                    type: "string",
                    description: "Create/use this folder for imported contacts.",
                },
                campaign_id: {
                    type: "string",
                    description: "Auto-enroll imported contacts into this campaign.",
                },
            },
            required: ["job_id"],
        },
    },

    // ── EMAIL ────────────────────────────────────────────────────────────────

    {
        name: "send_email",
        description:
            "Send a one-off email through your connected email account. Costs 1 credit per send. For bulk sending, use campaigns instead.",
        inputSchema: {
            type: "object",
            properties: {
                to: {
                    type: "string",
                    description: "Recipient email address.",
                },
                subject: {
                    type: "string",
                    description: "Email subject line.",
                },
                body: {
                    type: "string",
                    description: "Email body (plain text — will be auto-converted to HTML).",
                },
                html_body: {
                    type: "string",
                    description: "Email body as raw HTML. Use this instead of 'body' for rich formatting.",
                },
                from_email: {
                    type: "string",
                    description: "Optional. Which connected email account to send from. If not specified, uses the default connected account.",
                },
            },
            required: ["to", "subject"],
        },
    },

    // ── FOLDERS ──────────────────────────────────────────────────────────────

    {
        name: "list_folders",
        description:
            "List all contact folders in the workspace. Folders organize contacts into groups for campaigns. Returns folder names, IDs, and contact counts.",
        inputSchema: {
            type: "object",
            properties: {
                search: {
                    type: "string",
                    description: "Filter folders by name.",
                },
                limit: {
                    type: "number",
                    description: "Max folders to return. Default 100.",
                    default: 100,
                },
            },
        },
    },

    {
        name: "create_folder",
        description:
            "Create a new contact folder. If a folder with the same name already exists, returns the existing one.",
        inputSchema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Name for the new folder.",
                },
            },
            required: ["name"],
        },
    },

    // ── CAMPAIGN DETAIL ──────────────────────────────────────────────────────

    {
        name: "get_campaign",
        description:
            "Get full details of a single campaign including its config, steps, and audience statistics.",
        inputSchema: {
            type: "object",
            properties: {
                campaign_id: {
                    type: "string",
                    description: "ID of the campaign to retrieve.",
                },
            },
            required: ["campaign_id"],
        },
    },

    {
        name: "update_campaign",
        description:
            "Update a campaign's name, config, steps, or type. For status changes (pause/resume/activate), use update_campaign_status instead.",
        inputSchema: {
            type: "object",
            properties: {
                campaign_id: {
                    type: "string",
                    description: "ID of the campaign to update.",
                },
                name: {
                    type: "string",
                    description: "New campaign name.",
                },
                config: {
                    type: "object",
                    description: "Updated campaign configuration (stop_on_reply, target_folder_id, etc.).",
                },
                steps: {
                    type: "array",
                    description: "Campaign steps/sequence. Each step has a type (email, wait, linkedin, etc.) and content.",
                },
                type: {
                    type: "string",
                    description: "Campaign type: email, sms, voice, linkedin, multi_channel.",
                },
            },
            required: ["campaign_id"],
        },
    },

    // ── SETUP & ONBOARDING ──────────────────────────────────────────────────

    {
        name: "setup_workspace",
        description:
            "Run a full health check on the OutreachPilot workspace. Returns setup completeness for: email accounts, ICP config, knowledge base, folders, contacts, campaigns, and credits. Use this FIRST when starting a new conversation to understand what's configured and what needs setup. Returns a readiness percentage and actionable recommendations.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },

    {
        name: "onboarding_guide",
        description:
            "Get the step-by-step onboarding guide for setting up OutreachPilot from scratch. Returns a detailed walkthrough covering: account setup, email connection, ICP configuration, knowledge base, contact import, folder organization, campaign creation, and launch. Use this when a user is new or asks how to get started.",
        inputSchema: {
            type: "object",
            properties: {
                focus: {
                    type: "string",
                    description:
                        "Optional: Focus on a specific area. Options: email, icp, knowledge_base, contacts, campaigns, integrations, all. Default: all.",
                    default: "all",
                },
            },
        },
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server setup
// ─────────────────────────────────────────────────────────────────────────────

const server = new Server(
    {
        name: "OutreachPilot MCP Server",
        version: "2.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
}));

// Execute tools
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;

    try {
        let result: unknown;

        switch (name) {

            // ── CONTACTS ─────────────────────────────────────────────────

            case "search_contacts": {
                const params = new URLSearchParams();
                if (args?.query) params.set("search", args.query as string);
                if (args?.limit) params.set("limit", String(args.limit));
                if (args?.status) params.set("status", args.status as string);
                if (args?.folder_id) params.set("folder_id", args.folder_id as string);
                result = await apiRequest(`/api/v1/contacts?${params.toString()}`);
                break;
            }

            case "list_contacts": {
                const params = new URLSearchParams();
                if (args?.limit) params.set("limit", String(args.limit));
                if (args?.offset) params.set("offset", String(args.offset));
                if (args?.status) params.set("status", args.status as string);
                if (args?.folder_id) params.set("folder_id", args.folder_id as string);
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

            case "get_contact": {
                result = await apiRequest(
                    `/api/v1/contacts/${encodeURIComponent(args?.contact_id as string)}`
                );
                break;
            }

            case "delete_contact": {
                result = await apiRequest(
                    `/api/v1/contacts/${encodeURIComponent(args?.contact_id as string)}`,
                    "DELETE"
                );
                break;
            }

            case "update_contact": {
                const { contact_id, ...fields } = args as Record<string, unknown>;
                result = await apiRequest("/api/v1/contacts", "PATCH", {
                    contact_id,
                    ...fields,
                });
                break;
            }

            // ── CAMPAIGNS ─────────────────────────────────────────────────

            case "list_campaigns": {
                const params = new URLSearchParams();
                if (args?.limit) params.set("limit", String(args.limit));
                if (args?.offset) params.set("offset", String(args.offset));
                if (args?.status) params.set("status", args.status as string);
                if (args?.type) params.set("type", args.type as string);
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

            case "trigger_campaign": {
                const { campaign_id: triggerCampId, ...triggerFields } = args as Record<string, unknown>;
                result = await apiRequest(
                    `/api/v1/campaigns/${encodeURIComponent(triggerCampId as string)}/trigger`,
                    "POST",
                    triggerFields
                );
                break;
            }

            case "get_campaign_status": {
                result = await apiRequest(
                    `/api/v1/campaigns/${encodeURIComponent(args?.campaign_id as string)}/status`
                );
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
                if (args?.limit) params.set("limit", String(args.limit));
                if (args?.offset) params.set("offset", String(args.offset));
                if (args?.search) params.set("search", args.search as string);
                if (args?.domain) params.set("domain", args.domain as string);
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

            case "get_company": {
                result = await apiRequest(
                    `/api/v1/companies/${encodeURIComponent(args?.company_id as string)}`
                );
                break;
            }

            case "update_company": {
                const { company_id: updateCompId, ...companyFields } = args as Record<string, unknown>;
                result = await apiRequest(
                    `/api/v1/companies/${encodeURIComponent(updateCompId as string)}`,
                    "PUT",
                    companyFields
                );
                break;
            }

            case "delete_company": {
                result = await apiRequest(
                    `/api/v1/companies/${encodeURIComponent(args?.company_id as string)}`,
                    "DELETE"
                );
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
                result = await apiRequest(
                    `/api/v1/webhooks?id=${encodeURIComponent(args?.webhook_id as string)}`,
                    "DELETE"
                );
                break;
            }

            // ── RESEARCH ──────────────────────────────────────────────────

            case "run_research": {
                result = await apiRequest("/api/v1/research", "POST", {
                    query: args?.query,
                    target_type: args?.target_type ?? "companies",
                    limit: args?.limit ?? 10,
                    depth: args?.depth ?? "standard",
                    confirmed: args?.confirmed ?? false,
                });
                break;
            }

            case "check_research_status": {
                result = await apiRequest(
                    `/api/v1/research/status?job_id=${encodeURIComponent(args?.job_id as string)}`
                );
                break;
            }

            case "import_research_results": {
                result = await apiRequest("/api/v1/research/import", "POST", {
                    job_id: args?.job_id,
                    folder_name: args?.folder_name,
                    campaign_id: args?.campaign_id,
                });
                break;
            }

            // ── EMAIL ─────────────────────────────────────────────────────

            case "send_email": {
                result = await apiRequest("/api/v1/email/send", "POST", {
                    to: args?.to,
                    subject: args?.subject,
                    body: args?.body,
                    html_body: args?.html_body,
                    from_email: args?.from_email,
                });
                break;
            }

            // ── FOLDERS ──────────────────────────────────────────────────

            case "list_folders": {
                const params = new URLSearchParams();
                if (args?.search) params.set("search", args.search as string);
                if (args?.limit) params.set("limit", String(args.limit));
                result = await apiRequest(`/api/v1/folders?${params.toString()}`);
                break;
            }

            case "create_folder": {
                result = await apiRequest("/api/v1/folders", "POST", {
                    name: args?.name,
                });
                break;
            }

            // ── CAMPAIGN DETAIL ──────────────────────────────────────────

            case "get_campaign": {
                result = await apiRequest(
                    `/api/v1/campaigns/${encodeURIComponent(args?.campaign_id as string)}`
                );
                break;
            }

            case "update_campaign": {
                const { campaign_id: updCampId, ...campFields } = args as Record<string, unknown>;
                result = await apiRequest(
                    `/api/v1/campaigns/${encodeURIComponent(updCampId as string)}`,
                    "PATCH",
                    campFields
                );
                break;
            }
            // ── SETUP & ONBOARDING ────────────────────────────────────────

            case "setup_workspace": {
                result = await apiRequest("/api/v1/setup/status");
                break;
            }

            case "onboarding_guide": {
                const focus = (args?.focus as string) || "all";

                const guides: Record<string, object> = {
                    email: {
                        title: "📧 Connect Email Account",
                        priority: "CRITICAL — required for all outreach",
                        steps: [
                            "Go to Dashboard → Settings → Email Accounts",
                            "Click 'Connect Gmail' (or other provider)",
                            "Authorize OAuth access — OutreachPilot needs send/read permissions",
                            "Set your Sender Name (how recipients see you)",
                            "Send a test email to yourself to verify",
                        ],
                        tips: [
                            "Use a dedicated outreach email, not your personal inbox",
                            "Warm up new email accounts for 2 weeks before high-volume sending",
                            "Keep daily send volume under 50 for new accounts, scale gradually",
                        ],
                        verify: "Use setup_workspace to confirm email shows as 'active'",
                    },
                    icp: {
                        title: "🎯 Configure Ideal Customer Profile (ICP)",
                        priority: "HIGH — directly impacts campaign targeting and copy quality",
                        steps: [
                            "Go to Dashboard → Settings → ICP Configuration",
                            "Set Target Titles (e.g., 'VP of Sales', 'CTO', 'Head of Growth')",
                            "Set Target Industries (e.g., 'SaaS', 'Fintech', 'E-commerce')",
                            "Set Pain Points (e.g., 'manual outreach takes too long', 'low reply rates')",
                            "Set Company Size range (e.g., 50-500 employees)",
                            "Optionally add: tech stack, geographies, funding stage",
                        ],
                        tips: [
                            "Be specific with pain points — these appear in campaign copy",
                            "Add at least 3 fields for best results",
                            "Update ICP as you learn what converts",
                        ],
                        verify: "Use setup_workspace to confirm ICP status is 'complete'",
                    },
                    knowledge_base: {
                        title: "📚 Fill Out Knowledge Base",
                        priority: "CRITICAL — the #1 factor for campaign copy quality",
                        steps: [
                            "Go to Dashboard → Settings → Pilot / Auto-Responder",
                            "Fill in the Knowledge Base text field",
                            "Include: what you sell, who it's for, key value propositions",
                            "Include: pricing/offer details, differentiators vs competitors",
                            "Include: case studies, social proof, notable customers",
                            "Include: common objections and how to handle them",
                            "Aim for 200+ words — more context = better AI output",
                        ],
                        tips: [
                            "This is what the AI reads when writing campaign emails",
                            "Think of it as briefing a new SDR on your product",
                            "Update it when you add features, change pricing, or win big clients",
                            "Include example email copy you've written that performed well",
                        ],
                        verify: "Use setup_workspace to check knowledge_base word count (aim for 200+)",
                    },
                    contacts: {
                        title: "👥 Import Contacts",
                        priority: "HIGH — you need people to reach out to",
                        steps: [
                            "Option 1: CSV Import — Dashboard → Contacts → Import CSV",
                            "Option 2: AI Research — use run_research tool or pilot: 'Find 20 VPs of Sales at SaaS companies in Austin'",
                            "Option 3: Manual — use create_contact tool for individual additions",
                            "Organize contacts into folders (create_folder tool or Dashboard → Contacts → New Folder)",
                            "Enrich contacts with research for better personalization",
                        ],
                        tips: [
                            "Folders = audience segments. Create one per campaign/ICP segment",
                            "Research-imported contacts come pre-enriched with context",
                            "The more data per contact (title, company, context), the better the personalization",
                        ],
                        verify: "Use list_contacts or setup_workspace to confirm contacts exist",
                    },
                    campaigns: {
                        title: "🚀 Create & Launch Your First Campaign",
                        priority: "HIGH — this is where outreach happens",
                        steps: [
                            "Make sure email, ICP, and knowledge base are set up first",
                            "Create a campaign: use pilot tool — 'Build a 3-step email campaign for [audience] about [product/goal]'",
                            "Review the generated steps — the AI uses your knowledge base + ICP",
                            "If copy needs tweaking: 'Rewrite step 2 to be more casual' or 'Add a case study to step 3'",
                            "Assign a target folder: the contacts in that folder will receive the campaign",
                            "Launch: 'Launch the campaign' or use campaign_status tool",
                            "Monitor: use get_campaign_status to track delivery, opens, replies",
                        ],
                        tips: [
                            "Start with 3-step email campaigns before going multi-channel",
                            "Always review AI-generated copy before launching",
                            "Enable 'stop on reply' so responders drop out of the sequence",
                            "Send to a small test group first (10-20 contacts) before scaling",
                        ],
                        verify: "Use get_campaign_status to monitor after launch",
                    },
                    integrations: {
                        title: "🔗 Optional Integrations",
                        priority: "OPTIONAL — enhance functionality",
                        steps: [
                            "LinkedIn: Connect in Dashboard → Settings for LinkedIn outreach steps",
                            "Slack: Connect for real-time notifications when leads reply",
                            "Calendar: Connect Google Calendar for AI-powered meeting booking",
                            "Loom: Add Loom video links to campaign emails for higher engagement",
                            "Webhooks: Use create_webhook to receive real-time events in your systems",
                        ],
                        tips: [
                            "Slack integration is great for team visibility on replies",
                            "Calendar integration lets the AI auto-book meetings from chat",
                            "Webhooks enable custom automations with your own backend",
                        ],
                    },
                };

                const selectedGuides = focus === "all"
                    ? guides
                    : { [focus]: guides[focus] || { error: `Unknown focus area: ${focus}. Options: email, icp, knowledge_base, contacts, campaigns, integrations, all` } };

                result = {
                    title: "OutreachPilot Setup Guide",
                    recommended_order: [
                        "1. email — Connect your email account",
                        "2. knowledge_base — Fill out product/company knowledge",
                        "3. icp — Configure your ideal customer profile",
                        "4. contacts — Import or research your target audience",
                        "5. campaigns — Create and launch your first campaign",
                        "6. integrations — (Optional) Connect LinkedIn, Slack, Calendar",
                    ],
                    quick_start: "After completing steps 1-3, try: 'Build a 3-step email campaign targeting [your audience] about [your product]' — the AI will use your knowledge base and ICP to generate high-quality copy.",
                    guides: selectedGuides,
                    pro_tips: [
                        "Run setup_workspace anytime to check what's configured vs missing",
                        "The knowledge base is the single biggest lever for campaign quality",
                        "Start small: 3-step email campaign to 20 contacts, then iterate",
                        "Use the pilot tool for complex workflows — it has 35+ internal tools",
                    ],
                };
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

    } catch (error: unknown) {
        const err = error as Error;
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
