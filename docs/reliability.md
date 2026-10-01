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
- Retourclassificatie gecontroleerd op 1 oktober 2026: ontvangen retouren volgen
  `RETURN_RECEIVED` of Shopify refundregels met `restockType: RETURN`.
  €20 per pakket; historisch één pakket per retourorder aangenomen, niet per artikel.
  Nieuwe ontvangstregistraties en terugbetalingen worden nog niet automatisch
  volledig gesynchroniseerd. De datum van de financiële momentopname blijft apart zichtbaar.
- Influencerresultaat gebruikt de eigen gekoppelde Shopify-orders na correcties,
  inclusief behouden product-/betaalkosten, retourafhandeling en kanaalkosten.
  Ontbrekende orderkoppelingen of ongecontroleerde retourvlaggen geven geen resultaat.
  Meta en Google gebruiken de winkelmarge vóór correcties en trekken daarna
  één toegerekend correctiebedrag af. Influencerorders worden uit de pot gehaald.
  Overige terugbetalingen en retourkosten volgen Meta-aankopen en Google
  non-branded aankopen / resterende Shopify-orders; bij overlap worden aandelen
  evenredig begrensd tot 100%. Overig bewaart het restant. Branded krijgt geen
  eigen correctie; Alles bevat hetzelfde Google-deel één keer.
  Omzet wordt verminderd met toegerekende terugbetalingen incl. btw; resultaat
  verwerkt de correctie excl. btw, retourafhandeling, vrijval productkosten bij
  annulering en vrijval overhead. De grafiek houdt de periode-aandelen en marge
  vast zodat dag-/week-/maandtotalen aansluiten. Dit is geschatte attributie.
- Daan telt bij elke opening/herlading mee, ook vanuit oude `daan=without`-links.
  De uitschakelknop is alleen een tijdelijke, bewuste scenariovergelijking.
- De verticale margeopbouw gebruikt dezelfde rekencomponenten als de kerncijfers.
  Subtotalen worden niet nogmaals opgeteld; onbekende bedragen blijven onbekend.
  Grafiekselectie gebruikt de SVG-schermtransformatie, zodat schalen/zoomen geen
  afwijkend bucket oplevert. Grafiekpunten en tabelrijen delen dezelfde datumgrenzen.
- Status onderaan is uitklapbaar. Alleen beschikbare, actuele, dekkende bronnen
  zonder cache-/statusfout en met berekenbaar resultaat geven groen; bij een
  afwijking blijft de indicator amber, zonder animatie. Reduced-motion wordt gerespecteerd.
- Selecties, presets en vergelijking beginnen op 5 augustus 2026; de historische
  Daan-contractberekening behoudt haar eigen oorspronkelijke begindatum.
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


### Kostprijssheet, gecontroleerd 1 oktober 2026
Actuele tarieven uit `001 LumeWorks / Kostprijscalculatie` splitsen inkoop, transport naar Nederland en fulfilment. Atlas heeft een handmatig landed bedrag van €62,80: €3,06 boven inkoop plus transport. Deze broncorrectie blijft expliciet zichtbaar en het totaal blijft €71,75. Er zijn geen historische ingangsdatums; actuele tarieven worden voor alle orders gebruikt. Fulfilmenttarieven per product/bundel worden per verkochte eenheid toegepast; werkelijke gecombineerde pakketten en losse outbound tarieven ontbreken. Herhaalorderkorting is niet toegepast zonder betrouwbare klantkoppeling. Retourafhandeling blijft afzonderlijk €20 per geregistreerd ontvangen pakket. Ontvangen producten blijven kosten totdat aantoonbaar voorraadherstel bekend is. Kostcomponenten moeten aansluiten op het eenheidstarief voordat caching is toegestaan. De kostenopbouw per kanaal gebruikt dezelfde verdeling en annuleringsvrijval als het resultaat.

Het winstaandeel is kanaalresultaat gedeeld door het totale winkelresultaat over dezelfde periode, met dezelfde Daan-keuze. Geen percentage bij onbekende, nul of negatieve winkelwinst. Kanaalramingen overlappen en hoeven niet tot 100% op te tellen. Groene bronstatussen pulseren; waarschuwingen en reduced-motion blijven statisch.
