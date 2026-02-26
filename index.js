const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = 'https://asialiveaction.com';
const WP_API = `${BASE_URL}/wp-json/wp/v2`;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

// ─── Helpers ───────────────────────────────────────────────────────────────
function encodeId(url) {
  return 'ala_' + Buffer.from(url).toString('base64url').slice(0, 60);
}
function decodeId(id) {
  try { return Buffer.from(id.replace('ala_', ''), 'base64url').toString('utf-8'); }
  catch { return null; }
}
function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').trim();
}

// Extrae el ID numérico de la URL: /tv/123456t1-nombre/ → 123456
function extractWpId(url) {
  const match = url.match(/\/tv\/(\d+)t\d+/) || url.match(/\/pelicula\/(\d+)p\d+/) || url.match(/\/(\d+)/);
  return match ? match[1] : null;
}

// Extrae el título desde el slug de la URL
function titleFromSlug(url) {
  const slug = url.replace(BASE_URL, '').replace(/\/$/, '').split('/').pop();
  // Elimina el prefijo numérico tipo "123456t1-"
  const clean = slug.replace(/^\d+[tp]\d+-/, '').replace(/^\d+-/, '');
  return clean.replace(/-sub-espanol$/, '').replace(/-sub$/, '').replace(/-/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

// ─── Fetch sitemap XML ─────────────────────────────────────────────────────
async function fetchSitemap(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }
  });
  if (!res.ok) throw new Error(`Sitemap error ${res.status}`);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/g)].map(m => m[1]);
  const images = [...xml.matchAll(/<image:loc>(https?:\/\/[^<]+)<\/image:loc>/g)].map(m => m[1]);
  return { locs, images };
}

// Cache en memoria
const cache = { series: null, movies: null, ts: 0 };
const CACHE_TTL = 30 * 60 * 1000; // 30 minutos

async function getSeriesFromSitemaps() {
  if (cache.series && Date.now() - cache.ts < CACHE_TTL) return cache.series;
  const all = [];
  for (let i = 1; i <= 4; i++) {
    try {
      const { locs, images } = await fetchSitemap(`${BASE_URL}/series-sitemap${i}.xml`);
      locs.forEach((url, idx) => {
        if (url.includes('/tv/') || url.includes('/series/')) {
          all.push({
            id: encodeId(url),
            type: 'series',
            name: titleFromSlug(url),
            poster: images[idx] || '',
            posterShape: 'poster',
            url,
          });
        }
      });
    } catch (e) { console.error(`Sitemap series ${i} error:`, e.message); }
  }
  cache.series = all;
  cache.ts = Date.now();
  return all;
}

async function getMoviesFromSitemaps() {
  if (cache.movies && Date.now() - cache.ts < CACHE_TTL) return cache.movies;
  const all = [];
  for (let i = 1; i <= 5; i++) {
    try {
      const { locs, images } = await fetchSitemap(`${BASE_URL}/peliculas-sitemap${i}.xml`);
      locs.forEach((url, idx) => {
        if (!url.endsWith('/peliculas/')) {
          all.push({
            id: encodeId(url),
            type: 'movie',
            name: titleFromSlug(url),
            poster: images[idx] || '',
            posterShape: 'poster',
            url,
          });
        }
      });
    } catch (e) { console.error(`Sitemap peliculas ${i} error:`, e.message); }
  }
  cache.movies = all;
  return all;
}

// ─── Manifest ─────────────────────────────────────────────────────────────
app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'com.asialiveaction.stremio',
    version: '1.2.0',
    name: 'Asia Live Action',
    description: 'Doramas, series y peliculas asiaticas — asialiveaction.com',
    logo: 'https://asialiveaction.com/wp-content/uploads/cropped-favicon-200x200.png',
    resources: ['catalog', 'meta', 'stream'],
    types: ['series', 'movie'],
    catalogs: [
      {
        type: 'series', id: 'ala_series', name: 'Doramas y Series',
        extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
      },
      {
        type: 'movie', id: 'ala_movies', name: 'Peliculas Asiaticas',
        extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
      },
    ],
    behaviorHints: { adult: false, p2p: false },
  });
});

// ─── Catálogo Series ──────────────────────────────────────────────────────
app.get('/catalog/series/ala_series.json', async (req, res) => {
  try {
    const { search, skip } = req.query;
    let items = await getSeriesFromSitemaps();
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(m => m.name.toLowerCase().includes(q));
    }
    const start = parseInt(skip) || 0;
    res.json({ metas: items.slice(start, start + 20) });
  } catch (err) {
    console.error(err.message);
    res.json({ metas: [] });
  }
});

// ─── Catálogo Películas ───────────────────────────────────────────────────
app.get('/catalog/movie/ala_movies.json', async (req, res) => {
  try {
    const { search, skip } = req.query;
    let items = await getMoviesFromSitemaps();
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(m => m.name.toLowerCase().includes(q));
    }
    const start = parseInt(skip) || 0;
    res.json({ metas: items.slice(start, start + 20) });
  } catch (err) {
    console.error(err.message);
    res.json({ metas: [] });
  }
});

// ─── Meta ─────────────────────────────────────────────────────────────────
app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { id, type } = req.params;
    const pageUrl = decodeId(id);
    if (!pageUrl) return res.json({ meta: {} });
    const name = titleFromSlug(pageUrl);

    // Intentar obtener datos desde WP API por ID numérico
    const wpId = extractWpId(pageUrl);
    let description = '', poster = '', genres = [], year = '';

    if (wpId) {
      try {
        const r = await fetch(`${WP_API}/tv/${wpId}?_embed`, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
        });
        if (r.ok) {
          const post = await r.json();
          description = stripHtml(post.excerpt?.rendered || '').slice(0, 400);
          poster = post._embedded?.['wp:featuredmedia']?.[0]?.source_url || '';
          year = post.date?.slice(0, 4) || '';
          const cats = post._embedded?.['wp:term']?.[0] || [];
          genres = cats.map(c => c.name).filter(Boolean);
        }
      } catch {}
    }

    res.json({ meta: { id, type, name, poster, description, year, genres } });
  } catch (err) {
    console.error(err.message);
    res.json({ meta: {} });
  }
});

// ─── Streams ──────────────────────────────────────────────────────────────
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { id } = req.params;
    const pageUrl = decodeId(id);
    if (!pageUrl) return res.json({ streams: [] });

    const streams = [];
    const wpId = extractWpId(pageUrl);

    if (wpId) {
      // Intentar obtener contenido HTML del post via WP API
      try {
        const postType = pageUrl.includes('/tv/') ? 'tv' : 'peliculas';
        const r = await fetch(`${WP_API}/${postType}/${wpId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
        });
        if (r.ok) {
          const post = await r.json();
          const content = post.content?.rendered || '';
          // Buscar iframes
          const iframes = [...content.matchAll(/src=["'](https?:\/\/[^"']+)["']/g)];
          iframes.forEach(([, src], i) => {
            if (/player|embed|video|watch|stream|jwplayer/i.test(src)) {
              streams.push({ name: `Reproductor ${i + 1}`, externalUrl: src });
            }
          });
          // Links directos
          const directLinks = [...content.matchAll(/https?:\/\/[^\s"'<>]+\.(mp4|m3u8)/gi)];
          directLinks.forEach(([url]) => streams.push({ name: 'Stream directo', url }));
        }
      } catch {}
    }

    // Siempre agregar enlace web como fallback
    streams.push({
      name: '🌐 Ver en Asia Live Action',
      description: 'Abrir en el navegador',
      externalUrl: pageUrl,
    });

    res.json({ streams });
  } catch (err) {
    console.error(err.message);
    res.json({ streams: [{ name: '🌐 Ver en web', externalUrl: BASE_URL }] });
  }
});

app.get('/', (req, res) => res.redirect('/manifest.json'));
app.listen(PORT, () => console.log(`✅ Addon corriendo en puerto ${PORT}`));
