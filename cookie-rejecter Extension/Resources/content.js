/*
 * Cookie Rejecter – content script
 *
 * Finner cookie-bannere og avviser alle cookies som ikke er strengt nødvendige.
 * Rekkefølge:
 *   1. Kjente consent-plattformer (CMP-er) med egne selektorer
 *   2. Generisk heuristikk: knapper som "Avvis alle", "Kun nødvendige", "Reject all" …
 *      – men bare inne i noe som faktisk ser ut som et cookie-banner
 *   3. To-trinns: åpne "Innstillinger", skru av alle valgfrie brytere og lagre
 *
 * Utvidelsen trykker aldri på "Godta alle".
 */
(() => {
  "use strict";
  if (window.__cookieRejecterLoaded) return;
  window.__cookieRejecterLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const IS_TOP = window === window.top;
  const ACTIVE_WINDOW_MS = 45000; // hvor lenge vi leter etter bannere etter sidelast
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log("[CookieRejecter]", ...a);

  /* ------------------------------------------------------------------ *
   * Tekstmønstre (normalisert: små bokstaver, uten tegnsetting)
   * ------------------------------------------------------------------ */
  const REJECT_TEXT = [
    // engelsk
    /^(reject|decline|deny|refuse|disagree)( to)?( all| everything)?( cookies| optional cookies| non essential cookies| additional cookies| non necessary cookies)?( and close| and continue)?$/,
    /^(i )?(do not|dont) (accept|agree|consent)$/,
    /^(use |allow |accept |continue with )?(only )?(strictly )?(necessary|essential|required) (cookies )?only$/,
    /^(use|allow|accept|continue with|save) (only )?(the )?(strictly )?(necessary|essential|required)( cookies)?$/,
    /^only (strictly )?(necessary|essential|required)( cookies)?$/,
    /^(continue|proceed) without (accepting|agreeing|consent|consenting)$/,
    /^no thanks?$/,
    // norsk
    /^(avvis|avslå|avvise|avslå|nekt|nekte)( alle| alt)?( cookies| informasjonskapsler| valgfrie| valgfrie cookies| valgfrie informasjonskapsler| ikke nødvendige| ikke nødvendige cookies| ikke nødvendige informasjonskapsler)?( og lukk| og fortsett)?$/,
    /^(godta|aksepter|tillat|bruk|fortsett med|lagre)( kun| bare)? (de )?(strengt )?(nødvendige|essensielle|påkrevde)( informasjonskapsler| cookies)?$/,
    /^(kun|bare) (de )?(strengt )?(nødvendige|nødvendig|essensielle|påkrevde)( informasjonskapsler| cookies)?$/,
    /^(jeg )?(godtar|aksepterer|samtykker) ikke$/,
    /^ikke (godta|aksepter|samtykk)$/,
    /^nei takk$/,
    /^fortsett uten (å )?(godta|akseptere|samtykke|samtykk)$/,
    // svensk / dansk
    /^(avvisa|neka|avböj|afvis|afvise|afslå)( alla| alle| alt| allt)?( cookies)?$/,
    /^(endast|bara|kun|tillåt endast|acceptera endast|accepter kun|tillad kun|tillad kun nødvendige)( nödvändiga| nødvendige)?( cookies)?$/,
    /^(endast|bara|kun) (nödvändiga|nødvendige)( cookies)?$/,
    // tysk
    /^(alle |alles )?ablehnen$/,
    /^(nur )?(notwendige|essenzielle|erforderliche|technisch notwendige)( cookies)?( akzeptieren| erlauben| zulassen| verwenden)?$/,
    // fransk, spansk, italiensk, nederlandsk
    /^(tout )?refuser( tout| tous les cookies)?$/,
    /^continuer sans accepter$/,
    /^rechazar( todo| todas| todas las cookies)?$/,
    /^rifiuta( tutto| tutti)?$/,
    /^(alles |alle cookies )?weigeren$/,
    /^alleen (noodzakelijke|functionele|essentiële)( cookies)?$/,
  ];

  const SETTINGS_TEXT = [
    /^(cookie |privacy |consent )?(settings|preferences|options)$/,
    /^(manage|customi[sz]e|configure|adjust|change|set)( my| your)?( cookie| privacy| consent)?( settings| preferences| choices| options| cookies)?$/,
    /^(more options|other options|see options|show purposes|let me choose|show details|details)$/,
    /^(innstillinger|cookie innstillinger|cookieinnstillinger|personverninnstillinger|innstillinger for informasjonskapsler|tilpass|tilpass valg|tilpass innstillinger|administrer( valg| innstillinger| informasjonskapsler| cookies| samtykke)?|velg selv|flere valg|endre (innstillinger|valg)|vis (detaljer|formål|valg)|detaljer|les mer og tilpass|jeg vil velge selv)$/,
    /^(inställningar|anpassa|hantera( inställningar)?|indstillinger|tilpas|tilpas valg)$/,
    /^(einstellungen|anpassen|mehr optionen|optionen verwalten|individuelle einstellungen)$/,
    /^(paramètres|personnaliser|gérer (les options|mes préférences)|configurar|gestionar|personalizza|instellingen|aanpassen)$/,
  ];

  const SAVE_TEXT = [
    /^(save|confirm|submit)( my| your)?( choices| choice| selection| settings| preferences| and (exit|close|continue))?$/,
    /^(allow|accept) (selected|selection|current selection)( cookies)?$/,
    /^(lagre|bekreft)( mine| dine)?( valg| valgene| innstillinger| og lukk| og avslutt| og fortsett)?$/,
    /^(tillat|godta|aksepter) (valgte|utvalgte|utvalg|valg)( cookies| informasjonskapsler)?$/,
    /^(spara|bekräfta|gem|bekræft)( val| valg| inställningar| indstillinger| mina val| mine valg)?$/,
    /^(auswahl )?(speichern|bestätigen)$/, /^auswahl (erlauben|akzeptieren)$/,
    /^(enregistrer|confirmer|valider)( mes choix| les choix)?$/,
    /^(guardar|salva|opslaan)( y salir| e esci| configuración| preferenze)?$/,
  ];

  // Ord som tyder på at en container handler om cookies/samtykke
  const COOKIE_WORDS = /cookie|informasjonskaps|samtykke|consent|gdpr|personvern|kakor|datenschutz|privacy|tracking|sporing|tcf|iab/i;
  // id/class som ofte brukes på cookie-bannere
  const CONSENT_ATTR = /cookie|consent|gdpr|cmp|privacy|samtykke|personvern|banner|notice|disclaimer/i;
  // Brytere vi lar være (de er som regel låst uansett)
  const NECESSARY_LABEL = /necessary|nødvendig|essential|essensiell|required|påkrevd|strictly|nödvändig|nødvendige|notwendig|erforderlich|technisch/i;

  /* ------------------------------------------------------------------ *
   * Kjente consent-plattformer
   *   detect:   containeren(e) som må være synlige
   *   reject:   knapp(er) som avviser direkte
   *   settings: knapp som åpner detaljert visning (hvis ingen avvis-knapp)
   *   save:     lagre-knapp etter at bryterne er skrudd av
   * ------------------------------------------------------------------ */
  const CMPS = [
    { name: "OneTrust", detect: "#onetrust-banner-sdk, #onetrust-pc-sdk",
      reject: "#onetrust-reject-all-handler, .ot-pc-refuse-all-handler, button.banner-close-button.onetrust-close-btn-ui[aria-label*='reject' i]",
      settings: "#onetrust-pc-btn-handler", save: ".save-preference-btn-handler, #onetrust-pc-sdk .ot-pc-footer button.save-preference-btn-handler" },
    { name: "Cookiebot", detect: "#CybotCookiebotDialog",
      reject: "#CybotCookiebotDialogBodyButtonDecline, #CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll",
      settings: "#CybotCookiebotDialogBodyLevelButtonCustomize, #CybotCookiebotDialogNavDetails",
      save: "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection, #CybotCookiebotDialogBodyButtonAcceptSelected" },
    { name: "Usercentrics", detect: "#usercentrics-root, #usercentrics-cmp-ui",
      reject: "[data-testid='uc-deny-all-button'], button#deny, button.uc-deny-button",
      settings: "[data-testid='uc-more-button'], button#more", save: "[data-testid='uc-save-button'], button#save" },
    { name: "Didomi", detect: "#didomi-notice, #didomi-popup",
      reject: "#didomi-notice-disagree-button, .didomi-continue-without-agreeing, button[aria-label^='Disagree to all' i]",
      settings: "#didomi-notice-learn-more-button" },
    { name: "Sourcepoint", detect: "[class*='sp_choice_type']",
      reject: ".sp_choice_type_13, .sp_choice_type_REJECT_ALL, button[title='Reject All' i], button[title='Avvis alle' i]",
      settings: ".sp_choice_type_12", save: ".sp_choice_type_SAVE_AND_EXIT" },
    { name: "Quantcast Choice", detect: ".qc-cmp2-container, #qc-cmp2-container, #qc-cmp2-ui" },
    { name: "Google Funding Choices", detect: ".fc-consent-root",
      reject: ".fc-cta-do-not-consent", settings: ".fc-cta-manage-options", save: ".fc-confirm-choices" },
    { name: "TrustArc", detect: "#truste-consent-track, #truste-consent-content, .truste_box_overlay",
      reject: "#truste-consent-required, .truste-consent-required" },
    { name: "Consentmanager", detect: "#cmpbox, #cmpwrapper",
      reject: ".cmpboxbtnno, #cmpwelcomebtnno a, #cmpbntnotxt, .cmpboxbtnreject, .cmptxt_btn_no" },
    { name: "Cookie Information", detect: "#coiOverlay, #cookie-information-template-wrapper, .coi-banner__wrapper",
      reject: "#declineButton, .coi-banner__decline, button[onclick*='declineAllCategories']" },
    { name: "CookieYes", detect: ".cky-consent-container, #cookie-law-info-bar",
      reject: ".cky-btn-reject, #cookie_action_close_header_reject, .cli_action_button[data-cli_action='reject']" },
    { name: "Complianz", detect: ".cmplz-cookiebanner, #cmplz-cookiebanner-container", reject: ".cmplz-btn.cmplz-deny, button.cmplz-deny" },
    { name: "iubenda", detect: "#iubenda-cs-banner", reject: ".iubenda-cs-reject-btn" },
    { name: "Klaro", detect: ".klaro .cookie-notice, .klaro .cookie-modal", reject: ".klaro .cn-decline, .klaro .cm-btn-decline" },
    { name: "Osano", detect: ".osano-cm-window", reject: ".osano-cm-denyAll, .osano-cm-button--type_denyAll, .osano-cm-deny" },
    { name: "Termly", detect: "[data-tid='banner-decline'], #termly-code-snippet-support", reject: "[data-tid='banner-decline']" },
    { name: "CookieFirst", detect: ".cookiefirst-root, [data-cookiefirst-widget]", reject: "[data-cookiefirst-action='reject']" },
    { name: "Borlabs Cookie", detect: "#BorlabsCookieBox, .brlbs-cmpnt-container",
      reject: "#BorlabsCookieBox a[data-cookie-refuse], ._brlbs-refuse-btn a, ._brlbs-refuse a, .brlbs-btn-accept-only-essential" },
    { name: "Axeptio", detect: "#axeptio_overlay", reject: "#axeptio_btn_dismiss" },
    { name: "Meta", detect: "[data-cookiebanner]", reject: "[data-cookiebanner='accept_only_essential_button']" },
    { name: "Shopify", detect: "#shopify-pc__banner", reject: "#shopify-pc__banner__btn-decline" },
    { name: "HubSpot", detect: "#hs-eu-cookie-confirmation", reject: "#hs-eu-decline-button" },
    { name: "Cookie Notice", detect: "#cookie-notice", reject: "#cn-refuse-cookie" },
    { name: "CookieScript", detect: "#cookiescript_injected", reject: "#cookiescript_reject" },
    { name: "Civic Cookie Control", detect: "#ccc", reject: "#ccc-reject-settings, #ccc-notify-reject" },
    { name: "Evidon", detect: "#_evidon_banner", reject: "#_evidon-decline-button" },
    { name: "Piwik PRO", detect: "#ppms_cm_consent_popup, #ppms_cm_popup_overlay", reject: "#ppms_cm_reject-all" },
    { name: "tarteaucitron", detect: "#tarteaucitronRoot", reject: "#tarteaucitronAllDenied2, .tarteaucitronDeny" },
    { name: "Ketch", detect: "#lanyard_root" },
    { name: "Admiral", detect: "[class*='AdmiralCMP'], #admiral-cmp" },
  ];

  /* ------------------------------------------------------------------ *
   * DOM-hjelpere
   * ------------------------------------------------------------------ */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CLICKABLE = "button, [role='button'], a, input[type='button'], input[type='submit'], [onclick], [tabindex='0']";

  const norm = (s) =>
    (s || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[ \s]+/g, " ")
      .replace(/[^\p{L}\p{N} ]+/gu, " ")
      .replace(/ +/g, " ")
      .trim();

  // Alle "røtter" (dokumentet + åpne shadow roots) under en node
  function rootsUnder(node) {
    const roots = [node];
    const start = node.nodeType === Node.DOCUMENT_NODE ? node.documentElement : node;
    if (!start) return roots;
    if (start.shadowRoot) roots.push(...rootsUnder(start.shadowRoot));
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = walker.nextNode())) if (el.shadowRoot) roots.push(...rootsUnder(el.shadowRoot));
    return roots;
  }

  function deepAll(selector, scope = document) {
    if (!selector) return [];
    const out = [];
    const scopes = Array.isArray(scope) ? scope : [scope];
    for (const s of scopes) {
      if (s.nodeType === Node.ELEMENT_NODE) {
        try { if (s.matches(selector)) out.push(s); } catch { return []; }
      }
      for (const r of rootsUnder(s)) {
        try { out.push(...r.querySelectorAll(selector)); } catch { return []; }
      }
    }
    return [...new Set(out)];
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || parseFloat(st.opacity) === 0) return false;
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    }
    return true;
  }

  // En container regnes som "vist" hvis den selv er synlig, eller har en synlig knapp inni (shadow hosts har ofte 0×0)
  function isShown(el) {
    if (isVisible(el)) return true;
    return deepAll("button, [role='button']", el).some(isVisible);
  }

  const labelOf = (el) =>
    norm(el.innerText || el.value || el.getAttribute?.("aria-label") || el.title || el.textContent);

  // Unngå lenker som navigerer bort fra siden
  function isSafeToClick(el) {
    if (el.tagName === "A") {
      const href = (el.getAttribute("href") || "").trim();
      if (href && !href.startsWith("#") && !href.toLowerCase().startsWith("javascript:") && el.getAttribute("role") !== "button") return false;
    }
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    return true;
  }

  function findByText(patterns, scope) {
    for (const el of deepAll(CLICKABLE, scope)) {
      const raw = el.textContent || el.value || el.getAttribute("aria-label") || "";
      if (raw.length > 120) continue;
      const t = labelOf(el);
      if (!t || t.length > 70) continue;
      if (!patterns.some((re) => re.test(t))) continue;
      if (!isVisible(el) || !isSafeToClick(el)) continue;
      return el;
    }
    return null;
  }

  const firstVisible = (selector, scope) => deepAll(selector, scope).find((el) => isVisible(el) && isSafeToClick(el)) || null;

  let clicks = 0;
  function click(el) {
    log("click", el);
    clicks++;
    el.click();
  }

  async function waitFor(fn, timeout = 3000, every = 150) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(every);
    }
    return fn();
  }

  // Skru av alle valgfrie brytere/avkrysningsbokser i containerne
  function uncheckOptional(scope) {
    let changed = 0;
    const toggles = deepAll(
      "input[type='checkbox']:checked, [role='switch'][aria-checked='true'], [role='checkbox'][aria-checked='true']",
      scope
    );
    for (const t of toggles) {
      if (t.disabled || t.getAttribute("aria-disabled") === "true" || t.hasAttribute("readonly")) continue;
      const label = norm(
        (t.id && t.getRootNode().querySelector?.(`label[for="${CSS.escape(t.id)}"]`)?.textContent) ||
          t.closest("label")?.textContent ||
          t.getAttribute("aria-label") ||
          t.parentElement?.parentElement?.textContent ||
          ""
      );
      if (NECESSARY_LABEL.test(label) && label.length < 80) continue;
      t.click();
      clicks++;
      changed++;
    }
    return changed;
  }

  /* ------------------------------------------------------------------ *
   * Er en knapp inne i et cookie-banner?
   * ------------------------------------------------------------------ */
  let frameIsConsentFrame = null;
  function isConsentFrame() {
    if (IS_TOP) return false;
    if (frameIsConsentFrame !== null) return frameIsConsentFrame;
    const host = location.hostname;
    const byHost = /consent|privacy|cmp|cookie|sourcepoint|privacy-mgmt|trustarc|truste|didomi|usercentrics|onetrust|quantcast/i.test(host);
    const text = document.body?.innerText || "";
    frameIsConsentFrame = byHost || (text.length < 6000 && COOKIE_WORDS.test(text));
    return frameIsConsentFrame;
  }

  const parentOf = (el) => el.parentElement || (el.getRootNode() instanceof ShadowRoot ? el.getRootNode().host : null);

  function consentContainerOf(el) {
    if (isConsentFrame()) return document.body;
    let node = el;
    let cookieAncestor = null;
    let bannerLike = false;
    for (let i = 0; node && node !== document.body && node !== document.documentElement && i < 20; i++) {
      const st = getComputedStyle(node);
      const attrs = `${node.id || ""} ${typeof node.className === "string" ? node.className : ""}`;
      if (
        st.position === "fixed" || st.position === "sticky" ||
        node.getAttribute("role") === "dialog" || node.getAttribute("role") === "alertdialog" ||
        node.getAttribute("aria-modal") === "true" || node.tagName === "DIALOG" ||
        CONSENT_ATTR.test(attrs)
      ) bannerLike = true;
      if (!cookieAncestor) {
        const txt = node.innerText || "";
        if (txt.length < 8000 && (COOKIE_WORDS.test(txt) || COOKIE_WORDS.test(attrs))) cookieAncestor = node;
      }
      if (bannerLike && cookieAncestor) return cookieAncestor.contains(node) ? node : cookieAncestor;
      node = parentOf(node);
    }
    return null;
  }

  function findInConsentContext(patterns) {
    for (const el of deepAll(CLICKABLE, document)) {
      const raw = el.textContent || el.value || el.getAttribute("aria-label") || "";
      if (raw.length > 120) continue;
      const t = labelOf(el);
      if (!t || t.length > 70 || !patterns.some((re) => re.test(t))) continue;
      if (!isVisible(el) || !isSafeToClick(el)) continue;
      const box = consentContainerOf(el);
      if (box) return { el, box };
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Strategier
   * ------------------------------------------------------------------ */
  const attempts = new Map(); // navn -> antall forsøk på innstillinger-flyten

  async function settingsFlow(key, settingsBtn, scopeFn, rule = {}) {
    const n = attempts.get(key) || 0;
    if (n >= 2) return false;
    attempts.set(key, n + 1);
    click(settingsBtn);
    await sleep(400);

    // 1) Dukket det opp en "Avvis alle" i detaljvisningen?
    const rej = await waitFor(
      () => (rule.reject && firstVisible(rule.reject, scopeFn())) || findByText(REJECT_TEXT, scopeFn()),
      1800
    );
    if (rej) { click(rej); return true; }

    // 2) Skru av alle valgfrie brytere og lagre
    uncheckOptional(scopeFn());
    await sleep(200);
    const save = (rule.save && firstVisible(rule.save, scopeFn())) || findByText(SAVE_TEXT, scopeFn());
    if (save) { click(save); return true; }
    return false;
  }

  async function tryKnownCmps() {
    for (const rule of CMPS) {
      let containers = deepAll(rule.detect).filter(isShown);
      if (!containers.length) continue;
      const scopeFn = () => {
        const shown = deepAll(rule.detect).filter(isShown);
        return shown.length ? shown : containers;
      };

      const direct = (rule.reject && firstVisible(rule.reject, containers)) || findByText(REJECT_TEXT, containers);
      if (direct) { click(direct); return { cmp: rule.name, method: "reject" }; }

      const settings = (rule.settings && firstVisible(rule.settings, containers)) || findByText(SETTINGS_TEXT, containers);
      if (settings && (await settingsFlow(rule.name, settings, scopeFn, rule))) {
        return { cmp: rule.name, method: "settings" };
      }
    }
    return null;
  }

  async function tryGeneric() {
    const hit = findInConsentContext(REJECT_TEXT);
    if (hit) { click(hit.el); return { cmp: "Generisk banner", method: "reject" }; }

    const settings = findInConsentContext(SETTINGS_TEXT);
    if (settings) {
      // Detaljvisningen kan erstatte banneret – let i hele dokumentet etter nye consent-containere
      const scopeFn = () => {
        const boxes = deepAll("[role='dialog'], [aria-modal='true'], dialog, [id*='cookie' i], [class*='cookie' i], [id*='consent' i], [class*='consent' i], [id*='samtykke' i], [class*='samtykke' i]")
          .filter((b) => isShown(b) && COOKIE_WORDS.test(`${b.id} ${b.className} ${b.innerText || ""}`));
        if (settings.box.isConnected && !boxes.includes(settings.box)) boxes.push(settings.box);
        return boxes.length ? boxes : [settings.box];
      };
      if (await settingsFlow("generic", settings.el, scopeFn)) return { cmp: "Generisk banner", method: "settings" };
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Hovedløkke
   * ------------------------------------------------------------------ */
  let enabled = false;
  let done = false;
  let running = false;
  let startedAt = 0;
  let observer = null;
  let timer = null;
  let lastScan = 0;
  let pending = null;

  function topHost() {
    try {
      if (IS_TOP) return location.hostname;
      const ao = location.ancestorOrigins;
      if (ao && ao.length) return new URL(ao[ao.length - 1]).hostname;
      if (document.referrer) return new URL(document.referrer).hostname;
    } catch {}
    return location.hostname;
  }
  const bareHost = (h) => (h || "").replace(/^www\./, "").toLowerCase();

  function report(result) {
    const payload = {
      type: "rejected",
      cmp: result.cmp,
      method: result.method,
      clicks,
      host: bareHost(topHost()),
      frameHost: location.hostname,
      url: IS_TOP ? location.href : undefined,
    };
    try { api?.runtime?.sendMessage(payload)?.catch?.(() => {}); } catch {}
    document.documentElement?.setAttribute("data-cookie-rejecter", result.cmp);
  }

  async function scan() {
    if (!enabled || done || running) return;
    if (Date.now() - startedAt > ACTIVE_WINDOW_MS) return stop();
    if (!document.body) return;
    // Små iframes (annonser, pikslar) er aldri cookie-bannere
    if (!IS_TOP && (window.innerWidth < 150 || window.innerHeight < 60)) return stop();

    running = true;
    lastScan = Date.now();
    try {
      const result = (await tryKnownCmps()) || (await tryGeneric());
      if (result) {
        done = true;
        log("avvist", result);
        report(result);
        stop();
      }
    } catch (e) {
      log("feil", e);
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (pending || done || !enabled) return;
    const wait = Math.max(0, 350 - (Date.now() - lastScan));
    pending = setTimeout(() => { pending = null; scan(); }, wait);
  }

  function start() {
    if (!enabled) return;
    done = false;
    clicks = 0;
    attempts.clear();
    startedAt = Date.now();
    if (!observer) {
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    }
    // Shadow DOM-endringer fanges ikke av observeren – poll i tillegg
    if (!timer) timer = setInterval(schedule, 1200);
    schedule();
  }

  function stop() {
    observer?.disconnect();
    observer = null;
    clearInterval(timer);
    timer = null;
    clearTimeout(pending);
    pending = null;
  }

  async function init() {
    let cfg = {};
    try { cfg = (await api.storage.local.get(["enabled", "disabledSites"])) || {}; } catch {}
    const host = bareHost(topHost());
    enabled = cfg.enabled !== false && !(cfg.disabledSites || []).includes(host);
    if (!enabled) return;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
    window.addEventListener("load", schedule, { once: true });
  }

  // Popupen kan be oss prøve igjen ("Avvis nå")
  try {
    api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "rerun") {
        enabled = true;
        stop();
        start();
        sendResponse?.({ ok: true });
      }
      if (msg?.type === "ping") sendResponse?.({ ok: true, done, host: bareHost(topHost()) });
    });
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !(changes.enabled || changes.disabledSites)) return;
      const host = bareHost(topHost());
      const on = (changes.enabled ? changes.enabled.newValue : true) !== false &&
        !((changes.disabledSites?.newValue) || []).includes(host);
      if (!on) { enabled = false; stop(); }
    });
  } catch {}

  init();
})();
