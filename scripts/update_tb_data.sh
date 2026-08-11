#!/bin/bash
# Dashboard updater — Meta via Marketing API, Shopify via Claude CLI + MCP.
# Draait elk uur om :10 via launchd.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE="/Users/koengrosman/.npm-global/bin/claude"

echo "=== Dashboard update: $(date '+%Y-%m-%d %H:%M') ==="

# 1. Meta data ophalen en HTML patchen
python3 "$SCRIPT_DIR/fetch_and_patch.py" "$REPO_DIR/index.html"

# 2. Shopify orders bijwerken via Claude CLI + Shopify MCP
echo "Shopify orders ophalen via MCP..."
"$CLAUDE" --print --dangerously-skip-permissions "Use the Shopify MCP graphql_query tool to fetch all orders from lumeworksnl.myshopify.com since 2026-08-01 with their name, createdAt, totalPriceSet shopMoney amount, discountCodes, and lineItems title and quantity. Then update the ORDERS_SHOPIFY JavaScript array in $REPO_DIR/index.html. Format: {d:\"YYYY-MM-DD\",num:\"#XXXX\",items:[\"Product\"],code:\"kortingscode\",incl:PRICE}. Add ,test:true for orders with code pim100/koen100/job100 or price < 10. Only edit the file, do not commit or push." \
  2>/dev/null || echo "⚠️  Shopify MCP update mislukt — wordt overgeslagen"

# 3. Commit en push als er wijzigingen zijn (Meta + Shopify samen)
cd "$REPO_DIR"
# Altijd eerst pullen zodat lokaal niet achterloopt op remote
git pull --rebase origin main --quiet 2>/dev/null || true
if ! git diff --quiet index.html; then
    git add index.html
    git commit -m "Auto-update $(date -u '+%Y-%m-%d %H:%M') UTC"
    git push origin main
    echo "✓ Gepushed naar GitHub Pages"
else
    echo "Geen gewijzigde data — skip push"
fi

echo "=== Klaar ==="
