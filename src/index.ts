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

import crypto from "node:crypto";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const API_KEY = process.env.OUTREACHPILOT_API_KEY;
const API_URL = (process.env.OUTREACHPILOT_API_URL || "https://useoutreachpilot.com").replace(/\/$/, "");
const CLI_COMMAND = process.argv[2];

if (!API_KEY && !["list-tools", "help", "--help", "-h"].includes(CLI_COMMAND || "")) {
    console.error("Warning: OUTREACHPILOT_API_KEY is not set. Tool calls that reach the API will fail until it is provided.");
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper — all tools call this to hit the real API
// ─────────────────────────────────────────────────────────────────────────────

async function apiRequest(
    path: string,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
    body?: Record<string, unknown>,
    options: { idempotencyKey?: string } = {}
): Promise<unknown> {
    if (!API_KEY) {
        throw new Error("OUTREACHPILOT_API_KEY is not set. Create one in OutreachPilot Settings -> Workspace -> API Keys.");
    }

    const url = `${API_URL}${path}`;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": "OutreachPilot-MCP/2.1.0",
    };
    if (options.idempotencyKey) {
        headers["Idempotency-Key"] = options.idempotencyKey;
    }

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

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
        .join(",")}}`;
}

function makeStableIdempotencyKey(toolName: string, args: Record<string, unknown>): string {
    const { confirmed: _confirmed, idempotency_key: _idempotencyKey, ...stableArgs } = args;
    const digest = crypto
        .createHash("sha256")
        .update(`${toolName}:${stableStringify(stableArgs)}`)
        .digest("hex")
        .slice(0, 32);
    return `mcp:${toolName}:${digest}`;
}

function idempotencyKeyFor(toolName: string, args: Record<string, unknown>): string {
    return typeof args.idempotency_key === "string" && args.idempotency_key.trim()
        ? args.idempotency_key.trim()
        : makeStableIdempotencyKey(toolName, args);
}

function stripHelperFields(args: Record<string, unknown>): Record<string, unknown> {
    const { confirmed: _confirmed, idempotency_key: _idempotencyKey, ...apiArgs } = args;
    return apiArgs;
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
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate contact creation on retries.",
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
                confirmed: {
                    type: "boolean",
                    description: "Required when marking a contact not_interested or unsubscribed.",
                    default: false,
                },
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate write execution on retries.",
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
                confirmed: {
                    type: "boolean",
                    description: "Must be true to permanently delete the contact.",
                    default: false,
                },
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate delete attempts on retries.",
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
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate campaign creation on retries.",
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
                confirmed: {
                    type: "boolean",
                    description: "Must be true for active, paused, and archived status changes.",
                    default: false,
                },
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate status updates on retries.",
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
                confirmed: {
                    type: "boolean",
                    description: "Must be true to enroll a contact into the campaign.",
                    default: false,
                },
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate enrollment attempts on retries.",
                },
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
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate company creation on retries.",
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
                confirmed: {
                    type: "boolean",
                    description: "Must be true to update the company.",
                    default: false,
                },
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate company updates on retries.",
                },
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
                confirmed: {
                    type: "boolean",
                    description: "Must be true to permanently delete the company.",
                    default: false,
                },
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate delete attempts on retries.",
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
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate webhook registration on retries.",
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
                confirmed: {
                    type: "boolean",
                    description: "Must be true to delete the webhook.",
                    default: false,
                },
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate delete attempts on retries.",
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
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate research job creation on retries.",
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
                confirmed: {
                    type: "boolean",
                    description: "Must be true to import research results into the CRM.",
                    default: false,
                },
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate imports on retries.",
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
                confirmed: {
                    type: "boolean",
                    description: "Must be true to send the email.",
                    default: false,
                },
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate email sends on retries.",
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
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate folder creation on retries.",
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
                confirmed: {
                    type: "boolean",
                    description: "Must be true to update the campaign.",
                    default: false,
                },
                idempotency_key: {
                    type: "string",
                    description: "Optional stable key to prevent duplicate campaign updates on retries.",
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
// Runtime input validation and write safety
// ─────────────────────────────────────────────────────────────────────────────

const optionalString = z.string().trim().min(1).optional();
const helperFields = {
    confirmed: z.boolean().optional(),
    idempotency_key: z.string().trim().min(1).optional(),
};
const contactStatusSchema = z.enum(["new", "contacted", "replied", "interested", "meeting_booked", "not_interested", "unsubscribed"]).optional();
const campaignStatusSchema = z.enum(["active", "paused", "draft", "completed", "archived"]).optional();
const campaignTypeSchema = z.enum(["email", "sms", "voice", "linkedin", "multi_channel"]).optional();
const researchDepthSchema = z.enum(["standard", "thorough", "deep"]).optional();

const contactPayloadSchema = z.object({
    first_name: optionalString,
    last_name: optionalString,
    email: optionalString,
    phone: optionalString,
    company: optionalString,
    title: optionalString,
    linkedin_url: optionalString,
    status: contactStatusSchema,
}).passthrough();

const companyPayloadSchema = z.object({
    name: optionalString,
    domain: optionalString,
    industry: optionalString,
    size: optionalString,
}).passthrough();

const TOOL_SCHEMAS: Record<string, z.ZodType<unknown>> = {
    search_contacts: z.object({
        query: z.string().trim().min(1),
        limit: z.number().int().positive().max(200).optional(),
        status: contactStatusSchema,
        folder_id: optionalString,
    }),
    list_contacts: z.object({
        limit: z.number().int().positive().max(200).optional(),
        offset: z.number().int().min(0).optional(),
        status: contactStatusSchema,
        folder_id: optionalString,
    }),
    create_contact: z.object({
        contacts: z.array(contactPayloadSchema).min(1).max(200),
        upsert: z.boolean().optional(),
        campaign_id: optionalString,
        ...helperFields,
    }),
    update_contact: z.object({
        contact_id: z.string().trim().min(1),
        first_name: optionalString,
        last_name: optionalString,
        email: optionalString,
        phone: optionalString,
        company: optionalString,
        title: optionalString,
        status: contactStatusSchema,
        tags: z.array(z.string()).optional(),
        linkedin_url: optionalString,
        ...helperFields,
    }),
    get_contact: z.object({ contact_id: z.string().trim().min(1) }),
    delete_contact: z.object({ contact_id: z.string().trim().min(1), ...helperFields }),
    list_campaigns: z.object({
        limit: z.number().int().positive().max(200).optional(),
        offset: z.number().int().min(0).optional(),
        status: campaignStatusSchema,
        type: campaignTypeSchema,
    }),
    create_campaign: z.object({
        name: z.string().trim().min(1),
        type: campaignTypeSchema,
        config: z.record(z.string(), z.unknown()).optional(),
        ...helperFields,
    }),
    update_campaign_status: z.object({
        campaign_id: z.string().trim().min(1),
        status: z.enum(["active", "paused", "draft", "completed", "archived"]),
        ...helperFields,
    }),
    trigger_campaign: z.object({
        campaign_id: z.string().trim().min(1),
        contact_id: optionalString,
        email: optionalString,
        first_name: optionalString,
        last_name: optionalString,
        company: optionalString,
        linkedin_url: optionalString,
        ...helperFields,
    }),
    get_campaign_status: z.object({ campaign_id: z.string().trim().min(1) }),
    list_companies: z.object({
        limit: z.number().int().positive().max(200).optional(),
        offset: z.number().int().min(0).optional(),
        search: optionalString,
        domain: optionalString,
    }),
    create_company: z.object({
        companies: z.array(companyPayloadSchema).min(1).max(200),
        upsert: z.boolean().optional(),
        ...helperFields,
    }),
    get_company: z.object({ company_id: z.string().trim().min(1) }),
    update_company: z.object({
        company_id: z.string().trim().min(1),
        name: optionalString,
        domain: optionalString,
        industry: optionalString,
        size: optionalString,
        context: z.record(z.string(), z.unknown()).optional(),
        ...helperFields,
    }),
    delete_company: z.object({ company_id: z.string().trim().min(1), ...helperFields }),
    get_credit_balance: z.object({}),
    list_webhooks: z.object({}),
    create_webhook: z.object({
        url: z.string().url(),
        events: z.array(z.string().trim().min(1)).min(1),
        secret: optionalString,
        ...helperFields,
    }),
    delete_webhook: z.object({ webhook_id: z.string().trim().min(1), ...helperFields }),
    pilot: z.object({
        message: z.string().trim().min(1),
        thread_id: optionalString,
    }),
    run_research: z.object({
        query: z.string().trim().min(1),
        target_type: z.enum(["companies", "people"]).optional(),
        limit: z.number().int().positive().max(50).optional(),
        depth: researchDepthSchema,
        confirmed: z.boolean().optional(),
        idempotency_key: z.string().trim().min(1).optional(),
    }),
    check_research_status: z.object({ job_id: z.string().trim().min(1) }),
    import_research_results: z.object({
        job_id: z.string().trim().min(1),
        folder_name: optionalString,
        campaign_id: optionalString,
        ...helperFields,
    }),
    send_email: z.object({
        to: z.string().email(),
        subject: z.string().trim().min(1),
        body: optionalString,
        html_body: optionalString,
        from_email: z.string().email().optional(),
        ...helperFields,
    }).refine((value) => Boolean(value.body || value.html_body), {
        message: "Either body or html_body is required.",
        path: ["body"],
    }),
    list_folders: z.object({
        search: optionalString,
        limit: z.number().int().positive().max(200).optional(),
    }),
    create_folder: z.object({
        name: z.string().trim().min(1),
        ...helperFields,
    }),
    get_campaign: z.object({ campaign_id: z.string().trim().min(1) }),
    update_campaign: z.object({
        campaign_id: z.string().trim().min(1),
        name: optionalString,
        config: z.record(z.string(), z.unknown()).optional(),
        steps: z.array(z.unknown()).optional(),
        type: campaignTypeSchema,
        ...helperFields,
    }),
    setup_workspace: z.object({}),
    onboarding_guide: z.object({
        focus: z.enum(["email", "icp", "knowledge_base", "contacts", "campaigns", "integrations", "all"]).optional(),
    }),
};

function parseToolArgs(toolName: string, rawArgs: unknown): Record<string, unknown> {
    const schema = TOOL_SCHEMAS[toolName];
    if (!schema) {
        throw new Error(`Unknown tool: "${toolName}". Available tools: ${TOOLS.map((tool) => tool.name).join(", ")}`);
    }

    const parsed = schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
        const details = parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
            .join("; ");
        throw new Error(`Invalid arguments for "${toolName}": ${details}`);
    }

    return parsed.data as Record<string, unknown>;
}

function confirmationSummary(toolName: string, args: Record<string, unknown>): string | null {
    switch (toolName) {
        case "send_email":
            return `Send email to ${String(args.to)} with subject "${String(args.subject)}".`;
        case "delete_contact":
            return `Permanently delete contact ${String(args.contact_id)}.`;
        case "delete_company":
            return `Permanently delete company ${String(args.company_id)}.`;
        case "delete_webhook":
            return `Delete webhook ${String(args.webhook_id)}.`;
        case "trigger_campaign":
            return `Enroll a contact into campaign ${String(args.campaign_id)}.`;
        case "import_research_results":
            return `Import research job ${String(args.job_id)} into the CRM.`;
        case "update_campaign":
            return `Update campaign ${String(args.campaign_id)}.`;
        case "update_company":
            return `Update company ${String(args.company_id)}.`;
        case "update_campaign_status": {
            const status = String(args.status);
            return ["active", "paused", "archived"].includes(status)
                ? `Change campaign ${String(args.campaign_id)} status to ${status}.`
                : null;
        }
        case "update_contact": {
            const status = typeof args.status === "string" ? args.status : "";
            return ["not_interested", "unsubscribed"].includes(status)
                ? `Mark contact ${String(args.contact_id)} as ${status}.`
                : null;
        }
        default:
            return null;
    }
}

function confirmationResult(toolName: string, args: Record<string, unknown>): Record<string, unknown> | null {
    const summary = confirmationSummary(toolName, args);
    if (!summary || args.confirmed === true) {
        return null;
    }

    const idempotencyKey = idempotencyKeyFor(toolName, args);
    return {
        needs_confirmation: true,
        tool: toolName,
        summary,
        message: `${summary} Re-run this tool with confirmed: true to execute.`,
        next_call: {
            tool: toolName,
            arguments: {
                ...args,
                confirmed: true,
                idempotency_key: idempotencyKey,
            },
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server setup
// ─────────────────────────────────────────────────────────────────────────────

const server = new Server(
    {
        name: "OutreachPilot MCP Server",
        version: "2.1.0",
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
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    try {
        const args = parseToolArgs(name, request.params.arguments);
        const pendingConfirmation = confirmationResult(name, args);
        if (pendingConfirmation) {
            return {
                content: [{ type: "text", text: formatResult(pendingConfirmation) }],
            };
        }

        const writeOptions = { idempotencyKey: idempotencyKeyFor(name, args) };
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
                }, writeOptions);
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
                    "DELETE",
                    undefined,
                    writeOptions
                );
                break;
            }

            case "update_contact": {
                const { contact_id, ...fields } = args as Record<string, unknown>;
                result = await apiRequest("/api/v1/contacts", "PATCH", {
                    contact_id,
                    ...fields,
                }, writeOptions);
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
                }, writeOptions);
                break;
            }

            case "trigger_campaign": {
                const { campaign_id: triggerCampId, ...triggerFields } = stripHelperFields(args);
                result = await apiRequest(
                    `/api/v1/campaigns/${encodeURIComponent(triggerCampId as string)}/trigger`,
                    "POST",
                    triggerFields,
                    writeOptions
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
                }, writeOptions);
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
                }, writeOptions);
                break;
            }

            case "get_company": {
                result = await apiRequest(
                    `/api/v1/companies/${encodeURIComponent(args?.company_id as string)}`
                );
                break;
            }

            case "update_company": {
                const { company_id: updateCompId, ...companyFields } = stripHelperFields(args);
                result = await apiRequest(
                    `/api/v1/companies/${encodeURIComponent(updateCompId as string)}`,
                    "PUT",
                    companyFields,
                    writeOptions
                );
                break;
            }

            case "delete_company": {
                result = await apiRequest(
                    `/api/v1/companies/${encodeURIComponent(args?.company_id as string)}`,
                    "DELETE",
                    undefined,
                    writeOptions
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
                }, writeOptions);
                break;
            }

            case "delete_webhook": {
                result = await apiRequest(
                    `/api/v1/webhooks?id=${encodeURIComponent(args?.webhook_id as string)}`,
                    "DELETE",
                    undefined,
                    writeOptions
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
                }, writeOptions);
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
                }, writeOptions);
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
                }, writeOptions);
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
                }, writeOptions);
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
                const { campaign_id: updCampId, ...campFields } = stripHelperFields(args);
                result = await apiRequest(
                    `/api/v1/campaigns/${encodeURIComponent(updCampId as string)}`,
                    "PATCH",
                    campFields,
                    writeOptions
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
                }, writeOptions);
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
    console.error(`OutreachPilot MCP Server v2.1.0 started.`);
    console.error(`API URL: ${API_URL}`);
    console.error(`Tools available: ${TOOLS.map(t => t.name).join(", ")}`);
}

function printCliHelp(): void {
    console.log(`OutreachPilot MCP / CLI

Usage:
  outreachpilot-mcp                 Start the MCP stdio server
  outreachpilot-mcp mcp             Start the MCP stdio server
  outreachpilot-mcp list-tools      Print available MCP tools as JSON
  outreachpilot-mcp doctor          Check API key and workspace connectivity
  outreachpilot-mcp pilot <message> Send a natural-language command to /api/v1/chat

Environment:
  OUTREACHPILOT_API_KEY             Required for API calls
  OUTREACHPILOT_API_URL             Defaults to https://useoutreachpilot.com`);
}

async function runCli(argv: string[]): Promise<void> {
    const [command, ...rest] = argv;

    switch (command) {
        case undefined:
        case "mcp":
            await start();
            return;
        case "help":
        case "--help":
        case "-h":
            printCliHelp();
            return;
        case "list-tools":
            console.log(formatResult(TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))));
            return;
        case "doctor": {
            const status = {
                api_url: API_URL,
                api_key_present: Boolean(API_KEY),
            };
            if (!API_KEY) {
                console.log(formatResult({
                    ok: false,
                    ...status,
                    next_step: "Set OUTREACHPILOT_API_KEY to an op_live_ API key from Settings -> Workspace -> API Keys.",
                }));
                process.exitCode = 1;
                return;
            }

            const setup = await apiRequest("/api/v1/setup/status");
            console.log(formatResult({ ok: true, ...status, setup }));
            return;
        }
        case "pilot": {
            const message = rest.join(" ").trim();
            if (!message) {
                throw new Error("Usage: outreachpilot-mcp pilot <message>");
            }

            const result = await apiRequest("/api/v1/chat", "POST", { message }, {
                idempotencyKey: makeStableIdempotencyKey("cli:pilot", { message }),
            });
            console.log(formatResult(result));
            return;
        }
        default:
            throw new Error(`Unknown command "${command}". Run "outreachpilot-mcp help" for usage.`);
    }
}

runCli(process.argv.slice(2)).catch((error) => {
    console.error("Fatal server error:", error);
    process.exit(1);
});
