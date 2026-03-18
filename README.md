# OutreachPilot MCP Server

The official [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for [OutreachPilot](https://useoutreachpilot.com).

Connect your AI agents — Claude Desktop, Cursor, LangChain, CrewAI, or any MCP-compatible client — directly to your OutreachPilot workspace to automate outreach, research leads, manage campaigns, and much more.

---

## Requirements

- Node.js ≥ 18
- An active OutreachPilot **Pro or Scale** workspace
- An API key (generate one in **Settings → Workspace → API Keys**)

---

## Quick Start

### Option A: npx (recommended — zero install)

No download needed. Just configure your MCP client:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "outreachpilot": {
      "command": "npx",
      "args": ["-y", "outreachpilot-mcp"],
      "env": {
        "OUTREACHPILOT_API_KEY": "op_live_your_key_here",
        "OUTREACHPILOT_API_URL": "https://useoutreachpilot.com"
      }
    }
  }
}
```

Restart Claude Desktop — done. ✅

### Option B: Manual install (for development)

```bash
git clone https://github.com/emielmadonna/OutreachPilotMCP.git
cd OutreachPilotMCP
npm install
```

Create a `.env` file:
```env
OUTREACHPILOT_API_KEY=op_live_your_key_here
OUTREACHPILOT_API_URL=https://useoutreachpilot.com
```

Build the server:
```bash
npm run build
```

---

## Connecting to Claude Desktop

Add this to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "outreachpilot": {
      "command": "node",
      "args": ["/absolute/path/to/OutreachPilotMCP/build/index.js"],
      "env": {
        "OUTREACHPILOT_API_KEY": "op_live_your_key_here",
        "OUTREACHPILOT_API_URL": "https://useoutreachpilot.com"
      }
    }
  }
}
```

Restart Claude Desktop — you'll see OutreachPilot tools available in the toolbar.

---

## Connecting to Cursor

1. Open **Cursor Settings → Features → MCP**
2. Click `+ Add New MCP Server`
3. Set **Name** to `OutreachPilot`, **Type** to `command`
4. Set **Command** to: `npx -y outreachpilot-mcp`
5. Add env vars: `OUTREACHPILOT_API_KEY` and `OUTREACHPILOT_API_URL`

---

## Getting Started After Install

Once connected, start with these two commands:

1. **Check your workspace status:**
   ```
   Use the setup_workspace tool
   ```
   This runs a health check and tells you what's configured and what needs setup.

2. **Get the full setup guide:**
   ```
   Use the onboarding_guide tool
   ```
   Returns step-by-step instructions for email, ICP, knowledge base, contacts, and campaigns.

---

## Available Tools (31)

### 🔧 Setup & Onboarding

| Tool | Description |
|------|-------------|
| `setup_workspace` | Full workspace health check — email, ICP, knowledge base, contacts, campaigns, credits. Returns readiness % and action items. |
| `onboarding_guide` | Step-by-step setup guide. Pass `focus` param for specific area (email, icp, knowledge_base, contacts, campaigns, integrations). |

### 💬 `pilot` — AI Engine Bridge *(recommended for complex tasks)*

Send any natural language instruction to the OutreachPilot AI engine. This is the most powerful tool — it has access to all 35+ internal tools including calendar booking, LinkedIn outreach, deep research, email drafting, campaign building, voice dialing, and more.

```
"Find 20 VP of Sales at Series B SaaS companies in Austin"
"Draft a follow-up email to John Doe at Acme Corp"
"Build a 3-step email campaign for the Austin SaaS folder"
"Research Stripe — find buying signals and key decision makers"
"Book a meeting with Jane Smith on Friday at 2pm"
"Check if my email accounts and integrations are working"
```

---

### 👥 Contact Tools

| Tool | Description |
|------|-------------|
| `search_contacts` | Search CRM contacts by name, email, or company |
| `list_contacts` | List contacts with filters (status, folder, pagination) |
| `create_contact` | Create one or more contacts, optionally auto-enroll in a campaign |
| `update_contact` | Update a contact's fields (name, email, status, tags, etc.) |
| `get_contact` | Get full details of a single contact by ID |
| `delete_contact` | Delete a contact from the CRM |

### 📣 Campaign Tools

| Tool | Description |
|------|-------------|
| `list_campaigns` | List campaigns with optional status/type filters |
| `create_campaign` | Create a new draft campaign |
| `update_campaign_status` | Pause, resume, activate, or archive a campaign |
| `trigger_campaign` | Enroll a specific contact into a campaign |
| `get_campaign_status` | Get campaign audience stats (enrolled, completed, replied) |
| `get_campaign` | Get full campaign details including config, steps, and audience |
| `update_campaign` | Update campaign name, config, steps, or type |

### 🏢 Company Tools

| Tool | Description |
|------|-------------|
| `list_companies` | List company accounts in the CRM |
| `create_company` | Create one or more company accounts |
| `get_company` | Get full details of a single company by ID |
| `update_company` | Update company fields |
| `delete_company` | Delete a company from the CRM |

### 📧 Email

| Tool | Description |
|------|-------------|
| `send_email` | Send a one-off email through your connected account. Costs 1 credit. |

### 📁 Folders

| Tool | Description |
|------|-------------|
| `list_folders` | List contact folders with contact counts |
| `create_folder` | Create a new folder (idempotent — returns existing if name matches) |

### 💳 Credits

| Tool | Description |
|------|-------------|
| `get_credit_balance` | Check credits remaining, plan tier, and reset date |

### 🔬 Research

| Tool | Description |
|------|-------------|
| `run_research` | Start agentic research to find companies or people |
| `check_research_status` | Poll a research job's progress |
| `import_research_results` | Import research results as contacts into the CRM |

### 🔔 Webhook Tools

| Tool | Description |
|------|-------------|
| `list_webhooks` | List active webhook subscriptions |
| `create_webhook` | Register a new webhook endpoint for real-time events |
| `delete_webhook` | Remove a webhook subscription |

---

## Example Workflows

### Full Prospecting Pipeline
```
User: Find 10 fintech founders in New York, research each one, and add them to a campaign.

Claude: [setup_workspace] → checks workspace is ready
        [run_research] → finds 10 fintech founders
        [check_research_status] → waits for results
        [import_research_results] → imports to CRM + folder
        [pilot] → "Build a 3-step email campaign for the NYC Fintech folder"
```

### Quick Health Check
```
User: Is everything set up correctly?

Claude: [setup_workspace] → returns readiness %, flags missing items
        → "Your workspace is 75% ready. You're missing a knowledge base — this is critical for campaign quality. Go to Settings → Pilot and add your product info."
```

### Guided Onboarding
```
User: I'm new, how do I get started?

Claude: [onboarding_guide] → returns full setup walkthrough
        → walks through email setup, ICP config, knowledge base, first campaign
```

---

## Authentication

All API calls use Bearer token authentication:
```
Authorization: Bearer op_live_your_key_here
```

API keys are scoped to endpoints. Default scopes:
- `contacts` — contact operations
- `campaigns` — campaign, webhook operations
- `credits` — credit balance
- `chat` — pilot bridge (required for agentic tasks)
- `email` — direct email sending

---

## Development

Run in development mode (no build step needed):
```bash
npm run dev
```

The server communicates over **stdio** (JSON-RPC 2.0), which is required by the MCP protocol.

---

## Architecture

```
MCP Client (Claude, Cursor, etc.)
    ↓  JSON-RPC over stdio
OutreachPilot MCP Server (31 tools)
    ↓  HTTPS REST + Bearer auth
OutreachPilot API (/api/v1/*)
    ↓  Internal
OutreachPilot AI Pilot (35+ tools)
    ↓
Supabase · OpenAI · LinkedIn · Twilio · Google Calendar
```

The `pilot` tool routes through `POST /api/v1/chat`, which gives your AI agent **full access** to the internal OutreachPilot engine — the same AI that powers the in-app Pilot Buddy chat.
