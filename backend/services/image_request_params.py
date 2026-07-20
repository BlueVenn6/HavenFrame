from dataclasses import dataclass
from typing import Any


ASPECT_RATIO_SIZE_MAP = {
    "1:1": "1024x1024",
    "16:9": "1536x864",
    "9:16": "864x1536",
    "4:3": "1024x768",
    "3:4": "768x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
}


@dataclass(frozen=True)
class ImageRequestParams:
    aspect_ratio: str
    requested_size: str
    output_count: int = 1


def resolve_image_request_params(
    payload_json: dict[str, Any],
    params_snapshot: dict[str, Any] | None = None,
) -> ImageRequestParams:
    params_snapshot = params_snapshot or {}
    aspect_ratio = normalize_aspect_ratio(
        payload_json.get("aspect_ratio")
        or params_snapshot.get("aspect_ratio")
        or aspect_ratio_from_size(payload_json.get("size") or payload_json.get("resolution"))
        or "1:1"
    )
    explicit_size = payload_json.get("size") or payload_json.get("resolution")
    requested_size = str(explicit_size).strip() if is_size_string(explicit_size) else size_for_aspect_ratio(aspect_ratio)
    return ImageRequestParams(aspect_ratio=aspect_ratio, requested_size=requested_size, output_count=1)


def normalize_aspect_ratio(value: Any) -> str:
    raw = str(value or "1:1").lower().replace(" ", "").replace("/", ":")
    if raw in ASPECT_RATIO_SIZE_MAP:
        return raw
    parts = raw.split(":")
    if len(parts) != 2:
        return "1:1"
    try:
        width = float(parts[0])
        height = float(parts[1])
    except ValueError:
        return "1:1"
    if width <= 0 or height <= 0:
        return "1:1"
    return f"{_trim_number(width)}:{_trim_number(height)}"


def size_for_aspect_ratio(aspect_ratio: str) -> str:
    normalized = normalize_aspect_ratio(aspect_ratio)
    if normalized in ASPECT_RATIO_SIZE_MAP:
        return ASPECT_RATIO_SIZE_MAP[normalized]

    width_ratio, height_ratio = (float(part) for part in normalized.split(":"))
    max_side = 1536
    if width_ratio >= height_ratio:
        width = max_side
        height = _round_to_multiple(max_side * height_ratio / width_ratio, 8)
    else:
        height = max_side
        width = _round_to_multiple(max_side * width_ratio / height_ratio, 8)
    return f"{width}x{height}"


def append_aspect_ratio_instruction(prompt: str, params: ImageRequestParams) -> str:
    base_prompt = prompt.strip()
    instruction = (
        f" Final output must be exactly one image in {params.aspect_ratio} aspect ratio "
        f"at requested size {params.requested_size}; do not return a square image unless the ratio is 1:1."
    )
    if params.aspect_ratio in base_prompt and params.requested_size in base_prompt:
        return base_prompt
    return f"{base_prompt}{instruction}"


def is_size_string(value: Any) -> bool:
    raw = str(value or "").lower().strip()
    if "x" not in raw:
        return False
    width, height, *rest = raw.split("x")
    return not rest and width.isdigit() and height.isdigit() and int(width) > 0 and int(height) > 0


def aspect_ratio_from_size(value: Any) -> str | None:
    if not is_size_string(value):
        return None
    width_raw, height_raw = str(value).lower().split("x")
    width = int(width_raw)
    height = int(height_raw)
    divisor = _gcd(width, height)
    return f"{width // divisor}:{height // divisor}"


def _round_to_multiple(value: float, multiple: int) -> int:
    return max(multiple, int(round(value / multiple) * multiple))


def _trim_number(value: float) -> str:
    return str(int(value)) if value.is_integer() else f"{value:g}"


def _gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return a
