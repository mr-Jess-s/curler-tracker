"""Isolated rendered interaction tests; sharing and downloads never leave this browser."""
import datetime as dt
import json
import os
from pathlib import Path
import sys
import time
sys.path.insert(0, os.environ.get('CT_SELENIUM_PATH', r'C:\Temp\curler-qa-20261016'))
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

root = Path(__file__).resolve().parents[1]
out = root / 'release-evidence/2026-10-16'
out.mkdir(parents=True, exist_ok=True)
base = os.environ['CT_BASE_URL'].rstrip('/')
browser_name = os.environ.get('CT_BROWSER', 'edge')
if browser_name == 'chrome':
    from selenium.webdriver.chrome.options import Options
else:
    from selenium.webdriver.edge.options import Options
options = Options()
options.add_argument('--headless=new')
options.binary_location = (r'C:\Program Files\Google\Chrome\Application\chrome.exe' if browser_name == 'chrome'
                           else r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')
d = webdriver.Chrome(options=options) if browser_name == 'chrome' else webdriver.Edge(options=options)
d.set_script_timeout(40)
rows = []
def js(code): return d.execute_script(code)
def wait(expression, seconds=30): return WebDriverWait(d, seconds).until(lambda _: js('return ' + expression))
def check(name, passed, detail=None):
    rows.append({'name': name, 'status': 'PASS' if passed else 'FAIL', 'detail': detail})
    print(json.dumps(rows[-1]), flush=True)
try:
    d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
    d.get(base)
    wait("document.querySelectorAll('.curler-chip').length>=6")
    time.sleep(2)
    # Keyboard operation uses WebDriver key input, not just DOM clicks.
    field = d.find_element(By.ID, 'playerInput')
    field.click()
    field.send_keys('Farrol Asham')
    field.send_keys(Keys.ENTER)
    wait("state.playerName==='Farrol Asham'")
    check('keyboard_search_submission', js("return state.playerName==='Farrol Asham'"))
    wait("state.snapshot?.view==='documented-history'")
    # Capture native share invocation without messaging anybody.
    js("Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.capturedShare=data}});document.querySelector('#shareBtn').click()")
    wait('window.capturedShare!==undefined')
    share = js('return capturedShare')
    check('share_curler_url', 'player=Farrol+Asham' in share['url'] or 'player=Farrol%20Asham' in share['url'], share)
    js("document.querySelector('#feedbackBtn').click()")
    check('dialog_focus_inside', js("return document.querySelector('#feedbackDialog').contains(document.activeElement)"))
    js("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.capturedCopy=text}}});document.querySelector('#feedbackText').value='Isolated QA feedback; not submitted';document.querySelector('#feedbackCopyBtn').click()")
    wait("document.querySelector('#feedbackStatus').textContent.includes('Nothing was sent')")
    check('feedback_copy_content_and_disclosure', js("return capturedCopy.includes('Isolated QA feedback; not submitted')"))
    js("window.downloadObserved=false;HTMLAnchorElement.prototype.click=function(){if(this.download&&this.href.startsWith('blob:'))window.downloadObserved=true};document.querySelector('#feedbackDownloadBtn').click()")
    check('feedback_download_generated', js("return downloadObserved && document.querySelector('#feedbackStatus').textContent.includes('Nothing was sent')"))
    d.find_element(By.ID, 'feedbackCloseBtn').send_keys(Keys.ENTER)
    wait("!document.querySelector('#feedbackDialog').open")
    check('dialog_keyboard_close', True)
    # Check explicitly computed text/background colours and retain the screenshot for manual review.
    js("document.querySelector('#feedbackBtn').click()")
    colours = js("const p=document.querySelector('.feedback-form .hint');return {foreground:getComputedStyle(p).color,background:getComputedStyle(p).backgroundColor}")
    def luminance(colour):
        values = [float(x.strip())/255 for x in colour[colour.index('(')+1:colour.index(')')].split(',')[:3]]
        values = [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values]
        return sum(v*w for v,w in zip(values,[.2126,.7152,.0722]))
    light, dark = sorted([luminance(colours['foreground']), luminance(colours['background'])], reverse=True)
    ratio = (light+.05)/(dark+.05)
    check('feedback_computed_contrast', ratio>=4.5, {'ratio': ratio, **colours})
    d.save_screenshot(str(out/'feedback-manual-review.png'))
    js("document.querySelector('#feedbackCloseBtn').click();document.querySelector('#homeBtn').click()")
    js("capturedShare=null;document.querySelector('#shareBtn').click()")
    wait('capturedShare!==null')
    check('share_website_no_stale_curler', 'player=' not in js('return capturedShare.url'))
    # Cache expiry uses only an isolated browser memory entry, never source records.
    js("writeTimedCache('isolated-qa','test',{fixture:true})")
    check('fresh_cache_hit', js("return readTimedCache('isolated-qa','test',1000)?.fixture===true"))
    js("memoryCache.get(cacheKey('isolated-qa','test')).savedAt=Date.now()-2000")
    check('expired_cache_miss', js("return readTimedCache('isolated-qa','test',1000)===null"))
    d.execute_cdp_cmd('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
    check('reduced_motion_spinner_stopped', js("return getComputedStyle(document.querySelector('.search-spinner')).animationName==='none'"))
    # A real page load under controlled slow networking. No source search is started.
    d.get(base + '/')
    js("document.querySelector('#homeBtn').click()")
    d.execute_cdp_cmd('Network.enable', {})
    d.execute_cdp_cmd('Network.setCacheDisabled', {'cacheDisabled': True})
    d.execute_cdp_cmd('Network.emulateNetworkConditions', {'offline':False,'latency':150,'downloadThroughput':200000,'uploadThroughput':100000})
    started = time.perf_counter()
    d.refresh()
    wait("document.querySelectorAll('.curler-chip').length>=6", 40)
    elapsed = round((time.perf_counter()-started)*1000)
    check('slow_network_archive_usable', elapsed<10000, {'milliseconds': elapsed, 'latency_ms':150, 'download_bytes_per_second':200000})
except Exception as error:
    check('suite_completed', False, str(error))
finally:
    report={'timestamp':dt.datetime.now(dt.timezone.utc).isoformat(),'url':base,'browser':d.capabilities.get('browserVersion'),'checks':rows,'passed':sum(r['status']=='PASS' for r in rows),'failed':sum(r['status']=='FAIL' for r in rows),'limitation':'Share/download mocked inside isolated browser; no messages sent. Edge mobile emulation is not physical Safari.'}
    (out/('extended-browser-chrome.json' if browser_name == 'chrome' else 'extended-browser.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'passed':report['passed'],'failed':report['failed']}),flush=True)
    d.quit()
