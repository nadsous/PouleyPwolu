#!/usr/bin/env bash
# Ajoute les patches et le nom PouleyPwolu à ungoogled-chromium-macos ou
# ungoogled-chromium-portablelinux (déjà récupéré à la version de engine/source.lock.json).
#   bash scripts/prepare-unix.sh macos <dossier ungoogled-chromium-macos>
#   bash scripts/prepare-unix.sh linux <dossier ungoogled-chromium-portablelinux>
# Équivalent de scripts/prepare.ps1 pour Windows. Utilisé par les workflows
# moteur-macos et moteur-linux, à chaque étape (le dossier est récupéré à neuf).
set -euo pipefail

platform="$1"
dir="$(cd "$2" && pwd)"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
marker="$dir/.pouley-prepared"
[[ -f "$marker" ]] && { echo "Déjà préparé : $dir"; exit 0; }

# Remplace une chaîne dans un fichier, en vérifiant qu'elle y est.
replace() {
  local file="$1" from="$2" to="$3"
  python3 - "$file" "$from" "$to" <<'PY'
import sys
path, old, new = sys.argv[1:4]
text = open(path, encoding='utf-8').read()
if old not in text:
    sys.exit(f'{path} : « {old} » introuvable')
open(path, 'w', encoding='utf-8').write(text.replace(old, new))
PY
}

# 1. Patches PouleyPwolu, à la fin de la série de la plateforme.
mkdir -p "$dir/patches/pouley"
grep -v '^[[:space:]]*#' "$root/engine/patches/series" | sed '/^[[:space:]]*$/d' | while read -r p; do
  cp "$root/engine/patches/$p" "$dir/patches/pouley/$p"
  echo "pouley/$p" >> "$dir/patches/series"
done

# 2. Nom, icônes et extension intégrée (engine/rebrand.py), lancés juste après les patches.
rm -rf "$dir/pouley"
mkdir -p "$dir/pouley"
cp "$root/engine/rebrand.py" "$dir/pouley/"
cp -R "$root/engine/branding" "$root/engine/extension" "$root/engine/nadspdf.key" "$dir/pouley/"
cp -R "$root/extensions/nadspdf" "$dir/pouley/nadspdf"

# 3. Réglages GN : ajoutés à ceux de la plateforme (la dernière valeur l'emporte).
flags="$dir/flags.$platform.gn"
[[ "$platform" == "macos" ]] || flags="$dir/flags.linux.gn"
{ echo; cat "$root/engine/flags.gn"; } >> "$flags"

case "$platform" in
  macos)
    # Renommage après la substitution de domaines.
    replace "$dir/.github/scripts/github_fetch_resources.sh" \
      'python3 "$_main_repo/utils/domain_substitution.py" apply -r "$_main_repo/domain_regex.list" -f "$_main_repo/domain_substitution.list" "$_src_dir"' \
      'python3 "$_main_repo/utils/domain_substitution.py" apply -r "$_main_repo/domain_regex.list" -f "$_main_repo/domain_substitution.list" "$_src_dir"
python3 "$_root_dir/pouley/rebrand.py" "$_src_dir"'
    # L'application s'appelle PouleyPwolu.app (BRANDING), ses aides aussi.
    s="$dir/sign_and_package_app.sh"
    replace "$s" '_app="$_src_dir/out/Default/Chromium.app"' '_app="$_src_dir/out/Default/PouleyPwolu.app"'
    replace "$s" '_framework="$_app/Contents/Frameworks/Chromium Framework.framework"' '_framework="$_app/Contents/Frameworks/PouleyPwolu Framework.framework"'
    sed -i.bak 's/Chromium Helper/PouleyPwolu Helper/g; s/io\.ungoogled-software\.ungoogled-chromium/site.nads.pouleypwolu/g; s/--volname Chromium/--volname PouleyPwolu/' "$s"
    rm -f "$s.bak"
    # Extension intégrée dans les ressources du framework, avant la signature.
    replace "$s" 'xattr -cs "$_app"' 'xattr -cs "$_app"

# PouleyPwolu : extension intégrée (chrome::DIR_RESOURCES = Resources du framework).
rm -rf "$_framework/Resources/pouley"
cp -R "$_src_dir/out/Default/resources/pouley" "$_framework/Resources/pouley"'
    # Sans certificat Apple : signature ad hoc, pas de trousseau ni de notarisation.
    a="$dir/.github/scripts/github_prepare_artifacts.sh"
    replace "$a" '  # Prepare the certificate for app signing' '  # PouleyPwolu : certificat Apple seulement s'"'"'il y en a un.
  if [[ -n "${MACOS_CERTIFICATE:-}" ]]; then
  # Prepare the certificate for app signing'
    replace "$a" '  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$MACOS_CI_KEYCHAIN_PWD" build.keychain' '  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$MACOS_CI_KEYCHAIN_PWD" build.keychain
  else
    export MACOS_AD_HOC_SIGNING=1
  fi'
    replace "$a" '_file_name="ungoogled-chromium_${_chromium_version}-${_ungoogled_revision}.${_package_revision}_${_target_cpu}-macos.dmg"' '_file_name="PouleyPwolu_${_chromium_version}_${_target_cpu}-macos.dmg"'
    ;;
  linux)
    replace "$dir/scripts/shared.sh" \
      '"${_main_repo}/utils/domain_substitution.py" apply -r "${_main_repo}/domain_regex.list" -f "${_main_repo}/domain_substitution.list" "${_src_dir}"' \
      '"${_main_repo}/utils/domain_substitution.py" apply -r "${_main_repo}/domain_regex.list" -f "${_main_repo}/domain_substitution.list" "${_src_dir}"
        python3 "${_root}/pouley/rebrand.py" "${_src_dir}"'
    p="$dir/scripts/package.sh"
    replace "$p" '_app_name="ungoogled-chromium"' '_app_name="PouleyPwolu"'
    replace "$p" '_update_info="gh-releases-zsync|ungoogled-software|ungoogled-chromium-portablelinux|latest|$_app_name-*-$_arch.AppImage.zsync"' '_update_info="gh-releases-zsync|nadsous|PouleyPwolu|latest|$_app_name-*-$_arch.AppImage.zsync"'
    # Extension intégrée à côté du navigateur (chrome::DIR_RESOURCES = <dossier>/resources).
    replace "$p" 'for file in $_files; do
    cp -r "$_build_dir/src/out/Default/$file" "$_tarball_dir" &
done
wait' 'for file in $_files; do
    cp -r "$_build_dir/src/out/Default/$file" "$_tarball_dir" &
done
wait
mkdir -p "$_tarball_dir/resources"
cp -r "$_build_dir/src/out/Default/resources/pouley" "$_tarball_dir/resources/"'
    # Noms des fichiers produits (AppImage, tar.xz) dans l'action d'empaquetage.
    sed -i 's|build/release/ungoogled-chromium-|build/release/PouleyPwolu-|g; s|name: ungoogled-chromium-|name: PouleyPwolu-|g' "$dir/.github/actions/package/action.yml"
    d="$dir/package/ungoogled-chromium.desktop"
    sed -i 's/^Name=.*/Name=PouleyPwolu/; s/^GenericName=.*/GenericName=Navigateur web/; s/^Comment=.*/Comment=Navigateur léger et privé/' "$d"
    ;;
  *) echo "Plateforme inconnue : $platform" >&2; exit 1 ;;
esac

touch "$marker"
echo "Prêt : $dir ($platform), $(ls "$dir/patches/pouley" | wc -l) patch(es) PouleyPwolu."
