#!/usr/bin/env node
// JEVIS MCP server (stdio). Any MCP client — Claude Code, Codex, Gemini CLI —
// gets the same hands. stdout belongs to the protocol: never print to it.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, INSTRUCTIONS, callTool } from '../core/tools.js';

const server = new Server(
  { name: 'jevis', version: '0.2.0' },
  { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}));

server.setRequestHandler(CallToolRequestSchema, async request =>
  callTool(request.params.name, request.params.arguments || {})
);

await server.connect(new StdioServerTransport());
