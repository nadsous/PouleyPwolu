r"""Prépare les sources de Firefox pour compiler PouleyPwolu.

    python scripts/prepare.py [<dossier des sources de Firefox>]

Par défaut : C:\pwff\src\firefox-<version de engine/source.lock.json>. Le script
peut être relancé autant de fois que voulu (il remplace ce qu'il a déjà ajouté) :
- télécharge et vérifie les sources si le dossier n'existe pas ;
- crée la marque PouleyPwolu (engine/branding/make-branding.py) ;
- installe l'extension intégrée dans browser/extensions/pouleypwolu ;
- y ajoute tor.exe (Tor Expert Bundle, empreinte vérifiée) pour la fenêtre Tor ;
- y ajoute les paquets de langue de Mozilla (empreintes vérifiées) ;
- applique les patches de engine/patches/series ;
- copie engine/mozconfig.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ENGINE = REPO / 'engine'
LOCK = json.loads((ENGINE / 'source.lock.json').read_text(encoding='utf-8'))
VERSION = LOCK['firefox']
WORK = Path(os.environ.get('POULEY_WORK') or LOCK.get('work', r'C:\pwff'))

ADDON_MOZBUILD = '''# Extension intégrée de PouleyPwolu (copiée par scripts/prepare.py).
JAR_MANIFESTS += ["jar.mn"]
DIRS += ["tor", "langues"]
'''
ADDON_JAR = '''browser.jar:
    builtin-addons/pouleypwolu/ (extension/**)
'''
# Tor à côté de pouleypwolu.exe (dossier tor\ de l'installation), pour la fenêtre Tor.
TOR_MOZBUILD = '''# Tor (Tor Project, BSD-3) pour la fenêtre Tor de PouleyPwolu.
FINAL_TARGET = "dist/bin"
FINAL_TARGET_FILES.tor += ["LICENSE-tor.txt", "tor.exe"]
'''
PACKAGE_ANCHOR = '@BINPATH@/browser/VisualElements/PrivateBrowsing_70.png\n'
PACKAGE_TOR = '; PouleyPwolu : Tor pour la fenêtre Tor\n@BINPATH@/tor/tor.exe\n@BINPATH@/tor/LICENSE-tor.txt\n'


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fetch_sources(src):
    archive = WORK / f'firefox-{VERSION}.source.tar.xz'
    if not archive.exists() or sha256(archive) != LOCK['sha256']:
        print(f'Téléchargement de Firefox {VERSION}…')
        WORK.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(LOCK['url'], archive)
    if sha256(archive) != LOCK['sha256']:
        raise SystemExit('Empreinte SHA-256 des sources incorrecte : téléchargement corrompu.')
    print('Extraction…')
    with tarfile.open(archive) as t:
        t.extractall(src.parent, filter='tar')


def install_addon(src):
    dest = src / 'browser' / 'extensions' / 'pouleypwolu'
    # Seule l'extension est remplacée : le dossier tor\ (install_tor) reste en place.
    if (dest / 'extension').exists():
        shutil.rmtree(dest / 'extension')
    shutil.copytree(ENGINE / 'extension', dest / 'extension', ignore=shutil.ignore_patterns('*.md', '.DS_Store'))
    (dest / 'moz.build').write_text(ADDON_MOZBUILD, encoding='utf-8', newline='\n')
    (dest / 'jar.mn').write_text(ADDON_JAR, encoding='utf-8', newline='\n')
    mb = src / 'browser' / 'extensions' / 'moz.build'
    text = mb.read_text(encoding='utf-8')
    if '"pouleypwolu"' not in text:
        text = text.replace('DIRS += [\n', 'DIRS += [\n    "pouleypwolu",\n', 1)
        if '"pouleypwolu"' not in text:
            raise SystemExit('browser/extensions/moz.build : liste DIRS introuvable')
        mb.write_text(text, encoding='utf-8', newline='\n')


def install_tor(src):
    tor = LOCK['tor']
    archive = WORK / f"tor-expert-bundle-{tor['version']}.tar.gz"
    if not archive.exists() or sha256(archive) != tor['sha256']:
        print(f"Téléchargement de Tor {tor['version']}…")
        WORK.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(tor['url'], archive)
    if sha256(archive) != tor['sha256']:
        raise SystemExit('Empreinte SHA-256 de Tor incorrecte : téléchargement corrompu.')
    dest = src / 'browser' / 'extensions' / 'pouleypwolu' / 'tor'
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as t:
        for name, out in (('tor/tor.exe', 'tor.exe'), ('docs/tor.txt', 'LICENSE-tor.txt')):
            data = t.extractfile(name).read()
            (dest / out).write_bytes(data)
    (dest / 'moz.build').write_text(TOR_MOZBUILD, encoding='utf-8', newline='\n')
    manifest = src / 'browser' / 'installer' / 'package-manifest.in'
    text = manifest.read_text(encoding='utf-8')
    if '@BINPATH@/tor/tor.exe' not in text:
        if PACKAGE_ANCHOR not in text:
            raise SystemExit('package-manifest.in : repère introuvable pour ajouter Tor')
        manifest.write_text(text.replace(PACKAGE_ANCHOR, PACKAGE_ANCHOR + PACKAGE_TOR, 1), encoding='utf-8', newline='\n')


LANG_MOZBUILD = '''# Paquets de langue officiels de Mozilla (signés), installés au premier lancement.
FINAL_TARGET = "dist/bin/distribution/extensions"
FINAL_TARGET_FILES += [{files}]
'''
PACKAGE_LANG = '; PouleyPwolu : paquets de langue\n@BINPATH@/distribution/extensions/*\n'


BRAND_FTL = '''-brand-shorter-name = PouleyPwolu
-brand-short-name = PouleyPwolu
-brand-shortcut-name = PouleyPwolu
-brand-full-name = PouleyPwolu
-brand-product-name = PouleyPwolu
-vendor-short-name = Mozilla
trademarkInfo = { " " }
'''
BRAND_PROPERTIES = 'brandShorterName=PouleyPwolu\nbrandShortName=PouleyPwolu\nbrandFullName=PouleyPwolu\n'


def rebrand_langpack(source, target, code):
    """Copie d'un paquet de langue de Mozilla avec la marque PouleyPwolu : sinon le titre
    des fenêtres et les menus disent « Mozilla Firefox ». La signature de Mozilla saute
    (le contenu change) : PouleyPwolu n'exige pas de signature pour les paquets de langue.
    La version monte d'un cran pour remplacer un paquet déjà installé dans le profil."""
    import zipfile
    with zipfile.ZipFile(source) as zin, zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            name = item.filename
            if name.startswith('META-INF/'):
                continue
            data = zin.read(name)
            if name == f'browser/localization/{code}/branding/brand.ftl':
                data = BRAND_FTL.encode('utf-8')
            elif name == f'browser/chrome/{code}/locale/branding/brand.properties':
                data = BRAND_PROPERTIES.encode('utf-8')
            elif name == 'manifest.json':
                manifest = json.loads(data)
                parts = manifest['version'].split('.')
                parts[-1] = parts[-1] + '1'
                manifest['version'] = '.'.join(parts)
                data = json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8')
            zout.writestr(name, data)


def install_languages(src):
    lang = LOCK['langues']
    cache = WORK / 'langues'
    cache.mkdir(parents=True, exist_ok=True)
    dest = src / 'browser' / 'extensions' / 'pouleypwolu' / 'langues'
    dest.mkdir(parents=True, exist_ok=True)
    names = []
    for code, digest in lang['sha256'].items():
        name = f'langpack-{code}@firefox.mozilla.org.xpi'
        f = cache / name
        if not f.exists() or sha256(f) != digest:
            print(f'Langue {code}…')
            urllib.request.urlretrieve(lang['url'].format(code=code), f)
        if sha256(f) != digest:
            raise SystemExit(f'Empreinte SHA-256 du paquet de langue {code} incorrecte.')
        rebrand_langpack(f, dest / name, code)
        names.append(name)
    (dest / 'moz.build').write_text(LANG_MOZBUILD.format(files=', '.join(f'"{n}"' for n in sorted(names))),
                                    encoding='utf-8', newline='\n')
    mb = src / 'browser' / 'extensions' / 'pouleypwolu' / 'moz.build'
    text = mb.read_text(encoding='utf-8')
    if '"langues"' not in text:
        mb.write_text(text.replace('DIRS += ["tor"]', 'DIRS += ["tor", "langues"]'), encoding='utf-8', newline='\n')
    manifest = src / 'browser' / 'installer' / 'package-manifest.in'
    text = manifest.read_text(encoding='utf-8')
    if '@BINPATH@/distribution/extensions/*' not in text:
        manifest.write_text(text.replace(PACKAGE_ANCHOR, PACKAGE_ANCHOR + PACKAGE_LANG, 1), encoding='utf-8', newline='\n')


def install_chrome_style(src):
    # Interface PouleyPwolu dans la fenêtre du navigateur, dès son premier affichage :
    # feuille engine/chrome/pouleypwolu.css liée dans browser.xhtml, fenêtre née avec
    # l'attribut pouley-bar (l'extension l'enlève là où il ne doit pas être).
    base = src / 'browser' / 'base'
    shutil.copyfile(ENGINE / 'chrome' / 'pouleypwolu.css', base / 'content' / 'pouleypwolu.css')
    jar = base / 'jar.mn'
    text = jar.read_text(encoding='utf-8')
    anchor = '        content/browser/browser.xhtml                 (content/browser.xhtml)\n'
    line = '        content/browser/pouleypwolu.css               (content/pouleypwolu.css)\n'
    if line not in text:
        anchor_star = '*' + anchor[1:]
        if anchor_star in text:
            text = text.replace(anchor_star, anchor_star + line, 1)
        elif anchor in text:
            text = text.replace(anchor, anchor + line, 1)
        else:
            raise SystemExit('browser/base/jar.mn : browser.xhtml introuvable')
        jar.write_text(text, encoding='utf-8', newline='\n')
    xhtml = base / 'content' / 'browser.xhtml'
    text = xhtml.read_text(encoding='utf-8')
    if 'pouley-bar="true"' not in text:
        text = text.replace('        windowsmica="true"\n', '        windowsmica="true"\n        pouley-bar="true"\n', 1)
    link = '  <link rel="stylesheet" href="chrome://browser/content/pouleypwolu.css" />\n'
    if link not in text:
        text = text.replace('<link rel="localization" href="branding/brand.ftl"/>', link + '\n  <link rel="localization" href="branding/brand.ftl"/>', 1)
    if 'pouley-bar="true"' not in text or link not in text:
        raise SystemExit('browser.xhtml : repères introuvables pour l\'interface PouleyPwolu')
    xhtml.write_text(text, encoding='utf-8', newline='\n')


def set_vendor(src):
    # Éditeur « Nads » : profils dans %APPDATA%\Nads\PouleyPwolu. Seule la configuration
    # du navigateur peut le fixer (mozconfig refuse MOZ_APP_VENDOR).
    conf = src / 'browser' / 'moz.configure'
    text = conf.read_text(encoding='utf-8')
    old, new = 'imply_option("MOZ_APP_VENDOR", "Mozilla")', 'imply_option("MOZ_APP_VENDOR", "Nads")'
    if new not in text:
        if old not in text:
            raise SystemExit('browser/moz.configure : MOZ_APP_VENDOR introuvable')
        conf.write_text(text.replace(old, new), encoding='utf-8', newline='\n')


def apply_patches(src):
    series = ENGINE / 'patches' / 'series'
    if not series.exists():
        return
    stamp = src / '.pouleypwolu-patches'
    done = set(stamp.read_text(encoding='utf-8').split()) if stamp.exists() else set()
    for line in series.read_text(encoding='utf-8').splitlines():
        name = line.strip()
        if not name or name.startswith('#') or name in done:
            continue
        print(f'Patch {name}')
        subprocess.run(['git', 'apply', '--whitespace=nowarn', str(ENGINE / 'patches' / name)], cwd=src, check=True)
        done.add(name)
        stamp.write_text('\n'.join(sorted(done)), encoding='utf-8')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    src = Path(args[0]) if args else WORK / 'src' / f'firefox-{VERSION}'
    # --extension : recopie seulement l'extension intégrée dans les sources ; ensuite
    # « mach build faster » la met à jour dans dist\bin (voir scripts\essai.ps1).
    if '--extension' in sys.argv:
        install_addon(src)
        print(f'Extension recopiée dans {src}')
        return
    if not (src / 'mach').exists():
        fetch_sources(src)
    subprocess.run([sys.executable, str(ENGINE / 'branding' / 'make-branding.py'), str(src)], check=True)
    install_addon(src)
    install_tor(src)
    install_languages(src)
    install_chrome_style(src)
    set_vendor(src)
    apply_patches(src)
    shutil.copyfile(ENGINE / 'mozconfig', src / 'mozconfig')
    print(f'Sources prêtes : {src}')


if __name__ == '__main__':
    main()
