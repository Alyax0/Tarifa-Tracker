// api/kick-auth-start.js
// Primer paso del login con Kick. El viewer entra acá (por ejemplo con un
// botón "Iniciar sesión con Kick"), y lo mandamos a la página de Kick para
// que apruebe. Antes de mandarlo, generamos una clave de seguridad (PKCE)
// y la guardamos en una cookie temporal para verificarla cuando vuelva.

import crypto from "crypto";

const KICK_CLIENT_ID = process.env.KICK_CLIENT_ID;
const KICK_REDIRECT_URI = process.env.KICK_REDIRECT_URI; // https://tarifa-tracker.vercel.app/api/kick-auth-callback

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default async function handler(req, res) {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  // Cookies temporales (10 min) para verificar cuando Kick nos devuelva al viewer
  res.setHeader("Set-Cookie", [
    `kick_pkce_verifier=${verifier}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    `kick_oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
  ]);

  const params = new URLSearchParams({
    client_id: KICK_CLIENT_ID,
    redirect_uri: KICK_REDIRECT_URI,
    response_type: "code",
    scope: "user:read",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  res.writeHead(302, { Location: `https://id.kick.com/oauth/authorize?${params.toString()}` });
  res.end();
}
