/**
 * SuweldoTools — Verified Overtime & Holiday Pay Calculator Engine (2026)
 * Vanilla JavaScript implementation. Zero external dependencies.
 * Supports English (en-PH) and Filipino (tl-PH).
 *
 * Official Grounding & Verified Legal Sources:
 * 1. Labor Code of the Philippines (Presidential Decree No. 442, as amended and
 *    renumbered by DOLE Department Advisory No. 01, Series of 2015), Book III, Title I:
 *    - Article 82: Coverage and Exemptions (Managerial employees, field personnel, etc.)
 *    - Article 83: Normal Hours of Work (Not exceeding 8 hours a day)
 *    - Article 86: Night Shift Differential (Not less than 10% additional compensation
 *      for work performed between 10:00 PM and 6:00 AM)
 *    - Article 87: Overtime Work (+25% on ordinary working days; +30% on scheduled
 *      rest days, special non-working days, and regular holidays)
 *    - Article 93: Compensation for Rest Day, Sunday or Holiday Work (130% for scheduled
 *      rest day or special non-working day; 150% for special non-working day falling on rest day)
 *    - Article 94: Right to Regular Holiday Pay (100% if unworked subject to eligibility;
 *      200% for first 8 hours if worked; 260% if worked on scheduled rest day)
 * 2. DOLE Bureau of Working Conditions (BWC) — Handbook on Workers' Statutory Monetary Benefits:
 *    - Official compound multiplier matrix for Ordinary Day, Rest Day, Special Non-Working Day,
 *      and Regular Holiday combined with Overtime and Night Shift Differential.
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

  /**
   * Verified DOLE Workday Multipliers
   * - dayMultiplier: Total multiplier for the first 8 normal hours worked (e.g., 1.00, 1.30, 1.50, 2.00, 2.60)
   * - basePortion: The 1.00 (100%) regular wage baseline within dayMultiplier
   * - holidayRestPremiumMultiplier: Additional statutory premium above 100% (dayMultiplier - 1.00)
   * - otAddonRate: Statutory overtime increment on the day's hourly rate (0.25 on ordinary day; 0.30 on rest day/holiday)
   * - otTotalMultiplier: Compound overtime multiplier = dayMultiplier * (1 + otAddonRate)
   * - nsdRate: Statutory night shift differential rate (0.10 = 10% of the applicable hourly rate)
   */
  var WORKDAY_RULES = {
    ordinary: {
      id: 'ordinary',
      labelEn: 'Regular Workday (Ordinary Working Day)',
      labelTl: 'Regular na Araw ng Trabaho (Ordinary Working Day)',
      shortEn: 'Ordinary Workday',
      shortTl: 'Regular na Araw',
      legalBasisEn: 'Labor Code Art. 83, 86 & 87',
      legalBasisTl: 'Labor Code Art. 83, 86 at 87',
      dayMultiplier: 1.00,
      holidayRestPremiumMultiplier: 0.00,
      otAddonRate: 0.25,
      otTotalMultiplier: 1.25,
      nsdRate: 0.10,
      unworkedRuleEn: 'Paid as part of regular work schedule when worked.',
      unworkedRuleTl: 'Binabayaran bilang bahagi ng regular na araw ng pasok kapag nagtrabaho.'
    },
    rest_day: {
      id: 'rest_day',
      labelEn: 'Scheduled Rest Day',
      labelTl: 'Nakatakdang Araw ng Pahinga (Rest Day)',
      shortEn: 'Scheduled Rest Day',
      shortTl: 'Rest Day',
      legalBasisEn: 'Labor Code Art. 93(a) & Art. 87',
      legalBasisTl: 'Labor Code Art. 93(a) at Art. 87',
      dayMultiplier: 1.30,
      holidayRestPremiumMultiplier: 0.30,
      otAddonRate: 0.30,
      otTotalMultiplier: 1.69,
      nsdRate: 0.10,
      unworkedRuleEn: 'No extra premium if unworked; 130% of basic rate for the first 8 hours if worked.',
      unworkedRuleTl: 'Walang dagdag na premium kung hindi pumasok; 130% ng basic rate sa unang 8 oras kapag nagtrabaho.'
    },
    special_holiday: {
      id: 'special_holiday',
      labelEn: 'Special (Non-Working) Holiday',
      labelTl: 'Special (Non-Working) Holiday',
      shortEn: 'Special Non-Working Holiday',
      shortTl: 'Special Non-Working Holiday',
      legalBasisEn: 'Labor Code Art. 93(c) & DOLE Handbook',
      legalBasisTl: 'Labor Code Art. 93(c) at DOLE Handbook',
      dayMultiplier: 1.30,
      holidayRestPremiumMultiplier: 0.30,
      otAddonRate: 0.30,
      otTotalMultiplier: 1.69,
      nsdRate: 0.10,
      unworkedRuleEn: '"No work, no pay" applies for daily-paid workers unless covered by a favorable company policy or CBA. If worked, 130% for the first 8 hours.',
      unworkedRuleTl: 'Umiiral ang "No work, no pay" maliban kung may mas paborableng polisiya ang kompanya o CBA. Kapag pumasok, 130% sa unang 8 oras.'
    },
    special_holiday_rest: {
      id: 'special_holiday_rest',
      labelEn: 'Special (Non-Working) Holiday on Rest Day',
      labelTl: 'Special (Non-Working) Holiday na Natapat sa Rest Day',
      shortEn: 'Special Holiday + Rest Day',
      shortTl: 'Special Holiday + Rest Day',
      legalBasisEn: 'Labor Code Art. 93(c) & DOLE Handbook',
      legalBasisTl: 'Labor Code Art. 93(c) at DOLE Handbook',
      dayMultiplier: 1.50,
      holidayRestPremiumMultiplier: 0.50,
      otAddonRate: 0.30,
      otTotalMultiplier: 1.95,
      nsdRate: 0.10,
      unworkedRuleEn: '"No work, no pay" if unworked. If worked on a scheduled rest day, 150% of basic rate for the first 8 hours.',
      unworkedRuleTl: '"No work, no pay" kung hindi pumasok. Kapag nagtrabaho sa rest day na natapat sa special holiday, 150% sa unang 8 oras.'
    },
    regular_holiday: {
      id: 'regular_holiday',
      labelEn: 'Regular Holiday',
      labelTl: 'Regular Holiday',
      shortEn: 'Regular Holiday',
      shortTl: 'Regular Holiday',
      legalBasisEn: 'Labor Code Art. 94 & DOLE Handbook',
      legalBasisTl: 'Labor Code Art. 94 at DOLE Handbook',
      dayMultiplier: 2.00,
      holidayRestPremiumMultiplier: 1.00,
      otAddonRate: 0.30,
      otTotalMultiplier: 2.60,
      nsdRate: 0.10,
      unworkedRuleEn: '100% of daily basic wage even if unworked (if present or on paid leave on the preceding workday). If worked, 200% for the first 8 hours.',
      unworkedRuleTl: '100% ng arawang sahod kahit hindi pumasok (kung pumasok o naka-paid leave sa sinundang workday). Kapag nagtrabaho, 200% sa unang 8 oras.'
    },
    regular_holiday_rest: {
      id: 'regular_holiday_rest',
      labelEn: 'Regular Holiday on Scheduled Rest Day',
      labelTl: 'Regular Holiday na Natapat sa Rest Day',
      shortEn: 'Regular Holiday + Rest Day',
      shortTl: 'Regular Holiday + Rest Day',
      legalBasisEn: 'Labor Code Art. 94 & DOLE Handbook',
      legalBasisTl: 'Labor Code Art. 94 at DOLE Handbook',
      dayMultiplier: 2.60,
      holidayRestPremiumMultiplier: 1.60,
      otAddonRate: 0.30,
      otTotalMultiplier: 3.38,
      nsdRate: 0.10,
      unworkedRuleEn: '100% of daily basic wage if unworked (subject to eligibility). If worked on a scheduled rest day, 260% (200% × 1.30) for the first 8 hours.',
      unworkedRuleTl: '100% ng arawang sahod kung hindi pumasok. Kapag nagtrabaho sa rest day na natapat sa regular holiday, 260% (200% × 1.30) sa unang 8 oras.'
    }
  };

  /**
   * Monthly-to-Daily Conversion Methods
   * Allows transparent calculation of Daily Rate from Monthly Basic Salary
   */
  var CONVERSION_METHODS = {
    '261_year': {
      id: '261_year',
      labelEn: '261 Days/Year (Standard 5-Day Workweek · Monthly × 12 ÷ 261)',
      labelTl: '261 Araw/Taon (Karaniwang 5-Araw na Pasok · Buwanan × 12 ÷ 261)',
      formulaTextEn: '(Monthly Salary × 12) ÷ 261 days',
      formulaTextTl: '(Buwanang Sahod × 12) ÷ 261 araw',
      computeDaily: function (monthly) {
        return (monthly * 12) / 261;
      }
    },
    '22_month': {
      id: '22_month',
      labelEn: '22 Days/Month (Fixed Monthly Divisor · Monthly ÷ 22)',
      labelTl: '22 Araw/Buwan (Fixed Monthly Divisor · Buwanan ÷ 22)',
      formulaTextEn: 'Monthly Salary ÷ 22 days',
      formulaTextTl: 'Buwanang Sahod ÷ 22 araw',
      computeDaily: function (monthly) {
        return monthly / 22;
      }
    },
    '313_year': {
      id: '313_year',
      labelEn: '313 Days/Year (Standard 6-Day Workweek · Monthly × 12 ÷ 313)',
      labelTl: '313 Araw/Taon (Karaniwang 6-Araw na Pasok · Buwanan × 12 ÷ 313)',
      formulaTextEn: '(Monthly Salary × 12) ÷ 313 days',
      formulaTextTl: '(Buwanang Sahod × 12) ÷ 313 araw',
      computeDaily: function (monthly) {
        return (monthly * 12) / 313;
      }
    },
    '26_month': {
      id: '26_month',
      labelEn: '26 Days/Month (6-Day Monthly Divisor · Monthly ÷ 26)',
      labelTl: '26 Araw/Buwan (6-Araw Monthly Divisor · Buwanan ÷ 26)',
      formulaTextEn: 'Monthly Salary ÷ 26 days',
      formulaTextTl: 'Buwanang Sahod ÷ 26 araw',
      computeDaily: function (monthly) {
        return monthly / 26;
      }
    },
    '365_year': {
      id: '365_year',
      labelEn: '365 Days/Year (DOLE EEMR All-Days-Paid · Monthly × 12 ÷ 365)',
      labelTl: '365 Araw/Taon (DOLE EEMR Bayad Lahat ng Araw · Buwanan × 12 ÷ 365)',
      formulaTextEn: '(Monthly Salary × 12) ÷ 365 days',
      formulaTextTl: '(Buwanang Sahod × 12) ÷ 365 araw',
      computeDaily: function (monthly) {
        return (monthly * 12) / 365;
      }
    }
  };

  var DEFAULTS = {
    monthlySalary: 25000,
    conversionMethod: '261_year',
    normalHoursPerDay: 8,
    workdayType: 'ordinary',
    holidayEligible: true,
    regularHoursWorked: 8,
    overtimeHoursWorked: 2,
    nightShiftHours: 0,
    nightOvertimeHours: 0
  };

  function roundCentavos(val) {
    var num = Number(val);
    if (isNaN(num)) return 0;
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  function formatPHP(amount) {
    var num = Number(amount);
    if (isNaN(num)) num = 0;
    return '₱' + num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatMultiplierPct(mult) {
    var pct = Math.round(mult * 1000) / 10;
    return pct + '% (' + mult.toFixed(2) + '×)';
  }

  // DOM References
  var salaryInput = document.getElementById('otMonthlySalary');
  var conversionSelect = document.getElementById('otConversionMethod');
  var normalHoursInput = document.getElementById('otNormalHours');
  var workdayTypeSelect = document.getElementById('otWorkdayType');
  var holidayEligibleInput = document.getElementById('otHolidayEligible');
  var holidayEligibilityWrap = document.getElementById('otHolidayEligibilityWrap');
  var regularHoursInput = document.getElementById('otHoursWorked');
  var overtimeHoursInput = document.getElementById('otOvertimeHours');
  var nightShiftHoursInput = document.getElementById('otNightShiftHours');
  var nightOvertimeHoursInput = document.getElementById('otNightOvertimeHours');
  var resetBtn = document.getElementById('otResetBtn');
  var validationAlert = document.getElementById('otValidationAlert');

  // Derived rate preview inside Input Panel
  var previewDailyRate = document.getElementById('otPreviewDailyRate');
  var previewHourlyRate = document.getElementById('otPreviewHourlyRate');
  var previewConversionFormula = document.getElementById('otPreviewConversionFormula');

  // Mobile sticky calculate button & sections
  var calculateBtn = document.getElementById('calculateOtBtn');
  var mobileCalculateBar = document.getElementById('mobileCalculateBar');
  var calculatorInputSection = document.getElementById('calculatorInputSection');
  var resultsSection = document.getElementById('calculatorResultsSection');

  // Results DOM References
  var resScenarioBadge = document.getElementById('resScenarioBadge');
  var resLegalBasisBadge = document.getElementById('resLegalBasisBadge');
  var resTotalEstimatedPay = document.getElementById('resTotalEstimatedPay');
  var resAdditionalPremiumTotal = document.getElementById('resAdditionalPremiumTotal');
  var resHourlyRateDisplay = document.getElementById('resHourlyRateDisplay');
  var resDailyRateDisplay = document.getElementById('resDailyRateDisplay');

  // 4 Core Breakdown Cards
  var resRegularPay = document.getElementById('resRegularPay');
  var resRegularPaySub = document.getElementById('resRegularPaySub');
  var resHolidayRestPay = document.getElementById('resHolidayRestPay');
  var resHolidayRestPaySub = document.getElementById('resHolidayRestPaySub');
  var resOvertimePay = document.getElementById('resOvertimePay');
  var resOvertimePaySub = document.getElementById('resOvertimePaySub');
  var resNightShiftPay = document.getElementById('resNightShiftPay');
  var resNightShiftPaySub = document.getElementById('resNightShiftPaySub');

  // Detailed Formula Table rows
  var tblHourlyFormula = document.getElementById('tblHourlyFormula');
  var tblHourlyRateVal = document.getElementById('tblHourlyRateVal');
  var tblBaseHoursLabel = document.getElementById('tblBaseHoursLabel');
  var tblBaseHoursFormula = document.getElementById('tblBaseHoursFormula');
  var tblBaseHoursAmount = document.getElementById('tblBaseHoursAmount');
  var tblPremiumRow = document.getElementById('tblPremiumRow');
  var tblPremiumLabel = document.getElementById('tblPremiumLabel');
  var tblPremiumFormula = document.getElementById('tblPremiumFormula');
  var tblPremiumAmount = document.getElementById('tblPremiumAmount');
  var tblOvertimeLabel = document.getElementById('tblOvertimeLabel');
  var tblOvertimeFormula = document.getElementById('tblOvertimeFormula');
  var tblOvertimeAmount = document.getElementById('tblOvertimeAmount');
  var tblNightShiftLabel = document.getElementById('tblNightShiftLabel');
  var tblNightShiftFormula = document.getElementById('tblNightShiftFormula');
  var tblNightShiftAmount = document.getElementById('tblNightShiftAmount');
  var tblTotalAmount = document.getElementById('tblTotalAmount');
  var resDayRuleNotice = document.getElementById('resDayRuleNotice');

  function parseCleanFloat(el, fallback) {
    if (!el) return fallback;
    var raw = String(el.value || '').trim();
    if (raw === '') return 0;
    var parsed = parseFloat(raw.replace(/,/g, ''));
    return isNaN(parsed) ? fallback : parsed;
  }

  /**
   * Pure computation helper so unit tests or UI can compute deterministically
   */
  function computeOvertimeAndHolidayPay(params) {
    var monthlySalary = Math.max(0, Number(params.monthlySalary) || 0);
    var conversionKey = CONVERSION_METHODS[params.conversionMethod] ? params.conversionMethod : '261_year';
    var conversionObj = CONVERSION_METHODS[conversionKey];

    // Enforce valid Philippine normal working hours range (1 to 8 hours under Labor Code Art. 83, default 8)
    var rawNormalHours = Number(params.normalHoursPerDay);
    var normalHoursValid = !isNaN(rawNormalHours) && rawNormalHours >= 1 && rawNormalHours <= 8;
    var normalHours = normalHoursValid ? rawNormalHours : 8;

    var workdayKey = WORKDAY_RULES[params.workdayType] ? params.workdayType : 'ordinary';
    var rule = WORKDAY_RULES[workdayKey];
    var isRegularHoliday = workdayKey === 'regular_holiday' || workdayKey === 'regular_holiday_rest';
    var holidayEligible = params.holidayEligible !== false;

    var regularHoursRaw = Math.max(0, Number(params.regularHoursWorked) || 0);
    var overtimeHours = Math.max(0, Number(params.overtimeHoursWorked) || 0);

    // Separate Regular Night Shift Hours and Overtime Night Shift Hours
    var rawNightRegular =
      params.nightRegularHours !== undefined
        ? Math.max(0, Number(params.nightRegularHours) || 0)
        : Math.max(0, Number(params.nightShiftHours) || 0);
    var rawNightOvertime = Math.max(0, Number(params.nightOvertimeHours) || 0);

    // Cap regular hours at normalHoursPerDay for base-vs-OT separation
    var regularHours = Math.min(regularHoursRaw, normalHours);

    var dailyRateExact = conversionObj.computeDaily(monthlySalary);
    var hourlyRateExact = dailyRateExact / normalHours;

    var dailyRate = roundCentavos(dailyRateExact);
    var hourlyRate = roundCentavos(hourlyRateExact);

    // 1. Separate Worked Base Pay vs Guaranteed Unworked Regular Holiday Entitlement (Art. 94)
    // Eligible employees on a Regular Holiday receive 100% of their daily basic wage for the normal workday,
    // so working fewer than normalHours (e.g., 4 hours) does not forfeit the unworked portion of the guaranteed holiday entitlement.
    var workedBasePay =
      regularHours === normalHours
        ? dailyRate
        : roundCentavos(hourlyRateExact * 1.00 * regularHours);

    var unworkedHolidayHours =
      isRegularHoliday && holidayEligible ? Math.max(0, normalHours - regularHours) : 0;

    var unworkedHolidayPay = 0;
    if (isRegularHoliday && holidayEligible && unworkedHolidayHours > 0) {
      if (regularHours === 0) {
        unworkedHolidayPay = dailyRate;
      } else {
        // Reconcile against dailyRate so workedBasePay + unworkedHolidayPay equals the full 100% daily holiday entitlement without 1-centavo rounding loss
        unworkedHolidayPay = roundCentavos( Math.max(0, dailyRate - workedBasePay) );
      }
    }

    var isUnworkedRegularHoliday =
      isRegularHoliday &&
      holidayEligible &&
      regularHours === 0 &&
      overtimeHours === 0 &&
      rawNightRegular === 0 &&
      rawNightOvertime === 0;

    var isPartialRegularHoliday =
      isRegularHoliday &&
      holidayEligible &&
      regularHours > 0 &&
      regularHours < normalHours;

    var estimatedRegularPay = roundCentavos(workedBasePay + unworkedHolidayPay);

    // 2. Additional Holiday or Rest-Day Premium (only on regular hours actually worked)
    var additionalHolidayRestPay = roundCentavos(
      hourlyRateExact * rule.holidayRestPremiumMultiplier * regularHours
    );

    var totalFirstEightHoursPay = roundCentavos(estimatedRegularPay + additionalHolidayRestPay);

    // 3. Overtime Pay (Hourly Rate * Day Multiplier * (1 + OT Addon Rate) * OT Hours)
    var otHourlyRateExact = hourlyRateExact * rule.otTotalMultiplier;
    var overtimePay = roundCentavos(otHourlyRateExact * overtimeHours);

    // 4. Night Shift Differential (10% of applicable regular rate or overtime rate, added once per component)
    var nightRegularHours = Math.min(rawNightRegular, regularHours);
    var nightOvertimeHours = Math.min(rawNightOvertime, overtimeHours);
    var effectiveNightHours = nightRegularHours + nightOvertimeHours;

    var nsdRegularHourlyExact = hourlyRateExact * rule.dayMultiplier * rule.nsdRate;
    var nsdOvertimeHourlyExact = hourlyRateExact * rule.otTotalMultiplier * rule.nsdRate;

    var nsdRegularPay = roundCentavos(nsdRegularHourlyExact * nightRegularHours);
    var nsdOvertimePay = roundCentavos(nsdOvertimeHourlyExact * nightOvertimeHours);
    var nightShiftPay = roundCentavos(nsdRegularPay + nsdOvertimePay);

    // 5. Total Estimated Pay (exact sum of rounded components)
    var totalEstimatedPay = roundCentavos(
      estimatedRegularPay + additionalHolidayRestPay + overtimePay + nightShiftPay
    );

    var totalAdditionalPremium = roundCentavos(
      additionalHolidayRestPay + overtimePay + nightShiftPay
    );

    return {
      monthlySalary: monthlySalary,
      conversionMethod: conversionKey,
      conversionObj: conversionObj,
      normalHoursPerDay: normalHours,
      normalHoursValid: normalHoursValid,
      workdayType: workdayKey,
      rule: rule,
      isRegularHoliday: isRegularHoliday,
      holidayEligible: holidayEligible,
      regularHoursRaw: regularHoursRaw,
      regularHours: regularHours,
      unworkedHolidayHours: unworkedHolidayHours,
      overtimeHours: overtimeHours,
      nightShiftHours: rawNightRegular + rawNightOvertime,
      effectiveNightHours: effectiveNightHours,
      nightRegularHours: nightRegularHours,
      nightOvertimeHours: nightOvertimeHours,
      dailyRate: dailyRate,
      hourlyRate: hourlyRate,
      hourlyRateExact: hourlyRateExact,
      isUnworkedRegularHoliday: isUnworkedRegularHoliday,
      isPartialRegularHoliday: isPartialRegularHoliday,
      workedBasePay: workedBasePay,
      unworkedHolidayPay: unworkedHolidayPay,
      estimatedRegularPay: estimatedRegularPay,
      additionalHolidayRestPay: additionalHolidayRestPay,
      totalFirstEightHoursPay: totalFirstEightHoursPay,
      overtimePay: overtimePay,
      nsdRegularPay: nsdRegularPay,
      nsdOvertimePay: nsdOvertimePay,
      nightShiftPay: nightShiftPay,
      totalAdditionalPremium: totalAdditionalPremium,
      totalEstimatedPay: totalEstimatedPay
    };
  }

  function validateInputs() {
    if (!validationAlert) return;

    var rawSalary = salaryInput ? parseFloat(String(salaryInput.value || '0').replace(/,/g, '')) : 0;
    var rawNormalStr = normalHoursInput ? String(normalHoursInput.value || '').trim() : '8';
    var rawNormalHrs = rawNormalStr === '' ? NaN : parseFloat(rawNormalStr);
    var rawRegHrs = regularHoursInput ? parseFloat(String(regularHoursInput.value || '0')) : 0;
    var rawOtHrs = overtimeHoursInput ? parseFloat(String(overtimeHoursInput.value || '0')) : 0;
    var rawNsdRegHrs = nightShiftHoursInput ? parseFloat(String(nightShiftHoursInput.value || '0')) : 0;
    var rawNsdOtHrs = nightOvertimeHoursInput ? parseFloat(String(nightOvertimeHoursInput.value || '0')) : 0;

    var messages = [];

    if (rawSalary < 0) {
      messages.push(
        isTl
          ? 'Maling Halaga: Ang buwanang batayang sahod ay hindi maaaring negatibo.'
          : 'Invalid Input: Monthly basic salary cannot be negative.'
      );
    }

    if (isNaN(rawNormalHrs) || rawNormalHrs < 1 || rawNormalHrs > 8) {
      messages.push(
        isTl
          ? 'Paalala: Ang normal na oras ng trabaho bawat araw ay dapat nasa pagitan ng 1 at 8 oras (Labor Code Art. 83). Ginamit ang karaniwang 8-oras na workday sa kalkulasyon.'
          : 'Note: Normal working hours per day must be between 1 and 8 hours under Labor Code Art. 83. Calculation enforces the standard 8-hour workday.'
      );
    }

    if (rawRegHrs < 0 || rawOtHrs < 0 || rawNsdRegHrs < 0 || rawNsdOtHrs < 0) {
      messages.push(
        isTl
          ? 'Maling Halaga: Ang bilang ng oras na ipinasok ay hindi maaaring negatibo.'
          : 'Invalid Input: Hours worked cannot be negative.'
      );
    }

    var effectiveNormal = !isNaN(rawNormalHrs) && rawNormalHrs >= 1 && rawNormalHrs <= 8 ? rawNormalHrs : 8;
    var effectiveRegHrs = Math.min(Math.max(0, isNaN(rawRegHrs) ? 0 : rawRegHrs), effectiveNormal);
    var effectiveOtHrs = Math.max(0, isNaN(rawOtHrs) ? 0 : rawOtHrs);

    if (rawRegHrs > effectiveNormal) {
      messages.push(
        isTl
          ? 'Paalala: Ang regular na oras sa araw ay nililimitahan sa ' + effectiveNormal + ' oras. Ilagay ang lampas na oras sa "Overtime Hours Worked".'
          : 'Note: Regular hours worked are capped at your normal shift (' + effectiveNormal + ' hrs). Enter hours beyond ' + effectiveNormal + ' hrs in the "Overtime Hours Worked" field.'
      );
    }

    if (rawNsdRegHrs > effectiveRegHrs) {
      messages.push(
        isTl
          ? 'Paalala: Ang Regular Night Shift Hours (' + rawNsdRegHrs + ' oras) ay hindi maaaring lumampas sa Regular Hours Worked (' + effectiveRegHrs + ' oras). Nilimitahan ito sa ' + effectiveRegHrs + ' oras.'
          : 'Note: Regular night shift hours (' + rawNsdRegHrs + ' hrs) cannot exceed regular hours worked (' + effectiveRegHrs + ' hrs). Calculation caps regular night hours at ' + effectiveRegHrs + ' hrs.'
      );
    }

    if (rawNsdOtHrs > effectiveOtHrs) {
      messages.push(
        isTl
          ? 'Paalala: Ang Overtime Night Shift Hours (' + rawNsdOtHrs + ' oras) ay hindi maaaring lumampas sa Overtime Hours Worked (' + effectiveOtHrs + ' oras). Nilimitahan ito sa ' + effectiveOtHrs + ' oras.'
          : 'Note: Overtime night shift hours (' + rawNsdOtHrs + ' hrs) cannot exceed overtime hours worked (' + effectiveOtHrs + ' hrs). Calculation caps overtime night hours at ' + effectiveOtHrs + ' hrs.'
      );
    }

    var totalCappedNsd = Math.min(Math.max(0, rawNsdRegHrs), effectiveRegHrs) + Math.min(Math.max(0, rawNsdOtHrs), effectiveOtHrs);
    if (totalCappedNsd > 8) {
      messages.push(
        isTl
          ? 'Paalala: Ang statutory Night Shift window (10:00 PM hanggang 6:00 AM) ay may habang 8 oras bawat araw.'
          : 'Note: The statutory Night Shift window (10:00 PM to 6:00 AM) spans 8 hours per calendar day.'
      );
    }

    if (messages.length > 0) {
      validationAlert.textContent = messages.join(' ');
      validationAlert.classList.remove('hidden');
    } else {
      validationAlert.classList.add('hidden');
    }
  }

  function recalculate() {
    validateInputs();

    var currentWorkdayType = workdayTypeSelect ? workdayTypeSelect.value : 'ordinary';
    var isRegHolidayType =
      currentWorkdayType === 'regular_holiday' || currentWorkdayType === 'regular_holiday_rest';

    if (holidayEligibilityWrap) {
      if (isRegHolidayType) {
        holidayEligibilityWrap.classList.remove('opacity-60');
      } else {
        holidayEligibilityWrap.classList.add('opacity-60');
      }
    }

    var rawNormalVal = normalHoursInput ? String(normalHoursInput.value || '').trim() : '8';
    var parsedNormal = rawNormalVal === '' ? NaN : parseFloat(rawNormalVal);

    var state = computeOvertimeAndHolidayPay({
      monthlySalary: parseCleanFloat(salaryInput, 0),
      conversionMethod: conversionSelect ? conversionSelect.value : '261_year',
      normalHoursPerDay: parsedNormal,
      workdayType: currentWorkdayType,
      holidayEligible: holidayEligibleInput ? Boolean(holidayEligibleInput.checked) : true,
      regularHoursWorked: parseCleanFloat(regularHoursInput, 0),
      overtimeHoursWorked: parseCleanFloat(overtimeHoursInput, 0),
      nightRegularHours: parseCleanFloat(nightShiftHoursInput, 0),
      nightOvertimeHours: parseCleanFloat(nightOvertimeHoursInput, 0)
    });

    // Update Input Panel Derived Rate Preview
    if (previewDailyRate) {
      previewDailyRate.textContent = formatPHP(state.dailyRate);
    }
    if (previewHourlyRate) {
      previewHourlyRate.textContent = formatPHP(state.hourlyRate) + (isTl ? ' / oras' : ' / hr');
    }
    if (previewConversionFormula) {
      previewConversionFormula.textContent = isTl
        ? state.conversionObj.formulaTextTl + ' ÷ ' + state.normalHoursPerDay + ' oras'
        : state.conversionObj.formulaTextEn + ' ÷ ' + state.normalHoursPerDay + ' hrs';
    }

    // Update Results Header Badges & Hero Banner
    if (resScenarioBadge) {
      resScenarioBadge.textContent = isTl ? state.rule.labelTl : state.rule.labelEn;
    }
    if (resLegalBasisBadge) {
      resLegalBasisBadge.textContent = isTl ? state.rule.legalBasisTl : state.rule.legalBasisEn;
    }
    if (resTotalEstimatedPay) {
      resTotalEstimatedPay.textContent = formatPHP(state.totalEstimatedPay);
    }
    if (resAdditionalPremiumTotal) {
      resAdditionalPremiumTotal.textContent = formatPHP(state.totalAdditionalPremium);
    }
    if (resHourlyRateDisplay) {
      resHourlyRateDisplay.textContent = formatPHP(state.hourlyRate);
    }
    if (resDailyRateDisplay) {
      resDailyRateDisplay.textContent = formatPHP(state.dailyRate);
    }

    // Update 4 Core Breakdown Cards
    if (resRegularPay) {
      resRegularPay.textContent = formatPHP(state.estimatedRegularPay);
    }
    if (resRegularPaySub) {
      if (state.isUnworkedRegularHoliday) {
        resRegularPaySub.textContent = isTl
          ? '100% Unworked Regular Holiday Pay (1 araw na batayang sahod)'
          : '100% Unworked Regular Holiday Pay (1 full day basic wage)';
      } else if (state.isPartialRegularHoliday) {
        resRegularPaySub.textContent = isTl
          ? state.regularHours + ' oras na pinasok (' + formatPHP(state.workedBasePay) + ') + ' + state.unworkedHolidayHours + ' oras guaranteed holiday (' + formatPHP(state.unworkedHolidayPay) + ')'
          : state.regularHours + ' hrs worked (' + formatPHP(state.workedBasePay) + ') + ' + state.unworkedHolidayHours + ' hrs guaranteed holiday (' + formatPHP(state.unworkedHolidayPay) + ')';
      } else if (state.isRegularHoliday && !state.holidayEligible && state.regularHours === 0) {
        resRegularPaySub.textContent = isTl
          ? '0 oras (Hindi kwalipikado sa unworked Regular Holiday pay)'
          : '0 hrs (Marked ineligible for unworked Regular Holiday pay)';
      } else {
        resRegularPaySub.textContent = isTl
          ? state.regularHours + ' oras × ' + formatPHP(state.hourlyRate) + '/oras (100% base)'
          : state.regularHours + ' hrs × ' + formatPHP(state.hourlyRate) + '/hr (100% base)';
      }
    }

    if (resHolidayRestPay) {
      resHolidayRestPay.textContent = formatPHP(state.additionalHolidayRestPay);
    }
    if (resHolidayRestPaySub) {
      if (state.rule.holidayRestPremiumMultiplier === 0) {
        resHolidayRestPaySub.textContent = isTl
          ? '+0% dagdag (Regular na araw ng trabaho — 100% base)'
          : '+0% premium (Ordinary workday — 100% base rate)';
      } else {
        var addPct = Math.round(state.rule.holidayRestPremiumMultiplier * 100);
        resHolidayRestPaySub.textContent = isTl
          ? '+' + addPct + '% dagdag sa ' + state.regularHours + ' oras na aktuwal na pinasok'
          : '+' + addPct + '% premium on ' + state.regularHours + ' actual worked hrs';
      }
    }

    if (resOvertimePay) {
      resOvertimePay.textContent = formatPHP(state.overtimePay);
    }
    if (resOvertimePaySub) {
      var otPct = Math.round(state.rule.otTotalMultiplier * 100);
      resOvertimePaySub.textContent = isTl
        ? state.overtimeHours + ' OT oras × ' + otPct + '% (' + state.rule.otTotalMultiplier.toFixed(2) + '× basic hourly rate)'
        : state.overtimeHours + ' OT hrs × ' + otPct + '% (' + state.rule.otTotalMultiplier.toFixed(2) + '× basic hourly rate)';
    }

    if (resNightShiftPay) {
      resNightShiftPay.textContent = formatPHP(state.nightShiftPay);
    }
    if (resNightShiftPaySub) {
      if (state.effectiveNightHours === 0) {
        resNightShiftPaySub.textContent = isTl
          ? '0 oras sa pagitan ng 10:00 PM at 6:00 AM (+10% NSD)'
          : '0 hrs worked between 10:00 PM and 6:00 AM (+10% NSD)';
      } else if (state.nightRegularHours > 0 && state.nightOvertimeHours > 0) {
        resNightShiftPaySub.textContent = isTl
          ? state.nightRegularHours + ' reg NSD (' + formatPHP(state.nsdRegularPay) + ') + ' + state.nightOvertimeHours + ' OT NSD (' + formatPHP(state.nsdOvertimePay) + ')'
          : state.nightRegularHours + ' reg NSD (' + formatPHP(state.nsdRegularPay) + ') + ' + state.nightOvertimeHours + ' OT NSD (' + formatPHP(state.nsdOvertimePay) + ')';
      } else if (state.nightOvertimeHours > 0) {
        resNightShiftPaySub.textContent = isTl
          ? state.nightOvertimeHours + ' OT oras × +10% ng ' + Math.round(state.rule.otTotalMultiplier * 100) + '% OT rate'
          : state.nightOvertimeHours + ' OT hrs × +10% of ' + Math.round(state.rule.otTotalMultiplier * 100) + '% OT rate';
      } else {
        resNightShiftPaySub.textContent = isTl
          ? state.nightRegularHours + ' reg oras × +10% ng ' + Math.round(state.rule.dayMultiplier * 100) + '% rate'
          : state.nightRegularHours + ' reg hrs × +10% of ' + Math.round(state.rule.dayMultiplier * 100) + '% day rate';
      }
    }

    // Update Transparent Formula Breakdown Table
    if (tblHourlyFormula) {
      tblHourlyFormula.textContent = isTl
        ? formatPHP(state.dailyRate) + ' arawang sahod ÷ ' + state.normalHoursPerDay + ' oras'
        : formatPHP(state.dailyRate) + ' daily rate ÷ ' + state.normalHoursPerDay + ' normal hrs';
    }
    if (tblHourlyRateVal) {
      tblHourlyRateVal.textContent = formatPHP(state.hourlyRate) + (isTl ? '/oras' : '/hr');
    }

    if (tblBaseHoursLabel) {
      if (state.isUnworkedRegularHoliday) {
        tblBaseHoursLabel.textContent = isTl
          ? 'Unworked Regular Holiday Base (100%)'
          : 'Unworked Regular Holiday Entitlement (100%)';
      } else if (state.isPartialRegularHoliday) {
        tblBaseHoursLabel.textContent = isTl
          ? 'Batayang Sahod sa Oras na Pinasok + Unworked Holiday Entitlement (100%)'
          : 'Worked Base Pay + Guaranteed Unworked Holiday Entitlement (100%)';
      } else {
        tblBaseHoursLabel.textContent = isTl
          ? 'Batayang Sahod sa Regular na Oras (100%)'
          : 'Estimated Regular Base Pay (100%)';
      }
    }
    if (tblBaseHoursFormula) {
      if (state.isUnworkedRegularHoliday) {
        tblBaseHoursFormula.textContent = isTl
          ? '100% × ' + formatPHP(state.dailyRate) + ' (Art. 94)'
          : '100% × ' + formatPHP(state.dailyRate) + ' daily wage (Art. 94)';
      } else if (state.isPartialRegularHoliday) {
        tblBaseHoursFormula.textContent = isTl
          ? state.regularHours + ' oras pinasok (' + formatPHP(state.workedBasePay) + ') + ' + state.unworkedHolidayHours + ' oras holiday (' + formatPHP(state.unworkedHolidayPay) + ')'
          : state.regularHours + ' hrs worked (' + formatPHP(state.workedBasePay) + ') + ' + state.unworkedHolidayHours + ' unworked holiday hrs (' + formatPHP(state.unworkedHolidayPay) + ')';
      } else {
        tblBaseHoursFormula.textContent =
          formatPHP(state.hourlyRate) + ' × 1.00 × ' + state.regularHours + (isTl ? ' oras' : ' hrs');
      }
    }
    if (tblBaseHoursAmount) {
      tblBaseHoursAmount.textContent = formatPHP(state.estimatedRegularPay);
    }

    if (tblPremiumLabel) {
      var premPctLabel = Math.round(state.rule.holidayRestPremiumMultiplier * 100);
      tblPremiumLabel.textContent = isTl
        ? 'Dagdag na Holiday / Rest Day Pay (+' + premPctLabel + '%)'
        : 'Additional Holiday / Rest Day Pay (+' + premPctLabel + '%)';
    }
    if (tblPremiumFormula) {
      tblPremiumFormula.textContent =
        formatPHP(state.hourlyRate) +
        ' × ' +
        state.rule.holidayRestPremiumMultiplier.toFixed(2) +
        ' × ' +
        state.regularHours +
        (isTl ? ' oras' : ' hrs');
    }
    if (tblPremiumAmount) {
      tblPremiumAmount.textContent = formatPHP(state.additionalHolidayRestPay);
    }

    if (tblOvertimeLabel) {
      tblOvertimeLabel.textContent = isTl
        ? 'Bayad sa Overtime (' + formatMultiplierPct(state.rule.otTotalMultiplier) + ')'
        : 'Additional Overtime Pay (' + formatMultiplierPct(state.rule.otTotalMultiplier) + ')';
    }
    if (tblOvertimeFormula) {
      var otRatePerHr = roundCentavos(state.hourlyRateExact * state.rule.otTotalMultiplier);
      tblOvertimeFormula.textContent =
        formatPHP(state.hourlyRate) +
        ' × ' +
        state.rule.dayMultiplier.toFixed(2) +
        ' × ' +
        (1 + state.rule.otAddonRate).toFixed(2) +
        ' (' +
        formatPHP(otRatePerHr) +
        (isTl ? '/oras) × ' : '/hr) × ') +
        state.overtimeHours +
        (isTl ? ' oras' : ' hrs');
    }
    if (tblOvertimeAmount) {
      tblOvertimeAmount.textContent = formatPHP(state.overtimePay);
    }

    if (tblNightShiftLabel) {
      tblNightShiftLabel.textContent = isTl
        ? 'Night Shift Differential (+10% NSD)'
        : 'Night Shift Differential (+10% NSD)';
    }
    if (tblNightShiftFormula) {
      if (state.nightRegularHours > 0 && state.nightOvertimeHours > 0) {
        tblNightShiftFormula.textContent = isTl
          ? state.nightRegularHours + ' reg oras (' + formatPHP(state.nsdRegularPay) + ') + ' + state.nightOvertimeHours + ' OT oras (' + formatPHP(state.nsdOvertimePay) + ')'
          : state.nightRegularHours + ' reg hrs (' + formatPHP(state.nsdRegularPay) + ') + ' + state.nightOvertimeHours + ' OT hrs (' + formatPHP(state.nsdOvertimePay) + ')';
      } else if (state.nightOvertimeHours > 0) {
        tblNightShiftFormula.textContent =
          formatPHP(state.hourlyRate) +
          ' × ' +
          state.rule.otTotalMultiplier.toFixed(2) +
          ' × 0.10 × ' +
          state.nightOvertimeHours +
          (isTl ? ' OT oras' : ' OT hrs');
      } else {
        tblNightShiftFormula.textContent =
          formatPHP(state.hourlyRate) +
          ' × ' +
          state.rule.dayMultiplier.toFixed(2) +
          ' × 0.10 × ' +
          state.nightRegularHours +
          (isTl ? ' reg oras' : ' reg hrs');
      }
    }
    if (tblNightShiftAmount) {
      tblNightShiftAmount.textContent = formatPHP(state.nightShiftPay);
    }

    if (tblTotalAmount) {
      tblTotalAmount.textContent = formatPHP(state.totalEstimatedPay);
    }

    if (resDayRuleNotice) {
      resDayRuleNotice.textContent = isTl ? state.rule.unworkedRuleTl : state.rule.unworkedRuleEn;
    }

    return state;
  }

  /**
   * Mobile Sticky Calculate UX (matches Take-Home Pay, 13th Month, PhilHealth, and SSS calculators)
   */
  function isReducedMotionPreferred() {
    return Boolean(
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function scrollToResultsSection() {
    if (!resultsSection) return;
    var headerEl = document.querySelector('header');
    var headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 64;
    var rect = resultsSection.getBoundingClientRect();
    var targetY = Math.max(0, window.pageYOffset + rect.top - headerHeight - 12);

    window.scrollTo({
      top: targetY,
      behavior: isReducedMotionPreferred() ? 'auto' : 'smooth'
    });

    var summaryHeading = document.getElementById('resultsSummaryHeading');
    if (summaryHeading && typeof summaryHeading.focus === 'function') {
      setTimeout(function () {
        summaryHeading.focus({ preventScroll: true });
      }, isReducedMotionPreferred() ? 0 : 320);
    }
  }

  function handleMobileCalculateTrigger() {
    recalculate();
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    scrollToResultsSection();
  }

  function ensureFocusedFieldUnobscured(targetEl) {
    if (!targetEl || window.innerWidth >= 1024) return;
    var headerEl = document.querySelector('header');
    var headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 64;
    var barRect = mobileCalculateBar ? mobileCalculateBar.getBoundingClientRect() : null;
    var viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    var usableBottom = barRect && barRect.height > 0 ? Math.min(viewportHeight, barRect.top) : viewportHeight;

    var fieldContainer = targetEl.closest('[data-calc-field]') || targetEl;
    var rect = fieldContainer.getBoundingClientRect();

    if (rect.bottom > usableBottom - 12) {
      var deltaDown = rect.bottom - (usableBottom - 16);
      window.scrollBy({
        top: deltaDown,
        behavior: isReducedMotionPreferred() ? 'auto' : 'smooth'
      });
    } else if (rect.top < headerBottom + 8) {
      var deltaUp = rect.top - (headerBottom + 12);
      window.scrollBy({
        top: deltaUp,
        behavior: isReducedMotionPreferred() ? 'auto' : 'smooth'
      });
    }
  }

  function applyScenarioPreset(presetId) {
    if (!workdayTypeSelect || !regularHoursInput || !overtimeHoursInput || !nightShiftHoursInput) return;

    if (holidayEligibleInput) {
      holidayEligibleInput.checked = true;
    }

    if (presetId === 'ordinary_ot') {
      workdayTypeSelect.value = 'ordinary';
      regularHoursInput.value = '8';
      overtimeHoursInput.value = '2';
      nightShiftHoursInput.value = '0';
      if (nightOvertimeHoursInput) nightOvertimeHoursInput.value = '0';
    } else if (presetId === 'regular_holiday_worked') {
      workdayTypeSelect.value = 'regular_holiday';
      regularHoursInput.value = '8';
      overtimeHoursInput.value = '0';
      nightShiftHoursInput.value = '0';
      if (nightOvertimeHoursInput) nightOvertimeHoursInput.value = '0';
    } else if (presetId === 'special_holiday_ot') {
      workdayTypeSelect.value = 'special_holiday';
      regularHoursInput.value = '8';
      overtimeHoursInput.value = '2';
      nightShiftHoursInput.value = '0';
      if (nightOvertimeHoursInput) nightOvertimeHoursInput.value = '0';
    } else if (presetId === 'rest_day_shift') {
      workdayTypeSelect.value = 'rest_day';
      regularHoursInput.value = '8';
      overtimeHoursInput.value = '0';
      nightShiftHoursInput.value = '0';
      if (nightOvertimeHoursInput) nightOvertimeHoursInput.value = '0';
    } else if (presetId === 'night_shift_bpo') {
      workdayTypeSelect.value = 'ordinary';
      regularHoursInput.value = '8';
      overtimeHoursInput.value = '2';
      nightShiftHoursInput.value = '6';
      if (nightOvertimeHoursInput) nightOvertimeHoursInput.value = '2';
    } else if (presetId === 'regular_holiday_rest_ot') {
      workdayTypeSelect.value = 'regular_holiday_rest';
      regularHoursInput.value = '8';
      overtimeHoursInput.value = '2';
      nightShiftHoursInput.value = '4';
      if (nightOvertimeHoursInput) nightOvertimeHoursInput.value = '0';
    }

    recalculate();
  }

  function bindEvents() {
    var liveInputs = [
      salaryInput,
      conversionSelect,
      normalHoursInput,
      workdayTypeSelect,
      holidayEligibleInput,
      regularHoursInput,
      overtimeHoursInput,
      nightShiftHoursInput,
      nightOvertimeHoursInput
    ];

    for (var i = 0; i < liveInputs.length; i++) {
      var inputEl = liveInputs[i];
      if (!inputEl) continue;
      inputEl.addEventListener('input', recalculate);
      inputEl.addEventListener('change', recalculate);
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.type !== 'checkbox') {
          e.preventDefault();
          if (window.innerWidth < 1024) {
            handleMobileCalculateTrigger();
          } else {
            recalculate();
          }
        }
      });
    }

    // Salary preset buttons
    var salaryPresetBtns = document.querySelectorAll('[data-ot-salary-preset]');
    for (var s = 0; s < salaryPresetBtns.length; s++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var amount = btn.getAttribute('data-ot-salary-preset');
          if (salaryInput && amount) {
            salaryInput.value = amount;
            recalculate();
          }
        });
      })(salaryPresetBtns[s]);
    }

    // Work scenario preset buttons
    var scenarioBtns = document.querySelectorAll('[data-ot-scenario]');
    for (var c = 0; c < scenarioBtns.length; c++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var scenario = btn.getAttribute('data-ot-scenario');
          if (scenario) {
            applyScenarioPreset(scenario);
          }
        });
      })(scenarioBtns[c]);
    }

    // Reset button
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (salaryInput) salaryInput.value = DEFAULTS.monthlySalary;
        if (conversionSelect) conversionSelect.value = DEFAULTS.conversionMethod;
        if (normalHoursInput) normalHoursInput.value = DEFAULTS.normalHoursPerDay;
        if (workdayTypeSelect) workdayTypeSelect.value = DEFAULTS.workdayType;
        if (holidayEligibleInput) holidayEligibleInput.checked = DEFAULTS.holidayEligible;
        if (regularHoursInput) regularHoursInput.value = DEFAULTS.regularHoursWorked;
        if (overtimeHoursInput) overtimeHoursInput.value = DEFAULTS.overtimeHoursWorked;
        if (nightShiftHoursInput) nightShiftHoursInput.value = DEFAULTS.nightShiftHours;
        if (nightOvertimeHoursInput) nightOvertimeHoursInput.value = DEFAULTS.nightOvertimeHours;
        recalculate();
        if (salaryInput) salaryInput.focus();
      });
    }

    // Mobile Calculate Pay sticky button
    if (calculateBtn) {
      calculateBtn.addEventListener('click', function (e) {
        e.preventDefault();
        handleMobileCalculateTrigger();
      });
    }

    // Ensure focused inputs remain visible above mobile keyboard and sticky bar
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
        if (
          active &&
          calculatorInputSection &&
          calculatorInputSection.contains(active) &&
          active !== calculateBtn
        ) {
          ensureFocusedFieldUnobscured(active);
        }
      });
    }

    // Restore state handoff if user switched between English and Filipino, then clear sessionStorage key
    try {
      var rawHandoff = window.sessionStorage ? window.sessionStorage.getItem(CALC_HANDOFF_KEY) : null;
      if (rawHandoff) {
        var handoff = JSON.parse(rawHandoff);
        if (handoff && handoff.calculator === 'overtime-holiday') {
          if (salaryInput && handoff.monthlySalary !== undefined) salaryInput.value = handoff.monthlySalary;
          if (conversionSelect && handoff.conversionMethod) conversionSelect.value = handoff.conversionMethod;
          if (normalHoursInput && handoff.normalHours !== undefined) normalHoursInput.value = handoff.normalHours;
          if (workdayTypeSelect && handoff.workdayType) workdayTypeSelect.value = handoff.workdayType;
          if (holidayEligibleInput && handoff.holidayEligible !== undefined) {
            holidayEligibleInput.checked = Boolean(handoff.holidayEligible);
          }
          if (regularHoursInput && handoff.regularHours !== undefined) regularHoursInput.value = handoff.regularHours;
          if (overtimeHoursInput && handoff.overtimeHours !== undefined) overtimeHoursInput.value = handoff.overtimeHours;
          if (nightShiftHoursInput && handoff.nightShiftHours !== undefined) nightShiftHoursInput.value = handoff.nightShiftHours;
          if (nightOvertimeHoursInput && handoff.nightOvertimeHours !== undefined) {
            nightOvertimeHoursInput.value = handoff.nightOvertimeHours;
          }
          window.sessionStorage.removeItem(CALC_HANDOFF_KEY);
        }
      }
    } catch (e) {
      // Ignore storage parsing errors
    }
  }

  bindEvents();
  recalculate();

  // Expose calculation API for verification & testing
  window._SuweldoToolsOvertimeHoliday = {
    recalculate: recalculate,
    computeOvertimeAndHolidayPay: computeOvertimeAndHolidayPay,
    formatPHP: formatPHP,
    WORKDAY_RULES: WORKDAY_RULES,
    CONVERSION_METHODS: CONVERSION_METHODS
  };
})();
