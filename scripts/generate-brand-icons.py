from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "brand" / "logo-source.png"

TAURI_ICONS = ROOT / "app" / "src-tauri" / "icons"
MOBILE_ASSETS = ROOT / "mobile-expo" / "assets"
ANDROID_RES = ROOT / "mobile-expo" / "android" / "app" / "src" / "main" / "res"

DARK_BG = (1, 20, 35, 255)
SPLASH_BG = (255, 255, 255, 255)


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def load_source() -> Image.Image:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Missing source icon: {SOURCE}")
    return Image.open(SOURCE).convert("RGBA")


def square_crop(image: Image.Image) -> Image.Image:
    width, height = image.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    return image.crop((left, top, left + side, top + side))


def crop_alpha_icon(image: Image.Image, *, padding_ratio: float = 0.015) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        return square_crop(image)
    left, top, right, bottom = bbox
    width = right - left
    height = bottom - top
    pad = int(max(width, height) * padding_ratio)
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(image.width, right + pad)
    bottom = min(image.height, bottom + pad)
    return square_crop(image.crop((left, top, right, bottom)))


def fit_on_canvas(
    image: Image.Image,
    size: int,
    *,
    scale: float = 1.0,
    background: tuple[int, int, int, int] | None = None,
) -> Image.Image:
    image = square_crop(image)
    target = max(1, int(size * scale))
    fitted = ImageOps.contain(image, (target, target), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), background or (0, 0, 0, 0))
    canvas.alpha_composite(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
    return canvas


def save_png(path: Path, image: Image.Image, *, flatten: bool = False, background=DARK_BG) -> None:
    ensure_parent(path)
    out = image
    if flatten:
        base = Image.new("RGBA", out.size, background)
        base.alpha_composite(out)
        out = base.convert("RGB")
    out.save(path, "PNG", optimize=True)


def save_webp(path: Path, image: Image.Image, *, flatten: bool = False, background=DARK_BG) -> None:
    ensure_parent(path)
    out = image
    if flatten:
        base = Image.new("RGBA", out.size, background)
        base.alpha_composite(out)
        out = base.convert("RGB")
    out.save(path, "WEBP", quality=92, method=6)


def save_ico(path: Path, image: Image.Image) -> None:
    ensure_parent(path)
    base = fit_on_canvas(image, 256, scale=0.96)
    base.save(path, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


def save_icns(path: Path, image: Image.Image) -> None:
    ensure_parent(path)
    base = fit_on_canvas(image, 1024, scale=0.96)
    base.save(path, format="ICNS")


def monochrome_mark(image: Image.Image, size: int, *, scale: float = 0.78) -> Image.Image:
    source = fit_on_canvas(image, size, scale=scale)
    pixels = source.load()
    mask = Image.new("L", source.size, 0)
    mask_pixels = mask.load()
    for y in range(source.height):
        for x in range(source.width):
            r, g, b, a = pixels[x, y]
            if a < 8:
                continue
            # Keep the teal house mark and highlights, but drop the dark rounded background.
            if g > 80 and g > b * 0.85 and g > r * 1.15:
                mask_pixels[x, y] = min(255, int(a * 1.15))
    out = Image.new("RGBA", source.size, (255, 255, 255, 0))
    out.putalpha(mask)
    return out


def windows_small_icon(image: Image.Image, size: int) -> Image.Image:
    """Render a crisp, flat variant for 16-64 px Windows shell surfaces."""
    supersampled_size = max(256, size * 8)
    canvas = Image.new("RGBA", (supersampled_size, supersampled_size), (0, 0, 0, 0))
    inset = max(2, int(supersampled_size * 0.025))
    radius = int(supersampled_size * 0.21)
    ImageDraw.Draw(canvas).rounded_rectangle(
        (inset, inset, supersampled_size - inset, supersampled_size - inset),
        radius=radius,
        fill=DARK_BG,
    )
    mark_mask = monochrome_mark(image, supersampled_size, scale=0.78).getchannel("A")
    mark = Image.new("RGBA", canvas.size, (72, 213, 194, 255))
    mark.putalpha(mark_mask)
    canvas.alpha_composite(mark)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def solid_background(size: int, color=DARK_BG) -> Image.Image:
    return Image.new("RGBA", (size, size), color)


def generate_tauri(source: Image.Image) -> None:
    icon = crop_alpha_icon(source)
    png_specs = {
        "32x32.png": 32,
        "64x64.png": 64,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    for filename, size in png_specs.items():
        rendered = windows_small_icon(icon, size) if size <= 64 else fit_on_canvas(icon, size, scale=0.96)
        save_png(TAURI_ICONS / filename, rendered)

    save_ico(TAURI_ICONS / "icon.ico", windows_small_icon(icon, 256))
    save_icns(TAURI_ICONS / "icon.icns", icon)

    ios_specs = {
        "AppIcon-20x20@1x.png": 20,
        "AppIcon-20x20@2x.png": 40,
        "AppIcon-20x20@2x-1.png": 40,
        "AppIcon-20x20@3x.png": 60,
        "AppIcon-29x29@1x.png": 29,
        "AppIcon-29x29@2x.png": 58,
        "AppIcon-29x29@2x-1.png": 58,
        "AppIcon-29x29@3x.png": 87,
        "AppIcon-40x40@1x.png": 40,
        "AppIcon-40x40@2x.png": 80,
        "AppIcon-40x40@2x-1.png": 80,
        "AppIcon-40x40@3x.png": 120,
        "AppIcon-60x60@2x.png": 120,
        "AppIcon-60x60@3x.png": 180,
        "AppIcon-76x76@1x.png": 76,
        "AppIcon-76x76@2x.png": 152,
        "AppIcon-83.5x83.5@2x.png": 167,
        "AppIcon-512@2x.png": 1024,
    }
    for filename, size in ios_specs.items():
        save_png(TAURI_ICONS / "ios" / filename, fit_on_canvas(icon, size, scale=0.96, background=DARK_BG), flatten=True)


def generate_mobile_assets(source: Image.Image) -> None:
    icon = crop_alpha_icon(source)
    save_png(MOBILE_ASSETS / "icon.png", fit_on_canvas(icon, 1024, scale=0.96, background=DARK_BG), flatten=True)
    save_png(MOBILE_ASSETS / "favicon.png", fit_on_canvas(icon, 48, scale=0.96))
    save_png(MOBILE_ASSETS / "splash-icon.png", fit_on_canvas(icon, 512, scale=0.62))
    save_png(MOBILE_ASSETS / "android-icon-background.png", solid_background(432), flatten=True)
    save_png(MOBILE_ASSETS / "android-icon-foreground.png", fit_on_canvas(icon, 432, scale=0.78))
    save_png(MOBILE_ASSETS / "android-icon-monochrome.png", monochrome_mark(icon, 432, scale=0.78))


def generate_android_native(source: Image.Image) -> None:
    icon = crop_alpha_icon(source)
    densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    foreground_sizes = {
        "mipmap-mdpi": 108,
        "mipmap-hdpi": 162,
        "mipmap-xhdpi": 216,
        "mipmap-xxhdpi": 324,
        "mipmap-xxxhdpi": 432,
    }
    for folder, size in densities.items():
        res_dir = ANDROID_RES / folder
        save_webp(res_dir / "ic_launcher.webp", fit_on_canvas(icon, size, scale=0.96, background=DARK_BG), flatten=True)
        save_webp(res_dir / "ic_launcher_round.webp", fit_on_canvas(icon, size, scale=0.96, background=DARK_BG), flatten=True)

    for folder, size in foreground_sizes.items():
        res_dir = ANDROID_RES / folder
        save_webp(res_dir / "ic_launcher_background.webp", solid_background(size), flatten=True)
        save_webp(res_dir / "ic_launcher_foreground.webp", fit_on_canvas(icon, size, scale=0.78))
        save_webp(res_dir / "ic_launcher_monochrome.webp", monochrome_mark(icon, size, scale=0.78))

    splash_specs = {
        "drawable-mdpi": 72,
        "drawable-hdpi": 108,
        "drawable-xhdpi": 144,
        "drawable-xxhdpi": 216,
        "drawable-xxxhdpi": 288,
    }
    for folder, size in splash_specs.items():
        save_png(ANDROID_RES / folder / "splashscreen_logo.png", fit_on_canvas(icon, size, scale=0.62))


def main() -> None:
    source = load_source()
    generate_tauri(source)
    generate_mobile_assets(source)
    generate_android_native(source)
    print(f"Generated brand icons from {SOURCE}")


if __name__ == "__main__":
    main()
