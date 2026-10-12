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
    if(!elements.has(id)) {
      const classes=new Set();
      elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,handlers:{},attributes:{},
        classList:{add(...names){names.forEach(n=>classes.add(n));},remove(...names){names.forEach(n=>classes.delete(n));},toggle(name,force){if(force===undefined)force=!classes.has(name);if(force)classes.add(name);else classes.delete(name);},contains(name){return classes.has(name);}},
        setAttribute(name,value){this.attributes[name]=String(value);},removeAttribute(name){delete this.attributes[name];},
        addEventListener(name,fn){this.handlers[name]=fn;}});
    }
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
await check('Homepage has visible branding and a useful historical default', async()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const summary=JSON.parse(fs.readFileSync(path.join(root,'data/home-summary.json'),'utf8'));
 assert.match(html,/noble-beaver(?:-icon)?\.svg/); assert.match(html,/Explore recent seasons/);
 assert.match(html,/href="#main-content"/); assert.match(html,/id="main-content" tabindex="-1"/);
 assert.match(html,/id="currentSeasonBtn"/); assert(summary.seasons.some(row=>row.season==='2026 / 2027'&&row.events>0));
 assert.match(html,/role="search"/); assert.match(html,/aria-labelledby="feedback-title"/);
 const css=fs.readFileSync(path.join(root,"styles.css"),"utf8"); assert.match(css,/:focus-visible/); assert.match(css,/prefers-reduced-motion/);
 assert.equal(summary.default_season,'2025 / 2026');
 assert(summary.seasons.some(row=>row.season==='2024 / 2025'&&row.events>100));
 assert(summary.featured_curlers.length>=6);
});
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
await check('Refresh errors never become unsupported career records',async()=>{
 const a=app();a.run("render(computeErrorSnapshot('Ferrol Asham',{phase:'error'},30000,'source unavailable'))");
 assert.doesNotMatch(a.elements.get('careerPath').innerHTML,/Team not established|Temporary refresh issue/);
});
await check('Offline lookup returns a dated, explicitly archived team record',async()=>{
 const a=app();a.context.fixture={schema_version:1,source_provider:'Curling I/O',names:{'sophie abbs':[{name:'Sophie Abbs',source_subdomain:'ab',source_curler_id:'49287',records:[{name:'Sophie Abbs',team_name:'Abbs',event_name:'Test Bonspiel',event_id:'10',season:'2025 / 2026',position:'skip',source_subdomain:'ab',source_url:'https://ab.curling.io/en/events/10',retrieved_at:'2026-09-24T13:13:23.700240+00:00'}]}]}};
 a.run('fetchJson=async()=>fixture');
 const snapshot=await a.run("findOfflineTeamSnapshot('Sophie Abbs',{phase:'error'},30000)");
 assert.equal(snapshot.view,'archived-team');assert.equal(snapshot.teamName,'Abbs');assert.equal(snapshot.sourceCurlerId,49287);
 assert.match(snapshot.timelineHint,/not a current team confirmation/);assert.match(snapshot.scheduleHint,/last saved official roster record/);
});
await check('Ambiguous offline identities are not silently merged',async()=>{
 const a=app();a.context.fixture={schema_version:1,source_provider:'Curling I/O',names:{'same name':[{name:'Same Name',source_subdomain:'ab',source_curler_id:'1',records:[]},{name:'Same Name',source_subdomain:'mb',source_curler_id:'2',records:[]}]}};
 a.run('fetchJson=async()=>fixture');a.context.diagnostics={phase:'error'};const snapshot=await a.run("findOfflineTeamSnapshot('Same Name',diagnostics,30000)");
 assert.equal(snapshot,null);assert.equal(a.context.diagnostics.offlineLookup,'ambiguous-source-identities');
});
await check('Failed live search can fall back to an archived team record',async()=>{
 const a=app();a.run("state.playerName='Sophie Abbs';state.playerGeneration=1;discoverPlayerEvents=async()=>({candidates:[],checked:[{error:'offline'}],timedOut:false});findOfflineTeamSnapshot=async name=>({playerName:name,view:'archived-team',teamName:'Abbs',eventName:'Test Bonspiel',lastUpdatedAt:'2026-09-24T13:13:23.700240+00:00',careerHistory:[],scheduleRows:[],ends:[]})");
 await a.run("runTracker({reason:'test'})");assert.equal(a.run('state.snapshot.view'),'archived-team');assert.equal(a.run('state.snapshot.teamName'),'Abbs');
});
await check('No archived player match explains that club league rosters may be absent',async()=>{
 const a=app();a.run("state.playerName='Ferrol Asham';state.playerGeneration=1;discoverPlayerEvents=async()=>({candidates:[],checked:[{error:'offline'}],timedOut:false});findOfflineTeamSnapshot=async(name,diagnostics)=>{diagnostics.offlineLookup='no-exact-match';return null}");
 await a.run("runTracker({reason:'test'})");assert.equal(a.run('state.snapshot.view'),'error');
 assert.match(a.run('state.snapshot.errorHint'),/Club league rosters may not be published/);
 assert.doesNotMatch(a.elements.get('careerPath').innerHTML,/Team not established/);
});
await check('Search shows a prominent progress state and finishes with a distinct error',async()=>{
 const a=app();
 a.run("state.playerName='Slow Curler';discoverPlayerEvents=()=>new Promise(resolve=>globalThis.qaResolve=resolve);findOfflineTeamSnapshot=async()=>null");
 a.elements.get('searchProgress').classList.add('hidden');
 const pending=a.run("runTracker({reason:'qa-progress'})");
 assert.equal(a.elements.get('searchProgress').classList.contains('hidden'),false);
 assert.equal(a.elements.get('searchSubmitBtn').textContent,'Searching…');
 assert.equal(a.elements.get('searchProgressTitle').textContent,'Searching for Slow Curler');
 assert.match(a.elements.get('searchProgressDetail').textContent,/current-season/);
 assert.equal(a.elements.get('playerForm').attributes['aria-busy'],'true');
 a.run("qaResolve({candidates:[],checked:[{error:'simulated source failure'}],timedOut:false})");
 await pending;
 assert.equal(a.elements.get('searchProgress').classList.contains('hidden'),true);
 assert.equal(a.elements.get('searchSubmitBtn').textContent,'View curler');
 assert.equal(a.elements.get('playerForm').attributes['aria-busy'],undefined);
 assert.match(a.elements.get('statusLine').textContent,/could not refresh/i);
});
await check('Switching people starts a fresh search without stale progress overwrites',async()=>{
 const a=app();
 a.run("globalThis.qaResolves=[];discoverPlayerEvents=()=>new Promise(resolve=>qaResolves.push(resolve));findOfflineTeamSnapshot=async()=>null");
 a.run("startTracking('First Curler','manual-start')");
 assert.equal(a.run('state.isRunning'),true);
 assert.equal(a.run('qaResolves.length'),1);
 a.run("startTracking('Second Curler','manual-start')");
 assert.equal(a.run('qaResolves.length'),2);
 assert.equal(a.elements.get('searchProgressTitle').textContent,'Searching for Second Curler');
 a.run("qaResolves[0]({candidates:[],checked:[{error:'old failed'}],timedOut:false})");
 await Promise.resolve(); await Promise.resolve();
 assert.equal(a.run('state.isRunning'),true);
 assert.equal(a.elements.get('searchProgress').classList.contains('hidden'),false);
 assert.equal(a.run('state.playerName'),'Second Curler');
 a.run("qaResolves[1]({candidates:[],checked:[{error:'new failed'}],timedOut:false})");
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(a.run('state.isRunning'),false);
 assert.equal(a.elements.get('searchProgress').classList.contains('hidden'),true);
 assert.equal(a.run('state.snapshot.playerName'),'Second Curler');
});
await check('Source discovery stops scheduling new requests after its deadline',async()=>{
 const a=app();
 a.run("globalThis.qaStarted=[];globalThis.qaResolvers=[]");
 const pending=a.run("mapWithConcurrency([0,1,2,3,4,5],2,async i=>{qaStarted.push(i);await new Promise(resolve=>qaResolvers.push(resolve));return i},Date.now()+10)");
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(a.run("qaStarted.length"),2);
 a.run("qaResolvers.forEach(resolve=>resolve())");
 const results=await pending;
 assert.deepEqual(Array.from(results),[0,1]);
 assert.equal(a.run("qaStarted.length"),2);
});
await check('Independent first-party documents supply evidence without inventing a live team',async()=>{
 const a=app();
 a.context.citedIndex=JSON.parse(fs.readFileSync(path.join(root,'data/curler-source-records.json'),'utf8'));
 a.run("fetchJson=async()=>citedIndex");
 const result=await a.run("findDocumentedCurlingSnapshot('Farrol Asham',{phase:'error'},30000)");
 assert.equal(result.view,'documented-history');
 assert.equal(result.teamName,'');
 assert.equal(result.careerHistory.length,2);
 assert(result.careerHistory.every(row=>row.sourceUrl.startsWith('https://') && row.source));
 assert(result.careerHistory.some(row=>row.sourceUrl.includes('mancurltour.ca')));
 assert(result.careerHistory.some(row=>row.sourceUrl.includes('curlfortrouge.ca')));
 assert.equal(await a.run("findDocumentedCurlingSnapshot('No Published Person',{phase:'error'},30000)"),null);
});
await check('Source outage uses documentary history instead of unsupported no-record error',async()=>{
 const a=app();
 a.context.citedIndex=JSON.parse(fs.readFileSync(path.join(root,'data/curler-source-records.json'),'utf8'));
 a.run("state.playerName='Farrol Asham';discoverPlayerEvents=async()=>({candidates:[],checked:[{error:'offline'}],timedOut:false});findOfflineTeamSnapshot=async()=>null;fetchJson=async()=>citedIndex");
 await a.run("runTracker({reason:'test'})");
 assert.equal(a.run('state.snapshot.view'),'documented-history');
 assert.match(a.elements.get('statusLine').textContent,/cited curling references/);
 assert.doesNotMatch(a.elements.get('headlineBlock').innerHTML,/live game|last recorded team/i);
 assert.match(a.elements.get('careerPath').innerHTML,/Manitoba Curling Tour/);
});
console.log(count+' release regression checks passed.');
