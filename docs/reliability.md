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
  `scripts/sync_returns.py` controleert dagelijks ook gewijzigde oudere orders via de bestaande externe runner; dit hangt af van de Mac en Shopify-connector. Bij mislukken blijven de oude controle en waarschuwing zichtbaar. De fysieke ontvangstdatum ontbreekt; verwerking van de refund dient als benadering.
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


### Eenduidige omzetbasis, 1 oktober 2026
`compute().revenue` is voor Overzicht, Meta, Google en Influencers altijd omzet excl. de aangenomen 21% btw, na correcties. `revenueIncl` bewaart het bijbehorende bedrag incl. btw voor platform-ROAS. KPI, grafiek, selectie en kanaalvergelijking gebruiken exclusieve omzet; winstmarge deelt resultaat door diezelfde omzet. De winstberekening blijft identiek: de winkelmarge was al excl. btw en advertentiekanaalramingen vermenigvuldigen inclusieve platformomzet met een margefactor waarin de btw al verwijderd is. Retourcorrecties trekken terugbetaalde omzet excl. btw af. ROAS en Daan-bonus houden hun bestaande inclusieve platformbasis. Onderliggende onbewerkte platform- en ordergegevens worden apart als incl. btw gelabeld. Het 21%-tarief blijft een aanname omdat individuele belastingregels ontbreken.


### Zelfherijkende retourbegroting
`data/returns.json` bewaart alleen totalen per bestel-/kalibratiedag en week, kostengrondslag en modelparameters. Nieuwe ordernummers en losse refundmomenten worden niet gepubliceerd. De private controlehistorie wordt uitsluitend op de runner gecachet in `.cache/lumeworks-return-register.json`, met beperkte bestandsrechten; alleen dagtotalen gaan naar git. De eerste volledige controle bevat 575 orders sinds 5 augustus 2026. Refunds met `RETURN_RECEIVED` of restockType RETURN gelden als retour; CANCEL/annuleringen zijn afzonderlijk. Nog niet uitbetaalde retouren tellen economische terugdraaiing van regels mee, met de echte `taxesIncluded`-vlag, begrensd tot orderbedrag. Eén pakket per retourorder blijft een aanname. Dagelijkse incrementele controle heeft twee dagen overlap en vervangt de hele refundlijst per gewijzigde order. Identieke events worden niet dubbel verwerkt; onvolledige pagina's, ongeldige bedragen of datums bewaren de oude bron. De bestaande Mac-runner moet actief zijn; dit is geen onafhankelijk cloud-retourwebhook.

Kalibratie gebruikt uitsluitend voldoende oude, positieve, niet geannuleerde orders. Horizon = minstens 28 dagen en de gemeten 95%-vertraging naar volgende volle week; nu 35 dagen. Er zijn minimaal 50 volwassen orders en 3 retourorders nodig. De huidige vroege basis is 4/146 (2,74%); dit is onzeker, geen bewezen toekomstpercentage. De refund/ontvangstvertraging gebruikt kalenderdagen tot verwerking, geen daadwerkelijke ontvangstscan. Per order zonder correctie is de resterende retourkans p×(1−F(leeftijd))/(1−p×F(leeftijd)). Terugbetaling gebruikt het gemiddelde teruggedraaide omzetaandeel van volwassen retouren. Reservering = verwachte terugbetaling excl. aangenomen 21% btw + €20×verwachte pakketten − 4% overheadvrijval. Er wordt geen productkostprijsherstel of commissieteruggave verzonnen. Na geconstateerde retour of annulering vervalt de reservering van die order; bekende correcties lopen via dezelfde bestaande boekingsregels.

De leeftijd bevriest op de laatste succesvolle controle, zodat een storing de reserve niet stilzwijgend laat verdwijnen. Nieuwere Shopify-orders krijgen leeftijd nul totdat de retourcontrole ze heeft opgenomen. Kalibratie wordt bij iedere nieuwe valide bron opnieuw gedaan; de berekening wordt in het geheugen gedeeld door daggrafiek en KPI. Influencerorders worden apart toegewezen; overige reservering volgt dezelfde periode-aandelen van Meta en Google non-branded als werkelijke correcties, met restant Overig. Google branded krijgt geen extra pot. Ontbrekende/te kleine historie toont 'niet beschikbaar', met winst uitsluitend na geregistreerde correcties. Stale controle geeft amberstatus, geen actuele groene puls. ROAS, omzet-KPI's en Daan-bonus worden niet door de reservering veranderd; winst en winstmarge wel. De margeopbouw toont de reservering apart en sluit op de KPI aan.


De publieke dagtotalen bevatten een basis vóór correcties en de werkelijke correcties per oorspronkelijke besteldatum, met een aparte influenceruitsplitsing. Het dashboard past alleen het verschil tussen die twee toe op zijn eigen orderbasis, zodat nieuwe orders blijven meetellen en de oude handmatige correcties niet dubbel worden afgetrokken. Kostengrondslag moet exact overeenkomen met de huidige tarieven; bij afwijking vervalt de nieuwe bron met waarschuwing totdat de runner opnieuw rekent. Onderliggende orderregels uit de oude export blijven als eerdere momentopname aangeduid; nieuwe individuele retourdetails zijn geen onderdeel van de publieke update.
