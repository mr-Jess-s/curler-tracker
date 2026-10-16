"""Cross-check saved rendered text/links against independently read source facts.

No app matching functions, network calls, or synthetic curling records are used.
This supplements the browser audit: a snapshot-only record cannot pass here.
"""
import datetime as dt
import gzip
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'release-evidence/2026-10-16/field-audit'
with gzip.open(OUT / 'reference.json.gz', 'rt', encoding='utf-8') as stream:
    reference = json.load(stream)
aliases_path=OUT/'source-team-names.json'
aliases=json.loads(aliases_path.read_text(encoding='utf-8')) if aliases_path.exists() else []

def normalized(text):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(text))).strip().casefold()

checks = []
def record(target, name, check, passed, detail, review=False):
    checks.append(dict(target=target, name=name, check=check,
                       result='PASS' if passed else ('REVIEW' if review else 'FAIL'), detail=detail))

for target in ['production', 'staging']:
    path = OUT / (target + '-results.json')
    if not path.exists():
        continue
    report = json.loads(path.read_text(encoding='utf-8-sig'))
    if not report.get('complete'):
        continue
    for result in report['results']:
        obs = result.get('observation') or {}
        snap = obs.get('snapshot') or {}
        name = result['name']
        visible_history = normalized(obs.get('history_text', ''))
        links = obs.get('history_links', [])
        for row in snap.get('careerHistory') or []:
            eid = str(row.get('eventId', ''))
            if not eid:
                continue
            source = next((e for e in reference['events'] if
                           e['association'] == snap.get('sourceSubdomain') and
                           str(e['event_id']) == eid), None)
            if not source:
                continue
            record(target, name, 'Published history title and source link rendered',
                   normalized(source['name']) in visible_history and
                   any(re.search(r'/events/' + re.escape(eid) + r'(?:[/?#]|$)', u) for u in links),
                   {'event_id': eid, 'source_url': source['source_url']})
        event = next((e for e in reference['events'] if
                      e['association'] == snap.get('sourceSubdomain') and
                      str(e['event_id']) == str(snap.get('eventId'))), None)
        if not event:
            continue
        teams = {str(t['id']): t['name'] for t in event['teams']}
        source_aliases=next((e for e in aliases if e['association']==event['association'] and str(e['event_id'])==str(event['event_id'])),{})
        team_aliases={str(t['id']):[n for n in [t.get('name'),t.get('short_name')] if n] for t in source_aliases.get('teams',[])}
        games = {str(g['id']): g for g in event['games']}
        # Preserve DOM line breaks to bind each title to its own status/score.
        rendered_lines = obs.get('schedule_text', '').splitlines()
        blocks=[]
        for line in rendered_lines:
            if ' vs ' in line:
                blocks.append([line])
            elif blocks:
                blocks[-1].append(line)
        rows=snap.get('scheduleRows') or []
        record(target,name,'Rendered fixture count equals observed schedule rows',len(blocks)==len(rows),{'rendered':len(blocks),'observed_rows':len(rows)})
        for index,row in enumerate(rows):
            game = games.get(str(row.get('gameId')))
            if not game:
                continue
            names = [teams.get(str(side.get('team_id'))) for side in game['positions']]
            if len(names) != 2 or not all(names):
                continue
            # Check one visible fixture block, so a team elsewhere cannot satisfy it.
            rendered = normalized(' '.join(blocks[index])) if index<len(blocks) else ''
            title = normalized(names[0] + ' vs ' + names[1])
            reverse_title = normalized(names[1] + ' vs ' + names[0])
            found = title in rendered or reverse_title in rendered
            ids=[str(s.get('team_id')) for s in game['positions']]
            if not found:
                found=any(normalized(a+' vs '+b) in rendered or normalized(b+' vs '+a) in rendered for a in team_aliases.get(ids[0],[]) for b in team_aliases.get(ids[1],[]))
            record(target, name, 'Published fixture teams rendered together', found,
                   {'event_id': str(event['event_id']), 'game_id': game['id'], 'teams': names,'rendered_block':rendered,'review_reason':'Full source names can differ from provider short names; do not infer wrong team from this alone.'},review=True)
            if game['state'].lower() in ('complete', 'completed', 'final', 'finished'):
                scores = [side.get('score') for side in game['positions']]
                if None not in scores:
                    score_texts = [f'{scores[0]} - {scores[1]}', f'{scores[1]} - {scores[0]}']
                    record(target, name, 'Published completed score rendered in fixture block',
                           len(blocks)==len(rows) and any(score in rendered for score in score_texts),
                           {'event_id': str(event['event_id']), 'game_id': game['id'], 'source_scores': scores})

output = {'checked_at': dt.datetime.now(dt.timezone.utc).isoformat(),
          'method': 'Saved actual browser DOM text/links compared with independent published source payloads. Out-of-reference events remain unchecked. These assertions are not distinct user journeys.',
          'passing_assertions': sum(c['result'] == 'PASS' for c in checks),
          'failing_assertions': sum(c['result'] == 'FAIL' for c in checks),
          'review_assertions': sum(c['result'] == 'REVIEW' for c in checks), 'checks': checks}
(OUT / 'rendered-source-validation.json').write_text(json.dumps(output, indent=2), encoding='utf-8')
print(json.dumps({k: v for k, v in output.items() if k != 'checks'}, indent=2))
