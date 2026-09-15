import { JSDOM } from "jsdom";
import fs from "fs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
// Karte läuft im jsdom-Scope; Node-Globals nicht nötig


const src = fs.readFileSync(new URL("../gauge-flex-card.js", import.meta.url), "utf8");
w.eval(src);

const st = (state, attrs = {}) => ({ state: String(state), attributes: attrs });
const subs = [];
const hass = {
  locale: { language: "de" },
  user: { name: "Lucas" },
  states: {
    "sensor.kollektor": st(62.4, { unit_of_measurement: "°C", friendly_name: "Kollektor" }),
    "sensor.speicher_unten": st(48.0, { unit_of_measurement: "°C" }),
    "binary_sensor.pumpe": st("on"),
  },
  connection: {
    subscribeMessage: async (cb, msg) => { subs.push({ cb, msg }); return () => {}; },
  },
  callService: () => {},
};

const make = (config) => {
  const el = w.document.createElement("gauge-flex-card");
  w.document.body.appendChild(el);
  el.setConfig(config);
  el.hass = hass;
  return el;
};
const dump = (el) => {
  const r = el.shadowRoot;
  return {
    levels: [...r.querySelectorAll(".level")].map((p) => ({ d: p.getAttribute("d"), stroke: p.getAttribute("stroke") })),
    needle: r.getElementById("needle").style.transform,
    needleShown: r.getElementById("needle").style.display !== "none",
    arcShown: r.getElementById("valueArc").style.display !== "none",
    arcStroke: r.getElementById("valueArc").style.stroke,
    value: r.getElementById("valueText").textContent,
    name: r.getElementById("name").textContent,
    min: r.getElementById("minLabel").textContent,
    max: r.getElementById("maxLabel").textContent,
    warning: r.getElementById("warning").hidden ? "" : r.getElementById("warning").textContent,
    cardHidden: r.getElementById("card").hidden,
  };
};

let fails = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : "  -> " + extra}`);
  if (!cond) fails++;
};

// ---- 1: Anwendungsfall des Users (Pumpe an -> Segmentgrenze bei 53) ----
const cfgUser = {
  type: "custom:gauge-flex-card",
  entity: "sensor.kollektor",
  name: "Kollektor",
  needle: true,
  show_limits: true,
  min: "sensor.speicher_unten",
  max: { entity: "sensor.speicher_unten", offset: 17 },
  segments: [
    { from: 0, color: "lightgrey" },
    {
      from: { entity: "sensor.speicher_unten", offset: { entity: "binary_sensor.pumpe", map: { on: 5, off: 12 } } },
      color: "rgb(139, 195, 74)",
    },
  ],
};
const c1 = make(cfgUser);
let d = dump(c1);
console.log(JSON.stringify(d, null, 1));
// min=48, max=65, Segmentgrenze = 48+5 = 53 -> frac 5/17 = 0.294
// 2 Abschnitte + Kantenglättungskopie des letzten (wie im Original)
check("3 Bogenpfade gezeichnet", d.levels.length === 3, JSON.stringify(d.levels));
check("Segmentfarben korrekt", d.levels[0].stroke === "lightgrey" && d.levels[1].stroke === "rgb(139, 195, 74)");
check("Abschnitte laufen bis zum Bogenende (Original-Verfahren)", d.levels.every((l) => l.d.endsWith("A 40 40 0 0 1 40 0")), JSON.stringify(d.levels));
check("Erster Abschnitt startet links", d.levels[0].d.startsWith("M -40 0"), d.levels[0].d);
check("Nadel sichtbar", d.needleShown && !d.arcShown);
// Wert 62.4 -> (62.4-48)/17 = 0.8471 -> 152.471°
check("Nadelwinkel korrekt", d.needle === "rotate(152.471deg)", d.needle);
check("Grenzen beschriftet", d.min === "48" && d.max === "65", d.min + "/" + d.max);
check("Wert + Einheit", d.value === "62,4 °C", d.value);
check("Name", d.name === "Kollektor");

// ---- 2: Pumpe aus -> Segmentgrenze verschiebt sich auf 60 ----
hass.states["binary_sensor.pumpe"] = st("off");
c1.hass = { ...hass };
const segStartOff = dump(c1).levels[1].d;
hass.states["binary_sensor.pumpe"] = st("on");
c1.hass = { ...hass };
const segStartOn = dump(c1).levels[1].d;
check("Segmentgrenze reagiert auf Pumpenzustand", segStartOff !== segStartOn, segStartOff + " vs " + segStartOn);

// ---- 3: JS-Template + dynamische Farbe ----
const c2 = make({
  entity: "sensor.kollektor",
  needle: false,
  min: 0,
  max: "${parseFloat(states['sensor.speicher_unten'].state) + 17}",
  segments: [
    { from: 0, color: { entity: "binary_sensor.pumpe", map: { on: "green", off: "grey" } } },
    { from: "${parseFloat(states['sensor.speicher_unten'].state)}", color: "red" },
  ],
});
d = dump(c2);
check("JS-Template max wirkt", d.value === "62,4 °C", JSON.stringify(d));
// Ohne Nadel zeichnet auch das Original keine Farbbänder, sondern färbt den Wertbogen
check("Ohne Nadel keine Farbbänder", d.levels.length === 0, JSON.stringify(d.levels));
check("Wertbogen sichtbar, Nadel aus", d.arcShown && !d.needleShown, JSON.stringify(d));
check("Wertbogen nutzt aktive Segmentfarbe", d.arcStroke === "red", d.arcStroke);

// ---- 4: Jinja-Template ----
const c3 = make({
  entity: "sensor.kollektor",
  min: "{{ states('sensor.speicher_unten') | float }}",
  max: 100,
  needle: true,
});
check("Jinja-Template abonniert", subs.length === 1 && subs[0].msg.type === "render_template", JSON.stringify(subs.map(s=>s.msg)));
subs[0].cb({ result: 48 });
check("Jinja-Ergebnis angewandt", dump(c3).needle === "rotate(49.846deg)", dump(c3).needle);

// ---- 5: nicht verfügbar ----
hass.states["sensor.kollektor"] = st("unavailable", { unit_of_measurement: "°C", friendly_name: "Kollektor" });
c1.hass = { ...hass };
d = dump(c1);
check("Unavailable zeigt Warnung statt Zeiger (wie im Original)", d.cardHidden && /nicht verf/i.test(d.warning), JSON.stringify(d));
hass.states["sensor.kollektor"] = st(62.4, { unit_of_measurement: "°C", friendly_name: "Kollektor" });
c1.hass = { ...hass };
check("Erholung nach unavailable", dump(c1).value === "62,4 °C" && !dump(c1).cardHidden);

// ---- 6: fehlende Entity / Fehlkonfiguration ----
try { make({ needle: true }); check("Fehler ohne entity", false); }
catch (e) { check("Fehler ohne entity", /entity/.test(e.message), e.message); }
try { make({ entity: "sensor.kollektor", segments: { from: 1 } }); check("Fehler bei falschem segments-Typ", false); }
catch (e) { check("Fehler bei falschem segments-Typ", /segments/.test(e.message), e.message); }

// ---- 7: more-info Event ----
let evt = null;
w.document.body.addEventListener("hass-more-info", (e) => (evt = e.detail));
c1.shadowRoot.getElementById("card").dispatchEvent(new w.MouseEvent("click", { bubbles: true, composed: true }));
check("Tap löst more-info aus", evt && evt.entityId === "sensor.kollektor", JSON.stringify(evt));

// ---- 8: Kachelverhalten wie das Original ----
const css = c1.shadowRoot.querySelector("style").textContent;
check("Host nimmt die Kachelhöhe an", /:host\s*\{[^}]*height:\s*100%/.test(css), "height:100% fehlt auf :host");
check("ha-card füllt den Host", /ha-card\s*\{[^}]*height:\s*100%/.test(css));
const grid = c1.getGridOptions();
check("Standardhöhe ist auto wie beim Original", grid.rows === "auto", JSON.stringify(grid));
check("Mindestgröße gesetzt", grid.min_rows === 2 && grid.min_columns === 3, JSON.stringify(grid));

console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : "\nAlle Tests bestanden");
process.exit(fails ? 1 : 0);
