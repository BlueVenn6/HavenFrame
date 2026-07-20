from typing import Any

from sqlalchemy.orm import Session

from backend.services import model_service


def get_space_render_config(db: Session) -> dict[str, Any]:
    return {
        "room_types": ["客厅", "餐厅", "卧室", "大堂", "休闲区"],
        "styles": ["柔和极简", "现代轻奢", "温暖现代", "酒店风"],
        "lighting_modes": ["日光", "黄金时刻", "傍晚暖光", "影棚柔光"],
        "provider_options": model_service.list_mobile_image_routes(db),
        "submit_endpoint": "/api/tasks/provider-image",
    }
