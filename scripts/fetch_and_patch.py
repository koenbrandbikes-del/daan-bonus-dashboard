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
import json, os, re, sys, time, requests
import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

INDEX_PATH = sys.argv[1] if len(sys.argv) > 1 else str(
    Path(__file__).parent.parent / "index.html"
)

# Altijd Europe/Amsterdam, ongeacht of dit lokaal (CEST) of op een runner in
# UTC (GitHub Actions / cloud routine) draait — anders verschilt "vandaag"
# tot 2 uur per dag tussen de bronnen, en oogt de "Bijgewerkt"-tijd fout.
NL_TZ = ZoneInfo("Europe/Amsterdam")
NOW_NL = datetime.datetime.now(NL_TZ)

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
TODAY   = NOW_NL.date()
YEST    = TODAY - datetime.timedelta(days=1)
DOW     = TODAY.weekday()                       # 0=ma … 6=zo
WK_S    = TODAY - datetime.timedelta(days=DOW)  # maandag (nodig voor prevweek)
CLEAN_S = datetime.date(2026, 8, 5)             # CAPI-fix datum
WK_S_C  = max(TODAY - datetime.timedelta(days=6), CLEAN_S)  # rolling 7 dagen
PWK_E   = WK_S - datetime.timedelta(days=1)
PWK_S   = PWK_E - datetime.timedelta(days=6)
AUG_S   = datetime.date(2026, 8, 1)
MO      = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"]

# ── Meta Marketing API ───────────────────────────────────────────────────────
PURCHASE_TYPES = ["purchase", "offsite_conversion.fb_pixel_purchase"]

def _av(lst, atype, window=None):
    for a in (lst or []):
        if a.get("action_type") == atype:
            if window:
                return float(a.get(window) or 0)   # 0 als window niet aanwezig (nooit fallback op value)
            return float(a.get("value") or 0)
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
    last_err = None
    for attempt, timeout in enumerate((20, 30, 45), start=1):
        try:
            r = requests.get(url, params=params, timeout=timeout)
            r.raise_for_status()
            last_err = None
            break
        except requests.RequestException as e:
            last_err = e
            print(f"⚠️  Meta API poging {attempt}/3 mislukt ({start}–{end}): {e}")
            if attempt < 3:
                time.sleep(3 * attempt)
    if last_err is not None:
        print(f"❌ Meta API fout ({start}–{end}) na 3 pogingen: {last_err}")
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

ATC_TYPES = ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"]

def meta_insights_by_adset(start: datetime.date, end: datetime.date) -> list:
    """Per-advertentiegroep breakdown voor één dag. Zelfde attributie-logica
    als meta_insights(), maar level=adset i.p.v. account."""
    url = f"https://graph.facebook.com/v21.0/act_{META_ACCOUNT}/insights"
    params = {
        "fields": "adset_name,spend,impressions,clicks,ctr,cpc,actions,action_values",
        "action_attribution_windows": '["7d_click","1d_view"]',
        "time_range": json.dumps({"since": str(start), "until": str(end)}),
        "level": "adset",
        "limit": 200,
        "access_token": META_TOKEN,
    }
    try:
        r = requests.get(url, params=params, timeout=20)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"⚠️  Meta adset API fout ({start}–{end}): {e} — overgeslagen")
        return []

    out = []
    for row in r.json().get("data", []):
        acts = row.get("actions", [])
        avls = row.get("action_values", [])
        p7  = max(_av(acts, t, "7d_click") for t in PURCHASE_TYPES)
        p1v = max(_av(acts, t, "1d_view")  for t in PURCHASE_TYPES)
        r7  = max(_av(avls, t, "7d_click") for t in PURCHASE_TYPES)
        r1v = max(_av(avls, t, "1d_view")  for t in PURCHASE_TYPES)
        a7  = max(_av(acts, t, "7d_click") for t in ATC_TYPES)
        a1v = max(_av(acts, t, "1d_view")  for t in ATC_TYPES)
        out.append({
            "n":     row.get("adset_name", "?"),
            "spend": round(float(row.get("spend", 0)), 2),
            "rev7":  round(r7, 2),
            "rev1v": round(r1v, 2),
            "purch": int(p7 + p1v),
            "ctr":   round(float(row.get("ctr", 0)), 2),
            "cpc":   round(float(row.get("cpc", 0)), 2),
            "atc":   int(a7 + a1v),
        })
    out.sort(key=lambda a: -a["spend"])
    return out

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

def sum_daily(daily, from_date, to_date):
    """Som van dagelijkse Meta data voor een datumrange. Altijd consistent met DAILY_META."""
    total = {"spend": 0.0, "rev7": 0.0, "rev1v": 0.0, "purch": 0, "impr": 0, "cl": 0}
    for ds, x in daily.items():
        if str(from_date) <= ds <= str(to_date):
            total["spend"] += x["spend"]
            total["rev7"]  += x["rev7"]
            total["rev1v"] += x["rev1v"]
            total["purch"] += x["purch"]
            total["impr"]  += x["impr"]
            total["cl"]    += x["cl"]
    total["spend"] = round(total["spend"], 2)
    total["rev7"]  = round(total["rev7"],  2)
    total["rev1v"] = round(total["rev1v"], 2)
    return total

# Dagelijkse data ophalen voor DAILY_META (CLEAN_S t/m TODAY)
# TB_VANDAAG, TB_GISTEREN, TB_WEEK en TB_AUG_CLEAN worden hieruit afgeleid
# zodat ze altijd exact overeenkomen met de dagelijkse rijen.
print(f"Meta dagelijkse data ophalen (account {META_ACCOUNT})...")
daily_meta = {}
daily_ads = {}
d = CLEAN_S
while d <= TODAY:
    day_data = meta_insights(d, d)
    daily_meta[str(d)] = day_data
    ads_data = meta_insights_by_adset(d, d)
    daily_ads[str(d)] = ads_data
    print(f"  {d}: spend={day_data['spend']:7.2f}  rev7={day_data['rev7']:7.2f}  rev1v={day_data['rev1v']:6.2f}  purch={day_data['purch']}  adsets={len(ads_data)}")
    d += datetime.timedelta(days=1)

# Aggregaten berekend uit dagelijkse data — nooit losse API-calls, altijd consistent
v   = daily_meta.get(str(TODAY), {"spend":0,"rev7":0,"rev1v":0,"purch":0,"impr":0,"cl":0})
g   = daily_meta.get(str(YEST),  {"spend":0,"rev7":0,"rev1v":0,"purch":0,"impr":0,"cl":0})
w   = sum_daily(daily_meta, WK_S_C, TODAY)
aug = sum_daily(daily_meta, CLEAN_S, TODAY)

# Vorige week: buiten DAILY_META range, nog apart ophalen
pw = meta_insights(PWK_S, PWK_E)

# ── Zelfcheck ─────────────────────────────────────────────────────────────────
print("\n── Zelfcheck ────────────────────────────────────────────────────────────")
print(f"  {'Dag':<12} {'spend':>8} {'rev7':>8} {'rev1v':>7} {'purch':>6}")
for ds in sorted(daily_meta.keys()):
    x = daily_meta[ds]
    print(f"  {ds}  {x['spend']:>8.2f} {x['rev7']:>8.2f} {x['rev1v']:>7.2f} {x['purch']:>6}")
print(f"  {'─'*50}")
print(f"  Week ({WK_S_C}–{TODAY}):  spend={w['spend']:.2f}  purch={w['purch']}")
print(f"  Aug  ({CLEAN_S}–{TODAY}): spend={aug['spend']:.2f}  purch={aug['purch']}")
print("── ✓ Aggregaten = som dagelijkse data ───────────────────────────────────")

print("Shopify orders ophalen...")
orders = shopify_orders(AUG_S)
print(f"  {len(orders)} orders")

# ── HTML patchen ──────────────────────────────────────────────────────────────
snap_time = NOW_NL.strftime("%H:%M")

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

# DAILY_META array
if daily_meta:
    lines = []
    for ds in sorted(daily_meta.keys()):
        x = daily_meta[ds]
        lines.append(f'  {{d:"{ds}",spend:{x["spend"]},rev7:{x["rev7"]},rev1v:{x["rev1v"]},purch:{x["purch"]},impr:{x["impr"]},cl:{x["cl"]}}}')
    block = "const DAILY_META = [\n" + ",\n".join(lines) + "\n];"
    new = re.sub(r'const DAILY_META\s*=\s*\[[^\]]*\];', block, html, flags=re.DOTALL)
    if new != html:
        print(f"✓ DAILY_META bijgewerkt ({len(daily_meta)} dagen)")
        html = new
    else:
        print("⚠️  DAILY_META patroon niet gevonden")

# DAILY_ADS array (per-advertentiegroep dagcijfers)
if daily_ads:
    day_blocks = []
    for ds in sorted(daily_ads.keys()):
        ads_lines = []
        for a in daily_ads[ds]:
            name_js = json.dumps(a["n"])
            ads_lines.append(
                f'{{n:{name_js},spend:{a["spend"]},rev7:{a["rev7"]},rev1v:{a["rev1v"]},'
                f'purch:{a["purch"]},ctr:{a["ctr"]},cpc:{a["cpc"]},atc:{a["atc"]}}}'
            )
        day_blocks.append(f'  {{d:"{ds}",ads:[' + ",".join(ads_lines) + ']}')
    block = "const DAILY_ADS = [\n" + ",\n".join(day_blocks) + "\n];"
    new = re.sub(r'const DAILY_ADS\s*=\s*\[.*?\];', block, html, flags=re.DOTALL)
    if new != html:
        total_adsets = sum(len(v) for v in daily_ads.values())
        print(f"✓ DAILY_ADS bijgewerkt ({len(daily_ads)} dagen, {total_adsets} rijen)")
        html = new
    else:
        print("⚠️  DAILY_ADS patroon niet gevonden")

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
