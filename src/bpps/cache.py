"""Atomic JSON cache writes shared by NBA responses and fitted models."""

import json
import os
import tempfile
from pathlib import Path


def write_json_atomic(path: Path, value: object) -> None:
    """Readers see the old or the complete new document, never a partial write."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(value, stream, allow_nan=False)
            stream.close()
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
