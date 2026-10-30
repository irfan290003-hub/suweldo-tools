/**
 * SuweldoTools — Accessible Mobile Navigation & Bilingual Language Controller
 * Handles:
 * 1. Mobile hamburger menu toggle, ARIA states, icon swapping (☰ / ✕),
 *    keyboard navigation (Escape), outside click dismissal, link click dismissal,
 *    conditional background scroll lock, and viewport resize cleanup.
 * 2. Language selector (English / Filipino) state persistence in localStorage,
 *    counterpart route resolution across all 16 routes, calculator state handoff
 *    across language switches, and non-intrusive Filipino preference offer.
 */
(function () {
  'use strict';

  var LANG_STORAGE_KEY = 'suweldotools_lang';
  var CALC_HANDOFF_KEY = 'suweldotools_calc_handoff';
  var BANNER_DISMISSED_KEY = 'suweldotools_lang_banner_dismissed';

  function safeGetStorage(storage, key) {
    try {
      return storage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSetStorage(storage, key, val) {
    try {
      storage.setItem(key, val);
    } catch (e) {
      // Ignore storage quota or private mode restrictions
    }
  }

  function isFilipinoDocument() {
    var htmlLang = (document.documentElement && document.documentElement.lang ? document.documentElement.lang : '').toLowerCase();
    var path = window.location ? window.location.pathname : '';
    return htmlLang.indexOf('tl') === 0 || htmlLang.indexOf('fil') === 0 || path === '/tl' || path.indexOf('/tl/') === 0;
  }

  function normalizePath(pathname) {
    var p = pathname || '/';
    p = p.replace(/\/index\.html$/i, '/');
    if (!p.startsWith('/')) {
      p = '/' + p;
    }
    if (!p.endsWith('/')) {
      p = p + '/';
    }
    return p;
  }

  function getRoutePair(pathname) {
    var norm = normalizePath(pathname);
    var isTl = norm === '/tl/' || norm.indexOf('/tl/') === 0;
    var enPath = isTl ? (norm.replace(/^\/tl(\/|$)/, '/') || '/') : norm;
    if (!enPath.startsWith('/')) {
      enPath = '/' + enPath;
    }
    if (!enPath.endsWith('/')) {
      enPath = enPath + '/';
    }
    var tlPath = enPath === '/' ? '/tl/' : '/tl' + enPath;
    return {
      isTl: isTl,
      currentLang: isTl ? 'tl' : 'en',
      enPath: enPath,
      tlPath: tlPath
    };
  }

  function browserPrefersFilipino() {
    try {
      var langs = [];
      if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
        langs = navigator.languages;
      } else if (navigator.language) {
        langs = [navigator.language];
      }
      for (var i = 0; i < langs.length; i++) {
        var code = String(langs[i] || '').toLowerCase();
        if (code === 'tl' || code.indexOf('tl-') === 0 || code === 'fil' || code.indexOf('fil-') === 0) {
          return true;
        }
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  function captureCalculatorState() {
    try {
      // 1. Take-Home Pay Calculator
      var basicInput = document.getElementById('basicSalary');
      if (basicInput) {
        var allowInput = document.getElementById('allowances');
        var mweCheck = document.getElementById('minWageEarner');
        var cutoffBtn = document.querySelector('[data-freq-toggle="cutoff"]');
        var isCutoff = cutoffBtn && cutoffBtn.getAttribute('aria-pressed') === 'true';
        return {
          calculator: 'take-home',
          basicSalary: basicInput.value,
          allowances: allowInput ? allowInput.value : '0',
          minWageEarner: mweCheck ? Boolean(mweCheck.checked) : false,
          displayFrequency: isCutoff ? 'cutoff' : 'monthly'
        };
      }

      // 2. 13th Month Pay Calculator
      var tmSalary = document.getElementById('tmMonthlySalary');
      if (tmSalary) {
        var tmMonths = document.getElementById('tmMonthsWorked');
        var tmCustom = document.getElementById('tmCustomTotalToggle');
        var tmExact = document.getElementById('tmExactTotal');
        var tmOther = document.getElementById('tmOtherBenefits');
        return {
          calculator: '13th-month',
          monthlySalary: tmSalary.value,
          monthsWorked: tmMonths ? tmMonths.value : '12',
          customTotalToggle: tmCustom ? Boolean(tmCustom.checked) : false,
          exactTotal: tmExact ? tmExact.value : '',
          otherBenefits: tmOther ? tmOther.value : '0'
        };
      }

      // 3. SSS Contribution Table
      var sssLookup = document.getElementById('lookupSalary');
      if (sssLookup) {
        var sssSearch = document.getElementById('tableSearchInput');
        var activeTabEl = document.querySelector('[data-filter-tab].bg-emerald-600');
        var activeFilterTab = activeTabEl ? activeTabEl.getAttribute('data-filter-tab') : 'all';
        return {
          calculator: 'sss-table',
          lookupSalary: sssLookup.value,
          tableSearch: sssSearch ? sssSearch.value : '',
          filterTab: activeFilterTab || 'all'
        };
      }

      // 4. PhilHealth Calculator
      var phSalary = document.getElementById('phSalaryInput');
      if (phSalary) {
        var phCutoffBtn = document.querySelector('[data-freq-toggle="cutoff"]');
        var isPhCutoff = phCutoffBtn && phCutoffBtn.getAttribute('aria-pressed') === 'true';
        return {
          calculator: 'philhealth',
          basicSalary: phSalary.value,
          frequency: isPhCutoff ? 'cutoff' : 'monthly'
        };
      }

      // 5. Overtime & Holiday Pay Calculator
      var otSalary = document.getElementById('otMonthlySalary');
      if (otSalary) {
        var otConv = document.getElementById('otConversionMethod');
        var otNormHrs = document.getElementById('otNormalHours');
        var otDayType = document.getElementById('otWorkdayType');
        var otHolElig = document.getElementById('otHolidayEligible');
        var otRegHrs = document.getElementById('otHoursWorked');
        var otOtHrs = document.getElementById('otOvertimeHours');
        var otNsdHrs = document.getElementById('otNightShiftHours');
        var otNsdOtHrs = document.getElementById('otNightOvertimeHours');
        return {
          calculator: 'overtime-holiday',
          monthlySalary: otSalary.value,
          conversionMethod: otConv ? otConv.value : '261_year',
          normalHours: otNormHrs ? otNormHrs.value : '8',
          workdayType: otDayType ? otDayType.value : 'ordinary',
          holidayEligible: otHolElig ? Boolean(otHolElig.checked) : true,
          regularHours: otRegHrs ? otRegHrs.value : '8',
          overtimeHours: otOtHrs ? otOtHrs.value : '2',
          nightShiftHours: otNsdHrs ? otNsdHrs.value : '0',
          nightOvertimeHours: otNsdOtHrs ? otNsdOtHrs.value : '0'
        };
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  function updateDesktopSwitcherState(selectedLang) {
    var headerEl = document.querySelector('header');
    if (!headerEl) return;
    var mobileDrawer = document.getElementById('mobileNavigationPanel');
    var groups = headerEl.querySelectorAll('[role="group"][aria-label]');

    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      // Keep mobile navigation panel drawer controls untouched
      if (mobileDrawer && mobileDrawer.contains(group)) continue;

      var enLink = group.querySelector('[data-lang-switch="en"]');
      var tlLink = group.querySelector('[data-lang-switch="tl"]');
      if (!enLink || !tlLink) continue;

      var isCompact = enLink.classList.contains('min-h-[36px]') || tlLink.classList.contains('min-h-[36px]');

      if (selectedLang === 'tl') {
        enLink.removeAttribute('aria-current');
        tlLink.setAttribute('aria-current', 'page');
        if (isCompact) {
          enLink.className = 'inline-flex min-h-[36px] min-w-[36px] items-center justify-center px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-emerald-700 transition';
          tlLink.className = 'inline-flex min-h-[36px] min-w-[36px] items-center justify-center px-2.5 py-1.5 rounded-lg bg-white text-emerald-700 shadow-2xs';
        } else {
          enLink.className = 'px-2.5 py-1 rounded-lg text-slate-600 hover:text-slate-900 transition whitespace-nowrap';
          tlLink.className = 'px-2.5 py-1 rounded-lg bg-white text-emerald-700 shadow-2xs transition whitespace-nowrap';
        }
      } else {
        tlLink.removeAttribute('aria-current');
        enLink.setAttribute('aria-current', 'page');
        if (isCompact) {
          enLink.className = 'inline-flex min-h-[36px] min-w-[36px] items-center justify-center px-2.5 py-1.5 rounded-lg bg-white text-emerald-700 shadow-2xs';
          tlLink.className = 'inline-flex min-h-[36px] min-w-[36px] items-center justify-center px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-emerald-700 transition';
        } else {
          enLink.className = 'px-2.5 py-1 rounded-lg bg-white text-emerald-700 shadow-2xs transition whitespace-nowrap';
          tlLink.className = 'px-2.5 py-1 rounded-lg text-slate-600 hover:text-slate-900 transition whitespace-nowrap';
        }
      }
    }
  }

  function initLanguageSupport() {
    var routeInfo = getRoutePair(window.location.pathname);
    var explicitLang = safeGetStorage(window.localStorage, 'suweldotools_explicit_lang');
    var savedLang = safeGetStorage(window.localStorage, LANG_STORAGE_KEY);
    var searchAndHash = (window.location.search || '') + (window.location.hash || '');

    // Default to EN highlighted on both English and Filipino pages unless explicitly selected
    if (explicitLang === 'tl') {
      updateDesktopSwitcherState('tl');
    } else {
      updateDesktopSwitcherState('en');
    }

    // Update all language switcher links to point to exact counterpart route
    var langLinks = document.querySelectorAll('[data-lang-switch]');
    for (var i = 0; i < langLinks.length; i++) {
      (function (link) {
        if (link.getAttribute('data-lang-bound') === 'true') return;
        link.setAttribute('data-lang-bound', 'true');

        var targetLang = link.getAttribute('data-lang-switch');
        var targetPath = (targetLang === 'tl' ? routeInfo.tlPath : routeInfo.enPath) + searchAndHash;
        if (link.tagName === 'A') {
          link.setAttribute('href', targetPath);
        }

        link.addEventListener('click', function (e) {
          safeSetStorage(window.localStorage, LANG_STORAGE_KEY, targetLang);
          safeSetStorage(window.localStorage, 'suweldotools_explicit_lang', targetLang);
          var state = captureCalculatorState();
          if (state) {
            safeSetStorage(window.sessionStorage, CALC_HANDOFF_KEY, JSON.stringify(state));
          }
          updateDesktopSwitcherState(targetLang);
          if (link.tagName !== 'A') {
            e.preventDefault();
            window.location.href = targetPath;
          }
        });
      })(langLinks[i]);
    }

    // Offer Filipino non-intrusively on English pages if browser prefers Filipino or user previously chose Filipino
    var bannerDismissed = safeGetStorage(window.sessionStorage, BANNER_DISMISSED_KEY) === 'true';
    var shouldOfferFilipino =
      !routeInfo.isTl &&
      !bannerDismissed &&
      (savedLang === 'tl' || (!savedLang && browserPrefersFilipino()));

    if (shouldOfferFilipino) {
      var headerEl = document.querySelector('header');
      if (headerEl && !document.getElementById('langOfferBanner')) {
        var banner = document.createElement('div');
        banner.id = 'langOfferBanner';
        banner.setAttribute('role', 'region');
        banner.setAttribute('aria-label', 'Wika / Language preference');
        banner.className = 'bg-emerald-900 text-white text-xs border-b border-emerald-800';
        banner.innerHTML =
          '<div class="mx-auto max-w-6xl px-3 sm:px-6 lg:px-8 py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">' +
          '<p class="font-medium text-emerald-50">Available in Filipino: Gusto mo bang buksan ang pahinang ito sa wikang <strong>Filipino (Tagalog)</strong>?</p>' +
          '<div class="flex flex-wrap items-center gap-2 shrink-0">' +
          '<a href="' + (routeInfo.tlPath + searchAndHash) + '" id="langOfferAcceptBtn" class="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold transition whitespace-nowrap">Lumipat sa Filipino &rarr;</a>' +
          '<button type="button" id="langOfferDismissBtn" class="px-2.5 py-1.5 rounded-lg bg-emerald-800/80 hover:bg-emerald-800 text-emerald-100 font-semibold transition cursor-pointer whitespace-nowrap">Stay in English</button>' +
          '</div>' +
          '</div>';
        headerEl.insertAdjacentElement('afterend', banner);

        var acceptBtn = document.getElementById('langOfferAcceptBtn');
        var dismissBtn = document.getElementById('langOfferDismissBtn');
        if (acceptBtn) {
          acceptBtn.addEventListener('click', function () {
            safeSetStorage(window.localStorage, LANG_STORAGE_KEY, 'tl');
            var state = captureCalculatorState();
            if (state) {
              safeSetStorage(window.sessionStorage, CALC_HANDOFF_KEY, JSON.stringify(state));
            }
          });
        }
        if (dismissBtn) {
          dismissBtn.addEventListener('click', function () {
            safeSetStorage(window.localStorage, LANG_STORAGE_KEY, 'en');
            safeSetStorage(window.sessionStorage, BANNER_DISMISSED_KEY, 'true');
            banner.remove();
          });
        }
      }
    }
  }

  function initMobileNav() {
    var toggleBtn =
      document.querySelector('[data-mobile-menu-toggle]') ||
      document.getElementById('mobile-menu-btn');
    var menuPanel =
      document.getElementById('mobileNavigationPanel') ||
      document.querySelector('[data-mobile-menu]') ||
      document.getElementById('mobile-menu-panel');

    if (!toggleBtn || !menuPanel) return;
    if (toggleBtn.getAttribute('data-mobile-nav-bound') === 'true') return;
    toggleBtn.setAttribute('data-mobile-nav-bound', 'true');

    var openIcon =
      toggleBtn.querySelector('[data-mobile-menu-open-icon]') ||
      toggleBtn.querySelector('[data-menu-icon="open"]') ||
      document.getElementById('mobile-menu-icon-open');
    var closeIcon =
      toggleBtn.querySelector('[data-mobile-menu-close-icon]') ||
      toggleBtn.querySelector('[data-menu-icon="close"]') ||
      document.getElementById('mobile-menu-icon-close');
    var headerEl = toggleBtn.closest('header');
    var isTl = isFilipinoDocument();

    // Find or dynamically create backdrop overlay if not present in DOM
    var backdropEl =
      document.getElementById('mobileMenuBackdrop') ||
      (headerEl ? headerEl.querySelector('[data-mobile-menu-backdrop]') : null) ||
      document.querySelector('[data-mobile-menu-backdrop]');

    if (!backdropEl && headerEl) {
      backdropEl = document.createElement('div');
      backdropEl.id = 'mobileMenuBackdrop';
      backdropEl.setAttribute('data-mobile-menu-backdrop', '');
      backdropEl.setAttribute('aria-hidden', 'true');
      backdropEl.className = 'hidden fixed inset-0 top-16 bg-slate-900/40 backdrop-blur-xs z-40';
      headerEl.insertBefore(backdropEl, menuPanel);
    }

    // Ensure menuPanel has mobile drawer positioning: viewport-fixed attached below header, independent scrollable
    menuPanel.classList.add(
      'fixed',
      'inset-x-0',
      'top-16',
      'z-50',
      'bg-white',
      'border-b',
      'border-slate-200',
      'shadow-xl',
      'max-h-[calc(100vh-4rem)]',
      'max-h-[calc(100dvh-4rem)]',
      'overflow-y-auto',
      'overscroll-contain'
    );

    // Ensure aria-controls matches the actual panel ID
    if (menuPanel.id) {
      toggleBtn.setAttribute('aria-controls', menuPanel.id);
    }

    var savedScrollY = 0;
    var isScrollLocked = false;
    var closeTransitionTimeout = null;

    function lockScroll() {
      if (isScrollLocked) return;
      savedScrollY =
        window.pageYOffset ||
        (document.documentElement ? document.documentElement.scrollTop : 0) ||
        (document.body ? document.body.scrollTop : 0) ||
        0;
      isScrollLocked = true;

      // Keep header firmly pinned to top of visible viewport while menu is open
      if (headerEl) {
        headerEl.classList.add('mobile-nav-active');
      }
      if (document.documentElement) {
        document.documentElement.classList.add('mobile-nav-locked');
      }
      if (document.body) {
        document.body.classList.add('mobile-nav-locked');
      }
    }

    function unlockScroll() {
      if (!isScrollLocked) return;
      isScrollLocked = false;

      if (headerEl) {
        headerEl.classList.remove('mobile-nav-active');
      }
      if (document.documentElement) {
        document.documentElement.classList.remove('mobile-nav-locked');
      }
      if (document.body) {
        document.body.classList.remove('mobile-nav-locked');
      }

      // Restore user previous scroll position with zero jumps
      if (typeof window.scrollTo === 'function') {
        window.scrollTo(0, savedScrollY);
      }
    }

    function isMotionReduced() {
      try {
        return (
          window.matchMedia &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        );
      } catch (e) {
        return false;
      }
    }

    function setMenuOpen(isOpen) {
      if (closeTransitionTimeout) {
        clearTimeout(closeTransitionTimeout);
        closeTransitionTimeout = null;
      }

      toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      toggleBtn.setAttribute(
        'aria-label',
        isOpen
          ? (isTl ? 'Isara ang menu ng nabigasyon' : 'Close navigation menu')
          : (isTl ? 'Buksan ang menu ng nabigasyon' : 'Open navigation menu')
      );

      var reducedMotion = isMotionReduced();

      if (isOpen) {
        lockScroll();

        // Reveal backdrop and drawer in visible viewport
        if (backdropEl) {
          backdropEl.classList.remove('hidden');
          backdropEl.style.opacity = reducedMotion ? '1' : '0';
        }

        menuPanel.classList.remove('hidden');
        menuPanel.removeAttribute('hidden');
        menuPanel.style.opacity = reducedMotion ? '1' : '0';
        menuPanel.style.transform = reducedMotion ? 'none' : 'translateY(-8px)';

        if (openIcon) openIcon.classList.add('hidden');
        if (closeIcon) closeIcon.classList.remove('hidden');

        if (!reducedMotion) {
          // Double-rAF ensures CSS transitions trigger reliably after display un-hide
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              if (backdropEl) {
                backdropEl.style.opacity = '1';
              }
              menuPanel.style.opacity = '1';
              menuPanel.style.transform = 'translateY(0)';
            });
          });
        }
      } else {
        if (openIcon) openIcon.classList.remove('hidden');
        if (closeIcon) closeIcon.classList.add('hidden');

        if (reducedMotion) {
          if (backdropEl) {
            backdropEl.classList.add('hidden');
            backdropEl.style.opacity = '';
          }
          menuPanel.classList.add('hidden');
          menuPanel.style.opacity = '';
          menuPanel.style.transform = '';
          unlockScroll();
        } else {
          // Smooth slide-up & fade-out animation
          if (backdropEl) {
            backdropEl.style.opacity = '0';
          }
          menuPanel.style.opacity = '0';
          menuPanel.style.transform = 'translateY(-8px)';

          closeTransitionTimeout = setTimeout(function () {
            if (!isMenuOpen()) {
              if (backdropEl) {
                backdropEl.classList.add('hidden');
                backdropEl.style.opacity = '';
              }
              menuPanel.classList.add('hidden');
              menuPanel.style.opacity = '';
              menuPanel.style.transform = '';
              unlockScroll();
            }
          }, 200);
        }
      }
    }

    function isMenuOpen() {
      return toggleBtn.getAttribute('aria-expanded') === 'true';
    }

    // Initialize closed state and ARIA label consistently
    setMenuOpen(false);

    toggleBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setMenuOpen(!isMenuOpen());
    });

    // Dismiss on backdrop click or touch
    if (backdropEl) {
      backdropEl.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(false);
      });
      backdropEl.addEventListener('touchmove', function (e) {
        e.preventDefault();
      }, { passive: false });
    }

    // Close when clicking any link inside the mobile panel
    var navLinks = menuPanel.querySelectorAll('a');
    for (var i = 0; i < navLinks.length; i++) {
      navLinks[i].addEventListener('click', function () {
        setMenuOpen(false);
        unlockScroll();
      });
    }

    // Close on Escape key and return focus to toggle button
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && isMenuOpen()) {
        setMenuOpen(false);
        toggleBtn.focus();
      }
    });

    // Close when clicking/tapping outside the header
    document.addEventListener('click', function (e) {
      if (isMenuOpen() && headerEl && !headerEl.contains(e.target)) {
        setMenuOpen(false);
      }
    });

    // Both English and Filipino use the compact drawer menu across all screen widths.
  }

  function initAll() {
    initMobileNav();
    initLanguageSupport();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
