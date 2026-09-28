import { evaluate } from './policy-engine.js';

export function createMiddleware(options = {}) {
  const policies = options.policies || {};
  const onDecision = options.onDecision || (() => {});
  return async function agentgateMiddleware(request, next) {
    const result = evaluate(request, policies);
    onDecision({ request, result });
    if (result.decision === 'BLOCK') {
      return { decision: 'BLOCK', result };
    }
    if (result.decision === 'ASK') {
      return { decision: 'ASK', result };
    }
    return { decision: 'ALLOW', result, value: await next(request) };
  };
}
