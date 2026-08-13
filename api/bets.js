// api/bets.js
// Backend minimo para el Live Tracker, usando Vercel KV (ya que la pagina
// tambien vive en Vercel, se activa desde el mismo dashboard sin cuentas
// aparte).
//
//   GET  /api/bets   -> la pagina lo llama sola cada 20s, devuelve el JSON de apuestas
//   POST /api/bets   -> tu script sync_bets.py lo llama cada X minutos, sube apuestas nuevas
//
// SETUP (una sola vez):
//   1. En tu proyecto de Vercel: pestaña "Storage" -> "Create Database" -> "KV"
//   2. Dale "Connect Project" a este mismo proyecto -> Vercel agrega solo las
//      variables KV_REST_API_URL / KV_REST_API_TOKEN, no hay que tocarlas.
//   3. Agrega una variable mas a mano: SYNC_SECRET, cualquier password larga
//      que inventes (Settings -> Environment Variables).
//   4. Instala el paquete: npm install @vercel/kv
//
// Con eso el flujo queda: sync_bets.py -> POST aqui -> se guarda en KV
//                          tu pagina    -> GET aqui  -> lee de KV -> la muestra

import { kv } from "@vercel/kv";

const KEY = "bets:all";
const SYNC_SECRET = process.env.SYNC_SECRET;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Sync-Secret");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const bets = (await kv.get(KEY)) || [];
    return res.status(200).json({ bets });
  }

  if (req.method === "POST") {
    // el script tiene que mandar el mismo secreto que configuraste en Vercel
    if (req.headers["x-sync-secret"] !== SYNC_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const incoming = Array.isArray(req.body) ? req.body : req.body.bets;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ error: "se esperaba un array de apuestas" });
    }

    const current = (await kv.get(KEY)) || [];
    const known = new Set(current.filter((b) => b.externalId).map((b) => b.externalId));
    const merged = [...current, ...incoming.filter((b) => !b.externalId || !known.has(b.externalId))];

    await kv.set(KEY, merged);

    return res.status(200).json({ ok: true, total: merged.length, added: merged.length - current.length });
  }

  return res.status(405).json({ error: "method not allowed" });
}

