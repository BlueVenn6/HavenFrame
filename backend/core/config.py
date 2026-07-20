import os
from pathlib import Path

from backend.core.env import load_local_env


ROOT_DIR = Path(__file__).resolve().parents[2]
if os.getenv("INTERIOR_AI_STUDIO_SKIP_LOCAL_ENV") != "1":
    load_local_env(ROOT_DIR)
BACKEND_DIR = ROOT_DIR / "backend"

_APP_DATA_DIR_VALUE = os.getenv("QIGOU_APP_DATA_DIR", "").strip()
if _APP_DATA_DIR_VALUE:
    APP_DATA_DIR = Path(_APP_DATA_DIR_VALUE).expanduser().resolve()
    DATA_DIR = Path(os.getenv("QIGOU_DATA_DIR", str(APP_DATA_DIR / "data"))).expanduser().resolve()
    WORKSPACE_DIR = Path(os.getenv("QIGOU_WORKSPACE_DIR", str(APP_DATA_DIR / "workspace"))).expanduser().resolve()
else:
    APP_DATA_DIR = ROOT_DIR
    DATA_DIR = BACKEND_DIR / "data"
    WORKSPACE_DIR = ROOT_DIR / "workspace"

PROJECTS_DIR = WORKSPACE_DIR / "projects"
OUTPUTS_DIR = WORKSPACE_DIR / "outputs"
LOGS_DIR = WORKSPACE_DIR / "logs"
CACHE_DIR = WORKSPACE_DIR / "cache"
TEMP_DIR = WORKSPACE_DIR / "temp"
DATABASE_PATH = DATA_DIR / "interior_ai_studio.db"
DATABASE_URL = os.getenv("INTERIOR_AI_STUDIO_DATABASE_URL", f"sqlite:///{DATABASE_PATH.as_posix()}")


def ensure_runtime_directories() -> None:
    for path in (
        DATA_DIR,
        WORKSPACE_DIR,
        PROJECTS_DIR,
        OUTPUTS_DIR,
        LOGS_DIR,
        LOGS_DIR / "mock-renderer",
        CACHE_DIR,
        TEMP_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
