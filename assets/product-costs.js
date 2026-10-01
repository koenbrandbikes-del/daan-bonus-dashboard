// Shared by classic dashboards, ES modules and the Worker.
// Identifiers verified against https://lumeworks.nl/products.json on 2026-10-01.
// These Shopify SKUs are the product EANs. Store strings (preserve leading zeros).
(() => {
  const catalog = {
  "LumeWorks Prime": {
    "sku": [
      "8721008982625"
    ],
    "variant_id": [
      "57300256096582",
      "56657929077062"
    ]
  },
  "De complete Prime setup": {
    "sku": [
      "8721008982700"
    ],
    "variant_id": [
      "56926357029190"
    ]
  },
  "De complete Titan setup": {
    "sku": [
      "8721008982694"
    ],
    "variant_id": [
      "56926354276678"
    ]
  },
  "De complete Atlas setup": {
    "sku": [
      "8721008982687"
    ],
    "variant_id": [
      "56925729325382"
    ]
  },
  "Prime travelcase": {
    "sku": [
      "8721008982663"
    ],
    "variant_id": [
      "56827309195590"
    ]
  },
  "Atlas afstandsbediening": {
    "sku": [
      "8721008982588"
    ],
    "variant_id": [
      "56819328844102"
    ]
  },
  "Titan afstandsbediening": {
    "sku": [
      "8721008982571"
    ],
    "variant_id": [
      "56819294142790"
    ]
  },
  "Schoonmaak kit": {
    "sku": [
      "8721008982632"
    ],
    "variant_id": [
      "56819086524742"
    ]
  },
  "LumeWorks USB-C naar HDMI-kabel": {
    "sku": [
      "8721008982618"
    ],
    "variant_id": [
      "56819052413254"
    ]
  },
  "Mini stand": {
    "sku": [
      "8721008982595"
    ],
    "variant_id": [
      "56819048415558"
    ]
  },
  "Pro stand": {
    "sku": [
      "8721008982601"
    ],
    "variant_id": [
      "56819047498054"
    ]
  },
  "Projectiescherm 100 inch": {
    "sku": [
      "8721008982649"
    ],
    "variant_id": [
      "56819046285638"
    ]
  },
  "LumeWorks Titan": {
    "sku": [
      "8721008982557"
    ],
    "variant_id": [
      "56742735642950"
    ]
  },
  "LumeWorks Atlas": {
    "sku": [
      "8721008982564"
    ],
    "variant_id": [
      "56742732169542"
    ]
  }
};
  const aliases = {"LumeWorks Prime | Van gewone avond naar datenight.": "LumeWorks Prime"};
  const bySku = new Map(), byVariant = new Map();
  for (const [name, ids] of Object.entries(catalog)) {
    for (const sku of ids.sku) bySku.set(sku, name);
    for (const id of ids.variant_id) byVariant.set(id, name);
  }
  const code = value => value == null ? '' : String(value).trim();
  function productName(name, ref = {}, extraAliases = {}) {
    // Match any verified stable identifier. Conflicting known identifiers are
    // not safe to price. Unknown codes must not borrow a cost from a reused title.
    const candidates = [bySku.get(code(ref.barcode)), bySku.get(code(ref.sku)),
      byVariant.get(code(ref.variant_id).replace('gid://shopify/ProductVariant/', ''))].filter(Boolean);
    if (new Set(candidates).size > 1) return null;
    if (candidates.length) return candidates[0];
    if (['barcode','sku','variant_id'].some(k => code(ref[k]))) return null;
    return extraAliases[name] ?? aliases[name] ?? name;
  }
  function itemCost(name, items, ref, extraAliases) {
    const canonical = productName(name, ref, extraAliases);
    return canonical != null && Object.hasOwn(items, canonical) && Number.isFinite(items[canonical]) ? items[canonical] : null;
  }
  globalThis.LumeProductCosts = Object.freeze({productName, itemCost});
})();
