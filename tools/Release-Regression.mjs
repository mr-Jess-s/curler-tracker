import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/bootFromSavedState\(\);\s*$/, '');
function app() {
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,handlers:{},
      classList:{add(){},remove(){},toggle(){}},addEventListener(name,fn){this.handlers[name]=fn;}});
    return elements.get(id);
  };
  const context=vm.createContext({console,URL,URLSearchParams,AbortController,Intl,Date,Map,Set,Promise,queueMicrotask,
    clearTimeout(){},setTimeout(){return 1;},fetch(){throw new Error('Unexpected network');},
    localStorage:{getItem(){return null;},setItem(){},removeItem(){}},
    navigator:{},history:{replaceState(){}},
    document:{getElementById:element,addEventListener(){}},
    window:{location:{search:'',href:'http://localhost/'},addEventListener(){},setTimeout(){return 1;},clearTimeout(){}}
  });
  vm.runInContext(source,context);
  return {run:code=>vm.runInContext(code,context),elements,context};
}
let count=0;
async function check(name, fn){await fn();console.log('PASS '+name);count++;}
await check('Indexed history keeps identity, source link and retrieval provenance', async()=>{
 const a=app(); a.context.index=JSON.parse(fs.readFileSync(path.join(root,'data/history/ab.json')));
 a.run("fetchJson=async()=>index");
 const rows=await a.run("discoverCareerHistory({sourceCurlerId:49287,sourceSubdomain:'ab'})");
 assert(rows.length>=3); assert(rows.every(r=>r.sourceUrl.startsWith('https://ab.curling.io/')&&r.retrievedAt&&r.publishedName));
});
await check('Wrong association index rejected; official fallback used',async()=>{
 const a=app();a.run("fetchJson=async url=>url.startsWith('./')?{schema_version:1,source_provider:'Curling I/O',source_subdomain:'mb',generated_at:new Date().toISOString(),curler_appearances:{49287:[{event_id:99,team_id:1}]}}:{items:[],seasons:[]}");
 const rows=await a.run("discoverCareerHistory({sourceCurlerId:49287,sourceSubdomain:'ab'})");assert.equal(rows.length,0);
});
await check('Failed history requests are not reported as an empty successful search',async()=>{
 const a=app(); a.run("fetchJson=async()=>{throw new Error('offline')}");
 await assert.rejects(a.run("discoverCareerHistory({sourceCurlerId:49287,sourceSubdomain:'ab'})"),/could not be checked/);
});
await check('Lineup row IDs cannot establish curler identity',async()=>{
 const a=app();a.run("fetchJson=async url=>{if(url.startsWith('./'))throw new Error('missing'); if(url.includes('competitions'))return {items:[{id:1,publish_results:true}],seasons:[]};return {id:1,teams:[{id:2,name:'team',lineup:[{id:49287,name:'Different person'}]}]};}");
 assert.equal((await a.run("discoverCareerHistory({sourceCurlerId:49287,sourceSubdomain:'ab'})")).length,0);
});
await check('Delayed history cannot overwrite another curler',async()=>{
 const a=app();a.run("state.snapshot={playerName:'First',sourceCurlerId:1,sourceSubdomain:'ab'};discoverCareerHistory=()=>new Promise(resolve=>globalThis.finish=resolve)");
 const pending=a.elements.get('careerLoadBtn').handlers.click();
 a.run("state.playerGeneration++;state.snapshot={playerName:'Second',sourceCurlerId:2,sourceSubdomain:'ab'};finish([{title:'First history'}])");
 await pending;assert.equal(a.run('state.snapshot.playerName'),'Second');assert.equal(a.run('state.careerHistory.length'),0);
});
await check('Failed history retains existing records and visible retry message',async()=>{
 const a=app();a.run("state.snapshot={playerName:'First',sourceCurlerId:1,sourceSubdomain:'ab',careerHistory:[{title:'Existing'}]};discoverCareerHistory=async()=>{throw new Error('offline')}");
 await a.elements.get('careerLoadBtn').handlers.click();
 assert.match(a.elements.get('careerStatus').textContent,/could not be fully checked/);assert.equal(a.run('state.snapshot.careerHistory.length'),1);
});
await check('Empty history message survives final render',async()=>{
 const a=app();a.run("state.snapshot={playerName:'First',sourceCurlerId:1,sourceSubdomain:'ab'};discoverCareerHistory=async()=>[]");
 await a.elements.get('careerLoadBtn').handlers.click();assert.match(a.elements.get('careerStatus').textContent,/No additional sourced records/);
});
await check('Delayed player discovery cannot relabel one athlete as another',async()=>{
 const a=app();a.run("state.playerName='First';discoverPlayerEvents=()=>new Promise(resolve=>globalThis.finish=resolve);");
 const pending=a.run("runTracker({reason:'test'})");
 a.run("state.playerGeneration++;state.playerName='Second';finish({candidates:[],checked:0})");
 await pending;assert.equal(a.run('state.snapshot'),null);
});
await check('Restricted browser storage does not prevent boot',async()=>{
 const a=app();a.run("localStorage.getItem=()=>{throw new Error('denied')};bootFromSavedState()");assert.equal(a.run('state.playerName'),'');
});
await check('Stale saved player is not rendered for a different shared link',async()=>{
 const a=app();a.run("window.location.search='?player=Second';loadSnapshot=()=>({playerName:'First',careerHistory:[{title:'Wrong'}]});startTracking=()=>{};bootFromSavedState()");
 assert.equal(a.run('state.snapshot'),null);
});


await check('Published name changes stay linked only through the same scoped source ID',async()=>{
 const a=app();a.run("fetchJson=async()=>({schema_version:1,source_provider:'Curling I/O',source_subdomain:'ab',generated_at:new Date().toISOString(),curler_appearances:{7:[{event_id:1,team_id:2,published_name:'Former Name'},{event_id:3,team_id:4,published_name:'Current Name'}],8:[{event_id:5,team_id:6,published_name:'Former Name'}]}})");
 const rows=await a.run("discoverCareerHistory({sourceCurlerId:7,sourceSubdomain:'ab'})");
 assert.equal(rows.length,2);assert.deepEqual(Array.from(rows,r=>r.publishedName).sort(),['Current Name','Former Name']);
});
await check('Conflicting roster entries are retained and visibly qualified',async()=>{
 const a=app();a.run("fetchJson=async()=>({schema_version:1,source_provider:'Curling I/O',source_subdomain:'ab',generated_at:new Date().toISOString(),curler_appearances:{7:[{event_id:1,team_id:2,position:'first'},{event_id:1,team_id:2,position:'second'}]}})");
 const rows=await a.run("discoverCareerHistory({sourceCurlerId:7,sourceSubdomain:'ab'})");
 assert.equal(rows.length,2);assert(rows.every(r=>r.detail.includes('Multiple source roster entries')));
});
await check('Missing scores stay unknown rather than zero',async()=>{
 const a=app();assert.equal(a.run('getPositionScore({})'),null);assert.equal(a.run('displayScore(null)'),'\u2014');assert.equal(a.run("getPositionScore({score:0})"),0);
});
function serviceWorker(network) {
 const handlers={};let writes=0;
 const cache={async match(url){return url==='./index.html'?new Response('<html>App</html>'):undefined;},async put(){writes++;}};
 const context=vm.createContext({URL,Response,fetch:network,caches:{async open(){return cache;}},self:{location:{origin:'https://test.local'},addEventListener(name,fn){handlers[name]=fn;}}});
 vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),context);
 return {async request(mode){let pending;handlers.fetch({request:{method:'GET',url:'https://test.local/data/history/missing.json',mode},respondWith(p){pending=p;}});return pending;},writes:()=>writes};
}
await check('Offline JSON requests never receive cached HTML',async()=>{
 const sw=serviceWorker(async()=>{throw new Error('offline')});assert.equal((await sw.request('cors')).status,503);
});
await check('Offline navigation can use the cached application shell',async()=>{
 const sw=serviceWorker(async()=>{throw new Error('offline')});assert.match(await(await sw.request('navigate')).text(),/App/);
});
await check('Failed responses cannot poison the app cache',async()=>{
 const sw=serviceWorker(async()=>new Response('Unavailable',{status:503}));assert.equal((await sw.request('cors')).status,503);assert.equal(sw.writes(),0);
});
await check('Incomplete current-source search produces an explicit issue state',async()=>{
 const a=app();a.run("state.playerName='First';discoverPlayerEvents=async()=>({candidates:[],checked:[{error:'offline'}],timedOut:false})");
 await a.run("runTracker({reason:'test'})");assert.equal(a.run('state.snapshot.view'),'error');assert.match(a.elements.get('statusLine').textContent,/could not refresh/i);
});
await check('Incomplete recent search cannot be reported as no history',async()=>{
 const a=app();a.run("state.playerName='First';discoverPlayerEvents=async()=>({candidates:[],checked:[],timedOut:false});discoverMostRecentCompletedEvent=async()=>({candidates:[],checked:[{error:'offline'}],timedOut:false})");
 await a.run("runTracker({reason:'test'})");assert.equal(a.run('state.snapshot.view'),'error');assert.match(a.elements.get('statusLine').textContent,/could not refresh/i);
});
console.log(count+' release regression checks passed.');
