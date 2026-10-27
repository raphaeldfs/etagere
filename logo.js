// Logo : cerveau vu de dessus, trait continu. Deux hémisphères, sillons en miroir.
(function () {
  const G = [
    // hémisphère gauche
    "M30.5 9.5C24 7.6 16.6 9.8 14.3 15.9C9.9 17.8 8.2 23.4 10.3 27.6C7.2 31.6 7.6 38 11.6 41.3C10.9 47.4 15.6 52.6 21.6 52.3C24.2 55.6 28 56.4 30.5 55.2Z",
    "M30.5 18.5C27.2 18.6 25.3 16.4 24.6 13.6",
    "M14.6 16.2C16.4 19.4 19.8 20.6 22.9 19.6",
    "M10.6 27.8C14.3 30.2 18.4 29.6 20.9 26.8C22.6 25 25.7 24.6 27.6 26.3",
    "M30.5 34.6C27.4 33.6 24 34.4 22 36.8C19.9 39.2 15.7 39.9 11.8 41.1",
    "M21.6 52.3C21.2 48.6 23.4 45.6 26.6 44.9",
    // hémisphère droit (miroir)
    "M33.5 9.5C40 7.6 47.4 9.8 49.7 15.9C54.1 17.8 55.8 23.4 53.7 27.6C56.8 31.6 56.4 38 52.4 41.3C53.1 47.4 48.4 52.6 42.4 52.3C39.8 55.6 36 56.4 33.5 55.2Z",
    "M33.5 18.5C36.8 18.6 38.7 16.4 39.4 13.6",
    "M49.4 16.2C47.6 19.4 44.2 20.6 41.1 19.6",
    "M53.4 27.8C49.7 30.2 45.6 29.6 43.1 26.8C41.4 25 38.3 24.6 36.4 26.3",
    "M33.5 34.6C36.6 33.6 40 34.4 42 36.8C44.1 39.2 48.3 39.9 52.2 41.1",
    "M42.4 52.3C42.8 48.6 40.6 45.6 37.4 44.9"
  ];
  function svg(opts) {
    opts = opts || {};
    const sw = opts.trait || 2.6;
    const paths = G.map(d => `<path d="${d}"/>`).join("");
    return `<svg class="${opts.classe || "logo"}" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  }
  // Icône d'appli : cerveau clair sur fond encre
  function icone(taille, fond, trait) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${taille}" height="${taille}" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${fond}"/><g transform="translate(9.6 9.6) scale(.7)" fill="none" stroke="${trait}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">${G.map(d => `<path d="${d}"/>`).join("")}</g></svg>`;
  }
  window.ETAGERE_LOGO = { svg, icone, chemins: G };
})();
