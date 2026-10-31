#!/usr/bin/env node
// Handry MCP server (stdio). Any MCP client — Claude Code, Codex, Gemini CLI —
// gets the same hands. stdout belongs to the protocol: never print to it.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, INSTRUCTIONS, callTool } from '../core/tools.js';
import { jevOff } from '../core/jev.js';
import { MCP_NAME } from '../core/brand.js';

// One Claude session = one run in the action log (the teach tool learns from it),
// unless Handry started this server for one of its own runs.
process.env.JEVIS_RUN_ID ||= `mcp-${Date.now().toString(36)}`;

// Texts may be functions, so they come in the language Handry speaks when they are asked for.
const now = text => (typeof text === 'function' ? text() : text);

const server = new Server(
  { name: MCP_NAME, version: '0.3.0' },
  { capabilities: { tools: {} }, instructions: now(INSTRUCTIONS) }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  // jev_ask asks Jev directly: without Jev it is not offered.
  tools: TOOLS.filter(t => !(t.name === 'jev_ask' && jevOff())).map(({ name, description, inputSchema }) => ({ name, description: now(description), inputSchema }))
}));

server.setRequestHandler(CallToolRequestSchema, async request =>
  callTool(request.params.name, request.params.arguments || {})
);

await server.connect(new StdioServerTransport());
