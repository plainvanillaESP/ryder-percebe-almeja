/* =====================================================================
   Ryder Percebe vs Almeja — lógica de la app
   Vanilla JS · funciona en GitHub Pages · modo local o Firebase.
   ===================================================================== */

const CFG = window.RYDER_CONFIG;
const FB_VER = "12.15.0";
const CUR = CFG.currency || "€";

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const el = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const isAdmin = (u) => (CFG.admins || []).includes(u);
const pname = (u) => CFG.players[u]?.name || u;
const pteam = (u) => CFG.players[u]?.team;
const round1 = (n) => Math.round(n * 10) / 10;
const initialOf = (u) => (pname(u)[0] || "?").toUpperCase();

function money(n, sign = false) {
  const v = Math.round(n * 100) / 100;
  const s = (sign && v > 0 ? "+" : "") + v.toLocaleString("es-ES", { maximumFractionDigits: 2 });
  return s + " " + CUR;
}

async function sha256(txt) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt + "::ryder"));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let toastT;
function toast(msg) {
  let t = el("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------- estado inicial (semilla) ---------- */
function seed() {
  const players = {};
  for (const u in CFG.players) {
    players[u] = { name: CFG.players[u].name, team: CFG.players[u].team, hi: null, passHash: null };
  }
  const matches = CFG.matches.map((m) => ({
    id: m.id, day: m.day, format: m.format, label: m.label,
    a: [...m.a], b: [...m.b],
    result: { outcome: null, score: "", by: "", at: 0 }
  }));
  return {
    meta: { createdAt: Date.now(), updatedAt: Date.now() },
    course: { ...CFG.course },
    allowances: { ...CFG.allowances },
    players, matches, bets: {}
  };
}

/* =====================================================================
   STORE  —  abstracción local / nube
   ===================================================================== */
const Store = (() => {
  let cloud = false, subs = [], live = null;
  let db = null, docRef = null, tx = null;

  const cloudEnabled = () => !!(CFG.firebase && CFG.firebase.apiKey && CFG.firebase.apiKey.length > 8);
  const LKEY = "ryder_state_" + CFG.tournamentId;

  async function init() {
    if (cloudEnabled()) {
      try { await initCloud(); cloud = true; return "cloud"; }
      catch (e) { console.error("Firebase falló, uso local:", e); cloud = false; }
    }
    initLocal(); return "local";
  }

  /* ---- LOCAL ---- */
  function initLocal() {
    const raw = localStorage.getItem(LKEY);
    live = raw ? JSON.parse(raw) : seed();
    if (!raw) localStorage.setItem(LKEY, JSON.stringify(live));
    window.addEventListener("storage", (e) => {
      if (e.key === LKEY && e.newValue) { live = JSON.parse(e.newValue); emit(); }
    });
  }

  /* ---- NUBE (Firestore) ---- */
  async function initCloud() {
    const appMod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
    const fs = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-firestore.js`);
    tx = fs;
    const app = appMod.initializeApp(CFG.firebase);
    db = fs.getFirestore(app);
    docRef = fs.doc(db, "tournaments", CFG.tournamentId);
    const snap = await fs.getDoc(docRef);
    if (!snap.exists()) await fs.setDoc(docRef, seed());
  }

  function subscribe(cb) {
    subs.push(cb);
    if (cloud) {
      const unsub = tx.onSnapshot(docRef, (snap) => { if (snap.exists()) { live = snap.data(); cb(live); } });
      return unsub;
    } else {
      cb(live);
      return () => { subs = subs.filter((s) => s !== cb); };
    }
  }

  function emit() { subs.forEach((cb) => cb(live)); }

  async function mutate(fn) {
    if (cloud) {
      await tx.runTransaction(db, async (t) => {
        const s = await t.get(docRef);
        const data = s.exists() ? s.data() : seed();
        fn(data); data.meta.updatedAt = Date.now();
        t.set(docRef, data);
      });
    } else {
      fn(live); live.meta.updatedAt = Date.now();
      localStorage.setItem(LKEY, JSON.stringify(live));
      emit();
    }
  }

  return { init, subscribe, mutate, get: () => live, isCloud: () => cloud };
})();

/* =====================================================================
   REGLAS DE GOLF  (World Handicap System)
   ===================================================================== */

// Course Handicap = HI × (Slope/113) + (CR − Par)
function courseHcp(hi, course) {
  if (hi === null || hi === undefined || hi === "" || isNaN(hi)) return null;
  let ch = Number(hi) * (course.slope / 113);
  if (course.courseRating != null && course.par != null) ch += (course.courseRating - course.par);
  return Math.round(ch);
}

// Hándicap de juego de un bando según formato
function sideHcp(usernames, S, format) {
  if (!usernames || usernames.length === 0) return null;
  const chs = usernames.map((u) => courseHcp(S.players[u]?.hi, S.course));
  if (chs.some((v) => v === null)) return null;
  if (format === "singles") return chs[0] * (S.allowances.singles ?? 1);
  const low = Math.min(...chs), high = Math.max(...chs);
  return low * (S.allowances.scrambleLow ?? 0.35) + high * (S.allowances.scrambleHigh ?? 0.15);
}

// Ventaja del partido en match-play: el bando más alto recibe la diferencia
function advantage(m, S) {
  const ha = sideHcp(m.a, S, m.format), hb = sideHcp(m.b, S, m.format);
  if (ha === null || hb === null) return null;
  const strokes = Math.round(Math.abs(ha - hb));
  const recv = ha > hb ? "A" : hb > ha ? "B" : null;
  return { ha, hb, strokes, recv };
}

/* =====================================================================
   APUESTAS  (parimutuel: el bote de los perdedores se reparte
   entre los acertantes en proporción a lo apostado)
   ===================================================================== */
function settle(m, S) {
  const b = (S.bets && S.bets[m.id]) || {};
  let potA = 0, potB = 0;
  for (const u in b) (b[u].side === "A" ? (potA += b[u].amount) : (potB += b[u].amount));
  const out = { perUser: {}, potA, potB, pot: potA + potB, resolved: false, refunded: false };
  const oc = m.result?.outcome;
  if (!oc) return out;
  out.resolved = true;
  if (oc === "H") { for (const u in b) out.perUser[u] = 0; out.refunded = true; return out; }
  const winPot = oc === "A" ? potA : potB;
  const losePot = oc === "A" ? potB : potA;
  if (winPot === 0) { for (const u in b) out.perUser[u] = 0; out.refunded = true; return out; }
  for (const u in b) out.perUser[u] = b[u].side === oc ? (b[u].amount / winPot) * losePot : -b[u].amount;
  return out;
}

function overallPnL(S) {
  const pnl = {};
  for (const u in S.players) pnl[u] = 0;
  for (const m of S.matches) {
    const s = settle(m, S);
    for (const u in s.perUser) pnl[u] = (pnl[u] || 0) + s.perUser[u];
  }
  return pnl;
}

/* =====================================================================
   CLASIFICACIÓN RYDER  (bando A = Percebe, bando B = Almeja)
   ===================================================================== */
function standings(S) {
  let p = 0, a = 0, played = 0;
  const total = S.matches.length;
  for (const m of S.matches) {
    const oc = m.result?.outcome;
    if (!oc) continue;
    played++;
    if (oc === "A") p += 1; else if (oc === "B") a += 1; else { p += 0.5; a += 0.5; }
  }
  const toWin = total / 2 + 0.5;
  return { p, a, played, total, toWin };
}

/* =====================================================================
   APP / RENDER
   ===================================================================== */
const app = { route: "board", user: null, openMatch: null, betDraft: {}, ready: false };
let S = null;

const SESSION = "ryder_session_" + CFG.tournamentId;

function boot() {
  Store.init().then((mode) => {
    Store.subscribe((state) => {
      S = state;
      const sess = localStorage.getItem(SESSION);
      if (sess && S.players[sess]) app.user = sess;
      render();
    });
    // etiqueta de modo
    const tag = document.createElement("div");
    tag.className = "mode-tag";
    tag.textContent = mode === "cloud" ? "sincronizado ·  en la nube" : "modo local ·  solo este móvil";
    document.body.appendChild(tag);
    setTimeout(() => { tag.style.transition = "opacity .6s"; tag.style.opacity = "0"; }, 3500);
  });
}

function render() {
  if (!S) return;
  if (!app.user) return renderLogin();
  el("app").hidden = false;
  const login = el("login"); if (login) login.remove();
  el("app").innerHTML = header() + `<main id="root"></main>` + nav();
  el("root").innerHTML = views[app.route] ? views[app.route]() : views.board();
  animateBoard();
}

/* ---------- HEADER ---------- */
function header() {
  return `<header class="hdr">
    <div class="hdr-top">
      <div class="brand"><span class="dot d1"></span><span class="dot d2"></span><span>Ryder Percebe · Almeja</span></div>
      <div class="whoami"><b>${pname(app.user)}</b>${isAdmin(app.user) ? ' <span class="badge-admin">admin</span>' : ""}
        <button class="logout" data-logout>Salir</button></div>
    </div>
    ${scoreboard()}
  </header>`;
}

function scoreboard() {
  const st = standings(S);
  const tot = st.p + st.a;
  const pPct = tot ? (st.p / (st.total)) * 100 : 0;
  const aPct = tot ? (st.a / (st.total)) * 100 : 0;
  const xPct = 100 - pPct - aPct;
  let lead = "En juego";
  if (st.p > st.a) lead = `Percebe manda por ${round1(st.p - st.a)}`;
  else if (st.a > st.p) lead = `Almeja manda por ${round1(st.a - st.p)}`;
  else if (st.played) lead = "Empate técnico";
  const champ = st.p >= st.toWin ? " · ¡Percebe gana la Ryder!" : st.a >= st.toWin ? " · ¡Almeja gana la Ryder!" : "";
  return `<div class="board">
    <div class="board-heads">
      <div class="board-team"><div class="board-name"><span class="chip-team pc"></span>Percebe</div>
        <div class="board-pts pc-txt">${fmtPts(st.p)}</div></div>
      <div class="board-team r"><div class="board-name">Almeja<span class="chip-team al"></span></div>
        <div class="board-pts al-txt">${fmtPts(st.a)}</div></div>
    </div>
    <div class="board-bar">
      <div class="fill-p" data-w="${pPct}"></div>
      <div class="fill-x" style="width:${xPct}%"></div>
      <div class="fill-a" data-w="${aPct}"></div>
    </div>
    <div class="board-foot"><b>${lead}${champ}</b>
      <span class="needle">${st.played}/${st.total} · gana con ${st.toWin}</span></div>
  </div>`;
}
function fmtPts(n) {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (half) return (whole === 0 ? "" : whole) + "½";
  return String(whole);
}
function animateBoard() {
  requestAnimationFrame(() => {
    document.querySelectorAll(".fill-p,.fill-a").forEach((f) => {
      f.style.width = "0%";
      requestAnimationFrame(() => (f.style.width = (f.dataset.w || 0) + "%"));
    });
  });
}

/* ---------- NAV ---------- */
function nav() {
  const items = [
    ["board", "Marcador", `<path d="M6 3h12v4a6 6 0 01-12 0V3z"/><path d="M9 21h6M12 13v8"/><path d="M6 5H3v1a3 3 0 003 3M18 5h3v1a3 3 0 01-3 3"/>`],
    ["matches", "Partidos", `<path d="M5 21V4M5 4l11 2-2 5 2 5-11-2"/>`],
    ["hcp", "Hándicaps", `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>`],
    ["bolsa", "Bolsa", `<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>`]
  ];
  if (isAdmin(app.user)) items.push(["admin", "Admin", `<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>`]);
  return `<nav class="nav">${items.map(([r, l, ic]) =>
    `<button data-nav="${r}" class="${app.route === r ? "on" : ""}"><svg viewBox="0 0 24 24">${ic}</svg>${l}</button>`
  ).join("")}</nav>`;
}

/* ---------- VISTAS ---------- */
const views = {
  board() {
    const pnl = overallPnL(S)[app.user] || 0;
    const cls = pnl > 0 ? "pos-v" : pnl < 0 ? "neg-v" : "zero-v";
    const next = S.matches.filter((m) => !m.result?.outcome);
    return `<div class="view">
      <div class="eyebrow">Tu bolsa</div>
      <div class="card"><div class="match"><div class="match-top">
        <span class="match-label">Vas ${pnl > 0 ? "ganando" : pnl < 0 ? "perdiendo" : "en tablas"}</span>
        <span class="result-pill ${pnl >= 0 ? "win-p" : "win-a"}" style="font-size:14px">${money(pnl, true)}</span>
      </div><div style="font-size:12px;color:var(--ink-soft)">Resultado neto de tus apuestas cerradas.</div></div></div>

      <div class="eyebrow">Próximos partidos</div>
      ${next.length ? next.map((m) => matchCard(m, app.openMatch === m.id)).join("") : `<div class="empty">Todos los partidos cerrados. Ya puedes ver el resultado en la Bolsa.</div>`}
    </div>`;
  },

  matches() {
    const d1 = S.matches.filter((m) => m.day === 1);
    const d2 = S.matches.filter((m) => m.day === 2);
    return `<div class="view">
      <div class="eyebrow">Día 1 · Scramble por parejas</div>
      ${d1.map((m) => matchCard(m, app.openMatch === m.id)).join("")}
      <div class="eyebrow">Día 2 · Individual ${d2.every((m) => !m.a.length) ? "· por definir" : ""}</div>
      ${d2.map((m) => matchCard(m, app.openMatch === m.id)).join("")}
    </div>`;
  },

  hcp() {
    const c = S.course, adm = isAdmin(app.user);
    const rows = Object.keys(CFG.players).map((u) => {
      const p = S.players[u]; const ch = courseHcp(p.hi, c);
      const t = p.team === "percebe" ? "p" : "a";
      const editable = adm || u === app.user;
      return `<div class="hcp-row">
        <div class="av ${t}">${initialOf(u)}</div>
        <div class="nm"><b>${pname(u)}</b><small>${p.team === "percebe" ? "Percebe" : "Almeja"}</small></div>
        <input type="number" step="0.1" inputmode="decimal" placeholder="HCP"
          value="${p.hi ?? ""}" ${editable ? "" : "disabled"} data-hi="${u}">
        <div class="ch">Course<b>${ch === null ? "—" : ch}</b></div>
      </div>`;
    }).join("");
    return `<div class="view">
      <div class="eyebrow">El campo</div>
      <div class="card"><div class="match">
        <div class="grid3">
          <div class="field"><label>Slope</label><input type="number" data-course="slope" value="${c.slope}" ${adm ? "" : "disabled"}></div>
          <div class="field"><label>C. Rating</label><input type="number" step="0.1" data-course="courseRating" value="${c.courseRating}" ${adm ? "" : "disabled"}></div>
          <div class="field"><label>Par</label><input type="number" data-course="par" value="${c.par}" ${adm ? "" : "disabled"}></div>
        </div>
        <div style="font-size:11px;color:var(--ink-soft)">${adm ? "Editas el campo como admin." : "Solo el admin edita el campo."}</div>
      </div></div>

      <div class="eyebrow">Hándicap índice de cada uno</div>
      <div class="hcp-list">${rows}</div>

      <div class="eyebrow">Cómo se calcula</div>
      <div class="explainer">
        <b>Course Handicap</b> = <code>HI × (Slope ÷ 113) + (CR − Par)</code>, redondeado.<br><br>
        <b>Scramble 2 jugadores:</b> el bando juega con <code>${pct(S.allowances.scrambleLow)}·bajo + ${pct(S.allowances.scrambleHigh)}·alto</code>.<br>
        <b>Individual:</b> <code>${pct(S.allowances.singles)}</code> del course handicap.<br><br>
        En match-play el bando más bajo juega a scratch y el otro recibe la diferencia de golpes.
      </div>
    </div>`;
  },

  bolsa() {
    const pnl = overallPnL(S);
    const rows = Object.keys(CFG.players)
      .map((u) => ({ u, v: pnl[u] || 0 }))
      .sort((x, y) => y.v - x.v)
      .map((r, i) => {
        const t = pteam(r.u) === "percebe" ? "p" : "a";
        const cls = r.v > 0 ? "pos-v" : r.v < 0 ? "neg-v" : "zero-v";
        return `<div class="lb-row ${r.u === app.user ? "me" : ""}"><span class="pos">${i + 1}</span>
          <div class="av ${t}">${initialOf(r.u)}</div>
          <span class="nm">${pname(r.u)}</span>
          <span class="pnl ${cls}">${money(r.v, true)}</span></div>`;
      }).join("");
    let wagered = 0, open = 0;
    for (const m of S.matches) { const s = settle(m, S); wagered += s.pot; if (!s.resolved) open += s.pot; }
    return `<div class="view">
      <div class="summary">
        <div class="stat"><div class="k">Apostado</div><div class="v">${money(wagered)}</div></div>
        <div class="stat"><div class="k">En juego</div><div class="v">${money(open)}</div></div>
      </div>
      <div class="eyebrow">Clasificación de la bolsa</div>
      <div class="lb">${rows}</div>
      <div class="eyebrow">Detalle por partido</div>
      ${S.matches.map((m) => betBreakdown(m)).join("")}
    </div>`;
  },

  admin() {
    if (!isAdmin(app.user)) return `<div class="view"><div class="empty">Solo para admins.</div></div>`;
    const d2 = S.matches.filter((m) => m.day === 2);
    const percebes = CFG.teams.percebe.players, almejas = CFG.teams.almeja.players;
    const opt = (list, sel) => `<option value="">—</option>` + list.map((u) => `<option value="${u}" ${sel === u ? "selected" : ""}>${pname(u)}</option>`).join("");
    return `<div class="view">
      <div class="eyebrow">Definir Día 2 · individuales</div>
      <div class="card"><div class="match">
        ${d2.map((m) => `<div class="admin-block">
          <div style="font-size:12px;color:var(--ink-soft);margin-bottom:6px;font-weight:700">${m.label}</div>
          <div class="singles-edit">
            <select data-singles="${m.id}" data-slot="a">${opt(percebes, m.a[0])}</select>
            <span class="x">vs</span>
            <select data-singles="${m.id}" data-slot="b">${opt(almejas, m.b[0])}</select>
          </div>
        </div>`).join("")}
        <div style="font-size:11px;color:var(--ink-soft)">Percebe a la izquierda, Almeja a la derecha.</div>
      </div></div>

      <div class="eyebrow">Porcentajes de juego</div>
      <div class="card"><div class="match"><div class="grid3">
        <div class="field"><label>Scr. bajo %</label><input type="number" data-allow="scrambleLow" value="${Math.round(S.allowances.scrambleLow * 100)}"></div>
        <div class="field"><label>Scr. alto %</label><input type="number" data-allow="scrambleHigh" value="${Math.round(S.allowances.scrambleHigh * 100)}"></div>
        <div class="field"><label>Individual %</label><input type="number" data-allow="singles" value="${Math.round(S.allowances.singles * 100)}"></div>
      </div></div></div>

      <div class="eyebrow">Zona peligrosa</div>
      <button class="btn danger" data-reset>Reiniciar torneo (borra apuestas y resultados)</button>
    </div>`;
  }
};

const pct = (x) => Math.round(x * 100) + "%";

/* ---------- tarjeta de partido ---------- */
function matchCard(m, open) {
  const adv = advantage(m, S);
  const res = m.result?.outcome;
  const pill = res === "A" ? `<span class="result-pill win-p">Gana Percebe</span>`
    : res === "B" ? `<span class="result-pill win-a">Gana Almeja</span>`
      : res === "H" ? `<span class="result-pill halved">Empate</span>`
        : `<span class="result-pill pending">Sin cerrar</span>`;
  const scoreTxt = m.result?.score ? ` · ${m.result.score}` : "";
  const aNames = m.a.length ? m.a.map(pname).join(" · ") : "Por asignar";
  const bNames = m.b.length ? m.b.map(pname).join(" · ") : "Por asignar";
  const hcpTxt = adv
    ? `<span class="side-hcp">Juego ${round1(adv.ha)}</span>`
    : `<span class="side-hcp">—</span>`;
  const hcpTxtB = adv ? `<span class="side-hcp">Juego ${round1(adv.hb)}</span>` : `<span class="side-hcp">—</span>`;

  return `<div class="card"><div class="match">
    <div class="match-top"><span class="match-label">${m.label}</span><span class="match-day">Día ${m.day}</span></div>
    <div class="sides">
      <div class="side"><span class="side-team tp">Percebe</span><span class="side-players">${aNames}</span>${hcpTxt}</div>
      <span class="vs">VS</span>
      <div class="side r"><span class="side-team ta">Almeja</span><span class="side-players">${bNames}</span>${hcpTxtB}</div>
    </div>
    <div class="match-foot">
      <span>${pill}${scoreTxt}</span>
      ${m.a.length && m.b.length ? `<span class="tap" data-toggle-match="${m.id}">${open ? "Cerrar ▲" : "Apostar ▾"}</span>` : `<span style="color:var(--ink-soft);font-size:11px">Pendiente de definir</span>`}
    </div>
    ${open ? matchDetail(m, adv) : ""}
  </div>`;
}

/* ---------- detalle: hándicap + apuesta + resultado ---------- */
function matchDetail(m, adv) {
  let hcpBox = "";
  if (adv) {
    const recvTxt = adv.strokes === 0 ? "Match igualado, sin golpes de ventaja."
      : `Recibe <b>${adv.strokes}</b> golpe${adv.strokes > 1 ? "s" : ""} el equipo <b>${adv.recv === "A" ? "Percebe" : "Almeja"}</b>.`;
    hcpBox = `<div class="detail-hcp">
      <div class="row"><span>Hándicap de juego Percebe</span><span class="adv">${round1(adv.ha)}</span></div>
      <div class="row"><span>Hándicap de juego Almeja</span><span class="adv">${round1(adv.hb)}</span></div>
      <div class="row"><span>Ventaja</span><span class="adv">${adv.strokes} golpe${adv.strokes === 1 ? "" : "s"}</span></div>
      <div class="note">${recvTxt} ${m.format === "scramble" ? "(Scramble 2 jug.)" : "(Individual)"}</div>
    </div>`;
  } else {
    hcpBox = `<div class="detail-hcp"><div class="note">Falta el hándicap índice de algún jugador. Complétalo en la pestaña Hándicaps para ver la ventaja.</div></div>`;
  }

  const s = settle(m, S);
  const myBet = (S.bets[m.id] || {})[app.user];
  const draftSide = app.betDraft[m.id]?.side || myBet?.side || null;
  const resolved = !!m.result?.outcome;

  let betBox = "";
  if (!resolved) {
    betBox = `<div class="bet"><h4>Tu apuesta ${myBet ? `(actual: ${money(myBet.amount)} a ${myBet.side === "A" ? "Percebe" : "Almeja"})` : ""}</h4>
      <div class="pick">
        <button data-bet-side="A" data-match="${m.id}" class="${draftSide === "A" ? "sel-p" : ""}">Percebe<span class="sub">bote ${money(s.potA)}</span></button>
        <button data-bet-side="B" data-match="${m.id}" class="${draftSide === "B" ? "sel-a" : ""}">Almeja<span class="sub">bote ${money(s.potB)}</span></button>
      </div>
      <div class="chips">${[5, 10, 20, 50].map((v) => `<button data-chip="${v}" data-match="${m.id}">${v}${CUR}</button>`).join("")}</div>
      <div class="bet-row">
        <input type="number" inputmode="decimal" min="1" placeholder="Importe" id="amt-${m.id}" value="${myBet?.amount ?? ""}">
        <button class="btn sm ${draftSide === "B" ? "a" : "p"}" style="width:auto;padding:11px 16px" data-place-bet="${m.id}">${myBet ? "Actualizar" : "Apostar"}</button>
      </div>
      ${betList(m, s)}
    </div>`;
  } else {
    betBox = `<div class="bet"><h4>Resultado del reparto</h4>${betList(m, s, true)}</div>`;
  }

  let resBox = "";
  if (isAdmin(app.user)) {
    const oc = m.result?.outcome;
    resBox = `<div class="res-entry"><h4 style="font-family:var(--font-display);font-size:13px;color:#eaf2f4;margin-bottom:8px">Meter resultado (admin)</h4>
      <div class="res-btns">
        <button data-result="A" data-match="${m.id}" class="${oc === "A" ? "on-p" : ""}">Gana Percebe</button>
        <button data-result="H" data-match="${m.id}" class="${oc === "H" ? "on-x" : ""}">Empate</button>
        <button data-result="B" data-match="${m.id}" class="${oc === "B" ? "on-a" : ""}">Gana Almeja</button>
      </div>
      <div class="bet-row"><input type="text" placeholder='Marcador (ej. "3&2")' id="score-${m.id}" value="${m.result?.score || ""}">
        <button class="btn sm ghost" style="width:auto;padding:11px 16px" data-save-score="${m.id}">Guardar</button></div>
    </div>`;
  }

  return hcpBox + betBox + resBox;
}

function betList(m, s, showResult = false) {
  const b = S.bets[m.id] || {};
  const users = Object.keys(b);
  if (!users.length) return `<div class="pot">Aún no hay apuestas en este partido.</div>`;
  const lines = users.map((u) => {
    const bet = b[u];
    const sideCls = bet.side === "A" ? "s-p" : "s-a";
    const sideTxt = bet.side === "A" ? "Percebe" : "Almeja";
    let right = `<span class="amt">${money(bet.amount)}</span>`;
    if (showResult) {
      const net = s.perUser[u] || 0;
      const cls = net > 0 ? "pos-v" : net < 0 ? "neg-v" : "zero-v";
      right = `<span class="amt ${cls}">${money(net, true)}</span>`;
    }
    return `<div class="pot-line"><span><b class="${sideCls}">${pname(u)}</b> · ${sideTxt}</span>${right}</div>`;
  }).join("");
  return `<div class="pot">Bote total: <b>${money(s.pot)}</b><div class="pot-list">${lines}</div></div>`;
}

function betBreakdown(m) {
  const s = settle(m, S);
  const oc = m.result?.outcome;
  const status = !oc ? "Sin cerrar" : oc === "A" ? "Ganó Percebe" : oc === "B" ? "Ganó Almeja" : "Empate";
  return `<div class="card"><div class="match">
    <div class="match-top"><span class="match-label" style="font-size:13px">${m.label}</span>
      <span style="font-family:var(--font-mono);font-size:11px;color:var(--ink-soft)">${status} · ${money(s.pot)}</span></div>
    ${betList(m, s, !!oc).replace('class="pot"', 'class="pot" style="color:var(--ink-soft)"')}
  </div>`;
}

/* =====================================================================
   LOGIN
   ===================================================================== */
function renderLogin() {
  el("app").hidden = true;
  let box = el("login");
  if (!box) { box = document.createElement("div"); box.id = "login"; box.className = "login"; document.body.appendChild(box); }
  const sel = app._loginPick;
  const teams = [["percebe", "Percebe", "p", "pc"], ["almeja", "Almeja", "a", "al"]];
  const grid = teams.map(([tk, tn, tc, dc]) => {
    const names = CFG.teams[tk].players.map((u) => {
      const claimed = S.players[u]?.passHash;
      const on = sel === u ? `sel ${tc}` : "";
      return `<button class="name-chip ${on}" data-pick-name="${u}">
        <span class="av ${tc}">${initialOf(u)}</span>${pname(u)}
        <span class="lock">${claimed ? "🔒" : "＋"}</span></button>`;
    }).join("");
    return `<div class="pick-team"><h3><span class="chip-team ${dc}"></span>${tn}</h3><div class="names">${names}</div></div>`;
  }).join("");

  let panel = "";
  if (sel) {
    const claimed = S.players[sel]?.passHash;
    panel = `<div class="pw-panel">
      <p class="hint">${claimed ? `Hola ${pname(sel)}, escribe tu contraseña.` : `Primera vez, ${pname(sel)}. Crea tu contraseña.`}</p>
      <div class="field"><input type="password" id="pw1" placeholder="Contraseña" autocomplete="off"></div>
      ${claimed ? "" : `<div class="field"><input type="password" id="pw2" placeholder="Repite la contraseña" autocomplete="off"></div>`}
      <button class="btn ${pteam(sel) === "percebe" ? "p" : "a"}" data-do-login="${sel}">${claimed ? "Entrar" : "Crear y entrar"}</button>
      <div class="err" id="loginErr"></div>
    </div>`;
  }

  box.innerHTML = `<div class="login-hero">
      <div class="kick">La apuesta del año</div>
      <h1><span class="pc-txt">Percebe</span><span class="vs">contra</span><span class="al-txt">Almeja</span></h1>
      <p>Elige tu nombre para entrar</p>
    </div>${grid}${panel}`;
}

/* =====================================================================
   EVENTOS
   ===================================================================== */
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-nav],[data-logout],[data-pick-name],[data-do-login],[data-toggle-match],[data-bet-side],[data-chip],[data-place-bet],[data-result],[data-save-score],[data-reset]");
  if (!t) return;

  if (t.dataset.nav) { app.route = t.dataset.nav; render(); return; }
  if (t.hasAttribute("data-logout")) { localStorage.removeItem(SESSION); app.user = null; renderLogin(); return; }

  if (t.dataset.pickName) { app._loginPick = t.dataset.pickName; renderLogin(); return; }

  if (t.dataset.doLogin) {
    const u = t.dataset.doLogin;
    const pw1 = el("pw1")?.value || "";
    const errEl = el("loginErr");
    const claimed = S.players[u]?.passHash;
    if (pw1.length < 3) { errEl.textContent = "Mínimo 3 caracteres."; return; }
    if (!claimed) {
      const pw2 = el("pw2")?.value || "";
      if (pw1 !== pw2) { errEl.textContent = "Las contraseñas no coinciden."; return; }
      const h = await sha256(pw1);
      await Store.mutate((s) => { s.players[u].passHash = h; });
      finishLogin(u); return;
    } else {
      const h = await sha256(pw1);
      if (h === S.players[u].passHash) finishLogin(u);
      else errEl.textContent = "Contraseña incorrecta.";
      return;
    }
  }

  if (t.dataset.toggleMatch) {
    app.openMatch = app.openMatch === t.dataset.toggleMatch ? null : t.dataset.toggleMatch;
    render(); return;
  }

  if (t.dataset.betSide) {
    const id = t.dataset.match;
    app.betDraft[id] = app.betDraft[id] || {};
    app.betDraft[id].side = t.dataset.betSide;
    const card = t.closest(".match");
    card.querySelectorAll("[data-bet-side]").forEach((b) => { b.classList.remove("sel-p", "sel-a"); });
    t.classList.add(t.dataset.betSide === "A" ? "sel-p" : "sel-a");
    const place = card.querySelector("[data-place-bet]");
    if (place) { place.classList.remove("p", "a"); place.classList.add(t.dataset.betSide === "B" ? "a" : "p"); }
    return;
  }

  if (t.dataset.chip) {
    const inp = el("amt-" + t.dataset.match);
    if (inp) inp.value = t.dataset.chip;
    t.closest(".chips").querySelectorAll("button").forEach((b) => b.classList.remove("on"));
    t.classList.add("on");
    return;
  }

  if (t.dataset.placeBet) {
    const id = t.dataset.placeBet;
    const side = app.betDraft[id]?.side || (S.bets[id]?.[app.user]?.side);
    const amount = Number(el("amt-" + id)?.value);
    if (!side) { toast("Elige Percebe o Almeja"); return; }
    if (!amount || amount <= 0) { toast("Pon un importe válido"); return; }
    await Store.mutate((s) => {
      s.bets[id] = s.bets[id] || {};
      s.bets[id][app.user] = { side, amount, at: Date.now() };
    });
    toast(`Apostado ${money(amount)} a ${side === "A" ? "Percebe" : "Almeja"}`);
    return;
  }

  if (t.dataset.result) {
    const id = t.dataset.match, oc = t.dataset.result;
    await Store.mutate((s) => {
      const m = s.matches.find((x) => x.id === id);
      m.result.outcome = m.result.outcome === oc ? null : oc;
      m.result.by = app.user; m.result.at = Date.now();
    });
    toast("Resultado guardado");
    return;
  }

  if (t.dataset.saveScore) {
    const id = t.dataset.saveScore;
    const sc = el("score-" + id)?.value || "";
    await Store.mutate((s) => { s.matches.find((x) => x.id === id).result.score = sc; });
    toast("Marcador guardado");
    return;
  }

  if (t.hasAttribute("data-reset")) {
    if (confirm("¿Seguro? Se borran apuestas, resultados y hándicaps. Los usuarios y contraseñas se mantienen.")) {
      await Store.mutate((s) => {
        const fresh = seed();
        s.course = fresh.course; s.allowances = fresh.allowances; s.bets = {};
        s.matches = fresh.matches;
        for (const u in s.players) s.players[u].hi = null;
      });
      toast("Torneo reiniciado");
    }
    return;
  }
});

/* inputs (hándicaps, campo, allowances, individuales del admin) */
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.hi !== undefined && t.dataset.hi) {
    const u = t.dataset.hi;
    if (!(isAdmin(app.user) || u === app.user)) return;
    const v = t.value === "" ? null : Number(t.value);
    await Store.mutate((s) => { s.players[u].hi = v; });
    return;
  }
  if (t.dataset.course) {
    if (!isAdmin(app.user)) return;
    await Store.mutate((s) => { s.course[t.dataset.course] = Number(t.value); });
    return;
  }
  if (t.dataset.allow) {
    if (!isAdmin(app.user)) return;
    await Store.mutate((s) => { s.allowances[t.dataset.allow] = Number(t.value) / 100; });
    return;
  }
  if (t.dataset.singles) {
    if (!isAdmin(app.user)) return;
    const id = t.dataset.singles, slot = t.dataset.slot, u = t.value;
    await Store.mutate((s) => {
      const m = s.matches.find((x) => x.id === id);
      m[slot] = u ? [u] : [];
    });
    return;
  }
});

function finishLogin(u) {
  localStorage.setItem(SESSION, u);
  app.user = u; app._loginPick = null;
  const login = el("login"); if (login) login.remove();
  render();
}

/* ---------- arranque ---------- */
boot();
