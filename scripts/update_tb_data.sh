#!/bin/bash
# Dashboard updater — Meta via Marketing API, Shopify via Claude CLI + MCP.
# Draait elk uur om :10 via launchd.

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE="/Users/koengrosman/.npm-global/bin/claude"

echo "=== Dashboard update: $(date '+%Y-%m-%d %H:%M') ==="

# 0. Volgende wake-timer ALS EERSTE inplannen — onafhankelijk van of de rest
#    van dit script slaagt. Vereist /etc/sudoers.d/pmset-dashboard-wake met:
#    "koengrosman ALL=(root) NOPASSWD: /usr/bin/pmset schedule wake *,
#    /usr/bin/pmset schedule cancel *" (eenmalig handmatig ingesteld).
#    Stond dit onderaan (na de data-fetch), dan brak een API-timeout eerder
#    (bv. Meta Graph API read timeout) de hele keten: het script crashte op
#    die stap en de wake voor het vólgende uur werd dan nooit ingepland —
#    precies wat er op 13 aug tussen 17:10 en 19:19 gebeurde.
NEXT_WAKE="$(date -v+1H -v8M -v0S '+%m/%d/%y %H:%M:%S')"
if sudo -n /usr/bin/pmset schedule wake "$NEXT_WAKE" >/dev/null 2>&1; then
    echo "✓ Volgende wake ingepland: $NEXT_WAKE"
else
    echo "⚠️  Kon wake niet inplannen (sudoers-regel voor pmset ontbreekt?)"
fi

# 1. Synchroniseer — stash tijdelijk zodat pull --rebase altijd werkt
cd "$REPO_DIR"
git stash -u --quiet 2>/dev/null || true
git pull --rebase origin main --quiet 2>/dev/null || true
git stash pop --quiet 2>/dev/null || true

# 2. Meta data ophalen en HTML patchen — mag falen (bv. API-timeout) zonder
#    de rest van het script (en vooral: de wake-timer hierboven) te breken.
if ! python3 "$SCRIPT_DIR/fetch_and_patch.py" "$REPO_DIR/index.html"; then
    echo "⚠️  Meta-data ophalen mislukt deze run — wordt volgend uur opnieuw geprobeerd"
fi

# 3. Shopify orders bijwerken via Claude CLI + Shopify MCP
echo "Shopify orders ophalen via MCP..."
"$CLAUDE" --print --dangerously-skip-permissions "Use the Shopify MCP graphql_query tool to fetch all orders from lumeworksnl.myshopify.com since 2026-08-01 with their name, createdAt, totalPriceSet shopMoney amount, discountCodes, and lineItems title and quantity. Then update the ORDERS_SHOPIFY JavaScript array in $REPO_DIR/index.html. Format: {d:\"YYYY-MM-DD\",num:\"#XXXX\",items:[\"Product\"],code:\"kortingscode\",incl:PRICE}. Add ,test:true for orders with code pim100/koen100/job100 or price < 10. Only edit the file, do not commit or push." \
  2>/dev/null || echo "⚠️  Shopify MCP update mislukt — wordt overgeslagen"

# 4. Commit en push — met retry als GitHub Action ondertussen pushte
if ! git diff --quiet index.html; then
    git add index.html
    git commit -m "Auto-update $(date -u '+%Y-%m-%d %H:%M') UTC"
    if ! git push origin main 2>/dev/null; then
        echo "Push gefaald (remote ahead) — rebase en retry..."
        git stash -u --quiet 2>/dev/null || true
        git pull --rebase origin main --quiet
        git stash pop --quiet 2>/dev/null || true
        git push origin main
    fi
    echo "✓ Gepushed naar GitHub Pages"
else
    echo "Geen gewijzigde data — skip push"
fi

echo "=== Klaar ==="
