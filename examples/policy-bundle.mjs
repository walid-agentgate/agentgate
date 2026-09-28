import { createPolicyBundleRegistry } from 'agentgate-runtime-control';

const registry = createPolicyBundleRegistry({ filePath: '.agentgate/policy-bundles.json' });

const bundle = registry.create('support-production', {
  productionBlock: true,
  approvalActions: ['refund', 'delete'],
  autoApproveAmount: 500,
  approvalAmount: 5000
});

registry.test('support-production', bundle.version, [
  { input: { action: 'read', environment: 'production' }, expected: 'ALLOW' },
  { input: { action: 'refund', amount: 1200, environment: 'staging' }, expected: 'ASK' },
  { input: { action: 'delete', environment: 'production' }, expected: 'BLOCK' }
]);

console.log(registry.activate('support-production', bundle.version));
