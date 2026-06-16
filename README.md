# Mundial 2026 Backend para Roblox

Este backend sirve como puente seguro entre Roblox y una API deportiva.

## Archivos

- `server.js`: servidor Express.
- `package.json`: dependencias y comando de inicio.
- `.env.example`: ejemplo de variables de entorno.
- `.gitignore`: evita subir `.env` y `node_modules`.

## Ejecutar localmente

```bash
npm install
copy .env.example .env
node server.js
```

Luego abre:

```text
http://localhost:3000/health
http://localhost:3000/worldcup/live
```

## Variables importantes

```env
PROVIDER=sportradar
SPORTRADAR_API_KEY=tu_key
CACHE_SECONDS=30
```

## En Roblox

En `ServerScriptService > WorldCupLiveServer` pon:

```lua
local USE_REAL_API = true
local API_URL = "https://TU-URL-DE-RENDER.onrender.com/worldcup/live"
```

Y activa:

```text
Game Settings > Security > Allow HTTP Requests
```