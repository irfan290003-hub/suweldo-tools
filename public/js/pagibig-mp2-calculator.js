/**
 * Suweldo Tools — 2026 Pag-IBIG Regular Savings & MP2 Savings Estimator
 * Standalone Vanilla JS Calculation Engine (Bilingual EN / TL)
 *
 * Statutory Reference (Mandatory Regular Savings / Pag-IBIG I):
 * - Republic Act No. 9679 (Home Development Mutual Fund Law of 2009)
 * - HDMF Circular No. 460 (Effective February 2024 onwards, continued for 2026):
 *   - Monthly Basic Compensation <= ₱1,500.00: 1.0% Employee Share | 2.0% Employer Share
 *   - Monthly Basic Compensation >  ₱1,500.00: 2.0% Employee Share | 2.0% Employer Share
 *   - Maximum Fund Salary (MFS) Ceiling: ₱10,000.00
 *   - Standard Maximum Mandatory Monthly Contribution: ₱200.00 Employee + ₱200.00 Employer = ₱400.00 Total
 *
 * Voluntary MP2 Savings (Modified Pag-IBIG II):
 * - Minimum per-remittance contribution under Pag-IBIG rules: ₱500.00
 * - Standard statutory maturity period: 5 years (1 to 5 year projection supported)
 * - Dividend rates are declared annually by the Pag-IBIG Fund Board of Trustees based on actual
 *   Fund net income and are NEVER guaranteed. All MP2 outputs are illustrative projections.
 */

(function () {
  'use strict';

  var HANDOFF_STORAGE_KEY = 'suweldotools_calc_handoff';

  // Verified 2026 Statutory Pag-IBIG Regular Savings Defaults (matches /data/rates-2026.json)
  var PAGIBIG_RATES = {
    lowSalaryThreshold: 1500,
    employeeRateLow: 0.01,
    employeeRate: 0.02,
    employerRate: 0.02,
    maxFundSalary: 10000,
    maxEmployeeContribution: 200
  };

  var MAX_SAFE_SALARY = 100000000; // ₱100M upper sanity bound
  var MAX_SAFE_MP2_DEPOSIT = 100000000; // ₱100M upper sanity bound
  var MIN_MP2_CONTRIBUTION = 500; // ₱500 standard Pag-IBIG MP2 minimum per remittance

  var isTagalog = (document.documentElement.getAttribute('lang') || '')
    .toLowerCase()
    .indexOf('tl') === 0;

  var I18N = {
    en: {
      invalidSalary: 'Please enter a valid monthly basic salary (₱0.00 or higher).',
      salaryTooHigh: 'Salary exceeds the maximum supported calculation limit (₱100,000,000).',
      zeroSalaryNote: 'Enter a monthly basic salary above ₱0.00 to compute mandatory Pag-IBIG Regular Savings.',
      belowThresholdBadge: '≤ ₱1,500 Tier (1% EE / 2% ER)',
      standardTierBadge: 'Standard Tier (2% EE / 2% ER)',
      cappedAtMfsBadge: 'Capped at ₱10,000 MFS Ceiling (₱200 EE / ₱200 ER)',
      selfEmployedBadge: 'Voluntary / Self-Employed Mode (No Employer Counterpart)',
      customEmployeeRateBadge: 'Custom Employee Rate Override Applied',
      freqMonthlySuffix: '/ month',
      freqCutoffSuffix: '/ cutoff (kinsenas)',
      eeRateAutoLow: '1.0% (Statutory ≤ ₱1,500)',
      eeRateAutoHigh: '2.0% (Statutory > ₱1,500)',
      eeRateOverride1: '1.0% (Selected Rate)',
      eeRateOverride2: '2.0% (Selected Rate)',
      erRateStandard: '2.0% (Employer Counterpart)',
      erRateZero: '0.0% (No Employer Share)',
      mfsAppliedNote: 'Your salary exceeds the ₱10,000.00 Maximum Fund Salary (MFS) ceiling under HDMF Circular No. 460. Mandatory percentages apply only to the first ₱10,000.00.',
      mfsWithinNote: 'Your salary is within the ₱10,000.00 Maximum Fund Salary (MFS) ceiling. Contributions are computed on your exact monthly basic pay.',
      mp2InvalidInput: 'Please enter valid non-negative amounts for your MP2 savings inputs.',
      mp2RateRangeWarning: 'Assumed annual dividend rate must be between 0% and 20%.',
      mp2BelowMinNotice: 'Note: Pag-IBIG MP2 rules require a minimum of ₱500.00 per contribution remittance. Showing mathematical projection for your entered amount.',
      mp2ZeroSavingsNotice: 'Enter an initial deposit or regular savings amount above ₱0 to project MP2 maturity values.',
      treatmentCompoundedLabel: 'Compounded Annually (Paid at Maturity)',
      treatmentPayoutLabel: 'Annual Dividend Payout (Paid Yearly)',
      yearPrefix: 'Year ',
      compoundedAdvantageText: 'Compounding dividends reinvests your annual earnings, yielding an estimated ',
      compoundedAdvantageSuffix: ' more over the selected period compared to taking annual payouts.',
      sameYieldOneYearText: 'For a 1-year period, compounded maturity and annual payout yield the exact same total return because compounding begins in Year 2.'
    },
    tl: {
      invalidSalary: 'Maglagay ng wastong buwanang basic salary (₱0.00 o mas mataas).',
      salaryTooHigh: 'Lumampas ang sahod sa pinakamataas na limitasyon ng calculator (₱100,000,000).',
      zeroSalaryNote: 'Maglagay ng buwanang basic salary na lampas ₱0.00 upang makalkula ang mandatory Pag-IBIG Regular Savings.',
      belowThresholdBadge: '≤ ₱1,500 Bracket (1% Empleyado / 2% Employer)',
      standardTierBadge: 'Standard Bracket (2% Empleyado / 2% Employer)',
      cappedAtMfsBadge: 'Naka-cap sa ₱10,000 MFS Ceiling (₱200 EE / ₱200 ER)',
      selfEmployedBadge: 'Voluntary / Self-Employed Mode (Walang Bahagi ng Employer)',
      customEmployeeRateBadge: 'Ginamit ang Piniling Employee Contribution Rate',
      freqMonthlySuffix: '/ buwan',
      freqCutoffSuffix: '/ kinsenas (cutoff)',
      eeRateAutoLow: '1.0% (Statutory ≤ ₱1,500)',
      eeRateAutoHigh: '2.0% (Statutory > ₱1,500)',
      eeRateOverride1: '1.0% (Piniling Rate)',
      eeRateOverride2: '2.0% (Piniling Rate)',
      erRateStandard: '2.0% (Bahagi ng Employer)',
      erRateZero: '0.0% (Walang Employer Share)',
      mfsAppliedNote: 'Lampas ang iyong sahod sa ₱10,000.00 Maximum Fund Salary (MFS) ceiling sa ilalim ng HDMF Circular No. 460. Sa unang ₱10,000.00 lamang kinukuwenta ang mandatory contribution.',
      mfsWithinNote: 'Nasa loob ng ₱10,000.00 Maximum Fund Salary (MFS) ceiling ang iyong sahod. Kinukuwenta ang kontribusyon base sa eksaktong buwanang basic pay.',
      mp2InvalidInput: 'Maglagay ng wastong halaga (₱0 o mas mataas) para sa iyong MP2 savings.',
      mp2RateRangeWarning: 'Ang assumed annual dividend rate ay dapat nasa pagitan ng 0% at 20%.',
      mp2BelowMinNotice: 'Paalala: Ang Pag-IBIG MP2 ay may minimum na ₱500.00 bawat hulog. Ipinapakita pa rin ang tantiyang kalkulasyon para sa inilagay na halaga.',
      mp2ZeroSavingsNotice: 'Maglagay ng initial deposit o regular na hulog na lampas ₱0 upang makita ang MP2 projection.',
      treatmentCompoundedLabel: 'Compounded Annually (Makukuha sa Maturity)',
      treatmentPayoutLabel: 'Annual Dividend Payout (Taunang Payout)',
      yearPrefix: 'Taon ',
      compoundedAdvantageText: 'Sa compounded mode, muling ini-invest ang dibidendo kaya tinatayang mas mataas ito nang ',
      compoundedAdvantageSuffix: ' kumpara sa taunang payout sa napiling panahon.',
      sameYieldOneYearText: 'Para sa 1-taong panahon, pareho ang kabuuang balik ng compounded at annual payout dahil sa Ika-2 Taon pa nagsisimula ang epekto ng compounding.'
    }
  };

  var t = isTagalog ? I18N.tl : I18N.en;

  // State
  var currentRegFreq = 'monthly'; // 'monthly' | 'cutoff'
  var currentMp2Frequency = 'monthly'; // 'monthly' | 'annual'
  var currentMp2Treatment = 'compounded'; // 'compounded' | 'payout'

  // Helpers
  function round2(val) {
    return Math.round((val + Number.EPSILON) * 100) / 100;
  }

  function formatPHP(val) {
    var safeVal = isFinite(val) ? val : 0;
    return '₱' + safeVal.toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatPercent(decimalRate) {
    return (decimalRate * 100).toFixed(2) + '%';
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function parseNumericInput(rawVal) {
    if (rawVal === null || rawVal === undefined) return NaN;
    var cleaned = String(rawVal).replace(/,/g, '').trim();
    if (cleaned === '') return 0;
    return Number(cleaned);
  }

  /**
   * 1. Mandatory Pag-IBIG Regular Savings Computation (Pag-IBIG I)
   * Pure function for statutory Regular Savings calculation
   */
  function computeRegularSavings(monthlySalary, eeRateMode, erRateMode) {
    var salary = Math.max(0, Number(monthlySalary) || 0);
    var mfsCeiling = PAGIBIG_RATES.maxFundSalary;
    var creditedSalaryBase = round2(Math.min(salary, mfsCeiling));
    var isCapped = salary > mfsCeiling;

    // Determine employee rate
    var eeRate = 0;
    if (salary > 0) {
      if (eeRateMode === '1%') {
        eeRate = 0.01;
      } else if (eeRateMode === '2%') {
        eeRate = 0.02;
      } else {
        // 'auto' statutory rule per HDMF Circular No. 460
        eeRate = salary <= PAGIBIG_RATES.lowSalaryThreshold
          ? PAGIBIG_RATES.employeeRateLow
          : PAGIBIG_RATES.employeeRate;
      }
    }

    // Determine employer rate
    var erRate = 0;
    if (salary > 0) {
      if (erRateMode === '0%') {
        erRate = 0;
      } else {
        erRate = PAGIBIG_RATES.employerRate; // 2.0%
      }
    }

    var employeeMonthly = round2(creditedSalaryBase * eeRate);
    var employerMonthly = round2(creditedSalaryBase * erRate);
    var totalMonthly = round2(employeeMonthly + employerMonthly);

    var employeeCutoff = round2(employeeMonthly / 2);
    var employerCutoff = round2(employerMonthly / 2);
    var totalCutoff = round2(totalMonthly / 2);

    var employeeAnnual = round2(employeeMonthly * 12);
    var employerAnnual = round2(employerMonthly * 12);
    var totalAnnual = round2(totalMonthly * 12);

    return {
      salary: salary,
      mfsCeiling: mfsCeiling,
      creditedSalaryBase: creditedSalaryBase,
      isCapped: isCapped,
      eeRate: eeRate,
      erRate: erRate,
      employeeMonthly: employeeMonthly,
      employerMonthly: employerMonthly,
      totalMonthly: totalMonthly,
      employeeCutoff: employeeCutoff,
      employerCutoff: employerCutoff,
      totalCutoff: totalCutoff,
      employeeAnnual: employeeAnnual,
      employerAnnual: employerAnnual,
      totalAnnual: totalAnnual
    };
  }

  /**
   * 2. Voluntary MP2 Savings Projection Engine
   * Computes both Compounded (Reinvested) and Annual Dividend Payout schedules side-by-side
   *
   * Average Monthly Balance Method (Pag-IBIG MP2 standard convention):
   * - Opening balance at start of year t earns a full 12/12 months of the annual dividend rate r.
   * - If contributions are made MONTHLY (M per month at the start of each month):
   *   Month 1 earns 12/12, Month 2 earns 11/12 ... Month 12 earns 1/12.
   *   Sum of (13 - m)/12 for m = 1..12 is 78/12 = 6.5 months of equivalent full-year principal.
   *   Annual contribution added = 12 * M; Weighted average contribution for dividend = 6.5 * M.
   * - If contributions are made ANNUALLY (A at the start of each year):
   *   Annual contribution added = A; Weighted average contribution for dividend = A (full 12/12 year).
   */
  function computeMp2Projection(initialDeposit, regularContribution, frequency, years, annualDividendRatePercent) {
    var initDep = Math.max(0, Number(initialDeposit) || 0);
    var regContrib = Math.max(0, Number(regularContribution) || 0);
    var termYears = Math.min(5, Math.max(1, parseInt(years, 10) || 5));
    var rateDecimal = Math.max(0, Math.min(0.20, (Number(annualDividendRatePercent) || 0) / 100));
    var isMonthly = frequency !== 'annual';

    var annualContributionAdded = isMonthly ? round2(regContrib * 12) : round2(regContrib);
    var weightedAnnualContribution = isMonthly ? round2(regContrib * 6.5) : round2(regContrib);

    // Track Compounded Schedule
    var compRows = [];
    var compOpen = initDep;
    var compCumulativeContrib = initDep;
    var compCumulativeDividends = 0;

    // Track Annual Payout Schedule
    var payoutRows = [];
    var payoutOpen = initDep;
    var payoutCumulativeContrib = initDep;
    var payoutCumulativeDividends = 0;

    for (var yr = 1; yr <= termYears; yr++) {
      // Compounded year calculation
      var compDividendBase = compOpen + weightedAnnualContribution;
      var compDividend = round2(compDividendBase * rateDecimal);
      var compClose = round2(compOpen + annualContributionAdded + compDividend);
      compCumulativeContrib = round2(compCumulativeContrib + annualContributionAdded);
      compCumulativeDividends = round2(compCumulativeDividends + compDividend);

      compRows.push({
        year: yr,
        openingBalance: compOpen,
        annualContribution: annualContributionAdded,
        dividendEarned: compDividend,
        closingBalance: compClose,
        cumulativePrincipal: compCumulativeContrib,
        cumulativeDividends: compCumulativeDividends,
        totalValueToDate: compClose
      });
      compOpen = compClose;

      // Annual Payout year calculation (dividends paid out yearly, not added to next year's opening principal)
      var payoutDividendBase = payoutOpen + weightedAnnualContribution;
      var payoutDividend = round2(payoutDividendBase * rateDecimal);
      var payoutClosePrincipal = round2(payoutOpen + annualContributionAdded);
      payoutCumulativeContrib = round2(payoutCumulativeContrib + annualContributionAdded);
      payoutCumulativeDividends = round2(payoutCumulativeDividends + payoutDividend);

      payoutRows.push({
        year: yr,
        openingBalance: payoutOpen,
        annualContribution: annualContributionAdded,
        dividendEarned: payoutDividend,
        closingBalance: payoutClosePrincipal,
        cumulativePrincipal: payoutCumulativeContrib,
        cumulativeDividends: payoutCumulativeDividends,
        totalValueToDate: round2(payoutClosePrincipal + payoutCumulativeDividends)
      });
      payoutOpen = payoutClosePrincipal;
    }

    var totalPrincipal = round2(initDep + annualContributionAdded * termYears);
    var compTotalDividends = compCumulativeDividends;
    var compMaturityValue = round2(totalPrincipal + compTotalDividends);

    var payoutTotalDividends = payoutCumulativeDividends;
    var payoutTotalValue = round2(totalPrincipal + payoutTotalDividends);

    var compoundingDifference = round2(compMaturityValue - payoutTotalValue);

    return {
      initialDeposit: initDep,
      regularContribution: regContrib,
      frequency: isMonthly ? 'monthly' : 'annual',
      years: termYears,
      ratePercent: Number(annualDividendRatePercent) || 0,
      rateDecimal: rateDecimal,
      annualContributionAdded: annualContributionAdded,
      totalPrincipal: totalPrincipal,
      compounded: {
        totalPrincipal: totalPrincipal,
        totalDividends: compTotalDividends,
        totalMaturityValue: compMaturityValue,
        rows: compRows
      },
      payout: {
        totalPrincipal: totalPrincipal,
        totalDividends: payoutTotalDividends,
        totalValue: payoutTotalValue,
        rows: payoutRows
      },
      compoundingDifference: compoundingDifference
    };
  }

  /**
   * Render Mandatory Pag-IBIG Regular Savings UI
   */
  function updateRegularSavingsUI() {
    var salaryInput = document.getElementById('piBasicSalary');
    var eeRateSelect = document.getElementById('piEmployeeRateMode');
    var erRateSelect = document.getElementById('piEmployerRateMode');
    var errorBanner = document.getElementById('piValidationAlert');
    var errorText = document.getElementById('piValidationText');

    if (!salaryInput) return;

    var hasBadSalaryInput = Boolean(salaryInput.validity && salaryInput.validity.badInput);
    var rawSalary = hasBadSalaryInput ? NaN : parseNumericInput(salaryInput.value);
    var eeRateMode = eeRateSelect ? eeRateSelect.value : 'auto';
    var erRateMode = erRateSelect ? erRateSelect.value : '2%';

    var hasRegularError = false;
    var safeSalary = rawSalary;

    // Validation
    if (hasBadSalaryInput || !Number.isFinite(rawSalary) || rawSalary < 0) {
      hasRegularError = true;
      safeSalary = 0;
      if (errorBanner && errorText) {
        errorText.textContent = t.invalidSalary;
        errorBanner.classList.remove('hidden');
      }
    } else if (rawSalary > MAX_SAFE_SALARY) {
      hasRegularError = true;
      safeSalary = 0;
      if (errorBanner && errorText) {
        errorText.textContent = t.salaryTooHigh;
        errorBanner.classList.remove('hidden');
      }
    } else if (errorBanner) {
      errorBanner.classList.add('hidden');
    }

    var res = computeRegularSavings(safeSalary, eeRateMode, erRateMode);
    var isCutoff = currentRegFreq === 'cutoff';
    var freqSuffix = isCutoff ? t.freqCutoffSuffix : t.freqMonthlySuffix;

    var displayEE = isCutoff ? res.employeeCutoff : res.employeeMonthly;
    var displayER = isCutoff ? res.employerCutoff : res.employerMonthly;
    var displayTotal = isCutoff ? res.totalCutoff : res.totalMonthly;

    setText('piHeroEmployeeShare', formatPHP(displayEE));
    setText('piHeroFreqLabel', freqSuffix);
    setText('piEmployerShareDisplay', formatPHP(displayER));
    setText('piTotalMonthlyRemittance', formatPHP(displayTotal));
    setText('piCreditedSalaryBase', formatPHP(res.creditedSalaryBase));
    setText('piCutoffEmployeeShare', formatPHP(res.employeeCutoff));

    // Annual figures
    setText('piAnnualEmployeeShare', formatPHP(res.employeeAnnual));
    setText('piAnnualEmployerShare', formatPHP(res.employerAnnual));
    setText('piAnnualTotalSavings', formatPHP(res.totalAnnual));

    // Applied Rate Labels
    var eeRateLabel = '';
    if (eeRateMode === '1%') {
      eeRateLabel = t.eeRateOverride1;
    } else if (eeRateMode === '2%') {
      eeRateLabel = t.eeRateOverride2;
    } else {
      eeRateLabel = res.salary > 0 && res.salary <= PAGIBIG_RATES.lowSalaryThreshold
        ? t.eeRateAutoLow
        : t.eeRateAutoHigh;
    }
    var erRateLabel = erRateMode === '0%' ? t.erRateZero : t.erRateStandard;

    setText('piAppliedEeRateText', eeRateLabel);
    setText('piAppliedErRateText', erRateLabel);

    // Tier / Status Badge & MFS Notice
    var statusBadgeEl = document.getElementById('piTierStatusBadge');
    if (statusBadgeEl) {
      if (res.salary === 0) {
        statusBadgeEl.textContent = t.zeroSalaryNote;
      } else if (erRateMode === '0%') {
        statusBadgeEl.textContent = t.selfEmployedBadge;
      } else if (res.isCapped) {
        statusBadgeEl.textContent = t.cappedAtMfsBadge;
      } else if (res.salary <= PAGIBIG_RATES.lowSalaryThreshold) {
        statusBadgeEl.textContent = t.belowThresholdBadge;
      } else {
        statusBadgeEl.textContent = t.standardTierBadge;
      }
    }

    setText('piMfsExplanationText', res.isCapped ? t.mfsAppliedNote : t.mfsWithinNote);

    // Highlight active quick salary preset button
    var presetBtns = document.querySelectorAll('.pi-salary-preset');
    for (var i = 0; i < presetBtns.length; i++) {
      var btnVal = Number(presetBtns[i].getAttribute('data-salary'));
      if (!hasRegularError && btnVal === res.salary) {
        presetBtns[i].classList.add('border-emerald-600', 'bg-emerald-50', 'text-emerald-800', 'font-bold');
        presetBtns[i].classList.remove('border-slate-200', 'bg-white', 'text-slate-700');
      } else {
        presetBtns[i].classList.remove('border-emerald-600', 'bg-emerald-50', 'text-emerald-800', 'font-bold');
        presetBtns[i].classList.add('border-slate-200', 'bg-white', 'text-slate-700');
      }
    }

    return !hasRegularError;
  }

  /**
   * Render Voluntary MP2 Savings Projection UI
   */
  function updateMp2UI() {
    var initDepositInput = document.getElementById('mp2InitialDeposit');
    var contribInput = document.getElementById('mp2ContributionAmount');
    var yearsSelect = document.getElementById('mp2Years');
    var rateInput = document.getElementById('mp2DividendRate');
    var alertBanner = document.getElementById('mp2ValidationAlert');
    var alertText = document.getElementById('mp2ValidationText');

    if (!initDepositInput || !contribInput || !yearsSelect || !rateInput) return;

    var hasBadInitInput = Boolean(initDepositInput.validity && initDepositInput.validity.badInput);
    var hasBadContribInput = Boolean(contribInput.validity && contribInput.validity.badInput);
    var hasBadRateInput = Boolean(rateInput.validity && rateInput.validity.badInput);

    var rawInit = hasBadInitInput ? NaN : parseNumericInput(initDepositInput.value);
    var rawContrib = hasBadContribInput ? NaN : parseNumericInput(contribInput.value);
    var rawYears = parseInt(yearsSelect.value, 10) || 5;
    var rawRate = hasBadRateInput ? NaN : parseNumericInput(rateInput.value);

    var hasMp2HardError = false;

    // Validate numeric inputs
    if (
      hasBadInitInput || !Number.isFinite(rawInit) || rawInit < 0 || rawInit > MAX_SAFE_MP2_DEPOSIT ||
      hasBadContribInput || !Number.isFinite(rawContrib) || rawContrib < 0 || rawContrib > MAX_SAFE_MP2_DEPOSIT
    ) {
      hasMp2HardError = true;
      if (alertBanner && alertText) {
        alertText.textContent = t.mp2InvalidInput;
        alertBanner.classList.remove('hidden');
      }
    } else if (hasBadRateInput || !Number.isFinite(rawRate) || rawRate < 0 || rawRate > 20) {
      hasMp2HardError = true;
      if (alertBanner && alertText) {
        alertText.textContent = t.mp2RateRangeWarning;
        alertBanner.classList.remove('hidden');
      }
    } else if (
      (rawContrib > 0 && rawContrib < MIN_MP2_CONTRIBUTION) ||
      (rawInit > 0 && rawInit < MIN_MP2_CONTRIBUTION && rawContrib === 0)
    ) {
      // Soft informational notice if positive contribution is under ₱500 Pag-IBIG minimum
      if (alertBanner && alertText) {
        alertText.textContent = t.mp2BelowMinNotice;
        alertBanner.classList.remove('hidden');
      }
    } else if (alertBanner) {
      alertBanner.classList.add('hidden');
    }

    var safeInit = hasMp2HardError ? 0 : rawInit;
    var safeContrib = hasMp2HardError ? 0 : rawContrib;
    var safeRate = hasMp2HardError ? 0 : rawRate;

    var proj = computeMp2Projection(
      safeInit,
      safeContrib,
      currentMp2Frequency,
      rawYears,
      safeRate
    );

    var isCompounded = currentMp2Treatment === 'compounded';
    var activeMode = isCompounded ? proj.compounded : proj.payout;

    // Update Hero & Summary Cards
    setText(
      'mp2HeroTotalValue',
      formatPHP(isCompounded ? proj.compounded.totalMaturityValue : proj.payout.totalValue)
    );
    setText(
      'mp2HeroTreatmentBadge',
      isCompounded ? t.treatmentCompoundedLabel : t.treatmentPayoutLabel
    );
    setText('mp2TotalPrincipalDisplay', formatPHP(proj.totalPrincipal));
    setText('mp2TotalDividendsDisplay', formatPHP(activeMode.totalDividends));
    setText('mp2AssumedRateDisplay', proj.ratePercent.toFixed(2) + '% p.a.');
    setText('mp2SelectedTermDisplay', proj.years + (proj.years === 1 ? (isTagalog ? ' Taon' : ' Year') : (isTagalog ? ' Taon' : ' Years')));

    // Side-by-Side Comparison Card (Compounded vs Annual Payout)
    setText('mp2CompareCompoundedTotal', formatPHP(proj.compounded.totalMaturityValue));
    setText('mp2CompareCompoundedDiv', formatPHP(proj.compounded.totalDividends));
    setText('mp2ComparePayoutTotal', formatPHP(proj.payout.totalValue));
    setText('mp2ComparePayoutDiv', formatPHP(proj.payout.totalDividends));
    setText('mp2CompareDiffAmount', '+' + formatPHP(proj.compoundingDifference));

    var diffNoteEl = document.getElementById('mp2CompareDiffNote');
    if (diffNoteEl) {
      if (proj.years === 1 || proj.compoundingDifference === 0) {
        diffNoteEl.textContent = t.sameYieldOneYearText;
      } else {
        diffNoteEl.textContent =
          t.compoundedAdvantageText +
          formatPHP(proj.compoundingDifference) +
          t.compoundedAdvantageSuffix;
      }
    }

    // Render Year-by-Year Projection Table
    var tbody = document.getElementById('mp2ScheduleBody');
    if (tbody) {
      while (tbody.firstChild) {
        tbody.removeChild(tbody.firstChild);
      }

      var rows = activeMode.rows;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100 hover:bg-slate-50/80 transition-colors';

        var tdYear = document.createElement('td');
        tdYear.className = 'py-3 px-3 sm:px-4 font-semibold text-slate-900 whitespace-nowrap';
        tdYear.textContent = t.yearPrefix + r.year;

        var tdOpen = document.createElement('td');
        tdOpen.className = 'py-3 px-3 sm:px-4 text-right font-mono text-slate-600 whitespace-nowrap';
        tdOpen.textContent = formatPHP(r.openingBalance);

        var tdContrib = document.createElement('td');
        tdContrib.className = 'py-3 px-3 sm:px-4 text-right font-mono text-slate-700 whitespace-nowrap';
        tdContrib.textContent = formatPHP(r.annualContribution);

        var tdDiv = document.createElement('td');
        tdDiv.className = 'py-3 px-3 sm:px-4 text-right font-mono font-semibold text-emerald-700 whitespace-nowrap';
        tdDiv.textContent = '+' + formatPHP(r.dividendEarned);

        var tdClose = document.createElement('td');
        tdClose.className = 'py-3 px-3 sm:px-4 text-right font-mono font-bold text-slate-900 whitespace-nowrap';
        tdClose.textContent = formatPHP(r.closingBalance);

        tr.appendChild(tdYear);
        tr.appendChild(tdOpen);
        tr.appendChild(tdContrib);
        tr.appendChild(tdDiv);
        tr.appendChild(tdClose);
        tbody.appendChild(tr);
      }
    }

    // Highlight active rate preset button
    var rateBtns = document.querySelectorAll('.mp2-rate-preset');
    for (var j = 0; j < rateBtns.length; j++) {
      var presetRate = Number(rateBtns[j].getAttribute('data-rate'));
      if (!hasMp2HardError && Math.abs(presetRate - proj.ratePercent) < 0.001) {
        rateBtns[j].classList.add('border-emerald-600', 'bg-emerald-50', 'text-emerald-800', 'font-bold');
        rateBtns[j].classList.remove('border-slate-200', 'bg-white', 'text-slate-700');
      } else {
        rateBtns[j].classList.remove('border-emerald-600', 'bg-emerald-50', 'text-emerald-800', 'font-bold');
        rateBtns[j].classList.add('border-slate-200', 'bg-white', 'text-slate-700');
      }
    }

    return !hasMp2HardError;
  }

  /**
   * Restore state from language switch handoff if present
   */
  function restoreHandoffState() {
    try {
      var raw = sessionStorage.getItem(HANDOFF_STORAGE_KEY);
      if (!raw) return;
      var payload = JSON.parse(raw);
      if (!payload || payload.calculatorType !== 'pagibig-mp2') return;
      if (typeof payload.timestamp === 'number' && Date.now() - payload.timestamp > 60000) {
        sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
        return;
      }
      sessionStorage.removeItem(HANDOFF_STORAGE_KEY);

      var data = payload.data || {};
      var salaryInput = document.getElementById('piBasicSalary');
      if (salaryInput && data.piBasicSalary !== undefined) {
        salaryInput.value = data.piBasicSalary;
      }
      var eeRateSelect = document.getElementById('piEmployeeRateMode');
      if (eeRateSelect && data.piEmployeeRateMode) {
        eeRateSelect.value = data.piEmployeeRateMode;
      }
      var erRateSelect = document.getElementById('piEmployerRateMode');
      if (erRateSelect && data.piEmployerRateMode) {
        erRateSelect.value = data.piEmployerRateMode;
      }
      if (data.regFreq === 'cutoff' || data.regFreq === 'monthly') {
        setRegularFrequencyMode(data.regFreq);
      }

      var initDepositInput = document.getElementById('mp2InitialDeposit');
      if (initDepositInput && data.mp2InitialDeposit !== undefined) {
        initDepositInput.value = data.mp2InitialDeposit;
      }
      var contribInput = document.getElementById('mp2ContributionAmount');
      if (contribInput && data.mp2ContributionAmount !== undefined) {
        contribInput.value = data.mp2ContributionAmount;
      }
      var yearsSelect = document.getElementById('mp2Years');
      if (yearsSelect && data.mp2Years !== undefined) {
        yearsSelect.value = data.mp2Years;
      }
      var rateInput = document.getElementById('mp2DividendRate');
      if (rateInput && data.mp2DividendRate !== undefined) {
        rateInput.value = data.mp2DividendRate;
      }
      if (data.mp2Frequency === 'annual' || data.mp2Frequency === 'monthly') {
        setMp2FrequencyMode(data.mp2Frequency);
      }
      if (data.mp2Treatment === 'payout' || data.mp2Treatment === 'compounded') {
        setMp2TreatmentMode(data.mp2Treatment);
      }
    } catch (err) {
      // Ignore storage errors in private browsing
    }
  }

  function setRegularFrequencyMode(freq) {
    currentRegFreq = freq === 'cutoff' ? 'cutoff' : 'monthly';
    var btnMonthly = document.getElementById('piFreqMonthlyBtn');
    var btnCutoff = document.getElementById('piFreqCutoffBtn');
    if (btnMonthly && btnCutoff) {
      if (currentRegFreq === 'monthly') {
        btnMonthly.setAttribute('aria-pressed', 'true');
        btnMonthly.className = 'flex-1 py-2 px-3 text-xs sm:text-sm font-semibold rounded-md bg-white text-emerald-700 shadow-xs border border-slate-200/80 transition-all';
        btnCutoff.setAttribute('aria-pressed', 'false');
        btnCutoff.className = 'flex-1 py-2 px-3 text-xs sm:text-sm font-medium rounded-md text-slate-600 hover:text-slate-900 transition-all';
      } else {
        btnCutoff.setAttribute('aria-pressed', 'true');
        btnCutoff.className = 'flex-1 py-2 px-3 text-xs sm:text-sm font-semibold rounded-md bg-white text-emerald-700 shadow-xs border border-slate-200/80 transition-all';
        btnMonthly.setAttribute('aria-pressed', 'false');
        btnMonthly.className = 'flex-1 py-2 px-3 text-xs sm:text-sm font-medium rounded-md text-slate-600 hover:text-slate-900 transition-all';
      }
    }
    updateRegularSavingsUI();
  }

  function setMp2FrequencyMode(freq) {
    currentMp2Frequency = freq === 'annual' ? 'annual' : 'monthly';
    var btnMonthly = document.getElementById('mp2FreqMonthlyBtn');
    var btnAnnual = document.getElementById('mp2FreqAnnualBtn');
    if (btnMonthly && btnAnnual) {
      if (currentMp2Frequency === 'monthly') {
        btnMonthly.setAttribute('aria-pressed', 'true');
        btnMonthly.className = 'flex-1 py-2 px-3 text-xs sm:text-sm font-semibold rounded-md bg-white text-emerald-700 shadow-xs border border-slate-200/80 transition-all';
        btnAnnual.setAttribute('aria-pressed', 'false');
        btnAnnual.className = 'flex-1 py-2 px-3 text-xs sm:text-sm font-medium rounded-md text-slate-600 hover:text-slate-900 transition-all';
      } else {
        btnAnnual.setAttribute('aria-pressed', 'true');
        btnAnnual.className = 'flex-1 py-2 px-3 text-xs sm:text-sm font-semibold rounded-md bg-white text-emerald-700 shadow-xs border border-slate-200/80 transition-all';
        btnMonthly.setAttribute('aria-pressed', 'false');
        btnMonthly.className = 'flex-1 py-2 px-3 text-xs sm:text-sm font-medium rounded-md text-slate-600 hover:text-slate-900 transition-all';
      }
    }
    updateMp2UI();
  }

  function setMp2TreatmentMode(mode) {
    currentMp2Treatment = mode === 'payout' ? 'payout' : 'compounded';
    var btnCompounded = document.getElementById('mp2TreatmentCompoundedBtn');
    var btnPayout = document.getElementById('mp2TreatmentPayoutBtn');
    if (btnCompounded && btnPayout) {
      if (currentMp2Treatment === 'compounded') {
        btnCompounded.setAttribute('aria-pressed', 'true');
        btnCompounded.className = 'flex-1 py-2.5 px-3 text-xs sm:text-sm font-semibold rounded-md bg-white text-emerald-700 shadow-xs border border-slate-200/80 transition-all';
        btnPayout.setAttribute('aria-pressed', 'false');
        btnPayout.className = 'flex-1 py-2.5 px-3 text-xs sm:text-sm font-medium rounded-md text-slate-600 hover:text-slate-900 transition-all';
      } else {
        btnPayout.setAttribute('aria-pressed', 'true');
        btnPayout.className = 'flex-1 py-2.5 px-3 text-xs sm:text-sm font-semibold rounded-md bg-white text-emerald-700 shadow-xs border border-slate-200/80 transition-all';
        btnCompounded.setAttribute('aria-pressed', 'false');
        btnCompounded.className = 'flex-1 py-2.5 px-3 text-xs sm:text-sm font-medium rounded-md text-slate-600 hover:text-slate-900 transition-all';
      }
    }
    updateMp2UI();
  }

  function resetRegularSavings() {
    var salaryInput = document.getElementById('piBasicSalary');
    var eeRateSelect = document.getElementById('piEmployeeRateMode');
    var erRateSelect = document.getElementById('piEmployerRateMode');
    var errorBanner = document.getElementById('piValidationAlert');
    var errorText = document.getElementById('piValidationText');

    if (salaryInput) salaryInput.value = '25000';
    if (eeRateSelect) eeRateSelect.value = 'auto';
    if (erRateSelect) erRateSelect.value = '2%';
    if (errorBanner) errorBanner.classList.add('hidden');
    if (errorText) errorText.textContent = '';

    setRegularFrequencyMode('monthly');
  }

  function resetMp2Savings() {
    var initDepositInput = document.getElementById('mp2InitialDeposit');
    var contribInput = document.getElementById('mp2ContributionAmount');
    var yearsSelect = document.getElementById('mp2Years');
    var rateInput = document.getElementById('mp2DividendRate');
    var alertBanner = document.getElementById('mp2ValidationAlert');
    var alertText = document.getElementById('mp2ValidationText');

    if (initDepositInput) initDepositInput.value = '0';
    if (contribInput) contribInput.value = '1000';
    if (yearsSelect) yearsSelect.value = '5';
    if (rateInput) rateInput.value = '7.0';
    if (alertBanner) alertBanner.classList.add('hidden');
    if (alertText) alertText.textContent = '';

    setMp2FrequencyMode('monthly');
    setMp2TreatmentMode('compounded');
  }

  var eventsBound = false;

  function scrollToResultsElement(resultsEl) {
    if (!resultsEl) return;
    var headerEl = document.querySelector('header');
    var headerOffset = headerEl ? headerEl.offsetHeight + 12 : 76;
    var rect = resultsEl.getBoundingClientRect();
    var targetTop = Math.max(0, (window.pageYOffset || document.documentElement.scrollTop || 0) + rect.top - headerOffset);
    var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    window.scrollTo({
      top: targetTop,
      behavior: prefersReducedMotion ? 'auto' : 'smooth'
    });
  }

  function ensureFocusedFieldUnobscured(targetEl, mobileBarEl) {
    if (!targetEl || window.innerWidth >= 1024) return;
    var fieldContainer = (typeof targetEl.closest === 'function' && targetEl.closest('[data-calc-field]')) || targetEl;
    var rect = fieldContainer.getBoundingClientRect();
    var headerEl = document.querySelector('header');
    var headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 64;

    var bottomLimit = window.innerHeight;
    if (mobileBarEl && window.getComputedStyle(mobileBarEl).display !== 'none') {
      var barRect = mobileBarEl.getBoundingClientRect();
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
    if (eventsBound) return;
    eventsBound = true;

    // Regular Savings Inputs
    var salaryInput = document.getElementById('piBasicSalary');
    if (salaryInput) {
      salaryInput.addEventListener('input', updateRegularSavingsUI);
      salaryInput.addEventListener('change', updateRegularSavingsUI);
    }

    var eeRateSelect = document.getElementById('piEmployeeRateMode');
    if (eeRateSelect) {
      eeRateSelect.addEventListener('change', updateRegularSavingsUI);
    }

    var erRateSelect = document.getElementById('piEmployerRateMode');
    if (erRateSelect) {
      erRateSelect.addEventListener('change', updateRegularSavingsUI);
    }

    var piFreqMonthlyBtn = document.getElementById('piFreqMonthlyBtn');
    var piFreqCutoffBtn = document.getElementById('piFreqCutoffBtn');
    if (piFreqMonthlyBtn) {
      piFreqMonthlyBtn.addEventListener('click', function () {
        setRegularFrequencyMode('monthly');
      });
    }
    if (piFreqCutoffBtn) {
      piFreqCutoffBtn.addEventListener('click', function () {
        setRegularFrequencyMode('cutoff');
      });
    }

    var piResetBtn = document.getElementById('piResetBtn');
    if (piResetBtn) {
      piResetBtn.addEventListener('click', function () {
        resetRegularSavings();
      });
    }

    var salaryPresetBtns = document.querySelectorAll('.pi-salary-preset');
    for (var i = 0; i < salaryPresetBtns.length; i++) {
      salaryPresetBtns[i].addEventListener('click', function (e) {
        var targetSalary = e.currentTarget.getAttribute('data-salary');
        if (salaryInput && targetSalary !== null) {
          salaryInput.value = targetSalary;
          updateRegularSavingsUI();
        }
      });
    }

    // MP2 Inputs
    var mp2Ids = ['mp2InitialDeposit', 'mp2ContributionAmount', 'mp2Years', 'mp2DividendRate'];
    for (var j = 0; j < mp2Ids.length; j++) {
      var el = document.getElementById(mp2Ids[j]);
      if (el) {
        el.addEventListener('input', updateMp2UI);
        el.addEventListener('change', updateMp2UI);
      }
    }

    var mp2FreqMonthlyBtn = document.getElementById('mp2FreqMonthlyBtn');
    var mp2FreqAnnualBtn = document.getElementById('mp2FreqAnnualBtn');
    if (mp2FreqMonthlyBtn) {
      mp2FreqMonthlyBtn.addEventListener('click', function () {
        setMp2FrequencyMode('monthly');
      });
    }
    if (mp2FreqAnnualBtn) {
      mp2FreqAnnualBtn.addEventListener('click', function () {
        setMp2FrequencyMode('annual');
      });
    }

    var mp2TreatmentCompoundedBtn = document.getElementById('mp2TreatmentCompoundedBtn');
    var mp2TreatmentPayoutBtn = document.getElementById('mp2TreatmentPayoutBtn');
    if (mp2TreatmentCompoundedBtn) {
      mp2TreatmentCompoundedBtn.addEventListener('click', function () {
        setMp2TreatmentMode('compounded');
      });
    }
    if (mp2TreatmentPayoutBtn) {
      mp2TreatmentPayoutBtn.addEventListener('click', function () {
        setMp2TreatmentMode('payout');
      });
    }

    var mp2ResetBtn = document.getElementById('mp2ResetBtn');
    if (mp2ResetBtn) {
      mp2ResetBtn.addEventListener('click', function () {
        resetMp2Savings();
      });
    }

    var ratePresetBtns = document.querySelectorAll('.mp2-rate-preset');
    var rateInput = document.getElementById('mp2DividendRate');
    for (var k = 0; k < ratePresetBtns.length; k++) {
      ratePresetBtns[k].addEventListener('click', function (e) {
        var targetRate = e.currentTarget.getAttribute('data-rate');
        if (rateInput && targetRate !== null) {
          rateInput.value = targetRate;
          updateMp2UI();
        }
      });
    }

    // Mobile Calculate Buttons & Smooth Scroll to Results
    var regularInputSection = document.getElementById('regularSavingsInputSection');
    var regularResultsSection = document.getElementById('regularSavingsResultsSection');
    var piMobileCalculateBar = document.getElementById('piMobileCalculateBar');
    var calculateRegularSavingsBtn = document.getElementById('calculateRegularSavingsBtn');

    var mp2InputSection = document.getElementById('mp2SavingsInputSection');
    var mp2ResultsSection = document.getElementById('mp2SavingsResultsSection');
    var mp2MobileCalculateBar = document.getElementById('mp2MobileCalculateBar');
    var calculateMp2SavingsBtn = document.getElementById('calculateMp2SavingsBtn');

    var mp2InitialDepositInput = document.getElementById('mp2InitialDeposit');
    var mp2ContributionAmountInput = document.getElementById('mp2ContributionAmount');

    function handleRegularMobileCalculateTrigger() {
      var isValid = updateRegularSavingsUI();
      if (isValid === false) return;
      if (
        document.activeElement &&
        (document.activeElement === salaryInput || (regularInputSection && regularInputSection.contains(document.activeElement))) &&
        typeof document.activeElement.blur === 'function'
      ) {
        document.activeElement.blur();
      }
      scrollToResultsElement(regularResultsSection);
    }

    function handleMp2MobileCalculateTrigger() {
      var isValid = updateMp2UI();
      if (isValid === false) return;
      if (
        document.activeElement &&
        (document.activeElement === mp2InitialDepositInput ||
          document.activeElement === mp2ContributionAmountInput ||
          document.activeElement === rateInput ||
          (mp2InputSection && mp2InputSection.contains(document.activeElement))) &&
        typeof document.activeElement.blur === 'function'
      ) {
        document.activeElement.blur();
      }
      scrollToResultsElement(mp2ResultsSection);
    }

    if (calculateRegularSavingsBtn) {
      calculateRegularSavingsBtn.addEventListener('click', function () {
        handleRegularMobileCalculateTrigger();
      });
    }

    if (calculateMp2SavingsBtn) {
      calculateMp2SavingsBtn.addEventListener('click', function () {
        handleMp2MobileCalculateTrigger();
      });
    }

    // Allow pressing Enter in Regular Savings salary input to calculate and scroll on mobile (< 1024px)
    if (salaryInput) {
      salaryInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (window.innerWidth < 1024) {
            handleRegularMobileCalculateTrigger();
          } else {
            updateRegularSavingsUI();
          }
        }
      });
    }

    // Allow pressing Enter in MP2 numeric inputs to calculate and scroll on mobile (< 1024px)
    var mp2NumericInputs = [mp2InitialDepositInput, mp2ContributionAmountInput, rateInput];
    for (var m = 0; m < mp2NumericInputs.length; m++) {
      (function (inputEl) {
        if (!inputEl) return;
        inputEl.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (window.innerWidth < 1024) {
              handleMp2MobileCalculateTrigger();
            } else {
              updateMp2UI();
            }
          }
        });
      })(mp2NumericInputs[m]);
    }

    // Ensure focused inputs/controls on mobile are never obscured by sticky header or sticky calculate bar
    if (regularInputSection) {
      regularInputSection.addEventListener('focusin', function (e) {
        var target = e.target;
        if (!target || target === calculateRegularSavingsBtn) return;
        ensureFocusedFieldUnobscured(target, piMobileCalculateBar);
        setTimeout(function () {
          if (document.activeElement === target) {
            ensureFocusedFieldUnobscured(target, piMobileCalculateBar);
          }
        }, 120);
      });
    }

    if (mp2InputSection) {
      mp2InputSection.addEventListener('focusin', function (e) {
        var target = e.target;
        if (!target || target === calculateMp2SavingsBtn) return;
        ensureFocusedFieldUnobscured(target, mp2MobileCalculateBar);
        setTimeout(function () {
          if (document.activeElement === target) {
            ensureFocusedFieldUnobscured(target, mp2MobileCalculateBar);
          }
        }, 120);
      });
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () {
        var active = document.activeElement;
        if (!active) return;
        if (regularInputSection && regularInputSection.contains(active) && active !== calculateRegularSavingsBtn) {
          ensureFocusedFieldUnobscured(active, piMobileCalculateBar);
        } else if (mp2InputSection && mp2InputSection.contains(active) && active !== calculateMp2SavingsBtn) {
          ensureFocusedFieldUnobscured(active, mp2MobileCalculateBar);
        }
      });
    }
  }

  function loadVerifiedRatesAndInit() {
    restoreHandoffState();
    bindEvents();
    updateRegularSavingsUI();
    updateMp2UI();

    // Sync with authoritative /data/rates-2026.json if available
    if (typeof fetch === 'function') {
      fetch('/data/rates-2026.json')
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to load rates');
          return res.json();
        })
        .then(function (data) {
          if (data && data.pagibig) {
            PAGIBIG_RATES.lowSalaryThreshold = Number(data.pagibig.lowSalaryThreshold) || 1500;
            PAGIBIG_RATES.employeeRateLow = Number(data.pagibig.employeeRateLow) || 0.01;
            PAGIBIG_RATES.employeeRate = Number(data.pagibig.employeeRate) || 0.02;
            PAGIBIG_RATES.employerRate = Number(data.pagibig.employerRate) || 0.02;
            PAGIBIG_RATES.maxFundSalary = Number(data.pagibig.maxFundSalary) || 10000;
            PAGIBIG_RATES.maxEmployeeContribution = Number(data.pagibig.maxEmployeeContribution) || 200;
            updateRegularSavingsUI();
          }
        })
        .catch(function () {
          // Embedded verified PAGIBIG_RATES already active
        });
    }
  }

  if (typeof window !== 'undefined') {
    window.PagIbigMp2Calculator = {
      computeRegularSavings: computeRegularSavings,
      computeMp2Projection: computeMp2Projection,
      updateRegularSavingsUI: updateRegularSavingsUI,
      updateMp2UI: updateMp2UI,
      resetRegularSavings: resetRegularSavings,
      resetMp2Savings: resetMp2Savings
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadVerifiedRatesAndInit);
  } else {
    loadVerifiedRatesAndInit();
  }
})();
