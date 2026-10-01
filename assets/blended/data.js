export function checkShopifyOrders(orders) {
  const seen = new Set();
  for (const o of orders) {
    if (!o.num || typeof o.num !== "string" || seen.has(o.num)) throw Error("Ontbrekend of dubbel ordernummer");
    seen.add(o.num);
    if (!Array.isArray(o.items) || !o.items.length || o.items.some(i => typeof i !== "string" || !i.trim())) throw Error("Onvolledige productregels");
    if (o.item_refs !== undefined && (!Array.isArray(o.item_refs) || o.item_refs.length !== o.items.length || o.item_refs.some(ref => !ref || typeof ref !== "object" || Array.isArray(ref) || Object.values(ref).some(v => typeof v !== "string")))) throw Error("Ongeldige productcodes");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.d) || !Number.isFinite(Date.parse(o.d)) || new Date(o.d).toISOString().slice(0,10) !== o.d) throw Error("Ongeldige orderdatum");
    if (!Number.isFinite(o.incl)) throw Error("Ongeldig orderbedrag");
  }
  const sales = orders.filter(o => !o.test);
  const latest = [...sales].sort((a,b) => b.d.localeCompare(a.d) || Number(b.num.replace(/\D/g,""))-Number(a.num.replace(/\D/g,"")))[0];
  return {checked_at:new Date().toISOString(),orders:orders.length,sales:sales.length,test_orders:orders.length-sales.length,latest_num:latest?.num,latest_date:latest?.d};
}
const cacheVersion = "lw-dashboard-v2";
export async function load() {
  const data = {},
    errors = {};
  await Promise.all(
    ["meta", "google", "shopify", "creators"].map(async (key) => {
      try {
        const r = await fetch(`data/${key}.json`, { cache: "no-cache" });
        if (!r.ok) throw Error("HTTP " + r.status);
        const d = await r.json();
        const rows =
          d[
            key === "meta"
              ? "daily_meta"
              : key === "google"
                ? "daily_google"
                : "orders"
          ];
        if (!Array.isArray(rows) || !rows.length)
          throw Error("Geen geldige gegevens");
        if (rows.some((x) => !/^\d{4}-\d{2}-\d{2}$/.test(x.d || "")))
          throw Error("Ongeldige datums");
        const numeric =
          key === "meta"
            ? ["spend", "rev7", "rev1v", "purch"]
            : key === "google"
              ? ["spend", "rev", "conv"]
              : key === "shopify"
                ? ["incl"]
                : ["omzet_excl", "commissie"];
        if (rows.some((x) => numeric.some((k) => !Number.isFinite(x[k]))))
          throw Error("Ongeldige bedragen");
        if (key === "shopify") data.shopify_check = checkShopifyOrders(rows);
        data[key] = d;
        try {
          sessionStorage.setItem(cacheVersion + key, JSON.stringify(d));
        } catch {}
      } catch (e) {
        errors[key] = e.message;
        try {
          const cached = JSON.parse(sessionStorage.getItem(cacheVersion + key));
          if (cached) data[key] = cached;
        } catch {}
      }
    }),
  );
  const r = await fetch("assets/blended/costs.json", { cache: "no-cache" });
  if (!r.ok) throw Error("Kostenregister niet beschikbaar");
  const costs = await r.json();
  return { data, errors, costs };
}
