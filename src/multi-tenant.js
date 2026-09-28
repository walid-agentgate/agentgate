import crypto from 'node:crypto';
import { PersistentCollectionStore } from './persistent-store.js';
import { createWebhookDispatcher, validateWebhookTarget } from './webhook-delivery.js';

export const DEFAULT_SCOPES = Object.freeze(['runs:read','approvals:read','approvals:resolve','agents:read','agents:write','policies:read','policies:write','webhooks:read','webhooks:write','admin:*']);
const allows = (granted, needed) => granted.includes('admin:*') || granted.includes(needed) || granted.includes(needed.split(':')[0]+':*');

export class TenantRegistry {
  constructor(options={}) { this.tenants = options.tenantStore || new PersistentCollectionStore(options.filePath || '.agentgate/tenants.json',{limit: options.limit||1000}); this.keys = options.keyStore || new PersistentCollectionStore(options.keyPath || '.agentgate/api-keys.json',{limit: options.keyLimit||5000}); }
  create(name, metadata={}) { const id=`ten_${crypto.randomBytes(8).toString('hex')}`; const tenant={id,name:String(name),metadata,createdAt:new Date().toISOString()}; return this.tenants.add(tenant); }
  get(id){ return this.tenants.get(id); }
  list(){ return this.tenants.list(); }
  issueKey(tenantId, options={}) { if(!this.get(tenantId)) throw new Error('Tenant not found'); const secret=crypto.randomBytes(24).toString('base64url'); const prefix='ag_'+crypto.randomBytes(5).toString('hex'); const key=`${prefix}.${secret}`; const hash=crypto.createHash('sha256').update(key).digest('hex'); const rec={id:`key_${crypto.randomBytes(8).toString('hex')}`,tenantId,prefix,hash,scopes:options.scopes?.filter(s=>DEFAULT_SCOPES.includes(s)||s.endsWith(':*'))||['runs:read'],createdAt:new Date().toISOString(),expiresAt:options.expiresAt||null,revokedAt:null}; this.keys.add(rec); return {...rec,secret:key}; }
  authenticate(secret){ const hash=crypto.createHash('sha256').update(String(secret||'')).digest('hex'); const rec=this.keys.list(k=>k.hash===hash)[0]; if(!rec || rec.revokedAt || (rec.expiresAt && Date.parse(rec.expiresAt)<=Date.now())) return null; return {...rec}; }
  revoke(id, tenantId = null){ const k=this.keys.get(id); if(!k || (tenantId && k.tenantId !== tenantId)) return null; k.revokedAt=new Date().toISOString(); this.keys.save(); return k; }
  rotate(id, options={}, tenantId = null) { const k=this.keys.get(id); if(!k || (tenantId && k.tenantId !== tenantId)) throw new Error('API key not found'); const next=this.issueKey(k.tenantId,{...options,scopes:options.scopes||k.scopes}); this.revoke(id, k.tenantId); return next; }
  listKeys(tenantId){ return this.keys.list(k=>k.tenantId===tenantId).map(({hash,...k})=>k); }
  authorize(auth, tenantId, scope){ if(!auth || auth.tenantId!==tenantId) return false; return allows(auth.scopes,scope); }
}

export class WebhookRegistry {
  constructor(options={}) { this.store=options.store||new PersistentCollectionStore(options.filePath||'.agentgate/webhooks.json',{limit:options.limit||1000}); this.deliveries=options.deliveryStore||new PersistentCollectionStore(options.deliveryPath||'.agentgate/webhook-deliveries.json',{limit:options.deliveryLimit||5000}); this.dispatcher=options.dispatcher||createWebhookDispatcher(options); }
  create(tenantId,input={}) { const item={id:`wh_${crypto.randomBytes(8).toString('hex')}`,tenantId,url:String(input.url||''),events:Array.isArray(input.events)&&input.events.length?input.events:['*'],active:input.active!==false,secret:input.secret||crypto.randomBytes(24).toString('hex'),createdAt:new Date().toISOString()}; if(!/^https?:\/\//.test(item.url)) throw new Error('Webhook URL must use http or https'); const host = (()=>{ try{return new URL(item.url).hostname;}catch{return '';} })(); if(['localhost','127.0.0.1','0.0.0.0','169.254.169.254'].includes(host) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|127\.)/.test(host)) throw new Error('Webhook target blocked: private or local address'); return this.store.add(item); }
  list(tenantId){ return this.store.list(w=>w.tenantId===tenantId).map(({secret,...w})=>w); }
  remove(id,tenantId){ const w=this.store.get(id); if(!w||w.tenantId!==tenantId) return null; w.active=false; this.store.save(); return w; }
  emit(tenantId,event,payload){ const hooks=this.store.list(w=>w.tenantId===tenantId&&w.active&&(w.events.includes('*')||w.events.includes(event))); return hooks.map(w=>{ const delivery={id:`whd_${crypto.randomBytes(8).toString('hex')}`,webhookId:w.id,tenantId,event,payload,status:'queued',attempts:0,createdAt:new Date().toISOString()}; this.deliveries.add(delivery); return delivery; }); }
  deliveriesFor(tenantId){ return this.deliveries.list(d=>d.tenantId===tenantId); }
  async deliver(deliveryId, tenantId){ const d=this.deliveries.get(deliveryId); if(!d || d.tenantId!==tenantId) return null; const w=this.store.get(d.webhookId); if(!w || w.tenantId!==tenantId || !w.active) return null; const result=await this.dispatcher(w,d); this.deliveries.update(d.id,{status:result.status,attempts:result.attempts,lastError:result.error||null,statusCode:result.statusCode||null,deliveredAt:result.status==='delivered'?new Date().toISOString():null}); return {...d,...result}; }
}
