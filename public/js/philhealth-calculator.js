/**
 * SuweldoTools — Verified PhilHealth Calculator Engine (2026)
 * Vanilla JavaScript implementation. Zero external dependencies.
 * Supports English (en-PH) and Filipino (tl-PH).
 *
 * Official Grounding & Verified Sources:
 * 1. Republic Act No. 11223 (Universal Health Care Act) § 10
 * 2. PhilHealth Advisory No. 2025-0002
 * 3. PhilHealth Employer Payment Procedures & Contribution Table
 *    https://www.philhealth.gov.ph/partners/employers/pay_procedures.php
 * 4. Philippine Information Agency (PIA) 2026 Rate Schedule Notice
 *    https://pia.gov.ph/news/philhealth-sets-5-premium-contribution-rate-for-2026/
 *
 * Parameters for Employed Members (Direct Contributors in the Formal Economy):
 * - Premium rate: 5.0% of applicable Monthly Basic Salary (MBS).
 * - Statutory floor: ₱10,000.00 (Minimum total monthly premium = ₱500.00).
 * - Statutory ceiling: ₱100,000.00 (Maximum total monthly premium = ₱5,000.00).
 * - Sharing: 50% Employee Share (2.5%) and 50% Employer Share (2.5%).
 * - MBS excludes: overtime pay, commissions, bonuses, 13th-month pay, allowances, and gratuity.
 */

(function () {
  'use strict';

  var CALC_HANDOFF_KEY = 'suweldotools_calc_handoff';

  function isFilipinoLocale() {
    var htmlLang = (document.documentElement && document.documentElement.lang ? document.documentElement.lang : '').toLowerCase();
    var path = window.location ? window.location.pathname : '';
    return htmlLang.indexOf('tl') === 0 || htmlLang.indexOf('fil') === 0 || path === '/tl' || path.indexOf('/tl/') === 0;
  }

  var isTl = isFilipinoLocale();

  // Statutory parameters (Verified for 2026)
  var CONFIG = {
    premiumRate: 0.05,
    employeeShareRatio: 0.5,
    employerShareRatio: 0.5,
    floor: 10000,
    ceiling: 100000,
    defaultSalary: 25000
  };

  // Currency formatter
  function formatPHP(amount) {
    var num = Number(amount);
    if (isNaN(num)) num = 0;
    return '₱' + num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  // DOM Elements
  var salaryInput = document.getElementById('phSalaryInput');
  var resetButton = document.getElementById('phResetBtn');
  var validationAlert = document.getElementById('phValidationAlert');
  var freqMonthlyBtn = document.querySelector('[data-freq-toggle="monthly"]');
  var freqCutoffBtn = document.querySelector('[data-freq-toggle="cutoff"]');
  var calculateBtn = document.getElementById('calculatePhBtn') || document.getElementById('calculatePayBtn');
  var mobileCalculateBar = document.getElementById('mobileCalculateBar');
  var calculatorInputSection = document.getElementById('calculatorInputSection');
  var resultsSection = document.getElementById('calculatorResultsSection');

  // Outputs - Highlight Card
  var resEmployeeMonthly = document.getElementById('resEmployeeMonthly');
  var resTotalMonthly = document.getElementById('resTotalMonthly');
  var resEmployerMonthly = document.getElementById('resEmployerMonthly');
  var resCutoffEmployee = document.getElementById('resCutoffEmployee');
  var resCutoffEmployer = document.getElementById('resCutoffEmployer');
  var resCutoffTotal = document.getElementById('resCutoffTotal');

  // Outputs - Breakdown Table
  var tblBasicSalary = document.getElementById('tblBasicSalary');
  var tblApplicableMBS = document.getElementById('tblApplicableMBS');
  var tblSalaryBaseNote = document.getElementById('tblSalaryBaseNote');
  var tblEmployeeShare = document.getElementById('tblEmployeeShare');
  var tblEmployerShare = document.getElementById('tblEmployerShare');
  var tblTotalPremium = document.getElementById('tblTotalPremium');
  var freqHeaderLabel = document.getElementById('freqHeaderLabel');
  var employeeRowTitle = document.getElementById('employeeRowTitle');
  var employerRowTitle = document.getElementById('employerRowTitle');
  var totalRowTitle = document.getElementById('totalRowTitle');

  // Outputs - Annualized
  var resAnnualTotal = document.getElementById('resAnnualTotal');
  var resAnnualEmployee = document.getElementById('resAnnualEmployee');
  var resAnnualEmployer = document.getElementById('resAnnualEmployer');

  // Display mode ('monthly' or 'cutoff')
  var currentFrequency = 'monthly';

  function getCleanSalary() {
    if (!salaryInput) return 0;
    var raw = String(salaryInput.value || '').trim();
    if (!raw) return 0;
    var num = parseFloat(raw.replace(/,/g, ''));
    return isNaN(num) ? 0 : num;
  }

  function validateInput(salary) {
    if (!validationAlert) return true;
    if (salaryInput && String(salaryInput.value || '').trim() === '') {
      validationAlert.classList.add('hidden');
      return true;
    }
    if (salary < 0) {
      validationAlert.textContent = isTl
        ? 'Maling Halaga: Ang buwanang batayang sahod ay hindi maaaring negatibo.'
        : 'Invalid Input: Monthly basic salary cannot be negative.';
      validationAlert.classList.remove('hidden');
      return false;
    }
    if (salary > 2000000) {
      validationAlert.textContent = isTl
        ? 'Paalala: Ang ipinasok na sahod ay higit sa ₱2,000,000. Ang maximum ceiling ng PhilHealth ay ₱100,000.'
        : 'Note: Entered basic salary exceeds ₱2,000,000. PhilHealth computation is capped at the ₱100,000 ceiling.';
      validationAlert.classList.remove('hidden');
      return true;
    }
    validationAlert.classList.add('hidden');
    return true;
  }

  function recalculate() {
    var rawSalary = getCleanSalary();
    validateInput(rawSalary);

    // Apply statutory floor and ceiling
    var applicableSalary = rawSalary;
    var floorApplied = false;
    var ceilingApplied = false;

    if (rawSalary <= CONFIG.floor) {
      applicableSalary = CONFIG.floor;
      floorApplied = true;
    } else if (rawSalary >= CONFIG.ceiling) {
      applicableSalary = CONFIG.ceiling;
      ceilingApplied = true;
    }

    // Centavo rounding rule
    var totalMonthly = Math.round((applicableSalary * CONFIG.premiumRate + Number.EPSILON) * 100) / 100;
    var employeeMonthly = Math.round(((totalMonthly / 2) + Number.EPSILON) * 100) / 100;
    var employerMonthly = Math.round(((totalMonthly - employeeMonthly) + Number.EPSILON) * 100) / 100;

    // Per-Cutoff (50% split per semi-monthly payday)
    var employeeCutoff = Math.round(((employeeMonthly / 2) + Number.EPSILON) * 100) / 100;
    var employerCutoff = Math.round(((employerMonthly / 2) + Number.EPSILON) * 100) / 100;
    var totalCutoff = Math.round((employeeCutoff + employerCutoff + Number.EPSILON) * 100) / 100;

    // Annualized
    var totalAnnual = totalMonthly * 12;
    var employeeAnnual = employeeMonthly * 12;
    var employerAnnual = employerMonthly * 12;

    var isCutoff = currentFrequency === 'cutoff';

    // Update Highlight Banner
    if (resEmployeeMonthly) {
      resEmployeeMonthly.textContent = formatPHP(isCutoff ? employeeCutoff : employeeMonthly);
    }
    if (resTotalMonthly) {
      resTotalMonthly.textContent = formatPHP(isCutoff ? totalCutoff : totalMonthly);
    }
    if (resEmployerMonthly) {
      resEmployerMonthly.textContent = formatPHP(isCutoff ? employerCutoff : employerMonthly);
    }
    if (resCutoffEmployee) {
      resCutoffEmployee.textContent = formatPHP(employeeCutoff);
    }
    if (resCutoffEmployer) {
      resCutoffEmployer.textContent = formatPHP(employerCutoff);
    }
    if (resCutoffTotal) {
      resCutoffTotal.textContent = formatPHP(totalCutoff);
    }

    // Update Breakdown Table
    if (tblBasicSalary) {
      tblBasicSalary.textContent = formatPHP(rawSalary);
    }
    if (tblApplicableMBS) {
      tblApplicableMBS.textContent = formatPHP(applicableSalary);
    }
    if (tblSalaryBaseNote) {
      if (floorApplied) {
        tblSalaryBaseNote.textContent = isTl
          ? 'Inilapat ang Floor: Minimum na ₱10,000.00 batayang sahod (₱500 pinakamababang kontribusyon)'
          : 'Statutory Floor Applied: Minimum ₱10,000.00 salary base (₱500 min total premium)';
      } else if (ceilingApplied) {
        tblSalaryBaseNote.textContent = isTl
          ? 'Inilapat ang Ceiling: Maximum na ₱100,000.00 batayang sahod (₱5,000 pinakamataas na kontribusyon)'
          : 'Statutory Ceiling Applied: Capped at ₱100,000.00 salary base (₱5,000 max total premium)';
      } else {
        tblSalaryBaseNote.textContent = isTl
          ? 'Nasa loob ng karaniwang bracket na ₱10,000 hanggang ₱100,000 (5.0% kabuuang kontribusyon)'
          : 'Within standard ₱10,000 to ₱100,000 statutory bracket (5.0% total premium)';
      }
    }

    if (tblEmployeeShare) {
      tblEmployeeShare.textContent = formatPHP(isCutoff ? employeeCutoff : employeeMonthly);
    }
    if (tblEmployerShare) {
      tblEmployerShare.textContent = formatPHP(isCutoff ? employerCutoff : employerMonthly);
    }
    if (tblTotalPremium) {
      tblTotalPremium.textContent = formatPHP(isCutoff ? totalCutoff : totalMonthly);
    }

    // Dynamic row titles
    if (freqHeaderLabel) {
      freqHeaderLabel.textContent = isCutoff
        ? (isTl ? 'Halaga Bawat Kinsenas' : 'Amount Per Cutoff (Kinsenas)')
        : (isTl ? 'Buwanang Halaga' : 'Monthly Amount');
    }
    if (employeeRowTitle) {
      employeeRowTitle.textContent = isCutoff
        ? (isTl ? 'Bahagi ng Empleyado Bawat Kinsenas (2.5%)' : 'Employee Share Per Cutoff (2.5%)')
        : (isTl ? 'Buwanang Bahagi ng Empleyado (2.5%)' : 'Employee Share Monthly (2.5%)');
    }
    if (employerRowTitle) {
      employerRowTitle.textContent = isCutoff
        ? (isTl ? 'Bahagi ng Employer Bawat Kinsenas (2.5%)' : 'Employer Share Per Cutoff (2.5%)')
        : (isTl ? 'Buwanang Bahagi ng Employer (2.5%)' : 'Employer Share Monthly (2.5%)');
    }
    if (totalRowTitle) {
      totalRowTitle.textContent = isCutoff
        ? (isTl ? 'KABUUANG KONTRIBUSYON BAWAT KINSENAS' : 'Total PhilHealth Contribution Per Cutoff')
        : 'Total PhilHealth Contribution';
    }

    // Annualized
    if (resAnnualTotal) {
      resAnnualTotal.textContent = formatPHP(totalAnnual);
    }
    if (resAnnualEmployee) {
      resAnnualEmployee.textContent = formatPHP(employeeAnnual);
    }
    if (resAnnualEmployer) {
      resAnnualEmployer.textContent = formatPHP(employerAnnual);
    }
  }

  function setFrequency(freq) {
    currentFrequency = freq === 'cutoff' ? 'cutoff' : 'monthly';
    var isCutoff = currentFrequency === 'cutoff';

    if (freqMonthlyBtn) {
      freqMonthlyBtn.setAttribute('aria-pressed', isCutoff ? 'false' : 'true');
      if (isCutoff) {
        freqMonthlyBtn.classList.remove('bg-emerald-600', 'text-white', 'shadow-xs');
        freqMonthlyBtn.classList.add('text-slate-700');
      } else {
        freqMonthlyBtn.classList.add('bg-emerald-600', 'text-white', 'shadow-xs');
        freqMonthlyBtn.classList.remove('text-slate-700');
      }
    }

    if (freqCutoffBtn) {
      freqCutoffBtn.setAttribute('aria-pressed', isCutoff ? 'true' : 'false');
      if (isCutoff) {
        freqCutoffBtn.classList.add('bg-emerald-600', 'text-white', 'shadow-xs');
        freqCutoffBtn.classList.remove('text-slate-700');
      } else {
        freqCutoffBtn.classList.remove('bg-emerald-600', 'text-white', 'shadow-xs');
        freqCutoffBtn.classList.add('text-slate-700');
      }
    }

    recalculate();
  }

  function scrollToResultsSection() {
    if (!resultsSection) return;
    var headerEl = document.querySelector('header');
    var headerOffset = headerEl ? headerEl.offsetHeight + 12 : 76;
    var rect = resultsSection.getBoundingClientRect();
    var targetTop = Math.max(0, (window.pageYOffset || document.documentElement.scrollTop || 0) + rect.top - headerOffset);
    var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    window.scrollTo({
      top: targetTop,
      behavior: prefersReducedMotion ? 'auto' : 'smooth'
    });
  }

  function handleMobileCalculateTrigger() {
    recalculate();
    if (
      document.activeElement &&
      document.activeElement === salaryInput &&
      typeof document.activeElement.blur === 'function'
    ) {
      document.activeElement.blur();
    }
    scrollToResultsSection();
  }

  // Ensure focused inputs/controls on mobile are never obscured by sticky header or sticky calculate bar
  function ensureFocusedFieldUnobscured(targetEl) {
    if (!targetEl || window.innerWidth >= 1024) return;
    var fieldContainer = targetEl.closest('[data-calc-field]') || targetEl;
    var rect = fieldContainer.getBoundingClientRect();
    var headerEl = document.querySelector('header');
    var headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 64;

    var bottomLimit = window.innerHeight;
    if (mobileCalculateBar && window.getComputedStyle(mobileCalculateBar).display !== 'none') {
      var barRect = mobileCalculateBar.getBoundingClientRect();
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

  function bindEvents() {
    if (salaryInput) {
      salaryInput.addEventListener('input', recalculate);
      salaryInput.addEventListener('change', recalculate);
      salaryInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (window.innerWidth < 1024) {
            handleMobileCalculateTrigger();
          } else {
            recalculate();
          }
        }
      });
    }

    if (resetButton) {
      resetButton.addEventListener('click', function () {
        if (salaryInput) {
          salaryInput.value = CONFIG.defaultSalary;
        }
        setFrequency('monthly');
        recalculate();
        if (salaryInput) {
          salaryInput.focus();
        }
      });
    }

    // Quick preset buttons
    var presetBtns = document.querySelectorAll('[data-ph-preset]');
    for (var i = 0; i < presetBtns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var amount = btn.getAttribute('data-ph-preset');
          if (salaryInput && amount) {
            salaryInput.value = amount;
            recalculate();
          }
        });
      })(presetBtns[i]);
    }

    // Frequency switcher buttons
    if (freqMonthlyBtn) {
      freqMonthlyBtn.addEventListener('click', function () {
        setFrequency('monthly');
      });
    }
    if (freqCutoffBtn) {
      freqCutoffBtn.addEventListener('click', function () {
        setFrequency('cutoff');
      });
    }

    // Mobile Calculate / Scroll action
    if (calculateBtn) {
      calculateBtn.addEventListener('click', function (e) {
        e.preventDefault();
        handleMobileCalculateTrigger();
      });
    }

    if (calculatorInputSection) {
      calculatorInputSection.addEventListener('focusin', function (e) {
        var target = e.target;
        if (!target || target === calculateBtn) return;
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
        var active = document.activeElement;
        if (active && calculatorInputSection && calculatorInputSection.contains(active) && active !== calculateBtn) {
          ensureFocusedFieldUnobscured(active);
        }
      });
    }

    // Restore handoff state from sessionStorage if user switched language
    try {
      var rawHandoff = window.sessionStorage ? window.sessionStorage.getItem(CALC_HANDOFF_KEY) : null;
      if (rawHandoff) {
        var handoff = JSON.parse(rawHandoff);
        if (handoff && handoff.calculator === 'philhealth' && handoff.basicSalary) {
          if (salaryInput) {
            salaryInput.value = handoff.basicSalary;
          }
          if (handoff.frequency) {
            setFrequency(handoff.frequency);
          }
        }
      }
    } catch (e) {
      // Ignore handoff parsing errors
    }
  }

  // Initialize
  bindEvents();
  recalculate();

  // Expose calculation for unit testing
  window._SuweldoToolsPhilHealth = {
    recalculate: recalculate,
    formatPHP: formatPHP,
    CONFIG: CONFIG
  };
})();
