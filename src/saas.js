import crypto from 'node:crypto';
import { PersistentCollectionStore } from './persistent-store.js';

export const PLANS = Object.freeze({
  free: Object.freeze({ name:'free', tenants:1, members:2, agents:3, runsPerMonth:1000, apiKeys:3, webhooks:2 }),
  pro: Object.freeze({ name:'pro', tenants:10, members:10, agents:50, runsPerMonth:100000, apiKeys:25, webhooks:25 }),
  enterprise: Object.freeze({ name:'enterprise', tenants:1000, members:1000, agents:10000, runsPerMonth:10000000, apiKeys:5000, webhooks:1000 })
});

const ROLES = new Set(['owner','admin','developer','viewer','billing']);
const id = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const now = () => new Date().toISOString();

export class OrganizationRegistry {
  constructor(options={}) {
    const base = options.persistence || '.agentgate';
    this.orgs = options.orgStore || new PersistentCollectionStore(options.filePath || `${base}/organizations.json`, {limit: options.limit||10000});
    this.members = options.memberStore || new PersistentCollectionStore(options.memberPath || `${base}/organization-members.json`, {limit: options.memberLimit||50000});
    this.tenants = options.tenantStore || new PersistentCollectionStore(options.tenantPath || `${base}/organization-tenants.json`, {limit: options.tenantLimit||10000});
  }
  create(name, owner={}) {
    const org={id:id('org'),name:String(name||'').trim(),plan:'free',status:'active',createdAt:now(),metadata:owner.metadata||{}};
    if(!org.name) throw new Error('Organization name is required');
    this.orgs.add(org);
    this.addMember(org.id, owner.userId || owner.email || 'owner', 'owner', owner);
    return org;
  }
  get(orgId){ return this.orgs.get(orgId); }
  list(){ return this.orgs.list(); }
  setPlan(orgId, plan){ if(!PLANS[plan]) throw new Error('Unknown plan'); const o=this.get(orgId); if(!o) throw new Error('Organization not found'); o.plan=plan; o.updatedAt=now(); this.orgs.save(); return o; }
  addMember(orgId,userId,role='developer',metadata={}) { if(!this.get(orgId)) throw new Error('Organization not found'); if(!ROLES.has(role)) throw new Error('Invalid member role'); const existing=this.members.list(m=>m.orgId===orgId&&m.userId===String(userId))[0]; if(existing){existing.role=role; existing.updatedAt=now(); this.members.save(); return existing;} const m={id:id('mem'),orgId,userId:String(userId),role,metadata,createdAt:now()}; return this.members.add(m); }
  removeMember(orgId,userId){ const m=this.members.list(x=>x.orgId===orgId&&x.userId===String(userId))[0]; if(!m) return null; this.members.remove?.(m.id); if(!this.members.remove){m.revokedAt=now(); this.members.save();} return m; }
  membersFor(orgId){ return this.members.list(m=>m.orgId===orgId); }
  authorize(orgId,userId,action){ const m=this.membersFor(orgId).find(x=>x.userId===String(userId)); if(!m) return {allowed:false,reason:'Member not found'}; if(action==='billing' && !['owner','billing'].includes(m.role)) return {allowed:false,reason:'Billing permission required'}; if(['admin','members:write'].includes(action) && !['owner','admin'].includes(m.role)) return {allowed:false,reason:'Admin permission required'}; return {allowed:true,role:m.role}; }
  linkTenant(orgId,tenantId){ if(!this.get(orgId)) throw new Error('Organization not found'); if(this.tenants.list(x=>x.orgId===orgId&&x.tenantId===tenantId)[0]) return this.tenants.list(x=>x.orgId===orgId&&x.tenantId===tenantId)[0]; const t={id:id('ot'),orgId,tenantId,createdAt:now()}; return this.tenants.add(t); }
  tenantsFor(orgId){ return this.tenants.list(x=>x.orgId===orgId); }
}

export class UsageMeter {
  constructor(options={}) { this.store=options.store||new PersistentCollectionStore(options.filePath||'.agentgate/usage.json',{limit:options.limit||100000}); }
  period(date=new Date()){ return date.toISOString().slice(0,7); }
  get(orgId,metric='runs',period=this.period()){ return this.store.list(x=>x.orgId===orgId&&x.metric===metric&&x.period===period)[0] || {orgId,metric,period,quantity:0}; }
  increment(orgId,metric='runs',quantity=1,period=this.period()){ const n=Number(quantity); if(!Number.isFinite(n)||n<0) throw new Error('Quantity must be a non-negative number'); let row=this.get(orgId,metric,period); if(!row.id){ row={...row,id:id('usage'),quantity:0,updatedAt:now()}; this.store.add(row); } row.quantity += n; row.updatedAt=now(); this.store.save(); return row; }
  snapshot(orgId,period=this.period()){ return this.store.list(x=>x.orgId===orgId&&x.period===period); }
}

export class EntitlementService {
  constructor({organizations,usage}={}) { this.organizations=organizations||new OrganizationRegistry(); this.usageMeter=usage||new UsageMeter(); }
  plan(orgId){ const o=this.organizations.get(orgId); if(!o) throw new Error('Organization not found'); return PLANS[o.plan]||PLANS.free; }
  usage(orgId,metric='runs'){ return this.usageMeter.get(orgId,metric); }
  check(orgId,metric='runs',additional=1){ const p=this.plan(orgId), u=this.usage(orgId,metric).quantity||0; const limit=p[`${metric}PerMonth`] ?? p[metric]; return {allowed: limit===undefined || u+additional<=limit,metric,used:u,requested:additional,limit,plan:p.name}; }
  consume(orgId,metric='runs',quantity=1){ const check=this.check(orgId,metric,quantity); if(!check.allowed){ const e=new Error(`Plan limit exceeded for ${metric}`); e.code='AGENTGATE_QUOTA_EXCEEDED'; e.entitlement=check; throw e; } return this.usageMeter.increment(orgId,metric,quantity); }
}

export class BillingAdapter {
  constructor(options={}) { this.provider=options.provider||'none'; this.checkout=options.checkout|| (async ({orgId,plan})=>({provider:this.provider,orgId,plan,status:'not_configured'})); this.portal=options.portal|| (async ({orgId})=>({provider:this.provider,orgId,status:'not_configured'})); }
  async createCheckout(input){ return this.checkout(input); }
  async customerPortal(input){ return this.portal(input); }
}

export function createSaaSControl(options={}) {
  const organizations=options.organizations||new OrganizationRegistry(options);
  const usage=options.usage||new UsageMeter(options);
  const entitlements=options.entitlements||new EntitlementService({organizations,usage});
  const billing=options.billing||new BillingAdapter(options);
  return {organizations,usage,entitlements,billing};
}
