const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = 'https://asialiveaction.com';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

function encodeId(url) {
  return 'ala_' + Buffer.from(url).toString('base64url').slice(0, 60);
}
function decodeId(id) {
  try { return Buffer.from(id.replace('ala_', ''), 'base64url').toString('utf-8'); }
  catch { return null; }
}

function titleFromSlug(url) {
  const slug = url.replace(BASE_URL, '').replace(/\/$/, '').split('/').pop();
  const clean = slug.replace(/^\d+[tpe]\d+-/, '').replace(/^\d+-/, '');
  return clean
    .replace(/-sub-espanol$/, '').replace(/-sub$/, '').replace(/-online$/, '')
    .replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function extractWpId(url) {
  const match = url.match(/\/(\d+)[tpe]\d+/);
  return match ? match[1] : null;
}

async function fetchSitemap(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
  });
  if (!res.ok) throw new Error(`Sitemap ${res.status}: ${url}`);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/g)].map(m => m[1].trim());
  const images = [...xml.matchAll(/<image:loc>(https?:\/\/[^<]+)<\/image:loc>/g)].map(m => m[1].trim());
  return { locs, images };
}

// Cache en memoria
let cacheData = { series: null, movies: null, ts: 0 };
const CACHE_TTL = 60 * 60 * 1000; // 1 hora

async function getSeriesFromSitemaps() {
  if (cacheData.series && Date.now() - cacheData.ts < CACHE_TTL) return cacheData.series;
  const all = [];
  for (let i = 1; i <= 4; i++) {
    try {
      const { locs, images } = await fetchSitemap(`${BASE_URL}/series-sitemap${i}.xml`);
      console.log(`Sitemap series ${i}: ${locs.length} URLs`);
      locs.forEach((url, idx) => {
        // Acepta cualquier URL que no sea la página principal de series/peliculas
        if (!url.match(/\/(series|peliculas|page)\/?$/)) {
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
  console.log(`Total series: ${all.length}`);
  cacheData.series = all;
  cacheData.ts = Date.now();
  return all;
}

async function getMoviesFromSitemaps() {
  if (cacheData.movies && Date.now() - cacheData.ts < CACHE_TTL) return cacheData.movies;
  const all = [];
  for (let i = 1; i <= 5; i++) {
    try {
      const { locs, images } = await fetchSitemap(`${BASE_URL}/peliculas-sitemap${i}.xml`);
      console.log(`Sitemap peliculas ${i}: ${locs.length} URLs`);
      locs.forEach((url, idx) => {
        if (!url.match(/\/(series|peliculas|page)\/?$/)) {
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
  console.log(`Total peliculas: ${all.length}`);
  cacheData.movies = all;
  return all;
}

app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'com.asialiveaction.stremio',
    version: '1.3.0',
    name: 'Asia Live Action',
    description: 'Doramas, series y peliculas asiaticas — asialiveaction.com',
    logo: 'https://asialiveaction.com/wp-content/uploads/cropped-favicon-200x200.png',
    resources: ['catalog', 'meta', 'stream'],
    types: ['series', 'movie'],
    catalogs: [
      { type: 'series', id: 'ala_series', name: 'Doramas y Series', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
      { type: 'movie', id: 'ala_movies', name: 'Peliculas Asiaticas', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    ],
    behaviorHints: { adult: false, p2p: false },
  });
});

app.get('/catalog/series/ala_series.json', async (req, res) => {
  try {
    let items = await getSeriesFromSitemaps();
    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      items = items.filter(m => m.name.toLowerCase().includes(q));
    }
    const start = parseInt(req.query.skip) || 0;
    res.json({ metas: items.slice(start, start + 20) });
  } catch (err) {
    console.error(err.message);
    res.json({ metas: [] });
  }
});

app.get('/catalog/movie/ala_movies.json', async (req, res) => {
  try {
    let items = await getMoviesFromSitemaps();
    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      items = items.filter(m => m.name.toLowerCase().includes(q));
    }
    const start = parseInt(req.query.skip) || 0;
    res.json({ metas: items.slice(start, start + 20) });
  } catch (err) {
    console.error(err.message);
    res.json({ metas: [] });
  }
});

app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { id, type } = req.params;
    const pageUrl = decodeId(id);
    if (!pageUrl) return res.json({ meta: {} });
    res.json({ meta: { id, type, name: titleFromSlug(pageUrl), poster: '' } });
  } catch (err) {
    res.json({ meta: {} });
  }
});

app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { id } = req.params;
    const pageUrl = decodeId(id);
    if (!pageUrl) return res.json({ streams: [] });
    res.json({
      streams: [{
        name: '🌐 Ver en Asia Live Action',
        description: 'Abre en el navegador',
        externalUrl: pageUrl,
      }]
    });
  } catch (err) {
    res.json({ streams: [] });
  }
});

// Debug: ver primeras URLs de un sitemap
app.get('/debug/sitemap/:n', async (req, res) => {
  try {
    const { locs } = await fetchSitemap(`${BASE_URL}/series-sitemap${req.params.n}.xml`);
    res.json({ total: locs.length, first10: locs.slice(0, 10) });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get('/', (req, res) => res.redirect('/manifest.json'));
app.listen(PORT, () => console.log(`✅ Addon corriendo en puerto ${PORT}`));
