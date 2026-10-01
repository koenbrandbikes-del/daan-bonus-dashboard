// Compact date-range calendar, matching the Meta dashboard.
export function createDatePicker({
  host,
  id,
  label,
  options,
  getRange,
  onPreset,
  onApply,
  today,
  min = "0001-01-01",
}) {
  const format = (d) =>
    new Date(d + "T12:00:00").toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
    });
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  host.className = "date-picker";
  host.innerHTML = `<span class="picker-label">${label}</span><button type="button" class="period-btn" id="${id}Button" aria-haspopup="dialog" aria-expanded="false" aria-controls="${id}Menu"></button><div class="period-menu" id="${id}Menu" role="dialog" aria-label="${label} kiezen" hidden><div class="pm-grp">${label === "Periode" ? "Actueel" : "Vergelijken"}</div><div class="picker-options"></div><div class="pm-div"></div><div class="pm-grp">Aangepaste periode</div><div class="cal-pad"><div class="cal-nav"><button type="button" class="cal-nb" aria-label="Vorige maand">‹</button><span class="cal-mlbl" aria-live="polite"></span><button type="button" class="cal-nb" aria-label="Volgende maand">›</button></div><div class="cal-grid"></div><p class="cal-hint" aria-live="polite"></p><button type="button" class="cal-apply">Toepassen</button></div></div>`;
  const trigger = host.querySelector(".period-btn"),
    panel = host.querySelector(".period-menu");
  let month,
    from,
    to,
    pickingEnd = false,
    chosenPreset, chosenRange;
  const close = (focus = false) => {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (focus) trigger.focus();
  };
  function paint() {
    host.querySelector(".cal-mlbl").textContent = month.toLocaleDateString(
      "nl-NL",
      { month: "long", year: "numeric" },
    );
    const grid = host.querySelector(".cal-grid");
    grid.innerHTML = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"]
      .map((d) => `<span class="cal-dow">${d}</span>`)
      .join("");
    for (let i = 0; i < (month.getDay() + 6) % 7; i++)
      grid.append(document.createElement("span"));
    const days = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0,
    ).getDate();
    for (let n = 1; n <= days; n++) {
      const date = iso(new Date(month.getFullYear(), month.getMonth(), n));
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = n;
      b.dataset.date = date;
      b.className =
        "cal-day" +
        (date === from || date === to
          ? " cd-edge"
          : from && to && date > from && date < to
            ? " cd-range"
            : "");
      b.disabled = date < min || date > today;
      b.setAttribute(
        "aria-label",
        new Date(date + "T12:00:00").toLocaleDateString("nl-NL", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      );
      b.setAttribute("aria-pressed", String(date === from || date === to));
      b.onclick = () => {
        if(date<min || date>today) return;
        if (!pickingEnd) {
          from = date;
          to = date;
          pickingEnd = true;
        } else {
          to = date;
          if (to < from) [from, to] = [to, from];
          pickingEnd = false;
        }
        paint();
        grid.querySelector(`[data-date="${date}"]`)?.focus();
      };
      grid.append(b);
    }
    host.querySelector(".cal-hint").textContent = pickingEnd
      ? `${format(from)} · kies een einddatum, of pas één dag toe`
      : `${format(from)} – ${format(to)} · klik een begindatum om te wijzigen`;
    host.querySelector(".cal-apply").disabled =
      from<min || to>today || from>to || new Date(to) - new Date(from) > 3 * 366 * 864e5;
    host.querySelectorAll(".cal-nb")[0].disabled = iso(new Date(month.getFullYear(),month.getMonth()+1,0)) <= min.slice(0,8)+"31";
    host.querySelectorAll(".cal-nb")[1].disabled =
      iso(new Date(month.getFullYear(), month.getMonth() + 1, 1)) > today;
  }
  const rangeKey = r => `${r.from}|${r.to}`;
  function activePreset(r) {
    return chosenRange === rangeKey(r) ? chosenPreset : r.preset;
  }
  function update() {
    const r = getRange(), preset = activePreset(r);
    const presetLabel = options.find(([key]) => key === preset)?.[1];
    const dates = r.from === r.to ? format(r.from) : `${format(r.from)} – ${format(r.to)}`;
    const text = r.label || (preset === "today" || preset === "yesterday" ? `${presetLabel} · ${dates}` : dates);
    trigger.textContent = text;
    trigger.setAttribute("aria-label", `${label}: ${text}`);
    host.querySelector(".picker-label").textContent = label === "Periode" && presetLabel && !["today", "yesterday"].includes(preset)
      ? `${label} · ${presetLabel === "Laatste 7 afgesloten dagen" ? "Laatste 7 dagen" : presetLabel}` : label;
    host.querySelectorAll(".pm-opt").forEach(b => {
      b.setAttribute("aria-pressed", String(b.dataset.preset === preset));
      b.classList.toggle("is-selected", b.dataset.preset === preset);
    });
  }
  trigger.onclick = () => {
    const opening = panel.hidden;
    document.dispatchEvent(new CustomEvent("date-picker-close"));
    if (!opening) return;
    const r = getRange();
    from = r.from;
    to = r.to;
    pickingEnd = false;
    month = new Date(from + "T12:00:00");
    month.setDate(1);
    paint();
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    update();
    (host.querySelector(".pm-opt.is-selected") || host.querySelector(".pm-opt")).focus({preventScroll:true});
  };
  for (const [key, text] of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pm-opt";
    b.textContent = text;
    b.dataset.preset = key;
    b.onclick = () => {
      onPreset(key);
      chosenPreset = key;
      chosenRange = rangeKey(getRange());
      close(true);
      update();
    };
    host.querySelector(".picker-options").append(b);
  }
  host.querySelectorAll(".cal-nb").forEach(
    (b, i) =>
      (b.onclick = () => {
        if(b.disabled) return;
        month.setMonth(month.getMonth() + (i ? 1 : -1));
        paint();
      }),
  );
  host.querySelector(".cal-apply").onclick = () => {
    if(from<min || to>today || from>to) return;
    onApply(from, to);
    chosenPreset = null;
    chosenRange = rangeKey(getRange());
    close(true);
    update();
  };
  document.addEventListener("date-picker-close", () => close());
  document.addEventListener("pointerdown", (e) => {
    if (!host.contains(e.target)) close();
  });
  host.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    }
  });
  // Use the destination of the focus transition. During a native mouse click,
  // activeElement can temporarily be body before the new button receives focus.
  // Closing in that gap removes the button before its click event can fire.
  host.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !host.contains(event.relatedTarget)) close();
  });
  update();
  return { update };
}
