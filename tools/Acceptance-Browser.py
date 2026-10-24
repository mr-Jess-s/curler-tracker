"""Rendered-browser UAT. Fault injection affects this isolated browser only."""
import sys,time,json,os,datetime
from pathlib import Path
sys.path.insert(0,os.environ.get('CT_SELENIUM_PATH',r'C:\Temp\ct-selenium'))
from selenium import webdriver
from selenium.webdriver.edge.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('CT_BASE_URL','http://127.0.0.1:8768').rstrip('/')
OUT=Path(os.environ.get('CT_EVIDENCE_DIR', str(ROOT/'release-evidence'/os.environ.get('CT_EVIDENCE_DATE','2026-10-16'))));OUT.mkdir(parents=True,exist_ok=True)
opts=Options();opts.add_argument('--headless=new');opts.add_argument('--window-size=390,844');opts.binary_location=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
d=webdriver.Edge(options=opts);d.set_script_timeout(120)
checks=[];metrics=[]
def check(name,condition,detail=None):
    row={'name':name,'status':'PASS' if condition else 'FAIL','timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'detail':detail};checks.append(row);print(json.dumps(row),flush=True)
def wait(js,seconds=25):return WebDriverWait(d,seconds).until(lambda _:d.execute_script('return '+js))
def js(code):return d.execute_script(code)
try:
    started=time.perf_counter();d.get(BASE+'/');wait("document.querySelectorAll('.curler-chip').length>=6")
    # Allow the first service-worker activation reload to settle before timing interactions.
    time.sleep(2);wait("document.querySelectorAll('.curler-chip').length>=6")
    check('first_visit_archive',d.find_element(By.ID,'archiveHome').is_displayed())
    check('homepage_brand',d.find_element(By.TAG_NAME,'h1').text=='Curler Tracker')
    metrics.append({'name':'first_visit_archive_ms','value':round((time.perf_counter()-started)*1000),'includes_service_worker_settle_ms':2000})
    for w,h in [(320,740),(390,844),(1365,900)]:
        d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':w,'height':h,'deviceScaleFactor':1,'mobile':w<600});check('viewport_exact_width_'+str(w),js('return innerWidth')==w);check('viewport_no_overflow_'+str(w),js('return document.documentElement.scrollWidth<=innerWidth'))
        d.save_screenshot(str(OUT/f'homepage-{w}.png'))
    d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
    d.find_element(By.ID,'currentSeasonBtn').click();check('season_switch_current',d.find_element(By.ID,'seasonSelect').get_attribute('value')=='2026 / 2027')
    js("document.querySelector('#seasonSelect').value='2025 / 2026';document.querySelector('#seasonSelect').dispatchEvent(new Event('change'))")
    check('season_switch_history',len(d.find_elements(By.CSS_SELECTOR,'.event-link'))>=8)
    check('event_facts_have_no_source_or_association_links',js("return [...document.querySelectorAll('.event-link')].every(a=>a.tagName==='ARTICLE'&&!a.querySelector('a[href]')) && ![...document.querySelectorAll('.event-link')].some(a=>a.textContent.includes('curling.io'))"))
    check('privacy_link',len(d.find_elements(By.CSS_SELECTOR,'a[href="./privacy.html"]'))==1)
    js("document.getElementById('trackerResults').classList.remove('hidden');localStorage.removeItem(APP.localKeys.teams);state.followedTeams=[];renderTeamWatchlist();state.snapshot={playerName:'QA Curler One',view:'upcoming',teamName:'Team One',teamId:7001,sourceSubdomain:'canada',eventName:'QA Event',teamMembers:[{curlerId:'1',name:'QA Curler One',position:'skip'},{curlerId:'2',name:'QA Teammate One',position:'third'}]};renderCurrentTeam(state.snapshot)")
    check('current_team_members_visible','QA Curler One' in d.find_element(By.ID,'currentTeamMembers').text and 'QA Teammate One' in d.find_element(By.ID,'currentTeamMembers').text)
    check('team_roster_mobile_no_overflow',js('return document.documentElement.scrollWidth<=innerWidth'))
    d.find_element(By.ID,'addCurrentTeamBtn').click()
    check('add_team_to_watchlist',len(d.find_elements(By.CSS_SELECTOR,'.team-watch-card'))==1 and 'Team One' in d.find_element(By.ID,'teamWatchlist').text)
    js("state.snapshot={playerName:'QA Curler Two',view:'upcoming',teamName:'Team Two',teamId:7002,sourceSubdomain:'canada',eventName:'QA Event',teamMembers:[{curlerId:'3',name:'QA Curler Two',position:'skip'},{curlerId:'4',name:'QA Teammate Two',position:'third'}]};renderCurrentTeam(state.snapshot)")
    d.find_element(By.ID,'addCurrentTeamBtn').click()
    check('multiple_teams_saved',len(d.find_elements(By.CSS_SELECTOR,'.team-watch-card'))==2 and 'QA Teammate Two' in d.find_element(By.ID,'teamWatchlist').text)
    check('team_watchlist_persisted_locally',js("return JSON.parse(localStorage.getItem(APP.localKeys.teams)).teams.length===2"))
    d.find_elements(By.CSS_SELECTOR,'.team-remove-btn')[0].click()
    check('remove_team_from_watchlist',len(d.find_elements(By.CSS_SELECTOR,'.team-watch-card'))==1)
    d.find_elements(By.CSS_SELECTOR,'.team-remove-btn')[0].click()
    check('watchlist_hides_when_empty',d.find_element(By.ID,'teamWatchlist').get_attribute('class').find('hidden')>=0)
    js("resolveAndStart('Ferrol Asham','uat-unverified')");wait('!state.isRunning',90)
    spelling=js("return {name:state.snapshot?.playerName,sourceId:state.snapshot?.sourceCurlerId,suggestions:[...document.querySelectorAll('#identityChoices .identity-choice')].map(node=>node.textContent)}")
    check('unverified_spelling_not_merged_or_misdirected',spelling['name']=='Ferrol Asham' and spelling['sourceId'] is None and not spelling['suggestions'])
    # Consolidated records, with bounded waits; verification metadata stays internal.
    for name in ['Farrol Asham','Jody Sutherland','Adam Flatt']:
        if name=='Adam Flatt':
            js('resolveAndStart('+json.dumps(name)+',"uat-real")')
            wait("state.playerName==='Adam Flatt' && state.selectedProfile?.source_curler_id==='162112'",5)
            grouped=js("return {scopes:state.selectedProfile?.source_subdomains||[],choices:document.querySelectorAll('#identityChoices .identity-choice').length}")
            check('Adam_Flatt_same_identity_profiles_grouped',set(grouped['scopes'])=={'mb','canada'} and grouped['choices']==0,grouped)
            start=time.perf_counter()
        else:
            start=time.perf_counter()
            js('resolveAndStart('+json.dumps(name)+',"uat-real")')
        wait("!document.getElementById('searchProgress').classList.contains('hidden') && document.getElementById('playerForm').getAttribute('aria-busy')==='true'",3)
        progress=round((time.perf_counter()-start)*1000);check(name+'_progress_under_500ms',progress<500,progress)
        check(name+'_stale_result_cleared',js('return state.snapshot?.playerName==='+json.dumps(name)),js("return {name:state.snapshot?.playerName,view:state.snapshot?.view}"))
        try:
            wait("state.snapshot?.playerName==="+json.dumps(name)+" && ['archived-team','documented-history','recent-event','live','upcoming','idle-event'].includes(state.snapshot?.view)",90)
            useful=round((time.perf_counter()-start)*1000)
            wait('!state.isRunning',100)
            result=js("return {name:state.snapshot?.playerName,view:state.snapshot?.view,status:document.querySelector('#statusLine').textContent,records:state.snapshot?.careerHistory?.length||0,source:state.snapshot?.sourceSubdomain,sourceId:state.snapshot?.sourceCurlerId}")
            check(name+'_sourced_result',result['name']==name and result['view'] not in ['error','idle'],result)
            metrics.append({'name':name,'progress_ms':progress,'first_useful_result_ms':useful,'completed_ms':round((time.perf_counter()-start)*1000)})
            if name=='Farrol Asham':
                check('Farrol_exact_published_source_identity',result['name']=='Farrol Asham' and result['source']=='mb' and str(result['sourceId'])=='18594')
                check('Farrol_source_qualified_archive',result['records']>=1 and result['view'] in ['archived-team','recent-event','live','upcoming'])
                d.save_screenshot(str(OUT/'farrol-result.png'))
        except Exception as e:check(name+'_sourced_result',False,str(e))
    # Save implementations before isolated failure/slow/race scenarios.
    js("window.uatOriginal={discovery:discoverPlayerEvents,recent:discoverMostRecentCompletedEvent,offline:findOfflineTeamSnapshot,docs:findDocumentedCurlingSnapshot};findOfflineTeamSnapshot=async()=>null;findDocumentedCurlingSnapshot=async()=>null;discoverMostRecentCompletedEvent=async()=>({candidates:[],checked:[],timedOut:false});discoverPlayerEvents=async()=>({candidates:[],checked:[],timedOut:false})")
    js("startTracking('Unverified UAT Name','uat-empty')");wait('!state.isRunning')
    check('empty_means_collections_checked', 'collections checked' in d.find_element(By.ID,'statusLine').text.lower())
    for label,message in [('rate_limit','HTTP 429'),('source_outage','HTTP 503'),('disconnected','Failed to fetch')]:
        js('discoverPlayerEvents=async()=>{throw new Error('+json.dumps(message)+')};startTracking('+json.dumps('UAT '+label)+',"uat-failure")');wait('!state.isRunning')
        check(label+'_explicit_incomplete',js("return state.snapshot.view==='error' && document.querySelector('#statusLine').textContent.includes('Search incomplete')"))
        check(label+'_progress_cleared',js("return document.querySelector('#searchProgress').classList.contains('hidden')"))
    js("window.uatResolves=[];discoverPlayerEvents=()=>new Promise(r=>uatResolves.push(r));startTracking('First UAT','uat-slow')")
    check('slow_search_announced',js("return document.querySelector('#searchProgress').getAttribute('role')==='status' && document.querySelector('#playerForm').getAttribute('aria-busy')==='true'"))
    js("startTracking('Second UAT','uat-switch');uatResolves[0]({candidates:[],checked:[],timedOut:false})")
    check('stale_search_isolation',js("return state.playerName==='Second UAT' && state.isRunning && document.querySelector('#searchProgressTitle').textContent.includes('Second UAT')"))
    js("uatResolves[1]({candidates:[],checked:[],timedOut:false})");wait('!state.isRunning')
    js("discoverPlayerEvents=uatOriginal.discovery;discoverMostRecentCompletedEvent=uatOriginal.recent;findOfflineTeamSnapshot=uatOriginal.offline;findDocumentedCurlingSnapshot=uatOriginal.docs;document.querySelector('#homeBtn').click()")
    check('return_to_archive',d.find_element(By.ID,'archiveHome').is_displayed())
    js("resolveAndStart('Jody Sutherland','uat-back')");wait("state.playerName==='Jody Sutherland'",10);wait('!state.isRunning',100)
    js("document.querySelector('#homeBtn').click()");d.back();wait("state.playerName==='Jody Sutherland'",60)
    check('browser_back_restores_curler',js("return state.playerName==='Jody Sutherland'"));js("document.querySelector('#homeBtn').click()")
    js("document.querySelector('#feedbackBtn').click()")
    check('feedback_dialog',d.find_element(By.ID,'feedbackDialog').get_attribute('open') is not None)
    js("document.querySelector('#feedbackCopyBtn').click()")
    check('feedback_empty_validation','add your feedback' in d.find_element(By.ID,'feedbackStatus').text)
    js("document.querySelector('#feedbackCloseBtn').click()")
    d.execute_cdp_cmd('Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
    check('reduced_motion',js("return matchMedia('(prefers-reduced-motion: reduce)').matches"))
    d.get(BASE+'/privacy.html');check('privacy_page_readable','Privacy, coverage' in d.find_element(By.TAG_NAME,'h1').text)
    d.back();wait("document.querySelector('#playerInput')!==null")
    check('browser_back_from_privacy',d.find_element(By.ID,'playerInput').is_displayed())
    d.execute_cdp_cmd('Network.enable',{})
    d.execute_cdp_cmd('Network.emulateNetworkConditions',{'offline':True,'latency':0,'downloadThroughput':0,'uploadThroughput':0})
    d.refresh();wait("document.querySelector('#playerInput')!==null")
    check('offline_application_shell',d.find_element(By.ID,'playerInput').is_displayed())
    d.execute_cdp_cmd('Network.emulateNetworkConditions',{'offline':False,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1})
    d.refresh();wait("document.querySelectorAll('.event-link').length>=8")
    check('network_recovery',len(d.find_elements(By.CSS_SELECTOR,'.event-link'))>=8)
except Exception as error:
    check('suite_completed',False,str(error))
finally:
    report={'url':BASE,'browser':d.capabilities.get('browserVersion'),'device':'Edge desktop with viewport emulation; not physical Safari','timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':checks,'metrics':metrics,'passed':sum(c['status']=='PASS' for c in checks),'failed':sum(c['status']=='FAIL' for c in checks)}
    (OUT/'acceptance-browser.json').write_text(json.dumps(report,indent=2),encoding='utf-8');d.quit();print(json.dumps({'passed':report['passed'],'failed':report['failed']}),flush=True)
raise SystemExit(1 if report['failed'] else 0)
