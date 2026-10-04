import { createRuntime } from './runtime.js';
import { createMCPGateway } from './mcp-gateway.js';
import { createMiddleware } from './middleware.js';
import { analyzeBehavior, analyzeBlastRadius } from './behavior.js';
import { authorize, normalizeIdentity } from './identity.js';

/**
 * Create a developer-facing AgentGate runtime.
 * The policy engine remains deterministic; this layer only connects agents/tools to it.
 */
export function createAgentGate(options = {}) {
  const runtime = options.runtime || createRuntime(options);
  const gateway = options.gateway || null;
  const defaultContext = {
    agent: options.agent,
    environment: options.environment || 'production'
  };

  async function check(request = {}) {
    return runtime.check({ ...defaultContext, ...request });
  }

  function identity(request = {}) { return normalizeIdentity({ ...defaultContext, ...request }); }
  function authorizeRequest(request = {}) { return authorize({ ...defaultContext, ...request }, (request.policies || options.policies || {}).authorization || options.authorization || {}); }

  async function execute(tool, request = {}) {
    return runtime.execute(tool, { ...defaultContext, ...request });
  }

  function protect(tool, config = {}) {
    if (typeof tool !== 'function') throw new TypeError('agentgate.protect() expects a function');
    const toolName = config.tool || config.name || tool.name || 'anonymous_tool';
    const action = config.action || toolName;
    const base = { ...defaultContext, ...config, tool: toolName, action };
    delete base.name;

    return async function protectedTool(input = {}, context = {}) {
      return execute(async (request) => tool(input, request), {
        ...base,
        ...context,
        input
      });
    };
  }

  function approve(approvalId) { return runtime.approve(approvalId); }
  function deny(approvalId, reason) { return runtime.deny(approvalId, reason); }
  function approvals(status) { return runtime.approvals(status); }
  function getApproval(approvalId) { return runtime.getApproval(approvalId); }

  function middleware(options = {}) {
    return createMiddleware({
      ...options,
      policies: options.policies || runtime.policies || {}
    });
  }

  function withMCP(mcpOptions = {}) {
    return createMCPGateway({
      ...options,
      ...mcpOptions,
      mode: mcpOptions.mode || options.mode || 'enforce',
      policies: mcpOptions.policies || options.policies || {}
    });
  }

  return Object.freeze({
    mode: options.mode || 'enforce',
    policies: Object.freeze({ ...(runtime.policies || options.policies || {}) }),
    check,
    execute,
    protect,
    middleware,
    withMCP,
    runs: runtime.runs,
    replay: runtime.replay,
    behavior: () => analyzeBehavior(runtime.runs()),
    blastRadius: () => analyzeBlastRadius(runtime.runs()),
    identity,
    authorize: authorizeRequest,
    approve,
    deny,
    approvals,
    getApproval
  });
}
