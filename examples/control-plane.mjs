import fs from 'node:fs/promises';
import { createControlPlane } from '../src/control-plane.js';
import { createMCPGateway } from '../src/mcp-gateway.js';

const html = await fs.readFile(new URL('../standalone.html', import.meta.url), 'utf8');
const gateway = createMCPGateway({
  mode: 'enforce',
  policies: { productionBlock: true },
  tools: [
    { name: 'read', handler: async (args) => ({ ok: true, data: args }) },
    { name: 'refund', handler: async (args) => ({ refunded: args.amount }) },
    { name: 'delete', handler: async (args) => ({ deleted: args.id }) }
  ]
});
const { server } = createControlPlane({ gateway, html });
const port = Number(process.env.PORT || 8787);
server.listen(port, () => console.log(`AgentGate Control Plane: http://localhost:${port}`));
