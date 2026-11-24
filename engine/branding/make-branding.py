r"""Crée la marque PouleyPwolu dans les sources de Firefox (browser/branding/pouleypwolu)
à partir de la marque « unofficial » : mêmes fichiers, aux mêmes tailles, avec le logo
de PouleyPwolu (build/icon.png) et son nom.

    python engine/branding/make-branding.py <dossier des sources de Firefox>
"""
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
LOGO = Image.open(REPO / 'build' / 'icon.png').convert('RGBA')
LOGO_SVG = (REPO / 'build' / 'icon.svg').read_text(encoding='utf-8')
PREFS = (REPO / 'engine' / 'prefs' / 'pouleypwolu.js').read_text(encoding='utf-8')
NAME = 'PouleyPwolu'
YELLOW = (255, 225, 0, 255)
DARK = (17, 17, 19, 255)
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def logo_on(size, background=None, scale=1.0):
    """Logo centré sur une image de la taille donnée (fond transparent par défaut)."""
    w, h = size
    canvas = Image.new('RGBA', (w, h), background or (0, 0, 0, 0))
    side = max(1, int(min(w, h) * scale))
    canvas.alpha_composite(LOGO.resize((side, side), Image.LANCZOS), ((w - side) // 2, (h - side) // 2))
    return canvas


def replace_png(path):
    w, h = Image.open(path).size
    # Images larges (fonds de l'installateur, tuiles) : logo plus petit sur fond sombre.
    if w != h:
        logo_on((w, h), DARK, 0.6).save(path, optimize=True)
    else:
        logo_on((w, h)).save(path, optimize=True)


def replace_jpg(path):
    w, h = Image.open(path).size
    logo_on((w, h), DARK, 0.35).convert('RGB').save(path, quality=92)


def replace_bmp(path):
    w, h = Image.open(path).size
    logo_on((w, h), (255, 255, 255, 255), 0.7 if w < 200 else 0.45).convert('RGB').save(path)


def replace_ico(path):
    LOGO.save(path, format='ICO', sizes=[(s, s) for s in ICO_SIZES])


def replace_icns(path):
    LOGO.resize((1024, 1024), Image.LANCZOS).save(path, format='ICNS')


def wordmark_svg(height=40):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{len(NAME) * height * 0.62:.0f}" height="{height}" '
        f'viewBox="0 0 {len(NAME) * height * 0.62:.0f} {height}">'
        f'<text x="0" y="{height * 0.78:.0f}" font-family="Segoe UI, system-ui, sans-serif" font-weight="600" '
        f'font-size="{height * 0.86:.0f}" fill="context-fill #f4f4f5">{NAME}</text></svg>\n'
    )


def sub(path, pattern, repl):
    text = path.read_text(encoding='utf-8')
    new, n = re.subn(pattern, repl, text, flags=re.M)
    if n == 0:
        raise SystemExit(f'{path} : motif introuvable {pattern!r}')
    path.write_text(new, encoding='utf-8', newline='\n')


def main():
    src = Path(sys.argv[1])
    base = src / 'browser' / 'branding'
    out = base / 'pouleypwolu'
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(base / 'unofficial', out)

    for p in out.rglob('*'):
        if not p.is_file():
            continue
        ext = p.suffix.lower()
        if ext == '.png':
            replace_png(p)
        elif ext == '.jpg':
            replace_jpg(p)
        elif ext == '.bmp':
            replace_bmp(p)
        elif ext == '.ico':
            replace_ico(p)
        elif ext == '.icns':
            replace_icns(p)

    content = out / 'content'
    (content / 'about-logo.svg').write_text(LOGO_SVG, encoding='utf-8')
    for name in ('about-wordmark.svg', 'firefox-wordmark.svg'):
        (content / name).write_text(wordmark_svg(), encoding='utf-8')

    sub(out / 'configure.sh', r'^MOZ_APP_DISPLAYNAME=.*$', f'MOZ_APP_DISPLAYNAME={NAME}')
    sub(out / 'configure.sh', r'^MOZ_MACBUNDLE_ID=.*$', 'MOZ_MACBUNDLE_ID=site.nads.pouleypwolu')

    ftl = out / 'locales' / 'en-US' / 'brand.ftl'
    for key in ('brand-shorter-name', 'brand-short-name', 'brand-shortcut-name', 'brand-full-name', 'brand-product-name'):
        sub(ftl, rf'^-{key} = .*$', f'-{key} = {NAME}')
    props = out / 'locales' / 'en-US' / 'brand.properties'
    for key in ('brandShorterName', 'brandShortName', 'brandFullName'):
        sub(props, rf'^{key}=.*$', f'{key}={NAME}')

    nsi = out / 'branding.nsi'
    sub(nsi, r'^!define BrandFullNameInternal .*$', f'!define BrandFullNameInternal "{NAME}"')
    sub(nsi, r'^!define BrandFullName .*$', f'!define BrandFullName         "{NAME}"')
    sub(nsi, r'^!define CompanyName .*$', '!define CompanyName           "Nads"')
    sub(nsi, r'^!define URLInfoAbout .*$', '!define URLInfoAbout          "https://github.com/nadsous/PouleyPwolu"')
    sub(nsi, r'^!define HelpLink .*$', '!define HelpLink              "https://github.com/nadsous/PouleyPwolu/issues"')
    sub(nsi, r'^!define Channel .*$', '!define Channel "release"')

    # Réglages de la marque + réglages PouleyPwolu (vie privée, interface).
    pref = out / 'pref' / 'firefox-branding.js'
    text = pref.read_text(encoding='utf-8')
    text = re.sub(r'https://nightly\.mozilla\.org', 'https://github.com/nadsous/PouleyPwolu/releases', text)
    pref.write_text(text + '\n' + PREFS, encoding='utf-8', newline='\n')

    print(f'Marque {NAME} créée dans {out}')


if __name__ == '__main__':
    main()
