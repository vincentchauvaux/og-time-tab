# Changelog

## [1.0.92] - 2026-09-22

### Ajouté

- **Statistiques - Répartition par jour** : bouton **Résumé** (à côté Actif/Ouvert) télécharge un CSV de **toutes les sessions du jour** sélectionné (historique + live) : titre, URL, groupe, début/fin, O/A en secondes et libellés.

## [1.0.91] - 2026-08-21

### Modifié

- **Calendrier - mode Actif** : hauteur minimale = **titre seul** (~22 px) ; durée + plage horaire uniquement au **survol** (carte qui s'agrandit). Moins de zones hachurées sur les sessions courtes.

## [1.0.90] - 2026-08-21

### Modifié

- **Calendrier - mode Actif** : les fines bandes sont remplacées par un **mini-graphique aire** (gris = Ouvert, vert = Actif), même langage visuel que le schéma modal, **orienté verticalement** (temps de haut en bas) dans chaque carte, limité à **10 %** de la largeur pour rester discret.

## [1.0.89] - 2026-08-21

### Ajouté

- **Calendrier - mode Actif** : dans chaque carte, **bandes vertes verticales** (haut → bas) indiquent les rafales d'activité réelle à l'intérieur de la plage affichée (ex. 16 min actifs en 2 pics dans une box d'~1 h). Les segments sont conservés lors de la fusion des rafales du même site.

## [1.0.88] - 2026-08-20

### Corrigé

- **Calendrier - temps Ouvert des cartes** : `O` (et totaux modal / picker) utilisent une **union temporelle** des plages d'ouverture par site, plus la somme des onglets parallèles — finit les affichages impossibles (ex. plage `10:42–13:50` avec `O 11 h`).

## [1.0.87] - 2026-08-20

### Modifié

- **Calendrier - zoom vertical** : défaut **400 %** sur la semaine courante (sans préférence `sessionStorage`), au lieu de 200 %.

## [1.0.86] - 2026-08-20

### Ajouté

- **Logo horloge** : icônes PNG (`icons/icon16`–`128`) pour la barre d'outils Chrome / `chrome://extensions` ; logo affiché dans les en-têtes popup, dashboard et options. Plein format (bord à bord), transparence uniquement dans les **coins arrondis**.

## [1.0.85] - 2026-08-20

### Corrigé

- **Statistiques - répartition par jour / semaine (camemberts + légende)** : les durées Ouvert/Actif par site utilisent désormais une **union temporelle** par groupe (comme les barres 14 j et les totaux Insights), au lieu de sommer les onglets parallèles. Corrige les totaux impossibles (ex. 6 h ouvert alors que la journée écoulée est ~2 h 30).

## [1.0.84] - 2026-08-20

### Modifié

- **Calendrier - présentation Actif ↔ Ouvert inversée** : **Actif** affiche les sessions actives en cartes **côte à côte** (lanes, max 2 + « +N ») ; **Ouvert** affiche les onglets ouverts en **bloc fusionné** multi-lignes lorsque les plages se chevauchent. Données inchangées (filtre actif / plages ouvertes). Compact au survol et libellés v1.0.83 conservés.

## [1.0.83] - 2026-08-20

### Modifié

- **Calendrier - cartes plus lisibles** : au repos, les cartes **Ouvert** et **Actif** n'affichent que le **nom de site** (hostname sans `www.`) ; au **survol** / focus, révélation de la plage et des durées. En mode Actif, la durée n'affiche plus le suffixe « actif » (ex. `18 min` seul). Layout fusionné Actif et toggle Ouvert/Actif inchangés ; clic → modal détail inchangée.

## [1.0.82] - 2026-06-24

### Modifié

- **Calendrier - vue Actif (lisibilité v2)** : plancher visuel relevé (**10 min** / **48 px**) pour les sessions courtes isolées. Les blocs qui **se chevauchent** sont fusionnés en **un seul bloc** avec une ligne par site, empilées dans l'**ordre chronologique** (site, durée active, plage horaire) ; clic sur une ligne → modal du site.

## [1.0.81] - 2026-06-24

### Modifié

- **Calendrier - vue Actif (lisibilité)** : regroupement par créneaux **15 min** (au lieu de 5), fusion des rafales du même site si écart ≤ 20 min, tri par temps actif décroissant, max **2** cartes visibles + « +N ». Plusieurs sites au même créneau → **pile verticale** pleine largeur (fini les fines bandes illisibles). Cartes compactes : nom du site + durée active en évidence, plage horaire en sous-texte.

## [1.0.78] - 2026-06-03

### Corrigé

- **Statistiques - graphiques barres et chronologie** : les cartes « Temps réel par jour (14 jours) » et « Chronologie activité » remplissent désormais la hauteur utile de leur bloc bento (conteneur `.chart-grow-wrap`, `maintainAspectRatio: false` sur le bar chart 14 j, `resize` debounced) — fin de l'espace vide sous le graphique.

### Modifié

- **CSS stats** : suppression du `max-height: 280px` global sur tous les `canvas` des `.chart-card` (les doughnuts conservent leur zone fixe 210px via `.doughnut-chart-area`).

## [1.0.77] - 2026-06-03

### Corrigé

- **Statistiques - légende doughnut dual (barres Actif/Ouvert)** : suppression du plancher artificiel `Math.max(2, …)` sur les largeurs en % et du `min-width: 2px` CSS — les barres sont désormais strictement proportionnelles aux secondes brutes sur l'échelle commune `max(Ouvert)` du top 8 (trace 1 px uniquement si valeur > 0).

## [1.0.76] - 2026-06-03

### Corrigé

- **Statistiques - légende doughnut dual (semaine A/O)** : les barres Actif et Ouvert partagent désormais la même échelle (`max Ouvert` de la liste affichée) au lieu d'être normalisées séparément sur leur propre maximum — corrige le cas où un site leader (ex. A 1 h, O 20 h) affichait les deux barres à 100 %.

## [1.0.75] - 2026-06-03

### Corrigé

- **Calendrier - placement temporel des cartes** : le bas de chaque carte est désormais aligné sur l'heure de fin réelle (`visualEndMin`). Le plancher de lisibilité (15 min en Ouvert, 5 min en Actif) s'étend vers le haut au lieu de dépasser sous l'heure de fin — corrige l'effet « carte après 17h30 » pour une session se terminant à 17h34.
- **CSS calendrier** : suppression du `min-height: var(--block-min-h)` sur `.block` qui forçait parfois une hauteur minimale au-delà de la durée réelle malgré le `height` calculé en JS.

### Modifié

- **Calendrier - présentation** : zone hachurée en tête de carte lorsque le plancher lisibilité est actif (sessions courtes) ; marqueur de fin (trait + libellé `HH:MM`) en bas de carte pour indiquer explicitement l'heure de fin réelle.

## [1.0.74] - 2026-06-02

### Modifié

- **Statistiques - Chronologie activité (scope Jour/Semaine)** : les points de courbe sont désormais **masqués sur les portions plates répétées** (voisins gauche/droite identiques), ce qui supprime l'effet visuel "collier de perles" tout en conservant des marqueurs sur les ruptures/pics.
- **Hover chronologie** : `pointHoverRadius` suit la même logique (pas de hotspot sur plateau interne), avec survol conservé sur les points significatifs de changement.
- **Style spikes bucket 1 h** : rendu bucket 1 h, tensions et couleurs existants inchangés.

## [1.0.73] - 2026-06-02

### Modifié

- **Statistiques - Chronologie activité (scope Jour/Semaine)** : abandon du rendu cumulatif au profit d'un profil **par buckets 1 h** (delta par période) dans les deux scopes, avec invariants conservés `A <= O` via la source unifiée d'intervalles.
- **Scope Semaine** : la carte affiche désormais une chronologie temporelle continue en buckets horaires sur la semaine affichée (spikes lisibles), avec axe X en jours (`lun`...`dim`) sans pente artificielle "totaux jour".
- **Scope Jour** : la règle "1 point par heure" est conservée, mais chaque point représente le **bucket horaire** (non cumulatif), aligné visuellement avec la chronologie du groupe.
- **Tooltips** : libellés explicites `Ouvert (bucket 1 h)` / `Actif (bucket 1 h)` + créneau horaire (`HH:MM-HH:MM`) pour clarifier la sémantique.
- **UI titre** : texte de la carte chronologie ajusté pour refléter la nouvelle lecture "profil temporel par bucket".

## [1.0.72] - 2026-06-02

### Modifié

- **Statistiques - Chronologie activité (bento)** : granularité désormais **fixe à 1 heure** en scope **Jour** (24 points `00h` → `23h`) avec courbes cumulées `Ouvert/Actif` et tooltips alignés sur chaque bucket horaire.
- **Scope Semaine** : conservation des **7 totaux jour** pour la lecture macro, avec un **profil intrajournalier horaire** (`1 h`) dans les tooltips, cohérent avec la demande "point par heure" côté détail.
- **UI** : suppression du sélecteur **Granularité** dans la carte Chronologie activité (HTML/CSS/JS) pour éviter toute ambiguïté et refléter le comportement fixe.
- **Invariants métriques** : source unifiée conservée (`A <= O`, bornes `today`) sans divergence entre la chronologie et les autres agrégations stats.

## [1.0.71] - 2026-06-02

### Modifié

- **Statistiques - Chronologie activité (scope Semaine/Jour)** : la carte ajoute un contrôle de granularité (`15 min` / `1 h` en semaine, `5 min` / `15 min` / `1 h` en jour) avec persistance session, sans changer les autres toggles existants.
- **Scope Semaine** : l'axe conserve les 7 jours (totaux jour), mais les tooltips affichent désormais un **profil intrajournalier** (top plages horaires avec delta `A/O`) calculé depuis la même source unifiée d'intervalles.
- **Scope Jour** : la chronologie reste cumulative, mais la granularité est configurable ; les tooltips indiquent maintenant la plage du bucket + delta du bucket + cumul, tout en conservant les bornes `00:00 -> now` et l'invariant `A <= O`.
- **UI bento** : ajout d'un mini sélecteur "Granularité" dans l'en-tête de la carte chronologie pour une lecture plus détaillée sans surcharger la grille.

## [1.0.70] - 2026-06-02

### Corrigé

- **Calendrier (Ouvert/Actif) - borne de fin des cartes** : une session live n'est plus prolongée automatiquement jusqu'à `now` ; la fin utilisée pour le rendu est bornée par `start + openSeconds` (avec petite tolérance tick live), ce qui évite les étirements fantômes quand un segment live est stale/non flush.
- **Cohérence carte vs modale/schéma jour** : les cartes calendrier utilisent désormais la même borne temporelle effective que les sessions source, ce qui aligne la plage verticale affichée avec la plage détaillée en modal.
- **Layout horizontal multi-sites** : suppression de l'extension artificielle de hauteur via rangée partagée (`stackSlotEndMin`) ; les cartes côte à côte gardent leur propre `start/end` réel (lane layout), y compris lorsqu'un autre site du même bin reste actif plus longtemps.

## [1.0.69] - 2026-05-28

### Corrigé

- **Chronologie activité (scope Jour)** : la courbe est désormais **cumulative intra-journée** (buckets 15 min), ce qui aligne la valeur finale du jour avec le total utilisé par **Temps réel par jour (14 jours)** (tolérance d'arrondi).
- **Chronologie activité (scope Semaine)** : affichage simplifié en **totaux par jour** (7 points lun->dim) pour une lecture cohérente avec les agrégations journalières.
- **Sémantique clarifiée** : titre et séries explicitent le mode (`cumul` en jour, `total jour` en semaine) ; tooltips harmonisés en durées formatées.
- **Invariants conservés** : garde `A <= O` et borne aujourd'hui (`startOfDay -> now`) inchangées via la même source unifiée d'intervalles union.

## [1.0.68] - 2026-05-28

### Corrigé

- **Source de vérité unifiée (Stats)** : les barres **14 jours**, les **Insights (jour/semaine)** et la **Chronologie activité** reposent maintenant sur les mêmes helpers d'union journalière.
- **Fenêtres temporelles harmonisées** : pour aujourd'hui, toutes les vues sont bornées à `startOfDay -> now` (plus de décalage implicite entre un jour plein et un jour en cours).
- **Règle métier explicite** : `A <= O` est appliquée de façon cohérente sur les agrégations journalières et sur les buckets de chronologie.
- **Chronologie activité** : abandon du pipeline séparé basé sur sessions pondérées ; le chart est désormais alimenté par les intervalles union `Ouvert`/`Actif` consolidés par jour, ce qui aligne la somme des buckets avec les totaux Insights du même scope (à l'arrondi près).
- **Libellé clarifié** : titre mis à jour en **"Chronologie activité (répartition ...)"** pour réduire l'ambiguïté de lecture.

## [1.0.67] - 2026-05-28

### Corrigé

- **Axes temporels Dashboard (modales + bento chronologie)** : unification de la règle d'axe X par scope pour tous les charts temporels concernés.
- **Scope semaine** : l'axe affiche un label par jour (`lun` ... `dim`) au premier bucket réel de chaque jour, sans dépendre des ticks auto-sautés de Chart.js.
- **Scope jour** : l'axe affiche des heures lisibles (`00h`, `02h`, ...), avec filtrage sur les buckets intrahoraires pour éviter le bruit.
- **Bug "un seul lun"** : suppression de la logique fragile basée sur les ticks rendus ; la détection s'appuie désormais sur l'index bucket temporel calculé depuis `rangeStartMs + index * bucketMinutes`.
- **Tooltips conservés détaillés** : titre temporel complet maintenu (`jour dd/mm hh:mm`) sur les chronologies semaine et jour.

## [1.0.66] - 2026-05-28

### Corrigé

- **Chronologies Dashboard (bento + modale semaine)** : correction du callback des ticks X (jours FR) qui utilisait l'index de tick auto-sauté au lieu de l'index réel de bucket, ce qui pouvait laisser uniquement `lun` affiché.
- **Règle d'affichage jours** : le label est désormais rendu sur le **premier bucket de chaque jour présent** (`lun` ... `dim`) sur la plage visible, même avec beaucoup de buckets intrajournaliers.
- **Lisibilité axe X** : en mode jours (`xWeekdayOnly`), `autoSkip` est désactivé pour éviter la perte des premiers buckets journaliers ; les heures restent masquées sur l'axe.
- **Tooltip inchangé** : le survol conserve la précision date/heure complète (`jour dd/mm hh:mm`).

## [1.0.65] - 2026-05-28

### Modifié

- **Chronologies Dashboard (bento + modale semaine groupe/onglet)** : l'axe X n'affiche plus les heures ; il rend uniquement le **jour abrégé FR** (`lun`, `mar`, `mer`, `jeu`, `ven`, `sam`, `dim`).
- **Lisibilité axe X** : anti-répétition visuelle par déduplication des ticks consécutifs d'un même jour (seul le premier tick du jour est libellé).
- **Tooltips conservés utiles** : le survol affiche une date/heure complète (`jour dd/mm hh:mm`) pour garder la précision temporelle sans charger l'axe.

## [1.0.64] - 2026-05-28

### Modifié

- **Modale stats semaine/groupe** : la section texte "Sessions du groupe (semaine affichée)" est remplacée par une **chronologie Chart.js** (`Ouvert`/`Actif`) sur la semaine affichée, avec agrégation temporelle pondérée en buckets de **30 minutes**.
- **Cycle de vie chart modale** : réutilisation et mise à jour sans animation (`update('none')`) + destruction explicite à la fermeture/changement de contexte, sans fuite ni clignotement.
- **Dashboard Statistiques** : ajout d'une nouvelle carte bento **"Chronologie activité"** (Chart.js), pilotée par le contexte insights (**Semaine** ou **Jour**) et synchronisée avec la sélection du jour.
- **Layout stats** : évolution de la grille vers un style **bento/masonry** moderne (densification desktop, tailles de cartes variées, dark theme conservé, responsive tablette/mobile).

## [1.0.63] - 2026-05-28

### Corrigé

- **Stats - Graphique 14 jours ("Temps réel par jour")** : correction de la surestimation des barres causée par le cumul naïf des onglets parallèles. L'agrégation journalière utilise désormais une **union temporelle** des intervalles ouverts (`O`) au lieu d'une somme tabulaire par onglet.
- **Actif journalier 14j (`A`)** : calcul par union d'intervalles actifs ancrés prudemment en fin de session (et `lastActivityAt` côté live), avec garde stricte **`A <= O`** pour chaque jour.
- **Borne du jour courant** : plafonnement automatique des durées du jour à la fenêtre réelle `startOfDay -> now` pour empêcher toute barre du jour au-delà du temps écoulé.
- **UX** : titre clarifié en **"Temps réel par jour (14 jours)"** pour expliciter la sémantique non-cumulative du graphe.

## [1.0.62] - 2026-05-28

### Corrigé

- **Insights (Jour + Semaine) - KPI "Temps total"** : correction de la surestimation liée aux onglets parallèles. Les totaux `O`/`A` ne sont plus une somme tabulaire par onglet ; ils utilisent désormais une **union temporelle** sur la plage affichée (temps réel couvrant).
- **Temps Ouvert (O)** : union des intervalles ouverts tronqués à la plage d'insight (jour sélectionné ou semaine affichée), avec garde stricte pour éviter de dépasser la fenêtre temporelle.
- **Temps Actif (A)** : approximation prudente par union d'intervalles actifs ancrés en fin de session (et `lastActivityAt` pour le live quand disponible), puis plafonnement `A <= O` afin d'éviter des valeurs non plausibles sans sous-intervalles actifs exacts.
- **UX Insights** : libellé de tuile aligné avec la nouvelle sémantique : **"Temps réel total"** / **"Temps réel total (jour)"**.

## [1.0.61] - 2026-05-28

### Modifié

- **Dashboard - Modale calendrier (`#block-modal`)** : la section textuelle **Sessions du jour (même groupe)** est remplacée par un mini schéma temporel Chart.js (thème sombre) orienté sur la journée du bloc/groupe, avec séries **Ouvert** et **Actif** en buckets de **15 minutes**.
- **Source des données modale** : le schéma agrège les sessions persistées du jour et les segments live du même `groupKey` (si présents ce jour), avec répartition temporelle pondérée pour conserver la cohérence des durées O/A.
- **Lifecycle Chart.js modale** : instance mise à jour en place (`update('none')`) pendant l'ouverture, puis détruite à la fermeture/changement de contexte modal pour éviter les fuites mémoire et les artefacts visuels.
- **UX modale** : ajout d'un état vide explicite sur le schéma et conservation de la section **Onglet du créneau** dans les modales de cartes site.

## [1.0.60] - 2026-05-28

### Modifié

- **Dashboard - Calendrier (mode Actif)** : plancher visuel actif ajusté à **5 minutes** (`ACTIVE_MIN_VISUAL_MINUTES`) pour mieux refléter les micro-sessions sans les étirer comme en mode Ouvert.
- **Layout Actif plus réaliste** : binning temporel des rangées côte à côte affiné à **5 minutes** en mode Actif (`ACTIVE_STACK_BIN_MINUTES`) au lieu de 15 min, afin de réduire les faux parallélismes visuels entre sessions proches mais non simultanées.
- **Mode Ouvert inchangé** : minimum visuel 15 min (`MIN_BLOCK_MINUTES`) et logique de rendu existante conservés.
- **Popup - Sessions du jour** : ajout d’un schéma temporel Chart.js compact (courbes **Ouvert** / **Actif** par heure) sous la liste des onglets, avec état vide explicite et mise à jour fluide via réutilisation d’instance (`update('none')`).

## [1.0.59] - 2026-05-27

### Corrigé

- **Stats - doublons résiduels host identique** : fusion définitive des variantes de clé en mode `origin` et `domain` avec normalisation renforcée (trim, suppression caractères invisibles/non imprimables, host lowercase, suppression point final et `www.`, fallback host robuste depuis clé legacy/url brute).
- **Cause restante identifiée** : des clés distinctes pouvaient survivre via formats legacy (port/protocole/artefacts invisibles) alors que `formatGroupLabel` affichait le même hostname ; la légende et les camemberts conservaient alors plusieurs lignes visuellement identiques.
- **Port/canonique origin stats** : clé canonique unique fixée à `https://host` (sans port) pour éviter les doublons visuels par host en statistiques.
- **Dernier mile défensif** : re-fusion stricte juste avant rendu via map par clé canonique puis map par label canonique ; en cas de collision détectée, les métriques `A/O` sont fusionnées automatiquement (warning console informatif).

## [1.0.58] - 2026-05-27

### Corrigé

- **Dashboard / Popup — écran vide** : ajout d’un filet de sécurité `safeRender()` (try/catch) pour éviter qu’une exception JS (données inattendues, parsing, agrégation) laisse une page entièrement vide. Un bandeau d’erreur explicite est affiché et le détail reste dans la console.
- **Stats — robustesse agrégation** : l’assertion “libellés de distribution dupliqués” ne bloque plus le rendu (warning console au lieu d’une exception).

## [1.0.57] - 2026-05-27

### Corrigé

- **Stats — doublons légende / doughnut (même hôte affiché)** : agrégation unique `aggregateByGroupKey` avec clé canonique `normalizeStatsGroupKey` **avant** tri top 8, camemberts et légende (une seule source de vérité). En mode **origin**, fusion http/https et variantes d’hôte (www, casse) vers `https://hôte` ; en mode **domain**, regroupement eTLD+1. Suppression du post-merge `mergeDistributionGroupsForRender` (trop tardif : clés déjà distinctes au moment des couleurs).
- **Cause** : `formatGroupLabel` n’affiche que le hostname alors que l’agrégation utilisait des `groupKey` origin distincts (`http://…`, `https://…`, port explicite) → 3 lignes identiques, 3 couleurs. Le merge v1.0.56 ré-appliquait `normalizeGroupKeyForStats` (origin stricte) sans unifier le protocole stats.
- **Robustesse** : `renderCharts` charge la config si absente ; assertion post-agrégation sur libellés dupliqués.

## [1.0.56] - 2026-05-27

### Corrigé

- **Regroupement stats (base similaire robuste)** : normalisation canonique renforcée des clés de stats avant agrégation (`host` en lowercase, suppression `www.` / point final, protocole/port normalisés, retrait query/hash pour préfixes, slash stabilisés). En mode `domain`, utilisation d'un eTLD+1 heuristique sûr (fallback sans PSL), en mode `origin`, clé canonique `schéma + hôte + port`.
- **Fusion défensive pré-rendu (jour/semaine/légende)** : ajout d'un post-merge juste avant rendu des distributions ; si plusieurs labels résolvent vers la même base normalisée, les métriques **A/O** sont fusionnées et une seule entrée est conservée dans les doughnuts + légendes.
- **Compatibilité legacy** : les anciennes `groupKey` persistées (URL brutes, hôtes seuls, formes mixtes) sont re-normalisées via une fonction commune dédiée stats, ce qui évite des doublons résiduels comme `leseta2.plesk.graphylabs.com` dans une même vue.

## [1.0.55] - 2026-05-27

### Corrigé

- **Dashboard - Statistiques (fusion parents URL)** : suppression des doublons visuels dans les agrégations jour/semaine/insights causés par des clés hétérogènes (`groupKey` legacy, URL brute, live/persisté mélangés). Une normalisation unique est appliquée avant rendu : la clé parent est recalculée depuis l'URL selon le mode de regroupement actif (`origin`/`domain`/`prefix`/`custom`), puis utilisée partout comme source unique.
- **Agrégations et modales stats** : `A` et `O` sont désormais cumulés sur une seule entrée par parent dans les doughnuts, légendes, top sites insights et détails groupe (jour/semaine), avec conservation des couleurs stables par `groupKey` normalisé.
- **Normalisation hostname** : harmonisation des variantes (`www.`, casse, point final) au niveau de la clé de regroupement pour éviter des entrées séparées pour le même parent.

## [1.0.54] - 2026-05-27

### Corrigé

- **Dashboard - Calendrier (sémantique bordure activité)** : suppression de l'accent de bordure par site introduit en mode empilé (même créneau multi-sites), qui cassait la lecture métier des couleurs. La bordure des cartes calendrier suit désormais une règle unique et continue basée sur `ratio = clamp(activeSeconds / max(openSeconds, 1), 0..1)` en dégradé **rouge -> vert**.
- **Cohérence de rendu toutes cartes** : application de la même logique de bordure aux cartes normales, cartes consolidées site et cartes **`+N`**, avec hover conservant la visibilité sur fond sombre sans changer la sémantique de couleur.

## [1.0.53] - 2026-05-27

### Corrigé

- **Dashboard (Ouvert vs Actif, multi-fenêtres)** : correction d'un cas où un site pouvait apparaître en **Actif** mais pas en **Ouvert** (invariant violé) lorsque certaines données live renvoyaient un `openSeconds` manquant / non-numérique. Le dashboard normalise désormais systématiquement les métriques pour garantir **Actif ⊆ Ouvert** (`openSeconds >= activeSeconds`) lors de la collecte des blocs calendrier et des agrégations Stats (jour/semaine/insights).

## [1.0.52] - 2026-05-27

### Modifié

- **Dashboard - Calendrier (z-index des cartes)** : les blocs calendrier reçoivent désormais un **z-index chronologique** commun aux modes **Ouvert** et **Actif** — les cartes plus récentes (plage horaire plus tardive) passent automatiquement **devant** les plus anciennes lorsqu’elles se chevauchent. L’ordre est calculé à partir du début visuel (`visualStartMin` ou `start`), puis appliqué via un `z-index` par carte ; le survol augmente encore ce `z-index` dans une plage réservée. Les éléments structurants (`#block-modal`, `#erase-modal`, `#block-picker`, ligne now, panneaux Stats) conservent leurs propres piles (`z-index` supérieurs).

## [1.0.51] - 2026-05-27

### Corrigé

- **Dashboard - Calendrier (mode Actif)** : la plage visuelle des cartes correspond désormais au **temps actif** uniquement, plus à la plage d'ouverture de l'onglet. Ex. : 1 min active sur 1 h 45 ouverte → petite carte positionnée sur la durée active (ancrage `lastActivityAt` si live, sinon fin de session), pas une barre de 9:44 à 11:29. Hauteur proportionnelle à la durée active (plancher 3 min / 28 px). Masquage si `activeSeconds` < 30 s (session ou groupe).

### Modifié

- **Dashboard - Calendrier** : `normalizeBlockForCalendar` unifié (`normalizeBlockOpenRange` / `normalizeBlockActiveRange`) ; `buildMetricDisplayItems` commun aux modes Ouvert et Actif ; `clusterVisualRange` n'étend plus à 15 min en mode Actif. Suppression de `visualRangeForRealRange` (mort). Migration `ogTimeTabCalendarViewMode` conservée dans `loadCalendarMetric`.

## [1.0.50] - 2026-05-27

### Modifié

- **Dashboard - Calendrier** : le toggle **Précis | Empilé** est remplacé par **Ouvert | Actif** (`sessionStorage` `ogTimeTabCalendarMetric` = `open` | `active`, migration depuis `ogTimeTabCalendarViewMode`).
  - **Ouvert** : temps et onglets ouverts (logique empilé v1.0.49 — regroupement par `groupKey`, créneau 15 min, rangée horizontale max 4 + « +N », hauteur min 15 min, modal au clic).
  - **Actif** : uniquement les sessions avec `activeSeconds > 0`, agrégation par site, **même présentation** horizontale (pas de pile verticale ni mode « Précis ») ; hauteur selon durée active (plancher 3 min / 28 px sur cartes rangée) ; badges **A · O** sur les deux modes.
- Suppression du mode `unstack` (cartes empilées verticalement / une carte par chevauchement).

## [1.0.49] - 2026-05-27

### Modifié

- **Dashboard - Calendrier (mode empilé)** : plusieurs sites au **même créneau** 15 min s'affichent **côte à côte** (rangée flex `.stack-slot-row`, gap 4 px) au lieu d'une pile verticale — **4 cartes** max visibles ; au-delà, carte **« +N »** → modal liste complète (`openStackSlotSitesModal`, clic site → `openStackSiteCardModal`). `assignStackSiteLayout`, `stackSlotRowLayout`, rendu via rangées flex.

## [1.0.48] - 2026-05-27

### Corrigé

- **Dashboard - Calendrier (cartes avant leur heure)** :
  - Aucune carte si le début réel (`start`) est **strictement futur** (`start > now`).
  - Sessions live ou en cours : `end` tronqué à `now` pour position, hauteur et libellé horaire (plage affichée = plage réelle tronquée).
  - Position Y : `top = timeToY(startMin)` depuis l'heure locale réelle du bloc (plus de décalage via créneau 15 min ou `stackSlotStartMin` hors pile multi-sites).
  - Colonne jour : si `date` et `start` ne tombent pas sur le même jour local, la colonne est déduite de `start` (évite un bloc en haut de grille avec une plage texte correcte).
  - Mode **Précis** : filtrage futur + troncature avant clustering ; `pickMostActiveBlock` inchangé (1 carte par chevauchement).

## [1.0.47] - 2026-05-27

### Modifié

- **Dashboard - Calendrier (refactor Précis / Empilé)** :
  - **Précis** : uniquement les sessions avec `activeSeconds > 0` ; chevauchement → **1 carte** (site/onglet le plus actif), plus de lanes parallèles ; hauteur = **durée réelle** (plancher visuel 2 min, pas de min 15 min) ; titre = label site (`formatGroupLabel`), plage réelle, badges **A · O**.
  - **Empilé** : inchangé sur le fond — cartes par `groupKey` / créneau 15 min, min hauteur 15 min, temps O+A sur carte, clic → modal (`openStackSiteCardModal`).
  - `buildUnstackDisplayItems`, `renderUnstackBlocks` / `renderStackBlocks` ; `blockLayout({ useMinBlockHeight })` false en précis.

## [1.0.46] - 2026-05-27

### Modifié

- **Dashboard - Calendrier** : zoom vertical par défaut **200 %** (`2×`) lorsque la **semaine affichée est la semaine courante** (présent, ligne « now ») et qu'aucune valeur n'est enregistrée dans `sessionStorage` (`ogTimeTabCalendarZoomY`). Autres semaines sans préférence enregistrée : **100 %**. Dès que l'utilisateur règle le slider, la valeur est persistée et réutilisée sur toutes les semaines. Navigation semaine / **Aujourd'hui** : `syncCalendarZoomForDisplayedWeek` + `scrollCalendarToNow` si retour sur la semaine courante.

## [1.0.45] - 2026-05-27

### Modifié

- **Dashboard - Calendrier (mode empilé)** : **clic simple** sur une carte site ouvre la **grande modal centrée** `#block-modal` (même présentation que mode Précis / stats) via `openStackSiteCardModal` — titre site, URL et Groupe cliquables, plage, durée, temps O/A, section **Sessions du jour (même groupe)**, sous-section **Onglets du créneau** (scroll interne). Le panneau latéral `#block-picker` n'est plus ouvert au clic carte (fermé si déjà visible). Modal : `min-width` ~420 px, `max-width` 90 vw, liste sessions scrollable.

## [1.0.44] - 2026-05-27

### Modifié

- **Dashboard - Panneau `#block-picker`** : panneau agrandi au clic carte (mode empilé) — largeur `min(360px, 95 % colonne − 8px)` ; hauteur plancher **200 px** (`BLOCK_PICKER_MIN_HEIGHT`) ; plafond `min(75vh, 520px)` et espace disponible sous/au-dessus la carte (flip inchangé). En-tête et lignes onglet plus aérés (titre jusqu’à 2 lignes, `min-height` ligne **48 px**). Chaque ligne : **barre verticale colorée** à gauche (`border-left` 3px, couleur site via `assignColorsForItems`).

## [1.0.43] - 2026-05-27

### Corrigé

- **Stats - couleurs doughnut** : segments et pastilles pouvaient paraître tous verts lorsque plusieurs sites tombaient sur des teintes proches de la palette 16 (plusieurs verts `#28a745`, `#20c997`, `#4dd4ac`…). Déduplication par **couleur hex** déjà utilisée dans la vue (pas seulement l’index) ; palette **24** teintes distinctes ; repli HSL (angle d’or) au-delà de 24 sites.
- **Calendrier (mode empilé)** : suppression du bouton **≡** ; **clic simple** sur la carte site ouvre `#block-picker` (liste onglets + barres A/O, v1.0.42) ; **double-clic** ouvre la modal groupe. Plusieurs sites au même créneau : bordure **couleur stable par site** (même algorithme que les stats).

### Modifié

- **`lib/chart-colors.js`** : `pickColorForView`, `distinctColorForSlot` ; `assignColorsForItems` garantit l’unicité visuelle sur N items affichés.

## [1.0.42] - 2026-05-27

### Corrigé

- **Dashboard - Panneau `#block-picker` (carte site ≡)** : clic **≡** sur une carte mono-site affichait une boîte sombre quasi vide (souvent seulement les flèches du scroll) — `positionBlockPicker` (v1.0.38) imposait un `max-height` proche de 0 quand l'espace sous la carte était insuffisant et que le flip au-dessus n'était pas meilleur ; plancher **120 px**, choix du côté avec le plus d'espace, double `requestAnimationFrame` après rendu. Liste plate mono-site : onglets depuis `item.members` (tri actif desc), lignes `.block-picker-item` avec barre ratio A/O et badges ; en-tête **domaine · plage · A/O** ; pas de ligne groupe repliable. Multi-groupes (legacy) : groupes multi-onglets toujours dépliés par défaut.

## [1.0.41] - 2026-05-27

### Corrigé

- **Stats - couleurs doughnut** : deux sites différents (ex. grok.com et www.facebook.com) pouvaient partager la même teinte dans **Répartition par jour** lorsque leur `groupKey` tombait sur le même index de palette (hash % 16). `assignColorsForItems` conserve la couleur hash préférée par clé et réassigne la suivante à la prochaine teinte libre dans la liste affichée ; doughnuts jour/semaine (Actif + Ouvert) et légende (pastille + barres %) utilisent la même carte de couleurs.

### Modifié

- **`lib/chart-colors.js`** : palette 16 teintes réordonnée (verts non adjacents) pour un repli plus lisible en cas de collision.

## [1.0.40] - 2026-05-27

### Corrigé

- **Dashboard - Calendrier (mode empilé)** : plusieurs cartes site au même créneau 15 min ne se superposent plus au même `top/left` avec transparence illisible — répartition **verticale** (pile dans la colonne, hauteur min 28 px par carte, gap 2 px) si > 2 sites ; **2 sites ou moins** : côte à côte (lanes horizontales) ; survol porte la carte au premier plan (`z-index`).

### Modifié

- **Dashboard - Calendrier (mode empilé)** : restauration du bouton **≡** (`.icon-menu` / `.block-picker-toggle`) sur chaque carte site — clic **≡** → panneau `#block-picker` (`stopPropagation`) ; **double-clic** sur le corps de la carte → modal détail groupe ; positionnement panneau v1.0.38 et 1 carte par site v1.0.34 inchangés.

## [1.0.39] - 2026-05-27

### Corrigé

- **Dashboard - Insights (toggle Jour)** : le conteneur `#week-insights` restait visible en mode **Jour** car la règle CSS `.week-insights { display: flex }` écrasait l'attribut `[hidden]` — seules les tuiles semaine (plage lun–dim, « Jour le plus actif ») s'affichaient malgré le label « Insights jour ». Ajout de `.week-insights[hidden] { display: none }` ; mode **Jour** n'affiche plus que `#day-insights` avec les données de `statsSelectedDay` (`aggregateDayInsights`). Tuile **Onglet le plus actif** ajoutée en mode jour ; initialisation et early-return de `renderCharts` synchronisent le toggle visuel.

## [1.0.38] - 2026-05-27

### Modifié

- **Dashboard - Calendrier** : positionnement prévisible du panneau `#block-picker` — ancrage à la carte et à la colonne jour (`.col`), préférence sous le bloc aligné à gauche, **flip au-dessus** si la hauteur dépasse l'espace disponible dans `#grid-scroll` ; `max-height` = min(70vh, espace côté choisi − 8px) ; largeur `min(320px, colonne − 8px)` ; recalcul debounced au scroll / zoom / resize ; `z-index` 90 (grille < panneau < modal).

## [1.0.37] - 2026-05-27

### Modifié

- **Dashboard - Calendrier (mode empilé)** : un **clic sur la carte** ouvre directement le panneau `#block-picker` avec la liste des onglets visible — plus de bouton **≡** ni de ligne groupe repliable pour une carte mono-site (`groupKey` unique, v1.0.34). En-tête panneau : **domaine · plage · A/O**. Cartes multi-sites : groupes **tous dépliés** par défaut. **Double-clic** sur la carte → modal détail groupe (ancien clic simple) ; clic sur une ligne onglet → modal session. Modal et panneau ne s'ouvrent pas simultanément.

## [1.0.36] - 2026-05-27

### Modifié

- **Dashboard - Calendrier** : au changement du **zoom vertical** (slider), le scroll de `#grid-scroll` se recale sur la ligne **now** (heure courante, ~28 % du viewport depuis le haut) via `scrollCalendarToNow` — plus de simple conservation du ratio de scroll. Semaine affichée sans le jour courant : repli sur le ratio (navigation historique inchangée). Le tick live (~2 s) ne modifie pas le scroll manuel (`autoScrollToNowIfNeeded` une fois par semaine affichée).

## [1.0.35] - 2026-05-27

### Ajouté

- **Stats - couleurs par site** : module `lib/chart-colors.js` — chaque `groupKey` reçoit une couleur fixe (hash déterministe → palette de 16 teintes lisibles sur fond sombre). Même site = même couleur sur **Répartition par jour**, camemberts semaine (Actif + Ouvert), pastilles et barres proportionnelles de la légende, quel que soit le jour ou le classement.

### Modifié

- **Dashboard** : les doughnuts n'utilisent plus l'index de tri du jour pour colorer les segments ; un nouveau site obtient une couleur stable sans réassigner les autres.

## [1.0.34] - 2026-05-27

### Corrigé

- **Dashboard - Calendrier (mode empilé)** : une carte par site (`groupKey`) par créneau de 15 min — les onglets du même site parent au même moment ne produisent plus N cartes séparées (titres d'onglet) mais une seule carte `mail.google.com` ou `mail.google.com · N onglets` ; plage horaire union, A/O sommés, bordure ratio inchangée ; clic → modal groupe ; mode **Précis** inchangé.

## [1.0.33] - 2026-05-27

### Modifié

- **Dashboard - Calendrier** : zoom vertical étendu à **50 %–400 %** (facteur **0,5×–4×**, pas **5 %**) ; label et attributs ARIA mis à jour dynamiquement ; hauteur max grille ≈ 48 créneaux × 128 px (~6 150 px) avec scroll vertical inchangé.

## [1.0.32] - 2026-05-27

### Ajouté

- **Dashboard - Calendrier** : slider **Zoom vertical** dans la barre calendrier (à côté du bouton Précis/Empilé), couleurs app (piste `#2c313c`, curseur vert `#28a745`).
- **Zoom** : facteur **0,5× à 2×** (50 %–200 % affiché) ; recalcul `slotHPx` / hauteur créneaux, axe horaire, colonnes et repositionnement des blocs (pas de `transform: scale` seul).
- **Persistance** : `sessionStorage` clé `ogTimeTabCalendarZoomY` ; conservation du scroll relatif lors du glissement.

## [1.0.31] - 2026-05-27

### Corrigé

- **Dashboard - Panneau liste calendrier** : icônes expand groupe (▸/▾) et lien externe légende (↗) remplacées par CSS pur (`.icon-chevron`, `.icon-external`) — les glyphes Unicode avaient été vidés lors du correctif encodage, laissant des carrés vides dans `#block-picker`.

## [1.0.30] - 2026-05-27

### Corrigé

- **Dashboard - Calendrier (mode empilé)** : consolidation incohérente entre colonnes/jours — les sessions courtes séquentielles (sans chevauchement strict des timestamps) restaient en blocs séparés avec hauteur min 15 min, donnant l'illusion du mode précis. Clustering aligné sur la colonne `date`, plages visuelles relatives au minuit de la colonne, fusion avec écart ≤ 5 min et plage min `MIN_BLOCK_MINUTES` pour le chevauchement, plus fusion forcée si > 10 clusters dans un même créneau de 15 min.

## [1.0.29] - 2026-05-27

### Ajouté

- **Dashboard - Statistiques** : carte **Insights** avec toggle **Semaine | Jour**. Le mode **Jour** analyse uniquement `statsSelectedDay` (YYYY-MM-DD local) : total O/A, site le plus actif/ouvert, focus %, ratio actif/ouvert, groupes/onglets distincts, top 3 sites actifs, et plage horaire (première → dernière activité). Clic sur une tuile/top → modal détail groupe pour ce jour (réutilise `openGroupModalForDay`).

## [1.0.28] - 2026-05-27

### Ajouté

- **Dashboard - Calendrier** : bouton **Précis** / **Empilé** pour basculer entre mode **stack** (blocs consolidés « N onglets » par chevauchement) et mode **unstack** (une carte par session, colonnes lane si chevauchement).
- **Mode précis** : au survol, la carte s'agrandit (z-index, ombre, texte lisible, largeur colonne) sans ouvrir la modal ; clic = modal session.
- **Persistance** : `sessionStorage` `ogTimeTabCalendarViewMode` (`stack` | `unstack`).

### Modifié

- **Clic bloc consolidé** : ouvre la modal détail du créneau (plus de fractionnement inline au clic, rollback drill-down v1.0.28).
- **Icône liste** : bouton `≡` (trois barres CSS `.icon-menu`) à la place du caractère « 0 » ; `aria-label="Liste des onglets"`.

## [1.0.27] - 2026-05-27

### Corrigé

- **Encodage UTF-8** : correction du mojibake dans l'UI dashboard (`dashboard.html`, `dashboard.js`, `dashboard.css`), `manifest.json` et la documentation ; textes français lisibles (apostrophes ASCII, tirets `-`, séparateurs `·`).
- **Prévention** : fichiers texte en UTF-8 sans BOM ; éviter les guillemets typographiques fragiles dans les sources.

## [1.0.26] - 2026-05-27

### Modifié

- **Dashboard - Calendrier** : hauteur minimale des blocs = **15 minutes** sur l'échelle temps (`MIN_BLOCK_MINUTES`, demi-créneau si `SLOT_MIN` = 30) - sessions très courtes restent lisibles.
- **Style blocs** : fond sombre neutre semi-transparent ; **bordure 2px** dont la couleur interpole **rouge → vert** selon le ratio `activeSeconds / openSeconds` (CSS `--activity-ratio`, `color-mix`).
- **Libellé horaire** : plage réelle (ex. `10:21 - 10:22`) toujours affichée sur le bloc, y compris si la hauteur visuelle est étendue à 15 min.
- **Blocs consolidés** (« N onglets ») : même hauteur minimale et bordure basée sur les totaux **A** / **O** agrégés du cluster ; un seul bloc par chevauchement temporel (inchangé v1.0.7), sans décalage empilé entre clusters non chevauchants.

## [1.0.25] - 2026-05-27

### Ajouté

- **Dashboard - légende camembert** : clic sur une ligne site sous **Répartition par jour** (`#doughnut-legend-day`) ou **Répartition par site / groupe** (semaine, `#doughnut-legend`) → modal détail (groupe, totaux O/A, sessions avec URL cliquables).
- **Jour** : `openGroupModalForDay(groupKey, statsSelectedDay)` - même jour que la carte sélectionne.
- **Semaine** : réutilisation de `openWeekInsightModal` (groupe, semaine affichée).
- **UX** : curseur pointer, `role="button"`, `tabindex="0"` ; icne ****  droite pour ouvrir le site sans ouvrir la modal (`tabindex="-1"`, `stopPropagation` implicite via sélecteur).

## [1.0.24] - 2026-05-27

### Ajouté

- **Dashboard - modales** : champs **URL** et **Groupe** (clé) cliquables dans les popups (session bloc, groupe créneau, insights semaine) - ouverture dans un nouvel onglet (`target="_blank"`, `rel="noopener noreferrer"`).
- **Liste  Onglets du créneau ** : URL affichée en lien (clic n'ouvre pas la modal session enfant).
- **Sécurité** : helper `toSafeHref` - http/https uniquement ; rejet `javascript:`, `data:`, `vbscript:` ; URL relatives préfixées par `https://`.
- **Style** : liens modale bleu clair, soulignement au survol, ellipsis si trop long.

## [1.0.23] - 2026-05-27

### Modifié

- **Dashboard - Statistiques (grille)** : ligne haute **3 colonnes** - Temps par jour (14 j) | Répartition par jour | Insights semaine ; carte ** Répartition par site / groupe ** en **pleine largeur** en dessous (semaine affichée).
- **Carte semaine (pleine largeur)** : layout horizontal (≥ 768px) - **deux camemberts** cte  cte (Actif | Ouvert)  gauche, **liste des sites**  droite avec badges **A** / **O** et deux barres proportionnelles par ligne ; **plus de toggle** Actif/Ouvert sur cette carte.
- **Carte jour** : toggle **Actif | Ouvert** conserv (inchangé fonctionnellement).
- **Agrégation** : `aggregateByGroupForDatesDual` / `aggregateWeekByGroupDual` ; `renderDistributionCard` avec `dualMetric: true` (semaine) vs mode simple (jour).
- **Responsive** : carte semaine en colonne sur mobile (camemberts puis liste).

## [1.0.22] - 2026-05-27

### Ajouté

- **Dashboard - Statistiques** : 40 carte ** Répartition par jour ** (même layout que la colonne semaine : camembert 210px, liste sites + chronos + barres proportionnelles, toggle **Actif | Ouvert**).
- **Sélection du jour** : clic sur une barre du graphique **14 j** ; sélecteur date + flches 9 : sous le titre ; défaut = aujourd"hui ou dernier jour avec données ; persistance `sessionStorage` (`ogTimeTabStatsDay`) ; **Aujourd'hui** (navigation semaine) ramne aussi le jour sur la date du jour.
- **Agrégation** : `aggregateDayByGroup` (un jour `YYYY-MM-DD` local, `groupKey`) ; factorisation `aggregateByGroupForDates`, `upsertDistributionChart` / `renderDistributionCard`, légendes `#doughnut-legend-day` / chart `#chart-groups-day`.

### Modifié

- **Grille stats** : 4 colonnes (≥ 1280px), 22 (≥ 768px), 1 colonne sur mobile ; ordre : 14 j | semaine | jour | insights.

## [1.0.21] - 2026-05-26

### Corrigé

- **Dashboard - Statistiques (colonne milieu, doughnut)** : camembert  taille stable (`#chart-doughnut` 210px, `maintainAspectRatio`, `resize` Chart.js debounced) - plus de rtrcissement au premier rendu.
- **Liste sous le camembert** : occupe toute la hauteur restante de la carte (flex, sans `max-height` 168px) ; scroll uniquement si le contenu dpasse.
- **Chronos légende** : ligne site + durée en badge vert proche du nom, barre proportionnelle (% du max de la semaine) ; `formatDurationShort` + `title` détaill.
- **Grille stats** : `align-items: stretch` et cartes en colonne flex pour aligner la hauteur des 3 panneaux.

## [1.0.20] - 2026-05-26

### Modifié

- **Dashboard - Statistiques (colonne milieu)** : le doughnut  Répartition par site / groupe  n"affiche plus la légende Chart.js  droite ; liste des sites **sous** le camembert avec carr de couleur (segment), libell (`formatGroupLabel`) et chrono selon le toggle **Actif | Ouvert** (`formatDurationShort` + `title` avec `formatDurationFull`) ; tri dcroissant par durée ; mise en page verticale (camembert centr, liste scrollable) ; mise à jour in-place sans clignotement au refresh 2 s / changement de mtrique.

## [1.0.19] - 2026-05-26

### Modifié

- **Dashboard - Statistiques** : le 30 panneau ** Ouvert vs actif (semaine affichée) ** (barres horizontales redondantes avec le graphique 14 j quand une seule journe a des données) est remplac par la carte ** Insights semaine ** - tuiles compactes (temps total O/A, top site actif/ouvert, focus %, jour le plus actif, ratio, top 3 sites, compteurs groupes/onglets, onglet le plus actif si pertinent).
- **Insights** : agrégation sur la semaine affichée (`weekStart`, même rgle v1.0.14 que doughnut / calendrier) ; regroupement par `groupKey` ; titre onglet si session unique ; durées via `format-duration.js` ; clic sur une tuile → modal détail (sessions de la semaine pour le groupe ou l'onglet).
- **Chart.js** : seuls les graphiques **14 j** et **doughnut** restent ; pas de destroy/recreate en boucle sur ces deux graphiques.

## [1.0.18] - 2026-05-26

### Corrigé

- **content.js** : erreur console **Uncaught** `Extension context invalidated` après rechargement de l'extension sans F5 - drapeau `contextDead`, dtachement des couteurs DOM et suppression du listener `onMessage` au premier chec ; accs  `chrome.runtime.id` / `lastError` uniquement dans des blocs try/catch ; messagerie exclusivement via `safeSendMessage` (y compris `GET_CONFIG`).

## [1.0.17] - 2026-05-26

### Corrigé

- **Dashboard - Calendrier** : décalage visuel des blocs et de la ligne  now  par rapport aux libellés horaires - l"axe des heures tait **hors** de la zone scrollable (`grid-scroll`) et restait fixe pendant que la grille dfilait, donnant l"impression d"un décalage de plusieurs heures (ex. bloc affich  15:50  aligné sur le créneau ~05:00).
- **Calendrier** : plage **00:00 - 24:00** (heure locale) avec dfilement vertical unifi ; scroll automatique vers l'heure courante  l"ouverture de la semaine en cours.
- **Positionnement** : `localMinutesFromTs` / `timeToY` (fuseau local, `getHours` / `getMinutes`) ; normalisation des timestamps (`toTimestamp`).

## [1.0.16] - 2026-05-26

### Corrigé

- **Dashboard - Statistiques** : graphiques Chart.js totalement vides - `renderCharts()` utilisait `live` avant `await getLiveState()` (erreur `ReferenceError`, rgression v1.0.14) ; les graphiques ne se craient jamais.
- **Statistiques** : navigation semaine (9 Aujourd'hui :) visible aussi sur l'onglet Statistiques (doughnut +  Ouvert vs actif  suivent `weekStart`).
- **Statistiques** : axes visibles avec données  zro (`suggestedMax` sur les chelles) ; bandeau explicatif si aucune donne ou semaine affichée sans sessions + bouton **Aujourd'hui**.

## [1.0.15] - 2026-05-26

### Ajouté

- **Popup** : compteur discret  ct du titre  Onglets suivis  - nombre de groupes affichs `(N)`, ou `N groupes  M onglets` lorsque plusieurs onglets partagent un même `groupKey` ; mise à jour avec le refresh existant (1 s + `LIVE_UPDATE`).

## [1.0.14] - 2026-05-26

### Corrigé

- **Dashboard - Statistiques** : incohrence  Temps par jour (14 jours)  vs  Ouvert vs actif (semaine affichée)  - la semaine additionnait les sessions par chevauchement horaire **et** tous les onglets live ; le graphique journalier ne comptait que les entres persistées par `date`. Agrégation unifie par **jour calendaire local** ; semaine = somme des 7 jours de `weekStart` (lun - dim) ; live attribu au jour de `segmentStart` comme les sessions flushes.

## [1.0.13] - 2026-05-26

### Ajouté

- **Dashboard** : bouton **Effacer les données** (en-tte) - modal avec durée (nombre + minutes / heures / jours), avertissement irréversible, confirmation dynamique, bouton danger `#dc3545`.
- **Background** : message `ERASE_DATA` - efface `ogTimeTabEntries` dans la fenêtre `[maintenant → durée, maintenant]` ; sessions entirement dans la fenêtre supprimes ; chevauchement tronqué  la limite (secondes O/A au prorata) ; onglets live flush + reset compteurs.
- **`lib/storage.js`** : `computeEraseCutoff`, `applyCutoffToEntry`, `eraseEntriesSince`.

## [1.0.12] - 2026-05-26

### Corrigé

- **Dashboard - Statistiques** : le segmented control **Actif | Ouvert** ne s"applique plus qu"au doughnut  Répartition par site / groupe  (contrle dplac dans l"en-tte de cette carte).
- **Barres 14 jours** : affichage fixe des **deux** séries Ouvert + Actif, indpendant du toggle (comportement d"avant v1.0.8).
- **Ouvert vs actif (semaine)** : inchangé - comparaison fixe des deux métriques.

## [1.0.11] - 2026-05-26

### Corrigé

- **Dashboard - Panneau calendrier** (bloc  N onglets ) : les groupes dépliés () se refermaient immdiatement car `renderBlockPickerList` recrait la liste  chaque tick live (2 s). 0tat `pickerExpandedGroups` (Set en mmoire), restauration  chaque rendu, mise à jour in-place des métriques si la structure des groupes est inchange.
- **Panneau** : `stopPropagation` sur le bouton , la zone enfants et garde sur le clic ligne ; la modal groupe s"ouvre sans fermer le panneau (fermeture : extrieur / Échap).

## [1.0.10] - 2026-05-26

### Corrigé

- **Dashboard - Statistiques** : graphique  Ouvert vs actif (semaine affichée)  - le tooltip affichait des secondes brutes (`Durée: 2/873`) car `plugins: { legend: { display: false } }` crasait le callback tooltip de `chartDefaults()`. Fusion des `plugins` conservant `formatDurationFull` au survol.
- **`formatChartTooltipValue`** : barres horizontales (`indexAxis: 'y'`) - lecture de `parsed.x` (durée) au lieu de `parsed.y` (index de catgorie).

## [1.0.9] - 2026-05-26

### Modifié

- **Panneau calendrier** (bloc  N onglets ) : les lignes sont regroupes par `groupKey` (même logique que stats doughnut / options REGROUPEMENT URL) ; libell site, sous-texte  N onglets , **A** / **O** = sommes du groupe, barre sur le ratio du total, tri par actif dcroissant.
- **Modal** : clic sur une ligne groupe → totaux agrégés du créneau + liste des onglets enfants (clic enfant → détail session).
- **Panneau** : liste repliable () des onglets par groupe quand plusieurs onglets partagent la clé.
- **Popup**  Onglets suivis  : une ligne par groupe avec totaux O/A.
- **`lib/grouping.js`** : `formatGroupLabel()` ; correctif `groupPrefix` (`cfg` au lieu de `config`).

## [1.0.8] - 2026-05-26

### Ajouté

- **Dashboard - Statistiques** : segmented control **Actif** | **Ouvert** (thme sombre, vert `#28a745`) ; choix persist dans `sessionStorage` (`ogTimeTabStatsMetric`).

### Modifié

- **Doughnut**  Répartition par site / groupe  : agrégation par `groupKey` selon la mtrique (`activeSeconds` ou `openSeconds`), semaine affichée + onglets live.
- **Barres 14 jours** : une seule srie selon le mode ; titres des graphiques mis  jour dynamiquement.
- **Ouvert vs actif (semaine)** : graphique horizontal inchangé (comparaison fixe).
- Rafraîchissement Chart.js : `chart.update('none')`, clé `_ogStructureKey` (inclut le mode pour le graphique journalier).

## [1.0.7] - 2026-05-26

### Ajouté

- **Dashboard - Calendrier** : regroupement des sessions qui se chevauchent sur un même jour en un **bloc unique** ( N onglets ) avec panneau liste au clic (titre, URL courte, durées compactes + `title` détaill, barre de fond proportionnelle au ratio actif/ouvert, tri du plus actif au moins actif). Clic sur une ligne → modal stats de la session.

### Modifié

- **Calendrier** : un seul onglet dans un créneau conserve une carte simple (vert/rouge selon ratio actif) ; bordures allges, ombre lgre, plus d'empilement de cartes rouges.
- **Calendrier** : synchronisation DOM par snapshot (structure + métriques) pour éviter le clignotement  chaque tick 2 s (même principe que les graphiques v1.0.5).

## [1.0.6] - 2026-05-26

### Ajouté

- **`lib/format-duration.js`** : formatage des durées en français - affichage compact (une seule unit : s, min, h, j, mois, an) et format détaill pour infobulles (toutes les units non nulles). Seuils : &lt; 60 s, &lt; 1 h, &lt; 24 h, &lt; 30 j, mois = 30 j, anne = 12 mois.

### Modifié

- **Dashboard** : blocs calendrier, modal, axes et tooltips Chart.js (3 graphiques) utilisent le nouveau formatage ; `title` / infobulles au survol en format complet.
- **Popup** : temps O/A en format compact, `title` au survol en format complet.

## [1.0.5] - 2026-05-26

### Corrigé

- **Dashboard - Statistiques** : les graphiques Chart.js ne sont plus dtruits et recrs  chaque rafrachissement (2 s, `storage.onChanged`, `LIVE_UPDATE`). Rutilisation des instances avec `chart.update('none')`, snapshot des données pour ignorer les mises  jour identiques, recréation uniquement si la structure des libellés change.
- **Dashboard - Calendrier** : la grille semaine n"est reconstruite que lors d"un changement de semaine ; entre deux ticks seuls les blocs et la ligne  now  sont mis  jour (évite un re-render DOM complet toutes les 2 s).

## [1.0.4] - 2026-05-26

### Corrigé

- **content.js** : erreurs console après rechargement de l'extension ou service worker indisponible - vérification de `chrome.runtime.id` avant `sendMessage`, gestion de `chrome.runtime.lastError` sur `GET_CONFIG`, try/catch sur le canal de messagerie ( Extension context invalidated ,  Could not establish connection ).

## [1.0.3] - 2026-05-26

### Ajouté

- **Dashboard - onglets** : navigation  Calendrier  |  Statistiques .
- **Calendrier** : blocs plus lisibles (hauteur min, padding, typo, mta O/A), infobulle enrichie, **modal au clic** (titre, URL, groupe, plage, durées, sessions du jour pour le même `groupKey`).
- **Statistiques** : graphiques Chart.js locaux (`lib/chart.umd.min.js`, compatible CSP MV3) - temps par jour (14 j), rpartition par groupe (semaine affichée), ouvert vs actif.

### Modifié

- Créneaux calendrier : 32 px (au lieu de 28 px) pour une grille plus lisible.

## [1.0.2] - 2026-05-26

### Corrigé

- **Temps actif (A)** : incrment uniquement pour l'onglet actif de la fenêtre au premier plan, avec activité humaine rcente (`inactivityMs`). Les onglets en arrière-plan ne cumulent plus **A**, même avec une ancienne activité.
- Focus : signal d"activité seulement pour l'onglet qui reçoit le focus ; plus de ping automatique au chargement du content script sur tous les onglets.
- Synchronisation du focus via `windows.onFocusChanged` et `chrome.tabs.query({ active: true, windowId })`.

## [1.0.1] - 2026-05-26

### Corrigé

- **Temps actif (A)** : injection du content script sur les onglets existants, couteurs attachs immdiatement, config par défaut au dmarrage, signaux d"activité largis (clic, focus), seuils souris assouplis (50 px / 5 s).
