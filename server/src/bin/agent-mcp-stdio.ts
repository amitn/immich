#!/usr/bin/env node
/**
 * Bridges an agent's stdio MCP client to the Immich MCP endpoint (Streamable HTTP), for ACP agents that don't support
 * MCP over HTTP. A pure proxy: messages are forwarded unchanged in both directions.
 *
 * Environment: IMMICH_MCP_URL, IMMICH_MCP_TOKEN
 */
/* eslint-disable unicorn/prefer-add-event-listener -- MCP transports only have on* callbacks */
// eslint-disable-next-line import-x/no-unresolved -- resolved through the package's wildcard export
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
// eslint-disable-next-line import-x/no-unresolved
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const main = async () => {
  const url = process.env.IMMICH_MCP_URL;
  const token = process.env.IMMICH_MCP_TOKEN;
  if (!url || !token) {
    console.error('IMMICH_MCP_URL and IMMICH_MCP_TOKEN are required');
    process.exit(1);
  }

  const stdio = new StdioServerTransport();
  const http = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });

  let closing = false;
  const close = async (code: number) => {
    if (closing) {
      return;
    }
    closing = true;
    await Promise.allSettled([stdio.close(), http.close()]);
    process.exit(code);
  };

  stdio.onmessage = (message) => {
    http.send(message).catch((error: Error) => {
      console.error(`Immich MCP request failed: ${error.message}`);
      // answer the request, so the agent doesn't wait forever
      if ('id' in message && 'method' in message) {
        void stdio.send({ jsonrpc: '2.0', id: message.id, error: { code: -32_603, message: error.message } });
      }
    });
  };
  http.onmessage = (message) => void stdio.send(message);
  stdio.onerror = (error) => console.error(`stdio error: ${error.message}`);
  http.onerror = (error) => console.error(`Immich MCP error: ${error.message}`);
  stdio.onclose = () => void close(0);
  process.stdin.on('end', () => void close(0));

  await http.start();
  await stdio.start();
};

void main();
