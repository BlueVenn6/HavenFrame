from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "app"


def _release_version() -> str:
    package = json.loads((APP_DIR / "package.json").read_text(encoding="utf-8"))
    version = str(package.get("version") or "").strip()
    if not version:
        raise RuntimeError("app/package.json does not define a release version")
    return version


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the Windows desktop app locally with an explicit Rust target.")
    parser.add_argument("--no-bundle", action="store_true", help="build the executable without producing an installer")
    args = parser.parse_args()
    source_commit = _git_output("rev-parse", "HEAD")
    source_status = _git_output("status", "--porcelain")
    if not args.no_bundle and source_status:
        print("FAIL desktop release build: Git worktree must be clean before packaging.", file=sys.stderr)
        print(source_status, file=sys.stderr)
        return 1
    build_started_at = datetime.now(timezone.utc).isoformat()

    target = _rust_host_triple()
    if not target.endswith("-pc-windows-msvc"):
        print(f"FAIL desktop build: unsupported local target {target or '<unknown>'}.", file=sys.stderr)
        return 1

    sidecar = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "build-backend-sidecar.py"),
            "--target-triple",
            target,
        ],
        cwd=ROOT,
    )
    if sidecar.returncode != 0:
        return sidecar.returncode

    sidecar_path = ROOT / "app" / "src-tauri" / "binaries" / f"qigou-backend-sidecar-{target}.exe"
    persistence_gate = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(ROOT / "scripts" / "validate-packaged-sidecar-persistence.ps1"),
            "-SidecarPath",
            str(sidecar_path),
        ],
        cwd=ROOT,
    )
    if persistence_gate.returncode != 0:
        print("FAIL desktop build: packaged sidecar persistence gate failed.", file=sys.stderr)
        return persistence_gate.returncode

    npx = shutil.which("npx.cmd") or shutil.which("npx") or "npx"
    command = [npx, "tauri", "build", "--target", target]
    if args.no_bundle:
        command.append("--no-bundle")
    print(f"desktop_target={target}")
    result = subprocess.run(command, cwd=APP_DIR)
    if result.returncode != 0 or args.no_bundle:
        return result.returncode
    return _write_release_manifest(target, source_commit, source_status, build_started_at)


def _rust_host_triple() -> str:
    result = subprocess.run(
        ["rustc", "-vV"],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        return ""
    for line in result.stdout.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    return ""


def _git_output(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def _write_release_manifest(target: str, source_commit: str, source_status: str, build_started_at: str) -> int:
    release_version = _release_version()
    release_dir = APP_DIR / "src-tauri" / "target" / target / "release"
    installer_dir = release_dir / "bundle" / "nsis"
    installers = list(installer_dir.glob(f"*_{release_version}_*setup.exe"))
    frontend_files = sorted(path for path in (APP_DIR / "dist").rglob("*") if path.is_file())
    sidecar = release_dir / "qigou-backend-sidecar.exe"
    desktop_exe = release_dir / "interior-ai-studio.exe"
    required = [sidecar, desktop_exe, *installers, *frontend_files]
    if len(installers) != 1 or any(not path.is_file() for path in required):
        print(f"FAIL release manifest: expected one {release_version} installer and complete build outputs.", file=sys.stderr)
        return 1
    manifest = {
        "release_version": release_version,
        "git_commit": source_commit,
        "git_status": source_status or "clean",
        "build_started_at": build_started_at,
        "build_finished_at": datetime.now(timezone.utc).isoformat(),
        "target": target,
        "frontend": [
            {"path": str(path.relative_to(ROOT)), "size": path.stat().st_size, "sha256": _sha256(path)}
            for path in frontend_files
        ],
        "sidecar": {"path": str(sidecar.relative_to(ROOT)), "size": sidecar.stat().st_size, "sha256": _sha256(sidecar)},
        "desktop_exe": {"path": str(desktop_exe.relative_to(ROOT)), "size": desktop_exe.stat().st_size, "sha256": _sha256(desktop_exe)},
        "installer": {"path": str(installers[0].relative_to(ROOT)), "size": installers[0].stat().st_size, "sha256": _sha256(installers[0])},
    }
    manifest_path = installer_dir / f"havenframe-{release_version}-release-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"release_manifest={manifest_path}")
    print(f"installer_sha256={manifest['installer']['sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
