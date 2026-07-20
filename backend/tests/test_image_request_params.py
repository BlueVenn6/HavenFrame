from backend.services.image_request_params import (
    append_aspect_ratio_instruction,
    resolve_image_request_params,
    size_for_aspect_ratio,
)


def test_resolves_common_aspect_ratio_to_requested_size():
    params = resolve_image_request_params({"aspect_ratio": "16:9"}, {})

    assert params.aspect_ratio == "16:9"
    assert params.requested_size == "1536x864"
    assert params.output_count == 1


def test_explicit_size_wins_and_derives_ratio_when_needed():
    params = resolve_image_request_params({"size": "1024x1536"}, {})

    assert params.aspect_ratio == "2:3"
    assert params.requested_size == "1024x1536"


def test_custom_ratio_creates_non_square_size():
    assert size_for_aspect_ratio("21:9") == "1536x656"


def test_prompt_instruction_records_ratio_and_size():
    params = resolve_image_request_params({"aspect_ratio": "9:16"}, {})
    prompt = append_aspect_ratio_instruction("Create a room render.", params)

    assert "9:16" in prompt
    assert "864x1536" in prompt
    assert "do not return a square image" in prompt
