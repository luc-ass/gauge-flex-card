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
    segments: [...r.querySelectorAll(".segment")].map((p) => ({ d: p.getAttribute("d"), stroke: p.getAttribute("stroke") })),
    needle: r.getElementById("needle").getAttribute("transform"),
    needleShown: r.getElementById("needle").style.display !== "none",
    valueArc: r.getElementById("valueArc").getAttribute("d"),
    arcStroke: r.getElementById("valueArc").getAttribute("stroke"),
    value: r.getElementById("valueText").textContent,
    name: r.getElementById("name").textContent,
    min: r.getElementById("minLabel").textContent,
    max: r.getElementById("maxLabel").textContent,
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
check("2 Segmente gezeichnet", d.segments.length === 2, JSON.stringify(d.segments));
check("Segmentfarben korrekt", d.segments[0].stroke === "lightgrey" && d.segments[1].stroke === "rgb(139, 195, 74)");
check("Nadel sichtbar", d.needleShown);
// Wert 62.4 -> frac (62.4-48)/17 = 0.8471 -> 152.47°
check("Nadelwinkel korrekt", d.needle === "rotate(152.471 50 44)", d.needle);
check("Grenzen beschriftet", d.min === "48" && d.max === "65", d.min + "/" + d.max);
check("Wert + Einheit", d.value === "62,4 °C", d.value);
check("Name", d.name === "Kollektor");

// ---- 2: Pumpe aus -> Segmentgrenze verschiebt sich auf 60 ----
hass.states["binary_sensor.pumpe"] = st("off");
c1.hass = { ...hass };
const segStartOff = dump(c1).segments[1].d;
hass.states["binary_sensor.pumpe"] = st("on");
c1.hass = { ...hass };
const segStartOn = dump(c1).segments[1].d;
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
check("JS-Template max wirkt (65)", d.value === "62,4 °C" && d.segments.length === 2, JSON.stringify(d));
check("Nadel ausgeblendet, Wertbogen gezeichnet", !d.needleShown && !!d.valueArc, JSON.stringify(d));
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
check("Jinja-Ergebnis angewandt", dump(c3).needle === "rotate(49.846 50 44)", dump(c3).needle);

// ---- 5: nicht verfügbar ----
hass.states["sensor.kollektor"] = st("unavailable", { unit_of_measurement: "°C", friendly_name: "Kollektor" });
c1.hass = { ...hass };
d = dump(c1);
check("Unavailable zeigt Platzhalter", d.value === "—" && d.needle === "rotate(0 50 44)", JSON.stringify(d));
check("unavailable-Attribut gesetzt", c1.hasAttribute("unavailable"));
hass.states["sensor.kollektor"] = st(62.4, { unit_of_measurement: "°C", friendly_name: "Kollektor" });
c1.hass = { ...hass };
check("Erholung nach unavailable", dump(c1).value === "62,4 °C");

// ---- 6: fehlende Entity / Fehlkonfiguration ----
try { make({ needle: true }); check("Fehler ohne entity", false); }
catch (e) { check("Fehler ohne entity", /entity/.test(e.message), e.message); }
try { make({ entity: "sensor.kollektor", segments: { from: 1 } }); check("Fehler bei falschem segments-Typ", false); }
catch (e) { check("Fehler bei falschem segments-Typ", /segments/.test(e.message), e.message); }

// ---- 7: more-info Event ----
let evt = null;
w.document.body.addEventListener("hass-more-info", (e) => (evt = e.detail));
c1.shadowRoot.getElementById("container").dispatchEvent(new w.MouseEvent("click", { bubbles: true, composed: true }));
check("Tap löst more-info aus", evt && evt.entityId === "sensor.kollektor", JSON.stringify(evt));

console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : "\nAlle Tests bestanden");
process.exit(fails ? 1 : 0);
