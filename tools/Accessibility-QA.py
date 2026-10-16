"""Automated WCAG checks on rendered real archive content; not a conformance certificate."""
import datetime as dt
import json
import os
from pathlib import Path
import sys
import time
sys.path.insert(0, os.environ.get('CT_SELENIUM_PATH', r'C:\Temp\curler-qa-20261016'))
from selenium import webdriver
from selenium.webdriver.edge.options import Options
from selenium.webdriver.support.ui import WebDriverWait

root = Path(__file__).resolve().parents[1]
out = root / 'release-evidence' / '2026-10-16'
out.mkdir(parents=True, exist_ok=True)
base = os.environ.get('CT_BASE_URL', 'http://127.0.0.1:8780').rstrip('/')
axe = Path(os.environ.get('CT_AXE_PATH', r'C:\Temp\curler-a11y-20261016\node_modules\axe-core\axe.min.js')).read_text(encoding='utf-8')
options = Options()
options.add_argument('--headless=new')
options.binary_location = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
driver = webdriver.Edge(options=options)
driver.set_script_timeout(60)
results = []
try:
    driver.execute_cdp_cmd('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
    driver.get(base)
    WebDriverWait(driver, 30).until(lambda d: d.execute_script("return document.querySelectorAll('.curler-chip').length>=6"))
    time.sleep(2)
    for view in ['home', 'historical-record', 'feedback', 'privacy']:
        if view == 'historical-record':
            driver.execute_async_script("const done=arguments[0];findDocumentedCurlingSnapshot('Farrol Asham',{},1800000).then(s=>{render(s);done(true)}).catch(e=>done(e.message))")
        if view == 'feedback':
            driver.execute_script("document.getElementById('feedbackBtn').click()")
        if view == 'privacy':
            driver.get(base + '/privacy.html')
        driver.execute_script(axe)
        report = driver.execute_async_script("const done=arguments[0];axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}).then(done).catch(e=>done({error:e.message}))")
        # Keep actionable evidence, not megabytes of successful-node HTML.
        report.pop('inapplicable', None)
        report['passed_rule_ids'] = [r['id'] for r in report.pop('passes', [])]
        results.append({'view': view, 'report': report})
        driver.save_screenshot(str(out / ('accessibility-' + view + '.png')))
    result = {'timestamp': dt.datetime.now(dt.timezone.utc).isoformat(), 'url': base,
              'engine': 'axe-core 4.14.0', 'browser': driver.capabilities.get('browserVersion'),
              'viewport_width': driver.execute_script('return innerWidth'), 'results': results,
              'violations': sum(len(r['report'].get('violations', [])) for r in results),
              'errors': sum('error' in r['report'] for r in results),
              'manual_review_items': sum(len(r['report'].get('incomplete', [])) for r in results),
              'limitation': 'Automated subset only; physical iPhone and assistive-technology review remain separate gates.'}
    (out / 'accessibility.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'results'}))
finally:
    driver.quit()
