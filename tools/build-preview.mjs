/**
 * Baut preview.html aus tools/preview.template.html und der echten Kartenquelle.
 * So kann die Vorschau nicht gegenüber der Karte veralten.
 */
import fs from "fs";

const base = new URL("../", import.meta.url);
const card = fs.readFileSync(new URL("gauge-flex-card.js", base), "utf8");
const tpl = fs.readFileSync(new URL("tools/preview.template.html", base), "utf8");

if (card.includes("</script>")) {
  throw new Error("Kartenquelle enthält </script> und kann nicht eingebettet werden");
}
if (!tpl.includes("<!--__CARD_SOURCE__-->")) {
  throw new Error("Platzhalter <!--__CARD_SOURCE__--> fehlt im Template");
}

const out = tpl.replace("<!--__CARD_SOURCE__-->", card);
fs.writeFileSync(new URL("preview.html", base), out);
console.log(`preview.html geschrieben (${(out.length / 1024).toFixed(1)} kB)`);
