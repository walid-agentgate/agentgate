/**
 * Curated, reviewable policy packs for common agent side-effect workflows.
 * Packs are deterministic data: they never grant authorization by themselves.
 */

const SUPPORT_REFUND_SAFETY = Object.freeze({
  id: 'support-refund-safety',
  name: 'Support Refund Safety Pack',
  version: '1.0.0',
  description: 'Conservative controls for customer-support agents that can issue refunds.',
  useCase: 'support-financial-operations',
  policies: Object.freeze({
    productionBlock: false,
    autoApproveAmount: 500,
    approvalAmount: 5000,
    blockActions: Object.freeze(['export_all'])
  }),
  cases: Object.freeze([
    { name: 'small refund', action: 'refund', amount: 250, environment: 'production', expected: 'ASK' },
    { name: 'review refund', action: 'refund', amount: 1200, environment: 'production', expected: 'ASK' },
    { name: 'ceiling refund', action: 'refund', amount: 5000, environment: 'production', expected: 'ASK' },
    { name: 'over-ceiling refund', action: 'refund', amount: 5000.01, environment: 'production', expected: 'BLOCK' },
    { name: 'invalid refund amount', action: 'refund', amount: '5000.01', environment: 'production', expected: 'BLOCK' },
    { name: 'production export', action: 'export_all', amount: 0, environment: 'production', expected: 'BLOCK' }
  ]),
  limitations: Object.freeze([
    'Does not prove an agent is safe or prevent every prompt-injection technique.',
    'Does not replace application authorization, IAM, network isolation, or provider controls.',
    'Review policy thresholds and tool semantics before production enforcement.'
  ])
});

const PRODUCTION_DEVOPS_SAFETY = Object.freeze({
  id: 'production-devops-safety',
  name: 'Production DevOps Safety Pack',
  version: '1.0.0',
  description: 'Conservative controls for agents that can change or delete production infrastructure.',
  useCase: 'devops-it-operations',
  policies: Object.freeze({
    productionBlock: true,
    requireApprovalForDestructive: true,
    blockActions: Object.freeze(['update_production', 'delete', 'deploy'])
  }),
  cases: Object.freeze([
    { name: 'read production', action: 'read', environment: 'production', expected: 'ALLOW' },
    { name: 'production delete', action: 'delete', environment: 'production', expected: 'BLOCK' },
    { name: 'production config', action: 'update_production', environment: 'production', expected: 'BLOCK' },
    { name: 'production deploy', action: 'deploy', environment: 'production', expected: 'BLOCK' },
    { name: 'export everything', action: 'export_all', environment: 'production', expected: 'BLOCK' }
  ]),
  limitations: Object.freeze([
    'Does not replace cloud IAM, deployment approvals, change management, or infrastructure isolation.',
    'Review action names and production detection against the actual tool contract.',
    'This pack is intentionally conservative and may require explicit exceptions.'
  ])
});

const CUSTOMER_DATA_EXPORT_SAFETY = Object.freeze({
  id: 'customer-data-export-safety',
  name: 'Customer Data Export Safety Pack',
  version: '1.0.0',
  description: 'Conservative controls for CRM/data agents handling exports and bulk customer changes.',
  useCase: 'crm-customer-data',
  policies: Object.freeze({
    productionBlock: false,
    requireApprovalForDestructive: true,
    blockActions: Object.freeze(['export_all', 'bulk_update'])
  }),
  cases: Object.freeze([
    { name: 'search customer', action: 'search', environment: 'production', expected: 'ALLOW' },
    { name: 'export all customers', action: 'export_all', environment: 'production', expected: 'BLOCK' },
    { name: 'bulk customer update', action: 'bulk_update', environment: 'production', expected: 'BLOCK' },
    { name: 'delete customer', action: 'delete', environment: 'production', expected: 'ASK' }
  ]),
  limitations: Object.freeze([
    'Does not establish legal compliance or automatically satisfy privacy requirements.',
    'Tenant and identity authorization should be configured separately.',
    'Review data classification and destination controls before enforcement.'
  ])
});

const PACKS = Object.freeze({
  [SUPPORT_REFUND_SAFETY.id]: SUPPORT_REFUND_SAFETY,
  [PRODUCTION_DEVOPS_SAFETY.id]: PRODUCTION_DEVOPS_SAFETY,
  [CUSTOMER_DATA_EXPORT_SAFETY.id]: CUSTOMER_DATA_EXPORT_SAFETY
});

export function listPolicyPacks() {
  return Object.values(PACKS).map(pack => ({
    id: pack.id,
    name: pack.name,
    version: pack.version,
    useCase: pack.useCase,
    description: pack.description
  }));
}

export function getPolicyPack(id = '') {
  const pack = PACKS[String(id).trim().toLowerCase()];
  if (!pack) return null;
  return clonePack(pack);
}

export function getDefaultPolicyPack() {
  return clonePack(SUPPORT_REFUND_SAFETY);
}

function clonePack(pack) {
  return {
    ...pack,
    policies: { ...pack.policies, ...(pack.policies.approvalActions ? { approvalActions: [...pack.policies.approvalActions] } : {}), ...(pack.policies.blockActions ? { blockActions: [...pack.policies.blockActions] } : {}) },
    cases: pack.cases.map(item => ({ ...item })),
    limitations: [...pack.limitations]
  };
}
