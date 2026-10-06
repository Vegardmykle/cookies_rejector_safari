const api = globalThis.browser ?? globalThis.chrome;

const $ = (id) => document.getElementById(id);
const hostOf = (url) => {
    try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) return "";
        return u.hostname.replace(/^www\./, "").toLowerCase();
    } catch { return ""; }
};

let tab = null;
let host = "";
let needsReload = false;

function ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return "nå nettopp";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min siden`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} t siden`;
    const d = Math.round(h / 24);
    if (d < 7) return `${d} d siden`;
    return new Date(ts).toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
}

function formatTime(sec) {
    if (sec < 60) return `${sec} s`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return `${h} t ${m % 60} min`;
}

const fmt = (n) => new Intl.NumberFormat("nb-NO").format(n);

async function render() {
    const d = await api.storage.local.get(["enabled", "disabledSites", "stats", "history", "tabs"]);
    const globalOn = d.enabled !== false;
    const disabled = d.disabledSites || [];
    const stats = d.stats || { banners: 0, clicks: 0, seconds: 0, sites: {} };
    const history = d.history || [];
    const tabState = tab ? (d.tabs || {})[String(tab.id)] : null;
    const siteOn = !disabled.includes(host);

    document.body.classList.toggle("global-off", !globalOn);
    $("global-toggle").checked = globalOn;

    const card = $("site-card");
    $("site-host").textContent = host || (tab?.url ? new URL(tab.url).protocol.replace(":", "") : "—");
    $("site-name").textContent = host || "denne siden";
    $("site-toggle").checked = siteOn;
    $("site-toggle").disabled = !globalOn || !host;

    let state, title, detail;
    const past = host && stats.sites?.[host];
    if (!host) {
        state = "unsupported"; title = "Ikke tilgjengelig her";
        detail = "Cookie Rejecter virker bare på vanlige nettsider.";
    } else if (!globalOn) {
        state = "off"; title = "Slått av";
        detail = "Slå på bryteren øverst for å avvise cookies igjen.";
    } else if (!siteOn) {
        state = "paused"; title = "Pauset på denne siden";
        detail = "Cookie-bannere vises som vanlig her.";
    } else if (tabState && tabState.host === host) {
        state = "rejected"; title = "Cookies avvist";
        const clicks = tabState.clicks === 1 ? "1 klikk" : `${tabState.clicks} klikk`;
        detail = `${tabState.cmp} · ${clicks} · ${ago(tabState.time)}`;
    } else if (past) {
        state = "previous"; title = "Avvist tidligere";
        detail = `Siden husker valget ditt (${past.cmp}, ${ago(past.last)}).`;
    } else {
        state = "watching"; title = "Ingen cookie-banner funnet";
        detail = "Følger med mens siden lastes.";
    }
    card.dataset.state = state;
    $("status-title").textContent = title;
    $("status-detail").textContent = detail;

    $("rerun").hidden = !(globalOn && siteOn && host) || needsReload;
    $("reload").hidden = !needsReload;
    $("actions").hidden = $("rerun").hidden && $("reload").hidden;

    $("stat-banners").textContent = fmt(stats.banners || 0);
    $("stat-clicks").textContent = fmt(stats.clicks || 0);
    $("stat-time").textContent = formatTime(stats.seconds || 0);

    const list = $("recent");
    list.replaceChildren(
        ...history.slice(0, 4).map((h) => {
            const li = document.createElement("li");
            const dot = document.createElement("span"); dot.className = "dot";
            const box = document.createElement("div"); box.className = "h";
            const b = document.createElement("b"); b.textContent = h.host;
            const sub = document.createElement("span");
            sub.textContent = h.method === "settings" ? `${h.cmp} · via innstillinger` : h.cmp;
            box.append(b, sub);
            const t = document.createElement("time"); t.textContent = ago(h.time);
            li.append(dot, box, t);
            return li;
        })
    );
    $("recent-empty").hidden = history.length > 0;
}

async function init() {
    try {
        [tab] = await api.tabs.query({ active: true, currentWindow: true });
    } catch {}
    host = hostOf(tab?.url || "");

    $("global-toggle").addEventListener("change", async (e) => {
        await api.storage.local.set({ enabled: e.target.checked });
        if (e.target.checked && host) needsReload = true;
    });

    $("site-toggle").addEventListener("change", async (e) => {
        const { disabledSites = [] } = await api.storage.local.get("disabledSites");
        const set = new Set(disabledSites);
        if (e.target.checked) set.delete(host); else set.add(host);
        needsReload = true;
        await api.storage.local.set({ disabledSites: [...set] });
    });

    $("rerun").addEventListener("click", async () => {
        const btn = $("rerun");
        btn.disabled = true;
        btn.textContent = "Leter …";
        try { await api.tabs.sendMessage(tab.id, { type: "rerun" }); } catch {}
        setTimeout(() => { btn.disabled = false; btn.textContent = "Avvis nå"; render(); }, 2500);
    });

    $("reload").addEventListener("click", async () => {
        try { await api.tabs.reload(tab.id); } catch {}
        window.close();
    });

    $("reset").addEventListener("click", async () => {
        await api.storage.local.set({ stats: { banners: 0, clicks: 0, seconds: 0, sites: {} }, history: [] });
    });

    api.storage.onChanged.addListener((_c, area) => { if (area === "local") render(); });
    render();
}

init();
