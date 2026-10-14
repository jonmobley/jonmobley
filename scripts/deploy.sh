#!/bin/sh
# Publishes the site to Cloudflare Pages.
#   scripts/deploy.sh            → jonmobley.com (production)
#   scripts/deploy.sh <branch>   → a preview at <branch>.jonmobley.pages.dev
# Only the public site is uploaded. Source code, config and notes stay behind (Wrangler
# still bundles functions/ and server/ from this folder), so no address trick can ever
# reach them.
set -eu
cd "$(dirname "$0")/.."
BRANCH="${1:-main}"
OUT="$(mktemp -d)"
trap 'rm -rf "${OUT:?}"' EXIT
git archive HEAD | tar -x -C "${OUT:?}"
for p in functions server migrations scripts e2e node_modules test-results playwright-report \
         wrangler.toml tsconfig.json package.json package-lock.json playwright.config.ts .gitignore .dev.vars; do
  rm -rf "${OUT:?}/$p"
done
find "${OUT:?}" -maxdepth 1 -name '*.md' -delete
node scripts/sitemap.mjs "${OUT:?}"
npx -y wrangler@4 pages deploy "${OUT:?}" --project-name jonmobley --branch "$BRANCH" \
  --commit-hash "$(git rev-parse HEAD)" --commit-message "$(git log -1 --pretty=%s | cut -c1-100)" --commit-dirty=true
# Production only: tell Bing / ChatGPT search about the pages (never fails the deploy).
if [ "$BRANCH" = main ]; then
  ~/.moxie/bin/indexnow --key=dce0846fe85a387e6005e0425d05f5c4 https://jonmobley.com || node scripts/indexnow.mjs || true
fi
