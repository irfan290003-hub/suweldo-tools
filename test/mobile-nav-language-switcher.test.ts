import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const MOBILE_NAV_PATH = path.resolve(process.cwd(), 'public/js/mobile-nav.js');
const mobileNavCode = fs.readFileSync(MOBILE_NAV_PATH, 'utf8');

interface MockAnchor {
  tagName: string;
  href: string;
  id?: string;
  attrs: Record<string, string>;
  classList: { contains: (cls: string) => boolean };
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  addEventListener: (event: string, cb: (e: any) => void) => void;
}

function createMockAnchor(lang: 'en' | 'tl', initialHref: string): MockAnchor {
  const attrs: Record<string, string> = {
    'data-lang-switch': lang,
  };
  if (initialHref) {
    attrs.href = initialHref;
  }
  return {
    tagName: 'A',
    href: initialHref,
    attrs,
    classList: {
      contains: () => false,
    },
    getAttribute(name: string) {
      return name in this.attrs ? this.attrs[name] : null;
    },
    setAttribute(name: string, value: string) {
      this.attrs[name] = String(value);
      if (name === 'href') {
        this.href = String(value);
      }
    },
    removeAttribute(name: string) {
      delete this.attrs[name];
    },
    addEventListener() {},
  };
}

function runMobileNavInSandbox(options: {
  pathname: string;
  search?: string;
  hash?: string;
  htmlLang?: string;
  enHref?: string;
  tlHref?: string;
  includeLangLinks?: boolean;
  browserLanguages?: string[];
  savedLang?: string | null;
}) {
  const includeLinks = options.includeLangLinks !== false;
  const enDesktop = createMockAnchor('en', options.enHref ?? '');
  const tlDesktop = createMockAnchor('tl', options.tlHref ?? '');
  const enCompact = createMockAnchor('en', options.enHref ?? '');
  const tlCompact = createMockAnchor('tl', options.tlHref ?? '');
  const langLinks = includeLinks ? [enDesktop, tlDesktop, enCompact, tlCompact] : [];

  let injectedBannerHtml = '';
  const elementsById: Record<string, any> = {};

  const headerEl = {
    querySelectorAll: () => [],
    insertAdjacentElement(_pos: string, bannerEl: any) {
      injectedBannerHtml = bannerEl.innerHTML || '';
      const acceptMatch = injectedBannerHtml.match(
        /<a\s+href="([^"]+)"\s+id="langOfferAcceptBtn"/
      );
      if (acceptMatch) {
        elementsById.langOfferAcceptBtn = {
          id: 'langOfferAcceptBtn',
          href: acceptMatch[1],
          getAttribute: (k: string) => (k === 'href' ? acceptMatch[1] : null),
          addEventListener() {},
        };
      }
    },
  };

  const localStore: Record<string, string> = {};
  if (options.savedLang) {
    localStore.suweldotools_lang = options.savedLang;
  }
  const sessionStore: Record<string, string> = {};

  const documentMock = {
    readyState: 'complete',
    documentElement: {
      lang: options.htmlLang || (options.pathname.startsWith('/tl/') ? 'tl-PH' : 'en-PH'),
      classList: { add() {}, remove() {} },
    },
    body: {
      classList: { add() {}, remove() {} },
    },
    getElementById(id: string) {
      return elementsById[id] || null;
    },
    querySelector(selector: string) {
      if (selector === 'header') return headerEl;
      if (selector === 'a[data-lang-switch="en"]' || selector === '[data-lang-switch="en"]') {
        return includeLinks ? enDesktop : null;
      }
      if (selector === 'a[data-lang-switch="tl"]' || selector === '[data-lang-switch="tl"]') {
        return includeLinks ? tlDesktop : null;
      }
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === '[data-lang-switch]') {
        return langLinks;
      }
      return [];
    },
    createElement(tag: string) {
      return {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        innerHTML: '',
        setAttribute(k: string, v: string) {
          if (k === 'id') this.id = v;
        },
        remove() {},
      };
    },
    addEventListener() {},
  };

  const windowMock: any = {
    location: {
      pathname: options.pathname,
      search: options.search || '',
      hash: options.hash || '',
      href: `https://suweldotools.com${options.pathname}${options.search || ''}${options.hash || ''}`,
    },
    localStorage: {
      getItem: (k: string) => (k in localStore ? localStore[k] : null),
      setItem: (k: string, v: string) => {
        localStore[k] = String(v);
      },
    },
    sessionStorage: {
      getItem: (k: string) => (k in sessionStore ? sessionStore[k] : null),
      setItem: (k: string, v: string) => {
        sessionStore[k] = String(v);
      },
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
  };
  windowMock.window = windowMock;
  windowMock.document = documentMock;

  const sandbox = {
    window: windowMock,
    document: documentMock,
    navigator: {
      languages: options.browserLanguages || ['en-PH', 'en-US'],
      language: (options.browserLanguages && options.browserLanguages[0]) || 'en-PH',
    },
  };

  vm.runInNewContext(mobileNavCode, sandbox);

  return {
    enDesktop,
    tlDesktop,
    enCompact,
    tlCompact,
    langOfferAcceptBtn: elementsById.langOfferAcceptBtn || null,
    injectedBannerHtml,
  };
}

describe('Issue 2B — Blog Article & Static Page Language Switcher (public/js/mobile-nav.js)', () => {
  it('Case 1 — No Filipino translation: preserves /tl/blog/ on English blog article', () => {
    const articleHtml = fs.readFileSync(
      path.resolve(process.cwd(), 'blog/how-to-compute-take-home-pay-philippines/index.html'),
      'utf8'
    );
    const tlMatch = articleHtml.match(/<a\s+href="([^"]+)"\s+data-lang-switch="tl"/);
    const enMatch = articleHtml.match(/<a\s+href="([^"]+)"\s+data-lang-switch="en"/);
    assert.ok(tlMatch, 'Generated article HTML should contain a[data-lang-switch="tl"]');
    assert.ok(enMatch, 'Generated article HTML should contain a[data-lang-switch="en"]');
    assert.equal(tlMatch[1], '/tl/blog/');

    const res = runMobileNavInSandbox({
      pathname: '/blog/how-to-compute-take-home-pay-philippines/',
      enHref: enMatch[1],
      tlHref: tlMatch[1],
    });

    assert.equal(res.tlDesktop.getAttribute('href'), '/tl/blog/');
    assert.equal(res.tlCompact.getAttribute('href'), '/tl/blog/');
    assert.equal(
      res.enDesktop.getAttribute('href'),
      '/blog/how-to-compute-take-home-pay-philippines/'
    );
  });

  it('Case 2 — Filipino translation with a different slug: preserves exact /tl/blog/tagalog-article-slug/ URL', () => {
    const res = runMobileNavInSandbox({
      pathname: '/blog/how-to-compute-take-home-pay-philippines/',
      enHref: '/blog/how-to-compute-take-home-pay-philippines/',
      tlHref: '/tl/blog/tagalog-article-slug/',
    });

    assert.equal(res.tlDesktop.getAttribute('href'), '/tl/blog/tagalog-article-slug/');
    assert.equal(res.tlCompact.getAttribute('href'), '/tl/blog/tagalog-article-slug/');
    assert.equal(
      res.enDesktop.getAttribute('href'),
      '/blog/how-to-compute-take-home-pay-philippines/'
    );
  });

  it('Case 3 — Filipino article switching to English: preserves exact /blog/english-article-slug/ URL', () => {
    const res = runMobileNavInSandbox({
      pathname: '/tl/blog/tagalog-article-slug/',
      htmlLang: 'tl-PH',
      enHref: '/blog/english-article-slug/',
      tlHref: '/tl/blog/tagalog-article-slug/',
    });

    assert.equal(res.enDesktop.getAttribute('href'), '/blog/english-article-slug/');
    assert.equal(res.enCompact.getAttribute('href'), '/blog/english-article-slug/');
    assert.equal(res.tlDesktop.getAttribute('href'), '/tl/blog/tagalog-article-slug/');
  });

  it('Case 4 — Language offer button (#langOfferAcceptBtn) uses authoritative destination and safe fallback', () => {
    // 4a: Untranslated English article -> #langOfferAcceptBtn points to /tl/blog/
    const untranslatedOffer = runMobileNavInSandbox({
      pathname: '/blog/how-to-compute-take-home-pay-philippines/',
      enHref: '/blog/how-to-compute-take-home-pay-philippines/',
      tlHref: '/tl/blog/',
      browserLanguages: ['tl-PH', 'fil-PH'],
    });
    assert.ok(untranslatedOffer.langOfferAcceptBtn, '#langOfferAcceptBtn should be rendered');
    assert.equal(untranslatedOffer.langOfferAcceptBtn.getAttribute('href'), '/tl/blog/');

    // 4b: Translated English article -> #langOfferAcceptBtn points to /tl/blog/tagalog-article-slug/
    const translatedOffer = runMobileNavInSandbox({
      pathname: '/blog/how-to-compute-take-home-pay-philippines/',
      enHref: '/blog/how-to-compute-take-home-pay-philippines/',
      tlHref: '/tl/blog/tagalog-article-slug/',
      browserLanguages: ['tl-PH'],
    });
    assert.ok(translatedOffer.langOfferAcceptBtn, '#langOfferAcceptBtn should be rendered');
    assert.equal(
      translatedOffer.langOfferAcceptBtn.getAttribute('href'),
      '/tl/blog/tagalog-article-slug/'
    );

    // 4c: Missing authoritative hrefs -> falls back safely to /blog/ and /tl/blog/
    const fallbackOffer = runMobileNavInSandbox({
      pathname: '/blog/orphan-article-slug/',
      enHref: '',
      tlHref: '',
      browserLanguages: ['tl-PH'],
    });
    assert.equal(fallbackOffer.enDesktop.getAttribute('href'), '/blog/');
    assert.equal(fallbackOffer.tlDesktop.getAttribute('href'), '/tl/blog/');
    assert.ok(fallbackOffer.langOfferAcceptBtn);
    assert.equal(fallbackOffer.langOfferAcceptBtn.getAttribute('href'), '/tl/blog/');
  });

  it('Case 5 — Existing static pages and blog listing pages preserve normal language switching and query/hash', () => {
    const enCalc = runMobileNavInSandbox({
      pathname: '/take-home-pay-calculator-philippines/',
      search: '?ref=nav',
      hash: '#results',
      enHref: '/take-home-pay-calculator-philippines/',
      tlHref: '/tl/take-home-pay-calculator-philippines/',
      browserLanguages: ['tl-PH'],
    });
    assert.equal(
      enCalc.enDesktop.getAttribute('href'),
      '/take-home-pay-calculator-philippines/?ref=nav#results'
    );
    assert.equal(
      enCalc.tlDesktop.getAttribute('href'),
      '/tl/take-home-pay-calculator-philippines/?ref=nav#results'
    );
    assert.equal(
      enCalc.langOfferAcceptBtn?.getAttribute('href'),
      '/tl/take-home-pay-calculator-philippines/?ref=nav#results'
    );

    const tlCalc = runMobileNavInSandbox({
      pathname: '/tl/final-pay-calculator-philippines/',
      htmlLang: 'tl-PH',
      enHref: '/final-pay-calculator-philippines/',
      tlHref: '/tl/final-pay-calculator-philippines/',
    });
    assert.equal(tlCalc.enDesktop.getAttribute('href'), '/final-pay-calculator-philippines/');
    assert.equal(tlCalc.tlDesktop.getAttribute('href'), '/tl/final-pay-calculator-philippines/');

    const blogIndex = runMobileNavInSandbox({
      pathname: '/blog/',
      enHref: '/blog/',
      tlHref: '/tl/blog/',
    });
    assert.equal(blogIndex.enDesktop.getAttribute('href'), '/blog/');
    assert.equal(blogIndex.tlDesktop.getAttribute('href'), '/tl/blog/');
  });
});
