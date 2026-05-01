#!/usr/bin/env bash
# Build (and optionally push) the Glovebox base images.
#
# Usage:
#   ./build.sh                      build all images locally
#   ./build.sh media                build only glovebox/media
#   ./build.sh --push               build + push all to $REGISTRY
#   ./build.sh --push media docs    build + push selected
#   ./build.sh --tag 1.5            override the image tag for this run
#
# Environment:
#   REGISTRY   default ghcr.io/dterminal
#   PLATFORM   default linux/amd64

set -euo pipefail

cd "$(dirname "$0")"

REGISTRY="${REGISTRY:-ghcr.io/dterminal}"
PLATFORM="${PLATFORM:-linux/amd64}"

declare -A IMAGES=(
  [base]=1.0
  [media]=1.4
  [docs]=1.2
  [python]=1.3
  [browser]=1.1
)

# base must build first since the others FROM it.
ORDER=(base media docs python browser)

push=0
tag_override=""
selected=()

while (($#)); do
  case "$1" in
    --push) push=1; shift ;;
    --tag) tag_override="$2"; shift 2 ;;
    --tag=*) tag_override="${1#--tag=}"; shift ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) selected+=("$1"); shift ;;
  esac
done

if [[ ${#selected[@]} -eq 0 ]]; then
  selected=("${ORDER[@]}")
fi

build_one() {
  local name="$1"
  local default_tag="${IMAGES[$name]}"
  local tag="${tag_override:-$default_tag}"
  local ref="${REGISTRY}/glovebox/${name}:${tag}"

  echo "==> build ${ref}"
  if (( push )); then
    docker buildx build \
      --platform "$PLATFORM" \
      --tag "$ref" \
      --tag "${REGISTRY}/glovebox/${name}:latest" \
      --push \
      "${name}/"
  else
    docker build \
      --tag "$ref" \
      --tag "${REGISTRY}/glovebox/${name}:latest" \
      "${name}/"
  fi
}

# Always build base first if it's selected, OR if any non-base is selected
# and the local cache doesn't already have it.
if [[ " ${selected[*]} " == *" base "* ]]; then
  :
else
  if ! docker image inspect "${REGISTRY}/glovebox/base:${IMAGES[base]}" >/dev/null 2>&1; then
    selected=(base "${selected[@]}")
  fi
fi

# Reorder selection to match ORDER so base runs first.
final=()
for name in "${ORDER[@]}"; do
  for s in "${selected[@]}"; do
    if [[ "$s" == "$name" ]]; then
      final+=("$name")
      break
    fi
  done
done

for name in "${final[@]}"; do
  build_one "$name"
done

echo "==> done"
