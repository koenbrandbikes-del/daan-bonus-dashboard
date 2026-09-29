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
GitHub Pages-URL terecht (blended.html leest 'm rechtstreeks). Individuele
creator-namen gekoppeld aan hun persoonlijke omzet/commissie horen daar niet
onversleuteld in thuis — dit script vervangt de echte voornaam daarom altijd
door een stabiele, niet-terug te herleiden code (hash van de naam). De echte
namen blijven alleen in de bron-sheet staan, nooit in deze repo.
"""
import csv
import hashlib
import io
import json
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone


def anon_id(name):
    """Stabiele, niet-omkeerbare code per creator-naam — zelfde naam geeft
    bij elke rerun dezelfde code, zodat trends over tijd volgbaar blijven
    zonder de echte naam in de publieke JSON te zetten."""
    h = hashlib.sha256(name.strip().lower().encode()).hexdigest()[:4].upper()
    return f"Creator-{h}"

SHEET_ID = "1KFqw7ced05h4K2HU60yUAdImPs42Hm8LMfGHaOoRw7Y"
SALES_GID = "1378460483"
CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={SALES_GID}"

OUT_PATH = "data/creators.json"


def eur_to_float(s):
    """'€134,10' -> 134.10"""
    if not s:
        return 0.0
    s = s.replace("€", "").replace(".", "").replace(",", ".").strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


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
    return f"{y}-{mo}-{d}"


def fetch_csv(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    return raw.decode("utf-8-sig")


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
            "creator": anon_id(creator),
            # Geen "code" hier: de kortingscode (bv. "Anniek10", "PAKHUIS")
            # verklapt zelf al de echte naam, dus die hoort niet in de
            # publieke JSON — precies wat anon_id() net vermijdt.
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
            "creator": anon_id(name),
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
        "source": "Creators Google Sheet · tab 'Sales' (momentopname, geen live sync)",
        "totals": totals,
        "creators": creators,
        "orders": rows,
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print(f"✓ {len(rows)} orders, {len(creators)} creators -> {OUT_PATH}")
    print(f"  Totaal omzet (excl BTW, excl retour): €{totals['omzet_excl']:.2f}")
    print(f"  Totaal commissie: €{totals['commissie']:.2f} "
          f"(betaald €{totals['betaald']:.2f}, openstaand €{totals['openstaand']:.2f})")
    if corrected:
        print(f"  ⚠️  {corrected} orders hadden een foutieve 'Grondslag excl. BTW' in de sheet "
              f"(stond gelijk aan incl.-bedrag of €0) — gecorrigeerd via het echte Shopify-orderbedrag.")


if __name__ == "__main__":
    main()
