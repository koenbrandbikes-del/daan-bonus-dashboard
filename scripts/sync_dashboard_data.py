#!/usr/bin/env python3
"""
Deterministische Meta-sync — geen Claude, geen LLM, geen regexpatching van
JavaScript in index.html. Schrijft alleen data/meta.json (atomisch) en werkt
het "meta"-veld van data/status.json bij.

Incrementeel: ververst alleen vandaag + een korte lookback (attributie kan
een paar dagen na de aankoop nog bijgesteld worden), en behoudt de rest van
de bestaande geschiedenis in data/meta.json ongewijzigd — geen 15+ API-calls
die met de tijd alleen maar blijven groeien.

Credentials in ~/.secrets/dashboard.env:
  META_ACCESS_TOKEN=...
  META_AD_ACCOUNT_ID=1326701336329006   (al ingesteld als standaard)
"""
import json, os, sys, time, tempfile, requests
import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_DIR   = Path(__file__).parent.parent
DATA_DIR   = REPO_DIR / "data"
META_PATH  = DATA_DIR / "meta.json"
STATUS_PATH = DATA_DIR / "status.json"

LOOKBACK_DAYS = 3   # vandaag + 2 dagen terug — dekt late/bijgestelde attributie
CLEAN_S    = datetime.date(2026, 8, 5)   # CAPI-fix datum, oudste dag die ooit gefetcht is

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

META_TOKEN   = creds.get("META_ACCESS_TOKEN")   or os.environ.get("META_ACCESS_TOKEN", "")
META_ACCOUNT = creds.get("META_AD_ACCOUNT_ID", "1326701336329006")

if not META_TOKEN:
    print("❌ Geen META_ACCESS_TOKEN in ~/.secrets/dashboard.env")
    sys.exit(1)

# ── Datums ───────────────────────────────────────────────────────────────────
TODAY   = NOW_NL.date()
YEST    = TODAY - datetime.timedelta(days=1)
DOW     = TODAY.weekday()                       # 0=ma … 6=zo
WK_S    = TODAY - datetime.timedelta(days=DOW)
WK_S_C  = max(WK_S, CLEAN_S)
PWK_E   = WK_S - datetime.timedelta(days=1)
PWK_S   = PWK_E - datetime.timedelta(days=6)
LOOKBACK_FROM = max(CLEAN_S, TODAY - datetime.timedelta(days=LOOKBACK_DAYS - 1))

# ── Meta Marketing API ───────────────────────────────────────────────────────
PURCHASE_TYPES = ["purchase", "offsite_conversion.fb_pixel_purchase"]
ATC_TYPES = ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"]

def _av(lst, atype, window=None):
    for a in (lst or []):
        if a.get("action_type") == atype:
            if window:
                return float(a.get(window) or 0)
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
    r = None
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
        raise RuntimeError(f"Meta API fout ({start}–{end}) na 3 pogingen: {last_err}")

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

def meta_insights_by_adset(start: datetime.date, end: datetime.date) -> list:
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

def sum_daily(daily, from_date, to_date):
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

# ── Validatie ────────────────────────────────────────────────────────────────
# Vaste volgorde (lijst, geen set) — sets itereren niet-deterministisch tussen
# Python-runs (hash-randomisatie), wat anders bij elke sync een kunstmatige
# key-volgorde-diff in data/meta.json zou geven zonder echte inhoudswijziging.
DAY_FIELD_ORDER = ["spend", "rev7", "rev1v", "purch", "impr", "cl"]
REQUIRED_DAY_FIELDS = set(DAY_FIELD_ORDER)

def validate(daily_meta: dict, daily_ads: dict) -> list:
    """Geeft een lijst met foutmeldingen terug; leeg = geldig."""
    errors = []
    dates = sorted(daily_meta.keys())
    if not dates:
        errors.append("daily_meta is leeg")
        return errors
    for ds in dates:
        try:
            datetime.date.fromisoformat(ds)
        except ValueError:
            errors.append(f"ongeldige datum: {ds}")
            continue
        x = daily_meta[ds]
        missing = REQUIRED_DAY_FIELDS - set(x.keys())
        if missing:
            errors.append(f"{ds}: ontbrekende velden {missing}")
            continue
        for f in ("spend", "rev7", "rev1v"):
            if x[f] < 0:
                errors.append(f"{ds}: negatieve {f} ({x[f]})")
        for f in ("purch", "impr", "cl"):
            if x[f] < 0:
                errors.append(f"{ds}: negatieve {f} ({x[f]})")
    if dates != sorted(set(dates)):
        errors.append("dubbele datums in daily_meta")
    # Advertentiegroep-spend moet binnen een redelijke afrondingsmarge overeenkomen
    # met de totale dagspend (verschil kan door net-buiten-adset-scope campagnes).
    for ds in dates:
        if ds not in daily_ads:
            continue
        ads_spend = round(sum(a["spend"] for a in daily_ads[ds]), 2)
        day_spend = daily_meta[ds]["spend"]
        if day_spend > 0 and abs(ads_spend - day_spend) / day_spend > 0.15:
            errors.append(f"{ds}: som advertentiegroep-spend ({ads_spend}) wijkt >15% af van dagtotaal ({day_spend})")
    return errors

def atomic_write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=1, sort_keys=False)
            f.write("\n")
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise

def update_status(source: str, ok: bool, error: str | None):
    status = {}
    if STATUS_PATH.exists():
        try:
            status = json.loads(STATUS_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            status = {}
    status[source] = {
        "status": "ok" if ok else "error",
        "last_success": (status.get(source, {}).get("last_success") if not ok else NOW_NL.isoformat(timespec="seconds")),
        "error": error,
    }
    atomic_write_json(STATUS_PATH, status)

# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    existing = {"daily_meta": [], "daily_ads": []}
    if META_PATH.exists():
        try:
            existing = json.loads(META_PATH.read_text())
        except json.JSONDecodeError:
            print("⚠️  Bestaande data/meta.json is corrupt — start met lege basis (nieuwe fetch dekt lookback-venster alsnog)")

    daily_meta = {d["d"]: {k: d[k] for k in DAY_FIELD_ORDER} for d in existing.get("daily_meta", [])}
    daily_ads  = {d["d"]: d["ads"] for d in existing.get("daily_ads", [])}
    existing_day_count = len(daily_meta)

    print(f"Meta dagelijkse data ophalen (account {META_ACCOUNT}), lookback {LOOKBACK_FROM}–{TODAY}...")
    d = LOOKBACK_FROM
    while d <= TODAY:
        day_data = meta_insights(d, d)
        daily_meta[str(d)] = day_data
        daily_ads[str(d)] = meta_insights_by_adset(d, d)
        print(f"  {d}: spend={day_data['spend']:7.2f}  rev7={day_data['rev7']:7.2f}  rev1v={day_data['rev1v']:6.2f}  purch={day_data['purch']}")
        d += datetime.timedelta(days=1)

    errors = validate(daily_meta, daily_ads)
    if errors:
        msg = "; ".join(errors)
        print(f"❌ Validatie mislukt: {msg}")
        update_status("meta", ok=False, error=msg)
        sys.exit(1)

    # Een leeg/te klein resultaat mag nooit bestaande geldige geschiedenis
    # overschrijven — alleen relevant als de nieuwe set kleiner is dan wat we
    # al hadden (bv. API gaf voor het lookback-venster niets terug).
    if existing_day_count > 0 and len(daily_meta) < existing_day_count:
        msg = f"nieuwe dataset ({len(daily_meta)} dagen) is kleiner dan bestaande ({existing_day_count}) — niet overschreven"
        print(f"❌ {msg}")
        update_status("meta", ok=False, error=msg)
        sys.exit(1)

    v   = daily_meta.get(str(TODAY), {"spend":0,"rev7":0,"rev1v":0,"purch":0,"impr":0,"cl":0})
    g   = daily_meta.get(str(YEST),  {"spend":0,"rev7":0,"rev1v":0,"purch":0,"impr":0,"cl":0})
    w   = sum_daily(daily_meta, WK_S_C, TODAY)
    aug = sum_daily(daily_meta, CLEAN_S, TODAY)
    pw  = meta_insights(PWK_S, PWK_E)
    jul = None
    if existing.get("tb", {}).get("jul"):
        jul = existing["tb"]["jul"]   # juli is afgesloten historie, nooit opnieuw fetchen

    print("\n── Zelfcheck ────────────────────────────────────────────────────────────")
    print(f"  Week ({WK_S_C}–{TODAY}):  spend={w['spend']:.2f}  purch={w['purch']}")
    print(f"  Aug  ({CLEAN_S}–{TODAY}): spend={aug['spend']:.2f}  purch={aug['purch']}")
    print("── ✓ Aggregaten = som dagelijkse data ───────────────────────────────────")

    meta_out = {
        "snap": str(TODAY),
        "snap_time": NOW_NL.strftime("%H:%M"),
        "tb": {
            "vandaag":  {"from": str(TODAY), "to": str(TODAY), **v},
            "gisteren": {"from": str(YEST),  "to": str(YEST),  **g},
            "week":     {"from": str(WK_S_C),"to": str(TODAY), **w},
            "prevweek": {"from": str(PWK_S), "to": str(PWK_E), **pw},
            "jul": jul,
            "aug_clean":{"from": str(CLEAN_S),"to": str(TODAY),**aug},
        },
        "daily_meta": [{"d": ds, **daily_meta[ds]} for ds in sorted(daily_meta)],
        "daily_ads":  [{"d": ds, "ads": daily_ads[ds]} for ds in sorted(daily_ads) if ds in daily_meta],
    }

    atomic_write_json(META_PATH, meta_out)
    update_status("meta", ok=True, error=None)
    new_days = max(0, len(daily_meta) - existing_day_count)
    print(f"✓ data/meta.json bijgewerkt: {TODAY} {meta_out['snap_time']} ({len(daily_meta)} dagen totaal, {new_days} nieuw, lookback-venster ververst)")

if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        print(f"❌ {e}")
        update_status("meta", ok=False, error=str(e))
        sys.exit(1)
