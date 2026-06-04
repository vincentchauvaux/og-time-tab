import fs from "fs";

function polish(name, s) {
  s = s.replace(/  -  /g, " - ");
  s = s.replace(/Rpartition/g, "Répartition");
  s = s.replace(/rpartition/g, "répartition");
  s = s.replace(/sélectionn([^é])/g, "sélectionné$1");
  s = s.replace(/}  O /g, "} · O ");
  s = s.replace(/}  A /g, "} · A ");
  s = s.replace(/}  -  /g, "} - ");
  s = s.replace(/O \$\{oShort\}  A/g, "O ${oShort} · A");
  s = s.replace(/open\)}  A/g, "open)} · A");
  s = s.replace(/Prserve/g, "Préserve");
  s = s.replace(/d"éviter/g, "d'éviter");
  s = s.replace(/l"axe/g, "l'axe");
  s = s.replace(/doit tre recr/g, "doit être recréé");
  s = s.replace(/Ssaut/g, "saut");

  if (name.endsWith(".html")) {
    s = s.replace(
      /id="prev-week"[^>]*>9<\/button>/g,
      'id="prev-week" aria-label="Semaine precedente">&lsaquo;</button>'
    );
    s = s.replace(
      /id="next-week"[^>]*>:<\/button>/g,
      'id="next-week" aria-label="Semaine suivante">&rsaquo;</button>'
    );
    s = s.replace(
      /stats-day-prev"[^>]*>9<\/button>/g,
      'stats-day-prev" class="stats-day-nav-btn" aria-label="Jour precedent">&lsaquo;</button>'
    );
    s = s.replace(
      /stats-day-next"[^>]*>:<\/button>/g,
      'stats-day-next" class="stats-day-nav-btn" aria-label="Jour suivant">&rsaquo;</button>'
    );
    s = s.replace(
      /<span class="live-dot" id="live-indicator">\s*Temps/g,
      '<span class="live-dot" id="live-indicator">&#9679; Temps'
    );
    s = s.replace(
      /class="modal-close"([^>]*)><\/button>/g,
      'class="modal-close"$1>&times;</button>'
    );
  }

  return s;
}

for (const name of ["dashboard.html", "dashboard.js", "dashboard.css", "manifest.json"]) {
  if (!fs.existsSync(name)) continue;
  const raw = fs.readFileSync(name, "utf8");
  const out = polish(name, raw);
  if (out !== raw) {
    fs.writeFileSync(name, out, "utf8");
    console.log("polished", name);
  }
}
