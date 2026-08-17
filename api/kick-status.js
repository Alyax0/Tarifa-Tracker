export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const channel = (req.query.channel || "").toLowerCase();
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

    const rawBody = await r.text();
    console.log("KICK STATUS:", r.status, "BODY (primeros 300 chars):", rawBody.slice(0, 300));

    if (!r.ok) {
      return res.status(200).json({ live: false, viewers: null, thumbnail: null, debug_status: r.status });
    }

    const data = JSON.parse(rawBody);
    const live = !!data.livestream;
    return res.status(200).json({
      live,
      viewers: data.livestream?.viewer_count ?? null,
      thumbnail: data.livestream?.thumbnail?.url ?? null,
    });
  } catch (e) {
    console.log("KICK STATUS ERROR:", e.message);
    return res.status(200).json({ live: false, viewers: null, thumbnail: null, debug_error: e.message });
  }
}
