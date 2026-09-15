/**
 * gauge-flex-card
 * -----------------------------------------------------------------------------
 * Nachbau der Home-Assistant-Gauge-Karte mit dynamischen Grenzen und
 * dynamischen Farbabschnitten. Jeder Wert (min, max, segments[].from,
 * segments[].color, value) darf statt einer Zahl auch sein:
 *
 *   - eine Entity-ID          ->  "sensor.speicher_unten"
 *   - ein Jinja-Template      ->  "{{ states('sensor.x') | float + 5 }}"
 *   - ein JS-Ausdruck         ->  "${states['sensor.x'].state * 2}"
 *   - ein Objekt mit
 *       entity / attribute / value / template
 *       map     (Zustand -> Wert)
 *       factor  (Multiplikator)
 *       offset  (Summand, selbst wieder ein dynamischer Wert)
 *       round   (Nachkommastellen)
 *       default (Fallback bei nicht auflösbarem Wert)
 *
 * Lizenz: MIT
 */

const CARD_VERSION = "1.1.0";

console.info(
  `%c GAUGE-FLEX-CARD %c ${CARD_VERSION} `,
  "color:#fff;background:#03a9f4;font-weight:700;border-radius:3px 0 0 3px",
  "color:#03a9f4;background:#efefef;font-weight:700;border-radius:0 3px 3px 0"
);

/* --------------------------------------------------------------------------
 * Geometrie des Zeigers (SVG-Benutzereinheiten, viewBox 0 0 100 53)
 * ----------------------------------------------------------------------- */
const CX = 50;
const CY = 44;
const R = 34;
const STROKE = 12;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const escapeHtml = (v) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r3 = (v) => Math.round(v * 1000) / 1000;

const polar = (frac) => {
  const a = Math.PI * (1 - clamp(frac, 0, 1));
  return [r3(CX + R * Math.cos(a)), r3(CY - R * Math.sin(a))];
};

const arcPath = (f1, f2) => {
  const [x1, y1] = polar(f1);
  const [x2, y2] = polar(f2);
  return `M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`;
};

/* --------------------------------------------------------------------------
 * Hilfsfunktionen zur Wertauflösung
 * ----------------------------------------------------------------------- */
const ENTITY_RE = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const UNAVAILABLE = ["unavailable", "unknown", "none", ""];

const isJinja = (s) => s.includes("{{") || s.includes("{%");
const isJs = (s) => s.includes("${");

const toNumber = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

const collectTemplates = (obj, out) => {
  if (typeof obj === "string") {
    if (isJinja(obj)) out.add(obj);
  } else if (Array.isArray(obj)) {
    obj.forEach((o) => collectTemplates(o, out));
  } else if (obj && typeof obj === "object") {
    Object.values(obj).forEach((o) => collectTemplates(o, out));
  }
  return out;
};

/* --------------------------------------------------------------------------
 * Styles
 * ----------------------------------------------------------------------- */
const STYLE = `
  :host { display: block; }
  ha-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    box-sizing: border-box;
    padding: 12px 8px 8px;
    overflow: hidden;
  }
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    max-width: 200px;
    height: 100%;
    min-height: 0;
    cursor: pointer;
  }
  .container.no-action { cursor: default; }
  svg { display: block; width: 100%; overflow: visible; }
  /* schrumpft mit, wenn die Kachel niedriger ist als die Eigenhöhe (z. B. rows: 2) */
  svg.gauge { flex: 0 1 auto; min-height: 0; }
  svg.text { flex: 0 0 auto; max-height: 26px; margin-top: -2px; }
  .name { flex: 0 0 auto; }
  .dial {
    fill: none;
    stroke: var(--gauge-flex-dial-color, var(--divider-color, #e0e0e0));
    stroke-width: ${STROKE};
  }
  .segment { fill: none; stroke-width: ${STROKE}; }
  .value-arc {
    fill: none;
    stroke-width: ${STROKE};
    stroke: var(--info-color, var(--primary-color));
  }
  .needle {
    stroke: var(--gauge-flex-needle-color, var(--primary-text-color));
    stroke-width: 3.5;
    stroke-linecap: round;
  }
  .limit {
    fill: var(--secondary-text-color);
    font-size: 6px;
    font-family: var(--paper-font-body1_-_font-family, inherit);
  }
  .value-text {
    fill: var(--primary-text-color);
    font-size: 16px;
    font-weight: 500;
    font-family: var(--paper-font-body1_-_font-family, inherit);
  }
  .unit { font-size: 11px; }
  .name {
    width: 100%;
    margin-top: 2px;
    text-align: center;
    color: var(--secondary-text-color);
    font-size: var(--gauge-flex-name-font-size, 14px);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :host([unavailable]) .value-text { fill: var(--disabled-text-color, #9e9e9e); }
  :host([unavailable]) .needle { stroke: var(--disabled-text-color, #9e9e9e); }
  .warn {
    padding: 8px;
    color: var(--error-color, #db4437);
    font-size: 13px;
    text-align: center;
  }
`;

/* --------------------------------------------------------------------------
 * Karte
 * ----------------------------------------------------------------------- */
class GaugeFlexCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("gauge-flex-card-editor");
  }

  static getStubConfig(hass, entities, entitiesFallback) {
    const pick =
      (entities || []).find((e) => e.startsWith("sensor.")) ||
      (entitiesFallback || [])[0] ||
      "";
    return {
      type: "custom:gauge-flex-card",
      entity: pick,
      min: 0,
      max: 100,
      needle: true,
      segments: [
        { from: 0, color: "var(--info-color)" },
        { from: 50, color: "var(--warning-color)" },
        { from: 80, color: "var(--error-color)" },
      ],
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tplResults = {};
    this._unsubs = [];
    this._fnCache = new Map();
    this._sig = null;
  }

  /* ---------------- Konfiguration ---------------- */

  setConfig(config) {
    if (!config) throw new Error("Keine Konfiguration angegeben");
    if (!config.entity && config.value === undefined) {
      throw new Error("Bitte 'entity' (oder 'value') angeben");
    }
    if (config.entity && !ENTITY_RE.test(config.entity)) {
      throw new Error(`Ungültige Entity-ID: ${config.entity}`);
    }
    if (config.segments && !Array.isArray(config.segments)) {
      throw new Error("'segments' muss eine Liste sein");
    }

    this._config = {
      needle: false,
      show_limits: false,
      ...config,
    };

    this._sig = null;
    this._tplResults = {};
    this._templates = [...collectTemplates(this._config, new Set())];
    this._resubscribe();
    this._build();
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._subscribe();
    this._render();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    if (this._hass && !this._subscribed) this._subscribe();
  }

  disconnectedCallback() {
    this._unsubscribe();
  }

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    return { columns: 6, rows: 2, min_columns: 3, min_rows: 2 };
  }

  // Ältere HA-Versionen (< 2024.11)
  getLayoutOptions() {
    return { grid_columns: 2, grid_rows: 2, grid_min_columns: 1, grid_min_rows: 2 };
  }

  /* ---------------- Jinja-Templates über Websocket ---------------- */

  _resubscribe() {
    this._unsubscribe();
    if (this._hass) this._subscribe();
  }

  async _subscribe() {
    if (!this._hass || !this._templates || !this._templates.length) return;
    if (this._subscribed) return;
    this._subscribed = true;
    const token = (this._token = {});

    for (const tpl of this._templates) {
      try {
        const unsub = await this._hass.connection.subscribeMessage(
          (msg) => {
            if (this._token !== token) return;
            this._tplResults[tpl] = msg.result;
            this._sig = null;
            this._render();
          },
          { type: "render_template", template: tpl }
        );
        if (this._token !== token) {
          unsub();
          return;
        }
        this._unsubs.push(unsub);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("gauge-flex-card: Template konnte nicht abonniert werden:", tpl, err);
      }
    }
  }

  _unsubscribe() {
    this._token = {};
    this._subscribed = false;
    const subs = this._unsubs;
    this._unsubs = [];
    subs.forEach((u) => {
      try {
        Promise.resolve(u).then((fn) => (typeof fn === "function" ? fn() : null));
      } catch (e) {
        /* ignorieren */
      }
    });
  }

  /* ---------------- Wertauflösung ---------------- */

  _evalJs(str) {
    let fn = this._fnCache.get(str);
    if (!fn) {
      try {
        fn = new Function(
          "states",
          "hass",
          "user",
          "entity",
          "value",
          "return `" + str.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`;"
        );
      } catch (e) {
        fn = () => undefined;
      }
      this._fnCache.set(str, fn);
    }
    try {
      return fn(
        this._hass.states,
        this._hass,
        this._hass.user,
        this._entityState,
        this._rawValue
      );
    } catch (e) {
      return undefined;
    }
  }

  _resolveString(str) {
    if (isJs(str)) return this._evalJs(str);
    if (isJinja(str)) return this._tplResults[str];
    if (ENTITY_RE.test(str) && this._hass.states[str]) {
      return this._hass.states[str].state;
    }
    return str;
  }

  /** Löst einen beliebigen Wert-Ausdruck auf und gibt ihn roh zurück. */
  _resolveRaw(spec, depth = 0) {
    if (spec === null || spec === undefined || depth > 10) return undefined;
    if (typeof spec === "number" || typeof spec === "boolean") return spec;
    if (typeof spec === "string") return this._resolveString(spec);
    if (Array.isArray(spec)) return spec.map((s) => this._resolveRaw(s, depth + 1));
    if (typeof spec !== "object") return undefined;

    let v;
    if (spec.entity !== undefined) {
      const st = this._hass.states[spec.entity];
      if (st) v = spec.attribute !== undefined ? st.attributes[spec.attribute] : st.state;
    } else if (spec.template !== undefined) {
      v = this._resolveRaw(spec.template, depth + 1);
    } else if (spec.value !== undefined) {
      v = this._resolveRaw(spec.value, depth + 1);
    }

    if (spec.map && typeof spec.map === "object") {
      const key = String(v);
      const hit = Object.prototype.hasOwnProperty.call(spec.map, key)
        ? spec.map[key]
        : spec.map.default;
      v = this._resolveRaw(hit, depth + 1);
    }

    if (v !== undefined && (spec.factor !== undefined || spec.offset !== undefined)) {
      const n = toNumber(v);
      if (n !== undefined) {
        let out = n;
        const f = toNumber(this._resolveRaw(spec.factor, depth + 1));
        if (f !== undefined) out *= f;
        const o = toNumber(this._resolveRaw(spec.offset, depth + 1));
        if (o !== undefined) out += o;
        v = out;
      }
    }

    if (spec.round !== undefined) {
      const n = toNumber(v);
      const d = toNumber(spec.round) || 0;
      if (n !== undefined) v = Math.round(n * 10 ** d) / 10 ** d;
    }

    if (v === undefined || v === null || (typeof v === "string" && UNAVAILABLE.includes(v.toLowerCase()))) {
      if (spec.default !== undefined) v = this._resolveRaw(spec.default, depth + 1);
    }
    return v;
  }

  _resolveNumber(spec, fallback) {
    const n = toNumber(this._resolveRaw(spec));
    return n === undefined ? fallback : n;
  }

  /* ---------------- DOM ---------------- */

  _build() {
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="container" id="container">
          <svg class="gauge" viewBox="0 0 100 53" preserveAspectRatio="xMidYMid meet">
            <path class="dial" id="dial" d="${arcPath(0, 1)}"></path>
            <g id="segments"></g>
            <path class="value-arc" id="valueArc"></path>
            <line class="needle" id="needle"
                  x1="${r3(CX - R - STROKE / 2 - 1.5)}" y1="${CY}"
                  x2="${r3(CX - R + STROKE / 2 + 1.5)}" y2="${CY}"></line>
            <text class="limit" id="minLabel" x="10" y="52" text-anchor="middle"></text>
            <text class="limit" id="maxLabel" x="90" y="52" text-anchor="middle"></text>
          </svg>
          <svg class="text" viewBox="0 0 100 20" preserveAspectRatio="xMidYMid meet">
            <text class="value-text" id="valueText" x="50" y="16" text-anchor="middle"></text>
          </svg>
          <div class="name" id="name"></div>
        </div>
      </ha-card>
    `;

    const $ = (id) => this.shadowRoot.getElementById(id);
    this._el = {
      card: this.shadowRoot.querySelector("ha-card"),
      container: $("container"),
      segments: $("segments"),
      valueArc: $("valueArc"),
      needle: $("needle"),
      minLabel: $("minLabel"),
      maxLabel: $("maxLabel"),
      valueText: $("valueText"),
      name: $("name"),
    };

    this._el.container.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._handleTap();
    });
  }

  _handleTap() {
    const action = this._config.tap_action || { action: "more-info" };
    switch (action.action) {
      case "none":
        break;
      case "navigate":
        if (action.navigation_path) {
          history.pushState(null, "", action.navigation_path);
          window.dispatchEvent(new Event("location-changed"));
        }
        break;
      case "url":
        if (action.url_path) window.open(action.url_path, action.new_tab === false ? "_self" : "_blank");
        break;
      case "toggle":
        this._hass.callService("homeassistant", "toggle", { entity_id: this._config.entity });
        break;
      case "more-info":
      default:
        this.dispatchEvent(
          new CustomEvent("hass-more-info", {
            detail: { entityId: action.entity || this._config.entity },
            bubbles: true,
            composed: true,
          })
        );
    }
  }

  /* ---------------- Rendern ---------------- */

  _formatNumber(n, precision) {
    const opts =
      precision === undefined
        ? { maximumFractionDigits: 2 }
        : { minimumFractionDigits: precision, maximumFractionDigits: precision };
    try {
      return new Intl.NumberFormat(this._hass.locale?.language || navigator.language, opts).format(n);
    } catch (e) {
      return precision === undefined ? String(n) : n.toFixed(precision);
    }
  }

  _render() {
    if (!this._hass || !this._config || !this._el) return;
    const cfg = this._config;

    this._entityState = cfg.entity ? this._hass.states[cfg.entity] : undefined;

    /* --- Messwert --- */
    let rawValue;
    if (cfg.value !== undefined) {
      this._rawValue = undefined;
      rawValue = this._resolveRaw(cfg.value);
    } else if (this._entityState) {
      rawValue =
        cfg.attribute !== undefined
          ? this._entityState.attributes[cfg.attribute]
          : this._entityState.state;
      this._rawValue = toNumber(rawValue);
    }
    const value = toNumber(rawValue);
    const unavailable =
      value === undefined ||
      (!this._entityState && cfg.value === undefined) ||
      (typeof rawValue === "string" && UNAVAILABLE.includes(rawValue.toLowerCase()));

    /* --- Grenzen --- */
    let min = this._resolveNumber(cfg.min, 0);
    let max = this._resolveNumber(cfg.max, 100);
    if (!(max > min)) max = min + 1;

    /* --- Segmente --- */
    const segments = (cfg.segments || [])
      .map((s) => {
        if (s === null || typeof s !== "object") return null;
        const from = toNumber(this._resolveRaw(s.from));
        if (from === undefined) return null;
        const to = toNumber(this._resolveRaw(s.to));
        const color = this._resolveRaw(s.color);
        return {
          from,
          to,
          color: typeof color === "string" && color ? color : "var(--info-color)",
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.from - b.from);

    const bands = [];
    segments.forEach((seg, i) => {
      const next = segments[i + 1];
      const end = seg.to !== undefined ? seg.to : next ? next.from : max;
      const s = clamp(seg.from, min, max);
      const e = clamp(end, min, max);
      if (e > s) bands.push({ from: s, to: e, color: seg.color });
    });

    const frac = unavailable ? 0 : clamp((value - min) / (max - min), 0, 1);

    /* aktive Segmentfarbe (für die Wertbogen-Darstellung ohne Nadel) */
    let activeColor = null;
    for (const seg of segments) {
      if (!unavailable && value >= seg.from) activeColor = seg.color;
    }

    /* --- Signatur: nur bei echten Änderungen das DOM anfassen --- */
    const unit =
      cfg.unit !== undefined
        ? this._resolveRaw(cfg.unit)
        : this._entityState?.attributes?.unit_of_measurement || "";
    const name =
      cfg.name !== undefined
        ? this._resolveRaw(cfg.name)
        : this._entityState?.attributes?.friendly_name || "";

    const sig = JSON.stringify([
      unavailable, value, min, max, frac, bands, activeColor, unit, name,
      cfg.needle, cfg.show_limits, cfg.precision, cfg.limits_precision,
    ]);
    if (sig === this._sig) return;
    this._sig = sig;

    /* --- Zeichnen --- */
    const el = this._el;
    this.toggleAttribute("unavailable", unavailable);

    el.segments.innerHTML = bands
      .map((b) => {
        const f1 = (b.from - min) / (max - min);
        const f2 = (b.to - min) / (max - min);
        return `<path class="segment" d="${arcPath(f1, f2)}" stroke="${String(b.color).replace(
          /"/g,
          "'"
        )}"></path>`;
      })
      .join("");

    if (cfg.needle) {
      el.valueArc.setAttribute("d", "");
      el.needle.style.display = "";
      el.needle.setAttribute("transform", `rotate(${r3(frac * 180)} ${CX} ${CY})`);
    } else {
      el.needle.style.display = "none";
      el.valueArc.setAttribute("d", unavailable || frac <= 0 ? "" : arcPath(0, frac));
      el.valueArc.setAttribute("stroke", activeColor || "var(--info-color, var(--primary-color))");
    }

    const showLimits = !!cfg.show_limits;
    const lp = cfg.limits_precision !== undefined ? cfg.limits_precision : 0;
    el.minLabel.textContent = showLimits ? this._formatNumber(min, lp) : "";
    el.maxLabel.textContent = showLimits ? this._formatNumber(max, lp) : "";

    const valueText = unavailable
      ? "—"
      : this._formatNumber(value, cfg.precision);
    el.valueText.innerHTML = `${escapeHtml(valueText)}${
      unavailable || !unit ? "" : `<tspan class="unit"> ${escapeHtml(unit)}</tspan>`
    }`;

    el.name.textContent = name || "";
    el.name.style.display = name ? "" : "none";
    el.container.classList.toggle(
      "no-action",
      (cfg.tap_action || {}).action === "none"
    );
  }
}

customElements.define("gauge-flex-card", GaugeFlexCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "gauge-flex-card",
  name: "Gauge Flex Card",
  description:
    "Gauge-Karte mit dynamischen Min/Max-Grenzen und dynamischen Farbabschnitten (Entities, Templates, Offsets).",
  preview: true,
  documentationURL: "https://github.com/",
});

/* ==========================================================================
 * Visueller Editor
 * ======================================================================= */

const MODE_OPTIONS = [
  { value: "number", label: "Fester Wert" },
  { value: "entity", label: "Entity" },
  { value: "template", label: "Template" },
  { value: "advanced", label: "YAML (erweitert)" },
];

const LABELS = {
  entity: "Entity",
  attribute: "Attribut",
  name: "Name",
  unit: "Einheit",
  precision: "Nachkommastellen",
  limits_precision: "Nachkommastellen der Grenzen",
  needle: "Nadel statt Balken",
  show_limits: "Grenzen anzeigen",
  tap_action: "Aktion beim Antippen",
  mode: "Typ",
  number: "Wert",
  offset: "Offset (+)",
  factor: "Faktor (×)",
  template: "Template",
  advanced: "YAML",
  color: "Farbe",
};

const SIMPLE_ENTITY_KEYS = ["entity", "attribute", "offset", "factor"];

const isSimpleEntitySpec = (o) =>
  typeof o.entity === "string" &&
  Object.keys(o).every((k) => SIMPLE_ENTITY_KEYS.includes(k)) &&
  (o.attribute === undefined || typeof o.attribute === "string") &&
  (o.offset === undefined || typeof o.offset === "number") &&
  (o.factor === undefined || typeof o.factor === "number");

/** Config-Wert -> Formulardaten des Editors */
const specToUi = (spec) => {
  if (spec === undefined || spec === null) return { mode: "number" };
  if (typeof spec === "number") return { mode: "number", number: spec };
  if (typeof spec === "string") {
    if (isJinja(spec) || isJs(spec)) return { mode: "template", template: spec };
    if (ENTITY_RE.test(spec)) return { mode: "entity", entity: spec };
    const n = toNumber(spec);
    if (n !== undefined && String(n) === spec.trim()) return { mode: "number", number: n };
    return { mode: "template", template: spec };
  }
  if (typeof spec === "object" && !Array.isArray(spec) && isSimpleEntitySpec(spec)) {
    return {
      mode: "entity",
      entity: spec.entity,
      attribute: spec.attribute,
      offset: spec.offset,
      factor: spec.factor,
    };
  }
  return { mode: "advanced", advanced: spec };
};

/** Formulardaten -> Config-Wert */
const uiToSpec = (ui) => {
  if (!ui) return undefined;
  switch (ui.mode) {
    case "entity": {
      if (!ui.entity) return undefined;
      const extra = {};
      if (ui.attribute) extra.attribute = ui.attribute;
      if (toNumber(ui.offset) !== undefined) extra.offset = toNumber(ui.offset);
      if (toNumber(ui.factor) !== undefined) extra.factor = toNumber(ui.factor);
      return Object.keys(extra).length ? { entity: ui.entity, ...extra } : ui.entity;
    }
    case "template":
      return ui.template ? ui.template : undefined;
    case "advanced":
      return ui.advanced === undefined || ui.advanced === null ? undefined : ui.advanced;
    case "number":
    default:
      return toNumber(ui.number);
  }
};

const valueSchema = (mode, numberLabelName) => {
  const modeField = {
    name: "mode",
    selector: { select: { mode: "dropdown", options: MODE_OPTIONS } },
  };
  switch (mode) {
    case "entity":
      return [
        { name: "", type: "grid", schema: [modeField, { name: "entity", selector: { entity: {} } }] },
        {
          name: "",
          type: "grid",
          schema: [
            { name: "attribute", selector: { text: {} } },
            { name: "offset", selector: { number: { mode: "box", step: "any" } } },
            { name: "factor", selector: { number: { mode: "box", step: "any" } } },
          ],
        },
      ];
    case "template":
      return [modeField, { name: "template", selector: { template: {} } }];
    case "advanced":
      return [modeField, { name: "advanced", selector: { object: {} } }];
    case "number":
    default:
      return [
        {
          name: "",
          type: "grid",
          schema: [
            modeField,
            { name: numberLabelName || "number", selector: { number: { mode: "box", step: "any" } } },
          ],
        },
      ];
  }
};

const EDITOR_STYLE = `
  :host { display: block; }
  .section { margin-top: 20px; }
  .section-title {
    font-weight: 500;
    font-size: 15px;
    color: var(--primary-text-color);
    margin-bottom: 4px;
  }
  .section-hint {
    font-size: 12px;
    color: var(--secondary-text-color);
    margin-bottom: 8px;
  }
  .value-row { margin-bottom: 12px; }
  .value-label {
    font-size: 13px;
    color: var(--secondary-text-color);
    margin-bottom: 2px;
  }
  .segment {
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 8px;
    padding: 8px 12px 12px;
    margin-bottom: 10px;
  }
  .seg-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .seg-title { flex: 1; font-size: 13px; color: var(--secondary-text-color); }
  .swatch {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid var(--divider-color, #e0e0e0);
    flex: 0 0 auto;
  }
  button.icon {
    border: none;
    background: none;
    cursor: pointer;
    color: var(--secondary-text-color);
    font-size: 16px;
    line-height: 1;
    padding: 4px 6px;
    border-radius: 50%;
  }
  button.icon:hover { background: var(--secondary-background-color, #f0f0f0); }
  button.add {
    border: 1px solid var(--primary-color);
    background: none;
    color: var(--primary-color);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  button.add:hover { background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.08); }
`;

class GaugeFlexCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._modes = {};
    this._segCount = -1;
  }

  setConfig(config) {
    this._config = { ...(config || {}) };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  get hass() {
    return this._hass;
  }

  /* ---- Hilfen ---- */

  _emit(config) {
    Object.keys(config).forEach((k) => {
      if (config[k] === undefined || config[k] === "") delete config[k];
    });
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })
    );
  }

  _form(host) {
    let form = host.querySelector("ha-form");
    if (!form) {
      form = document.createElement("ha-form");
      form.computeLabel = (schema) => LABELS[schema.name] || schema.name;
      host.appendChild(form);
    }
    form.hass = this._hass;
    return form;
  }

  /** Modus eines dynamischen Feldes: Benutzerwahl schlägt Ableitung aus der Config. */
  _modeFor(key, spec) {
    if (this._modes[key]) return this._modes[key];
    return specToUi(spec).mode;
  }

  _renderValueEditor(host, key, spec, onChange) {
    const mode = this._modeFor(key, spec);
    const ui = { ...specToUi(spec), mode };
    const form = this._form(host);
    form.schema = valueSchema(mode);
    form.data = ui;
    // Bei jedem Rendern aktualisieren, damit der einmalig gebundene Listener
    // nicht auf einem veralteten Modus bzw. Callback sitzt.
    form._mode = mode;
    form._onChange = onChange;
    if (!form._bound) {
      form._bound = true;
      form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const v = { ...ev.detail.value };
        this._modes[key] = v.mode;
        if (v.mode !== form._mode) {
          // Moduswechsel: nur neu zeichnen, bestehenden Wert nicht überschreiben
          this._render();
          return;
        }
        form._onChange(uiToSpec(v));
      });
    }
  }

  /* ---- Rendern ---- */

  _render() {
    if (!this._config) return;

    if (!this._built) {
      this.shadowRoot.innerHTML = `
        <style>${EDITOR_STYLE}</style>
        <div class="editor">
          <div id="main"></div>
          <div class="section">
            <div class="section-title">Skala</div>
            <div class="section-hint">
              Grenzen dürfen fest, an eine Entity gekoppelt oder per Template berechnet sein.
            </div>
            <div class="value-row"><div class="value-label">Untergrenze (min)</div><div id="min"></div></div>
            <div class="value-row"><div class="value-label">Obergrenze (max)</div><div id="max"></div></div>
          </div>
          <div class="section">
            <div class="section-title">Farbabschnitte</div>
            <div class="section-hint">
              Jeder Abschnitt reicht bis zum Beginn des nächsten bzw. bis zur Obergrenze.
            </div>
            <div id="segments"></div>
            <button class="add" id="addSeg">+ Abschnitt hinzufügen</button>
          </div>
          <div class="section">
            <div class="section-title">Verhalten</div>
            <div id="action"></div>
          </div>
        </div>
      `;
      this._built = true;
      this.shadowRoot.getElementById("addSeg").addEventListener("click", () => this._addSegment());
    }

    const $ = (id) => this.shadowRoot.getElementById(id);
    const cfg = this._config;

    /* Hauptfelder */
    const mainForm = this._form($("main"));
    mainForm.schema = [
      { name: "entity", required: true, selector: { entity: {} } },
      {
        name: "",
        type: "grid",
        schema: [
          { name: "name", selector: { text: {} } },
          { name: "unit", selector: { text: {} } },
          { name: "attribute", selector: { text: {} } },
          { name: "precision", selector: { number: { min: 0, max: 5, mode: "box" } } },
        ],
      },
      {
        name: "",
        type: "grid",
        schema: [
          { name: "needle", selector: { boolean: {} } },
          { name: "show_limits", selector: { boolean: {} } },
        ],
      },
    ];
    mainForm.data = {
      entity: cfg.entity,
      name: typeof cfg.name === "string" ? cfg.name : undefined,
      unit: typeof cfg.unit === "string" ? cfg.unit : undefined,
      attribute: cfg.attribute,
      precision: cfg.precision,
      needle: !!cfg.needle,
      show_limits: !!cfg.show_limits,
    };
    if (!mainForm._bound) {
      mainForm._bound = true;
      mainForm.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const v = ev.detail.value;
        const next = { ...this._config, entity: v.entity };
        ["name", "unit", "attribute"].forEach((k) => {
          if (v[k] === "" || v[k] === undefined || v[k] === null) delete next[k];
          else next[k] = v[k];
        });
        if (v.precision === undefined || v.precision === null || v.precision === "") delete next.precision;
        else next.precision = Number(v.precision);
        if (v.needle) next.needle = true;
        else delete next.needle;
        if (v.show_limits) next.show_limits = true;
        else delete next.show_limits;
        this._emit(next);
      });
    }

    /* Grenzen */
    this._renderValueEditor($("min"), "min", cfg.min, (spec) =>
      this._emit({ ...this._config, min: spec })
    );
    this._renderValueEditor($("max"), "max", cfg.max, (spec) =>
      this._emit({ ...this._config, max: spec })
    );

    /* Segmente */
    const segments = Array.isArray(cfg.segments) ? cfg.segments : [];
    const segHost = $("segments");
    if (this._segCount !== segments.length) {
      segHost.innerHTML = "";
      this._segCount = segments.length;
      segments.forEach((_, i) => {
        const row = document.createElement("div");
        row.className = "segment";
        row.innerHTML = `
          <div class="seg-head">
            <span class="swatch"></span>
            <span class="seg-title">Abschnitt ${i + 1}</span>
            <button class="icon" title="Abschnitt entfernen">✕</button>
          </div>
          <div class="seg-color"></div>
          <div class="value-label">Von</div>
          <div class="seg-from"></div>
        `;
        row.querySelector("button.icon").addEventListener("click", () => this._removeSegment(i));
        segHost.appendChild(row);
      });
    }

    [...segHost.children].forEach((row, i) => {
      const seg = segments[i] || {};
      row.querySelector(".swatch").style.background =
        typeof seg.color === "string" ? seg.color : "transparent";

      const colorForm = this._form(row.querySelector(".seg-color"));
      const colorIsPlain = seg.color === undefined || typeof seg.color === "string";
      colorForm.schema = [
        { name: "color", selector: colorIsPlain ? { text: {} } : { object: {} } },
      ];
      colorForm.data = { color: seg.color };
      if (!colorForm._bound) {
        colorForm._bound = true;
        colorForm.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          this._patchSegment(i, { color: ev.detail.value.color });
        });
      }

      this._renderValueEditor(row.querySelector(".seg-from"), `seg${i}`, seg.from, (spec) =>
        this._patchSegment(i, { from: spec })
      );
    });

    /* Aktion */
    const actionForm = this._form($("action"));
    actionForm.schema = [
      { name: "tap_action", selector: { ui_action: {} } },
      { name: "limits_precision", selector: { number: { min: 0, max: 3, mode: "box" } } },
    ];
    actionForm.data = {
      tap_action: cfg.tap_action,
      limits_precision: cfg.limits_precision,
    };
    if (!actionForm._bound) {
      actionForm._bound = true;
      actionForm.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const v = ev.detail.value;
        const next = { ...this._config };
        if (v.tap_action) next.tap_action = v.tap_action;
        else delete next.tap_action;
        if (v.limits_precision === undefined || v.limits_precision === null || v.limits_precision === "")
          delete next.limits_precision;
        else next.limits_precision = Number(v.limits_precision);
        this._emit(next);
      });
    }
  }

  _patchSegment(index, patch) {
    const segments = [...(this._config.segments || [])];
    segments[index] = { ...segments[index], ...patch };
    Object.keys(segments[index]).forEach((k) => {
      if (segments[index][k] === undefined) delete segments[index][k];
    });
    this._emit({ ...this._config, segments });
  }

  _addSegment() {
    const segments = [...(this._config.segments || [])];
    const last = segments[segments.length - 1];
    const lastFrom = last ? toNumber(last.from) : undefined;
    segments.push({
      from: lastFrom !== undefined ? lastFrom + 10 : toNumber(this._config.min) || 0,
      color: "#4caf50",
    });
    this._segCount = -1;
    this._emit({ ...this._config, segments });
  }

  _removeSegment(index) {
    const segments = [...(this._config.segments || [])];
    segments.splice(index, 1);
    delete this._modes[`seg${index}`];
    this._segCount = -1;
    const next = { ...this._config, segments };
    if (!segments.length) delete next.segments;
    this._emit(next);
  }
}

customElements.define("gauge-flex-card-editor", GaugeFlexCardEditor);
