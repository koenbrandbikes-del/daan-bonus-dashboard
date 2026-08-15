#!/bin/bash
# Dashboard updater — draait lokaal op de Mac, maar is sinds 15 aug 2026 niet
# meer verantwoordelijk voor Meta of de real-time Shopify-orders: die lopen
# via de Cloudflare Worker (cloudflare-worker/), volledig los van of deze Mac
# wakker is. Reden: bij lage accu onderdrukt macOS geplande achtergrond-wakes
# (DarkWake), waardoor dit script uren kon overslaan.
#   - Meta: cron-trigger in de Worker zelf (elke 15 min), niet hier.
#   - Shopify: real-time via de Worker-webhook. Dit script doet Shopify
#     alleen nog als vangnet voor gemiste webhooks, max 1x per
#     SHOPIFY_SYNC_HOURS uur via Claude CLI + Shopify MCP — de enige stap
#     hier die nog credits kost.
#   - Google Ads (TrackBee): NIET automatisch ververst (bewust besluit —
#     TrackBee heeft geen directe API zonder Claude/MCP; zie data/status.json).
#   - Wijzigt uitsluitend data/shopify.json. index.html/CSS/JS blijven
#     onaangeroerd tijdens een normale sync.
# Draait elke 15 minuten via launchd (StartInterval) — vooral om het
# Shopify-vangnet tijdig te checken zodra de Mac toevallig wakker is.

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Dashboard update: $(date '+%Y-%m-%d %H:%M') ==="

# Voorkom overlappende runs (bv. handmatige trigger + uurlijkse launchd-run
# tegelijk) — gaf eerder een kapotte/losliggende .git/rebase-merge state.
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
#    de hele keten: het script crashte op die stap en de wake voor de
#    vólgende run werd dan nooit ingepland.
#    +17 min = 15-minuten-interval (StartInterval in de plist) + 2 min marge.
NEXT_WAKE="$(date -v+17M -v0S '+%m/%d/%y %H:%M:%S')"
if sudo -n /usr/bin/pmset schedule wake "$NEXT_WAKE" >/dev/null 2>&1; then
    echo "✓ Volgende wake ingepland: $NEXT_WAKE"
else
    echo "⚠️  Kon wake niet inplannen (sudoers-regel voor pmset ontbreekt?)"
fi

# 1. Synchroniseer repo — stash tijdelijk zodat pull --rebase altijd werkt
cd "$REPO_DIR"
git stash -u --quiet 2>/dev/null || true
git pull --rebase origin main --quiet 2>/dev/null || true
git stash pop --quiet 2>/dev/null || true

# 2. Shopify — sinds 15 aug 2026 vangt de Cloudflare Worker
#    (cloudflare-worker/, Shopify "Aanmaken van bestelling"-webhook) nieuwe
#    orders al real-time en gratis op. Dit is dus nu alleen nog een vangnet
#    voor gemiste webhooks (Shopify geeft na 48u retries op) — via Claude CLI,
#    throttled op SHOPIFY_SYNC_HOURS uur bijgehouden via een timestamp-bestand
#    buiten de repo.
#    Afbouwplan (in overleg gekozen, geen automatisch aftellen): begin op 24u
#    (dagelijks vangnet, eerste week). Blijkt de webhook een week lang
#    betrouwbaar te werken (geen gaten in de ordernummering), zet dan naar 72
#    (1x/3 dagen); daarna eventueel naar 168 (1x/week).
SHOPIFY_SYNC_HOURS=24
SHOPIFY_SYNC_STAMP="$HOME/.secrets/last_shopify_sync"
now_epoch=$(date +%s)
last_epoch=$(cat "$SHOPIFY_SYNC_STAMP" 2>/dev/null || echo 0)
elapsed_h=$(( (now_epoch - last_epoch) / 3600 ))
if [ "$elapsed_h" -ge "$SHOPIFY_SYNC_HOURS" ]; then
    if python3 "$SCRIPT_DIR/sync_shopify.py"; then
        echo "$now_epoch" > "$SHOPIFY_SYNC_STAMP"
    else
        echo "⚠️  Shopify-sync mislukt — data/shopify.json blijft ongewijzigd, volgende beurt opnieuw"
    fi
else
    echo "Shopify-sync overgeslagen (laatste sync ${elapsed_h}u geleden, drempel ${SHOPIFY_SYNC_HOURS}u)"
fi

# 3. Commit en push — alleen data/*.json, nooit index.html/CSS/JS.
#    Met retry als er ondertussen elders gepusht is.
if ! git diff --quiet -- data/; then
    git add data/
    git commit -m "Data-sync $(date -u '+%Y-%m-%d %H:%M') UTC"
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
