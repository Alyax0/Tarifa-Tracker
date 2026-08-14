// api/sync.js
// Reemplaza a sync_bets.py: jala el perfil publico de Gamdom y guarda en KV
// directo (mismo proyecto, no hace falta llamar a /api/bets por fuera).
//
// Como Vercel Cron gratis solo corre 1 vez al dia, este endpoint esta hecho
// para que un servicio EXTERNO gratis lo llame seguido:
//
//   1. Entra a https://cron-job.org (gratis, sin tarjeta)
//   2. Crea un cron job -> URL: https://TU-PROYECTO.vercel.app/api/sync
//   3. Intervalo: cada 1-5 minutos
//   4. Listo — desde ahi corre solo, sin tu PC ni nada.
import { kv } from "@vercel/kv";

const TARGET_USERNAME = process.env.TARGET_USERNAME || "Tarifa";
const GAMDOM_COOKIE = process.env.GAMDOM_COOKIE; // <-- la cookie de sesión completa (el string largo del header Cookie)
const PROFILE_URL = "https://gamdom.com/client-api/profile/userProfileJson";
const COIN_DIVISOR = 1000;
const KEY = "bets:all";

async function fetchProfile() {
  if (!GAMDOM_COOKIE) {
    throw new Error("Falta la env var GAMDOM_COOKIE en Vercel");
  }

  const r = await fetch(PROFILE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "*/*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      Origin: "https://gamdom.com",
      Referer: "https://gamdom.com/",
      "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
      Cookie: GAMDOM_COOKIE, // <-- esto era lo que faltaba
    },
    body: JSON.stringify({ userName: TARGET_USERNAME }),
  });

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(
      `gamdom respondio ${r.status} (cookieLen=${GAMDOM_COOKIE.length}): ${body.slice(0, 200)}`
    );
  }
  return r.json();
}

function normalizePlays(data) {
  const plays = data.plays || [];
  const out = [];
  for (const p of plays) {
    const coins = p.coins || 0;
    const profit = p.profit || 0;
    if (coins === 0 && profit === 0) continue;
    const stakeUsd = Math.abs(coins) / COIN_DIVISOR;
    const profitUsd = profit / COIN_DIVISOR;
    out.push({
      externalId: `gd_${p.game_id}`,
      date: (p.created || "").slice(0, 10),
      category: "skins",
      label: `Slot #${p.game_id}`,
      stake: Math.round(stakeUsd * 100) / 100,
      profit: Math.round(profitUsd * 100) / 100,
      result: profitUsd > 0 ? "ganada" : profitUsd < 0 ? "perdida" : "pendiente",
    });
  }
  return out;
}

export default async function handler(req, res) {
  try {
    const data = await fetchProfile();
    const plays = normalizePlays(data);
    const current = (await kv.get(KEY)) || [];
    const known = new Set(current.filter((b) => b.externalId).map((b) => b.externalId));
    const fresh = plays.filter((p) => !known.has(p.externalId));
    const merged = [...current, ...fresh];
    if (fresh.length) await kv.set(KEY, merged);
    return res.status(200).json({ ok: true, added: fresh.length, total: merged.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
