/*
 * Cookie Rejecter – bakgrunnsscript
 * Holder styr på hva som er avvist (per fane og totalt) og oppdaterer merket på verktøylinjeknappen.
 */
const api = globalThis.browser ?? globalThis.chrome;

const HISTORY_LIMIT = 25;
const SECONDS_SAVED_PER_BANNER = 4; // anslag: lese banneret + finne riktig knapp
const SECONDS_SAVED_PER_CLICK = 2;

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};

// Alle skrivinger går i kø så parallelle meldinger fra flere iframes ikke overskriver hverandre
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

async function getAll() {
  const d = await api.storage.local.get(["stats", "history", "tabs"]);
  return {
    stats: d.stats || { banners: 0, clicks: 0, seconds: 0, sites: {} },
    history: d.history || [],
    tabs: d.tabs || {},
  };
}

async function recordRejection(msg, sender) {
  const tabId = sender.tab?.id;
  const host = hostOf(sender.tab?.url) || msg.host || hostOf(sender.url);
  if (!host) return;
  const { stats, history, tabs } = await getAll();
  const now = Date.now();
  const key = String(tabId ?? "none");
  const existing = tabs[key];
  const samePage = existing && existing.host === host;

  const clicks = Math.max(1, msg.clicks || 1);
  stats.clicks += clicks;
  stats.seconds += clicks * SECONDS_SAVED_PER_CLICK;

  if (!samePage) {
    stats.banners += 1;
    stats.seconds += SECONDS_SAVED_PER_BANNER;
    const site = stats.sites[host] || { count: 0 };
    stats.sites[host] = { count: site.count + 1, last: now, cmp: msg.cmp };
    history.unshift({ host, cmp: msg.cmp, method: msg.method, time: now });
    history.splice(HISTORY_LIMIT);
  }

  if (tabId != null) {
    tabs[key] = {
      host,
      cmp: samePage ? existing.cmp : msg.cmp,
      method: msg.method,
      clicks: (samePage ? existing.clicks : 0) + clicks,
      time: now,
    };
  }

  await api.storage.local.set({ stats, history, tabs });

  if (tabId != null) {
    try {
      await api.action.setBadgeBackgroundColor({ tabId, color: "#1f9d55" });
      await api.action.setBadgeText({ tabId, text: "✓" });
    } catch {}
  }
}

async function clearTab(tabId) {
  const { tabs } = await getAll();
  if (tabs[String(tabId)]) {
    delete tabs[String(tabId)];
    await api.storage.local.set({ tabs });
  }
  try { await api.action.setBadgeText({ tabId, text: "" }); } catch {}
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "rejected") {
    serial(() => recordRejection(msg, sender)).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  return false;
});

// Ny side i fanen → nullstill status for fanen
api.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") serial(() => clearTab(tabId));
});
api.tabs.onRemoved.addListener((tabId) => serial(() => clearTab(tabId)));

api.runtime.onInstalled.addListener(async () => {
  const d = await api.storage.local.get(["enabled", "disabledSites"]);
  const init = {};
  if (d.enabled === undefined) init.enabled = true;
  if (!Array.isArray(d.disabledSites)) init.disabledSites = [];
  if (Object.keys(init).length) await api.storage.local.set(init);
});
