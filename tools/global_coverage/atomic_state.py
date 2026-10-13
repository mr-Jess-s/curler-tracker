"""Atomic checkpoint replacement with bounded Windows sharing-violation retries."""
import json
import os
import tempfile
import time
from pathlib import Path


def atomic_json(path, payload, attempts=6):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
    temp = Path(temp_name)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(payload, stream, indent=2, ensure_ascii=False)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        for attempt in range(attempts):
            try:
                os.replace(temp, path)
                return
            except PermissionError:
                if attempt + 1 == attempts:
                    raise
                time.sleep(min(0.25 * 2 ** attempt, 2))
    finally:
        temp.unlink(missing_ok=True)
