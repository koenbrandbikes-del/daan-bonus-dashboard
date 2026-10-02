#!/usr/bin/env bash
# Replace public data commits at cutover; invoke from the repository root.
# LW_STORAGE_ORIGIN and LW_STORAGE_SECRET must come from a private environment.
set -euo pipefail
revisions_file=$(mktemp)
rm "$revisions_file"
trap 'rm -f "$revisions_file"' EXIT
python siteground/scripts/upload_data.py --paths data/shopify.json data/returns.json --capture "$revisions_file" --pull
# Run existing real data producers. Never invent or fill in missing data here.
python scripts/sync_shopify.py
python scripts/sync_returns.py
python siteground/scripts/upload_data.py --paths data/shopify.json data/returns.json --expected-revisions "$revisions_file"
# Deliberately no git add/commit/push of financial datasets.
