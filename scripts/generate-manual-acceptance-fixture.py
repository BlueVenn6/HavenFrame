from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "manual-acceptance" / "fixtures" / "sample-room-plan.png"


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


canvas = Image.new("RGB", (1280, 800), "#f7fafc")
draw = ImageDraw.Draw(canvas)
draw.rectangle((40, 40, 1240, 760), outline="#0f766e", width=8)
draw.rectangle((70, 150, 710, 720), fill="#e6f4f1", outline="#17324d", width=5)
draw.rectangle((710, 150, 1210, 430), fill="#eef4fa", outline="#17324d", width=5)
draw.rectangle((710, 430, 1210, 720), fill="#fff7df", outline="#17324d", width=5)
draw.text((70, 65), "人工验收上传样例", fill="#102a43", font=font(42))
draw.text((795, 75), "QA SAMPLE / 非 AI 输出", fill="#b45309", font=font(28))
draw.rectangle((170, 300, 580, 365), fill="#8fbfb5", outline="#17324d", width=3)
draw.ellipse((830, 225, 1080, 365), fill="#d6e5f2", outline="#17324d", width=3)
draw.rectangle((815, 515, 1110, 640), fill="#f4df9b", outline="#17324d", width=3)
draw.text((290, 400), "客厅", fill="#102a43", font=font(50))
draw.text((900, 370), "餐厅", fill="#102a43", font=font(36))
draw.text((900, 655), "主卧", fill="#102a43", font=font(36))
draw.text((72, 724), "用途：上传、资产持久化、历史回看与真实 Provider 输入测试", fill="#475569", font=font(20))
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
canvas.save(OUTPUT, format="PNG", optimize=True)
print(OUTPUT)
