const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 7000;
const BASE_URL = 'https://asialiveaction.com';

// ─── CORS (obligatorio para Stremio) ───────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

// ─── Helpers ───────────────────────────────────────────────────────────────
function encodeId(url) {
  return 'ala_' + Buffer.from(url).toString('base64url').slice(0, 40);
}

function decodeId(id) {
  const b64 = id.replace('ala_', '');
  try {
    return Buffer.from(b64, 'base64url').toString('utf-8');
  } catch {
    return null;
  }
}

async function fetchPage(url) {
  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
    timeout: 10000,
  });
  return cheerio.load(data);
}

// ─── Manifest ─────────────────────────────────────────────────────────────
app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'com.asialiveaction.stremio',
    version: '1.0.0',
    name: 'Asia Live Action',
    description: 'Doramas, series y películas asiáticas desde asialiveaction.com',
    logo: 'https://asialiveaction.com/wp-content/uploads/2020/01/cropped-favicon-1-192x192.png',
    background: 'https://asialiveaction.com/wp-content/uploads/2023/01/banner.jpg',
    resources: ['catalog', 'meta', 'stream'],
    types: ['series', 'movie'],
    catalogs: [
      {
        type: 'series',
        id: 'ala_series',
        name: 'Doramas y Series',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false },
          { name: 'genre', isRequired: false, options: ['Romance', 'Acción', 'Comedia', 'Drama', 'Thriller', 'Misterio', 'Fantasía', 'Histórico'] }
        ]
      },
      {
        type: 'movie',
        id: 'ala_movies',
        name: 'Películas Asiáticas',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false }
        ]
      }
    ],
    behaviorHints: { adult: false, p2p: false }
  });
});

// ─── Catálogo Series ──────────────────────────────────────────────────────
app.get('/catalog/series/ala_series.json', async (req, res) => {
  try {
    const { search, skip, genre } = req.query;
    let url = BASE_URL;

    if (search) {
      url = `${BASE_URL}/?s=${encodeURIComponent(search)}`;
    } else if (genre) {
      url = `${BASE_URL}/genero/${genre.toLowerCase()}/`;
    } else {
      const page = skip ? Math.floor(parseInt(skip) / 20) + 1 : 1;
      url = page > 1 ? `${BASE_URL}/page/${page}/` : BASE_URL;
    }

    const $ = await fetchPage(url);
    const metas = [];

    // Selectores adaptados a la estructura típica de este tipo de sitios WordPress
    $('article, .TPost, .MovieList .TPostMv, .item').each((i, el) => {
      const $el = $(el);
      const title = $el.find('h2, h3, .Title, .title').first().text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const poster =
        $el.find('img').first().attr('data-src') ||
        $el.find('img').first().attr('src') || '';

      if (title && link.includes(BASE_URL)) {
        metas.push({
          id: encodeId(link),
          type: 'series',
          name: title,
          poster: poster,
          posterShape: 'poster',
        });
      }
    });

    res.json({ metas: metas.slice(0, 40) });
  } catch (err) {
    console.error('Catalog series error:', err.message);
    res.json({ metas: [] });
  }
});

// ─── Catálogo Películas ───────────────────────────────────────────────────
app.get('/catalog/movie/ala_movies.json', async (req, res) => {
  try {
    const { search, skip } = req.query;
    let url = search
      ? `${BASE_URL}/?s=${encodeURIComponent(search)}&post_type=movies`
      : `${BASE_URL}/peliculas/`;

    const page = skip ? Math.floor(parseInt(skip) / 20) + 1 : 1;
    if (page > 1) url += `page/${page}/`;

    const $ = await fetchPage(url);
    const metas = [];

    $('article, .TPost, .MovieList .TPostMv').each((i, el) => {
      const $el = $(el);
      const title = $el.find('h2, h3, .Title').first().text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const poster =
        $el.find('img').first().attr('data-src') ||
        $el.find('img').first().attr('src') || '';

      if (title && link.includes(BASE_URL)) {
        metas.push({
          id: encodeId(link),
          type: 'movie',
          name: title,
          poster,
          posterShape: 'poster',
        });
      }
    });

    res.json({ metas: metas.slice(0, 40) });
  } catch (err) {
    console.error('Catalog movies error:', err.message);
    res.json({ metas: [] });
  }
});

// ─── Meta (detalles) ──────────────────────────────────────────────────────
app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { id, type } = req.params;
    const pageUrl = decodeId(id);
    if (!pageUrl) return res.json({ meta: {} });

    const $ = await fetchPage(pageUrl);

    const title =
      $('h1.Title, h1.entry-title, .TPost h1').first().text().trim() ||
      $('title').text().split('|')[0].trim();

    const description =
      $('.Description p, .sinopsis p, .entry-content p').first().text().trim();

    const poster =
      $('.TPostBg img, .post-thumbnail img, article img').first().attr('data-src') ||
      $('.TPostBg img, .post-thumbnail img, article img').first().attr('src') || '';

    const year =
      $('.Date, .year, time').first().text().match(/\d{4}/)?.[0] || '';

    const genres = [];
    $('.Genre a, .generos a, a[rel="category tag"]').each((i, el) => {
      genres.push($(el).text().trim());
    });

    res.json({
      meta: {
        id,
        type,
        name: title,
        poster,
        description,
        year,
        genres,
        links: [{ name: 'Ver en Asia Live Action', category: 'Web', url: pageUrl }],
      }
    });
  } catch (err) {
    console.error('Meta error:', err.message);
    res.json({ meta: {} });
  }
});

// ─── Streams ──────────────────────────────────────────────────────────────
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { id } = req.params;
    const pageUrl = decodeId(id);
    if (!pageUrl) return res.json({ streams: [] });

    const $ = await fetchPage(pageUrl);
    const streams = [];

    // Buscar iframes de reproductores embebidos
    $('iframe').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (src && (src.includes('player') || src.includes('embed') || src.includes('video'))) {
        streams.push({
          name: `Asia Live Action`,
          description: `Reproductor ${i + 1}`,
          externalUrl: src,
        });
      }
    });

    // Buscar links directos de video
    $('source').each((i, el) => {
      const src = $(el).attr('src') || '';
      if (src && (src.endsWith('.mp4') || src.endsWith('.m3u8'))) {
        streams.push({
          name: 'Asia Live Action (Directo)',
          description: 'Stream directo',
          url: src,
        });
      }
    });

    // Enlace web como fallback
    streams.push({
      name: '🌐 Abrir en navegador',
      description: 'Ver en asialiveaction.com',
      externalUrl: pageUrl,
    });

    res.json({ streams });
  } catch (err) {
    console.error('Stream error:', err.message);
    res.json({ streams: [{ name: 'Error', description: err.message, streams: [] }] });
  }
});

// ─── Root redirect ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.redirect('/manifest.json');
});

app.listen(PORT, () => {
  console.log(`\n✅ Asia Live Action Stremio Addon corriendo en:`);
  console.log(`   → Local:  http://localhost:${PORT}/manifest.json`);
  console.log(`\nPega esta URL en Stremio → Addons → URL del addon\n`);
});
