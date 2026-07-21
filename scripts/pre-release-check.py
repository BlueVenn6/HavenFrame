from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_GITIGNORE_PATTERNS = [
    ".env",
    ".env.*",
    "workspace/",
    "backend/data/",
    "*.db",
    "*.sqlite",
    "*.sqlite3",
    "*.p8",
    "*.p12",
    "*.mobileprovision",
    "*.keystore",
    "*.jks",
    "app/dist/",
    "node_modules/",
    "*.safetensors",
    "*.ckpt",
    "*.gguf",
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Run pre-release checks for the bilingual HavenFrame desktop workspace.")
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--skip-heavy", action="store_true", help="skip pytest/build/smoke for fast static validation")
    args = parser.parse_args()
    root = args.root.resolve()
    checks: list[tuple[str, bool, str]] = []

    checks.append(_command_check("python_dependency_check", [sys.executable, "-m", "pip", "check"], root))

    if not args.skip_heavy:
        checks.append(_command_check("backend_tests", [sys.executable, "-m", "pytest", "backend/tests", "-q"], root))
        npm = _npm_command()
        checks.append(_command_check("frontend_model_routing_test", [npm, "run", "test:model-routing"], root / "app"))
        checks.append(_command_check("frontend_model_selection_runtime_test", [npm, "run", "test:model-selection-runtime"], root / "app"))
        checks.append(_command_check("frontend_i18n_test", [npm, "run", "test:i18n"], root / "app"))
        checks.append(_command_check("frontend_independent_board_workflows", [npm, "run", "test:independent-board-workflows"], root / "app"))
        checks.append(_command_check("frontend_workflow_history", [npm, "run", "test:workflow-history"], root / "app"))
        checks.append(_command_check("frontend_build", [npm, "run", "build"], root / "app"))

    checks.append(_secret_scan_check(root))
    checks.append(_gitignore_check(root))
    checks.append(
        _file_contains_check(
            root / "LICENSE",
            "open_source_license",
            ["GNU AFFERO GENERAL PUBLIC LICENSE", "Version 3, 19 November 2007"],
        )
    )
    checks.append(
        _file_contains_check(
            root / "THIRD_PARTY_NOTICES.md",
            "third_party_notices",
            ["Third-Party Notices", "app/package-lock.json", "backend/requirements.txt"],
        )
    )
    checks.append(
        _file_contains_check(
            root / "README.md",
            "readme_bilingual_overview",
            ["## 中文概览", "## English overview", "docs/USER_GUIDE_BILINGUAL.md"],
        )
    )
    checks.append(
        _file_contains_check(
            root / "docs" / "USER_GUIDE_BILINGUAL.md",
            "bilingual_user_guide",
            ["# 中文说明", "# English Guide"],
        )
    )
    checks.append(
        _file_contains_check(
            root / "app" / "package.json",
            "desktop_license_metadata",
            ['"license": "AGPL-3.0-or-later"'],
        )
    )
    checks.append(
        _file_contains_check(
            root / "app" / "src-tauri" / "Cargo.toml",
            "tauri_license_metadata",
            ['license = "AGPL-3.0-or-later"', 'authors = ["HavenFrame contributors"]'],
        )
    )
    for path, name in (
        (".github/workflows/source-validation.yml", "github_source_validation"),
        (".github/dependabot.yml", "github_dependabot"),
        (".github/PULL_REQUEST_TEMPLATE.md", "github_pull_request_template"),
        (".github/ISSUE_TEMPLATE/bug_report.yml", "github_bug_template"),
    ):
        checks.append(_file_exists_check(root / path, name))
    checks.append(_file_contains_check(root / "SECURITY.md", "security_doc", ["FastAPI sidecar", "API Key", "中转", "127.0.0.1:8010"]))
    checks.append(_file_contains_check(root / "README.md", "readme_security_section", ["## 安全与发布", "API Key", "workspace/", "127.0.0.1"]))
    checks.append(
        _file_contains_check(
            root / "RELEASE_NOTES.md",
            "release_notes",
            ["HavenFrame / 栖构", "Provider boundaries", "State D"],
        )
    )
    checks.append(_file_contains_check(root / "docs/OPEN_SOURCE_RELEASE.md", "open_source_release_doc", ["Windows", "Android/iOS", "不包含"] ))
    checks.append(_file_contains_check(root / "app/package.json", "desktop_bundle_script", ["desktop:build:bundle"]))
    checks.append(_version_consistency_check(root))
    checks.append(_file_contains_check(root / "app/src-tauri/tauri.conf.json", "tauri_bundle_config", ['"bundle"', '"active": true', '"nsis"']))
    checks.append(_file_contains_check(root / "app/src-tauri/tauri.conf.json", "tauri_sidecar_config", ["externalBin", "qigou-backend-sidecar"]))
    checks.append(_file_contains_check(root / "app/src-tauri/src/main.rs", "tauri_sidecar_startup", ["qigou-backend-sidecar.exe", "QIGOU_APP_DATA_DIR", "app_local_data_dir", "--parent-pid"]))
    checks.append(_file_contains_check(root / "app/src-tauri/src/main.rs", "tauri_backend_identity", ["com.havenframe.desktop.backend", "2026-07-13-model-persistence-v1", "backend_health_ok"]))
    checks.append(_file_contains_check(root / "app/src/api/client.ts", "frontend_backend_identity", ["EXPECTED_BACKEND_SERVICE_ID", "EXPECTED_API_CONTRACT_VERSION", "ensureBackendIdentity"]))
    checks.append(_file_contains_check(root / "backend/main.py", "backend_health_identity", ["SERVICE_ID", "API_CONTRACT_VERSION", "api_contract_version"]))
    checks.append(_file_contains_check(root / "backend/sidecar_entry.py", "backend_sidecar_entry", ["uvicorn.Server", "127.0.0.1", "--parent-pid", "_stop_when_parent_exits"]))
    checks.append(_file_contains_check(root / "backend/core/config.py", "appdata_runtime_dirs", ["QIGOU_APP_DATA_DIR", "QIGOU_WORKSPACE_DIR", "LOGS_DIR"]))
    checks.append(_file_contains_check(root / "scripts/build-backend-sidecar.py", "backend_sidecar_build_script", ["PyInstaller", "qigou-backend-sidecar", "target_triple"]))
    checks.append(_file_contains_check(root / "scripts/build-desktop-local.py", "desktop_persistence_gate_enabled", ["validate-packaged-sidecar-persistence.ps1", "persistence_gate.returncode"]))
    checks.append(_file_contains_check(root / "scripts/validate-packaged-sidecar-persistence.ps1", "packaged_sidecar_persistence_gate", ["restart_persistence_confirmed", "module_binding_confirmed"]))
    checks.append(_file_contains_check(root / "scripts/validate-installed-live-provider.py", "installed_live_provider_gate", ["--allow-paid-provider-call", "external_provider_called", "single_without_extraction_review_or_budget", "multi_without_extraction_review_or_budget", "real_provider_images_readable"]))
    checks.append(_file_contains_check(root / "backend/core/local_security.py", "local_token_enabled", ["LOCAL_TOKEN_HEADER", "request_has_valid_token"]))
    checks.append(_cors_check(root / "backend/main.py"))
    checks.append(_file_contains_check(root / "backend/services/model_service.py", "api_key_not_plaintext", ["store_model_api_key", "migrate_plain_api_key"]))
    checks.append(_file_contains_check(root / "backend/core/security_context.py", "security_context_enabled", ["class SecurityContext", "data_flow_confirmed"]))
    checks.append(_file_contains_check(root / "backend/services/task_service.py", "data_flow_confirmed_enforced", ["_ensure_data_flow_confirmed", "require_data_flow=True"]))
    checks.append(_file_contains_check(root / "backend/core/platform_capabilities.py", "platform_capability_isolation", ["local_file_open", "API_PROFILE_CLOUD"]))

    failed = [item for item in checks if not item[1]]
    for name, ok, _detail in checks:
        print(f"{'PASS' if ok else 'FAIL'} {name}")
    return 1 if failed else 0


def _command_check(name: str, cmd: list[str], cwd: Path) -> tuple[str, bool, str]:
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=900,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return name, False, str(exc)
    if result.returncode == 0:
        return name, True, "ok"
    return name, False, _last_lines(result.stdout)


def _secret_scan_check(root: Path) -> tuple[str, bool, str]:
    result = subprocess.run(
        [sys.executable, "scripts/secret_scan.py", "--json"],
        cwd=root,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            return "secret_scan", False, "secret scan failed"
        count = len(payload.get("findings") or [])
        return "secret_scan", False, f"{count} high-risk item(s)"
    return "secret_scan", True, "no high-risk items"


def _gitignore_check(root: Path) -> tuple[str, bool, str]:
    path = root / ".gitignore"
    if not path.exists():
        return "gitignore_sensitive_rules", False, ".gitignore missing"
    text = path.read_text(encoding="utf-8", errors="ignore")
    missing = [pattern for pattern in REQUIRED_GITIGNORE_PATTERNS if pattern not in text]
    if missing:
        return "gitignore_sensitive_rules", False, f"missing {', '.join(missing)}"
    tracked = subprocess.run(["git", "ls-files"], cwd=root, text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if tracked.returncode == 0:
        risky = [line for line in tracked.stdout.splitlines() if _tracked_sensitive(line)]
        if risky:
            return "gitignore_sensitive_rules", False, f"tracked sensitive file(s): {', '.join(risky[:5])}"
    return "gitignore_sensitive_rules", True, "ok"


def _file_contains_check(path: Path, name: str, needles: list[str]) -> tuple[str, bool, str]:
    if not path.exists():
        return name, False, f"{path.name} missing"
    text = path.read_text(encoding="utf-8", errors="ignore")
    missing = [needle for needle in needles if needle not in text]
    if missing:
        return name, False, f"missing {', '.join(missing)}"
    return name, True, "ok"


def _file_exists_check(path: Path, name: str) -> tuple[str, bool, str]:
    if not path.is_file():
        return name, False, f"{path.name} missing"
    return name, True, "ok"


def _cors_check(path: Path) -> tuple[str, bool, str]:
    if not path.exists():
        return "cors_not_wildcard", False, "backend/main.py missing"
    text = path.read_text(encoding="utf-8", errors="ignore")
    if re.search(r"allow_origins\s*=\s*\[\s*['\"]\*['\"]\s*\]", text):
        return "cors_not_wildcard", False, "wildcard CORS detected"
    return "cors_not_wildcard", True, "ok"


def _version_consistency_check(root: Path) -> tuple[str, bool, str]:
    required = (
        root / "app/package.json",
        root / "app/src-tauri/tauri.conf.json",
        root / "app/src-tauri/Cargo.toml",
        root / "backend/main.py",
    )
    missing = [str(path.relative_to(root)) for path in required if not path.is_file()]
    if missing:
        return "release_version_consistency", False, f"missing {', '.join(missing)}"
    try:
        desktop_package = json.loads(required[0].read_text(encoding="utf-8"))
        tauri_config = json.loads(required[1].read_text(encoding="utf-8"))
        cargo_text = required[2].read_text(encoding="utf-8")
        backend_text = required[3].read_text(encoding="utf-8")
    except (KeyError, json.JSONDecodeError) as exc:
        return "release_version_consistency", False, f"invalid release metadata: {exc}"
    desktop_version = str(desktop_package["version"])
    desktop_ok = (
        tauri_config.get("version") == desktop_version
        and f'version = "{desktop_version}"' in cargo_text
        and f'version="{desktop_version}"' in backend_text
    )
    if not desktop_ok:
        return "release_version_consistency", False, "desktop release metadata is inconsistent"
    return "release_version_consistency", True, f"desktop {desktop_version}"


def _tracked_sensitive(path: str) -> bool:
    name = Path(path).name.lower()
    if name == ".env.example":
        return False
    return name in {".env", "secrets.json"} or name.endswith((".env", ".p8", ".p12", ".keystore", ".jks", ".mobileprovision", ".provisionprofile"))


def _npm_command() -> str:
    return shutil.which("npm.cmd") or shutil.which("npm") or "npm"


def _last_lines(text: str, count: int = 8) -> str:
    lines = [line for line in text.splitlines() if line.strip()]
    return " | ".join(lines[-count:])[:1200]


if __name__ == "__main__":
    raise SystemExit(main())
