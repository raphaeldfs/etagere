// Lecteur universel : transforme un fichier (presque n'importe quel format) en document affichable.
// Résultat : { genre: "md" | "html" | "pdf" | "image", contenu, titre?, pdf? }
(function () {
  const CDN = "https://cdnjs.cloudflare.com/ajax/libs/";
  const LIBS = {
    pdf: [CDN + "pdf.js/3.11.174/pdf.min.js"],
    mammoth: [CDN + "mammoth/1.6.0/mammoth.browser.min.js"],
    jszip: [CDN + "jszip/3.10.1/jszip.min.js"]
  };
  const charges = {};
  function script(src) {
    if (!charges[src]) charges[src] = new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = ok; s.onerror = () => ko(new Error("Impossible de charger " + src.split("/").slice(-2).join("/") + ". Vérifie ta connexion."));
      document.head.appendChild(s);
    });
    return charges[src];
  }
  async function lib(nom) {
    for (const src of LIBS[nom]) await script(src);
    if (nom === "pdf" && window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN + "pdf.js/3.11.174/pdf.worker.min.js";
    }
  }

  const FORMATS = {
    md: ["md", "markdown", "mdown", "mkd", "mdx"],
    texte: ["txt", "text", "log", "org", "rst", "adoc"],
    tex: ["tex", "latex"],
    html: ["html", "htm", "xhtml"],
    pdf: ["pdf"],
    docx: ["docx", "docm", "dotx"],
    odt: ["odt"],
    epub: ["epub"],
    pptx: ["pptx"],
    rtf: ["rtf"],
    csv: ["csv", "tsv"],
    json: ["json"],
    ipynb: ["ipynb"],
    image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"]
  };
  const famille = {};
  for (const [f, exts] of Object.entries(FORMATS)) exts.forEach(e => famille[e] = f);
  function extension(nom) { const m = /\.([^.\/]+)$/.exec(nom || ""); return m ? m[1].toLowerCase() : ""; }
  const LISIBLES = Object.values(FORMATS).flat();

  function texteDe(buf) {
    if (typeof buf === "string") return buf;
    const u8 = new Uint8Array(buf);
    let t = new TextDecoder("utf-8", { fatal: false }).decode(u8);
    if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
    // Fichier en Windows-1252 : trop de caractères de remplacement
    const bad = (t.match(/\uFFFD/g) || []).length;
    if (bad > 3 && bad / t.length > 0.001) {
      try { t = new TextDecoder("windows-1252").decode(u8); } catch (e) {}
    }
    return t;
  }
  function ressembleATexte(buf) {
    const u8 = new Uint8Array(buf.slice ? buf.slice(0, 4096) : buf);
    if (!u8.length) return true;
    let ctrl = 0;
    for (const b of u8) if (b === 0 || (b < 9) || (b > 13 && b < 32)) ctrl++;
    return ctrl / u8.length < 0.02;
  }
  const echap = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- Convertisseurs ----------
  function texToMd(t) {
    const titre = (/\\title\{([^}]*)\}/.exec(t) || [])[1];
    const debut = t.indexOf("\\begin{document}");
    if (debut >= 0) t = t.slice(debut + 16);
    t = t.replace(/\\end\{document\}[\s\S]*$/, "");
    t = t.replace(/(^|[^\\])%.*$/gm, "$1");
    t = t.replace(/\\maketitle/g, titre ? "# " + titre + "\n" : "");
    t = t.replace(/\\(?:section|chapter)\*?\{([^}]*)\}/g, "\n## $1\n");
    t = t.replace(/\\subsection\*?\{([^}]*)\}/g, "\n### $1\n");
    t = t.replace(/\\subsubsection\*?\{([^}]*)\}/g, "\n#### $1\n");
    t = t.replace(/\\textbf\{([^}]*)\}/g, "**$1**");
    t = t.replace(/\\(?:emph|textit)\{([^}]*)\}/g, "*$1*");
    t = t.replace(/\\underline\{([^}]*)\}/g, "$1");
    t = t.replace(/\\begin\{(?:itemize|enumerate)\}|\\end\{(?:itemize|enumerate)\}/g, "\n");
    t = t.replace(/^\s*\\item\s*/gm, "- ");
    t = t.replace(/\\begin\{(equation|align|gather)\*?\}([\s\S]*?)\\end\{\1\*?\}/g, (m, e, c) => "\n$$" + (e === "equation" ? c : "\\begin{aligned}" + c + "\\end{aligned}") + "$$\n");
    t = t.replace(/\\begin\{(theorem|definition|proposition|lemma|remark)\}([\s\S]*?)\\end\{\1\}/g, (m, e, c) => "\n> [!" + (e === "definition" ? "def" : "retenir") + "]\n> " + c.trim().replace(/\n/g, "\n> ") + "\n");
    t = t.replace(/\\\\(\s*\n)/g, "  $1");
    return t.replace(/\n{3,}/g, "\n\n").trim();
  }

  function rtfToTexte(r) {
    let t = r.replace(/\{\\\*[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, "");
    t = t.replace(/\{\\(?:fonttbl|colortbl|stylesheet|info)[\s\S]*?\}\}?/g, "");
    t = t.replace(/\\'([0-9a-f]{2})/gi, (m, h) => new TextDecoder("windows-1252").decode(new Uint8Array([parseInt(h, 16)])));
    t = t.replace(/\\u(-?\d+)\??/g, (m, n) => String.fromCharCode(n < 0 ? 65536 + +n : +n));
    t = t.replace(/\\(par|line)\b ?/g, "\n").replace(/\\tab\b ?/g, "\t");
    t = t.replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "");
    return t.replace(/\n{3,}/g, "\n\n").trim();
  }

  function decouperCsv(t, sep) {
    const lignes = []; let ligne = [], champ = "", q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"' && t[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') q = false; else champ += c; }
      else if (c === '"') q = true;
      else if (c === sep) { ligne.push(champ); champ = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; ligne.push(champ); lignes.push(ligne); ligne = []; champ = ""; }
      else champ += c;
    }
    if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
    return lignes.filter(l => l.some(x => x.trim()));
  }
  function tableauMd(lignes) {
    if (!lignes.length) return "_Fichier vide._";
    const n = Math.max(...lignes.map(l => l.length));
    const cel = s => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    const ent = lignes[0].concat(Array(n - lignes[0].length).fill(""));
    let md = "| " + ent.map(cel).join(" | ") + " |\n|" + " --- |".repeat(n) + "\n";
    for (const l of lignes.slice(1)) md += "| " + l.concat(Array(n - l.length).fill("")).map(cel).join(" | ") + " |\n";
    return md;
  }

  function ipynbToMd(t) {
    const nb = JSON.parse(t);
    const lang = nb.metadata?.kernelspec?.language || nb.metadata?.language_info?.name || "";
    return (nb.cells || []).map(c => {
      const src = Array.isArray(c.source) ? c.source.join("") : (c.source || "");
      if (c.cell_type === "markdown") return src;
      if (c.cell_type === "code") {
        let out = "```" + lang + "\n" + src + "\n```";
        for (const o of c.outputs || []) {
          const txt = o.text || o.data?.["text/plain"];
          if (txt) out += "\n```\n" + (Array.isArray(txt) ? txt.join("") : txt) + "\n```";
        }
        return out;
      }
      return src;
    }).join("\n\n");
  }

  function odtToHtml(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const T = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
    const corps = doc.getElementsByTagNameNS("urn:oasis:names:tc:opendocument:xmlns:office:1.0", "text")[0];
    if (!corps) return "";
    const inl = n => {
      let s = "";
      n.childNodes.forEach(c => {
        if (c.nodeType === 3) s += echap(c.nodeValue);
        else if (c.localName === "s") s += " ";
        else if (c.localName === "tab") s += "&emsp;";
        else if (c.localName === "line-break") s += "<br>";
        else s += inl(c);
      });
      return s;
    };
    const bloc = n => {
      let s = "";
      n.childNodes.forEach(c => {
        if (c.namespaceURI !== T && c.localName !== "table") { if (c.childNodes) s += bloc(c); return; }
        if (c.localName === "h") { const lv = Math.min(6, +(c.getAttributeNS(T, "outline-level") || 2)); s += `<h${lv}>${inl(c)}</h${lv}>`; }
        else if (c.localName === "p") { const x = inl(c); if (x.trim()) s += `<p>${x}</p>`; }
        else if (c.localName === "list") { s += "<ul>"; c.childNodes.forEach(li => { if (li.localName === "list-item") s += "<li>" + bloc(li).replace(/^<p>|<\/p>$/g, "") + "</li>"; }); s += "</ul>"; }
        else if (c.localName === "section") s += bloc(c);
      });
      return s;
    };
    return bloc(corps);
  }

  async function epubToHtml(zip) {
    const cont = await zip.file("META-INF/container.xml").async("string");
    const opfChemin = /full-path="([^"]+)"/.exec(cont)[1];
    const base = opfChemin.includes("/") ? opfChemin.replace(/[^/]+$/, "") : "";
    const opf = new DOMParser().parseFromString(await zip.file(opfChemin).async("string"), "application/xml");
    const titre = opf.getElementsByTagName("dc:title")[0]?.textContent;
    const items = {};
    for (const it of opf.getElementsByTagName("item")) items[it.getAttribute("id")] = it.getAttribute("href");
    let html = "";
    for (const ref of opf.getElementsByTagName("itemref")) {
      const href = items[ref.getAttribute("idref")];
      const f = href && zip.file(decodeURIComponent(base + href));
      if (!f) continue;
      const d = new DOMParser().parseFromString(await f.async("string"), "application/xhtml+xml");
      const b = d.body || d.getElementsByTagName("body")[0];
      if (b) { b.querySelectorAll("img,image,svg").forEach(x => x.remove()); html += b.innerHTML + "\n<hr>\n"; }
    }
    return { html: html.replace(/<hr>\n$/, ""), titre };
  }

  async function pptxToMd(zip) {
    const slides = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
    let md = "";
    for (const [i, p] of slides.entries()) {
      const xml = new DOMParser().parseFromString(await zip.file(p).async("string"), "application/xml");
      const paras = [...xml.getElementsByTagName("a:p")].map(pp => [...pp.getElementsByTagName("a:t")].map(t => t.textContent).join("")).filter(s => s.trim());
      if (!paras.length) continue;
      md += `## ${paras[0]}\n\n` + paras.slice(1).map(s => "- " + s).join("\n") + "\n\n";
    }
    return md || "_Présentation sans texte._";
  }

  // Texte brut d'un PDF (pour la recherche et les questions)
  async function textePdf(pdf, maxPages) {
    const n = Math.min(pdf.numPages, maxPages || 60);
    let out = "";
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      let derY = null;
      for (const it of tc.items) {
        const y = it.transform ? it.transform[5] : null;
        if (derY !== null && y !== null && Math.abs(y - derY) > 2) out += "\n";
        out += it.str; derY = y;
        if (it.hasEOL) { out += "\n"; derY = null; }
      }
      out += "\n\n";
    }
    return out;
  }

  // ---------- Point d'entrée ----------
  async function lire(nom, source) {
    const ext = extension(nom);
    let fam = famille[ext];
    const buf = source instanceof Blob ? await source.arrayBuffer() : source;
    if (!fam) {
      if (typeof buf === "string" || ressembleATexte(buf)) fam = "texte";
      else throw new Error(`Le format .${ext || "?"} n'est pas reconnu, et le fichier ne contient pas de texte lisible.`);
    }
    switch (fam) {
      case "md": return { genre: "md", contenu: texteDe(buf) };
      case "texte": {
        const t = texteDe(buf);
        // Le texte brut garde ses retours à la ligne ; on le passe en Markdown prudent.
        const md = t.split(/\n{2,}/).map(p => p.replace(/([\\`*_[\]#>|])/g, "\\$1").replace(/\n/g, "  \n")).join("\n\n");
        return { genre: "md", contenu: md };
      }
      case "tex": return { genre: "md", contenu: texToMd(texteDe(buf)) };
      case "rtf": return { genre: "md", contenu: rtfToTexte(texteDe(buf)).split(/\n{2,}/).map(p => p.replace(/\n/g, "  \n")).join("\n\n") };
      case "csv": return { genre: "md", contenu: tableauMd(decouperCsv(texteDe(buf), ext === "tsv" ? "\t" : (texteDe(buf).split("\n")[0].split(";").length > texteDe(buf).split("\n")[0].split(",").length ? ";" : ","))) };
      case "json": {
        const t = texteDe(buf); let v;
        try { v = JSON.parse(t); } catch (e) { return { genre: "md", contenu: "```\n" + t + "\n```" }; }
        if (Array.isArray(v) && v.length && v.every(o => o && typeof o === "object" && !Array.isArray(o))) {
          const cles = [...new Set(v.flatMap(Object.keys))];
          return { genre: "md", contenu: tableauMd([cles, ...v.map(o => cles.map(k => typeof o[k] === "object" ? JSON.stringify(o[k]) : o[k]))]) };
        }
        return { genre: "md", contenu: "```json\n" + JSON.stringify(v, null, 2) + "\n```" };
      }
      case "ipynb": return { genre: "md", contenu: ipynbToMd(texteDe(buf)) };
      case "html": {
        const d = new DOMParser().parseFromString(texteDe(buf), "text/html");
        d.querySelectorAll("script,style,noscript,link,meta,iframe,form,button,input,select,textarea,nav").forEach(x => x.remove());
        return { genre: "html", contenu: d.body ? d.body.innerHTML : "", titre: d.title || undefined };
      }
      case "image": {
        const type = ext === "svg" ? "image/svg+xml" : "image/" + (ext === "jpg" ? "jpeg" : ext);
        return { genre: "image", contenu: URL.createObjectURL(new Blob([buf], { type })) };
      }
      case "pdf": {
        await lib("pdf");
        const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
        let titre;
        try { const m = await pdf.getMetadata(); const t = (m?.info?.Title || "").trim(); titre = t.length > 2 && !/^(untitled|sans titre|document\d*$|microsoft (word|powerpoint))|\.(docx?|pptx?|pdf|tex)$/i.test(t) ? t : undefined; } catch (e) {}
        return { genre: "pdf", pdf, titre };
      }
      case "docx": {
        await lib("mammoth");
        const r = await window.mammoth.convertToHtml({ arrayBuffer: buf });
        return { genre: "html", contenu: r.value };
      }
      case "odt": {
        await lib("jszip");
        const zip = await window.JSZip.loadAsync(buf);
        return { genre: "html", contenu: odtToHtml(await zip.file("content.xml").async("string")) };
      }
      case "epub": {
        await lib("jszip");
        const r = await epubToHtml(await window.JSZip.loadAsync(buf));
        return { genre: "html", contenu: r.html, titre: r.titre };
      }
      case "pptx": {
        await lib("jszip");
        return { genre: "md", contenu: await pptxToMd(await window.JSZip.loadAsync(buf)) };
      }
    }
  }

  window.ETAGERE_LECTEUR = { lire, extension, textePdf, LISIBLES, FORMATS, lib };
})();
