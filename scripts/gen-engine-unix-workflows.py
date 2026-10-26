"""Génère les workflows du moteur pour macOS et Linux à partir de ceux d'ungoogled-chromium.
    python scripts/gen-engine-unix-workflows.py
Les workflows d'ungoogled-chromium-macos et d'ungoogled-chromium-portablelinux (aux versions de
engine/source.lock.json) découpent déjà la compilation en étapes de moins de 6 h. On les
reprend tels quels, sauf la récupération des sources : chaque étape récupère leur dépôt à la
version figée, puis le nôtre dans pouley-src/, et lance scripts/prepare-unix.sh.
Modifier ce script, pas les fichiers générés.
"""
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / 'engine' / 'source.lock.json').read_text(encoding='utf-8'))
WF = ROOT / '.github' / 'workflows'
HEADER = '# Généré par scripts/gen-engine-unix-workflows.py à partir de {src} : ne pas modifier.\n'


def fetch(repo, commit, path):
    url = f'https://raw.githubusercontent.com/ungoogled-software/{repo}/{commit}/{path}'
    with urllib.request.urlopen(url) as r:
        return r.read().decode('utf-8')


def checkout(platform, repo, commit, indent):
    pad = ' ' * indent
    return (f'{pad}- name: {repo} (version figée)\n'
            f'{pad}  uses: actions/checkout@v6\n'
            f'{pad}  with:\n'
            f'{pad}    repository: ungoogled-software/{repo}\n'
            f'{pad}    ref: {commit}\n'
            f'{pad}    submodules: true\n'
            f'{pad}- name: PouleyPwolu\n'
            f'{pad}  uses: actions/checkout@v6\n'
            f'{pad}  with:\n'
            f'{pad}    path: pouley-src\n'
            f'{pad}- name: Patches, nom et extension PouleyPwolu\n'
            f'{pad}  run: bash pouley-src/scripts/prepare-unix.sh {platform} .\n')


def macos():
    lock = LOCK['macos']
    repo = 'ungoogled-chromium-macos'
    src = fetch(repo, lock['commit'], '.github/workflows/building.yml')
    pattern = re.compile(r'^( *)- name: Clone repository\n\1  uses: actions/checkout@v\d+\n\1  with:\n\1    submodules: true\n', re.M)
    out, n = pattern.subn(lambda m: checkout('macos', repo, lock['commit'], len(m.group(1))), src)
    assert n > 10, f'macOS : {n} récupération(s) remplacée(s)'
    # Pas de certificat Apple : signature ad hoc (voir scripts/prepare-unix.sh).
    out = re.sub(r'^env:\n(?:  .*\n)+', 'env:\n  MACOS_AD_HOC_SIGNING: "1"\n', out, count=1, flags=re.M)
    out = out.replace('name: Building macOS binaries of Ungoogled Chromium', 'name: moteur-macos-etapes', 1)
    (WF / 'moteur-macos-etapes.yml').write_text(HEADER.format(src=f'{repo}@{lock["tag"]}') + out, encoding='utf-8')
    (WF / 'moteur-macos.yml').write_text(HEADER.format(src='ungoogled-chromium-macos') + '''# Compile le moteur Chromium de PouleyPwolu pour macOS (Apple Silicon et Intel) sur les machines
# Mac gratuites de GitHub, en étapes chaînées (moteur-macos-etapes.yml). Compter 1 à 2 jours.
# Résultat : les artefacts PouleyPwolu_<version>_<arch>-macos.dmg de l'exécution.
name: moteur-macos
on:
  workflow_dispatch:
  push:
    tags:
      - 'moteur-*'

permissions:
  contents: read

concurrency:
  group: moteur-macos-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:
    strategy:
      matrix:
        include:
          - arch: arm64
            os: macos-15
          - arch: x86_64
            os: macos-15-intel
      fail-fast: false
      max-parallel: 2
    uses: ./.github/workflows/moteur-macos-etapes.yml
    with:
      arch: ${{ matrix.arch }}
      os: ${{ matrix.os }}
''', encoding='utf-8')
    return n


def linux():
    lock = LOCK['linux']
    repo = 'ungoogled-chromium-portablelinux'
    src = fetch(repo, lock['commit'], '.github/workflows/build-steps.yml')
    long_form = re.compile(r'^( *)- name: Clone repository\n\1  uses: actions/checkout@v\d+\n\1  with: \{ submodules: true \}\n', re.M)
    short_form = re.compile(r'^( *)- uses: actions/checkout@v\d+\n\1  with: \{ submodules: true \}\n', re.M)
    out, a = long_form.subn(lambda m: checkout('linux', repo, lock['commit'], len(m.group(1))), src)
    out, b = short_form.subn(lambda m: checkout('linux', repo, lock['commit'], len(m.group(1))), out)
    assert a + b > 5, f'Linux : {a + b} récupération(s) remplacée(s)'
    out = out.replace('name: Building Linux AppImage for ungoogled-chromium', 'name: moteur-linux-etapes', 1)
    (WF / 'moteur-linux-etapes.yml').write_text(HEADER.format(src=f'{repo}@{lock["tag"]}') + out, encoding='utf-8')
    (WF / 'moteur-linux.yml').write_text(HEADER.format(src='ungoogled-chromium-portablelinux') + '''# Compile le moteur Chromium de PouleyPwolu pour Linux (x86_64 et arm64) sur les machines
# gratuites de GitHub, dans le conteneur Docker d'ungoogled-chromium (moteur-linux-etapes.yml).
# Résultat : les artefacts PouleyPwolu-<version>-<arch>.AppImage et _linux.tar.xz.
name: moteur-linux
on:
  workflow_dispatch:
  push:
    tags:
      - 'moteur-*'

permissions:
  contents: read

concurrency:
  group: moteur-linux-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:
    strategy:
      matrix:
        arch: [x86_64, arm64]
      fail-fast: false
      max-parallel: 2
    uses: ./.github/workflows/moteur-linux-etapes.yml
    with:
      arch: ${{ matrix.arch }}
      runs-on: ubuntu-latest
''', encoding='utf-8')
    return a + b


if __name__ == '__main__':
    print(f'macOS : {macos()} étapes adaptées')
    print(f'Linux : {linux()} étapes adaptées')
