#!/bin/bash
# Haalt elk uur verse TrackBee Meta-advertentiedata op via claude CLI
# en pusht de bijgewerkte dashboard HTML naar GitHub Pages.

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INDEX="$REPO_DIR/index.html"

TODAY=$(date +%Y-%m-%d)
YEST=$(date -v-1d +%Y-%m-%d)
DOW=$(date +%u)                            # 1=maandag ... 7=zondag
WK_S=$(date -v-$((DOW-1))d +%Y-%m-%d)    # Maandag van deze week
PWK_E=$(date -v-${DOW}d +%Y-%m-%d)        # Zondag van vorige week
PWK_S=$(date -v-$((DOW+6))d +%Y-%m-%d)   # Maandag van vorige week
AUG_S="2026-08-01"                         # Start augustus (contractmaand)
CLEAN_S="2026-08-05"                       # CAPI-fix datum

echo "=== Dashboard update: $TODAY $(date +%H:%M) ==="

PROMPT="Haal TrackBee Meta campaign insights op voor store 53920, campaign 120245206367440662.

Haal data op voor precies deze 5 periodes via get_meta_campaign_insights:
1. Vandaag:      from=$TODAY    to=$TODAY
2. Gisteren:     from=$YEST     to=$YEST
3. Deze week:    from=$WK_S     to=$TODAY
4. Vorige week:  from=$PWK_S    to=$PWK_E
5. Augustus:     from=$AUG_S    to=$TODAY

Voor elke periode noteer: spend, revenue_7d_click (rev7), revenue_1d_view (rev1v), purchases (purch), impressions (impr), clicks (cl). Gebruik 0 als een waarde ontbreekt.

Output NA het ophalen van alle data ALLEEN dit JSON-blok tussen de markers (vul echte getallen in):

---JSON_START---
{\"snap\":\"$TODAY\",\"vandaag\":{\"spend\":0,\"rev7\":0,\"rev1v\":0,\"purch\":0,\"impr\":0,\"cl\":0},\"gisteren\":{\"spend\":0,\"rev7\":0,\"rev1v\":0,\"purch\":0,\"impr\":0,\"cl\":0},\"week\":{\"from\":\"$WK_S\",\"spend\":0,\"rev7\":0,\"rev1v\":0,\"purch\":0,\"impr\":0,\"cl\":0},\"prevweek\":{\"from\":\"$PWK_S\",\"to\":\"$PWK_E\",\"spend\":0,\"rev7\":0,\"rev1v\":0,\"purch\":0,\"impr\":0,\"cl\":0},\"aug\":{\"spend\":0,\"rev7\":0,\"rev1v\":0,\"purch\":0,\"impr\":0,\"cl\":0}}
---JSON_END---"

# Roep claude aan (gebruikt jouw bestaande claude.ai authenticatie + TrackBee connector)
OUTPUT=$(claude --dangerously-skip-permissions -p "$PROMPT" 2>/dev/null || true)

# Extraheer JSON tussen markers
JSON=$(echo "$OUTPUT" | awk '/---JSON_START---/{f=1;next}/---JSON_END---/{f=0}f' | tr -d '\n ')

if [ -z "$JSON" ]; then
  echo "❌ Geen JSON gevonden. Claude output:"
  echo "$OUTPUT" | tail -30
  exit 1
fi

echo "✓ Data ontvangen"

# Update HTML met Python
python3 << PYTHON
import json, re, sys

raw = r"""$JSON"""
try:
    d = json.loads(raw)
except Exception as e:
    print(f"❌ JSON parse fout: {e}\nRaw: {raw[:200]}")
    sys.exit(1)

with open("$INDEX") as f:
    html = f.read()

snap = d["snap"]
v, g, w, pw, a = d["vandaag"], d["gisteren"], d["week"], d["prevweek"], d["aug"]

def tb(name, frm, to, x):
    return (f'const {name} = {{from:"{frm}",to:"{to}",'
            f'spend:{x["spend"]},rev7:{x["rev7"]},rev1v:{x["rev1v"]},'
            f'purch:{x["purch"]},impr:{x["impr"]},cl:{x["cl"]}}};')

html = re.sub(r'const SNAP\s*=\s*"[^"]+"', f'const SNAP = "{snap}"', html)

replacements = [
    (r'const TB_VANDAAG\s*=\s*\{[^;]+\};',   tb("TB_VANDAAG",  snap,                   snap,                   v)),
    (r'const TB_GISTEREN\s*=\s*\{[^;]+\};',  tb("TB_GISTEREN", "$YEST",                 "$YEST",                 g)),
    (r'const TB_WEEK\s*=\s*\{[^;]+\};',      tb("TB_WEEK",     w.get("from","$WK_S"),   snap,                   w)),
    (r'const TB_PREVWEEK\s*=\s*\{[^;]+\};',  tb("TB_PREVWEEK", pw.get("from","$PWK_S"), pw.get("to","$PWK_E"), pw)),
    (r'const TB_AUG_CLEAN\s*=\s*\{[^;]+\};', tb("TB_AUG_CLEAN","$CLEAN_S",              snap,                   a)),
]

for pattern, replacement in replacements:
    new_html = re.sub(pattern, replacement, html)
    if new_html == html:
        print(f"⚠️  Patroon niet gevonden: {pattern[:40]}")
    html = new_html

with open("$INDEX", "w") as f:
    f.write(html)

print(f"✓ Constanten bijgewerkt voor {snap}")
PYTHON

# Commit en push als er wijzigingen zijn
cd "$REPO_DIR"
if ! git diff --quiet index.html; then
    git add index.html
    git commit -m "Auto-update $(date -u '+%Y-%m-%d %H:%M') UTC"
    git push origin main
    echo "✓ Gepushed naar GitHub Pages"
else
    echo "Geen gewijzigde data — skip push"
fi

echo "=== Klaar ==="
