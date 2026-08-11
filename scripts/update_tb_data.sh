#!/bin/bash
# Dashboard updater — Meta via Marketing API, Shopify via Claude CLI + MCP.
# Draait elk uur om :10 via launchd.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE="/Users/koengrosman/.npm-global/bin/claude"

echo "=== Dashboard update: $(date '+%Y-%m-%d %H:%M') ==="

# 0. Eerst synchroniseren — working dir is schoon hier, dus pull werkt altijd
cd "$REPO_DIR"
git pull --rebase origin main --quiet 2>/dev/null || true

# 1. Meta data ophalen en HTML patchen
python3 "$SCRIPT_DIR/fetch_and_patch.py" "$REPO_DIR/index.html"

# 2. Shopify orders bijwerken via Claude CLI + Shopify MCP
echo "Shopify orders ophalen via MCP..."
"$CLAUDE" --print --dangerously-skip-permissions "Use the Shopify MCP graphql_query tool to fetch all orders from lumeworksnl.myshopify.com since 2026-08-01 with their name, createdAt, totalPriceSet shopMoney amount, discountCodes, and lineItems title and quantity. Then update the ORDERS_SHOPIFY JavaScript array in $REPO_DIR/index.html. Format: {d:\"YYYY-MM-DD\",num:\"#XXXX\",items:[\"Product\"],code:\"kortingscode\",incl:PRICE}. Add ,test:true for orders with code pim100/koen100/job100 or price < 10. Only edit the file, do not commit or push." \
  2>/dev/null || echo "⚠️  Shopify MCP update mislukt — wordt overgeslagen"

# 3. Commit en push — met retry als GitHub Action ondertussen pushte
if ! git diff --quiet index.html; then
    git add index.html
    git commit -m "Auto-update $(date -u '+%Y-%m-%d %H:%M') UTC"
    if ! git push origin main 2>/dev/null; then
        echo "Push gefaald (remote ahead) — rebase en retry..."
        git pull --rebase origin main --quiet
        git push origin main
    fi
    echo "✓ Gepushed naar GitHub Pages"
else
    echo "Geen gewijzigde data — skip push"
fi

echo "=== Klaar ==="
