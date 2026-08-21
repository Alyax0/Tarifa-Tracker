// api/kick-me.js
// El frontend llama a esto para saber: ¿hay alguien logueado ahora mismo?
// Si sí, devuelve su nombre y saldo. Si no, dice que no hay sesión.

import { kv } from "@vercel/kv";

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  });
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  const cookies = parseCookies(req);
  const kickUserId = cookies.tarifa_session;

  if (!kickUserId) {
    return res.status(200).json({ loggedIn: false });
  }

  const wallet = await kv.get(`wallet:${kickUserId}`);
  if (!wallet) {
    return res.status(200).json({ loggedIn: false });
  }

  return res.status(200).json({
    loggedIn: true,
    username: wallet.username,
    balance: wallet.balance,
  });
}
