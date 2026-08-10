#!/bin/bash
# Haalt Shopify orders op via Claude CLI + Shopify MCP en pusht naar GitHub.
# Draait via launchd elk uur om :25.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="Shopify MCP update: $(date '+%Y-%m-%d %H:%M')"
echo "=== $LOG ==="

PROMPT="Use the Shopify MCP graphql_query tool to fetch all orders from lumeworksnl.myshopify.com since 2026-08-01 with their name, createdAt, totalPriceSet, discountCodes, and lineItems (title, quantity). Then update the ORDERS_SHOPIFY JavaScript array in the file $REPO_DIR/index.html with the result — same format as the existing entries: {d:\"YYYY-MM-DD\",num:\"#XXXX\",items:[...],code:\"...\",incl:NUMBER}. Mark orders with discount codes pim100/koen100/job100 or totalPrice < 10 with ,test:true. After patching the file, run: cd $REPO_DIR && git add index.html && git diff --staged --quiet || git commit -m 'Auto-update Shopify orders \$(date -u +%Y-%m-%d\ %H:%M) UTC' && git push origin main"

/Users/koengrosman/.npm-global/bin/claude --print "$PROMPT"

echo "=== Klaar ==="
