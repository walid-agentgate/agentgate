import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

if (typeof WebSocket === 'undefined') throw new Error('Node WebSocket API unavailable');
const source=fs.readFileSync(new URL('../standalone.html', import.meta.url),'utf8');
const probe=`<script>
window.__AG_SMOKE__={status:'RUNNING',error:null};
window.addEventListener('load',async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms)); const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
 try{
  await wait(300);
  assert(document.body.innerText.includes('SECURITY') && document.body.innerText.includes('SCORE'),'Overview security score missing');
  assert(document.querySelector('#attackBtn'),'Overview Attack Lab button missing');
  document.querySelector('[data-tab="Attack Lab"]').click(); await wait(250); assert(document.querySelector('#runAttack'),'Attack Lab controls missing');
  document.querySelector('[data-tab="Policies"]').click(); await wait(250); assert(document.querySelector('#newPolicy'),'Policy create control missing'); assert(document.body.innerText.includes('Create Draft') && document.body.innerText.includes('Activate'),'Policy lifecycle missing');
  document.querySelector('[data-tab="Monitor"]').click(); await wait(250); assert(document.querySelector('#approvals'),'Runtime approval panel missing');
  document.querySelector('[data-tab="Replay"]').click(); await wait(250); assert(document.querySelector('#replayCard'),'Replay panel missing');
  document.querySelector('[data-tab="Behavior"]').click(); await wait(250); assert(document.querySelector('#behaviorCard'),'Behavior panel missing');
  document.querySelector('[data-tab="Blast Radius"]').click(); await wait(250); assert(document.querySelector('#blastCard'),'Blast Radius panel missing');
  document.querySelector('[data-tab="Observability"]').click(); await wait(250); assert(document.querySelector('#obsStats'),'Observability panel missing');
  document.querySelector('[data-tab="Cost Control"]').click(); await wait(250); assert(document.querySelector('#costStats'),'Cost Control panel missing');
  window.__AG_SMOKE__.status='PASS';
 }catch(e){window.__AG_SMOKE__.status='FAIL';window.__AG_SMOKE__.error=e.message}
});
</script>`;
const pageHtml=source.replace('</body>',probe+'</body>');
const pickPort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));})});
const chromePort=await pickPort();
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'agentgate-chrome-smoke-'));
const chrome=spawn('chromium',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${chromePort}`,`--user-data-dir=${dataDir}`,'about:blank'],{stdio:['ignore','pipe','pipe']});
await new Promise(async resolve=>{for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${chromePort}/json/version`)).ok)return resolve()}catch{} await new Promise(r=>setTimeout(r,100))}resolve()});
const tabs=await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json(); const page=tabs.find(x=>x.type==='page'); if(!page) throw new Error('Chrome page target unavailable');
const ws=new WebSocket(page.webSocketDebuggerUrl); let seq=0; const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}};
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,m=>m.error?reject(new Error(m.error.message)):resolve(m.result));ws.send(JSON.stringify({id,method,params}))});
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Runtime.evaluate',{expression:`document.open();document.write(${JSON.stringify(pageHtml)});document.close();`}); await new Promise(r=>setTimeout(r,4200));
const result=await cdp('Runtime.evaluate',{expression:'JSON.stringify({smoke:window.__AG_SMOKE__||null,href:location.href,ready:document.readyState,overview:typeof window.overview,body:document.body?.innerText?.slice(0,500),content:document.querySelector("#content")?.innerHTML?.slice(0,300)})',returnByValue:true});
const state=JSON.parse(result.result.value); const smoke=state.smoke||{status:'FAIL',error:`probe missing: ${state.href}`}; ws.close(); chrome.kill('SIGTERM'); await new Promise(resolve=>chrome.once('close',resolve)); fs.rmSync(dataDir,{recursive:true,force:true});
if(smoke.status!=='PASS') throw new Error(`Browser UI smoke failed: ${smoke.error||smoke.status} state=${JSON.stringify(state)}`);
console.log('release-browser-smoke: PASS');
