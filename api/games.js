// api/games.js
// Devuelve el catálogo de juegos guardado por games-scraper.js.
// GET /api/games -> { games: [{name, provider, image, code, slug}, ...] }

import { kv } from "@vercel/kv";

const KEY = "games:catalog";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const games = (await kv.get(KEY)) || [];
  return res.status(200).json({ games });
}
