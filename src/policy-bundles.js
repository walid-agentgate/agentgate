import crypto from 'node:crypto';
import { PersistentCollectionStore } from './persistent-store.js';
import { evaluate } from './policy-engine.js';
export const BUNDLE_STATES=Object.freeze({DRAFT:'draft',TESTED:'tested',ACTIVE:'active',ARCHIVED:'archived'});
export class PolicyBundleRegistry {
  constructor(options={}){ this.store=options.store||new PersistentCollectionStore(options.filePath||'.agentgate/policy-bundles.json',{limit:options.limit||2000}); }
  create(name,policies={},metadata={},tenantId=null){ const versions=this.store.list(x=>x.name===name && (tenantId==null ? !x.tenantId : x.tenantId===tenantId)); const version=(Math.max(0,...versions.map(x=>x.version||0))+1); const item={id:`bundle_${crypto.randomBytes(8).toString('hex')}`,name,version,state:BUNDLE_STATES.DRAFT,tenantId:tenantId||null,policies:{...policies},metadata,hash:hash(policies),createdAt:new Date().toISOString()}; return this.store.add(item); }
  list(name,tenantId=null){ return this.store.list(x=>(!name||x.name===name) && (tenantId==null ? !x.tenantId : x.tenantId===tenantId)); }
  get(name,version,tenantId=null){ return this.store.list(x=>x.name===name&&x.version===Number(version) && (tenantId==null ? !x.tenantId : x.tenantId===tenantId))[0]||null; }
  test(name,version,cases=[],tenantId=null){ const b=this.get(name,version,tenantId); if(!b) throw new Error('Policy bundle not found'); const results=cases.map(c=>{const r=evaluate(c.input||{},b.policies); return {...c,actual:r.decision,passed:r.decision===c.expected};}); const passed=results.every(x=>x.passed); if(passed){b.state=BUNDLE_STATES.TESTED;b.testedAt=new Date().toISOString();b.testResults=results;this.store.save();} return {passed,results}; }
  activate(name,version,tenantId=null){ const b=this.get(name,version,tenantId); if(!b) throw new Error('Policy bundle not found'); if(b.state!==BUNDLE_STATES.TESTED&&b.state!==BUNDLE_STATES.ACTIVE) throw new Error('Bundle must pass tests before activation'); for(const x of this.store.list(i=>i.name===name&&i.state===BUNDLE_STATES.ACTIVE && (tenantId==null ? !i.tenantId : i.tenantId===tenantId))){x.state=BUNDLE_STATES.ARCHIVED;} b.state=BUNDLE_STATES.ACTIVE;b.activatedAt=new Date().toISOString();this.store.save();return b; }
  active(name,tenantId=null){ return this.store.list(x=>x.name===name&&x.state===BUNDLE_STATES.ACTIVE && (tenantId==null ? !x.tenantId : x.tenantId===tenantId))[0]||null; }
  activeAll(tenantId=null){ return this.store.list(x=>x.state===BUNDLE_STATES.ACTIVE && (tenantId==null ? !x.tenantId : x.tenantId===tenantId)); }
  diff(name,a,b,tenantId=null){const x=this.get(name,a,tenantId),y=this.get(name,b,tenantId);if(!x||!y)throw new Error('Policy bundle version not found');const keys=new Set([...Object.keys(x.policies),...Object.keys(y.policies)]);return [...keys].filter(k=>JSON.stringify(x.policies[k])!==JSON.stringify(y.policies[k])).map(k=>({key:k,from:x.policies[k],to:y.policies[k]}));}
}
function hash(v){return crypto.createHash('sha256').update(JSON.stringify(v,Object.keys(v).sort())).digest('hex');}
export const createPolicyBundleRegistry=o=>new PolicyBundleRegistry(o);
