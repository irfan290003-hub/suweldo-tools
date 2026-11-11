/**
 * SuweldoTools — Strict Consent-First GA4 & Bilingual Cookie Consent Controller
 *
 * Policy:
 * - Consent model: Strict Block Until Accept (zero gtag.js requests, zero GA4 cookies,
 *   and zero cookieless pings before explicit user acceptance).
 * - Scope: Worldwide — all public website visitors (strictly excludes /admin).
 * - Storage key: localStorage['suweldotools_cookie_consent']
 * - Persistence: 6 calendar months for both 'accepted' and 'rejected' decisions.
 * - Languages: English (en) and Filipino (tl) determined from page document language & route.
 * - Measurement ID: G-E3Z69Z6Y0J (with allow_google_signals: false, allow_ad_personalization_signals: false).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var instance = factory();
    module.exports = instance;
    if (typeof window !== 'undefined') {
      window.SuweldoCookieConsent = instance;
    }
  } else {
    root.SuweldoCookieConsent = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'suweldotools_cookie_consent';
  var CONSENT_VERSION = 1;
  var GA4_MEASUREMENT_ID = 'G-E3Z69Z6Y0J';
  var GA4_SCRIPT_URL = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_MEASUREMENT_ID;
  var GA4_SCRIPT_ID = 'suweldotools-ga4-script';
  var BANNER_ID = 'suweldotools-cookie-consent-banner';
  var FOOTER_BTN_ID = 'cookieSettingsFooterBtn';

  var COPY = {
    en: {
      heading: 'Cookie Preferences',
      message:
        'We use Google Analytics to understand how visitors use SuweldoTools and improve the website. Analytics will only run if you accept. You can change your choice at any time.',
      acceptBtn: 'Accept Cookies',
      rejectBtn: 'Reject',
      footerLink: 'Cookie Settings',
      privacyLabel: 'Privacy Policy',
      privacyHref: '/privacy-policy/'
    },
    tl: {
      heading: 'Mga Setting ng Cookie',
      message:
        'Gumagamit kami ng Google Analytics upang maunawaan kung paano ginagamit ng mga bisita ang SuweldoTools at mapahusay ang website. Gagana lamang ang analytics kapag pumayag ka. Maaari mong baguhin ang iyong desisyon anumang oras.',
      acceptBtn: 'Tanggapin ang Cookies',
      rejectBtn: 'Tanggihan',
      footerLink: 'Mga Setting ng Cookie',
      privacyLabel: 'Patakaran sa Privacy',
      privacyHref: '/tl/privacy-policy/'
    }
  };

  /**
   * Computes a timestamp exactly 6 UTC calendar months after `timestampMs`,
   * clamping end-of-month dates safely (e.g., Aug 31 + 6 months -> Feb 28/29).
   */
  function addSixCalendarMonths(timestampMs) {
    var baseMs = typeof timestampMs === 'number' && isFinite(timestampMs) ? timestampMs : Date.now();
    var d = new Date(baseMs);
    var targetMonth = d.getUTCMonth() + 6;
    var targetYear = d.getUTCFullYear() + Math.floor(targetMonth / 12);
    targetMonth = targetMonth % 12;

    var originalDay = d.getUTCDate();
    var maxDayInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    var clampedDay = Math.min(originalDay, maxDayInTargetMonth);

    return Date.UTC(
      targetYear,
      targetMonth,
      clampedDay,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds()
    );
  }

  function safeGetStorageItem(storage, key) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      return storage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSetStorageItem(storage, key, value) {
    if (!storage || typeof storage.setItem !== 'function') return false;
    try {
      storage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function safeRemoveStorageItem(storage, key) {
    if (!storage || typeof storage.removeItem !== 'function') return false;
    try {
      storage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Validates a parsed consent record object.
   */
  function isValidConsentRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return false;
    }
    if (record.status !== 'accepted' && record.status !== 'rejected') {
      return false;
    }
    if (typeof record.timestamp !== 'number' || !isFinite(record.timestamp) || record.timestamp <= 0) {
      return false;
    }
    if (
      typeof record.expiresAt !== 'number' ||
      !isFinite(record.expiresAt) ||
      record.expiresAt <= record.timestamp
    ) {
      return false;
    }
    if (record.version !== CONSENT_VERSION) {
      return false;
    }
    return true;
  }

  /**
   * Reads, validates, and checks expiration of the stored consent record.
   * Removes invalid or expired records automatically.
   */
  function readStoredConsent(storage, nowMs) {
    var currentNow = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    var raw = safeGetStorageItem(storage, STORAGE_KEY);
    if (raw === null || raw === '') {
      return { state: 'missing', record: null };
    }

    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      safeRemoveStorageItem(storage, STORAGE_KEY);
      return { state: 'invalid', record: null };
    }

    if (!isValidConsentRecord(parsed)) {
      safeRemoveStorageItem(storage, STORAGE_KEY);
      return { state: 'invalid', record: null };
    }

    if (currentNow >= parsed.expiresAt) {
      safeRemoveStorageItem(storage, STORAGE_KEY);
      return { state: 'expired', record: null };
    }

    return {
      state: parsed.status,
      record: parsed
    };
  }

  /**
   * Builds and persists a consent decision ('accepted' | 'rejected') for 6 calendar months.
   * If localStorage is unavailable, returns `persisted: false` while still returning the in-memory record.
   */
  function saveConsentDecision(storage, status, nowMs) {
    var normalizedStatus = status === 'accepted' ? 'accepted' : 'rejected';
    var ts = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    var record = {
      status: normalizedStatus,
      timestamp: ts,
      expiresAt: addSixCalendarMonths(ts),
      version: CONSENT_VERSION
    };
    var persisted = safeSetStorageItem(storage, STORAGE_KEY, JSON.stringify(record));
    return {
      persisted: persisted,
      record: record
    };
  }

  /**
   * Determines page language ('en' or 'tl') strictly from the document's `lang` attribute
   * and URL route structure (`/tl/`), without inspecting browser `navigator.language`.
   */
  function detectPageLanguage(doc, win) {
    var htmlLang = '';
    if (doc && doc.documentElement && typeof doc.documentElement.lang === 'string') {
      htmlLang = doc.documentElement.lang.trim().toLowerCase();
    }
    var pathname = '';
    if (win && win.location && typeof win.location.pathname === 'string') {
      pathname = win.location.pathname.trim();
    }

    if (
      htmlLang === 'tl' ||
      htmlLang.indexOf('tl-') === 0 ||
      htmlLang === 'fil' ||
      htmlLang.indexOf('fil-') === 0 ||
      pathname === '/tl' ||
      pathname.indexOf('/tl/') === 0
    ) {
      return 'tl';
    }
    return 'en';
  }

  /**
   * Checks whether the current route is `/admin` (which must remain strictly excluded from GA4).
   */
  function isAdminRoute(win) {
    if (!win || !win.location || typeof win.location.pathname !== 'string') {
      return false;
    }
    var p = win.location.pathname.replace(/\\/g, '/');
    return p === '/admin' || p.indexOf('/admin/') === 0 || /\/admin\/index\.html$/i.test(p);
  }

  /**
   * Clears existing first-party GA4 cookies (`_ga`, `_ga_*`, `_gid`, `_gat`) across
   * applicable domain and path combinations when consent is rejected or withdrawn.
   */
  function clearGa4Cookies(doc, win) {
    if (!doc) return [];
    var cookieNames = ['_ga', '_ga_' + GA4_MEASUREMENT_ID.replace(/^G-/, ''), '_gid', '_gat'];

    try {
      var rawCookies = typeof doc.cookie === 'string' ? doc.cookie : '';
      if (rawCookies) {
        var pairs = rawCookies.split(';');
        for (var i = 0; i < pairs.length; i++) {
          var eqIdx = pairs[i].indexOf('=');
          var name = (eqIdx !== -1 ? pairs[i].slice(0, eqIdx) : pairs[i]).trim();
          if (
            name &&
            (name === '_ga' ||
              name.indexOf('_ga_') === 0 ||
              name === '_gid' ||
              name.indexOf('_gat') === 0) &&
            cookieNames.indexOf(name) === -1
          ) {
            cookieNames.push(name);
          }
        }
      }
    } catch (e) {
      // Ignore cookie read errors in restricted environments
    }

    var hostname =
      win && win.location && typeof win.location.hostname === 'string'
        ? win.location.hostname.trim()
        : '';
    var pathname =
      win && win.location && typeof win.location.pathname === 'string'
        ? win.location.pathname.trim()
        : '/';

    var domains = [''];
    if (hostname && hostname !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      domains.push(hostname);
      domains.push('.' + hostname);
      var parts = hostname.split('.');
      if (parts.length > 2) {
        var rootDomain = parts.slice(-2).join('.');
        domains.push(rootDomain);
        domains.push('.' + rootDomain);
      }
    }

    var paths = ['/'];
    if (pathname && pathname !== '/') {
      var trimmedPath = pathname.replace(/\/+$/, '');
      if (trimmedPath && paths.indexOf(trimmedPath) === -1) {
        paths.push(trimmedPath);
      }
      var lastSlash = trimmedPath.lastIndexOf('/');
      if (lastSlash > 0) {
        var parentPath = trimmedPath.slice(0, lastSlash);
        if (parentPath && paths.indexOf(parentPath) === -1) {
          paths.push(parentPath);
        }
      }
    }

    var expirySuffix = '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; path=';
    for (var c = 0; c < cookieNames.length; c++) {
      var cName = cookieNames[c];
      for (var pIdx = 0; pIdx < paths.length; pIdx++) {
        var pathVal = paths[pIdx];
        for (var dIdx = 0; dIdx < domains.length; dIdx++) {
          var domVal = domains[dIdx];
          var domainAttr = domVal ? '; domain=' + domVal : '';
          try {
            doc.cookie = cName + expirySuffix + pathVal + domainAttr + '; SameSite=Lax';
          } catch (e) {
            // Ignore restricted cookie assignment errors
          }
        }
      }
    }

    return cookieNames;
  }

  /**
   * Disables GA4 collection on the window and removes any injected GA4 script tag,
   * then performs best-effort GA4 cookie cleanup.
   */
  function disableGA4AndClearCookies(doc, win) {
    if (win) {
      win['ga-disable-' + GA4_MEASUREMENT_ID] = true;
    }
    if (doc) {
      var existingScript = doc.getElementById(GA4_SCRIPT_ID);
      if (existingScript && existingScript.parentNode) {
        existingScript.parentNode.removeChild(existingScript);
      }
    }
    return clearGa4Cookies(doc, win);
  }

  /**
   * Dynamically loads `gtag.js` and initializes GA4 (`G-E3Z69Z6Y0J`) at most ONCE per page.
   * Strictly preserves `allow_google_signals: false` and `allow_ad_personalization_signals: false`.
   */
  function loadAndInitializeGA4(doc, win) {
    if (!doc || !win) return false;
    if (isAdminRoute(win)) return false;

    // Clear the GA4 disable flag when consent is active
    win['ga-disable-' + GA4_MEASUREMENT_ID] = false;

    // Guard against duplicate initialization on the same page
    if (win.__SUWELDOTOOLS_GA4_INITIALIZED__ === true) {
      if (!doc.getElementById(GA4_SCRIPT_ID) && !doc.querySelector('script[src*="googletagmanager.com/gtag/js"]')) {
        var reScript = doc.createElement('script');
        reScript.id = GA4_SCRIPT_ID;
        reScript.async = true;
        reScript.src = GA4_SCRIPT_URL;
        var reTarget = doc.head || doc.documentElement || doc.body;
        if (reTarget) {
          reTarget.appendChild(reScript);
        }
      }
      return false;
    }

    win.__SUWELDOTOOLS_GA4_INITIALIZED__ = true;
    win.dataLayer = win.dataLayer || [];
    if (typeof win.gtag !== 'function') {
      win.gtag = function gtag() {
        win.dataLayer.push(arguments);
      };
    }

    win.gtag('js', new Date());
    win.gtag('set', 'allow_google_signals', false);
    win.gtag('set', 'allow_ad_personalization_signals', false);
    win.gtag('config', GA4_MEASUREMENT_ID);

    var existingScript =
      doc.getElementById(GA4_SCRIPT_ID) ||
      doc.querySelector('script[src*="googletagmanager.com/gtag/js"]');

    if (!existingScript) {
      var scriptEl = doc.createElement('script');
      scriptEl.id = GA4_SCRIPT_ID;
      scriptEl.async = true;
      scriptEl.src = GA4_SCRIPT_URL;
      var headTarget = doc.head || doc.documentElement || doc.body;
      if (headTarget) {
        headTarget.appendChild(scriptEl);
      }
    }

    return true;
  }

  /**
   * Creates a controller bound to a given `window` and `document` (defaults to global browser window/document).
   */
  function createConsentController(customWin, customDoc, customNowFn) {
    var win = customWin || (typeof window !== 'undefined' ? window : null);
    var doc = customDoc || (win && win.document ? win.document : typeof document !== 'undefined' ? document : null);
    var getNow =
      typeof customNowFn === 'function'
        ? customNowFn
        : function () {
            return Date.now();
          };

    function getStorage() {
      if (!win) return null;
      try {
        return win.localStorage || null;
      } catch (e) {
        return null;
      }
    }

    function hideBanner() {
      if (!doc) return;
      var banner = doc.getElementById(BANNER_ID);
      if (banner) {
        banner.classList.add('hidden');
        banner.setAttribute('aria-hidden', 'true');
      }
    }

    function applyDecision(status) {
      var normalized = status === 'accepted' ? 'accepted' : 'rejected';
      var saved = saveConsentDecision(getStorage(), normalized, getNow());
      if (normalized === 'accepted') {
        loadAndInitializeGA4(doc, win);
      } else {
        disableGA4AndClearCookies(doc, win);
      }
      hideBanner();
      return saved;
    }

    function buildOrShowBanner(focusFirstButton) {
      if (!doc || !doc.body || isAdminRoute(win)) return null;
      var lang = detectPageLanguage(doc, win);
      var t = COPY[lang] || COPY.en;

      var banner = doc.getElementById(BANNER_ID);
      if (!banner) {
        banner = doc.createElement('div');
        banner.id = BANNER_ID;
        banner.setAttribute('role', 'region');
        banner.setAttribute('aria-labelledby', 'cookieConsentHeading');
        banner.className =
          'fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4 pointer-events-none';

        // Both buttons share identical visual styling for strict equal prominence
        var equalButtonClass =
          'inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-800 shadow-2xs hover:bg-emerald-50 hover:border-emerald-600 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 transition cursor-pointer whitespace-nowrap';

        banner.innerHTML =
          '<div class="pointer-events-auto mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white/98 backdrop-blur-md p-4 sm:p-5 shadow-xl">' +
          '<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3.5 sm:gap-4">' +
          '<div class="space-y-1 min-w-0">' +
          '<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">' +
          '<h2 id="cookieConsentHeading" class="text-sm sm:text-base font-bold text-slate-900">' +
          t.heading +
          '</h2>' +
          '<a href="' +
          t.privacyHref +
          '" class="text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">' +
          t.privacyLabel +
          '</a>' +
          '</div>' +
          '<p id="cookieConsentMessage" class="text-xs sm:text-sm text-slate-600 leading-relaxed">' +
          t.message +
          '</p>' +
          '</div>' +
          '<div class="grid grid-cols-2 sm:flex sm:items-center gap-2.5 shrink-0">' +
          '<button type="button" id="cookieConsentAcceptBtn" data-cookie-consent-accept class="' +
          equalButtonClass +
          '">' +
          t.acceptBtn +
          '</button>' +
          '<button type="button" id="cookieConsentRejectBtn" data-cookie-consent-reject class="' +
          equalButtonClass +
          '">' +
          t.rejectBtn +
          '</button>' +
          '</div>' +
          '</div>' +
          '</div>';

        doc.body.appendChild(banner);

        var acceptBtn = banner.querySelector('#cookieConsentAcceptBtn');
        var rejectBtn = banner.querySelector('#cookieConsentRejectBtn');

        if (acceptBtn) {
          acceptBtn.addEventListener('click', function (e) {
            e.preventDefault();
            applyDecision('accepted');
          });
        }

        if (rejectBtn) {
          rejectBtn.addEventListener('click', function (e) {
            e.preventDefault();
            applyDecision('rejected');
          });
        }
      } else {
        // Ensure copy matches current document language
        var headingEl = banner.querySelector('#cookieConsentHeading');
        var messageEl = banner.querySelector('#cookieConsentMessage');
        var acceptEl = banner.querySelector('#cookieConsentAcceptBtn');
        var rejectEl = banner.querySelector('#cookieConsentRejectBtn');
        if (headingEl) headingEl.textContent = t.heading;
        if (messageEl) messageEl.textContent = t.message;
        if (acceptEl) acceptEl.textContent = t.acceptBtn;
        if (rejectEl) rejectEl.textContent = t.rejectBtn;
        banner.classList.remove('hidden');
        banner.removeAttribute('aria-hidden');
      }

      if (focusFirstButton) {
        var firstBtn = banner.querySelector('#cookieConsentAcceptBtn');
        if (firstBtn && typeof firstBtn.focus === 'function') {
          firstBtn.focus();
        }
      }

      return banner;
    }

    function ensureFooterCookieSettingsLink() {
      if (!doc || isAdminRoute(win)) return null;
      var lang = detectPageLanguage(doc, win);
      var t = COPY[lang] || COPY.en;

      var existingTriggers = doc.querySelectorAll('[data-cookie-settings-trigger], #' + FOOTER_BTN_ID);
      if (existingTriggers.length === 0) {
        var footerEl = doc.querySelector('footer');
        if (footerEl) {
          var disclaimerLink =
            footerEl.querySelector('a[href="/disclaimer/"]') ||
            footerEl.querySelector('a[href="/tl/disclaimer/"]') ||
            footerEl.querySelector('a[href="/privacy-policy/"]') ||
            footerEl.querySelector('a[href="/tl/privacy-policy/"]');

          var legalList = disclaimerLink ? disclaimerLink.closest('ul') : null;
          if (legalList) {
            var li = doc.createElement('li');
            var btn = doc.createElement('button');
            btn.type = 'button';
            btn.id = FOOTER_BTN_ID;
            btn.setAttribute('data-cookie-settings-trigger', '');
            btn.className =
              'text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 cursor-pointer text-left';
            btn.textContent = t.footerLink;
            li.appendChild(btn);
            legalList.appendChild(li);
          }
        }
      }

      var allTriggers = doc.querySelectorAll('[data-cookie-settings-trigger], #' + FOOTER_BTN_ID);
      for (var i = 0; i < allTriggers.length; i++) {
        (function (trigger) {
          if (trigger.getAttribute('data-cookie-settings-bound') === 'true') return;
          trigger.setAttribute('data-cookie-settings-bound', 'true');
          trigger.textContent = t.footerLink;
          trigger.addEventListener('click', function (e) {
            e.preventDefault();
            buildOrShowBanner(true);
          });
        })(allTriggers[i]);
      }

      return doc.getElementById(FOOTER_BTN_ID) || doc.querySelector('[data-cookie-settings-trigger]');
    }

    function init() {
      if (!doc || !win || isAdminRoute(win)) {
        return { state: 'excluded', record: null };
      }

      ensureFooterCookieSettingsLink();

      var evaluation = readStoredConsent(getStorage(), getNow());
      if (evaluation.state === 'accepted') {
        hideBanner();
        loadAndInitializeGA4(doc, win);
        return evaluation;
      }

      if (evaluation.state === 'rejected') {
        win['ga-disable-' + GA4_MEASUREMENT_ID] = true;
        hideBanner();
        return evaluation;
      }

      // Missing, invalid, or expired: keep GA4 strictly blocked and display consent banner
      buildOrShowBanner(false);
      return evaluation;
    }

    return {
      init: init,
      accept: function () {
        return applyDecision('accepted');
      },
      reject: function () {
        return applyDecision('rejected');
      },
      openSettings: function () {
        return buildOrShowBanner(true);
      },
      hideBanner: hideBanner,
      ensureFooterCookieSettingsLink: ensureFooterCookieSettingsLink
    };
  }

  // Auto-initialize in browser environments
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    var defaultController = createConsentController(window, document);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        defaultController.init();
      });
    } else {
      defaultController.init();
    }
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    CONSENT_VERSION: CONSENT_VERSION,
    GA4_MEASUREMENT_ID: GA4_MEASUREMENT_ID,
    GA4_SCRIPT_URL: GA4_SCRIPT_URL,
    GA4_SCRIPT_ID: GA4_SCRIPT_ID,
    BANNER_ID: BANNER_ID,
    FOOTER_BTN_ID: FOOTER_BTN_ID,
    COPY: COPY,
    addSixCalendarMonths: addSixCalendarMonths,
    isValidConsentRecord: isValidConsentRecord,
    readStoredConsent: readStoredConsent,
    saveConsentDecision: saveConsentDecision,
    detectPageLanguage: detectPageLanguage,
    isAdminRoute: isAdminRoute,
    clearGa4Cookies: clearGa4Cookies,
    disableGA4AndClearCookies: disableGA4AndClearCookies,
    loadAndInitializeGA4: loadAndInitializeGA4,
    createConsentController: createConsentController
  };
});
