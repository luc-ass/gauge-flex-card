import { JSDOM } from "jsdom";
import fs from "fs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
const w = dom.window;

// Stub für <ha-form> aus dem HA-Frontend
w.eval(`customElements.define("ha-form", class extends HTMLElement {});`);
w.eval(fs.readFileSync(new URL("../gauge-flex-card.js", import.meta.url), "utf8"));

const hass = {
  locale: { language: "de" },
  states: {
    "sensor.kollektor": { state: "62.4", attributes: { unit_of_measurement: "°C" } },
    "sensor.speicher_unten": { state: "48", attributes: {} },
    "binary_sensor.pumpe": { state: "on", attributes: {} },
  },
};

const userConfig = {
  type: "custom:gauge-flex-card",
  entity: "sensor.kollektor",
  name: "Kollektor",
  needle: true,
  min: "sensor.speicher_unten",
  max: { entity: "sensor.speicher_unten", offset: 17 },
  segments: [
    { from: 0, color: "lightgrey" },
    {
      from: {
        entity: "sensor.speicher_unten",
        offset: { entity: "binary_sensor.pumpe", map: { on: 5, off: 12 } },
      },
      color: "rgb(139, 195, 74)",
    },
  ],
};

let fails = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : "  -> " + extra}`);
  if (!cond) fails++;
};

const makeEditor = (config) => {
  const CardClass = w.customElements.get("gauge-flex-card");
  const ed = CardClass.getConfigElement();
  w.document.body.appendChild(ed);
  ed.setConfig(config);
  ed.hass = hass;
  const events = [];
  ed.addEventListener("config-changed", (e) => events.push(e.detail.config));
  return { ed, events };
};
const $ = (ed, sel) => ed.shadowRoot.querySelector(sel);
const forms = (ed) => [...ed.shadowRoot.querySelectorAll("ha-form")];
const fire = (form, value) =>
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value }, bubbles: true }));
const flat = (schema, out = []) => {
  schema.forEach((s) => (s.type === "grid" ? flat(s.schema, out) : out.push(s.name)));
  return out;
};

// ---- 1: Editor existiert und rendert ----
const { ed, events } = makeEditor(userConfig);
check("getConfigElement liefert Editor", ed.tagName.toLowerCase() === "gauge-flex-card-editor");
const mainForm = $(ed, "#main ha-form");
check("Hauptformular vorhanden", !!mainForm);
check(
  "Hauptformular kennt Entity/Name/Nadel",
  mainForm.data.entity === "sensor.kollektor" && mainForm.data.name === "Kollektor" && mainForm.data.needle === true,
  JSON.stringify(mainForm.data)
);
check("Labels auf Deutsch", mainForm.computeLabel({ name: "needle" }) === "Nadel statt Balken");

// ---- 2: min als Entity erkannt ----
const minForm = $(ed, "#min ha-form");
check("min-Modus = Entity", minForm.data.mode === "entity" && minForm.data.entity === "sensor.speicher_unten", JSON.stringify(minForm.data));

// ---- 3: max als Entity + Offset erkannt ----
const maxForm = $(ed, "#max ha-form");
check(
  "max-Modus = Entity mit Offset",
  maxForm.data.mode === "entity" && maxForm.data.offset === 17,
  JSON.stringify(maxForm.data)
);
check("Offset-Feld im Schema", flat(maxForm.schema).includes("offset"), JSON.stringify(flat(maxForm.schema)));

// ---- 4: Segmente ----
const segRows = [...ed.shadowRoot.querySelectorAll(".segment")];
check("2 Segmentzeilen gerendert", segRows.length === 2);
check("Farbvorschau gesetzt", segRows[0].querySelector(".swatch").style.background === "lightgrey", segRows[0].querySelector(".swatch").style.background);
const seg0From = segRows[0].querySelector(".seg-from ha-form");
check("Segment 1 'von' = fester Wert 0", seg0From.data.mode === "number" && seg0From.data.number === 0, JSON.stringify(seg0From.data));
const seg1From = segRows[1].querySelector(".seg-from ha-form");
check(
  "Verschachteltes Rechenobjekt -> YAML-Modus",
  seg1From.data.mode === "advanced" && seg1From.data.advanced.offset.map.on === 5,
  JSON.stringify(seg1From.data)
);
check(
  "YAML-Modus nutzt object-Selector",
  flat(seg1From.schema).includes("advanced") && seg1From.schema.some((s) => s.selector && s.selector.object),
  JSON.stringify(seg1From.schema)
);

// ---- 5: Änderung im Hauptformular wird emittiert ----
fire(mainForm, { ...mainForm.data, name: "Solar", show_limits: true });
let last = events[events.length - 1];
check("Name + show_limits emittiert", last.name === "Solar" && last.show_limits === true, JSON.stringify(last));
check("Komplexe Segmente bleiben unangetastet", JSON.stringify(last.segments) === JSON.stringify(userConfig.segments));
check("needle bleibt erhalten", last.needle === true);

// ---- 6: leerer Name wird entfernt statt als "" gespeichert ----
ed.setConfig(last);
fire($(ed, "#main ha-form"), { ...$(ed, "#main ha-form").data, name: "" });
last = events[events.length - 1];
check("Leerer Name entfernt Schlüssel", !("name" in last), JSON.stringify(last));

// ---- 7: Moduswechsel min: Entity -> fester Wert -> Eingabe ----
ed.setConfig(last);
let mf = $(ed, "#min ha-form");
fire(mf, { ...mf.data, mode: "number" });
mf = $(ed, "#min ha-form");
check("Schema nach Moduswechsel = Zahl", flat(mf.schema).includes("number") && !flat(mf.schema).includes("entity"), JSON.stringify(flat(mf.schema)));
check("Moduswechsel allein ändert Config nicht", events[events.length - 1] === last, "es wurde vorzeitig emittiert");
fire(mf, { mode: "number", number: 12 });
last = events[events.length - 1];
check("Fester Wert wird übernommen", last.min === 12, JSON.stringify(last));

// ---- 8: zurück auf Entity + Offset ----
ed.setConfig(last);
mf = $(ed, "#min ha-form");
fire(mf, { ...mf.data, mode: "entity" });
mf = $(ed, "#min ha-form");
fire(mf, { mode: "entity", entity: "sensor.speicher_unten", offset: -2 });
last = events[events.length - 1];
check(
  "Entity + Offset ergibt Rechenobjekt",
  JSON.stringify(last.min) === JSON.stringify({ entity: "sensor.speicher_unten", offset: -2 }),
  JSON.stringify(last.min)
);
// und ohne Offset wieder die kurze Schreibweise
ed.setConfig(last);
mf = $(ed, "#min ha-form");
fire(mf, { mode: "entity", entity: "sensor.speicher_unten", offset: null });
last = events[events.length - 1];
check("Ohne Offset wieder reine Entity-ID", last.min === "sensor.speicher_unten", JSON.stringify(last.min));

// ---- 9: Segment hinzufügen / entfernen ----
ed.setConfig(last);
ed.shadowRoot.getElementById("addSeg").click();
last = events[events.length - 1];
check("Segment hinzugefügt", last.segments.length === 3 && last.segments[2].color === "#4caf50", JSON.stringify(last.segments[2]));
ed.setConfig(last);
check("3 Zeilen gerendert", ed.shadowRoot.querySelectorAll(".segment").length === 3);
ed.shadowRoot.querySelectorAll(".segment")[2].querySelector("button.icon").click();
last = events[events.length - 1];
check("Segment entfernt", last.segments.length === 2, JSON.stringify(last.segments));

// ---- 10: Farbe ändern ----
ed.setConfig(last);
const colorForm = ed.shadowRoot.querySelectorAll(".segment")[0].querySelector(".seg-color ha-form");
fire(colorForm, { color: "#ff9800" });
last = events[events.length - 1];
check("Farbe geändert", last.segments[0].color === "#ff9800", JSON.stringify(last.segments[0]));

// ---- 11: Template-Modus ----
ed.setConfig({ entity: "sensor.kollektor", max: "{{ states('sensor.speicher_unten') | float + 17 }}" });
const maxForm2 = $(ed, "#max ha-form");
check(
  "Jinja -> Template-Modus mit template-Selector",
  maxForm2.data.mode === "template" && maxForm2.schema.some((s) => s.selector && s.selector.template),
  JSON.stringify(maxForm2.data)
);
ed.setConfig({ entity: "sensor.kollektor", max: "${parseFloat(states['sensor.x'].state)}" });
check("JS-Ausdruck -> Template-Modus", $(ed, "#max ha-form").data.mode === "template");

// ---- 12: Editor überlebt Config ohne Segmente ----
ed.setConfig({ entity: "sensor.kollektor" });
check("Keine Segmentzeilen ohne segments", ed.shadowRoot.querySelectorAll(".segment").length === 0);
check("tap_action-Formular vorhanden", !!$(ed, "#action ha-form"));

console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : "\nAlle Editor-Tests bestanden");
process.exit(fails ? 1 : 0);
