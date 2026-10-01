# Betrouwbaarheid financieel dashboard

Doel: 99,9% beschikbaarheid. Dit is een meetdoel, geen huidige garantie.
99,9% beschikbaarheid staat bij 30 dagen maximaal 43,2 minuten uitval toe.
Een controle per 30 minuten via GitHub Actions is een eerste vangnet: schedules
kunnen vertragen. Dit meet steekproeven en bewijst geen tijdgewogen 99,9%.
Voor een aantoonbare SLA is onafhankelijke monitoring per minuut nodig,
met bewaarde incidentduur, bereikbare eigenaar en herstelafspraken.

## Ingebouwde bescherming
- Vier bronnen en tarieven parallel ophalen; maximaal twee pogingen van acht
  seconden per bron, inclusief het lezen van JSON.
- Ordernummers, echte kalenderdatums, bedragen, meetmomenten en kostentarieven
  valideren. Dubbele advertentiedagen worden geweigerd.
- Alleen opnieuw gevalideerde gegevens uit de huidige browsersessie als
  fallback. Een waarschuwing blijft zichtbaar; er is geen fictieve nulwaarde
  voor ontbrekende bonussen. Zonder geldig kostenregister stopt het overzicht.
- Dagdekking van Meta en Google controleren voor selectie en vergelijking.
- Shopify bronstatus apart van de controle op orderinhoud tonen.
- Regressietests bij codewijzigingen; live health-check iedere 30 minuten,
  inclusief pagina/assets, bronvalidatie, versheid en synchronisatiestatus.
  Resultaten als Actions-artifact 30 dagen bewaren; een fout faalt de workflow.
  GitHub-notificatie-instellingen bepalen of de eigenaar bericht krijgt.

## Resterende kwetsbaarheden
- Shopify-webhooks verwerken orders, maar vormen geen periodieke volledige
  aansluiting met Shopify. Een gemiste webhook kan een ontbrekende order geven.
  Een bronstatus of valide JSON bewijst niet dat elke order is opgehaald.
- Historische bonusgegevens vóór beschikbare daghistorie ontbreken.
- Retouren en kostprijzen blijven gecontroleerde momentopnamen/aannamen.
  Influenceropstartkosten volgen de brontabel; verzenddatums ontbreken nog.
- Platformattributie overlapt en wordt achteraf bijgesteld; kanaalwinst is geschat.
- Worker/MCP bevatten afzonderlijke rekenlogica. Wijzigingen aan het financieel
  dashboard zijn geen bewijs dat die aparte API exact dezelfde uitkomst geeft.
- GitHub Pages en Actions, externe cron en platform-API's blijven afhankelijkheden.
  De testworkflow blokkeert de bestaande automatische Pages-publicatie niet;
  branch protection en een centrale deployment-pipeline zijn nog niet ingesteld.
- De site en JSON-bestanden zijn publiek. Toegang tot bedrijfsgegevens vereist
  afzonderlijke authenticatie/hosting als vertrouwelijkheid nodig is.

## Verificatie
`npm test` controleert berekeningen, bediening en gesimuleerde netwerkfouten.
`node scripts/check-dashboard-health.mjs` controleert de gepubliceerde gegevens.
Voer na wijzigingen beide uit en bekijk de laatste Pages-deployment.
