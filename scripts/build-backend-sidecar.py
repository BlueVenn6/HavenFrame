from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SIDECAR_BASE_NAME = "qigou-backend-sidecar"


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the FastAPI backend as a Tauri sidecar with PyInstaller.")
    parser.add_argument("--target-triple", default="", help="Override the Rust target triple used by Tauri externalBin.")
    parser.add_argument("--clean", action="store_true", help="Remove PyInstaller build cache before building.")
    args = parser.parse_args()

    triple = args.target_triple.strip() or _rust_host_triple()
    if not triple:
        print("FAIL backend sidecar: could not determine Rust target triple.", file=sys.stderr)
        return 1

    entry = ROOT / "backend" / "sidecar_entry.py"
    dist_dir = ROOT / "app" / "src-tauri" / "binaries"
    work_dir = ROOT / "build" / "pyinstaller" / "work"
    spec_dir = ROOT / "build" / "pyinstaller" / "spec"
    binary_name = f"{SIDECAR_BASE_NAME}-{triple}"
    exe_name = f"{binary_name}.exe" if "windows" in triple else binary_name
    target = dist_dir / exe_name
    required_targets = [_sidecar_path_for_triple(dist_dir, item) for item in _required_target_triples(triple)]

    if args.clean:
        shutil.rmtree(work_dir, ignore_errors=True)
        shutil.rmtree(spec_dir, ignore_errors=True)
    dist_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    spec_dir.mkdir(parents=True, exist_ok=True)
    for existing_target in required_targets:
        if not existing_target.exists():
            continue
        try:
            existing_target.unlink()
        except PermissionError:
            print(
                f"FAIL backend sidecar: existing sidecar is locked: {existing_target}. "
                "Close the Qigou desktop app or stop the qigou-backend-sidecar process, then retry.",
                file=sys.stderr,
            )
            return 1

    pyinstaller = [sys.executable, "-m", "PyInstaller"]
    if subprocess.run(pyinstaller + ["--version"], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).returncode != 0:
        print("FAIL backend sidecar: PyInstaller is not installed. Run `python -m pip install pyinstaller` in the build environment.", file=sys.stderr)
        return 1

    cmd = [
        *pyinstaller,
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        binary_name,
        "--distpath",
        str(dist_dir),
        "--workpath",
        str(work_dir),
        "--specpath",
        str(spec_dir),
        "--paths",
        str(ROOT),
        "--hidden-import",
        "sqlalchemy.dialects.sqlite",
        "--hidden-import",
        "uvicorn.loops.auto",
        "--hidden-import",
        "uvicorn.protocols.http.auto",
        "--hidden-import",
        "uvicorn.protocols.websockets.auto",
        "--hidden-import",
        "uvicorn.lifespan.on",
        str(entry),
    ]
    result = subprocess.run(cmd, cwd=ROOT, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        print(f"FAIL backend sidecar: PyInstaller exited with {result.returncode}.", file=sys.stderr)
        return result.returncode
    if not target.exists() or target.stat().st_size == 0:
        print(f"FAIL backend sidecar: expected output missing or empty: {target}", file=sys.stderr)
        return 1
    binary_arch = _windows_pe_arch(target) if os.name == "nt" else ""
    target_arch = triple.split("-", 1)[0]
    compatibility_mode = "native"
    if binary_arch and binary_arch != target_arch:
        if target_arch == "aarch64" and binary_arch == "x86_64":
            compatibility_mode = "windows_arm64_x64_emulation"
        else:
            print(
                f"FAIL backend sidecar: PE architecture {binary_arch} does not match target {target_arch}.",
                file=sys.stderr,
            )
            return 1
    for extra_target in required_targets:
        if extra_target == target:
            continue
        shutil.copy2(target, extra_target)

    print(f"PASS backend sidecar: {target}")
    print(f"target_triple={triple}")
    if binary_arch:
        print(f"binary_arch={binary_arch}")
        print(f"compatibility_mode={compatibility_mode}")
    print(f"size_bytes={target.stat().st_size}")
    for extra_target in required_targets:
        if extra_target != target:
            print(f"prepared_alias={extra_target}")
    return 0


def _rust_host_triple() -> str:
    override = os.getenv("TAURI_BUILD_TARGET") or os.getenv("CARGO_BUILD_TARGET")
    if override:
        return override.strip()
    result = subprocess.run(["rustc", "-vV"], cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        return ""
    for line in result.stdout.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    return ""


def _required_target_triples(primary: str) -> list[str]:
    triples = [primary]
    if os.name == "nt" and "x86_64-pc-windows-msvc" not in triples:
        triples.append("x86_64-pc-windows-msvc")
    return triples


def _sidecar_path_for_triple(dist_dir: Path, triple: str) -> Path:
    suffix = ".exe" if "windows" in triple else ""
    return dist_dir / f"{SIDECAR_BASE_NAME}-{triple}{suffix}"


def _windows_pe_arch(path: Path) -> str:
    with path.open("rb") as handle:
        handle.seek(0x3C)
        pe_offset = int.from_bytes(handle.read(4), "little")
        handle.seek(pe_offset + 4)
        machine = int.from_bytes(handle.read(2), "little")
    return {0x014C: "x86", 0x8664: "x86_64", 0xAA64: "aarch64"}.get(machine, f"0x{machine:04x}")


if __name__ == "__main__":
    raise SystemExit(main())
