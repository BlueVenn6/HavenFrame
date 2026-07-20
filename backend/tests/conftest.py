import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


os.environ["INTERIOR_AI_STUDIO_SKIP_LOCAL_ENV"] = "1"
for provider_env_name in (
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "ZHIPU_API_KEY",
    "ZAI_API_KEY",
    "ARK_API_KEY",
    "OPENAI_RELAY_BASE_URL",
    "OPENAI_RELAY_API_KEY",
    "OPENAI_RELAY_MODEL",
    "GEMINI_RELAY_BASE_URL",
    "GEMINI_RELAY_API_KEY",
    "CUSTOM_REST_BASE_URL",
    "CUSTOM_REST_API_KEY",
    "VOLCENGINE_ACCESS_KEY_ID",
    "VOLCENGINE_SECRET_ACCESS_KEY",
    "JIMENG_ACCESS_KEY",
    "JIMENG_SECRET_KEY",
    "LIVE_COSTLY_MODEL_TESTS",
):
    os.environ.pop(provider_env_name, None)
_TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="interior-ai-studio-test-"))
_TEST_DATABASE_URL = f"sqlite:///{(_TEST_DATA_DIR / 'interior_ai_studio_test.db').as_posix()}"
os.environ["INTERIOR_AI_STUDIO_DATABASE_URL"] = _TEST_DATABASE_URL
os.environ["QIGOU_APP_DATA_DIR"] = str(_TEST_DATA_DIR)
os.environ["INTERIOR_AI_STUDIO_LOCAL_RUNTIME_CONFIG"] = str(_TEST_DATA_DIR / "local-runtime.json")
os.environ["QIGOU_LOCAL_API_TOKEN_PATH"] = str(_TEST_DATA_DIR / "local-api-token")
os.environ["QIGOU_ALLOWED_HOSTS"] = "testserver"


@pytest.fixture(scope="session")
def test_database_url(tmp_path_factory: pytest.TempPathFactory) -> str:
    return os.environ["INTERIOR_AI_STUDIO_DATABASE_URL"]


@pytest.fixture(scope="session")
def client(test_database_url: str):
    from backend.main import app

    with TestClient(app) as test_client:
        test_client.get("/api/security/session")
        if not test_client.get("/api/projects").json():
            created = test_client.post(
                "/api/projects",
                json={"name": "自动化测试项目", "status": "active"},
            )
            assert created.status_code == 200, created.text
        yield test_client
