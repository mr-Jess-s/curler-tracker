import sys,time,json,os
from pathlib import Path
sys.path.insert(0,r'C:\Temp\ct-selenium')
from selenium import webdriver
from selenium.webdriver.edge.options import Options
from selenium.webdriver.edge.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
ROOT=Path(__file__).resolve().parents[1]
BASE_URL=os.environ.get('CT_BASE_URL','http://127.0.0.1:8766').rstrip('/')
OUT=ROOT/'qa'
OUT.mkdir(exist_ok=True)
opts=Options()
opts.add_argument('--headless=new')
opts.add_argument('--disable-gpu')
opts.add_argument('--window-size=390,844')
opts.binary_location=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
service=Service(r'C:\Users\mrjes\.cache\selenium\msedgedriver\win64\153.0.4234.48\msedgedriver.exe')
driver=webdriver.Edge(service=service,options=opts)
driver.set_script_timeout(90)
checks=[]
passed=False
def check(condition,name):
 assert condition,name
 checks.append(name)
 print('PASS '+name,flush=True)
try:
 driver.get(BASE_URL+'/')
 WebDriverWait(driver,20).until(lambda d:len(d.find_elements(By.CSS_SELECTOR,'.event-link'))>0)
 WebDriverWait(driver,20).until(lambda d:d.execute_script("return document.readyState==='complete'&&document.querySelector('.brand-mark')?.getBoundingClientRect().width>0"))
 check(driver.execute_script("return document.querySelector('.brand-mark')?.getBoundingClientRect().width>0"),'Brand mark visible on homepage')
 check(driver.find_element(By.ID,'seasonSelect').get_attribute('value')=='2025 / 2026','Last full season shown by default')
 check(len(driver.find_elements(By.CSS_SELECTOR,'.event-link'))>=8,'Historical events visible before search')
 check(len(driver.find_elements(By.CSS_SELECTOR,'.curler-chip'))>=6,'Example careers visible before search')
 check(not driver.find_element(By.ID,'trackerResults').is_displayed(),'Empty live panels stay hidden before search')
 driver.get(BASE_URL+'/?player=Sophie%20Abbs')
 WebDriverWait(driver,90).until(lambda d:d.execute_script("return typeof state!=='undefined'&&!state.isRunning&&!!state.snapshot?.sourceCurlerId"))
 check(driver.find_element(By.ID,'trackedPlayer').text=='Sophie Abbs','Live-source player lookup')
 check(driver.execute_script("return state.snapshot.sourceCurlerId")==49287,'Stable source identity')
 driver.find_element(By.ID,'careerLoadBtn').click()
 WebDriverWait(driver,30).until(lambda d:d.execute_script('return !state.careerLoading'))
 check(len(driver.find_elements(By.CSS_SELECTOR,'.career-item'))>=3,'Sourced historical appearances load')
 check(all(a.get_attribute('href').startswith('https://ab.curling.io/') for a in driver.find_elements(By.CSS_SELECTOR,'.career-source')),'Official source links')
 for width,height in [(390,844),(320,740),(1365,900)]:
  driver.set_window_size(width,height)
  check(driver.execute_script('return document.documentElement.scrollWidth<=window.innerWidth'),f'No horizontal overflow at {width}px')
  driver.execute_script("window.scrollTo(0,0)")
  driver.save_screenshot(str(OUT/f'top-{width}.png'))
  driver.execute_script("document.getElementById('careerPath').scrollIntoView({block:'start'})")
  driver.save_screenshot(str(OUT/f'career-{width}.png'))
 driver.find_element(By.ID,'feedbackBtn').click()
 check(driver.find_element(By.ID,'feedbackDialog').get_attribute('open') is not None,'Feedback dialog opens')
 driver.find_element(By.ID,'feedbackCopyBtn').click()
 check('add your feedback' in driver.find_element(By.ID,'feedbackStatus').text,'Empty feedback validation')
 driver.find_element(By.ID,'feedbackText').send_keys('QA only: name correction needs source review')
 driver.find_element(By.ID,'feedbackSource').send_keys('https://ab.curling.io/en/events/24023')
 driver.execute_script("document.getElementById('feedbackType').value='identity-or-name-update';document.getElementById('feedbackRelationship').value='self'")
 packet=driver.execute_script('return buildFeedbackPacket()')
 check(packet['app_version']=='v26.5' and packet['supporting_source'].endswith('/24023'),'Feedback version and evidence retained')
 check(packet['submitter_relationship']=='self','Declared contributor relationship retained')
 driver.find_element(By.ID,'feedbackCloseBtn').click()
 check(driver.find_element(By.ID,'feedbackDialog').get_attribute('open') is None,'Feedback dialog closes')
 # Missing index plus failed source requests must yield an explicit error in real DOM.
 driver.execute_script("window.originalHistory=discoverCareerHistory;discoverCareerHistory=async()=>{throw new Error('QA offline')}")
 driver.find_element(By.ID,'careerLoadBtn').click()
 WebDriverWait(driver,10).until(lambda d:not d.execute_script('return state.careerLoading'))
 check('could not be fully checked' in driver.find_element(By.ID,'careerStatus').text,'History failure remains visible')
 check(len(driver.find_elements(By.CSS_SELECTOR,'.career-item'))>=3,'Previously loaded history retained on failure')
 driver.execute_script('discoverCareerHistory=window.originalHistory')
 # Empty result message must survive final render.
 driver.execute_script('discoverCareerHistory=async()=>[]')
 driver.find_element(By.ID,'careerLoadBtn').click()
 WebDriverWait(driver,10).until(lambda d:not d.execute_script('return state.careerLoading'))
 check('No additional sourced records' in driver.find_element(By.ID,'careerStatus').text,'Empty history message remains visible')
 driver.execute_script('discoverCareerHistory=window.originalHistory')
 driver.find_element(By.ID,'careerLoadBtn').click()
 WebDriverWait(driver,10).until(lambda d:not d.execute_script('return state.careerLoading'))
 driver.refresh()
 WebDriverWait(driver,30).until(lambda d:d.execute_script("return typeof APP_VERSION!=='undefined'&&APP_VERSION==='v26.5'"))
 check(driver.execute_script("return APP_VERSION")=='v26.5','Updated release survives reload')
 driver.execute_async_script("const done=arguments[0];navigator.serviceWorker.ready.then(async()=>done(await caches.keys())).catch(()=>done([]))")
 check('curler-tracker-v26-5' in driver.execute_async_script('const done=arguments[0];caches.keys().then(done)'),'Current service-worker cache installed')
 passed=True
 print('BROWSER_QA_PASS '+str(len(checks)),flush=True)
finally:
 (OUT/'browser-results.json').write_text(json.dumps({'passed':passed,'checks_passed':checks,'browser':'Edge 153 headless','mobile':'viewport emulation, not physical iOS/Android','checked_at':time.strftime('%Y-%m-%dT%H:%M:%S%z')},indent=2))
 driver.quit()
