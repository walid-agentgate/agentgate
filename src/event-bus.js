import { EventEmitter } from 'node:events';
export const RUNTIME_EVENTS = Object.freeze({
  RUN_RECORDED:'run.recorded', RUN_DECIDED:'run.decided', APPROVAL_CREATED:'approval.created', APPROVAL_RESOLVED:'approval.resolved', POLICY_ACTIVATED:'policy.activated', WEBHOOK_DELIVERED:'webhook.delivered'
});
export class RuntimeEventBus extends EventEmitter {
  publish(event, payload={}) { const message={id:cryptoRandom(),event,payload,timestamp:new Date().toISOString()}; this.emit(event,message); this.emit('*',message); return message; }
  subscribe(event, handler){ this.on(event,handler); return ()=>this.off(event,handler); }
}
function cryptoRandom(){ return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`; }
export const createEventBus=(options={})=>new RuntimeEventBus(options);
