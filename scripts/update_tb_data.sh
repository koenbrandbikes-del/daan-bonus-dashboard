#!/bin/bash
# Dashboard updater — Meta via Marketing API, Shopify via Claude CLI + MCP.
# Draait elk uur om :10 via launchd.

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE="/Users/koengrosman/.npm-global/bin/claude"

echo "=== Dashboard update: $(date '+%Y-%m-%d %H:%M') ==="

# Voorkom overlappende runs (bv. handmatige trigger + uurlijkse launchd-run
# tegelijk) — dat gaf steeds een kapotte/losliggende .git/rebase-merge state.
LOCK_DIR="/tmp/daan-dashboard-update.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "⚠️  Een andere update-run is al bezig — deze run wordt overgeslagen"
    exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

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

# 3. Shopify orders + Google Ads data bijwerken via Claude CLI + MCP (Shopify
#    + TrackBee-Insights) — dit kost credits per aanroep, dus draait dit niet
#    elk uur mee (zoals de gratis Meta-fetch hierboven) maar hooguit 1x per
#    SHOPIFY_SYNC_HOURS uur, bijgehouden via een timestamp-bestand buiten de
#    repo. Vervangt de losse cloud-routine die dit vroeger elk uur deed —
#    die is gepauzeerd, dit is nu de enige plek die Shopify+Google bijwerkt.
SHOPIFY_SYNC_HOURS=4
SHOPIFY_SYNC_STAMP="$HOME/.secrets/last_shopify_sync"
now_epoch=$(date +%s)
last_epoch=$(cat "$SHOPIFY_SYNC_STAMP" 2>/dev/null || echo 0)
elapsed_h=$(( (now_epoch - last_epoch) / 3600 ))
if [ "$elapsed_h" -ge "$SHOPIFY_SYNC_HOURS" ]; then
    echo "Shopify + Google Ads ophalen via MCP... (laatste sync ${elapsed_h}u geleden)"
    if "$CLAUDE" --print --dangerously-skip-permissions "Do TWO things in $REPO_DIR/orders_google.js — a small standalone data file loaded by index.html via <script src>, NOT index.html itself (don't touch index.html, don't read it, that file is huge and irrelevant to this task). Then stop (do not commit or push):

1. SHOPIFY ORDERS: Use the Shopify MCP graphql_query tool to fetch all orders from lumeworksnl.myshopify.com since 2026-08-01 with their name, createdAt, totalPriceSet shopMoney amount, discountCodes, and lineItems title and quantity. Update the ORDERS_SHOPIFY JavaScript array in orders_google.js. Format: {d:\"YYYY-MM-DD\",num:\"#XXXX\",items:[\"Product\"],code:\"kortingscode\",incl:PRICE}. Add ,test:true for orders with code pim100/koen100/job100 or price < 10.

2. GOOGLE ADS: Run \`date -u +%Y-%m-%d\` for today and compute yesterday. Use the TrackBee-Insights MCP tool get_google_campaign_insights with store=53920, once for today (start_date=end_date=today) and once for yesterday (start_date=end_date=yesterday). Sum across all returned campaigns: spend, conversions (integer field, not all_conversions), conversions_value (as rev), impressions, clicks. Replace these two lines in orders_google.js with the fresh numbers, keeping the exact format:
const TG_VANDAAG = {from:\"YYYY-MM-DD\",to:\"YYYY-MM-DD\",spend:N,conv:N,rev:N,impr:N,cl:N};
const TG_GISTEREN = {from:\"YYYY-MM-DD\",to:\"YYYY-MM-DD\",spend:N,conv:N,rev:N,impr:N,cl:N};" \
      2>/dev/null; then
        echo "$now_epoch" > "$SHOPIFY_SYNC_STAMP"
    else
        echo "⚠️  Shopify/Google MCP update mislukt — wordt overgeslagen"
    fi
else
    echo "Shopify/Google-sync overgeslagen (laatste sync ${elapsed_h}u geleden, drempel ${SHOPIFY_SYNC_HOURS}u)"
fi

# 4. Commit en push — met retry als GitHub Action ondertussen pushte
if ! git diff --quiet index.html orders_google.js; then
    git add index.html orders_google.js
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
