import base64
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.core.config import PROJECTS_DIR
from backend.core.database import SessionLocal
from backend.db.models import Asset, BoardDocument, ExtractedItem, ModelConfig, Project, Task
from backend.services import asset_service, board_service, export_service, model_service, task_service


ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _create_real_board_data() -> tuple[int, int, int, list[int], int, str]:
    with SessionLocal() as db:
        project = Project(
            name="中文客户住宅",
            client_name="林女士",
            style_tags="现代暖调",
            room_types="客厅",
            archive_root_path=str(PROJECTS_DIR / "release-export-project"),
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        asset = asset_service.create_uploaded_asset(
            db,
            project_id=project.id,
            file_name="客厅.png",
            file_bytes=ONE_PIXEL_PNG,
            asset_type="room_input",
            mime_type="image/png",
            room_type="客厅",
            source="single_room_board",
        )
        extracted_item = ExtractedItem(
                project_id=project.id,
                asset_id=asset["id"],
                room_type="客厅",
                category="家具",
                name="三人沙发",
                material="棉麻",
                color="米白",
                price_min=6800,
                price_max=9200,
                notes=json.dumps(
                    {
                        "selection_state": "keep",
                        "summary": "保留现有沙发",
                        "review_schema_version": 2,
                        "selection_updated_at": "2026-07-12T00:00:00+00:00",
                        "procurement_status": "pending",
                        "quantity": 1,
                        "purchase_method": "品牌官网",
                        "purchase_url": "https://example.test/sofa",
                    },
                    ensure_ascii=False,
                ),
            )
        db.add(extracted_item)
        db.commit()
        db.refresh(extracted_item)
        review_snapshot = json.dumps(
            [{
                "id": extracted_item.id,
                "price_min": 6800,
                "price_max": 9200,
                "procurement_status": "pending",
                "quantity": 1,
                "purchase_method": "品牌官网",
                "purchase_url": "https://example.test/sofa",
            }],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        result = board_service.generate_single_room_board(
            db,
            {
                "project_id": project.id,
                "asset_id": asset["id"],
                "room_type": "客厅",
                "style": "现代暖调",
                "selected_item_ids": [extracted_item.id],
                "params_snapshot": {
                    "source_asset_ids": [asset["id"]],
                    "selected_item_ids": [extracted_item.id],
                    "review_schema_version": 2,
                    "delivery_prompt_version": "qigou-board-delivery-v2",
                    "review_snapshot": review_snapshot,
                },
            },
        )
        board_ids = [board["id"] for board in result["board_documents"]]
        board_ids.append(result["quote_card"]["board_document"]["id"])
        generated = asset_service.create_generated_output_asset(
            db,
            project_id=project.id,
            module="single_room_board",
            file_bytes=ONE_PIXEL_PNG,
            mime_type="image/png",
            provider="OpenAI Relay",
            model_name="gpt-image-2",
            source_asset_ids=[asset["id"]],
            metadata={
                "review_schema_version": 2,
                "selected_item_ids": [extracted_item.id],
                "delivery_prompt_version": "qigou-board-delivery-v2",
                "review_snapshot": review_snapshot,
            },
        )
        return project.id, asset["id"], extracted_item.id, board_ids, generated["id"], review_snapshot


def _report_payload(project_id: int, asset_id: int, item_id: int, board_ids: list[int], generated_asset_id: int, review_snapshot: str) -> dict:
    return {
        "project_id": project_id,
        "file_name": "客户方案板.svg",
        "title": "林女士客厅方案",
        "board_document_ids": board_ids,
        "mode": "single",
        "source_asset_ids": [asset_id],
        "selected_item_ids": [item_id],
        "generated_asset_id": generated_asset_id,
        "review_snapshot": review_snapshot,
        "delivery_prompt_version": "qigou-board-delivery-v2",
    }


def test_delete_uploaded_asset_removes_extraction_rows_but_preserves_archived_file(tmp_path: Path, client: TestClient):
    archived_file = tmp_path / "客户参考图.png"
    archived_file.write_bytes(ONE_PIXEL_PNG)
    with SessionLocal() as db:
        project = Project(
            name="删除素材验证",
            archive_root_path=str(tmp_path),
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        asset = Asset(
            project_id=project.id,
            type="space_reference",
            file_name=archived_file.name,
            file_path=str(archived_file),
            mime_type="image/png",
            source="space_render_reference",
        )
        db.add(asset)
        db.commit()
        db.refresh(asset)
        item = ExtractedItem(project_id=project.id, asset_id=asset.id, name="沙发")
        db.add(item)
        db.commit()

        assert asset_service.delete_asset(db, asset.id) is True
        assert db.get(Asset, asset.id) is None
        assert db.query(ExtractedItem).filter(ExtractedItem.asset_id == asset.id).count() == 0
        assert archived_file.is_file()


def test_board_delivery_image_and_utf8_table_are_real_files(client: TestClient):
    project_id, asset_id, item_id, board_ids, generated_asset_id, review_snapshot = _create_real_board_data()

    image_response = client.post(
        "/api/exports/report-image",
        json=_report_payload(project_id, asset_id, item_id, board_ids, generated_asset_id, review_snapshot),
    )
    assert image_response.status_code == 200, image_response.text
    image_export = image_response.json()
    image_path = Path(image_export["file_path"])
    assert image_export["type"] == "image_report"
    assert image_path.is_file()
    image_content = image_path.read_text(encoding="utf-8")
    assert "中文客户住宅" in image_content
    assert "林女士" in image_content
    assert "方案板主视觉" in image_content
    assert "保留元素与预算明细" in image_content
    assert "GLM" not in image_content
    assert "Provider" not in image_content
    assert "gpt-image-2" not in image_content
    assert "…" not in image_content
    assert "data:image/png;base64," in image_content
    assert 'viewBox="0 0 1240 1754"' in image_content
    assert 'width="100%" height="auto"' in image_content
    assert "@page { size: A4 portrait; margin: 0; }" in image_content
    assert "HAVENFRAME · A4 DELIVERY" in image_content

    table_response = client.post(
        "/api/exports/table",
        json={
            "project_id": project_id,
            "file_name": "预算清单.csv",
            "asset_ids": [asset_id],
            "selected_item_ids": [item_id],
            "review_snapshot": review_snapshot,
            "selected_only": True,
        },
    )
    assert table_response.status_code == 200, table_response.text
    table_export = table_response.json()
    table_bytes = Path(table_export["file_path"]).read_bytes()
    assert table_bytes.startswith(b"\xef\xbb\xbf")
    decoded = table_bytes.decode("utf-8-sig")
    assert "项目,房间,类型,产品" in decoded
    assert "中文客户住宅,客厅,家具,三人沙发,1,棉麻,米白,6800.0,9200.0,保留,未采购,品牌官网,https://example.test/sofa" in decoded


def test_formal_report_constrains_long_mixed_language_text(client: TestClient, tmp_path: Path):
    material_text = "布艺 / 浅色石材或仿石材质 / 金属框架与织物坐垫 / 超长补充材质说明"
    color_text = "浅米色 / 深棕色 / 浅色带图案 / 浅灰色 / 白色 / 黄铜色"
    material_lines = export_service._wrap_visual_text(material_text, 34)
    color_lines = export_service._wrap_visual_text(color_text, 34)
    assert len(material_lines) >= 2
    assert len(color_lines) >= 2
    assert all(export_service._visual_text_units(line) <= 34 for line in material_lines + color_lines)
    assert "…" not in "".join(material_lines + color_lines)
    for value in ("布艺", "浅色石材或仿石材质", "金属框架与织物坐垫", "超长补充材质说明"):
        assert any(value in line for line in material_lines)
    for value in ("浅米色", "深棕色", "浅色带图案", "浅灰色", "白色", "黄铜色"):
        assert any(value in line for line in color_lines)

    project_id, asset_id, item_id, board_ids, generated_asset_id, review_snapshot = _create_real_board_data()
    with SessionLocal() as db:
        project = db.get(Project, project_id)
        item = db.get(ExtractedItem, item_id)
        asset = db.get(Asset, asset_id)
        assert project is not None and item is not None and asset is not None
        project.name = "这是一个非常长的中文客户住宅项目名称用于验证标题不会越过页面边界"
        project.client_name = "具有很长名称的客户与设计工作室"
        project.style_tags = "现代暖调与自然材质融合并包含多种空间设计方向"
        item.name = "带有超长产品名称的模块化组合沙发与贵妃榻及配套边几"
        item.material = material_text
        item.color = color_text
        asset.room_type = "客厅与开放式餐厅及多功能展示空间"
        db.commit()

    payload = _report_payload(project_id, asset_id, item_id, board_ids, generated_asset_id, review_snapshot)
    payload.update({"file_name": "long-text-a4-report.svg", "output_language": "zh-CN"})
    response = client.post("/api/exports/report-image", json=payload)
    assert response.status_code == 200, response.text
    content = Path(response.json()["file_path"]).read_text(encoding="utf-8")
    assert 'clipPath id="header-content-clip"' in content
    assert 'clipPath id="summary-content-clip"' in content
    assert 'clipPath id="summary-material-value-clip"' not in content
    assert 'clipPath id="summary-color-value-clip"' not in content
    assert 'clipPath id="source-caption-0"' not in content
    assert 'clipPath id="item-heading-clip"' in content
    assert 'clipPath id="item-overflow-note-clip"' in content
    assert 'clipPath id="footer-note-clip"' in content
    assert content.count('<tspan x="848"') >= 7
    assert "…" not in content
    assert "OpenAI Relay" not in content
    assert "gpt-image-2" not in content
    for value in ("浅色石材或仿石材质", "金属框架与织物坐垫", "超长补充材质说明"):
        assert value in content
    for value in ("浅色带图案", "黄铜色"):
        assert value in content

    full_page_items = [
        ExtractedItem(
            id=10_000 + index,
            project_id=project_id,
            asset_id=asset_id,
            room_type=f"超长房间名称与多功能空间 {index + 1}",
            category="家具与软装",
            name=f"{index + 1:02d} 带有超长产品名称的模块化组合家具与定制配套边几",
            material=material_text,
            color=color_text,
            price_min=6800 + index * 100,
            price_max=9200 + index * 100,
            notes=json.dumps(
                {
                    "procurement_status": "pending",
                    "purchase_method": "品牌官方网站、授权线下门店或指定电商采购渠道",
                },
                ensure_ascii=False,
            ),
        )
        for index in range(12)
    ]
    with SessionLocal() as db:
        project = db.get(Project, project_id)
        asset = db.get(Asset, asset_id)
        generated_asset = db.get(Asset, generated_asset_id)
        assert project is not None and asset is not None and generated_asset is not None
        full_page_content = export_service._render_formal_board_report_svg(
            db=db,
            title="长文本满页报告",
            project=project,
            mode="multi",
            hero_asset=generated_asset,
            hero_is_generated=True,
            source_assets=[asset],
            selected_items=full_page_items,
            output_language="zh-CN",
        )
    full_page_path = tmp_path / "full-page-long-text-a4-report.svg"
    full_page_path.write_text(full_page_content, encoding="utf-8")
    assert "…" not in full_page_content
    assert "本页完整展示前 6 项" in full_page_content
    assert "OpenAI Relay" not in full_page_content
    assert "gpt-image-2" not in full_page_content


def test_english_board_delivery_localizes_fixed_report_and_table_labels(client: TestClient):
    project_id, asset_id, item_id, board_ids, generated_asset_id, review_snapshot = _create_real_board_data()
    report_payload = _report_payload(project_id, asset_id, item_id, board_ids, generated_asset_id, review_snapshot)
    report_payload.update({"file_name": "english-report.svg", "title": "Client Board", "output_language": "en"})

    report_response = client.post("/api/exports/report-image", json=report_payload)

    assert report_response.status_code == 200, report_response.text
    report_content = Path(report_response.json()["file_path"]).read_text(encoding="utf-8")
    assert "HavenFrame · Client Delivery" in report_content
    assert "Delivery Summary" in report_content
    assert "Extracted Details + Review" in report_content
    assert "Retained Items and Budget" in report_content
    assert "GLM" not in report_content
    assert "Provider" not in report_content
    assert "gpt-image-2" not in report_content
    assert "…" not in report_content
    assert "栖构 · 客户正式交付" not in report_content

    table_response = client.post(
        "/api/exports/table",
        json={
            "project_id": project_id,
            "file_name": "english-procurement.csv",
            "asset_ids": [asset_id],
            "selected_item_ids": [item_id],
            "review_snapshot": review_snapshot,
            "selected_only": True,
            "output_language": "en",
        },
    )

    assert table_response.status_code == 200, table_response.text
    table_bytes = Path(table_response.json()["file_path"]).read_bytes()
    assert table_bytes.startswith(b"\xef\xbb\xbf")
    decoded = table_bytes.decode("utf-8-sig")
    assert decoded.startswith("Project,Room,Category,Product,Quantity,Material,Color,Minimum Budget,Maximum Budget,Selection")
    assert ",Keep,Not purchased," in decoded


def test_board_delivery_does_not_claim_an_unset_design_direction(client: TestClient):
    project_id, asset_id, item_id, board_ids, generated_asset_id, review_snapshot = _create_real_board_data()
    with SessionLocal() as db:
        project = db.get(Project, project_id)
        assert project is not None
        project.style_tags = ""
        db.commit()

    payload = _report_payload(project_id, asset_id, item_id, board_ids, generated_asset_id, review_snapshot)
    payload.update({"file_name": "unset-direction-en.svg", "output_language": "en"})
    english_response = client.post("/api/exports/report-image", json=payload)
    assert english_response.status_code == 200, english_response.text
    english_content = Path(english_response.json()["file_path"]).read_text(encoding="utf-8")
    assert "Design direction not specified" in english_content
    assert "Confirmed design direction" not in english_content
    assert "Design direction not specifi…" not in english_content

    payload.update({"file_name": "unset-direction-zh.svg", "output_language": "zh-CN"})
    chinese_response = client.post("/api/exports/report-image", json=payload)
    assert chinese_response.status_code == 200, chinese_response.text
    chinese_content = Path(chinese_response.json()["file_path"]).read_text(encoding="utf-8")
    assert "设计方向未填写" in chinese_content
    assert "已确认设计方向" not in chinese_content


def test_report_export_can_use_current_source_without_generated_image(client: TestClient):
    project_id, asset_id, item_id, board_ids, _, review_snapshot = _create_real_board_data()
    payload = _report_payload(project_id, asset_id, item_id, board_ids, 1, review_snapshot)
    payload.pop("generated_asset_id")
    payload["file_name"] = "source-only-report.svg"

    response = client.post("/api/exports/report-image", json=payload)

    assert response.status_code == 200, response.text
    exported = response.json()
    assert exported["export_config_json"]["generated_asset_id"] is None
    assert exported["export_config_json"]["hero_asset_id"] == asset_id
    assert exported["export_config_json"]["hero_source"] == "source_asset"
    content = Path(exported["file_path"]).read_text(encoding="utf-8")
    assert "项目源图 / 报告依据" in content
    assert "未调用图片模型" not in content
    assert "Provider" not in content
    assert "gpt-image-2" not in content
    assert "…" not in content


def test_procurement_fields_persist_through_item_patch(client: TestClient):
    project_id, asset_id, item_id, _, _, _ = _create_real_board_data()
    response = client.patch(
        f"/api/workflows/softboard/extracted-items/{item_id}",
        json={
            "selection_state": "keep",
            "price_min": 7000,
            "price_max": 9500,
            "procurement_status": "purchased",
            "quantity": 2,
            "purchase_method": "线下门店",
            "purchase_url": "https://example.test/purchased-sofa",
        },
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["project_id"] == project_id
    assert updated["asset_id"] == asset_id
    assert updated["price_min"] == 7000
    assert updated["price_max"] == 9500
    assert updated["procurement_status"] == "purchased"
    assert updated["quantity"] == 2
    assert updated["purchase_method"] == "线下门店"
    assert updated["purchase_url"] == "https://example.test/purchased-sofa"

    invalid = client.patch(
        f"/api/workflows/softboard/extracted-items/{item_id}",
        json={"purchase_url": "file:///C:/secret.txt"},
    )
    assert invalid.status_code == 422


def test_formal_report_rejects_stale_review_snapshot(client: TestClient):
    project_id, asset_id, item_id, board_ids, generated_asset_id, review_snapshot = _create_real_board_data()
    payload = _report_payload(project_id, asset_id, item_id, board_ids, generated_asset_id, review_snapshot)
    payload["review_snapshot"] = "[]"
    response = client.post("/api/exports/report-image", json=payload)
    assert response.status_code == 400
    assert "快照" in response.json()["detail"] or "人工确认结果" in response.json()["detail"]


def test_multi_room_board_generates_all_preview_assets(client: TestClient):
    with SessionLocal() as db:
        project = Project(name="多房间验收项目", archive_root_path=str(PROJECTS_DIR / "multi-room-board"))
        db.add(project)
        db.commit()
        db.refresh(project)
        asset_ids = []
        for room_name in ("客厅", "卧室"):
            asset = asset_service.create_uploaded_asset(
                db,
                project_id=project.id,
                file_name=f"{room_name}.png",
                file_bytes=ONE_PIXEL_PNG,
                asset_type="room_input",
                mime_type="image/png",
                room_type=room_name,
                source="multi_room_board",
            )
            asset_ids.append(asset["id"])
            db.add(
                ExtractedItem(
                    project_id=project.id,
                    asset_id=asset["id"],
                    room_type=room_name,
                    category="家具",
                    name=f"{room_name}家具",
                    material="木材",
                    color="原木色",
                    price_min=3000,
                    price_max=5000,
                )
            )
        db.commit()

        result = board_service.generate_multi_room_board(
            db,
            {
                "project_id": project.id,
                "asset_ids": asset_ids,
                "room_tags": {str(asset_ids[0]): "客厅", str(asset_ids[1]): "卧室"},
                "integrated_board_title": "整屋综合方案板",
            },
        )
        documents = result["board_documents"]
        assert len(documents) == 4
        assert {document["board_type"] for document in documents} == {
            "integrated_board",
            "budget_summary",
            "split_room_board",
        }
        for document in documents:
            preview = db.get(Asset, document["preview_asset_id"])
            assert preview is not None
            preview_path = Path(preview.file_path)
            assert preview_path.is_file()
            assert "<svg" in preview_path.read_text(encoding="utf-8")


def test_reviewed_multi_room_board_excludes_stale_and_removed_items(client: TestClient):
    with SessionLocal() as db:
        project = Project(name="当前两房间", archive_root_path=str(PROJECTS_DIR / "reviewed-multi-room"))
        db.add(project)
        db.commit()
        db.refresh(project)
        assets = []
        for room_name in ("客厅", "餐厅", "历史卧室"):
            assets.append(
                asset_service.create_uploaded_asset(
                    db,
                    project_id=project.id,
                    file_name=f"{room_name}.png",
                    file_bytes=ONE_PIXEL_PNG,
                    asset_type="room_input",
                    mime_type="image/png",
                    room_type=room_name,
                    source="multi_room_board",
                )
            )

        def reviewed_item(asset_id: int, room: str, name: str, state: str, minimum=None, maximum=None):
            item = ExtractedItem(
                project_id=project.id,
                asset_id=asset_id,
                room_type=room,
                category="家具",
                name=name,
                price_min=minimum,
                price_max=maximum,
                notes=json.dumps(
                    {"selection_state": state, "selection_updated_at": "2026-07-12T00:00:00+00:00", "review_schema_version": 2},
                    ensure_ascii=False,
                ),
            )
            db.add(item)
            db.flush()
            return item

        sofa = reviewed_item(assets[0]["id"], "客厅", "深灰沙发", "keep", 6000, 9000)
        reviewed_item(assets[0]["id"], "客厅", "误识别双人床", "remove")
        table = reviewed_item(assets[1]["id"], "餐厅", "长方形餐桌", "keep", 3000, 5000)
        reviewed_item(assets[2]["id"], "卧室", "历史双人床", "keep", 8000, 12000)
        db.commit()

        result = board_service.generate_multi_room_board(
            db,
            {
                "project_id": project.id,
                "asset_ids": [assets[0]["id"], assets[1]["id"]],
                "selected_item_ids": [sofa.id, table.id],
                "room_tags": {
                    str(assets[0]["id"]): "客厅",
                    str(assets[1]["id"]): "餐厅",
                    "legacy-room": "卧室",
                },
                "integrated_board_title": "当前两房间方案板",
            },
        )

        integrated = next(item for item in result["board_documents"] if item["board_type"] == "integrated_board")
        data = integrated["data_json"]
        names = [item["name"] for item in data["selected_items"]]
        assert names == ["长方形餐桌", "深灰沙发"] or names == ["深灰沙发", "长方形餐桌"]
        assert "误识别双人床" not in names
        assert "历史双人床" not in names
        assert data["rooms"] == ["客厅", "餐厅"]
        assert result["budget_summary"]["range_min"] == 9000
        assert result["budget_summary"]["range_max"] == 14000
        assert len([item for item in result["board_documents"] if item["board_type"] == "split_room_board"]) == 2


def test_explicit_selection_does_not_require_complete_review_or_budget(client: TestClient):
    with SessionLocal() as db:
        project = Project(name="人工确认校验", archive_root_path=str(PROJECTS_DIR / "review-validation"))
        db.add(project)
        db.commit()
        db.refresh(project)
        asset = asset_service.create_uploaded_asset(
            db,
            project_id=project.id,
            file_name="客厅.png",
            file_bytes=ONE_PIXEL_PNG,
            asset_type="room_input",
            mime_type="image/png",
            room_type="客厅",
            source="single_room_board",
        )
        item = ExtractedItem(
            project_id=project.id,
            asset_id=asset["id"],
            room_type="客厅",
            category="家具",
            name="沙发",
            notes=json.dumps({"selection_state": "keep"}, ensure_ascii=False),
        )
        db.add(item)
        db.commit()
        db.refresh(item)

        payload = {
            "project_id": project.id,
            "asset_id": asset["id"],
            "room_type": "客厅",
            "selected_item_ids": [item.id],
        }
        result = board_service.generate_single_room_board(db, payload)
        assert result["task"]["status"] == "success"
        assert result["quote_card"]["items"][0]["name"] == "沙发"
        assert result["quote_card"]["items"][0]["price_min"] is None


def test_single_room_board_without_extraction_is_independent(client: TestClient):
    with SessionLocal() as db:
        project = Project(name="无提取单房间", archive_root_path=str(PROJECTS_DIR / "single-no-extraction"))
        db.add(project)
        db.commit()
        db.refresh(project)
        asset = asset_service.create_uploaded_asset(
            db,
            project_id=project.id,
            file_name="客厅.png",
            file_bytes=ONE_PIXEL_PNG,
            asset_type="room_input",
            mime_type="image/png",
            room_type="客厅",
            source="single_room_board",
        )
        result = board_service.generate_single_room_board(
            db,
            {"project_id": project.id, "asset_id": asset["id"], "room_type": "客厅", "selected_item_ids": []},
        )
        assert result["task"]["status"] == "success"
        assert result["quote_card"]["items"] == []


def test_english_single_room_board_preview_uses_havenframe_labels(client: TestClient):
    with SessionLocal() as db:
        project = Project(name="English board", archive_root_path=str(PROJECTS_DIR / "english-board"))
        db.add(project)
        db.commit()
        db.refresh(project)
        asset = asset_service.create_uploaded_asset(
            db,
            project_id=project.id,
            file_name="room.png",
            file_bytes=ONE_PIXEL_PNG,
            asset_type="room_input",
            mime_type="image/png",
            room_type="Living Room",
            source="single_room_board",
        )
        result = board_service.generate_single_room_board(
            db,
            {
                "project_id": project.id,
                "asset_id": asset["id"],
                "room_type": "Living Room",
                "style": "Soft Minimal",
                "selected_item_ids": [],
                "params_snapshot": {"output_language": "en"},
            },
        )
        preview_asset = db.get(Asset, result["board_documents"][0]["preview_asset_id"])
        assert preview_asset is not None
        preview = Path(preview_asset.file_path).read_text(encoding="utf-8")
        assert "HavenFrame" in preview
        assert "Material Board" in preview
        assert "栖构工作台" not in preview
        assert result["quote_card"]["currency"] == "CNY"


def test_multi_room_board_without_extraction_is_independent(client: TestClient):
    with SessionLocal() as db:
        project = Project(name="无提取多房间", archive_root_path=str(PROJECTS_DIR / "multi-no-extraction"))
        db.add(project)
        db.commit()
        db.refresh(project)
        asset_ids = []
        for room in ("客厅", "餐厅"):
            asset = asset_service.create_uploaded_asset(
                db,
                project_id=project.id,
                file_name=f"{room}.png",
                file_bytes=ONE_PIXEL_PNG,
                asset_type="room_input",
                mime_type="image/png",
                room_type=room,
                source="multi_room_board",
            )
            asset_ids.append(asset["id"])
        result = board_service.generate_multi_room_board(
            db,
            {"project_id": project.id, "asset_ids": asset_ids, "selected_item_ids": []},
        )
        assert result["task"]["status"] == "success"
        assert len([item for item in result["board_documents"] if item["board_type"] == "split_room_board"]) == 2


def test_multi_room_board_failure_does_not_leave_queued_task(client: TestClient, monkeypatch):
    project_id, asset_id, _, _, _, _ = _create_real_board_data()

    def fail_preview(*_args, **_kwargs):
        raise RuntimeError("preview renderer failed")

    monkeypatch.setattr(board_service, "_create_multi_room_documents", fail_preview)
    with SessionLocal() as db:
        with pytest.raises(RuntimeError, match="preview renderer failed"):
            board_service.generate_multi_room_board(
                db,
                {
                    "project_id": project_id,
                    "asset_ids": [asset_id],
                    "room_tags": {str(asset_id): "客厅"},
                },
            )
        task = (
            db.query(Task)
            .filter(Task.project_id == project_id, Task.task_type == "generate_multi_room_board")
            .order_by(Task.id.desc())
            .first()
        )
        assert task is not None
        assert task.status == "failed"
        assert task.progress == 100
        assert task.error_message == "preview renderer failed"


def test_image_export_resolves_asset_id_and_checks_project_ownership(client: TestClient):
    project_id, asset_id, _, _, _, _ = _create_real_board_data()
    exported = client.post(
        "/api/exports/image",
        json={"project_id": project_id, "asset_id": asset_id, "file_name": "客户原图.png"},
    )
    assert exported.status_code == 200, exported.text
    payload = exported.json()
    assert Path(payload["file_path"]).read_bytes() == ONE_PIXEL_PNG
    assert payload["export_config_json"]["source_asset_id"] == asset_id
    assert "source_file_path" not in payload["export_config_json"]

    wrong_project = client.post(
        "/api/exports/image",
        json={"project_id": 1, "asset_id": asset_id, "file_name": "cross-project.png"},
    )
    assert wrong_project.status_code == 400
    assert "不属于当前项目" in wrong_project.json()["detail"]


def test_board_delivery_rejects_missing_board(client: TestClient):
    project_id, asset_id, item_id, _, generated_asset_id, review_snapshot = _create_real_board_data()
    payload = _report_payload(project_id, asset_id, item_id, [999999], generated_asset_id, review_snapshot)
    response = client.post(
        "/api/exports/report-image",
        json=payload,
    )
    assert response.status_code == 400
    assert "方案板记录不存在" in response.json()["detail"]


def test_board_delivery_rejects_text_only_fake_report(client: TestClient):
    response = client.post(
        "/api/exports/report-image",
        json={"project_id": 1, "file_name": "fake.svg", "content_sections": ["固定成功"]},
    )
    assert response.status_code == 422


def test_export_content_round_trip_and_cloud_serialization(client: TestClient, monkeypatch):
    project_id, asset_id, item_id, board_ids, generated_asset_id, review_snapshot = _create_real_board_data()
    payload = _report_payload(project_id, asset_id, item_id, board_ids, generated_asset_id, review_snapshot)
    payload.update({"file_name": "受控下载.svg", "title": "真实方案板"})
    created = client.post(
        "/api/exports/report-image",
        json=payload,
    ).json()

    content = client.get(f'/api/exports/{created["id"]}/content')
    assert content.status_code == 200
    assert content.headers["content-type"].startswith("image/svg+xml")
    assert b"data:image/png;base64," in content.content

    monkeypatch.setenv("QIGOU_API_PROFILE", "cloud")
    with SessionLocal() as db:
        listed = export_service.list_exports(db, project_id)
    assert listed[0]["file_path"] == f'/api/exports/{created["id"]}/content'
    assert listed[0]["content_path"] == listed[0]["file_path"]


def test_asset_content_recovers_from_storage_key_after_stale_absolute_path(client: TestClient, tmp_path: Path):
    project_id, _, _, board_ids, _, _ = _create_real_board_data()
    with SessionLocal() as db:
        board = db.query(BoardDocument).filter(BoardDocument.id.in_(board_ids)).first()
        assert board is not None and board.preview_asset_id is not None
        preview_asset_id = board.preview_asset_id
        asset = db.get(Asset, preview_asset_id)
        assert asset is not None
        metadata = json.loads(asset.metadata_json or "{}")
        assert metadata["storage_key"].startswith("outputs/")
        asset.file_path = str(tmp_path / "retired-install" / asset.file_name)
        db.commit()

    response = client.get(f"/api/assets/{preview_asset_id}/content")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert b"<svg" in response.content


def test_runtime_snapshot_contains_routing_without_credentials():
    with SessionLocal() as db:
        config = db.query(ModelConfig).filter(ModelConfig.model_name == "gpt-image-2").first()
        assert config is not None
        runtime = model_service.resolve_runtime_model_payload(
            db,
            {
                "provider_config_id": config.id,
                "provider_id": "openai",
                "model_id": "gpt-image-2",
                "capability": "image",
            },
        )
        snapshot = model_service.build_runtime_snapshot(db, runtime, capability="image_generation")
        assert snapshot["provider_config_id"] == config.id
        assert snapshot["model_id"] == "gpt-image-2"
        assert snapshot["config_updated_at"]
        assert "api_key" not in snapshot

        edit_snapshot = model_service.build_runtime_snapshot(db, runtime, capability="image_to_image")
        assert edit_snapshot["endpoint_path"] == "/images/edits"
        assert edit_snapshot["resolved_endpoint"].endswith("/images/edits")

        task = task_service.queue_task(
            db,
            "space_render",
            "snapshot_test",
            {"project_id": None, "params_snapshot": {"real_provider": True}},
        )
        task_service._persist_model_runtime_snapshot(db, task["id"], runtime, capability="image_generation")
        saved = db.get(Task, task["id"])
        params = json.loads(saved.params_snapshot_json or "{}")
        assert params["generation_runtime"]["resolved_endpoint"]
        assert "api_key" not in json.dumps(params)
        task_service.finalize_task(db, task["id"], {"test": "runtime_snapshot"})


def test_finalize_success_clears_previous_error():
    with SessionLocal() as db:
        task = task_service.queue_task(
            db,
            "custom_tasks",
            "provider_custom_task",
            {"project_id": None, "params_snapshot": {"real_provider": True}},
        )
        task_service.mark_task_failed(db, task["id"], "old timeout")

        result = task_service.finalize_task(db, task["id"], {"assets": [{"id": 1}]})

        assert result is not None
        assert result["status"] == "success"
        assert result["error_message"] is None


def test_replay_uses_persisted_status_and_enforces_project_ownership(client: TestClient):
    with SessionLocal() as db:
        other_project = Project(
            name="另一个项目",
            archive_root_path=str(PROJECTS_DIR / "other-replay-project"),
        )
        db.add(other_project)
        db.commit()
        db.refresh(other_project)
        other_project_id = other_project.id
        task = task_service.queue_task(
            db,
            "space_render",
            "provider_space_render",
            {
                "project_id": other_project.id,
                "provider": "OpenAI",
                "model_name": "gpt-image-2",
                "prompt_snapshot": {},
            },
        )

    wrong_project = client.get(f'/api/projects/1/replay/{task["id"]}')
    assert wrong_project.status_code == 404

    replay = client.get(f'/api/projects/{other_project_id}/replay/{task["id"]}')
    assert replay.status_code == 200
    steps = {step["label"]: step for step in replay.json()["steps"]}
    assert steps["提示词快照"]["status"] == "not_available"
    assert steps["任务执行"]["status"] == "queued"
    assert steps["输出归档"]["status"] == "not_available"
