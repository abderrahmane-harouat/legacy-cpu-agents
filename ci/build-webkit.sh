#!/usr/bin/env bash
# Build oven-sh/WebKit's `bun-webkit-linux-amd64` lane (JavaScriptCore + ICU, what Bun links) at the legacy x86-64
# floor instead of -march=nehalem. Same Dockerfile, same toolchain image and same settings as oven-sh's CI; only
# MARCH_FLAG changes, and -g is dropped from DEFAULT_CFLAGS to fit a 4-core runner.
#
#   build-webkit.sh <webkit checkout> <output dir>
set -euo pipefail
src=$(realpath "$1")
out=$2
LABEL=bun-webkit-linux-amd64
LEGACY_MARCH=${LEGACY_MARCH:-"-march=x86-64 -mcx16 -msahf"}

cd "$src"
# The toolchain image is oven-sh's (public on ghcr.io): its tag is a hash of the Dockerfile's `base` stage.
lane=$(GITHUB_REPOSITORY_OWNER=oven-sh node .github/scripts/lanes.mjs --json | jq -c --arg l "$LABEL" '.[] | select(.label == $l)')
[ -n "$lane" ] || { echo "no lane $LABEL" >&2; exit 1; }
image=$(jq -r .image <<<"$lane")
echo "toolchain image: $image"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "image=$image" >>"$GITHUB_OUTPUT"

default_cflags=$(sed -n 's/^ARG DEFAULT_CFLAGS="\(.*\)"$/\1/p' Dockerfile)
[ -n "$default_cflags" ] || { echo "DEFAULT_CFLAGS not found in Dockerfile" >&2; exit 1; }
default_cflags=$(sed 's/ -g / /' <<<" $default_cflags ")

args=()
while IFS= read -r kv; do
  case "$kv" in MARCH_FLAG=*) continue ;; esac
  args+=(--build-arg "$kv")
done < <(jq -r '.build_args | to_entries[] | "\(.key)=\(.value)"' <<<"$lane")
args+=(--build-arg "MARCH_FLAG=--target=x86_64-unknown-linux-gnu $LEGACY_MARCH")
args+=(--build-arg "DEFAULT_CFLAGS=$default_cflags")

base=()
if docker buildx imagetools inspect "$image" >/dev/null 2>&1; then
  base=(--build-context "base=docker-image://$image")
else
  echo "::warning::$image is not on ghcr.io any more; building the toolchain stage from the Dockerfile"
fi

set -x
docker buildx build -f Dockerfile --platform linux/amd64 --progress=plain "${args[@]}" "${base[@]}" \
  --target=artifact --output "type=local,dest=$out" .
