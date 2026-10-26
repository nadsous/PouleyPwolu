r"""Nom et icônes PouleyPwolu dans les sources de Chromium.

Lancé après les patches (build.py, via scripts/prepare.ps1) ou à la main :
    python engine/rebrand.py <dossier des sources Chromium>

1. Icônes : engine/branding/fichiers/ est copié par-dessus les sources (fichiers binaires,
   que les patches quilt ne savent pas transporter).
2. Textes : « Chromium » devient « PouleyPwolu » dans les messages de l'interface. Chaque
   traduction (.xtb) est retrouvée par une empreinte calculée sur le texte anglais : on
   recalcule ces empreintes avec grit, sinon toutes les langues retomberaient sur l'anglais.
   « The Chromium Authors » (droits d'auteur) et « Chromium OS » ne changent pas.
Relancer le script ne change rien de plus.
"""
import os
import re
import shutil
import sys
from pathlib import Path

NAME = 'PouleyPwolu'
# Espace ordinaire ou insécable (« Chromium OS » s'écrit avec une insécable en français).
WORD = re.compile(r'Chromium(?![  ]Authors|[  ]?OS\b)')
# Fichiers de messages dont le texte dit « Chromium » (avec leurs .grdp inclus).
GRDS = ['chrome/app/chromium_strings.grd', 'components/components_chromium_strings.grd']
HERE = Path(__file__).resolve().parent


# Fins de ligne gardées telles quelles (les .xtb sont en CRLF) : diff minimal.
def read(p):
    with open(p, encoding='utf-8', newline='') as f:
        return f.read()


def write(p, text):
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def copy_icons(src):
    files = HERE / 'branding' / 'fichiers'
    n = 0
    for f in files.rglob('*'):
        if f.is_file():
            to = src / f.relative_to(files)
            to.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(f, to)
            n += 1
    return n


def message_ids(grd):
    """Empreintes de traduction des messages, dans l'ordre du fichier, calculées par grit.
    Toutes les branches <if> sont lues (un même nom peut y apparaître plusieurs fois) : la
    vérification d'unicité de grit, qui évalue les conditions de compilation, est coupée."""
    from grit import grd_reader
    from grit.node import message, misc
    misc.GritNode.ValidateUniqueIds = lambda self: None
    root = grd_reader.Parse(str(grd), dir=str(grd.parent), debug=False)
    return [node.GetCliques()[0].GetId() for node in root.Preorder() if isinstance(node, message.MessageNode)]


def rebrand_grd(src, rel):
    grd = src / rel
    text = read(grd)
    parts = [grd.parent / p for p in re.findall(r'<part file="([^"]+)"', text)]
    sources = [grd] + [p for p in parts if p.exists()]
    if not any(WORD.search(read(p)) for p in sources):
        return 0, 0  # déjà fait
    before = message_ids(grd)
    for p in sources:
        write(p, WORD.sub(NAME, read(p)))
    after = message_ids(grd)
    if len(before) != len(after):
        raise SystemExit(f'{rel} : nombre de messages différent après renommage')
    remap = {o: n for o, n in zip(before, after) if o != n}
    n_xtb = 0
    for xtb in re.findall(r'<file path="([^"]+\.xtb)"', text):
        path = grd.parent / xtb
        if not path.exists():
            continue
        body = read(path)

        def fix(m):
            old = m.group(1)
            return '<translation id="%s"%s>%s</translation>' % (remap.get(old, old), m.group(2), WORD.sub(NAME, m.group(3)))
        new = re.sub(r'<translation id="(\d+)"([^>]*)>(.*?)</translation>', fix, body, flags=re.S)
        if new != body:
            write(path, new)
            n_xtb += 1
    return len(remap), n_xtb


def main():
    src = Path(sys.argv[1]).resolve()
    sys.path.insert(0, str(src / 'tools' / 'grit'))
    print(f'Icônes : {copy_icons(src)} fichier(s)')
    for rel in GRDS:
        msgs, xtbs = rebrand_grd(src, rel)
        print(f'{rel} : {msgs} message(s) renommé(s), {xtbs} langue(s)')


if __name__ == '__main__':
    main()
