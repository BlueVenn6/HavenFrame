import json

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.db.models import Base, ModelConfig, Task
from backend.services import model_service
from backend.services.task_service import _find_recent_duplicate_provider_task, _provider_task_timeout


def test_running_provider_task_with_same_signature_is_reused():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        task = Task(
            project_id=7,
            module="multi_room_board",
            task_type="provider_multi_room_board",
            provider="OpenAI",
            model_name="gpt-image-2",
            status="running",
            progress=15,
            input_payload_json=json.dumps({"payload_json": {"asset_ids": [1, 2]}}),
            prompt_snapshot_json=json.dumps({"resolved_prompt": "Generate one board."}),
            params_snapshot_json=json.dumps({"request_signature": "same-request"}),
        )
        session.add(task)
        session.commit()

        duplicate = _find_recent_duplicate_provider_task(
            session,
            module="multi_room_board",
            task_type="provider_multi_room_board",
            project_id=7,
            request_signature="same-request",
        )

        assert duplicate is not None
        assert duplicate["id"] == task.id
        assert duplicate["status"] == "running"
    finally:
        session.close()


def test_provider_task_timeout_uses_saved_config_when_request_omits_timeout():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        config = ModelConfig(
            provider_type="openai_compatible",
            provider_name="OpenAI-Compatible Relay",
            routing_mode="relay_base_url",
            base_url="https://relay.local.test/v1",
            model_name="gpt-image-2",
            timeout_sec=360,
        )
        session.add(config)
        session.commit()

        assert _provider_task_timeout(session, config.id, {}) == 900
        assert _provider_task_timeout(session, config.id, {"timeout_sec": 120}) == 900
        assert _provider_task_timeout(session, config.id, {"timeout_sec": 1200}) == 1200
    finally:
        session.close()


def test_existing_image_config_timeout_is_migrated_without_touching_route():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        config = ModelConfig(
            provider_type="openai_compatible",
            provider_name="OpenAI-Compatible Relay",
            routing_mode="relay_base_url",
            base_url="https://relay.local.test/v1",
            model_name="gpt-image-2",
            timeout_sec=120,
            extra_config_json='{"provider_id":"openai","model_id":"gpt-image-2","capability":"image"}',
        )
        session.add(config)
        session.commit()

        assert model_service.migrate_image_generation_timeouts(session) == 1
        session.refresh(config)
        assert config.timeout_sec == 900
        assert config.base_url == "https://relay.local.test/v1"
        assert model_service.migrate_image_generation_timeouts(session) == 0
    finally:
        session.close()
