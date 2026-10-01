# LumeWorks overview

Run `npm ci && npm test` from the repository root. UI tests use jsdom and fixture periods from the existing anonymized reporting datasets. Financial tests cover weighted ratios, missing sources, cost quantities, returned creator orders and period boundaries.

The live page is `blended.html`, with frontend modules in `assets/blended/`. Google detail reports are refreshed by the existing Worker; creators are refreshed and published by the hourly `Sync creators` workflow. Existing Meta and Shopify synchronization routes are unchanged.

## Data limitations intentionally visible in the UI

- Shopify currently contains order totals and product names, not separate tax/refund/payment records or complete customer history. Ex-VAT revenue and payment fees are estimates.
- Product rates combine purchase, shipping and fulfillment; component splits and historical rate start dates are unavailable.
- Startup costs follow Extra kosten influencers (products, accessories and one shipment each). Shipment dates are unavailable; allocation follows lifetime revenue share. Other unregistered creator fees remain unknown.
- Google primary conversion actions GTM and TrackBee both contribute. No account settings were changed; action reporting exposes their values separately. New-customer reporting is not yet reliable.
- Google search-term grouping only classifies explicit LumeWorks variants. Other visible terms and unreported inventory remain separate; there is no inferred nonbrand acquisition or incrementality claim.
- Legacy Meta rows are ad-set-name aggregates, not individual ads or stable campaign IDs.

These gaps require source-data enrichment. Do not replace missing values with zero or silently label the provisional result as net profit.
