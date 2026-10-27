// Étagère : catalogue de fiches, lecture, révision espacée, progression.
(function () {
  "use strict";
  const CFG = window.ETAGERE_CONFIG || {};
  const MODE = window.ETAGERE_MODE || "site"; // "artefact" ou "site"
  const L = window.ETAGERE_LECTEUR;
  const MEP = window.ETAGERE_MISE_EN_PAGE;
  const LOGO = window.ETAGERE_LOGO;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const echap = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sansAccent = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const pluriel = (n, mot, motP) => `${n} ${n > 1 ? (motP || mot + "s") : mot}`;
  const reduit = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ================= Stockage =================
  const memoire = {};
  const stock = {
    lire(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return k in memoire ? memoire[k] : def; } },
    ecrire(k, v) { memoire[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} if (/^etagere\.(progression\.v1|meta\.v2|domaines)$/.test(k)) window.__etagereModif?.(); }
  };
  const CLE = "etagere.progression.v1";
  let P = stock.lire(CLE, null);
  if (!P || P.v !== 1) P = { v: 1, xp: 0, jours: {}, fiches: {}, cartes: {}, badges: {}, revisions: 0, serieRecord: 0 };
  const sauver = () => stock.ecrire(CLE, P);
  const META = stock.lire("etagere.meta.v2", {});
  const sauverMeta = () => stock.ecrire("etagere.meta.v2", META);
  const jourDe = d => P.jours[d] || (P.jours[d] = { xp: 0, rev: 0, ok: 0, lu: 0 });

  // IndexedDB : fichiers ajoutés depuis l'appareil
  const idb = (() => {
    let db = null; const repli = new Map(), repliR = new Map();
    const ouvrir = () => new Promise(ok => {
      if (db) return ok(db);
      try {
        const r = indexedDB.open("etagere", 3);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains("fichiers")) r.result.createObjectStore("fichiers", { keyPath: "chemin" });
          if (!r.result.objectStoreNames.contains("rendus")) r.result.createObjectStore("rendus", { keyPath: "chemin" });
          if (!r.result.objectStoreNames.contains("cache")) r.result.createObjectStore("cache", { keyPath: "sha" });
        };
        r.onsuccess = () => { db = r.result; ok(db); };
        r.onerror = () => ok(null);
      } catch (e) { ok(null); }
    });
    const tx = async (magasin, mode, fn) => {
      const d = await ouvrir();
      return new Promise((ok, ko) => {
        const t = d.transaction(magasin, mode); const r = fn(t.objectStore(magasin));
        t.oncomplete = () => ok(r && r.result); t.onerror = () => ko(t.error);
      });
    };
    return {
      async tous() { return (await ouvrir()) ? tx("fichiers", "readonly", s => s.getAll()) : [...repli.values()]; },
      async mettre(o) { if (await ouvrir()) return tx("fichiers", "readwrite", s => s.put(o)); repli.set(o.chemin, o); },
      async retirer(ch) { if (await ouvrir()) { await tx("rendus", "readwrite", s => s.delete(ch)); return tx("fichiers", "readwrite", s => s.delete(ch)); } repli.delete(ch); },
      async rendu(ch) { try { return (await ouvrir()) ? await tx("rendus", "readonly", s => s.get(ch)) : repliR.get(ch); } catch (e) { return null; } },
      async mettreRendu(o) { try { if (await ouvrir()) return await tx("rendus", "readwrite", s => s.put(o)); repliR.set(o.chemin, o); } catch (e) {} },
      async cache(sha) { try { return (await ouvrir()) ? (await tx("cache", "readonly", s => s.get(sha)))?.donnees : null; } catch (e) { return null; } },
      async mettreCache(o) { try { if (await ouvrir()) return await tx("cache", "readwrite", s => s.put(o)); } catch (e) {} },
      async retirerRendu(ch) { try { if (await ouvrir()) return await tx("rendus", "readwrite", s => s.delete(ch)); repliR.delete(ch); } catch (e) {} }
    };
  })();
  const VERSION_MEP = 15; // à augmenter quand la mise en page change : les fiches sont remises en page

  // ================= Dates =================
  const jourStr = d => { const x = new Date(d); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
  const auj = () => jourStr(Date.now());
  const plusJours = (s, n) => { const [a, m, j] = s.split("-").map(Number); return jourStr(new Date(a, m - 1, j + n)); };
  const ecart = (a, b) => { const f = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((f(b) - f(a)) / 864e5); };
  const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  const dateLisible = s => { if (!s) return ""; const [a, m, j] = s.split("-").map(Number); return `${j} ${MOIS[m - 1]}${a !== new Date().getFullYear() ? " " + a : ""}`; };
  const dateJour = s => { const [a, m, j] = s.split("-").map(Number); return `${JOURS[new Date(a, m - 1, j).getDay()]} ${j} ${MOIS[m - 1]}`; };
  const dans = n => n <= 0 ? "aujourd'hui" : n === 1 ? "demain" : n < 14 ? `dans ${n} jours` : n < 60 ? `dans ${Math.round(n / 7)} semaines` : `dans ${Math.round(n / 30)} mois`;
  const court = n => n < 14 ? `${n} j` : n < 60 ? `${Math.round(n / 7)} sem.` : `${Math.round(n / 30)} mois`;

  // ================= Niveaux, série, badges =================
  const NOMS = ["Curieux", "Lecteur", "Apprenti", "Studieux", "Lettré", "Érudit", "Savant", "Humaniste", "Encyclopédiste", "Polymathe"];
  const SEUILS = [0, 60, 160, 320, 550, 850, 1250, 1750, 2400, 3200];
  const seuil = i => i < SEUILS.length ? SEUILS[i] : SEUILS[SEUILS.length - 1] + 1200 * (i - SEUILS.length + 1);
  function niveau(xp) {
    let n = 0;
    while (xp >= seuil(n + 1)) n++;
    const bas = seuil(n), haut = seuil(n + 1);
    const nom = n < NOMS.length ? NOMS[n] : "Polymathe " + ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][Math.min(8, n - NOMS.length)];
    return { n: n + 1, nom, bas, haut, frac: (xp - bas) / (haut - bas) };
  }
  function serie() {
    let d = auj(), n = 0;
    if (!(P.jours[d] && P.jours[d].xp > 0)) d = plusJours(d, -1);
    while (P.jours[d] && P.jours[d].xp > 0) { n++; d = plusJours(d, -1); }
    return n;
  }
  const nbLues = () => Object.keys(P.fiches).filter(c => P.fiches[c].lue && trouver(c)).length;
  const BADGES = [
    { id: "premiere", n: "Première fiche", d: "Lire une fiche", s: "1", t: () => nbLues() >= 1 },
    { id: "trois-dom", n: "Esprit large", d: "Lire dans 3 domaines", s: "3", t: () => new Set(Object.keys(P.fiches).filter(c => P.fiches[c].lue).map(c => c.split("/")[0])).size >= 3 },
    { id: "dix-lues", n: "Une rangée", d: "Lire 10 fiches", s: "10", t: () => nbLues() >= 10 },
    { id: "cinquante", n: "Une bibliothèque", d: "Lire 50 fiches", s: "50", t: () => nbLues() >= 50 },
    { id: "serie-7", n: "Une semaine", d: "7 jours d'affilée", s: "7j", t: () => serie() >= 7 },
    { id: "serie-30", n: "Un mois", d: "30 jours d'affilée", s: "30j", t: () => serie() >= 30 },
    { id: "jalons-10", n: "Dix étapes", d: "Valider 10 parties", s: "10", t: () => (P.jalonsTotal || 0) >= 10 },
    { id: "jalons-100", n: "Cent étapes", d: "Valider 100 parties", s: "100", t: () => (P.jalonsTotal || 0) >= 100 },
    { id: "pavé", n: "Un pavé", d: "Finir un document de 100 pages", s: "100p", t: () => Object.keys(P.fiches).some(c => P.fiches[c].lue && (META[c]?.pages || 0) >= 100) },
    { id: "jour-5", n: "Belle journée", d: "Valider 5 parties en un jour", s: "5/j", t: () => Object.values(P.jours).some(j => (j.jal || 0) >= 5) }
  ];

  function gagner(n, raison) {
    const avant = niveau(P.xp).n;
    const j = jourDe(auj());
    const bonus = j.xp === 0 ? 5 : 0;
    P.xp += n + bonus; j.xp += n + bonus;
    P.serieRecord = Math.max(P.serieRecord || 0, serie());
    sauver();
    if (n + bonus) toast(`<span class="xp">+${n + bonus} XP</span><span>${echap(raison)}${bonus ? ", premier pas du jour" : ""}</span>`);
    for (const b of BADGES) if (!P.badges[b.id] && b.t()) { P.badges[b.id] = auj(); sauver(); toast(`<span class="xp">Badge</span><span>${echap(b.n)}</span>`); }
    const apres = niveau(P.xp);
    if (apres.n > avant) setTimeout(() => montee(apres), 500);
    majBarre();
  }

  // ================= Progression : jalons (parties validées) =================
  const jalonsDe = ch => META[ch]?.jalons || [];
  const jalonsFaits = ch => { const f = P.fiches[ch]?.jalons || {}; return jalonsDe(ch).filter(j => f[j.k]).length; };
  function progressionFiche(ch) {
    if (P.fiches[ch]?.lue) return 1;
    const n = jalonsDe(ch).length;
    return n ? jalonsFaits(ch) / n : 0;
  }
  function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

  // ================= Catalogue =================
  let CATALOGUE = [], pret = false, ERREUR_DEPOT = null;
  const PALETTE = ["#8A3341", "#1E6F69", "#A8741C", "#34508F", "#5C4B8C", "#3E7A3A", "#B0532E", "#7B3F72", "#6B6A1E", "#4F6470"];
  function couleurLibre(id, exclure) {
    const prises = new Set(CATALOGUE.map(e => e.domaine).concat(Object.keys(CFG.domaines || {}).filter(k => CATALOGUE.some(e => e.domaine === k))).filter(k => k !== id && k !== exclure).map(k => (CFG.domaines[k] || {}).couleur).filter(Boolean));
    let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    for (let k = 0; k < PALETTE.length; k++) { const c = PALETTE[(h + k) % PALETTE.length]; if (!prises.has(c)) return c; }
    return PALETTE[h % PALETTE.length];
  }
  function infosDomaine(id) {
    CFG.domaines = CFG.domaines || {};
    const c = CFG.domaines[id];
    if (c && c.couleur) return { id, nom: c.nom, couleur: c.couleur };
    const auto = { nom: (c && c.nom) || id.replace(/[-_]+/g, " ").replace(/^./, m => m.toUpperCase()), couleur: couleurLibre(id) };
    if (pret) CFG.domaines[id] = auto;
    return Object.assign({ id }, auto);
  }
  const titreDepuisNom = nom => nom.replace(/\.[^.]+$/, "").replace(/^\d+[\s._-]+/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().replace(/^./, m => m.toUpperCase());
  function entree(chemin, origine, obtenir, extra) {
    const parts = chemin.split("/"), nom = parts[parts.length - 1];
    return Object.assign({ chemin, origine, obtenir, nom, domaine: parts.length > 1 ? parts[0] : "divers", sous: parts.length > 2 ? parts.slice(1, -1).join(" / ") : "", ext: L.extension(nom) }, extra || {});
  }
  function frontMatter(md) {
    const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(md);
    if (!m) return { meta: {}, corps: md };
    const meta = {};
    for (const l of m[1].split("\n")) {
      const k = /^(\w[\w-]*)\s*:\s*(.*)$/.exec(l); if (!k) continue;
      let v = k[2].trim();
      v = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(",").map(x => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : v.replace(/^["']|["']$/g, "");
      meta[k[1].toLowerCase()] = v;
    }
    return { meta, corps: md.slice(m[0].length) };
  }

  async function chargerCatalogue() {
    const liste = new Map();
    if (Array.isArray(window.ETAGERE_EMBARQUE)) for (const f of window.ETAGERE_EMBARQUE) liste.set(f.chemin, entree(f.chemin, "integree", async () => f.contenu));
    if (MODE === "site" && CFG.fichesDuSite === true) {
      try { for (const e of await listerDepot()) liste.set(e.chemin, e); ERREUR_DEPOT = null; }
      catch (err) { ERREUR_DEPOT = nuageActif() ? null : err.message; }
    }
    if (nuageActif()) for (const e of await listerNuage()) liste.set(e.chemin, e);
    try { for (const f of await idb.tous()) liste.set(f.chemin, entree(f.chemin, "ajout", async () => f.donnees, { ajoute: f.ajoute, taille: f.donnees?.byteLength || f.taille || 0 })); } catch (e) {}
    CATALOGUE = [...liste.values()];
    pret = true;
  }

  // --- Mode site : fichiers du dépôt GitHub ---
  function depot() {
    const g = CFG.github || {};
    let owner = g.owner, repo = g.repo;
    if (!owner && /\.github\.io$/.test(location.hostname)) {
      owner = location.hostname.split(".")[0];
      const seg = location.pathname.split("/").filter(Boolean)[0];
      repo = seg && !/\.html?$/.test(seg) ? seg : owner + ".github.io";
    }
    return owner && repo ? { owner, repo, branche: g.branche || "main" } : null;
  }
  async function listerDepot() {
    const r = depot();
    const fabriquer = chemins => chemins.map(ch => entree(ch.replace(/^fiches\//, ""), "depot", async () => {
      const rep = await fetch("fiches/" + ch.replace(/^fiches\//, "").split("/").map(encodeURIComponent).join("/"), { cache: "no-cache" });
      if (!rep.ok) throw new Error(rep.status === 404 ? "GitHub publie encore cette fiche. Réessaie dans une minute." : "Fiche introuvable (" + rep.status + ").");
      return rep.arrayBuffer();
    }));
    const garder = p => /^fiches\/.+\.[^/]+$/.test(p) && !/(^|\/)[_.]/.test(p.replace(/^fiches\//, "")) && !/\/(lisezmoi|readme)\.md$/i.test(p);
    if (r) {
      try {
        let rep = await fetch(`https://api.github.com/repos/${r.owner}/${r.repo}/git/trees/${r.branche}?recursive=1`);
        if (rep.status === 404 && r.branche === "main") rep = await fetch(`https://api.github.com/repos/${r.owner}/${r.repo}/git/trees/master?recursive=1`);
        if (rep.ok) {
          const chemins = (await rep.json()).tree.filter(t => t.type === "blob" && garder(t.path)).map(t => t.path);
          stock.ecrire("etagere.depot", { quand: Date.now(), chemins });
          return fabriquer(chemins);
        }
      } catch (e) {}
    }
    const cache = stock.lire("etagere.depot", null);
    if (cache) return fabriquer(cache.chemins);
    try { const rep = await fetch("fiches.json", { cache: "no-cache" }); if (rep.ok) return fabriquer((await rep.json()).map(p => "fiches/" + p).filter(garder)); } catch (e) {}
    throw new Error("Impossible de lister les fiches du dépôt. Vérifie le dépôt dans config.js.");
  }

  const titreDe = e => META[e.chemin]?.titrePerso || META[e.chemin]?.titre || titreDepuisNom(e.nom);
  // Titres mis au propre : majuscules criardes, numérotation, points de conduite, espaces
  const ROMAIN = /^[IVXLC]+$/;
  // noms propres d'un texte : mots capitalisés au milieu d'une phrase (Marx, Naville, Sartre…)
  function nomsPropres(texte) {
    const n = new Set(), re = /[\p{Ll},;:)]\s+(\p{Lu}\p{Ll}{2,})/gu; let m;
    texte = String(texte).slice(0, 400000);
    while ((m = re.exec(texte))) n.add(m[1].toLowerCase());
    return n;
  }
  function formaliserTitre(t, noms) {
    if (!t) return "";
    t = String(t).replace(/\s+/g, " ").trim()
      .replace(/\s*[.·…_]{3,}\s*\d*\s*$/, "")          // points de conduite d'une table des matières
      .replace(/^[#*•▪◦–—-]+\s*/, "").replace(/[\s:;,–—-]+$/, "").trim();
    const lettres = t.replace(/[^\p{L}]/gu, "");
    if (lettres.length > 3 && lettres === lettres.toUpperCase()) {
      // tout en capitales : casse de phrase, chiffres romains gardés
      t = t.split(" ").map(m => ROMAIN.test(m.replace(/[.)]$/, "")) ? m : m.toLowerCase().replace(/^(\P{L}*)(\p{L}+)/u, (x, a, w) => noms && noms.has(w) ? a + w[0].toUpperCase() + w.slice(1) : x)).join(" ");
      t = t.replace(/([.!?]\s+)(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase());
    }
    t = t.replace(/^(\d+(?:\.\d+)*)\.?\s*(?=\p{L})/u, (m, n) => n + (n.includes(".") ? " " : ". "))  // « 1 Généralités » → « 1. Généralités »
      .replace(/^([IVXLC]+)[.)]?\s+(?=\p{L})/u, (m, n) => n + ". ")
      .replace(/^([A-H])\)\s+/, "$1. ")
      .replace(/^(chapitre|partie|section|livre|leçon|lecon|annexe)\s+(\d+|[IVXLC]+)\s*[.:–—-]?\s*(?=\p{L})/iu, (m, a, n) => a + " " + n + ". ")
      .replace(/\s+([,.])/g, "$1").replace(/\s+/g, " ").trim()
      .replace(/^((?:chapitre|partie|section|livre|leçon|lecon|annexe) (?:\d+|[IVXLC]+)\. |\d+(?:\.\d+)*\.? |[IVXLC]+\. |[A-H]\. )(\p{Ll})/iu, (m, a, b) => a + b.toUpperCase());
    return t.replace(/^(\P{L}*)(\p{Ll})/u, (m, a, b) => a + b.toUpperCase());
  }
  // Nom de fichier → titre lisible : « maths_2-series » → « Maths 2 series »
  const titreFichier = nom => formaliserTitre(titreDepuisNom(nom).replace(/(\p{L})(\d+)$/u, "$1 $2"));
  const titreValable = t => t && t.length >= 3 && t.length <= 140 && /\p{L}{3}/u.test(t) && !/^(untitled|sans titre|document|page \d+)$/i.test(t);
  function domaines() {
    const ids = [...new Set(CATALOGUE.map(e => e.domaine))];
    const ordre = Object.keys(CFG.domaines || {});
    return ids.sort((a, b) => { const ia = ordre.indexOf(a), ib = ordre.indexOf(b); if (ia >= 0 && ib >= 0) return ia - ib; if (ia >= 0) return -1; if (ib >= 0) return 1; return a.localeCompare(b, "fr"); }).map(infosDomaine);
  }
  const fichesDe = d => CATALOGUE.filter(e => e.domaine === d).sort((a, b) => (a.sous || "").localeCompare(b.sous || "", "fr") || a.nom.localeCompare(b.nom, "fr", { numeric: true }));
  const trouver = ch => CATALOGUE.find(e => e.chemin === ch);
  const etat = ch => P.fiches[ch]?.lue ? "lue" : (jalonsFaits(ch) || (P.fiches[ch]?.posOrig?.q || 0) > 0.03) ? "encours" : "nouvelle";
  const ETATS = { nouvelle: "Nouvelle", encours: "En cours", lue: "Lue" };
  const FORMAT = ext => (ext || "?").toUpperCase().slice(0, 5);
  const duree = mots => Math.max(1, Math.round((mots || 0) / 220));

  // ================= Documents : ouverture fidèle et index (titre, pages, sommaire, jalons) =================
  const DOCS = new Map();
  function mdEnHtml(md) {
    let t = frontMatter(md).corps;
    const codes = [], maths = [];
    t = t.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g, m => { codes.push(m); return `CODEPH${codes.length - 1}Z`; });
    t = t.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (m, a, b) => { maths.push({ t: a ?? b, d: true }); return `MATHPH${maths.length - 1}Z`; });
    t = t.replace(/\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?![\s$])([^$\n]+?)(?<!\s)\$(?![\w$])/g, (m, a, b) => { maths.push({ t: a ?? b, d: false }); return `MATHPH${maths.length - 1}Z`; });
    t = t.replace(/CODEPH(\d+)Z/g, (m, i) => codes[+i]);
    let html = window.marked ? window.marked.parse(t, { gfm: true }) : "<pre>" + echap(t) + "</pre>";
    html = nettoyer(html);
    html = html.replace(/<p>\s*MATHPH(\d+)Z\s*<\/p>/g, (m, i) => maths[+i].d ? rendreMath(maths[+i]) : m);
    return html.replace(/MATHPH(\d+)Z/g, (m, i) => rendreMath(maths[+i]));
  }
  function rendreMath(m) {
    if (!window.katex) return `<code>${echap(m.t)}</code>`;
    try { return window.katex.renderToString(m.t, { displayMode: m.d, throwOnError: false, output: "mathml", strict: "ignore" }); }
    catch (e) { return `<code>${echap(m.t)}</code>`; }
  }
  function nettoyer(html) {
    if (!window.DOMPurify) return html;
    return window.DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "script", "iframe", "form", "input", "button", "object", "embed", "svg"], FORBID_ATTR: ["style", "class", "id"] });
  }
  const ENCADRES = {
    retenir: ["retenir", "À retenir"], important: ["retenir", "À retenir"], tip: ["remarque", "Astuce"], note: ["remarque", "Remarque"], remarque: ["remarque", "Remarque"], astuce: ["remarque", "Méthode"], methode: ["remarque", "Méthode"],
    piege: ["piege", "Attention"], warning: ["piege", "Attention"], caution: ["piege", "Attention"], attention: ["piege", "Attention"],
    exemple: ["exemple", "Exemple"], example: ["exemple", "Exemple"],
    def: ["def", "Définition"], definition: ["def", "Définition"], theoreme: ["def", "Théorème"], propriete: ["def", "Propriété"], citation: ["citation", "Citation"]
  };
  function decorer(racine) {
    $$("blockquote", racine).forEach(bq => {
      const p = bq.firstElementChild;
      const m = p && /^\s*\[!([\wéèû-]+)\][ \t]*([^\n<]*)/i.exec(p.innerHTML);
      if (!m) { bq.className = "citation-libre"; return; }
      const t = ENCADRES[sansAccent(m[1])] || ["remarque", m[1]];
      p.innerHTML = p.innerHTML.slice(m[0].length).replace(/^\s*(<br>)?\s*/, "");
      if (!p.innerHTML.trim()) p.remove();
      const a = document.createElement("aside");
      a.className = "encadre " + t[0];
      a.innerHTML = `<div class="encadre-t">${echap(m[2].trim() || t[1])}</div>` + bq.innerHTML;
      bq.replaceWith(a);
    });
    $$("table", racine).forEach(tb => { if (!tb.parentElement.classList.contains("tableau")) { const w = document.createElement("div"); w.className = "tableau"; tb.before(w); w.appendChild(tb); } });
    $$("a[href]", racine).forEach(a => { if (/^https?:/.test(a.getAttribute("href"))) { a.target = "_blank"; a.rel = "noopener"; } });
    $$("math[display='block']", racine).forEach(m => { if (m.parentElement.tagName === "P" && m.parentElement.childNodes.length === 1) m.parentElement.replaceWith(m); });
  }
  // Ouvre le document tel quel : PDF pour la liseuse, HTML fidèle pour les autres formats
  async function ouvrirDoc(e) {
    if (DOCS.has(e.chemin)) return DOCS.get(e.chemin);
    const doc = await L.lire(e.nom, await e.obtenir());
    let res;
    if (doc.genre === "pdf") res = { genre: "pdf", pdf: doc.pdf, titreMeta: doc.titre };
    else {
      const r = document.createElement("div");
      r.innerHTML = doc.genre === "md" ? mdEnHtml(doc.contenu) : doc.genre === "html" ? nettoyer(doc.contenu) : `<figure class="ls-image"><img src="${doc.contenu}" alt=""></figure>`;
      decorer(r);
      let titreDoc = doc.titre;
      if (doc.genre === "md") { const fm = frontMatter(doc.contenu); titreDoc = fm.meta.titre || fm.meta.title || titreDoc; }
      if (!titreDoc) { const h1 = r.querySelector("h1") || (r.querySelectorAll("h2").length === 1 ? r.querySelector("h2") : null); if (h1) titreDoc = h1.textContent; }
      res = { genre: doc.genre, html: r.innerHTML, titreDoc };
    }
    DOCS.set(e.chemin, res);
    return res;
  }
  const VERSION_IDX = 3;
  const pause0 = () => new Promise(r => setTimeout(r, 0));
  // sommaire intégré au PDF (signets)
  async function planSignets(pdf) {
    let o = null; try { o = await pdf.getOutline(); } catch (x) {}
    if (!o || !o.length) return [];
    const plan = [], hauteurs = {};
    const parcourir = async (items, niv) => {
      for (const it of items.slice(0, 500)) {
        try {
          const d = typeof it.dest === "string" ? await pdf.getDestination(it.dest) : it.dest;
          if (d) {
            const idx = typeof d[0] === "number" ? d[0] : await pdf.getPageIndex(d[0]);
            if (!hauteurs[idx]) hauteurs[idx] = (await pdf.getPage(idx + 1)).view[3];
            const h = hauteurs[idx];
            let y = null;
            if (d[1] && d[1].name === "XYZ" && typeof d[3] === "number") y = d[3];
            else if (d[1] && (d[1].name === "FitH" || d[1].name === "FitBH") && typeof d[2] === "number") y = d[2];
            const fy = y == null ? 0 : Math.max(0, Math.min(0.98, (h - y) / h));
            plan.push({ t: (it.title || "").replace(/\s+/g, " ").trim(), pos: idx + 1 + fy, niv });
          }
        } catch (x) {}
        if (it.items && it.items.length && niv < 3) await parcourir(it.items, niv + 1);
      }
    };
    await parcourir(o, 0);
    return plan.filter(x => x.t).sort((a, b) => a.pos - b.pos);
  }
  // sans signets : on repère les titres par la taille des caractères
  function detecterTitres(lignes, N) {
    if (!lignes.length) return [];
    const parTaille = {};
    for (const l of lignes) parTaille[l.s] = (parTaille[l.s] || 0) + l.texte.length;
    const corps = +Object.entries(parTaille).sort((a, b) => b[1] - a[1])[0][0];
    const freq = {};
    const cle = l => sansAccent(l.texte).replace(/\d+/g, "#").replace(/\s+/g, " ") + "|" + Math.round(l.s);
    for (const l of lignes) freq[cle(l)] = (freq[cle(l)] || 0) + 1;
    const MOTS_T = /^(chapitre|partie|section|livre|titre|annexe|introduction|conclusion|lecon|leçon|seance|séance)\b/i;
    let c = lignes.filter(l => {
      const t = l.texte;
      if (t.length < 2 || t.length > 140 || !/\p{L}{2}/u.test(t)) return false;
      if (freq[cle(l)] > Math.max(2, N * 0.25)) return false;
      if (l.s >= corps * 1.14) return true;
      return Math.abs(l.s - corps) < 0.6 && MOTS_T.test(t) && t.length < 90 && !/[.;,]$/.test(t);
    });
    // titres sur plusieurs lignes
    const fus = [];
    for (const l of c) {
      const p = fus[fus.length - 1];
      if (p && p.n === l.n && Math.abs(p.s - l.s) < 0.6 && p.yBas - l.y < l.s * 1.9 && p.yBas > l.y) { p.texte += " " + l.texte; p.yBas = l.y; }
      else fus.push(Object.assign({}, l, { yBas: l.y }));
    }
    c = fus;
    // titre du document (plus grosse taille, une seule fois, en page 1)
    const max = Math.max(...c.map(l => l.s));
    const auMax = c.filter(l => Math.abs(l.s - max) < 0.6);
    if (auMax.length === 1 && auMax[0].n === 1 && c.length > 1) c = c.filter(l => l !== auMax[0]);
    // niveaux selon la taille
    const tailles = [...new Set(c.map(l => l.s))].sort((a, b) => b - a), niveaux = [];
    for (const s of tailles) { const g = niveaux.find(g => Math.abs(g - s) < 0.8); if (!g) niveaux.push(s); }
    const niv = s => { let k = 0, best = 1e9; niveaux.forEach((g, i) => { if (Math.abs(g - s) < best) { best = Math.abs(g - s); k = i; } }); return k; };
    let plan = c.map(l => ({ t: l.texte.replace(/\s+/g, " ").trim(), pos: l.n + Math.max(0, Math.min(0.98, (l.h - l.y - l.s) / l.h)), niv: niv(l.s) })).filter(x => x.niv <= 2);
    if (plan.length > Math.max(60, N * 3)) plan = plan.filter(x => x.niv <= 1);
    return plan;
  }
  // accents « détachés » des PDF LaTeX (´e, `a, ˆo, ¨i, c¸) recomposés
  const ACC = { "´": "\u0301", "`": "\u0300", "ˆ": "\u0302", "^": "\u0302", "¨": "\u0308", "˜": "\u0303" };
  const recomposer = s => s.replace(/([´`ˆ^¨˜])\s?([a-zA-Zıı])/g, (m, a, l) => (l === "ı" ? "i" : l) + ACC[a]).replace(/([cC])\s?¸/g, "$1\u0327").replace(/¸\s?([cC])/g, "$1\u0327").normalize("NFC");
  async function planPdf(pdf) {
    const N = pdf.numPages, textes = [], lignes = [];
    let mots = 0;
    for (let n = 1; n <= N; n++) {
      try {
        const page = await pdf.getPage(n), h = page.view[3], tc = await page.getTextContent();
        const items = tc.items.filter(it => it.str !== undefined);
        const texte = items.map(it => it.str + (it.hasEOL ? "\n" : "")).join("");
        textes.push(texte); mots += (texte.match(/\S+/g) || []).length;
        const ls = [];
        for (const it of items) {
          if (!it.str || !it.str.trim() || !it.transform) continue;
          const s = Math.round(Math.hypot(it.transform[2], it.transform[3]) * 2) / 2, x = it.transform[4], y = it.transform[5];
          let l = ls.find(l => Math.abs(l.y - y) < Math.max(2, Math.min(l.s, s) * 0.45));
          if (!l) { l = { y, s, n, h, b: [] }; ls.push(l); }
          l.b.push({ x, w: it.width || 0, s, t: it.str }); l.s = Math.max(l.s, s);
        }
        ls.sort((a, b) => b.y - a.y);
        for (const l of ls) {
          l.b.sort((a, b) => a.x - b.x);
          let t = "", fin = -1e9;
          for (const b of l.b) { if (t && !/\s$/.test(t) && !/^\s/.test(b.t) && b.x - fin > b.s * 0.18 && !/^[´`ˆ^¨¸˜]$/.test(t.slice(-1))) t += " "; t += b.t; fin = Math.max(fin, b.x + b.w); }
          l.texte = recomposer(t).replace(/\s+/g, " ").trim(); delete l.b; if (l.texte) lignes.push(l);
        }
      } catch (err) { textes.push(""); }
      if (n % 15 === 0) await pause0();
    }
    let plan = await planSignets(pdf);
    if (plan.length < 2) plan = detecterTitres(lignes, N);
    let titre = "";
    try {
      const parTaille = {}; for (const l of lignes) parTaille[l.s] = (parTaille[l.s] || 0) + l.texte.length;
      const corps = +Object.entries(parTaille).sort((a, b) => b[1] - a[1])[0][0];
      const p1 = lignes.filter(l => l.n === 1 && /\p{L}{2}/u.test(l.texte));
      const max = Math.max(...p1.map(l => l.s));
      if (max >= corps * 1.25) {
        const tl = p1.filter(l => Math.abs(l.s - max) < 0.6).slice(0, 3);
        titre = tl.map(l => l.texte).join(" ");
        if (tl.length > 1 && tl[0].y - tl[tl.length - 1].y > max * 2.6 * (tl.length - 1)) titre = tl[0].texte;
      }
    } catch (x) {}
    const noms = nomsPropres(textes.join(" "));
    plan.forEach(x => { x.t = formaliserTitre(x.t, noms); });
    return { plan, textes, mots, titre: formaliserTitre(titre, noms) };
  }
  function planTexte(html) {
    const r = document.createElement("div"); r.innerHTML = html;
    const blocs = [...r.children];
    let hs = $$("h1,h2,h3", r);
    if ($$("h1", r).length === 1 && hs.length > 1 && hs[0].tagName === "H1") hs = hs.slice(1);
    const nivs = [...new Set(hs.map(h => +h.tagName[1]))].sort();
    const plan = hs.map(h => { let b = h; while (b.parentElement !== r) b = b.parentElement; return { t: formaliserTitre(h.textContent), pos: blocs.indexOf(b), niv: nivs.indexOf(+h.tagName[1]) }; }).filter(x => x.t && x.pos >= 0);
    const texte = r.textContent.replace(/\s+/g, " ");
    return { plan, mots: (texte.match(/\S+/g) || []).length, texte, blocs: blocs.length };
  }
  // Jalons : les parties à valider, tirées du sommaire
  function construireJalons(plan, pdf, N, mots, blocs) {
    let niv = 0;
    while (niv < 2 && plan.filter(x => x.niv <= niv).length < 2) niv++;
    let sel = plan.filter(x => x.niv <= niv);
    // une partie par position (titres sur une même ligne fusionnés)
    sel = sel.filter((x, i) => !i || Math.abs(x.pos - sel[i - 1].pos) > (pdf ? 0.03 : 0.5));
    if (sel.length > 36) { const k = Math.ceil(sel.length / 30); sel = sel.filter((x, i) => i % k === 0); }
    const debut = pdf ? 1 : 0, fin = pdf ? N + 1 : blocs;
    let parts;
    if (sel.length >= 2) parts = sel.map((x, i) => ({ t: x.t, s: i ? x.pos : debut, e: i < sel.length - 1 ? sel[i + 1].pos : fin }));
    else if (pdf && N > 12) {
      const n = Math.ceil(N / 10), pas = Math.ceil(N / n);
      parts = Array.from({ length: n }, (_, i) => { const a = 1 + i * pas, b = Math.min(N, (i + 1) * pas); return { t: `Pages ${a} à ${b}`, s: a, e: b + 1 }; });
    } else parts = [{ t: "Tout le document", s: debut, e: fin }];
    return parts.filter(j => j.e > j.s || parts.length === 1).map((j, i) => {
      const xp = pdf ? Math.round(Math.max(10, Math.min(50, 6 + (j.e - j.s) * 3))) : Math.round(Math.max(10, Math.min(40, 8 + mots / parts.length / 120)));
      return Object.assign(j, { k: hash(i + "|" + j.s.toFixed(2)), xp });
    });
  }
  const INDEX_EN_COURS = new Map();
  function indexer(e, force) {
    const m = META[e.chemin];
    if (!force && m && m.v === VERSION_IDX && (!e.taille || m.taille === e.taille)) return Promise.resolve(m);
    if (INDEX_EN_COURS.has(e.chemin)) return INDEX_EN_COURS.get(e.chemin);
    const pr = (async () => {
      const D = await ouvrirDoc(e);
      let r, M;
      if (D.genre === "pdf") {
        r = await planPdf(D.pdf);
        M = { genre: "pdf", pages: D.pdf.numPages, mots: r.mots, plan: r.plan, jalons: construireJalons(r.plan, true, D.pdf.numPages, r.mots) };
      } else {
        r = planTexte(D.html);
        M = { genre: D.genre, pages: 0, mots: r.mots, plan: r.plan, jalons: construireJalons(r.plan, false, 0, r.mots, r.blocs) };
        r.textes = [r.texte];
      }
      M.v = VERSION_IDX; M.taille = e.taille || 0;
      // un titre de chapitre n'est pas le titre du document
      const section = t => M.plan.some(x => x.t === t) || /^(chapitre|partie|section|leçon|lecon|livre|annexe)\b|^(\d+|[IVXLC]+)\.\s/i.test(t);
      const cand = [D.genre === "pdf" ? r.titre : D.titreDoc, D.titreMeta].map(t => formaliserTitre(t, D.genre === "pdf" ? null : nomsPropres(r.texte))).find(t => titreValable(t) && !section(t));
      M.titre = cand || titreFichier(e.nom);
      // les parties déjà validées restent validées si le sommaire est reconstruit
      const ancien = META[e.chemin], fj = P.fiches[e.chemin]?.jalons;
      if (ancien?.titrePerso) M.titrePerso = ancien.titrePerso;
      if (ancien?.jalons && fj) for (const j of M.jalons) { const o = ancien.jalons.find(x => Math.abs(x.s - j.s) < 0.02 || x.t === j.t); if (o && fj[o.k] && !fj[j.k]) fj[j.k] = fj[o.k]; }
      if (fj) sauver();
      META[e.chemin] = M; sauverMeta();
      try { await idb.mettreRendu({ chemin: e.chemin, v: VERSION_IDX, taille: e.taille || 0, data: { textes: r.textes } }); } catch (x) {}
      return M;
    })().finally(() => INDEX_EN_COURS.delete(e.chemin));
    INDEX_EN_COURS.set(e.chemin, pr);
    return pr;
  }
  // indexe en arrière-plan les documents encore inconnus
  let indexation = null;
  function indexerTout() {
    if (indexation) return indexation;
    indexation = (async () => {
      let change = false;
      for (const e of CATALOGUE) {
        const m = META[e.chemin];
        if (m && m.v === VERSION_IDX) continue;
        try { await indexer(e); change = true; } catch (err) {}
        await pause0();
      }
      indexation = null;
      if (change && /^#\/(d\/.*)?$/.test(ROUTE)) rendre(true);
    })();
    return indexation;
  }
  async function textesDe(e) {
    const r = await idb.rendu(e.chemin);
    if (r && r.v === VERSION_IDX && r.data?.textes) return r.data.textes;
    await indexer(e, true);
    return (await idb.rendu(e.chemin))?.data?.textes || [];
  }
  const vue = () => $("#vue");
  const FILE_TOAST = []; let toastActif = false;
  function toast(html) { if (FILE_TOAST.length > 1) FILE_TOAST.splice(0, FILE_TOAST.length - 1); FILE_TOAST.push(html); if (!toastActif) suivant(); }
  function suivant() {
    const t = $("#toast");
    if (!FILE_TOAST.length) { t.hidden = true; toastActif = false; return; }
    toastActif = true; t.innerHTML = FILE_TOAST.shift(); t.hidden = false;
    t.classList.remove("entre"); void t.offsetWidth; t.classList.add("entre");
    setTimeout(suivant, FILE_TOAST.length ? 1500 : 2300);
  }
  function montee(nv) {
    const v = document.createElement("div");
    v.className = "voile";
    v.innerHTML = `<div class="montee" role="dialog" aria-modal="true" aria-label="Nouveau niveau">${LOGO.svg({ trait: 2.4 })}<div class="k">Niveau ${nv.n}</div><div class="nom">${echap(nv.nom)}</div><button class="bouton principal" id="montee-ok">Continuer</button></div>`;
    document.body.appendChild(v);
    const fermer = () => v.remove();
    $("#montee-ok", v).focus();
    $("#montee-ok", v).onclick = fermer;
    v.addEventListener("click", e => { if (e.target === v) fermer(); });
    v.addEventListener("keydown", e => { if (e.key === "Escape") fermer(); });
  }
  const FLAMME = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 4.2 5.5 6.3 5.5 11.4A5.5 5.5 0 0 1 12 19a5.5 5.5 0 0 1-5.5-5.6c0-2.6 1.4-4 2.6-5.2.2 1.7.9 2.8 2.1 3.4C11.4 9.2 10.7 5.6 12 2zM12 22c-3.3 0-6-1.4-6-3.2.9.9 3.2 1.6 6 1.6s5.1-.7 6-1.6c0 1.8-2.7 3.2-6 3.2z"/></svg>`;
  const PLUS = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
  function majBarre() {
    const nv = niveau(P.xp), s = serie();
    $("#niveau-mini").innerHTML = `<span class="obj-mini" id="obj-mini"></span><span class="serie" title="Série">${FLAMME}${s}</span><span class="niv">Niv. ${nv.n}<span class="jauge"><i style="width:${Math.round(nv.frac * 100)}%"></i></span></span>`;
    $("#niveau-mini").setAttribute("aria-label", `Niveau ${nv.n}, ${nv.nom}. Série de ${pluriel(s, "jour")}.`);
    majObjectif();
  }
  function marquerNav(cle) { $$("[data-nav]").forEach(a => a.dataset.nav === cle ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")); }
  const lienFiche = ch => "#/f/" + ch.split("/").map(encodeURIComponent).join("/");
  const lienDom = id => "#/d/" + encodeURIComponent(id);

  function ligneFiche(e) {
    const d = infosDomaine(e.domaine), et = etat(e.chemin), m = META[e.chemin] || {};
    const p = progressionFiche(e.chemin), nj = jalonsDe(e.chemin).length, fj = jalonsFaits(e.chemin);
    return `<a class="fiche-ligne" href="${lienFiche(e.chemin)}" style="--c:${d.couleur};--p:${(p * 100).toFixed(0)}%">
      <span class="t">${echap(titreDe(e))}</span>
      <span class="m"><span class="format">${FORMAT(e.ext)}</span>${m.pages ? `<span>${pluriel(m.pages, "page")}</span>` : m.mots ? `<span>${duree(m.mots)} min</span>` : ""}${nj > 1 && et === "encours" ? `<span class="parties-lues">${fj}/${nj} parties</span>` : ""}<span class="etat ${et}"><i></i>${ETATS[et]}</span></span>
      <span class="barre-p" aria-hidden="true"></span></a>`;
  }

  // ================= File de lecture =================
  const dansFile = ch => (P.file || []).includes(ch);
  function basculerFile(ch) {
    P.file = P.file || [];
    if (dansFile(ch)) P.file = P.file.filter(x => x !== ch); else P.file.push(ch);
    sauver();
    toast(dansFile(ch) ? "Ajoutée à ta file de lecture" : "Retirée de ta file");
  }
  const ETOILE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>`;
  function caseFiche(e, o) {
    o = o || {};
    const ch = e.chemin, f = dansFile(ch);
    const dom = o.dom ? ` data-dom="${echap(o.dom)}"` : "";
    return `<div class="fiche-case" data-ch="${echap(ch)}"${o.glisser ? ` draggable="true"` : ""}>${o.coche && modifiable(e) ? `<input type="checkbox" class="coche" data-ch="${echap(ch)}" aria-label="Sélectionner ${echap(titreDe(e))}">` : ""}
      ${o.menu ? `<button class="plus-fiche" data-menu="${echap(ch)}" aria-label="Options de la fiche"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>` : ""}
      <button class="epingle" data-file="${echap(ch)}" aria-pressed="${f}" aria-label="${f ? "Retirer de" : "Ajouter à"} ma file de lecture" title="${f ? "Dans ta file" : "Lire en priorité"}">${ETOILE}</button>
      ${o.ordre ? `<span class="ordre"><button data-monter="${echap(ch)}"${dom} aria-label="Monter" ${o.premier ? "disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button data-descendre="${echap(ch)}"${dom} aria-label="Descendre" ${o.dernier ? "disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></span>` : ""}
      ${ligneFiche(e)}</div>`;
  }
  document.addEventListener("click", ev => {
    const b = ev.target.closest("[data-file],[data-monter],[data-descendre]");
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    if (b.dataset.file) { basculerFile(b.dataset.file); rendre(true); return; }
    const ch = b.dataset.monter || b.dataset.descendre;
    if (b.dataset.dom) {
      const dom = b.dataset.dom, e = trouver(ch);
      const l = trier(fichesDe(dom), "perso", dom).filter(x => x.sous === e.sous).map(x => x.chemin);
      const k = l.indexOf(ch), v = l[k + (b.dataset.monter ? -1 : 1)];
      if (v) { deplacerDansOrdre(dom, ch, v, !b.dataset.monter); transition(() => rendre(true)); }
      return;
    }
    const i = P.file.indexOf(ch), j = i + (b.dataset.monter ? -1 : 1);
    if (i < 0 || j < 0 || j >= P.file.length) return;
    [P.file[i], P.file[j]] = [P.file[j], P.file[i]]; sauver();
    transition(() => rendre(true));
  }, true);

  let ALLER_MARQUE = null, ALLER_POS = null;
  document.addEventListener("click", ev => { const a = ev.target.closest("[data-vers-marque]"); if (a) ALLER_MARQUE = a.dataset.versMarque; }, true);
  function reprises() {
    return CATALOGUE.filter(e => P.fiches[e.chemin]?.marque?.pos != null).sort((a, b) => (P.fiches[b.chemin].marque.d || "").localeCompare(P.fiches[a.chemin].marque.d || "")).slice(0, 4);
  }

  // ================= Vues =================
  function statsDomaine(id) {
    const fs = fichesDe(id);
    return { n: fs.length, p: fs.length ? fs.reduce((a, e) => a + progressionFiche(e.chemin), 0) / fs.length : 0 };
  }
  function vueAccueil() {
    marquerNav("accueil");
    const doms = domaines(), nv = niveau(P.xp), s = serie();
    if (!CATALOGUE.length) {
      const fantomes = [230, 270, 205, 250, 220].map((h, i) => `<span class="dos fantome" style="--h:${h}px;--l:${58 + i * 3}px"></span>`).join("");
      vue().innerHTML = `
        <div class="etagere"><div class="rayon">${fantomes}<a class="dos vide" href="#/ajouter" style="--h:240px;--l:62px">${PLUS}<span>Ajouter</span></a></div></div>
        <div class="vide-accueil"><h1 class="titre-vue">Ton étagère est vide</h1><a class="bouton principal" href="#/ajouter">Ajouter mes documents</a></div>`;
      return;
    }
    const parDom = doms.map(d => Object.assign({ d }, statsDomaine(d.id)));
    const max = Math.max(1, ...parDom.map(x => x.n));
    const dos = parDom.map(({ d, n, p }) => {
      const h = Math.round(220 + 90 * Math.sqrt(n / max)), l = 62 + (hash(d.id).charCodeAt(0) % 4) * 5;
      return `<a class="dos" href="${lienDom(d.id)}" style="--c:${d.couleur};--p:${(p * 100).toFixed(1)}%;--h:${h}px;--l:${l}px" title="${echap(d.nom)} : ${pluriel(n, "fiche")}, ${Math.round(p * 100)} %">
        <span class="etiquette">${echap(d.nom)}</span><span class="compte">${Math.round(p * 100)}%</span></a>`;
    }).join("");
    P.file = (P.file || []).filter(ch => trouver(ch));
    const file = P.file.map(trouver);
    const enCours = CATALOGUE.filter(e => etat(e.chemin) === "encours" && !dansFile(e.chemin) && !P.fiches[e.chemin]?.marque?.pos)
      .sort((a, b) => (P.fiches[b.chemin]?.ouverte || "").localeCompare(P.fiches[a.chemin]?.ouverte || "")).slice(0, 4);
    const aLire = CATALOGUE.filter(e => etat(e.chemin) === "nouvelle" && !dansFile(e.chemin))
      .sort((a, b) => (P.fiches[b.chemin]?.ouverte || "").localeCompare(P.fiches[a.chemin]?.ouverte || "") || (b.ajoute || "").localeCompare(a.ajoute || ""))
      .slice(0, 6);
    vue().innerHTML = `
      <div class="accueil-tete">
        <h1 class="titre-vue">Ton étagère</h1>
        <div class="statut">
          <div class="stat objectif" id="obj-accueil"><span class="obj-anneau"></span><span><span class="chiffre obj-v"></span><span class="legende">aujourd'hui</span></span><button class="bouton seance-b" id="seance-accueil">${SEANCE ? "Séance en cours" : "Lancer une séance"}</button></div>
          <a class="stat" href="#/progres"><span class="chiffre">${echap(nv.nom)}</span><span class="legende">Niveau ${nv.n}</span></a>
          <a class="stat" href="#/progres"><span class="chiffre dore">${s}</span><span class="legende">${s > 1 ? "jours" : "jour"} de série</span></a>
          <span class="stat"><span class="chiffre">${CATALOGUE.length}</span><span class="legende">${CATALOGUE.length > 1 ? "documents" : "document"}</span></span>
        </div>
      </div>
      <div class="etagere"><div class="rayon">${dos}<a class="dos vide" href="#/ajouter" style="--h:220px;--l:58px" title="Ajouter des fiches">${PLUS}<span>Ajouter</span></a></div></div>
      ${ERREUR_DEPOT ? `<p class="erreur">${echap(ERREUR_DEPOT)}</p>` : ""}
      ${reprises().length ? `<section class="section"><h2 class="section-titre">Reprendre ma lecture</h2><div class="liste">${reprises().map(e => { const d = infosDomaine(e.domaine), m = P.fiches[e.chemin].marque; return `<a class="reprise-carte" href="${lienFiche(e.chemin)}" data-vers-marque="${echap(e.chemin)}" style="--c:${d.couleur}"><span class="ruban" aria-hidden="true"></span><span class="t">${echap(titreDe(e))}</span><span class="x">${echap((m.x || "").slice(0, 80))}</span><span class="m"><span class="jauge-r"><i style="width:${m.q || 0}%"></i></span>${m.q || 0} %</span></a>`; }).join("")}</div></section>` : ""}
      ${enCours.length ? `<section class="section"><h2 class="section-titre">En cours</h2><div class="liste">${enCours.map(e => caseFiche(e)).join("")}</div></section>` : ""}
      ${file.length ? `<section class="section"><h2 class="section-titre">Ma file de lecture</h2><div class="liste file">${file.map((e, i) => caseFiche(e, { ordre: true, premier: i === 0, dernier: i === file.length - 1 })).join("")}</div></section>` : ""}
      ${aLire.length ? `<section class="section"><h2 class="section-titre">À lire</h2><div class="liste">${aLire.map(e => caseFiche(e)).join("")}</div></section>` : ""}`;
    $("#seance-accueil").onclick = ev => { menuSeance(ev.currentTarget); };
    majObjectif();
    indexerTout();
  }

  // ----- Gestion des fiches : déplacer, supprimer, domaines -----
  const modifiable = e => e && (e.origine === "ajout" || e.origine === "nuage");
  async function deplacer(ch, dom, sous) {
    const e = trouver(ch); if (!modifiable(e)) return ch;
    sous = sous === undefined ? "" : String(sous).replace(/\//g, "-").trim();
    const base = dom + "/" + (sous ? sous + "/" : "");
    if (ch === base + e.nom) return ch;
    let neuf = base + e.nom, k = 2;
    const rendu = await idb.rendu(ch);
    if (e.origine === "nuage") {
      while (CATALOGUE.some(x => x.chemin === neuf)) neuf = base + e.nom.replace(/(\.[^.]+)?$/, ` (${k++})$1`);
      await commitNuage([{ chemin: ch, supprimer: true }, { chemin: neuf, sha: e.sha }], "Déplacer " + e.nom);
    } else {
      const tous = await idb.tous();
      const rec = tous.find(r => r.chemin === ch); if (!rec) return ch;
      while (tous.some(r => r.chemin === neuf)) neuf = base + e.nom.replace(/(\.[^.]+)?$/, ` (${k++})$1`);
      await idb.mettre(Object.assign({}, rec, { chemin: neuf }));
      await idb.retirer(ch);
    }
    if (rendu) { await idb.mettreRendu(Object.assign({}, rendu, { chemin: neuf })); await idb.retirerRendu(ch); }
    if (P.fiches[ch]) { P.fiches[neuf] = P.fiches[ch]; delete P.fiches[ch]; }
    for (const id of Object.keys(P.cartes)) if (P.cartes[id].chemin === ch) { const c = P.cartes[id]; delete P.cartes[id]; c.chemin = neuf; P.cartes[neuf + id.slice(ch.length)] = c; }
    if (META[ch]) { META[neuf] = META[ch]; delete META[ch]; }
    if (DOCS.has(ch)) { DOCS.set(neuf, DOCS.get(ch)); DOCS.delete(ch); }
    if (P.file) P.file = P.file.map(x => x === ch ? neuf : x);
    if (P.ordre) for (const d of Object.keys(P.ordre)) P.ordre[d] = P.ordre[d].map(x => x === ch ? neuf : x);
    sauver(); sauverMeta();
    return neuf;
  }
  async function supprimer(ch) {
    const e = trouver(ch); if (!modifiable(e)) return;
    if (e.origine === "nuage") await commitNuage([{ chemin: ch, supprimer: true }], "Supprimer " + e.nom);
    else await idb.retirer(ch);
    delete P.fiches[ch];
    P.supprimes = P.supprimes || {}; P.supprimes[ch] = Date.now();
    for (const id of Object.keys(P.cartes)) if (P.cartes[id].chemin === ch) delete P.cartes[id];
    delete META[ch]; DOCS.delete(ch);
    if (P.file) P.file = P.file.filter(x => x !== ch);
    sauver(); sauverMeta();
  }
  function creerDomaine(nom) {
    const id = sansAccent(nom).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "divers";
    if (!CFG.domaines[id] || !CFG.domaines[id].nom) enregistrerDomaine(id, { nom, couleur: couleurLibre(id) });
    return id;
  }
  function enregistrerDomaine(id, o) {
    CFG.domaines[id] = Object.assign({}, CFG.domaines[id], o, { t: Date.now() });
    const perso = stock.lire("etagere.domaines", {}); perso[id] = CFG.domaines[id]; stock.ecrire("etagere.domaines", perso);
  }
  function choixDomaine(idSel, exclure) {
    return `<select id="${idSel}">${domaines().filter(d => d.id !== exclure).map(d => `<option value="${echap(d.id)}">${echap(d.nom)}</option>`).join("")}<option value="__nouveau">Nouveau domaine…</option></select>`;
  }
  function lireChoix(sel, champ) {
    if (sel.value !== "__nouveau") return sel.value;
    const n = champ.value.trim();
    if (!n) { champ.hidden = false; champ.focus(); return null; }
    return creerDomaine(n);
  }

  const TRIS = { perso: "Mon ordre", titre: "Titre (A → Z)", recent: "Ajout récent", alire: "À lire d'abord", progression: "Moins avancées d'abord", duree: "Plus courtes d'abord" };
  let GESTION = null; // domaine en mode sélection
  const FILTRE = {};  // intercalaire affiché par domaine ("" = tout)
  function trier(liste, mode, id) {
    const base = liste.slice();
    const ordre = (P.ordre || {})[id] || [];
    const rang = e => { const k = ordre.indexOf(e.chemin); return k < 0 ? 1e6 : k; };
    const cmp = {
      perso: (a, b) => rang(a) - rang(b),
      titre: (a, b) => titreDe(a).localeCompare(titreDe(b), "fr", { numeric: true }),
      recent: (a, b) => (b.ajoute || "").localeCompare(a.ajoute || ""),
      alire: (a, b) => ["encours", "nouvelle", "lue"].indexOf(etat(a.chemin)) - ["encours", "nouvelle", "lue"].indexOf(etat(b.chemin)) || (dansFile(b.chemin) - dansFile(a.chemin)),
      progression: (a, b) => progressionFiche(a.chemin) - progressionFiche(b.chemin),
      duree: (a, b) => (META[a.chemin]?.pages || (META[a.chemin]?.mots || 1e9) / 300) - (META[b.chemin]?.pages || (META[b.chemin]?.mots || 1e9) / 300)
    }[mode] || (() => 0);
    return base.sort((a, b) => cmp(a, b) || titreDe(a).localeCompare(titreDe(b), "fr", { numeric: true }));
  }
  function deplacerDansOrdre(id, ch, versCh, apres) {
    const fs = trier(fichesDe(id), "perso", id).map(e => e.chemin);
    const l = fs.filter(x => x !== ch);
    let k = l.indexOf(versCh); if (k < 0) k = l.length; else if (apres) k++;
    l.splice(k, 0, ch);
    P.ordre = P.ordre || {}; P.ordre[id] = l; sauver();
  }
  function intercalairesDe(id) {
    const liste = (CFG.domaines[id]?.inter || []).slice();
    for (const e of fichesDe(id)) if (e.sous && !liste.includes(e.sous)) liste.push(e.sous);
    return liste;
  }
  function enregistrerInter(id, liste) { enregistrerDomaine(id, { nom: infosDomaine(id).nom, couleur: infosDomaine(id).couleur, inter: liste }); }
  const nomLibre = (liste, n) => { let x = n.trim().replace(/\//g, "-"), k = 2; while (liste.includes(x)) x = n.trim() + " " + k++; return x; };

  // ----- Menus contextuels -----
  let MENU = null;
  function fermerMenu() { if (MENU) { MENU.remove(); MENU = null; } }
  document.addEventListener("click", ev => { if (MENU && !ev.target.closest(".menu")) fermerMenu(); }, true);
  document.addEventListener("keydown", ev => { if (ev.key === "Escape") fermerMenu(); });
  window.addEventListener("scroll", () => { if (MENU && !MENU.matches(":hover")) fermerMenu(); }, { passive: true });
  function ouvrirMenu(ancre, titre, items) {
    fermerMenu();
    const m = document.createElement("div");
    m.className = "menu"; m.setAttribute("role", "menu");
    const pile = [];
    const dessiner = (t, its) => {
      m.innerHTML = `${pile.length ? `<button class="menu-retour" data-k="-1">‹ ${echap(t)}</button>` : t ? `<div class="menu-t">${echap(t)}</div>` : ""}` +
        its.map((it, k) => it === "-" ? `<hr>` : it.saisie ? `<form class="menu-saisie" data-k="${k}"><input placeholder="${echap(it.saisie)}" aria-label="${echap(it.saisie)}" value="${echap(it.valeur || "")}"><button class="bouton principal">OK</button></form>`
          : `<button role="menuitem" class="menu-i ${it.danger ? "danger" : ""} ${it.actif ? "actif" : ""}" data-k="${k}" ${it.inactif ? "disabled" : ""}>${it.puce ? `<i style="background:${it.puce}"></i>` : ""}<span>${echap(it.label)}</span>${it.sous ? "<b>›</b>" : it.actif ? "<b>✓</b>" : ""}</button>`).join("");
      $$("[data-k]", m).forEach(b => {
        const k = +b.dataset.k;
        if (b.tagName === "FORM") { b.onsubmit = ev => { ev.preventDefault(); const v = $("input", b).value.trim(); if (v) { fermerMenu(); its[k].valider(v); } }; return; }
        b.onclick = ev => {
          ev.stopPropagation();
          if (k === -1) { const [t2, its2] = pile.pop(); dessiner(t2, its2); return; }
          const it = its[k];
          if (it.sous) { pile.push([t, its]); dessiner(it.label, it.sous()); return; }
          if (it.confirmer && !b.dataset.ok) { b.dataset.ok = 1; $("span", b).textContent = it.confirmer; return; }
          fermerMenu(); it.action();
        };
      });
      $("input", m)?.focus();
      placer();
    };
    const placer = () => {
      const r = ancre.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
      let x = Math.min(window.innerWidth - mw - 12, Math.max(12, r.right - mw)), y = r.bottom + 6;
      if (y + mh > window.innerHeight - 12) y = Math.max(12, r.top - mh - 6);
      m.style.left = x + "px"; m.style.top = y + "px";
    };
    document.body.appendChild(m); MENU = m;
    dessiner(titre, items);
    ($("button:not([disabled])", m))?.focus({ preventScroll: true });
  }
  function menuRanger(id, chemins, apres) {
    const inter = intercalairesDe(id), sousActuel = chemins.length === 1 ? trouver(chemins[0])?.sous : null;
    return [
      ...inter.map(n => ({ label: n, actif: sousActuel === n, action: async () => { for (const ch of chemins) await deplacer(ch, id, n); await chargerCatalogue(); toast(`Rangée${chemins.length > 1 ? "s" : ""} dans « ${echap(n)} »`); apres(); } })),
      { label: "Sans intercalaire", actif: sousActuel === "", action: async () => { for (const ch of chemins) await deplacer(ch, id, ""); await chargerCatalogue(); toast("Sortie de l'intercalaire"); apres(); } },
      "-",
      { saisie: "Nouvel intercalaire", valider: async v => { const l = intercalairesDe(id); const n = nomLibre(l, v); enregistrerInter(id, [...l, n]); for (const ch of chemins) await deplacer(ch, id, n); await chargerCatalogue(); toast(`Rangée${chemins.length > 1 ? "s" : ""} dans « ${echap(n)} »`); apres(); } }
    ];
  }
  function menuDomaines(id, chemins, apres) {
    return [
      ...domaines().filter(d => d.id !== id).map(d => ({ label: d.nom, puce: d.couleur, action: async () => { for (const ch of chemins) await deplacer(ch, d.id, ""); await chargerCatalogue(); toast(`Déplacée${chemins.length > 1 ? "s" : ""} vers ${echap(d.nom)}`); apres(d.id); } })),
      "-",
      { saisie: "Nouveau domaine", valider: async v => { const dom = creerDomaine(v); for (const ch of chemins) await deplacer(ch, dom, ""); await chargerCatalogue(); toast(`Déplacée${chemins.length > 1 ? "s" : ""} vers ${echap(infosDomaine(dom).nom)}`); apres(dom); } }
    ];
  }
  function menuFiche(ancre, ch, id) {
    const e = trouver(ch); if (!e) return;
    const apres = dom => { fichesDe(id).length ? rendre(true) : aller(dom ? lienDom(dom) : "#/"); };
    const its = [
      { label: dansFile(ch) ? "Retirer de ma file" : "Lire en priorité", action: () => { basculerFile(ch); rendre(true); } }
    ];
    if ((stock.lire("etagere.tri", {})[id] || "perso") === "perso") {
      const l = trier(fichesDe(id), "perso", id).filter(x => x.sous === e.sous).map(x => x.chemin), k = l.indexOf(ch);
      its.push({ label: "Monter", inactif: k <= 0, action: () => { deplacerDansOrdre(id, ch, l[k - 1], false); transition(() => rendre(true)); } },
               { label: "Descendre", inactif: k >= l.length - 1, action: () => { deplacerDansOrdre(id, ch, l[k + 1], true); transition(() => rendre(true)); } });
    }
    its.push({ saisie: "Renommer", valeur: titreDe(e), valider: v => { const t = formaliserTitre(v); if (!t) return; META[ch] = Object.assign(META[ch] || {}, { titrePerso: t, tTitre: Date.now() }); sauverMeta(); toast("Document renommé"); rendre(true); } });
    if (modifiable(e)) its.push(
      { label: "Ranger dans un intercalaire", sous: () => menuRanger(id, [ch], () => rendre(true)) },
      { label: "Déplacer vers un domaine", sous: () => menuDomaines(id, [ch], apres) },
      "-",
      { label: "Supprimer le document", danger: true, confirmer: "Confirmer la suppression", action: async () => { await supprimer(ch); await chargerCatalogue(); toast("Document supprimé"); apres(); } }
    );
    ouvrirMenu(ancre, titreDe(e), its);
  }

  function vueDomaine(id) {
    marquerNav("accueil");
    const d = infosDomaine(id), fs = fichesDe(id);
    if (!fs.length && !intercalairesDe(id).length) { vue().innerHTML = `<a class="lien-retour" href="#/">Étagère</a><div class="vide-etat"><h2>Classeur vide</h2><a class="bouton principal" href="#/ajouter">Ajouter des documents</a></div>`; return; }
    const { p } = statsDomaine(id);
    const lues = fs.filter(e => P.fiches[e.chemin]?.lue).length, enc = fs.filter(e => etat(e.chemin) === "encours").length;
    const tris = stock.lire("etagere.tri", {}), mode = tris[id] || "perso";
    const ouverts = stock.lire("etagere.plis", {});
    const inter = intercalairesDe(id);
    let filtre = FILTRE[id] || "";
    if (filtre && filtre !== "__sans" && !inter.includes(filtre)) filtre = FILTRE[id] = "";
    const triees = trier(fs, mode, id);
    const selection = GESTION === id;
    const glisser = mode === "perso" && !selection;
    const teinte = k => `color-mix(in srgb, ${d.couleur} ${100 - (k % 4) * 18}%, var(--feuille))`;
    let groupes;
    if (!filtre) groupes = [["", triees.filter(e => !e.sous)], ...inter.map(s => [s, triees.filter(e => e.sous === s)])].filter(([s, l]) => l.length || s);
    else if (filtre === "__sans") groupes = [["", triees.filter(e => !e.sous)]];
    else groupes = [[filtre, triees.filter(e => e.sous === filtre)]];
    const sansInter = fs.filter(e => !e.sous).length;
    vue().innerHTML = `
      <a class="lien-retour" href="#/">Étagère</a>
      <div class="domaine-tete" style="--c:${d.couleur}">
        <span class="mini-dos" style="--p:${(p * 100).toFixed(1)}%"></span>
        <div class="dt-texte">
          <h1 class="titre-vue" id="titre-dom">${echap(d.nom)}</h1>
          <div class="dt-stats"><span><b>${Math.round(p * 100)} %</b> lu</span><span><b>${lues}</b>/${fs.length} terminés</span><span><b>${enc}</b> en cours</span></div>
        </div>
        <div class="dt-actions">
          <button class="bouton icone" id="menu-dom" aria-label="Options du domaine"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>
        </div>
      </div>
      <nav class="onglets-inter" aria-label="Intercalaires" style="--c:${d.couleur}">
        <button class="ongl ${!filtre ? "actif" : ""}" data-filtre="">Tout <span>${fs.length}</span></button>
        ${inter.map((n, k) => `<button class="ongl ${filtre === n ? "actif" : ""}" data-filtre="${echap(n)}" data-cible="${echap(n)}" style="--t:${teinte(k)}"><i></i>${echap(n)} <span>${fs.filter(e => e.sous === n).length}</span></button>`).join("")}
        ${inter.length && sansInter ? `<button class="ongl discret ${filtre === "__sans" ? "actif" : ""}" data-filtre="__sans" data-cible="">Sans intercalaire <span>${sansInter}</span></button>` : ""}
        <button class="ongl ajout" id="nouvel-inter">+ Intercalaire</button>
      </nav>
      <div class="barre-tri">
        <label class="tri" for="tri"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <select id="tri" aria-label="Trier les fiches">${Object.entries(TRIS).map(([k, v]) => `<option value="${k}" ${k === mode ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        ${filtre && filtre !== "__sans" ? `<button class="bouton discret" id="menu-inter">Options de l'intercalaire</button>` : ""}
        <span class="astuce-tri">${glisser ? "Glisse une fiche pour la ranger, ou dépose-la sur un intercalaire." : ""}</span>
        <button class="bouton discret" id="selection" aria-pressed="${selection}">${selection ? "Terminer" : "Sélectionner"}</button>
      </div>
      ${groupes.map(([sous, liste]) => {
        const cle = id + "/" + sous, ferme = !filtre && sous && ouverts[cle] === false;
        const k = inter.indexOf(sous);
        return `<section class="intercalaire ${sous ? "nomme" : ""}" data-sous="${echap(sous)}">
          ${sous && !filtre ? `<button class="inter-tete" aria-expanded="${!ferme}" data-pli="${echap(cle)}" data-cible="${echap(sous)}"><span class="inter-onglet" style="background:${teinte(k)}"></span><span class="inter-nom">${echap(sous)}</span><span class="inter-nb">${liste.length}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ""}
          ${liste.length ? `<div class="liste" ${ferme ? "hidden" : ""}>${liste.map(e => caseFiche(e, { coche: selection, menu: !selection, glisser, dom: id })).join("")}</div>`
            : `<div class="inter-vide" data-cible="${echap(sous)}">Intercalaire vide. Glisse des fiches ici, ou passe par le menu <b>⋯</b> d'une fiche.</div>`}
        </section>`;
      }).join("")}
      ${selection ? `<div class="barre-sel" id="barre-sel"><span id="nb-sel">0 fiche</span>
        <button class="bouton" data-act="ranger" disabled>Ranger</button><button class="bouton" data-act="deplacer" disabled>Déplacer</button><button class="bouton" data-act="file" disabled>Prioriser</button><button class="bouton danger" data-act="suppr" disabled>Supprimer</button></div>` : ""}`;
    vue().classList.toggle("mode-gestion", selection);
    indexerTout();

    $("#tri").onchange = ev => { tris[id] = ev.target.value; stock.ecrire("etagere.tri", tris); transition(() => rendre(true)); };
    $$("[data-filtre]").forEach(b => b.onclick = () => { FILTRE[id] = b.dataset.filtre; transition(() => rendre(true)); });
    $("#selection").onclick = () => { GESTION = selection ? null : id; rendre(true); };
    $$("[data-pli]").forEach(b => b.onclick = () => {
      const ouvert = b.getAttribute("aria-expanded") !== "true";
      b.setAttribute("aria-expanded", ouvert); b.nextElementSibling.hidden = !ouvert;
      ouverts[b.dataset.pli] = ouvert; stock.ecrire("etagere.plis", ouverts);
    });
    // nouvel intercalaire : champ en place
    $("#nouvel-inter").onclick = ev => {
      const b = ev.currentTarget, f = document.createElement("form");
      f.className = "ongl-saisie"; f.innerHTML = `<input placeholder="Nom de l'intercalaire" aria-label="Nom de l'intercalaire"><button class="bouton principal">Créer</button>`;
      b.replaceWith(f); const inp = $("input", f); inp.focus();
      f.onsubmit = e2 => { e2.preventDefault(); const v = inp.value.trim(); if (!v) return rendre(true); const l = intercalairesDe(id), n = nomLibre(l, v); enregistrerInter(id, [...l, n]); FILTRE[id] = n; toast(`Intercalaire « ${echap(n)} » créé`); rendre(true); };
      inp.addEventListener("keydown", e2 => { if (e2.key === "Escape") rendre(true); });
      inp.addEventListener("blur", () => setTimeout(() => { if (f.isConnected && !inp.value.trim()) rendre(true); }, 150));
    };
    // options du domaine
    $("#menu-dom").onclick = ev => ouvrirMenu(ev.currentTarget, d.nom, [
      { saisie: "Renommer le domaine", valider: v => { enregistrerDomaine(id, { nom: v, couleur: d.couleur }); toast("Domaine renommé"); rendre(true); } },
      { label: "Couleur", sous: () => PALETTE.map(c => ({ label: c === d.couleur ? "Couleur actuelle" : " ", puce: c, actif: c === d.couleur, action: () => { enregistrerDomaine(id, { couleur: c, nom: d.nom }); rendre(true); } })) }
    ]);
    // options de l'intercalaire affiché
    $("#menu-inter")?.addEventListener("click", ev => {
      const n = filtre;
      ouvrirMenu(ev.currentTarget, n, [
        { saisie: "Renommer l'intercalaire", valider: async v => { const l = intercalairesDe(id), nv = nomLibre(l.filter(x => x !== n), v); for (const e of fichesDe(id).filter(e => e.sous === n)) await deplacer(e.chemin, id, nv); enregistrerInter(id, l.map(x => x === n ? nv : x)); FILTRE[id] = nv; await chargerCatalogue(); toast("Intercalaire renommé"); rendre(true); } },
        "-",
        { label: "Supprimer l'intercalaire", danger: true, confirmer: "Ses fiches restent dans le domaine : confirmer", action: async () => { for (const e of fichesDe(id).filter(e => e.sous === n)) await deplacer(e.chemin, id, ""); enregistrerInter(id, intercalairesDe(id).filter(x => x !== n)); FILTRE[id] = ""; await chargerCatalogue(); toast("Intercalaire supprimé"); rendre(true); } }
      ]);
    });
    // menu ⋯ de chaque fiche
    $$("[data-menu]").forEach(b => b.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); menuFiche(b, b.dataset.menu, id); });

    // glisser-déposer : réordonner, ou déposer sur un intercalaire
    let tire = null;
    $$(".fiche-case[draggable]").forEach(c => {
      c.addEventListener("dragstart", ev => { tire = c.dataset.ch; c.classList.add("tire"); vue().classList.add("glisse"); ev.dataTransfer.effectAllowed = "move"; try { ev.dataTransfer.setData("text/plain", tire); } catch (e) {} });
      c.addEventListener("dragend", () => { tire = null; c.classList.remove("tire"); vue().classList.remove("glisse"); $$(".cible-avant,.cible-apres,.cible-ok").forEach(x => x.classList.remove("cible-avant", "cible-apres", "cible-ok")); });
      c.addEventListener("dragover", ev => { if (!tire || tire === c.dataset.ch) return; ev.preventDefault(); const r = c.getBoundingClientRect(); const apres = (ev.clientX - r.left) > r.width / 2; $$(".cible-avant,.cible-apres").forEach(x => x.classList.remove("cible-avant", "cible-apres")); c.classList.add(apres ? "cible-apres" : "cible-avant"); });
      c.addEventListener("drop", async ev => {
        ev.preventDefault(); const src = tire; if (!src || src === c.dataset.ch) return;
        const apres = c.classList.contains("cible-apres"), dest = trouver(c.dataset.ch), e0 = trouver(src);
        if (e0 && dest && e0.sous !== dest.sous && modifiable(e0)) { const neuf = await deplacer(src, id, dest.sous); await chargerCatalogue(); deplacerDansOrdre(id, neuf, dest.chemin, apres); }
        else deplacerDansOrdre(id, src, c.dataset.ch, apres);
        transition(() => rendre(true));
      });
    });
    $$("[data-cible]").forEach(t => {
      t.addEventListener("dragover", ev => { if (!tire) return; ev.preventDefault(); t.classList.add("cible-ok"); });
      t.addEventListener("dragleave", () => t.classList.remove("cible-ok"));
      t.addEventListener("drop", async ev => {
        ev.preventDefault(); t.classList.remove("cible-ok"); const src = tire; if (!src || !modifiable(trouver(src))) return;
        const n = t.dataset.cible; await deplacer(src, id, n); await chargerCatalogue();
        toast(n ? `Rangée dans « ${echap(n)} »` : "Sortie de l'intercalaire"); transition(() => rendre(true));
      });
    });

    // sélection multiple
    if (!selection) return;
    const coches = () => $$(".coche:checked").map(c => c.dataset.ch);
    const maj = () => { const n = coches().length; $("#nb-sel").textContent = pluriel(n, "fiche sélectionnée", "fiches sélectionnées"); $$("#barre-sel [data-act]").forEach(b => { b.disabled = !n; if (b.dataset.act === "suppr") { b.textContent = "Supprimer"; delete b.dataset.ok; } }); };
    $$(".coche").forEach(c => c.onchange = maj);
    $$(".fiche-case").forEach(c => c.addEventListener("click", ev => { if (ev.target.closest(".coche")) return; ev.preventDefault(); ev.stopPropagation(); const x = $(".coche", c); if (x) { x.checked = !x.checked; maj(); } }, true));
    const fin = dom => { GESTION = null; fichesDe(id).length ? rendre(true) : aller(dom ? lienDom(dom) : "#/"); };
    $$("#barre-sel [data-act]").forEach(b => b.onclick = async () => {
      const l = coches(); if (!l.length) return;
      const act = b.dataset.act;
      if (act === "ranger") ouvrirMenu(b, "Ranger dans", menuRanger(id, l.filter(ch => modifiable(trouver(ch))), () => fin()));
      else if (act === "deplacer") ouvrirMenu(b, "Déplacer vers", menuDomaines(id, l.filter(ch => modifiable(trouver(ch))), fin));
      else if (act === "file") { P.file = P.file || []; P.file.push(...l.filter(ch => !dansFile(ch))); sauver(); toast(`${pluriel(l.length, "fiche ajoutée", "fiches ajoutées")} à ta file`); fin(); }
      else if (act === "suppr") { if (!b.dataset.ok) { b.dataset.ok = 1; b.textContent = `Confirmer (${l.length})`; return; } for (const ch of l) await supprimer(ch); await chargerCatalogue(); toast(pluriel(l.length, "fiche supprimée", "fiches supprimées")); fin(); }
    });
  }

  // ================= Synchronisation entre appareils : un dépôt GitHub privé =================
  // Les documents vivent dans documents/<domaine>/<intercalaire>/<fichier>, la progression dans etat.json.
  const NUAGE = Object.assign({ owner: "", repo: "", jeton: "", branche: "main" }, stock.lire("etagere.sync", {}));
  const nuageActif = () => MODE === "site" && !!(NUAGE.owner && NUAGE.repo && NUAGE.jeton);
  const ETAT_NUAGE = { derniere: stock.lire("etagere.sync.derniere", 0), sha: null, enCours: null, sale: false, erreur: "", minut: 0 };
  async function gh(chemin, o = {}) {
    const r = await fetch(`https://api.github.com/repos/${NUAGE.owner}/${NUAGE.repo}${chemin}`, {
      method: o.method || "GET", body: o.body, cache: "no-store", keepalive: !!o.keepalive,
      headers: Object.assign({ Authorization: "Bearer " + NUAGE.jeton, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, o.body ? { "Content-Type": "application/json" } : {}, o.headers || {})
    });
    if (!r.ok) {
      let msg = ""; try { msg = (await r.json()).message || ""; } catch (x) {}
      const err = new Error(r.status === 401 ? "jeton refusé (expiré ou mal copié)" : r.status === 403 ? "le jeton n'a pas le droit d'écrire dans ce dépôt" : r.status === 404 ? "dépôt introuvable (vérifie le nom et les droits du jeton)" : `GitHub : ${r.status} ${msg}`);
      err.status = r.status; err.msg = msg; throw err;
    }
    if (o.brut) return r;
    return r.status === 204 ? null : r.json();
  }
  const b64Texte = s => { const u = new TextEncoder().encode(s); let b = ""; for (let i = 0; i < u.length; i += 0x8000) b += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(b); };
  const texteB64 = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), c => c.charCodeAt(0)));
  const b64Octets2 = buf => new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(",")[1] || ""); fr.onerror = () => ko(fr.error); fr.readAsDataURL(new Blob([buf])); });
  // --- documents ---
  async function initialiserDepot() {
    try { await gh(`/git/ref/heads/${NUAGE.branche}`); }
    catch (e) {
      if (e.status !== 409 && e.status !== 404) throw e;
      await gh(`/contents/LISEZMOI.md`, { method: "PUT", body: JSON.stringify({ message: "Étagère : création", content: b64Texte("# Étagère\n\nDonnées de mon Étagère : documents et progression. Ne pas rendre ce dépôt public.\n"), branch: NUAGE.branche }) });
    }
  }
  async function listerNuage() {
    let arbre;
    try {
      const t = await gh(`/git/trees/${NUAGE.branche}?recursive=1`);
      arbre = t.tree.filter(x => x.type === "blob" && x.path.startsWith("documents/") && !/(^|\/)\./.test(x.path)).map(x => ({ p: x.path.slice(10), sha: x.sha, s: x.size }));
      stock.ecrire("etagere.sync.arbre", arbre); ETAT_NUAGE.erreur = "";
    } catch (e) {
      if (e.status === 409) arbre = [];
      else { arbre = stock.lire("etagere.sync.arbre", []); ETAT_NUAGE.erreur = navigator.onLine === false ? "hors ligne" : e.message; }
    }
    return arbre.map(x => entree(x.p, "nuage", () => lireNuage(x.sha), { sha: x.sha, taille: x.s }));
  }
  async function lireNuage(sha) {
    const c = await idb.cache(sha); if (c) return c;
    const r = await gh(`/git/blobs/${sha}`, { brut: true, headers: { Accept: "application/vnd.github.raw+json" } });
    const buf = await r.arrayBuffer();
    idb.mettreCache({ sha, donnees: buf }).catch(() => {});
    return buf;
  }
  // un seul commit pour plusieurs changements : [{chemin, donnees} | {chemin, sha} | {chemin, supprimer: true}]
  async function commitNuage(changements, message, prog) {
    for (let essai = 0; essai < 3; essai++) {
      try {
        const ref = await gh(`/git/ref/heads/${NUAGE.branche}`), parent = ref.object.sha;
        const base = (await gh(`/git/commits/${parent}`)).tree.sha;
        const arbre = [];
        let k = 0;
        for (const c of changements) {
          let sha = c.sha;
          if (c.donnees) {
            if (!c.blob) c.blob = (await gh(`/git/blobs`, { method: "POST", body: JSON.stringify({ content: await b64Octets2(c.donnees), encoding: "base64" }) })).sha;
            sha = c.blob; idb.mettreCache({ sha, donnees: c.donnees }).catch(() => {});
          }
          arbre.push({ path: "documents/" + c.chemin, mode: "100644", type: "blob", sha: c.supprimer ? null : sha });
          prog?.(++k / changements.length);
        }
        const tree = await gh(`/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: base, tree: arbre }) });
        const commit = await gh(`/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [parent] }) });
        await gh(`/git/refs/heads/${NUAGE.branche}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
        return;
      } catch (e) { if (essai === 2 || (e.status !== 422 && e.status !== 409)) throw e; }
    }
  }
  // --- progression ---
  const EMPREINTES = {};
  const CHAMPS_DATES = ["file", "ordre", "objectif"];
  function horodater() { P.t = P.t || {}; for (const k of CHAMPS_DATES) { const s = JSON.stringify(P[k] ?? null); if (EMPREINTES[k] !== undefined && s !== EMPREINTES[k]) P.t[k] = Date.now(); EMPREINTES[k] = s; } }
  CHAMPS_DATES.forEach(k => { EMPREINTES[k] = JSON.stringify(P[k] ?? null); });
  const plusRecent = (a, b, cle) => ((a?.[cle] || 0) >= (b?.[cle] || 0) ? a : b);
  function fusionnerP(a, b) {
    const R = Object.assign({}, b, a);
    R.jours = {};
    for (const d of new Set([...Object.keys(a.jours || {}), ...Object.keys(b.jours || {})])) {
      const x = a.jours?.[d] || {}, y = b.jours?.[d] || {}, j = {};
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) j[k] = typeof (x[k] ?? y[k]) === "boolean" ? !!(x[k] || y[k]) : Math.max(+x[k] || 0, +y[k] || 0);
      R.jours[d] = j;
    }
    R.fiches = {};
    for (const ch of new Set([...Object.keys(a.fiches || {}), ...Object.keys(b.fiches || {})])) {
      const x = a.fiches?.[ch], y = b.fiches?.[ch];
      if (!x || !y) { R.fiches[ch] = x || Object.assign({}, y); continue; }
      const f = Object.assign({}, y, x);
      f.jalons = Object.assign({}, y.jalons, x.jalons);
      for (const k of Object.keys(f.jalons)) if (x.jalons?.[k] && y.jalons?.[k]) f.jalons[k] = x.jalons[k] < y.jalons[k] ? x.jalons[k] : y.jalons[k];
      f.lue = x.lue && y.lue ? (x.lue < y.lue ? x.lue : y.lue) : x.lue || y.lue;
      const mx = x.marque, my = y.marque;
      f.marque = mx && my ? ((mx.d || "") >= (my.d || "") ? mx : my) : mx || my;
      if (x.sansMarque || y.sansMarque) { const s = Math.max(x.sansMarque || 0, y.sansMarque || 0); if (f.marque && Date.parse(f.marque.d || 0) < s) delete f.marque; f.sansMarque = s; }
      f.posOrig = plusRecent(x.posOrig, y.posOrig, "t");
      f.ouverte = (x.ouverte || "") > (y.ouverte || "") ? x.ouverte : y.ouverte;
      R.fiches[ch] = a.fiches?.[ch] ? Object.assign(a.fiches[ch], f) : f;
    }
    R.badges = Object.assign({}, b.badges, a.badges);
    R.t = Object.assign({}, b.t, a.t);
    for (const k of CHAMPS_DATES) { const ta = a.t?.[k] || 0, tb = b.t?.[k] || 0; R[k] = ta >= tb ? a[k] : b[k]; R.t[k] = Math.max(ta, tb); }
    R.xp = Math.max(Object.values(R.jours).reduce((s, j) => s + (j.xp || 0), 0), 0);
    R.serieRecord = Math.max(a.serieRecord || 0, b.serieRecord || 0);
    R.jalonsTotal = Object.values(R.fiches).reduce((s, f) => s + Object.keys(f.jalons || {}).length, 0);
    R.supprimes = Object.assign({}, b.supprimes, a.supprimes);
    for (const ch of Object.keys(R.supprimes)) delete R.fiches[ch];
    return R;
  }
  function etatLocal() { return { v: 1, P, META, domaines: stock.lire("etagere.domaines", {}), maj: Date.now() }; }
  function appliquerEtat(d) {
    if (!d || !d.P) return;
    P = fusionnerP(P, d.P);
    for (const [ch, m] of Object.entries(d.META || {})) {
      const l = META[ch];
      if (!l || (m.v || 0) > (l.v || 0)) META[ch] = Object.assign({}, m, l && l.titrePerso && (l.tTitre || 0) >= (m.tTitre || 0) ? { titrePerso: l.titrePerso, tTitre: l.tTitre } : {});
      else if (m.titrePerso && (m.tTitre || 0) > (l.tTitre || 0)) { l.titrePerso = m.titrePerso; l.tTitre = m.tTitre; }
    }
    const dl = stock.lire("etagere.domaines", {});
    for (const [id, o] of Object.entries(d.domaines || {})) if (!dl[id] || (o.t || 0) > (dl[id].t || 0)) dl[id] = o;
    ETAT_NUAGE.silence = true;
    stock.ecrire("etagere.domaines", dl); Object.assign(CFG.domaines = CFG.domaines || {}, dl);
    stock.ecrire(CLE, P); stock.ecrire("etagere.meta.v2", META);
    ETAT_NUAGE.silence = false;
    CHAMPS_DATES.forEach(k => { EMPREINTES[k] = JSON.stringify(P[k] ?? null); });
  }
  async function lireEtatNuage() {
    try {
      const r = await gh(`/contents/etat.json?ref=${NUAGE.branche}`);
      ETAT_NUAGE.sha = r.sha;
      const txt = r.content && r.encoding === "base64" ? texteB64(r.content) : await (await gh(`/contents/etat.json?ref=${NUAGE.branche}`, { brut: true, headers: { Accept: "application/vnd.github.raw+json" } })).text();
      return JSON.parse(txt);
    } catch (e) { if (e.status === 404) { ETAT_NUAGE.sha = null; return null; } throw e; }
  }
  async function ecrireEtatNuage(keepalive) {
    horodater();
    const corps = JSON.stringify({ message: "Progression", content: b64Texte(JSON.stringify(etatLocal())), branch: NUAGE.branche, ...(ETAT_NUAGE.sha ? { sha: ETAT_NUAGE.sha } : {}) });
    const r = await gh(`/contents/etat.json`, { method: "PUT", body: corps, keepalive: keepalive && corps.length < 60000 });
    ETAT_NUAGE.sha = r?.content?.sha || ETAT_NUAGE.sha;
  }
  // tirer, fusionner, pousser — une opération à la fois
  function synchroniser(opts = {}) {
    if (!nuageActif()) return Promise.resolve();
    if (ETAT_NUAGE.enCours) return ETAT_NUAGE.enCours.then(() => opts.forcer ? synchroniser(opts) : null);
    ETAT_NUAGE.enCours = (async () => {
      majPastilleSync("encours");
      try {
        for (let essai = 0; essai < 3; essai++) {
          const d = await lireEtatNuage();
          const avant = JSON.stringify(P) + JSON.stringify(META);
          if (d) appliquerEtat(d);
          const change = JSON.stringify(P) + JSON.stringify(META) !== avant;
          try { if (ETAT_NUAGE.sale || !d) await ecrireEtatNuage(); ETAT_NUAGE.sale = false; }
          catch (e) { if (e.status === 409 || e.status === 422) continue; throw e; }
          ETAT_NUAGE.derniere = Date.now(); stock.ecrire("etagere.sync.derniere", ETAT_NUAGE.derniere); ETAT_NUAGE.erreur = "";
          if (change && !LISEUSE) { majBarre(); if (!/^#\/(ajouter|f\/)/.test(ROUTE)) rendre(true); }
          break;
        }
        majPastilleSync("ok");
      } catch (e) { ETAT_NUAGE.erreur = navigator.onLine === false ? "hors ligne" : e.message; majPastilleSync("erreur"); }
      finally { ETAT_NUAGE.enCours = null; }
    })();
    return ETAT_NUAGE.enCours;
  }
  window.__etagereModif = () => {
    if (!nuageActif() || ETAT_NUAGE.silence) return;
    ETAT_NUAGE.sale = true;
    clearTimeout(ETAT_NUAGE.minut); ETAT_NUAGE.minut = setTimeout(() => synchroniser(), 8000);
  };
  document.addEventListener("visibilitychange", () => {
    if (!nuageActif()) return;
    if (document.hidden) { if (ETAT_NUAGE.sale && !ETAT_NUAGE.enCours) { clearTimeout(ETAT_NUAGE.minut); ecrireEtatNuage(true).then(() => { ETAT_NUAGE.sale = false; }).catch(() => {}); } }
    else if (Date.now() - ETAT_NUAGE.derniere > 20000) synchroniser().then(async () => { const avant = CATALOGUE.length; await chargerCatalogue(); if (CATALOGUE.length !== avant && !LISEUSE) rendre(true); });
  });
  window.addEventListener("online", () => { if (nuageActif()) synchroniser(); });
  function majPastilleSync(etat) {
    const el = $("#sync-etat"); if (!el) return;
    el.dataset.etat = etat;
    el.textContent = etat === "encours" ? "Synchronisation…" : etat === "erreur" ? "Erreur : " + ETAT_NUAGE.erreur : "Synchronisé " + (ETAT_NUAGE.derniere ? "à " + new Date(ETAT_NUAGE.derniere).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");
  }
  // connexion : formulaire, code ou lien scanné depuis un autre appareil
  const codeConnexion = () => btoa(unescape(encodeURIComponent(JSON.stringify({ o: NUAGE.owner, r: NUAGE.repo, j: NUAGE.jeton, b: NUAGE.branche })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  function lireCode(code) {
    code = String(code || "").trim().replace(/^.*#connexion=/, "");
    try { const o = JSON.parse(decodeURIComponent(escape(atob(code.replace(/-/g, "+").replace(/_/g, "/"))))); if (o.o && o.r && o.j) return { owner: o.o, repo: o.r, jeton: o.j, branche: o.b || "main" }; } catch (x) {}
    return null;
  }
  async function connecterNuage(cfg, prog) {
    Object.assign(NUAGE, cfg);
    try {
      await gh("");
      await initialiserDepot();
    } catch (e) { Object.assign(NUAGE, { owner: "", repo: "", jeton: "" }); throw e; }
    stock.ecrire("etagere.sync", NUAGE);
    // les documents déjà sur cet appareil partent dans le dépôt
    const locaux = await idb.tous();
    if (locaux.length) {
      prog?.(`Envoi de ${pluriel(locaux.length, "document")}…`);
      await commitNuage(locaux.map(f => ({ chemin: f.chemin, donnees: f.donnees })), "Documents de " + (navigator.platform || "cet appareil"), x => prog?.(`Envoi… ${Math.round(x * 100)} %`));
      for (const f of locaux) await idb.retirer(f.chemin);
    }
    prog?.("Synchronisation de la progression…");
    ETAT_NUAGE.sale = true;
    await synchroniser({ forcer: true });
    await chargerCatalogue();
  }
  function deconnecterNuage() { Object.assign(NUAGE, { owner: "", repo: "", jeton: "" }); stock.ecrire("etagere.sync", NUAGE); }
  function chargerQr() {
    if (window.qrcode) return Promise.resolve();
    return new Promise((ok, ko) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  }
  async function dialogueAutreAppareil() {
    const lien = location.origin + location.pathname + "#connexion=" + codeConnexion();
    const v = document.createElement("div"); v.className = "voile";
    v.innerHTML = `<div class="dialogue dialogue-qr" role="dialog" aria-modal="true" aria-label="Connecter un autre appareil">
      <h2>Connecter un autre appareil</h2>
      <p>Sur ton téléphone, ouvre l'appareil photo et vise ce code. Étagère s'ouvre déjà connecté.</p>
      <div class="qr" id="qr"></div>
      <p class="petit">Appli déjà installée sur l'écran d'accueil ? Copie le code, envoie-le-toi, puis colle-le dans l'appli : Ajouter › Synchroniser.</p>
      <div class="dialogue-b"><button class="bouton" id="qr-copier">Copier le code</button><button class="bouton principal" id="qr-ok">Fermer</button></div>
      <p class="petit attention">Ce code donne accès à ton dépôt : ne le partage avec personne.</p></div>`;
    document.body.appendChild(v);
    const fermer = () => v.remove();
    $("#qr-ok", v).onclick = fermer; v.addEventListener("click", ev => { if (ev.target === v) fermer(); });
    $("#qr-copier", v).onclick = async () => { try { await navigator.clipboard.writeText(codeConnexion()); toast("Code copié"); } catch (e) { toast("Copie impossible"); } };
    try { await chargerQr(); const q = window.qrcode(0, "M"); q.addData(lien); q.make(); $("#qr", v).innerHTML = q.createSvgTag({ cellSize: 5, margin: 3, scalable: true }); }
    catch (e) { $("#qr", v).innerHTML = `<p class="petit">QR code indisponible : utilise « Copier le code ».</p>`; }
  }
  function sectionSync() {
    if (MODE !== "site") return "";
    if (nuageActif()) return `<section class="section sync"><h2 class="section-titre">Synchroniser mes appareils</h2>
      <div class="sync-carte"><span class="sync-ico"></span><div class="sync-t"><b>Connecté à ${echap(NUAGE.owner)}/${echap(NUAGE.repo)}</b><span id="sync-etat" data-etat="${ETAT_NUAGE.erreur ? "erreur" : "ok"}"></span></div></div>
      <div class="sync-b"><button class="bouton principal" id="sync-qr">Connecter un autre appareil</button><button class="bouton" id="sync-maint">Synchroniser maintenant</button><button class="bouton discret" id="sync-off">Déconnecter cet appareil</button></div></section>`;
    return `<section class="section sync"><h2 class="section-titre">Synchroniser mes appareils</h2>
      <p class="sync-aide">Tes documents et ta progression sont rangés dans un dépôt GitHub <b>privé</b>, partagé par ton téléphone et ton ordinateur.</p>
      <form class="formulaire sync-form" id="sync-form">
        <label class="champ" for="sync-depot">Dépôt privé<input id="sync-depot" placeholder="pseudo/etagere-donnees" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        <label class="champ" for="sync-jeton">Jeton d'accès<input id="sync-jeton" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false"></label>
        <button class="bouton principal">Connecter</button>
      </form>
      <details class="sync-code"><summary>J'ai un code de connexion</summary><form class="formulaire" id="sync-form-code"><label class="champ" for="sync-code">Code<input id="sync-code" placeholder="Colle le code ici" autocomplete="off"></label><button class="bouton principal">Connecter</button></form></details>
      <p class="sync-msg" id="sync-msg" hidden></p></section>`;
  }
  function brancherSync() {
    if (MODE !== "site") return;
    majPastilleSync(ETAT_NUAGE.erreur ? "erreur" : "ok");
    $("#sync-qr")?.addEventListener("click", dialogueAutreAppareil);
    $("#sync-maint")?.addEventListener("click", async () => { ETAT_NUAGE.sale = true; await synchroniser({ forcer: true }); await chargerCatalogue(); toast(ETAT_NUAGE.erreur ? "Synchronisation impossible : " + echap(ETAT_NUAGE.erreur) : "Synchronisé"); });
    $("#sync-off")?.addEventListener("click", ev => { const b = ev.currentTarget; if (!b.dataset.ok) { b.dataset.ok = 1; b.textContent = "Confirmer la déconnexion"; return; } deconnecterNuage(); chargerCatalogue().then(() => vueAjouter()); toast("Appareil déconnecté"); });
    const msg = $("#sync-msg");
    const lancer = async cfg => {
      msg.hidden = false; msg.className = "sync-msg"; msg.textContent = "Connexion…";
      try { await connecterNuage(cfg, t => { msg.textContent = t; }); toast("Appareil connecté"); vueAjouter(); }
      catch (e) { msg.className = "sync-msg erreur"; msg.textContent = "Connexion impossible : " + e.message; }
    };
    $("#sync-form")?.addEventListener("submit", ev => {
      ev.preventDefault();
      const d = $("#sync-depot").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, ""), j = $("#sync-jeton").value.trim();
      const [owner, repo] = d.split("/");
      if (!owner || !repo || !j) { msg.hidden = false; msg.className = "sync-msg erreur"; msg.textContent = "Indique le dépôt sous la forme pseudo/nom, et le jeton."; return; }
      lancer({ owner, repo, jeton: j, branche: "main" });
    });
    $("#sync-form-code")?.addEventListener("submit", ev => { ev.preventDefault(); const c = lireCode($("#sync-code").value); if (!c) { msg.hidden = false; msg.className = "sync-msg erreur"; msg.textContent = "Code illisible."; return; } lancer(c); });
  }
  // lien de connexion ouvert depuis un QR code
  async function connexionParLien() {
    if (!location.hash.startsWith("#connexion=")) return;
    const c = lireCode(location.hash);
    history.replaceState(null, "", location.pathname + "#/");
    ROUTE = "#/";
    if (!c) { toast("Lien de connexion illisible"); return; }
    toast("Connexion à ton dépôt…");
    try { await connecterNuage(c); toast("Appareil connecté"); rendre(); } catch (e) { toast("Connexion impossible : " + echap(e.message)); }
  }

  // ================= Ouvrir un document =================
  async function vueFiche(ch) {
    marquerNav("accueil");
    const e = trouver(ch), route0 = ROUTE;
    if (!e) { vue().innerHTML = `<a class="lien-retour" href="#/">Étagère</a><div class="vide-etat"><h2>Document introuvable</h2></div>`; return; }
    vue().innerHTML = `<a class="lien-retour" href="${lienDom(e.domaine)}">${echap(infosDomaine(e.domaine).nom)}</a><div class="chargement">${LOGO.svg()}</div>`;
    P.fiches[ch] = Object.assign(P.fiches[ch] || {}, { ouverte: auj() }); sauver();
    let D;
    try { D = await ouvrirDoc(e); }
    catch (err) { if (ROUTE === route0) vue().innerHTML = `<a class="lien-retour" href="${lienDom(e.domaine)}">${echap(infosDomaine(e.domaine).nom)}</a><div class="vide-etat"><h2>Impossible d'ouvrir ce document</h2><p class="erreur">${echap(err.message)}</p></div>`; return; }
    if (ROUTE !== route0) return;
    const op = ALLER_POS && ALLER_POS.ch === ch ? { pos: ALLER_POS.pos } : {};
    if (D.genre === "pdf") ouvrirLiseuse(e, D, ch, op);
    else ouvrirLiseuseTexte(e, D, ch);
  }

  // ================= Outils communs aux deux liseuses : jalons, marque-page, sommaire =================
  function outilsLecture(o) {
    const { R, ch } = o, f = P.fiches[ch] || (P.fiches[ch] = {});
    const barre = document.createElement("div"); barre.className = "ls-jalons"; barre.setAttribute("aria-hidden", "true");
    $(".ls-haut", R).appendChild(barre);
    const invite = document.createElement("div"); invite.className = "ls-invite"; invite.hidden = true; invite.setAttribute("role", "status");
    R.appendChild(invite);
    const ignores = new Set(); let inviteK = null;
    const M = () => META[ch];
    const fait = j => !!(f.jalons && f.jalons[j.k]);
    const largeur = j => Math.max(0.15, j.e - j.s);
    function dessiner() {
      const js = M()?.jalons || []; if (!js.length) { barre.innerHTML = ""; return; }
      const ph = o.posHaut();
      barre.innerHTML = js.map(j => `<i class="${fait(j) ? "fait" : ""} ${ph >= j.s && ph < j.e ? "ici" : ""}" style="flex:${largeur(j)}"></i>`).join("");
    }
    function verifier() {
      const js = M()?.jalons || []; if (!js.length) return;
      const fin = o.finAtteinte(), pb = o.posBas(), ph = o.posHaut();
      let cible = null;
      if (fin) cible = js.find(j => !fait(j) && !ignores.has(j.k)) || null;
      else js.forEach(j => { if (pb >= j.e && !fait(j) && !ignores.has(j.k) && ph < j.e + o.marge) cible = j; });
      montrer(cible);
      dessiner();
    }
    function montrer(j) {
      if (!j) {
        if (!invite.hidden && !invite.classList.contains("sort")) { invite.classList.add("sort"); setTimeout(() => { if (inviteK === null) invite.hidden = true; invite.classList.remove("sort"); }, 200); }
        inviteK = null; return;
      }
      if (inviteK === j.k && !invite.hidden) return;
      inviteK = j.k; invite.hidden = false; invite.classList.remove("sort", "valide");
      invite.innerHTML = `<span class="li-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span class="li-t"><small>Partie terminée</small><b>${echap(j.t)}</b></span><button class="bouton principal li-ok">Valider <span class="xp-tag">+${j.xp} XP</span></button><button class="ls-b li-x" aria-label="Plus tard">${ico("fermer")}</button>`;
      $(".li-ok", invite).onclick = () => valider(j);
      $(".li-x", invite).onclick = () => { ignores.add(j.k); montrer(null); };
    }
    function valider(j) {
      f.jalons = f.jalons || {}; if (f.jalons[j.k]) return;
      f.jalons[j.k] = auj(); P.jalonsTotal = (P.jalonsTotal || 0) + 1;
      const jr = jourDe(auj()); jr.jal = (jr.jal || 0) + 1; sauver();
      gagner(j.xp, "Partie validée");
      if (inviteK === j.k) { invite.classList.add("valide"); $(".li-ok", invite).innerHTML = "Validée"; setTimeout(() => montrer(null), 900); }
      const js = M().jalons;
      if (!f.lue && js.every(fait)) { f.lue = auj(); jr.lu = (jr.lu || 0) + 1; sauver(); setTimeout(() => gagner(15, "Document terminé"), 700); }
      dessiner();
    }
    function libelle(pos) { let t = ""; for (const x of M()?.plan || []) { if (x.pos <= pos + 1e-3) t = x.t; else break; } return t; }
    function majBoutonMarque() { const b = $('[data-ls="marque"]', R); if (b) { b.setAttribute("aria-pressed", !!f.marque?.pos); b.title = f.marque?.pos ? "Marque-page" : "Poser un marque-page (M)"; } }
    function poserMarque() {
      const pos = o.posHaut(), l = libelle(pos);
      f.marque = { pos, d: new Date().toISOString(), q: Math.round(Math.max(0, Math.min(1, o.fraction(pos))) * 100), x: o.pdf ? "Page " + Math.floor(pos) + (l ? " · " + l : "") : (l || "Marque-page") };
      sauver(); o.ruban(pos); majBoutonMarque(); toast("Marque-page posé");
    }
    function menuMarque(b) {
      if (!f.marque?.pos) return poserMarque();
      ouvrirMenu(b, "Marque-page", [
        { label: "Aller au marque-page", action: () => o.allerPos(f.marque.pos) },
        { label: "Le déplacer ici", action: poserMarque },
        "-",
        { label: "Retirer le marque-page", danger: true, action: () => { delete f.marque; f.sansMarque = Date.now(); sauver(); o.ruban(null); majBoutonMarque(); toast("Marque-page retiré"); } }
      ]);
    }
    function sommaireHtml() {
      const Mm = M();
      if (!Mm) return `<p class="lsp-aide">Sommaire en préparation…</p>`;
      const js = Mm.jalons, pl = Mm.plan, ph = o.posHaut(), n = js.filter(fait).length;
      return `<div class="lsp-prog"><span><b>${n}</b> / ${js.length} ${js.length > 1 ? "parties validées" : "partie validée"}</span><span class="lsp-barre"><i style="width:${(n / js.length * 100).toFixed(1)}%"></i></span></div>
        <ol class="lsp-jal">${js.map((j, i) => {
          const subs = pl.filter(x => x.pos > j.s + 1e-3 && x.pos < j.e - 1e-3 && x.t !== j.t).slice(0, 60);
          return `<li class="${fait(j) ? "fait" : ""} ${ph >= j.s && ph < j.e ? "ici" : ""}">
            <div class="lsp-jt"><button class="lsp-s niv-0" data-pos="${j.s}">${echap(j.t)}${o.pdf ? `<span>p. ${Math.floor(j.s)}</span>` : ""}</button>
            <button class="lsp-v" data-j="${i}" ${fait(j) ? "disabled" : ""} title="${fait(j) ? "Validée le " + dateLisible(f.jalons[j.k]) : "Valider cette partie"}">${fait(j) ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>` : `+${j.xp}`}</button></div>
            ${subs.length ? `<div class="lsp-sous">${subs.map(x => `<button class="lsp-s niv-${Math.min(2, x.niv + 1)}" data-pos="${x.pos}">${echap(x.t)}${o.pdf ? `<span>p. ${Math.floor(x.pos)}</span>` : ""}</button>`).join("")}</div>` : ""}</li>`;
        }).join("")}</ol>`;
    }
    function brancherSommaire(panneau, fermer) {
      $$("[data-pos]", panneau).forEach(b => b.onclick = () => { if (TACTILE) fermer(); o.allerPos(+b.dataset.pos); });
      $$("[data-j]", panneau).forEach(b => b.onclick = () => {
        valider(M().jalons[+b.dataset.j]);
        b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`; b.disabled = true; b.closest("li").classList.add("fait");
        const js = M().jalons, n = js.filter(fait).length, p = $(".lsp-prog", panneau);
        if (p) { $("b", p).textContent = n; $("i", p).style.width = (n / js.length * 100).toFixed(1) + "%"; }
      });
      $(".lsp-jal li.ici", panneau)?.scrollIntoView({ block: "center" });
    }
    majBoutonMarque();
    return { verifier, dessiner, poserMarque, menuMarque, sommaireHtml, brancherSommaire, libelle };
  }

  // ================= Liseuse des autres formats (Markdown, Word, HTML…) : le document tel quel =================
  const PREF_TXT = Object.assign({ taille: 19 }, stock.lire("etagere.texte", {}));
  async function ouvrirLiseuseTexte(e, D, ch) {
    if (LISEUSE) LISEUSE.fermer(true);
    const f = P.fiches[ch] || (P.fiches[ch] = {});
    const R = document.createElement("div");
    R.className = "liseuse liseuse-texte theme-" + PREF_PDF.theme; R.setAttribute("role", "dialog"); R.setAttribute("aria-label", titreDe(e));
    R.innerHTML = `
      <header class="ls-haut">
        <button class="ls-b" data-ls="fermer" aria-label="Fermer" title="Fermer (Échap)">${ico("retour")}</button>
        <div class="ls-titre"><span class="ls-t">${echap(titreDe(e))}</span><span class="ls-sous" id="ls-sous"></span></div>
        <div class="ls-outils">
          <button class="ls-b" data-ls="sommaire" aria-label="Sommaire et parties" title="Sommaire">${ico("sommaire")}</button>
          <button class="ls-b" data-ls="ecouter" aria-label="Écouter" title="Écouter (K)">${ico("ecouter")}</button>
          <button class="ls-b ls-marque" data-ls="marque" aria-label="Marque-page">${ico("marque")}</button>
          <button class="ls-b" data-ls="affichage" aria-label="Affichage" title="Affichage">${ico("aa")}</button>
        </div>
      </header>
      <div class="ls-defil" tabindex="-1"><article class="ls-feuille" id="corps" style="--taille:${PREF_TXT.taille}px">${D.html}</article></div>
      <button class="ls-pilule" aria-hidden="true" tabindex="-1"><b id="ls-n">0 %</b></button>
      <aside class="ls-panneau" hidden></aside>`;
    document.body.appendChild(R);
    document.documentElement.classList.add("liseuse-ouverte");
    const defil = $(".ls-defil", R), doc = $(".ls-feuille", R), haut = $(".ls-haut", R), panneau = $(".ls-panneau", R);
    let ferme = false;
    const ecouteurs = [];
    const ecouter = (cible, type, fn, op) => { cible.addEventListener(type, fn, op); ecouteurs.push(() => cible.removeEventListener(type, fn, op)); };
    const quitter = () => aller(lienDom(e.domaine));
    const Lx = LISEUSE = {
      ch,
      pousse: () => false,
      fermer() {
        if (ferme) return; ferme = true; sauverPos();
        if (VOIX.actif && VOIX.ch === ch) arreterVoix(false);
        ecouteurs.forEach(x => x()); R.remove();
        document.documentElement.classList.remove("liseuse-ouverte");
        if (LISEUSE === Lx) LISEUSE = null; fermerMenu();
      }
    };
    $$("a[href]", doc).forEach(a => { const h = a.getAttribute("href"); if (h && h.startsWith("#") && !h.startsWith("#/")) a.onclick = ev => { ev.preventDefault(); const c = document.getElementById(decodeURIComponent(h.slice(1))); if (c) defil.scrollTop += c.getBoundingClientRect().top - defil.getBoundingClientRect().top - haut.offsetHeight - 12; }; });
    const blocs = () => [...doc.children];
    const posA = y => { // y : position dans le défilement
      const bs = blocs(); if (!bs.length) return 0;
      const base = doc.offsetTop;
      let k = 0; for (let i = 0; i < bs.length; i++) { if (base + bs[i].offsetTop <= y) k = i; else break; }
      const b = bs[k], h = Math.max(1, b.offsetHeight);
      return k + Math.max(0, Math.min(0.999, (y - base - b.offsetTop) / h));
    };
    const posHaut = () => posA(defil.scrollTop + haut.offsetHeight + 8);
    const posBas = () => posA(defil.scrollTop + defil.clientHeight * 0.45);
    const finAtteinte = () => defil.scrollHeight > defil.clientHeight + 40 && defil.scrollTop + defil.clientHeight >= defil.scrollHeight - 30;
    const allerPos = pos => {
      const bs = blocs(); if (!bs.length) return;
      const k = Math.max(0, Math.min(bs.length - 1, Math.floor(pos))), b = bs[k];
      defil.scrollTop = doc.offsetTop + b.offsetTop + (pos - k) * b.offsetHeight - haut.offsetHeight - 14;
    };
    let ruban = null;
    const poserRuban = pos => {
      ruban?.remove(); ruban = null; if (pos == null) return;
      const bs = blocs(), k = Math.max(0, Math.min(bs.length - 1, Math.floor(pos))), b = bs[k]; if (!b) return;
      ruban = document.createElement("span"); ruban.className = "ls-ruban"; ruban.style.top = (b.offsetTop + (pos - k) * b.offsetHeight) + "px";
      doc.appendChild(ruban);
    };
    const O = outilsLecture({ R, ch, pdf: false, marge: 2.5, posHaut, posBas, finAtteinte, allerPos, ruban: poserRuban, fraction: p => p / Math.max(1, blocs().length) });
    function sauverPos() { const mx = defil.scrollHeight - defil.clientHeight; f.posOrig = { pos: posHaut(), q: mx > 0 ? defil.scrollTop / mx : 0, t: Date.now() }; sauver(); }
    let minut;
    const suivre = () => {
      const max = defil.scrollHeight - defil.clientHeight;
      $("#ls-n", R).textContent = Math.round(max > 0 ? defil.scrollTop / max * 100 : 100) + " %";
      $("#ls-sous", R).textContent = O.libelle(posHaut());
      O.verifier();
      clearTimeout(minut); minut = setTimeout(sauverPos, 500);
    };
    let dernierY = 0;
    ecouter(defil, "scroll", () => {
      suivre();
      const y = defil.scrollTop;
      if (TACTILE && panneau.hidden) { if (y > dernierY + 12 && y > 80) R.classList.add("immersion"); else if (y < dernierY - 18) R.classList.remove("immersion"); }
      dernierY = y;
      R.classList.add("defile"); clearTimeout(R._t); R._t = setTimeout(() => R.classList.remove("defile"), 900);
    }, { passive: true });
    ecouter(defil, "click", ev => { if (!TACTILE || ev.target.closest("a") || !getSelection().isCollapsed) return; if (panneau.hidden) R.classList.toggle("immersion"); });
    let panneauType = "";
    const fermerPanneau = () => { panneau.hidden = true; panneauType = ""; R.classList.remove("panneau-ouvert"); };
    const ouvrirPanneau = (type, titre, html) => {
      panneauType = type; panneau.hidden = false; panneau.className = "ls-panneau p-" + type;
      panneau.innerHTML = `<div class="lsp-tete"><h2>${titre}</h2><button class="ls-b" data-p="fermer" aria-label="Fermer">${ico("fermer")}</button></div>${html}`;
      $('[data-p="fermer"]', panneau).onclick = fermerPanneau; R.classList.remove("immersion"); R.classList.add("panneau-ouvert");
    };
    ecouter(R, "pointerdown", ev => { if (!panneau.hidden && TACTILE && ev.target.closest(".ls-defil")) fermerPanneau(); });
    const appliquerTaille = () => { const a = posHaut(); doc.style.setProperty("--taille", PREF_TXT.taille + "px"); allerPos(a); if (f.marque?.pos != null) poserRuban(f.marque.pos); };
    function ouvrirAffichage() {
      const opt = (v, t) => `<button class="lsp-o ${PREF_PDF.theme === v ? "actif" : ""}" data-v="${v}">${t}</button>`;
      ouvrirPanneau("affichage", "Affichage", `
        <div class="lsp-g"><div class="lsp-l">Fond</div><div class="lsp-seg">${opt("clair", "<i class='t-clair'></i>Clair")}${opt("sepia", "<i class='t-sepia'></i>Sépia")}${opt("nuit", "<i class='t-nuit'></i>Nuit")}</div></div>
        <div class="lsp-g"><div class="lsp-l">Taille du texte</div><div class="lsp-zoom"><button class="ls-b" data-z="-1" aria-label="Plus petit">${ico("moins")}</button><span id="lsp-z">${PREF_TXT.taille} px</span><button class="ls-b" data-z="1" aria-label="Plus grand">${ico("plus")}</button></div></div>`);
      $$("[data-v]", panneau).forEach(b => b.onclick = () => { PREF_PDF.theme = b.dataset.v; sauverPrefPdf(); R.className = R.className.replace(/theme-\w+/, "theme-" + b.dataset.v); $$("[data-v]", panneau).forEach(x => x.classList.toggle("actif", x === b)); });
      $$("[data-z]", panneau).forEach(b => b.onclick = () => { PREF_TXT.taille = Math.max(14, Math.min(28, PREF_TXT.taille + +b.dataset.z)); stock.ecrire("etagere.texte", PREF_TXT); $("#lsp-z", panneau).textContent = PREF_TXT.taille + " px"; appliquerTaille(); });
    }
    $$("[data-ls]", R).forEach(b => b.onclick = () => {
      const a = b.dataset.ls;
      if (a === "fermer") quitter();
      else if (a === "sommaire") { if (panneauType === "sommaire") return fermerPanneau(); ouvrirPanneau("sommaire", "Sommaire", O.sommaireHtml()); O.brancherSommaire(panneau, fermerPanneau); }
      else if (a === "affichage") panneauType === "affichage" ? fermerPanneau() : ouvrirAffichage();
      else if (a === "marque") O.menuMarque(b);
      else if (a === "ecouter") { if (VOIX.actif && VOIX.ch === ch) { VOIX.lecture ? pause() : jouer(); } else lancerVoix(ch); }
    });
    ecouter(document, "keydown", ev => {
      if (ev.target.closest("input,textarea,select") || document.querySelector(".menu, .voile")) return;
      if (ev.key === "Escape") { ev.preventDefault(); panneau.hidden ? quitter() : fermerPanneau(); }
      else if (ev.key === "m" && !ev.metaKey && !ev.ctrlKey) O.poserMarque();
      else if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", " "].includes(ev.key) && document.activeElement !== defil) defil.focus({ preventScroll: true });
    });
    const ro = new ResizeObserver(() => { if (f.marque?.pos != null) poserRuban(f.marque.pos); O.dessiner(); });
    ro.observe(doc); ecouteurs.push(() => ro.disconnect());
    // départ : marque-page demandé, sinon dernière position
    await new Promise(r => requestAnimationFrame(r));
    if (ALLER_MARQUE === ch && f.marque?.pos != null) allerPos(f.marque.pos);
    else if (f.posOrig?.pos) allerPos(f.posOrig.pos);
    ALLER_MARQUE = null;
    if (f.marque?.pos != null) poserRuban(f.marque.pos);
    defil.focus({ preventScroll: true });
    indexer(e).then(() => { if (!ferme) suivre(); }).catch(() => {});
    suivre();
    return Lx;
  }

  // ================= Liseuse : lecture de l'original (PDF) =================
  // Plein écran sur tous les appareils, rendu net à tout zoom, zoom à deux doigts maison,
  // texte sélectionnable, liens internes, sommaire du PDF, recherche, position mémorisée.
  const PREF_PDF = Object.assign({ rogner: true, theme: "clair", ajuste: "auto", zoom: 1, parDefaut: false }, stock.lire("etagere.pdf", {}));
  if ("nuit" in PREF_PDF) { if (PREF_PDF.nuit) PREF_PDF.theme = "nuit"; delete PREF_PDF.nuit; }
  const sauverPrefPdf = () => stock.ecrire("etagere.pdf", PREF_PDF);
  const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const TACTILE = matchMedia("(pointer: coarse)").matches;
  const MAX_PX = IOS ? 4.5e6 : 11e6;
  const ICL = {
    retour: `<path d="M15 5l-7 7 7 7"/>`,
    sommaire: `<path d="M4 6h16M4 12h10M4 18h13"/>`,
    chercher: `<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>`,
    aa: `<path d="M3 18l5-12 5 12M4.8 14h6.4M14.5 18l3.2-8 3.3 8M15.4 15.6h4.6"/>`,
    moins: `<path d="M6 12h12"/>`, plus: `<path d="M6 12h12M12 6v12"/>`,
    plein: `<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>`,
    fiche: `<path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M9 11h6M9 14.5h6M9 18h4"/>`,
    fermer: `<path d="M6 6l12 12M18 6L6 18"/>`,
    haut: `<path d="M6 15l6-6 6 6"/>`, bas: `<path d="M6 9l6 6 6-6"/>`,
    ecouter: `<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>`,
    marque: `<path d="M7 3.5h10v17l-5-3.8-5 3.8z"/>`
  };
  const ico = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICL[n]}</svg>`;
  let LISEUSE = null;

  async function ouvrirLiseuse(e, F, ch, opts = {}) {
    if (LISEUSE) LISEUSE.fermer(true);
    const f = P.fiches[ch] || (P.fiches[ch] = {});
    const R = document.createElement("div");
    R.className = "liseuse theme-" + PREF_PDF.theme; R.setAttribute("role", "dialog"); R.setAttribute("aria-label", titreDe(e));
    R.innerHTML = `
      <header class="ls-haut">
        <button class="ls-b" data-ls="fermer" aria-label="Fermer l'original" title="Fermer (Échap)">${ico("retour")}</button>
        <div class="ls-titre"><span class="ls-t">${echap(titreDe(e))}</span><span class="ls-sous" id="ls-sous"></span></div>
        <div class="ls-outils">
          <button class="ls-b" data-ls="sommaire" aria-label="Sommaire et parties" title="Sommaire et parties">${ico("sommaire")}</button>
          <button class="ls-b" data-ls="chercher" aria-label="Chercher dans le document" title="Chercher (Ctrl F)">${ico("chercher")}</button>
          <span class="ls-zoom"><button class="ls-b" data-ls="moins" aria-label="Réduire" title="Réduire (−)">${ico("moins")}</button><button class="ls-pc" data-ls="ajuster" title="Ajuster (0)">100 %</button><button class="ls-b" data-ls="plus" aria-label="Agrandir" title="Agrandir (+)">${ico("plus")}</button></span>
          <button class="ls-b" data-ls="ecouter" aria-label="Écouter" title="Écouter (K)">${ico("ecouter")}</button>
          <button class="ls-b ls-marque" data-ls="marque" aria-label="Marque-page">${ico("marque")}</button>
          <button class="ls-b" data-ls="affichage" aria-label="Affichage" title="Affichage">${ico("aa")}</button>
          ${document.fullscreenEnabled && !TACTILE ? `<button class="ls-b" data-ls="plein" aria-label="Plein écran" title="Plein écran (F)">${ico("plein")}</button>` : ""}
        </div>
      </header>
      <div class="ls-defil" tabindex="-1"><div class="ls-pages"><div class="ls-charge">${LOGO.svg()}</div></div></div>
      <button class="ls-pilule" aria-label="Aller à une page"><b id="ls-n">1</b><span id="ls-N"></span></button>
      <div class="ls-rail" aria-hidden="true"><div class="ls-poignee"><span class="ls-bulle"></span></div></div>
      <aside class="ls-panneau" hidden></aside>`;
    document.body.appendChild(R);
    document.documentElement.classList.add("liseuse-ouverte");
    const defil = $(".ls-defil", R), zone = $(".ls-pages", R), haut = $(".ls-haut", R), pilule = $(".ls-pilule", R), rail = $(".ls-rail", R), poignee = $(".ls-poignee", R), panneau = $(".ls-panneau", R);
    let ferme = false, pousse = false;
    const ecouteurs = [];
    const ecouter = (cible, type, fn, o) => { cible.addEventListener(type, fn, o); ecouteurs.push(() => cible.removeEventListener(type, fn, o)); };
    const L = LISEUSE = {
      ch,
      fermer(silence) {
        if (ferme) return; ferme = true;
        try { sauverPos(); } catch (x) {}
        if (VOIX.actif && VOIX.ch === ch) arreterVoix(false);
        ecouteurs.forEach(x => x());
        pages.forEach(p => { try { p.tache?.cancel(); } catch (x) {} libererCanvas(p); });
        if (document.fullscreenElement === R) document.exitFullscreen?.();
        R.classList.add("sort");
        setTimeout(() => R.remove(), silence ? 0 : 180);
        document.documentElement.classList.remove("liseuse-ouverte");
        if (LISEUSE === L) LISEUSE = null;
        fermerMenu();
      }
    };
    L.pousse = () => pousse;
    const quitter = () => aller(lienDom(e.domaine));

    // ---- Document ----
    let pdf = F.pdf;
    if (!pdf) { try { pdf = (await L_lire(e)).pdf; F.pdf = pdf; } catch (err) { zone.innerHTML = `<p class="erreur ls-err">Impossible d'ouvrir l'original : ${echap(err.message)}</p>`; return L; } }
    if (ferme) return L;
    const N = pdf.numPages;
    $("#ls-N", R).textContent = " / " + N;
    const p1 = await pdf.getPage(1), v1 = p1.getViewport({ scale: 1 });
    // cadre utile commun (marges blanches rognées)
    let cadre = { x0: 0, y0: 0, x1: v1.width, y1: v1.height };
    try {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const echant = [...new Set([1, 2, 3, 4, 5, 6, Math.ceil(N / 3), Math.ceil(N / 2), Math.ceil(2 * N / 3), N].filter(n => n >= 1 && n <= N))];
      for (const i of echant) {
        const pg = await pdf.getPage(i), tc = await pg.getTextContent();
        for (const it of tc.items) {
          if (!it.str || !it.str.trim() || !it.transform) continue;
          const s = Math.hypot(it.transform[2], it.transform[3]) || 10, x = it.transform[4], y = it.transform[5];
          x0 = Math.min(x0, x); x1 = Math.max(x1, x + (it.width || 0)); y0 = Math.min(y0, y - s * 0.4); y1 = Math.max(y1, y + s);
        }
      }
      if (isFinite(x0) && x1 - x0 > v1.width * 0.3) { const m = 16; cadre = { x0: Math.max(0, x0 - m), y0: Math.max(0, y0 - m), x1: Math.min(v1.width, x1 + m), y1: Math.min(v1.height, y1 + m) }; }
    } catch (err) {}
    if (ferme) return L;
    const pages = Array.from({ length: N }, (_, i) => ({ n: i + 1, w: v1.width, h: v1.height, el: null, c: null, s: 0, tache: null, det: null, texte: null, liens: null, cssW: 0, cssH: 0 }));
    // découpe d'une page (en points PDF, origine en bas à gauche)
    const decoupe = p => {
      if (!PREF_PDF.rogner) return { x0: 0, y0: 0, x1: p.w, y1: p.h };
      const fx = p.w / v1.width, fy = p.h / v1.height;
      return { x0: cadre.x0 * fx, y0: cadre.y0 * fy, x1: cadre.x1 * fx, y1: cadre.y1 * fy };
    };
    zone.innerHTML = pages.map(p => `<div class="ls-page" data-n="${p.n}"><span class="ls-num">${p.n}</span></div>`).join("");
    pages.forEach((p, i) => { p.el = zone.children[i]; });

    // ---- Mise en page : largeur de base × zoom ----
    const PAD = () => (innerWidth < 700 ? 0 : 28);
    const GAP = () => (innerWidth < 700 ? 8 : 18);
    const ajusteEffectif = () => PREF_PDF.ajuste === "auto" ? "largeur" : PREF_PDF.ajuste;
    const largeurBase = () => {
      const dispo = defil.clientWidth - 2 * PAD(), d = decoupe(pages[0]), ratio = (d.x1 - d.x0) / (d.y1 - d.y0);
      if (ajusteEffectif() === "page") return Math.max(240, Math.min(dispo, (defil.clientHeight - 24) * ratio));
      return Math.max(240, Math.min(dispo, PREF_PDF.ajuste === "largeur" ? 1400 : 900));
    };
    let zoom = PREF_PDF.zoom || 1;
    const disposer = () => {
      const w0 = largeurBase(), w = Math.round(w0 * zoom);
      const hh = haut.offsetHeight;
      zone.style.setProperty("--gap", GAP() + "px"); zone.style.padding = `${hh + GAP()}px ${PAD()}px ${Math.max(90, GAP())}px`;
      for (const p of pages) {
        const d = decoupe(p), ww = Math.round(w * (d.x1 - d.x0) / (decoupe(pages[0]).x1 - decoupe(pages[0]).x0));
        p.cssW = ww; p.cssH = Math.round(ww * (d.y1 - d.y0) / (d.x1 - d.x0));
        p.el.style.width = p.cssW + "px"; p.el.style.height = p.cssH + "px";
      }
      let y = hh + GAP(); for (const p of pages) { p.top = y; y += p.cssH + GAP(); }
      zone.classList.toggle("large", w + 2 * PAD() > defil.clientWidth + 1);
      const pc = $('[data-ls="ajuster"]', R); if (pc) pc.textContent = Math.round(zoom * 100) + " %";
    };
    // repère : point du document sous (x, y) écran, pour zoomer sans perdre sa place
    const repere = (x, y) => {
      const r = defil.getBoundingClientRect(); x = x ?? r.left + r.width / 2; y = y ?? r.top + r.height * 0.3;
      const dy = y - r.top + defil.scrollTop;
      let best = pages[0];
      for (const p of pages) { if (p.top <= dy) best = p; else break; }
      const b = best.el.getBoundingClientRect();
      return { p: best, fx: (x - b.left) / b.width, fy: (y - b.top) / b.height, x, y };
    };
    const allerRepere = a => {
      const b = a.p.el.getBoundingClientRect(), r = defil.getBoundingClientRect();
      defil.scrollTop += (b.top + a.fy * b.height) - a.y;
      defil.scrollLeft += (b.left + a.fx * b.width) - a.x;
      void r;
    };
    const zoomer = (z, x, y) => {
      z = Math.max(0.5, Math.min(6, z));
      const a = repere(x, y);
      zoom = z; PREF_PDF.zoom = z; sauverPrefPdf();
      zone.style.transform = ""; disposer(); allerRepere(a);
      if (f.marque?.pos != null) poserRuban(f.marque.pos);
      for (const p of pages) supprimerDetail(p);
      planifier(true);
    };

    // ---- Rendu : file prioritaire, annulations, libération ----
    const qualite = () => Math.max(1, window.devicePixelRatio || 1) * (IOS ? 1 : 1.25);
    function libererCanvas(p) { if (p.c) { p.c.width = 0; p.c.height = 0; p.c.remove(); p.c = null; p.s = 0; } supprimerDetail(p); if (p.texte) { p.texte.remove(); p.texte = null; } if (p.liens) { p.liens.remove(); p.liens = null; } p.el?.classList.remove("pret"); }
    function supprimerDetail(p) { if (p.det) { try { p.det.tache?.cancel(); } catch (x) {} p.det.c.width = 0; p.det.c.remove(); p.det = null; } }
    let enCours = 0; const MAX_TACHES = TACTILE ? 1 : 2;
    const visibles = () => { const t = defil.scrollTop, h = defil.clientHeight; return pages.filter(p => p.top + p.cssH > t - h * 1.2 && p.top < t + h * 2.2); };
    const dansVue = p => { const t = defil.scrollTop, h = defil.clientHeight; return p.top + p.cssH > t && p.top < t + h; };
    const echelleVoulue = p => { const d = decoupe(p); let s = p.cssW / (d.x1 - d.x0) * qualite(); const px = (d.x1 - d.x0) * s * (d.y1 - d.y0) * s; if (px > MAX_PX) s *= Math.sqrt(MAX_PX / px); return s; };
    async function rendrePage(p) {
      const s = echelleVoulue(p);
      if (p.occupe || (p.c && Math.abs(p.s - s) / s < 0.06)) return false;
      enCours++; p.occupe = true;
      try {
        const page = await pdf.getPage(p.n);
        const v = page.getViewport({ scale: 1 });
        if (v.width !== p.w || v.height !== p.h) { p.w = v.width; p.h = v.height; const a = repere(); disposer(); allerRepere(a); }
        const d = decoupe(p), s2 = echelleVoulue(p);
        const vp = page.getViewport({ scale: s2, offsetX: -d.x0 * s2, offsetY: -(p.h - d.y1) * s2 });
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round((d.x1 - d.x0) * s2)); c.height = Math.max(1, Math.round((d.y1 - d.y0) * s2));
        const cx = c.getContext("2d", { alpha: false }); cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
        p.tache = page.render({ canvasContext: cx, viewport: vp });
        await p.tache.promise; p.tache = null;
        if (ferme) { c.width = 0; return false; }
        c.className = "ls-c";
        if (p.c) { p.c.width = 0; p.c.remove(); }
        p.el.prepend(c); p.c = c; p.s = s2; p.el.classList.add("pret");
        if (!p.texte) coucheTexte(p, page).catch(() => {});
        if (!p.liens) coucheLiens(p, page).catch(() => {});
        return true;
      } catch (err) { p.tache = null; return false; }
      finally { enCours--; p.occupe = false; }
    }
    // couche de texte (sélection, copie, recherche) et liens cliquables
    async function coucheTexte(p, page) {
      if (!window.pdfjsLib?.renderTextLayer) return;
      const d = decoupe(p), k = p.cssW / (d.x1 - d.x0);
      const div = document.createElement("div"); div.className = "textLayer ls-texte";
      div.style.setProperty("--scale-factor", k); div.style.left = (-d.x0 * k) + "px"; div.style.top = (-(p.h - d.y1) * k) + "px";
      p.texte = div; p.el.appendChild(div);
      const tc = await texteDe(p.n, page);
      const divs = [];
      await pdfjsLib.renderTextLayer({ textContentSource: tc, container: div, viewport: page.getViewport({ scale: k }), textDivs: divs }).promise;
      div.__divs = divs;
      if (RECH.q) marquerTrouves(p);
    }
    async function coucheLiens(p, page) {
      const an = await page.getAnnotations({ intent: "display" });
      const liens = an.filter(a => a.subtype === "Link" && (a.url || a.dest));
      if (!liens.length) { p.liens = document.createElement("div"); return; }
      const d = decoupe(p), k = p.cssW / (d.x1 - d.x0);
      const div = document.createElement("div"); div.className = "ls-liens";
      for (const a of liens) {
        const [x0, y0, x1, y1] = a.rect, l = document.createElement("a");
        l.style.left = ((Math.min(x0, x1) - d.x0) * k) + "px"; l.style.top = ((d.y1 - Math.max(y0, y1)) * k) + "px";
        l.style.width = (Math.abs(x1 - x0) * k) + "px"; l.style.height = (Math.abs(y1 - y0) * k) + "px";
        if (a.url) { l.href = a.url; l.target = "_blank"; l.rel = "noopener"; l.title = a.url; }
        else { l.href = "#"; l.title = "Aller à la destination"; l.onclick = ev => { ev.preventDefault(); allerDest(a.dest); }; }
        div.appendChild(l);
      }
      p.liens = div; p.el.appendChild(div);
    }
    // détail net quand on zoome fort : on redessine seulement la partie visible
    async function rendreDetail(p) {
      const sVoulue = (() => { const d = decoupe(p); return p.cssW / (d.x1 - d.x0) * qualite(); })();
      if (!p.c || p.s >= sVoulue * 0.94) { supprimerDetail(p); return; }
      const r = defil.getBoundingClientRect(), b = p.el.getBoundingClientRect();
      const x0 = Math.max(0, r.left - b.left - 60), y0 = Math.max(0, r.top - b.top - 60);
      const x1 = Math.min(b.width, r.right - b.left + 60), y1 = Math.min(b.height, r.bottom - b.top + 60);
      if (x1 <= x0 || y1 <= y0) { supprimerDetail(p); return; }
      if (p.det && p.det.x0 <= x0 && p.det.y0 <= y0 && p.det.x1 >= x1 && p.det.y1 >= y1 && p.det.cssW === p.cssW) return;
      const d = decoupe(p), k = p.cssW / (d.x1 - d.x0);
      let q = qualite(); const px = (x1 - x0) * (y1 - y0) * q * q; if (px > MAX_PX) q *= Math.sqrt(MAX_PX / px);
      const s = k * q;
      const page = await pdf.getPage(p.n);
      const vp = page.getViewport({ scale: s, offsetX: -(d.x0 * k + x0) * q, offsetY: -((p.h - d.y1) * k + y0) * q });
      const c = document.createElement("canvas"); c.width = Math.round((x1 - x0) * q); c.height = Math.round((y1 - y0) * q);
      const cx = c.getContext("2d", { alpha: false }); cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
      const det = { c, x0, y0, x1, y1, cssW: p.cssW, tache: null };
      det.tache = page.render({ canvasContext: cx, viewport: vp });
      try { await det.tache.promise; } catch (err) { c.width = 0; return; }
      if (ferme || p.cssW !== det.cssW) { c.width = 0; return; }
      c.className = "ls-det"; Object.assign(c.style, { left: x0 + "px", top: y0 + "px", width: (x1 - x0) + "px", height: (y1 - y0) + "px" });
      const ancien = p.det; p.el.insertBefore(c, p.c.nextSibling); p.det = det;
      if (ancien) { ancien.c.width = 0; ancien.c.remove(); }
    }
    let planif = 0, repos = 0;
    function planifier(vite) {
      if (ferme) return;
      cancelAnimationFrame(planif);
      planif = requestAnimationFrame(async () => {
        const proches = visibles();
        const t0 = defil.scrollTop, h0 = defil.clientHeight, centre = t0 + h0 / 2;
        proches.sort((a, b) => Math.abs(a.top + a.cssH / 2 - centre) - Math.abs(b.top + b.cssH / 2 - centre));
        // libère loin, annule ce qui sort
        const garder = new Set(proches.map(p => p.n));
        for (const p of pages) {
          if (garder.has(p.n)) continue;
          if (p.tache) { try { p.tache.cancel(); } catch (x) {} }
          if (p.c && (p.top + p.cssH < t0 - h0 * 3 || p.top > t0 + h0 * 4)) libererCanvas(p);
          else supprimerDetail(p);
        }
        for (const p of proches) { if (enCours >= MAX_TACHES) break; if (!p.occupe) rendrePage(p).then(ok => { if (ok) planifier(); }); }
        clearTimeout(repos);
        repos = setTimeout(() => { if (!ferme) proches.filter(dansVue).forEach(p => rendreDetail(p).catch(() => {})); }, vite ? 60 : 200);
      });
    }

    // ---- Page courante, position mémorisée ----
    let courante = 1, minutSauve;
    const sections = [];
    const sectionDe = n => O.libelle(n + 0.5);
    function suivre() {
      const mi = defil.scrollTop + defil.clientHeight * 0.4;
      let n = 1; for (const p of pages) { if (p.top < mi) n = p.n; else break; }
      if (n !== courante) { courante = n; $("#ls-n", R).textContent = n; }
      $("#ls-sous", R).textContent = O.libelle(posHaut());
      O.verifier();
      const max = defil.scrollHeight - defil.clientHeight;
      const fr = max > 0 ? defil.scrollTop / max : 0;
      poignee.style.transform = `translateY(${(fr * (rail.clientHeight - poignee.offsetHeight)).toFixed(1)}px)`;
      clearTimeout(minutSauve); minutSauve = setTimeout(sauverPos, 500);
    }
    // position dans le document : n° de page + fraction de la page entière (indépendante du zoom et du rognage)
    const posA = y => {
      let p = pages[0]; for (const q of pages) { if (q.top <= y) p = q; else break; }
      const d = decoupe(p), fc = Math.max(0, Math.min(1, (y - p.top) / Math.max(1, p.cssH)));
      return p.n + Math.max(0, Math.min(0.999, ((p.h - d.y1) + fc * (d.y1 - d.y0)) / p.h));
    };
    const posHaut = () => posA(defil.scrollTop + (chromeCache ? 0 : haut.offsetHeight) + 6);
    const posBas = () => posA(defil.scrollTop + defil.clientHeight * 0.45);
    const finAtteinte = () => defil.scrollTop + defil.clientHeight >= defil.scrollHeight - 40;
    const yDe = pos => {
      const n = Math.max(1, Math.min(N, Math.floor(pos))), p = pages[n - 1], d = decoupe(p);
      const fc = Math.max(0, Math.min(1, ((pos - n) * p.h - (p.h - d.y1)) / (d.y1 - d.y0)));
      return { p, y: p.top + fc * p.cssH };
    };
    const allerPos = pos => { defil.scrollTop = yDe(pos).y - (chromeCache ? 0 : haut.offsetHeight) - 14; suivre(); planifier(true); };
    function sauverPos() { const ph = posHaut(); f.posOrig = { pos: ph, q: (ph - 1) / N, t: Date.now() }; f.pageOrig = Math.floor(ph); sauver(); }
    let ruban = null;
    const poserRuban = pos => {
      ruban?.remove(); ruban = null; if (pos == null) return;
      const { p, y } = yDe(pos);
      ruban = document.createElement("span"); ruban.className = "ls-ruban"; ruban.style.top = (y - p.top) + "px"; p.el.appendChild(ruban);
    };
    const O = outilsLecture({ R, ch, pdf: true, marge: 1.2, posHaut, posBas, finAtteinte, allerPos, ruban: poserRuban, fraction: p => (p - 1) / N });
    const allerPage = (n, fy = 0, lisse) => {
      n = Math.max(1, Math.min(N, n)); const p = pages[n - 1];
      const r = defil.getBoundingClientRect(), b = p.el.getBoundingClientRect();
      defil.scrollTo({ top: defil.scrollTop + b.top - r.top + fy * b.height - (fy ? r.height * 0.25 : GAP() + (chromeCache ? 0 : haut.offsetHeight)), behavior: lisse && !reduit() ? "smooth" : "auto" });
      if (!lisse) suivre();
    };
    async function allerDest(dest) {
      try {
        const d = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
        if (!d) return;
        const idx = typeof d[0] === "number" ? d[0] : await pdf.getPageIndex(d[0]);
        const p = pages[idx]; let fy = 0;
        if (d[1] && d[1].name === "XYZ" && typeof d[3] === "number") { const c = decoupe(p); fy = Math.max(0, Math.min(1, (c.y1 - d[3]) / (c.y1 - c.y0))); }
        else if (d[1] && (d[1].name === "FitH" || d[1].name === "FitBH") && typeof d[2] === "number") { const c = decoupe(p); fy = Math.max(0, Math.min(1, (c.y1 - d[2]) / (c.y1 - c.y0))); }
        allerPage(idx + 1, fy);
      } catch (err) {}
    }

    // ---- Interface : barre qui se cache, pilule, rail ----
    let chromeCache = false, dernierY = 0;
    const montrerChrome = v => { chromeCache = !v; R.classList.toggle("immersion", !v); };
    ecouter(defil, "scroll", () => {
      planifier(); suivre();
      const y = defil.scrollTop;
      if (TACTILE && panneau.hidden) { if (y > dernierY + 12 && y > 80) montrerChrome(false); else if (y < dernierY - 18) montrerChrome(true); }
      dernierY = y;
      R.classList.add("defile"); clearTimeout(R._t); R._t = setTimeout(() => R.classList.remove("defile"), 900);
    }, { passive: true });
    // rail : glisser pour parcourir vite
    let railActif = false;
    const railVers = y => {
      const rr = rail.getBoundingClientRect(), fr = Math.max(0, Math.min(1, (y - rr.top - poignee.offsetHeight / 2) / (rr.height - poignee.offsetHeight)));
      defil.scrollTop = fr * (defil.scrollHeight - defil.clientHeight);
      const n = courante; $(".ls-bulle", R).innerHTML = `<b>${n}</b>${sectionDe(n) ? `<span>${echap(sectionDe(n))}</span>` : ""}`;
    };
    ecouter(rail, "pointerdown", ev => { railActif = true; rail.setPointerCapture(ev.pointerId); R.classList.add("rail-actif"); railVers(ev.clientY); ev.preventDefault(); });
    ecouter(rail, "pointermove", ev => { if (railActif) railVers(ev.clientY); });
    const finRail = () => { if (!railActif) return; railActif = false; R.classList.remove("rail-actif"); planifier(true); };
    ecouter(rail, "pointerup", finRail); ecouter(rail, "pointercancel", finRail);
    pilule.onclick = () => {
      if (pilule.querySelector("input")) return;
      pilule.innerHTML = `<input inputmode="numeric" aria-label="Numéro de page" value="${courante}"><span>/ ${N}</span>`;
      const inp = $("input", pilule); inp.focus(); inp.select();
      const fin = ok => { const v = parseInt(inp.value, 10); pilule.innerHTML = `<b id="ls-n">${courante}</b><span id="ls-N"> / ${N}</span>`; if (ok && v) { allerPage(v); suivre(); } };
      inp.onkeydown = ev => { if (ev.key === "Enter") { ev.preventDefault(); fin(true); } else if (ev.key === "Escape") { ev.stopPropagation(); fin(false); } };
      inp.onblur = () => fin(true);
    };

    // ---- Gestes : pincer, double-toucher, ctrl + molette ----
    let pince = null, dernierTap = 0, tapMinut = 0;
    const apercu = (s, ox, oy) => { zone.style.transformOrigin = `${ox}px ${oy}px`; zone.style.transform = `scale(${s})`; };
    ecouter(defil, "touchstart", ev => {
      if (ev.touches.length === 2) {
        const [a, b] = ev.touches, rz = zone.getBoundingClientRect();
        const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
        pince = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mx, my, ox: mx - rz.left, oy: my - rz.top, s: 1 };
        clearTimeout(tapMinut);
      }
    }, { passive: true });
    ecouter(defil, "touchmove", ev => {
      if (pince && ev.touches.length === 2) {
        ev.preventDefault();
        const [a, b] = ev.touches; let s = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pince.d0;
        s = Math.max(0.5 / zoom, Math.min(6 / zoom, s)); pince.s = s;
        apercu(s, pince.ox, pince.oy);
      }
    }, { passive: false });
    const finPince = ev => {
      if (!pince || (ev.touches && ev.touches.length >= 2)) return;
      const { s, mx, my } = pince; pince = null;
      if (Math.abs(s - 1) < 0.03) { zone.style.transform = ""; return; }
      zoomer(zoom * s, mx, my);
    };
    ecouter(defil, "touchend", finPince); ecouter(defil, "touchcancel", finPince);
    // toucher simple : barres ; double toucher (ou double clic) : zoom sur le passage
    let appui = null;
    ecouter(defil, "pointerdown", ev => { appui = { x: ev.clientX, y: ev.clientY, t: Date.now(), n: ev.isPrimary }; }, { passive: true });
    ecouter(defil, "pointerup", ev => {
      if (!appui || ev.pointerType !== "touch" || pince) return;
      const bouge = Math.hypot(ev.clientX - appui.x, ev.clientY - appui.y) > 12, long = Date.now() - appui.t > 400;
      if (bouge || long || ev.target.closest("a")) { appui = null; return; }
      const t = Date.now();
      if (t - dernierTap < 360 && Math.hypot(ev.clientX - (defil._tx || 0), ev.clientY - (defil._ty || 0)) < 40) {
        clearTimeout(tapMinut); dernierTap = 0;
        zoomer(zoom > 1.15 ? 1 : 2.2, ev.clientX, ev.clientY);
        return;
      }
      dernierTap = t; defil._tx = ev.clientX; defil._ty = ev.clientY;
      tapMinut = setTimeout(() => { if (!getSelection().isCollapsed) return; if (panneau.hidden) montrerChrome(chromeCache); }, 300);
    });
    ecouter(defil, "dblclick", ev => { if (TACTILE || ev.target.closest(".textLayer span")) return; zoomer(zoom > 1.15 ? 1 : 2, ev.clientX, ev.clientY); });
    let molette = null;
    ecouter(defil, "wheel", ev => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      const rz = zone.getBoundingClientRect();
      if (!molette) molette = { s: 1, x: ev.clientX, y: ev.clientY, ox: ev.clientX - rz.left, oy: ev.clientY - rz.top };
      molette.s = Math.max(0.5 / zoom, Math.min(6 / zoom, molette.s * Math.exp(-Math.max(-60, Math.min(60, ev.deltaY * (ev.deltaMode ? 33 : 1))) * 0.0035)));
      apercu(molette.s, molette.ox, molette.oy);
      clearTimeout(molette.t); molette.t = setTimeout(() => { const m = molette; molette = null; zoomer(zoom * m.s, m.x, m.y); }, 160);
    }, { passive: false });
    // Safari ordinateur : pincement du pavé tactile
    ecouter(defil, "gesturestart", ev => ev.preventDefault());
    ecouter(defil, "gesturechange", ev => ev.preventDefault());

    // ---- Clavier ----
    ecouter(document, "keydown", ev => {
      if (ev.target.closest("input,textarea,select")) { if (ev.key === "Escape" && ev.target.closest(".ls-panneau")) { fermerPanneau(); ev.preventDefault(); } return; }
      if (document.querySelector(".menu, .voile")) return;
      const k = ev.key, mod = ev.ctrlKey || ev.metaKey;
      if (mod && k.toLowerCase() === "f") { ev.preventDefault(); ouvrirRecherche(); }
      else if (mod && (k === "+" || k === "=")) { ev.preventDefault(); zoomer(zoom * 1.2); }
      else if (mod && k === "-") { ev.preventDefault(); zoomer(zoom / 1.2); }
      else if (mod && k === "0") { ev.preventDefault(); zoomer(1); }
      else if (mod) return;
      else if (k === "Escape") { ev.preventDefault(); if (!panneau.hidden) fermerPanneau(); else quitter(); }
      else if (k === "ArrowRight" || k === "PageDown" && ev.shiftKey) { ev.preventDefault(); allerPage(courante + 1); }
      else if (k === "ArrowLeft") { ev.preventDefault(); allerPage(courante - 1); }
      else if (k === "Home") { ev.preventDefault(); allerPage(1); }
      else if (k === "End") { ev.preventDefault(); allerPage(N); }
      else if (k === "+" || k === "=") zoomer(zoom * 1.2);
      else if (k === "-") zoomer(zoom / 1.2);
      else if (k === "0") zoomer(1);
      else if (k === "f" && document.fullscreenEnabled) basculerPlein();
      else if (k === "/") { ev.preventDefault(); ouvrirRecherche(); }
      else if (k === "m") O.poserMarque();
      else if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", " "].includes(k) && document.activeElement !== defil) { defil.focus({ preventScroll: true }); }
    });
    const basculerPlein = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else R.requestFullscreen?.().catch(() => {}); };

    // ---- Panneaux : sommaire, recherche, affichage ----
    let panneauType = "";
    function ouvrirPanneau(type, html) {
      panneauType = type; panneau.hidden = false; panneau.className = "ls-panneau p-" + type;
      panneau.innerHTML = `<div class="lsp-tete"><h2>${{ sommaire: "Sommaire", chercher: "Chercher", affichage: "Affichage" }[type]}</h2><button class="ls-b" data-p="fermer" aria-label="Fermer">${ico("fermer")}</button></div>${html}`;
      $('[data-p="fermer"]', panneau).onclick = fermerPanneau;
      montrerChrome(true); R.classList.add("panneau-ouvert");
    }
    function fermerPanneau() { if (panneauType === "chercher" && RECH.q) { RECH.q = ""; RECH.res = []; RECH.jeton++; pages.forEach(p => p.texte && marquerTrouves(p)); } panneau.hidden = true; panneauType = ""; R.classList.remove("panneau-ouvert"); defil.focus({ preventScroll: true }); }
    ecouter(R, "pointerdown", ev => { if (!panneau.hidden && TACTILE && ev.target.closest(".ls-defil")) fermerPanneau(); });
    // sommaire et parties (index construit à l'ajout du document)
    indexer(e).then(() => { if (!ferme) suivre(); }).catch(() => {});
    function ouvrirSommaire() { ouvrirPanneau("sommaire", O.sommaireHtml()); O.brancherSommaire(panneau, fermerPanneau); }
    // ---- Lecture à voix haute de l'original ----
    let voixMarques = [];
    L.voix = {
      async segments() {
        const depart = Math.max(1, Math.floor(posHaut())), segs = [];
        for (let n = depart; n <= N; n++) {
          const tc = await texteDe(n), items = tc.items.filter(it => it.str !== undefined);
          let t = ""; for (const it of items) t += it.str + (it.hasEOL ? " " : "");
          const re = /[^.!?…]+(?:[.!?…]+[»")\]]*|$)/g; let m;
          while ((m = re.exec(t))) {
            const brut = m[0];
            if (brut.trim()) {
              const a = m.index + brut.length - brut.trimStart().length, b = m.index + brut.trimEnd().length;
              const dire = prononcer(t.slice(a, b).replace(/(\p{L})-\s+(\p{Ll})/gu, "$1$2"));
              if (dire.replace(/[\s\d.,;:!?()-]/g, "").length >= 2) segs.push({ ls: true, n, a, b, dire, pause: 60, titre: false, el: pages[n - 1].el, nodes: [], d: 0, f: 0 });
            }
            if (re.lastIndex === m.index) re.lastIndex++;
          }
          if (n % 10 === 0) await pause0();
        }
        return segs;
      },
      surligner(seg) {
        voixMarques.forEach(d => d.classList.remove("ls-lu")); voixMarques = [];
        if (!seg || ferme) return;
        const p = pages[seg.n - 1];
        const appliquer = () => {
          const divs = p.texte?.__divs; if (!divs) return false;
          const tc = TEXTES.get(seg.n); if (!tc) return false;
          tc.then(tc2 => {
            if (VOIX.segs[VOIX.i] !== seg) return;
            let pos = 0;
            tc2.items.filter(it => it.str !== undefined).forEach((it, idx) => { const a = pos, b = pos + it.str.length; pos = b + (it.hasEOL ? 1 : 0); if (b > seg.a && a < seg.b && divs[idx]) { divs[idx].classList.add("ls-lu"); voixMarques.push(divs[idx]); } });
          });
          return true;
        };
        if (!appliquer()) { let k = 0; const t = setInterval(() => { if (ferme || VOIX.segs[VOIX.i] !== seg || appliquer() || ++k > 40) clearInterval(t); }, 150); }
      },
      suivre(seg) {
        if (Date.now() - VOIX.defilManuel < 4000) return;
        setTimeout(() => {
          if (ferme) return;
          const d = voixMarques[0], rr = defil.getBoundingClientRect();
          let y;
          if (d) { const r = d.getBoundingClientRect(); if (r.top > rr.top + rr.height * 0.15 && r.bottom < rr.top + rr.height * 0.72) return; y = defil.scrollTop + r.top - rr.top - rr.height * 0.3; }
          else { const p = pages[seg.n - 1]; if (p.top + p.cssH > defil.scrollTop && p.top < defil.scrollTop + defil.clientHeight * 0.5) return; y = p.top - haut.offsetHeight; }
          defil.scrollTo({ top: y, behavior: reduit() ? "auto" : "smooth" });
        }, 80);
      },
      titre(seg) { return O.libelle(seg.n + 0.5) || "Page " + seg.n; }
    };
    // recherche plein texte
    const TEXTES = new Map();
    async function texteDe(n, page) {
      if (TEXTES.has(n)) return TEXTES.get(n);
      const pr = (page ? Promise.resolve(page) : pdf.getPage(n)).then(pg => pg.getTextContent());
      TEXTES.set(n, pr); return pr;
    }
    const plier = s => s.replace(/[\s\S]/g, c => (c.normalize("NFD")[0] || c).toLowerCase());
    const RECH = { q: "", res: [], i: -1, jeton: 0 };
    async function chercherTout(q) {
      const j = ++RECH.jeton; RECH.q = q; RECH.res = []; RECH.i = -1;
      pages.forEach(p => p.texte && marquerTrouves(p));
      const liste = $(".lsp-res", panneau), info = $(".lsp-info", panneau);
      if (!q || q.length < 2) { liste.innerHTML = ""; info.textContent = ""; return; }
      const qp = plier(q); liste.innerHTML = ""; let total = 0;
      for (let n = 1; n <= N; n++) {
        if (j !== RECH.jeton || ferme) return;
        const tc = await texteDe(n);
        const items = tc.items.filter(it => it.str !== undefined);
        let t = "", bornes = [];
        for (const it of items) { bornes.push(t.length); t += it.str + (it.hasEOL ? " " : ""); }
        const tp = plier(t); let i = tp.indexOf(qp), parPage = 0;
        while (i >= 0 && parPage < 50) {
          const a = Math.max(0, i - 50), b = Math.min(t.length, i + qp.length + 70);
          RECH.res.push({ n, i, l: qp.length }); total++; parPage++;
          if (total <= 300) liste.insertAdjacentHTML("beforeend", `<li><button class="lsp-r" data-k="${RECH.res.length - 1}"><span class="lsp-p">p. ${n}</span><span>${a > 0 ? "…" : ""}${echap(t.slice(a, i))}<mark>${echap(t.slice(i, i + qp.length))}</mark>${echap(t.slice(i + qp.length, b))}${b < t.length ? "…" : ""}</span></button></li>`);
          i = tp.indexOf(qp, i + qp.length);
        }
        if (n % 10 === 0 || n === N) info.textContent = `${total} résultat${total > 1 ? "s" : ""}${n < N ? ` · page ${n} / ${N}…` : ""}`;
        if (n % 20 === 0) await new Promise(r => setTimeout(r, 0));
      }
      if (!total) info.textContent = "Aucun résultat";
      pages.forEach(p => p.texte && marquerTrouves(p));
    }
    function marquerTrouves(p) {
      const divs = p.texte?.__divs; if (!divs) return;
      divs.forEach(d => { if (d.__brut !== undefined) { d.textContent = d.__brut; delete d.__brut; } });
      if (!RECH.q) return;
      TEXTES.get(p.n)?.then(tc => {
        const items = tc.items.filter(it => it.str !== undefined);
        let pos = 0; const bornes = items.map(it => { const b = [pos, pos + it.str.length]; pos += it.str.length + (it.hasEOL ? 1 : 0); return b; });
        const parDiv = new Map();
        RECH.res.forEach((r, k) => {
          if (r.n !== p.n) return;
          bornes.forEach(([a, b], idx) => { if (b > r.i && a < r.i + r.l && divs[idx]) { const l = parDiv.get(idx) || []; l.push([Math.max(0, r.i - a), Math.min(b - a, r.i + r.l - a), k === RECH.i]); parDiv.set(idx, l); } });
        });
        for (const [idx, zones] of parDiv) {
          const d = divs[idx], t = d.textContent; d.__brut = t;
          zones.sort((x, y) => x[0] - y[0]);
          let h = "", o = 0;
          for (const [a, b, act] of zones) { if (a < o) continue; h += echap(t.slice(o, a)) + `<mark class="${act ? "ls-trouve-actif" : "ls-trouve"}">${echap(t.slice(a, b))}</mark>`; o = b; }
          d.innerHTML = h + echap(t.slice(o));
        }
      });
    }
    function allerResultat(k) {
      if (!RECH.res.length) return;
      RECH.i = (k + RECH.res.length) % RECH.res.length;
      const r = RECH.res[RECH.i], p = pages[r.n - 1];
      $$(".lsp-r", panneau).forEach(b => b.classList.toggle("actif", +b.dataset.k === RECH.i));
      $(`.lsp-r[data-k="${RECH.i}"]`, panneau)?.scrollIntoView({ block: "nearest" });
      allerPage(r.n);
      const viser = () => {
        marquerTrouves(p);
        setTimeout(() => {
          const d = p.texte?.querySelector(".ls-trouve-actif");
          if (d) { const b = d.getBoundingClientRect(), rr = defil.getBoundingClientRect(); defil.scrollTop += b.top - rr.top - rr.height * 0.3; }
        }, 60);
      };
      if (p.texte?.__divs) viser(); else { let k2 = 0; const t = setInterval(() => { if (p.texte?.__divs || ++k2 > 40) { clearInterval(t); viser(); } }, 100); }
      $(".lsp-info", panneau).textContent = `${RECH.i + 1} / ${RECH.res.length}`;
    }
    function ouvrirRecherche() {
      ouvrirPanneau("chercher", `<form class="lsp-form"><input type="search" placeholder="Mot ou expression" aria-label="Chercher dans le document" value="${echap(RECH.q)}" enterkeyhint="search"><button type="button" class="ls-b" data-r="prec" aria-label="Résultat précédent">${ico("haut")}</button><button type="button" class="ls-b" data-r="suiv" aria-label="Résultat suivant">${ico("bas")}</button></form><div class="lsp-info"></div><ol class="lsp-res"></ol>`);
      const inp = $("input", panneau); let t;
      inp.focus(); inp.select();
      inp.oninput = () => { clearTimeout(t); t = setTimeout(() => chercherTout(inp.value.trim()), 280); };
      $("form", panneau).onsubmit = ev => { ev.preventDefault(); if (RECH.q !== inp.value.trim()) chercherTout(inp.value.trim()).then(() => allerResultat(0)); else allerResultat(RECH.i + 1); if (TACTILE) inp.blur(); };
      $('[data-r="prec"]', panneau).onclick = () => allerResultat(RECH.i - 1);
      $('[data-r="suiv"]', panneau).onclick = () => allerResultat(RECH.i + 1);
      $(".lsp-res", panneau).onclick = ev => { const b = ev.target.closest(".lsp-r"); if (b) { allerResultat(+b.dataset.k); if (TACTILE) fermerPanneau(); } };
      if (RECH.q) chercherTout(RECH.q);
    }
    function ouvrirAffichage() {
      const opt = (k, v, t) => `<button class="lsp-o ${PREF_PDF[k] === v ? "actif" : ""}" data-k="${k}" data-v="${v}">${t}</button>`;
      ouvrirPanneau("affichage", `
        <div class="lsp-g"><div class="lsp-l">Fond des pages</div><div class="lsp-seg themes">${opt("theme", "clair", "<i class='t-clair'></i>Clair")}${opt("theme", "sepia", "<i class='t-sepia'></i>Sépia")}${opt("theme", "nuit", "<i class='t-nuit'></i>Nuit")}</div></div>
        <div class="lsp-g"><div class="lsp-l">Ajustement</div><div class="lsp-seg">${opt("ajuste", "auto", "Auto")}${opt("ajuste", "largeur", "Largeur")}${opt("ajuste", "page", "Page entière")}</div></div>
        <div class="lsp-g"><div class="lsp-l">Taille</div><div class="lsp-zoom"><button class="ls-b" data-z="moins" aria-label="Réduire">${ico("moins")}</button><span id="lsp-z">${Math.round(zoom * 100)} %</span><button class="ls-b" data-z="plus" aria-label="Agrandir">${ico("plus")}</button><button class="lsp-o" data-z="un">100 %</button></div></div>
        <label class="lsp-c"><span><b>Rogner les marges</b><small>Le texte prend toute la largeur de l'écran</small></span><input type="checkbox" data-c="rogner" ${PREF_PDF.rogner ? "checked" : ""}></label>
        <p class="lsp-aide">${TACTILE ? "Pince pour zoomer, touche deux fois pour agrandir un passage, touche une fois pour masquer les barres. Glisse sur le bord droit pour parcourir vite. Appui long sur le texte pour le sélectionner." : "Ctrl + molette ou pincement du pavé pour zoomer. Flèches ← → : page précédente / suivante. Ctrl F : chercher. F : plein écran. Échap : fermer."}</p>`);
      $$(".lsp-o[data-k]", panneau).forEach(b => b.onclick = () => {
        const k = b.dataset.k, v = b.dataset.v; PREF_PDF[k] = v; sauverPrefPdf();
        $$(`.lsp-o[data-k="${k}"]`, panneau).forEach(x => x.classList.toggle("actif", x === b));
        if (k === "theme") { R.className = R.className.replace(/theme-\w+/, "theme-" + v); }
        if (k === "ajuste") { zoom = 1; PREF_PDF.zoom = 1; sauverPrefPdf(); const a = repere(); disposer(); allerRepere(a); pages.forEach(supprimerDetail); planifier(true); $("#lsp-z", panneau).textContent = "100 %"; }
      });
      $$("[data-z]", panneau).forEach(b => b.onclick = () => { zoomer(b.dataset.z === "un" ? 1 : zoom * (b.dataset.z === "plus" ? 1.2 : 1 / 1.2)); $("#lsp-z", panneau).textContent = Math.round(zoom * 100) + " %"; });
      $$("[data-c]", panneau).forEach(c => c.onchange = () => {
        PREF_PDF[c.dataset.c] = c.checked; sauverPrefPdf();
        if (c.dataset.c === "rogner") { const a = repere(); pages.forEach(libererCanvas); disposer(); allerRepere(a); if (f.marque?.pos != null) poserRuban(f.marque.pos); planifier(true); }
      });
    }
    $$("[data-ls]", R).forEach(b => b.onclick = () => {
      const a = b.dataset.ls;
      if (a === "fermer") quitter();
      else if (a === "marque") O.menuMarque(b);
      else if (a === "ecouter") { if (VOIX.actif && VOIX.ch === ch) { VOIX.lecture ? pause() : jouer(); } else lancerVoix(ch); }
      else if (a === "sommaire") panneauType === "sommaire" ? fermerPanneau() : ouvrirSommaire();
      else if (a === "chercher") panneauType === "chercher" ? fermerPanneau() : ouvrirRecherche();
      else if (a === "affichage") panneauType === "affichage" ? fermerPanneau() : ouvrirAffichage();
      else if (a === "plus") zoomer(zoom * 1.2);
      else if (a === "moins") zoomer(zoom / 1.2);
      else if (a === "ajuster") zoomer(1);
      else if (a === "plein") basculerPlein();
    });

    // ---- Redimensionnement, rotation ----
    let rt;
    const ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (ferme) return; const a = repere(); disposer(); allerRepere(a); pages.forEach(supprimerDetail); if (f.marque?.pos != null) poserRuban(f.marque.pos); planifier(true); }, 120); });
    ro.observe(defil); ecouteurs.push(() => ro.disconnect());

    // ---- Départ ----
    disposer();
    const depart = ALLER_MARQUE === ch && f.marque?.pos != null ? f.marque.pos : f.posOrig?.pos ?? (f.posOrig?.p ? f.posOrig.p + (f.posOrig.fy || 0) * 0.9 : null);
    ALLER_MARQUE = ALLER_POS = null;
    if (opts.pos) allerPos(opts.pos); else if (depart && depart > 1.01) allerPos(depart);
    if (f.marque?.pos != null) poserRuban(f.marque.pos);
    suivre(); planifier(true);
    defil.focus({ preventScroll: true });
    if (!PREF_PDF.vuAide) { PREF_PDF.vuAide = true; sauverPrefPdf(); setTimeout(() => { if (!ferme) toast(TACTILE ? "Pince pour zoomer · touche pour masquer les barres" : "Ctrl + molette pour zoomer · ← → pour tourner les pages"); }, 900); }
    return L;
  }
  const L_lire = async e => L.lire(e.nom, await e.obtenir());

  // ================= Lecture à voix haute =================
  const SYNTH = window.speechSynthesis;
  const PREF_V = Object.assign({ vitesse: 1, voix: "", moteur: "neurale" }, stock.lire("etagere.voix", {}));
  const sauverPrefV = () => stock.ecrire("etagere.voix", PREF_V);
  const VOIX = { actif: false, lecture: false, segs: [], i: 0, ch: null, jeton: 0, verrou: null, defilManuel: 0, echecs: 0 };
  let VOIX_DISPO = [];
  const HOMMES = /henri|r[ée]my|thomas|paul|claude|j[ée]r[ôo]me|alain|yves|maurice|lucien|nicolas|daniel|gilles|fabrice|antoine|guillaume|mathieu|olivier|pierre|s[ée]bastien|louis|jean|f[ée]lix|hugo|arthur|gabriel|raphael|vincent|xavier|male|homme|x-frd|x-frb/i;
  const FEMMES = /denise|[ée]lo[iï]se|vivienne|am[ée]lie|audrey|aur[ée]lie|marie|julie|hortense|c[ée]line|coralie|brigitte|jacqueline|jos[ée]phine|yvette|c[ée]leste|virginie|chantal|sylvie|natalie|female|femme|google fran[çc]ais|x-frc|x-vlf/i;
  const genreVoix = v => HOMMES.test(v.name) ? "h" : FEMMES.test(v.name) ? "f" : "?";
  function scoreVoix(v) {
    let s = 0;
    if (/^fr[-_]FR/i.test(v.lang)) s += 12; else if (/^fr/i.test(v.lang)) s += 6; else return -1;
    if (/natural|neural|naturelle/i.test(v.name)) s += 60;
    if (/premium/i.test(v.name)) s += 55;
    if (/enhanced|amélioré|améliorée/i.test(v.name)) s += 45;
    if (/google/i.test(v.name)) s += 35;
    if (/online/i.test(v.name)) s += 20;
    if (/denise|henri|vivienne|remy|eloise|amélie|amelie|thomas|audrey|aurélie|marie|daniel|julie|paul|hortense|claude|siri/i.test(v.name)) s += 8;
    if (/compact|eloquence|grandma|grandpa|rocko|shelley|sandy|flo|reed|jacques|eddy/i.test(v.name)) s -= 25;
    if (!v.localService) s += 3;
    const g = genreVoix(v); if (g === "h") s += 40; else if (g === "f") s -= 10;
    return s;
  }
  function chargerVoix() {
    if (!SYNTH) return;
    VOIX_DISPO = SYNTH.getVoices().map(v => ({ v, s: scoreVoix(v) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).map(x => x.v);
  }
  if (SYNTH) { chargerVoix(); SYNTH.addEventListener?.("voiceschanged", chargerVoix); }
  const voixChoisie = () => VOIX_DISPO.find(v => v.name === PREF_V.voix) || VOIX_DISPO[0] || null;

  const ROMAINS_N = s => { const m = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }; let t = 0; for (let i = 0; i < s.length; i++) { const a = m[s[i]], b = m[s[i + 1]] || 0; t += a < b ? -a : a; } return t; };
  function prononcer(s) {
    return s
      .replace(/\b([IVXLC]{1,6})(e|ème|er|re)\b/g, (m, r, suf) => ROMAINS_N(r) + (suf === "er" || suf === "re" ? "er" : "e"))
      .replace(/\bav\.\s?J\.?-?C\.?/g, "avant Jésus-Christ").replace(/\bapr\.\s?J\.?-?C\.?/g, "après Jésus-Christ")
      .replace(/\bcf\.\s?/gi, "voir ").replace(/\bp\.\s?(?=\d)/g, "page ").replace(/\bpp\.\s?(?=\d)/g, "pages ").replace(/\bchap\.\s?/g, "chapitre ").replace(/\bé?d\.\s?(?=\d)/g, "édition ")
      .replace(/\benv\.\s/g, "environ ").replace(/\bex\.\s?:?/gi, "par exemple, ").replace(/\bi\.\s?e\.\s?/gi, "c'est-à-dire ").replace(/\bc\.-à-d\.\s?/g, "c'est-à-dire ")
      .replace(/\b(\d{3,4})\s?[–—-]\s?(\d{2,4})\b/g, "$1 à $2")
      .replace(/⇒|⟹/g, " implique ").replace(/⇔|⟺/g, " équivaut à ").replace(/→|⟶/g, " vers ").replace(/≠/g, " différent de ").replace(/≤|⩽/g, " inférieur ou égal à ").replace(/≥|⩾/g, " supérieur ou égal à ")
      .replace(/∈/g, " appartient à ").replace(/∞/g, " l'infini ").replace(/×/g, " fois ").replace(/∑/g, " somme ").replace(/∫/g, " intégrale ").replace(/√/g, " racine de ").replace(/≈/g, " environ ")
      .replace(/[∎□■•▪◦]/g, " ").replace(/\[…\]|\(…\)/g, " ").replace(/\s*[«»"]\s*/g, ", ").replace(/,\s*,/g, ",").replace(/\s+/g, " ").replace(/^[\s,]+/, "").trim();
  }
  const filtreVoix = n => n.parentElement && n.parentElement.closest(".etape, figure, var[data-f], button, .lien-fiche-menu, ul ul, ol ol, li > ul, li > ol, sup.note") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  function segmentsVoix() {
    const blocs = $$("#corps h2, #corps h3, #corps h4, #corps p, #corps li, #corps tr, #corps .encadre-t, #corps blockquote:not(:has(p)), #corps dt, #corps dd")
      .filter(el => !el.closest(".etape") && !(el.tagName === "P" && el.parentElement.closest("li,td,th,blockquote:not(:has(p))")));
    const segs = [];
    for (const el of blocs) {
      const nodes = []; let pos = 0;
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => {
        if (filtreVoix(n) === NodeFilter.FILTER_REJECT) return NodeFilter.FILTER_REJECT;
        if (el.tagName === "LI" && n.parentElement.closest("li") !== el) return NodeFilter.FILTER_REJECT;
        if (el.tagName === "TR" && !n.parentElement.closest("td,th")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      } });
      let n; while ((n = w.nextNode())) { nodes.push({ n, d: pos }); pos += n.nodeValue.length; }
      let T = nodes.map(x => x.n.nodeValue).join("");
      if (el.tagName === "TR") { /* cellules séparées par une pause */ }
      if (!T.trim()) continue;
      const titre = /^H[2-4]$/.test(el.tagName) || el.classList.contains("encadre-t");
      const re = titre ? /^[\s\S]+$/g : /[^.!?…]+(?:[.!?…]+[»")\]]*|$)/g;
      let m;
      while ((m = re.exec(T))) {
        const brut = m[0]; if (!brut.trim()) { if (re.lastIndex === m.index) re.lastIndex++; continue; }
        const lead = brut.length - brut.trimStart().length;
        const d = m.index + lead, f = m.index + brut.trimEnd().length;
        let dire = prononcer(T.slice(d, f));
        if (el.tagName === "TR") dire = [...el.cells].map(c => prononcer(c.textContent)).filter(Boolean).join(". ");
        if (dire.replace(/[\s.,;:!?]/g, "").length < 1) continue;
        segs.push({ el, nodes, d, f, dire, titre, pause: titre ? 420 : el.tagName === "LI" ? 160 : 60 });
        if (el.tagName === "TR") break;
        if (re.lastIndex === m.index) re.lastIndex++;
      }
    }
    return segs;
  }
  function plage(seg, d, f) {
    const r = document.createRange(); let ok = 0;
    for (const { n, d: nd } of seg.nodes) {
      const L = n.nodeValue.length;
      if (!ok && d < nd + L) { r.setStart(n, Math.max(0, d - nd)); ok = 1; }
      if (ok && f <= nd + L) { r.setEnd(n, Math.max(0, f - nd)); return r; }
    }
    if (ok) { const last = seg.nodes[seg.nodes.length - 1]; r.setEnd(last.n, last.n.nodeValue.length); return r; }
    return null;
  }
  const HL = window.CSS && CSS.highlights && window.Highlight;
  function surlignerVoix(seg, motD, motF) {
    if (seg && seg.ls) { LISEUSE?.voix?.surligner(seg); return; }
    if (!seg) LISEUSE?.voix?.surligner(null);
    $$(".voix-bloc").forEach(x => x.classList.remove("voix-bloc"));
    if (!seg) { if (HL) { CSS.highlights.delete("voix-phrase"); CSS.highlights.delete("voix-mot"); } return; }
    seg.el.classList.add("voix-bloc");
    if (HL) {
      const r = plage(seg, seg.d, seg.f); if (r) CSS.highlights.set("voix-phrase", new Highlight(r));
      if (motD != null) { const rm = plage(seg, seg.d + motD, seg.d + motF); if (rm) CSS.highlights.set("voix-mot", new Highlight(rm)); } else CSS.highlights.delete("voix-mot");
    }
  }
  function suivreDefil(seg) {
    if (seg.ls) { LISEUSE?.voix?.suivre(seg); return; }
    if (Date.now() - VOIX.defilManuel < 4000) return;
    const r = seg.el.getBoundingClientRect();
    if (r.top < innerHeight * 0.18 || r.bottom > innerHeight * 0.72) seg.el.scrollIntoView({ behavior: reduit() ? "auto" : "smooth", block: "center" });
  }
  ["wheel", "touchmove"].forEach(t => addEventListener(t, () => { if (VOIX.lecture) VOIX.defilManuel = Date.now(); }, { passive: true }));
  // ================= Voix neuronale Tom (Piper, calculée sur l'appareil) =================
  // Tout vient du paquet hébergé avec Étagère (même origine) : modèle, moteur ONNX, phonétiseur.
  const PAQUET = window.ETAGERE_VOIX || null;
  const CFG_N = { espeak: "fr", noise: 0.667, longueur: 1, noiseW: 0.8, sr: 44100, multi: false };
  const MODELE_N = { nom: "Tom", mo: PAQUET ? Math.round(PAQUET.b64 * 0.75 / 1e6) : 41 };
  // Le moteur : identique dans un worker ou, à défaut, dans la page.
  function moteurTom(G) {
    let sess = null, phon = null, cfg = null, file = [], occupe = false;
    async function phonemiser(texte) {
      const out = [];
      const m = await G.createPiperPhonemize({ print: x => out.push(x), printErr: () => {}, wasmBinary: phon.wasm, getPreloadedPackage: () => phon.data, locateFile: f => f });
      m.callMain(["-l", cfg.espeak, "--input", JSON.stringify([{ text: texte }]), "--espeak_data", "/espeak-ng-data"]);
      const ids = [];
      for (const l of out) { try { const j = JSON.parse(l); if (j.phoneme_ids) ids.push(...(ids.length ? j.phoneme_ids.slice(1) : j.phoneme_ids)); } catch (e) {} }
      return ids;
    }
    async function tourner() {
      if (occupe) return; occupe = true;
      while (file.length) {
        const m = file.shift();
        try {
          const ids = await phonemiser(m.texte);
          if (!ids.length) throw new Error("vide");
          const T = G.ort.Tensor;
          const feeds = {
            input: new T("int64", BigInt64Array.from(ids, x => BigInt(x)), [1, ids.length]),
            input_lengths: new T("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
            scales: new T("float32", Float32Array.from([cfg.noise, cfg.longueur / m.vitesse, cfg.noiseW]), [3])
          };
          if (cfg.multi) feeds.sid = new T("int64", BigInt64Array.from([0n]), [1]);
          const r = await sess.run(feeds);
          const pcm = new Float32Array(r.output.data);
          G.post({ t: "audio", id: m.id, pcm }, [pcm.buffer]);
        } catch (err) { G.post({ t: "echec", id: m.id, msg: String(err && err.message || err) }); }
      }
      occupe = false;
    }
    G.recevoir = async m => {
      if (m.t === "init") {
        let etape = "moteur";
        try {
          const wasm = m.ortwasm, fetch0 = G.fetch;
          // le moteur ONNX réclame son .wasm par fetch : on le lui sert depuis la mémoire
          G.fetch = (u, o) => /\.wasm(\?|$)/.test(String(u && u.url || u)) ? Promise.resolve(new Response(wasm, { headers: { "content-type": "application/wasm" } })) : fetch0.call(G, u, o);
          G.ort.env.wasm.numThreads = 1; G.ort.env.wasm.proxy = false;
          G.ort.env.wasm.wasmPaths = "https://etagere.invalid/";
          phon = { data: m.phondata.buffer, wasm: m.phonwasm }; cfg = m.cfg;
          etape = "modèle";
          sess = await G.ort.InferenceSession.create(m.graph, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
          etape = "phonétiseur";
          await phonemiser("Bonjour.");
          G.post({ t: "pret" });
        } catch (err) { G.post({ t: "erreur", msg: etape + " : " + String(err && err.message || err) }); }
      } else if (m.t === "vider") { const g = new Set(m.garder); file = file.filter(x => { if (g.has(x.id)) return true; G.post({ t: "annule", id: x.id }); return false; }); }
      else if (m.t === "dire") { file.push(m); tourner(); }
    };
  }
  const NEURO = { etat: "absent", w: null, attente: new Map(), cache: new Map(), n: 0, cfg: CFG_N, audio: null, url: null, timer: 0, seg: -1, echecs: 0, pret: null, mode: "" };
  const idbVoix = {
    db: null,
    ouvrir() { return this.db || (this.db = new Promise((res, rej) => { const r = indexedDB.open("etagere-voix", 1); r.onupgradeneeded = () => r.result.createObjectStore("m"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
    async lire(k) { const db = await this.ouvrir(); return new Promise((res, rej) => { const q = db.transaction("m").objectStore("m").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
    async ecrire(k, v) { const db = await this.ouvrir(); return new Promise((res, rej) => { const t = db.transaction("m", "readwrite"); t.objectStore("m").put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("stockage plein")); }); },
    async vider() { const db = await this.ouvrir(); return new Promise(res => { const t = db.transaction("m", "readwrite"); t.objectStore("m").clear(); t.oncomplete = () => res(); t.onerror = () => res(); }); }
  };
  const neuroChoisie = () => PREF_V.moteur !== "systeme" && !!PAQUET;
  async function modeleInstalle() { try { return PAQUET && (await idbVoix.lire("tom/version")) === PAQUET.v; } catch (e) { return false; } }
  function b64Octets(t) {
    if (Uint8Array.fromBase64) return Uint8Array.fromBase64(t);
    const s = atob(t), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  async function texteAvecProgres(url, prog) {
    const r = await fetch(url, { cache: "force-cache" }); if (!r.ok) throw new Error("HTTP " + r.status + " sur la partie " + url.split("/").pop());
    if (!r.body || !r.body.getReader) { const t = await r.text(); prog(t.length); return t; }
    const lec = r.body.getReader(), dec = new TextDecoder(); let t = "", n = 0;
    for (;;) { const { done, value } = await lec.read(); if (done) break; n += value.length; t += dec.decode(value, { stream: true }); prog(n); }
    return t + dec.decode();
  }
  async function installerVoix(prog) {
    if (!PAQUET) throw new Error("paquet de voix absent");
    const morceaux = []; let fait = 0;
    for (const u of PAQUET.parts) {
      const t = await texteAvecProgres(u, n => prog(Math.min(0.99, (fait + n) / PAQUET.b64)));
      fait += t.length; morceaux.push(b64Octets(t.trim()));
    }
    const tout = new Uint8Array(morceaux.reduce((s, m) => s + m.length, 0)); let o = 0;
    for (const m of morceaux) { tout.set(m, o); o += m.length; }
    if (tout.length !== PAQUET.total) throw new Error("paquet incomplet (" + tout.length + " / " + PAQUET.total + ")");
    await idbVoix.vider();
    for (const e of PAQUET.index) await idbVoix.ecrire("tom/" + e.n, tout.slice(e.o, e.o + e.l));
    await idbVoix.ecrire("tom/version", PAQUET.v);
    prog(1);
  }
  async function degonfler(u8) {
    const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  let TABLE_F16 = null;
  function f16versF32(u8) {
    if (!TABLE_F16) {
      TABLE_F16 = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) {
        const s = i & 0x8000 ? -1 : 1, e = (i >> 10) & 31, m = i & 1023;
        TABLE_F16[i] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
      }
    }
    const h = new Uint16Array(u8.buffer, u8.byteOffset, u8.length >> 1), f = new Float32Array(h.length);
    for (let i = 0; i < h.length; i++) f[i] = TABLE_F16[h[i]];
    return new Uint8Array(f.buffer);
  }
  function chargerScript(code) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.textContent = code + "\n;window.__voixOk && window.__voixOk();"; window.__voixOk = res; document.head.appendChild(s); setTimeout(() => rej(new Error("script bloqué")), 4000); });
  }
  function brancherReponses(rep, minuteur, res, rej) {
    return m => {
      if (m.t === "pret") { clearTimeout(minuteur); res(); }
      else if (m.t === "erreur") { clearTimeout(minuteur); rej(new Error(m.msg)); }
      else if (m.t === "audio" || m.t === "echec" || m.t === "annule") {
        const a = NEURO.attente.get(m.id); if (!a) return; NEURO.attente.delete(m.id);
        m.t === "audio" ? a.res(m.pcm) : a.rej(m.t === "annule" ? "annule" : new Error(m.msg));
      }
    };
  }
  async function lancerMoteur(donnees, dansPage) {
    if (!window.ETAGERE_VOIX_JS && PAQUET?.js) {
      const [ort, phon] = await Promise.all([PAQUET.js.ort, PAQUET.js.phon].map(u => fetch(u).then(r => { if (!r.ok) throw new Error("moteur introuvable"); return r.text(); })));
      window.ETAGERE_VOIX_JS = { ort, phon };
    }
    const JS = window.ETAGERE_VOIX_JS;
    if (!dansPage) {
      const code = JS.ort + "\n;" + JS.phon + "\n;(" + moteurTom.toString() + ")(self);\nself.ort=ort;self.createPiperPhonemize=createPiperPhonemize;self.post=(m,t)=>postMessage(m,t||[]);onmessage=e=>self.recevoir(e.data);";
      const w = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
      NEURO.w = { postMessage: (m, t) => w.postMessage(m, t || []), terminate: () => w.terminate() };
      await new Promise((res, rej) => {
        const minuteur = setTimeout(() => rej(new Error("délai dépassé")), 90000);
        w.onerror = ev => { clearTimeout(minuteur); ev.preventDefault?.(); rej(new Error("worker : " + (ev.message || "bloqué"))); };
        const traiter = brancherReponses(null, minuteur, res, rej);
        w.onmessage = ev => traiter(ev.data);
        w.postMessage(Object.assign({ t: "init", cfg: NEURO.cfg }, donnees), [donnees.graph.buffer, donnees.ortwasm.buffer, donnees.phonwasm.buffer, donnees.phondata.buffer]);
      });
      NEURO.mode = "worker";
    } else {
      if (!window.ort) await chargerScript(JS.ort);
      if (!window.createPiperPhonemize) await chargerScript(JS.phon);
      const G = { ort: window.ort, createPiperPhonemize: window.createPiperPhonemize, fetch: window.fetch.bind(window) };
      moteurTom(G);
      const fetch0 = window.fetch;
      window.fetch = (u, o) => G.fetch(u, o); // le moteur ONNX lit `fetch` global
      await new Promise((res, rej) => {
        const minuteur = setTimeout(() => rej(new Error("délai dépassé")), 90000);
        const traiter = brancherReponses(null, minuteur, res, rej);
        G.post = m => setTimeout(() => traiter(m), 0);
        NEURO.w = { postMessage: m => setTimeout(() => G.recevoir(m), 0), terminate: () => {} };
        NEURO.w.postMessage(Object.assign({ t: "init", cfg: NEURO.cfg }, donnees));
      }).finally(() => { window.fetch = fetch0; });
      NEURO.mode = "page";
    }
  }
  function demarrerNeuro() {
    if (NEURO.pret) return NEURO.pret;
    NEURO.etat = "charge";
    NEURO.pret = (async () => {
      if (!(await modeleInstalle())) throw new Error("absent");
      NEURO.cfg = CFG_N;
      const noms = ["plan", "graph", "w16", "ortwasm", "phonwasm", "phondata"];
      const lire = async () => {
        const d = {}; for (const n of noms) { const v = await idbVoix.lire("tom/" + n); if (!v) throw new Error("fichier manquant : " + n); d[n] = await degonfler(v); }
        // le modèle est rangé sans ses poids (zéros) ; on les recopie, demi-précision → simple précision
        const plan = JSON.parse(new TextDecoder().decode(d.plan)), w = f16versF32(d.w16);
        const dv = new Uint8Array(w.buffer); let p = 0;
        for (const [o, n] of plan) { d.graph.set(dv.subarray(p, p + n * 4), o); p += n * 4; }
        delete d.plan; delete d.w16; return d;
      };
      let err1;
      try { await lancerMoteur(await lire(), false); }
      catch (e) {
        err1 = e; try { NEURO.w?.terminate(); } catch (x) {}
        try { await lancerMoteur(await lire(), true); }
        catch (e2) { throw new Error(err1.message + " | dans la page : " + e2.message); }
      }
      NEURO.etat = "pret";
    })().catch(e => { NEURO.etat = "erreur"; NEURO.pret = null; NEURO.erreur = e.message; try { NEURO.w?.terminate(); } catch (x) {} NEURO.w = null; throw e; });
    return NEURO.pret;
  }
  function wav(pcm, sr) {
    const n = pcm.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    s(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); s(8, "WAVE"); s(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, "data"); v.setUint32(40, n * 2, true);
    let pic = 0; for (let i = 0; i < n; i++) pic = Math.max(pic, Math.abs(pcm[i]));
    const g = pic > 0 ? Math.min(3, 0.92 / pic) : 1;
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i] * g)) * 32767, true);
    return new Blob([b], { type: "audio/wav" });
  }
  function synthNeuro(i) {
    const cle = i + "|" + PREF_V.vitesse;
    if (NEURO.cache.has(cle)) return NEURO.cache.get(cle);
    const seg = VOIX.segs[i], id = ++NEURO.n;
    const p = new Promise((res, rej) => { NEURO.attente.set(id, { res, rej }); NEURO.w.postMessage({ t: "dire", id, texte: seg.dire, vitesse: PREF_V.vitesse }); })
      .then(pcm => ({ blob: wav(pcm, NEURO.cfg.sr), duree: pcm.length / NEURO.cfg.sr, id }));
    p.id = id;
    p.catch(() => NEURO.cache.delete(cle));
    NEURO.cache.set(cle, p);
    for (const k of [...NEURO.cache.keys()]) { const j = +k.split("|")[0]; if (j < i - 2 || j > i + 6) NEURO.cache.delete(k); }
    return p;
  }
  function viderNeuro(garderDe) {
    if (!NEURO.w) return;
    const garder = [];
    for (const [k, p] of NEURO.cache) { const j = +k.split("|")[0]; if (k.endsWith("|" + PREF_V.vitesse) && j >= garderDe && j <= garderDe + 2) garder.push(p.id); else NEURO.cache.delete(k); }
    NEURO.w.postMessage({ t: "vider", garder });
  }
  function audioNeuro() {
    if (!NEURO.audio) { NEURO.audio = new Audio(); NEURO.audio.preload = "auto"; NEURO.audio.setAttribute("playsinline", ""); }
    return NEURO.audio;
  }
  function arreterSonNeuro() {
    clearInterval(NEURO.timer);
    const a = NEURO.audio; if (a) { a.onended = null; a.pause(); }
    NEURO.seg = -1;
  }
  function suivreMots(seg, a, jeton) {
    clearInterval(NEURO.timer);
    if (seg.titre || seg.el.tagName === "TR") return;
    const T = seg.nodes.map(x => x.n.nodeValue).join("").slice(seg.d, seg.f);
    const mots = [...T.matchAll(/\S+/g)].map(m => {
      const w = m[0], lettres = w.replace(/[^\p{L}]/gu, "").length, chiffres = w.replace(/\D/g, "").length;
      return { d: m.index, f: m.index + w.length, p: lettres + chiffres * 3 + 1.5 + (/[,;:]$/.test(w) ? 3 : /[.!?…»]$/.test(w) ? 4 : 0) };
    });
    if (!mots.length) return;
    const tot = mots.reduce((s, m) => s + m.p, 0); let k0 = -1;
    NEURO.timer = setInterval(() => {
      if (jeton !== VOIX.jeton) { clearInterval(NEURO.timer); return; }
      if (!a.duration || a.paused) return;
      const marge = 0.1, x = Math.max(0, (a.currentTime - marge) / Math.max(0.2, a.duration - 2 * marge)) * tot;
      let c = 0, k = 0; while (k < mots.length - 1 && c + mots[k].p < x) { c += mots[k].p; k++; }
      if (k !== k0) { k0 = k; surlignerVoix(seg, mots[k].d, mots[k].f); }
    }, 50);
  }
  function direNeuro() {
    const seg = VOIX.segs[VOIX.i];
    if (!seg) { arreterVoix(true); return; }
    const jeton = ++VOIX.jeton, i = VOIX.i;
    arreterSonNeuro();
    surlignerVoix(seg); suivreDefil(seg); majLecteur(); majMedia();
    viderNeuro(i);
    const p = synthNeuro(i);
    for (const k of [1, 2]) if (VOIX.segs[i + k]) synthNeuro(i + k).catch(() => {});
    const attente = setTimeout(() => { if (jeton === VOIX.jeton) etatLecteur("Préparation de la voix…"); }, 400);
    p.then(r => {
      clearTimeout(attente); etatLecteur("");
      if (jeton !== VOIX.jeton || !VOIX.lecture) return;
      NEURO.echecs = 0;
      const a = audioNeuro();
      if (NEURO.url) URL.revokeObjectURL(NEURO.url);
      NEURO.url = URL.createObjectURL(r.blob); a.src = NEURO.url; NEURO.seg = i;
      a.onended = () => {
        if (jeton !== VOIX.jeton || !VOIX.lecture) return;
        clearInterval(NEURO.timer); VOIX.i++;
        const f = P.fiches[VOIX.ch]; if (f) { f.voix = VOIX.i; if (VOIX.i % 5 === 0) sauver(); }
        setTimeout(() => { if (jeton === VOIX.jeton && VOIX.lecture) direSegment(); }, seg.pause / PREF_V.vitesse);
      };
      a.play().then(() => suivreMots(seg, a, jeton)).catch(() => { VOIX.lecture = false; majLecteur(); toast("Appuie sur lecture pour démarrer le son"); });
    }).catch(err => {
      clearTimeout(attente); etatLecteur("");
      if (jeton !== VOIX.jeton || err === "annule") return;
      if (++NEURO.echecs >= 3) { NEURO.echecs = 0; basculerSysteme("La voix Tom n'arrive pas à lire ce passage"); return; }
      VOIX.i++; direSegment();
    });
  }
  function basculerSysteme(msg) {
    PREF_V.moteur = "systeme"; sauverPrefV();
    toast(msg + " : voix de l'appareil utilisée");
    if (VOIX.lecture) { VOIX.jeton++; arreterSonNeuro(); direSegment(); }
  }
  function etatLecteur(t) { const el = $("#lv-etat"); if (el) { el.textContent = t; el.hidden = !t; } }
  function majMedia() {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: $("#lv-titre")?.textContent || (VOIX.ch && trouver(VOIX.ch) ? titreDe(trouver(VOIX.ch)) : "") || "Étagère", artist: "Étagère", album: (VOIX.ch && trouver(VOIX.ch) ? titreDe(trouver(VOIX.ch)) : "") || "" });
      navigator.mediaSession.playbackState = VOIX.lecture ? "playing" : "paused";
      navigator.mediaSession.setActionHandler("play", () => jouer());
      navigator.mediaSession.setActionHandler("pause", () => pause());
      navigator.mediaSession.setActionHandler("nexttrack", () => sauter(1));
      navigator.mediaSession.setActionHandler("previoustrack", () => sauter(-1));
    } catch (e) {}
  }
  // Fenêtre d'installation de la voix
  function dialogueVoix() {
    return new Promise(fin => {
      const v = document.createElement("div"); v.className = "voile";
      v.innerHTML = `<div class="dialogue dialogue-voix" role="dialog" aria-modal="true" aria-label="Voix haute qualité">
        <div class="dv-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/></svg></div>
        <h2>Voix d'homme haute qualité</h2>
        <p>Tom est une voix neuronale qui tourne directement sur ton appareil, sans compte ni abonnement. Elle s'installe une seule fois (${MODELE_N.mo} Mo), de préférence en wifi.</p>
        <div class="dv-prog" hidden><span class="dv-barre"><i></i></span><span class="dv-pc">0 %</span></div>
        <p class="dv-msg" hidden></p>
        <div class="dialogue-b dv-b">
          <button type="button" class="bouton discret" data-dv="systeme">Voix de l'appareil</button>
          <button type="button" class="bouton principal" data-dv="dl">Installer Tom</button>
        </div></div>`;
      document.body.appendChild(v);
      const fermer = r => { v.remove(); fin(r); };
      const prog = $(".dv-prog", v), msg = $(".dv-msg", v), dl = $('[data-dv="dl"]', v);
      const montrer = t => { msg.hidden = false; msg.textContent = t; };
      $('[data-dv="systeme"]', v).onclick = () => { PREF_V.moteur = "systeme"; sauverPrefV(); fermer("systeme"); };
      dl.onclick = async () => {
        dl.disabled = true; msg.hidden = true; prog.hidden = false;
        let etape = "Téléchargement";
        try {
          if (!(await modeleInstalle())) await installerVoix(f => { $(".dv-barre i", prog).style.width = (f * 100).toFixed(1) + "%"; $(".dv-pc", prog).textContent = Math.round(f * 100) + " %"; });
          etape = "Démarrage"; $(".dv-pc", prog).textContent = "Démarrage…"; $(".dv-barre i", prog).style.width = "100%";
          await demarrerNeuro();
          PREF_V.moteur = "neurale"; sauverPrefV(); fermer("neurale");
        } catch (e) {
          dl.disabled = false; prog.hidden = true; dl.textContent = "Réessayer";
          montrer(`${etape} impossible : ${e.message}. Envoie-moi ce message si ça persiste.`);
        }
      };
      v.addEventListener("keydown", ev => { if (ev.key === "Escape") fermer(null); });
      dl.focus();
    });
  }
  const relancerVoix = () => { VOIX.jeton++; SYNTH?.cancel(); arreterSonNeuro(); };
  function direSegment() {
    if (neuroChoisie() && NEURO.etat === "pret") return direNeuro();
    const seg = VOIX.segs[VOIX.i];
    if (!seg) { arreterVoix(true); return; }
    const jeton = ++VOIX.jeton;
    const u = new SpeechSynthesisUtterance(seg.dire);
    const v = voixChoisie(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "fr-FR";
    u.rate = PREF_V.vitesse; u.pitch = 1;
    surlignerVoix(seg); suivreDefil(seg); majLecteur();
    VOIX.dernierEvt = Date.now();
    let parti = false;
    const echec = () => { if (++VOIX.echecs >= 3) { VOIX.echecs = 0; pause(); toast("Aucune voix n'a pu lire le texte. Choisis une autre voix dans le lecteur."); return true; } return false; };
    u.onstart = () => { parti = true; VOIX.echecs = 0; VOIX.dernierEvt = Date.now(); };
    u.onboundary = ev => {
      if (jeton !== VOIX.jeton || ev.name && ev.name !== "word") return;
      const T = seg.nodes.map(x => x.n.nodeValue).join("").slice(seg.d, seg.f);
      if (prononcer(T) !== T) return;
      const deb = ev.charIndex, l = ev.charLength || (/^\S+/.exec(T.slice(deb)) || [""])[0].length;
      surlignerVoix(seg, deb, deb + l);
    };
    u.onend = () => {
      if (jeton !== VOIX.jeton || !VOIX.lecture) return;
      VOIX.dernierEvt = Date.now();
      if (!parti && echec()) return;
      VOIX.i++;
      const f = P.fiches[VOIX.ch]; if (f) { f.voix = VOIX.i; if (VOIX.i % 5 === 0) sauver(); }
      setTimeout(() => { if (jeton === VOIX.jeton && VOIX.lecture) direSegment(); }, seg.pause / PREF_V.vitesse);
    };
    u.onerror = ev => { if (jeton !== VOIX.jeton) return; if (ev.error === "interrupted" || ev.error === "canceled") return; if (echec()) return; VOIX.i++; direSegment(); };
    SYNTH.speak(u);
  }
  // Chrome coupe parfois la synthèse au bout de ~15 s : relance douce
  setInterval(() => {
    if (!SYNTH || !VOIX.lecture || (neuroChoisie() && NEURO.etat === "pret")) return;
    if (SYNTH.paused) SYNTH.resume();
    if (!SYNTH.speaking && !SYNTH.pending && Date.now() - (VOIX.dernierEvt || 0) > 6000) { VOIX.jeton++; direSegment(); }
  }, 3000);
  function debloquerAudio() {
    if (NEURO.debloque) return; NEURO.debloque = true;
    try { const a = audioNeuro(); a.src = URL.createObjectURL(wav(new Float32Array(2205), 22050)); a.play().catch(() => {}); } catch (e) {}
  }
  async function lancerVoix(ch, depuis) {
    debloquerAudio();
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
    let charger = false;
    if (neuroChoisie() && NEURO.etat !== "pret") {
      if (await modeleInstalle()) charger = true;
      else if ((await dialogueVoix()) === null) return;
    }
    if (!charger && !(neuroChoisie() && NEURO.etat === "pret") && !SYNTH) { toast("La lecture à voix haute n'est pas disponible dans ce navigateur"); return; }
    chargerVoix();
    const lsVoix = LISEUSE && LISEUSE.ch === ch && LISEUSE.voix;
    if (lsVoix) toast("Préparation de la lecture…");
    VOIX.segs = lsVoix ? await lsVoix.segments() : segmentsVoix(); VOIX.ch = ch; VOIX.actif = true;
    if (!VOIX.segs.length) { VOIX.actif = false; toast("Rien à lire ici"); return; }
    let i = 0;
    if (lsVoix) i = 0;
    else if (depuis === "suite" && P.fiches[ch]?.voix) i = Math.min(P.fiches[ch].voix, VOIX.segs.length - 1);
    else if (depuis instanceof Element) i = Math.max(0, VOIX.segs.findIndex(s => s.el === depuis || depuis.contains(s.el) || s.el.contains(depuis)));
    else { const k = VOIX.segs.findIndex(s => s.el.getBoundingClientRect().bottom > 140); i = k < 0 ? 0 : k; }
    VOIX.i = i;
    afficherLecteur();
    if (charger) {
      VOIX.lecture = true; majLecteur(); surlignerVoix(VOIX.segs[i]); etatLecteur("Chargement de la voix…");
      try { await demarrerNeuro(); } catch (e) { PREF_V.moteur = "systeme"; sauverPrefV(); toast("La voix Tom n'a pas pu démarrer : voix de l'appareil utilisée"); if (!SYNTH) { arreterVoix(false); return; } }
      etatLecteur("");
      if (!VOIX.actif || VOIX.ch !== ch || !VOIX.lecture) return;
    }
    jouer();
  }
  async function jouer() {
    debloquerAudio();
    if (neuroChoisie() && NEURO.etat === "pret") {
      const a = NEURO.audio;
      VOIX.lecture = true;
      if (a && NEURO.seg === VOIX.i && a.paused && a.currentTime > 0 && !a.ended) { a.play().catch(() => {}); majLecteur(); majMedia(); try { if ("wakeLock" in navigator && !VOIX.verrou) VOIX.verrou = await navigator.wakeLock.request("screen"); } catch (e) {} return; }
    }
    VOIX.lecture = true; SYNTH?.cancel();
    try { if ("wakeLock" in navigator && !VOIX.verrou) VOIX.verrou = await navigator.wakeLock.request("screen"); } catch (e) {}
    direSegment();
  }
  function pause() { VOIX.lecture = false; if (neuroChoisie() && NEURO.etat === "pret") { NEURO.audio?.pause(); } else { VOIX.jeton++; SYNTH?.cancel(); } majMedia(); majLecteur(); try { VOIX.verrou?.release(); } catch (e) {} VOIX.verrou = null; const f = P.fiches[VOIX.ch]; if (f) { f.voix = VOIX.i; sauver(); } }
  function arreterVoix(fini) {
    if (!VOIX.actif) return;
    pause(); VOIX.jeton++; arreterSonNeuro(); VOIX.actif = false; surlignerVoix(null); $("#lecteur-voix")?.remove(); document.body.classList.remove("avec-lecteur");
    if (fini) { const f = P.fiches[VOIX.ch]; if (f) { delete f.voix; sauver(); } toast("Lecture terminée"); }
  }
  function sauter(n) { VOIX.i = Math.max(0, Math.min(VOIX.segs.length - 1, VOIX.i + n)); if (VOIX.lecture) { relancerVoix(); direSegment(); } else { surlignerVoix(VOIX.segs[VOIX.i]); suivreDefil(VOIX.segs[VOIX.i]); majLecteur(); } }
  const VITESSES = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75];
  function afficherLecteur() {
    $("#lecteur-voix")?.remove();
    const b = document.createElement("div"); b.id = "lecteur-voix"; b.className = "lecteur-voix"; b.setAttribute("role", "region"); b.setAttribute("aria-label", "Lecture à voix haute");
    b.innerHTML = `<div class="lv-info"><span class="lv-titre" id="lv-titre"></span><span class="lv-etat" id="lv-etat" hidden></span><span class="lv-barre"><i id="lv-prog"></i></span></div>
      <div class="lv-cmd">
        <button class="lv-b" data-v="prec" aria-label="Phrase précédente"><svg viewBox="0 0 24 24"><path d="M6 5v14M19 5l-10 7 10 7z"/></svg></button>
        <button class="lv-b lv-play" data-v="play" aria-label="Lecture"><svg viewBox="0 0 24 24" id="lv-ico"></svg></button>
        <button class="lv-b" data-v="suiv" aria-label="Phrase suivante"><svg viewBox="0 0 24 24"><path d="M18 5v14M5 5l10 7-10 7z"/></svg></button>
        <button class="lv-vit" data-v="vitesse" aria-label="Vitesse" id="lv-vit"></button>
        <button class="lv-b" data-v="voix" aria-label="Choisir la voix"><svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
        <button class="lv-b" data-v="fermer" aria-label="Fermer le lecteur"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>`;
    document.body.appendChild(b); document.body.classList.add("avec-lecteur");
    $$("[data-v]", b).forEach(x => x.onclick = ev => {
      const a = x.dataset.v;
      if (a === "play") VOIX.lecture ? pause() : jouer();
      else if (a === "prec") sauter(-1);
      else if (a === "suiv") sauter(1);
      else if (a === "fermer") arreterVoix(false);
      else if (a === "vitesse") ouvrirMenu(x, "Vitesse", VITESSES.map(v => ({ label: (v === 1 ? "Normale" : v.toLocaleString("fr-FR") + "×"), actif: v === PREF_V.vitesse, action: () => { PREF_V.vitesse = v; sauverPrefV(); majLecteur(); if (VOIX.lecture) { relancerVoix(); direSegment(); } } })));
      else if (a === "voix") {
        chargerVoix();
        const nomV = v => v.name.replace(/Microsoft |Google |Online|\(Natural\)|\(.*?\)|- French.*$|-? ?Fran[çc]ais.*$/g, "").replace(/\s+/g, " ").trim() || v.name;
        const qual = v => /natural|neural|premium|enhanced|amélior/i.test(v.name) ? " · haute qualité" : "";
        const sys = VOIX_DISPO.slice(0, 12);
        const items = (PAQUET ? [{ label: `${MODELE_N.nom} · homme · neuronale (recommandée)`, actif: neuroChoisie(), action: async () => {
          if (NEURO.etat !== "pret") { if (await modeleInstalle()) { try { await demarrerNeuro(); } catch (e) { toast("La voix Tom n'a pas pu démarrer"); return; } } else if ((await dialogueVoix()) !== "neurale") return; }
          PREF_V.moteur = "neurale"; sauverPrefV(); toast("Voix : Tom"); if (VOIX.lecture) { relancerVoix(); direSegment(); }
        } }] : []).concat(sys.map(v => ({ label: nomV(v) + (genreVoix(v) === "h" ? " · homme" : genreVoix(v) === "f" ? " · femme" : "") + qual(v), actif: !neuroChoisie() && v === voixChoisie(), action: () => { PREF_V.voix = v.name; PREF_V.moteur = "systeme"; sauverPrefV(); if (VOIX.lecture) { relancerVoix(); direSegment(); } toast("Voix : " + nomV(v)); } })));
        ouvrirMenu(x, items.length ? "Voix" : "Aucune voix française sur cet appareil", items);
      }
    });
    majLecteur();
  }
  function majLecteur() {
    const b = $("#lecteur-voix"); if (!b) return;
    $("#lv-ico", b).innerHTML = VOIX.lecture ? `<path d="M8 5h3v14H8zM13 5h3v14h-3z"/>` : `<path d="M8 5l11 7-11 7z"/>`;
    $('[data-v="play"]', b).setAttribute("aria-label", VOIX.lecture ? "Pause" : "Lecture");
    $("#lv-vit", b).textContent = PREF_V.vitesse === 1 ? "1×" : PREF_V.vitesse.toLocaleString("fr-FR") + "×";
    const seg = VOIX.segs[VOIX.i];
    let sec = null; if (seg && !seg.ls) { const hs = $$("#corps h1, #corps h2, #corps h3"); for (const h of hs) { if (h.compareDocumentPosition(seg.el) & Node.DOCUMENT_POSITION_FOLLOWING || h === seg.el) sec = h; } }
    const ent = VOIX.ch && trouver(VOIX.ch);
    $("#lv-titre", b).textContent = seg?.ls ? (LISEUSE?.voix?.titre(seg) || "") : sec ? sec.textContent : (ent ? titreDe(ent) : "");
    $("#lv-prog", b).style.width = (VOIX.segs.length ? (VOIX.i / VOIX.segs.length * 100) : 0).toFixed(1) + "%";
  }
  let F_COURANTE = null;
  document.addEventListener("keydown", ev => {
    if (!VOIX.actif || ev.target.closest("input,textarea,select")) return;
    if (ev.key === "k" && !ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); VOIX.lecture ? pause() : jouer(); }
  });

  // ================= Objectif quotidien et séances =================
  const objectifMin = () => (P.objectif && P.objectif.min) || 20;
  const minutesJour = d => Math.floor(((P.jours[d] || {}).sec || 0) / 60);
  const ACT = { derniere: Date.now() };
  ["pointerdown", "keydown", "wheel", "touchstart", "scroll"].forEach(t => addEventListener(t, () => { ACT.derniere = Date.now(); }, { passive: true, capture: true }));
  setInterval(() => {
    if (document.hidden || !pret) return;
    const etude = /^#\/f\//.test(ROUTE) || VOIX.lecture;
    if (!etude || (Date.now() - ACT.derniere > 120000 && !VOIX.lecture)) return;
    const j = jourDe(auj()); j.sec = (j.sec || 0) + 5;
    if (j.sec % 30 === 0) sauver();
    if (!j.objectif && j.sec >= objectifMin() * 60) { j.objectif = true; sauver(); gagner(20, "Objectif du jour atteint"); }
    majObjectif();
  }, 5000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) sauver(); });
  function anneauObjectif(taille, epais) {
    const frac = Math.min(1, ((P.jours[auj()] || {}).sec || 0) / (objectifMin() * 60));
    const r = (taille - epais) / 2, C = 2 * Math.PI * r;
    return `<svg class="obj-svg" viewBox="0 0 ${taille} ${taille}" width="${taille}" height="${taille}" aria-hidden="true"><circle cx="${taille / 2}" cy="${taille / 2}" r="${r}" class="obj-fond" stroke-width="${epais}"/><circle cx="${taille / 2}" cy="${taille / 2}" r="${r}" class="obj-plein ${frac >= 1 ? "atteint" : ""}" stroke-width="${epais}" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(2)}" transform="rotate(-90 ${taille / 2} ${taille / 2})"/></svg>`;
  }
  function majObjectif() {
    const m = minutesJour(auj()), o = objectifMin();
    const el = $("#obj-mini"); if (el) { el.innerHTML = anneauObjectif(22, 3.5); el.title = `${m} / ${o} min aujourd'hui`; el.setAttribute("aria-label", el.title); }
    const acc = $("#obj-accueil"); if (acc) { $(".obj-anneau", acc).innerHTML = anneauObjectif(54, 6); $(".obj-v", acc).innerHTML = `${m}<small>/${o} min</small>`; }
  }

  // Séance minutée
  let SEANCE = stock.lire("etagere.seance", null);
  function lancerSeance(min) {
    SEANCE = { debut: Date.now(), fin: Date.now() + min * 60000, min, rev0: P.jalonsTotal || 0, xp0: P.xp };
    stock.ecrire("etagere.seance", SEANCE); majSeance(); toast(`Séance de ${min} min lancée`);
  }
  function arreterSeance() { SEANCE = null; stock.ecrire("etagere.seance", null); majSeance(); }
  function sonner() {
    try {
      const A = new (window.AudioContext || window.webkitAudioContext)();
      [[660, 0], [880, 0.18], [1320, 0.36]].forEach(([f, t]) => { const o = A.createOscillator(), g = A.createGain(); o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, A.currentTime + t); g.gain.exponentialRampToValueAtTime(0.18, A.currentTime + t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, A.currentTime + t + 0.5); o.connect(g).connect(A.destination); o.start(A.currentTime + t); o.stop(A.currentTime + t + 0.55); });
    } catch (e) {}
  }
  function finSeance() {
    const s = SEANCE; arreterSeance(); sonner();
    const parts = (P.jalonsTotal || 0) - (s.rev0 || 0);
    gagner(10, "Séance terminée");
    const v = document.createElement("div"); v.className = "voile";
    v.innerHTML = `<div class="montee" role="dialog" aria-modal="true" aria-label="Séance terminée">${LOGO.svg({ trait: 2.4 })}<div class="k">Séance terminée</div><div class="nom">${s.min} minutes</div>
      <div class="bilan-chiffres"><div>${parts}<small>${parts > 1 ? "parties" : "partie"}</small></div><div class="dore">+${P.xp - s.xp0}<small>XP</small></div><div>${minutesJour(auj())}<small>min aujourd'hui</small></div></div>
      <button class="bouton principal" id="seance-ok">Continuer</button></div>`;
    document.body.appendChild(v); $("#seance-ok", v).focus(); $("#seance-ok", v).onclick = () => v.remove();
  }
  function majSeance() {
    const ba = $("#seance-accueil"); if (ba) ba.textContent = SEANCE ? "Séance en cours" : "Lancer une séance";
    const b = $("#seance"); if (!b) return;
    if (!SEANCE) { b.hidden = true; return; }
    const reste = SEANCE.fin - Date.now();
    if (reste <= 0) { b.hidden = true; finSeance(); return; }
    const m = Math.floor(reste / 60000), s = Math.floor(reste / 1000) % 60;
    b.hidden = false; b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/></svg>${m}:${String(s).padStart(2, "0")}`;
    b.style.setProperty("--p", ((1 - reste / (SEANCE.min * 60000)) * 100).toFixed(1) + "%");
  }
  setInterval(majSeance, 1000);
  function menuSeance(ancre) {
    if (SEANCE) ouvrirMenu(ancre, "Séance en cours", [{ label: "Arrêter la séance", danger: true, action: () => { arreterSeance(); toast("Séance arrêtée"); } }]);
    else ouvrirMenu(ancre, "Lancer une séance", [10, 20, 30, 45, 60].map(m => ({ label: `${m} minutes`, action: () => lancerSeance(m) })));
  }
  function graphTemps(el) {
    const jours = 14, W = el.clientWidth || 600, H = 190, g = { h: 14, d: 8, b: 26, gch: 34 };
    const a = auj(), barres = [];
    for (let i = jours - 1; i >= 0; i--) { const d = plusJours(a, -i); barres.push({ d, m: ((P.jours[d] || {}).sec || 0) / 60 }); }
    const o = objectifMin();
    const { pas, haut } = echelle(Math.max(o * 1.15, ...barres.map(b => b.m)));
    const n = barres.length, pl = (W - g.gch - g.d) / n, bw = Math.max(6, Math.min(34, pl - 8));
    const y = v => H - g.b - v / haut * (H - g.h - g.b);
    let s = "";
    for (let v = 0; v <= haut; v += pas) s += `<line x1="${g.gch}" x2="${W - g.d}" y1="${y(v)}" y2="${y(v)}" class="grille"/><text x="${g.gch - 8}" y="${y(v) + 4}" text-anchor="end" class="axe">${v}</text>`;
    barres.forEach((b, k) => {
      const x = g.gch + k * pl + (pl - bw) / 2, h = Math.max(0, y(0) - y(b.m)), r = Math.min(4, bw / 2, h);
      if (b.m > 0) s += `<path class="${b.m >= o ? "b-atteint" : "b-temps"}" d="M${x},${y(0)}V${y(b.m) + r}Q${x},${y(b.m)} ${x + r},${y(b.m)}H${x + bw - r}Q${x + bw},${y(b.m)} ${x + bw},${y(b.m) + r}V${y(0)}Z"><title>${dateJour(b.d)} : ${Math.round(b.m)} min</title></path>`;
      if (k % 2 === (n - 1) % 2) s += `<text x="${x + bw / 2}" y="${H - 7}" text-anchor="middle" class="axe ${k === n - 1 ? "fort" : ""}">${k === n - 1 ? "auj." : (([Y, M, D]) => JOURS[new Date(Y, M - 1, D).getDay()].slice(0, 2))(b.d.split("-").map(Number))}</text>`;
    });
    s += `<line x1="${g.gch}" x2="${W - g.d}" y1="${y(o)}" y2="${y(o)}" class="ligne-obj"/><text x="${W - g.d}" y="${y(o) - 6}" text-anchor="end" class="axe obj-l">objectif ${o} min</text>`;
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Minutes d'étude par jour, 14 derniers jours">${s}</svg>`;
  }

  // ----- Recherche dans tous les documents -----
  let DERNIERE_RECHERCHE = "";
  function vueChercher() {
    marquerNav("chercher");
    vue().innerHTML = `<h1 class="titre-vue">Chercher</h1>
      <div class="recherche"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>
      <input id="q" type="search" placeholder="Un auteur, une notion…" autocomplete="off" aria-label="Rechercher"></div>
      <div class="resultats" id="res"></div>`;
    const q = $("#q"), res = $("#res");
    q.value = DERNIERE_RECHERCHE; q.focus();
    let jeton = 0;
    const plier = s => s.replace(/[\s\S]/g, ch => (ch.normalize("NFD")[0] || ch).toLowerCase());
    const lancer = async () => {
      const mine = ++jeton;
      DERNIERE_RECHERCHE = q.value;
      const brut = q.value.trim(), qp = plier(brut);
      if (qp.length < 2) { res.innerHTML = ""; return; }
      res.innerHTML = `<p class="aucun">Recherche…</p>`;
      const out = [];
      for (const e of CATALOGUE) {
        let textes = [];
        try { textes = await textesDe(e); } catch (err) {}
        if (mine !== jeton) return;
        const titre = titreDe(e), dansTitre = plier(titre).includes(qp);
        const occ = [];
        textes.forEach((t, k) => { const tp = plier(t); let i = tp.indexOf(qp); while (i >= 0 && occ.length < 60) { occ.push({ k, i, t }); i = tp.indexOf(qp, i + qp.length); } });
        if (!dansTitre && !occ.length) continue;
        out.push({ e, titre, dansTitre, occ, pdf: META[e.chemin]?.genre === "pdf" });
      }
      out.sort((a, b) => (b.dansTitre - a.dansTitre) || (b.occ.length - a.occ.length));
      const marquer = s => { const sp = plier(s); let h = "", o = 0, i = sp.indexOf(qp); while (i >= 0) { h += echap(s.slice(o, i)) + "<mark>" + echap(s.slice(i, i + qp.length)) + "</mark>"; o = i + qp.length; i = sp.indexOf(qp, o); } return h + echap(s.slice(o)); };
      res.innerHTML = out.length ? out.slice(0, 40).map(({ e, titre, occ, pdf }) => {
        const d = infosDomaine(e.domaine);
        const ex = occ.slice(0, 3).map(o => { const a = Math.max(0, o.i - 60), b = Math.min(o.t.length, o.i + qp.length + 90), s = o.t.slice(a, b).replace(/\s+/g, " "); return `<button class="extrait" data-ch="${echap(e.chemin)}" data-p="${pdf ? o.k + 1 : ""}">${pdf ? `<span class="pg">p. ${o.k + 1}</span>` : ""}<span>${a ? "…" : ""}${marquer(s)}${b < o.t.length ? "…" : ""}</span></button>`; }).join("");
        return `<div class="resultat" style="--c:${d.couleur}"><a class="r-tete" href="${lienFiche(e.chemin)}"><span class="d"><i></i>${echap(d.nom)}</span><span class="t">${marquer(titre)}</span>${occ.length ? `<span class="nb">${occ.length >= 60 ? "60+" : occ.length} occurrence${occ.length > 1 ? "s" : ""}</span>` : ""}</a>${ex}</div>`;
      }).join("") : `<p class="aucun">Aucun résultat</p>`;
      $$(".extrait", res).forEach(b => b.onclick = () => { if (b.dataset.p) ALLER_POS = { ch: b.dataset.ch, pos: +b.dataset.p }; aller(lienFiche(b.dataset.ch)); });
    };
    let t; q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(lancer, 220); });
    if (q.value) lancer();
  }

  // ----- Graphiques -----
  function bulle(conteneur) {
    let b = $(".bulle", conteneur);
    if (!b) { b = document.createElement("div"); b.className = "bulle"; b.hidden = true; conteneur.appendChild(b); }
    return b;
  }
  function placerBulle(b, conteneur, x, y, html) {
    b.innerHTML = html; b.hidden = false;
    const W = conteneur.clientWidth, bw = b.offsetWidth;
    b.style.left = Math.max(0, Math.min(W - bw, x - bw / 2)) + "px";
    b.style.top = Math.max(0, y - b.offsetHeight - 12) + "px";
  }
  function echelle(max) {
    const brut = max / 4, p = Math.pow(10, Math.floor(Math.log10(brut || 1))), n = brut / p;
    const pas = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
    return { pas, haut: Math.max(pas, Math.ceil(max / pas) * pas) };
  }
  function graphXp(el, jours) {
    const W = el.clientWidth || 600, H = 220, g = { h: 12, d: 12, b: 26, gch: 44 };
    const debut = plusJours(auj(), -(jours - 1));
    let cumul = Object.entries(P.jours).filter(([d]) => d < debut).reduce((s, [, j]) => s + (j.xp || 0), 0);
    const pts = [];
    for (let i = 0; i < jours; i++) { const d = plusJours(debut, i); cumul += P.jours[d]?.xp || 0; pts.push({ d, v: cumul, gain: P.jours[d]?.xp || 0 }); }
    const { pas, haut } = echelle(Math.max(10, pts[pts.length - 1].v));
    const x = i => g.gch + i * (W - g.gch - g.d) / (pts.length - 1), y = v => H - g.b - v / haut * (H - g.h - g.b);
    let grille = "";
    for (let v = 0; v <= haut; v += pas) grille += `<line x1="${g.gch}" x2="${W - g.d}" y1="${y(v)}" y2="${y(v)}" class="grille"/><text x="${g.gch - 8}" y="${y(v) + 4}" text-anchor="end" class="axe">${v}</text>`;
    const ticks = [0, Math.round((pts.length - 1) / 2), pts.length - 1].map(i => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"}" class="axe">${i === pts.length - 1 ? "aujourd'hui" : dateLisible(pts[i].d)}</text>`).join("");
    const ligne = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const aire = ligne + `L${x(pts.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="XP cumulé sur ${jours} jours">
      <defs><linearGradient id="deg-xp" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--dorure)" stop-opacity=".28"/><stop offset="1" stop-color="var(--dorure)" stop-opacity="0"/></linearGradient></defs>
      ${grille}${ticks}<path d="${aire}" fill="url(#deg-xp)"/><path d="${ligne}" fill="none" stroke="var(--dorure)" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${x(pts.length - 1)}" cy="${y(pts[pts.length - 1].v)}" r="4.5" fill="var(--dorure)" stroke="var(--feuille)" stroke-width="2"/>
      <g class="survol" visibility="hidden"><line class="viseur" y1="${g.h}" y2="${H - g.b}"/><circle r="5" fill="var(--dorure)" stroke="var(--feuille)" stroke-width="2"/></g>
      <rect x="${g.gch}" y="0" width="${W - g.gch - g.d}" height="${H - g.b}" fill="transparent" class="zone"/></svg>`;
    const svg = $("svg", el), sv = $(".survol", svg), b = bulle(el);
    const bouger = ev => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(pts.length - 1, Math.round((ev.clientX - r.left - g.gch) / ((W - g.gch - g.d) / (pts.length - 1)))));
      sv.setAttribute("visibility", "visible");
      $("line", sv).setAttribute("x1", x(i)); $("line", sv).setAttribute("x2", x(i));
      $("circle", sv).setAttribute("cx", x(i)); $("circle", sv).setAttribute("cy", y(pts[i].v));
      placerBulle(b, el, x(i), y(pts[i].v), `<b>${pts[i].v} XP</b><span>${dateJour(pts[i].d)}${pts[i].gain ? `, +${pts[i].gain}` : ""}</span>`);
    };
    const zone = $(".zone", svg);
    zone.addEventListener("pointermove", bouger); zone.addEventListener("pointerdown", bouger);
    zone.addEventListener("pointerleave", () => { sv.setAttribute("visibility", "hidden"); b.hidden = true; });
  }
  // ----- Progrès -----
  let PLAGE_XP = 30;
  function vueProgres() {
    marquerNav("progres");
    const nv = niveau(P.xp), s = serie();
    P.serieRecord = Math.max(P.serieRecord || 0, s);
    const doms = domaines();
    const j30 = Array.from({ length: 30 }, (_, i) => P.jours[plusJours(auj(), -i)] || {});
    const jal30 = j30.reduce((a, j) => a + (j.jal || 0), 0);
    const R = 54, C = 2 * Math.PI * R;
    const sem = 26, cell = 14, gap = 4, dow = (new Date().getDay() + 6) % 7;
    const debut = plusJours(auj(), -(sem - 1) * 7 - dow);
    const maxXp = Math.max(30, ...Object.values(P.jours).map(j => j.xp || 0));
    let rects = "", mois = "", dm = -1, de = -9;
    for (let w = 0; w < sem; w++) for (let dd = 0; dd < 7; dd++) {
      const jour = plusJours(debut, w * 7 + dd);
      if (jour > auj()) continue;
      const x = P.jours[jour]?.xp || 0, niv = !x ? 0 : x < maxXp * .25 ? 1 : x < maxXp * .5 ? 2 : x < maxXp * .75 ? 3 : 4;
      rects += `<rect x="${w * (cell + gap)}" y="${18 + dd * (cell + gap)}" width="${cell}" height="${cell}" rx="3" class="c${niv}"><title>${dateJour(jour)} : ${x} XP</title></rect>`;
      const m = +jour.split("-")[1] - 1;
      if (dd === 0 && m !== dm) { if (w < sem - 1 && w - de >= 3) { mois += `<text x="${w * (cell + gap)}" y="11" class="axe">${MOIS[m]}</text>`; de = w; } dm = m; }
    }
    const HW = sem * (cell + gap), HH = 18 + 7 * (cell + gap);
    const etats = doms.map(d => { const fs = fichesDe(d.id); const m = fs.filter(e => etat(e.chemin) === "lue").length, l = fs.filter(e => etat(e.chemin) === "encours").length; return { d, n: fs.length, m, l, nv: fs.length - m - l }; });
    const segment = (v, n, cls, lib) => v ? `<span class="seg ${cls}" style="flex:${v}" title="${pluriel(v, "fiche")} ${lib}">${v / n > 0.12 ? v : ""}</span>` : "";

    vue().innerHTML = `
      <h1 class="titre-vue">Progrès</h1>
      <div class="prog-haut">
        <div class="panneau niveau-grand">
          <div class="anneau">
            <svg viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="${R}" class="anneau-fond"/><circle cx="64" cy="64" r="${R}" class="anneau-plein" stroke-dasharray="${C.toFixed(1)}" style="--off:${(C * (1 - nv.frac)).toFixed(1)};--tour:${C.toFixed(1)}" transform="rotate(-90 64 64)"/></svg>
            ${LOGO.svg()}
          </div>
          <div class="ng-texte"><div class="k">Niveau ${nv.n}</div><div class="nom">${echap(nv.nom)}</div><div class="sous">${P.xp - nv.bas} / ${nv.haut - nv.bas} XP vers ${echap(niveau(nv.haut).nom)}</div></div>
        </div>
        <div class="tuiles">
          <div class="tuile"><span class="v dore">${s}</span><span class="l">série, record ${P.serieRecord}</span></div>
          <div class="tuile"><span class="v">${P.jalonsTotal || 0}</span><span class="l">parties validées</span></div>
          <div class="tuile"><span class="v">${jal30}</span><span class="l">parties sur 30 j</span></div>
          <div class="tuile"><span class="v">${nbLues()}</span><span class="l">documents terminés</span></div>
          <div class="tuile"><span class="v">${CATALOGUE.filter(e => etat(e.chemin) === "encours").length}</span><span class="l">en cours</span></div>
          <div class="tuile"><span class="v">${P.xp}</span><span class="l">XP au total</span></div>
        </div>
      </div>
      <section class="panneau section">
        <div class="panneau-tete"><h2>XP cumulé</h2><div class="segmente" role="group" aria-label="Période">${[[30, "30 j"], [90, "3 mois"], [365, "1 an"]].map(([v, l]) => `<button data-plage="${v}" aria-pressed="${PLAGE_XP === v}">${l}</button>`).join("")}</div></div>
        <div class="graphe" id="g-xp"></div>
      </section>
      <section class="panneau section">
        <div class="panneau-tete"><h2>Temps d'étude</h2><div class="segmente" role="group" aria-label="Objectif quotidien">${[10, 15, 20, 30, 45, 60].map(v => `<button data-obj="${v}" aria-pressed="${objectifMin() === v}">${v} min</button>`).join("")}</div></div>
        <div class="graphe" id="g-temps"></div>
      </section>
      <div class="prog-bas">
        <section class="panneau section">
          <div class="panneau-tete"><h2>Domaines</h2><div class="legende-g"><span><i class="l-mai"></i>Terminés</span><span><i class="l-lue"></i>En cours</span><span><i class="l-nouv"></i>Nouveaux</span></div></div>
          ${etats.length ? `<div class="dom-barres">${etats.map(x => `<a class="dom-barre" href="${lienDom(x.d.id)}"><span class="dn"><i style="background:${x.d.couleur}"></i>${echap(x.d.nom)}</span><span class="pile">${segment(x.m, x.n, "mai", "terminés")}${segment(x.l, x.n, "lue", "en cours")}${segment(x.nv, x.n, "nouv", "nouveaux")}</span></a>`).join("")}</div>` : `<p class="aucun">Aucun domaine</p>`}
        </section>
        <section class="panneau section">
          <div class="panneau-tete"><h2>Régularité</h2></div>
          <div class="carte-chaleur"><svg width="${HW}" height="${HH}" viewBox="0 0 ${HW} ${HH}" role="img" aria-label="Activité par jour sur six mois">${mois}${rects}</svg></div>
        </section>
      </div>
      <section class="panneau section">
        <div class="panneau-tete"><h2>Badges</h2><span class="compte-badges">${Object.keys(P.badges).length}/${BADGES.length}</span></div>
        <div class="badges">${BADGES.map(b => `<div class="badge ${P.badges[b.id] ? "obtenu" : ""}" title="${echap(b.d)}"><span class="sceau">${b.s}</span><span class="n">${echap(b.n)}</span><span class="d">${P.badges[b.id] ? dateLisible(P.badges[b.id]) : echap(b.d)}</span></div>`).join("")}</div>
      </section>
      <section class="section sauvegarde">
        <button class="bouton" id="exporter">Copier ma progression</button><button class="bouton discret" id="montrer-import">Restaurer</button>
        <div id="zone-import" hidden><textarea class="zone-texte" id="import-texte" aria-label="Code de progression"></textarea><div class="formulaire"><button class="bouton principal" id="importer">Restaurer</button><span class="aucun" id="import-msg"></span></div></div>
      </section>`;
    $$("[data-obj]").forEach(b => b.onclick = () => { P.objectif = { min: +b.dataset.obj }; const j = jourDe(auj()); if (j.objectif && (j.sec || 0) < objectifMin() * 60) j.objectif = false; sauver(); $$("[data-obj]").forEach(x => x.setAttribute("aria-pressed", x === b)); graphTemps($("#g-temps")); majObjectif(); toast(`Objectif : ${b.dataset.obj} min par jour`); });
    requestAnimationFrame(() => { graphXp($("#g-xp"), PLAGE_XP); graphTemps($("#g-temps")); const hc = $(".carte-chaleur"); if (hc) hc.scrollLeft = hc.scrollWidth; });
    $$("[data-plage]").forEach(b => b.onclick = () => { PLAGE_XP = +b.dataset.plage; $$("[data-plage]").forEach(x => x.setAttribute("aria-pressed", x === b)); graphXp($("#g-xp"), PLAGE_XP); });
    $("#exporter").onclick = async () => {
      const code = btoa(unescape(encodeURIComponent(JSON.stringify(P))));
      try { await navigator.clipboard.writeText(code); toast("Progression copiée"); }
      catch (e) { $("#zone-import").hidden = false; const t = $("#import-texte"); t.value = code; t.select(); }
    };
    $("#montrer-import").onclick = () => { $("#zone-import").hidden = false; $("#import-texte").focus(); };
    $("#importer").onclick = () => {
      try { const o = JSON.parse(decodeURIComponent(escape(atob($("#import-texte").value.trim())))); if (!o || o.v !== 1) throw 0; P = o; sauver(); majBarre(); toast("Progression restaurée"); vueProgres(); }
      catch (e) { $("#import-msg").textContent = "Code invalide"; }
    };
  }
  let redim;
  window.addEventListener("resize", () => { clearTimeout(redim); redim = setTimeout(() => { if (ROUTE === "#/progres" && $("#g-xp")) { graphXp($("#g-xp"), PLAGE_XP); graphTemps($("#g-temps")); } }, 150); });

  // ----- Ajouter -----
  async function vueAjouter() {
    marquerNav("importer");
    const doms = domaines();
    const ajouts = (await idb.tous()).sort((a, b) => (b.ajoute || "").localeCompare(a.ajoute || ""));
    const r = depot();
    vue().innerHTML = `
      <h1 class="titre-vue">Ajouter</h1>
      <div class="formulaire">
        <label class="champ" for="dom">Domaine
          <select id="dom">${doms.map(d => `<option value="${echap(d.id)}">${echap(d.nom)}</option>`).join("")}<option value="__nouveau">Nouveau domaine…</option></select></label>
        <label class="champ" for="nouveau-dom" id="champ-nouveau" ${doms.length ? "hidden" : ""}>Nom<input id="nouveau-dom" placeholder="Philosophie"></label>
        <label class="champ" for="inter" id="champ-inter">Intercalaire
          <select id="inter"></select></label>
        <label class="champ" for="nouvel-inter-nom" id="champ-ninter" hidden>Nom de l'intercalaire<input id="nouvel-inter-nom" placeholder="Chapitre 1"></label>
      </div>
      <label class="depot" id="depot" for="fichiers">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
        <span class="grand">Déposer des fichiers</span>
        <span class="petit">Rangé tel quel dans le classeur, lu dans sa version originale</span>
        <input type="file" id="fichiers" multiple hidden>
      </label>
      ${ajouts.length ? `<section class="section"><h2 class="section-titre">Sur cet appareil</h2><div class="ajouts">${ajouts.map(a => { const d = infosDomaine(a.chemin.split("/")[0]); return `<div class="ajout" style="--c:${d.couleur}"><i></i><a class="n" href="${lienFiche(a.chemin)}">${echap(titreDe(entree(a.chemin, "ajout")))}</a><span class="d">${echap(d.nom)}</span><button class="bouton discret" data-retirer="${echap(a.chemin)}">Retirer</button></div>`; }).join("")}</div></section>` : ""}
      ${sectionSync()}
      ${false ? `<section class="section"><h2 class="section-titre">Publier sur GitHub</h2><div class="liens-depot">${doms.map(d => `<a class="bouton" href="https://github.com/${r.owner}/${r.repo}/upload/${r.branche}/fiches/${encodeURIComponent(d.id)}" target="_blank" rel="noopener">${echap(d.nom)}</a>`).join("")}</div></section>` : ""}`;
    brancherSync();
    const sel = $("#dom"), champ = $("#champ-nouveau"), selI = $("#inter"), champI = $("#champ-ninter");
    const majInter = () => {
      const l = sel.value === "__nouveau" ? [] : intercalairesDe(sel.value);
      selI.innerHTML = `<option value="">Aucun</option>${l.map(n => `<option value="${echap(n)}">${echap(n)}</option>`).join("")}<option value="__nouveau">Nouvel intercalaire…</option>`;
      const f = FILTRE[sel.value]; if (f && l.includes(f)) selI.value = f;
      champI.hidden = true;
    };
    const dernier = stock.lire("etagere.dernierDom", "");
    if (!doms.length) sel.value = "__nouveau"; else if (dernier && doms.some(d => d.id === dernier)) sel.value = dernier;
    majInter();
    sel.onchange = () => { champ.hidden = sel.value !== "__nouveau"; if (!champ.hidden) $("#nouveau-dom").focus(); majInter(); };
    selI.onchange = () => { champI.hidden = selI.value !== "__nouveau"; if (!champI.hidden) $("#nouvel-inter-nom").focus(); };
    const depotEl = $("#depot"), input = $("#fichiers");
    const recevoir = async files => {
      let dom = sel.value;
      if (dom === "__nouveau") {
        const n = $("#nouveau-dom").value.trim();
        if (!n) { $("#nouveau-dom").focus(); champ.classList.add("requis"); return; }
        dom = sansAccent(n).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "divers";
        CFG.domaines = CFG.domaines || {};
        if (!CFG.domaines[dom]) { CFG.domaines[dom] = { nom: n, couleur: couleurLibre(dom), t: Date.now() }; const perso = stock.lire("etagere.domaines", {}); perso[dom] = CFG.domaines[dom]; stock.ecrire("etagere.domaines", perso); }
      }
      let sous = selI.value;
      if (sous === "__nouveau") {
        const n = $("#nouvel-inter-nom").value.trim();
        if (!n) { $("#nouvel-inter-nom").focus(); champI.classList.add("requis"); return; }
        const l = intercalairesDe(dom); sous = nomLibre(l, n); enregistrerInter(dom, [...l, sous]);
      }
      stock.ecrire("etagere.dernierDom", dom);
      depotEl.classList.add("travail");
      const base = dom + "/" + (sous ? sous.replace(/\//g, "-") + "/" : "");
      $(".grand", depotEl).textContent = "Rangement…";
      if (nuageActif()) {
        const ch2 = [];
        for (const f of files) ch2.push({ chemin: base + f.name, donnees: await f.arrayBuffer() });
        try { await commitNuage(ch2, `Ajouter ${pluriel(files.length, "document")}`, x => { $(".grand", depotEl).textContent = `Envoi… ${Math.round(x * 100)} %`; }); }
        catch (err) { depotEl.classList.remove("travail"); $(".grand", depotEl).textContent = "Déposer des fichiers"; toast("Envoi impossible : " + echap(err.message)); return; }
      }
      for (const f of files) {
        const ch = base + f.name;
        if (!nuageActif()) await idb.mettre({ chemin: ch, donnees: await f.arrayBuffer(), ajoute: new Date().toISOString() });
        DOCS.delete(ch); delete META[ch]; await idb.retirerRendu(ch);
        if (P.supprimes) delete P.supprimes[ch];
      }
      await chargerCatalogue();
      for (let k = 0; k < files.length; k++) {
        $(".grand", depotEl).textContent = files.length > 1 ? `Préparation du sommaire (${k + 1}/${files.length})…` : "Préparation du sommaire…";
        try { await indexer(trouver(base + files[k].name), true); } catch (e) {}
      }
      toast(`${pluriel(files.length, "document rangé", "documents rangés")} dans ${echap(infosDomaine(dom).nom)}${sous ? " · " + echap(sous) : ""}`);
      if (sous) FILTRE[dom] = sous;
      aller(lienDom(dom));
    };
    input.onchange = () => input.files.length && recevoir([...input.files]);
    ["dragenter", "dragover"].forEach(t => depotEl.addEventListener(t, e => { e.preventDefault(); depotEl.classList.add("survol"); }));
    ["dragleave", "drop"].forEach(t => depotEl.addEventListener(t, e => { e.preventDefault(); depotEl.classList.remove("survol"); }));
    depotEl.addEventListener("drop", e => e.dataTransfer.files.length && recevoir([...e.dataTransfer.files]));
    $$("[data-retirer]").forEach(b => b.onclick = async () => {
      if (!b.dataset.confirme) { b.dataset.confirme = 1; b.textContent = "Confirmer"; b.classList.add("danger"); return; }
      await idb.retirer(b.dataset.retirer); DOCS.delete(b.dataset.retirer); delete META[b.dataset.retirer]; sauverMeta(); await chargerCatalogue(); vueAjouter();
    });
  }

  // ================= Routage et transitions =================
  let ROUTE = "#/";
  const DEFIL = {};
  function transition(fn) {
    if (document.startViewTransition && !reduit() && !document.hidden) { try { document.startViewTransition(() => { fn(); }); return; } catch (e) {} }
    fn();
  }
  function aller(h) {
    DEFIL[ROUTE] = window.scrollY;
    if (h !== ROUTE) { try { history.pushState(null, "", h); } catch (e) {} }
    ROUTE = h;
    transition(() => rendre(false));
  }
  async function rendre(garderDefil) {
    if (LISEUSE) LISEUSE.fermer(true);
    if (VOIX.actif && ROUTE !== lienFiche(VOIX.ch)) arreterVoix(false);
    fermerMenu();
    if (!/^#\/d\//.test(ROUTE)) { vue().classList.remove("mode-gestion"); GESTION = null; }
    if (!pret) { vue().innerHTML = `<div class="chargement">${LOGO.svg()}</div>`; return; }
    const r = ROUTE.replace(/^#/, "") || "/";
    if (garderDefil !== true) window.scrollTo(0, 0);
    const m = r.match(/^\/(d|f)\/(.+)$/);
    if (r === "/") vueAccueil();
    else if (m && m[1] === "d") vueDomaine(decodeURIComponent(m[2]));
    else if (m && m[1] === "f") await vueFiche(m[2].split("/").map(decodeURIComponent).join("/"));
    else if (r === "/chercher") vueChercher();
    else if (r === "/progres") vueProgres();
    else if (r === "/ajouter") await vueAjouter();
    else vueAccueil();
    if (typeof garderDefil === "number") window.scrollTo(0, garderDefil);
    majBarre();
  }
  document.addEventListener("click", ev => {
    const a = ev.target.closest('a[href^="#/"]');
    if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    ev.preventDefault(); aller(a.getAttribute("href"));
  });
  window.addEventListener("popstate", () => {
    if (location.hash.startsWith("#connexion=")) { connexionParLien(); return; }
    if (LISEUSE && LISEUSE.pousse() && (location.hash || "#/") === ROUTE) { LISEUSE.fermer(); return; }
    DEFIL[ROUTE] = window.scrollY;
    ROUTE = location.hash.startsWith("#/") ? location.hash : "#/";
    transition(() => rendre(DEFIL[ROUTE] || 0));
  });

  async function demarrer() {
    Object.assign(CFG.domaines = CFG.domaines || {}, stock.lire("etagere.domaines", {}));
    const nom = CFG.nom || "Étagère";
    $("#marque").innerHTML = LOGO.svg() + `<span>${echap(nom)}</span>`;
    const puce = document.createElement("button"); puce.id = "seance"; puce.className = "seance-puce"; puce.hidden = true; puce.setAttribute("aria-label", "Séance en cours");
    puce.onclick = ev => menuSeance(ev.currentTarget);
    $(".barre-in").insertBefore(puce, $("#niveau-mini"));
    majSeance();
    document.title = nom;
    ROUTE = location.hash.startsWith("#/") ? location.hash : "#/";
    majBarre(); rendre();
    await connexionParLien();
    await chargerCatalogue();
    rendre();
    if (nuageActif()) synchroniser().then(() => { majBarre(); if (!LISEUSE) rendre(true); });
    if (MODE === "site" && "serviceWorker" in navigator && location.protocol === "https:") { try { navigator.serviceWorker.register("sw.js"); } catch (e) {} }
  }
  demarrer();
})();
