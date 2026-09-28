import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const bin = path.join(root, 'bin', 'agentgate.js');
const pickPort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const waitFor = async (fn, timeout=10000) => {
  const end = Date.now()+timeout;
  while(Date.now()<end){ try { const v=await fn(); if(v) return v; } catch {} await new Promise(r=>setTimeout(r,100)); }
  throw new Error('Timed out waiting for condition');
};
const port = await pickPort();
const cp = spawn(process.execPath, [bin, 'dev', '--port', String(port)], {cwd:root, stdio:['ignore','pipe','pipe']});
let output=''; cp.stdout.on('data',d=>output+=d); cp.stderr.on('data',d=>output+=d);
try {
  let cookie='';
  await waitFor(async()=>{ const r=await fetch(`http://127.0.0.1:${port}/`); cookie=r.headers.get('set-cookie')?.split(';')[0]||''; return r.ok && Boolean(cookie); }, 12000);
  const api = await (await fetch(`http://127.0.0.1:${port}/api/attack-lab`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'})).json();
  if (api.summary?.status !== 'PROTECTED' || api.summary?.passed !== 5 || api.summary?.failed !== 0 || api.summary?.skipped !== 0) throw new Error(`dev API Attack Lab not 5/5: ${JSON.stringify(api.summary)}`);
  if (api.results.some(x => /Unknown tool/i.test(JSON.stringify(x.response)))) throw new Error('Unknown tool returned by dev Attack Lab');

  if (typeof WebSocket === 'undefined') throw new Error('Node WebSocket API unavailable');
  const chromePort = await pickPort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'agentgate-dev-chrome-'));
  const chrome = spawn('chromium',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${chromePort}`,`--user-data-dir=${dataDir}`,'about:blank'],{stdio:['ignore','pipe','pipe']});
  try {
    await waitFor(async()=>{ const r=await fetch(`http://127.0.0.1:${chromePort}/json/version`); return r.ok; },10000);
    const tabs=await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json(); const page=tabs.find(x=>x.type==='page');
    if(!page) throw new Error('Chrome page target unavailable');
    const ws=new WebSocket(page.webSocketDebuggerUrl); let seq=0; const pending=new Map();
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}};
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
    const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,m=>m.error?reject(new Error(m.error.message)):resolve(m.result));ws.send(JSON.stringify({id,method,params}))});
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Page.navigate',{url:`http://localhost:${port}/`});
    await new Promise(r=>setTimeout(r,4200));
    const gate=await cdp('Runtime.evaluate',{expression:'location.href.startsWith("chrome-error://") ? document.body.innerText : ""',returnByValue:true});
    const browserBlocked=/is blocked/i.test(gate.result?.value||'');
    if(browserBlocked){
      ws.close();
      console.log('dev-attack-browser-smoke: SKIPPED (Chromium environment blocks local HTTP)');
    } else {
      const expr=`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));if(!document.querySelector('[data-tab=\"Attack Lab\"]')){throw new Error('Attack Lab tab missing href='+location.href+' body='+document.body.innerText.slice(0,300)+' html='+document.documentElement.outerHTML.slice(0,500));}const tab=[...document.querySelectorAll('[data-tab]')].find(x=>x.dataset.tab==='Attack Lab');if(!tab)throw new Error('Attack Lab tab missing');tab.click();await wait(300);const btn=document.querySelector('#runAttack');if(!btn)throw new Error('RUN ATTACK LAB missing');btn.click();for(let i=0;i<80;i++){await wait(100);const s=document.querySelector('#attackSummary')?.textContent||'';const st=document.querySelector('#attackStatus')?.textContent||'';if(s.toLowerCase().includes('5/5 protected')&&st.toLowerCase().includes('protected'))return {summary:s,status:st,body:document.body.innerText};if(/Unknown tool/i.test(document.body.innerText))throw new Error('Unknown tool visible in browser Attack Lab');}throw new Error('Browser Attack Lab did not reach 5/5 protected')})()`;
      const result=await cdp('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'browser evaluation failed');
      if(!(result.result.value.summary||'').toLowerCase().includes('5/5 protected')) throw new Error(`Browser summary unexpected: ${JSON.stringify(result.result.value)}`);
      ws.close();
      console.log('dev-attack-browser-smoke: PASS');
    }
  } finally { chrome.kill('SIGTERM'); await new Promise(resolve=>chrome.once('close',resolve)); fs.rmSync(dataDir,{recursive:true,force:true}); }
} finally { cp.kill('SIGTERM'); await new Promise(resolve=>cp.once('close',resolve)); if(cp.exitCode && cp.exitCode!==0) console.error(output); }
