"""Preserve a fresh-browser follow-up to the Kyle Kurz staging failure."""
import importlib.util
import json
import time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('audit',ROOT/'tools/Curler-Field-Audit.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
d=a.browser();rows=[]
try:
 d.get(a.STAGING);a.WebDriverWait(d,30).until(lambda _:d.execute_script("return typeof startTracking==='function'"));time.sleep(3)
 for name in ['Kyle Kurz','Braden Calvert','Kyle Kurz']:
  start=a.stamp();field=d.find_element(a.By.ID,'playerInput')
  d.execute_script("arguments[0].scrollIntoView({behavior:'instant',block:'center'})",field)
  field.clear();field.send_keys(name);button=d.find_element(a.By.ID,'searchSubmitBtn')
  d.execute_script("arguments[0].scrollIntoView({behavior:'instant',block:'center'})",button);time.sleep(.2);button.click()
  a.WebDriverWait(d,95).until(lambda _:d.execute_script('return !state.isRunning'))
  button=d.find_element(a.By.ID,'careerLoadBtn')
  if button.is_displayed() and button.is_enabled():
   d.execute_script("arguments[0].scrollIntoView({behavior:'instant',block:'center'})",button);time.sleep(.2);button.click()
   a.WebDriverWait(d,65).until(lambda _:d.execute_script('return !state.careerLoading'))
  rows.append({'name':name,'started_at':start,'finished_at':a.stamp(),'observation':a.observation(d)})
  a.save(a.OUT/'ambiguity-retest.json',{'url':a.STAGING,'method':'Fresh Edge browser; Kyle, Braden, Kyle submitted through actual UI. Original 71-case observation retained unchanged.','results':rows})
  print(json.dumps({'name':name,'view':rows[-1]['observation'].get('snapshot',{}).get('view'),'status':rows[-1]['observation']['status']}),flush=True)
  time.sleep(2)
finally:d.quit()
