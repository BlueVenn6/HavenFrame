import base64
import json

import httpx
import pytest

from backend.adapters.glm_item_extraction import (
    GLMItemExtractionRequest,
    extract_items_with_glm_vision,
    parse_extracted_items,
)
from backend.schemas.boards import ExtractItemsRequest
from backend.services.board_service import _build_extraction_prompt


def test_parse_extracted_items_from_json_object():
    items = parse_extracted_items(
        '{"items":[{"category":"sofa","name":"Curved sofa","material":"boucle","color":"ivory","selection_state":"keep"}]}'
    )

    assert items == [
        {
            "category": "sofa",
            "name": "Curved sofa",
            "material": "boucle",
            "color": "ivory",
            "color_hex": None,
            "bbox": None,
            "selection_state": "keep",
            "notes": None,
            "price_min": None,
            "price_max": None,
        }
    ]


def test_parse_extracted_items_from_fenced_json():
    items = parse_extracted_items(
        """```json
        {"items":[{"category":"lighting","name":"Pendant light","selection_state":"unknown","notes":"visible over table"}]}
        ```"""
    )

    assert items[0]["name"] == "Pendant light"
    assert items[0]["selection_state"] == "undecided"
    assert items[0]["notes"] == "visible over table"


def test_parse_extracted_items_from_concatenated_provider_json():
    items = parse_extracted_items(
        '{"queries":["interior image"]}{"items":[{"category":"sofa","name":"gray sofa","material":"fabric"}]}'
    )

    assert items[0]["name"] == "gray sofa"
    assert items[0]["material"] == "fabric"


def test_glm_extraction_uses_chat_completions_and_raw_base64(tmp_path):
    image_path = tmp_path / "客厅.png"
    image_path.write_bytes(b"real-image-payload")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        assert request.headers["authorization"] == "Bearer test-key"
        body = json.loads(request.content)
        assert body["model"] == "glm-4.5v"
        assert body["thinking"] == {"type": "disabled"}
        image_value = body["messages"][0]["content"][1]["image_url"]["url"]
        assert image_value == base64.b64encode(b"real-image-payload").decode("ascii")
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": '{"items":[{"category":"家具","name":"沙发","price_min":6800,"price_max":9200}]}'
                        }
                    }
                ]
            },
        )

    result = extract_items_with_glm_vision(
        GLMItemExtractionRequest(
            base_url="https://open.bigmodel.cn/api/paas/v4",
            api_key="test-key",
            model_id="glm-4.5v",
            image_path=image_path,
            prompt="仅返回 JSON",
            transport=httpx.MockTransport(handler),
        )
    )
    assert result["ok"] is True
    assert result["surface"] == "chat_completions"
    assert parse_extracted_items(result["raw_text"])[0]["name"] == "沙发"


def test_glm_extraction_rejects_non_glm_model(tmp_path):
    image_path = tmp_path / "room.png"
    image_path.write_bytes(b"image")
    with pytest.raises(ValueError, match="only accepts GLM"):
        extract_items_with_glm_vision(
            GLMItemExtractionRequest(
                base_url="https://open.bigmodel.cn/api/paas/v4",
                api_key="test-key",
                model_id="gpt-5.5",
                image_path=image_path,
                prompt="extract",
            )
        )


def test_parse_extracted_items_validates_budget_range_and_currency_strings():
    parsed = parse_extracted_items(
        '{"items":[{"name":"沙发","price_min":"￥6,800元","price_max":"9,200"}]}'
    )
    assert parsed[0]["price_min"] == 6800
    assert parsed[0]["price_max"] == 9200

    with pytest.raises(ValueError, match="price_min"):
        parse_extracted_items('{"items":[{"name":"沙发","price_min":9200,"price_max":6800}]}')


def test_space_render_reference_extraction_slot_and_prompt_are_explicit():
    payload = ExtractItemsRequest(
        project_id=1,
        asset_id=2,
        room_type="参考图：指定家具",
        style="指定家具",
        workflow_slot="space_render.extraction",
        data_flow_confirmed=True,
    ).model_dump()

    prompt = _build_extraction_prompt(payload)

    assert "只分析当前这一张参考图" in prompt
    assert "参考角色：参考图：指定家具" in prompt
    assert "不得加入其他图片、历史项目" in prompt
    assert '"selection_state":"undecided"' in prompt


def test_parse_extracted_items_normalizes_bbox_and_hex_color():
    items = parse_extracted_items(
        '{"items":[{"name":"砖红餐桌","color":"砖红色","color_hex":"a74b3f",'
        '"bbox":{"x":0.12,"y":0.45,"width":0.5,"height":0.2}}]}'
    )

    assert items[0]["color_hex"] == "#A74B3F"
    assert items[0]["bbox"] == {"x": 0.12, "y": 0.45, "width": 0.5, "height": 0.2}
