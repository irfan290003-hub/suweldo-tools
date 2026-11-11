import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CookieConsent = require('../public/js/cookie-consent.js');

interface SimElement {
  id: string;
  tagName: string;
  type?: string;
  async?: boolean;
  src?: string;
  href?: string;
  className: string;
  textContent: string;
  innerHTML: string;
  parentNode: SimElement | null;
  children: SimElement[];
  attributes: Record<string, string>;
  listeners: Record<string, Array<(e?: any) => void>>;
  focused: boolean;
  classList: {
    add: (...tokens: string[]) => void;
    remove: (...tokens: string[]) => void;
    contains: (token: string) => boolean;
  };
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, val: string) => void;
  removeAttribute: (name: string) => void;
  appendChild: (child: SimElement) => SimElement;
  removeChild: (child: SimElement) => SimElement;
  addEventListener: (event: string, cb: (e?: any) => void) => void;
  click: () => void;
  focus: () => void;
  closest: (selector: string) => SimElement | null;
  querySelector: (selector: string) => SimElement | null;
  querySelectorAll: (selector: string) => SimElement[];
}

function createSimEnv(options?: {
  pathname?: string;
  hostname?: string;
  htmlLang?: string;
  navigatorLanguages?: string[];
  storageThrows?: boolean;
  initialStorage?: Record<string, string>;
  initialCookies?: Record<string, string>;
  nowMs?: number;
  withPresetFooterTrigger?: boolean;
}) {
  let currentNowMs = options?.nowMs ?? Date.UTC(2026, 10, 10, 8, 0, 0); // 2026-11-10T08:00:00Z
  const networkRequests: string[] = [];
  const storageMap = new Map<string, string>(Object.entries(options?.initialStorage ?? {}));
  const cookieJar = new Map<string, string>(Object.entries(options?.initialCookies ?? {}));
  const cookieSetLog: string[] = [];

  let activeFocusedElement: SimElement | null = null;

  function makeElement(tagName: string, id = '', attrs: Record<string, string> = {}): SimElement {
    const classSet = new Set<string>(
      (attrs.class || '')
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
    const attributes: Record<string, string> = { ...attrs };
    if (id) attributes.id = id;
    const listeners: Record<string, Array<(e?: any) => void>> = {};
    const children: SimElement[] = [];
    let rawInnerHtml = '';
    let rawTextContent = '';

    const el: SimElement = {
      id,
      tagName: tagName.toUpperCase(),
      get className() {
        return Array.from(classSet).join(' ');
      },
      set className(val: string) {
        classSet.clear();
        String(val || '')
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((c) => classSet.add(c));
      },
      get textContent() {
        return rawTextContent;
      },
      set textContent(val: string) {
        rawTextContent = String(val ?? '');
      },
      get innerHTML() {
        return rawInnerHtml;
      },
      set innerHTML(val: string) {
        rawInnerHtml = String(val ?? '');
        children.length = 0;
        // Parse key child elements generated inside the consent banner HTML template
        const headingMatch = rawInnerHtml.match(
          /<h2[^>]*id="cookieConsentHeading"[^>]*>([\s\S]*?)<\/h2>/i
        );
        if (headingMatch) {
          const h2 = makeElement('h2', 'cookieConsentHeading');
          h2.textContent = headingMatch[1];
          el.appendChild(h2);
        }
        const privacyMatch = rawInnerHtml.match(
          /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
        );
        if (privacyMatch) {
          const a = makeElement('a', '', { href: privacyMatch[1] });
          a.href = privacyMatch[1];
          a.textContent = privacyMatch[2];
          el.appendChild(a);
        }
        const msgMatch = rawInnerHtml.match(
          /<p[^>]*id="cookieConsentMessage"[^>]*>([\s\S]*?)<\/p>/i
        );
        if (msgMatch) {
          const p = makeElement('p', 'cookieConsentMessage');
          p.textContent = msgMatch[1];
          el.appendChild(p);
        }
        const acceptMatch = rawInnerHtml.match(
          /<button[^>]*id="cookieConsentAcceptBtn"[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/button>/i
        );
        if (acceptMatch) {
          const btn = makeElement('button', 'cookieConsentAcceptBtn', {
            'data-cookie-consent-accept': '',
            class: acceptMatch[1],
          });
          btn.className = acceptMatch[1];
          btn.textContent = acceptMatch[2];
          el.appendChild(btn);
        }
        const rejectMatch = rawInnerHtml.match(
          /<button[^>]*id="cookieConsentRejectBtn"[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/button>/i
        );
        if (rejectMatch) {
          const btn = makeElement('button', 'cookieConsentRejectBtn', {
            'data-cookie-consent-reject': '',
            class: rejectMatch[1],
          });
          btn.className = rejectMatch[1];
          btn.textContent = rejectMatch[2];
          el.appendChild(btn);
        }
      },
      parentNode: null,
      children,
      attributes,
      listeners,
      get focused() {
        return activeFocusedElement === el;
      },
      classList: {
        add(...tokens: string[]) {
          tokens.forEach((t) => t && classSet.add(t));
        },
        remove(...tokens: string[]) {
          tokens.forEach((t) => classSet.delete(t));
        },
        contains(token: string) {
          return classSet.has(token);
        },
      },
      getAttribute(name: string) {
        if (name === 'id') return el.id || null;
        return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
      },
      setAttribute(name: string, val: string) {
        attributes[name] = String(val);
        if (name === 'id') el.id = String(val);
      },
      removeAttribute(name: string) {
        delete attributes[name];
      },
      appendChild(child: SimElement) {
        if (child.parentNode) {
          child.parentNode.removeChild(child);
        }
        child.parentNode = el;
        children.push(child);
        if (child.tagName === 'SCRIPT' && child.src) {
          networkRequests.push(child.src);
        }
        return child;
      },
      removeChild(child: SimElement) {
        const idx = children.indexOf(child);
        if (idx !== -1) {
          children.splice(idx, 1);
          child.parentNode = null;
        }
        return child;
      },
      addEventListener(event: string, cb: (e?: any) => void) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      },
      click() {
        const cbs = listeners.click || [];
        for (const cb of cbs) {
          cb({
            type: 'click',
            target: el,
            preventDefault() {},
            stopPropagation() {},
          });
        }
      },
      focus() {
        activeFocusedElement = el;
      },
      closest(selector: string) {
        let cur: SimElement | null = el;
        while (cur) {
          if (matchesSelector(cur, selector)) return cur;
          cur = cur.parentNode;
        }
        return null;
      },
      querySelector(selector: string) {
        return findAll(el, selector)[0] ?? null;
      },
      querySelectorAll(selector: string) {
        return findAll(el, selector);
      },
    };

    return el;
  }

  function matchesSelector(el: SimElement, selector: string): boolean {
    const parts = selector.split(',').map((s) => s.trim());
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('#')) {
        if (el.id === part.slice(1)) return true;
        continue;
      }
      if (part.startsWith('[') && part.endsWith(']')) {
        const attrName = part.slice(1, -1);
        if (el.getAttribute(attrName) !== null) return true;
        continue;
      }
      const scriptSrcSub = part.match(/^script\[src\*="([^"]+)"\]$/i);
      if (scriptSrcSub) {
        if (el.tagName === 'SCRIPT' && el.src && el.src.includes(scriptSrcSub[1])) return true;
        continue;
      }
      const anchorHref = part.match(/^a\[href="([^"]+)"\]$/i);
      if (anchorHref) {
        if (
          el.tagName === 'A' &&
          (el.href === anchorHref[1] || el.getAttribute('href') === anchorHref[1])
        ) {
          return true;
        }
        continue;
      }
      if (el.tagName.toLowerCase() === part.toLowerCase()) {
        return true;
      }
    }
    return false;
  }

  function findAll(root: SimElement, selector: string): SimElement[] {
    const results: SimElement[] = [];
    function walk(node: SimElement) {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) {
          results.push(child);
        }
        walk(child);
      }
    }
    walk(root);
    return results;
  }

  const documentElement = makeElement('html');
  documentElement.setAttribute('lang', options?.htmlLang ?? 'en-PH');
  (documentElement as any).lang = options?.htmlLang ?? 'en-PH';

  const head = makeElement('head');
  const body = makeElement('body');
  const footer = makeElement('footer');
  const legalUl = makeElement('ul');
  const privacyLi = makeElement('li');
  const isTl =
    (options?.htmlLang ?? '').toLowerCase().startsWith('tl') ||
    (options?.pathname ?? '/').startsWith('/tl/');
  const privacyA = makeElement('a', '', {
    href: isTl ? '/tl/privacy-policy/' : '/privacy-policy/',
  });
  privacyA.href = isTl ? '/tl/privacy-policy/' : '/privacy-policy/';
  privacyLi.appendChild(privacyA);

  const disclaimerLi = makeElement('li');
  const disclaimerA = makeElement('a', '', {
    href: isTl ? '/tl/disclaimer/' : '/disclaimer/',
  });
  disclaimerA.href = isTl ? '/tl/disclaimer/' : '/disclaimer/';
  disclaimerLi.appendChild(disclaimerA);

  legalUl.appendChild(privacyLi);
  legalUl.appendChild(disclaimerLi);

  if (options?.withPresetFooterTrigger) {
    const cookieLi = makeElement('li');
    const cookieBtn = makeElement('button', CookieConsent.FOOTER_BTN_ID, {
      'data-cookie-settings-trigger': '',
    });
    cookieBtn.textContent = isTl ? 'Mga Setting ng Cookie' : 'Cookie Settings';
    cookieLi.appendChild(cookieBtn);
    legalUl.appendChild(cookieLi);
  }

  footer.appendChild(legalUl);
  body.appendChild(footer);
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const localStorageMock = options?.storageThrows
    ? {
        getItem() {
          throw new Error('SecurityError: localStorage disabled');
        },
        setItem() {
          throw new Error('SecurityError: localStorage disabled');
        },
        removeItem() {
          throw new Error('SecurityError: localStorage disabled');
        },
      }
    : {
        getItem(k: string) {
          return storageMap.has(k) ? storageMap.get(k)! : null;
        },
        setItem(k: string, v: string) {
          storageMap.set(k, String(v));
        },
        removeItem(k: string) {
          storageMap.delete(k);
        },
      };

  const doc = {
    documentElement,
    head,
    body,
    readyState: 'complete',
    get cookie() {
      return Array.from(cookieJar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    },
    set cookie(raw: string) {
      cookieSetLog.push(raw);
      const [firstPair, ...attrs] = raw.split(';').map((s) => s.trim());
      const eqIdx = firstPair.indexOf('=');
      const name = eqIdx !== -1 ? firstPair.slice(0, eqIdx).trim() : firstPair.trim();
      const val = eqIdx !== -1 ? firstPair.slice(eqIdx + 1).trim() : '';
      const isClearing =
        val === '' ||
        attrs.some(
          (a) =>
            /^max-age=0$/i.test(a) ||
            /^expires=thu,\s*01\s+jan\s+1970/i.test(a)
        );
      if (isClearing) {
        cookieJar.delete(name);
      } else if (name) {
        cookieJar.set(name, val);
      }
    },
    createElement(tag: string) {
      return makeElement(tag);
    },
    getElementById(id: string) {
      return findAll(documentElement, `#${id}`)[0] ?? null;
    },
    querySelector(selector: string) {
      return findAll(documentElement, selector)[0] ?? null;
    },
    querySelectorAll(selector: string) {
      return findAll(documentElement, selector);
    },
    addEventListener() {},
  };

  const win: Record<string, any> = {
    document: doc,
    location: {
      pathname: options?.pathname ?? '/',
      hostname: options?.hostname ?? 'suweldotools.com',
    },
    navigator: {
      language: options?.navigatorLanguages?.[0] ?? 'en-US',
      languages: options?.navigatorLanguages ?? ['en-US'],
    },
    localStorage: localStorageMock,
  };

  const controller = CookieConsent.createConsentController(win, doc, () => currentNowMs);

  return {
    win,
    doc,
    controller,
    storageMap,
    cookieJar,
    cookieSetLog,
    networkRequests,
    setNowMs(ms: number) {
      currentNowMs = ms;
    },
    getNowMs() {
      return currentNowMs;
    },
  };
}

describe('Strict GA4 Cookie Consent — Comprehensive Runtime & Build Suite', () => {
  it('1. No consent: GA4 does not load, zero network requests or cookies occur, and banner appears', () => {
    const env = createSimEnv({ pathname: '/take-home-pay-calculator-philippines/' });
    const result = env.controller.init();

    assert.equal(result.state, 'missing');
    assert.equal(env.networkRequests.length, 0, 'Must make zero network requests before consent');
    assert.equal(env.doc.getElementById(CookieConsent.GA4_SCRIPT_ID), null);
    assert.equal(env.win.gtag, undefined);
    assert.equal(env.win.dataLayer, undefined);
    assert.equal(env.cookieJar.size, 0);

    const banner = env.doc.getElementById(CookieConsent.BANNER_ID);
    assert.ok(banner, 'Cookie consent banner must be rendered when no consent is stored');
    assert.equal(banner.classList.contains('hidden'), false);
  });

  it('2. Visitor ignores banner: GA4 stays strictly blocked and no storage entry is created', () => {
    const env = createSimEnv({ pathname: '/' });
    env.controller.init();

    // Visitor does not click Accept or Reject
    assert.equal(env.storageMap.has(CookieConsent.STORAGE_KEY), false);
    assert.equal(env.networkRequests.length, 0);
    assert.equal(env.doc.getElementById(CookieConsent.GA4_SCRIPT_ID), null);
    assert.equal(env.win.gtag, undefined);
    assert.equal(env.win.dataLayer, undefined);
  });

  it('3. Visitor rejects: GA4 does not load, 6-month rejected consent is saved, and banner hides', () => {
    const startMs = Date.UTC(2026, 10, 10, 8, 0, 0);
    const env = createSimEnv({ pathname: '/', nowMs: startMs });
    env.controller.init();

    const rejectBtn = env.doc.getElementById('cookieConsentRejectBtn');
    assert.ok(rejectBtn, 'Reject button must exist');
    rejectBtn.click();

    assert.equal(env.networkRequests.length, 0, 'Rejecting must never load gtag.js');
    assert.equal(env.doc.getElementById(CookieConsent.GA4_SCRIPT_ID), null);
    assert.equal(env.win.gtag, undefined);
    assert.equal(env.win['ga-disable-G-E3Z69Z6Y0J'], true);

    const banner = env.doc.getElementById(CookieConsent.BANNER_ID);
    assert.ok(banner?.classList.contains('hidden'), 'Banner must hide after rejection');

    const storedRaw = env.storageMap.get(CookieConsent.STORAGE_KEY);
    assert.ok(storedRaw, 'Rejected choice must be stored in localStorage');
    const parsed = JSON.parse(storedRaw!);
    assert.equal(parsed.status, 'rejected');
    assert.equal(parsed.timestamp, startMs);
    assert.equal(parsed.expiresAt, Date.UTC(2027, 4, 10, 8, 0, 0)); // +6 calendar months (May 10, 2027)
    assert.equal(parsed.version, 1);
  });

  it('4. Visitor accepts: GA4 loads only after explicit acceptance with privacy flags preserved', () => {
    const startMs = Date.UTC(2026, 10, 10, 8, 0, 0);
    const env = createSimEnv({ pathname: '/', nowMs: startMs });
    env.controller.init();

    // Before click: strictly blocked
    assert.equal(env.networkRequests.length, 0);
    assert.equal(env.win.gtag, undefined);

    const acceptBtn = env.doc.getElementById('cookieConsentAcceptBtn');
    assert.ok(acceptBtn, 'Accept button must exist');
    acceptBtn.click();

    // After click: gtag.js loaded once and configured
    assert.equal(env.networkRequests.length, 1);
    assert.equal(
      env.networkRequests[0],
      'https://www.googletagmanager.com/gtag/js?id=G-E3Z69Z6Y0J'
    );
    const scriptEl = env.doc.getElementById(CookieConsent.GA4_SCRIPT_ID);
    assert.ok(scriptEl, 'GA4 script element must be appended to head');
    assert.equal(scriptEl?.async, true);

    assert.equal(env.win['ga-disable-G-E3Z69Z6Y0J'], false);
    assert.ok(Array.isArray(env.win.dataLayer));
    const commands = env.win.dataLayer.map((args: any) => Array.from(args));
    assert.equal(commands.length, 4);
    assert.equal(commands[0][0], 'js');
    assert.deepEqual(commands[1], ['set', 'allow_google_signals', false]);
    assert.deepEqual(commands[2], ['set', 'allow_ad_personalization_signals', false]);
    assert.deepEqual(commands[3], ['config', 'G-E3Z69Z6Y0J']);

    const stored = JSON.parse(env.storageMap.get(CookieConsent.STORAGE_KEY)!);
    assert.equal(stored.status, 'accepted');
    assert.equal(stored.timestamp, startMs);
    assert.equal(stored.expiresAt, Date.UTC(2027, 4, 10, 8, 0, 0));
    assert.equal(stored.version, 1);

    const banner = env.doc.getElementById(CookieConsent.BANNER_ID);
    assert.ok(banner?.classList.contains('hidden'), 'Banner must hide after acceptance');
  });

  it('5. Valid accepted consent on a subsequent MPA page: GA4 loads once without showing banner', () => {
    const startMs = Date.UTC(2026, 10, 10, 8, 0, 0);
    const validRecord = {
      status: 'accepted',
      timestamp: startMs,
      expiresAt: CookieConsent.addSixCalendarMonths(startMs),
      version: 1,
    };

    const env = createSimEnv({
      pathname: '/13th-month-pay-calculator/',
      nowMs: startMs + 5 * 24 * 60 * 60 * 1000, // 5 days later
      initialStorage: {
        [CookieConsent.STORAGE_KEY]: JSON.stringify(validRecord),
      },
    });

    const result = env.controller.init();
    assert.equal(result.state, 'accepted');
    assert.equal(env.networkRequests.length, 1);
    assert.equal(
      env.networkRequests[0],
      'https://www.googletagmanager.com/gtag/js?id=G-E3Z69Z6Y0J'
    );
    assert.equal(env.doc.getElementById(CookieConsent.BANNER_ID), null);
  });

  it('6. Valid rejected consent on a subsequent MPA page: GA4 stays blocked and banner stays hidden', () => {
    const startMs = Date.UTC(2026, 10, 10, 8, 0, 0);
    const validRecord = {
      status: 'rejected',
      timestamp: startMs,
      expiresAt: CookieConsent.addSixCalendarMonths(startMs),
      version: 1,
    };

    const env = createSimEnv({
      pathname: '/philhealth-contribution-calculator/',
      nowMs: startMs + 30 * 24 * 60 * 60 * 1000, // 30 days later
      initialStorage: {
        [CookieConsent.STORAGE_KEY]: JSON.stringify(validRecord),
      },
    });

    const result = env.controller.init();
    assert.equal(result.state, 'rejected');
    assert.equal(env.networkRequests.length, 0);
    assert.equal(env.doc.getElementById(CookieConsent.GA4_SCRIPT_ID), null);
    assert.equal(env.win.gtag, undefined);
    assert.equal(env.win['ga-disable-G-E3Z69Z6Y0J'], true);
    assert.equal(env.doc.getElementById(CookieConsent.BANNER_ID), null);
  });

  it('7. Six-month expiry: expired consent (accepted or rejected) is removed and banner reappears with GA4 blocked', () => {
    const startMs = Date.UTC(2026, 7, 31, 12, 0, 0); // Aug 31, 2026
    const expiresAt = CookieConsent.addSixCalendarMonths(startMs);
    // Aug 31, 2026 + 6 calendar months -> Feb 28, 2027 12:00:00 UTC
    assert.equal(expiresAt, Date.UTC(2027, 1, 28, 12, 0, 0));

    // 1ms before expiry -> still valid
    const beforeEnv = createSimEnv({
      pathname: '/',
      nowMs: expiresAt - 1,
      initialStorage: {
        [CookieConsent.STORAGE_KEY]: JSON.stringify({
          status: 'accepted',
          timestamp: startMs,
          expiresAt,
          version: 1,
        }),
      },
    });
    assert.equal(beforeEnv.controller.init().state, 'accepted');
    assert.equal(beforeEnv.networkRequests.length, 1);

    // At expiry timestamp -> expired! Must remove key, block GA4, and show banner
    const expiredAcceptedEnv = createSimEnv({
      pathname: '/',
      nowMs: expiresAt,
      initialStorage: {
        [CookieConsent.STORAGE_KEY]: JSON.stringify({
          status: 'accepted',
          timestamp: startMs,
          expiresAt,
          version: 1,
        }),
      },
    });
    const expResult = expiredAcceptedEnv.controller.init();
    assert.equal(expResult.state, 'expired');
    assert.equal(
      expiredAcceptedEnv.storageMap.has(CookieConsent.STORAGE_KEY),
      false,
      'Expired consent entry must be removed from localStorage'
    );
    assert.equal(expiredAcceptedEnv.networkRequests.length, 0, 'GA4 must not load when expired');
    const banner = expiredAcceptedEnv.doc.getElementById(CookieConsent.BANNER_ID);
    assert.ok(banner && !banner.classList.contains('hidden'), 'Banner must reappear on expiry');

    // Also verify expired 'rejected' consent is removed and prompts again
    const expiredRejectedEnv = createSimEnv({
      pathname: '/',
      nowMs: expiresAt + 1000,
      initialStorage: {
        [CookieConsent.STORAGE_KEY]: JSON.stringify({
          status: 'rejected',
          timestamp: startMs,
          expiresAt,
          version: 1,
        }),
      },
    });
    assert.equal(expiredRejectedEnv.controller.init().state, 'expired');
    assert.equal(expiredRejectedEnv.storageMap.has(CookieConsent.STORAGE_KEY), false);
    assert.ok(expiredRejectedEnv.doc.getElementById(CookieConsent.BANNER_ID));
  });

  it('8. Invalid stored consent or unavailable localStorage: fails safely and keeps GA4 blocked', () => {
    const invalidPayloads = [
      'not-json{{{',
      JSON.stringify({ status: 'unknown', timestamp: 1000, expiresAt: 2000, version: 1 }),
      JSON.stringify({ status: 'accepted', timestamp: 2000, expiresAt: 1000, version: 1 }),
      JSON.stringify({ status: 'accepted', timestamp: 1000, expiresAt: 9999999999999, version: 99 }),
      JSON.stringify(['accepted']),
    ];

    for (const badPayload of invalidPayloads) {
      const env = createSimEnv({
        pathname: '/',
        initialStorage: { [CookieConsent.STORAGE_KEY]: badPayload },
      });
      const res = env.controller.init();
      assert.equal(res.state, 'invalid');
      assert.equal(env.storageMap.has(CookieConsent.STORAGE_KEY), false);
      assert.equal(env.networkRequests.length, 0);
      assert.ok(env.doc.getElementById(CookieConsent.BANNER_ID));
    }

    // When localStorage throws (e.g., disabled in browser), fails safely and does not falsely claim persistence
    const throwingEnv = createSimEnv({ pathname: '/', storageThrows: true });
    const initRes = throwingEnv.controller.init();
    assert.equal(initRes.state, 'missing');
    assert.equal(throwingEnv.networkRequests.length, 0);
    assert.ok(throwingEnv.doc.getElementById(CookieConsent.BANNER_ID));

    const acceptRes = throwingEnv.controller.accept();
    assert.equal(acceptRes.persisted, false, 'Must report persisted: false when storage throws');
    assert.equal(throwingEnv.networkRequests.length, 1, 'Allows current-page choice to take effect');
  });

  it('9. Accepting twice does not initialize GA4 twice or duplicate page_view config on the same page', () => {
    const env = createSimEnv({ pathname: '/' });
    env.controller.init();

    const acceptBtn = env.doc.getElementById('cookieConsentAcceptBtn')!;
    acceptBtn.click();
    assert.equal(env.networkRequests.length, 1);
    assert.equal(env.win.dataLayer.length, 4);

    // Reopen Cookie Settings and click Accept a second time on the same page
    env.controller.openSettings();
    acceptBtn.click();

    assert.equal(env.networkRequests.length, 1, 'Must not inject gtag.js a second time');
    assert.equal(
      env.win.dataLayer.length,
      4,
      'Must not push duplicate gtag("config") or page_view events on the same page'
    );
  });

  it('10. Reopening Cookie Settings from footer works after acceptance and after rejection', () => {
    const env = createSimEnv({ pathname: '/' });
    env.controller.init();

    const footerBtn = env.doc.getElementById(CookieConsent.FOOTER_BTN_ID);
    assert.ok(footerBtn, 'Footer Cookie Settings button must exist');
    assert.equal(footerBtn?.textContent, 'Cookie Settings');

    // Accept first -> banner hides
    env.doc.getElementById('cookieConsentAcceptBtn')!.click();
    const banner = env.doc.getElementById(CookieConsent.BANNER_ID)!;
    assert.equal(banner.classList.contains('hidden'), true);

    // Click Footer Cookie Settings -> banner reopens and focuses Accept button
    footerBtn!.click();
    assert.equal(banner.classList.contains('hidden'), false);
    assert.equal(env.doc.getElementById('cookieConsentAcceptBtn')?.focused, true);

    // Reject -> banner hides, then click Footer Cookie Settings again -> banner reopens
    env.doc.getElementById('cookieConsentRejectBtn')!.click();
    assert.equal(banner.classList.contains('hidden'), true);
    footerBtn!.click();
    assert.equal(banner.classList.contains('hidden'), false);
  });

  it('11. Changing accepted to rejected stops tracking, removes GA4 script, and cleans up _ga cookies', () => {
    const env = createSimEnv({
      pathname: '/take-home-pay-calculator-philippines/',
      hostname: 'suweldotools.com',
      initialCookies: {
        _ga: 'GA1.1.123456789.1762787400',
        _ga_E3Z69Z6Y0J: 'GS1.1.1762787400.1.1.1762787500.0.0.0',
        _gid: 'GA1.2.987654321.1762787400',
      },
    });
    env.controller.init();
    env.doc.getElementById('cookieConsentAcceptBtn')!.click();
    assert.equal(env.win['ga-disable-G-E3Z69Z6Y0J'], false);
    assert.ok(env.doc.getElementById(CookieConsent.GA4_SCRIPT_ID));

    // Reopen Cookie Settings from footer and switch to Reject
    env.doc.getElementById(CookieConsent.FOOTER_BTN_ID)!.click();
    env.doc.getElementById('cookieConsentRejectBtn')!.click();

    // 1. Stored consent updated to 'rejected'
    const stored = JSON.parse(env.storageMap.get(CookieConsent.STORAGE_KEY)!);
    assert.equal(stored.status, 'rejected');

    // 2. GA4 kill-switch enabled and script element removed
    assert.equal(env.win['ga-disable-G-E3Z69Z6Y0J'], true);
    assert.equal(env.doc.getElementById(CookieConsent.GA4_SCRIPT_ID), null);

    // 3. GA4 cookies expired and cleared from cookie jar
    assert.equal(env.cookieJar.has('_ga'), false);
    assert.equal(env.cookieJar.has('_ga_E3Z69Z6Y0J'), false);
    assert.equal(env.cookieJar.has('_gid'), false);
    assert.ok(
      env.cookieSetLog.some((entry) => entry.startsWith('_ga=') && entry.includes('Max-Age=0')),
      'Must emit cookie expiration directives for _ga'
    );
    assert.ok(
      env.cookieSetLog.some(
        (entry) => entry.startsWith('_ga_E3Z69Z6Y0J=') && entry.includes('Max-Age=0')
      ),
      'Must emit cookie expiration directives for _ga_E3Z69Z6Y0J'
    );
  });

  it('12. Changing rejected to accepted enables GA4 only after the new explicit acceptance', () => {
    const env = createSimEnv({ pathname: '/' });
    env.controller.init();

    // Reject first
    env.doc.getElementById('cookieConsentRejectBtn')!.click();
    assert.equal(env.networkRequests.length, 0);
    assert.equal(env.win['ga-disable-G-E3Z69Z6Y0J'], true);

    // Reopen settings -> still blocked until Accept is clicked
    env.doc.getElementById(CookieConsent.FOOTER_BTN_ID)!.click();
    assert.equal(env.networkRequests.length, 0);

    // Explicitly click Accept -> now GA4 loads
    env.doc.getElementById('cookieConsentAcceptBtn')!.click();
    assert.equal(env.networkRequests.length, 1);
    assert.equal(env.win['ga-disable-G-E3Z69Z6Y0J'], false);
    const stored = JSON.parse(env.storageMap.get(CookieConsent.STORAGE_KEY)!);
    assert.equal(stored.status, 'accepted');
  });

  it('13. English and Filipino banner & footer text, 44px min-height, equal button prominence, storage key, and route-based language detection', () => {
    assert.equal(CookieConsent.STORAGE_KEY, 'suweldotools_cookie_consent');

    // English page (even if browser navigator.languages prefers 'tl-PH', page language wins)
    const enEnv = createSimEnv({
      pathname: '/blog/how-to-compute-take-home-pay-philippines/',
      htmlLang: 'en-PH',
      navigatorLanguages: ['tl-PH', 'tl'],
    });
    enEnv.controller.init();

    assert.equal(enEnv.doc.getElementById('cookieConsentHeading')?.textContent, 'Cookie Preferences');
    assert.equal(
      enEnv.doc.getElementById('cookieConsentMessage')?.textContent,
      'We use Google Analytics to understand how visitors use SuweldoTools and improve the website. Analytics will only run if you accept. You can change your choice at any time.'
    );
    const enAcceptBtn = enEnv.doc.getElementById('cookieConsentAcceptBtn')!;
    const enRejectBtn = enEnv.doc.getElementById('cookieConsentRejectBtn')!;
    assert.equal(enAcceptBtn.textContent, 'Accept Cookies');
    assert.equal(enRejectBtn.textContent, 'Reject');
    assert.ok(
      enAcceptBtn.classList.contains('min-h-[44px]') &&
        enRejectBtn.classList.contains('min-h-[44px]'),
      'Both English buttons must enforce a minimum height of 44px'
    );
    assert.equal(
      enAcceptBtn.className,
      enRejectBtn.className,
      'Accept and Reject buttons must have identical visual prominence classes'
    );
    assert.equal(enEnv.doc.getElementById(CookieConsent.FOOTER_BTN_ID)?.textContent, 'Cookie Settings');

    // Filipino page (/tl/blog/...)
    const tlEnv = createSimEnv({
      pathname: '/tl/blog/paano-kuwentahin-ang-take-home-pay-sa-pilipinas/',
      htmlLang: 'tl-PH',
      navigatorLanguages: ['en-US'],
    });
    tlEnv.controller.init();

    assert.equal(
      tlEnv.doc.getElementById('cookieConsentHeading')?.textContent,
      'Mga Setting ng Cookie'
    );
    assert.equal(
      tlEnv.doc.getElementById('cookieConsentMessage')?.textContent,
      'Gumagamit kami ng Google Analytics upang maunawaan kung paano ginagamit ng mga bisita ang SuweldoTools at mapahusay ang website. Gagana lamang ang analytics kapag pumayag ka. Maaari mong baguhin ang iyong desisyon anumang oras.'
    );
    const tlAcceptBtn = tlEnv.doc.getElementById('cookieConsentAcceptBtn')!;
    const tlRejectBtn = tlEnv.doc.getElementById('cookieConsentRejectBtn')!;
    assert.equal(tlAcceptBtn.textContent, 'Tanggapin ang Cookies');
    assert.equal(tlRejectBtn.textContent, 'Tanggihan');
    assert.ok(
      tlAcceptBtn.classList.contains('min-h-[44px]') &&
        tlRejectBtn.classList.contains('min-h-[44px]'),
      'Both Filipino buttons must enforce a minimum height of 44px'
    );
    assert.equal(tlAcceptBtn.className, tlRejectBtn.className);
    assert.equal(
      tlEnv.doc.getElementById(CookieConsent.FOOTER_BTN_ID)?.textContent,
      'Mga Setting ng Cookie'
    );

    const enPrivacyHtml = fs.readFileSync(
      path.resolve(process.cwd(), 'privacy-policy/index.html'),
      'utf8'
    );
    const tlPrivacyHtml = fs.readFileSync(
      path.resolve(process.cwd(), 'tl/privacy-policy/index.html'),
      'utf8'
    );
    assert.ok(enPrivacyHtml.includes('<code>suweldotools_cookie_consent</code>'));
    assert.equal(enPrivacyHtml.includes('suweldotools_cookie_consent_v1'), false);
    assert.ok(tlPrivacyHtml.includes('<code>suweldotools_cookie_consent</code>'));
    assert.equal(tlPrivacyHtml.includes('suweldotools_cookie_consent_v1'), false);
  });

  it('14. Admin route (/admin) remains strictly excluded from GA4 and consent banner', () => {
    const startMs = Date.UTC(2026, 10, 10, 8, 0, 0);
    const adminEnv = createSimEnv({
      pathname: '/admin/',
      htmlLang: 'en-PH',
      initialStorage: {
        [CookieConsent.STORAGE_KEY]: JSON.stringify({
          status: 'accepted',
          timestamp: startMs,
          expiresAt: CookieConsent.addSixCalendarMonths(startMs),
          version: 1,
        }),
      },
    });

    const res = adminEnv.controller.init();
    assert.equal(res.state, 'excluded');
    assert.equal(adminEnv.networkRequests.length, 0);
    assert.equal(adminEnv.doc.getElementById(CookieConsent.BANNER_ID), null);
    assert.equal(adminEnv.doc.getElementById(CookieConsent.FOOTER_BTN_ID), null);

    const adminSourceHtml = fs.readFileSync(path.resolve(process.cwd(), 'admin/index.html'), 'utf8');
    assert.equal(adminSourceHtml.includes('G-E3Z69Z6Y0J'), false);
    assert.equal(adminSourceHtml.includes('cookie-consent.js'), false);
  });

  it('15. Generated English and Filipino blog pages and generator templates use the consent-aware implementation', () => {
    const generatorSource = fs.readFileSync(
      path.resolve(process.cwd(), 'scripts/generate-blog.ts'),
      'utf8'
    );
    assert.equal(
      generatorSource.includes('googletagmanager.com/gtag/js'),
      false,
      'scripts/generate-blog.ts must not contain unconditional gtag.js script tags'
    );
    assert.equal(
      generatorSource.includes("gtag('config'"),
      false,
      'scripts/generate-blog.ts must not contain inline gtag("config") calls'
    );
    assert.ok(
      generatorSource.includes('<script src="/js/cookie-consent.js" defer></script>'),
      'scripts/generate-blog.ts must include /js/cookie-consent.js'
    );
    assert.ok(
      generatorSource.includes('>Cookie Settings</button>') &&
        generatorSource.includes('>Mga Setting ng Cookie</button>'),
      'scripts/generate-blog.ts must include bilingual footer Cookie Settings triggers'
    );

    const enBlogHtml = fs.readFileSync(
      path.resolve(process.cwd(), 'blog/how-to-compute-take-home-pay-philippines/index.html'),
      'utf8'
    );
    const tlBlogHtml = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'tl/blog/paano-kuwentahin-ang-take-home-pay-sa-pilipinas/index.html'
      ),
      'utf8'
    );

    for (const [label, html] of [
      ['EN blog article', enBlogHtml],
      ['TL blog article', tlBlogHtml],
    ]) {
      assert.equal(
        html.includes('googletagmanager.com/gtag/js'),
        false,
        `${label} must not contain unconditional gtag.js`
      );
      assert.ok(
        html.includes('/js/cookie-consent.js'),
        `${label} must reference /js/cookie-consent.js`
      );
      assert.ok(
        html.includes('data-cookie-settings-trigger'),
        `${label} must include footer Cookie Settings trigger`
      );
    }
  });

  it('16. No unconditional GA4 snippet remains in source HTML or built dist/ HTML files', () => {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (!fs.existsSync(distDir)) {
      return;
    }

    function collectHtmlFiles(dir: string): string[] {
      const results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...collectHtmlFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.html')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const builtHtmlFiles = collectHtmlFiles(distDir);
    assert.ok(builtHtmlFiles.length >= 38, 'Expected at least 38 built HTML files in dist/');

    for (const filePath of builtHtmlFiles) {
      const rel = path.relative(distDir, filePath).replace(/\\/g, '/');
      const content = fs.readFileSync(filePath, 'utf8');

      assert.equal(
        content.includes('googletagmanager.com/gtag/js'),
        false,
        `dist/${rel} must not contain an unconditional gtag.js script tag`
      );
      assert.equal(
        content.includes("gtag('config', 'G-E3Z69Z6Y0J')"),
        false,
        `dist/${rel} must not contain an inline gtag('config', 'G-E3Z69Z6Y0J') call`
      );

      if (rel === 'admin/index.html' || rel === '404.html') {
        assert.equal(
          content.includes('/js/cookie-consent.js'),
          false,
          `dist/${rel} must remain excluded from cookie-consent.js`
        );
      } else {
        assert.ok(
          content.includes('/js/cookie-consent.js'),
          `dist/${rel} must load /js/cookie-consent.js`
        );
        assert.ok(
          content.includes('data-cookie-settings-trigger'),
          `dist/${rel} must include the footer Cookie Settings trigger`
        );
      }
    }
  });
});
