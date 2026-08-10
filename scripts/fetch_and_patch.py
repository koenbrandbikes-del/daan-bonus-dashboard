#!/usr/bin/env python3
"""
Haalt Meta Marketing API + Shopify data op en patcht index.html.
Geen Claude CLI nodig.

Credentials in ~/.secrets/dashboard.env:
  META_ACCESS_TOKEN=...
  META_AD_ACCOUNT_ID=1326701336329006   (al ingesteld als standaard)
  SHOPIFY_STORE=lumeworksnl.myshopify.com
  SHOPIFY_ACCESS_TOKEN=...
"""
import json, os, re, sys, requests
import datetime
from pathlib import Path

INDEX_PATH = sys.argv[1] if len(sys.argv) > 1 else str(
    Path(__file__).parent.parent / "index.html"
)

# ── Credentials ──────────────────────────────────────────────────────────────
creds_path = Path.home() / ".secrets" / "dashboard.env"
creds = {}
if creds_path.exists():
    for line in creds_path.read_text().splitlines():
        line = line.strip()
        if line and "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            creds[k.strip()] = v.strip()

META_TOKEN    = creds.get("META_ACCESS_TOKEN")    or os.environ.get("META_ACCESS_TOKEN", "")
META_ACCOUNT  = creds.get("META_AD_ACCOUNT_ID",  "1326701336329006")
SHOPIFY_STORE = creds.get("SHOPIFY_STORE",        "lumeworksnl.myshopify.com")
SHOPIFY_TOKEN = creds.get("SHOPIFY_ACCESS_TOKEN") or os.environ.get("SHOPIFY_ACCESS_TOKEN", "")

if not META_TOKEN:
    print("❌ Geen META_ACCESS_TOKEN in ~/.secrets/dashboard.env")
    print("   Zie: https://github.com/koenbrandbikes-del/daan-bonus-dashboard#setup")
    sys.exit(1)

# ── Datums ───────────────────────────────────────────────────────────────────
TODAY   = datetime.date.today()
YEST    = TODAY - datetime.timedelta(days=1)
DOW     = TODAY.weekday()                       # 0=ma … 6=zo
WK_S    = TODAY - datetime.timedelta(days=DOW)  # maandag
CLEAN_S = datetime.date(2026, 8, 5)             # CAPI-fix datum
WK_S_C  = max(WK_S, CLEAN_S)
PWK_E   = WK_S - datetime.timedelta(days=1)
PWK_S   = PWK_E - datetime.timedelta(days=6)
AUG_S   = datetime.date(2026, 8, 1)
MO      = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"]

# ── Meta Marketing API ───────────────────────────────────────────────────────
PURCHASE_TYPES = ["purchase", "offsite_conversion.fb_pixel_purchase"]

def _av(lst, atype, window=None):
    for a in (lst or []):
        if a.get("action_type") == atype:
            val = a.get(window) if window else None
            return float(val or a.get("value") or 0)
    return 0.0

def meta_insights(start: datetime.date, end: datetime.date) -> dict:
    url = f"https://graph.facebook.com/v21.0/act_{META_ACCOUNT}/insights"
    params = {
        "fields": "spend,impressions,clicks,actions,action_values",
        "action_attribution_windows": '["7d_click","1d_view"]',
        "time_range": json.dumps({"since": str(start), "until": str(end)}),
        "level": "account",
        "access_token": META_TOKEN,
    }
    try:
        r = requests.get(url, params=params, timeout=20)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"❌ Meta API fout ({start}–{end}): {e}")
        sys.exit(1)

    rows = r.json().get("data", [])
    if not rows:
        return {"spend": 0, "rev7": 0, "rev1v": 0, "purch": 0, "impr": 0, "cl": 0}

    row  = rows[0]
    acts = row.get("actions", [])
    avls = row.get("action_values", [])

    p7  = max(_av(acts, t, "7d_click") for t in PURCHASE_TYPES)
    p1v = max(_av(acts, t, "1d_view")  for t in PURCHASE_TYPES)
    r7  = max(_av(avls, t, "7d_click") for t in PURCHASE_TYPES)
    r1v = max(_av(avls, t, "1d_view")  for t in PURCHASE_TYPES)

    return {
        "spend": round(float(row.get("spend", 0)), 2),
        "rev7":  round(r7,  2),
        "rev1v": round(r1v, 2),
        "purch": int(p7 + p1v),
        "impr":  int(row.get("impressions", 0)),
        "cl":    int(row.get("clicks", 0)),
    }

# ── Shopify Admin GraphQL ─────────────────────────────────────────────────────
TEST_CODES = {"pim100", "koen100", "job100"}

def shopify_orders(since: datetime.date) -> list:
    if not SHOPIFY_TOKEN:
        print("⚠️  Geen SHOPIFY_ACCESS_TOKEN — orders overgeslagen")
        return []
    gql = f"https://{SHOPIFY_STORE}/admin/api/2024-01/graphql.json"
    query = """{
      orders(first:50, query:"created_at:>=%s", sortKey:CREATED_AT) {
        edges { node {
          name createdAt
          totalPriceSet { shopMoney { amount } }
          discountCodes
          lineItems(first:5) { edges { node { title quantity } } }
        }}
      }
    }""" % str(since)
    try:
        r = requests.post(gql, json={"query": query},
                          headers={"X-Shopify-Access-Token": SHOPIFY_TOKEN,
                                   "Content-Type": "application/json"}, timeout=20)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"⚠️  Shopify API fout: {e} — orders overgeslagen")
        return []

    orders = []
    for e in r.json()["data"]["orders"]["edges"]:
        n = e["node"]
        items = []
        for li in n["lineItems"]["edges"]:
            items.extend([li["node"]["title"]] * li["node"]["quantity"])
        code  = (n["discountCodes"] or [""])[0]
        incl  = float(n["totalPriceSet"]["shopMoney"]["amount"])
        test  = code.lower() in TEST_CODES or incl < 10
        o = {"d": n["createdAt"][:10], "num": n["name"],
             "items": items, "code": code, "incl": incl}
        if test:
            o["test"] = True
        orders.append(o)
    return orders

# ── Data ophalen ──────────────────────────────────────────────────────────────
print(f"Meta data ophalen (account {META_ACCOUNT})...")
v   = meta_insights(TODAY, TODAY)
g   = meta_insights(YEST, YEST)
w   = meta_insights(WK_S_C, TODAY)
pw  = meta_insights(PWK_S, PWK_E)
aug = meta_insights(CLEAN_S, TODAY)
print(f"  vandaag  spend={v['spend']}  rev7={v['rev7']}  purch={v['purch']}")
print(f"  augustus spend={aug['spend']} rev7={aug['rev7']} purch={aug['purch']}")

print("Shopify orders ophalen...")
orders = shopify_orders(AUG_S)
print(f"  {len(orders)} orders")

# ── HTML patchen ──────────────────────────────────────────────────────────────
snap_time = datetime.datetime.now().strftime("%H:%M")

def tb_const(name, frm, to, x):
    return (f'const {name} = {{from:"{frm}",to:"{to}",'
            f'spend:{x["spend"]},rev7:{x["rev7"]},rev1v:{x["rev1v"]},'
            f'purch:{x["purch"]},impr:{x["impr"]},cl:{x["cl"]}}};')

def fmts(d):
    return f"{d.day} {MO[d.month - 1]}"

with open(INDEX_PATH) as f:
    html = f.read()

# TB-constanten
html = re.sub(r'const SNAP\s*=\s*"[^"]+"',      f'const SNAP = "{TODAY}"',       html)
html = re.sub(r'const SNAP_TIME\s*=\s*"[^"]+"', f'const SNAP_TIME = "{snap_time}"', html)

tb_replacements = [
    (r'const TB_VANDAAG\s*=\s*\{[^;]+\};',   tb_const("TB_VANDAAG",  str(TODAY),   str(TODAY),   v)),
    (r'const TB_GISTEREN\s*=\s*\{[^;]+\};',  tb_const("TB_GISTEREN", str(YEST),    str(YEST),    g)),
    (r'const TB_WEEK\s*=\s*\{[^;]+\};',      tb_const("TB_WEEK",     str(WK_S_C),  str(TODAY),   w)),
    (r'const TB_PREVWEEK\s*=\s*\{[^;]+\};',  tb_const("TB_PREVWEEK", str(PWK_S),   str(PWK_E),   pw)),
    (r'const TB_AUG_CLEAN\s*=\s*\{[^;]+\};', tb_const("TB_AUG_CLEAN","2026-08-05", str(TODAY),   aug)),
]
for pat, repl in tb_replacements:
    new = re.sub(pat, repl, html)
    if new == html:
        print(f"⚠️  Patroon niet gevonden: {pat[:50]}")
    html = new

# PERIODS vandaag/gisteren/aug/contract (from/to datums)
html = re.sub(
    r'(vandaag\s*:\s*\{label:"Vandaag",\s*from:")[^"]+(",\s*to:")[^"]+(")',
    f'\\g<1>{TODAY}\\g<2>{TODAY}\\g<3>', html)
html = re.sub(
    r'(gisteren\s*:\s*\{label:"Gisteren",\s*from:")[^"]+(",\s*to:")[^"]+(")',
    f'\\g<1>{YEST}\\g<2>{YEST}\\g<3>', html)
html = re.sub(
    r'(aug\s*:\s*\{label:"Augustus",[^}]*to:")[^"]+(")',
    f'\\g<1>{TODAY}\\2', html)
html = re.sub(
    r'(contract\s*:\s*\{label:"Volledige periode",[^}]*to:")[^"]+(")',
    f'\\g<1>{TODAY}\\2', html)

# Dropdown labels
wk_lbl = f"{WK_S_C.day}–{TODAY.day} {MO[TODAY.month - 1]}"
html = re.sub(r'<option value="vandaag">Vandaag \([^)]+\)</option>',
              f'<option value="vandaag">Vandaag ({fmts(TODAY)})</option>', html)
html = re.sub(r'<option value="gisteren">Gisteren \([^)]+\)</option>',
              f'<option value="gisteren">Gisteren ({fmts(YEST)})</option>', html)
html = re.sub(r'<option value="week">Deze week \([^)]+\)</option>',
              f'<option value="week">Deze week ({wk_lbl})</option>', html)

# Shopify orders
if orders:
    lines = []
    for o in orders:
        items_js = json.dumps(o["items"])
        test_part = ",test:true" if o.get("test") else ""
        lines.append(
            f'  {{d:"{o["d"]}",num:"{o["num"]}",items:{items_js},'
            f'code:"{o["code"]}",incl:{o["incl"]}{test_part}}}'
        )
    block = "const ORDERS_SHOPIFY = [\n" + ",\n".join(lines) + "\n];"
    new = re.sub(r'const ORDERS_SHOPIFY\s*=\s*\[[^\]]*\];', block, html, flags=re.DOTALL)
    if new != html:
        print(f"✓ {len(orders)} Shopify orders bijgewerkt")
        html = new
    else:
        print("⚠️  ORDERS_SHOPIFY patroon niet gevonden")

with open(INDEX_PATH, "w") as f:
    f.write(html)

print(f"✓ HTML bijgewerkt: {TODAY} {snap_time}")
