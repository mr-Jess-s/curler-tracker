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
    navigator:{},history:{replaceState(){},pushState(){}},
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
 const historyManifest=JSON.parse(fs.readFileSync(path.join(root,'data/history-manifest.json'),'utf8'));
 const worldIndex=JSON.parse(fs.readFileSync(path.join(root,'data/world-curler-index.json'),'utf8'));
 assert.match(html,/noble-beaver(?:-icon)?\.svg/); assert.match(html,/Explore recent seasons/);
 assert.match(html,/href="#main-content"/); assert.match(html,/id="main-content" tabindex="-1"/);
 assert.match(html,/id="currentSeasonBtn"/); assert(summary.seasons.some(row=>row.season==='2026 / 2027'&&row.events>0));
 assert.match(html,/role="search"/); assert.match(html,/aria-labelledby="feedback-title"/);
 const css=fs.readFileSync(path.join(root,"styles.css"),"utf8"); assert.match(css,/:focus-visible/); assert.match(css,/prefers-reduced-motion/);
 assert.equal(summary.default_season,'2025 / 2026');
 assert.match(summary.coverage_note,new RegExp(`${historyManifest.files.length} published Curling I/O roster indexes across ${summary.seasons.length} seasons`));
 assert.match(summary.coverage_note,new RegExp(`Results database index includes ${worldIndex.coverage.people_indexed} people`));
 assert.match(summary.coverage_note,/World Curling documents historical gaps/);
 assert.match(summary.coverage_note,/not a national club count/);
 assert.match(summary.coverage_note,/Missing history remains unknown/);
 assert(summary.seasons.some(row=>row.season==='2024 / 2025'&&row.events>100));
 assert(summary.featured_curlers.length>=6);
});
await check('Season archive facts show without association labels or outbound source links',async()=>{
 const a=app();
 a.run(`renderArchiveSeason({seasons:[{season:'2025 / 2026',events:1,curlers:1,appearances:4,recent_events:[{name:'Open Championship',association:'Canada',starts_on:'2025-03-01',source_url:'https://example.invalid/event'}]}]},'2025 / 2026')`);
 const html=a.elements.get('recentEvents').innerHTML;
 assert.match(html,/Open Championship/);assert.match(html,/2025-03-01/);
 assert.doesNotMatch(html,/<a\b|href=|Canada|example\.invalid/);
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
 await a.elements.get('careerLoadBtn').handlers.click();assert.match(a.elements.get('careerStatus').textContent,/No additional records/);
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
 assert.equal(a.run('state.snapshot.playerName'),'Second');
 assert.equal(a.run('(state.snapshot.careerHistory || []).length'),0);
});


await check('Published name changes stay linked only through the same scoped source ID',async()=>{
 const a=app();a.run("fetchJson=async()=>({schema_version:1,source_provider:'Curling I/O',source_subdomain:'ab',generated_at:new Date().toISOString(),curler_appearances:{7:[{event_id:1,team_id:2,published_name:'Former Name'},{event_id:3,team_id:4,published_name:'Current Name'}],8:[{event_id:5,team_id:6,published_name:'Former Name'}]}})");
 const rows=await a.run("discoverCareerHistory({sourceCurlerId:7,sourceSubdomain:'ab'})");
 assert.equal(rows.length,2);assert.deepEqual(Array.from(rows,r=>r.publishedName).sort(),['Current Name','Former Name']);
});
await check('Consolidated identity history retains each association source link',async()=>{
 const a=app();
 a.run(`fetchJson=async url=>{
  const sub=url.includes('canada.json')?'canada':url.includes('on.json')?'on':'mb';
  return {schema_version:1,source_provider:'Curling I/O',source_subdomain:sub,generated_at:new Date().toISOString(),curler_appearances:{1935:[{event_id:sub==='canada'?1:sub==='on'?2:3,team_id:1,event_name:sub+' event',team_name:sub,starts_on:'2025-01-01'}]}};
 }`);
 const rows=await a.run("discoverCareerHistory({sourceCurlerId:1935,sourceSubdomain:'canada',sourceSubdomains:['canada','on','mb']})");
 assert.equal(rows.length,3);assert.deepEqual(Array.from(rows,r=>r.sourceUrl).sort(),[
  'https://canada.curling.io/en/events/1','https://mb.curling.io/en/events/3','https://on.curling.io/en/events/2']);
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
 await a.run("runTracker({reason:'test'})");assert.equal(a.run('state.snapshot.view'),'error');assert.match(a.elements.get('statusLine').textContent,/search incomplete/i);
});
await check('Incomplete recent search cannot be reported as no history',async()=>{
 const a=app();a.run("state.playerName='First';discoverPlayerEvents=async()=>({candidates:[],checked:[],timedOut:false});discoverMostRecentCompletedEvent=async()=>({candidates:[],checked:[{error:'offline'}],timedOut:false})");
 await a.run("runTracker({reason:'test'})");assert.equal(a.run('state.snapshot.view'),'error');assert.match(a.elements.get('statusLine').textContent,/search incomplete/i);
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
await check('Mike McEwen source profiles with the same published ID consolidate into one person choice',async()=>{
 const a=app();
 const profiles=a.run(`consolidateSourceProfiles([
  {source_subdomain:'canada',source_curler_id:'1935',team_name:'Saskatchewan (McEwen)'},
  {source_subdomain:'on',source_curler_id:'1935',team_name:'M-Team McEwen'},
  {source_subdomain:'mb',source_curler_id:'1935',team_name:'Mike McEwen'}
 ])`);
 assert.equal(profiles.length,1);assert.equal(profiles[0].source_curler_id,'1935');
 assert.deepEqual(Array.from(profiles[0].source_subdomains),['canada','on','mb']);
 assert.doesNotMatch(a.run('profileLabel(globalThis.qaProfile = consolidateSourceProfiles([{source_subdomain:\'canada\',source_curler_id:\'1935\',team_name:\'Saskatchewan\',season:\'2025 / 2026\'},{source_subdomain:\'on\',source_curler_id:\'1935\'}])[0])'),/canada|ontario|\bon\b/i);
 const separate=a.run(`consolidateSourceProfiles([
  {source_subdomain:'ab',source_curler_id:'1'},
  {source_subdomain:'mb',source_curler_id:'2'}
 ])`);
 assert.equal(separate.length,2);
});
await check('Exact Mike McEwen preflight starts one consolidated identity choice',async()=>{
 const a=app();
 a.context.catalog={schema_version:1,source_provider:'Curling I/O',names:[{normalized:'mike mcewen',name:'Mike McEwen',profiles:[
  {source_subdomain:'canada',source_curler_id:'1935',team_name:'Saskatchewan (McEwen)'},
  {source_subdomain:'on',source_curler_id:'1935',team_name:'M-Team McEwen'},
  {source_subdomain:'mb',source_curler_id:'1935',team_name:'Mike McEwen'}
 ]}]};
 a.run("loadNameCatalogShard=async()=>catalog;globalThis.started='';startTracking=name=>{started=name}");
 await a.run("resolveAndStart('Mike McEwen','test')");
 assert.equal(a.context.started,'Mike McEwen');assert.equal(a.run('state.selectedProfile.source_curler_id'),'1935');
 assert.deepEqual(Array.from(a.run('state.selectedProfile.source_subdomains')),['canada','on','mb']);
 assert.equal(a.elements.get('identityChoices').classList.contains('hidden'),true);
});
await check('Career records display without source brands, association labels or outbound links',async()=>{
 const a=app();
 a.run("state.careerHistory=[{title:'Canadian Championship',detail:'Team: Example · 2025 / 2026',source:'Curling I/O · canada',sourceUrl:'https://canada.curling.io/en/events/1'}];renderCareerPath({playerName:'Example Curler',careerHistory:state.careerHistory,view:'archived-team',sourceCurlerId:1935,sourceSubdomain:'canada'})");
 const html=a.elements.get('careerPath').innerHTML;
 assert.match(html,/Canadian Championship/);assert.match(html,/Team: Example/);
 assert.doesNotMatch(html,/<a\b|href=|Curling I\/O|canada\.curling\.io/);
});
await check('Current team roster is listed and multiple teams can be saved and removed',async()=>{
 const a=app();
 a.run(`globalThis.teamOne={playerName:'Kerri Einarson',view:'upcoming',teamName:'Team Einarson',teamId:71,sourceSubdomain:'canada',eventName:'Championship',teamMembers:[
  {curler_id:11,name:'Kerri Einarson',position:'skip'},
  {curler_id:12,name:'Val Sweeting',position:'third'},
  {curler_id:13,name:'Shannon Birchard',position:'second'},
  {curler_id:14,name:'Gina Aitken',position:'lead'}
  ]};state.snapshot=teamOne;renderCurrentTeam(teamOne);`);
 assert.equal(a.elements.get('currentTeamCard').classList.contains('hidden'),false);
 assert.equal(a.elements.get('currentTeamTitle').textContent,'Current team');
 assert.match(a.elements.get('currentTeamMembers').innerHTML,/Kerri Einarson/);
 assert.match(a.elements.get('currentTeamMembers').innerHTML,/Val Sweeting/);
 assert.equal(a.run('addCurrentTeamToWatchlist()'),true);
 a.run(`globalThis.teamTwo={...teamOne,teamName:'Team Jones',teamId:72,playerName:'Rachel Homan',teamMembers:[{curler_id:21,name:'Rachel Homan',position:'skip'},{curler_id:22,name:'Tracy Fleury',position:'third'}]};state.snapshot=teamTwo;renderCurrentTeam(teamTwo);addCurrentTeamToWatchlist()`);
 assert.equal(a.run('state.followedTeams.length'),2);
 assert.match(a.elements.get('teamWatchlistItems').innerHTML,/Team Einarson/);
 assert.match(a.elements.get('teamWatchlistItems').innerHTML,/Team Jones/);
 assert.match(a.elements.get('teamWatchlistItems').innerHTML,/Tracy Fleury/);
 a.run("removeTeamFromWatchlist('canada:71')");assert.equal(a.run('state.followedTeams.length'),1);
 assert.doesNotMatch(a.elements.get('teamWatchlistItems').innerHTML,/Team Einarson/);
});
await check('Archived team records do not claim a current lineup that is missing',async()=>{
 const a=app();
 a.run("renderCurrentTeam({view:'archived-team',teamName:'Team Example',teamId:9,sourceSubdomain:'ab',teamMembers:[]})");
 assert.equal(a.elements.get('currentTeamTitle').textContent,'Last recorded team');
 assert.match(a.elements.get('currentTeamMembers').innerHTML,/does not include a team lineup/);
 assert.match(a.elements.get('currentTeamStatus').textContent,/does not confirm a current team/);
 assert.equal(a.elements.get('addCurrentTeamBtn').classList.contains('hidden'),true);
});
await check('Offline Mike McEwen fallback aggregates all retained source-linked tournaments',async()=>{
 const a=app();a.context.fixture={schema_version:1,source_provider:'Curling I/O',names:{'mike mcewen':[
  {name:'Mike McEwen',source_subdomain:'canada',source_curler_id:'1935',records:[{name:'Mike McEwen',team_name:'Saskatchewan',event_name:'Canada Event',event_id:'10',starts_on:'2025-01-01',source_subdomain:'canada',source_url:'https://canada.curling.io/en/events/10'}]},
  {name:'Mike McEwen',source_subdomain:'on',source_curler_id:'1935',records:[{name:'Mike McEwen',team_name:'Ontario',event_name:'Ontario Event',event_id:'20',starts_on:'2023-01-01',source_subdomain:'on',source_url:'https://on.curling.io/en/events/20'}]},
  {name:'Mike McEwen',source_subdomain:'mb',source_curler_id:'1935',records:[{name:'Mike McEwen',team_name:'Manitoba',event_name:'Manitoba Event',event_id:'30',starts_on:'2022-01-01',source_subdomain:'mb',source_url:'https://mb.curling.io/en/events/30'}]}
 ]}};
 a.run('fetchJson=async()=>fixture');
 const profile=a.run("consolidateSourceProfiles([{source_subdomain:'canada',source_curler_id:'1935'},{source_subdomain:'on',source_curler_id:'1935'},{source_subdomain:'mb',source_curler_id:'1935'}])[0]");
 a.context.selectedTestProfile=profile;
 const aggregated=await a.run("findOfflineTeamSnapshot('Mike McEwen',{phase:'error'},30000,globalThis.selectedTestProfile)");
 assert.equal(aggregated.sourceCurlerId,1935);assert.equal(aggregated.careerHistory.length,3);
 assert.deepEqual(Array.from(aggregated.careerHistory,r=>r.sourceUrl).sort(),[
  'https://canada.curling.io/en/events/10','https://mb.curling.io/en/events/30','https://on.curling.io/en/events/20']);
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
 assert.match(a.elements.get('statusLine').textContent,/search incomplete/i);
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
 assert(result.careerHistory.every(row=>/Farrol Asham/i.test(row.detail)));
 assert.equal(await a.run("findDocumentedCurlingSnapshot('No Published Person',{phase:'error'},30000)"),null);
});
await check('Source outage uses documentary history instead of unsupported no-record error',async()=>{
 const a=app();
 a.context.citedIndex=JSON.parse(fs.readFileSync(path.join(root,'data/curler-source-records.json'),'utf8'));
 a.run("state.playerName='Farrol Asham';discoverPlayerEvents=async()=>({candidates:[],checked:[{error:'offline'}],timedOut:false});findOfflineTeamSnapshot=async()=>null;fetchJson=async()=>citedIndex");
 await a.run("runTracker({reason:'test'})");
 assert.equal(a.run('state.snapshot.view'),'documented-history');
 assert.match(a.elements.get('statusLine').textContent,/historical records/);
 assert.doesNotMatch(a.elements.get('headlineBlock').innerHTML,/live game|last recorded team/i);
 assert.match(a.elements.get('careerPath').innerHTML,/Manitoba Curling Tour/);
 assert.match(a.elements.get('careerPath').innerHTML,/Farrol Asham/i);
 assert.doesNotMatch(a.elements.get('careerPath').innerHTML,/<a\b|href=|mancurltour\.ca|curlfortrouge\.ca/);
});
await check('Published Farrol spelling resolves exact documentary references without identity merging',async()=>{
 const a=app(); a.context.citedIndex=JSON.parse(fs.readFileSync(path.join(root,'data/curler-source-records.json'),'utf8'));
 a.run("fetchJson=async()=>citedIndex");
 const r=await a.run("findDocumentedCurlingSnapshot('Farrol Asham',{},30000)");
 assert.equal(r.displayPlayer,'Farrol Asham');assert.equal(r.view,'documented-history');assert.equal(r.careerHistory.length,2);
 assert.equal(r.sourceCurlerId,undefined);assert.equal(r.teamName,'');
});
await check('Distant lookalike is not suggested for an unverified spelling',async()=>{
 const a=app();
 a.context.qaCatalog=JSON.parse(fs.readFileSync(path.join(root,'data/name-catalog/first-g.json'),'utf8'));
 const choices=await a.run("findNameChoices(globalThis.qaCatalog,'Ferrol Asham')");
 assert(!choices.suggestions.some(row=>row.name==='Gerry Adam'));
});
await check('Published documentary-only names pass the local identity preflight',async()=>{
 const a=app();a.context.citedIndex=JSON.parse(fs.readFileSync(path.join(root,'data/curler-source-records.json'),'utf8'));
 a.run("globalThis.emptyCatalog={schema_version:1,source_provider:'Curling I/O',names:[]};loadNameCatalogShard=async()=>emptyCatalog;fetchJson=async url=>url.includes('curler-source-records')?citedIndex:emptyCatalog;globalThis.started='';startTracking=name=>{started=name}");
 await a.run("resolveAndStart('Farrol Asham','test')");
 assert.equal(a.context.started,'Farrol Asham');
});
await check('Unsafe imported source links cannot execute JavaScript',async()=>{
 const a=app();assert.equal(a.run("safeSourceUrl('javascript:alert(1)')"),'');assert.equal(a.run("safeSourceUrl('data:text/html,test')"),'');assert.equal(a.run("safeSourceUrl('https://ab.curling.io/en/events/24023')"),'https://ab.curling.io/en/events/24023');
});
await check('Partial names and ambiguous same-name teams never select an identity',async()=>{
 const a=app();a.run("globalThis.event={teams:[{id:1,name:'One',lineup:[{curler_id:1,name:'Farrol Asham'}]},{id:2,name:'Two',lineup:[{curler_id:2,name:'Jayden Asham'}]}]}");
 assert.equal(a.run("findMatchingTeam(event,'asham')"),null);
 assert.equal(a.run("findMatchingTeam(event,'farrol asham').curler.curler_id"),1);
 a.run("event.teams[1].lineup[0].name='Farrol Asham'");
 assert.equal(a.run("findMatchingTeam(event,'farrol asham')"),null);
});
await check('Unverified spelling variants cannot receive another published name’s documentary records',async()=>{
 const a=app();a.context.citedIndex=JSON.parse(fs.readFileSync(path.join(root,'data/curler-source-records.json'),'utf8'));
 a.run("fetchJson=async()=>citedIndex");
 assert.equal(await a.run("findDocumentedCurlingSnapshot('Ferrol Asham',{},30000)"),null);
});
await check('World Curling history resolves exact names to a stable source ID and source-linked facts',async()=>{
 const a=app();a.context.worldIndex={schema_version:1,source_provider:'World Curling',generated_at:'2026-10-24T00:00:00Z',coverage:{history_complete:false},people:{'486':{world_person_id:'486',person_url:'https://results.worldcurling.org/Person/Details/486',published_names:[{name:'Torger Nergård'}],associations:['Norway'],record_summaries:{IndividualGames:[{metrics:{Games:'428',Golds:'6'}}]},championships:[{championship_id:'702',championship_type:'Olympic Games',source_label:'2022-6',association_id:'10',association_names:['Norway'],source_url:'https://results.worldcurling.org/Championship/Details/702'}]}}};
 a.run('fetchJson=async()=>worldIndex');
 const result=await a.run("findWorldCurlingSnapshot('Torger Nergård',{phase:'test'},5000)");
 assert.equal(result.view,'world-archive');assert.equal(result.worldPersonId,'486');assert.equal(result.diagnostics.worldArchiveCoverageComplete,false);
 assert.equal(result.careerHistory.length,2);assert.match(result.careerHistory[0].detail,/Games: 428/);
 assert.equal(result.careerHistory[1].detail,'');
 assert.equal(result.careerHistory[1].sourceUrl,'https://results.worldcurling.org/Championship/Details/702');
 assert.equal(result.careerHistory[1].source,'');
 assert.doesNotMatch(a.elements.get('headlineBlock').innerHTML,/World Curling ID|World Curling Results/i);
});
await check('Missing release data cannot silently load unreviewed data from another branch',async()=>{
 const a=app();a.context.fetches=[];
 a.run("fetch=async url=>{fetches.push(url);return {ok:false,status:404}};");
 await assert.rejects(a.run("fetchJson('./data/curler-source-records.json?v=test')"),/HTTP 404/);
 assert.equal(a.context.fetches.length,1);
 assert.equal(a.context.fetches[0],'./data/curler-source-records.json?v=test');
});
await check('First-party source proxy requests remain CDN-cacheable',async()=>{
 const a=app();a.context.options=null;
 a.run("fetch=async(url,options)=>{globalThis.options=options;return {ok:true,json:async()=>({items:[]})}};");
 await a.run("fetchJson('/api/curling-io?kind=competitions&subdomain=ab&occurred=0')");
 assert.equal(a.context.options.cache,'default');
});
await check('Missing cached source degrades without visitor-side upstream traffic',async()=>{
 const a=app();a.context.fetches=[];
 a.run("fetch=async(url,options)=>{fetches.push({url,cache:options.cache});return {ok:false,status:404}};");
 await assert.rejects(a.run("fetchJson('/api/curling-io?kind=event&subdomain=ab&id=999999')"),/HTTP 404/);
 assert.equal(a.context.fetches.length,1);
 assert.equal(a.context.fetches[0].cache,'default');
 assert.match(a.context.fetches[0].url,/^\/api\/curling-io/);
});
await check('Name-index shards bound browser work and include keyboard-neighbor recovery',async()=>{
 const a=app();
 assert.deepEqual([...a.run("nameCatalogCandidateKeys('Olivia Stone')")].sort(),['i','k','l','o','p'].sort());
 assert.equal(a.run("catalogShardKey('  Émile Example')"),'e');
 a.context.fetches=[];
 a.run("fetchJson=async url=>{fetches.push(url);return {schema_version:1,source_provider:'Curling I/O',names:[]}}");
 await a.run("loadNameCatalogShard('first','o')");
 await a.run("loadNameCatalogShard('first','o')");
 assert.equal(a.context.fetches.length,1);
 assert.match(a.context.fetches[0],/data\/name-catalog\/first-o\.json/);
});
await check('Name-index preflight immediately exposes an accessible progress state',async()=>{
 const a=app();
 a.run("loadNameCatalogShard=()=>new Promise(resolve=>globalThis.finishCatalog=resolve);startTracking=name=>{globalThis.started=name}");
 const pending=a.run("resolveAndStart('Jody Sutherland','uat')");
 assert.equal(a.run('state.snapshot.playerName'),'Jody Sutherland');
 assert.equal(a.elements.get('searchProgress').classList.contains('hidden'),false);
 assert.equal(a.elements.get('playerForm').attributes['aria-busy'],'true');
 assert.match(a.elements.get('searchProgressTitle').textContent,/published name index/i);
 a.run("finishCatalog({names:[{normalized:'jody sutherland',name:'Jody Sutherland',profiles:[{source_subdomain:'ab',source_curler_id:'29219'}]}]})");
 await pending;assert.equal(a.run('started'),'Jody Sutherland');
});
console.log(count+' release regression checks passed.');
