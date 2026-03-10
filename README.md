# OutreachPilot MCP Server

The official Model Context Protocol (MCP) server for [OutreachPilot](https://useoutreachpilot.com).

This server allows you to connect your custom AI agents, LangChain scripts, or desktop LLM clients (like Claude Desktop and Cursor) directly to your OutreachPilot workspace. 

Give your AI agents the ability to:
- **Search CRM Contacts:** Query your database for specific roles, companies, and leads.
- **Create Campaigns:** Dynamically generate multi-channel (Email, LinkedIn, SMS) outbound sequences.
- **Send Pilot Instructions:** Pass natural language commands directly to the internal Pilot Assistant to handle replies, draft follow-ups, and book meetings.

## Requirements
- Node.js >= 18
- An active OutreachPilot account and API Key

## Setup

1. Clone this repository:
```bash
git clone https://github.com/outreachpilot/mcp-server.git
cd mcp-server
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with your credentials:
```bash
OUTREACHPILOT_API_KEY=your_outreachpilot_api_key_here
OUTREACHPILOT_API_URL=https://api.useoutreachpilot.com/v1
```

4. Build the server:
```bash
npm run build
```

## Connecting to Claude Desktop

To use OutreachPilot natively in Claude, add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "outreachpilot": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/build/index.js"],
      "env": {
        "OUTREACHPILOT_API_KEY": "your_api_key",
        "OUTREACHPILOT_API_URL": "https://api.useoutreachpilot.com/v1"
      }
    }
  }
}
```

## Connecting to Cursor IDE

1. Open Cursor Settings -> Features -> MCP
2. Click `+ Add New MCP Server`
3. Set Name to `OutreachPilot` and Type to `command`
4. Set Command to: `node /absolute/path/to/mcp-server/build/index.js`

## Available Tools

- `search_contacts(query: string, limit?: number)`
- `create_campaign(name: string, targetAudience: string)`
- `send_pilot_message(instruction: string)`

## Development

To run the server locally for testing:
```bash
npm run dev
```

*Note: The MCP protocol communicates over stdio. If you run the server directly in a terminal, it will wait for JSON-RPC messages on stdin.*

## Architecture
The MCP Server acts as an open standard wrapper around the proprietary OutreachPilot API. All authentication, credit deduction, and rate-limiting is handled automatically by the OutreachPilot backend.
