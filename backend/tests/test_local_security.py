import json
import os
import subprocess
import sys

from fastapi.testclient import TestClient


def test_api_requires_local_token(test_database_url: str):
    from backend.main import app

    with TestClient(app) as raw_client:
        response = raw_client.get("/api/projects")

    assert response.status_code == 401
    assert "local API token" in response.json()["detail"]


def test_security_session_allows_same_origin_api_access(test_database_url: str):
    from backend.main import app

    with TestClient(app) as raw_client:
        session = raw_client.get("/api/security/session", headers={"origin": "http://127.0.0.1:5173"})
        assert session.status_code == 200
        cookie = session.headers["set-cookie"].lower()
        assert "httponly" in cookie
        assert "samesite=strict" in cookie
        token = session.json()["token"]
        response = raw_client.get(
            "/api/projects",
            headers={"origin": "http://127.0.0.1:5173", "X-Qigou-Local-Token": token},
        )

    assert response.status_code == 200


def test_tauri_origin_cross_site_can_get_session_and_call_api(test_database_url: str):
    from backend.main import app

    tauri_headers = {
        "host": "127.0.0.1:8000",
        "origin": "http://tauri.localhost",
        "referer": "http://tauri.localhost/",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "cors",
    }

    with TestClient(app, base_url="http://127.0.0.1:8000") as raw_client:
        session = raw_client.get("/api/security/session", headers=tauri_headers)
        assert session.status_code == 200
        token = session.json()["token"]
        response = raw_client.get(
            "/api/projects",
            headers={**tauri_headers, "X-Qigou-Local-Token": token},
        )

    assert response.status_code == 200


def test_unknown_cross_site_origin_is_still_rejected(test_database_url: str):
    from backend.main import app

    with TestClient(app, base_url="http://127.0.0.1:8000") as raw_client:
        response = raw_client.get(
            "/api/security/session",
            headers={
                "host": "127.0.0.1:8000",
                "origin": "https://evil.example",
                "referer": "https://evil.example/",
                "sec-fetch-site": "cross-site",
                "sec-fetch-mode": "cors",
            },
        )

    assert response.status_code == 403
    assert response.json()["detail"] == "Origin is not allowed."


def test_tauri_origin_without_token_still_cannot_call_api(test_database_url: str):
    from backend.main import app

    with TestClient(app, base_url="http://127.0.0.1:8000") as raw_client:
        response = raw_client.get(
            "/api/projects",
            headers={
                "host": "127.0.0.1:8000",
                "origin": "http://tauri.localhost",
                "referer": "http://tauri.localhost/",
                "sec-fetch-site": "cross-site",
                "sec-fetch-mode": "cors",
            },
        )

    assert response.status_code == 401
    assert "local API token" in response.json()["detail"]


def test_tauri_origin_with_non_loopback_host_is_rejected(test_database_url: str):
    from backend.main import app

    with TestClient(app, base_url="http://evil.example") as raw_client:
        response = raw_client.get(
            "/api/security/session",
            headers={
                "host": "evil.example",
                "origin": "http://tauri.localhost",
                "sec-fetch-site": "cross-site",
                "sec-fetch-mode": "cors",
            },
        )

    assert response.status_code == 403
    assert response.json()["detail"] == "Host is not allowed."


def test_asset_content_allows_tauri_image_fetch_with_query_token(test_database_url: str, tmp_path):
    from backend.core.config import PROJECTS_DIR
    from backend.core.database import SessionLocal
    from backend.db.models import Asset
    from backend.main import app

    asset_dir = PROJECTS_DIR / "security-test" / "assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    image_path = asset_dir / "safe-preview.png"
    image_path.write_bytes(b"not-a-real-png-but-file-response-ok")

    with SessionLocal() as db:
        asset = Asset(
            project_id=1,
            type="render_output",
            file_name="safe-preview.png",
            file_path=str(image_path),
            mime_type="image/png",
            source="test",
        )
        db.add(asset)
        db.commit()
        asset_id = asset.id

    with TestClient(app, base_url="http://127.0.0.1:8000") as raw_client:
        session = raw_client.get(
            "/api/security/session",
            headers={
                "host": "127.0.0.1:8000",
                "origin": "http://tauri.localhost",
                "sec-fetch-site": "cross-site",
                "sec-fetch-mode": "cors",
            },
        )
        assert session.status_code == 200
        token = session.json()["token"]
        response = raw_client.get(
            f"/api/assets/{asset_id}/content?local_token={token}",
            headers={
                "host": "127.0.0.1:8000",
                "sec-fetch-site": "cross-site",
                "sec-fetch-mode": "no-cors",
            },
        )

    assert response.status_code == 200


def test_asset_content_cross_site_without_token_is_rejected(test_database_url: str, tmp_path):
    from backend.core.config import PROJECTS_DIR
    from backend.core.database import SessionLocal
    from backend.db.models import Asset
    from backend.main import app

    asset_dir = PROJECTS_DIR / "security-test" / "assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    image_path = asset_dir / "safe-preview-no-token.png"
    image_path.write_bytes(b"not-a-real-png-but-file-response-ok")

    with SessionLocal() as db:
        asset = Asset(
            project_id=1,
            type="render_output",
            file_name="safe-preview-no-token.png",
            file_path=str(image_path),
            mime_type="image/png",
            source="test",
        )
        db.add(asset)
        db.commit()
        asset_id = asset.id

    with TestClient(app, base_url="http://127.0.0.1:8000") as raw_client:
        response = raw_client.get(
            f"/api/assets/{asset_id}/content",
            headers={
                "host": "127.0.0.1:8000",
                "sec-fetch-site": "cross-site",
                "sec-fetch-mode": "no-cors",
            },
        )

    assert response.status_code == 403
    assert response.json()["detail"] == "Cross-site requests are not allowed."


def test_cross_site_origin_is_rejected(test_database_url: str):
    from backend.main import app

    with TestClient(app) as raw_client:
        response = raw_client.get("/api/security/session", headers={"origin": "https://evil.example"})

    assert response.status_code == 403
    assert response.json()["detail"] == "Origin is not allowed."


def test_abnormal_host_is_rejected(test_database_url: str):
    from backend.main import app

    with TestClient(app) as raw_client:
        response = raw_client.get("/health", headers={"host": "evil.example"})

    assert response.status_code == 403
    assert response.json()["detail"] == "Host is not allowed."


def test_cloud_profile_excludes_desktop_routes_and_requires_bearer(tmp_path):
    script = r'''
import json
from fastapi.testclient import TestClient
from backend.core.database import SessionLocal
from backend.db.models import Asset
from backend.main import app

with TestClient(app) as client:
    routes = set(app.openapi()["paths"])
    no_auth = client.get("/api/projects")
    auth = client.get("/api/projects", headers={"Authorization": "Bearer cloud-test-token"})
    with SessionLocal() as db:
        asset = Asset(project_id=1, type="render_output", file_name="cloud.png", file_path="C:/server/workspace/cloud.png", mime_type="image/png", source="test")
        db.add(asset)
        db.commit()
    assets = client.get("/api/assets?project_id=1", headers={"Authorization": "Bearer cloud-test-token"}).json()
    capabilities = client.get("/api/platform/capabilities").json()
    preflight = client.options(
        "/api/projects",
        headers={
            "Origin": "https://mobile.qigou.cn",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization",
        },
    )
    print(json.dumps({
        "has_local": "/api/local/status" in routes,
        "has_render_engines": "/api/render-engines" in routes,
        "has_project_open": "/api/projects/{project_id}/open-folder" in routes,
        "has_asset_open": "/api/assets/{asset_id}/open-file" in routes,
        "has_export_open": "/api/exports/{export_id}/open-file" in routes,
        "no_auth": no_auth.status_code,
        "auth": auth.status_code,
        "cloud_file_path": assets[0]["file_path"],
        "capabilities": capabilities,
        "preflight": preflight.status_code,
        "allow_headers": preflight.headers.get("access-control-allow-headers", ""),
    }))
'''
    env = os.environ.copy()
    env.update(
        {
            "INTERIOR_AI_STUDIO_SKIP_LOCAL_ENV": "1",
            "INTERIOR_AI_STUDIO_DATABASE_URL": f"sqlite:///{(tmp_path / 'cloud.db').as_posix()}",
            "QIGOU_APP_DATA_DIR": str(tmp_path / "cloud-data"),
            "QIGOU_API_PROFILE": "cloud",
            "QIGOU_ALLOWED_HOSTS": "testserver",
            "QIGOU_ALLOWED_ORIGINS": "https://mobile.qigou.cn",
            "QIGOU_CLOUD_BEARER_TOKENS": "cloud-test-token",
        }
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=os.getcwd(),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout.strip().splitlines()[-1])
    assert payload["has_local"] is False
    assert payload["has_render_engines"] is False
    assert payload["has_project_open"] is False
    assert payload["has_asset_open"] is False
    assert payload["has_export_open"] is False
    assert payload["no_auth"] == 401
    assert payload["auth"] == 200
    assert payload["cloud_file_path"].startswith("/api/assets/")
    assert "local_deployment" not in payload["capabilities"]
    assert "local_renderer" not in payload["capabilities"]
    assert payload["preflight"] == 200
    assert "Authorization" in payload["allow_headers"]
