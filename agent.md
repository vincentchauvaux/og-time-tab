# OG Time Tab - Extension Chrome

Suivi du temps par onglet : **temps ouvert** (onglet existant) et **temps actif** (activité humaine sur l'onglet au premier plan). Dashboard calendrier semaine type Clockify + onglet statistiques Chart.js, mise à jour temps réel.

## Installation

1. Ouvrir Chrome → `chrome://extensions`
2. Activer **Mode développeur**
3. **Charger l'extension non empaquetée** → sélectionner le dossier du projet (`og-time-tab`)
4. Épingler l'icône si besoin ; ouvrir le **popup** ou **Dashboard** depuis les liens

## Structure des fichiers

| Fichier | Rôle |
|---------|------|
| `manifest.json` | MV3, permissions, scripts |
| `background.js` | Service worker : onglets, tick, focus fenêtre, stockage, alarmes |
| `content.js` | Capture souris / clavier / scroll par page (onglet visible uniquement utile pour **A**) |
| `lib/config.js` | Paramètres par défaut et persistance |
| `lib/grouping.js` | Clé de regroupement URL (`getGroupKey`, `normalizeStatsGroupKey`, `formatGroupLabel`) |
| `lib/storage.js` | Entrées historiques + État live |
| `lib/format-duration.js` | Durées lisibles (compact + détaill pour tooltips) |
| `lib/chart-colors.js` | Couleur stable par `groupKey` + dédup stricte par vue (`assignColorsForItems`, palette 24 + repli HSL, v1.0.43) |
| `lib/chart.umd.min.js` | Chart.js (bundle local, CSP extension) |
| `icons/` | Logo horloge PNG (16 / 32 / 48 / 128) — barre d’outils Chrome + UI |
| `popup.html/js/css` | Résumé onglets + liens ; compteur groupes/onglets + schéma "sessions du jour" Chart.js (v1.0.60) |
| `options.html/js/css` | Réglages comportement humain |
| `dashboard.html/js/css` | Calendrier semaine, modal détail, graphiques |

## Format des durées (v1.0.6)

Module partagé `lib/format-duration.js` :

| Contexte | Fonction | Exemple (1736 s) |
|----------|----------|------------------|
| Affichage normal (blocs, popup, axes) | `formatDurationShort` | `29 min` |
| Survol (`title`, tooltip Chart.js) | `formatDurationFull` | `28 min 56 s` |

Seuils : secondes (&lt; 1 min), minutes (&lt; 1 h), heures (&lt; 24 h), jours (&lt; 30 j), mois (30 j), années (12 × 30 j). Libellés français : `s`, `min`, `h`, `j`, `mois`, `an`.

## Interface dashboard (v1.0.7, blocs v1.0.28)

### Onglet Calendrier

- Grille semaine (lun - dim), créneaux 30 min, hauteur de base **32 px** par slot (× zoom vertical), plage **00:00 - 24:00** (locale), scroll vertical unique (axe + colonnes).
- **Zoom vertical** (v1.0.32, plage étendue v1.0.33, scroll now v1.0.36, défaut présent v1.0.87) : slider dans `.calendar-toolbar` (à côté **Ouvert** / **Actif**) ; label « Zoom vertical » + valeur (ex. `400 %` sur semaine courante) ; plage **50 %–400 %** (`0,5×`–`4×`, pas `0,05`) ; persistance `sessionStorage` `ogTimeTabCalendarZoomY` (écrite au premier réglage du slider). **Sans clé session** : défaut **400 %** si `weekStart` = semaine courante, **100 %** sinon ; `syncCalendarZoomForDisplayedWeek` à chaque changement de semaine ; préférence enregistrée inchangée sur toutes les semaines. Recalcul `slotHPx`, axe, colonnes et blocs (`applyCalendarZoomY`). Ajustement slider ou retour semaine courante sans préférence : `scrollToNow` → `scrollCalendarToNow` (ligne now ~28 % viewport) ; semaine sans jour courant → ratio de scroll préservé.
- Scroll auto vers l'heure courante à l'affichage de la semaine en cours (une fois par semaine affichée, `autoScrollToNowIfNeeded` — pas à chaque tick 2 s).
- **Métrique calendrier** (v1.0.50, plage active v1.0.51, remplace Précis/Empilé v1.0.47) : toggle **Ouvert** | **Actif** dans `.calendar-toolbar` ; persistance `sessionStorage` `ogTimeTabCalendarMetric` (`open` | `active`, défaut `open` ; migration `ogTimeTabCalendarViewMode` : `stack` → `open`, `unstack` → `active`).
  - **Ouvert (`open`)** (présentation fusionnée v1.0.84) : clustering temporel (chevauchement, écart ≤ 5 min, plage min 15 min ; fusion forcée si > 10 clusters / créneau 15 min), puis **1 carte par site** (`groupKey`) ; plages qui se **chevauchent** → **bloc fusionné** multi-lignes (site ; au survol `A · O` + plage) ; sinon carte isolée (au repos nom seul, survol plage + A·O) ; titre `formatGroupLabel` (sans `www.`) ; **clic** → modal.
  - **Actif (`active`)** (présentation côte à côte v1.0.84, spark v1.0.90, compact v1.0.91) : **uniquement** sessions avec `activeSeconds ≥ 30 s` ; plage visuelle = **durée active** (min→max des rafales, peut inclure des trous) ; regroupement **15 min** + fusion rafales même site (≤ 20 min, segments conservés) ; plusieurs sites → **lanes horizontales** (max **2** + « +N ») ; carte au repos = **titre seul** (plancher ~22 px) ; survol = durée + plage (agrandissement) ; **mini-graphique O/A vertical** (10 % largeur, discret) ; clic → modal site.
- **Hauteur / fin visuelle** (v1.0.75, fusion Ouvert v1.0.84, Actif compact v1.0.91) : plancher **15 min** (Ouvert isolé) / **~22 px titre** (Actif isolé) ; bloc fusionné Ouvert = hauteur min selon nombre de lignes (**22 px**/ligne) ; **bas de carte = heure de fin réelle** ; zone hachurée en tête si plancher actif + libellé fin `HH:MM` en bas (masqué en Actif).
- **Un onglet** : fond sombre neutre semi-transparent ; **bordure 2px** rouge → vert selon `ratio = clamp(activeSeconds / max(openSeconds, 1), 0..1)` (CSS `--activity-ratio`, `color-mix`) ; plage horaire affichée = plage **Ouvert** (ouverture) ou plage **active** (Actif), même si la hauteur visuelle est tendue au plancher 3 min.
- **Plusieurs onglets** (mode empilé) : **une carte par site** au même créneau (pas N cartes pour N onglets du même `groupKey`) ; plusieurs sites distincts → rangée horizontale (max 4 + « +N », v1.0.49) ; **clic** carte = modal détail site (`openStackSiteCardModal`, v1.0.45).
- Survol : carte **agrandie** (révélation plage / durées, v1.0.83) + infobulle (`title`) avec durées détaillées (`format-duration.js`).
- **O/A sur cartes** (v1.0.88) : temps ouvert = **union** des plages `start`–`end` des onglets du site (pas somme) ; actif plafonné par O.
- **Clic** sur bloc simple → **modal** (titre, URL, groupe, plage, O/A, schéma temporel de la journée pour le même `groupKey`) ; **URL** et **Groupe** cliquables → nouvel onglet (v1.0.24).
- Rafraîchissement calendrier : snapshot structure + métriques (pas de recréation DOM si inchangé, cf. v1.0.5 stats).
- Ligne  now  sur la colonne du jour courant.
- Navigation semaine (‹ / Aujourd'hui / ›) - visible aussi sur l'onglet **Statistiques** (v1.0.16).
- **Effacer les données** (v1.0.13) : bouton en-tte → modal (nombre + minutes / heures / jours), message de confirmation ( Effacer les X dernières heures ? ), bouton danger **Effacer** + **Annuler** ; **Échap** ou fond ferme la modal.
- **Liens modales** (v1.0.24) : dans `#block-modal`, champs **URL** / **Groupe (clé)** en `<a>` sécurisé (`toSafeHref`, http/https) ; liste **Onglets du créneau** : URL cliquable sans déclencher le détail session (`modal-external-link` + `stopPropagation`) ; style `.modal a` (bleu clair, underline au survol, ellipsis).

### Onglet Statistiques

**Correctif v1.0.78 (hauteur graphiques barres / chronologie)** :
- **Symptôme** : barres 14 j et chronologie activité compressées en haut du conteneur (~1/3 de la carte), grand vide en bas.
- **Cause** : `maintainAspectRatio: true` (défaut `chartDefaults`) sur le bar chart 14 j ; `max-height: 280px` sur tous les `canvas` `.chart-card` ; zone chart sans `flex: 1` pour le bar 14 j.
- **Fix** : wrapper `.chart-grow-wrap` (`flex: 1`, `min-height` responsive) ; `maintainAspectRatio: false` sur `#chart-daily` et chronologie (déjà false) ; `scheduleFillChartResize` debounced 150 ms (`daily`, `activityTimeline`) ; doughnuts inchangés (210px, `maintainAspectRatio: true`).

**Correctif v1.0.77 (barres légende dual — proportion stricte)** :
- **Symptôme** : barres Actif incohérentes entre sites (ex. github A 4 min visuellement plus long que facebook A 55 min alors que O 3 h = même longueur pour les deux).
- **Cause** : plancher JS `Math.max(2, …)` sur le % de largeur (toute valeur > 0 ≥ 2 %) + `min-width: 2px` CSS — les petites durées actives gonflaient artificiellement et rompaient la comparaison inter-lignes.
- **Fix** : helpers `legendBarFillWidthPercent` / `applyDoughnutLegendBarFill` — `width = seconds / maxOpen × 100 %` sans arrondi/plancher ; `min-width: 1px` inline seulement si > 0 ; CSS `min-width: 0`. Mode jour (métrique unique) aligné.

**Correctif v1.0.76 (barres légende doughnut dual A/O)** :
- **Symptôme** : pour un site ex. `larevuephilo.com` avec badges **A 1 h** / **O 20 h**, les deux barres horizontales apparaissaient pleines à 100 %.
- **Cause** : `renderDoughnutLegend(..., dualMetric: true)` normalisait chaque barre sur le max de **sa** série (`maxActive` pour A, `maxOpen` pour O) — le site leader dans les deux classements obtenait 100 % sur les deux barres.
- **Règle UX retenue (option A)** : échelle **commune** par liste affichée, dénominateur = **max(Ouvert)** du top 8. Barre O = `openSeconds / maxOpen` ; barre A = `activeSeconds / maxOpen`. Ex. A 1 h, O 20 h, max liste 20 h → barre O pleine, barre A ~5 %. Permet de comparer les sites entre eux **et** le rapport A/O sur une même ligne. Mode jour (métrique unique) inchangé : `seconds / max(seconds)`.

**Correctif v1.0.57 (doublons légende stats — cause exacte)** :
- **Cause** : l’agrégation groupait par `groupKey` origin brut (`http://` vs `https://`, port, legacy) alors que `formatGroupLabel` n’affiche que le **hostname** → 3 lignes « leseta2.plesk.graphylabs.com », 3 couleurs (`assignColorsForItems` par clé distincte). Le merge v1.0.56 (`mergeDistributionGroupsForRender`) réutilisait `normalizeGroupKeyForStats` (origin stricte) **après** le top 8, donc ne fusionnait pas http/https.
- **Fix** : `normalizeStatsGroupKey` dans `lib/grouping.js` (origin stats → `https://hôte` canonique ; domain → eTLD+1) + `aggregateByGroupKey` unique pour jour/semaine **avant** chart + légende ; assertion anti-libellés dupliqués.

**Correctif v1.0.68 (cohérence métriques temporelles inter-vues)** :
- **Cause racine** : pipeline séparé pour la chronologie (sessions pondérées + fenêtre jour non bornée à `now`) alors que 14j/Insights utilisaient l'union journalière.
- **Fix** : helpers communs d'union journalière consommés par 14j, Insights et Chronologie ; même fenêtre temporelle pour aujourd'hui (`startOfDay -> now`) ; garde uniforme `A <= O`.
- **Effet attendu** : un même concept de "temps réel du jour" devient cohérent entre barres 14j, tuiles Insights et somme des buckets chronologie (tolérance arrondi).

**Correctif v1.0.67 (axes X chronologies — semaine/jour robustes)** :
- **Symptôme** : sur certaines semaines, l'axe X de la chronologie (bento + modale semaine) n'affichait qu'un seul `lun` puis plus aucun jour.
- **Cause** : la logique de labels dépendait des ticks réellement rendus/filtrés par Chart.js ; si le premier bucket d'un jour n'était pas dans les ticks conservés, le jour disparaissait (cas "un seul lun").
- **Fix** : callback d'axe unifié par scope (`week`/`day`) basé sur l'index bucket temporel.  
  - `week` : label jour abrégé FR (`lun` ... `dim`) sur le premier bucket de chaque jour.
  - `day` : labels horaires (`00h`, `02h`, ...) sur les buckets pleins, avec filtrage des sous-buckets pour la lisibilité.

**Correctif v1.0.59 (doublons stats résiduels — fusion définitive)** :
- **Cause restante** : des clés hétérogènes survivaient encore en entrée stats (caractères invisibles/non imprimables, fallback legacy, variantes host+port) ; après `formatGroupLabel`, plusieurs clés rendaient le même hostname (`leseta2.plesk.graphylabs.com`) avec des couleurs différentes.
- **Fix** : normalisation forte (`sanitizeStatsRawKey`) + extraction host robuste (URL/legacy) ; en mode origin stats, clé canonique unique `https://host` (**sans port**) ; fusion défensive de dernier mile par **clé canonique** puis **label canonique** juste avant rendu (`aggregateByGroupKey` + `mergeDistributionRowsByLabel`) ; garde anti-dup stricte : collision label => re-fusion automatique (warning non bloquant).

**Correctif v1.0.56 (doublons base similaire)** :
- Normalisation host / protocole / ports ; tentative de post-merge pré-rendu (remplacée par v1.0.57).

**Grille stats (v1.0.64, bento/masonry)** : mobile **1 colonne**, tablette **2 colonnes**, desktop large **masonry 12 colonnes** avec cartes de tailles variées pour mieux hiérarchiser les contenus.

- **Temps réel par jour** (barres, 14 derniers jours, colonne 1) : **deux séries** fixes Ouvert + Actif ; agrégation par **union temporelle journalière** (non-cumulative entre onglets parallèles). **Clic sur une barre** sélectionne ce jour pour la carte "Répartition par jour" (indication dans le sous-titre du titre).
- **Répartition par jour** (doughnut, colonne 2) : toggle **Actif** | **Ouvert** (`sessionStorage` `ogTimeTabStatsMetric`, défaut : actif). Bouton **Résumé** → CSV du jour (`og-time-tab-resume-YYYY-MM-DD.csv`, v1.0.92). `aggregateDayByGroup` sur **un seul** jour (`statsSelectedDay`). Camembert `#chart-groups-day`, liste `#doughnut-legend-day`. Navigation jour : **‹** / **›** + date picker ; persistance `ogTimeTabStatsDay`. **Clic ligne site** → modal `openGroupModalForDay` (v1.0.25) ; icne **** ouvre le site.
- **Insights semaine** (colonne 3, v1.0.19) : analyse de la **semaine affichée** - tuiles O/A, top sites, focus %, etc. ; clic → modal sessions (URL / groupe cliquables depuis v1.0.24).
- **Insights** (colonne 3, v1.0.29, correctif affichage v1.0.39) : toggle **Semaine | Jour** (`#week-insights` / `#day-insights`, un seul visible). Mode **Semaine** : agrégation 7 jours `weekStart` (`aggregateWeekInsights`) — plage lun–dim, tuile « Jour le plus actif ». Mode **Jour** : uniquement `statsSelectedDay` (`aggregateDayInsights`, `dayKeys: [statsSelectedDay]`) — date unique (ex. « mar. 26 mai 2026 »), total O/A du jour, site top actif/ouvert, focus %, ratio, top 3 actifs, onglet le plus actif, plage horaire ; clic tuile/top → `openGroupModalForDay`. Synchronisé avec clic barre 14 j et sélecteur « Répartition par jour ».
- **Chronologie activité** (v1.0.74, bento) : courbe Chart.js **Ouvert/Actif** en profils **bucket 1 h** (sans sélecteur) ; portée alignée sur le toggle insights.  
  - **Jour** : 24 points (`00h` à `23h`) en **valeurs bucket non cumulatives** (spikes horaires).  
  - **Semaine** : profil temporel continu de la semaine en buckets `1 h` (pas de totaux jour), axe X lisible par jours abrégés FR.
- **Répartition par site/groupe (semaine)** (v1.0.23, **pleine largeur**) : **pas de toggle** - **Actif et Ouvert** affichs ensemble. Layout 0 768px : **gauche** deux camemberts (`#chart-groups-active`, `#chart-groups-open`), **droite** liste `#doughnut-legend` (top 8) avec badges **A** / **O**, deux barres (% max **Ouvert** commun à toute la liste, v1.0.76, proportion stricte v1.0.77). Mobile : camemberts puis liste (colonne). Agrégation `aggregateWeekByGroupDual` sur les 7 jours de `weekStart`. **Clic ligne** → `openWeekInsightModal` (groupe, semaine) ; **** = site (v1.0.25).
- **Couleurs stables par site** (v1.0.35, dédup v1.0.41, stricte v1.0.43) : `lib/chart-colors.js` — hash djb2 → teinte **préférée** dans palette **24** couleurs visuellement distinctes ; `assignColorsForItems(items)` refuse une teinte déjà utilisée dans la vue (dédup par hex, pas seulement par index) ; repli HSL (angle d’or) au-delà de 24 clés. Doughnuts jour/semaine (Actif + Ouvert) et légende (pastille + barres %) partagent la même carte ; hors collision, même `groupKey` = même couleur d'un jour à l'autre.
- Factorisation : `renderDistributionCard` - `dualMetric: true` (semaine) vs simple (jour) ; `renderDoughnutLegend(..., dualMetric)` ; resize doughnut debounced.
- Axes et tooltips : `lib/format-duration.js` ; chronologies semaine (modale + bento) en jours abrégés FR côté axe X, tooltip conservé en date/heure complète.
- Rafraîchissement : 2 s + storage + `LIVE_UPDATE` ; 5 graphiques Chart.js (14 j + 3 doughnuts + chronologie activité) en `update('none')`.
- **Données vides** (v1.0.16) : bandeau + **Aujourd'hui** ; doughnuts  Aucune donnée  ; barres avec axes  0.

## Métriques

### Agrégation statistiques (v1.0.69)

- **Clé jour** : `YYYY-MM-DD` en fuseau local (`dateKey` / `entry.date` au flush ; live = jour de `segmentStart`).
- **14 jours (barres "Temps réel par jour")** : calcul par **union temporelle** par jour (intervalle ouvert tronqué au jour, actif prudent ancré en fin de session/`lastActivityAt`, garde `A <= O`).
- **Source unifiée 14j + Insights + Chronologie** (v1.0.68+) : ces trois vues utilisent la même couche d'agrégation journalière (intervalles union), plus de pipeline parallèle divergent.
- **Sémantique Chronologie (v1.0.73)** : en scopes **Jour** et **Semaine**, affichage en **valeurs bucket** (delta par période), plus de cumul ni de série "totaux jour" ; garde `A <= O` conservée.
- **Somme multi-onglets (doughnuts/légendes)** (corrigé v1.0.85) : union temporelle **par groupe** (même logique que barres 14 j / Insights) — fini le double comptage des onglets parallèles du même site.
- **Exception Insights (v1.0.62)** : le KPI **Temps réel total** (Jour/Semaine) utilise une **union temporelle** des intervalles pour éviter la double comptabilisation des onglets parallèles.  
  - `O` = union des plages ouvertes tronquées à la fenêtre d'insight.  
  - `A` = approximation prudente via union des plages actives ancrées en fin de session (ou `lastActivityAt` pour le live), puis plafonnée par `O`.
- **Borne du jour courant** : pour les vues en union journalière, les durées du jour sont plafonnées à `startOfDay -> now` (pas de dépassement possible du temps écoulé).
- **Semaine affichée** : même `weekStart` que le calendrier (lun - dim) ; total semaine = somme des 7 buckets jour, **pas** filtre par chevauchement `start`/`end` ni dump global de tous les onglets live.
- **Live** : inclus dans le bucket du jour de dbut de segment, seulement si ce jour est dans la fenêtre du graphique (14 j ou semaine courante affichée).

- **Temps ouvert (O)** : +1 s par tick pour chaque onglet web suivi tant qu"il est ouvert (URLs `chrome://` et `chrome-extension://` exclues).
- **Temps actif (A)** : +1 s seulement si **les trois** conditions sont runies :
  1. L"onglet est l'onglet **actif** de la **fenêtre au premier plan** (`focusedTabId` via `tabs.onActivated`, `windows.onFocusChanged`, `refreshFocusedTab`).
  2. Activit humaine rcente sur cet onglet (souris, clavier, scroll depuis le content script, ou prise de focus) dans la fenêtre `inactivityMs`.
  3. Les onglets en **arrière-plan** ne cumulent jamais **A**, même s"ils ont t actifs récemment avant un changement d"onglet.

Le changement de focus enregistre une activité lgre **uniquement** sur l'onglet qui **reçoit** le focus (pas sur l'onglet quitt).

## Paramètres (options / `ogTimeTabConfig`)

| Paramètre | Défaut | Description |
|-----------|--------|-------------|
| `mouseDistanceThreshold` | 50 px | Distance souris cumule pour valider un mouvement |
| `mouseWindowMs` | 5000 | Fentre glissante pour la distance souris |
| `trackKeyboard` | true | Frappes clavier = activité |
| `trackScroll` | true | Scroll / molette = activité |
| `inactivityMs` | 120000 | Délai sans activité avant arrt du temps actif (lecture) |
| `heartbeatIntervalMs` | 1000 | Fréquence du tick compteur (alarme chane) |
| `activityCheckIntervalMs` | 60000 | Vrification périodique du score d"activité |
| `minActivityScore` | 1 | Réservé (n"est plus utilis pour compter **A** en arrière-plan depuis v1.0.2) |
| `groupMode` | `origin` | `origin` \| `domain` \| `prefix` |
| `groupPathDepth` | 1 | Segments de chemin en mode `prefix` |
| `groupPrefix` | "" | Préfixe URL forc pour regrouper |

## Stockage (`chrome.storage.local`)

- **`ogTimeTabEntries`** : `{ id, url, title, groupKey, start, end, activeSeconds, openSeconds, date, tabId, reason? }[]`
- **`ogTimeTabLive`** : snapshot onglets ouverts (popup / dashboard)
- **`ogTimeTabConfig`** : paramtres ci-dessus

## Effacement des données (v1.0.13)

- **UI** : `dashboard.html` / `dashboard.js` - modal depuis le bouton  Effacer les données  (thme sombre, danger `#dc3545`).
- **Message** : `ERASE_DATA` `{ amount, unit: "minutes"|"hours"|"days" }` → `background.js`.
- **Rgle** (fenêtre `[cutoff, maintenant]`, `cutoff = Date.now() → n  unit`) :
  - Entrée avec `end 0 cutoff` → **conserve** ;
  - `start 0 cutoff` → **supprime** ;
  - Chevauchement (`start < cutoff < end`) → `end` tronqué  `cutoff`, `activeSeconds` / `openSeconds` au prorata du temps conserv.
- **Onglets live** : segment entirement dans la fenêtre → reset compteurs ; sinon flush du tronon `[segmentStart, cutoff]` puis reset.
- **Refresh** : `chrome.storage.onChanged` + `render()` dashboard (calendrier / stats).

## Tests manuels

1. Charger l'extension (ou **Recharger** sur `chrome://extensions` après une mise à jour).
2. Ouvrir 3 - 4 onglets web - **F5** une fois par onglet si besoin (obligatoire après rechargement extension pour reprendre le tracking, cf. v1.0.18).

### Content script - contexte invalid (v1.0.18)

3. Ouvrir `https://time.opengraphy.com/calendar` (ou tout site suivi), laisser l'onglet ouvert.
4. **Recharger** l'extension sur `chrome://extensions` **sans** F5 l'onglet.
5. Console DevTools de la page : **aucune** erreur rouge `Uncaught` / `Extension context invalidated` ; pas d"entre sur la page Erreurs de l'extension.
6. Bouger souris / scroller : pas d"erreur (couteurs dtachs).
7. **F5** sur l'onglet : le tracking reprend (messages `ACTIVITY` visibles ct SW si besoin).
8. Rester sur un onglet, bouger souris / scroller → seul cet onglet : **O** et **A** montent.
9. Ouvrir **Dashboard** (lien popup ou `chrome-extension://&/dashboard.html`).

### Calendrier - zoom vertical (v1.0.32, scroll now v1.0.36)

10. Onglet **Calendrier** : barre au-dessus de la grille — **Ouvert** / **Actif** puis **Zoom vertical** + curseur + pourcentage (défaut `400 %` semaine courante sans préférence).
11. Glisser le zoom : créneaux et blocs plus hauts/bas ; axe `00:00`–`24:00` étiré ; mode **Ouvert** : hauteur min **15 min** ; mode **Actif** : hauteur ~durée active (plancher 3 min) ; la vue **reste centrée sur la ligne now** (pas bloquée en haut de grille).
12. Glisser vers la gauche (50 %) : grille compacte ; blocs et heures alignés ; scroll toujours recalé sur l'heure actuelle.
13. Recharger le dashboard : dernier zoom conservé (`ogTimeTabCalendarZoomY`) ; premier affichage semaine courante → scroll initial vers now (une fois).
14. Naviguer vers une **autre semaine** (‹ ›) puis zoomer : pas de saut vers now (ratio préservé) ; revenir **Aujourd'hui** puis zoomer → recalage sur now.
15. Scroll manuel vers le matin, attendre ~10 s (tick live) : position de scroll **inchangée** ; zoomer à nouveau → retour sur now.

### Calendrier - position et scroll (v1.0.17)

16. Session vers **15:50** locale : le bloc est sur le créneau **15:30 - 16:00** (pas vers le matin) ; libell horaire à gauche aligné avec la grille après scroll.
17. Faire défiler le calendrier : heures jusqu'à **22:00+** visibles ; ligne verte **now** à l'heure réelle sur la colonne du jour.
18. Recharger le dashboard sur la semaine courante : scroll initial centré vers l'heure actuelle (une fois).

### Calendrier + panneau liste (v1.0.37, placement v1.0.38, clic carte v1.0.43)

8a. Mode **Empilé** : **clic simple** sur une carte `site · N onglets` → panneau sous la carte avec en-tête `domaine · plage · A/O` et **liste des onglets directement** (pas de chevron mono-site) ; pas de bouton **≡** (v1.0.43).
8b. **Double-clic** sur la carte → modal détail groupe.
8c. **Clic** une ligne onglet dans le panneau → modal session ; le panneau se ferme.
8d. **Plusieurs sites même créneau** : cartes site affichées côte à côte (max 4 + « +N ») ; bordures toujours pilotées par le ratio activité (**rouge → vert**) et **jamais** par la couleur site.
8e. **Placement `#block-picker`** (v1.0.38, plancher v1.0.42, taille v1.0.44) : `openBlockPicker` / `positionBlockPicker` — ancrage `getBoundingClientRect()` carte + colonne `.col` ; défaut **sous** le bloc (gap 4px), bord gauche = max(colonne, carte) ; si `hauteur naturelle > espace sous` dans `#grid-scroll` ∩ viewport → **au-dessus** (côté avec le plus d'espace) ; `max-height` = min(75vh, 520px, max(200px, min(hauteur naturelle, espace côté))) ; largeur = min(360px, 95 % colonne, colonne − 8px) ; CSS panneau `min-height` 200px, lignes `min-height` 48px, titre 2 lignes ; barre gauche 3px couleur site ; scroll/zoom/resize → recalcul debounced 50ms (panneau reste ouvert).

### Calendrier + modal

8. Session **1 - 2 min** active (ex. 10:21 - 10:22) en mode **Actif** : carte **positionnée sur la plage active** (pas sur toute la durée d'ouverture), hauteur ~durée active (plancher 3 min) ; en mode **Ouvert** : hauteur min 15 min sur plage ouverture ; bordure plutôt rouge si peu d'activité / verte si très actif ; ligne meta **A · O**.
9. **Cliquer** un bloc vert/rouge → la modal sé"ouvre avec URL, groupe, plage, O/A, liste des sessions du jour (même `groupKey`).
9b. **Liens** (v1.0.24) : cliquer **URL** ou **Groupe** ouvre le site dans un nouvel onglet ; `javascript:` refus ; clé domaine sans schma → `https://` ; bloc  N onglets  → modal groupe → lien URL dans la liste enfants sans ouvrir la modal session.
10. Fermer avec , clic sur le fond sombre, ou **Échap**.
11. Changer de semaine (9 :) : les blocs et la ligne  now  suivent la semaine courante si  Aujourd'hui .

### Statistiques

12. Onglet **Statistiques** : layout bento/masonry (desktop) + 5 cartes actives : 14 j, jour, insights, **chronologie activité**, semaine pleine largeur.
12a. **Hauteur graphiques** (v1.0.78) : cartes « Temps réel par jour (14 jours) » et « Chronologie activité » — l'axe Y occupe toute la hauteur utile de la carte (pas de bande vide en bas) ; doughnuts jour/semaine restent ~210px ; redimensionner la fenêtre → graphiques se recalent (debounce 150 ms).
12b. **14 jours (anti-gonflage parallèle)** : ouvrir 2-3 onglets en parallèle pendant ~5 min ; la barre **Ouvert** du jour doit rester proche du temps réel écoulé (pas la somme des onglets), jamais > `maintenant - minuit`. La barre **Actif** reste <= **Ouvert**.
13. **Jour** : toggle **Actif** | **Ouvert** ; cliquer une barre du 14 j met  jour la carte jour ; 9 : et date picker ; persistance `ogTimeTabStatsDay`.
14. **Semaine (pleine largeur)** : deux camemberts (Actif | Ouvert) + liste avec **A** / **O** par site ; barre O pleine pour le site le plus ouvert, barre A proportionnelle au même max Ouvert (v1.0.76) ; pas de toggle sur cette carte.
14b. **Légende dual — échelle barres** (v1.0.76, proportion stricte v1.0.77) : site avec **A 1 h · O 20 h** et max Ouvert liste = 20 h → barre O à 100 %, barre A ~5 % (pas deux barres pleines). **A 4 min vs A 55 min** (max O 3 h) → barre facebook ~13,75× plus longue que github ; barres O égales si O identiques.
15. Cliquer **Ouvert** sur la carte **jour** uniquement : doughnut jour + liste passent sur `openSeconds` ; barres 14 j, carte semaine dual et insights inchangs (O+A ct 14 j / insights).
16. Recharger le dashboard : dernier mode mtrique (jour) et dernier jour sélectionn conservs (`sessionStorage`).
17. Survol barre / doughnut / insight : `formatDurationFull` dans `title`.
17b. **Insights** : toggle **Semaine** → plage lun–dim, tuile « Jour le plus actif » ; toggle **Jour** → une seule date (`statsSelectedDay`), pas de tuile « Jour le plus actif », chiffres du jour uniquement ; clic barre 14 j ou picker jour met à jour les insights jour.
18. Axes barres 14 j : libellés compacts.
19. Statistiques 0 10 s : pas de clignotement (5 charts Chart.js).
19b. **Chronologie activité** : toggle Insights **Semaine/Jour** change la portée du chart (semaine affichée vs jour sélectionné) sans recréer la page.
19c. **Modale semaine (groupe/onglet)** : clic sur une tuile insight semaine ou une ligne légende semaine → modal avec **chronologie** (plus de liste texte "Sessions du groupe (semaine affichée)").
19d. **Règle axe X chronologies (v1.0.67)** : scope **Semaine** → labels jour `lun`…`dim` (plusieurs jours visibles, pas un seul `lun`) ; scope **Jour** → labels heures (`00h`, `02h`, ...), avec tooltip complet `jour dd/mm hh:mm` dans les deux cas.
20. Live : retour dashboard → mise à jour silencieuse.
21. Semaine vide : doughnuts  Aucune donnée  ; bandeau si besoin.
22. **Aujourd'hui** : semaine courante + jour = date du jour.
23. Jour sans données : camembert  Aucune donnée  ; changer de jour via picker ou barre 14 j.
24. Mobile : carte semaine - camemberts empils puis liste (scroll si besoin).
25. **Couleurs stables** (v1.0.35) : noter la couleur de grok.com (ou autre site) sur **Répartition par jour** ; changer de jour (‹ › ou barre 14 j) : grok garde la même pastille/couleur camembert ; carte semaine dual : même teinte pour ce site sur Actif et Ouvert.
25b. **Couleurs uniques par vue** (v1.0.41, v1.0.43) : sur un jour avec 5–8 sites (grok, facebook, instagram, cursor, etc.) : pastilles et segments doughnut **tous visuellement distincts** (pas plusieurs verts identiques) ; recharger le dashboard : pas de régression.

### Rgression

17. Popup : **O** / **A** cohérents avec le focus (cf. tests v1.0.2) ; survol des durées → format détaillé dans `title`.
18. Popup : section **Sessions du jour** visible sous la liste ; chart compact (courbes Ouvert/Actif) sans clignotement au refresh live (instance Chart.js réutilisée) ; état vide lisible si aucune session aujourd'hui.
18. Fermer un onglet → entre persistée, visible au prochain refresh calendrier / stats.
19. Onglet **Calendrier** : les blocs ne clignotent pas toutes les 2 s (seule la ligne  now  et les durées live voluent).

### Calendrier - onglets simultanés (v1.0.7, métrique v1.0.50)

18. Ouvrir **3+ onglets** au même moment, interagir différemment sur chacun.
19. Mode **Ouvert** : 10 onglets Gmail au même créneau → **1 carte** `mail.google.com · 10 onglets` (pas 10 cartes avec titres d'onglet).
20. 3 sites différents au **même moment** (chevauchement) → **Actif** : **un bloc fusionné** avec 3 lignes chronologiques ; **Ouvert** : 3 cartes côte à côte ; clic ligne/carte → modal site.
21. Mode **Actif** : onglet ouvert 10 min sans interaction → **aucune** carte ; session 1 min active sur 2 h ouverte → **petite carte** sur ~1 min (pas barre sur 2 h) ; 4 onglets actifs même créneau → cartes site côte à côte ; **A · O** sur chaque carte ; masqué si actif < 30 s.
22. Recharger le dashboard : dernière métrique conservée (`ogTimeTabCalendarMetric`).

### Calendrier - fin réelle alignée (v1.0.75)

23a. Session **16:49 - 17:34** (mode **Ouvert**) : le **bas** de la carte (trait fin + libellé `17:34`) se situe **entre** les lignes **17:30** et **18:00**, pas sous **18:00**.
23b. Session **< 15 min** (ex. 10:21 - 10:28) : carte lisible avec bandeau hachuré en haut ; le bas reste sur **10:28**.
23c. Recharger le dashboard : pas de régression sur cartes côte à côte (max 4 + « +N »).

### Calendrier - pas de carte avant l'heure (v1.0.48)

23. Ouvrir plusieurs onglets ; vérifier qu'**aucune carte** n'apparaît avec une plage dont le **début** est après la ligne **now** (verte).
24. Onglets live en cours : plage affichée se termine à l'heure courante (ex. `13:26 - 13:28` si now = 13:28), hauteur alignée sur cette durée.

### Calendrier - regroupement URL (v1.0.9)

21. Mode **Origin** (options) : 3 onglets `www.example.com` (accueil, wp-admin, autre) → panneau **une ligne** par host, **A** / **O** = sommes.
22. Clic ligne groupe → modal totaux + liste enfants ; clic enfant → modal session.
23. Changer **domain** / **prefix** dans options → le panneau et le popup suivent le nouveau `groupKey`.
24. Popup  Onglets suivis  : une entre par groupe avec totaux O/A ; compteur `(N)` ou `N groupes  M onglets`  ct du titre (v1.0.15).

### Calendrier - groupes dépliés (v1.0.11)

25. Ouvrir un bloc  N onglets  → dplier un groupe () → la liste enfants reste ouverte 0 10 s pendant le refresh live.
26. Dplier plusieurs groupes en même temps ; les durées **A** / **O** se mettent  jour sans refermer.
27. Clic ligne groupe : modal sans fermer le panneau ; **Échap** ou clic extrieur ferme le panneau.

### Effacement des données (v1.0.13)

28. Accumuler ~30 min de navigation → **Effacer les données** → 15 **minutes** → confirmer : le calendrier / stats ne montrent plus que la partie &gt; 15 min (ou vide si tout tait rcent).
29. Effacer **1 jour** alors que les données ont &lt; 24 h → calendrier et doughnut vides (hors onglets live en cours, compteurs remis  zro).
30. Session chevauchant la limite (ex. 2 h dont 1 h avant la coupure) : la partie avant la limite reste visible, tronquée au prorata.

## Design

- Fond `#1a1d23`, grille `#2c313c`, actif `#28a745`, inactif `#dc3545` (bordures calendrier via interpolation, pas fond plein depuis v1.0.27)

## Correctif - temps actif identique sur tous les onglets (v1.0.2)

**Symptôme** : tous les onglets affichent le même **O** et **A** ; **A** monte même en arrière-plan.

**Correctifs** (`background.js`, `content.js`) : **A** uniquement si `tabId === focusedTabId` + `isRecentlyActive` ; messages `ACTIVITY` ignors hors focus ; pas de ping au chargement ; `windows.onFocusChanged` + `refreshFocusedTab()`.

## UX - calendrier multi-onglets (v1.0.7)

**Symptôme** : plusieurs cartes rouges empiles au même créneau, bordures lourdes, clignotement au refresh 2 s.

**Correctifs** (`dashboard.js`, `dashboard.css`, `dashboard.html`) : union des sessions qui se chevauchent par jour ; rendu d"un bloc  N onglets  + panneau liste ; cartes simples sans marquage  overlap  ; sync DOM par clés stables et snapshots structure/métriques.

## UX - calendrier stack / unstack (v1.0.28)

**Demande** : basculer entre vue empilée (consolidée) et vue précise (une carte par session) ; survol lisible en mode précis ; icône ≡ pour le panneau liste ; pas de drill-down au clic sur le bloc consolidé.

**Implémentation** (`dashboard.html`, `dashboard.js`, `dashboard.css`) : `calendarViewMode` + `ogTimeTabCalendarViewMode` ; `buildDisplayItems` (stack vs unstack + `assignOverlapLanes`) ; survol `.is-hovered` en unstack ; `openClusterModal` au clic consolidé ; `.block-picker-toggle` + `.icon-menu`.

## Correctif - icônes panneau déploiement (v1.0.31)

**Symptôme** : dans le panneau `#block-picker` (liste depuis bloc « N onglets »), chaque ligne de groupe affichait un petit carré vide à droite au lieu du bouton expand ; lien externe ↗ de la légende doughnut également vide.

**Cause** : lors du correctif mojibake (v1.0.27), les caractères Unicode `▸`, `▾`, `↗` dans `renderBlockPickerList` et `doughnutLegendExternalLinkHtml` avaient été remplacés par des chaînes vides.

**Correctifs** (`dashboard.js`, `dashboard.css`) : `.icon-chevron` (chevron CSS, rotation via `.is-expanded`) pour `.block-picker-expand` ; `.icon-external` pour `.doughnut-legend-external` ; cohérent avec `.icon-menu` du bloc principal.

## UX - calendrier empilé : cartes lisibles + bouton ≡ (v1.0.40)

**Symptôme** : plusieurs cartes site (grok.com, google.com, etc.) superposées au même créneau 15 min avec transparence — texte illisible ; bouton **≡** retiré en v1.0.37.

**Correctifs** (`dashboard.js`, `dashboard.css`) : `assignStackSiteLayout` — même bin 15 min → pile **verticale** (> 2 sites, min 28 px/carte, gap 2 px) ou **lanes horizontales** (≤ 2 sites) ; `blockLayout` étend la hauteur totale si nécessaire ; survol `z-index` inchangé. Restauration `.block-picker-toggle` + `.icon-menu` (3 barres CSS) ; clic **≡** → `#block-picker` (`stopPropagation`) ; **double-clic** corps carte → modal groupe ; panneau v1.0.38 et 1 carte/site v1.0.34 préservés. Correctif contenu vide : voir v1.0.42. **v1.0.49** : pile verticale remplacée par rangée horizontale (voir section dédiée).

## UX - calendrier Ouvert / Actif (v1.0.50)

**Demande** : remplacer **Précis | Empilé** par **Ouvert | Actif** ; conserver la vue horizontale (max 4 cartes site + « +N ») pour les deux métriques ; supprimer le mode `unstack` (pile verticale / une carte par chevauchement).

**Implémentation** (`dashboard.html`, `dashboard.js`, `dashboard.css`) : `calendarMetric` + `ogTimeTabCalendarMetric` ; `buildOpenDisplayItems` / `buildActiveDisplayItems` ; `assignStackSiteLayout` + `renderStackBlocks` communs ; migration `ogTimeTabCalendarViewMode` ; suppression `mode-unstack` et rendu unstack.

## Correctif - sémantique bordure calendrier (v1.0.54)

**Symptôme** : les bordures des cartes calendrier ne suivaient plus une règle activité cohérente sur certains créneaux multi-sites.

**Cause** : une couleur d'accent par site (`slotAccentColor`) pouvait remplacer la bordure ratio activité sur des cartes consolidées, surtout en affichage côte à côte.

**Correctifs** (`dashboard.js`, `dashboard.css`) : bordure calendrier unifiée pour **toutes** les cartes (normales, consolidées site, `+N`) avec `ratio = clamp(activeSeconds / max(openSeconds, 1), 0..1)` ; interpolation continue rouge → vert via `--activity-ratio` ; suppression de la surcharge `borderColor` par site pour la bordure calendrier ; hover conservé sans changer la sémantique couleur.

## Correctif - doublons légende stats (v1.0.57)

**Symptôme** : 3 lignes identiques `leseta2.plesk.graphylabs.com` dans la légende Répartition jour/semaine, couleurs différentes, totaux A/O éclatés.

**Cause exacte** : `aggregateByGroupForDates*` groupait par `groupKey` origin **brut** (ex. `http://…`, `https://…`, hôte seul legacy) tandis que `formatGroupLabel` n’affiche que le **hostname** → libellés visuellement identiques mais clés distinctes pour `assignColorsForItems`. Le post-merge v1.0.56 (`mergeDistributionGroupsForRender`) ré-appliquait `normalizeGroupKeyForStats` (origin **stricte**, http ≠ https) **après** le top 8, donc sans fusionner ces variantes.

**Correctifs** (`lib/grouping.js`, `dashboard.js`) : `normalizeStatsGroupKey` (origin stats → `https://hôte` canonique ; domain → eTLD+1) ; `aggregateByGroupKey` unique **avant** tri, doughnuts et légende (suppression du post-merge) ; `resolveStatsGroupKey` aligné ; assertion anti-libellés dupliqués.

## Correctif - fusion parents URL en statistiques (v1.0.55)

**Symptôme** : dans l'onglet **Statistiques**, un même parent peut apparaître plusieurs fois (ex. `leseta2.plesk.graphylabs.com`) avec des totaux `A`/`O` éclatés.

**Cause** : mélange de clés hétérogènes (`groupKey` legacy, fallback URL brute, live et persistant non harmonisés), plus variantes d'hôte (`www`, casse, point final) non normalisées.

**Règle de fusion finale** : pour toutes les vues stats, la clé unique est recalculée avant agrégation avec `groupKey = getGroupKey(url, config active)` (fallback legacy uniquement si URL non exploitable), puis utilisée partout sans fallback `groupKey || url`.

**Correctifs** (`dashboard.js`, `lib/grouping.js`) : normalisation centralisée des entrées et du live (`normalizeEntriesForStats`, `normalizeLiveForStats`, `resolveStatsGroupKey`), agrégations jour/semaine/insights et modales alignées sur cette clé unique, et normalisation hostname dans `getGroupKey` (`www.`, casse, point final) + support explicite du mode `custom`.

## Correctif - calendrier mode Actif : plage visuelle (v1.0.51)

**Symptôme** : mode **Actif** sélectionné mais carte (ex. mail.google.com) affichée sur toute la plage d'ouverture (9:44 - 11:29) avec seulement **A 1 min · O 27 min** — la barre couvrait la session ouverte au lieu du temps actif.

**Règles mode Actif** :
1. Masquer si `activeSeconds` total du groupe < **30 s** (`ACTIVE_MIN_DISPLAY_SECONDS`).
2. Plage visuelle = durée **active** (`activeSeconds`), pas `start`/`end` d'ouverture ; ancrage `lastActivityAt` (live) ou fin de session (historique).
3. Union des segments actifs par site / bin 15 min ; hauteur proportionnelle au temps actif (plancher 3 min / 28 px).
4. Mode **Ouvert** inchangé (plage ouverture, min 15 min, rangée horizontale).

**Implémentation** (`dashboard.js`) : `normalizeBlockOpenRange` / `normalizeBlockActiveRange` ; `buildMetricDisplayItems` ; `clusterVisualRange` sans extension 15 min en Actif ; `lastActivityAt` dans `collectBlocks` (live). **Nettoyage** : suppression `visualRangeForRealRange` ; code mort v1.0.47 déjà retiré (`buildUnstackDisplayItems`, `renderUnstackBlocks`, `pickMostActiveBlock`) ; `assignStackSiteLayout` réservé aux builders Ouvert/Actif ; migration `ogTimeTabCalendarViewMode` conservée dans `loadCalendarMetric`.

## UX - calendrier empilé : même créneau (v1.0.49, inversion présentation v1.0.84)

**Demande** : plusieurs cartes au même moment. **v1.0.84** : présentations **inversées** — **Actif** = lanes **horizontales** (ex-Ouvert, max 2 + « +N ») ; **Ouvert** = **bloc fusionné** multi-lignes si chevauchement (ex-Actif). Compact au repos / détail au survol (v1.0.83).

**Implémentation** (`dashboard.js`, `dashboard.css`) : `buildDisplayItems` appelle `assignStackSiteLayout` en Actif et `fuseOverlappingActiveItems` en Ouvert ; `useActiveColumn` désactivé (lanes absolues) ; styles fused sous `.mode-open` ; `formatGroupLabel` retire `www.`.

## Correctif - panneau ≡ vide sur carte site (v1.0.42)

**Symptôme** : clic **≡** sur une carte site (ex. botanique.be) → `#block-picker` s'ouvre mais affiche une boîte sombre quasi vide, parfois seulement les flèches haut/bas du scroll.

**Cause** : `positionBlockPicker` (v1.0.38) calculait `max-height` = espace disponible côté choisi sans plancher ; sur carte basse dans la grille ou pile verticale, l'espace sous le bloc pouvait être < 30 px → panneau écrasé alors que la liste était bien rendue. Liste plate mono-site : barres A/O calées sur le max **groupe** au lieu du max **onglet** (barres trop fines).

**Correctifs** (`dashboard.js`, `dashboard.css`) : `BLOCK_PICKER_MIN_HEIGHT` 120 px ; flip au-dessus seulement si `spaceAbove > spaceBelow` ; `pickerFlatTabs` + lignes `.block-picker-item` en mode plat (carte `type: group` + `groupKey`) ; en-tête **domaine · plage · A · O** ; tri actif desc ; multi-groupes legacy : chevrons dépliés par défaut ; `#block-picker` `min-height`, `overflow-y: auto`, couleur texte explicite.

## UX - calendrier : panneau en 1 clic (v1.0.37)

**Plainte** : ouvrir le détail d'une carte empilée exigeait 2 étapes (bouton **≡** puis chevron groupe).

**Correctifs** (`dashboard.js`, `dashboard.css`) : **clic carte** → `#block-picker` avec liste onglets déjà visible (mono-site : pas de ligne groupe repliable) ; en-tête **domaine · plage · A/O** ; suppression du bouton **≡** ; multi-sites : groupes tous dépliés par défaut ; **double-clic** carte → modal groupe ; clic ligne onglet → modal session ; modal et panneau exclusifs.

## UX - panneau liste : ancrage prévisible (v1.0.38)

**Symptôme** : `#block-picker` apparaissait à des positions incohérentes (surtout liste longue ou bloc bas dans la grille).

**Correctifs** (`dashboard.js`, `dashboard.css`) : `positionBlockPicker` mesure espace sous/au-dessus dans `#grid-scroll`, flip vertical, contraintes colonne et `z-index` 90 ; `scheduleBlockPickerReposition` sur scroll grille, zoom vertical et resize.

## UX - mode empilé : 1 carte par site (v1.0.34)

**Symptôme** : en mode **Empilé**, plusieurs cartes (titres d'onglet EWET…, Fwd…, ETA…) pour le **même** site parent au même moment.

**Cause** : le clustering temporel fusionnait les sessions qui se chevauchent, mais chaque session d'un même `groupKey` restait une carte **single** si elle n'entrait pas dans un cluster multi-sessions, ou un bloc « N onglets » multi-sites sans sous-groupe par site.

**Correctifs** (`dashboard.js`) : `groupSessionsByGroupKey`, `buildStackDisplayItems` (fusion par `groupKey` + créneau 15 min) ; titre `stackSiteCardTitle` ; double-clic → `openPickerGroupModal` (clic → panneau liste depuis v1.0.37) ; mode **Précis** inchangé.

## Correctif - clustering empilé incohérent entre jours (v1.0.30)

**Symptôme** : en mode **Empilé**, un jour (ex. mardi) affiche des blocs « N onglets » lisibles, un autre (ex. mercredi) des dizaines de fines barres min-height comme en mode précis.

**Cause** : le clustering ne fusionnait que les sessions dont les timestamps se chevauchaient strictement ; les sessions courtes séquentielles (flush navigate, segments live) ne se chevauchaient pas malgré une activité multi-onglets dense au même créneau visuel. La colonne jour utilisait `start` au lieu de `date`, et la plage visuelle était calculée depuis le minuit du `start` (pas celui de la colonne).

**Correctifs** (`dashboard.js`) : `dayIndexForBlock` (priorité `date`) ; `visualRangeForDayColumn` ; `blocksStackClusterable` (plage min `MIN_BLOCK_MINUTES` + gap `STACK_CLUSTER_GAP_MIN = 5`) ; `consolidateDenseStackClusters` (max `MAX_STACK_BLOCKS_PER_BIN = 10` par créneau 15 min). Mode **Précis** inchangé (chevauchement strict + lanes).

## UX - blocs calendrier lisibles (v1.0.27)

**Symptôme** : sessions très courtes (ex. 10:21 - 10:22,  6 onglets ) → fines bandes colores illisibles.

**Correctifs** (`dashboard.js`, `dashboard.css`) : `blockLayout` - `height = max(durationPx, minBlockHeightPx())` avec `MIN_BLOCK_MINUTES = 15` ; bordure `color-mix` rouge/vert selon ratio A/O ; fond `rgba(26,29,35,0.88)` ; `formatTimeRange` sur chaque bloc ; consolidés = ratio agrg ; pas de stack offset (un cluster = un bloc, largeur pleine colonne).


**Demande** : ajouter un zoom vertical, aligner les blocs sur une granularit visuelle de 15 minutes et rendre une bordure rouge → vert non binaire.

**Correctifs** (`dashboard.html`, `dashboard.js`, `dashboard.css`) : slider `sessionStorage` `ogTimeTabCalendarZoomY` ; recalcul du rendu via `slotHPx` (axe + grille + blocs) ; collisions/stacking bases sur `visualStartMin`/`visualEndMin` alignées sur `VISUAL_BIN_MINUTES = 15` ; bordure interpole en continu via teinte HSL `--activity-hue` depuis `activeSeconds / openSeconds` (clamp 0..1). Réintroduit proprement en **v1.0.32** (barre `.calendar-toolbar`, style range app) ; plage max portée à **4×** en **v1.0.33**.

## UX - zoom vertical calendrier (v1.0.32, plage v1.0.33)

**Demande** : slider aux couleurs de l'app pour zoomer verticalement ; label + pourcentage ; persistance session ; ne pas casser stack/unstack ni min-height 15 min.

**Implémentation** (`dashboard.html`, `dashboard.js`, `dashboard.css`) : `#calendar-zoom-y` dans `.calendar-toolbar` ; `loadCalendarZoomY` / `applyCalendarZoomY` ; `SLOT_H_BASE * calendarZoomY` → `slotHPx`, `--block-min-h` ; **v1.0.36** : option `scrollToNow` sur le slider → `scrollCalendarToNow` (même logique que chargement semaine courante) ; repli `preserveScroll` (ratio) si jour courant absent de la semaine affichée. **v1.0.33** : `CALENDAR_ZOOM_Y_MAX = 4` (50 %–400 %, pas 5 %), `#calendar-zoom-y` `max="4"`, ARIA `aria-valuemax="400"`.

## Fonctionnalité - switch Actif / Ouvert (v1.0.8, primtre v1.0.12)

**Demande initiale (v1.0.8)** : basculer la mtrique sur doughnut et barres 14 j.

**Correctif UX (v1.0.12)** : le toggle ne pilote **que** le doughnut  Répartition par site / groupe  (contrle dans l"en-tte de la carte). Barres 14 j : deux séries fixes Ouvert + Actif.

## UX - légende doughnut sous le camembert (v1.0.20)

**Demande** : dans la colonne milieu  Répartition par site / groupe , afficher la liste des sites **sous** le doughnut (pas la légende Chart.js  droite), avec chronos selon le toggle Actif | Ouvert.

**Implmentation** (`dashboard.html`, `dashboard.css`, `dashboard.js`) : conteneur `.doughnut-wrap` + `#doughnut-legend` ; `legend: { display: false }` sur le chart doughnut ; `renderDoughnutLegend` (structure stable par `groupKey`, durées mises  jour in-place) ; `aggregateWeekByGroup` retourne `items` tris ; couleurs via `getColorForGroupKey` (v1.0.35, plus d'index de tri).

## Fonctionnalité - Répartition par jour (v1.0.22)

**Demande** : dupliquer la colonne milieu  Répartition par site / groupe  (camembert + liste + toggle + barres) **filtre par journe**, en carte stats ddie.

**Implmentation** (`dashboard.html`, `dashboard.css`, `dashboard.js`) : `aggregateDayByGroup` ; carte `#chart-groups-day` ; sélection jour (clic barres 14 j, date picker, flches) ; `sessionStorage` `ogTimeTabStatsDay` ; réutilisation `renderDistributionCard` / `renderDoughnutLegend`.

## Fonctionnalité - clic légende camembert → modal (v1.0.25)

**Demande** : clic sur un site dans la liste sous le camembert  Répartition par jour  (et bonus carte semaine) → même popup détail que calendrier / insights (groupe, O/A, sessions, URL).

**Implmentation** (`dashboard.js`, `dashboard.css`) : `renderDoughnutLegend` - lignes `role="button"`, `data-group-key`, `bindDoughnutLegendClicks` ; `openGroupModalForDay` (jour `statsSelectedDay`) ; semaine → `openWeekInsightModal` ; lien **** `.doughnut-legend-external` ; version **1.0.25**.

## Fonctionnalité - liens cliquables modales (v1.0.24)

**Demande** : dans les modales dashboard (session, groupe créneau, insights), rendre **URL** et **Groupe** (clé) cliquables pour ouvrir le site dans un nouvel onglet.

**Implmentation** (`dashboard.js`, `dashboard.css`) : `toSafeHref` / `modalLinkHtml` ; `openBlockModal`, `openPickerGroupModal`, `openWeekInsightModal` ; liste  Onglets du créneau  ; CSS `.modal a` ; version **1.0.24**.

## UX - grille stats + comparaison Actif/Ouvert semaine (v1.0.23)

**Demande** : grille haute 3 colonnes (14 j | jour | insights) ; carte **semaine** pleine largeur sous les 3 cartes ; **Actif et Ouvert** visibles ensemble (plus de toggle sur la semaine) - deux camemberts + liste avec **A** / **O** par site.

**Implmentation** (`dashboard.html`, `dashboard.css`, `dashboard.js`) : `.stats-layout` + `.stats-grid--top` (3 col) + `.chart-card--week-full` ; `.distribution-week-layout` (row desktop / column mobile) ; `aggregateByGroupForDatesDual` ; `renderDistributionCard` avec `dualMetric` ; toggle limit  `.chart-card--day`.

## UX - couleurs stables par site (stats, v1.0.35)

**Symptôme** : dans **Répartition par jour** (et camemberts semaine), la couleur d'un site (ex. grok.com) change selon le jour affiché ou le classement du top 8.

**Cause** : couleurs dérivées de l'**index** dans la liste triée du jour (`palette[i % n]`), pas de la clé `groupKey`.

**Correctifs** (`lib/chart-colors.js`, `dashboard.js`) : `hashGroupKey` (djb2) → index fixe dans `CHART_GROUP_PALETTE` (16 teintes) ; `getColorForGroupKey` pour doughnuts Chart.js, pastilles légende et barres proportionnelles ; barres 14 j inchangées (séries Ouvert/Actif globales).

## Correctif - couleurs dupliquées sur un doughnut (v1.0.41, renforcé v1.0.43)

**Symptôme** : dans **Répartition par jour**, plusieurs sites (grok, facebook, instagram, cursor, etc.) affichaient la **même** pastille verte.

**Cause** : `hashGroupKey % 16` (collision modulo) ; v1.0.41 dédupliquait par **index** palette alors que plusieurs index pointaient vers des verts proches (`#28a745`, `#20c997`, `#4dd4ac`…).

**Correctifs** (`lib/chart-colors.js`, `dashboard.js`) : palette **24** teintes distinctes ; `assignColorsForItems` déduplique par **couleur hex** déjà prise dans la vue ; repli `distinctColorForSlot` (HSL, angle d’or) ; `colorsForGroupItems` et `renderDoughnutLegend` partagent la même `Map`.

## UX - calendrier empilé : panneau en 1 clic sans ≡ (v1.0.43)

**Demande** : retirer le bouton **≡** ; clic simple sur la carte → même panneau `#block-picker` qu’en mode précis (liste onglets + barres A/O) ; double-clic → modal groupe.

**Implémentation** (`dashboard.js`, `dashboard.css`) : suppression `.block-picker-toggle` / `.icon-menu` ; clic carte (debounce 280 ms) → `toggleBlockPicker` ; `dblclick` → `openClusterModal` ; bordures `slotAccentColor` via `assignColorsForItems` quand ≥ 2 sites au créneau.

## Correctif - cartes calendrier avant leur heure (v1.0.48)

**Symptôme** : plusieurs cartes (grok, gmail, etc.) avec plage ex. `13:26 - 13:29` alors que la ligne **now** est encore **au-dessus** de ce créneau — onglets visibles avant l'heure réelle affichée.

**Causes** :
1. Blocs dont `start` est dans le futur (ou `end` non tronqué à `now` pour le live) encore rendus.
2. Position Y pouvant s'appuyer sur `stackSlotStartMin` / créneau 15 min plutôt que l'heure réelle de début.
3. Colonne jour incohérente si `date` et timestamp `start` ne correspondent pas (offset minuit → bloc en haut de grille).

**Règle d'affichage** (`dashboard.js`) :
- Ne pas créer de bloc si `start > Date.now()` (strictement futur).
- Chevauchement **now** : plage affichée et layout de `start` à `min(end, now)` ; hauteur proportionnelle (min 15 min en Empilé, plancher 2 min en Précis).
- `top = timeToY(visualStartMin)` depuis l'heure locale réelle (pas bin 15 min futur) ; `stackSlotStartMin` réservé à la pile multi-sites même créneau.
- Tooltip / meta : plage réelle tronquée si live (`formatTimeRange` + `clampToNow`).
- Mode **Précis** : filtrage + troncature avant clustering ; **1 carte** par chevauchement (`pickMostActiveBlock`).

## UX - calendrier Précis / Empilé (v1.0.47)

**Symptômes** : mode Précis — 4 cartes (grok, gmail, etc.) empilées illisiblement au même créneau ; session cursor 3 min (`09:47 - 09:50`) affichée avec hauteur 15 min (`MIN_BLOCK_MINUTES`).

**Demande** : séparer clairement les deux modes — Précis = activité humaine uniquement, 1 gagnant par chevauchement, hauteur réelle ; Empilé = regroupement par site, min 15 min, modal au clic.

**Implémentation** (`dashboard.js`, `dashboard.css`) :
- `buildUnstackDisplayItems` : filtre `activeSeconds > 0`, cluster chevauchement strict, `pickMostActiveBlock` ;
- `renderUnstackBlocks` / `renderStackBlocks` ; `blockLayout({ useMinBlockHeight })` — false + `UNSTACK_MIN_VISUAL_MINUTES = 2` en Précis ;
- Cartes : label site + plage réelle + **A · O** (deux modes) ; CSS `.mode-unstack .unstack-block { min-height: 0 }`.

## UX - calendrier empilé : modal au clic carte (v1.0.45)

**Symptôme** : clic carte site (mode Empilé) ouvrait encore `#block-picker` — panneau latéral étroit à côté de la carte, trop petit pour la liste onglets.

**Demande** : même **grande modal centrée** que mode Précis / stats (fond sombre, titre site, champs URL, Groupe, Plage, durées O/A, sessions du jour).

**Implémentation** (`dashboard.js`, `dashboard.css`) :
- Handler clic carte (`createBlockShell`, branche `consolidated`) : `openStackSiteCardModal(item)` — remplace `toggleBlockPicker` (debounce 280 ms supprimé) ; `#block-picker` fermé via `closeBlockPicker()` ; plus de double-clic distinct.
- **`openStackSiteCardModal(item)`** : titre `formatGroupLabel(groupKey)` ; stats URL/Groupe cliquables, plage créneau, durée, O/A ; mini schéma temporel **journée (même groupe)** (persisté + live) ; sous-section **Onglets du créneau** (clic ligne → `openBlockModal`).
- **`openClusterModal`** délègue à `openStackSiteCardModal` si `item.groupKey` (legacy multi-site sans clé conserve l'ancien contenu).
- CSS `.modal-content` : `min-width` 420 px, `max-width` 90 vw ; `.modal-sessions ul` scroll interne (`max-height` ~40 vh).

## UX - panneau `#block-picker` agrandi (v1.0.44)

**Demande** : panneau au clic carte trop petit (micro-scroll, en-tête illisible) — retrouver une taille proche de l’ancien grand panneau.

**Implémentation** (`dashboard.js`, `dashboard.css`) : largeur `min(360px, 95 % colonne, colonne − 8px)` ; `BLOCK_PICKER_MIN_HEIGHT` **200** ; plafond `min(75vh, 520px)` ; en-tête et liste plus aérés ; lignes onglet `min-height` 48px, titre jusqu’à 2 lignes ; `border-left` 3px couleur site (`buildPickerColorMap` + `assignColorsForItems`) ; ancrage carte + flip vertical inchangés.

## UX - colonne doughnut (taille, liste, chronos) (v1.0.21)

**Symptômes** : camembert qui rtrcit au chargement ; liste des sites coince en haut avec vide en bas (`max-height` 168px) ; durées trop loignes des noms.

**Correctifs** (`dashboard.html`, `dashboard.css`, `dashboard.js`) : `#chart-doughnut` hauteur fixe 210px, `maintainAspectRatio: true`, `scheduleDoughnutChartResize` (debounce 150 ms) ; `.doughnut-legend` en `flex: 1` sans plafond arbitraire ; lignes légende avec en-tte flex (site + badge durée) et barre `%` du max semaine ; grille `.stats-grid` en `align-items: stretch` et `.chart-card` en colonne flex.

## Correctif - Insights toggle Jour affichait la semaine (v1.0.39)

**Symptôme** : toggle **Jour** actif (titre « Insights jour ») mais contenu identique à la semaine — TEMPS TOTAL avec plage `25/05/2026 - 31/05/2026`, tuile « Jour le plus actif », mêmes chiffres O/A et groupes.

**Cause** : `updateInsightsScopeToggleUi()` posait bien `hidden` sur `#week-insights`, mais `.week-insights { display: flex }` dans `dashboard.css` **écrasait** l'attribut HTML `[hidden]` (comportement CSS standard). Les deux conteneurs restaient visibles ; l'utilisateur voyait le contenu semaine généré par `renderWeekInsights`.

**Correctifs** (`dashboard.css`, `dashboard.js` v1.0.39) : `.week-insights[hidden] { display: none }` (même pattern que `.doughnut-legend[hidden]`) ; tuile **Onglet le plus actif** en mode jour ; `updateInsightsScopeToggleUi()` à l'init et sur early-return de `renderCharts`. L'agrégation jour (`aggregateDayInsights` → `computeInsightsForRange` avec `dayKeys: new Set([dayKey])`) était déjà correcte.

## Fonctionnalité - Insights semaine (v1.0.19)

**Demande** : le panneau  Ouvert vs actif (semaine affichée)  doublonnait avec le graphique 14 j lorsqu"une seule journe avait des données.

**Implmentation** (`dashboard.html`, `dashboard.css`, `dashboard.js`) : carte **Insights semaine** (`aggregateWeekInsights`, `renderWeekInsights`) ; suppression du chart `openVsActive` ; modal détail au clic (`openWeekInsightModal`) ; agrégation alignée v1.0.14 (`buildDayMetricsMap`, `groupKey`, live sur jour de `segmentStart`).

**Implmentation** (`dashboard.html`, `dashboard.css`, `dashboard.js`) : `statsMetricMode` + `sessionStorage` ; `aggregateWeekByGroup(..., mode)` ; `aggregateLast14Days` sans mode ; `entryMetricSeconds` / `tabMetricSeconds` pour le doughnut ; `_ogStructureKey` pour `chart.update('none')`.

## Correctif - panneau groupes se referme (v1.0.11)

**Symptôme** : dans le panneau  N onglets , cliquer sur **** pour dplier un groupe (ex. `www.zahiazd.com` → 11 onglets) referme la liste immdiatement.

**Cause** :  chaque tick live (~2 s), `syncCalendarBlocks` rappelait `renderBlockPickerList` qui faisait `innerHTML = ""`, perdant la classe `is-expanded`.

**Correctifs** (`dashboard.js` v1.0.11) : `pickerExpandedGroups` (Set `${domKey}\u001f${groupKey}`) ; restauration au rendu ; `updateBlockPickerListMetrics` si la structure des groupes est inchange ; `stopPropagation` sur  et zone enfants ; clic ligne groupe n"appelle plus `closeBlockPicker` avant la modal.

## Correctif - calendrier position + plage horaire (v1.0.17)

**Symptômes** : bloc affichant la bonne plage textuelle (ex.  15:50 - 15:51 ) mais plac visuellement vers le matin (~05:00) ; ligne  now  au mauvais créneau ; grille semblant s"arrter vers 14:00 (fenêtre sans scroll jusqu"au soir).

**Causes** :

1. **Axe horaire fixe** : `#time-axis` tait **en dehors** de `#grid-scroll` - au scroll de la grille, les créneaux et les blocs bougeaient mais pas les libellés 00:00, 01:00& (décalage apparent ~10 h selon la position de scroll).
2. **Viewport** : hauteur `calc(100vh → &)` sans scroll unifi masquait l"après-midi tant que l"utilisateur ne faisait pas dfiler (ou croyait que la grille s"arrtait  ~14:00).

**Correctifs** (`dashboard.html`, `dashboard.css`, `dashboard.js` v1.0.17) : structure `calendar-head` + `calendar-body` (axe et colonnes dans le **même** `#grid-scroll`) ; `localMinutesFromTs` / `timeToY` / `clampCalendarMinutes` en heure locale ; `CALENDAR_DAY_START_HOUR` / `CALENDAR_DAY_END_HOUR` (≥ - 24) ; `scrollCalendarToNow` + `autoScrollToNowIfNeeded`.

## Correctif - graphiques Statistiques vides (v1.0.16)

**Symptôme** : onglet **Statistiques** - les trois panneaux Chart.js restent compltement vides (pas de barres, pas de doughnut, axes invisibles). Semaine affichée possiblement correcte (ex. 25/05/2026 - 31/05/2026).

**Causes possibles** :

1. **Bug (v1.0.14 → v1.0.15)** : dans `renderCharts()`, `aggregateLast14Days(cachedEntries, live)` s"excutait **avant** `const live = await getLiveState()` → `ReferenceError` (zone morte temporelle), promesse rejete, **aucun** `new Chart()` - symptme identique   tout vide  même avec des données.
2. **Données lgitimement vides** :  Effacer les données  (v1.0.13) sur une fenêtre couvrant toute l"activité ; aucune navigation web suivie ; onglets uniquement `chrome://` / `chrome-extension://`.
3. **Mauvaise semaine affichée** : navigation 9 : sur le calendrier puis onglet Statistiques - doughnut et **insights** ne montrent que la semaine de `weekStart` (les 14 j peuvent encore avoir des barres).

**Correctifs** (`dashboard.js` v1.0.16) : ordre corrig (`getLiveState` puis agrégation) ; navigation semaine visible sur Statistiques ; bandeau `#stats-empty` + **Aujourd'hui** ; `suggestedMax` sur axes quand max = 0.

## Correctif - cohrence graphiques stats (v1.0.14)

**Symptôme** : avec des données uniquement le 26 mai - graphique 14 j  Ouvert  ~30 min, graphique semaine  Temps ouvert  ~45 min ; actif cohrent (~12 min).

**Cause** : `aggregateWeekOpenActive` filtrait les entres par chevauchement horaire de la semaine **et** additionnait **tous** les `openSeconds` des onglets live, sans les attribuer  un jour ; `aggregateLast14Days` ne comptait que les entres persistées par `e.date` et **excluait** le live.

**Correctifs** (`dashboard.js` v1.0.14) : helpers partags `buildDayMetricsMap`, `accumulateEntriesByDate`, `accumulateLiveByDate`, `sumDayMetrics` ; semaine = somme des 7 jours de `weekStart` ; 14 j inclut le live ; doughnut semaine aligné sur les mêmes clés jour.

## Fonctionnalité - compteur popup (v1.0.15)

**Demande** : petit compteur  ct de  Onglets suivis  dans la popup.

**Implmentation** (`popup.html`, `popup.js`, `popup.css`) : `updateTabsCount` après `groupLiveTabs` (même clé `groupKey` que v1.0.9) ; `(N)` si un onglet par groupe, sinon `N groupes  M onglets` ; style gris `#6b7280`, taille rduite ; refresh 1 s + `LIVE_UPDATE`.

## Fonctionnalité - effacement des données (v1.0.13)

**Demande** : bouton **Effacer** avec choix de la durée (minutes, heures, jours) ; supprimer les sessions dans la fenêtre temporelle depuis maintenant vers le pass.

**Implmentation** : modal dashboard (`ERASE_DATA`) ; `lib/storage.js` (`eraseEntriesSince`, troncature au prorata) ; `background.js` (`eraseLiveTabsSince` pour onglets ouverts). Style danger `#dc3545`.

## UX - toggle Actif/Ouvert limit au doughnut (v1.0.12)

**Symptôme** : le segmented control modifiait aussi le graphique 14 j (une seule srie) alors que seul le doughnut doit suivre la mtrique.

**Correctifs** (`dashboard.html`, `dashboard.css`, `dashboard.js`) : toggle dplac dans l"en-tte de la carte doughnut ; `aggregateLast14Days` agrge toujours `openSeconds` + `activeSeconds` (deux datasets Chart.js) ; `aggregateWeekByGroup` seul consommateur de `statsMetricMode` ; titre 14 j fixe ; titre doughnut `Répartition par site / groupe (actif|ouvert)`.

## Correctif - tooltip Ouvert vs actif (v1.0.10)

**Symptôme** : graphique horizontal  Ouvert vs actif  - axe X en minutes (`8 min`, `50 min`) mais tooltip `Durée: 2/873` (secondes brutes avec sparateur de milliers).

**Cause** : dans `createOpenActiveChart`, `plugins: { legend: { display: false } }` remplaait tout l"objet `plugins` issu de `chartDefaults()` (perte du callback tooltip). En outre, pour `indexAxis: 'y'`, `formatChartTooltipValue` lisait `parsed.y` (index 0/1) avant `parsed.x` (durée en secondes).

**Correctifs** (`dashboard.js`, `lib/format-duration.js` v1.0.10) : fusion `...chartDefaults().plugins` + `legend: { display: false }` ; tooltip horizontal utilise `parsed.x`.

## Correctif - graphiques Statistiques en boucle (v1.0.5)

**Symptôme** : onglet Statistiques - les graphiques Chart.js se remplissent depuis zro en boucle (~ toutes les 2 s).

**Cause** : `renderCharts()` appel  chaque `render()` faisait `destroy()` + `new Chart()` sur les trois graphiques, relanant les animations  chaque tick.

**Correctifs** (`dashboard.js` v1.0.5) : snapshot JSON des agrgats ; skip si inchangé ; `upsert*` avec `chart.update('none')` ; recréation seulement si les libellés changent de structure ; `animation: false` dans les options. Calendrier : grille reconstruite uniquement au changement de semaine.

## Correctif - erreurs console content.js (v1.0.4 → v1.0.18)

**Symptômes** (DevTools page web, onglet ouvert **avant** un **Recharger** de l'extension sur `chrome://extensions`, sans F5) :

- `Unchecked runtime.lastError: Could not establish connection. Receiving end does not exist.`
- `Uncaught Error: Extension context invalidated` (souvent `content.js` / `isExtensionAlive`, `sendMessage`, ou callback `GET_CONFIG` lisant `chrome.runtime.lastError`)

**Cause** : le content script inject reste dans la page alors que le contexte MV3 est mort ; tout accs  `chrome.runtime` peut **throw** (pas seulement retourner `undefined`). v1.0.4 ajoutait des gardes mais le callback `GET_CONFIG` et les couteurs DOM continuaient d"appeler `chrome` après invalidation → erreurs **non gres** listes sur `chrome://extensions`.

**Correctifs** (`content.js` v1.0.18) :

- `contextDead` : au premier chec ou `!chrome.runtime.id`, marquer mort et **ne plus jamais** toucher `chrome`.
- `markContextDead()` : `unbindListeners()` (mousemove, keydown, scroll, wheel, pointer, click) + `chrome.runtime.onMessage.removeListener`.
- `isExtensionAlive()` : lecture de `chrome.runtime.id` dans try/catch ; en cas d"exception → `markContextDead()`.
- `safeSendMessage()` seul chemin pour `sendMessage` (promesse + callback avec `lastError` protg).
- Handlers DOM : sortie immdiate si `contextDead`.

**Aprs rechargement extension** : rafrachir les onglets concerns (**F5**) pour rinjecter le script et reprendre le tracking ; sinon la page reste silencieuse (aucune erreur rouge) jusqu"au refresh. L"injection manifest + `executeScript` (`background.js`) ne s"applique qu"aux onglets nouvellement chargs ou rinjects ; `window.__ogTimeTabContent` évite les doubles couteurs sur une même injection.

## Encodage des fichiers texte (v1.0.27)

- Tous les fichiers sources (HTML, JS, CSS, JSON, MD) sont en **UTF-8 sans BOM**.
- Préférer l'apostrophe ASCII `'` et le tiret `-` plutôt que les guillemets ou tirets typographiques (`'`, `—`, `·` uniquement si nécessaire en UI).
- En cas de mojibake (`Ã©`, `â€™`, etc.) : **une seule** passe `Buffer.from(text, 'latin1').toString('utf8')` sur le fichier concerné, puis vérifier dans Chrome — ne pas boucler sur du texte déjà correct.

## Correctif - placement calendrier fin réelle vs visuel (v1.0.75)

**Symptôme** : session ex. `borne-electrique.be` **16:49 - 17:34** (45 min) — modal et libellé corrects, mais la carte semble se terminer **après** la ligne **17:30** (voire vers 18:00), d'où une lecture incohérente.

**Cause exacte** :
1. `blockLayout` / `stackSlotRowLayout` : `height = max(durationPx, minH)` avec `top` fixé au début réel → le plancher **15 min** (Ouvert) ou **5 min** (Actif) **allongeait le bas** de la carte au-delà de `visualEndMin` pour toute session plus courte que le plancher (et pouvait cumuler avec d'autres effets de hauteur commune).
2. CSS `.block { min-height: var(--block-min-h) }` : imposait encore un minimum en pixels même quand le JS calculait une hauteur proportionnelle exacte.

**Règle de présentation (v1.0.75)** :
- **Bas de carte = fin réelle** (`visualEndMin` / `timeToY(end)`).
- **Hauteur affichée** = `max(durée réelle px, plancher lisibilité)` ; si plancher > durée réelle → **décalage du `top` vers le haut** (`top = endY - height`), jamais d'extension sous l'heure de fin.
- **Sessions courtes** : bandeau hachuré en tête (`.block-readability-pad`) = zone « minimum lisible » ; trait + libellé **fin** (`.block-end-marker` / `.block-end-time`) sur le bord bas.
- **Clustering** : `clusterVisualRange` (extension 15 min) reste réservé au regroupement, pas au rendu des cartes.

**Implémentation** : `layoutBlockVerticalRange` dans `dashboard.js` ; `applyBlockLayout` pose `--block-real-frac` ; styles `dashboard.css`.

## Correctif - bornage cartes calendrier (v1.0.70)

**Symptôme** : certaines cartes calendrier (ex. `chat.qwen.ai`) pouvaient rester visuellement étirées jusqu'à `now` alors que la session réelle était terminée plus tôt dans la journée.

**Causes** (`dashboard.js`) :
- `collectBlocks` forçait `end = Date.now()` pour chaque entrée live, même quand `openSeconds` indiquait une fin effective antérieure (segment live stale/non flush).
- le layout horizontal multi-sites (`assignStackSiteLayout` + `stackSlotEndMin`) imposait une hauteur de rangée commune, pouvant étendre une carte courte à la durée d'un autre site plus long du même créneau.

**Règle finale de bornage** :
- une carte n'utilise `now` comme borne de fin **que** si le segment est réellement live (tolérance tick) ; sinon `end = min(now, start + openSeconds)`.
- en affichage côte à côte, chaque carte conserve sa plage propre (`start/end` et `visualStartMin/visualEndMin`) ; pas d'extension à la borne d'une autre carte du slot.

## UX - chronologie activité en buckets (v1.0.73)

**Demande** : rendre la carte `Chronologie activité` plus détaillée sans perdre la logique **Semaine vs Jour**.

**Implémentation** (`dashboard.html`, `dashboard.css`, `dashboard.js`) :
- suppression du contrôle **Granularité** dans l'en-tête de la carte (UI fixe) ;
- **Jour** : buckets **fixes 1 h** (`00h` à `23h`, 24 points) en valeurs **non cumulatives** `Ouvert/Actif` ;
- **Semaine** : chronologie en buckets `1 h` sur toute la semaine affichée (même sémantique que la chronologie du groupe, labels jours côté axe X) ;
- **Tooltips** : libellés explicites `Ouvert (bucket 1 h)` / `Actif (bucket 1 h)` + créneau `HH:MM-HH:MM` ;
- invariants conservés : bornes aujourd'hui `00:00 -> now` et garde `A <= O`.

## UX - chronologie activité sans "collier de perles" (v1.0.74)

**Demande** : alléger visuellement la chronologie activité en supprimant les marqueurs répétés sur les plateaux (valeurs identiques) tout en conservant les points utiles aux ruptures.

**Implémentation** (`dashboard.js`) :
- règle scriptable `pointRadius` / `pointHoverRadius` sur les deux datasets (`Ouvert`, `Actif`) ;
- pour un index `i`, point masqué (`0`) si `value[i-1] ~= value[i]` **et** `value[i+1] ~= value[i]` (plateau interne) ;
- point conservé sur les transitions (début/fin de plateau, pics, ruptures), avec rayon base `1.5` et hover `4` ;
- style bucket `1 h` inchangé (couleurs, tension, remplissage, tooltips).

## Version

| Version | Date | Notes |
|---------|------|-------|
| **1.0.92** | 2026-09-22 | Stats jour : bouton Résumé → export CSV des sessions du jour - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.91** | 2026-08-21 | Calendrier Actif : plancher titre seul, détail au survol - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.90** | 2026-08-21 | Calendrier Actif : mini-graphique O/A vertical (style modal) dans les cartes - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.89** | 2026-08-21 | Calendrier Actif : bandes vertes verticales (rafales d'activité dans la plage) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.88** | 2026-08-20 | Calendrier : O/A cartes = union temporelle par site (pas somme onglets parallèles) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.87** | 2026-08-20 | Calendrier : zoom vertical 400 % par défaut (semaine courante) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.86** | 2026-08-20 | Logo horloge (icônes Chrome + en-têtes UI) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.85** | 2026-08-20 | Stats doughnuts/légende : union temporelle par site (fin double comptage onglets parallèles) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.84** | 2026-08-20 | Calendrier : présentation Actif (côte à côte) ↔ Ouvert (fusion) inversée - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.83** | 2026-08-20 | Calendrier : cartes compactes (nom seul au repos, détail au survol), durée Actif sans « actif », `formatGroupLabel` sans `www.` - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.82** | 2026-06-24 | Calendrier Actif : blocs fusionnés superposés + plancher lisible - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.81** | 2026-06-24 | Calendrier Actif : pile verticale, fusion rafales, cartes compactes - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.78** | 2026-06-03 | Stats : barres 14 j + chronologie activité remplissent la hauteur des cartes bento (`chart-grow-wrap`, resize debounced) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.77** | 2026-06-03 | Stats légende dual : barres A/O strictement proportionnelles (suppression plancher 2 % + min-width CSS) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.76** | 2026-06-03 | Stats légende semaine dual : barres A/O sur échelle commune (max Ouvert liste) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.75** | 2026-06-03 | Calendrier : bas de carte = fin réelle (plancher min vers le haut), marqueur fin HH:MM, zone hachurée sessions courtes - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.74** | 2026-06-02 | Chronologie activité : masquage des points internes sur segments plats (anti "collier de perles"), hover conservé sur ruptures/pics - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.73** | 2026-06-02 | Stats Chronologie activité : rendu bucketisé 1h (jour + semaine), non cumulatif, style spikes aligné sur "Chronologie du groupe", tooltips explicites bucket/plage - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.72** | 2026-06-02 | Stats Chronologie activité : granularité fixe 1h, suppression du sélecteur "Granularité", scope jour en 24 points horaires (`00h`...`23h`), scope semaine en totaux jour + profil horaire - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.71** | 2026-06-02 | Stats Chronologie activité : contrôle de granularité par scope (jour/semaine), détail intrajournalier dans tooltips semaine, et tooltips jour enrichis (plage + delta + cumul) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.70** | 2026-06-02 | Calendrier Ouvert/Actif : bornage strict des cartes sur la fin réelle des sessions (plus d'extension fantôme à `now`) + layout côte à côte sans hauteur forcée commune - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.69** | 2026-05-28 | Chronologie activité alignée avec 14j : scope jour en cumul intra-journée (valeur finale = total du jour), scope semaine en totaux par jour, libellés/tooltips clarifiés - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.68** | 2026-05-28 | Cohérence métriques temporelles stats : source unifiée entre 14j/Insights/Chronologie, bornes aujourd'hui harmonisées (`startOfDay -> now`), garde `A <= O` appliquée partout - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.67** | 2026-05-28 | Chronologies temporelles (modales + bento) : axe X unifié par scope (`week` = jours `lun`…`dim`, `day` = heures `00h`…`22h`), correctif robuste du bug "un seul lun", tooltips détaillés conservés - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.66** | 2026-05-28 | Chronologies (bento + modale semaine) : correction callback ticks X pour afficher un label sur le premier bucket de chaque jour présent (`lun`…`dim`) ; tooltip date/heure conservé - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.65** | 2026-05-28 | Chronologies (modale semaine + bento activité) : axe X en jours abrégés FR sans heures (`lun`…`dim`) + dédup ticks par jour, tooltip date/heure conservé - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.63** | 2026-05-28 | Stats 14 jours : barres "Temps réel par jour" en union temporelle journalière (`A<=O`, borne today), fin du gonflage multi-onglets parallèles - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.62** | 2026-05-28 | Insights Jour/Semaine : KPI "Temps réel total" en union temporelle (anti-chevauchement multi-onglets), garde de plage et approximation active prudente - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.61** | 2026-05-28 | Modale calendrier : remplacement de la liste "Sessions du jour" par mini chart Chart.js (persisté + live, buckets 15 min), section "Onglet du créneau" conservée - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.60** | 2026-05-28 | Calendrier Actif : plancher 5 min + binning 5 min ; Popup : schéma Chart.js "sessions du jour" - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.59** | 2026-05-27 | Stats : normalisation forte + fusion finale stricte anti-doublons (clé+label), origin canonique `https://host` sans port - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.58** | 2026-05-27 | Robustesse : `safeRender()` (dashboard + popup) + pas de crash sur assertion libellés stats - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.57** | 2026-05-27 | Stats : `aggregateByGroupKey` + `normalizeStatsGroupKey` (fusion http/https, une ligne par hôte en légende) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.55** | 2026-05-27 | Stats : fusion finale par parent URL via `groupKey` normalisé (jour/semaine/insights) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.53** | 2026-05-27 | Dashboard : invariant **Actif ⊆ Ouvert** (multi-fenêtres) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.52** | 2026-05-27 | Calendrier : z-index chronologique des cartes (Ouvert + Actif) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.51** | 2026-05-27 | Calendrier Actif : plage visuelle = temps actif (pas ouverture) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.50** | 2026-05-27 | Calendrier : toggle Ouvert / Actif (remplace Précis / Empilé), layout horizontal commun - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.49** | 2026-05-27 | Calendrier empilé : même créneau → cartes côte à côte (max 4 + « +N ») - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.48** | 2026-05-27 | Calendrier : pas de carte avant `start`, troncature live à now, position Y réelle - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.47** | 2026-05-27 | Calendrier : refactor Précis (actif only, 1 gagnant/chevauchement, hauteur réelle) vs Empilé - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.46** | 2026-05-27 | Calendrier : zoom vertical 200 % par défaut sur la semaine courante (sans préférence session) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.45** | 2026-05-27 | Calendrier empilé : clic carte → modal centrée (`openStackSiteCardModal`) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.44** | 2026-05-27 | Calendrier : panneau `#block-picker` agrandi (360px, 200px min, barre site) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.43** | 2026-05-27 | Stats : couleurs doughnut strictement distinctes ; calendrier empilé : clic carte → panneau, sans ≡ - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.42** | 2026-05-27 | Calendrier : panneau ≡ carte site — liste onglets visible + plancher hauteur picker - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.41** | 2026-05-27 | Stats : couleurs uniques par vue doughnut (`assignColorsForItems`) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.40** | 2026-05-27 | Calendrier empilé : pile verticale même créneau + bouton ≡ restauré - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.39** | 2026-05-27 | Insights : toggle Jour masque bien la semaine (CSS `[hidden]`) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.38** | 2026-05-27 | Calendrier : ancrage prévisible du panneau `#block-picker` (flip, colonne, scroll) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.37** | 2026-05-27 | Calendrier empilé : clic carte → panneau liste direct (sans ≡ ni chevron mono-site) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.36** | 2026-05-27 | Calendrier : zoom vertical recale le scroll sur la ligne now - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.35** | 2026-05-27 | Stats : couleur fixe par site (`groupKey`) sur tous les doughnuts et légendes - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.34** | 2026-05-27 | Calendrier empilé : 1 carte par site (`groupKey`) par créneau 15 min - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.33** | 2026-05-27 | Calendrier : zoom vertical 50 %–400 % (4× max) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.32** | 2026-05-27 | Calendrier : slider zoom vertical (50 %–200 %), persistance session, recalcul grille/blocs - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.31** | 2026-05-27 | Panneau liste calendrier : icônes expand/externe en CSS pur (plus de carrés vides) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.30** | 2026-05-27 | Calendrier : correctif clustering mode empilé incohérent entre jours - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.29** | 2026-05-27 | Stats : Insights jour (toggle Semaine | Jour, suivi `statsSelectedDay`) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.28** | 2026-05-27 | Calendrier : toggle stack/unstack, survol mode précis, icône ≡ liste, clic consolidé → modal - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.27** | 2026-05-27 | Correctif encodage UTF-8 (mojibake UI dashboard + docs) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.26** | 2026-05-27 | Calendrier : hauteur min 15 min, bordure ratio A/O, plage horaire réelle - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.25** | 2026-05-27 | Dashboard : clic légende camembert (jour + semaine) → modal détail groupe - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.24** | 2026-05-27 | Dashboard : liens URL / groupe cliquables dans les modales - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.23** | 2026-05-27 | Stats : grille 3+1, carte semaine pleine largeur, dual A/O (2 camemberts + liste) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.22** | 2026-05-27 | Stats : carte "Répartition par jour  (sélection jour, même UX doughnut) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.21** | 2026-05-26 | Stats : UX colonne doughnut (taille stable, liste pleine hauteur, chronos lisibles) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.20** | 2026-05-26 | Stats : liste sites sous le doughnut (chrono Actif/Ouvert, sans légende Chart.js) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.19** | 2026-05-26 | Stats : carte Insights semaine  la place du graphique Ouvert vs actif - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.18** | 2026-05-26 | content.js : zro erreur Uncaught après rechargement extension (contextDead + cleanup) - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.17** | 2026-05-26 | Calendrier : axe scroll synchronis, plage 00 - 24h locale, scroll auto  now  - voir [CHANGELOG.md](./CHANGELOG.md) |
| **1.0.16** | 2026-05-26 | Stats : correctif graphiques vides (`renderCharts` / `live`) + UX données vides - voir [CHANGELOG.md](./CHANGELOG.md) |
| 1.0.15 | 2026-05-26 | Popup : compteur groupes/onglets  ct de  Onglets suivis  - voir [CHANGELOG.md](./CHANGELOG.md) |
| 1.0.14 | 2026-05-26 | Stats : agrégation unifie jour calendaire (14 j / semaine / doughnut) - voir [CHANGELOG.md](./CHANGELOG.md) |
| 1.0.13 | 2026-05-26 | Dashboard : effacement des données (durée minutes / heures / jours) - voir [CHANGELOG.md](./CHANGELOG.md) |
| 1.0.12 | 2026-05-26 | Stats : toggle Actif/Ouvert limit au doughnut ; barres 14 j en double srie - voir [CHANGELOG.md](./CHANGELOG.md) |
| 1.0.11 | 2026-05-26 | Panneau calendrier : groupes dépliés persists au refresh live |
| 1.0.10 | 2026-05-26 | Stats : tooltip graphique Ouvert vs actif (`formatDurationFull`) |
| 1.0.9 | 2026-05-26 | Panneau calendrier + popup : regroupement par `groupKey` |
| 1.0.8 | 2026-05-26 | Statistiques : toggle Actif / Ouvert (doughnut + barres 14 j ; primtre doughnut seul depuis v1.0.12) |
| 1.0.7 | 2026-05-26 | Calendrier : blocs consolidés multi-onglets + panneau liste + moins de bruit visuel / clignotement |
| 1.0.6 | 2026-05-26 | `lib/format-duration.js` : durées lisibles (compact + tooltips) - dashboard, popup, Chart.js |
| 1.0.5 | 2026-05-26 | dashboard.js : stats Chart.js sans destroy/recreate en boucle ; calendrier refresh lger |
| 1.0.4 | 2026-05-26 | content.js : messagerie dfensive (contexte invalid, SW absent) |
| 1.0.3 | 2026-05-26 | Dashboard : calendrier lisible, modal détail, onglet Statistiques Chart.js |
| 1.0.2 | 2026-05-26 | **A** uniquement onglet actif fenêtre courante |
| 1.0.1 | 2026-05-26 | Correctif temps actif (A)  0 |
| 1.0.0 | - | Version initiale MV3 (popup, options, dashboard) |

## Dépôt Git

- Remote : `git@github.com:vincentchauvaux/og-time-tab.git`
- Branche : `master`
- Dernier push : 2026-06-04 — commit initial v1.0.78 (extension complète, `.gitignore` exclut `node_modules` et `package-lock.json` ; sauvegardes locales `*.bak-*` non versionnées).

## 0tat du projet

- Extension MV3 fonctionnelle (v1.0.92)
- Popup, options, dashboard calendrier + stats Chart.js
- Modal détail bloc calendrier (URL / groupe en liens sécurisés) ; panneau liste multi-onglets (créneaux chevauchants, lignes par `groupKey`)
- Popup : onglets suivis regroupés par site/groupe (totaux O/A), compteur groupes/onglets dans l"en-tête de liste, et schéma temporel "sessions du jour" (Chart.js)
- Focus fenêtre + onglet actif pour **A**
- Regroupement URL configurable

## Limitations connues

- Service worker peut tre suspendu par Chrome ; le tick reprend via alarmes et messages d"activité.
- Aprs **Recharger** l'extension, les onglets déjà ouverts gardent l"ancien content script jusqu" **F5** ou rinjection (`executeScript` au chargement d"onglet). v1.0.18 : plus d"erreurs `Uncaught` / `Extension context invalidated` (couteurs dtachs, `contextDead`) ; le tracking humain ne reprend qu"après refresh de la page ou nouvelle navigation.
- Pages `chrome://` et `chrome-extension://` non suivies.
- Pas d"icnes PNG dans le manifest (avertissement possible  l"installation).
- Chevauchement calendrier : **Ouvert** = 1 carte par `groupKey` par créneau 15 min (tous onglets ouverts, min 15 min) ; **Actif** = plage visuelle temps actif uniquement (≥ 30 s, ancrage activité, min hauteur 5 min, binning layout 5 min, layout horizontal max 4 + « +N ») (v1.0.60).
- Graphiques stats : carte **semaine** = Actif + Ouvert simultans (pas de toggle) ; carte **jour** = toggle Actif/Ouvert ; semaine affichée = carte pleine largeur + **insights** ; jour sélectionn indpendant (sauf **Aujourd'hui**) ; 14 j en double srie fixe (v1.0.12).
- Pas d"export CSV / sync cloud.
- Effacement : pas de corbeille / restauration ; confirmation obligatoire dans la modal.

## 0volutions possibles

- Icnes, export, dition manuelle des blocs (rouge  manuel )
- Effacement slectif par site / groupe
- Clic sur tranche vide du calendrier pour crer une entre
- Offscreen document pour tick plus rgulier en arrière-plan
