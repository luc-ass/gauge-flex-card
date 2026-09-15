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

const CARD_VERSION = "1.2.2";

console.info(
  `%c GAUGE-FLEX-CARD %c ${CARD_VERSION} `,
  "color:#fff;background:#03a9f4;font-weight:700;border-radius:3px 0 0 3px",
  "color:#03a9f4;background:#efefef;font-weight:700;border-radius:0 3px 3px 0"
);

/* --------------------------------------------------------------------------
 * Geometrie – identisch zu src/components/ha-gauge.ts im HA-Frontend:
 * viewBox "-50 -50 100 55", Bogenradius 40 um den Ursprung, Strichstärke 12,
 * Winkel 0° = links, 180° = rechts.
 * ----------------------------------------------------------------------- */
const ARC_R = 40;
const ARC_LENGTH = Math.PI * ARC_R;
const BASE_ARC = "M -40 0 A 40 40 0 0 1 40 0";
const GAUGE_MAX_WIDTH = 250;
const NEEDLE_PATH = "M -34,-3 L -40,-1 A 1,1,0,0,0,-40,1 L -34,3 A 2,2,0,0,0,-34,-3 Z";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const escapeHtml = (v) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r3 = (v) => Math.round(v * 1000) / 1000;

const getAngle = (value, min, max) => {
  const span = max - min;
  if (!(span > 0)) return 0;
  return clamp((value - min) / span, 0, 1) * 180;
};

const anglePoint = (angle) => {
  const rad = (angle * Math.PI) / 180;
  return [r3(-ARC_R * Math.cos(rad)), r3(-ARC_R * Math.sin(rad))];
};

/** Bogen vom übergebenen Winkel bis zum rechten Ende – wie im Original werden
 *  die Abschnitte aufsteigend übereinandergemalt, das vermeidet Nahtkanten. */
const levelArc = (angle) => {
  const [x, y] = anglePoint(angle);
  return `M ${x} ${y} A ${ARC_R} ${ARC_R} 0 0 1 ${ARC_R} 0`;
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
  :host {
    display: block;
    height: 100%;
  }
  /* Autoren-Regeln wie .warning { display: block } oder ha-card { display: flex }
     schlagen sonst die UA-Regel [hidden] { display: none }: das ausgeblendete
     Element bliebe im Fluss und schoebe die Karte nach unten. */
  [hidden] { display: none !important; }
  ha-card {
    height: 100%;
    overflow: hidden;
    padding: var(--ha-space-3, 12px);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    box-sizing: border-box;
  }
  ha-card.action { cursor: pointer; }
  ha-card:focus { outline: none; }
  .gauge-wrap {
    position: relative;
    display: block;
    width: 100%;
    max-width: ${GAUGE_MAX_WIDTH}px;
  }
  svg.gauge { display: block; width: 100%; }
  .levels-base {
    fill: none;
    stroke: var(--primary-background-color, #e8e8e8);
    stroke-width: 12;
    stroke-linecap: butt;
  }
  .level {
    fill: none;
    stroke-width: 12;
    stroke-linecap: butt;
  }
  .value {
    fill: none;
    stroke-width: 12;
    stroke: var(--gauge-flex-color, var(--info-color));
    stroke-linecap: butt;
    transition: stroke-dashoffset 1s ease 0s;
  }
  .needle {
    fill: var(--primary-text-color);
    stroke: var(--card-background-color);
    stroke-width: 1;
    stroke-linecap: round;
    transform-origin: 0 0;
    transition: all 1s ease 0s;
  }
  .limit {
    fill: var(--secondary-text-color);
    font-size: 7px;
    font-family: inherit;
  }
  .text {
    position: absolute;
    max-height: 40%;
    max-width: 55%;
    left: 50%;
    bottom: 10%;
    transform: translate(-50%, 0%);
  }
  .value-text {
    font-size: var(--ha-font-size-l, 18px);
    fill: var(--primary-text-color);
    direction: ltr;
  }
  .title {
    width: 100%;
    font-size: var(--ha-font-size-m, 14px);
    line-height: var(--ha-line-height-expanded, 1.6);
    margin: 0;
    text-align: center;
    box-sizing: border-box;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: none;
    color: var(--primary-text-color);
  }
  .warning {
    display: block;
    padding: 8px;
    margin: 0;
    color: var(--warning-color, #ffa600);
    font-size: 14px;
  }
  @media (prefers-reduced-motion: reduce) {
    .needle, .value { transition: none; }
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
    if (this._el) this._observeSize();
  }

  disconnectedCallback() {
    this._unsubscribe();
    if (this._ro) {
      this._ro.disconnect();
      this._ro = undefined;
    }
  }

  getCardSize() {
    return 4;
  }

  getGridOptions() {
    // "auto" wie bei der Original-Karte: die Höhe ergibt sich aus dem Inhalt,
    // eine feste Zeilenzahl in grid_options wird trotzdem ausgefüllt.
    return { rows: "auto", columns: 6, min_rows: 2, min_columns: 3 };
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
      <div class="warning" id="warning" hidden></div>
      <ha-card id="card">
        <div class="gauge-wrap" id="wrap">
          <svg viewBox="-50 -50 100 55" class="gauge" id="gauge">
            <path class="levels-base" d="${BASE_ARC}"></path>
            <g id="levels"></g>
            <path class="value" id="valueArc" d="${BASE_ARC}"
                  stroke-dasharray="${r3(ARC_LENGTH)}"
                  style="stroke-dashoffset: ${r3(ARC_LENGTH)}"></path>
            <path class="needle" id="needle" d="${NEEDLE_PATH}"></path>
            <text class="limit" id="minLabel" x="-33" y="-2" text-anchor="start"></text>
            <text class="limit" id="maxLabel" x="33" y="-2" text-anchor="end"></text>
          </svg>
          <svg class="text" id="textSvg">
            <text class="value-text" id="valueText" x="0" y="-5"
                  dominant-baseline="middle" text-anchor="middle"></text>
          </svg>
        </div>
        <p class="title" id="name"></p>
      </ha-card>
    `;

    const $ = (id) => this.shadowRoot.getElementById(id);
    this._el = {
      warning: $("warning"),
      card: $("card"),
      wrap: $("wrap"),
      levels: $("levels"),
      valueArc: $("valueArc"),
      needle: $("needle"),
      minLabel: $("minLabel"),
      maxLabel: $("maxLabel"),
      textSvg: $("textSvg"),
      valueText: $("valueText"),
      name: $("name"),
    };
    this._first = true;

    this._el.card.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._handleTap();
    });
    this._el.card.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        this._handleTap();
      }
    });
    this._observeSize();
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

  /* ---------------- Größenanpassung ---------------- */

  _observeSize() {
    if (this._ro || typeof ResizeObserver === "undefined") return;
    this._ro = new ResizeObserver(() => {
      this._fitGauge();
      this._rescaleText();
    });
    this._ro.observe(this);
  }

  /**
   * Das Original skaliert nur über die Breite und wird in niedrigen Kacheln
   * abgeschnitten. Hier begrenzt die verfügbare Höhe zusätzlich die Breite –
   * bei genug Platz ist das Ergebnis identisch zum Original.
   */
  _fitGauge() {
    const { card, wrap, name } = this._el || {};
    if (!card || !wrap || !this.clientHeight) return;
    const cs = getComputedStyle(card);
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    // Höhe der Kachel, nicht der Karte: sonst hinge die Messung am Ergebnis.
    const avail = this.clientHeight - pad - (name.offsetHeight || 0);
    const cap = Math.floor(avail / 0.55);
    wrap.style.maxWidth = cap >= GAUGE_MAX_WIDTH ? `${GAUGE_MAX_WIDTH}px` : `${Math.max(60, cap)}px`;
  }

  /** viewBox der Text-SVG auf die Textausdehnung setzen – wie _rescaleSvg im Original. */
  _rescaleText() {
    const t = this._el && this._el.valueText;
    const svg = this._el && this._el.textSvg;
    if (!t || !svg || !this.isConnected || typeof t.getBBox !== "function") return;
    let box;
    try {
      box = t.getBBox();
    } catch (e) {
      return;
    }
    if (!box || !box.width || !box.height) return;
    svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
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

  _localize(key, fallback, params) {
    try {
      const t = this._hass.localize(key, params);
      if (t) return t;
    } catch (e) {
      /* ignorieren */
    }
    return fallback;
  }

  _showWarning(text) {
    this._el.warning.textContent = text;
    this._el.warning.hidden = false;
    this._el.card.hidden = true;
    this._sig = "warn:" + text;
  }

  _render() {
    if (!this._hass || !this._config || !this._el) return;
    const cfg = this._config;
    const el = this._el;

    this._entityState = cfg.entity ? this._hass.states[cfg.entity] : undefined;

    /* --- Fehlerfälle wie im Original: Warnung statt Zeiger --- */
    if (cfg.value === undefined) {
      if (!this._entityState) {
        this._showWarning(
          this._localize("ui.panel.lovelace.warning.entity_not_found", `Entity nicht gefunden: ${cfg.entity}`, {
            entity: cfg.entity,
          })
        );
        return;
      }
      if (this._entityState.state === "unavailable") {
        this._showWarning(
          this._localize("ui.panel.lovelace.warning.entity_unavailable", `Entity nicht verfügbar: ${cfg.entity}`, {
            entity: cfg.entity,
          })
        );
        return;
      }
    }

    /* --- Messwert --- */
    let rawValue;
    if (cfg.value !== undefined) {
      this._rawValue = undefined;
      rawValue = this._resolveRaw(cfg.value);
    } else {
      rawValue =
        cfg.attribute !== undefined
          ? this._entityState.attributes[cfg.attribute]
          : this._entityState.state;
      this._rawValue = toNumber(rawValue);
    }
    const value = toNumber(rawValue);

    if (value === undefined) {
      this._showWarning(
        cfg.attribute !== undefined
          ? this._localize(
              "ui.panel.lovelace.warning.attribute_not_numeric",
              `Attribut ist nicht numerisch: ${cfg.attribute}`,
              { entity: cfg.entity, attribute: cfg.attribute }
            )
          : this._localize(
              "ui.panel.lovelace.warning.entity_non_numeric",
              `Entity ist nicht numerisch: ${cfg.entity}`,
              { entity: cfg.entity }
            )
      );
      return;
    }

    el.warning.hidden = true;
    el.card.hidden = false;

    /* --- Grenzen --- */
    let min = this._resolveNumber(cfg.min, 0);
    let max = this._resolveNumber(cfg.max, 100);
    if (!(max > min)) max = min + 1;

    /* --- Abschnitte --- */
    const segments = (cfg.segments || [])
      .map((s) => {
        if (s === null || typeof s !== "object") return null;
        const from = toNumber(this._resolveRaw(s.from));
        if (from === undefined) return null;
        const color = this._resolveRaw(s.color);
        const label = s.label === undefined ? undefined : this._resolveRaw(s.label);
        return {
          from,
          to: toNumber(this._resolveRaw(s.to)),
          color: typeof color === "string" && color ? color : "var(--info-color)",
          label: label === undefined || label === null ? undefined : String(label),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.from - b.from);

    /* Wie im Original: fehlt ein Abschnitt am Skalenanfang, wird er mit
       --info-color aufgefüllt. */
    const levels = segments.length ? [...segments] : [];
    if (levels.length && levels[0].from > min) {
      levels.unshift({ from: min, color: "var(--info-color)" });
    }

    const angle = getAngle(value, min, max);

    /* aktiver Abschnitt (Farbe des Wertbogens bzw. Beschriftung) */
    let active = null;
    for (const seg of levels) {
      if (value >= seg.from) active = seg;
    }
    const segmentLabel = cfg.needle && active && active.label ? active.label : "";

    /* --- Beschriftung --- */
    let valueText;
    let label = "";
    if (segmentLabel) {
      valueText = segmentLabel;
    } else if (cfg.unit !== undefined) {
      const unit = this._resolveRaw(cfg.unit);
      label = unit === undefined || unit === null ? "" : String(unit);
      valueText = this._formatNumber(value, cfg.precision);
    } else if (
      cfg.value === undefined &&
      cfg.attribute === undefined &&
      cfg.precision === undefined &&
      typeof this._hass.formatEntityState === "function"
    ) {
      // gleiche Formatierung wie das Original (Anzeigegenauigkeit + Einheit)
      try {
        valueText = this._hass.formatEntityState(this._entityState);
      } catch (e) {
        valueText = this._formatNumber(value, cfg.precision);
      }
    } else {
      label = (this._entityState && this._entityState.attributes.unit_of_measurement) || "";
      valueText = this._formatNumber(value, cfg.precision);
    }
    const fullText = label ? `${valueText} ${label}` : String(valueText);

    const name =
      cfg.name !== undefined
        ? String(this._resolveRaw(cfg.name) ?? "")
        : this._entityState
          ? this._entityState.attributes.friendly_name || ""
          : "";

    /* --- Signatur --- */
    const sig = JSON.stringify([
      value, min, max, angle, levels, active && active.color, fullText, name,
      !!cfg.needle, !!cfg.show_limits, cfg.limits_precision,
    ]);
    if (sig === this._sig) return;
    const first = this._first;
    this._sig = sig;
    this._first = false;

    /* --- Farbabschnitte: nur im Nadelmodus, aufsteigend übereinander --- */
    if (cfg.needle && levels.length) {
      const dial = "var(--primary-background-color, #e8e8e8)";
      let markup = "";
      levels.forEach((seg, i) => {
        const next = levels[i + 1];
        const start = clamp(seg.from, min, max);
        markup += `<path class="level" stroke="${escapeHtml(seg.color).replace(/"/g, "'")}" d="${levelArc(
          getAngle(start, min, max)
        )}"></path>`;
        const nextStart = next ? next.from : max;
        if (seg.to !== undefined && seg.to < nextStart) {
          markup += `<path class="level" stroke="${dial}" d="${levelArc(
            getAngle(clamp(seg.to, min, max), min, max)
          )}"></path>`;
        } else if (!next) {
          // Kantenglättung am rechten Ende – identisch zum Original
          markup += `<path class="level" stroke="${escapeHtml(seg.color).replace(
            /"/g,
            "'"
          )}" d="${levelArc(180 - 0.5)}"></path>`;
        }
      });
      el.levels.innerHTML = markup;
    } else {
      el.levels.innerHTML = "";
    }

    /* --- Nadel oder Wertbogen --- */
    if (cfg.needle) {
      el.needle.style.display = "";
      el.needle.style.transform = `rotate(${r3(angle)}deg)`;
      el.valueArc.style.display = "none";
    } else {
      el.needle.style.display = "none";
      el.valueArc.style.display = "";
      el.valueArc.style.stroke = active ? active.color : "var(--info-color)";
      const offset = r3(ARC_LENGTH * (1 - angle / 180));
      if (first) {
        el.valueArc.style.strokeDashoffset = String(r3(ARC_LENGTH));
        requestAnimationFrame(() => {
          if (el.valueArc) el.valueArc.style.strokeDashoffset = String(offset);
        });
      } else {
        el.valueArc.style.strokeDashoffset = String(offset);
      }
    }

    /* --- optionale Grenzenbeschriftung (Erweiterung, im Original nicht vorhanden) --- */
    const lp = cfg.limits_precision !== undefined ? cfg.limits_precision : 0;
    el.minLabel.textContent = cfg.show_limits ? this._formatNumber(min, lp) : "";
    el.maxLabel.textContent = cfg.show_limits ? this._formatNumber(max, lp) : "";

    /* --- Text und Name --- */
    el.valueText.textContent = fullText;
    el.name.textContent = name;
    el.name.title = name;
    el.name.style.display = name ? "" : "none";

    const hasAction = (cfg.tap_action || {}).action !== "none";
    el.card.classList.toggle("action", hasAction);
    if (hasAction) el.card.setAttribute("tabindex", "0");
    else el.card.removeAttribute("tabindex");

    this._rescaleText();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        this._fitGauge();
        this._rescaleText();
      });
    }
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
