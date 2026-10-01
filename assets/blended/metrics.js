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
  // Start the ad estimate before corrections, then deduct the allocated effect
  // once. Using the already corrected store margin would deduct refunds twice.
  const beforeCorrections = rows => finance(rows.map(o => ({...o,
    incl:o.paid_incl ?? o.incl, return_kind:undefined, return_cost:0,
    return_packages:0, refunded_incl:0})), {...costs,returns:null});
  const grossFinance = beforeCorrections(orders);
  const baselineRates=options.baselineRates ?? Object.fromEntries(['fixed','fees','overhead'].map(k=>[k,
    data.shopify && grossFinance.incl>0 && grossFinance[k]!=null ? grossFinance[k]/grossFinance.incl : null]));
  const creatorNums = new Set((data.creators?.orders || []).map(o => o.num));
  const remainingOrders = orders.filter(o => !creatorNums.has(o.num));
  const remainingFinance = finance(remainingOrders,costs);
  const remainingGross = beforeCorrections(remainingOrders);
  const nonbrandRows = data.google?.allocation_nonbrand_daily ??
    data.google?.daily_campaigns?.filter(r => googleCampaignGroups[r.id] === 'nonbrand');
  const nonbrandCount = nonbrandRows ? sum(nonbrandRows.filter(o => inRange(o,from,to)),'conv') : null;
  const denominator = remainingOrders.length;
  const hasCorrections = remainingFinance.refundedIncl>0 || remainingFinance.returnCost>0;
  const canAllocate = !!(data.shopify && (!hasCorrections || (data.creators && data.meta && data.google && nonbrandCount!=null)));
  const rawMeta = denominator > 0 ? channels.meta.orders/denominator : 0;
  const rawGoogle = denominator > 0 ? nonbrandCount/denominator : 0;
  const normalization = Math.max(1,rawMeta+rawGoogle);
  const weights = options.correctionWeights ?? (canAllocate ? {
    meta:rawMeta/normalization, google:rawGoogle/normalization,
    other:Math.max(0,1-(rawMeta+rawGoogle)/normalization),
  } : null);
  const pool = {
    refundedIncl:remainingFinance.refundedIncl,
    returnCost:remainingFinance.returnCost,
    cancelledCostCredit:remainingGross.fixed!=null && remainingFinance.fixed!=null ? remainingGross.fixed-remainingFinance.fixed : null,
    overheadCredit:remainingGross.overhead-remainingFinance.overhead,
    profitImpact:remainingGross.cost!=null && remainingFinance.cost!=null ?
      (remainingGross.excl-remainingGross.cost-remainingGross.overhead)-
      (remainingFinance.excl-remainingFinance.cost-remainingFinance.overhead) : null,
  };
  const allocations = Object.fromEntries(['meta','google','other'].map(k => [k,
    Object.fromEntries(Object.entries(pool).map(([name,value]) => [name,
      weights && value!=null ? value*weights[k] : null]))]));
  for(const k of ['meta','google']) {
    const applied = k==='google' && data.google?.allocation_scope==='brand' ?
      Object.fromEntries(Object.keys(pool).map(key=>[key,0])) : allocations[k];
    channels[k].grossRevenue=channels[k].revenue;
    channels[k].corrections=applied;
    channels[k].revenue=channels[k].grossRevenue!=null && applied.refundedIncl!=null ?
      channels[k].grossRevenue-applied.refundedIncl : null;
  }
  const directFinance=finance(orders.filter(o=>creatorNums.has(o.num)),costs);
  const directGross=beforeCorrections(orders.filter(o=>creatorNums.has(o.num)));
  const direct={refundedIncl:directFinance.refundedIncl,returnCost:directFinance.returnCost,
    profitImpact:directFinance.cost!=null && directGross.cost!=null ?
      (directGross.excl-directGross.cost-directGross.overhead)-
      (directFinance.excl-directFinance.cost-directFinance.overhead) : null};
  const correctionAllocation={pool,weights,allocations,direct,orders:denominator,
    totalOrders:orders.length,metaOrders:channels.meta.orders,googleNonbrandOrders:nonbrandCount,
    normalized:canAllocate && normalization>1,excludedInfluencerOrders:orders.length-denominator};
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
  const marginRate = options.marginRate !== undefined ? options.marginRate : data.shopify && grossFinance.incl>0 && grossFinance.cost!=null ? (grossFinance.excl-grossFinance.cost-grossFinance.overhead)/grossFinance.incl : null;
  const creatorOrders=creators.map(o=>byNum.get(o.num));
  const creatorFinance=!unverifiedCreatorReturn && data.creators && creatorOrders.every(Boolean) ? finance(creatorOrders,costs) : null;
  const result = channel === "infl" ? (creatorFinance && creatorFinance.cost!=null && spend!=null ? creatorFinance.excl-creatorFinance.cost-creatorFinance.overhead-spend : null) : channel !== "all" ? (marginRate!=null && channels[channel].grossRevenue!=null && channels[channel].corrections.profitImpact!=null && spend!=null ? channels[channel].grossRevenue*marginRate-channels[channel].corrections.profitImpact-spend : null) :
      data.shopify && spend !== null && f.cost !== null ? f.excl-f.cost-spend-f.overhead : null;
  const netRevenue = channel === "all" ? revenue : revenue==null?null:revenue / (1 + costs.assumed_vat);
  const negative=v=>v==null?null:-v;
  const line=(key,label,value,kind='line')=>({key,label,value,kind});
  const own=channel==='infl'?creatorFinance:channel==='all'?f:null;
  const grossOwn=channel==='infl' && creatorOrders.every(Boolean)?beforeCorrections(creatorOrders):grossFinance;
  const adChannel=['meta','google'].includes(channel)?channels[channel]:null;
  const correction=adChannel?.corrections;
  const grossRevenue=own?grossOwn.incl:adChannel?.grossRevenue;
  const ownNet=own?.incl ?? revenue;
  const netExcl=own?own.excl:netRevenue;
  const estimated=(key,credit=0)=>adChannel?.grossRevenue!=null && baselineRates[key]!=null && credit!=null ? adChannel.grossRevenue*baselineRates[key]-credit : null;
  const marginBuild=[
    line('gross','Omzet vóór correcties · incl. btw',grossRevenue),
    line('refunds',own?'Terugbetalingen & annuleringen':'Toegerekende omzetcorrecties',negative(own?own.refundedIncl:correction?.refundedIncl)),
    line('vat','Btw na omzetcorrecties',ownNet!=null && netExcl!=null ? -(ownNet-netExcl) : null),
    line('netRevenue','Netto omzet · excl. btw',netExcl,'subtotal'),
    line('products',own?'Product & levering':'Product & levering · raming',negative(own?own.fixed:estimated('fixed',correction?.cancelledCostCredit))),
    line('payments',own?'Betaalkosten':'Betaalkosten · raming',negative(own?own.fees:estimated('fees'))),
    line('returns',own?'Retourafhandeling':'Retourafhandeling · toegerekend',negative(own?own.returnCost:correction?.returnCost)),
  ];
  if(channel==='all')marginBuild.push(
    line('metaAds','Meta-advertenties',negative(channels.meta.mediaSpend)),
    line('googleAds','Google Ads · inclusief branded',negative(channels.google.spend)),
  );
  if(channel==='meta')marginBuild.push(line('metaAds','Meta-advertenties',negative(channels.meta.mediaSpend)));
  if(channel==='google')marginBuild.push(line('googleAds','Google Ads · geselecteerde campagnes',negative(spend)));
  if(['all','meta'].includes(channel))marginBuild.push(
    line('daanFixed','Daan · vaste vergoeding',options.includeDaan===false?0:negative(management.fixed)),
    line('daanBonus','Daan · bonus',options.includeDaan===false?0:negative(management.bonus)),
  );
  if(['all','infl'].includes(channel))marginBuild.push(
    line('commission','Influencercommissies',negative(channels.infl.commission)),
    line('startup','Opstartkosten · toegerekend',negative(channels.infl.giftAllocated)),
  );
  marginBuild.push(
    line('overhead','Overige bedrijfskosten · 4%',negative(own?own.overhead:estimated('overhead',correction?.overheadCredit))),
    line('result','Netto resultaat',result,'total'),
    line('margin','Netto marge',result!=null && netExcl>0?result/netExcl*100:null,'percent'),
  );
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
    correctionAllocation,
    baselineRates,
    marginBuild,
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
  if(channel !== "all") {
    const total=compute(data,costs,from,to,channel,options);
    options = {...options, marginRate:total.marginRate, baselineRates:total.baselineRates, correctionWeights:total.correctionAllocation.weights};
  }
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
      allocation_scope: scope,
      allocation_nonbrand_daily: g.allocation_nonbrand_daily ?? g.daily_campaigns.filter(r => googleCampaignGroups[r.id] === 'nonbrand'),
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
