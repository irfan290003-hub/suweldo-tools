/**
 * SuweldoTools — Calculators Directory Progressive Enhancement Controller
 * Consumes the single authoritative calculator metadata registry (`./data/calculators-registry`)
 * to provide instant search, category filtering, accurate live calculator counts,
 * Popular/Recently Added visibility management, and Empty State reset behavior
 * while keeping all calculator cards and links in the static HTML source.
 */

import {
  CALCULATOR_CATEGORIES,
  CALCULATORS_REGISTRY,
  type CalculatorCategoryId,
  type CalculatorLanguage,
  getLiveCategoryCounts,
  getTotalLiveCalculatorCount,
  matchesCalculatorSearch,
} from './data/calculators-registry';

type FilterCategoryValue = 'all' | CalculatorCategoryId;

function detectDocumentLanguage(): CalculatorLanguage {
  const htmlLang = (document.documentElement?.lang || '').toLowerCase();
  const pathname = window.location?.pathname || '/';
  if (
    htmlLang.startsWith('tl') ||
    htmlLang.startsWith('fil') ||
    pathname === '/tl' ||
    pathname.startsWith('/tl/')
  ) {
    return 'tl';
  }
  return 'en';
}

function isValidCategoryFilter(value: string | null): value is FilterCategoryValue {
  if (!value) return false;
  if (value === 'all') return true;
  return CALCULATOR_CATEGORIES.some((cat) => cat.id === value);
}

function initCalculatorsDirectory(): void {
  const directoryRoot = document.getElementById('calculators-directory-root');
  if (!directoryRoot) return;

  const lang = detectDocumentLanguage();
  const liveCounts = getLiveCategoryCounts();
  const totalLiveCount = getTotalLiveCalculatorCount();

  // 1. Synchronize all live count badges from the single source of truth
  //    (Coming Soon tools never contribute to these counts)
  const totalCountEls = document.querySelectorAll<HTMLElement>('[data-total-calculators-count]');
  totalCountEls.forEach((el) => {
    el.textContent = String(totalLiveCount);
  });

  const categoryCountEls = document.querySelectorAll<HTMLElement>('[data-category-count]');
  categoryCountEls.forEach((el) => {
    const key = el.getAttribute('data-category-count') as FilterCategoryValue | null;
    if (key && key in liveCounts) {
      el.textContent = String(liveCounts[key]);
    }
  });

  // 2. Locate interactive DOM controls
  const searchInput = document.getElementById('calculator-search-input') as HTMLInputElement | null;
  const clearSearchBtn = document.getElementById('clear-calculator-search') as HTMLButtonElement | null;
  const filterButtons = Array.from(
    directoryRoot.querySelectorAll<HTMLButtonElement>('[data-category-filter]')
  );
  const categorySections = Array.from(
    directoryRoot.querySelectorAll<HTMLElement>('[data-category-section]')
  );
  const popularSection = document.getElementById('popular-calculators-section');
  const recentlyAddedSection = document.getElementById('recently-added-section');
  const comingSoonSection = document.getElementById('coming-soon-calculators-section');
  const emptyStateEl = document.getElementById('directory-empty-state');
  const emptyStateQueryText = document.getElementById('directory-empty-query');
  const resetFiltersBtn = document.getElementById('reset-directory-filters') as HTMLButtonElement | null;
  const resultsStatusEl = document.getElementById('directory-results-status');

  let activeCategory: FilterCategoryValue = 'all';
  let currentQuery = '';

  // Read optional initial URL query parameters (`?category=...` or `?q=...`)
  try {
    const params = new URLSearchParams(window.location.search);
    const paramCategory = params.get('category');
    const paramQuery = params.get('q');
    if (isValidCategoryFilter(paramCategory)) {
      activeCategory = paramCategory;
    }
    if (paramQuery && paramQuery.trim()) {
      currentQuery = paramQuery.trim();
      if (searchInput) {
        searchInput.value = currentQuery;
      }
    }
  } catch {
    // Ignore URLSearchParams errors in restricted environments
  }

  function updateFilterButtonStyles(): void {
    filterButtons.forEach((btn) => {
      const btnCategory = btn.getAttribute('data-category-filter') as FilterCategoryValue | null;
      const isSelected = btnCategory === activeCategory;
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

      const badgeEl = btn.querySelector<HTMLElement>('[data-category-count]');

      if (isSelected) {
        btn.className =
          'inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs sm:text-sm font-bold text-white shadow-xs transition cursor-pointer';
        if (badgeEl) {
          badgeEl.className =
            'inline-flex items-center justify-center rounded-full bg-emerald-700/80 px-2 py-0.5 text-[11px] font-bold text-emerald-50 tabular-nums';
        }
      } else {
        btn.className =
          'inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40 px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 transition cursor-pointer';
        if (badgeEl) {
          badgeEl.className =
            'inline-flex items-center justify-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 tabular-nums';
        }
      }
    });
  }

  function formatResultsSummary(matchedLiveCount: number): string {
    const activeCatObj =
      activeCategory === 'all'
        ? null
        : CALCULATOR_CATEGORIES.find((cat) => cat.id === activeCategory);

    if (lang === 'tl') {
      if (currentQuery && activeCatObj) {
        return `Nagpapakita ng ${matchedLiveCount} sa ${totalLiveCount} aktibong calculator sa "${activeCatObj.label.tl}" para sa "${currentQuery}"`;
      }
      if (currentQuery) {
        return `Nagpapakita ng ${matchedLiveCount} sa ${totalLiveCount} aktibong calculator para sa "${currentQuery}"`;
      }
      if (activeCatObj) {
        return `Nagpapakita ng ${matchedLiveCount} aktibong calculator sa kategoryang ${activeCatObj.label.tl}`;
      }
      return `Nagpapakita ng lahat ng ${totalLiveCount} aktibong calculator`;
    }

    if (currentQuery && activeCatObj) {
      return `Showing ${matchedLiveCount} of ${totalLiveCount} live calculators in "${activeCatObj.label.en}" matching "${currentQuery}"`;
    }
    if (currentQuery) {
      return `Showing ${matchedLiveCount} of ${totalLiveCount} live calculators matching "${currentQuery}"`;
    }
    if (activeCatObj) {
      return `Showing ${matchedLiveCount} live ${matchedLiveCount === 1 ? 'calculator' : 'calculators'} in ${activeCatObj.label.en}`;
    }
    return `Showing all ${totalLiveCount} live calculators`;
  }

  function applyFilters(): void {
    const normalizedQuery = currentQuery.trim();
    const isDefaultUnfilteredView = activeCategory === 'all' && normalizedQuery === '';

    if (clearSearchBtn) {
      if (normalizedQuery.length > 0) {
        clearSearchBtn.classList.remove('hidden');
      } else {
        clearSearchBtn.classList.add('hidden');
      }
    }

    // Show Popular & Recently Added highlight strips only in the default unfiltered view
    // so category filters and search queries immediately surface the matching category cards.
    if (popularSection) {
      popularSection.classList.toggle('hidden', !isDefaultUnfilteredView);
    }
    if (recentlyAddedSection) {
      recentlyAddedSection.classList.toggle('hidden', !isDefaultUnfilteredView);
    }

    // Evaluate which live calculators match both the active category and search query
    const matchedLiveIds = new Set<string>();
    const matchedComingSoonIds = new Set<string>();

    for (const tool of CALCULATORS_REGISTRY) {
      const categoryMatches = activeCategory === 'all' || tool.category === activeCategory;
      const searchMatches = matchesCalculatorSearch(tool, normalizedQuery, lang);

      if (categoryMatches && searchMatches) {
        if (tool.status === 'live') {
          matchedLiveIds.add(tool.id);
        } else {
          matchedComingSoonIds.add(tool.id);
        }
      }
    }

    // Update visibility of each category section and its live calculator cards
    categorySections.forEach((sectionEl) => {
      const sectionCategoryId = sectionEl.getAttribute(
        'data-category-section'
      ) as CalculatorCategoryId | null;
      const cardsInSection = Array.from(
        sectionEl.querySelectorAll<HTMLElement>('[data-calculator-card]')
      );

      let visibleLiveCardsInSection = 0;
      cardsInSection.forEach((cardEl) => {
        const cardId = cardEl.getAttribute('data-calculator-card');
        const isVisible = Boolean(cardId && matchedLiveIds.has(cardId));
        cardEl.classList.toggle('hidden', !isVisible);
        if (isVisible) {
          visibleLiveCardsInSection += 1;
        }
      });

      const sectionCategoryMatches =
        activeCategory === 'all' || sectionCategoryId === activeCategory;
      const shouldShowSection = sectionCategoryMatches && visibleLiveCardsInSection > 0;
      sectionEl.classList.toggle('hidden', !shouldShowSection);
    });

    // Update Coming Soon section visibility separately (never counts toward matchedLiveIds)
    if (comingSoonSection) {
      const comingSoonCards = Array.from(
        comingSoonSection.querySelectorAll<HTMLElement>('[data-coming-soon-card]')
      );
      let visibleComingSoon = 0;
      comingSoonCards.forEach((cardEl) => {
        const cardId = cardEl.getAttribute('data-coming-soon-card');
        const isVisible = Boolean(cardId && matchedComingSoonIds.has(cardId));
        cardEl.classList.toggle('hidden', !isVisible);
        if (isVisible) {
          visibleComingSoon += 1;
        }
      });
      comingSoonSection.classList.toggle('hidden', visibleComingSoon === 0);
    }

    // Update status summary text
    const matchedLiveCount = matchedLiveIds.size;
    if (resultsStatusEl) {
      resultsStatusEl.textContent = formatResultsSummary(matchedLiveCount);
    }

    // Toggle Empty Search State when zero live calculators match
    if (emptyStateEl) {
      const showEmptyState = matchedLiveCount === 0;
      emptyStateEl.classList.toggle('hidden', !showEmptyState);
      if (showEmptyState && emptyStateQueryText) {
        emptyStateQueryText.textContent = normalizedQuery
          ? `"${normalizedQuery}"`
          : lang === 'tl'
            ? 'napiling filter'
            : 'selected filter';
      }
    }

    updateFilterButtonStyles();
  }

  function resetAllFilters(focusSearch = false): void {
    activeCategory = 'all';
    currentQuery = '';
    if (searchInput) {
      searchInput.value = '';
      if (focusSearch) {
        searchInput.focus();
      }
    }
    applyFilters();
  }

  // 3. Bind events
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      currentQuery = searchInput.value || '';
      applyFilters();
    });

    searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchInput.value) {
          e.preventDefault();
          currentQuery = '';
          searchInput.value = '';
          applyFilters();
        } else {
          searchInput.blur();
        }
      }
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      currentQuery = '';
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      applyFilters();
    });
  }

  filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const selectedCat = btn.getAttribute('data-category-filter');
      if (isValidCategoryFilter(selectedCat)) {
        activeCategory = selectedCat;
        applyFilters();
      }
    });
  });

  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', () => {
      resetAllFilters(true);
    });
  }

  // Keyboard shortcut: press '/' to focus calculator search when not inside an input/textarea
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const activeEl = document.activeElement;
    const tagName = activeEl ? activeEl.tagName.toLowerCase() : '';
    if (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      (activeEl && (activeEl as HTMLElement).isContentEditable)
    ) {
      return;
    }
    if (searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  // Initial render sync
  applyFilters();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCalculatorsDirectory);
} else {
  initCalculatorsDirectory();
}
