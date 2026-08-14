// api/kick-status.js
// Consulta si un canal de Kick está en vivo. Lo llamamos desde el servidor
// (no desde el navegador directo) porque Kick no deja llamadas cross-origin
// desde cualquier sitio.
//
// GET /api/kick-status?channel=Baitarifa
// -> { live: true/false, viewers: number|null, thumbnail: string|null }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const channel = req.query.channel;
  if (!channel) {
    return res.status(400).json({ error: "falta el parámetro channel" });
  }

  try {
    const r = await fetch(`https://kick.com/api/v2/channels/${channel}`, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
    });

    if (!r.ok) {
      // Si Kick no responde bien, asumimos offline en vez de romper la página
      return res.status(200).json({ live: false, viewers: null, thumbnail: null });
    }

    const data = await r.json();
    const live = !!data.livestream;

    return res.status(200).json({
      live,
      viewers: data.livestream?.viewer_count ?? null,
      thumbnail: data.livestream?.thumbnail?.url ?? null,
    });
  } catch (e) {
    return res.status(200).json({ live: false, viewers: null, thumbnail: null });
  }
}
