import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Search, Shuffle, Trophy, RefreshCw, Radio, Dice5, Coins,
} from "lucide-react";

// URL de tu endpoint backend (ver api/bets.js). La página lo consulta sola,
// sin que nadie tenga que apretar nada.
const SYNC_ENDPOINT = "https://tarifa-tracker.vercel.app/api/bets";
const POLL_MS = 20000; // cada cuanto revisa por apuestas nuevas

const CATS = {
  deportiva: { label: "Deportiva", color: "#4C8DFF" },
  skins: { label: "Gamdom", color: "#00D9FF" },
};
const RESULTS = {
  pendiente: { label: "Pendiente", color: "#F5A623" },
  ganada: { label: "Ganada", color: "#35D07F" },
  perdida: { label: "Perdida", color: "#E8283F" },
  push: { label: "Push", color: "#8A8A90" },
};

// Juegos reales disponibles en Gamdom: los 7 Originals de la casa, más
// slots confirmados de proveedores reales (Pragmatic Play, Hacksaw Gaming,
// Nolimit City, NetEnt, Play'n GO, Playson) que sí están en su catálogo.
const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = (n) => {
  const num = Number(n || 0);
  const abs = Math.abs(num);
  if (abs >= 1000) return `$${(num / 1000).toFixed(1)}k`;
  return `$${num.toFixed(2)}`;
};
const todayStr = () => new Date().toISOString().slice(0, 10);
const timeAgo = (iso) => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMin = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return `${Math.floor(diffH / 24)}d`;
};

export default function LiveTracker() {
  const [view, setView] = useState("feed"); // feed | picker
  const [bets, setBets] = useState([]);
  const [bankroll, setBankroll] = useState(100);
  const [loaded, setLoaded] = useState(false);
  const [brand, setBrand] = useState("TARIFA LIVE TRACKER");
  const [kickChannel, setKickChannel] = useState("Baitarifa");
  const [editingBrand, setEditingBrand] = useState(false);
  const [filter, setFilter] = useState("todas");
  const [lastSync, setLastSync] = useState(null);
  const [syncStatus, setSyncStatus] = useState("esperando"); // esperando | ok | error
  const [kickLive, setKickLive] = useState(false);
  const [session, setSession] = useState(null); // { username, balance } o null si no logueado
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    try {
      const b = localStorage.getItem("bets_v2"); if (b) setBets(JSON.parse(b));
      const br = localStorage.getItem("bankroll"); if (br) setBankroll(JSON.parse(br));
      const bd = localStorage.getItem("brand_v2"); if (bd) setBrand(bd);
    } catch (e) {}
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) localStorage.setItem("bets_v2", JSON.stringify(bets)); }, [bets, loaded]);
  useEffect(() => { if (loaded) localStorage.setItem("bankroll", JSON.stringify(bankroll)); }, [bankroll, loaded]);
  useEffect(() => { if (loaded) localStorage.setItem("brand_v2", brand); }, [brand, loaded]);

  const profitOf = (bet) => {
    if (bet.profit !== undefined && bet.profit !== null) return Number(bet.profit);
    const stake = parseFloat(bet.stake) || 0;
    const odds = parseFloat(bet.odds) || 1;
    if (bet.result === "ganada") return stake * (odds - 1);
    if (bet.result === "perdida") return -stake;
    return 0;
  };

  const sorted = useMemo(() => [...bets].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0)), [bets]);
  const stats = useMemo(() => {
    const settled = bets.filter((b) => b.result !== "pendiente");
    const staked = bets.reduce((s, b) => s + (parseFloat(b.stake) || 0), 0);
    const netProfit = bets.reduce((s, b) => s + profitOf(b), 0);
    const wins = settled.filter((b) => b.result === "ganada").length;
    return {
      staked, netProfit,
      winRate: settled.length ? (wins / settled.length) * 100 : 0,
      roi: staked ? (netProfit / staked) * 100 : 0,
    };
  }, [bets]);
  const chartData = useMemo(() => {
    let running = parseFloat(bankroll) || 0;
    const pts = [{ i: 0, label: "Inicio", balance: running }];
    sorted.forEach((b, idx) => { running += profitOf(b); pts.push({ i: idx + 1, label: b.date, balance: running }); });
    return pts;
  }, [sorted, bankroll]);
  const currentBalance = chartData[chartData.length - 1]?.balance ?? bankroll;
  const positive = currentBalance >= parseFloat(bankroll || 0);

  const feedList = useMemo(
    () => [...bets].filter((b) => filter === "todas" || b.category === filter).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [bets, filter]
  );
  const BIG_WIN_THRESHOLD = 5000;
  const bigWins = useMemo(
    () => [...bets].filter((b) => b.result === "ganada" && profitOf(b) >= BIG_WIN_THRESHOLD).sort((a, b) => profitOf(b) - profitOf(a)),
    [bets]
  );

  // Trae apuestas nuevas del backend automáticamente, sin intervención manual.
  const syncFromApi = async () => {
    try {
      const res = await fetch(SYNC_ENDPOINT);
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      const arr = Array.isArray(data) ? data : data.bets;
      if (!Array.isArray(arr)) throw new Error("bad shape");
      setBets((prev) => {
        const existing = new Set(prev.filter((b) => b.externalId).map((b) => b.externalId));
        const fresh = arr.filter((b) => !b.externalId || !existing.has(b.externalId)).map((b) => ({
          id: uid(), externalId: b.externalId || null, date: b.date || todayStr(),
          createdAt: b.createdAt || null,
          category: CATS[b.category] ? b.category : "skins", label: b.label || b.description || "Gamdom bet",
          stake: b.stake ?? 0, odds: b.odds ?? 1, result: RESULTS[b.result] ? b.result : "pendiente",
          profit: b.profit !== undefined ? b.profit : null,
        }));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
      setSyncStatus("ok");
      setLastSync(new Date());
    } catch (e) {
      setSyncStatus("error");
    }
  };

  useEffect(() => {
    if (!loaded) return;
    syncFromApi();
    const interval = setInterval(syncFromApi, POLL_MS);
    return () => clearInterval(interval);
  }, [loaded]);

  // Consulta si el viewer que abrió la página tiene sesión activa con Kick.
  useEffect(() => {
    fetch("/api/kick-me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setSession(data.loggedIn ? { username: data.username, balance: data.balance } : null);
        setSessionChecked(true);
      })
      .catch(() => setSessionChecked(true));
  }, []);

  // Consulta si el canal de Kick está en vivo, cada 30s.
  useEffect(() => {
    let cancelled = false;
    const checkKick = async () => {
      try {
        const res = await fetch(`/api/kick-status?channel=${kickChannel}`);
        const data = await res.json();
        if (!cancelled) setKickLive(!!data.live);
      } catch (e) {
        if (!cancelled) setKickLive(false);
      }
    };
    checkKick();
    const interval = setInterval(checkKick, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [kickChannel]);

  return (
    <div className="w-full min-h-screen relative overflow-hidden" style={{ background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
        :root {
          --bg: #000000; --panel: #0D0D0D; --panel-2: #161616; --border: #242424;
          --accent: #00D9FF; --accent-dim: #0A2A33;
          --accent-2: #F5A623; --accent-2-dim: #2E2107;
          --text: #F2F2F0; --text-muted: #8A8A90;
          --font-display: 'Archivo Black', sans-serif; --font-body: 'Archivo Black', sans-serif; --font-mono: 'JetBrains Mono', monospace;
        }
        .mono { font-family: var(--font-mono); }
        .display { font-family: var(--font-display); letter-spacing: -0.02em; line-height: 0.92; }
        .btr-input { background: var(--panel-2); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 8px 10px; font-size: 14px; outline: none; }
        .btr-input:focus { border-color: var(--accent); }
        .btr-card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; }
        .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 100px; font-size: 12px; font-weight: 500; }
        .provider-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border-left: 3px solid transparent; transition: background 0.15s, border-color 0.15s; }
        .provider-row:hover { background: var(--panel-2); }
        .navtab { padding: 8px 16px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
        .row-hover:hover { background: var(--panel-2); }
        .slot-card { transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease; }
        .slot-card:hover { transform: translateY(-3px); }
        .btn-amber:hover { background: #FFC24D; }
        .outline-text { color: transparent; -webkit-text-stroke: 1.5px var(--ink, var(--accent)); }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
      `}</style>

      <div className="relative mx-auto px-5 py-6" style={{ zIndex: 1, maxWidth: 1600 }}>
        {/* Nav */}
        <div className="flex items-center justify-between mb-10">
          <div className="display text-2xl" style={{ color: "var(--accent)" }}>
            {editingBrand ? (
              <input autoFocus className="btr-input display text-xl" value={brand} onChange={(e) => setBrand(e.target.value)} onBlur={() => setEditingBrand(false)} onKeyDown={(e) => e.key === "Enter" && setEditingBrand(false)} />
            ) : (
              <span onClick={() => setEditingBrand(true)} className="cursor-pointer">{brand}</span>
            )}
          </div>
          <div className="flex items-center gap-1 px-3 py-2 rounded-full" style={{ border: "1px solid var(--border)", background: "var(--panel)" }}>
            <div
              className="navtab"
              style={{
                color: view === "feed" ? "var(--accent)" : "var(--text-muted)",
                fontWeight: view === "feed" ? 700 : 500,
                borderBottom: view === "feed" ? "2px solid var(--accent)" : "2px solid transparent",
                textShadow: view === "feed" ? "0 0 10px rgba(0,217,255,0.5)" : "none",
                paddingBottom: 6,
              }}
              onClick={() => setView("feed")}
            ><Radio size={14} /> Live Feed</div>
            <div
              className="navtab"
              style={{
                color: view === "picker" ? "var(--accent)" : "var(--text-muted)",
                fontWeight: view === "picker" ? 700 : 500,
                borderBottom: view === "picker" ? "2px solid var(--accent)" : "2px solid transparent",
                textShadow: view === "picker" ? "0 0 10px rgba(0,217,255,0.5)" : "none",
                paddingBottom: 6,
              }}
              onClick={() => setView("picker")}
            ><Dice5 size={14} /> Slot Picker</div>
            <a href="https://tarifagiveaway.com/es/home" target="_blank" rel="noreferrer" className="navtab" style={{ color: "#FF5FA8", textDecoration: "none", fontWeight: 600 }}>
              <img src="/tarifagiveaway-logo.png" alt="" style={{ height: 16, width: "auto" }} /> Tarifagiveaway
            </a>
            <a href="https://gamdom.com/r/tarifa" target="_blank" rel="noreferrer" className="navtab" style={{ color: "#35D07F", textDecoration: "none", fontWeight: 600 }}>
              <img src="/gamdom-logo.png" alt="" style={{ height: 16, width: "auto" }} /> Gamdom
            </a>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <RefreshCw size={12} className={syncStatus === "esperando" ? "animate-spin" : ""} style={{ color: syncStatus === "error" ? "#E8283F" : "#35D07F" }} />
              {syncStatus === "error" ? "sin conexión" : lastSync ? `sync ${lastSync.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}` : "conectando..."}
            </div>
            {sessionChecked && (
              session ? (
                <div className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold" style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }}>
                  <span>{session.username}</span>
                  <span style={{ color: "#35D07F" }}>{session.balance.toLocaleString()} 🪙</span>
                </div>
              ) : (
                <a href="/api/kick-auth-start" className="px-4 py-2 rounded-full text-sm font-semibold" style={{ background: "#53FC18", color: "#000", textDecoration: "none" }}>
                  Entrar con Kick
                </a>
              )
            )}
          </div>
        </div>

        {view === "feed" ? (
          <>
            <h1 className="display text-6xl text-center mb-1" style={{ color: "var(--text)" }}>
              {brand.split(" ")[0]} <span className="outline-text" style={{ "--ink": "var(--accent)" }}>{brand.split(" ").slice(1).join(" ")}</span>
            </h1>
            <div className="text-center text-xs mb-8" style={{ color: "var(--text-muted)" }}>
              Fuente: Gamdom · sincronizado automáticamente
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[306px_862px_306px] gap-4">
              {/* Left: feed */}
              <div className="btr-card overflow-hidden" style={{ height: 542, display: "flex", flexDirection: "column" }}>
                <div className="p-3" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-bold uppercase tracking-wider">Apuestas</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>{feedList.length} apuestas</div>
                  </div>
                  <div className="flex gap-1">
                    {["todas", ...Object.keys(CATS)].map((k) => (
                      <button key={k} onClick={() => setFilter(k)} className="chip" style={{ background: filter === k ? "var(--accent)" + "22" : "transparent", color: filter === k ? "var(--accent)" : "var(--text-muted)", border: `1px solid ${filter === k ? "var(--accent)" : "var(--border)"}` }}>
                        {k === "todas" ? "Recientes" : CATS[k].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="overflow-y-auto flex-1">
                  {feedList.length === 0 ? (
                    <div className="p-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>Sin apuestas todavía.</div>
                  ) : feedList.map((b) => {
                    const profit = profitOf(b);
                    return (
                      <div key={b.id} className="row-hover px-3 py-2 flex items-start justify-between gap-2" style={{ borderLeft: `3px solid ${profit >= 0 ? "#35D07F" : "#E8283F"}`, borderBottom: "1px solid var(--border)" }}>
                        <div>
                          <div className="text-sm font-medium">{b.label}</div>
                          <div className="text-xs mono" style={{ color: "var(--text-muted)" }}>{CATS[b.category].label} · {fmt(b.stake)} · {timeAgo(b.createdAt) || b.date}</div>
                        </div>
                        <div className="text-right">
                          <div className="mono text-sm font-semibold" style={{ color: profit > 0 ? "#35D07F" : profit < 0 ? "#E8283F" : "var(--text-muted)" }}>
                            {profit === 0 ? "—" : `${profit > 0 ? "+" : ""}${fmt(profit)}`}
                          </div>
                          <div className="text-xs mono" style={{ color: "var(--text-muted)" }}>{parseFloat(b.odds || 1).toFixed(2)}x</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Center: kick embed */}
              <div className="btr-card p-0 overflow-hidden" style={{ height: 542, display: "flex", flexDirection: "column" }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <span style={{ color: "#53FC18" }}>KICK</span>
                    <span>{kickChannel}</span>
                  </div>
                  {kickLive ? (
                    <a href={`https://kick.com/${kickChannel}`} target="_blank" rel="noreferrer" className="chip" style={{ background: "#53FC1822", color: "#53FC18" }}>
                      ● EN VIVO
                    </a>
                  ) : (
                    <span className="chip" style={{ background: "var(--panel-2)", color: "var(--text-muted)" }}>OFFLINE</span>
                  )}
                </div>
                {kickLive ? (
                  <div className="flex-1" style={{ background: "#000", position: "relative", overflow: "hidden" }}>
                   <iframe
  src={`https://player.kick.com/${kickChannel}?autoplay=true&muted=true`}
  title={`Stream de ${kickChannel}`}
  allow="autoplay; fullscreen"
  allowFullScreen
  style={{
    width: "100%",
    height: "100%",
    border: "none",
  }}
/>
                  </div>
                ) : (
                  <div className="flex items-center justify-center flex-1" style={{ background: "#000" }}>
                    <div className="text-center">
                      <div className="display text-4xl tracking-widest" style={{ color: "var(--text-muted)" }}>OFFLINE</div>
                      <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{kickChannel} no está transmitiendo ahora</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: big wins */}
              <div className="btr-card p-3" style={{ height: 542, overflowY: "auto" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1"><Trophy size={12} /> Grandes victorias</div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>{bigWins.length} victoria{bigWins.length === 1 ? "" : "s"}</div>
                </div>
                {bigWins.length === 0 ? (
                  <div className="text-center text-xs py-6" style={{ color: "var(--text-muted)" }}>Aún sin grandes victorias.</div>
                ) : bigWins.map((b) => (
                  <div key={b.id} className="py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex justify-between text-sm font-medium"><span>{b.label}</span>
                      <span className="mono" style={{ color: "#35D07F" }}>+{fmt(profitOf(b))}</span>
                    </div>
                    <div className="flex justify-between text-xs mono" style={{ color: "var(--text-muted)" }}>
                      <span>{CATS[b.category].label} · {fmt(b.stake)}</span>
                      <span style={{ color: "var(--accent-2)" }}>{parseFloat(b.odds).toFixed(2)}x</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <SlotPicker />
        )}
      </div>
    </div>
  );
}

const CARD_WIDTH = 150;
const CARD_HEIGHT = 200;
const CARD_GAP = 10;
const STEP = CARD_WIDTH + CARD_GAP;
const LEAD_COUNT = 28; // cuántas tarjetas "de relleno" antes de la ganadora
const TRAIL_COUNT = 6; // relleno después, para que no se vea vacío al frenar
const SPIN_MS = 3600;

function SlotPicker() {
  const [query, setQuery] = useState("");
  const [activeProviders, setActiveProviders] = useState([]);
  const [spinning, setSpinning] = useState(false);
  const [strip, setStrip] = useState([]); // contenido de la tira completa
  const [picked, setPicked] = useState(null); // resultado final confirmado
  const [allGames, setAllGames] = useState([]);
  const [gamesLoaded, setGamesLoaded] = useState(false);
  const stripRef = useRef(null);
  const viewportRef = useRef(null);
  const timeoutsRef = useRef([]);

  useEffect(() => {
    fetch("/api/games")
      .then((r) => r.json())
      .then((data) => {
        setAllGames(Array.isArray(data.games) ? data.games : []);
        setGamesLoaded(true);
      })
      .catch(() => setGamesLoaded(true));
  }, []);

  const providers = useMemo(() => {
    const counts = {};
    allGames.forEach((s) => { counts[s.provider] = (counts[s.provider] || 0) + 1; });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  }, [allGames]);

  const filtered = useMemo(() => {
    return allGames.filter((s) => {
      const matchesQuery = s.name.toLowerCase().includes(query.toLowerCase());
      const matchesProvider = activeProviders.length === 0 || activeProviders.includes(s.provider);
      return matchesQuery && matchesProvider;
    });
  }, [allGames, query, activeProviders]);

  const toggleProvider = (p) => setActiveProviders((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const preloadImages = (games) => {
    games.forEach((g) => {
      if (g?.image) {
        const img = new Image();
        img.src = g.image;
      }
    });
  };

  const clearAllTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  const spin = () => {
    if (filtered.length === 0 || spinning) return;
    clearAllTimeouts();
    setSpinning(true);
    setPicked(null);

    // Elegimos las imágenes de la tira directo de TODO el catálogo
    // filtrado (sin límite artificial), y precargamos justo esas.
    const withImage = filtered.filter((g) => g.image);
    const source = withImage.length ? withImage : filtered;

    const finalPick = source[Math.floor(Math.random() * source.length)];
    const newStrip = [
      ...Array.from({ length: LEAD_COUNT }, () => source[Math.floor(Math.random() * source.length)]),
      finalPick,
      ...Array.from({ length: TRAIL_COUNT }, () => source[Math.floor(Math.random() * source.length)]),
    ];
    preloadImages(newStrip);
    setStrip(newStrip);

    // Esperamos un instante (imágenes precargando + que React pinte la
    // tira nueva) antes de animar el deslizamiento.
    const t1 = setTimeout(() => {
      const el = stripRef.current;
      const viewport = viewportRef.current;
      if (!el || !viewport) return;

      el.style.transition = "none";
      el.style.transform = "translateX(0px)";
      void el.offsetWidth; // forzar reflow para que el reset se aplique antes de animar

      const viewportWidth = viewport.clientWidth;
      const targetOffset = (viewportWidth / 2 - CARD_WIDTH / 2) - LEAD_COUNT * STEP;

      requestAnimationFrame(() => {
        el.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.68, 0.15, 1)`;
        el.style.transform = `translateX(${targetOffset}px)`;
      });
    }, 350);

    const t2 = setTimeout(() => {
      setSpinning(false);
      setPicked(finalPick);
    }, 350 + SPIN_MS + 100);

    timeoutsRef.current.push(t1, t2);
  };

  useEffect(() => () => clearAllTimeouts(), []);

  // Al cargar, mostramos una tira inicial con imágenes al azar (sin ganador
  // marcado) en vez de dejar el espacio vacío hasta el primer "Girar".
  useEffect(() => {
    if (gamesLoaded && filtered.length > 0 && strip.length === 0 && !spinning) {
      const withImage = filtered.filter((g) => g.image);
      const source = withImage.length ? withImage : filtered;
      const initial = Array.from(
        { length: LEAD_COUNT + 1 + TRAIL_COUNT },
        () => source[Math.floor(Math.random() * source.length)]
      );
      setStrip(initial);
    }
  }, [gamesLoaded, filtered, strip.length, spinning]);

  return (
    <div>
      <div className="flex items-end justify-between mb-6" style={{ maxWidth: 1192, margin: "0 auto 24px auto" }}>
        <div>
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Gamdom</div>
          <div className="display text-3xl" style={{ color: "var(--text)" }}>
            SLOT <span className="outline-text" style={{ "--ink": "var(--accent)" }}>PICKER</span>
          </div>
        </div>
        <div className="text-xs text-right" style={{ color: "var(--text-muted)", maxWidth: 320 }}>
          ¿No sabés qué jugar? Filtrá por proveedor y que el azar decida. {gamesLoaded ? allGames.length : "..."} juegos en la baraja.
        </div>
      </div>

      <div className="flex gap-5" style={{ maxWidth: 1192, margin: "0 auto" }}>
        {/* Sidebar: búsqueda + proveedores */}
        <div className="flex-shrink-0" style={{ width: 260 }}>
          <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Proveedores</div>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input className="btr-input w-full" style={{ paddingLeft: 32 }} placeholder="Buscar un juego..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="btr-card" style={{ maxHeight: 380, overflowY: "auto", padding: 6 }}>
            <div
              onClick={() => setActiveProviders([])}
              className="provider-row"
              style={{
                background: activeProviders.length === 0 ? "var(--accent-dim)" : "transparent",
                borderLeftColor: activeProviders.length === 0 ? "var(--accent)" : "transparent",
                color: activeProviders.length === 0 ? "var(--text)" : "var(--text-muted)",
              }}
            >
              <span>Todos</span>
              <span style={{ color: activeProviders.length === 0 ? "var(--accent)" : "var(--text-muted)" }}>{allGames.length}</span>
            </div>
            {providers.map((p) => {
              const count = allGames.filter((s) => s.provider === p).length;
              const active = activeProviders.includes(p);
              return (
                <div
                  key={p}
                  onClick={() => toggleProvider(p)}
                  className="provider-row"
                  style={{
                    background: active ? "var(--accent-dim)" : "transparent",
                    borderLeftColor: active ? "var(--accent)" : "transparent",
                    color: active ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  <span>{p}</span>
                  <span style={{ color: active ? "var(--accent)" : "var(--text-muted)" }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Vitrina + tira */}
        <div className="flex-1 min-w-0">
          <div className="btr-card p-4 relative" style={{ overflow: "hidden" }}>
            <div className="absolute pointer-events-none" style={{ left: "50%", bottom: -30, width: "70%", height: 60, transform: "translateX(-50%)", background: "radial-gradient(ellipse at center, rgba(0,217,255,0.16) 0%, transparent 70%)" }} />
            {!gamesLoaded ? (
              <div className="text-center text-xs py-16" style={{ color: "var(--text-muted)" }}>Cargando catálogo de juegos...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-xs py-16" style={{ color: "var(--text-muted)" }}>Ningún juego coincide con tu búsqueda.</div>
            ) : strip.length === 0 ? (
              <div className="text-center text-xs py-16" style={{ color: "var(--text-muted)" }}>Apretá "Girar" para elegir un juego al azar.</div>
            ) : (
              <div ref={viewportRef} className="relative overflow-hidden" style={{ height: CARD_HEIGHT }}>
                {/* flechita fija, no se mueve — solo la tira de abajo se desliza */}
                <div className="absolute z-10" style={{ top: -2, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "9px solid transparent", borderRight: "9px solid transparent", borderTop: "12px solid var(--accent-2)" }} />
                <div className="absolute z-10" style={{ bottom: -2, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "9px solid transparent", borderRight: "9px solid transparent", borderBottom: "12px solid var(--accent-2)" }} />

                <div ref={stripRef} className="flex absolute top-0 left-0" style={{ gap: CARD_GAP, transform: "translateX(0px)" }}>
                  {strip.map((g, idx) => {
                    const isWinner = idx === LEAD_COUNT;
                    const settled = !spinning && picked;
                    return (
                      <div
                        key={idx}
                        className="rounded-xl overflow-hidden relative flex-shrink-0"
                        style={{
                          width: CARD_WIDTH,
                          height: CARD_HEIGHT,
                          background: "var(--panel-2)",
                          border: settled && isWinner ? "2px solid var(--accent-2)" : "1px solid var(--border)",
                          opacity: settled && !isWinner ? 0.35 : 1,
                          filter: settled && !isWinner ? "grayscale(0.6)" : "none",
                          transition: "opacity 0.4s, filter 0.4s, border-color 0.4s",
                        }}
                      >
                        {g?.image ? (
                          <img
                            key={`${idx}-${g.code || g.name}`}
                            src={g.image}
                            alt={g.name}
                            style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }}
                            onError={(e) => { e.target.style.display = "none"; }}
                          />
                        ) : null}
                        <div className="absolute bottom-0 left-0 right-0 p-2" style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.9), transparent)" }}>
                          <div className="text-xs font-semibold leading-tight">{g?.name}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="text-center mt-6 mb-8">
            <button onClick={spin} disabled={filtered.length === 0 || spinning} className="btn-amber inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold" style={{ background: "var(--accent-2)", color: "#1A1200", opacity: filtered.length === 0 || spinning ? 0.6 : 1 }}>
              <Shuffle size={16} /> {spinning ? "Girando..." : picked ? "Girar de nuevo" : "Girar"}
            </button>
            <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{filtered.length} juegos en juego</div>
          </div>

          {picked && !spinning && (
            <div className="btr-card p-6 flex items-center gap-6">
              <div className="rounded-lg flex-shrink-0 overflow-hidden" style={{ width: 190, height: 190, background: "var(--panel-2)" }}>
                {picked.image ? <img key={picked.code || picked.name} src={picked.image} alt={picked.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Te tocó</div>
                <div className="display text-4xl mb-1">{picked.name}</div>
                <div className="text-sm font-semibold" style={{ color: "var(--accent-2)" }}>{picked.provider}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {gamesLoaded && filtered.length > 0 && (
        <div className="mt-10" style={{ maxWidth: 1192, margin: "40px auto 0 auto" }}>
          <div className="flex items-center justify-between mb-4">
            <div className="display text-2xl">En la baraja</div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{filtered.length} juegos</div>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(159px, 1fr))" }}>
            {filtered.slice(0, 60).map((g, idx) => (
              <div key={`${g.code || g.name}-${idx}`}>
                <div className="rounded-lg overflow-hidden relative slot-card" style={{ width: "100%", aspectRatio: "159 / 211", background: "var(--panel-2)", border: "1px solid var(--border)" }}>
                  {g.image ? (
                    <img
                      src={g.image}
                      alt={g.name}
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }}
                      onError={(e) => { e.target.style.display = "none"; }}
                    />
                  ) : null}
                </div>
                <div className="text-sm font-semibold leading-tight mt-2">{g.name}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>{g.provider}</div>
              </div>
            ))}
          </div>
          {filtered.length > 60 && (
            <div className="text-center text-xs mt-4" style={{ color: "var(--text-muted)" }}>
              Mostrando 60 de {filtered.length} — refiná la búsqueda o el proveedor para ver otros.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
