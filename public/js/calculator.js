/**
 * SuweldoTools — Philippine Take-Home Pay Calculator Engine (2026)
 * Vanilla JavaScript implementation.
 * Zero external dependencies. Supports English (en-PH) and Filipino (tl-PH).
 *
 * Grounded in statutory Philippine laws:
 * - SSS: RA 11199 (15% rate, 5% employee share, MSC ₱5,000 - ₱35,000)
 * - PhilHealth: RA 11223 (5% premium, 2.5% employee share, Floor ₱10,000, Ceiling ₱100,000)
 * - Pag-IBIG: RA 9679 & HDMF Circular 460 (2% employee rate, max ₱10,000 base = ₱200 max)
 * - Tax: RA 10963 (TRAIN Law revised withholding brackets) & RA 9504 (Minimum Wage Exemption)
 */

(function () {
  'use strict';

  function isFilipinoLocale() {
    var htmlLang = (document.documentElement && document.documentElement.lang ? document.documentElement.lang : '').toLowerCase();
    var path = window.location ? window.location.pathname : '';
    return htmlLang.indexOf('tl') === 0 || htmlLang.indexOf('fil') === 0 || path === '/tl' || path.indexOf('/tl/') === 0;
  }

  // Authoritative default rates (matches /src/data/rates-2026.json)
  const defaultRates = {
    year: 2026,
    sss: {
      totalRate: 0.15,
      employeeRate: 0.05,
      employerRate: 0.10,
      mscMin: 5000,
      mscMax: 35000,
      mscStep: 500,
      salaryFloorThreshold: 5250,
      salaryCeilingThreshold: 34750
    },
    philhealth: {
      totalPremiumRate: 0.05,
      employeeShareRate: 0.025,
      employerShareRate: 0.025,
      salaryFloor: 10000,
      salaryCeiling: 100000,
      minEmployeeContribution: 250,
      maxEmployeeContribution: 2500
    },
    pagibig: {
      lowSalaryThreshold: 1500,
      employeeRateLow: 0.01,
      employeeRate: 0.02,
      employerRate: 0.02,
      maxFundSalary: 10000,
      maxEmployeeContribution: 200
    },
    taxBracketsAnnual: [
      { min: 0, max: 250000, baseTax: 0, rate: 0 },
      { min: 250000, max: 400000, baseTax: 0, rate: 0.15 },
      { min: 400000, max: 800000, baseTax: 22500, rate: 0.20 },
      { min: 800000, max: 2000000, baseTax: 102500, rate: 0.25 },
      { min: 2000000, max: 8000000, baseTax: 402500, rate: 0.30 },
      { min: 8000000, max: null, baseTax: 2202500, rate: 0.35 }
    ]
  };

  let rates = JSON.parse(JSON.stringify(defaultRates));

  // Asynchronously attempt to load external JSON without blocking
  if (typeof fetch === 'function') {
    fetch('/data/rates-2026.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.sss && data.philhealth && data.pagibig) {
          rates.sss = Object.assign({}, defaultRates.sss, data.sss);
          rates.philhealth = Object.assign({}, defaultRates.philhealth, data.philhealth);
          rates.pagibig = Object.assign({}, defaultRates.pagibig, data.pagibig);
          if (data.withholdingTax && Array.isArray(data.withholdingTax.annualBrackets)) {
            rates.taxBracketsAnnual = data.withholdingTax.annualBrackets;
          }
          recalculate();
        }
      })
      .catch(() => {
        // Fallback gracefully to default embedded rates
      });
  }

  // DOM Elements
  const basicSalaryInput = document.getElementById('basicSalary');
  const allowancesInput = document.getElementById('allowances');
  const minWageCheckbox = document.getElementById('minWageEarner');
  const validationAlert = document.getElementById('validationAlert');

  // Frequency switch: monthly or cutoff
  let displayFrequency = 'monthly'; // 'monthly' or 'cutoff'
  const freqButtons = document.querySelectorAll('[data-freq-toggle]');

  // Result display elements
  const resGross = document.getElementById('resGross');
  const resMonthlyGross = document.getElementById('resMonthlyGross');
  const resCutoffGross = document.getElementById('resCutoffGross');
  const resSSS = document.getElementById('resSSS');
  const resPhilHealth = document.getElementById('resPhilHealth');
  const resPagIBIG = document.getElementById('resPagIBIG');
  const resTax = document.getElementById('resTax');
  const resTotalDeductions = document.getElementById('resTotalDeductions');
  const resNetPay = document.getElementById('resNetPay');
  const resCutoffPay = document.getElementById('resCutoffPay');
  const resNetPayTable = document.getElementById('resNetPayTable');
  const resAnnualNet = document.getElementById('resAnnualNet');
  const resTaxableIncome = document.getElementById('resTaxableIncome');
  const freqHeaderLabel = document.getElementById('freqHeaderLabel');
  const grossRowTitle = document.getElementById('grossRowTitle');
  const grossRowSubtitle = document.getElementById('grossRowSubtitle');
  const deductionsGroupLabel = document.getElementById('deductionsGroupLabel');
  const totalDeductionsRowTitle = document.getElementById('totalDeductionsRowTitle');
  const netRowTitle = document.getElementById('netRowTitle');
  const netRowSubtitle = document.getElementById('netRowSubtitle');

  // Preset chips
  const presetButtons = document.querySelectorAll('[data-salary-preset]');

  // Progress Bar Elements
  const barDeductions = document.getElementById('barDeductions');
  const barNet = document.getElementById('barNet');
  const barSSS = document.getElementById('barSSS');
  const barPH = document.getElementById('barPH');
  const barPI = document.getElementById('barPI');
  const barTax = document.getElementById('barTax');
  const deductionPercentageText = document.getElementById('deductionPercentageText');
  const netPercentageText = document.getElementById('netPercentageText');

  /**
   * Safe currency formatter (Philippine Peso)
   */
  function formatPHP(amount) {
    if (isNaN(amount) || amount === null || amount === undefined || amount <= 0) {
      return '₱0.00';
    }
    return '₱' + Number(amount).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * Sync preset chip active state with current basic salary & allowances
   */
  function syncPresetButtons(basicSalary, allowances) {
    if (!presetButtons || !presetButtons.length) return;
    presetButtons.forEach((b) => {
      const presetVal = parseFloat(b.getAttribute('data-salary-preset') || '0');
      if (basicSalary === presetVal && allowances === 0) {
        b.classList.remove('border-slate-200', 'bg-slate-50', 'text-slate-700');
        b.classList.add('border-emerald-300', 'bg-emerald-50', 'text-emerald-800');
      } else {
        b.classList.remove('border-emerald-300', 'bg-emerald-50', 'text-emerald-800');
        b.classList.add('border-slate-200', 'bg-slate-50', 'text-slate-700');
      }
    });
  }

  function syncFrequencyButtonStyles() {
    freqButtons.forEach((b) => {
      const freq = b.getAttribute('data-freq-toggle');
      if (freq === displayFrequency) {
        b.classList.remove('bg-slate-100', 'text-slate-700', 'hover:bg-slate-200');
        b.classList.add('bg-emerald-600', 'text-white', 'shadow-xs');
        if (typeof b.setAttribute === 'function') b.setAttribute('aria-pressed', 'true');
      } else {
        b.classList.remove('bg-emerald-600', 'text-white', 'shadow-xs');
        b.classList.add('bg-slate-100', 'text-slate-700', 'hover:bg-slate-200');
        if (typeof b.setAttribute === 'function') b.setAttribute('aria-pressed', 'false');
      }
    });
  }

  /**
   * SSS Employee Share (RA 11199)
   * 15% total rate, 5% employee share.
   * MSC Range: ₱5,000 to ₱35,000 in ₱500 steps.
   */
  function computeSSS(basicSalary) {
    if (basicSalary <= 0 || isNaN(basicSalary)) return 0;
    let msc;
    if (basicSalary < rates.sss.salaryFloorThreshold) {
      msc = rates.sss.mscMin;
    } else if (basicSalary >= rates.sss.salaryCeilingThreshold) {
      msc = rates.sss.mscMax;
    } else {
      msc = Math.round(basicSalary / rates.sss.mscStep) * rates.sss.mscStep;
      msc = Math.max(rates.sss.mscMin, Math.min(msc, rates.sss.mscMax));
    }
    return msc * rates.sss.employeeRate;
  }

  /**
   * PhilHealth Employee Share (RA 11223)
   * 5% total premium, 2.5% employee share.
   * Floor ₱10,000, Ceiling ₱100,000.
   */
  function computePhilHealth(basicSalary) {
    if (basicSalary <= 0 || isNaN(basicSalary)) return 0;
    const clampedSalary = Math.max(
      rates.philhealth.salaryFloor,
      Math.min(basicSalary, rates.philhealth.salaryCeiling)
    );
    return clampedSalary * rates.philhealth.employeeShareRate;
  }

  /**
   * Pag-IBIG Employee Share (RA 9679 & Circular 460)
   * 1% if <= ₱1,500; 2% if > ₱1,500.
   * Maximum monthly fund salary base ₱10,000 (cap = ₱200).
   */
  function computePagIBIG(basicSalary) {
    if (basicSalary <= 0 || isNaN(basicSalary)) return 0;
    const fundSalary = Math.min(basicSalary, rates.pagibig.maxFundSalary);
    const rate = basicSalary <= rates.pagibig.lowSalaryThreshold
      ? rates.pagibig.employeeRateLow
      : rates.pagibig.employeeRate;
    return Math.min(fundSalary * rate, rates.pagibig.maxEmployeeContribution);
  }

  /**
   * Withholding Tax (TRAIN Law - RA 10963)
   * Tax computed on annual taxable income, divided by 12 for monthly withholding.
   * Minimum wage earners exempt from income tax (RA 9504).
   */
  function computeWithholdingTax(taxableMonthly, isMinimumWage) {
    if (isMinimumWage || taxableMonthly <= 0 || isNaN(taxableMonthly)) return 0;
    const annualTaxable = taxableMonthly * 12;
    let annualTax = 0;

    for (let i = 0; i < rates.taxBracketsAnnual.length; i++) {
      const b = rates.taxBracketsAnnual[i];
      if (annualTaxable > b.min) {
        if (b.max === null || annualTaxable <= b.max) {
          annualTax = b.baseTax + ((annualTaxable - b.min) * b.rate);
          break;
        }
      }
    }

    return Math.max(0, annualTax / 12);
  }

  /**
   * Recalculate salary figures and update UI
   */
  function recalculate() {
    if (!basicSalaryInput) return;

    const isTl = isFilipinoLocale();
    let rawBasic = parseFloat(basicSalaryInput.value.replace(/,/g, ''));
    let basicSalary = 0;
    let hasWarning = false;
    let warningMessage = '';

    if (isNaN(rawBasic) || basicSalaryInput.value.trim() === '') {
      basicSalary = 0;
    } else if (rawBasic < 0) {
      basicSalary = 0;
      hasWarning = true;
      warningMessage = isTl
        ? 'Hindi maaaring negatibo ang sahod. Ibinalik ang kalkulasyon sa ₱0.00.'
        : 'Salary cannot be negative. Calculation reset to ₱0.00.';
    } else if (rawBasic > 20000000) {
      basicSalary = rawBasic;
      hasWarning = true;
      warningMessage = isTl
        ? 'Lumampas ang sahod sa karaniwang buwanang pamantayan. Inilapat ang tantiya hanggang sa statutory ceiling.'
        : 'Salary exceeds standard monthly payroll benchmarks. Estimates applied up to statutory caps.';
    } else {
      basicSalary = rawBasic;
    }

    let rawAllowances = allowancesInput ? parseFloat(allowancesInput.value.replace(/,/g, '')) : 0;
    let allowances = 0;
    if (isNaN(rawAllowances) || (allowancesInput && allowancesInput.value.trim() === '')) {
      allowances = 0;
    } else if (rawAllowances < 0) {
      allowances = 0;
      hasWarning = true;
      const allowNegMsg = isTl ? 'Hindi maaaring negatibo ang allowance.' : 'Allowances cannot be negative.';
      const allowSetZeroMsg = isTl ? 'Hindi maaaring negatibo ang allowance. Itinakda sa ₱0.00.' : 'Allowances cannot be negative. Set to ₱0.00.';
      warningMessage = warningMessage ? (warningMessage + ' ' + allowNegMsg) : allowSetZeroMsg;
    } else {
      allowances = rawAllowances;
    }

    const isMinimumWage = minWageCheckbox ? minWageCheckbox.checked : false;

    // Sync active preset chip state with current inputs
    syncPresetButtons(basicSalary, allowances);

    // Display validation alert if needed
    if (validationAlert) {
      if (hasWarning) {
        validationAlert.textContent = warningMessage;
        validationAlert.classList.remove('hidden');
      } else {
        validationAlert.classList.add('hidden');
        validationAlert.textContent = '';
      }
    }

    // Monthly core values
    const grossMonthly = basicSalary + allowances;
    const grossCutoff = grossMonthly / 2;
    const sssMonthly = computeSSS(basicSalary);
    const philHealthMonthly = computePhilHealth(basicSalary);
    const pagIBIGMonthly = computePagIBIG(basicSalary);

    const mandatoryContributionsMonthly = sssMonthly + philHealthMonthly + pagIBIGMonthly;
    const taxableIncomeMonthly = Math.max(0, grossMonthly - mandatoryContributionsMonthly);
    const withholdingTaxMonthly = computeWithholdingTax(taxableIncomeMonthly, isMinimumWage);
    const totalDeductionsMonthly = mandatoryContributionsMonthly + withholdingTaxMonthly;
    const netPayMonthly = Math.max(0, grossMonthly - totalDeductionsMonthly);

    const netPayCutoff = netPayMonthly / 2;
    const annualNetPay = netPayMonthly * 12;

    // Frequency multiplier for breakdown table display (50% equal split per cutoff)
    const isCutoff = (displayFrequency === 'cutoff');
    const mult = isCutoff ? 0.5 : 1.0;

    if (resGross) resGross.textContent = formatPHP(grossMonthly * mult);
    if (resMonthlyGross) resMonthlyGross.textContent = formatPHP(grossMonthly);
    if (resCutoffGross) resCutoffGross.textContent = formatPHP(grossCutoff);
    if (resSSS) resSSS.textContent = formatPHP(sssMonthly * mult);
    if (resPhilHealth) resPhilHealth.textContent = formatPHP(philHealthMonthly * mult);
    if (resPagIBIG) resPagIBIG.textContent = formatPHP(pagIBIGMonthly * mult);
    if (resTax) resTax.textContent = formatPHP(withholdingTaxMonthly * mult);
    if (resTotalDeductions) resTotalDeductions.textContent = formatPHP(totalDeductionsMonthly * mult);

    // Hero summary values always display monthly & cutoff distinctly
    if (resNetPay) resNetPay.textContent = formatPHP(netPayMonthly);
    if (resCutoffPay) resCutoffPay.textContent = formatPHP(netPayCutoff);
    if (resNetPayTable) resNetPayTable.textContent = formatPHP(netPayMonthly * mult);

    if (resTaxableIncome) resTaxableIncome.textContent = formatPHP(taxableIncomeMonthly);
    if (resAnnualNet) resAnnualNet.textContent = formatPHP(annualNetPay);

    if (freqHeaderLabel) {
      if (isTl) {
        freqHeaderLabel.textContent = isCutoff ? 'Bawat Kinsenas (Cutoff)' : 'Buwanang Halaga';
      } else {
        freqHeaderLabel.textContent = isCutoff ? 'Per Cutoff (Kinsenas)' : 'Monthly Amount';
      }
    }
    if (grossRowTitle) {
      if (isTl) {
        grossRowTitle.textContent = isCutoff ? 'Gross na Sahod Bawat Kinsenas (Cutoff)' : 'Buwanang Gross na Sahod';
      } else {
        grossRowTitle.textContent = isCutoff ? 'Gross Salary Per Cutoff (Kinsenas)' : 'Gross Monthly Salary';
      }
    }
    if (grossRowSubtitle) {
      if (isTl) {
        grossRowSubtitle.textContent = isCutoff
          ? '50% ng buwanang gross na sahod bawat kinsenas (bago ang kaltas)'
          : 'Basic salary + taxable allowances (bago ang kaltas)';
      } else {
        grossRowSubtitle.textContent = isCutoff
          ? '50% of monthly gross salary per semi-monthly payday (before deductions)'
          : 'Basic salary + taxable allowances (before deductions)';
      }
    }
    if (deductionsGroupLabel) {
      if (isTl) {
        deductionsGroupLabel.textContent = isCutoff
          ? 'Mandatory na Kaltas sa Empleyado (50% Hati Bawat Kinsenas)'
          : 'Mandatory na Kaltas sa Empleyado';
      } else {
        deductionsGroupLabel.textContent = isCutoff
          ? 'Mandatory Employee Deductions (50% Cutoff Allocation)'
          : 'Mandatory Employee Deductions';
      }
    }
    if (totalDeductionsRowTitle) {
      if (isTl) {
        totalDeductionsRowTitle.textContent = isCutoff
          ? 'Kabuuang Kaltas Bawat Kinsenas (Cutoff)'
          : 'Kabuuang Buwanang Kaltas';
      } else {
        totalDeductionsRowTitle.textContent = isCutoff
          ? 'Total Deductions Per Cutoff (Kaltas)'
          : 'Total Monthly Deductions (Kaltas)';
      }
    }
    if (netRowTitle) {
      if (isTl) {
        netRowTitle.textContent = isCutoff
          ? 'NET NA SAHOD BAWAT KINSENAS (CUTOFF)'
          : 'BUWANANG NET TAKE-HOME PAY (SAHOD)';
      } else {
        netRowTitle.textContent = isCutoff
          ? 'NET SALARY PER CUTOFF (KINSENAS)'
          : 'NET MONTHLY TAKE-HOME PAY';
      }
    }
    if (netRowSubtitle) {
      if (isTl) {
        netRowSubtitle.textContent = isCutoff
          ? 'Tinatayang net take-home sahod bawat kinsenas matapos ang 50% hati ng kaltas'
          : 'Aktwal na buwanang take-home sahod matapos ang mga kaltas';
      } else {
        netRowSubtitle.textContent = isCutoff
          ? 'Estimated net take-home sahod per cutoff after 50% deduction split'
          : 'Actual monthly take-home sahod after deductions';
      }
    }

    // Pure-CSS multi-segment proportion bar
    if (grossMonthly > 0) {
      const deductionPct = Math.min(100, Math.max(0, (totalDeductionsMonthly / grossMonthly) * 100));
      const netPct = Math.max(0, 100 - deductionPct);

      if (deductionPercentageText) deductionPercentageText.textContent = deductionPct.toFixed(1) + '%';
      if (netPercentageText) netPercentageText.textContent = netPct.toFixed(1) + '%';

      const sssPct = (sssMonthly / grossMonthly) * 100;
      const phPct = (philHealthMonthly / grossMonthly) * 100;
      const piPct = (pagIBIGMonthly / grossMonthly) * 100;
      const taxPct = (withholdingTaxMonthly / grossMonthly) * 100;

      if (barSSS) barSSS.style.width = sssPct.toFixed(2) + '%';
      if (barPH) barPH.style.width = phPct.toFixed(2) + '%';
      if (barPI) barPI.style.width = piPct.toFixed(2) + '%';
      if (barTax) barTax.style.width = taxPct.toFixed(2) + '%';
      if (barNet) barNet.style.width = netPct.toFixed(2) + '%';
      if (barDeductions) barDeductions.style.width = deductionPct.toFixed(2) + '%';
    } else {
      if (deductionPercentageText) deductionPercentageText.textContent = '0%';
      if (netPercentageText) netPercentageText.textContent = '100%';
      if (barSSS) barSSS.style.width = '0%';
      if (barPH) barPH.style.width = '0%';
      if (barPI) barPI.style.width = '0%';
      if (barTax) barTax.style.width = '0%';
      if (barNet) barNet.style.width = '100%';
      if (barDeductions) barDeductions.style.width = '0%';
    }
  }

  function restoreLanguageHandoffState() {
    try {
      var raw = window.sessionStorage ? window.sessionStorage.getItem('suweldotools_calc_handoff') : null;
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.calculator === 'take-home') {
        window.sessionStorage.removeItem('suweldotools_calc_handoff');
        if (basicSalaryInput && parsed.basicSalary !== undefined) {
          basicSalaryInput.value = parsed.basicSalary;
        }
        if (allowancesInput && parsed.allowances !== undefined) {
          allowancesInput.value = parsed.allowances;
        }
        if (minWageCheckbox && parsed.minWageEarner !== undefined) {
          minWageCheckbox.checked = Boolean(parsed.minWageEarner);
        }
        if (parsed.displayFrequency === 'cutoff' || parsed.displayFrequency === 'monthly') {
          displayFrequency = parsed.displayFrequency;
          syncFrequencyButtonStyles();
        }
      }
    } catch (e) {
      // Ignore parse/storage errors
    }
  }

  // Frequency switcher event listeners
  freqButtons.forEach((btn) => {
    btn.addEventListener('click', function () {
      const targetFreq = this.getAttribute('data-freq-toggle');
      if (targetFreq && (targetFreq === 'monthly' || targetFreq === 'cutoff')) {
        displayFrequency = targetFreq;
        syncFrequencyButtonStyles();
        recalculate();
      }
    });
  });

  // Event Listeners for inputs
  if (basicSalaryInput) {
    basicSalaryInput.addEventListener('input', recalculate);
    basicSalaryInput.addEventListener('change', recalculate);
  }
  if (allowancesInput) {
    allowancesInput.addEventListener('input', recalculate);
    allowancesInput.addEventListener('change', recalculate);
  }
  if (minWageCheckbox) {
    minWageCheckbox.addEventListener('change', recalculate);
  }

  // Mobile Calculate button & smooth scroll to results
  const calculatePayBtn = document.getElementById('calculatePayBtn');
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
      (document.activeElement === basicSalaryInput || document.activeElement === allowancesInput) &&
      typeof document.activeElement.blur === 'function'
    ) {
      document.activeElement.blur();
    }
    scrollToResultsSection();
  }

  if (calculatePayBtn) {
    calculatePayBtn.addEventListener('click', function () {
      handleMobileCalculateTrigger();
    });
  }

  // Allow pressing Enter in mobile salary/allowance inputs to calculate and scroll to results
  [basicSalaryInput, allowancesInput].forEach((inputEl) => {
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
      if (!target || target === calculatePayBtn) return;
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
      if (active && calculatorInputSection && calculatorInputSection.contains(active) && active !== calculatePayBtn) {
        ensureFocusedFieldUnobscured(active);
      }
    });
  }

  // Preset chips styling & behavior
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', function () {
      const val = this.getAttribute('data-salary-preset');
      if (basicSalaryInput && val) {
        basicSalaryInput.value = val;
        if (allowancesInput) allowancesInput.value = '0';
        if (minWageCheckbox) minWageCheckbox.checked = false;
        recalculate();
      }
    });
  });

  // Reset button behavior
  const resetSalaryBtn = document.getElementById('resetSalaryBtn');
  if (resetSalaryBtn) {
    resetSalaryBtn.addEventListener('click', function () {
      if (basicSalaryInput) basicSalaryInput.value = '25000';
      if (allowancesInput) allowancesInput.value = '0';
      if (minWageCheckbox) minWageCheckbox.checked = false;

      // Reset frequency to monthly
      displayFrequency = 'monthly';
      syncFrequencyButtonStyles();
      recalculate();
    });
  }

  // Restore any state from language switch and run initial calculation
  restoreLanguageHandoffState();
  document.addEventListener('DOMContentLoaded', function () {
    restoreLanguageHandoffState();
    recalculate();
  });
  recalculate();

  // Export for testing
  window.SuweldoCalculator = {
    computeSSS,
    computePhilHealth,
    computePagIBIG,
    computeWithholdingTax,
    recalculate,
    rates
  };
})();
