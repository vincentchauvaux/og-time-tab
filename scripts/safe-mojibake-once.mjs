import fs from "fs";

/** Une seule passe latin1->utf8 si marqueurs mojibake (ne pas boucler). */
export function fixMojibakeOnce(text) {
  if (!/[Ãâ€ÂðŸ]/.test(text)) return text;
  return Buffer.from(text, "latin1").toString("utf8");
}

export function asciiDoc(text) {
  return text
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2019/g, "'")
    .replace(/\u2018/g, "'")
    .replace(/\u00ab/g, '"')
    .replace(/\u00bb/g, '"')
    .replace(/\u2026/g, "...");
}

const file = process.argv[2];
if (!file) process.exit(1);
let s = fs.readFileSync(file, "utf8");
if (s.includes("\uFFFD")) {
  console.error(file, "contient U+FFFD, restauration manuelle requise");
  process.exit(2);
}
s = asciiDoc(fixMojibakeOnce(s));
fs.writeFileSync(file, s, "utf8");
console.log("ok", file);
