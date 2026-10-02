# SiteGround continuous delivery

One-time activation uses the downloadable Mac setup to authenticate GitHub,
install the restricted `command="php .../deploy-server.php",restrict` SSH key,
then set Actions secrets `LW_DEPLOY_KEY` and `LW_DEPLOY_KNOWN_HOSTS`.
The preexisting installation key is never sent to GitHub. Host verification
remains strict. The handler, releases, backups and all state are outside webroot.

`siteground-deploy.yml` publishes code changes on main after dashboard tests,
real PHP authentication tests (including atomic release layout), and deployment
tests. The builder's `--code-only` mode never generates/ships config, users,
database or sessions. It maps presentation references to `LW_CODE`; state uses
`LW_PRIVATE`. A release is staged, hashes and PHP syntax checked, then a pointer
is replaced atomically. Each request resolves that pointer once. The previous
release is retained. Anonymous HTTPS checks verify the deployed revision,
login assets and protected data before accepting the update. Failed health
verification invokes rollback tied to the failed revision.

`siteground-data.yml` bridges existing GitHub source-data updates to private
SQLite. It checks out latest main, refuses superseded source revisions, validates
seven JSON datasets, captures current private SHA revisions, then uses a
transaction with compare-and-swap checks. Database backups are private and
include account state; never upload those backups to GitHub. Upload logs contain
status only. This bridge does not remove existing public sources and does not
improve upstream source freshness. Private-only producers remain the next step.

Expected flow: ChatGPT repository update -> GitHub Actions -> tests -> restricted
SSH deployment -> HTTPS checks. Source jobs -> data workflow -> private SQLite.
Activation is not proven until the Mac setup's workflow runs finish successfully.
Neither the setup nor CI changes Shopify DNS, the shop or email routing.

The self-hosted deployment handler is deliberately installed by the setup only;
changes to its protocol require rerunning the one-time setup. Revoke the
restricted SSH key and GitHub secrets to retire the integration. Repository write
access is production code deployment authority; protect main appropriately.
