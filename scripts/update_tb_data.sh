#!/bin/bash
# Dashboard updater.
#   - Meta: elke run, direct via Marketing API (geen Claude, geen LLM).
#   - Shopify: real-time en gratis via een Cloudflare Worker-webhook
#     (cloudflare-worker/) die nieuwe orders rechtstreeks in data/shopify.json
#     zet zodra Shopify "Aanmaken van bestelling" meldt. Dit script doet
#     Shopify alleen nog als vangnet, max 1x per SHOPIFY_SYNC_HOURS uur via
#     Claude CLI + Shopify MCP — de enige stap die nog credits kost.
#   - Google Ads (TrackBee): NIET meer automatisch ververst (bewust besluit —
#     TrackBee heeft geen directe API zonder Claude/MCP; zie data/status.json).
#   - Wijzigt uitsluitend data/*.json. index.html/CSS/JS blijven onaangeroerd
#     tijdens een normale sync.
# Draait elke 15 minuten via launchd (StartInterval).

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

# 2. Meta — elke run, gratis, deterministisch. Mag falen zonder de rest
#    (vooral de wake-timer hierboven) te breken.
if ! python3 "$SCRIPT_DIR/sync_dashboard_data.py"; then
    echo "⚠️  Meta-sync mislukt deze run — data/meta.json blijft ongewijzigd, volgend uur opnieuw"
fi

# 3. Shopify — sinds 15 aug 2026 vangt de Cloudflare Worker
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

# 4. Commit en push — alleen data/*.json, nooit index.html/CSS/JS.
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
