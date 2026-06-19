#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ASL Data Catalog — GitHub Push Setup
# Run this ONCE from the project root to initialise the repo and push.
#
# Prerequisites:
#   1. git is installed
#   2. You are authenticated with GitHub (gh auth login  OR  SSH key set up)
#   3. The repo https://github.com/ASLDnT/asl-data-catalog already exists
#      (create it at https://github.com/new — empty, no README)
# ─────────────────────────────────────────────────────────────────────────────
set -e

REPO_URL="https://github.com/ASLDnT/asl-data-catalog.git"
# Use SSH if you prefer:
# REPO_URL="git@github.com:ASLDnT/asl-data-catalog.git"

echo ""
echo "🛫  ASL Data Catalog — GitHub Setup"
echo "    Target: $REPO_URL"
echo ""

# ── Init git if needed ───────────────────────────────────────────────────────
if [ ! -d .git ]; then
  echo "📁  Initialising git repository…"
  git init
  git branch -M main
else
  echo "📁  Git repository already initialised"
fi

# ── Set remote ───────────────────────────────────────────────────────────────
if git remote get-url origin &>/dev/null; then
  echo "🔗  Updating remote origin → $REPO_URL"
  git remote set-url origin "$REPO_URL"
else
  echo "🔗  Adding remote origin → $REPO_URL"
  git remote add origin "$REPO_URL"
fi

# ── Stage all files ──────────────────────────────────────────────────────────
echo "📦  Staging files…"
git add .
git status --short

# ── Commit ───────────────────────────────────────────────────────────────────
echo ""
echo "💾  Creating initial commit…"
git commit -m "feat: ASL Enterprise Data Catalog v2 — dynamic Dremio sync

- scripts/sync-catalog.js: crawls dremio-db.source, eagle_eye, SAP_HANA
- src/App.jsx: 6-pillar React catalog (Discovery, Glossary, Lineage, Quality, Knowledge Map, Metadata)
- .github/workflows/deploy.yml: auto-sync Dremio every 30min + build + GitHub Pages deploy
- catalog-api-server.js: optional live Express API with 5-min cache
- vite.config.js: base /asl-data-catalog/ for GitHub Pages"

# ── Push ─────────────────────────────────────────────────────────────────────
echo ""
echo "🚀  Pushing to GitHub…"
git push -u origin main

echo ""
echo "✅  Done! Next steps:"
echo ""
echo "   1. Go to: https://github.com/ASLDnT/asl-data-catalog/settings/pages"
echo "      → Source: GitHub Actions"
echo ""
echo "   2. Add secrets at: https://github.com/ASLDnT/asl-data-catalog/settings/secrets/actions"
echo "      DREMIO_BASE_URL = https://data.eu.dremio.cloud"
echo "      DREMIO_PAT      = <your Personal Access Token>"
echo ""
echo "   3. Trigger the first deploy:"
echo "      https://github.com/ASLDnT/asl-data-catalog/actions"
echo "      → 'Sync Dremio & Deploy to GitHub Pages' → Run workflow"
echo ""
echo "   4. Your catalog will be live at:"
echo "      https://asldnt.github.io/asl-data-catalog/"
echo ""
