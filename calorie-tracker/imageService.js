'use strict';
/* ================================================================
   NutriFlow — Image Service
   No API key. No signup. Works immediately.

   Sources (tried in order, results cached 24h):
   1. TheMealDB  — real recipe photos matched to food names (free)
   2. Foodish    — category food photography fallback (free)
   ================================================================ */
const ImageService = (() => {
  const TTL  = 24 * 60 * 60 * 1000;
  const _mem = new Map();

  function _key(kw) {
    return 'nf_img_' + kw.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 52);
  }

  function _read(kw) {
    const k = _key(kw);
    if (_mem.has(k)) return _mem.get(k);
    try {
      const raw = localStorage.getItem(k);
      if (!raw) return null;
      const { ts, d } = JSON.parse(raw);
      if (Date.now() - ts > TTL) { localStorage.removeItem(k); return null; }
      _mem.set(k, d);
      return d;
    } catch { return null; }
  }

  function _write(kw, data) {
    const k = _key(kw);
    _mem.set(k, data);
    try { localStorage.setItem(k, JSON.stringify({ ts: Date.now(), d: data })); } catch {}
  }

  // ── Source 1: TheMealDB ──────────────────────────────────────
  // Free public API, no key. Returns real recipe photography.
  async function _mealDB(keyword) {
    const term = keyword
      .split(/[+&,·]/)[0]
      .replace(/\b(food|meal|bowl|healthy|high|protein|balanced|photography|quick|easy)\b/gi, '')
      .trim();
    if (term.length < 3) return null;
    const res = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(term)}`);
    if (!res.ok) return null;
    const { meals } = await res.json();
    if (!meals?.length) return null;
    const m = meals[Math.floor(Math.random() * Math.min(3, meals.length))];
    return { url: m.strMealThumb, small: m.strMealThumb, alt: m.strMeal };
  }

  // ── Source 2: Foodish ────────────────────────────────────────
  // Free public API, no key. Category-based food photography.
  const _FOODISH_MAP = [
    [/chicken|tikka|murgh|butter|poultry/i,     'butter-chicken'],
    [/biryani|rice|chawal|pilaf|fried.rice/i,   'biryani'],
    [/pasta|spaghetti|noodle|penne|linguine/i,  'pasta'],
    [/pizza/i,                                  'pizza'],
    [/burger|sandwich/i,                        'burger'],
    [/samosa|pakora|fritter/i,                  'samosa'],
    [/dosa|idli|idly|pancake|crepe/i,           'dosa'],
    [/dessert|cake|sweet|halwa|pudding/i,        'dessert'],
    [/breakfast|morning|egg|oat/i,              'dosa'],
    [/salad|veggie|greens|bowl|healthy/i,       'fried-rice'],
  ];
  async function _foodish(keyword) {
    let cat = 'biryani';
    for (const [rx, c] of _FOODISH_MAP) { if (rx.test(keyword)) { cat = c; break; } }
    const res = await fetch(`https://foodish-api.com/api/images/${cat}`);
    if (!res.ok) return null;
    const { image } = await res.json();
    return { url: image, small: image, alt: keyword };
  }

  // ── Main fetch (tries both, caches winner) ───────────────────
  async function fetchImage(keyword) {
    const cleanKw = keyword.toLowerCase().trim();
    if (cleanKw.includes('desi protein bowl')) {
      return { url: 'assets/desi-protein-bowl.png', small: 'assets/desi-protein-bowl.png', alt: 'Desi Protein Bowl' };
    }
    const cached = _read(keyword);
    if (cached) return cached;
    let data = null;
    try { data = await _mealDB(keyword); } catch {}
    if (!data) { try { data = await _foodish(keyword); } catch {} }
    if (data) _write(keyword, data);
    return data;
  }

  // ── Attach lazy-loading img to a container ───────────────────
  // Stays as CSS gradient fallback if both sources fail — no broken boxes.
  function attachImg(container, keyword, { alt = '', small = false } = {}) {
    fetchImage(keyword).then(data => {
      if (!data) return;
      const img = document.createElement('img');
      img.className = 'food-img food-img--loading';
      img.alt = alt || keyword;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onload  = () => { img.classList.remove('food-img--loading'); img.classList.add('food-img--loaded'); };
      img.onerror = () => img.remove();
      img.src = small ? data.small : data.url;
      container.insertBefore(img, container.firstChild);
    });
  }

  return { fetchImage, attachImg };
})();
