#!/bin/sh
# Génère .github/workflows/moteur-windows.yml : 16 étapes chaînées (GitHub n'a pas de boucle).
#   sh scripts/gen-engine-workflow.sh
set -e
STAGES=16
out="$(dirname "$0")/../.github/workflows/moteur-windows.yml"
{
cat <<'HEAD'
# Compile le moteur Chromium de PouleyPwolu (Windows x64) sur les machines GitHub gratuites.
# Une machine gratuite s'arrête après 6 h : la compilation est découpée en étapes de ~3 h 30
# qui se passent le relais par artefact (comme ungoogled-chromium-windows). Compter 1 à 2 jours.
# Résultat : l'artefact « chromium » (installateur .exe et .zip) de l'exécution.
# Généré par scripts/gen-engine-workflow.sh : modifier le script, pas ce fichier.
name: moteur-windows
on:
  workflow_dispatch:
  push:
    tags:
      - 'moteur-*'

permissions:
  contents: read

concurrency:
  group: moteur-windows-${{ github.ref }}
  cancel-in-progress: false

jobs:
HEAD
i=1
while [ $i -le $STAGES ]; do
  echo "  etape-$i:"
  if [ $i -gt 1 ]; then echo "    needs: etape-$((i-1))"; fi
  cat <<STEP
    runs-on: windows-2022
    timeout-minutes: 350
    steps:
      - uses: actions/checkout@v6
      - uses: ./.github/actions/engine-prepare
      - id: stage
        uses: ./.github/actions/engine-stage
        with:
STEP
  if [ $i -eq 1 ]; then
    echo "          finished: false"
    echo "          from_artifact: false"
  else
    echo "          finished: \${{ needs.etape-$((i-1)).outputs.finished }}"
    echo "          from_artifact: true"
  fi
  cat <<STEP
    outputs:
      finished: \${{ steps.stage.outputs.finished }}
STEP
  i=$((i+1))
done
cat <<TAIL
  fin:
    needs: etape-$STAGES
    runs-on: ubuntu-latest
    steps:
      - name: Compilation terminée ?
        run: |
          if [ "\${{ needs.etape-$STAGES.outputs.finished }}" != "true" ]; then
            echo "La compilation n'a pas fini en $STAGES étapes."
            exit 1
          fi
TAIL
} > "$out"
