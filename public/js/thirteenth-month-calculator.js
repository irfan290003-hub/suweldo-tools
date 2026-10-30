/**
 * SuweldoTools — Philippine 13th Month Pay Calculator Engine
 * Vanilla JavaScript implementation.
 * Zero external dependencies. Supports English (en-PH) and Filipino (tl-PH).
 *
 * Grounded in statutory Philippine laws:
 * - Presidential Decree No. 851 (13th Month Pay Law)
 * - DOLE Revised Guidelines on the Implementation of the 13th Month Pay Law (Nov 16, 1987)
 * - DOLE Annual Labor Advisories (e.g. Labor Advisory No. 25, Series of 2023)
 * - NIRC Section 32(B)(7)(e) as amended by RA 10963 (TRAIN Law) — ₱90,000 Tax-Exempt Ceiling
 */

(function () {
  'use strict';

  function isFilipinoLocale() {
    var htmlLang = (document.documentElement && document.documentElement.lang ? document.documentElement.lang : '').toLowerCase();
    var path = window.location ? window.location.pathname : '';
    return htmlLang.indexOf('tl') === 0 || htmlLang.indexOf('fil') === 0 || path === '/tl' || path.indexOf('/tl/') === 0;
  }

  const defaultRates = {
    year: 2026,
    annualDivisor: 12,
    minimumServiceMonths: 1,
    taxExemptionCap: 90000
  };

  let config = Object.assign({}, defaultRates);

  // Load external configuration asynchronously if available
  if (typeof fetch === 'function') {
    fetch('/data/rates-2026.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.thirteenthMonth) {
          if (data.thirteenthMonth.taxExemptionCap) {
            config.taxExemptionCap = Number(data.thirteenthMonth.taxExemptionCap);
          }
          if (data.thirteenthMonth.annualDivisor) {
            config.annualDivisor = Number(data.thirteenthMonth.annualDivisor);
          }
          recalculate();
        }
      })
      .catch(() => {
        // Fallback gracefully to default embedded rates
      });
  }

  // DOM Input Elements
  const monthlySalaryInput = document.getElementById('tmMonthlySalary');
  const monthsWorkedInput = document.getElementById('tmMonthsWorked');
  const exactTotalInput = document.getElementById('tmExactTotal');
  const customTotalToggle = document.getElementById('tmCustomTotalToggle');
  const customTotalContainer = document.getElementById('tmCustomTotalContainer');
  const otherBenefitsInput = document.getElementById('tmOtherBenefits');
  const resetButton = document.getElementById('tmResetBtn');
  const validationAlert = document.getElementById('tmValidationAlert');

  // DOM Output Elements
  const resGrossPay = document.getElementById('tmResGrossPay');
  const resProratedBadge = document.getElementById('tmResProratedBadge');
  const resCalculationFormula = document.getElementById('tmResCalculationFormula');
  const resTotalEarned = document.getElementById('tmResTotalEarned');
  const resMonthsWorked = document.getElementById('tmResMonthsWorked');
  const resMonthlyEquivalent = document.getElementById('tmResMonthlyEquivalent');
  const resEligibilityNote = document.getElementById('tmResEligibilityNote');

  // Tax Breakdown Elements
  const resTaxExemptPortion = document.getElementById('tmResTaxExemptPortion');
  const resTaxableExcess = document.getElementById('tmResTaxableExcess');
  const resTotalBenefits = document.getElementById('tmResTotalBenefits');
  const resTaxBadge = document.getElementById('tmResTaxBadge');
  const resTaxExplanation = document.getElementById('tmResTaxExplanation');

  /**
   * Currency formatter for Philippine Peso (PHP)
   */
  function formatPHP(amount) {
    if (isNaN(amount) || amount === null || amount === undefined || amount < 0) {
      return '₱0.00';
    }
    return '₱' + Number(amount).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * Pure calculation logic for testing & headless verification
   * @param {Object} params
   * @param {number} params.monthlySalary
   * @param {number} params.monthsWorked (1-12)
   * @param {number|null} params.exactTotalEarned
   * @param {number} params.otherBenefits
   * @returns {Object} Calculated payroll breakdown
   */
  function calculate13thMonth(params) {
    const monthlySalary = Math.max(0, Number(params.monthlySalary) || 0);
    const monthsWorked = Math.min(12, Math.max(0, Number(params.monthsWorked) || 0));
    const otherBenefits = Math.max(0, Number(params.otherBenefits) || 0);

    let totalBasicEarned = 0;
    const isCustomTotal = params.exactTotalEarned !== null && params.exactTotalEarned !== undefined && !isNaN(params.exactTotalEarned) && params.exactTotalEarned !== '';

    if (isCustomTotal) {
      totalBasicEarned = Math.max(0, Number(params.exactTotalEarned) || 0);
    } else {
      totalBasicEarned = monthlySalary * monthsWorked;
    }

    // DOLE statutory formula: Total basic salary earned during calendar year / 12
    const gross13thMonth = totalBasicEarned > 0 ? (totalBasicEarned / config.annualDivisor) : 0;

    // Proration evaluation
    const isProrated = monthsWorked < 12 || (monthlySalary > 0 && Math.abs(totalBasicEarned - (monthlySalary * 12)) > 0.01);
    const isEligible = monthsWorked >= 1 || (totalBasicEarned > 0 && monthlySalary > 0 && totalBasicEarned >= (monthlySalary * 1));

    // Tax treatment under TRAIN Law Section 32(B)(7)(e) (₱90,000 aggregate cap)
    const totalAggregateBenefits = gross13thMonth + otherBenefits;
    const taxExemptionCap = config.taxExemptionCap;
    const taxExemptPortion = Math.min(totalAggregateBenefits, taxExemptionCap);
    const potentialTaxableExcess = Math.max(0, totalAggregateBenefits - taxExemptionCap);

    return {
      monthlySalary,
      monthsWorked,
      totalBasicEarned,
      isCustomTotal,
      gross13thMonth,
      isProrated,
      isEligible,
      otherBenefits,
      totalAggregateBenefits,
      taxExemptionCap,
      taxExemptPortion,
      potentialTaxableExcess
    };
  }

  /**
   * Reads UI inputs, validates, computes, and renders results
   */
  function recalculate() {
    if (!monthlySalaryInput) return;

    const isTl = isFilipinoLocale();
    let monthlySalary = parseFloat(monthlySalaryInput.value);
    let monthsWorked = parseFloat(monthsWorkedInput ? monthsWorkedInput.value : 12);
    let otherBenefits = parseFloat(otherBenefitsInput && otherBenefitsInput.value ? otherBenefitsInput.value : 0);
    const isCustomMode = customTotalToggle ? customTotalToggle.checked : false;

    let warnings = [];

    // Validation
    if (isNaN(monthlySalary) || monthlySalary < 0) {
      monthlySalary = 0;
      if (monthlySalaryInput.value !== '' && parseFloat(monthlySalaryInput.value) < 0) {
        warnings.push(isTl ? 'Hindi maaaring negatibo ang buwanang basic salary.' : 'Monthly basic salary cannot be negative.');
      }
    }

    if (isNaN(monthsWorked) || monthsWorked < 0) {
      monthsWorked = 0;
      warnings.push(isTl ? 'Hindi maaaring negatibo ang bilang ng buwang ipinasok.' : 'Months worked cannot be negative.');
    } else if (monthsWorked > 12) {
      monthsWorked = 12;
      if (monthsWorkedInput) monthsWorkedInput.value = '12';
      warnings.push(isTl ? 'Hindi maaaring lumampas sa 12 buwan ang ipinasok sa loob ng isang calendar year.' : 'Months worked within a calendar year cannot exceed 12 months.');
    }

    if (isNaN(otherBenefits) || otherBenefits < 0) {
      otherBenefits = 0;
      if (otherBenefitsInput && otherBenefitsInput.value !== '' && parseFloat(otherBenefitsInput.value) < 0) {
        warnings.push(isTl ? 'Hindi maaaring negatibo ang ibang benepisyo.' : 'Other benefits cannot be negative.');
      }
    }

    let exactTotal = null;
    if (isCustomMode && exactTotalInput && exactTotalInput.value !== '') {
      const parsedExact = parseFloat(exactTotalInput.value);
      if (isNaN(parsedExact) || parsedExact < 0) {
        exactTotal = 0;
        warnings.push(isTl ? 'Hindi maaaring negatibo ang aktwal na kabuuang basic salary na kinita.' : 'Actual total basic salary earned cannot be negative.');
      } else {
        exactTotal = parsedExact;
      }
    }

    // Display validation alerts
    if (validationAlert) {
      if (warnings.length > 0) {
        validationAlert.textContent = warnings.join(' ');
        validationAlert.classList.remove('hidden');
      } else {
        validationAlert.classList.add('hidden');
        validationAlert.textContent = '';
      }
    }

    const res = calculate13thMonth({
      monthlySalary,
      monthsWorked,
      exactTotalEarned: isCustomMode ? exactTotal : null,
      otherBenefits
    });

    // If not in custom mode, keep exact total placeholder or input in sync
    if (!isCustomMode && exactTotalInput) {
      exactTotalInput.value = (res.totalBasicEarned > 0) ? res.totalBasicEarned.toFixed(2) : '';
    }

    // Render Main Outputs
    if (resGrossPay) {
      resGrossPay.textContent = formatPHP(res.gross13thMonth);
    }

    if (resTotalEarned) {
      resTotalEarned.textContent = formatPHP(res.totalBasicEarned);
    }

    if (resMonthsWorked) {
      if (isTl) {
        resMonthsWorked.textContent = res.monthsWorked + ' buwan';
      } else {
        resMonthsWorked.textContent = res.monthsWorked + ' month' + (res.monthsWorked === 1 ? '' : 's');
      }
    }

    if (resMonthlyEquivalent) {
      resMonthlyEquivalent.textContent = formatPHP(res.monthlySalary);
    }

    if (resCalculationFormula) {
      if (isTl) {
        if (res.totalBasicEarned > 0) {
          resCalculationFormula.textContent = `${formatPHP(res.totalBasicEarned)} ÷ 12 buwan = ${formatPHP(res.gross13thMonth)}`;
        } else {
          resCalculationFormula.textContent = '₱0.00 ÷ 12 buwan = ₱0.00';
        }
      } else {
        if (res.totalBasicEarned > 0) {
          resCalculationFormula.textContent = `${formatPHP(res.totalBasicEarned)} ÷ 12 months = ${formatPHP(res.gross13thMonth)}`;
        } else {
          resCalculationFormula.textContent = '₱0.00 ÷ 12 months = ₱0.00';
        }
      }
    }

    // Prorated vs Full-Year Badge
    if (resProratedBadge) {
      if (res.monthsWorked < 1 && res.totalBasicEarned === 0) {
        resProratedBadge.textContent = isTl ? '0 Buwang Ipinasok' : '0 Months Rendered';
        resProratedBadge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800';
      } else if (res.isProrated) {
        resProratedBadge.textContent = isTl
          ? `Prorated na Tantiya (${res.monthsWorked}/12 buwan)`
          : `Prorated Estimate (${res.monthsWorked}/12 mos)`;
        resProratedBadge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800';
      } else {
        resProratedBadge.textContent = isTl
          ? 'Buong Taon (12/12 buwan)'
          : 'Full Calendar Year (12/12 mos)';
        resProratedBadge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800';
      }
    }

    // DOLE Eligibility Note
    if (resEligibilityNote) {
      if (res.monthsWorked < 1 && res.totalBasicEarned <= 0) {
        resEligibilityNote.textContent = isTl
          ? 'Sa ilalim ng DOLE Presidential Decree No. 851, kailangang nakapagtrabaho nang hindi bababa sa isang (1) buong buwan sa loob ng calendar year ang rank-and-file na empleyado upang maging kwalipikado sa statutory 13th month pay.'
          : 'Under DOLE Presidential Decree No. 851, rank-and-file employees must render at least one (1) full month of service during the calendar year to qualify for statutory 13th month pay.';
        resEligibilityNote.className = 'text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200 mt-3';
        resEligibilityNote.classList.remove('hidden');
      } else if (res.monthsWorked < 1 && res.totalBasicEarned > 0) {
        resEligibilityNote.textContent = isTl
          ? 'May inilagay na custom earnings. Paalala: Sa ilalim ng DOLE rules, karaniwang kailangan ang hindi bababa sa isang buwang serbisyo sa loob ng calendar year.'
          : 'Custom earnings entered. Note: DOLE rules generally require at least one month of service rendered during the calendar year.';
        resEligibilityNote.className = 'text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200 mt-3';
        resEligibilityNote.classList.remove('hidden');
      } else {
        resEligibilityNote.classList.add('hidden');
        resEligibilityNote.textContent = '';
      }
    }

    // Render Tax Outputs
    if (resTaxExemptPortion) {
      resTaxExemptPortion.textContent = formatPHP(res.taxExemptPortion);
    }

    if (resTaxableExcess) {
      resTaxableExcess.textContent = formatPHP(res.potentialTaxableExcess);
      if (res.potentialTaxableExcess > 0) {
        resTaxableExcess.className = 'text-base font-bold text-amber-600';
      } else {
        resTaxableExcess.className = 'text-base font-bold text-slate-700';
      }
    }

    if (resTotalBenefits) {
      resTotalBenefits.textContent = formatPHP(res.totalAggregateBenefits);
    }

    if (resTaxBadge) {
      if (res.potentialTaxableExcess > 0) {
        resTaxBadge.textContent = isTl ? 'Lampas sa ₱90,000 Cap' : 'Exceeds ₱90,000 Cap';
        resTaxBadge.className = 'px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800';
      } else if (res.totalAggregateBenefits > 0) {
        resTaxBadge.textContent = '100% Tax-Exempt';
        resTaxBadge.className = 'px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800';
      } else {
        resTaxBadge.textContent = isTl ? 'Pasok sa Cap' : 'Within Cap';
        resTaxBadge.className = 'px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-700';
      }
    }

    if (resTaxExplanation) {
      if (res.potentialTaxableExcess > 0) {
        resTaxExplanation.textContent = isTl
          ? `Ang iyong pinagsamang 13th month pay at iba pang benepisyo (${formatPHP(res.totalAggregateBenefits)}) ay lumampas sa statutory ₱90,000 tax-exempt limit nang ${formatPHP(res.potentialTaxableExcess)}. Ang sobrang halagang ito ay idaragdag sa iyong taunang gross taxable compensation sa year-end tax reconciliation (BIR Form 2316), at ang withholding tax ay kakalkulahin batay sa iyong TRAIN tax bracket. Hindi ito agad na binabawas nang buo.`
          : `Your combined 13th month pay and other benefits (${formatPHP(res.totalAggregateBenefits)}) exceed the statutory ₱90,000 tax-exempt limit by ${formatPHP(res.potentialTaxableExcess)}. This excess is added to your annual gross taxable compensation during year-end tax reconciliation (BIR Form 2316), and withholding tax is calculated based on your total annual TRAIN tax bracket. It is not an immediate lump-sum deduction.`;
      } else if (res.totalAggregateBenefits > 0) {
        resTaxExplanation.textContent = isTl
          ? `Sa ilalim ng Section 32(B)(7)(e) ng National Internal Revenue Code (na inamyendahan ng TRAIN Law), ang iyong kabuuang benepisyo (${formatPHP(res.totalAggregateBenefits)}) ay pasok sa ₱90,000 threshold at 100% tax-exempt sa income tax.`
          : `Under Section 32(B)(7)(e) of the National Internal Revenue Code (as amended by the TRAIN Law), your total benefits (${formatPHP(res.totalAggregateBenefits)}) are within the ₱90,000 threshold and qualify for complete income tax exemption.`;
      } else {
        resTaxExplanation.textContent = isTl
          ? 'Sa ilalim ng batas sa buwis ng Pilipinas (TRAIN Law), ang 13th month pay at iba pang benepisyo ay walang buwis (tax-exempt) hanggang sa pinagsamang limitasyon na ₱90,000.00 bawat calendar year.'
          : 'Under Philippine tax law (TRAIN Law), 13th month pay and other benefits are non-taxable up to an aggregate ceiling of ₱90,000.00 per calendar year.';
      }
    }
  }

  function restoreLanguageHandoffState() {
    try {
      var raw = window.sessionStorage ? window.sessionStorage.getItem('suweldotools_calc_handoff') : null;
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.calculator === '13th-month') {
        window.sessionStorage.removeItem('suweldotools_calc_handoff');
        if (monthlySalaryInput && parsed.monthlySalary !== undefined) {
          monthlySalaryInput.value = parsed.monthlySalary;
        }
        if (monthsWorkedInput && parsed.monthsWorked !== undefined) {
          monthsWorkedInput.value = parsed.monthsWorked;
          document.querySelectorAll('[data-months-preset]').forEach((b) => {
            if (b.getAttribute('data-months-preset') === String(parsed.monthsWorked)) {
              b.classList.remove('bg-white', 'text-slate-700', 'border-slate-300');
              b.classList.add('bg-emerald-600', 'text-white', 'border-emerald-600');
            } else {
              b.classList.remove('bg-emerald-600', 'text-white', 'border-emerald-600');
              b.classList.add('bg-white', 'text-slate-700', 'border-slate-300');
            }
          });
        }
        if (customTotalToggle && parsed.customTotalToggle !== undefined) {
          customTotalToggle.checked = Boolean(parsed.customTotalToggle);
          if (customTotalContainer) {
            if (customTotalToggle.checked) {
              customTotalContainer.classList.remove('hidden');
            } else {
              customTotalContainer.classList.add('hidden');
            }
          }
        }
        if (exactTotalInput && parsed.exactTotal !== undefined) {
          exactTotalInput.value = parsed.exactTotal;
        }
        if (otherBenefitsInput && parsed.otherBenefits !== undefined) {
          otherBenefitsInput.value = parsed.otherBenefits;
        }
      }
    } catch (e) {
      // Ignore storage errors
    }
  }

  // Event Listeners
  if (monthlySalaryInput) {
    monthlySalaryInput.addEventListener('input', recalculate);
    monthlySalaryInput.addEventListener('change', recalculate);
  }

  if (monthsWorkedInput) {
    monthsWorkedInput.addEventListener('input', recalculate);
    monthsWorkedInput.addEventListener('change', recalculate);
  }

  if (exactTotalInput) {
    exactTotalInput.addEventListener('input', recalculate);
    exactTotalInput.addEventListener('change', recalculate);
  }

  if (otherBenefitsInput) {
    otherBenefitsInput.addEventListener('input', recalculate);
    otherBenefitsInput.addEventListener('change', recalculate);
  }

  if (customTotalToggle) {
    customTotalToggle.addEventListener('change', function () {
      if (customTotalContainer) {
        if (this.checked) {
          customTotalContainer.classList.remove('hidden');
          // If empty, prefill with current calculated amount
          if (exactTotalInput && (!exactTotalInput.value || exactTotalInput.value === '0')) {
            const m = parseFloat(monthlySalaryInput.value) || 0;
            const mos = parseFloat(monthsWorkedInput.value) || 12;
            exactTotalInput.value = (m * mos).toFixed(2);
          }
        } else {
          customTotalContainer.classList.add('hidden');
        }
      }
      recalculate();
    });
  }

  // Months quick-select buttons / chips
  document.querySelectorAll('[data-months-preset]').forEach((btn) => {
    btn.addEventListener('click', function () {
      const val = this.getAttribute('data-months-preset');
      if (monthsWorkedInput && val) {
        monthsWorkedInput.value = val;
        // update active chip styles
        document.querySelectorAll('[data-months-preset]').forEach((b) => {
          b.classList.remove('bg-emerald-600', 'text-white', 'border-emerald-600');
          b.classList.add('bg-white', 'text-slate-700', 'border-slate-300');
        });
        this.classList.remove('bg-white', 'text-slate-700', 'border-slate-300');
        this.classList.add('bg-emerald-600', 'text-white', 'border-emerald-600');
        recalculate();
      }
    });
  });

  // Salary preset chips
  document.querySelectorAll('[data-tm-salary-preset]').forEach((btn) => {
    btn.addEventListener('click', function () {
      const val = this.getAttribute('data-tm-salary-preset');
      if (monthlySalaryInput && val) {
        monthlySalaryInput.value = val;
        recalculate();
      }
    });
  });

  // Reset Button
  if (resetButton) {
    resetButton.addEventListener('click', function () {
      if (monthlySalaryInput) monthlySalaryInput.value = '25000';
      if (monthsWorkedInput) monthsWorkedInput.value = '12';
      if (otherBenefitsInput) otherBenefitsInput.value = '0';
      if (customTotalToggle) {
        customTotalToggle.checked = false;
        if (customTotalContainer) customTotalContainer.classList.add('hidden');
      }
      if (exactTotalInput) exactTotalInput.value = '300000';

      // Reset months chips styling
      document.querySelectorAll('[data-months-preset]').forEach((b) => {
        if (b.getAttribute('data-months-preset') === '12') {
          b.classList.remove('bg-white', 'text-slate-700', 'border-slate-300');
          b.classList.add('bg-emerald-600', 'text-white', 'border-emerald-600');
        } else {
          b.classList.remove('bg-emerald-600', 'text-white', 'border-emerald-600');
          b.classList.add('bg-white', 'text-slate-700', 'border-slate-300');
        }
      });

      recalculate();
    });
  }

  // Mobile Calculate button & smooth scroll to results
  const calculate13thMonthBtn = document.getElementById('calculate13thMonthBtn') || document.getElementById('calculatePayBtn');
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
    recalculate();
    if (
      document.activeElement &&
      (document.activeElement === monthlySalaryInput ||
        document.activeElement === monthsWorkedInput ||
        document.activeElement === exactTotalInput ||
        document.activeElement === otherBenefitsInput) &&
      typeof document.activeElement.blur === 'function'
    ) {
      document.activeElement.blur();
    }
    scrollToResultsSection();
  }

  if (calculate13thMonthBtn) {
    calculate13thMonthBtn.addEventListener('click', function () {
      handleMobileCalculateTrigger();
    });
  }

  // Allow pressing Enter in mobile inputs to calculate and scroll to results
  [monthlySalaryInput, monthsWorkedInput, exactTotalInput, otherBenefitsInput].forEach((inputEl) => {
    if (!inputEl) return;
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (window.innerWidth < 1024) {
          handleMobileCalculateTrigger();
        } else {
          recalculate();
        }
      }
    });
  });

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

  if (calculatorInputSection) {
    calculatorInputSection.addEventListener('focusin', function (e) {
      const target = e.target;
      if (!target || target === calculate13thMonthBtn) return;
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
      if (active && calculatorInputSection && calculatorInputSection.contains(active) && active !== calculate13thMonthBtn) {
        ensureFocusedFieldUnobscured(active);
      }
    });
  }

  // Restore any state from language switch and run initial calculation
  restoreLanguageHandoffState();
  document.addEventListener('DOMContentLoaded', function () {
    restoreLanguageHandoffState();
    recalculate();
  });
  recalculate();

  // Export engine globally for testing and verification
  window.ThirteenthMonthCalculator = {
    calculate13thMonth,
    formatPHP,
    recalculate,
    config
  };
})();
