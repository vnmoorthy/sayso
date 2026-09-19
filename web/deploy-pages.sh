#!/usr/bin/env bash
# Publish the web app to GitHub Pages (https://vnmoorthy.github.io/sayso/).
# The hosted build runs in mock mode without a server (?mock=1) and can also
# point at a locally running Sayso server via Settings → Server URL.
set -euo pipefail
cd "$(dirname "$0")"
REPO="${REPO:-vnmoorthy/sayso}"
BASE="/${REPO#*/}/"

echo "→ building with base $BASE"
npx tsc -b && npx vite build --base="$BASE"
cp dist/index.html dist/404.html        # SPA fallback
touch dist/.nojekyll

echo "→ publishing dist/ to gh-pages"
TMP="$(mktemp -d)"
git -C .. worktree add -f "$TMP" --detach >/dev/null 2>&1 || true
(
  cd "$TMP"
  git checkout --orphan gh-pages >/dev/null 2>&1 || git checkout gh-pages
  git rm -rfq . >/dev/null 2>&1 || true
  cp -R "$OLDPWD/dist/." .
  git add -A
  git -c commit.gpgsign=false commit -qm "deploy: web build $(date -u +%Y-%m-%dT%H:%MZ)" || true
  git push -f origin gh-pages
)
git -C .. worktree remove --force "$TMP" >/dev/null 2>&1 || true

echo "→ enabling Pages (idempotent)"
gh api -X POST "repos/$REPO/pages" -f 'source[branch]=gh-pages' -f 'source[path]=/' >/dev/null 2>&1 || \
gh api -X PUT "repos/$REPO/pages" -f 'source[branch]=gh-pages' -f 'source[path]=/' >/dev/null 2>&1 || true
echo "✓ https://${REPO%/*}.github.io${BASE}?mock=1"
