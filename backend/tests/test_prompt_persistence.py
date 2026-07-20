def test_prompt_crud_round_trip_preserves_chinese_and_structured_variables(client):
    created = client.post(
        "/api/prompts",
        json={
            "name": "客厅材质提取",
            "module": "single_room_board",
            "scope": "local",
            "system_prompt": "提取室内设计信息。",
            "user_prompt": "提取 {room_type} 的 {material_keywords}。",
            "negative_prompt": "不要猜测品牌。",
            "variables_json": ["room_type", "material_keywords", "room_type"],
        },
    )
    assert created.status_code == 200
    prompt = created.json()
    assert prompt["name"] == "客厅材质提取"
    assert prompt["variables_json"] == ["room_type", "material_keywords"]

    favorited = client.patch(f'/api/prompts/{prompt["id"]}', json={"is_favorite": True})
    assert favorited.status_code == 200
    assert favorited.json()["is_favorite"] is True

    cloned = client.post(f'/api/prompts/{prompt["id"]}/clone')
    assert cloned.status_code == 200
    assert cloned.json()["name"] == "客厅材质提取 副本"
    assert cloned.json()["variables_json"] == ["room_type", "material_keywords"]

    listed = client.get("/api/prompts")
    assert listed.status_code == 200
    assert {item["name"] for item in listed.json()} >= {"客厅材质提取", "客厅材质提取 副本"}


def test_prompt_api_rejects_unknown_or_invalid_fields(client):
    base = {
        "name": "有效模板",
        "module": "space_render",
        "user_prompt": "生成 {room_type}",
    }
    assert client.post("/api/prompts", json={**base, "unexpected": "value"}).status_code == 422
    assert client.post("/api/prompts", json={**base, "variables_json": ["bad variable"]}).status_code == 422
    assert client.post("/api/prompts", json={**base, "user_prompt": "   "}).status_code == 422
