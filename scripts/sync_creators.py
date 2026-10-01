#!/usr/bin/env python3
"""
Creators/affiliate-sync — leest de "Sales"-tab van het externe Creators-
Google Sheet (bijgehouden door de creators/affiliate-beheerder, los van deze
repo) via de publieke CSV-export en zet 'm om naar data/creators.json.

Geen live automatische verversing (geen cron hierop, in tegenstelling tot
Meta/Shopify): dit is een momentopname. Sheet is "voor iedereen met de link"
leesbaar, dus een simpele GET volstaat — geen auth nodig. Vanaf de Mac
(server-side) omdat Google's CSV-export geen CORS-header teruggeeft en dus
niet vanuit de browser (blended.html, GitHub Pages) opgehaald kan worden.

Herdraaien: python3 scripts/sync_creators.py   (overschrijft data/creators.json)

Privacy: data/creators.json komt op een volledig publieke, niet-afgeschermde
GitHub Pages-URL terecht (blended.html leest 'm rechtstreeks) — dus ook de
voornamen hieronder zijn voor iedereen met de link zichtbaar. Bewust
gekozen door Koen (29 sep 2026): eerst geanonimiseerd geweest (hash-codes
i.p.v. namen), maar op verzoek teruggezet naar de echte voornaam uit de
sheet, omdat de codes de tabel onbruikbaar maakten. Bij twijfel hierover:
navragen voordat je dit weer aanpast.
"""
import csv
import io
import json
import re
import sys
import urllib.request
import time
import os
import tempfile
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timezone

SHEET_ID = "1KFqw7ced05h4K2HU60yUAdImPs42Hm8LMfGHaOoRw7Y"
SALES_GID = "1378460483"
CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={SALES_GID}"

SETTINGS_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid=1008701550"
OUT_PATH = "data/creators.json"


def eur_to_float(s):
    """'€134,10' -> 134.10"""
    if not s:
        return 0.0
    s = s.replace("€", "").replace(".", "").replace(",", ".").strip()
    try:
        return float(s)
    except ValueError as e:
        raise ValueError(f"Ongeldig bedrag in Creators-sheet: {s!r}") from e


def pct_to_float(s):
    """'10%' -> 10.0"""
    if not s:
        return 0.0
    return float(s.replace("%", "").strip() or 0)


def nl_date_to_iso(s):
    """'16-07-2026' -> '2026-07-16'"""
    s = (s or "").strip()
    m = re.match(r"^(\d{2})-(\d{2})-(\d{4})$", s)
    if not m:
        return None
    d, mo, y = m.groups()
    value = f"{y}-{mo}-{d}"
    datetime.strptime(value, "%Y-%m-%d")
    return value


def fetch_csv(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw = resp.read()
            return raw.decode("utf-8-sig")
        except (OSError, UnicodeError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


STARTUP_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid=1511639179"

def load_startup_costs():
    grid = list(csv.reader(io.StringIO(fetch_csv(STARTUP_URL))))
    if len(grid) < 5 or grid[3][:5] != ["Creator", "Kortingscode", "Beamer", "Accessoire", "Extra accessoire"]:
        raise ValueError("Onverwachte opstartkostentabel; bestaande dataset blijft behouden")
    rows = []
    excluded = []
    for row in grid[4:]:
        row += [""] * max(0, 23 - len(row))
        if row[22].strip(): excluded.append(row[22].strip())
        if not row[0].strip(): continue
        values = [eur_to_float(row[i]) for i in range(5,10)]
        import math
        if any(not math.isfinite(v) or v < 0 for v in values) or abs(sum(values[:4])-values[4]) > .011:
            raise ValueError("Ongeldige opstartkosten voor " + row[0])
        rows.append(dict(zip(
            ["creator","code","beamer","accessory","extra_accessory","beamer_cost","accessory_cost","extra_accessory_cost","shipping","total"],
            [v.strip() for v in row[:5]] + values,
        )))
    if not rows or any(not r["code"] for r in rows) or len({r["code"].casefold() for r in rows}) != len(rows):
        raise ValueError("Ontbrekende/dubbele opstartkostenregistratie")
    if any(r["creator"] in excluded for r in rows):
        raise ValueError("Uitgesloten influencer staat in kostentabel")
    return {"source":"Extra kosten influencers", "date_basis":"shipment_dates_unknown", "count":len(rows), "total":round(sum(r["total"] for r in rows),2), "excluded":excluded, "rows":rows}

BTW = 1.21


def load_shopify_by_num():
    """num -> incl-BTW-bedrag uit data/shopify.json, om de sheet's eigen
    'Grondslag (omzet excl. BTW)'-kolom te verifiëren/corrigeren (zie
    main() hieronder) — die klopt niet altijd."""
    try:
        with open("data/shopify.json", encoding="utf-8") as f:
            d = json.load(f)
        return {o["num"]: o["incl"] for o in d["orders"]}
    except Exception as e:
        print(f"⚠️  Kon data/shopify.json niet lezen ({e}) — geen kostprijs-check op de sheet-omzet", file=sys.stderr)
        return {}


def main():
    try:
        text = fetch_csv(CSV_URL)
    except Exception as e:
        print(f"⚠️  Kon Creators-sheet niet ophalen: {e}", file=sys.stderr)
        sys.exit(1)

    settings = list(csv.DictReader(io.StringIO(fetch_csv(SETTINGS_URL))))
    roster = {r.get("Kortingscode", "").strip().casefold() for r in settings if r.get("Creator", "").strip() and r.get("Kortingscode", "").strip()}
    if not roster:
        raise ValueError("Geen creators in Instellingen; bestaande dataset blijft behouden")
    startup_costs = load_startup_costs()
    shopify_incl_by_num = load_shopify_by_num()
    corrected = 0
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    by_creator = defaultdict(lambda: {
        "orders": 0, "omzet_excl": 0.0, "commissie": 0.0,
        "betaald": 0.0, "openstaand": 0.0, "retouren": 0,
    })

    for row in reader:
        if not row.get("Ordernummer"):
            continue
        d = nl_date_to_iso(row.get("Datum", ""))
        creator = (row.get("Creator") or "").strip()
        if not creator:
            continue
        retour = (row.get("Retour?") or "").strip().lower() == "ja"
        num = (row.get("Ordernummer") or "").strip()
        omzet_excl = eur_to_float(row.get("Grondslag (omzet excl. BTW)"))
        # De sheet's "Grondslag"-kolom is niet altijd betrouwbaar: bij een
        # deel van de orders staat daar het incl.-BTW-bedrag in plaats van
        # excl. (en bij losse upsell-regels soms €0, terwijl er wel voor
        # betaald is). Waar het echte Shopify-orderbedrag bekend is
        # (ordernummer-match), gebruiken we dat i.p.v. de sheet-kolom —
        # zelfde bedrag waar ook de kostprijs/marge in blended.html tegen
        # afgezet wordt, dus omzet en marge blijven consistent.
        real_incl = shopify_incl_by_num.get(num)
        if real_incl is not None:
            real_excl = round(real_incl / BTW, 2)
            if abs(real_excl - omzet_excl) > 1:
                corrected += 1
            omzet_excl = real_excl
        commissie = eur_to_float(row.get("Commissie €"))
        status = (row.get("Status uitbetaling") or "").strip()

        rec = {
            "d": d,
            "creator": creator,
            "code": (row.get("Kortingscode") or "").strip(),
            "num": num,
            "product": (row.get("Product") or "").strip(),
            "herkomst": (row.get("Herkomst (eerste bezoek)") or "").strip(),
            "omzet_excl": round(omzet_excl, 2),
            "commissie_pct": pct_to_float(row.get("Commissie %")),
            "commissie": round(commissie, 2),
            "status": status,
            "retour": retour,
        }
        rows.append(rec)

        c = by_creator[creator]
        c["orders"] += 1
        if not retour:
            c["omzet_excl"] += omzet_excl
            c["commissie"] += commissie
            if status == "Betaald":
                c["betaald"] += commissie
            else:
                c["openstaand"] += commissie
        else:
            c["retouren"] += 1

    creators = []
    for name, c in sorted(by_creator.items(), key=lambda kv: -kv[1]["commissie"]):
        creators.append({
            "creator": name,
            "orders": c["orders"],
            "retouren": c["retouren"],
            "omzet_excl": round(c["omzet_excl"], 2),
            "commissie": round(c["commissie"], 2),
            "betaald": round(c["betaald"], 2),
            "openstaand": round(c["openstaand"], 2),
        })

    totals = {
        "orders": sum(c["orders"] for c in creators),
        "retouren": sum(c["retouren"] for c in creators),
        "omzet_excl": round(sum(c["omzet_excl"] for c in creators), 2),
        "commissie": round(sum(c["commissie"] for c in creators), 2),
        "betaald": round(sum(c["betaald"] for c in creators), 2),
        "openstaand": round(sum(c["openstaand"] for c in creators), 2),
    }

    out = {
        "synced_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "Creators Google Sheet · tab 'Sales' (ieder uur gesynchroniseerd)",
        "sync_interval_minutes": 60,
        "collaborations": {
            "total": len(roster),
            "with_orders": len(roster & {r["code"].casefold() for r in rows}),
            "without_orders": len(roster - {r["code"].casefold() for r in rows}),
            "basis": "Instellingen + volledige Sales-tab; bestellingen via kortingscode, inclusief eventuele retouren",
            "through": max(r["d"] for r in rows if r["d"]),
        },
        "startup_costs": startup_costs,
        "totals": totals,
        "creators": creators,
        "orders": rows,
    }

    if len({o["num"] for o in rows}) != len(rows):
        raise ValueError("Dubbele ordernummers in Creators-sheet; bestaande dataset blijft behouden")
    if any(not o["d"] for o in rows):
        raise ValueError("Ontbrekende orderdatum; bestaande dataset blijft behouden")
    if not rows:
        raise ValueError("Geen creatororders gevonden; bestaande dataset blijft behouden")
    import math
    if any(not math.isfinite(o["commissie"]) or not math.isfinite(o["omzet_excl"]) for o in rows):
        raise ValueError("Ongeldige bedragen; bestaande dataset blijft behouden")
    target = Path(OUT_PATH)
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, delete=False) as f:
            temp_name = f.name
            json.dump(out, f, ensure_ascii=False, indent=1, allow_nan=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_name, target)
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)

    print(f"✓ {len(rows)} orders, {len(creators)} creators -> {OUT_PATH}")
    print(f"  Totaal omzet (excl BTW, excl retour): €{totals['omzet_excl']:.2f}")
    print(f"  Totaal commissie: €{totals['commissie']:.2f} "
          f"(betaald €{totals['betaald']:.2f}, openstaand €{totals['openstaand']:.2f})")
    if corrected:
        print(f"  ⚠️  {corrected} orders hadden een foutieve 'Grondslag excl. BTW' in de sheet "
              f"(stond gelijk aan incl.-bedrag of €0) — gecorrigeerd via het echte Shopify-orderbedrag.")


if __name__ == "__main__":
    main()
