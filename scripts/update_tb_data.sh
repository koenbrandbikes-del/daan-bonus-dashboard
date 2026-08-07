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

from datetime import datetime
snap_time = datetime.now().strftime("%H:%M")
html = re.sub(r'const SNAP\s*=\s*"[^"]+"', f'const SNAP = "{snap}"', html)
html = re.sub(r'const SNAP_TIME\s*=\s*"[^"]+"', f'const SNAP_TIME = "{snap_time}"', html)

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

# ── Stap 2: Shopify orders ophalen ──────────────────────────────────────────
echo "Shopify orders ophalen..."

ORDERS_PROMPT="Fetch all Shopify orders created since $AUG_S using the Shopify GraphQL API.
Use this query:
{ orders(first:50, query:\"created_at:>=$AUG_S\", sortKey:CREATED_AT, reverse:false) { edges { node { name createdAt totalPriceSet { shopMoney { amount } } discountCodes lineItems(first:5) { edges { node { title quantity } } } } } } }

Output ONLY this JSON between the markers (fill in real data, no markdown):

---ORDERS_START---
[{\"num\":\"#1066\",\"d\":\"2026-08-01\",\"items\":[\"LumeWorks Prime\"],\"code\":\"\",\"incl\":149}]
---ORDERS_END---

Rules:
- d = date in YYYY-MM-DD format (createdAt date only, no time)
- items = array of lineItem titles (quantity>1: repeat the title)
- code = first discountCode or empty string
- incl = totalPrice as number
- test = true only if discountCode is pim100, Koen100, JOB100, or price < 10"

ORDERS_OUT=$(~/.npm-global/bin/claude --dangerously-skip-permissions -p "$ORDERS_PROMPT" 2>/dev/null || true)
ORDERS_JSON=$(echo "$ORDERS_OUT" | awk '/---ORDERS_START---/{f=1;next}/---ORDERS_END---/{f=0}f' | tr -d '\n')

if [ -z "$ORDERS_JSON" ]; then
  echo "⚠️  Geen Shopify orders JSON — skip orders update"
else
  python3 << PYORDERS
import json, re, sys

raw = r"""$ORDERS_JSON"""
try:
    orders = json.loads(raw)
except Exception as e:
    print(f"⚠️  Orders JSON parse fout: {e}")
    sys.exit(0)

with open("$INDEX") as f:
    html = f.read()

TEST_CODES = {"pim100","koen100","job100"}

lines = []
for o in orders:
    d    = o.get("d","")
    num  = o.get("num","")
    items= o.get("items",[])
    code = o.get("code","")
    incl = o.get("incl",0)
    test = o.get("test", code.lower() in TEST_CODES or incl < 10)
    items_js = json.dumps(items)
    test_part = ",test:true" if test else ""
    lines.append(f'  {{d:"{d}",num:"{num}",items:{items_js},code:"{code}",incl:{incl}{test_part}}}')

block = "const ORDERS_SHOPIFY = [\n" + ",\n".join(lines) + "\n];"
new_html = re.sub(r'const ORDERS_SHOPIFY\s*=\s*\[[^\]]*\];', block, html, flags=re.DOTALL)

if new_html == html:
    print("⚠️  ORDERS_SHOPIFY patroon niet gevonden")
else:
    with open("$INDEX","w") as f:
        f.write(new_html)
    print(f"✓ {len(orders)} Shopify orders bijgewerkt")
PYORDERS
fi

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
