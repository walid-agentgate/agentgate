import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { evaluate } from './policy-engine.js';

export const POLICY_STATES = Object.freeze({ DRAFT:'draft', TESTED:'tested', ACTIVE:'active', ARCHIVED:'archived' });

const clone = (v) => structuredClone(v ?? {});
const digest = (v) => crypto.createHash('sha256').update(JSON.stringify(v, Object.keys(v).sort())).digest('hex').slice(0,16);

export class PolicyRegistry {
  constructor(options = {}) {
    this.filePath = path.resolve(options.filePath || '.agentgate/policies.json');
    this.limit = options.limit || 500;
    this.items = this.#load();
    this.audit = this.#loadAudit();
  }
  #load() { try { const x=JSON.parse(fs.readFileSync(this.filePath,'utf8')); return Array.isArray(x)?x:[]; } catch { return []; } }
  #loadAudit() { try { const p=this.filePath.replace(/\.json$/,'-audit.json'); const x=JSON.parse(fs.readFileSync(p,'utf8')); return Array.isArray(x)?x:[]; } catch { return []; } }
  #save() { fs.mkdirSync(path.dirname(this.filePath),{recursive:true}); const t=this.filePath+'.tmp'; fs.writeFileSync(t,JSON.stringify(this.items,null,2)); fs.renameSync(t,this.filePath); const ap=this.filePath.replace(/\.json$/,'-audit.json'); fs.writeFileSync(ap,JSON.stringify(this.audit.slice(0,2000),null,2)); }
  #versions(name, tenantId = null) { return this.items.filter(x=>x.name===name && (tenantId == null ? !x.tenantId : x.tenantId === tenantId)).sort((a,b)=>b.version-a.version); }
  create(name, policy={}, metadata={}, tenantId = null) {
    if (!name || typeof name!=='string') throw new TypeError('Policy name is required');
    const versions=this.#versions(name, tenantId); const version=(versions[0]?.version||0)+1;
    const item={id:`pol_${name.toLowerCase().replace(/[^a-z0-9]+/g,'_')}_v${version}`,name,version,state:POLICY_STATES.DRAFT,policy:clone(policy),metadata:clone(metadata),tenantId: tenantId || null,hash:digest(policy),createdAt:new Date().toISOString()};
    this.items.unshift(item); this.#audit('create',item); this.#save(); return clone(item);
  }
  get(name, version, tenantId = null) { return clone(this.#versions(name, tenantId).find(x=>version==null||x.version===Number(version))||null); }
  list(name, tenantId = null) { return this.#versions(name, tenantId).map(clone); }
  active(name, tenantId = null) { return clone(this.#versions(name, tenantId).find(x=>x.state===POLICY_STATES.ACTIVE)||null); }
  activeAll(tenantId = null) { return this.items.filter(x => x.state === POLICY_STATES.ACTIVE && (tenantId == null ? !x.tenantId : x.tenantId === tenantId)).map(clone); }
  updateDraft(name, version, policy, metadata, tenantId = null) {
    const item=this.#versions(name, tenantId).find(x=>x.version===Number(version));
    if(!item) return null; if(item.state!==POLICY_STATES.DRAFT) throw new Error('Only draft policies can be updated');
    item.policy=clone(policy); if(metadata) item.metadata=clone(metadata); item.hash=digest(policy); item.updatedAt=new Date().toISOString(); this.#audit('update',item); this.#save(); return clone(item);
  }
  test(name, version, cases=[], tenantId = null) {
    const item=this.#versions(name, tenantId).find(x=>x.version===Number(version)); if(!item) throw new Error('Policy version not found');
    const results=cases.map((c)=>{const r=evaluate(c.input||c.request||{},item.policy); return {name:c.name||c.id||'case',expected:c.expected,actual:r.decision,passed:c.expected?c.expected===r.decision:true,reason:r.reason,risk:r.risk};});
    const passed=results.every(r=>r.passed); if(passed && item.state===POLICY_STATES.DRAFT) item.state=POLICY_STATES.TESTED; item.lastTest={at:new Date().toISOString(),passed,results}; this.#audit('test',item,{passed}); this.#save(); return clone(item.lastTest);
  }
  activate(name, version, tenantId = null) {
    const target=this.#versions(name, tenantId).find(x=>x.version===Number(version)); if(!target) throw new Error('Policy version not found');
    if(target.state!==POLICY_STATES.TESTED && target.state!==POLICY_STATES.ACTIVE) throw new Error('Policy must pass tests before activation');
    for(const x of this.#versions(name, tenantId)) if(x.state===POLICY_STATES.ACTIVE) x.state=POLICY_STATES.ARCHIVED;
    target.state=POLICY_STATES.ACTIVE; target.activatedAt=new Date().toISOString(); this.#audit('activate',target); this.#save(); return clone(target);
  }
  rollback(name, version, tenantId = null) { return this.activate(name,version,tenantId); }
  diff(name, a, b, tenantId = null) {
    const left=this.get(name,a,tenantId)?.policy||{}, right=this.get(name,b,tenantId)?.policy||{}; const keys=new Set([...Object.keys(left),...Object.keys(right)]); const changes=[];
    for(const key of [...keys].sort()) if(JSON.stringify(left[key])!==JSON.stringify(right[key])) changes.push({key,from:clone(left[key]),to:clone(right[key])});
    return {name,from:Number(a),to:Number(b),tenantId:tenantId || null,changes};
  }
  auditLog(name, tenantId = null) { return this.audit.filter(x=>(!name||x.name===name) && (tenantId == null ? !x.tenantId : x.tenantId === tenantId)).map(clone); }
  #audit(action,item,extra={}) { this.audit.unshift({id:`pa_${crypto.randomUUID()}`,at:new Date().toISOString(),action,name:item.name,tenantId:item.tenantId || null,version:item.version,state:item.state,hash:item.hash,...extra}); }
}

export function createPolicyRegistry(options={}) { return new PolicyRegistry(options); }
