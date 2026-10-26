r"""Génère les icônes PouleyPwolu aux tailles qu'attend Chromium, à partir de build/icon.png.
    python engine/branding/make-icons.py <dossier des sources Chromium>
Les tailles sont lues dans les fichiers d'origine de Chromium. Le résultat va dans
engine/branding/fichiers/ (copié dans les sources par engine/rebrand.py).
"""
import sys
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
LOGO = Image.open(HERE.parent.parent / 'build' / 'icon.png').convert('RGBA')
PNGS = [
    'chrome/app/theme/chromium/product_logo_16.png',
    'chrome/app/theme/chromium/product_logo_24.png',
    'chrome/app/theme/chromium/product_logo_48.png',
    'chrome/app/theme/chromium/product_logo_64.png',
    'chrome/app/theme/chromium/product_logo_128.png',
    'chrome/app/theme/chromium/product_logo_256.png',
    'chrome/app/theme/default_100_percent/chromium/product_logo_16.png',
    'chrome/app/theme/default_100_percent/chromium/product_logo_32.png',
    'chrome/app/theme/default_200_percent/chromium/product_logo_16.png',
    'chrome/app/theme/default_200_percent/chromium/product_logo_32.png',
    'chrome/app/theme/chromium/win/tiles/Logo.png',
    'chrome/app/theme/chromium/win/tiles/SmallLogo.png',
    # Linux
    'chrome/app/theme/chromium/linux/product_logo_24.png',
    'chrome/app/theme/chromium/linux/product_logo_48.png',
    'chrome/app/theme/chromium/linux/product_logo_64.png',
    'chrome/app/theme/chromium/linux/product_logo_128.png',
    'chrome/app/theme/chromium/linux/product_logo_256.png',
    # macOS : catalogue d'icônes (Assets.car est recompilé sur Mac par engine/rebrand.py)
    'chrome/app/theme/chromium/mac/Assets.xcassets/AppIcon.appiconset/appicon_16.png',
    'chrome/app/theme/chromium/mac/Assets.xcassets/AppIcon.appiconset/appicon_32.png',
    'chrome/app/theme/chromium/mac/Assets.xcassets/AppIcon.appiconset/appicon_64.png',
    'chrome/app/theme/chromium/mac/Assets.xcassets/AppIcon.appiconset/appicon_128.png',
    'chrome/app/theme/chromium/mac/Assets.xcassets/AppIcon.appiconset/appicon_256.png',
    'chrome/app/theme/chromium/mac/Assets.xcassets/AppIcon.appiconset/appicon_512.png',
    'chrome/app/theme/chromium/mac/Assets.xcassets/AppIcon.appiconset/appicon_1024.png',
    'chrome/app/theme/chromium/mac/Assets.xcassets/Icon.iconset/icon_256x256.png',
    'chrome/app/theme/chromium/mac/Assets.xcassets/Icon.iconset/icon_256x256@2x.png',
]
ICNS = 'chrome/app/theme/chromium/mac/app.icns'
ICOS = ['chrome/app/theme/chromium/win/chromium.ico', 'chrome/app/theme/chromium/win/app_list.ico']
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def main():
    src = Path(sys.argv[1])
    out = HERE / 'fichiers'
    for rel in PNGS:
        w, h = Image.open(src / rel).size
        to = out / rel
        to.parent.mkdir(parents=True, exist_ok=True)
        # Les tuiles sont rectangulaires : logo centré sur fond transparent.
        side = min(w, h)
        canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        canvas.paste(LOGO.resize((side, side), Image.LANCZOS), ((w - side) // 2, (h - side) // 2))
        canvas.save(to, optimize=True)
    for rel in ICOS:
        to = out / rel
        to.parent.mkdir(parents=True, exist_ok=True)
        LOGO.save(to, format='ICO', sizes=[(s, s) for s in ICO_SIZES])
    to = out / ICNS
    to.parent.mkdir(parents=True, exist_ok=True)
    LOGO.resize((1024, 1024), Image.LANCZOS).save(to, format='ICNS')
    print(f'{len(PNGS)} PNG, {len(ICOS)} ICO, 1 ICNS dans {out}')


if __name__ == '__main__':
    main()
