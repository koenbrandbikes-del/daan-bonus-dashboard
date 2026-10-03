# Eén dashboard op meta.lumeworks.nl

Het oorspronkelijke `index.html` wordt tijdens de private build opgenomen in
de bestaande code-release. Meta-resultaten, vergoeding, bonussimulator,
advertentiegroepen en orderdetails blijven één dashboard. Geen wijziging aan
de bestaande bonusberekeningen of de publieke GitHub-versie.

De nieuwe ingang definieert `LW_ORIGINAL_META` vóór de bestaande beveiligde
app wordt geladen. Alleen die expliciet geïnstalleerde ingang gebruikt de
host `meta.lumeworks.nl`; de cijfers-ingang blijft ongewijzigd. Dezelfde private
database en automatische gegevensaanvoer worden gebruikt. Cookies blijven
hostgebonden. Het accountscherm biedt op Meta geen gesplitste testdashboards.

Inline handlers worden tijdens de build omgezet naar gewone eventlisteners,
ook bij dynamisch gegenereerde rijen. Inline scripts krijgen een CSP-nonce;
geen `eval` of versoepeling van script-CSP. De bestaande externe advertentie-
tagservice blijft uitsluitend voor de oorspronkelijke tags bereikbaar.

## Publicatie

1. Publiceer de code-release via de bestaande workflow, met herstel bij fouten.
2. Maak in SiteGround `meta.lumeworks.nl` en het HTTPS-certificaat aan. Laat de
   Shopify-hoofddomeinen en mailrecords intact.
3. Voer het afzonderlijk bewaarde installatiescript uit op de Mac met de bestaande
   installatiebestanden. De installatie stopt bij onbekende websitebestanden.

De nieuwe documentroot bevat alleen een bootstrap en routing. Financiële
gegevens blijven buiten de documentroot. Bestaande rootbestanden worden vooraf
privé gekopieerd; accounts, wachtwoorden en database worden niet gewijzigd.
Herstel van de nieuwe ingang: kopieer de opgeslagen rootbestanden terug uit de
gemelde `meta-backup-*`-map en verwijder alleen de nieuw aangemaakte rootbestanden
die niet in die backup staan. De oude publieke URL blijft bestaan totdat de
nieuwe versie na login en op mobiel volledig is gecontroleerd.

## Controle

`node --test siteground/tests/original_meta.test.mjs`

`LW_TEST_BASE='' LW_TEST_RELEASE=1 python siteground/tests/original_meta.py`

De Python-test controleert vier bestaande accounts, anonieme gegevensafscherming,
nonce-CSP, oorspronkelijke onderdelen en het ontbreken van gesplitste links.
DNS, SSL en een ingelogde productiepagina zijn pas bevestigd na installatie;
lokale tests betekenen niet dat het subdomein live staat.
