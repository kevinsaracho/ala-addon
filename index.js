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

function encodeId(url) {
  return 'ala_' + Buffer.from(url).toString('base64url').slice(0, 60);
}
function decodeId(id) {
  try { return Buffer.from(id.replace('ala_', ''), 'base64url').toString('utf-8'); }
  catch { return null; }
}

async function wpFetch(path) {
  const res = await fetch(`${WP_API}${path}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`WP API error: ${res.status} ${path}`);
  return res.json();
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').trim();
}

function postToMeta(post, type) {
  const title = stripHtml(post.title?.rendered || '');
  const poster = post._embedded?.['wp:featuredmedia']?.[0]?.source_url || '';
  const description = stripHtml(post.excerpt?.rendered || '').slice(0, 300);
  const year = post.date ? post.date.slice(0, 4) : '';
  const id = encodeId(post.link || String(post.id));
  return { id, type, name: title, poster, description, year, posterShape: 'poster' };
}

app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'com.asialiveaction.stremio',
    version: '1.1.0',
    name: 'Asia Live Action',
    description: 'Doramas, series y peliculas asiaticas',
    logo: 'https://asialiveaction.com/wp-content/uploads/2020/01/cropped-favicon-1-192x192.png',
    resources: ['catalog', 'meta', 'stream'],
    types: ['series', 'movie'],
    catalogs: [
      { type: 'series', id: 'ala_series', name: 'Doramas y Series', extra: [{ name: 'search' }, { name: 'skip' }] },
      { type: 'movie', id: 'ala_movies', name: 'Peliculas Asiaticas', extra: [{ name: 'search' }, { name: 'skip' }] },
    ],
    behaviorHints: { adult: false, p2p: false },
  });
});

async function fetchPosts(search, skip, postTypes) {
  const page = skip ? Math.floor(parseInt(skip) / 20) + 1 : 1;
  for (const pt of postTypes) {
    try {
      const q = search
        ? `/posts?search=${encodeURIComponent(search)}&per_page=20&_embed`
        : `/${pt}?per_page=20&page=${page}&_embed`;
      const posts = await wpFetch(q);
      if (posts.length) return posts;
    } catch {}
  }
  return [];
}

app.get('/catalog/series/ala_series.json', async (req, res) => {
  try {
    const posts = await fetchPosts(req.query.search, req.query.skip, ['serie', 'series', 'posts']);
    res.json({ metas: posts.map(p => postToMeta(p, 'series')).filter(m => m.name) });
  } catch (err) {
    console.error(err.message);
    res.json({ metas: [] });
  }
});

app.get('/catalog/movie/ala_movies.json', async (req, res) => {
  try {
    const posts = await fetchPosts(req.query.search, req.query.skip, ['pelicula', 'movie', 'peliculas', 'posts']);
    res.json({ metas: posts.map(p => postToMeta(p, 'movie')).filter(m => m.name) });
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
    const slug = pageUrl.split('/').filter(Boolean).pop();
    let posts = [];
    for (const pt of ['posts', 'serie', 'pelicula', 'movie']) {
      try { posts = await wpFetch(`/${pt}?slug=${slug}&_embed`); if (posts.length) break; } catch {}
    }
    if (!posts.length) return res.json({ meta: { id, type, name: slug } });
    const meta = postToMeta(posts[0], type);
    meta.description = stripHtml(posts[0].content?.rendered || '').slice(0, 500);
    const cats = posts[0]._embedded?.['wp:term']?.[0] || [];
    meta.genres = cats.map(c => c.name).filter(Boolean);
    res.json({ meta });
  } catch (err) {
    console.error(err.message);
    res.json({ meta: {} });
  }
});

app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { id } = req.params;
    const pageUrl = decodeId(id);
    if (!pageUrl) return res.json({ streams: [] });
    const slug = pageUrl.split('/').filter(Boolean).pop();
    let posts = [];
    for (const pt of ['posts', 'serie', 'pelicula', 'movie']) {
      try { posts = await wpFetch(`/${pt}?slug=${slug}&_embed`); if (posts.length) break; } catch {}
    }
    const streams = [];
    if (posts.length) {
      const content = posts[0].content?.rendered || '';
      const iframes = [...content.matchAll(/src=["'](https?:\/\/[^"']+)["']/g)];
      iframes.forEach(([, src], i) => {
        if (/player|embed|video|watch|stream/i.test(src)) {
          streams.push({ name: `Asia Live Action`, description: `Reproductor ${i + 1}`, externalUrl: src });
        }
      });
      const directLinks = [...content.matchAll(/https?:\/\/[^\s"'<>]+\.(mp4|m3u8)/gi)];
      directLinks.forEach(([url]) => streams.push({ name: 'Stream directo', url }));
    }
    streams.push({ name: 'Ver en Asia Live Action', description: 'Abrir pagina web', externalUrl: pageUrl });
    res.json({ streams });
  } catch (err) {
    console.error(err.message);
    res.json({ streams: [{ name: 'Ver en web', externalUrl: BASE_URL }] });
  }
});

// Debug: ver post types disponibles
app.get('/debug/types', async (req, res) => {
  try { res.json(await wpFetch('/types')); }
  catch (err) { res.json({ error: err.message }); }
});

app.get('/', (req, res) => res.redirect('/manifest.json'));
app.listen(PORT, () => console.log(`✅ Addon corriendo en puerto ${PORT}`));
