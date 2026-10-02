# LumeWorks — SiteGround voorbereiding

Doel: https://www.lumeworks.nl/cijfers/ . Vier gelijkwaardige accounts: koen, floris, pim, bas. Willekeurige startwachtwoorden van 12 letters/cijfers. Tab- en appnaam: LumeWorks.
Deze release is een voorbereid installatiepakket; de huidige GitHub Pages-site wordt hiermee niet automatisch beveiligd.

## Indeling en vereisten

PHP 8.3+ met PDO_SQLite en Argon2, HTTPS, Apache rewrite/`.htaccess`, schrijfbare private map. Geen Node-runtime op de hosting nodig. SiteGround ondersteunt SQLite/PDO_SQLite.

Plaats de inhoud van `public/` in `public_html/cijfers/`.
Plaats `lumeworks-private/` **naast** `public_html/`, nooit erin:

```
<website-home>/public_html/cijfers/index.php
<website-home>/lumeworks-private/app.php
<website-home>/lumeworks-private/config.json
<website-home>/lumeworks-private/state.sqlite
```

`private-path.php` berekent deze locatie. Pas alleen het pad aan als SiteGround een andere website-home gebruikt. Private map 0700, config/database 0600, eigenaar dezelfde hostinggebruiker als PHP. Geen openbare installatiepagina, phpinfo, config-download of password-resetlink.

## Wat is afgeschermd

Elke HTML-, JS- en financiële JSON-route wordt serverzijdig gecontroleerd. Data, configuratie, wachtwoordhashes en dashboardtemplate staan buiten document root. Vier accounts hebben Argon2id-hashes; wachtwoorden komen niet in GitHub of het ZIP-pakket als leesbare tekst.

Sessioncookie en apparaatcookie zijn HttpOnly, Secure, SameSite=Lax en alleen geldig onder `/cijfers/`. Een sessie heeft 8 uur inactiviteit en maximaal 24 uur levensduur. ‘Ingelogd blijven’ herstelt de sessie met een willekeurig apparaatsecret, alleen gehasht opgeslagen, roterend bij herstel, maximaal 30 dagen vanaf inloggen. Uitloggen verwijdert het apparaatsecret. ‘Alle apparaten uitloggen’ en wachtwoordwijziging trekken ook bestaande sessies in. Gebruikers kunnen zelf hun wachtwoord wijzigen onder hun naam bovenaan.

Login en accountacties hebben CSRF-controle, generieke loginfouten en beperking van mislukte pogingen. Dashboard en databestanden hebben `Cache-Control: no-store`. Financiële hersteldata blijven alleen in geheugen; de serviceworker is network-only en toont offline uitsluitend een verbindingsmelding. Een snelkoppeling gebruikt dezelfde login als de browser. Een wachtwoordmanager kan de invoer onthouden; het dashboard bewaart het wachtwoord niet.

Alleen vier accounts; geen registratie, geen email-reset, geen externe gebruikers. Verloren wachtwoorden worden beheerd via hosting/CLI. Geen belofte van foutloosheid of 99,9% beschikbaarheid: dat vereist hostingmonitoring en metingen in productie.

## Eerst de domeinroute vaststellen

`www.lumeworks.nl` stuurt momenteel naar de Shopify-webshop op `lumeworks.nl`. DNS routeert een host, geen losse `/cijfers`-map. Een Shopify app-proxy ondersteunt bovendien geen normale authcookies (Shopify verwijdert Cookie/Set-Cookie) en ondersteunt niet een vrije `/cijfers`-prefix. Alleen bestanden naar SiteGround uploaden maakt deze URL daarom niet live.

Mogelijke routes, pas kiezen na inspectie van de hosting/DNS:

1. **Als www al via SiteGround/proxy loopt:** `/cijfers/*` direct aan deze PHP-app koppelen; overige routes/webshop behouden.
2. **www apart op SiteGround:** uitsluitend www naar SiteGround laten wijzen. Laat `/cijfers/*` lokaal verwerken en alle overige www-paden met 302/301 naar `https://lumeworks.nl` + hetzelfde pad/query verwijzen. Shopify op de apex laten staan; de bestaande winkel/DNS nooit blind verplaatsen. Ook www/certificaat en Shopify-domeininstellingen controleren.
3. **Als www volledig Shopify moet blijven:** een gerichte edge reverse-proxy nodig. `/cijfers/*` naar een private SiteGround-origin, andere paden blijven Shopify. Origin-cookies/Host/HTTPS moeten correct worden behandeld. Maak eerst een testopstelling; geen app-proxy als cookie-authoplossing. `cijfers.lumeworks.nl` is een technisch eenvoudiger alternatief, alleen na akkoord op de gewijzigde URL.

De prefix is configureerbaar, maar dit pakket gebruikt `/cijfers`. Production origin is exact `https://www.lumeworks.nl` en weigert afwijkende Host/HTTP. Zet stagingorigin in private config voor een stagingtest; gebruik nooit test-HTTP in productie.

## Dataverversing zonder openbaar lek

Het pakket bevat een startkopie van de bestaande gegevens met hun bronmeetmomenten. Ververs vóór livegang alle datasets en controleer de datastatus.

De nieuwe machine-API `/cijfers/api/storage/<dataset-pad>` ondersteunt GET/PUT met HMAC-SHA256, tijdstempel, unieke nonce, maximaal 5 minuten klokafwijking, replaycontrole, dataset-allowlist en compare-and-swap (`sha`). API-sleutel uitsluitend uit private config, als secret in Cloudflare/GitHub/produceromgeving bewaren. Nooit in browser, URL, repository of workflowlogs.

`cloudflare-worker/src/private-storage.js` is de voorbereide Worker-adapter. Stel `LW_STORAGE_ORIGIN=https://www.lumeworks.nl/cijfers` en secret `LW_STORAGE_SECRET` in om gegevens rechtstreeks privé op SiteGround op te slaan. Zonder beide instellingen blijft de bestaande GitHub-route actief; met onvolledige instellingen stopt de sync. In private modus worden beide oude MCP-routes afgesloten zodat de openbare Meta-MCP geen omweg naar de cijfers is. Interne MCP herstellen kan later via geauthenticeerde private opslag.

`siteground/scripts/upload_data.py` uploadt dezelfde zeven lokale datasets met revisiecontrole. Leg eerst de private revisies vast met `--capture --pull` (downloadt de actuele private kopie), run daarna Shopify-, retouren- of creators-sync en upload met `--expected-revisions`. Bij een concurrente update stopt de upload; opnieuw lezen/mergen vóór herhalen. Dit vervangt openbare data-commits. Creators/retouren/kosten moeten blijven herijken volgens de bestaande financiële berekeningen; er worden geen nieuwe bedragen of bronmetingen verzonnen.

### Verplichte omschakeling van de bestaande producenten

1. Maak een actuele back-up van data en bronconfigs. Installeer de private app op staging en test.
2. Zet de Worker-adapter in de bestaande Worker. Stel beide opslagsecrets in en controleer Meta/Google/shopify-write+read op de private API.
3. Configureer de bestaande lokale retouren-/Shopify-sync en creators-workflow om `upload_data.py` te gebruiken en **geen data meer openbaar te committen**. Voorbeeldworkflow staat in `templates/private-data.yml`; lokale omschakeling in `templates/private-sync.sh`. Geen twee schrijvers tegelijk ongecontroleerd data laten overschrijven; CAS-conflicten vragen opnieuw lezen/mergen of opnieuw genereren.
4. Schakel GitHub Pages en openbare MCP-feed uit. Maak de bestaande repository privé of verhuis de volledige databron/history naar een private repository en verwijder de publieke datageschiedenis. Alleen de JSON van main verwijderen is onvoldoende: oude commits blijven anders leesbaar. Connector heeft geen GitHub-administrationrecht; privacy/Pages moet met eigenaarstoegang uitgevoerd worden. Eerdere downloads/caches kun je niet met terugwerkende kracht wissen.
5. Controleer oude Pages-links, raw GitHub-links, repository history en oude MCP. Zonder afsluiting is de nieuwe app wel afgeschermd, maar bestaan oude openbare kopieën nog.
6. De huidige creators-sync leest publiek toegankelijke Google Sheets-CSV-exports. Controleer ook de deelrechten van bron-Sheets en zet financiële bronbestanden op beperkte toegang, met behoud van legitieme medewerkers. De geauthenticeerde vervanging staat klaar: `siteground/scripts/sync_private_creators.py` gebruikt dezelfde bestaande parsing en validatie, maar leest met de read-only Sheets-API. Geef alleen de betreffende bron-Sheet leesrechten voor de serviceaccount; secret `LW_SHEETS_SERVICE_ACCOUNT` blijft buiten git. Installeer `siteground/requirements-producers.txt`. De private workflow gebruikt deze transportlaag en valt bij ontbrekende credentials nooit terug op openbare exports. Test deze serviceaccount vóór het uitschakelen van linkdeling. De dashboardlogin verandert Google-deelrechten niet.

## Installatie en verificatie morgenochtend

- SiteGround website-home, SFTP/SSH, PHP-versie, HTTPS, www/DNS en eventuele CDN controleren. Geen wachtwoorden in chatlogs/scripts opnieuw kopiëren.
- ZIP uitpakken, bovenstaande public/private-indeling uploaden, bestandsrechten instellen. SiteGround Dynamic Cache/CDN voor `/cijfers` en `/cijfers/*` uitsluiten; geen caching van cookies/JSON/login.
- Domeinroute in test controleren zonder checkout/productpagina's te wijzigen.
- Vier logins testen, verkeerd wachtwoord/CSRF/limiet testen, reload/onthouden/logout/alle apparaten/wachtwoord wijzigen testen.
- Onaangemelde HTML moet naar login; JSON/JS moeten 401; config/sqlite/private/traversal moet onbereikbaar; HTTP/onjuiste host weigeren.
- Alle gegevens verversen; status/timestamps vergelijken met bron. Meta, Google, Shopify, influencers, kosten en retourmodel controleren.
- Laptop en iPhone/Android 320/375/390/768 px testen: geen horizontale pagina-overflow, invulvelden >=16px, touchdoelen >=44px, tabellen scrollbaar.
- App installeren, offline testen (geen cijfers), uitloggen en terugknop testen (geen oude financiële pagina tonen).
- Pas na bovenstaande checks publieke data afsluiten en nieuwe link delen. Oude dashboardlink vervangen door kale redirect of verwijzing naar `/cijfers` zonder gegevens.
- Private SQLite dagelijkse back-up buiten public root met beperkte retentie; hosting backups beschermen. Externe monitor elke 5 minuten op login + met authenticatie bronstatus; alerts naar gekozen beheerder instellen zodra bestemming bekend is. Bewijs minimaal 7 dagen metingen alvorens een beschikbaarheidspercentage te noemen.

## Lokale bouw / tests

`python siteground/scripts/build.py --output /private/release-directory --php php`

Bouw schrijft alleen hashes in config en vier tijdelijke startwachtwoorden in een private sibling `release-directory-credentials.json`. Deel deze éénmalig met de eigenaar, verwijder daarna dat losse bestand. ZIP uitsluitend release-directory; nooit de credentials sibling. Maak een nieuwe buildmap per release; niet over bestaande live state.sqlite heen bouwen.

`LW_PHP_BIN=php python siteground/tests/security.py`

Tests draaien de daadwerkelijke PHP-controller met geïsoleerde SQLite/config. Test-only HTTP kan uitsluitend onder PHP's lokale devserver met loopback-client en `LW_TEST_HTTP=1`. De productionconfig bevat die instelling niet.
