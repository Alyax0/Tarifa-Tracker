// api/kick-status.js
// Antes intentaba llamar a Kick directo desde el servidor de Vercel, pero
// Kick bloquea peticiones que detecta como venidas de un servidor (no de
// una persona navegando). Ahora el bot.js (que corre con un navegador real)
// chequea el estado cada 45s y lo guarda en KV -- este endpoint solo lee
// ese valor guardado, no le pregunta a Kick directamente.
//
// GET /api/kick-status -> { live, viewers, thumbnail, checkedAt }

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const status = (await kv.get("kick:status")) || { live: false, viewers: null, thumbnail: null };
  return res.status(200).json(status);
}
