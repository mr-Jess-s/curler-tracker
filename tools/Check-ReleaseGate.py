"""Fail closed: an evidence file is not approval unless every mandatory gate passes."""
import argparse
import json
from pathlib import Path
import subprocess

MANDATORY = ('functional_uat', 'data_integrity', 'accessibility', 'security_privacy',
             'backup_restore', 'collector_operational', 'monitoring_recovery',
             'rollback_rehearsal', 'staging_verification')

def validate(evidence, commit):
    if evidence.get('tested_commit') != commit:
        return False, 'Acceptance evidence does not match the exact release commit.'
    for name in MANDATORY:
        row = evidence.get('gates', {}).get(name, {})
        if row.get('status') != 'PASS' or not row.get('artifact') or not row.get('timestamp'):
            return False, 'Mandatory acceptance missing or incomplete: ' + name
    if not str(evidence.get('rollback_deployment', '')).startswith('dpl_'):
        return False, 'Verified rollback deployment is missing.'
    return True, 'All mandatory evidence gates passed.'

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('evidence')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    try:
        evidence = json.loads(Path(args.evidence).read_text(encoding='utf-8-sig'))
        passed, reason = validate(evidence, commit)
    except (OSError, ValueError) as exc:
        passed, reason = False, 'Acceptance file unavailable: ' + str(exc)
    print(reason)
    raise SystemExit(0 if passed else 1)
