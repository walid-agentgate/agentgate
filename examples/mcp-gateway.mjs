import { createMCPGatewayServer } from '../src/mcp-gateway.js';

const { server } = createMCPGatewayServer({
  mode: 'enforce',
  policies: {
    approvalActions: ['refund'],
    blockActions: ['export_all']
  },
  tools: [
    {
      name: 'read_customer',
      description: 'Read a customer record',
      inputSchema: { type: 'object', properties: { customerId: { type: 'string' } } },
      handler: async ({ customerId }) => ({ customerId, name: 'Demo Customer' })
    },
    {
      name: 'refund',
      description: 'Issue a refund',
      inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
      handler: async ({ amount }) => ({ refunded: amount })
    }
  ]
});

const port = Number(process.env.PORT || 8787);
server.listen(port, () => console.log(`AgentGate MCP Gateway listening on http://localhost:${port}/mcp`));
