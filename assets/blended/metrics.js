export const sum = (a, k) =>
  a.reduce(
    (s, x) => s + (Number(typeof k === "function" ? k(x) : x[k]) || 0),
    0,
  );
export const shift = (s, n) => {
  const d = new Date(s + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const inRange = (x, f, t) => x.d >= f && x.d <= t;
export function finance(orders, costs) {
  let fixed = 0,
    unknown = 0;
  const incl = sum(orders, "incl");
  for (const o of orders)
    for (const item of o.items) {
      if (costs.items[item] == null) unknown++;
      else fixed += costs.items[item];
    }
  const excl = incl / (1 + costs.assumed_vat),
    fees = incl * costs.payment_rate;
  return {
    incl,
    excl,
    fixed: unknown ? null : fixed,
    knownFixed: fixed,
    fees,
    cost: unknown ? null : fixed + fees,
    overhead: excl * costs.overhead_rate,
    unknown,
    orders: orders.length,
  };
}
export function compute(data, costs, from, to, channel = "all") {
  const orders = (data.shopify?.orders || []).filter(
    (o) => !o.test && inRange(o, from, to),
  );
  const f = finance(orders, costs),
    byNum = new Map(
      (data.shopify?.orders || [])
        .filter((o) => !o.test)
        .map((o) => [o.num, o]),
    );
  const creators = (data.creators?.orders || []).filter(
    (o) => !o.retour && inRange(o, from, to),
  );
  const meta = (data.meta?.daily_meta || []).filter((o) =>
    inRange(o, from, to),
  );
  const google = (data.google?.daily_google || []).filter((o) =>
    inRange(o, from, to),
  );
  const channels = {
    meta: {
      spend: data.meta ? sum(meta, "spend") : null,
      revenue: data.meta
        ? sum(meta, (o) => (o.rev7 || 0) + (o.rev1v || 0))
        : null,
      orders: data.meta ? sum(meta, "purch") : null,
    },
    google: {
      spend: data.google ? sum(google, "spend") : null,
      revenue: data.google ? sum(google, "rev") : null,
      orders: data.google ? sum(google, "conv") : null,
    },
    infl: {
      spend: data.creators ? sum(creators, "commissie") : null,
      revenue: data.creators
        ? sum(
            creators,
            (o) =>
              byNum.get(o.num)?.incl ?? o.omzet_excl * (1 + costs.assumed_vat),
          )
        : null,
      orders: data.creators ? creators.length : null,
    },
  };
  const complete = Object.values(channels).every((c) => c.spend !== null);
  const spend =
    channel === "all"
      ? complete
        ? sum(Object.values(channels), "spend")
        : null
      : channels[channel].spend;
  const revenue =
    channel === "all"
      ? data.shopify
        ? f.excl
        : null
      : channels[channel].revenue;
  const numerator =
    channel === "all" ? (data.shopify ? f.incl : null) : revenue;
  return {
    ...f,
    ...(!data.shopify
      ? {
          incl: null,
          excl: null,
          fixed: null,
          fees: null,
          cost: null,
          overhead: null,
        }
      : {}),
    revenue,
    spend,
    result:
      channel === "all" && data.shopify && spend !== null && f.cost !== null
        ? f.excl - f.cost - spend - f.overhead
        : null,
    roas: spend > 0 && numerator !== null ? numerator / spend : null,
    count:
      channel === "all"
        ? data.shopify
          ? f.orders
          : null
        : channels[channel].orders,
    cpa: spend != null && (channel === "all" ? f.orders : channels[channel].orders) > 0 ? spend / (channel === "all" ? f.orders : channels[channel].orders) : null,
    channels,
    orderRows: orders,
    creatorRows: creators,
  };
}
export function series(data, costs, from, to, channel, gran = "day") {
  const buckets = new Map();
  for (let d = from; d <= to; d = shift(d, 1)) {
    let key = d;
    if (gran === "week")
      key = shift(d, -((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7));
    if (gran === "month") key = d.slice(0, 7) + "-01";
    if (!buckets.has(key)) buckets.set(key, { key, from: d, to: d });
    else buckets.get(key).to = d;
  }
  return [...buckets.values()].map((b) => ({
    ...b,
    ...compute(data, costs, b.from, b.to, channel),
  }));
}
export function aggregate(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k))
      m.set(k, { name: k, spend: 0, revenue: 0, orders: 0, rows: [] });
    const v = m.get(k);
    v.spend += r.spend || 0;
    v.revenue += r.revenue || 0;
    v.orders += r.orders || 0;
    v.rows.push(r);
  }
  return [...m.values()].map((x) => ({
    ...x,
    roas: x.spend > 0 ? x.revenue / x.spend : null,
  }));
}
export function previous(from, to) {
  const n = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  return { from: shift(from, -n), to: shift(from, -1) };
}

// Campaign purpose verified in Ads on 2026-09-30 and the SEA reporting.
// Stable IDs keep classification intact when a campaign is renamed.
export const googleCampaignGroups = {
  23981332205: "brand", // C | Corporate: LumeWorks search
  23989624267: "brand", // S | Branded: branded Shopping
  23981395562: "nonbrand", // T | Generiek | B2C
  23985056312: "nonbrand", // P | Generiek: PMAX
  23980131321: "nonbrand", // T | Generiek | B2B
  23981395565: "nonbrand", // T | Concurrentie
};
export function googleScopeData(data, scope = "all") {
  if (scope === "all" || !data.google) return data;
  const g = data.google;
  if (!Array.isArray(g.daily_campaigns)) return { ...data, google: null };
  const selected = g.daily_campaigns.filter(
    (r) => (googleCampaignGroups[r.id] || "unknown") === scope,
  );
  const grouped = new Map();
  for (const r of selected) {
    const v = grouped.get(r.d) || { d: r.d, spend: 0, rev: 0, conv: 0 };
    for (const k of ["spend", "rev", "conv"]) v[k] += Number(r[k]) || 0;
    grouped.set(r.d, v);
  }
  const daily = g.daily_google.map(
    (r) => grouped.get(r.d) || { d: r.d, spend: 0, rev: 0, conv: 0 },
  );
  return {
    ...data,
    google: {
      ...g,
      daily_google: daily,
      daily_campaigns: selected,
      daily_actions: [],
    },
  };
}

export function basketMetrics(orders) {
  const models = ["Prime", "Atlas", "Titan"];
  const beamers = models.map((m) => "LumeWorks " + m);
  const bundles = models.map((m) => "De complete " + m + " setup");
  const accessories = [
    "Projectiescherm 100 inch",
    "Pro stand",
    "LumeWorks USB-C naar HDMI-kabel",
    "Mini stand",
    "Prime travelcase",
    "Schoonmaak kit",
    "Atlas afstandsbediening",
    "Titan afstandsbediening",
  ];
  const clean = orders.filter((o) => !o.test);
  const hasAccessory = (o) => o.items.some((i) => accessories.includes(i));
  const bundleOrders = clean.filter((o) =>
    o.items.some((i) => bundles.includes(i)),
  );
  // Exclude complete packages from the standalone-projector comparison.
  const base = clean.filter(
    (o) =>
      o.items.some((i) => beamers.includes(i)) && !bundleOrders.includes(o),
  );
  const withExtra = base.filter(hasAccessory),
    withoutExtra = base.filter((o) => !hasAccessory(o));
  const avg = (rows) => (rows.length ? sum(rows, "incl") / rows.length : null);
  const byModel = beamers
    .map((name) => {
      const rows = base.filter((o) => o.items.includes(name));
      const extra = rows.filter(hasAccessory);
      return {
        name,
        orders: rows.length,
        withExtra: extra.length,
        rate: rows.length ? extra.length / rows.length : null,
      };
    })
    .filter((r) => r.orders)
    .sort((a, b) => b.orders - a.orders);
  return {
    base,
    withExtra,
    withoutExtra,
    bundleOrders,
    rate: base.length ? withExtra.length / base.length : null,
    avgWith: avg(withExtra),
    avgWithout: avg(withoutExtra),
    byModel,
    accessories,
  };
}
