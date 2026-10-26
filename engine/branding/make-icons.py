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
]
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
    print(f'{len(PNGS)} PNG, {len(ICOS)} ICO dans {out}')


if __name__ == '__main__':
    main()
