# 🎬 Asia Live Action — Addon para Stremio

Addon no oficial para ver doramas, series y películas asiáticas desde [asialiveaction.com](https://asialiveaction.com) directamente en Stremio.

---

## 🚀 Instalación rápida

### Requisitos
- [Node.js](https://nodejs.org) v16 o superior
- [Stremio](https://www.stremio.com)

### Pasos

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar el servidor
npm start
```

El servidor arrancará en `http://localhost:7000`

### Agregar a Stremio

1. Abre **Stremio**
2. Ve a **Addons** (icono puzzle)
3. Clic en **"+ Add addon"** o pega la URL manualmente:
   ```
   http://localhost:7000/manifest.json
   ```
4. Clic en **Install** ✅

---

## ☁️ Despliegue en la nube (acceso remoto)

Para usar el addon desde cualquier dispositivo sin tener el PC encendido, despliégalo gratis en:

### Railway (recomendado)
1. Crea cuenta en [railway.app](https://railway.app)
2. Conecta tu repositorio de GitHub con estos archivos
3. Railway detecta automáticamente el `package.json`
4. Copia la URL pública y úsala en Stremio

### Render
1. Crea cuenta en [render.com](https://render.com)
2. Nuevo **Web Service** → sube los archivos
3. Build command: `npm install`
4. Start command: `node index.js`

### Glitch
1. Ve a [glitch.com](https://glitch.com) → New Project → Import from GitHub
2. La URL del proyecto es tu endpoint

---

## 📁 Estructura del proyecto

```
asialiveaction-addon/
├── index.js        ← Servidor principal del addon
├── package.json    ← Dependencias
└── README.md       ← Este archivo
```

---

## 🔧 Rutas disponibles

| Ruta | Descripción |
|------|-------------|
| `GET /manifest.json` | Manifest del addon |
| `GET /catalog/series/ala_series.json` | Catálogo de doramas/series |
| `GET /catalog/movie/ala_movies.json` | Catálogo de películas |
| `GET /meta/:type/:id.json` | Detalles de un título |
| `GET /stream/:type/:id.json` | Links de reproducción |

---

## ⚠️ Notas importantes

- **Scraping**: El addon extrae contenido directamente del sitio web. Si Asia Live Action cambia su diseño, puede ser necesario ajustar los selectores CSS en `index.js`.
- **Streams**: Algunos reproductores están protegidos con JavaScript y no se pueden extraer directamente. En esos casos, el addon abre la página en el navegador.
- **Uso personal**: Este addon es para uso personal. Respeta los términos de servicio del sitio.

---

## 🛠️ Personalización

Si los resultados aparecen vacíos, inspecciona el HTML del sitio con DevTools y actualiza los selectores en `index.js`:

```js
// Línea ~60 en index.js — ajusta estos selectores:
$('article, .TPost, .MovieList .TPostMv, .item').each(...)
//  ↑ Selector de tarjetas de contenido

const title = $el.find('h2, h3, .Title').first().text().trim();
//                       ↑ Selector del título
```
