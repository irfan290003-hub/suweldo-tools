/**
 * SuweldoTools — Philippine SSS Contribution Table & MSC Guide Engine (2026)
 * Vanilla JavaScript implementation.
 * Zero external dependencies. Supports English (en-PH) and Filipino (tl-PH).
 *
 * Grounded in statutory Philippine laws:
 * - Republic Act No. 11199 (The Social Security Act of 2018) § 4(a)(1)
 * - SSS Circular No. 2024-006 (Schedule of SSS Contributions for All Business Employers and Employees Effective January 2025, applicable in 2026)
 * - Presidential Decree No. 626 & ECC Executive Order No. 33 (Employees' Compensation Program)
 */

(function () {
  'use strict';

  function isFilipinoLocale() {
    var htmlLang = (document.documentElement && document.documentElement.lang ? document.documentElement.lang : '').toLowerCase();
    var path = window.location ? window.location.pathname : '';
    return htmlLang.indexOf('tl') === 0 || htmlLang.indexOf('fil') === 0 || path === '/tl' || path.indexOf('/tl/') === 0;
  }

  // Statutory parameters for 2026
  const SSS_CONFIG = {
    year: 2026,
    totalRate: 0.15,
    employeeRate: 0.05,
    employerRate: 0.10,
    mscMin: 5000,
    mscMax: 35000,
    mscStep: 500,
    salaryFloorThreshold: 5250,
    salaryCeilingThreshold: 34750,
    regularMscCap: 20000,
    ecThresholdMsc: 15000,
    ecRateBelowThreshold: 10,
    ecRateAboveThreshold: 30
  };

  /**
   * Currency formatter (PHP)
   */
  function formatPHP(amount) {
    if (isNaN(amount) || amount === null || amount === undefined) {
      return '₱0.00';
    }
    return '₱' + Number(amount).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * Formats a number with comma separators (no peso sign)
   */
  function formatNumber(amount) {
    if (isNaN(amount) || amount === null || amount === undefined) {
      return '0.00';
    }
    return Number(amount).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * Generates the official 61 SSS brackets according to RA 11199 schedule.
   * Total brackets = (35,000 - 5,000) / 500 + 1 = 61.
   */
  function generateSSSTiers() {
    const tiers = [];
    let tierIndex = 1;

    for (let msc = SSS_CONFIG.mscMin; msc <= SSS_CONFIG.mscMax; msc += SSS_CONFIG.mscStep) {
      let minSalary, maxSalary, rangeLabel, rangeLabelTl;

      if (msc === SSS_CONFIG.mscMin) {
        minSalary = 0;
        maxSalary = 5249.99;
        rangeLabel = 'Below ₱5,250.00';
        rangeLabelTl = 'Mas mababa sa ₱5,250.00';
      } else if (msc === SSS_CONFIG.mscMax) {
        minSalary = 34750.00;
        maxSalary = Infinity;
        rangeLabel = '₱34,750.00 and above';
        rangeLabelTl = '₱34,750.00 pataas';
      } else {
        minSalary = msc - 250.00;
        maxSalary = msc + 249.99;
        rangeLabel = `₱${formatNumber(minSalary)} – ₱${formatNumber(maxSalary)}`;
        rangeLabelTl = rangeLabel;
      }

      const regularMsc = Math.min(msc, SSS_CONFIG.regularMscCap);
      const regularEE = regularMsc * SSS_CONFIG.employeeRate;
      const regularER = regularMsc * SSS_CONFIG.employerRate;
      const regularTotal = regularEE + regularER;

      const hasWisp = msc > SSS_CONFIG.regularMscCap;
      const wispMsc = hasWisp ? (msc - SSS_CONFIG.regularMscCap) : 0;
      const wispEE = wispMsc * SSS_CONFIG.employeeRate;
      const wispER = wispMsc * SSS_CONFIG.employerRate;
      const wispTotal = wispEE + wispER;

      const ecER = msc < SSS_CONFIG.ecThresholdMsc
        ? SSS_CONFIG.ecRateBelowThreshold
        : SSS_CONFIG.ecRateAboveThreshold;

      const totalEE = regularEE + wispEE;
      const totalER = regularER + wispER + ecER;
      const grandTotal = totalEE + totalER;

      tiers.push({
        index: tierIndex++,
        msc,
        minSalary,
        maxSalary,
        rangeLabel,
        rangeLabelTl,
        regularMsc,
        regularEE,
        regularER,
        regularTotal,
        hasWisp,
        wispMsc,
        wispEE,
        wispER,
        wispTotal,
        ecER,
        totalEE,
        totalER,
        grandTotal
      });
    }

    return tiers;
  }

  const ALL_TIERS = generateSSSTiers();

  /**
   * Find tier corresponding to a monthly basic salary
   */
  function findTierForSalary(salary) {
    if (salary === '' || salary === null || salary === undefined) return null;
    const num = Number(salary);
    if (isNaN(num) || num <= 0) return null;

    if (num < SSS_CONFIG.salaryFloorThreshold) {
      return ALL_TIERS[0];
    }
    if (num >= SSS_CONFIG.salaryCeilingThreshold) {
      return ALL_TIERS[ALL_TIERS.length - 1];
    }

    // Direct official bracket lookup by salary interval [minSalary, minSalary + 500)
    for (let i = 0; i < ALL_TIERS.length; i++) {
      const tier = ALL_TIERS[i];
      if (i === 0 && num < 5250) return tier;
      if (i === ALL_TIERS.length - 1 && num >= 34750) return tier;
      if (num >= tier.minSalary && num < (tier.minSalary + 500)) {
        return tier;
      }
    }

    const calculatedMsc = Math.round(num / SSS_CONFIG.mscStep) * SSS_CONFIG.mscStep;
    const clampedMsc = Math.max(SSS_CONFIG.mscMin, Math.min(calculatedMsc, SSS_CONFIG.mscMax));

    const found = ALL_TIERS.find(t => t.msc === clampedMsc);
    return found || ALL_TIERS[0];
  }

  // DOM Elements
  function initSSSTable() {
    if (document.body && document.body.getAttribute('data-sss-table-bound') === 'true') return;
    if (document.body) document.body.setAttribute('data-sss-table-bound', 'true');
    const isTl = isFilipinoLocale();
    const lookupSalaryInput = document.getElementById('lookupSalary');
    const resetLookupBtn = document.getElementById('resetLookupBtn');
    const highlightInTableBtn = document.getElementById('highlightInTableBtn');
    const presetButtons = document.querySelectorAll('[data-preset-salary]');

    // Lookup results DOM elements
    const outMsc = document.getElementById('outMsc');
    const outRange = document.getElementById('outRange');
    const outTotalEE = document.getElementById('outTotalEE');
    const outTotalER = document.getElementById('outTotalER');
    const outGrandTotal = document.getElementById('outGrandTotal');
    const outRegEE = document.getElementById('outRegEE');
    const outRegER = document.getElementById('outRegER');
    const outWispEE = document.getElementById('outWispEE');
    const outWispER = document.getElementById('outWispER');
    const outEC = document.getElementById('outEC');
    const wispBadge = document.getElementById('wispBadge');
    const outEquationEE = document.getElementById('outEquationEE');
    const outEquationER = document.getElementById('outEquationER');
    const outTotalERSub = document.getElementById('outTotalERSub');

    // Table elements
    const tableBody = document.getElementById('sssTableBody');
    const tableSearchInput = document.getElementById('tableSearchInput');
    const filterTabs = document.querySelectorAll('[data-filter-tab]');
    const tableCountIndicator = document.getElementById('tableCountIndicator');
    const tableContainer = document.getElementById('tableContainer');

    let currentActiveTier = null;
    let currentFilterTab = 'all'; // 'all', 'regular', 'wisp'

    /**
     * Updates the interactive lookup widget
     */
    function updateLookup(salaryVal) {
      const rawStr = String(salaryVal === null || salaryVal === undefined ? '' : salaryVal).trim();

      // Empty input state
      if (rawStr === '') {
        currentActiveTier = null;
        if (outMsc) outMsc.textContent = '₱0.00';
        if (outRange) outRange.textContent = isTl ? 'Ilagay ang buwanang sahod upang makita ang bracket' : 'Enter monthly salary to look up';
        if (outTotalEE) outTotalEE.textContent = '₱0.00';
        if (outTotalER) outTotalER.textContent = '₱0.00';
        if (outTotalERSub) outTotalERSub.textContent = '10.0% MSC + EC';
        if (outGrandTotal) outGrandTotal.textContent = '₱0.00';
        if (outRegEE) outRegEE.textContent = '₱0.00';
        if (outRegER) outRegER.textContent = '₱0.00';
        if (outWispEE) outWispEE.textContent = '₱0.00';
        if (outWispER) outWispER.textContent = '₱0.00';
        if (outEC) outEC.textContent = '₱0.00';
        if (outEquationEE) outEquationEE.textContent = '—';
        if (outEquationER) outEquationER.textContent = '—';
        if (wispBadge) {
          wispBadge.textContent = isTl ? 'Naghihintay ng sahod' : 'Awaiting input';
          wispBadge.className = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500';
        }
        return;
      }

      const num = Number(rawStr);

      // Non-numeric or negative input state
      if (isNaN(num) || num < 0) {
        currentActiveTier = null;
        if (outMsc) outMsc.textContent = '₱0.00';
        if (outRange) outRange.textContent = isTl ? 'Hindi wastong sahod (dapat positibong halaga)' : 'Invalid salary (must be a positive amount)';
        if (outTotalEE) outTotalEE.textContent = '₱0.00';
        if (outTotalER) outTotalER.textContent = '₱0.00';
        if (outTotalERSub) outTotalERSub.textContent = '10.0% MSC + EC';
        if (outGrandTotal) outGrandTotal.textContent = '₱0.00';
        if (outRegEE) outRegEE.textContent = '₱0.00';
        if (outRegER) outRegER.textContent = '₱0.00';
        if (outWispEE) outWispEE.textContent = '₱0.00';
        if (outWispER) outWispER.textContent = '₱0.00';
        if (outEC) outEC.textContent = '₱0.00';
        if (outEquationEE) outEquationEE.textContent = '—';
        if (outEquationER) outEquationER.textContent = '—';
        if (wispBadge) {
          wispBadge.textContent = isTl ? 'Hindi wastong input' : 'Invalid input';
          wispBadge.className = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-700';
        }
        return;
      }

      // Zero salary state
      if (num === 0) {
        currentActiveTier = null;
        if (outMsc) outMsc.textContent = '₱0.00';
        if (outRange) outRange.textContent = isTl ? '₱0.00 (Walang sahod / walang kaltas)' : '₱0.00 (No compensation / no deductions)';
        if (outTotalEE) outTotalEE.textContent = '₱0.00';
        if (outTotalER) outTotalER.textContent = '₱0.00';
        if (outTotalERSub) outTotalERSub.textContent = '10.0% MSC + EC';
        if (outGrandTotal) outGrandTotal.textContent = '₱0.00';
        if (outRegEE) outRegEE.textContent = '₱0.00';
        if (outRegER) outRegER.textContent = '₱0.00';
        if (outWispEE) outWispEE.textContent = '₱0.00';
        if (outWispER) outWispER.textContent = '₱0.00';
        if (outEC) outEC.textContent = '₱0.00';
        if (outEquationEE) outEquationEE.textContent = '—';
        if (outEquationER) outEquationER.textContent = '—';
        if (wispBadge) {
          wispBadge.textContent = isTl ? 'Walang sahod' : 'Zero earnings';
          wispBadge.className = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500';
        }
        return;
      }

      // Valid positive salary
      const tier = findTierForSalary(num);
      currentActiveTier = tier;

      if (outMsc) outMsc.textContent = formatPHP(tier.msc);
      if (outRange) outRange.textContent = isTl ? tier.rangeLabelTl : tier.rangeLabel;
      if (outTotalEE) outTotalEE.textContent = formatPHP(tier.totalEE);
      if (outTotalER) outTotalER.textContent = formatPHP(tier.totalER);
      if (outTotalERSub) outTotalERSub.textContent = `10.0% MSC + ${formatPHP(tier.ecER)} EC`;
      if (outGrandTotal) outGrandTotal.textContent = formatPHP(tier.grandTotal);

      if (outRegEE) outRegEE.textContent = formatPHP(tier.regularEE);
      if (outRegER) outRegER.textContent = formatPHP(tier.regularER);
      if (outWispEE) outWispEE.textContent = formatPHP(tier.wispEE);
      if (outWispER) outWispER.textContent = formatPHP(tier.wispER);
      if (outEC) outEC.textContent = formatPHP(tier.ecER);

      if (outEquationEE) {
        if (isTl) {
          if (tier.hasWisp) {
            outEquationEE.textContent = `${formatPHP(tier.regularEE)} regular SS + ${formatPHP(tier.wispEE)} MPF = ${formatPHP(tier.totalEE)} kabuuang hulog ng empleyado`;
          } else {
            outEquationEE.textContent = `${formatPHP(tier.regularEE)} regular SS + ₱0.00 MPF = ${formatPHP(tier.totalEE)} kabuuang hulog ng empleyado`;
          }
        } else {
          if (tier.hasWisp) {
            outEquationEE.textContent = `${formatPHP(tier.regularEE)} regular SS + ${formatPHP(tier.wispEE)} MPF = ${formatPHP(tier.totalEE)} total employee contribution`;
          } else {
            outEquationEE.textContent = `${formatPHP(tier.regularEE)} regular SS + ₱0.00 MPF = ${formatPHP(tier.totalEE)} total employee contribution`;
          }
        }
      }

      if (outEquationER) {
        if (isTl) {
          if (tier.hasWisp) {
            outEquationER.textContent = `${formatPHP(tier.regularER)} regular SS + ${formatPHP(tier.wispER)} MPF + ${formatPHP(tier.ecER)} EC = ${formatPHP(tier.totalER)} kabuuang sagot ng employer (kasama ang EC)`;
          } else {
            outEquationER.textContent = `${formatPHP(tier.regularER)} regular SS + ₱0.00 MPF + ${formatPHP(tier.ecER)} EC = ${formatPHP(tier.totalER)} kabuuang sagot ng employer (kasama ang EC)`;
          }
        } else {
          if (tier.hasWisp) {
            outEquationER.textContent = `${formatPHP(tier.regularER)} regular SS + ${formatPHP(tier.wispER)} MPF + ${formatPHP(tier.ecER)} EC = ${formatPHP(tier.totalER)} total employer cost (incl. EC)`;
          } else {
            outEquationER.textContent = `${formatPHP(tier.regularER)} regular SS + ₱0.00 MPF + ${formatPHP(tier.ecER)} EC = ${formatPHP(tier.totalER)} total employer cost (incl. EC)`;
          }
        }
      }

      if (wispBadge) {
        if (tier.hasWisp) {
          wispBadge.textContent = isTl
            ? `May kasamang ${formatPHP(tier.wispMsc)} MPF MSC (MySSS Pension Booster)`
            : `Includes ${formatPHP(tier.wispMsc)} MPF MSC (MySSS Pension Booster)`;
          wispBadge.className = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800';
        } else {
          wispBadge.textContent = isTl
            ? 'Regular SS Lamang (Walang MPF / WISP)'
            : 'Regular SS Only (No MPF / WISP)';
          wispBadge.className = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600';
        }
      }
    }

    /**
     * Highlights the selected tier row in the table
     */
    function highlightRowInTable(msc) {
      if (!tableBody) return;

      const rows = tableBody.querySelectorAll('tr[data-msc]');
      let targetRow = null;

      rows.forEach(row => {
        const rowMsc = Number(row.getAttribute('data-msc'));
        if (rowMsc === msc) {
          row.classList.add('bg-emerald-100/90', 'ring-2', 'ring-emerald-600', 'font-semibold');
          row.classList.remove('hover:bg-slate-50');
          targetRow = row;
        } else {
          row.classList.remove('bg-emerald-100/90', 'ring-2', 'ring-emerald-600', 'font-semibold');
          row.classList.add('hover:bg-slate-50');
        }
      });

      if (targetRow && tableContainer) {
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    /**
     * Filters the static table rows based on search text and active tab
     */
    function filterTable() {
      if (!tableBody) return;

      const searchTerm = tableSearchInput ? tableSearchInput.value.toLowerCase().trim() : '';
      const rows = tableBody.querySelectorAll('tr[data-msc]');
      let visibleCount = 0;

      rows.forEach(row => {
        const msc = Number(row.getAttribute('data-msc'));
        const rangeText = (row.getAttribute('data-range') || '').toLowerCase();
        const hasWisp = msc > SSS_CONFIG.regularMscCap;

        // Check tab category
        let matchesTab = true;
        if (currentFilterTab === 'regular' && hasWisp) {
          matchesTab = false;
        } else if (currentFilterTab === 'wisp' && !hasWisp) {
          matchesTab = false;
        }

        // Check search query
        let matchesSearch = true;
        if (searchTerm) {
          const mscStr = String(msc);
          const formattedMsc = formatNumber(msc);
          if (!mscStr.includes(searchTerm) && !formattedMsc.includes(searchTerm) && !rangeText.includes(searchTerm)) {
            matchesSearch = false;
          }
        }

        if (matchesTab && matchesSearch) {
          row.style.display = '';
          visibleCount++;
        } else {
          row.style.display = 'none';
        }
      });

      if (tableCountIndicator) {
        tableCountIndicator.textContent = isTl
          ? `Ipinapakita ang ${visibleCount} sa ${ALL_TIERS.length} na bracket`
          : `Showing ${visibleCount} of ${ALL_TIERS.length} brackets`;
      }
    }

    // Input listener for salary lookup
    const calculateSssBtn = document.getElementById('calculateSssBtn') || document.getElementById('calculatePayBtn');
    const mobileCalculateBar = document.getElementById('mobileCalculateBar');
    const calculatorInputSection = document.getElementById('calculatorInputSection');
    const calculatorResultsSection = document.getElementById('calculatorResultsSection');

    function scrollToResultsSection() {
      if (!calculatorResultsSection) return;
      const headerEl = document.querySelector('header');
      const headerOffset = headerEl ? headerEl.offsetHeight + 12 : 76;
      const rect = calculatorResultsSection.getBoundingClientRect();
      const targetTop = Math.max(0, (window.pageYOffset || document.documentElement.scrollTop || 0) + rect.top - headerOffset);
      const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      window.scrollTo({
        top: targetTop,
        behavior: prefersReducedMotion ? 'auto' : 'smooth'
      });
    }

    function handleMobileCalculateTrigger() {
      if (lookupSalaryInput) {
        updateLookup(lookupSalaryInput.value);
      }
      if (
        document.activeElement &&
        document.activeElement === lookupSalaryInput &&
        typeof document.activeElement.blur === 'function'
      ) {
        document.activeElement.blur();
      }
      scrollToResultsSection();
    }

    // Ensure focused inputs/controls on mobile are never obscured by sticky header or sticky calculate bar
    function ensureFocusedFieldUnobscured(targetEl) {
      if (!targetEl || window.innerWidth >= 1024) return;
      const fieldContainer = targetEl.closest('[data-calc-field]') || targetEl;
      const rect = fieldContainer.getBoundingClientRect();
      const headerEl = document.querySelector('header');
      const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 64;

      let bottomLimit = window.innerHeight;
      if (mobileCalculateBar && window.getComputedStyle(mobileCalculateBar).display !== 'none') {
        const barRect = mobileCalculateBar.getBoundingClientRect();
        if (barRect.height > 0 && barRect.top < bottomLimit) {
          bottomLimit = barRect.top;
        }
      }

      if (rect.top < headerBottom + 8) {
        window.scrollBy({
          top: rect.top - (headerBottom + 12),
          behavior: 'auto'
        });
      } else if (rect.bottom > bottomLimit - 8) {
        window.scrollBy({
          top: rect.bottom - (bottomLimit - 12),
          behavior: 'auto'
        });
      }
    }

    if (lookupSalaryInput) {
      lookupSalaryInput.addEventListener('input', function (e) {
        updateLookup(e.target.value);
      });
      lookupSalaryInput.addEventListener('change', function (e) {
        updateLookup(e.target.value);
      });
      lookupSalaryInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (window.innerWidth < 1024) {
            handleMobileCalculateTrigger();
          } else {
            updateLookup(lookupSalaryInput.value);
          }
        }
      });
    }

    if (calculateSssBtn) {
      calculateSssBtn.addEventListener('click', function (e) {
        e.preventDefault();
        handleMobileCalculateTrigger();
      });
    }

    if (calculatorInputSection) {
      calculatorInputSection.addEventListener('focusin', function (e) {
        const target = e.target;
        if (!target || target === calculateSssBtn) return;
        ensureFocusedFieldUnobscured(target);
        setTimeout(function () {
          if (document.activeElement === target) {
            ensureFocusedFieldUnobscured(target);
          }
        }, 120);
      });
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () {
        const active = document.activeElement;
        if (active && calculatorInputSection && calculatorInputSection.contains(active) && active !== calculateSssBtn) {
          ensureFocusedFieldUnobscured(active);
        }
      });
    }

    // Reset button
    if (resetLookupBtn) {
      resetLookupBtn.addEventListener('click', function () {
        if (lookupSalaryInput) {
          lookupSalaryInput.value = '25000';
          updateLookup(25000);
          highlightRowInTable(25000);
        }
      });
    }

    // Highlight in Table button
    if (highlightInTableBtn) {
      highlightInTableBtn.addEventListener('click', function () {
        if (currentActiveTier) {
          if (currentFilterTab !== 'all') {
            currentFilterTab = 'all';
            filterTabs.forEach(t => {
              if (t.getAttribute('data-filter-tab') === 'all') {
                t.classList.add('bg-emerald-600', 'text-white');
                t.classList.remove('bg-white', 'text-slate-700', 'border-slate-200');
              } else {
                t.classList.remove('bg-emerald-600', 'text-white');
                t.classList.add('bg-white', 'text-slate-700', 'border-slate-200');
              }
            });
            if (tableSearchInput) tableSearchInput.value = '';
            filterTable();
          }
          highlightRowInTable(currentActiveTier.msc);
        }
      });
    }

    // Preset buttons
    presetButtons.forEach(btn => {
      btn.addEventListener('click', function () {
        const amount = this.getAttribute('data-preset-salary');
        if (lookupSalaryInput && amount) {
          lookupSalaryInput.value = amount;
          updateLookup(parseFloat(amount));
          highlightRowInTable(findTierForSalary(amount).msc);
        }
      });
    });

    // Search input listener
    if (tableSearchInput) {
      tableSearchInput.addEventListener('input', filterTable);
    }

    // Filter tab buttons
    filterTabs.forEach(btn => {
      btn.addEventListener('click', function () {
        currentFilterTab = this.getAttribute('data-filter-tab');
        filterTabs.forEach(b => {
          b.classList.remove('bg-emerald-600', 'text-white');
          b.classList.add('bg-white', 'text-slate-700', 'border-slate-200');
        });
        this.classList.add('bg-emerald-600', 'text-white');
        this.classList.remove('bg-white', 'text-slate-700', 'border-slate-200');
        filterTable();
      });
    });

    // Restore state from language switch if present
    let initialSalary = 25000;
    try {
      var raw = window.sessionStorage ? window.sessionStorage.getItem('suweldotools_calc_handoff') : null;
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.calculator === 'sss-table') {
          window.sessionStorage.removeItem('suweldotools_calc_handoff');
          if (lookupSalaryInput && parsed.lookupSalary !== undefined) {
            lookupSalaryInput.value = parsed.lookupSalary;
            initialSalary = parsed.lookupSalary;
          }
          if (parsed.filterTab && (parsed.filterTab === 'all' || parsed.filterTab === 'regular' || parsed.filterTab === 'wisp')) {
            currentFilterTab = parsed.filterTab;
            filterTabs.forEach(b => {
              if (b.getAttribute('data-filter-tab') === currentFilterTab) {
                b.classList.add('bg-emerald-600', 'text-white');
                b.classList.remove('bg-white', 'text-slate-700', 'border-slate-200');
              } else {
                b.classList.remove('bg-emerald-600', 'text-white');
                b.classList.add('bg-white', 'text-slate-700', 'border-slate-200');
              }
            });
          }
          if (tableSearchInput && parsed.tableSearch !== undefined) {
            tableSearchInput.value = parsed.tableSearch;
          }
          filterTable();
        }
      }
    } catch (e) {
      // Ignore storage errors
    }

    // Initial run
    updateLookup(initialSalary);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSSSTable);
  } else {
    initSSSTable();
  }

  // Expose for verification and testing
  window.SSSTableManager = {
    CONFIG: SSS_CONFIG,
    tiers: ALL_TIERS,
    findTierForSalary: findTierForSalary,
    formatPHP: formatPHP,
    formatNumber: formatNumber
  };
})();
