import fs from "fs";

const REPLACEMENTS = [
  ["  -  ", " - "],
  ["  ·  ", " → "],
  [" · ", " → "],
  ['l"onglet', "l'onglet"],
  ['l"extension', "l'extension"],
  ['l"icne', "l'icône"],
  ['l"heure', "l'heure"],
  ['l"affichage', "l'affichage"],
  ['l"chelle', "l'échelle"],
  ['s"intersectent', "s'intersectent"],
  ['d"empilement', "d'empilement"],
  ['n"ouvre', "n'ouvre"],
  ["Aujourd\"hui", "Aujourd'hui"],
  ["0pingler", "Épingler"],
  ["0chap", "Échap"],
  ["Rle", "Rôle"],
  ["Rsum", "Résumé"],
  ["Rglages", "Réglages"],
  ["Rpartition", "Répartition"],
  ["Rafra", "Rafraî"],
  ["Rafrachissement", "Rafraîchissement"],
  ["mtriques", "métriques"],
  ["inchang ", "inchangé "],
  ["inchang,", "inchangé,"],
  ["dcalage", "décalage"],
  ["detaill ", "détaillé "],
  ["detailles", "détaillées"],
  ["détailles", "détaillées"],
  ["consolid ", "consolidé "],
  ["consolidès", "consolidés"],
  ["### Modifi\n", "### Modifié\n"],
  ["### Ajout\n", "### Ajouté\n"],
  ["### Corrig\n", "### Corrigé\n"],
  ["trs ", "très "],
  ["agrgs", "agrégés"],
  ["Libell ", "Libellé "],
  ["Scurit", "Sécurité"],
  ["prfixes", "préfixées"],
  ["slecteur", "sélecteur"],
  ["rutilisation", "réutilisation"],
  ["sries", "séries"],
  ["dfaut", "défaut"],
  ["partag ", "partagé "],
  ["Libells", "Libellés"],
  ["tendue ", "étendue "],
  ["tendue  15", "étendue à 15"],
  ["entte ", "en-tête "],
  ["dernires", "dernières"],
  ["dclencher", "déclencher"],
  ["Fonctionnalit", "Fonctionnalité"],
  ["Symptme", "Symptôme"],
  ["(9 /", "(‹ /"],
  [" / :)", " / ›)"],
  ["(0 ", "(≥ "],
  ["12  30", "12 × 30"],
  ["v1.0.26)", "v1.0.27)"],
  ["(v1.0.26)", "(v1.0.27)"],
  ["v1.0.26)", "v1.0.27)"],
  ["Extension MV3 fonctionnelle (v1.0.26)", "Extension MV3 fonctionnelle (v1.0.27)"],
];

function fix(name) {
  let s = fs.readFileSync(name, "utf8");
  for (const [a, b] of REPLACEMENTS) s = s.split(a).join(b);
  fs.writeFileSync(name, s, "utf8");
  console.log("fixed", name);
}

fix("agent.md");
fix("CHANGELOG.md");
