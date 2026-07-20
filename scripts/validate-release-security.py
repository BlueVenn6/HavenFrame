from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


SECRET_PATTERNS = (
    re.compile(r"(?i)\bsk-[A-Za-z0-9]{20,}\b"),
    re.compile(r"(?i)\bAIza[A-Za-z0-9_-]{30,}\b"),
    re.compile(r"(?i)-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_dist(dist: Path) -> dict[str, object]:
    if not dist.is_dir():
        raise RuntimeError(f"release frontend directory does not exist: {dist}")

    failures: list[str] = []
    files = [path for path in dist.rglob("*") if path.is_file()]
    for path in files:
        if path.suffix.lower() in {".map", ".env", ".pem", ".key", ".p12", ".p8"}:
            failures.append(f"forbidden release file: {path.relative_to(dist)}")
        raw = path.read_bytes()
        if b"sourceMappingURL=" in raw or b"//# sourceURL=" in raw:
            failures.append(f"debug/source-map marker found: {path.relative_to(dist)}")
        text = raw.decode("utf-8", errors="ignore")
        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                failures.append(f"secret-shaped value found: {path.relative_to(dist)}")
                break

    result = {
        "dist": str(dist.resolve()),
        "file_count": len(files),
        "files": [
            {"path": str(path.relative_to(dist)), "size": path.stat().st_size, "sha256": sha256(path)}
            for path in sorted(files)
        ],
        "failures": failures,
        "passed": not failures,
    }
    if failures:
        raise RuntimeError(json.dumps(result, ensure_ascii=False, indent=2))
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a production frontend bundle for release leaks.")
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        result = validate_dist(args.dist)
    except RuntimeError as error:
        print(f"FAIL release security validation: {error}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"PASS release security validation: {result['file_count']} files checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
