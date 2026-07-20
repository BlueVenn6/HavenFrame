from typing import Any

from sqlalchemy.orm import Session

from backend.services import model_service


def get_floorplan_config(db: Session) -> dict[str, Any]:
    return {
        "output_modes": [
            {"label": "2D 彩色平面图", "value": "2d_color"},
            {"label": "3D 鸟瞰平面图", "value": "3d_birdview"},
        ],
        "styles": ["现代暖调", "柔和极简", "酒店轻奢", "自然中性"],
        "provider_options": model_service.list_mobile_image_routes(db),
        "submit_endpoint": "/api/tasks/provider-image",
    }
