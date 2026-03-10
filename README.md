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
4. Set **Command** to: `node /absolute/path/to/OutreachPilotMCP/build/index.js`
5. Add env vars: `OUTREACHPILOT_API_KEY` and `OUTREACHPILOT_API_URL`

---

## Available Tools

### 💬 `pilot` — AI Engine Bridge *(recommended for complex tasks)*

Send any natural language instruction to the OutreachPilot AI engine. This is the most powerful tool — it has access to all 35+ internal tools including calendar booking, LinkedIn outreach, deep research, email drafting, campaign building, voice dialing, and more.

```
"Find 20 VP of Sales at Series B SaaS companies in Austin"
"Draft a follow-up email to John Doe at Acme Corp"
"Build a 3-step email campaign for the Austin SaaS folder"
"Research Stripe — find buying signals and key decision makers"
"Book a meeting with Jane Smith on Friday at 2pm"
"Check if my email accounts and integrations are working"
"How many credits do I have left?"
```

---

### 👥 Contact Tools

| Tool | Description |
|------|-------------|
| `search_contacts` | Search CRM contacts by name, email, or company |
| `list_contacts` | List contacts with filters (status, folder, pagination) |
| `create_contact` | Create one or more contacts, optionally auto-enroll in a campaign |
| `update_contact` | Update a contact's fields (name, email, status, tags, etc.) |

### 📣 Campaign Tools

| Tool | Description |
|------|-------------|
| `list_campaigns` | List campaigns with optional status/type filters |
| `create_campaign` | Create a new draft campaign |
| `update_campaign_status` | Pause, resume, activate, or archive a campaign |

### 🏢 Company Tools

| Tool | Description |
|------|-------------|
| `list_companies` | List company accounts in the CRM |
| `create_company` | Create one or more company accounts |

### 💳 Credits

| Tool | Description |
|------|-------------|
| `get_credit_balance` | Check credits remaining, plan tier, and reset date |

### 🔔 Webhook Tools

| Tool | Description |
|------|-------------|
| `list_webhooks` | List active webhook subscriptions |
| `create_webhook` | Register a new webhook endpoint for real-time events |
| `delete_webhook` | Remove a webhook subscription |

---

## Example: Agentic Workflow with Claude

```
User: Find 10 fintech founders in New York, research each one, and add them to my "NYC Fintech" campaign.

Claude: [calls pilot] "Find 10 fintech founders in New York, research each one with buying signals, and add them to the NGC Fintech campaign"

→ OutreachPilot AI runs agentic research, finds leads, enriches them, and enrolls them automatically.
```

---

## Authentication

All API calls use Bearer token authentication:
```
Authorization: Bearer op_live_your_key_here
```

API keys are scoped to specific endpoints. Make sure your key has the required scopes:
- `contacts` — for contact operations
- `campaigns` — for campaign, webhook operations
- `credits` — for credit balance
- `chat` — for the `pilot` bridge (required for agentic tasks)

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
OutreachPilot MCP Server
    ↓  HTTPS REST + Bearer auth
OutreachPilot API (/api/v1/*)
    ↓  Internal
OutreachPilot AI Pilot (35+ tools)
    ↓
Supabase · OpenAI · LinkedIn · Twilio · Google Calendar
```

The `pilot` tool routes through `POST /api/v1/chat`, which gives your AI agent **full access** to the internal OutreachPilot engine — the same AI that powers the in-app Pilot Buddy chat.
