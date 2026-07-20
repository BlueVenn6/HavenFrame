from __future__ import annotations

import argparse
import ctypes
import os
import sys
import threading
import time

import uvicorn


def main() -> int:
    parser = argparse.ArgumentParser(description="HavenFrame FastAPI desktop sidecar")
    parser.add_argument("--host", default=os.getenv("QIGOU_API_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("QIGOU_API_PORT", "8010")))
    parser.add_argument("--parent-pid", type=int, default=0)
    args = parser.parse_args()

    host = str(args.host).strip()
    if host not in {"127.0.0.1", "localhost", "::1"}:
        print("Refusing to start: sidecar host must be loopback only.", file=sys.stderr)
        return 2
    if not (1024 <= int(args.port) <= 65535):
        print("Refusing to start: sidecar port must be between 1024 and 65535.", file=sys.stderr)
        return 2
    if int(args.parent_pid) < 0:
        print("Refusing to start: parent PID must be a positive process ID.", file=sys.stderr)
        return 2

    os.environ.setdefault("INTERIOR_AI_STUDIO_SKIP_LOCAL_ENV", "1")
    os.environ.setdefault("QIGOU_API_HOST", host)
    os.environ.setdefault("QIGOU_API_PORT", str(args.port))

    from backend.main import app

    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host=host,
            port=int(args.port),
            log_level=os.getenv("QIGOU_UVICORN_LOG_LEVEL", "warning"),
            access_log=False,
        )
    )
    if args.parent_pid:
        threading.Thread(
            target=_stop_when_parent_exits,
            args=(server, int(args.parent_pid)),
            daemon=True,
            name="qigou-parent-monitor",
        ).start()
    server.run()
    return 0


def _stop_when_parent_exits(server: uvicorn.Server, parent_pid: int) -> None:
    while not server.should_exit:
        if not _process_exists(parent_pid):
            server.should_exit = True
            return
        time.sleep(1)


def _process_exists(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        process_query_limited_information = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(process_query_limited_information, False, pid)
        if not handle:
            return False
        try:
            exit_code = ctypes.c_ulong()
            if not ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return False
            return exit_code.value == 259  # STILL_ACTIVE
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


if __name__ == "__main__":
    raise SystemExit(main())
