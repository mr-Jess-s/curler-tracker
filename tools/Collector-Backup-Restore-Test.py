"""Non-destructive restore verification for the isolated collector archive."""
import argparse, datetime, gzip, hashlib, json, shutil, tempfile
from pathlib import Path

def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()

def run(backup, out):
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    source = Path(backup) / 'data'
    destination = Path(tempfile.mkdtemp(prefix='CurlerTracker-archive-restore-')) / 'data'
    shutil.copytree(source, destination)
    files = [path for path in source.rglob('*') if path.is_file()]
    mismatches, invalid = [], []
    raw_files = normalized = total_bytes = 0
    for path in files:
        relative = path.relative_to(source)
        restored = destination / relative
        total_bytes += path.stat().st_size
        if digest(path) != digest(restored):
            mismatches.append(str(relative))
        if relative.parts and relative.parts[0] == 'raw':
            raw_files += 1
            if restored.suffix == '.gz':
                try:
                    with gzip.open(restored, 'rb') as stream:
                        while stream.read(1024 * 1024):
                            pass
                except Exception as error:
                    invalid.append({'file': str(relative), 'error': str(error)})
        elif restored.suffix == '.json':
            try:
                json.loads(restored.read_text(encoding='utf-8-sig'))
                normalized += 1
            except Exception as error:
                invalid.append({'file': str(relative), 'error': str(error)})
    report = {
        'started_at': started,
        'finished_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'restore_directory': str(destination.parent),
        'files_restored': len(files),
        'bytes_restored': total_bytes,
        'raw_files_restored': raw_files,
        'normalized_json_validated': normalized,
        'mismatches': mismatches,
        'invalid_files': invalid,
        'cloud_sync_verified': False,
        'passed': not mismatches and not invalid and len(files) > 0,
    }
    target = Path(out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('backup')
    parser.add_argument('out')
    args = parser.parse_args()
    run(args.backup, args.out)
