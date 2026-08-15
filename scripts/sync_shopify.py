#!/usr/bin/env python3
"""
Shopify-ordersync — de ENIGE plek in deze pipeline die Claude gebruikt, en
alleen omdat de Shopify Admin API hier niet werkt (zie ~/.secrets/dashboard.env
— bekende 401, wordt niet opnieuw geprobeerd op te lossen, zie projectinstructies).

Roept Claude NIET aan om bestanden te lezen of te bewerken. Claude krijgt alleen
het laatst bekende ordernummer mee (geen historie, geen index.html, geen ander
dashboardbestand), gebruikt de Shopify MCP-tool om alleen nieuwere orders op te
halen, en print UITSLUITEND een compacte JSON-array terug op stdout. Dit script
valideert dat resultaat en merget het deterministisch in data/shopify.json —
Claude zelf schrijft nergens naartoe.
"""
import json, os, re, subprocess, sys, tempfile
import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_DIR    = Path(__file__).parent.parent
DATA_DIR    = REPO_DIR / "data"
SHOPIFY_PATH = DATA_DIR / "shopify.json"
STATUS_PATH  = DATA_DIR / "status.json"
CLAUDE       = "/Users/koengrosman/.npm-global/bin/claude"
SHOP         = "lumeworksnl.myshopify.com"
TEST_CODES   = {"pim100", "koen100", "job100"}

NL_TZ  = ZoneInfo("Europe/Amsterdam")
NOW_NL = datetime.datetime.now(NL_TZ)

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

def update_status(ok: bool, error, note=None):
    status = {}
    if STATUS_PATH.exists():
        try:
            status = json.loads(STATUS_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            status = {}
    entry = {
        "status": "ok" if ok else "error",
        "last_success": (status.get("shopify", {}).get("last_success") if not ok else NOW_NL.isoformat(timespec="seconds")),
        "error": error,
    }
    if note:
        entry["note"] = note
    status["shopify"] = entry
    atomic_write_json(STATUS_PATH, status)

def order_num_int(num: str):
    m = re.search(r"\d+", num or "")
    return int(m.group()) if m else -1

def validate_new_orders(new_orders, existing_nums):
    """Geeft (geldige_orders, fouten) terug. Filtert stilzwijgend exacte
    duplicaten van al bekende ordernummers (kan gebeuren als Claude het
    lookback-venster iets ruimer neemt dan strikt nodig)."""
    errors = []
    valid = []
    seen = set()
    for i, o in enumerate(new_orders):
        if not isinstance(o, dict):
            errors.append(f"item {i}: geen object")
            continue
        missing = {"d", "num", "items", "code", "incl"} - set(o.keys())
        if missing:
            errors.append(f"item {i} ({o.get('num','?')}): ontbrekende velden {missing}")
            continue
        try:
            datetime.date.fromisoformat(o["d"])
        except (ValueError, TypeError):
            errors.append(f"{o['num']}: ongeldige datum {o.get('d')!r}")
            continue
        if not isinstance(o["items"], list) or not o["items"]:
            errors.append(f"{o['num']}: items moet een niet-lege lijst zijn")
            continue
        try:
            incl = float(o["incl"])
        except (ValueError, TypeError):
            errors.append(f"{o['num']}: ongeldige prijs {o.get('incl')!r}")
            continue
        if incl < 0:
            errors.append(f"{o['num']}: negatieve prijs ({incl})")
            continue
        if o["num"] in existing_nums:
            continue  # al bekend, stille dedup
        if o["num"] in seen:
            continue  # dubbel in dit antwoord, stille dedup
        seen.add(o["num"])
        code = o.get("code") or ""
        rec = {"d": o["d"], "num": o["num"], "items": o["items"], "code": code, "incl": round(incl, 2)}
        if code.lower() in TEST_CODES or incl < 10:
            rec["test"] = True
        valid.append(rec)
    return valid, errors

def main():
    if not SHOPIFY_PATH.exists():
        print(f"❌ {SHOPIFY_PATH} bestaat niet — kan niet incrementeel syncen")
        update_status(ok=False, error="data/shopify.json ontbreekt")
        sys.exit(1)

    try:
        existing = json.loads(SHOPIFY_PATH.read_text())
    except json.JSONDecodeError as e:
        print(f"❌ data/shopify.json is corrupt: {e}")
        update_status(ok=False, error=f"corrupt JSON: {e}")
        sys.exit(1)

    existing_orders = existing.get("orders", [])
    existing_nums = {o["num"] for o in existing_orders}
    last_num = max((order_num_int(o["num"]) for o in existing_orders), default=0)

    print(f"Laatst bekend ordernummer: #{last_num}. Nieuwe orders ophalen via Shopify MCP...")

    prompt = (
        f"Use the Shopify MCP graphql_query tool to fetch orders from {SHOP} with "
        f"order number strictly greater than #{last_num} (query: \"created_at:>=2026-08-01\", "
        f"sort by CREATED_AT, first 20 is enough), with name, createdAt, totalPriceSet "
        f"shopMoney amount, discountCodes, and lineItems title+quantity. "
        f"Output ONLY a raw JSON array on stdout, nothing else — no markdown fences, no "
        f"explanation, no leading/trailing text. Each element: "
        f'{{"d":"YYYY-MM-DD","num":"#XXXX","items":["Product",...],"code":"discountcode-or-empty",'
        f'"incl":123.45}}. If there are no orders newer than #{last_num}, output exactly: []'
    )

    try:
        proc = subprocess.run(
            [CLAUDE, "--print", "--dangerously-skip-permissions", prompt],
            capture_output=True, text=True, timeout=180,
        )
    except subprocess.TimeoutExpired:
        print("❌ Claude CLI timeout na 180s")
        update_status(ok=False, error="Claude CLI timeout")
        sys.exit(1)

    if proc.returncode != 0:
        err = (proc.stderr or "")[:300]
        print(f"❌ Claude CLI gaf exit code {proc.returncode}: {err}")
        update_status(ok=False, error=f"Claude CLI exit {proc.returncode}: {err}")
        sys.exit(1)

    raw = proc.stdout.strip()
    # Claude houdt zich meestal aan "alleen JSON", maar defensief markdown-fences strippen
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    m = re.search(r"\[.*\]", raw, re.DOTALL)
    if m:
        raw = m.group()

    try:
        new_orders = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"❌ Kon Claude-output niet als JSON parsen: {e}")
        print(f"   Ruwe output (eerste 300 tekens): {proc.stdout[:300]!r}")
        update_status(ok=False, error=f"ongeldige JSON van Claude: {e}")
        sys.exit(1)

    if not isinstance(new_orders, list):
        print(f"❌ Verwachtte een JSON-array, kreeg {type(new_orders).__name__}")
        update_status(ok=False, error="Claude gaf geen JSON-array terug")
        sys.exit(1)

    valid, errors = validate_new_orders(new_orders, existing_nums)
    if errors:
        print("❌ Validatiefouten in nieuwe orders: " + "; ".join(errors))
        update_status(ok=False, error="; ".join(errors)[:500])
        sys.exit(1)

    if not valid:
        print("✓ Geen nieuwe orders — data/shopify.json blijft ongewijzigd")
        update_status(ok=True, error=None)
        return

    merged = existing_orders + valid
    merged.sort(key=lambda o: (o["d"], order_num_int(o["num"])))
    atomic_write_json(SHOPIFY_PATH, {"orders": merged})
    update_status(ok=True, error=None)
    print(f"✓ {len(valid)} nieuwe order(s) toegevoegd aan data/shopify.json (totaal {len(merged)})")

if __name__ == "__main__":
    main()
