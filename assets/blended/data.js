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
