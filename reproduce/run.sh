#!/bin/sh
# Offline demo: runs four programs on the VM executor and on the E2B executor, before and after the patch.
# Needs Docker and a clone of mcp-use with dependencies installed. No key, no network.
# usage: sh reproduce/run.sh <path to mcp-use clone>
set -eu
REPO=${1:?usage: sh reproduce/run.sh <path to mcp-use clone>}
REPO=$(cd "$REPO" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
PATCH=$HERE/../patch/pr1-thrown-errors.diff
BASE=d3f543b74c4b744bdd3babcac7df6b75341d53e7
PKG=libraries/typescript/packages/client
IMAGE=node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c

BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
for name in before after; do
  mkdir -p "$BUILD/$name"
  git -C "$REPO" archive "$BASE" "$PKG" | tar -x -C "$BUILD/$name"
  cp "$HERE/demo.test.ts" "$BUILD/$name/$PKG/tests/unit/client/demo.test.ts"
done
(cd "$BUILD/after" && git apply --include='libraries/typescript/packages/client/src/*' "$PATCH")

docker run --rm --network none --cpus 2 --memory 3g --user "$(id -u):$(id -g)" -e HOME=/tmp -e NO_COLOR=1 \
  -v "$BUILD:/demo" -v "$REPO:/w:ro" "$IMAGE" sh -eu -c '
    PKG=libraries/typescript/packages/client
    for name in before after; do
      cd "/demo/$name/$PKG"
      mkdir node_modules
      for entry in "/w/$PKG/node_modules"/* "/w/$PKG/node_modules/.bin"; do ln -s "$entry" node_modules/; done
      ln -s /w/libraries/typescript/node_modules ../../node_modules
      executors=e2b; [ "$name" = before ] && executors=vm,e2b
      echo "== $name"
      DEMO_EXECUTORS=$executors DEMO_OUT="/demo/$name.json" node_modules/.bin/vitest run --reporter=dot tests/unit/client/demo.test.ts 2>&1 | grep -E "Tests |FAIL"
      node -e "const r=require(\"/demo/$name.json\");for(const [k,v] of Object.entries(r))for(const [p,o] of Object.entries(v))console.log(k.padEnd(4),p.padEnd(16),o.noReturn?\"no return in 4 s\":o.error?\"error: \"+o.error.split(\"\\n\")[0].slice(0,60):JSON.stringify(o.result))"
    done
  '
