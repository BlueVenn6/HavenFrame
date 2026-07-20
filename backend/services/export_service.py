import base64
import csv
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from backend.core.config import OUTPUTS_DIR
from backend.core.platform_capabilities import current_platform_capabilities
from backend.core.security_context import SecurityContextError, validate_workspace_path
from backend.core.serializers import model_to_dict
from backend.db.models import Asset, BoardDocument, ExportRecord, ExtractedItem, Project
from backend.services import asset_service


def list_exports(db: Session, project_id: int | None = None) -> list[dict]:
    query = db.query(ExportRecord)
    if project_id is not None:
        query = query.filter(ExportRecord.project_id == project_id)
    return [serialize_export(item) for item in query.order_by(ExportRecord.created_at.desc()).all()]


def create_export(db: Session, payload: dict) -> dict:
    export_payload = dict(payload)
    if isinstance(export_payload.get("export_config_json"), dict):
        export_payload["export_config_json"] = json.dumps(export_payload["export_config_json"], ensure_ascii=False)
    export = ExportRecord(**export_payload)
    db.add(export)
    db.commit()
    db.refresh(export)
    return serialize_export(export)


def export_report_image(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    project_id = int(payload["project_id"])
    project = db.get(Project, project_id)
    if project is None:
        raise ValueError("导出项目不存在。")
    file_name = _safe_export_file_name(payload["file_name"], ".svg")
    project_folder = OUTPUTS_DIR / f"project-{project_id}"
    project_folder.mkdir(parents=True, exist_ok=True)
    target_path = _deduplicated_path(project_folder / file_name)
    board_document_ids = [int(value) for value in payload["board_document_ids"]]
    source_asset_ids = [int(value) for value in payload["source_asset_ids"]]
    selected_item_ids = [int(value) for value in payload["selected_item_ids"]]
    mode = str(payload["mode"])
    output_language = "en" if payload.get("output_language") == "en" else "zh-CN"
    prompt_version = str(payload["delivery_prompt_version"])
    review_snapshot = str(payload["review_snapshot"])
    boards = _validated_board_documents(
        db,
        board_document_ids=board_document_ids,
        project_id=project_id,
        task_id=payload.get("task_id"),
        mode=mode,
        source_asset_ids=source_asset_ids,
        selected_item_ids=selected_item_ids,
        prompt_version=prompt_version,
        review_snapshot=review_snapshot,
    )
    source_assets = _validated_source_assets(db, project_id, source_asset_ids)
    selected_items = _validated_reviewed_items(db, project_id, source_asset_ids, selected_item_ids)
    if review_snapshot != _review_snapshot(selected_items):
        raise ValueError("导出快照与当前预算或采购信息不一致，请刷新后重试。")
    generated_asset_id = payload.get("generated_asset_id")
    generated_asset = (
        _validated_generated_board_asset(
            db,
            project_id=project_id,
            asset_id=int(generated_asset_id),
            mode=mode,
            source_asset_ids=source_asset_ids,
            selected_item_ids=selected_item_ids,
            prompt_version=prompt_version,
            review_snapshot=review_snapshot,
        )
        if generated_asset_id is not None
        else None
    )
    hero_asset = generated_asset or source_assets[0]
    target_path.write_text(
        _render_formal_board_report_svg(
            db=db,
            title=payload.get("title", "栖构图片报告"),
            project=project,
            mode=mode,
            hero_asset=hero_asset,
            hero_is_generated=generated_asset is not None,
            source_assets=source_assets,
            selected_items=selected_items,
            output_language=output_language,
        ),
        encoding="utf-8",
    )
    return create_export(
        db,
        {
            "project_id": project_id,
            "task_id": payload.get("task_id"),
            "type": "image_report",
            "file_name": target_path.name,
            "file_path": str(target_path),
            "export_config_json": {
                "mime_type": "image/svg+xml",
                "format": "svg",
                "board_document_ids": board_document_ids,
                "board_task_id": boards[0].task_id,
                "mode": mode,
                "source_asset_ids": source_asset_ids,
                "selected_item_ids": selected_item_ids,
                "generated_asset_id": generated_asset.id if generated_asset else None,
                "hero_asset_id": hero_asset.id,
                "hero_source": "provider_generation" if generated_asset else "source_asset",
                "delivery_prompt_version": prompt_version,
                "review_snapshot": review_snapshot,
                "embedded_source_count": len(source_assets),
                "selected_item_count": len(selected_items),
                "output_language": output_language,
                **(payload.get("export_config_json") or {}),
            },
        },
    )


def export_extracted_items_table(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    project_id = int(payload["project_id"])
    project = db.get(Project, project_id)
    if project is None:
        raise ValueError("导出项目不存在。")

    asset_ids = [int(value) for value in payload.get("asset_ids", [])]
    selected_item_ids = [int(value) for value in payload.get("selected_item_ids", [])]
    if selected_item_ids:
        items = _validated_reviewed_items(db, project_id, asset_ids, selected_item_ids)
        if payload.get("review_snapshot") != _review_snapshot(items):
            raise ValueError("表格快照与当前预算或采购信息不一致，请刷新后重试。")
    else:
        query = db.query(ExtractedItem).filter(ExtractedItem.project_id == project_id)
        if asset_ids:
            query = query.filter(ExtractedItem.asset_id.in_(asset_ids))
        items = query.order_by(ExtractedItem.room_type.asc(), ExtractedItem.created_at.asc()).all()
    output_language = "en" if payload.get("output_language") == "en" else "zh-CN"
    rows = [_table_row(project.name, item, output_language) for item in items]
    if payload.get("selected_only"):
        selection_column = "Selection" if output_language == "en" else "选择状态"
        keep_label = "Keep" if output_language == "en" else "保留"
        rows = [row for row in rows if row[selection_column] == keep_label]
    if not rows:
        raise ValueError("没有可导出的真实提取项。请先完成 GLM 信息提取。")

    file_name = _safe_export_file_name(payload["file_name"], ".csv")
    project_folder = OUTPUTS_DIR / f"project-{project_id}"
    project_folder.mkdir(parents=True, exist_ok=True)
    target_path = _deduplicated_path(project_folder / file_name)
    columns = list(rows[0].keys())
    with target_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    return create_export(
        db,
        {
            "project_id": project_id,
            "task_id": payload.get("task_id"),
            "type": "structured_table",
            "file_name": target_path.name,
            "file_path": str(target_path),
            "export_config_json": {
                "format": "csv",
                "encoding": "utf-8-sig",
                "columns": columns,
                "row_count": len(rows),
                "output_language": output_language,
                "asset_ids": asset_ids,
                "source_asset_ids": asset_ids,
                "selected_item_ids": selected_item_ids,
                "review_snapshot": payload.get("review_snapshot"),
                **(payload.get("export_config_json") or {}),
            },
        },
    )


def export_image_file(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    asset = db.get(Asset, int(payload["asset_id"]))
    if asset is None:
        raise ValueError("图片导出的素材不存在。")
    if payload.get("project_id") is not None and asset.project_id != payload.get("project_id"):
        raise ValueError("图片导出的素材不属于当前项目。")
    resolved = asset_service.get_asset_path(db, asset.id)
    if resolved is None:
        raise ValueError("图片导出的素材文件不存在或不在受控工作区。")
    source_path, stored_media_type = resolved
    media_type = stored_media_type or mimetypes.guess_type(source_path.name)[0] or ""
    if not media_type.startswith("image/"):
        raise ValueError("图片导出只支持图片文件。")

    file_name = _safe_export_file_name(payload["file_name"], source_path.suffix.lower() or ".png")
    project_folder = OUTPUTS_DIR / f"project-{payload.get('project_id') or 'shared'}"
    project_folder.mkdir(parents=True, exist_ok=True)
    target_path = _deduplicated_path(project_folder / file_name)
    shutil.copy2(source_path, target_path)

    return create_export(
        db,
        {
            "project_id": payload.get("project_id"),
            "task_id": payload.get("task_id"),
            "type": "image",
            "file_name": target_path.name,
            "file_path": str(target_path),
            "export_config_json": {
                "source_asset_id": asset.id,
                "mime_type": media_type,
                **(payload.get("export_config_json") or {}),
            },
        },
    )


def open_export_file(db: Session, export_id: int) -> dict[str, Any] | None:
    export = db.get(ExportRecord, export_id)
    if export is None:
        return None
    file_path = _resolved_export_path(export.file_path)
    if file_path is None:
        return None
    _open_path(file_path)
    return {"opened": True, "path": str(file_path)}


def open_export_folder(db: Session, export_id: int) -> dict[str, Any] | None:
    export = db.get(ExportRecord, export_id)
    if export is None:
        return None
    file_path = _resolved_export_path(export.file_path)
    if file_path is None:
        return None
    folder = file_path.parent
    _open_path(folder)
    return {"opened": True, "path": str(folder)}


def get_export_path(db: Session, export_id: int) -> tuple[Path, str] | None:
    export = db.get(ExportRecord, export_id)
    if export is None:
        return None
    file_path = _resolved_export_path(export.file_path)
    if file_path is None:
        return None
    return file_path, mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"


def serialize_export(export: ExportRecord) -> dict[str, Any]:
    data = model_to_dict(export)
    content_path = f"/api/exports/{export.id}/content"
    data["content_path"] = content_path
    if not current_platform_capabilities().local_file_open:
        data["file_path"] = content_path
        config = data.get("export_config_json")
        if isinstance(config, dict):
            data["export_config_json"] = {
                key: value for key, value in config.items() if "path" not in key.lower()
            }
    return data


def _validated_board_documents(
    db: Session,
    *,
    board_document_ids: list[int],
    project_id: int,
    task_id: int | None,
    mode: str,
    source_asset_ids: list[int],
    selected_item_ids: list[int],
    prompt_version: str,
    review_snapshot: str,
) -> list[BoardDocument]:
    boards = db.query(BoardDocument).filter(BoardDocument.id.in_(board_document_ids)).all()
    if len(boards) != len(set(board_document_ids)):
        raise ValueError("部分方案板记录不存在，无法创建完整图片交付。")
    board_task_ids = {board.task_id for board in boards if board.task_id is not None}
    if (
        not boards
        or len(board_task_ids) != 1
        or (task_id is not None and task_id not in board_task_ids)
        or any(board.project_id != project_id for board in boards)
    ):
        raise ValueError("方案板文档不属于当前项目或当前生成任务。")
    for board in boards:
        data = _json_object(board.data_json)
        if (
            data.get("review_schema_version") != 2
            or data.get("delivery_prompt_version") != prompt_version
            or data.get("review_snapshot") != review_snapshot
            or not _same_ids(data.get("source_asset_ids"), source_asset_ids)
            or not _same_ids(data.get("selected_item_ids"), selected_item_ids)
        ):
            raise ValueError("方案板文档与当前图片或人工确认结果不一致，请重新生成。")
    board_types = [board.board_type for board in boards]
    required = {"material_board", "color_board", "board_preview", "quote_card"} if mode == "single" else {"integrated_board", "budget_summary"}
    if not required.issubset(set(board_types)):
        raise ValueError("当前方案板任务缺少正式交付所需文档。")
    if mode == "multi" and board_types.count("split_room_board") != len(source_asset_ids):
        raise ValueError("分房间方案板数量与当前上传图片不一致。")
    return sorted(boards, key=lambda board: (board.board_type, board.id))


def _validated_source_assets(db: Session, project_id: int, asset_ids: list[int]) -> list[Asset]:
    assets_by_id = {
        asset.id: asset
        for asset in db.query(Asset).filter(Asset.id.in_(asset_ids), Asset.project_id == project_id).all()
    }
    if len(assets_by_id) != len(set(asset_ids)):
        raise ValueError("部分当前房间图片不存在或不属于当前项目。")
    assets = [assets_by_id[asset_id] for asset_id in asset_ids]
    for asset in assets:
        if not (asset.mime_type or "").startswith("image/") or asset_service.get_asset_path(db, asset.id) is None:
            raise ValueError(f"当前房间图片 {asset.file_name} 无法读取。")
    return assets


def _validated_reviewed_items(
    db: Session,
    project_id: int,
    asset_ids: list[int],
    selected_item_ids: list[int],
) -> list[ExtractedItem]:
    if not selected_item_ids:
        return []
    selected = (
        db.query(ExtractedItem)
        .filter(
            ExtractedItem.project_id == project_id,
            ExtractedItem.asset_id.in_(asset_ids),
            ExtractedItem.id.in_(selected_item_ids),
        )
        .all()
    )
    selected_by_id = {item.id: item for item in selected}
    if len(selected_by_id) != len(set(selected_item_ids)):
        raise ValueError("部分导出元素不存在或不属于当前图片。")
    ordered = [selected_by_id[item_id] for item_id in selected_item_ids]
    if any(_review_state(item) == "remove" for item in ordered):
        raise ValueError("已删除的元素不能进入导出结果。")
    for item in ordered:
        if item.price_min is not None and item.price_max is not None and item.price_min > item.price_max:
            raise ValueError(f"{item.name} 的最低预算不能高于最高预算。")
    return ordered


def _validated_generated_board_asset(
    db: Session,
    *,
    project_id: int,
    asset_id: int,
    mode: str,
    source_asset_ids: list[int],
    selected_item_ids: list[int],
    prompt_version: str,
    review_snapshot: str,
) -> Asset:
    asset = db.get(Asset, asset_id)
    metadata = _json_object(asset.metadata_json if asset else None)
    expected_module = "single_room_board" if mode == "single" else "multi_room_board"
    if (
        asset is None
        or asset.project_id != project_id
        or asset.source != "provider_generation"
        or not (asset.mime_type or "").startswith("image/")
        or metadata.get("module") != expected_module
        or metadata.get("review_schema_version") != 2
        or metadata.get("delivery_prompt_version") != prompt_version
        or metadata.get("review_snapshot") != review_snapshot
        or not _same_ids(metadata.get("source_asset_ids"), source_asset_ids)
        or not _same_ids(metadata.get("selected_item_ids"), selected_item_ids)
        or asset_service.get_asset_path(db, asset.id) is None
    ):
        raise ValueError("当前方案板图片不是由本次图片、人工确认结果和交付提示词真实生成的。")
    return asset


def _render_formal_board_report_svg(
    *,
    db: Session,
    title: str,
    project: Project,
    mode: str,
    hero_asset: Asset,
    hero_is_generated: bool,
    source_assets: list[Asset],
    selected_items: list[ExtractedItem],
    output_language: str = "zh-CN",
) -> str:
    labels = _report_labels(output_language)
    # A4 portrait delivery sheet. The SVG scales to the browser width on screen
    # and retains an exact 210:297 page ratio when printed.
    width = 1240
    height = 1754
    margin = 56
    content_width = width - margin * 2
    hero_y = 210
    hero_height = 470
    hero_width = 740
    summary_x = margin + hero_width + 24
    summary_width = content_width - hero_width - 24
    source_y = 760
    visible_source_assets = source_assets[:3]
    source_columns = min(3, max(1, len(visible_source_assets)))
    source_card_height = 160
    item_y = 1010
    # The A4 overview intentionally shows at most eight complete item cards.
    # Additional items remain available in the structured table; displayed text
    # must never be shortened with an ellipsis to squeeze more cards onto a page.
    visible_items = selected_items[:8]
    hero_uri = _asset_data_uri(db, hero_asset)
    source_markup: list[str] = []
    source_gap = 24
    source_width = (content_width - source_gap * (source_columns - 1)) / source_columns
    for index, asset in enumerate(visible_source_assets):
        column = index % source_columns
        x = margin + column * (source_width + source_gap)
        y = source_y
        caption = f'{labels["source_basis"]} {index + 1:02d}'
        if asset.room_type:
            caption = f"{caption} · {asset.room_type}"
        caption_lines = _wrap_visual_text(caption, 46)
        source_markup.append(
            f'<rect x="{x}" y="{y}" width="{source_width}" height="{source_card_height}" rx="8" fill="#E8EDF3" />'
            f'<image x="{x}" y="{y}" width="{source_width}" height="124" href="{_asset_data_uri(db, asset)}" preserveAspectRatio="xMidYMid slice" />'
            f'{_svg_multiline_text(x + 14, y + 143, caption_lines, "caption", 14)}'
        )
    item_markup: list[str] = []
    card_gap = 24
    card_width = (content_width - card_gap) / 2
    item_layout: list[dict[str, Any]] = []
    for index, item in enumerate(visible_items):
        metadata = _item_metadata(item.notes)
        procurement_label = labels["purchased"] if metadata.get("procurement_status") == "purchased" else labels["not_purchased"]
        purchase_method = str(metadata.get("purchase_method") or labels["purchase_pending"])
        item_budget = _budget_range_label(item.price_min, item.price_max, output_language)
        title_lines = _wrap_visual_text(f"{index + 1:02d}  {item.name}", 42)
        meta_lines = _wrap_visual_text(
            " · ".join(
                (
                    item.room_type or labels["room_unmarked"],
                    item.material or labels["material_unmarked"],
                    item.color or labels["color_unmarked"],
                )
            ),
            74,
        )
        purchase_lines = _wrap_visual_text(purchase_method, 46)
        # Keep the review state on its own row so a long item title can never
        # run underneath it. All variable text below is wrapped, not clipped.
        title_start = 52
        meta_start = title_start + len(title_lines) * 18 + 6
        purchase_start = meta_start + len(meta_lines) * 15 + 5
        card_height = max(112, purchase_start + len(purchase_lines) * 15 + 20)
        item_layout.append(
            {
                "index": index,
                "procurement_label": procurement_label,
                "item_budget": item_budget,
                "title_lines": title_lines,
                "meta_lines": meta_lines,
                "purchase_lines": purchase_lines,
                "title_start": title_start,
                "meta_start": meta_start,
                "purchase_start": purchase_start,
                "card_height": card_height,
            }
        )
    rendered_item_count = 0
    row_y = item_y
    max_item_bottom = height - 96
    for row_start in range(0, len(item_layout), 2):
        row_items = item_layout[row_start : row_start + 2]
        row_height = max(entry["card_height"] for entry in row_items)
        if row_y + row_height > max_item_bottom:
            break
        for column, entry in enumerate(row_items):
            x = margin + column * (card_width + card_gap)
            y = row_y
            index = entry["index"]
            item_markup.append(
                f'<rect x="{x}" y="{y}" width="{card_width}" height="{row_height}" rx="8" fill="#FFFFFF" stroke="#D8E0E8" />'
                f'<rect x="{x}" y="{y}" width="6" height="{row_height}" rx="3" fill="#0F8B80" />'
                f'<text x="{x + card_width - 20}" y="{y + 28}" text-anchor="end" class="status">{entry["procurement_label"]}</text>'
                f'{_svg_multiline_text(x + 20, y + entry["title_start"], entry["title_lines"], "item-title", 18)}'
                f'{_svg_multiline_text(x + 20, y + entry["meta_start"], entry["meta_lines"], "item-meta", 15)}'
                f'{_svg_multiline_text(x + 20, y + entry["purchase_start"], entry["purchase_lines"], "item-meta", 15)}'
                f'<text x="{x + card_width - 20}" y="{y + row_height - 16}" text-anchor="end" class="budget">{_svg_escape(entry["item_budget"])}</text>'
            )
            rendered_item_count += 1
        row_y += row_height + 12
    if not item_markup:
        item_markup.append(
            f'<rect x="{margin}" y="{item_y}" width="{content_width}" height="84" rx="8" fill="#FFFFFF" stroke="#D8E0E8" />'
            f'<text x="{margin + 24}" y="{item_y + 50}" class="item-meta">{_svg_escape(labels["no_selected_items"])}</text>'
        )
    rooms = list(dict.fromkeys(item.room_type or labels["room_unmarked"] for item in selected_items))
    materials = list(dict.fromkeys(item.material for item in selected_items if item.material))
    colors = list(dict.fromkeys(item.color for item in selected_items if item.color))
    total_min = sum(item.price_min or 0 for item in selected_items)
    total_max = sum(item.price_max or 0 for item in selected_items)
    total_budget = (
        f"¥ {total_min:,.0f} - {total_max:,.0f}"
        if any(item.price_min is not None or item.price_max is not None for item in selected_items)
        else labels["optional_not_provided"]
    )
    purchased_count = sum(1 for item in selected_items if _item_metadata(item.notes).get("procurement_status") == "purchased")
    hero_label = labels["ai_hero"] if hero_is_generated else labels["source_hero"]
    footer_note = (
        labels["generated_footer"]
        if hero_is_generated
        else labels["source_footer"]
    )
    report_kind = labels["single_report"] if mode == "single" else labels["multi_report"]
    overflow_note = (
        labels["full_table_note"].format(count=rendered_item_count)
        if len(selected_items) > rendered_item_count
        else ""
    )
    header_title_lines = _wrap_visual_text(project.name or title, 54)
    header_subtitle_lines = _wrap_visual_text(
        f'{report_kind} · {project.client_name or labels["client_project"]} · {project.style_tags or labels["design_direction_missing"]}',
        108,
    )
    header_title_y = 82
    header_title_line_height = 34
    header_subtitle_y = header_title_y + (len(header_title_lines) - 1) * header_title_line_height + 32
    header_markup = (
        _svg_multiline_text(margin, header_title_y, header_title_lines, "title", header_title_line_height)
        + _svg_multiline_text(margin, header_subtitle_y, header_subtitle_lines, "subtitle", 18)
    )
    summary_values = (
        (labels["budget_range"], total_budget),
        (labels["rooms"], " / ".join(rooms) or labels["optional_not_extracted"]),
        (labels["review_procurement"], f'{len(selected_items)} {labels["items"]} · {labels["purchased"]} {purchased_count}/{len(selected_items)}'),
        (labels["materials"], " / ".join(materials) or labels["unmarked"]),
        (labels["colors"], " / ".join(colors) or labels["unmarked"]),
    )
    summary_markup, summary_font_size = _summary_text_markup(
        x=summary_x + 28,
        start_y=hero_y + 70,
        max_y=hero_y + hero_height - 18,
        available_width=summary_width - 56,
        values=summary_values,
    )
    footer_lines = _wrap_visual_text(footer_note, 92)
    footer_markup = _svg_multiline_text(margin, height - 46, footer_lines, "footer", 14)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="auto" viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMin meet" style="display:block;max-width:210mm;height:auto;margin:0 auto;background:#F4F7FA">
  <defs>
    <clipPath id="header-content-clip"><rect x="{margin - 8}" y="8" width="{content_width + 8}" height="162" /></clipPath>
    <clipPath id="summary-content-clip"><rect x="{summary_x + 20}" y="{hero_y + 50}" width="{summary_width - 40}" height="{hero_height - 60}" /></clipPath>
    <clipPath id="item-heading-clip"><rect x="{margin - 8}" y="{item_y - 42}" width="{content_width - 352}" height="40" /></clipPath>
    <clipPath id="item-overflow-note-clip"><rect x="{width - margin - 344}" y="{item_y - 42}" width="344" height="40" /></clipPath>
    <clipPath id="footer-note-clip"><rect x="{margin - 8}" y="{height - 60}" width="{content_width - 242}" height="38" /></clipPath>
  </defs>
  <style>
    @page {{ size: A4 portrait; margin: 0; }}
    @media print {{ :root {{ width: 210mm; height: 297mm; max-width: none; }} }}
    text {{ font-family: 'Microsoft YaHei', 'Noto Sans CJK SC', Arial, sans-serif; letter-spacing: 0; }}
    .brand {{ fill: #57D3C5; font-size: 19px; font-weight: 700; }}
    .title {{ fill: #FFFFFF; font-size: 32px; font-weight: 800; }}
    .subtitle {{ fill: #C9D5E4; font-size: 18px; font-weight: 500; }}
    .section {{ fill: #0B1838; font-size: 23px; font-weight: 800; }}
    .eyebrow {{ fill: #0F8B80; font-size: 15px; font-weight: 800; }}
    .summary-label {{ fill: #66758A; font-size: 13px; font-weight: 600; }}
    .summary-value {{ fill: #0B1838; font-size: {summary_font_size}px; font-weight: 800; }}
    .caption {{ fill: #46566B; font-size: 12px; font-weight: 600; }}
    .item-title {{ fill: #0B1838; font-size: 16px; font-weight: 800; }}
    .item-meta {{ fill: #66758A; font-size: 12px; font-weight: 600; }}
    .budget {{ fill: #9A6B08; font-size: 12px; font-weight: 800; }}
    .status {{ fill: #0F8B80; font-size: 12px; font-weight: 800; }}
    .footer {{ fill: #66758A; font-size: 12px; font-weight: 500; }}
  </style>
  <rect width="{width}" height="{height}" fill="#F4F7FA" />
  <rect width="{width}" height="170" fill="#0B1838" />
  <g clip-path="url(#header-content-clip)">
    <text x="{margin}" y="47" class="brand">{labels["brand_delivery"]}</text>
    {header_markup}
  </g>

  <text x="{margin}" y="{hero_y - 22}" class="eyebrow">{hero_label}</text>
  <rect x="{margin}" y="{hero_y}" width="{hero_width}" height="{hero_height}" rx="8" fill="#DDE4EB" />
  <image x="{margin}" y="{hero_y}" width="{hero_width}" height="{hero_height}" href="{hero_uri}" preserveAspectRatio="xMidYMid meet" />
  <rect x="{summary_x}" y="{hero_y}" width="{summary_width}" height="{hero_height}" rx="8" fill="#FFFFFF" stroke="#D8E0E8" />
  <text x="{summary_x + 28}" y="{hero_y + 40}" class="section">{labels["delivery_summary"]}</text>
  <g clip-path="url(#summary-content-clip)">
    {summary_markup}
  </g>

  <text x="{margin}" y="{source_y - 42}" class="eyebrow">{labels["current_image_basis"]}</text>
  <text x="{margin}" y="{source_y - 14}" class="section">{labels["space_style_source"]}</text>
  {''.join(source_markup)}

  <text x="{margin}" y="{item_y - 42}" class="eyebrow">{labels["glm_review"]}</text>
  <text x="{margin}" y="{item_y - 14}" class="section" clip-path="url(#item-heading-clip)">{labels["items_budget_details"]}</text>
  <text x="{width - margin}" y="{item_y - 14}" text-anchor="end" class="caption" clip-path="url(#item-overflow-note-clip)">{_svg_escape(overflow_note)}</text>
  {''.join(item_markup)}

  <line x1="{margin}" y1="{height - 70}" x2="{width - margin}" y2="{height - 70}" stroke="#D8E0E8" />
  <g clip-path="url(#footer-note-clip)">{footer_markup}</g>
  <text x="{width - margin}" y="{height - 38}" text-anchor="end" class="footer">HAVENFRAME · A4 DELIVERY</text>
</svg>"""


def _asset_data_uri(db: Session, asset: Asset) -> str:
    resolved = asset_service.get_asset_path(db, asset.id)
    if resolved is None:
        raise ValueError(f"报告素材 {asset.file_name} 无法读取。")
    source_path, stored_media_type = resolved
    media_type = stored_media_type or asset.mime_type or mimetypes.guess_type(source_path.name)[0] or "application/octet-stream"
    return f"data:{media_type};base64,{base64.b64encode(source_path.read_bytes()).decode('ascii')}"


def _review_state(item: ExtractedItem) -> str:
    metadata = _item_metadata(item.notes)
    if metadata.get("review_schema_version") != 2 or not metadata.get("selection_updated_at"):
        return "undecided"
    state = str(metadata.get("selection_state") or "undecided")
    if state in {"remove", "replace"}:
        return "remove"
    return "keep" if state == "keep" else "undecided"


def _review_snapshot(items: list[ExtractedItem]) -> str:
    snapshot = []
    for item in sorted(items, key=lambda value: value.id):
        metadata = _item_metadata(item.notes)
        snapshot.append(
            {
                "id": item.id,
                "price_min": _json_number(item.price_min),
                "price_max": _json_number(item.price_max),
                "procurement_status": metadata.get("procurement_status") or "pending",
                "quantity": metadata.get("quantity"),
                "purchase_method": metadata.get("purchase_method") or "",
                "purchase_url": metadata.get("purchase_url") or "",
            }
        )
    return json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))


def _json_number(value: float | None) -> int | float | None:
    if value is None:
        return None
    return int(value) if float(value).is_integer() else float(value)


def _budget_range_label(minimum: float | None, maximum: float | None, output_language: str = "zh-CN") -> str:
    english = output_language == "en"
    if minimum is None and maximum is None:
        return "Budget not provided" if english else "预算未填写"
    minimum_label = f"{minimum:,.0f}" if minimum is not None else ("N/A" if english else "未填")
    maximum_label = f"{maximum:,.0f}" if maximum is not None else ("N/A" if english else "未填")
    return f"¥ {minimum_label} - {maximum_label}"


def _report_labels(output_language: str) -> dict[str, str]:
    if output_language != "en":
        return {
            "source_basis": "原始依据", "purchased": "已采购", "not_purchased": "未采购",
            "purchase_pending": "购买方式待补充", "room_unmarked": "未标注房间", "material_unmarked": "材质未标注",
            "color_unmarked": "颜色未标注", "optional_not_provided": "未填写（可选）", "ai_hero": "方案板主视觉",
            "source_hero": "项目源图 / 报告依据", "generated_footer": "主视觉、名称、材质、颜色和预算均来自当前项目已保存的交付内容。",
            "source_footer": "主视觉为当前项目源图；提取、人工确认和预算按当前项目已有内容纳入。",
            "single_report": "单房间方案板", "multi_report": "多房间全案方案板", "brand_delivery": "栖构 · 客户正式交付",
            "client_project": "客户项目", "design_direction_missing": "设计方向未填写", "delivery_summary": "交付摘要",
            "budget_range": "预算范围", "rooms": "房间", "optional_not_extracted": "未提取（可选）",
            "review_procurement": "人工保留 / 采购进度", "items": "项", "materials": "材质方向", "colors": "色彩方向",
            "unmarked": "未标注", "current_image_basis": "当前图片依据",
            "space_style_source": "空间与风格来源", "glm_review": "信息提取 + 人工确认", "items_budget_details": "保留元素与预算明细",
            "no_selected_items": "未选择提取元素；报告仍保留当前图片和设计方向。",
            "full_table_note": "本页完整展示前 {count} 项；其余内容见结构化表格",
        }
    return {
        "source_basis": "Source", "purchased": "Purchased", "not_purchased": "Not purchased",
        "purchase_pending": "Purchase method pending", "room_unmarked": "Room not specified", "material_unmarked": "Material not specified",
        "color_unmarked": "Color not specified", "optional_not_provided": "Not provided (optional)", "ai_hero": "Design board visual",
        "source_hero": "Project source / report reference", "generated_footer": "The hero visual, names, materials, colors, and budgets come from the current project's saved delivery content.",
        "source_footer": "The hero visual is the current project source; extraction, review, and budget details are included when available.",
        "single_report": "Single-room Design Board", "multi_report": "Multi-room Design Board", "brand_delivery": "HavenFrame · Client Delivery",
        "client_project": "Client project", "design_direction_missing": "Design direction not specified", "delivery_summary": "Delivery Summary",
        "budget_range": "Budget Range", "rooms": "Rooms", "optional_not_extracted": "Not extracted (optional)",
        "review_procurement": "Retained / Procurement", "items": "items", "materials": "Material Direction", "colors": "Color Direction",
        "unmarked": "Not specified", "current_image_basis": "Current Image Basis",
        "space_style_source": "Space and Style Sources", "glm_review": "Extracted Details + Review", "items_budget_details": "Retained Items and Budget",
        "no_selected_items": "No extracted items were selected; the image and design direction remain available.",
        "full_table_note": "Showing {count} complete items; see the structured table for the remainder",
    }


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _same_ids(value: Any, expected: list[int]) -> bool:
    if not isinstance(value, list):
        return False
    return sorted({int(item) for item in value}) == sorted(set(expected))


def _visual_text_units(value: str) -> int:
    return sum(2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1 for char in value)


def _wrap_visual_text(value: str, max_units: int) -> list[str]:
    remaining = " ".join(str(value or "").split())
    lines: list[str] = []
    while remaining:
        if _visual_text_units(remaining) <= max_units:
            lines.append(remaining)
            break
        used = 0
        cutoff = 0
        preferred_cutoff = 0
        for index, char in enumerate(remaining):
            char_units = _visual_text_units(char)
            if used + char_units > max_units:
                break
            used += char_units
            cutoff = index + 1
            if char.isspace() or char in "/·,，、;；":
                preferred_cutoff = index + 1
        split_at = preferred_cutoff if preferred_cutoff >= max(1, cutoff // 2) else cutoff
        lines.append(remaining[:split_at].rstrip(" /·,，、;；"))
        remaining = remaining[split_at:].lstrip(" /·,，、;；")
    return lines or [""]


def _summary_text_markup(
    *,
    x: float,
    start_y: float,
    max_y: float,
    available_width: float,
    values: tuple[tuple[str, str], ...],
) -> tuple[str, int]:
    for font_size in range(15, 8, -1):
        line_height = font_size + 3
        max_units = max(30, int(available_width / (font_size * 0.56)))
        wrapped = [(label, _wrap_visual_text(value, max_units)) for label, value in values]
        cursor = start_y
        markup: list[str] = []
        for label, lines in wrapped:
            markup.append(f'<text x="{x}" y="{cursor}" class="summary-label">{_svg_escape(label)}</text>')
            value_y = cursor + 24
            markup.append(_svg_multiline_text(x, value_y, lines, "summary-value", line_height))
            cursor = value_y + len(lines) * line_height + 12
        if cursor <= max_y:
            return "".join(markup), font_size
    raise ValueError("报告摘要内容过长，无法在 A4 页面内完整排版；请精简异常字段后重试。")


def _svg_multiline_text(x: float, y: float, lines: list[str], class_name: str, line_height: int) -> str:
    spans = "".join(
        f'<tspan x="{x}" y="{y + index * line_height}">{_svg_escape(line)}</tspan>'
        for index, line in enumerate(lines)
    )
    return f'<text class="{class_name}">{spans}</text>'


def _svg_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _safe_export_file_name(file_name: str, suffix: str) -> str:
    clean = Path(str(file_name or "")).name.strip()
    if not clean:
        clean = f"qigou-export{suffix}"
    clean = re.sub(r"[\x00-\x1f]", "", clean)
    if Path(clean).suffix.lower() != suffix:
        clean = f"{Path(clean).stem or 'qigou-export'}{suffix}"
    return clean[:180]


def _table_row(project_name: str, item: ExtractedItem, output_language: str = "zh-CN") -> dict[str, str | float | int]:
    metadata = _item_metadata(item.notes)
    if output_language == "en":
        return {
            "Project": project_name,
            "Room": item.room_type or "Not specified",
            "Category": item.category or "Uncategorized",
            "Product": item.name,
            "Quantity": metadata.get("quantity") or "",
            "Material": item.material or "",
            "Color": item.color or "",
            "Minimum Budget": item.price_min if item.price_min is not None else "",
            "Maximum Budget": item.price_max if item.price_max is not None else "",
            "Selection": _selection_state_label(str(metadata.get("selection_state") or "undecided"), "en"),
            "Procurement Status": "Purchased" if metadata.get("procurement_status") == "purchased" else "Not purchased",
            "Purchase Method": str(metadata.get("purchase_method") or ""),
            "Purchase URL": str(metadata.get("purchase_url") or ""),
            "Notes": str(metadata.get("summary") or ""),
        }
    return {
        "项目": project_name,
        "房间": item.room_type or "未标注",
        "类型": item.category or "未分类",
        "产品": item.name,
        "数量": metadata.get("quantity") or "",
        "材质": item.material or "",
        "颜色": item.color or "",
        "最低预算": item.price_min if item.price_min is not None else "",
        "最高预算": item.price_max if item.price_max is not None else "",
        "选择状态": _selection_state_label(str(metadata.get("selection_state") or "undecided")),
        "采购状态": "已采购" if metadata.get("procurement_status") == "purchased" else "未采购",
        "购买方式": str(metadata.get("purchase_method") or ""),
        "购买链接": str(metadata.get("purchase_url") or ""),
        "备注": str(metadata.get("summary") or ""),
    }


def _item_metadata(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {"summary": value}
    return parsed if isinstance(parsed, dict) else {"summary": str(parsed)}


def _selection_state_label(value: str, output_language: str = "zh-CN") -> str:
    if output_language == "en":
        return {"keep": "Keep", "remove": "Remove", "replace": "Remove", "undecided": "Pending"}.get(value, value)
    return {"keep": "保留", "remove": "删除", "replace": "删除", "undecided": "待定"}.get(value, value)


def _deduplicated_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    index = 1
    while True:
        candidate = path.with_name(f"{stem}-{index}{suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def _resolved_export_path(path_value: str | None) -> Path | None:
    if not path_value:
        return None
    try:
        file_path = validate_workspace_path(path_value, allowed_roots=[OUTPUTS_DIR])
    except SecurityContextError:
        return None
    if not file_path.exists() or not file_path.is_file():
        return None
    return file_path


def _open_path(path: Path) -> None:
    if os.name == "nt":
        os.startfile(str(path))  # type: ignore[attr-defined]
        return
    if sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
        return
    if opener := shutil.which("xdg-open"):
        subprocess.Popen([opener, str(path)])
        return
    raise RuntimeError("当前系统没有可用的打开路径命令。")
