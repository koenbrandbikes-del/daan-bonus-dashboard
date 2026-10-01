export function influencerInvestment(data, costs) {
  const gift=costs.influencer_gifting;
  if (gift === null) return 0;
  if (data?.startup_costs) return Number.isFinite(data.startup_costs.total) ? data.startup_costs.total : null;
  if (gift?.source === 'creators.startup_costs') return null;
  return gift && Number.isFinite(costs.items?.[gift.product]) ? gift.quantity*costs.items[gift.product] : 0;
}
import "../product-costs.js?v=stable-codes-1";
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
// Audited Shopify payment totals, applied on the original order date.
// Using paid minus refunded (rather than subtracting from incl) is idempotent.
export function reconciledOrder(order, costs) {
  const correction = costs.returns?.orders?.find(r => r.num === order.num);
  if (!correction) return order;
  return {...order, incl: correction.paid_incl-correction.refunded_incl,
    paid_incl: correction.paid_incl, refunded_incl: correction.refunded_incl,
    sales_reversal_report: correction.sales_reversal_report, refund_status: correction.refund_status,
    return_kind: correction.kind, store_credit: correction.store_credit,
    return_packages: correction.kind === 'received_return' ? (correction.received_packages ?? 1) : 0,
    return_cost: correction.kind === 'received_return' ? (costs.returns.cost_per_return ?? 20)*(correction.received_packages ?? 1) : 0};
}
// Explicit aliases preserve a single cost for renamed products. Unknown products
// must remain unknown rather than silently getting a zero or guessed cost.
export function itemCost(name, costs, ref) {
  return globalThis.LumeProductCosts.itemCost(name, costs.items, ref, costs.item_aliases);
}
export function finance(orders, costs) {
  orders = orders.map(o => reconciledOrder(o, costs));
  let fixed = 0,
    unknown = 0;
  const incl = sum(orders, "incl");
  for (const o of orders.filter(o => o.return_kind !== 'cancelled'))
    for (const [i, item] of o.items.entries()) {
      const unitCost = itemCost(item, costs, o.item_refs?.[i]);
      if (unitCost == null) unknown++;
      else fixed += unitCost;
    }
  const excl = incl / (1 + costs.assumed_vat),
    fees = sum(orders, o => o.paid_incl ?? o.incl) * costs.payment_rate;
  const returnCost = sum(orders, 'return_cost');
  return {
    incl,
    excl,
    fixed: unknown ? null : fixed,
    knownFixed: fixed,
    fees,
    cost: unknown ? null : fixed + fees + returnCost,
    returnCost,
    refundedIncl: sum(orders, 'refunded_incl'),
    refundedOrders: orders.filter(o => o.refunded_incl > 0).length,
    receivedReturnPackages: sum(orders,'return_packages'),
    receivedReturns: orders.filter(o => o.return_kind === 'received_return').length,
    unknownReturns: orders.filter(o => o.return_kind === 'unknown').length,
    overhead: excl * costs.overhead_rate,
    unknown,
    orders: orders.length,
  };
}
// Fixed fee follows calendar days. Signed daily bonus contributions share one
// break-even rate per contract block; the zero floor is applied only to the
// block total. A single closing adjustment makes daily costs reconcile to it.
export function managementCosts(data, costs, from, to) {
  const cfg=costs.meta_management;
  if(!cfg) return {fixed:0,bonus:0,total:0,periods:[],daily:[]};
  let fixed=0,bonus=0;
  const periods=new Map(), daily=new Map();
  for(let d=from;d<=to;d=shift(d,1)) {
    if(d<cfg.contract_start) continue;
    const date=new Date(d+'T12:00:00Z');
    const monthDays=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
    const dayFixed=cfg.monthly_fixed/monthDays;
    fixed+=dayFixed;
    const index=Math.floor((Date.parse(d)-Date.parse(cfg.contract_start))/864e5/cfg.bonus_period_days);
    const start=shift(cfg.contract_start,index*cfg.bonus_period_days);
    if(!periods.has(start)) periods.set(start,[]);
    periods.get(start).push(d);
    daily.set(d,{d,fixed:dayFixed,contribution:null,adjustment:null,bonus:null,total:null,periodFrom:start});
  }
  const audit=[];
  for(const [start,selected] of periods) {
    const end=shift(start,cfg.bonus_period_days-1);
    const until=data.meta?.snap && data.meta.snap<end ? data.meta.snap : end;
    const meta=data.meta?.daily_meta?.filter(r=>r.d>=start && r.d<=until).sort((a,b)=>a.d.localeCompare(b.d));
    // Retain the original contract margin basis, excluding manual refunds.
    const f=finance((data.shopify?.orders||[]).filter(o=>!o.test && o.d>=start && o.d<=until),{...costs,returns:null});
    const margin=f.excl-f.cost-f.overhead;
    // Missing days are not zero-spend days. July Shopify coverage is incomplete.
    const byDate=new Map(meta?.map(r=>[r.d,r]));
    let complete=!!meta && !!data.shopify && start>='2026-08-01' && until>=start && f.cost!=null && margin>0 && byDate.size===meta.length;
    for(let d=start;complete && d<=until;d=shift(d,1)) {
      const row=byDate.get(d);
      if(!row || !['spend','rev7','rev1v'].every(k=>Number.isFinite(row[k]))) complete=false;
    }
    if(!complete || selected.some(d=>d>until)) {
      bonus=null; audit.push({from:start,to:end,through:until,bonus:null,allocated:null,daily:[]}); continue;
    }
    const spend=sum(meta,'spend'), revenue=sum(meta,r=>r.rev7+r.rev1v);
    const be=f.incl/margin;
    const contributions=meta.map(r=>({d:r.d,contribution:(r.rev7+r.rev1v-r.spend*be)*cfg.bonus_rate}));
    const rawBonus=sum(contributions,'contribution');
    const periodBonus=Math.max(0,rawBonus);
    const closingAdjustment=periodBonus-rawBonus;
    const blockDaily=contributions.map(r=>({...r,adjustment:r.d===until?closingAdjustment:0,bonus:r.contribution+(r.d===until?closingAdjustment:0)}));
    const part=sum(blockDaily.filter(r=>selected.includes(r.d)),'bonus');
    if(bonus!=null) bonus+=part;
    for(const row of blockDaily) {
      const selectedDay=daily.get(row.d);
      if(selectedDay) Object.assign(selectedDay,row,{total:selectedDay.fixed+row.bonus});
    }
    audit.push({from:start,to:end,through:until,bonus:periodBonus,rawBonus,closingAdjustment,allocated:part,breakEvenRoas:be,spend,revenue,daily:blockDaily});
  }
  return {fixed,bonus,total:bonus==null?null:fixed+bonus,periods:audit,daily:[...daily.values()]};
}
export function compute(data, costs, from, to, channel = "all", options = {}) {
  const orders = (data.shopify?.orders || []).filter(
    (o) => !o.test && inRange(o, from, to),
  ).map(o => reconciledOrder(o, costs));
  const f = finance(orders, costs),
    byNum = new Map(
      (data.shopify?.orders || [])
        .filter((o) => !o.test)
        .map((o) => [o.num, reconciledOrder(o, costs)]),
    );
  const creatorSelection = (data.creators?.orders || []).filter(o => inRange(o, from, to));
  const creators = creatorSelection.filter(o => !o.retour || byNum.get(o.num)?.return_kind);
  const unverifiedCreatorReturn = creatorSelection.some(o => o.retour && !byNum.get(o.num)?.return_kind);
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
  const giftTotal=influencerInvestment(data.creators,costs);
  const allCreatorRevenue=sum((data.creators?.orders||[]).filter(o=>!o.retour || byNum.get(o.num)?.return_kind),o=>Math.max(0,byNum.get(o.num)?.incl ?? o.omzet_excl*(1+costs.assumed_vat)));
  const giftRate=giftTotal==null?null:allCreatorRevenue>0?giftTotal/allCreatorRevenue:0;
  channels.infl.commission=channels.infl.spend;
  channels.infl.giftRate=giftRate;
  channels.infl.giftTotal=giftTotal;
  channels.infl.giftAllocated=channels.infl.revenue!=null && giftRate!=null?Math.max(0,channels.infl.revenue)*giftRate:null;
  channels.infl.spend=channels.infl.commission!=null && channels.infl.giftAllocated!=null?channels.infl.commission+channels.infl.giftAllocated:null;
  const management=managementCosts(data,costs,from,to);
  channels.meta.mediaSpend=channels.meta.spend;
  channels.meta.spend=["meta","all"].includes(channel) && options.includeDaan === false ? channels.meta.mediaSpend : channels.meta.spend!=null && management.total!=null ? channels.meta.spend+management.total : null;
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
  const marginRate = options.marginRate !== undefined ? options.marginRate : data.shopify && f.incl>0 && f.cost!=null ? (f.excl-f.cost-f.overhead)/f.incl : null;
  const creatorOrders=creators.map(o=>byNum.get(o.num));
  const creatorFinance=!unverifiedCreatorReturn && data.creators && creatorOrders.every(Boolean) ? finance(creatorOrders,costs) : null;
  const result = channel === "infl" ? (creatorFinance && creatorFinance.cost!=null && spend!=null ? creatorFinance.excl-creatorFinance.cost-creatorFinance.overhead-spend : null) : channel !== "all" ? (marginRate!=null && revenue!=null && spend!=null ? revenue*marginRate-spend : null) :
      data.shopify && spend !== null && f.cost !== null ? f.excl-f.cost-spend-f.overhead : null;
  const netRevenue = channel === "all" ? revenue : revenue / (1 + costs.assumed_vat);
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
    marginRate,
    creatorFinance,
    result,
    profitMargin: result != null && netRevenue > 0 ? result / netRevenue * 100 : null,
    roas: spend > 0 && numerator !== null ? numerator / spend : null,
    count:
      channel === "all"
        ? data.shopify
          ? f.orders
          : null
        : channels[channel].orders,
    cpa: spend != null && (channel === "all" ? f.orders : channels[channel].orders) > 0 ? spend / (channel === "all" ? f.orders : channels[channel].orders) : null,
    channels,
    management,
    orderRows: orders,
    creatorRows: creators,
  };
}
export function series(data, costs, from, to, channel, gran = "day", options = {}) {
  if(channel !== "all") options = {...options, marginRate:compute(data,costs,from,to,channel,options).marginRate};
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
    ...compute(data, costs, b.from, b.to, channel, options),
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
