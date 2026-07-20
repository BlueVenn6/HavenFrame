from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {
    ".git",
    ".venv",
    "venv",
    ".expo",
    ".gradle",
    ".cxx",
    "node_modules",
    "dist",
    "build",
    "target",
    "__pycache__",
    ".pytest_cache",
    "workspace",
    "backend/data",
    "manual-acceptance",
    "release-validation",
}
SENSITIVE_FILE_PATTERNS = (
    ".env",
    ".p8",
    ".p12",
    ".keystore",
    ".jks",
    ".mobileprovision",
    ".provisionprofile",
    "secrets.json",
)
SECRET_PATTERNS = {
    "api_key": re.compile(r"(?i)\b(api[_-]?key|access[_-]?token|secret|password)\b\s*[:=]\s*['\"]?(sk-[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,}|[A-Za-z0-9_+/=-]{32,})"),
    "authorization": re.compile(r"(?i)\bauthorization\b\s*[:=]\s*['\"]?(bearer\s+)?(sk-[A-Za-z0-9]{16,}|[A-Za-z0-9_+/=-]{32,})"),
    "bearer": re.compile(r"(?i)\bbearer\s+(sk-[A-Za-z0-9]{16,}|[A-Za-z0-9_+/=-]{32,})"),
    "private_key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
}


@dataclass(frozen=True)
class SecretFinding:
    path: str
    rule: str
    source: str
    risk: str = "high"

    def as_dict(self) -> dict[str, str]:
        return {"path": self.path, "rule": self.rule, "source": self.source, "risk": self.risk}


def scan_workspace(root: Path = ROOT) -> list[SecretFinding]:
    findings: list[SecretFinding] = []
    tracked = _tracked_files(root)
    for directory, dir_names, file_names in os.walk(root):
        directory_path = Path(directory)
        dir_names[:] = [
            name
            for name in dir_names
            if not _should_skip(directory_path / name, root)
        ]
        for file_name in file_names:
            path = directory_path / file_name
            if _should_skip(path, root):
                continue
            relative = _relative(path, root)
            lowered_name = path.name.lower()
            if _is_sensitive_file_name(lowered_name) and path.name != ".env.example":
                risk = "high" if relative in tracked else "medium"
                source = "workspace_tracked" if relative in tracked else "workspace_untracked"
                findings.append(SecretFinding(relative, "sensitive_file", source, risk=risk))
            try:
                if path.stat().st_size > 2 * 1024 * 1024:
                    continue
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for rule, pattern in SECRET_PATTERNS.items():
                if pattern.search(text):
                    findings.append(SecretFinding(relative, rule, "workspace"))
    return findings


def scan_git_history(root: Path = ROOT) -> list[SecretFinding]:
    findings: list[SecretFinding] = []
    tracked = _git(["ls-files"], root)
    if tracked.returncode == 0:
        for line in tracked.stdout.splitlines():
            if _is_sensitive_file_name(Path(line).name.lower()) and Path(line).name != ".env.example":
                findings.append(SecretFinding(line, "tracked_sensitive_file", "git_index"))
    history_pathspecs = [
        "*.env",
        "*.p8",
        "*.p12",
        "*.keystore",
        "*.jks",
        "*.mobileprovision",
        "*.provisionprofile",
        "secrets.json",
    ]
    grep = _git(
        ["log", "--all", "--full-history", "--name-only", "--pretty=format:", "--", *history_pathspecs],
        root,
    )
    if grep.returncode == 0:
        seen: set[str] = set()
        for line in grep.stdout.splitlines():
            if not line or line in seen:
                continue
            seen.add(line)
            if _is_sensitive_file_name(Path(line).name.lower()) and Path(line).name != ".env.example":
                findings.append(SecretFinding(line, "history_sensitive_file", "git_history"))
    history_diff = _git(
        [
            "log",
            "--all",
            "-p",
            "--no-ext-diff",
            "--format=",
            "--",
            ".",
            ":(exclude)scripts/secret_scan.py",
            ":(exclude).env.example",
            ":(exclude)backend/tests",
        ],
        root,
    )
    if history_diff.returncode == 0:
        for rule, pattern in SECRET_PATTERNS.items():
            if pattern.search(history_diff.stdout):
                findings.append(SecretFinding("(git history diff)", rule, "git_history"))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan workspace and git metadata for sensitive files or secret-shaped text.")
    parser.add_argument("--json", action="store_true", help="print JSON result")
    args = parser.parse_args()
    findings = _dedupe(scan_workspace(ROOT) + scan_git_history(ROOT))
    high_findings = [finding for finding in findings if finding.risk == "high"]
    payload = {"ok": not high_findings, "findings": [finding.as_dict() for finding in findings]}
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        if high_findings:
            print("FAIL secret scan: high-risk items found")
            for finding in high_findings:
                print(f"- {finding.risk}: {finding.source}:{finding.rule}:{finding.path}")
        else:
            print("PASS secret scan: no high-risk items found")
            for finding in findings:
                print(f"- warning: {finding.source}:{finding.rule}:{finding.path}")
    return 0 if not high_findings else 1


def _should_skip(path: Path, root: Path) -> bool:
    relative = _relative(path, root).replace("\\", "/")
    parts = set(relative.split("/"))
    if parts & {"node_modules", "dist", "build", "target", "__pycache__", ".pytest_cache", ".git", ".expo", ".gradle", ".cxx"}:
        return True
    return any(relative == skip or relative.startswith(f"{skip}/") for skip in SKIP_DIRS)


def _is_sensitive_file_name(name: str) -> bool:
    return any(fnmatch.fnmatch(name, pattern) or name.endswith(pattern) for pattern in SENSITIVE_FILE_PATTERNS)


def _dedupe(findings: list[SecretFinding]) -> list[SecretFinding]:
    seen: set[tuple[str, str, str]] = set()
    unique = []
    for finding in findings:
        key = (finding.path, finding.rule, finding.source)
        if key in seen:
            continue
        seen.add(key)
        unique.append(finding)
    return unique


def _relative(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def _git(args: list[str], root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=root,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def _tracked_files(root: Path) -> set[str]:
    tracked = _git(["ls-files"], root)
    return set(tracked.stdout.splitlines()) if tracked.returncode == 0 else set()


if __name__ == "__main__":
    raise SystemExit(main())
