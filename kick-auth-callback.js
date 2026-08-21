// api/kick-auth-callback.js
// Acá vuelve el viewer después de aprobar el login en Kick. Confirmamos
// que todo esté en orden, le pedimos a Kick su identidad real, y le
// creamos (o encontramos) su billetera de monedas en la base de datos.

import { kv } from "@vercel/kv";

const KICK_CLIENT_ID = process.env.KICK_CLIENT_ID;
const KICK_CLIENT_SECRET = process.env.KICK_CLIENT_SECRET;
const KICK_REDIRECT_URI = process.env.KICK_REDIRECT_URI;
const SITE_URL = process.env.SITE_URL || "https://tarifa-tracker.vercel.app";
const WELCOME_BONUS = 500; // monedas de regalo la primera vez que alguien entra

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
  const { code, state } = req.query;
  const cookies = parseCookies(req);

  if (!code || !state || state !== cookies.kick_oauth_state || !cookies.kick_pkce_verifier) {
    return res.status(400).send("Login inválido o expirado. Volvé a intentar.");
  }

  try {
    // Cambiamos el código por un token de acceso
    const tokenRes = await fetch("https://id.kick.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: KICK_CLIENT_ID,
        client_secret: KICK_CLIENT_SECRET,
        redirect_uri: KICK_REDIRECT_URI,
        code,
        code_verifier: cookies.kick_pkce_verifier,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => "");
      throw new Error(`token exchange falló ${tokenRes.status}: ${body.slice(0, 300)}`);
    }
    const tokenData = await tokenRes.json();

    // Con el token, pedimos quién es
    const userRes = await fetch("https://api.kick.com/public/v1/users", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) throw new Error(`no se pudo leer el usuario: ${userRes.status}`);
    const userData = await userRes.json();
    const user = userData?.data?.[0];
    if (!user?.user_id) throw new Error("respuesta de usuario sin id");

    const walletKey = `wallet:${user.user_id}`;
    let wallet = await kv.get(walletKey);
    if (!wallet) {
      wallet = {
        kickUserId: user.user_id,
        username: user.name || user.username || "viewer",
        balance: WELCOME_BONUS,
        createdAt: new Date().toISOString(),
      };
      await kv.set(walletKey, wallet);
    }

    // Cookie de sesión propia (simple, no es un banco: solo identifica al viewer)
    res.setHeader("Set-Cookie", [
      `kick_pkce_verifier=; Path=/; Max-Age=0`,
      `kick_oauth_state=; Path=/; Max-Age=0`,
      `tarifa_session=${user.user_id}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
    ]);

    res.writeHead(302, { Location: SITE_URL });
    res.end();
  } catch (e) {
    res.status(500).send(`Error en el login con Kick: ${e.message}`);
  }
}
