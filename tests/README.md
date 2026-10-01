# LumeWorks overview

Run `npm ci && npm test` from the repository root. UI tests use jsdom and fixture periods from the existing anonymized reporting datasets. Financial tests cover weighted ratios, missing sources, cost quantities, returned creator orders and period boundaries.

The live page is `blended.html`, with frontend modules in `assets/blended/`. Google detail reports are refreshed by the existing Worker; creators are refreshed and published by the hourly `Sync creators` workflow. Existing Meta and order synchronization routes remain. The external daily runner also synchronizes refund history privately and publishes only validated aggregate actual corrections and return reserves in data/returns.json.

## Data limitations intentionally visible in the UI

- Shopify currently contains order totals and product names, not separate tax/refund/payment records or complete customer history. Ex-VAT revenue and payment fees are estimates.
- Product rates now split purchase, inbound shipping, fulfillment and explicit source adjustments from the current cost sheet. Historical effective dates and separate outbound shipping rates remain unavailable.
- Startup costs follow Extra kosten influencers (products, accessories and one shipment each). Shipment dates are unavailable; allocation follows lifetime revenue share. Other unregistered creator fees remain unknown.
- Google primary conversion actions GTM and TrackBee both contribute. No account settings were changed; action reporting exposes their values separately. New-customer reporting is not yet reliable.
- Google search-term grouping only classifies explicit LumeWorks variants. Other visible terms and unreported inventory remain separate; there is no inferred nonbrand acquisition or incrementality claim.
- Legacy Meta rows are ad-set-name aggregates, not individual ads or stable campaign IDs.

These gaps require source-data enrichment. Do not replace missing values with zero or silently label the provisional result as net profit.

Return reserves are provisional. The lag uses refund processing as an arrival proxy; physical scan dates and parcel counts are not universally available. Calibration uses mature cohorts, currently a 35-day horizon. Meta/Google receive allocated store risk rather than an invented channel-specific rate. The initial cohort has few returns. Actual corrections and expected remaining corrections never double-count; broken/stale registers retain their audit time and are marked. Public output excludes new order identifiers and individual refunds.
