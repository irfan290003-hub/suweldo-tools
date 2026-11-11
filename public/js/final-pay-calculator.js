/**
 * SuweldoTools — Final Pay Calculator Philippines Calculation Engine
 * Pure Vanilla JavaScript implementation.
 * Zero external dependencies. Browser & Node.js compatible via UMD wrapper
 * (CommonJS `module.exports` and Browser/Global `window.FinalPayCalculator` / `globalThis.FinalPayCalculator`).
 *
 * Statutory Authorities & Grounding:
 * - DOLE Labor Advisory No. 06, Series of 2020 (Guidelines on Payment of Final Pay and Issuance of Certificate of Employment)
 * - Presidential Decree No. 442 (Labor Code of the Philippines, as amended and renumbered):
 *   - Article 95: Right to Service Incentive Leave (SIL)
 *   - Articles 102, 113, 116: Prohibitions against unauthorized wage deductions
 *   - Article 297 [282]: Termination by Employer (Just Causes)
 *   - Article 298 [283]: Closure of Establishment and Reduction of Personnel (Authorized Causes)
 *   - Article 299 [284]: Disease as Ground for Termination (Authorized Cause)
 *   - Article 300 [285]: Termination by Employee (Voluntary Resignation)
 * - Presidential Decree No. 851: 13th Month Pay Law & 1987 Revised DOLE Guidelines
 * - National Internal Revenue Code (NIRC) of 1997, as amended by RA 10963 (TRAIN Law):
 *   - Section 32(B)(6)(b): Exclusion of Separation Pay due to death, sickness or other physical disability, or causes beyond control of employee
 *   - Section 32(B)(7)(e): ₱90,000 Tax-Exempt Ceiling for 13th Month Pay and Other Benefits
 * - BIR Revenue Regulations No. 2-98, as further amended by RR No. 29-2025 (effective January 6, 2026):
 *   - De minimis benefits: Monetized unused vacation leave credits of private employees not exceeding 12 days during the year
 */

(function (root, factory) {
  var exported = factory();
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = exported;
  }
  if (typeof root !== 'undefined' && root) {
    root.FinalPayCalculator = exported;
  }
  if (typeof globalThis !== 'undefined' && globalThis) {
    globalThis.FinalPayCalculator = exported;
  }
  if (typeof window !== 'undefined' && window) {
    window.FinalPayCalculator = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function () {
  'use strict';

  // Statutory Divisors per DOLE Handbook on Workers' Statutory Monetary Benefits
  var DIVISORS = {
    STANDARD_5_DAY: 261,    // Ordinary working days (Mon-Fri), rest days Sat-Sun (excluding special days)
    STANDARD_6_DAY: 313,    // Ordinary working days (Mon-Sat), rest days Sun
    EVERYDAY: 365,          // Working all 365 days of the year including rest days and holidays
    CUSTOM_HOSPITAL: 394.40 // All-days-worked annual equivalent factor with applicable rest-day and holiday premiums included
  };

  // Statutory Separation Causes
  var SEPARATION_CAUSES = {
    REDUNDANCY: 'redundancy',             // Art. 298: 1 month pay per year of service (min 1 month)
    LABOR_SAVING: 'labor_saving',         // Art. 298: 1 month pay per year of service (min 1 month)
    RETRENCHMENT: 'retrenchment',         // Art. 298: 1/2 month pay per year of service (min 1 month)
    CLOSURE_NO_LOSS: 'closure_no_loss',   // Art. 298: 1/2 month pay per year of service (min 1 month)
    CLOSURE_LOSS: 'closure_loss',         // Art. 298: ₱0.00 (exempt from separation pay)
    DISEASE: 'disease',                   // Art. 299: 1/2 month pay per year of service (min 1 month)
    RESIGNATION: 'resignation',           // Art. 300: ₱0.00 statutory
    JUST_CAUSE: 'just_cause',             // Art. 297: ₱0.00 statutory
    CONTRACT_EXPIRY: 'contract_expiry',   // Fixed-term: ₱0.00 statutory
    OTHER: 'other'                        // Custom/contractual separation pay
  };

  var STATUTORY_CONSTANTS = {
    TAX_EXEMPT_BONUS_CAP: 90000,          // NIRC Sec. 32(B)(7)(e)
    DE_MINIMIS_VL_DAYS_CAP: 12,           // BIR RR No. 29-2025 Sec. 1 (eff. Jan 6, 2026) further amending RR 2-98, as amended
    STATUTORY_SIL_DAYS_CAP: 5,            // Labor Code Art. 95(a)
    FINAL_PAY_RELEASE_DAYS: 30            // DOLE Labor Advisory No. 06-20
  };

  // Statutory Retirement Constants (Labor Code Art. 302 as amended by RA 7641; RA 4917; NIRC Sec. 32(B)(6)(a))
  var RETIREMENT_CONSTANTS = {
    STATUTORY_RETIREMENT_DAYS_FACTOR: 22.5, // 15 days basic salary + 5 days SIL + 2.5 days (1/12 of 13th month pay)
    STATUTORY_OPTIONAL_AGE: 60,             // Labor Code Art. 302: Optional retirement minimum age
    STATUTORY_COMPULSORY_AGE: 65,           // Labor Code Art. 302: Compulsory retirement age
    STATUTORY_MIN_SERVICE_YEARS: 5.0,       // Labor Code Art. 302: Minimum qualifying service for statutory retirement
    PRIVATE_PLAN_MIN_AGE: 50,               // RA 4917 / NIRC Sec. 32(B)(6)(a): Qualified private plan minimum age
    PRIVATE_PLAN_MIN_SERVICE_YEARS: 10.0    // RA 4917: Minimum qualifying service in the same firm
  };

  // Explicit Benefit Entitlement / Payability Statuses for Retirement Benefits
  var RETIREMENT_ENTITLEMENT_STATUS = {
    CONFIRMED_PAYABLE: 'CONFIRMED_PAYABLE',             // Legally or contractually confirmed payable benefit
    PROVISIONAL_ENTITLEMENT: 'PROVISIONAL_ENTITLEMENT', // Benefit entitlement itself is unverified (e.g. unknown employer or plan coverage)
    NOT_APPLICABLE: 'NOT_APPLICABLE'                    // Zero amount / no benefit exists
  };

  // Explicit Tax Classification Statuses for Retirement Benefits
  var RETIREMENT_TAX_STATUS = {
    CONFIRMED_TAX_EXEMPT: 'CONFIRMED_TAX_EXEMPT',       // 100% Tax-Exempt under statute or qualified plan
    CONFIRMED_TAXABLE: 'CONFIRMED_TAXABLE',             // Taxable compensation subject to regular tax
    UNCONFIRMED_PROVISIONAL: 'UNCONFIRMED_PROVISIONAL', // Tax exemption or entitlement documentation pending
    NOT_APPLICABLE: 'NOT_APPLICABLE'                    // Zero amount / no payment exists
  };

  // Employer Coverage Classification for RA 7641 Statutory Mandate
  var RETIREMENT_EMPLOYER_COVERAGE = {
    COVERED: 'COVERED',         // Private general employers and non-chartered GOCCs
    EXEMPT: 'EXEMPT',           // Retail, service, agricultural <= 10 workers; chartered gov agencies
    NOT_COVERED: 'NOT_COVERED', // General non-covered entities
    UNKNOWN: 'UNKNOWN'          // Unverified employer status
  };

  // Coexistence Modes for Separation Pay & Retirement Pay
  var RETIREMENT_COEXISTENCE_MODES = {
    BOTH_PAYABLE: 'both_payable', // Default per Goodyear Philippines v. Angus (G.R. No. 185449)
    HIGHER_OF: 'higher_of',       // Contractual higher-of per Aquino v. NLRC (G.R. No. 87653)
    OFFSET: 'offset'              // Contractual offset per Aquino v. NLRC
  };

  /**
   * Half-up rounding to two decimal places (centavos)
   * Safely avoids floating-point precision pitfalls using Number.EPSILON
   * @param {number|string} val
   * @returns {number}
   */
  function round2(val) {
    var n = Number(val);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /**
   * Safely parse clean numeric inputs, stripping commas, whitespace, and rejecting negatives/NaN
   * @param {*} val
   * @param {number} defaultVal
   * @returns {number}
   */
  function parseCleanNumber(val, defaultVal) {
    var fallback = typeof defaultVal === 'number' && Number.isFinite(defaultVal) ? defaultVal : 0;
    if (val === null || val === undefined || typeof val === 'boolean') return fallback;
    var cleaned = String(val).replace(/,/g, '').trim();
    if (cleaned === '') return fallback;
    var num = Number(cleaned);
    return Number.isFinite(num) ? num : fallback;
  }

  /**
   * A. Calculate Daily Basic Rate
   * Formula: Daily Rate = round2(Monthly Basic Salary * 12 / Selected Divisor)
   * Supports custom daily rate override and standard DOLE divisors (261, 313, 365, 394.40).
   *
   * @param {Object} params
   * @param {number} params.monthlyBasicSalary
   * @param {number} [params.divisor=261]
   * @param {number} [params.customDailyRate]
   * @param {boolean} [params.isCustomDailyRate=false]
   * @returns {{ dailyRate: number, divisor: number, isCustom: boolean }}
   */
  function calculateDailyRate(params) {
    params = params || {};
    var isCustom = Boolean(params.isCustomDailyRate);
    if (isCustom) {
      var parsedCustom = parseCleanNumber(params.customDailyRate, 0);
      var customRate = round2(Math.max(0, parsedCustom));
      return {
        dailyRate: customRate,
        divisor: 0,
        isCustom: true
      };
    }

    var mbs = Math.max(0, parseCleanNumber(params.monthlyBasicSalary, 0));
    var divisor = parseCleanNumber(params.divisor, DIVISORS.STANDARD_5_DAY);
    if (divisor <= 0) divisor = DIVISORS.STANDARD_5_DAY;

    var dailyRate = round2((mbs * 12) / divisor);
    return {
      dailyRate: dailyRate,
      divisor: divisor,
      isCustom: false
    };
  }

  /**
   * B. Calculate Unpaid Earned Salary
   * Formula: Unpaid Salary = max(0, round2(Days Worked * Daily Rate) - Tardiness Deductions)
   *
   * @param {Object} params
   * @param {number} params.daysWorked
   * @param {number} params.dailyRate
   * @param {number} [params.tardinessDeductions=0]
   * @returns {{ daysWorked: number, dailyRate: number, earnedWages: number, tardinessDeductions: number, netUnpaidSalary: number, unrecoveredTardiness: number }}
   */
  function calculateUnpaidSalary(params) {
    params = params || {};
    var daysWorked = Math.max(0, parseCleanNumber(params.daysWorked, 0));
    var dailyRate = Math.max(0, parseCleanNumber(params.dailyRate, 0));
    var tardiness = Math.max(0, parseCleanNumber(params.tardinessDeductions, 0));

    var earnedWages = round2(daysWorked * dailyRate);
    var netUnpaidSalary = Math.max(0, round2(earnedWages - tardiness));
    var unrecoveredTardiness = tardiness > earnedWages ? round2(tardiness - earnedWages) : 0;

    return {
      daysWorked: daysWorked,
      dailyRate: dailyRate,
      earnedWages: earnedWages,
      tardinessDeductions: tardiness,
      netUnpaidSalary: netUnpaidSalary,
      unrecoveredTardiness: unrecoveredTardiness
    };
  }

  /**
   * C. Calculate Prorated 13th Month Pay (PD 851)
   * Formula: Net 13th Month = max(0, round2(YTD Basic Salary / 12) - Prior Advances)
   * Note: Excludes allowances, overtime, holiday premiums, and night differential from basic salary.
   *
   * @param {Object} params
   * @param {number} params.ytdBasicSalary
   * @param {number} [params.priorAdvances=0]
   * @returns {{ ytdBasicSalary: number, gross13thMonth: number, priorAdvances: number, net13thMonthPay: number, remainingAdvance: number }}
   */
  function calculate13thMonthPay(params) {
    params = params || {};
    var ytdBasic = Math.max(0, parseCleanNumber(params.ytdBasicSalary, 0));
    var advances = Math.max(0, parseCleanNumber(params.priorAdvances, 0));

    var gross13th = round2(ytdBasic / 12);
    var net13th = Math.max(0, round2(gross13th - advances));
    var remainingAdvance = advances > gross13th ? round2(advances - gross13th) : 0;

    return {
      ytdBasicSalary: ytdBasic,
      gross13thMonth: gross13th,
      priorAdvances: advances,
      net13thMonthPay: net13th,
      remainingAdvance: remainingAdvance
    };
  }

  /**
   * Calculate Credited Years of Service for Separation Pay
   * DOLE Rule: At least 6 months counts as 1 whole year.
   *
   * @param {number} serviceYears
   * @param {number} [serviceMonths=0]
   * @returns {number}
   */
  function calculateCreditedYears(serviceYears, serviceMonths) {
    var yrs = Math.max(0, parseInt(serviceYears, 10) || 0);
    var mos = Math.max(0, parseInt(serviceMonths, 10) || 0);
    var fractionYear = mos >= 6 ? 1 : 0;
    var totalCredited = yrs + fractionYear;
    return totalCredited;
  }

  /**
   * E. Calculate Statutory Separation Pay
   * Grounded in Articles 297-300 of the Labor Code:
   * - Redundancy & Labor-Saving: 1 month salary per year of service, min 1 month.
   * - Retrenchment, Closure without loss, Disease: 0.5 month salary per year of service, min 1 month.
   * - Closure with serious loss, Resignation, Just Cause, Contract Expiration: ₱0.00 statutory.
   * - For eligible authorized causes, the statutory minimum is at least 1 month salary, even when
   *   service is under six months (creditedYears === 0). A fraction of at least 6 months counts as 1 full year
   *   when calculating the per-year component.
   *
   * When Custom Daily Rate is enabled (`isCustomDailyRate: true`), statutory separation pay
   * does NOT silently use `monthlyBasicSalary`. Instead, it uses the DOLE Equivalent Monthly Rate
   * (`round2(dailyRate * emrDivisor / 12)`) for the explicitly selected work arrangement (`dailyEmrBasis`
   * in `[261, 313, 365, 394.40]`), or `monthlyBasicSalary` only when `dailyEmrBasis === 'monthly_salary'`,
   * or an explicit `customSeparationPay` override.
   *
   * @param {Object} params
   * @param {string} params.separationCause
   * @param {number} params.monthlyBasicSalary
   * @param {number} params.creditedYears
   * @param {number} [params.customSeparationPay]
   * @param {boolean} [params.isCustomDailyRate=false]
   * @param {number} [params.dailyRate=0]
   * @param {string|number} [params.dailyEmrBasis='']
   * @returns {{ cause: string, causeLabel: string, creditedYears: number, multiplier: number, amount: number, isTaxExempt: boolean, legalBasis: string, monthlyBaseUsed: number, rateBasis: string, emrDivisor: number, missingBasis: boolean }}
   */
  function calculateSeparationPay(params) {
    params = params || {};
    var cause = params.separationCause || SEPARATION_CAUSES.RESIGNATION;
    var rawMbs = Math.max(0, parseCleanNumber(params.monthlyBasicSalary, 0));
    var serviceYears = Math.max(0, parseInt(params.serviceYears, 10) || 0);
    var serviceMonths = Math.max(0, parseInt(params.serviceMonths, 10) || 0);
    var creditedYears = params.creditedYears !== undefined
      ? Math.max(0, parseCleanNumber(params.creditedYears, 0))
      : calculateCreditedYears(serviceYears, serviceMonths);

    // Positive service duration guard:
    // Requires positive service tenure (serviceYears > 0 || serviceMonths > 0).
    // If tenure is zero years AND zero months, statutory separation pay is ₱0.00.
    var hasPositiveService = (serviceYears > 0 || serviceMonths > 0);
    if (params.serviceYears === undefined && params.serviceMonths === undefined && creditedYears > 0) {
      hasPositiveService = true;
    }

    var isCustomDaily = Boolean(params.isCustomDailyRate);
    var dailyRate = Math.max(0, parseCleanNumber(params.dailyRate, 0));
    var rawEmrBasis = params.dailyEmrBasis !== undefined && params.dailyEmrBasis !== null
      ? String(params.dailyEmrBasis).trim()
      : '';
    var customSepVal = parseCleanNumber(params.customSeparationPay, 0);
    var hasCustomOverride = Boolean(params.customSeparationPay && customSepVal > 0);

    var requiresMonthlyBase = (
      cause === SEPARATION_CAUSES.REDUNDANCY ||
      cause === SEPARATION_CAUSES.LABOR_SAVING ||
      cause === SEPARATION_CAUSES.RETRENCHMENT ||
      cause === SEPARATION_CAUSES.CLOSURE_NO_LOSS ||
      cause === SEPARATION_CAUSES.DISEASE
    );

    var supportedEmrDivisors = [
      DIVISORS.STANDARD_5_DAY,
      DIVISORS.STANDARD_6_DAY,
      DIVISORS.EVERYDAY,
      DIVISORS.CUSTOM_HOSPITAL
    ];

    var mbs = 0;
    var rateBasis = 'none';
    var emrDivisor = 0;
    var missingBasis = false;

    if (hasCustomOverride) {
      rateBasis = 'custom_override';
    } else if (!isCustomDaily) {
      mbs = rawMbs;
      rateBasis = 'monthly_salary';
      missingBasis = requiresMonthlyBase && mbs <= 0;
    } else {
      // Custom Daily Rate enabled: never silently use monthlyBasicSalary unless explicitly selected
      if (rawEmrBasis === 'monthly_salary') {
        mbs = rawMbs;
        rateBasis = 'monthly_salary';
        missingBasis = requiresMonthlyBase && mbs <= 0;
      } else if (rawEmrBasis !== '') {
        var parsedEmrDiv = parseCleanNumber(rawEmrBasis, 0);
        if (supportedEmrDivisors.indexOf(parsedEmrDiv) !== -1 && dailyRate > 0) {
          emrDivisor = parsedEmrDiv;
          mbs = round2((dailyRate * emrDivisor) / 12);
          rateBasis = 'dole_emr';
        } else {
          mbs = 0;
          rateBasis = 'missing';
          missingBasis = requiresMonthlyBase;
        }
      } else {
        mbs = 0;
        rateBasis = 'missing';
        missingBasis = requiresMonthlyBase;
      }
    }

    var causeLabel = '';
    var multiplier = 0;
    var isTaxExempt = false;
    var legalBasis = '';
    var amount = 0;

    switch (cause) {
      case SEPARATION_CAUSES.REDUNDANCY:
        causeLabel = 'Redundancy';
        multiplier = 1.0;
        isTaxExempt = true;
        legalBasis = 'Labor Code Art. 298 (1 month pay per year of service, min 1 month)';
        amount = hasPositiveService && mbs > 0 ? Math.max(mbs, round2(mbs * creditedYears)) : 0;
        break;

      case SEPARATION_CAUSES.LABOR_SAVING:
        causeLabel = 'Installation of Labor-Saving Devices';
        multiplier = 1.0;
        isTaxExempt = true;
        legalBasis = 'Labor Code Art. 298 (1 month pay per year of service, min 1 month)';
        amount = hasPositiveService && mbs > 0 ? Math.max(mbs, round2(mbs * creditedYears)) : 0;
        break;

      case SEPARATION_CAUSES.RETRENCHMENT:
        causeLabel = 'Retrenchment to Prevent Losses';
        multiplier = 0.5;
        isTaxExempt = true;
        legalBasis = 'Labor Code Art. 298 (1/2 month pay per year of service, min 1 month)';
        amount = hasPositiveService && mbs > 0 ? Math.max(mbs, round2(0.5 * mbs * creditedYears)) : 0;
        break;

      case SEPARATION_CAUSES.CLOSURE_NO_LOSS:
        causeLabel = 'Closure / Cessation of Business (Not Due to Serious Losses)';
        multiplier = 0.5;
        isTaxExempt = true;
        legalBasis = 'Labor Code Art. 298 (1/2 month pay per year of service, min 1 month)';
        amount = hasPositiveService && mbs > 0 ? Math.max(mbs, round2(0.5 * mbs * creditedYears)) : 0;
        break;

      case SEPARATION_CAUSES.CLOSURE_LOSS:
        causeLabel = 'Closure Due to Serious Business Losses / Financial Reverses';
        multiplier = 0;
        isTaxExempt = true;
        legalBasis = 'Labor Code Art. 298 (Exempt from statutory separation pay due to severe losses)';
        amount = 0;
        break;

      case SEPARATION_CAUSES.DISEASE:
        causeLabel = 'Disease / Incurable Illness';
        multiplier = 0.5;
        isTaxExempt = true;
        legalBasis = 'Labor Code Art. 299 (1/2 month pay per year of service, min 1 month)';
        amount = hasPositiveService && mbs > 0 ? Math.max(mbs, round2(0.5 * mbs * creditedYears)) : 0;
        break;

      case SEPARATION_CAUSES.RESIGNATION:
        causeLabel = 'Voluntary Resignation';
        multiplier = 0;
        isTaxExempt = false;
        legalBasis = 'Labor Code Art. 300 (No statutory separation pay unless granted by CBA/Company Policy)';
        amount = 0;
        break;

      case SEPARATION_CAUSES.JUST_CAUSE:
        causeLabel = 'Dismissal for Just Cause';
        multiplier = 0;
        isTaxExempt = false;
        legalBasis = 'Labor Code Art. 297 (No separation pay for just cause dismissals)';
        amount = 0;
        break;

      case SEPARATION_CAUSES.CONTRACT_EXPIRY:
        causeLabel = 'Fixed-Term Contract Expiration';
        multiplier = 0;
        isTaxExempt = false;
        legalBasis = 'Civil Code & DOLE Guidelines (Natural expiration of agreed term)';
        amount = 0;
        break;

      case SEPARATION_CAUSES.OTHER:
      default:
        causeLabel = 'Other / Contractual Separation';
        multiplier = 0;
        isTaxExempt = false;
        legalBasis = 'Contractual Agreement / Company Policy';
        amount = 0;
        break;
    }

    // Support optional explicit custom separation pay (e.g. CBA terms)
    if (hasCustomOverride) {
      amount = round2(customSepVal);
      rateBasis = 'custom_override';
      missingBasis = false;
    }

    return {
      cause: cause,
      causeLabel: causeLabel,
      creditedYears: creditedYears,
      serviceYears: serviceYears,
      serviceMonths: serviceMonths,
      multiplier: multiplier,
      amount: amount,
      isTaxExempt: isTaxExempt,
      legalBasis: legalBasis,
      monthlyBaseUsed: mbs,
      rateBasis: rateBasis,
      emrDivisor: emrDivisor,
      missingBasis: missingBasis
    };
  }

  /**
   * D. Calculate Leave Monetization
   * Rules:
   * - Statutory SIL: Article 95 of Labor Code (5 days/year). Applies only to rank-and-file with >= 1 year service.
   *   Managerial employees are excluded by law.
   * - Outcome A (Default): If qualifying monetizable company vacation leave exists (>= 5 days), statutory SIL is absorbed.
   *   If unused company VL is < 5 days or monetizeVL === false, statutory SIL is NOT absorbed.
   *   Prevents double-counting statutory SIL and company vacation leave while protecting the 5-day statutory minimum.
   * - Additive option: Allows explicit CBA / contractual leave stacked on top of statutory SIL.
   * - Tax Rules:
   *   - Unified Private-Sector De Minimis Allocation: First 12 combined days of statutory SIL and company Vacation Leave
   *     are tax-exempt de minimis under the calculator's conservative tax assumption (RR 2-98 Sec. 2.78.1(A)(3)(a), as amended by RR 29-2025).
   *     (Legal Caveat: No explicit BIR issuance names SIL under the 12-day cap; conservative assumption prevents unauthorized stacking).
   *   - Combined Leave Excess (> 12 days): Subject to ₱90,000 aggregate bonus pool under Sec. 32(B)(7)(e).
   *   - Private Sector Company Sick Leave: Subject to ₱90,000 aggregate bonus pool.
   *
   * @param {Object} params
   * @param {number} params.dailyRate
   * @param {string} [params.leavePolicy='absorb_sil'] 'absorb_sil' (Outcome A) | 'additive_sil'
   * @param {boolean} [params.isManagerial=false]
   * @param {number} [params.yearsOfService=1]
   * @param {number} [params.annualCompanyVLDays=0] Annual paid company vacation leave entitlement (days/year) under company policy
   * @param {number} [params.unusedSILDays=0]
   * @param {number} [params.unusedVLDays=0]
   * @param {number} [params.unusedSLDays=0]
   * @param {boolean} [params.monetizeSIL=true]
   * @param {boolean} [params.monetizeVL=true]
   * @param {boolean} [params.monetizeSL=true]
   * @returns {Object}
   */
  function calculateLeaveMonetization(params) {
    params = params || {};
    var dailyRate = Math.max(0, parseCleanNumber(params.dailyRate, 0));
    var policy = params.leavePolicy === 'additive_sil' ? 'additive_sil' : 'absorb_sil';
    var isManagerial = Boolean(params.isManagerial);
    var yearsOfService = parseCleanNumber(params.yearsOfService, 1);
    var annualVL = Math.max(0, parseCleanNumber(params.annualCompanyVLDays, 0));

    var rawSIL = Math.max(0, parseCleanNumber(params.unusedSILDays, 0));
    var rawVL = Math.max(0, parseCleanNumber(params.unusedVLDays, 0));
    var rawSL = Math.max(0, parseCleanNumber(params.unusedSLDays, 0));

    var monetizeSIL = params.monetizeSIL !== false;
    var monetizeVL = params.monetizeVL !== false;
    var monetizeSL = params.monetizeSL !== false;

    // Company Vacation Leave eligible for monetization
    var vlDays = monetizeVL ? rawVL : 0;

    var silAbsorbed = false;
    var statutorySILDays = 0;

    // Check Art. 95 eligibility for statutory SIL
    var eligibleForSIL = !isManagerial && yearsOfService >= 1;

    if (eligibleForSIL) {
      if (policy === 'absorb_sil' && annualVL >= STATUTORY_CONSTANTS.STATUTORY_SIL_DAYS_CAP) {
        // Article 95(b): Employers granting at least 5 days of paid vacation leave annually are exempt from statutory SIL
        silAbsorbed = true;
        statutorySILDays = 0;
      } else {
        // Additive mode or employer provides < 5 days annual paid VL: grant unused statutory SIL up to 5 days
        statutorySILDays = Math.min(STATUTORY_CONSTANTS.STATUTORY_SIL_DAYS_CAP, rawSIL);
      }
    } else {
      // Ineligible under Art. 95 (managerial or < 1 year of service)
      statutorySILDays = 0;
    }

    // Gross Statutory SIL pay (if monetized)
    var effectiveSILDays = monetizeSIL ? statutorySILDays : 0;
    var statutorySILPay = round2(effectiveSILDays * dailyRate);

    // Unified Vacation Leave & Statutory SIL De Minimis Allocation:
    // Combined ceiling of 12 days under conservative tax assumption based on RR 2-98 as amended by RR 29-2025.
    // Statutory SIL is treated as statutory baseline vacation leave, sharing one combined 12-day de minimis ceiling with company VL.
    var totalMonetizedLeaveDays = round2(effectiveSILDays + vlDays);
    var deMinimisLeaveDays = Math.min(STATUTORY_CONSTANTS.DE_MINIMIS_VL_DAYS_CAP, totalMonetizedLeaveDays);
    var excessLeaveDays = Math.max(0, round2(totalMonetizedLeaveDays - STATUTORY_CONSTANTS.DE_MINIMIS_VL_DAYS_CAP));

    var deMinimisLeavePay = round2(deMinimisLeaveDays * dailyRate);
    var excessLeavePay = round2(excessLeaveDays * dailyRate);

    // Itemized breakdown and backward-compatible properties for UI display
    // Statutory SIL fits within the 12-day cap (since max statutory SIL is 5 days <= 12 days).
    // Any remaining de minimis headroom is allocated to company VL.
    var deMinimisVLDays = Math.max(0, round2(deMinimisLeaveDays - effectiveSILDays));
    var excessVLDays = Math.max(0, round2(vlDays - deMinimisVLDays));
    var deMinimisVLPay = round2(deMinimisVLDays * dailyRate);
    var excessVLPay = round2(excessVLDays * dailyRate);

    // Company Sick Leave (Private sector: not de minimis; enters ₱90k pool)
    var slDays = monetizeSL ? rawSL : 0;
    var companySLPay = round2(slDays * dailyRate);

    var totalLeavePay = round2(statutorySILPay + deMinimisVLPay + excessVLPay + companySLPay);

    return {
      leavePolicy: policy,
      isManagerial: isManagerial,
      eligibleForSIL: eligibleForSIL,
      silAbsorbed: silAbsorbed,
      // Unified allocation properties
      totalMonetizedLeaveDays: totalMonetizedLeaveDays,
      deMinimisLeaveDays: deMinimisLeaveDays,
      excessLeaveDays: excessLeaveDays,
      deMinimisLeavePay: deMinimisLeavePay,
      excessLeavePay: excessLeavePay,
      // Itemized breakdown & backward-compatible properties
      statutorySILDays: statutorySILDays,
      statutorySILPay: statutorySILPay,
      deMinimisVLDays: deMinimisVLDays,
      deMinimisVLPay: deMinimisVLPay,
      excessVLDays: excessVLDays,
      excessVLPay: excessVLPay,
      companySLDays: slDays,
      companySLPay: companySLPay,
      totalLeavePay: totalLeavePay
    };
  }

  /**
   * Classify Employer Coverage under RA 7641 Statutory Retirement Mandate
   *
   * @param {string} [employerCategory='private_general']
   * @returns {{ status: string, isCovered: boolean, label: string, legalBasis: string }}
   */
  function classifyRetirementEmployerCoverage(employerCategory) {
    var cat = employerCategory ? String(employerCategory).trim() : 'private_general';

    if (cat === 'gov_agency') {
      return {
        status: RETIREMENT_EMPLOYER_COVERAGE.EXEMPT,
        isCovered: false,
        label: 'Government Agency / Chartered GOCC (Civil Service / GSIS)',
        legalBasis: 'Labor Code Art. 291: Chartered government entities are governed by the Civil Service Law and GSIS.'
      };
    }

    if (cat === 'private_retail_le10') {
      return {
        status: RETIREMENT_EMPLOYER_COVERAGE.EXEMPT,
        isCovered: false,
        label: 'Retail Establishment (<= 10 Employees)',
        legalBasis: 'Labor Code Art. 302, 1st para; RA 7641 Sec. 1: Retail establishments regularly employing not more than 10 workers are statutorily exempt.'
      };
    }

    if (cat === 'private_service_le10') {
      return {
        status: RETIREMENT_EMPLOYER_COVERAGE.EXEMPT,
        isCovered: false,
        label: 'Service Establishment (<= 10 Employees)',
        legalBasis: 'Labor Code Art. 302, 1st para; RA 7641 Sec. 1: Service establishments regularly employing not more than 10 workers are statutorily exempt.'
      };
    }

    if (cat === 'private_agri_le10') {
      return {
        status: RETIREMENT_EMPLOYER_COVERAGE.EXEMPT,
        isCovered: false,
        label: 'Agricultural Establishment (<= 10 Employees)',
        legalBasis: 'Labor Code Art. 302, 1st para; RA 7641 Sec. 1: Agricultural establishments regularly employing not more than 10 workers are statutorily exempt.'
      };
    }

    if (cat === 'gov_nonchartered') {
      return {
        status: RETIREMENT_EMPLOYER_COVERAGE.COVERED,
        isCovered: true,
        label: 'Non-Chartered GOCC (Organized under Corporation Code)',
        legalBasis: 'Juco v. NLRC (G.R. No. 98107): Non-chartered GOCCs organized under the Corporation Code are governed by the Labor Code.'
      };
    }

    if (cat === 'private_general') {
      return {
        status: RETIREMENT_EMPLOYER_COVERAGE.COVERED,
        isCovered: true,
        label: 'Private-Sector Employer (Covered by RA 7641)',
        legalBasis: 'Labor Code Art. 302, as amended by RA 7641.'
      };
    }

    return {
      status: RETIREMENT_EMPLOYER_COVERAGE.UNKNOWN,
      isCovered: false,
      label: 'Unknown / Unverified Employer Coverage',
      legalBasis: 'Employer category not verified; statutory coverage requires legal/payroll determination.'
    };
  }

  /**
   * Component Evaluator 1: Statutory RA 7641 Floor
   * Evaluates the statutory retirement benchmark independently from company plan TQP status.
   *
   * @param {Object} params
   * @param {number} params.amount
   * @param {boolean} params.isStatutorilyEligible
   * @param {string} params.taxAvailment 'first_time' | 'repeat' | 'unknown'
   * @param {number} params.age
   * @param {string} params.post65Consent 'yes' | 'no' | 'unknown' | 'not_applicable'
   * @returns {{ amount: number, taxStatus: string, legalAuthority: string, notes: string }}
   */
  function evaluateStatutoryFloorComponent(params) {
    params = params || {};
    var amount = Math.max(0, parseCleanNumber(params.amount, 0));
    var isEligible = Boolean(params.isStatutorilyEligible);
    var isCoveragePending = Boolean(params.isCoveragePending);
    var availment = params.taxAvailment || 'first_time';
    var age = parseCleanNumber(params.age, 60);
    var consent = params.post65Consent || 'not_applicable';

    if (amount <= 0 || (!isEligible && !isCoveragePending)) {
      return {
        amount: 0,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.NOT_APPLICABLE,
        taxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE,
        legalAuthority: 'Labor Code Art. 302',
        notes: 'Not applicable: No statutory retirement entitlement exists.'
      };
    }

    if (isCoveragePending) {
      return {
        amount: amount,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.PROVISIONAL_ENTITLEMENT,
        taxStatus: RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL,
        legalAuthority: 'Labor Code Art. 302 (Pending Employer Coverage Determination)',
        notes: 'EMPLOYER_COVERAGE_PENDING_VERIFICATION: Potential statutory retirement floor calculated based on age and service; employer coverage under RA 7641 must be verified before confirming entitlement or tax exemption.'
      };
    }

    if (availment === 'repeat') {
      return {
        amount: amount,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE,
        taxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAXABLE,
        legalAuthority: 'NIRC Sec. 32(B)(6)(a)',
        notes: 'Repeat claimant: Tax exemption privilege under Section 32(B)(6)(a) may be availed of only once.'
      };
    }

    if (availment === 'unknown') {
      return {
        amount: amount,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE,
        taxStatus: RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL,
        legalAuthority: 'NIRC Sec. 32(B)(6)(a)',
        notes: 'Provisional Tax Classification: Statutory retirement entitlement is confirmed payable; prior tax exemption availment history is unconfirmed. Documentation required for tax exemption.'
      };
    }

    // first_time
    if (age <= RETIREMENT_CONSTANTS.STATUTORY_COMPULSORY_AGE) {
      return {
        amount: amount,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE,
        taxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT,
        legalAuthority: 'Labor Code Art. 302; NIRC Sec. 32(B)(6)(a); BIR RMC 13-2024 Q&A 10',
        notes: '100% Tax-Exempt: Statutory retirement pay under RA 7641.'
      };
    }

    // Age > 65
    if (consent === 'yes') {
      return {
        amount: amount,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE,
        taxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT,
        legalAuthority: 'BIR RMC 13-2024 Q&A 11',
        notes: '100% Tax-Exempt: Continued employment beyond age 65 with express/implied employer consent.'
      };
    }

    if (consent === 'no') {
      return {
        amount: amount,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE,
        taxStatus: RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL,
        legalAuthority: 'BIR RMC 13-2024 Q&A 11; NIRC Sec. 79',
        notes: 'Provisional Tax Classification: Statutory retirement entitlement is confirmed payable; continued employment beyond age 65 without express employer consent is subject to BIR withholding/tax determination.'
      };
    }

    return {
      amount: amount,
      entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE,
      taxStatus: RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL,
      legalAuthority: 'BIR RMC 13-2024 Q&A 11',
      notes: 'Provisional Tax Classification: Statutory retirement entitlement is confirmed payable; employer consent status beyond age 65 is unconfirmed.'
    };
  }

  /**
   * Component Evaluator 2: Statutory Top-Up
   * Follows statutory tax criteria (guaranteed statutory top-up under Art. 302).
   */
  function evaluateStatutoryTopUpComponent(params) {
    params = params || {};
    var topUpAmount = Math.max(0, parseCleanNumber(params.topUpAmount, 0));
    if (topUpAmount <= 0) {
      return {
        amount: 0,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.NOT_APPLICABLE,
        taxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE,
        legalAuthority: 'Labor Code Art. 302; RA 7641 Sec. 1',
        notes: 'Not applicable: Company plan satisfies or exceeds statutory floor.'
      };
    }
    var statEval = evaluateStatutoryFloorComponent({
      amount: topUpAmount,
      isStatutorilyEligible: params.isStatutorilyEligible,
      isCoveragePending: params.isCoveragePending,
      taxAvailment: params.taxAvailment,
      age: params.age,
      post65Consent: params.post65Consent
    });
    statEval.legalAuthority = 'Labor Code Art. 302; RA 7641 Sec. 1';
    statEval.notes = 'Statutory Top-Up: ' + statEval.notes;
    return statEval;
  }

  /**
   * Component Evaluator 3: Qualified Private Plan (RA 4917; NIRC Sec. 32(B)(6)(a))
   * Evaluates whether a private plan benefit satisfies all 4 TQP evidentiary pillars and age/service thresholds.
   * Keeps benefit entitlement uncertainty (unknown employee coverage under the plan) strictly separate from tax-qualification uncertainty.
   */
  function evaluateQualifiedPrivatePlanComponent(params) {
    params = params || {};
    var amount = Math.max(0, parseCleanNumber(params.amount, 0));
    if (amount <= 0) {
      return {
        amount: 0,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.NOT_APPLICABLE,
        taxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE,
        legalAuthority: 'RA 4917; NIRC Sec. 32(B)(6)(a)',
        notes: 'Not applicable: No private plan amount.'
      };
    }

    var hasBirTqp = params.hasBirTqpApproval || 'unknown';
    var isIdentityMatch = params.isPlanIdentityMatched || 'yes';
    var isCovered = params.isEmployeeCoveredByPlan || 'yes';
    var isTrustPaid = params.isPaidUnderTrust || 'yes';
    var age = parseCleanNumber(params.age, 0);
    var actualServiceYears = parseCleanNumber(params.actualServiceYears, 0);
    var availment = params.taxAvailment || 'first_time';

    // If employee coverage under the private plan is explicitly 'unknown', benefit entitlement itself is uncertain
    if (isCovered === 'unknown') {
      return {
        amount: amount,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.PROVISIONAL_ENTITLEMENT,
        taxStatus: RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL,
        legalAuthority: 'RA 4917; NIRC Sec. 32(B)(6)(a)',
        notes: 'Provisional Entitlement: Employee coverage/membership under the private retirement plan is unconfirmed.'
      };
    }

    // If any TQP pillar is explicitly 'no', the plan benefit is non-qualified for tax exemption (Confirmed Payable, Taxable)
    if (hasBirTqp === 'no' || isIdentityMatch === 'no' || isCovered === 'no' || isTrustPaid === 'no') {
      return {
        amount: amount,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE,
        taxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAXABLE,
        legalAuthority: 'NIRC Sec. 32(A)',
        notes: 'Taxable: Private plan is non-qualified or payout does not qualify under a BIR-approved trust plan.'
      };
    }

    // Check statutory RA 4917 age/service requirements (Age >= 50, Service >= 10 in same firm) and repeat availment
    var meetsAge = age >= RETIREMENT_CONSTANTS.PRIVATE_PLAN_MIN_AGE;
    var meetsService = actualServiceYears >= RETIREMENT_CONSTANTS.PRIVATE_PLAN_MIN_SERVICE_YEARS;

    if (!meetsAge || !meetsService) {
      return {
        amount: amount,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE,
        taxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAXABLE,
        legalAuthority: 'RA 4917; NIRC Sec. 32(B)(6)(a)',
        notes: 'Taxable: Fails statutory RA 4917 criteria (requires Age >= 50 and Service >= 10 years in the same firm). Actual: Age ' + age + ', Service ' + actualServiceYears.toFixed(1) + ' yrs.'
      };
    }

    if (availment === 'repeat') {
      return {
        amount: amount,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE,
        taxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAXABLE,
        legalAuthority: 'NIRC Sec. 32(B)(6)(a)',
        notes: 'Taxable: Repeat claimant. Tax exemption under Section 32(B)(6)(a) is strictly once-in-a-lifetime.'
      };
    }

    // Employee coverage is confirmed ('yes'), but BIR TQP certificate, plan identity, trust payment, or prior tax availment is 'unknown'
    if (hasBirTqp === 'unknown' || isIdentityMatch === 'unknown' || isTrustPaid === 'unknown' || availment === 'unknown') {
      return {
        amount: amount,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE,
        taxStatus: RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL,
        legalAuthority: 'RA 4917; NIRC Sec. 32(B)(6)(a)',
        notes: 'Provisional Tax Classification: Contractual benefit entitlement is confirmed payable, but BIR TQP approval, trust documentation, or prior tax exemption history is unconfirmed.'
      };
    }

    return {
      amount: amount,
      entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE,
      taxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT,
      legalAuthority: 'RA 4917; NIRC Sec. 32(B)(6)(a)',
      notes: '100% Tax-Exempt: Qualified private retirement plan meeting all RA 4917 requirements.'
    };
  }

  /**
   * Component Evaluator 4: Contractual / Voluntary Early Retirement Benefit
   */
  function evaluateContractualEarlyRetirementComponent(amount) {
    var amt = Math.max(0, parseCleanNumber(amount, 0));
    if (amt <= 0) {
      return {
        amount: 0,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.NOT_APPLICABLE,
        taxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE,
        legalAuthority: 'N/A',
        notes: 'Not applicable: No contractual early retirement amount.'
      };
    }
    return {
      amount: amt,
      entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE,
      taxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAXABLE,
      legalAuthority: 'NIRC Sec. 32(A)',
      notes: 'Taxable: Contractual early retirement benefit subject to regular graduated income tax.'
    };
  }

  /**
   * Component Evaluator 5: Company-Plan Excess Above Statutory Floor
   */
  function evaluateCompanyPlanExcessComponent(params) {
    params = params || {};
    var excessAmount = Math.max(0, parseCleanNumber(params.excessAmount, 0));
    if (excessAmount <= 0) {
      return {
        amount: 0,
        entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.NOT_APPLICABLE,
        taxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE,
        legalAuthority: 'N/A',
        notes: 'Not applicable: Company plan does not exceed statutory floor.'
      };
    }

    // Excess is not mandated by statute; it can ONLY be tax-exempt if private plan satisfies RA 4917
    var tqpEval = evaluateQualifiedPrivatePlanComponent({
      amount: excessAmount,
      hasBirTqpApproval: params.hasBirTqpApproval,
      isPlanIdentityMatched: params.isPlanIdentityMatched,
      isEmployeeCoveredByPlan: params.isEmployeeCoveredByPlan,
      isPaidUnderTrust: params.isPaidUnderTrust,
      age: params.age,
      actualServiceYears: params.actualServiceYears,
      taxAvailment: params.taxAvailment
    });

    tqpEval.notes = 'Company Plan Excess: ' + tqpEval.notes;
    return tqpEval;
  }

  /**
   * Master Retirement Calculation Engine (RA 7641 & RA 4917)
   *
   * @param {Object} params
   * @returns {Object} Structured retirement calculation result
   */
  function calculateRetirementPay(params) {
    params = params || {};
    var planType = params.planType === 'company_plan' ? 'company_plan' : 'statutory_only';
    var employerCategory = params.employerCategory || 'private_general';
    var age = Math.max(0, parseCleanNumber(params.age, 60));
    var serviceYears = Math.max(0, parseInt(params.serviceYears, 10) || 0);
    var serviceMonths = Math.max(0, parseInt(params.serviceMonths, 10) || 0);
    var monthlyBasicSalary = Math.max(0, parseCleanNumber(params.monthlyBasicSalary, 0));
    var divisor = parseCleanNumber(params.divisor, DIVISORS.STANDARD_5_DAY);
    if (!divisor || divisor <= 0) divisor = DIVISORS.STANDARD_5_DAY;

    var dailyRate = params.dailyRate !== undefined && parseCleanNumber(params.dailyRate, 0) > 0
      ? parseCleanNumber(params.dailyRate, 0)
      : (monthlyBasicSalary * 12) / divisor;

    var post65Consent = params.post65Consent || 'not_applicable';
    if (age <= RETIREMENT_CONSTANTS.STATUTORY_COMPULSORY_AGE) {
      post65Consent = 'not_applicable';
    }

    var taxAvailment = params.taxAvailment || 'first_time';
    var hasBirTqpApproval = params.hasBirTqpApproval || 'unknown';
    var isPlanIdentityMatched = params.isPlanIdentityMatched || 'yes';
    var isEmployeeCoveredByPlan = params.isEmployeeCoveredByPlan || 'yes';
    var isPaidUnderTrust = params.isPaidUnderTrust || 'yes';
    var companyPlanGross = Math.max(0, parseCleanNumber(params.companyPlanGrossAmount, 0));

    var actualServiceYears = serviceYears + (serviceMonths / 12);
    var creditedYears = calculateCreditedYears(serviceYears, serviceMonths);

    // 1. Employer Coverage
    var coverage = classifyRetirementEmployerCoverage(employerCategory);
    var isCoveredEmployer = coverage.status === RETIREMENT_EMPLOYER_COVERAGE.COVERED;
    var isUnknownCoverage = coverage.status === RETIREMENT_EMPLOYER_COVERAGE.UNKNOWN;

    // 2. Statutory Eligibility
    var meetsStatutoryAge = age >= RETIREMENT_CONSTANTS.STATUTORY_OPTIONAL_AGE;
    var meetsStatutoryService = actualServiceYears >= RETIREMENT_CONSTANTS.STATUTORY_MIN_SERVICE_YEARS;
    var roundingSensitivityFlag = actualServiceYears >= 4.5 && actualServiceYears < 5.0;
    var isStatutorilyEligible = isCoveredEmployer && meetsStatutoryAge && meetsStatutoryService;
    var isCoveragePending = isUnknownCoverage && meetsStatutoryAge && meetsStatutoryService;

    // 3. Statutory Floor Benchmark (Double-precision calculation)
    var statutoryDailyFactor = RETIREMENT_CONSTANTS.STATUTORY_RETIREMENT_DAYS_FACTOR; // 22.5
    var statutoryFloorBenchmark = (isCoveredEmployer || isUnknownCoverage) && (meetsStatutoryService || roundingSensitivityFlag)
      ? round2(dailyRate * statutoryDailyFactor * creditedYears)
      : ((isCoveredEmployer || isUnknownCoverage) ? round2(dailyRate * statutoryDailyFactor * creditedYears) : 0);

    // If actual service is under 5 years baseline, benchmark exists for comparison, but statutory floor entitlement is 0
    var effectiveStatutoryFloor = (isStatutorilyEligible || isCoveragePending) ? statutoryFloorBenchmark : 0;

    // 4. Actual Disbursement Component Calculations (Zero Double-Counting)
    var planBaseAmount = 0;
    var topUpAmount = 0;
    var excessAmount = 0;

    if (planType === 'company_plan') {
      if (isStatutorilyEligible || isCoveragePending) {
        if (companyPlanGross < effectiveStatutoryFloor) {
          planBaseAmount = companyPlanGross;
          topUpAmount = round2(effectiveStatutoryFloor - companyPlanGross);
          excessAmount = 0;
        } else {
          planBaseAmount = effectiveStatutoryFloor;
          topUpAmount = 0;
          excessAmount = round2(companyPlanGross - effectiveStatutoryFloor);
        }
      } else {
        planBaseAmount = companyPlanGross;
        topUpAmount = 0;
        excessAmount = 0;
      }
    } else {
      // statutory_only
      if (isStatutorilyEligible || isCoveragePending) {
        planBaseAmount = effectiveStatutoryFloor;
        topUpAmount = 0;
        excessAmount = 0;
      } else {
        planBaseAmount = 0;
        topUpAmount = 0;
        excessAmount = 0;
      }
    }

    var totalGrossRetirementPayable = round2(planBaseAmount + topUpAmount + excessAmount);

    // 5. Evaluate Components Entitlement & Tax Status Independently
    // Statutory Floor Benchmark Evaluator (Informational)
    var statutoryFloorComponent = evaluateStatutoryFloorComponent({
      amount: effectiveStatutoryFloor,
      isStatutorilyEligible: isStatutorilyEligible,
      isCoveragePending: isCoveragePending,
      taxAvailment: taxAvailment,
      age: age,
      post65Consent: post65Consent
    });
    statutoryFloorComponent.isBenchmarkOnly = true;

    // Statutory Top-Up Component (Actual Disbursement)
    var statutoryTopUpComponent = evaluateStatutoryTopUpComponent({
      topUpAmount: topUpAmount,
      isStatutorilyEligible: isStatutorilyEligible,
      isCoveragePending: isCoveragePending,
      taxAvailment: taxAvailment,
      age: age,
      post65Consent: post65Consent
    });
    statutoryTopUpComponent.isActualDisbursement = true;

    // Company Plan Base Component (Actual Disbursement)
    var companyPlanBaseComponent;
    if (isStatutorilyEligible || isCoveragePending) {
      // If statutorily eligible or coverage pending verification, evaluate under statutory rules
      companyPlanBaseComponent = evaluateStatutoryFloorComponent({
        amount: planBaseAmount,
        isStatutorilyEligible: isStatutorilyEligible,
        isCoveragePending: isCoveragePending,
        taxAvailment: taxAvailment,
        age: age,
        post65Consent: post65Consent
      });
      if (isStatutorilyEligible) {
        companyPlanBaseComponent.notes = 'Protected Statutory Base: ' + companyPlanBaseComponent.notes;
      }
    } else {
      // If not statutorily eligible, evaluate under private plan rules
      companyPlanBaseComponent = evaluateQualifiedPrivatePlanComponent({
        amount: planBaseAmount,
        hasBirTqpApproval: hasBirTqpApproval,
        isPlanIdentityMatched: isPlanIdentityMatched,
        isEmployeeCoveredByPlan: isEmployeeCoveredByPlan,
        isPaidUnderTrust: isPaidUnderTrust,
        age: age,
        actualServiceYears: actualServiceYears,
        taxAvailment: taxAvailment
      });
    }
    companyPlanBaseComponent.isActualDisbursement = true;

    // Company Plan Excess Component (Actual Disbursement)
    var companyPlanExcessComponent = evaluateCompanyPlanExcessComponent({
      excessAmount: excessAmount,
      hasBirTqpApproval: hasBirTqpApproval,
      isPlanIdentityMatched: isPlanIdentityMatched,
      isEmployeeCoveredByPlan: isEmployeeCoveredByPlan,
      isPaidUnderTrust: isPaidUnderTrust,
      age: age,
      actualServiceYears: actualServiceYears,
      taxAvailment: taxAvailment
    });
    companyPlanExcessComponent.isActualDisbursement = true;

    // Wrapper: Qualified Private Plan vs Contractual Early Retirement
    var qualifiedPrivatePlanComponent = {
      amount: 0,
      entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.NOT_APPLICABLE,
      taxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE
    };
    var contractualEarlyRetirementComponent = {
      amount: 0,
      entitlementStatus: RETIREMENT_ENTITLEMENT_STATUS.NOT_APPLICABLE,
      taxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE
    };

    if (planType === 'company_plan' && companyPlanGross > 0) {
      if (!isStatutorilyEligible && !isCoveragePending) {
        if (companyPlanBaseComponent.taxStatus === RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT) {
          qualifiedPrivatePlanComponent = companyPlanBaseComponent;
        } else {
          contractualEarlyRetirementComponent = companyPlanBaseComponent;
        }
      } else {
        if (companyPlanExcessComponent.amount > 0) {
          if (companyPlanExcessComponent.taxStatus === RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT) {
            qualifiedPrivatePlanComponent = companyPlanExcessComponent;
          } else {
            contractualEarlyRetirementComponent = companyPlanExcessComponent;
          }
        }
      }
    }

    // 6. Aggregate Entitlement & Tax Ledgers Independently (Zero Double-Counting)
    // Confirmed payable benefits remain in confirmedRetirementGrossPayable even when taxStatus is UNCONFIRMED_PROVISIONAL.
    // Only PROVISIONAL_ENTITLEMENT amounts are excluded from confirmedRetirementGrossPayable.
    var actualDisbursements = [companyPlanBaseComponent, statutoryTopUpComponent, companyPlanExcessComponent];
    var confirmedTaxExemptTotal = 0;
    var confirmedTaxableTotal = 0;
    var provisionalTaxClassificationTotal = 0;
    var provisionalEntitlementTotal = 0;

    for (var d = 0; d < actualDisbursements.length; d++) {
      var item = actualDisbursements[d];
      if (item.amount > 0) {
        if (item.entitlementStatus === RETIREMENT_ENTITLEMENT_STATUS.PROVISIONAL_ENTITLEMENT) {
          provisionalEntitlementTotal = round2(provisionalEntitlementTotal + item.amount);
        } else {
          // RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE
          if (item.taxStatus === RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT) {
            confirmedTaxExemptTotal = round2(confirmedTaxExemptTotal + item.amount);
          } else if (item.taxStatus === RETIREMENT_TAX_STATUS.CONFIRMED_TAXABLE) {
            confirmedTaxableTotal = round2(confirmedTaxableTotal + item.amount);
          } else if (item.taxStatus === RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL) {
            provisionalTaxClassificationTotal = round2(provisionalTaxClassificationTotal + item.amount);
          }
        }
      }
    }

    var confirmedRetirementGrossPayable = round2(
      confirmedTaxExemptTotal + confirmedTaxableTotal + provisionalTaxClassificationTotal
    );
    var provisionalRetirementGrossAmount = provisionalEntitlementTotal;
    var unconfirmedProvisionalTotal = round2(provisionalTaxClassificationTotal + provisionalEntitlementTotal);

    var entitlementStatus = RETIREMENT_ENTITLEMENT_STATUS.NOT_APPLICABLE;
    if (totalGrossRetirementPayable > 0) {
      if (confirmedRetirementGrossPayable > 0 && provisionalEntitlementTotal === 0) {
        entitlementStatus = RETIREMENT_ENTITLEMENT_STATUS.CONFIRMED_PAYABLE;
      } else if (provisionalEntitlementTotal > 0 && confirmedRetirementGrossPayable === 0) {
        entitlementStatus = RETIREMENT_ENTITLEMENT_STATUS.PROVISIONAL_ENTITLEMENT;
      } else {
        entitlementStatus = 'PARTIALLY_CONFIRMED_PARTIALLY_PROVISIONAL';
      }
    }

    var overallTaxStatus = RETIREMENT_TAX_STATUS.NOT_APPLICABLE;
    if (totalGrossRetirementPayable > 0) {
      if (unconfirmedProvisionalTotal > 0) {
        overallTaxStatus = RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL;
      } else if (confirmedTaxExemptTotal > 0 && confirmedTaxableTotal === 0) {
        overallTaxStatus = RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT;
      } else if (confirmedTaxableTotal > 0 && confirmedTaxExemptTotal === 0) {
        overallTaxStatus = RETIREMENT_TAX_STATUS.CONFIRMED_TAXABLE;
      } else {
        overallTaxStatus = 'PARTIALLY_EXEMPT_PARTIALLY_TAXABLE';
      }
    }

    return {
      planType: planType,
      employerCoverage: coverage,
      age: age,
      serviceYears: serviceYears,
      serviceMonths: serviceMonths,
      actualServiceYears: actualServiceYears,
      creditedYears: creditedYears,
      monthlyBasicSalary: monthlyBasicSalary,
      dailyRate: round2(dailyRate),
      divisor: divisor,
      post65Consent: post65Consent,
      taxAvailment: taxAvailment,

      // Eligibility & Entitlement Status
      isStatutorilyEligible: isStatutorilyEligible,
      isCoveragePending: isCoveragePending,
      entitlementStatus: entitlementStatus,
      eligibilityStatus: isStatutorilyEligible
        ? 'ELIGIBLE_STATUTORY'
        : (isCoveragePending
          ? 'PENDING_EMPLOYER_VERIFICATION'
          : (coverage.status === RETIREMENT_EMPLOYER_COVERAGE.EXEMPT ? 'EXEMPT_EMPLOYER' : 'INELIGIBLE_STATUTORY')),
      meetsStatutoryAge: meetsStatutoryAge,
      meetsStatutoryService: meetsStatutoryService,
      roundingSensitivityFlag: roundingSensitivityFlag,

      // Five Required Components
      statutoryFloor: statutoryFloorComponent,
      statutoryTopUp: statutoryTopUpComponent,
      companyPlanBase: companyPlanBaseComponent,
      companyPlanExcess: companyPlanExcessComponent,
      qualifiedPrivatePlan: qualifiedPrivatePlanComponent,
      contractualEarlyRetirement: contractualEarlyRetirementComponent,

      // Master Payable & Provisional Amounts (Entitlement vs Tax Uncertainty Separated)
      confirmedBenefitEntitlement: confirmedRetirementGrossPayable,
      confirmedRetirementGrossPayable: confirmedRetirementGrossPayable,
      provisionalEntitlementAmount: provisionalEntitlementTotal,
      provisionalRetirementGrossAmount: provisionalRetirementGrossAmount,
      provisionalTaxClassificationAmount: provisionalTaxClassificationTotal,
      totalGrossRetirementPayable: totalGrossRetirementPayable,

      // Tax Reconciliation
      taxReconciliation: {
        confirmedTaxExemptTotal: confirmedTaxExemptTotal,
        confirmedTaxableTotal: confirmedTaxableTotal,
        provisionalTaxClassificationTotal: provisionalTaxClassificationTotal,
        provisionalEntitlementTotal: provisionalEntitlementTotal,
        unconfirmedProvisionalTotal: unconfirmedProvisionalTotal,
        overallTaxStatus: overallTaxStatus
      }
    };
  }

  /**
   * Coexistence Evaluator: Separation Pay & Retirement Pay
   */
  function calculateRetirementCoexistence(params) {
    params = params || {};
    var separation = params.separationResult || { amount: 0, isTaxExempt: false };
    var retirement = params.retirementResult || { totalGrossRetirementPayable: 0, taxReconciliation: {} };
    var mode = params.coexistenceMode || RETIREMENT_COEXISTENCE_MODES.BOTH_PAYABLE;

    var sepGross = Math.max(0, parseCleanNumber(separation.amount, 0));
    var retGross = Math.max(0, parseCleanNumber(retirement.totalGrossRetirementPayable, 0));
    var retTaxRec = retirement.taxReconciliation || {};

    var confirmedExempt = retTaxRec.confirmedTaxExemptTotal || 0;
    var confirmedTaxable = retTaxRec.confirmedTaxableTotal || 0;
    var provisionalTax = retTaxRec.provisionalTaxClassificationTotal !== undefined
      ? retTaxRec.provisionalTaxClassificationTotal
      : (retirement.provisionalTaxClassificationAmount || 0);
    var provisionalEntitlement = retirement.provisionalEntitlementAmount !== undefined
      ? retirement.provisionalEntitlementAmount
      : (retirement.provisionalRetirementGrossAmount !== undefined
        ? retirement.provisionalRetirementGrossAmount
        : Math.max(0, round2((retTaxRec.unconfirmedProvisionalTotal || 0) - provisionalTax)));
    var confirmedRetGross = retirement.confirmedRetirementGrossPayable !== undefined
      ? retirement.confirmedRetirementGrossPayable
      : round2(confirmedExempt + confirmedTaxable + provisionalTax);

    var separationGrossDisbursed = 0;
    var retirementGrossDisbursed = 0;
    var confirmedRetirementGrossPayable = 0;
    var provisionalRetirementGrossAmount = 0;
    var provisionalTaxClassificationAmount = 0;
    var confirmedCombinedGross = 0;
    var totalCombinedGross = 0;
    var offsetDeduction = 0;
    var offsetTaxStatus = RETIREMENT_TAX_STATUS.NOT_APPLICABLE;
    var offsetTaxNote = '';
    var confirmedTaxExemptRetirement = 0;
    var confirmedTaxableRetirement = 0;
    var unconfirmedProvisionalRetirement = 0;

    var provisionalOffsetDifference = 0;
    var unverifiedPlanProvisionalAmount = provisionalEntitlement;

    if (mode === RETIREMENT_COEXISTENCE_MODES.BOTH_PAYABLE) {
      separationGrossDisbursed = sepGross;
      retirementGrossDisbursed = confirmedRetGross;
      totalCombinedGross = round2(sepGross + retGross);
      confirmedTaxExemptRetirement = confirmedExempt;
      confirmedTaxableRetirement = confirmedTaxable;
      provisionalTaxClassificationAmount = provisionalTax;
      unconfirmedProvisionalRetirement = round2(provisionalTax + provisionalEntitlement);
      confirmedRetirementGrossPayable = confirmedRetGross;
      provisionalRetirementGrossAmount = provisionalEntitlement;
      confirmedCombinedGross = round2(sepGross + confirmedRetirementGrossPayable);
    } else if (mode === RETIREMENT_COEXISTENCE_MODES.HIGHER_OF) {
      // Compare confirmed separation pay against confirmed retirement payable only.
      // Provisional retirement entitlement must never win the confirmed higher_of comparison or extinguish confirmed separation pay.
      if (confirmedRetGross >= sepGross && (confirmedRetGross > 0 || sepGross === 0)) {
        separationGrossDisbursed = 0;
        retirementGrossDisbursed = confirmedRetGross;
        totalCombinedGross = retGross;
        confirmedTaxExemptRetirement = confirmedExempt;
        confirmedTaxableRetirement = confirmedTaxable;
        provisionalTaxClassificationAmount = provisionalTax;
        unconfirmedProvisionalRetirement = round2(provisionalTax + provisionalEntitlement);
        confirmedRetirementGrossPayable = confirmedRetGross;
        provisionalRetirementGrossAmount = provisionalEntitlement;
        confirmedCombinedGross = confirmedRetGross;
      } else {
        separationGrossDisbursed = sepGross;
        retirementGrossDisbursed = 0;
        totalCombinedGross = round2(sepGross + provisionalEntitlement);
        confirmedTaxExemptRetirement = 0;
        confirmedTaxableRetirement = 0;
        provisionalTaxClassificationAmount = 0;
        unconfirmedProvisionalRetirement = provisionalEntitlement;
        confirmedRetirementGrossPayable = 0;
        provisionalRetirementGrossAmount = provisionalEntitlement;
        confirmedCombinedGross = sepGross;
      }
    } else if (mode === RETIREMENT_COEXISTENCE_MODES.OFFSET) {
      var isPendingEmployerVerification = retirement.eligibilityStatus === 'PENDING_EMPLOYER_VERIFICATION' || Boolean(retirement.isCoveragePending);
      if (isPendingEmployerVerification || confirmedRetGross === 0) {
        // Do not calculate a confirmed offset or provisional net difference against an unverified retirement entitlement.
        separationGrossDisbursed = sepGross;
        offsetDeduction = 0;
        retirementGrossDisbursed = 0;
        confirmedRetirementGrossPayable = 0;
        provisionalOffsetDifference = 0;
        provisionalTaxClassificationAmount = 0;
        unconfirmedProvisionalRetirement = provisionalEntitlement;
        provisionalRetirementGrossAmount = provisionalEntitlement;
        confirmedCombinedGross = sepGross;
        totalCombinedGross = round2(sepGross + provisionalEntitlement);
        if (provisionalEntitlement > 0) {
          offsetTaxStatus = RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL;
          offsetTaxNote = isPendingEmployerVerification
            ? 'EMPLOYER_COVERAGE_PENDING_VERIFICATION: Potential statutory retirement entitlement is unverified; contractual offset cannot be applied until employer coverage under RA 7641 is confirmed.'
            : 'PROVISIONAL_ENTITLEMENT_PENDING_VERIFICATION: Retirement benefit or plan coverage is unverified; contractual offset cannot be applied against unconfirmed provisional amounts.';
        }
      } else {
        // Calculate contractual offset strictly against confirmed retirement entitlement (confirmedRetGross).
        // Never use unverified provisional company-plan / private-plan amounts in offsetDeduction or offset difference.
        separationGrossDisbursed = sepGross;
        offsetDeduction = Math.min(sepGross, confirmedRetGross);
        var netDiff = Math.max(0, round2(confirmedRetGross - sepGross));
        retirementGrossDisbursed = netDiff;
        confirmedRetirementGrossPayable = netDiff;
        provisionalRetirementGrossAmount = provisionalEntitlement;
        confirmedCombinedGross = round2(sepGross + netDiff);
        totalCombinedGross = round2(confirmedCombinedGross + provisionalEntitlement);

        var sepIsTaxExempt = Boolean(separation.isTaxExempt);
        var retIsFullyConfirmedExempt = confirmedExempt === confirmedRetGross && confirmedTaxable === 0 && provisionalTax === 0;

        if (sepGross === 0) {
          // No separation pay to offset; preserve standalone retirement tax buckets
          confirmedTaxExemptRetirement = confirmedExempt;
          confirmedTaxableRetirement = confirmedTaxable;
          provisionalTaxClassificationAmount = provisionalTax;
          provisionalOffsetDifference = 0;
          unconfirmedProvisionalRetirement = round2(provisionalTaxClassificationAmount + provisionalEntitlement);
          if (provisionalTaxClassificationAmount > 0 || provisionalEntitlement > 0) {
            offsetTaxStatus = RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL;
          } else if (confirmedTaxable > 0 && confirmedExempt > 0) {
            offsetTaxStatus = RETIREMENT_TAX_STATUS.PARTIALLY_EXEMPT_PARTIALLY_TAXABLE;
          } else if (confirmedTaxable > 0) {
            offsetTaxStatus = RETIREMENT_TAX_STATUS.CONFIRMED_TAXABLE;
          } else {
            offsetTaxStatus = RETIREMENT_TAX_STATUS.CONFIRMED_EXEMPT;
          }
          offsetTaxNote = 'CONTRACT_REVIEW_REQUIRED: Contractual/CBA offset authorization requires independent verification. No separation pay was payable to credit against confirmed retirement pay.';
        } else if (netDiff === 0) {
          // Confirmed retirement entitlement is fully absorbed by equal or greater separation pay
          confirmedTaxExemptRetirement = 0;
          confirmedTaxableRetirement = 0;
          provisionalTaxClassificationAmount = 0;
          provisionalOffsetDifference = 0;
          unconfirmedProvisionalRetirement = provisionalEntitlement;
          if (provisionalEntitlement > 0) {
            offsetTaxStatus = RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL;
            offsetTaxNote = 'PROVISIONAL_PLAN_EXCESS_PENDING_VERIFICATION: Confirmed retirement entitlement is fully offset by separation pay; unverified company-plan excess is excluded from contractual offset and held as UNCONFIRMED_PROVISIONAL. Contractual/CBA offset authorization requires independent verification.';
          } else {
            offsetTaxStatus = sepIsTaxExempt ? RETIREMENT_TAX_STATUS.CONFIRMED_EXEMPT : RETIREMENT_TAX_STATUS.CONFIRMED_TAXABLE;
            offsetTaxNote = 'CONTRACT_REVIEW_REQUIRED: Confirmed retirement entitlement is fully absorbed by separation pay under contractual offset. Contractual/CBA offset authorization requires independent verification.';
          }
        } else if (sepIsTaxExempt && retIsFullyConfirmedExempt) {
          // Both separation pay and confirmed retirement pay are 100% confirmed tax-exempt:
          // Remaining confirmed retirement balance (netDiff) is confirmed tax-exempt with no tax-allocation conflict.
          confirmedTaxExemptRetirement = netDiff;
          confirmedTaxableRetirement = 0;
          provisionalTaxClassificationAmount = 0;
          provisionalOffsetDifference = 0;
          unconfirmedProvisionalRetirement = provisionalEntitlement;
          if (provisionalEntitlement > 0) {
            offsetTaxStatus = RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL;
            offsetTaxNote = 'CONTRACT_REVIEW_REQUIRED: Contractual offset calculated strictly against confirmed retirement floor; remaining confirmed retirement balance (₱' + netDiff.toFixed(2) + ') is confirmed payable and tax-exempt, while unverified company-plan excess (₱' + provisionalEntitlement.toFixed(2) + ') remains provisional. Contractual/CBA offset authorization requires independent verification.';
          } else {
            offsetTaxStatus = RETIREMENT_TAX_STATUS.CONFIRMED_EXEMPT;
            offsetTaxNote = 'CONTRACT_REVIEW_REQUIRED: Contractual offset applied; separation pay (₱' + sepGross.toFixed(2) + ') is credited against confirmed retirement pay, leaving ₱' + netDiff.toFixed(2) + ' confirmed retirement payable. Both benefits are confirmed tax-exempt. Contractual/CBA offset authorization requires independent verification.';
          }
        } else {
          // Tax status is unknown/provisional or tax allocation between separation pay and retirement tax buckets is legally uncertain under BIR rules:
          // Keep netDiff in confirmed retirement gross payable, and classify its tax status in provisionalTaxClassificationAmount without inventing a tax priority.
          confirmedTaxExemptRetirement = 0;
          confirmedTaxableRetirement = 0;
          provisionalTaxClassificationAmount = netDiff;
          provisionalOffsetDifference = netDiff;
          unconfirmedProvisionalRetirement = round2(netDiff + provisionalEntitlement);
          offsetTaxStatus = RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL;
          if (provisionalEntitlement > 0) {
            offsetTaxNote = 'CONTRACT_REVIEW_REQUIRED: Contractual offset calculated strictly against confirmed retirement floor; remaining confirmed retirement balance (₱' + netDiff.toFixed(2) + ') is included in confirmed pay with provisional tax classification, and unverified company-plan excess (₱' + provisionalEntitlement.toFixed(2) + ') remains provisional entitlement.';
          } else {
            offsetTaxNote = 'CONTRACT_REVIEW_REQUIRED: Remaining confirmed retirement balance after offset (₱' + netDiff.toFixed(2) + ') is included in confirmed gross and net final pay; tax priority allocation between separation pay and retirement pay under contractual offset is legally unsettled under BIR rules and held in provisional tax classification.';
          }
        }
      }
    }

    return {
      coexistenceMode: mode,
      separationGrossDisbursed: separationGrossDisbursed,
      retirementGrossDisbursed: retirementGrossDisbursed,
      confirmedRetirementGrossPayable: confirmedRetirementGrossPayable,
      provisionalRetirementGrossAmount: provisionalRetirementGrossAmount,
      provisionalEntitlementAmount: provisionalRetirementGrossAmount,
      provisionalTaxClassificationAmount: provisionalTaxClassificationAmount,
      provisionalOffsetDifference: provisionalOffsetDifference,
      unverifiedPlanProvisionalAmount: unverifiedPlanProvisionalAmount,
      confirmedCombinedGross: confirmedCombinedGross,
      totalCombinedGross: totalCombinedGross,
      offsetDeduction: offsetDeduction,
      offsetTaxStatus: offsetTaxStatus,
      offsetTaxNote: offsetTaxNote,
      confirmedTaxExemptRetirement: confirmedTaxExemptRetirement,
      confirmedTaxableRetirement: confirmedTaxableRetirement,
      unconfirmedProvisionalRetirement: unconfirmedProvisionalRetirement
    };
  }

  /**
   * Master Calculation Function: calculateFinalPay
   * Integrates all final pay components, statutory rules, deductions, and tax categorizations.
   *
   * @param {Object} inputs
   * @returns {Object} Structured final pay results
   */
  function calculateFinalPay(inputs) {
    inputs = inputs || {};
    var warnings = [];
    var notes = [];

    // 1. Daily Rate Computation
    var dailyRateResult = calculateDailyRate({
      monthlyBasicSalary: inputs.monthlyBasicSalary,
      divisor: inputs.divisor,
      customDailyRate: inputs.customDailyRate,
      isCustomDailyRate: inputs.isCustomDailyRate
    });
    var dailyRate = dailyRateResult.dailyRate;

    // 2. Final Cutoff Unpaid Salary
    var unpaidSalaryResult = calculateUnpaidSalary({
      daysWorked: inputs.daysWorkedInCutoff,
      dailyRate: dailyRate,
      tardinessDeductions: inputs.tardinessDeductions
    });

    if (unpaidSalaryResult.unrecoveredTardiness > 0) {
      warnings.push('Tardiness/undertime deductions (₱' + unpaidSalaryResult.tardinessDeductions.toFixed(2) +
        ') exceeded earned cutoff wages. Unrecovered balance: ₱' + unpaidSalaryResult.unrecoveredTardiness.toFixed(2));
    }

    // 3. Prorated 13th Month Pay (PD 851)
    var tmResult = calculate13thMonthPay({
      ytdBasicSalary: inputs.ytdBasicSalary,
      priorAdvances: inputs.prior13thMonthAdvances
    });

    if (tmResult.remainingAdvance > 0) {
      warnings.push('Prior 13th month advances (₱' + tmResult.priorAdvances.toFixed(2) +
        ') exceeded prorated 13th month earnings. Remaining unrecovered advance: ₱' + tmResult.remainingAdvance.toFixed(2));
    }

    // 4. Credited Years of Service
    var serviceYears = Math.max(0, parseInt(inputs.serviceYears, 10) || 0);
    var serviceMonths = Math.max(0, parseInt(inputs.serviceMonths, 10) || 0);
    var creditedYears = calculateCreditedYears(serviceYears, serviceMonths);

    // 5. Leave Monetization
    var leaveResult = calculateLeaveMonetization({
      dailyRate: dailyRate,
      leavePolicy: inputs.leavePolicy || 'absorb_sil',
      isManagerial: Boolean(inputs.isManagerial),
      yearsOfService: serviceYears + (serviceMonths / 12),
      annualCompanyVLDays: inputs.annualCompanyVLDays,
      unusedSILDays: inputs.unusedSILDays,
      unusedVLDays: inputs.unusedCompanyVLDays,
      unusedSLDays: inputs.unusedCompanySLDays,
      monetizeSIL: inputs.monetizeSIL,
      monetizeVL: inputs.monetizeVL,
      monetizeSL: inputs.monetizeSL
    });

    if (inputs.isManagerial) {
      notes.push('Managerial employee: Excluded from statutory Service Incentive Leave under Article 95(b) of the Labor Code.');
    } else if (leaveResult.silAbsorbed) {
      notes.push('Statutory SIL absorbed by qualifying company-provided paid vacation leave under DOLE guidelines (Outcome A).');
    }

    // 6. Statutory Separation Pay
    var separationResult = calculateSeparationPay({
      separationCause: inputs.separationCause,
      monthlyBasicSalary: inputs.monthlyBasicSalary,
      creditedYears: creditedYears,
      serviceYears: serviceYears,
      serviceMonths: serviceMonths,
      customSeparationPay: inputs.customSeparationPay,
      isCustomDailyRate: dailyRateResult.isCustom,
      dailyRate: dailyRate,
      dailyEmrBasis: inputs.dailyEmrBasis
    });

    if (separationResult.missingBasis) {
      warnings.push('Statutory separation pay requires a valid DOLE Equivalent Monthly Rate (EMR) work-arrangement basis (or Custom Separation Pay Override) when Custom Daily Rate is enabled.');
    }

    // 7. Other Additions & Tax Cash Adjustments
    var otherTaxableAdditions = Math.max(0, parseCleanNumber(inputs.otherTaxableAdditions, 0));
    var otherNonTaxableAdditions = Math.max(0, parseCleanNumber(inputs.otherNonTaxableAdditions, 0));
    var taxRefund = Math.max(0, parseCleanNumber(inputs.taxRefund, 0)); // Separate cash adjustment (not income/exempt compensation)

    // 8. Retirement Benefit Calculation & Coexistence (if provided)
    var retirementResult = null;
    var coexistenceResult = null;
    var separationGrossDisbursed = separationResult.amount;
    var confirmedRetirementGrossPayable = 0;
    var provisionalRetirementGrossAmount = 0;
    var provisionalTaxClassificationAmount = 0;
    var confirmedTaxExemptRetirement = 0;
    var confirmedTaxableRetirement = 0;
    var unconfirmedProvisionalRetirement = 0;

    if (inputs.retirement && typeof inputs.retirement === 'object') {
      var retInputs = Object.assign({}, inputs.retirement);
      if (retInputs.monthlyBasicSalary === undefined) retInputs.monthlyBasicSalary = inputs.monthlyBasicSalary;
      if (retInputs.divisor === undefined) retInputs.divisor = inputs.divisor;
      if (retInputs.dailyRate === undefined && dailyRateResult.isCustom) retInputs.dailyRate = dailyRate;
      if (retInputs.serviceYears === undefined) retInputs.serviceYears = serviceYears;
      if (retInputs.serviceMonths === undefined) retInputs.serviceMonths = serviceMonths;

      retirementResult = calculateRetirementPay(retInputs);
      var coexistenceMode = retInputs.coexistenceMode || RETIREMENT_COEXISTENCE_MODES.BOTH_PAYABLE;

      coexistenceResult = calculateRetirementCoexistence({
        separationResult: separationResult,
        retirementResult: retirementResult,
        coexistenceMode: coexistenceMode
      });

      separationGrossDisbursed = coexistenceResult.separationGrossDisbursed;
      confirmedRetirementGrossPayable = coexistenceResult.confirmedRetirementGrossPayable;
      provisionalRetirementGrossAmount = coexistenceResult.provisionalRetirementGrossAmount;
      provisionalTaxClassificationAmount = coexistenceResult.provisionalTaxClassificationAmount;
      confirmedTaxExemptRetirement = coexistenceResult.confirmedTaxExemptRetirement;
      confirmedTaxableRetirement = coexistenceResult.confirmedTaxableRetirement;
      unconfirmedProvisionalRetirement = coexistenceResult.unconfirmedProvisionalRetirement;
    }

    // 9. Confirmed Gross Statutory Final Pay (includes confirmed retirement payable; excludes only unconfirmed provisional entitlement amounts)
    var confirmedGrossFinalPay = round2(
      unpaidSalaryResult.netUnpaidSalary +
      tmResult.net13thMonthPay +
      leaveResult.totalLeavePay +
      separationGrossDisbursed +
      confirmedRetirementGrossPayable +
      otherTaxableAdditions +
      otherNonTaxableAdditions +
      taxRefund
    );
    var grossStatutoryFinalPay = confirmedGrossFinalPay;
    var provisionalRetirementAdjustment = provisionalRetirementGrossAmount;
    var provisionalRetirementStatus = provisionalRetirementAdjustment > 0
      ? RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL
      : RETIREMENT_TAX_STATUS.NOT_APPLICABLE;
    var provisionalTaxClassificationStatus = provisionalTaxClassificationAmount > 0
      ? RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL
      : RETIREMENT_TAX_STATUS.NOT_APPLICABLE;

    if (provisionalRetirementAdjustment > 0) {
      notes.push('Provisional retirement entitlement (₱' + provisionalRetirementAdjustment.toFixed(2) +
        ') is marked PROVISIONAL_ENTITLEMENT and excluded from confirmed gross and net final pay pending verification.');
    }
    if (provisionalTaxClassificationAmount > 0) {
      notes.push('Confirmed retirement pay (₱' + provisionalTaxClassificationAmount.toFixed(2) +
        ') is included in confirmed gross and net final pay; its tax classification is marked UNCONFIRMED_PROVISIONAL pending BIR/evidentiary verification.');
    }

    // 10. Tax Categorization & ₱90,000 Bonus Pool Allocation
    var priorBonuses = Math.max(0, parseCleanNumber(inputs.priorTaxableBonuses, 0));
    var remainingCapBeforeFinalPay = Math.max(0, round2(STATUTORY_CONSTANTS.TAX_EXEMPT_BONUS_CAP - priorBonuses));

    var totalBonusPool = round2(
      tmResult.net13thMonthPay +
      leaveResult.excessLeavePay +
      leaveResult.companySLPay
    );

    var exemptBonusPortion = Math.min(remainingCapBeforeFinalPay, totalBonusPool);
    var taxableBonusPortion = Math.max(0, round2(totalBonusPool - exemptBonusPortion));

    // Statutory Tax-Exempt Total (excludes taxRefund which is a separate cash adjustment)
    // Uses unified 12-day de minimis leave pay (combining statutory SIL and company VL)
    var taxExemptTotal = round2(
      exemptBonusPortion +
      leaveResult.deMinimisLeavePay +
      (separationResult.isTaxExempt ? separationGrossDisbursed : 0) +
      confirmedTaxExemptRetirement +
      otherNonTaxableAdditions
    );

    // Taxable Compensation Total (subject to regular graduated income tax)
    var taxableCompensationTotal = round2(
      unpaidSalaryResult.netUnpaidSalary +
      taxableBonusPortion +
      (!separationResult.isTaxExempt ? separationGrossDisbursed : 0) +
      confirmedTaxableRetirement +
      otherTaxableAdditions
    );

    // 10. Deductions Ledger
    // Parse authorized statutory and payroll deductions
    var authDed = inputs.authorizedDeductions;
    var sssContrib = 0;
    var philHealthContrib = 0;
    var pagIbigContrib = 0;
    var authorizedLoans = 0;
    var taxDeficit = 0;
    var otherAuthDeductions = 0;

    if (typeof authDed === 'number') {
      authorizedLoans = Math.max(0, authDed);
    } else if (authDed && typeof authDed === 'object') {
      sssContrib = Math.max(0, parseCleanNumber(authDed.sssContribution, 0));
      philHealthContrib = Math.max(0, parseCleanNumber(authDed.philHealthContribution, 0));
      pagIbigContrib = Math.max(0, parseCleanNumber(authDed.pagIbigContribution, 0));
      authorizedLoans = Math.max(0, parseCleanNumber(authDed.authorizedLoans, 0));
      taxDeficit = Math.max(0, parseCleanNumber(authDed.taxDeficit, 0));
      otherAuthDeductions = Math.max(0, parseCleanNumber(authDed.otherAuthorizedDeductions, 0));
    }

    var totalAuthorizedDeductions = round2(
      sssContrib + philHealthContrib + pagIbigContrib + authorizedLoans + taxDeficit + otherAuthDeductions
    );

    var deductionsExceedGross = totalAuthorizedDeductions > grossStatutoryFinalPay;
    var statutoryNetFinalPay = Math.max(0, round2(grossStatutoryFinalPay - totalAuthorizedDeductions));
    var confirmedNetFinalPay = statutoryNetFinalPay;
    var unrecoveredDeductionsBalance = deductionsExceedGross ? round2(totalAuthorizedDeductions - grossStatutoryFinalPay) : 0;

    if (deductionsExceedGross) {
      warnings.push('Authorized payroll deductions (₱' + totalAuthorizedDeductions.toFixed(2) +
        ') exceed Gross Final Pay (₱' + grossStatutoryFinalPay.toFixed(2) + '). Net final pay is ₱0.00. Unrecovered deduction balance: ₱' +
        unrecoveredDeductionsBalance.toFixed(2));
    }

    // 11. Employer Claims Ledger (Disputed/Property Liabilities)
    // CRITICAL: Must NEVER be deducted from statutory net final pay without consent / legal judgment.
    var empClaims = inputs.employerClaims;
    var unreturnedEquip = 0;
    var lostBadge = 0;
    var disputedLiab = 0;
    var otherClaims = 0;

    if (typeof empClaims === 'number') {
      disputedLiab = Math.max(0, empClaims);
    } else if (empClaims && typeof empClaims === 'object') {
      unreturnedEquip = Math.max(0, parseCleanNumber(empClaims.unreturnedEquipment, 0));
      lostBadge = Math.max(0, parseCleanNumber(empClaims.lostBadgeProperty, 0));
      disputedLiab = Math.max(0, parseCleanNumber(empClaims.disputedLiabilities, 0));
      otherClaims = Math.max(0, parseCleanNumber(empClaims.otherClaims, 0));
    }

    var totalEmployerClaims = round2(unreturnedEquip + lostBadge + disputedLiab + otherClaims);
    var claimsExceedNet = totalEmployerClaims > statutoryNetFinalPay;
    var hypotheticalAdjustedPayout = Math.max(0, round2(statutoryNetFinalPay - totalEmployerClaims));
    var unrecoveredClaimsBalance = claimsExceedNet ? round2(totalEmployerClaims - statutoryNetFinalPay) : 0;

    if (totalEmployerClaims > 0) {
      notes.push('Employer property claims (₱' + totalEmployerClaims.toFixed(2) +
        ') are recorded on a separate clearance ledger and NOT deducted from Statutory Net Final Pay pursuant to Articles 113 and 116 of the Labor Code.');
    }

    return {
      dailyRate: dailyRate,
      divisor: dailyRateResult.divisor,
      isCustomDailyRate: dailyRateResult.isCustom,

      unpaidSalary: {
        daysWorked: unpaidSalaryResult.daysWorked,
        dailyRate: dailyRate,
        earnedWages: unpaidSalaryResult.earnedWages,
        tardinessDeductions: unpaidSalaryResult.tardinessDeductions,
        netUnpaidSalary: unpaidSalaryResult.netUnpaidSalary,
        unrecoveredTardiness: unpaidSalaryResult.unrecoveredTardiness
      },

      thirteenthMonthPay: {
        ytdBasicSalary: tmResult.ytdBasicSalary,
        gross13thMonth: tmResult.gross13thMonth,
        priorAdvances: tmResult.priorAdvances,
        net13thMonthPay: tmResult.net13thMonthPay,
        remainingAdvance: tmResult.remainingAdvance
      },

      leaveMonetization: {
        leavePolicy: leaveResult.leavePolicy,
        isManagerial: leaveResult.isManagerial,
        eligibleForSIL: leaveResult.eligibleForSIL,
        silAbsorbed: leaveResult.silAbsorbed,
        totalMonetizedLeaveDays: leaveResult.totalMonetizedLeaveDays,
        deMinimisLeaveDays: leaveResult.deMinimisLeaveDays,
        excessLeaveDays: leaveResult.excessLeaveDays,
        deMinimisLeavePay: leaveResult.deMinimisLeavePay,
        excessLeavePay: leaveResult.excessLeavePay,
        statutorySILDays: leaveResult.statutorySILDays,
        statutorySILPay: leaveResult.statutorySILPay,
        deMinimisVLDays: leaveResult.deMinimisVLDays,
        deMinimisVLPay: leaveResult.deMinimisVLPay,
        excessVLDays: leaveResult.excessVLDays,
        excessVLPay: leaveResult.excessVLPay,
        companySLDays: leaveResult.companySLDays,
        companySLPay: leaveResult.companySLPay,
        totalLeavePay: leaveResult.totalLeavePay
      },

      separationPay: {
        cause: separationResult.cause,
        causeLabel: separationResult.causeLabel,
        creditedYears: separationResult.creditedYears,
        serviceYears: serviceYears,
        serviceMonths: serviceMonths,
        multiplier: separationResult.multiplier,
        amount: separationResult.amount,
        isTaxExempt: separationResult.isTaxExempt,
        legalBasis: separationResult.legalBasis,
        monthlyBaseUsed: separationResult.monthlyBaseUsed,
        rateBasis: separationResult.rateBasis,
        emrDivisor: separationResult.emrDivisor,
        missingBasis: separationResult.missingBasis
      },

      taxReconciliation: {
        bonusPool: {
          net13thMonthPay: tmResult.net13thMonthPay,
          excessLeavePay: leaveResult.excessLeavePay,
          excessVLPay: leaveResult.excessVLPay,
          companySLPay: leaveResult.companySLPay,
          totalBonusPool: totalBonusPool,
          priorBonusesApplied: priorBonuses,
          statutoryCap: STATUTORY_CONSTANTS.TAX_EXEMPT_BONUS_CAP,
          remainingCapBeforeFinalPay: remainingCapBeforeFinalPay,
          exemptBonusPortion: exemptBonusPortion,
          taxableBonusPortion: taxableBonusPortion
        },
        taxExemptTotal: taxExemptTotal,
        taxableCompensationTotal: taxableCompensationTotal,
        provisionalTaxClassificationAmount: provisionalTaxClassificationAmount,
        provisionalEntitlementAmount: provisionalRetirementGrossAmount,
        unconfirmedProvisionalTotal: unconfirmedProvisionalRetirement,
        taxRefund: taxRefund,
        taxDeficit: taxDeficit
      },

      retirementPay: retirementResult,
      coexistenceLedger: coexistenceResult,

      deductionsLedger: {
        totalAuthorizedDeductions: totalAuthorizedDeductions,
        breakdown: {
          sssContribution: sssContrib,
          philHealthContribution: philHealthContrib,
          pagIbigContribution: pagIbigContrib,
          authorizedLoans: authorizedLoans,
          taxDeficit: taxDeficit,
          otherAuthorizedDeductions: otherAuthDeductions
        },
        deductionsExceedGross: deductionsExceedGross,
        unrecoveredDeductionsBalance: unrecoveredDeductionsBalance
      },

      employerClaimsLedger: {
        totalEmployerClaims: totalEmployerClaims,
        breakdown: {
          unreturnedEquipment: unreturnedEquip,
          lostBadgeProperty: lostBadge,
          disputedLiabilities: disputedLiab,
          otherClaims: otherClaims
        },
        claimsExceedNet: claimsExceedNet,
        unrecoveredClaimsBalance: unrecoveredClaimsBalance,
        legalDisclaimer: 'Under DOLE Labor Advisory 06-20 and Article 113 of the Labor Code, unreturned company property cannot be unilaterally deducted from statutory final pay without voluntary written employee authorization or judicial order.'
      },

      summary: {
        grossStatutoryFinalPay: grossStatutoryFinalPay,
        confirmedGrossFinalPay: confirmedGrossFinalPay,
        confirmedRetirementGrossPayable: confirmedRetirementGrossPayable,
        provisionalRetirementGrossAmount: provisionalRetirementGrossAmount,
        provisionalEntitlementAmount: provisionalRetirementGrossAmount,
        provisionalTaxClassificationAmount: provisionalTaxClassificationAmount,
        provisionalTaxClassificationStatus: provisionalTaxClassificationStatus,
        provisionalRetirementAdjustment: provisionalRetirementAdjustment,
        provisionalRetirementStatus: provisionalRetirementStatus,
        totalAuthorizedDeductions: totalAuthorizedDeductions,
        statutoryNetFinalPay: statutoryNetFinalPay,
        confirmedNetFinalPay: confirmedNetFinalPay,
        totalEmployerClaims: totalEmployerClaims,
        hypotheticalAdjustedPayout: hypotheticalAdjustedPayout,
        remainingUnrecoveredDeductions: unrecoveredDeductionsBalance,
        remainingUnrecoveredClaims: unrecoveredClaimsBalance
      },

      warnings: warnings,
      notes: notes
    };
  }

  /**
   * Currency formatter helper for Philippine Peso (PHP)
   * @param {number} amount
   * @returns {string}
   */
  function formatPHP(amount) {
    var num = Number(amount);
    if (!Number.isFinite(num) || num < 0) return '₱0.00';
    return '₱' + num.toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * Automated verification suite for the 8 Stage 1 Numerical Test Cases.
   * Asserts exact centavo equality across all required fields:
   * gross, net, hypotheticalNet, taxExempt, taxable, taxRefund,
   * authorizedDeductions, unrecoveredDeductions, employerClaims, and unrecoveredClaims.
   *
   * @returns {Array<Object>} Test execution results
   */
  function runStage1Tests() {
    var testCases = [
      {
        id: 1,
        title: 'Case 1: Voluntary Resignation with Authorized Loan',
        inputs: {
          monthlyBasicSalary: 25000,
          divisor: 261,
          daysWorkedInCutoff: 12,
          ytdBasicSalary: 193793.10, // 7 months + 12 days wages
          prior13thMonthAdvances: 0,
          unusedSILDays: 5,
          unusedCompanyVLDays: 0,
          unusedCompanySLDays: 0,
          serviceYears: 2,
          serviceMonths: 0,
          separationCause: SEPARATION_CAUSES.RESIGNATION,
          authorizedDeductions: { authorizedLoans: 5000 },
          employerClaims: 0
        },
        unroundedReference: {
          dailyRate: 1149.425287,
          unpaidSalary: 13793.10,
          silPay: 5747.13,
          thirteenthMonthPay: 16149.43,
          gross: 35689.65,
          net: 30689.65,
          taxExempt: 21896.55,
          taxable: 13793.10
        },
        expected: {
          dailyRate: 1149.43,
          unpaidSalary: 13793.16,
          thirteenthMonthPay: 16149.43,
          leavePay: 5747.15,
          separationPay: 0.00,
          gross: 35689.74,
          net: 30689.74,
          hypotheticalNet: 30689.74,
          taxExempt: 21896.58,
          taxable: 13793.16,
          taxRefund: 0.00,
          authorizedDeductions: 5000.00,
          unrecoveredDeductions: 0.00,
          employerClaims: 0.00,
          unrecoveredClaims: 0.00
        }
      },
      {
        id: 2,
        title: 'Case 2: Senior Operations Manager — Redundancy with Managerial Exclusion',
        inputs: {
          monthlyBasicSalary: 55000,
          divisor: 261,
          daysWorkedInCutoff: 10,
          ytdBasicSalary: 157758.60,
          prior13thMonthAdvances: 0,
          isManagerial: true, // Art. 95 SIL excluded
          unusedSILDays: 5,   // Ignored due to managerial exclusion
          unusedCompanyVLDays: 0,
          unusedCompanySLDays: 0,
          serviceYears: 5,
          serviceMonths: 0,
          separationCause: SEPARATION_CAUSES.REDUNDANCY,
          authorizedDeductions: 0,
          employerClaims: 0
        },
        unroundedReference: {
          dailyRate: 2528.735632,
          unpaidSalary: 25287.35,
          thirteenthMonthPay: 13146.55,
          separationPay: 275000.00,
          gross: 313433.90,
          net: 313433.90,
          taxExempt: 288146.55,
          taxable: 25287.35
        },
        expected: {
          dailyRate: 2528.74,
          unpaidSalary: 25287.40,
          thirteenthMonthPay: 13146.55,
          leavePay: 0.00,
          separationPay: 275000.00,
          gross: 313433.95,
          net: 313433.95,
          hypotheticalNet: 313433.95,
          taxExempt: 288146.55,
          taxable: 25287.40,
          taxRefund: 0.00,
          authorizedDeductions: 0.00,
          unrecoveredDeductions: 0.00,
          employerClaims: 0.00,
          unrecoveredClaims: 0.00
        }
      },
      {
        id: 3,
        title: 'Case 3: Retrenchment with 6-day Workweek (Divisor 313)',
        inputs: {
          monthlyBasicSalary: 25000,
          divisor: 313,
          daysWorkedInCutoff: 13,
          ytdBasicSalary: 75000, // 3 months
          prior13thMonthAdvances: 0,
          unusedSILDays: 4,
          unusedCompanyVLDays: 0,
          unusedCompanySLDays: 0,
          serviceYears: 3,
          serviceMonths: 0,
          separationCause: SEPARATION_CAUSES.RETRENCHMENT,
          authorizedDeductions: 0,
          employerClaims: 0
        },
        expected: {
          dailyRate: 958.47,
          unpaidSalary: 12460.11,
          thirteenthMonthPay: 6250.00,
          leavePay: 3833.88,
          separationPay: 37500.00,
          gross: 60043.99,
          net: 60043.99,
          hypotheticalNet: 60043.99,
          taxExempt: 47583.88,
          taxable: 12460.11,
          taxRefund: 0.00,
          authorizedDeductions: 0.00,
          unrecoveredDeductions: 0.00,
          employerClaims: 0.00,
          unrecoveredClaims: 0.00
        }
      },
      {
        id: 4,
        title: 'Case 4: Fixed-Term Contract Expiry with Disputed Lost Badge Claim',
        inputs: {
          monthlyBasicSalary: 28000,
          divisor: 261,
          daysWorkedInCutoff: 11,
          ytdBasicSalary: 168000, // 6 months
          prior13thMonthAdvances: 0,
          unusedSILDays: 0,
          unusedCompanyVLDays: 0,
          unusedCompanySLDays: 0,
          serviceYears: 0,
          serviceMonths: 6,
          separationCause: SEPARATION_CAUSES.CONTRACT_EXPIRY,
          authorizedDeductions: 0,
          employerClaims: { lostBadgeProperty: 2500 }
        },
        expected: {
          dailyRate: 1287.36,
          unpaidSalary: 14160.96,
          thirteenthMonthPay: 14000.00,
          leavePay: 0.00,
          separationPay: 0.00,
          gross: 28160.96,
          net: 28160.96, // Statutory net final pay MUST NOT deduct the ₱2,500 claim
          hypotheticalNet: 25660.96,
          taxExempt: 14000.00,
          taxable: 14160.96,
          taxRefund: 0.00,
          authorizedDeductions: 0.00,
          unrecoveredDeductions: 0.00,
          employerClaims: 2500.00,
          unrecoveredClaims: 0.00
        }
      },
      {
        id: 5,
        title: 'Case 5: Voluntary Resignation with ₱20k Mid-Year 13th Month Advance',
        inputs: {
          monthlyBasicSalary: 40000,
          divisor: 261,
          daysWorkedInCutoff: 10,
          ytdBasicSalary: 480000,
          prior13thMonthAdvances: 20000,
          unusedSILDays: 5,
          unusedCompanyVLDays: 0,
          unusedCompanySLDays: 0,
          serviceYears: 3,
          serviceMonths: 0,
          separationCause: SEPARATION_CAUSES.RESIGNATION,
          authorizedDeductions: 0,
          employerClaims: 0
        },
        expected: {
          dailyRate: 1839.08,
          unpaidSalary: 18390.80,
          thirteenthMonthPay: 20000.00,
          leavePay: 9195.40,
          separationPay: 0.00,
          gross: 47586.20,
          net: 47586.20,
          hypotheticalNet: 47586.20,
          taxExempt: 29195.40,
          taxable: 18390.80,
          taxRefund: 0.00,
          authorizedDeductions: 0.00,
          unrecoveredDeductions: 0.00,
          employerClaims: 0.00,
          unrecoveredClaims: 0.00
        }
      },
      {
        id: 6,
        title: 'Case 6: Tardiness Deduction and Tax Refund Cash Adjustment',
        inputs: {
          monthlyBasicSalary: 22000,
          divisor: 261,
          daysWorkedInCutoff: 9,
          tardinessDeductions: 443.25,
          ytdBasicSalary: 55000, // Restored Stage 1 YTD basic salary (₱4,583.33 13th month pay)
          prior13thMonthAdvances: 0,
          taxRefund: 1250,       // Restored Stage 1 employer tax refund cash adjustment
          unusedSILDays: 0,
          unusedCompanyVLDays: 0,
          unusedCompanySLDays: 0,
          serviceYears: 1,
          serviceMonths: 0,
          separationCause: SEPARATION_CAUSES.RESIGNATION,
          authorizedDeductions: 0,
          employerClaims: 0
        },
        expected: {
          dailyRate: 1011.49,
          unpaidSalary: 8660.16,
          thirteenthMonthPay: 4583.33,
          leavePay: 0.00,
          separationPay: 0.00,
          gross: 14493.49,
          net: 14493.49,
          hypotheticalNet: 14493.49,
          taxExempt: 4583.33, // 13th month pay only; taxRefund (₱1,250.00) is separate cash adjustment
          taxable: 8660.16,
          taxRefund: 1250.00,
          authorizedDeductions: 0.00,
          unrecoveredDeductions: 0.00,
          employerClaims: 0.00,
          unrecoveredClaims: 0.00
        }
      },
      {
        id: 7,
        title: 'Case 7: High Earner with Outcome A Company Leave & Prior Bonuses Consuming ₱85k Cap',
        inputs: {
          monthlyBasicSalary: 80000,
          divisor: 261,
          daysWorkedInCutoff: 11,
          ytdBasicSalary: 800000,
          prior13thMonthAdvances: 0,
          leavePolicy: 'absorb_sil', // Outcome A default
          annualCompanyVLDays: 15,   // Article 95(b): >= 5 days annual paid VL absorbs statutory SIL
          unusedSILDays: 5,          // Absorbed by 15 days qualifying annual company leave
          unusedCompanyVLDays: 15,   // 12 days de minimis exempt (RR 29-2025), 3 days enters bonus pool
          unusedCompanySLDays: 0,
          priorTaxableBonuses: 85000, // Consumed ₱85k of ₱90k cap -> only ₱5,000 remaining cap
          serviceYears: 4,
          serviceMonths: 0,
          separationCause: SEPARATION_CAUSES.RESIGNATION,
          authorizedDeductions: 0,
          employerClaims: 0
        },
        expected: {
          dailyRate: 3678.16,
          unpaidSalary: 40459.76,
          thirteenthMonthPay: 66666.67,
          leavePay: 55172.40,
          separationPay: 0.00,
          gross: 162298.83,
          net: 162298.83,
          hypotheticalNet: 162298.83,
          taxExempt: 49137.92,
          taxable: 113160.91,
          taxRefund: 0.00,
          authorizedDeductions: 0.00,
          unrecoveredDeductions: 0.00,
          employerClaims: 0.00,
          unrecoveredClaims: 0.00
        }
      },
      {
        id: 8,
        title: 'Case 8: Just Cause Dismissal with ₱25k Unreturned Laptop Claim',
        inputs: {
          monthlyBasicSalary: 35000,
          divisor: 261,
          daysWorkedInCutoff: 14,
          ytdBasicSalary: 230000,
          prior13thMonthAdvances: 0,
          unusedSILDays: 5, // Accrued statutory SIL is NOT forfeited by just cause dismissal
          unusedCompanyVLDays: 0,
          unusedCompanySLDays: 0,
          serviceYears: 2,
          serviceMonths: 0,
          separationCause: SEPARATION_CAUSES.JUST_CAUSE,
          authorizedDeductions: 0,
          employerClaims: { unreturnedEquipment: 25000 }
        },
        expected: {
          dailyRate: 1609.20,
          unpaidSalary: 22528.80,
          thirteenthMonthPay: 19166.67,
          leavePay: 8046.00,
          separationPay: 0.00,
          gross: 49741.47,
          net: 49741.47, // Statutory Net Final Pay MUST NOT deduct the ₱25,000 claim
          hypotheticalNet: 24741.47,
          taxExempt: 27212.67,
          taxable: 22528.80,
          taxRefund: 0.00,
          authorizedDeductions: 0.00,
          unrecoveredDeductions: 0.00,
          employerClaims: 25000.00,
          unrecoveredClaims: 0.00
        }
      }
    ];

    var results = [];
    for (var i = 0; i < testCases.length; i++) {
      var tc = testCases[i];
      var res = calculateFinalPay(tc.inputs);
      var exp = tc.expected;

      var actual = {
        dailyRate: res.dailyRate,
        unpaidSalary: res.unpaidSalary.netUnpaidSalary,
        thirteenthMonthPay: res.thirteenthMonthPay.net13thMonthPay,
        leavePay: res.leaveMonetization.totalLeavePay,
        separationPay: res.separationPay.amount,
        gross: res.summary.grossStatutoryFinalPay,
        net: res.summary.statutoryNetFinalPay,
        hypotheticalNet: res.summary.hypotheticalAdjustedPayout,
        taxExempt: res.taxReconciliation.taxExemptTotal,
        taxable: res.taxReconciliation.taxableCompensationTotal,
        taxRefund: res.taxReconciliation.taxRefund,
        authorizedDeductions: res.deductionsLedger.totalAuthorizedDeductions,
        unrecoveredDeductions: res.deductionsLedger.unrecoveredDeductionsBalance,
        employerClaims: res.employerClaimsLedger.totalEmployerClaims,
        unrecoveredClaims: res.employerClaimsLedger.unrecoveredClaimsBalance
      };

      var assertions = {
        dailyRate: actual.dailyRate === exp.dailyRate,
        unpaidSalary: actual.unpaidSalary === exp.unpaidSalary,
        thirteenthMonthPay: actual.thirteenthMonthPay === exp.thirteenthMonthPay,
        leavePay: actual.leavePay === exp.leavePay,
        separationPay: actual.separationPay === exp.separationPay,
        gross: actual.gross === exp.gross,
        net: actual.net === exp.net,
        hypotheticalNet: actual.hypotheticalNet === exp.hypotheticalNet,
        taxExempt: actual.taxExempt === exp.taxExempt,
        taxable: actual.taxable === exp.taxable,
        taxRefund: actual.taxRefund === exp.taxRefund,
        authorizedDeductions: actual.authorizedDeductions === exp.authorizedDeductions,
        unrecoveredDeductions: actual.unrecoveredDeductions === exp.unrecoveredDeductions,
        employerClaims: actual.employerClaims === exp.employerClaims,
        unrecoveredClaims: actual.unrecoveredClaims === exp.unrecoveredClaims
      };

      var failedFields = [];
      var assertionKeys = Object.keys(assertions);
      for (var k = 0; k < assertionKeys.length; k++) {
        var fieldKey = assertionKeys[k];
        if (!assertions[fieldKey]) {
          failedFields.push(fieldKey);
        }
      }

      var passed = failedFields.length === 0;

      results.push({
        id: tc.id,
        title: tc.title,
        passed: passed,
        failedFields: failedFields,
        assertions: assertions,
        unroundedReference: tc.unroundedReference || null,
        actual: actual,
        expected: exp,
        actualGross: actual.gross,
        expectedGross: exp.gross,
        grossDiff: round2(actual.gross - exp.gross),
        actualNet: actual.net,
        expectedNet: exp.net,
        netDiff: round2(actual.net - exp.net),
        actualHypotheticalNet: actual.hypotheticalNet,
        expectedHypotheticalNet: exp.hypotheticalNet,
        actualExempt: actual.taxExempt,
        expectedExempt: exp.taxExempt,
        actualTaxable: actual.taxable,
        expectedTaxable: exp.taxable,
        actualTaxRefund: actual.taxRefund,
        expectedTaxRefund: exp.taxRefund,
        actualEmployerClaims: actual.employerClaims,
        expectedEmployerClaims: exp.employerClaims,
        actualUnrecoveredClaims: actual.unrecoveredClaims,
        expectedUnrecoveredClaims: exp.unrecoveredClaims,
        actualAuthorizedDeductions: actual.authorizedDeductions,
        expectedAuthorizedDeductions: exp.authorizedDeductions,
        actualUnrecoveredDeductions: actual.unrecoveredDeductions,
        expectedUnrecoveredDeductions: exp.unrecoveredDeductions
      });
    }

    return results;
  }

  /**
   * Automated verification suite for SIL Absorption & Leave Monetization Edge Cases
   * Specifically tests 0, 1, 4, 5, and 10 unused VL days under Outcome A ('absorb_sil'),
   * non-monetizable VL (`monetizeVL: false`), managerial exclusion, and < 1 year service,
   * plus unrecovered deduction and employer claim overflow balances.
   *
   * @returns {Array<Object>} Test execution results
   */
  function runSILEdgeCaseTests() {
    var silTestCases = [
      {
        id: 'SIL-1',
        title: 'Outcome A with 0 unused VL days -> SIL NOT absorbed (5 SIL days paid)',
        params: {
          dailyRate: 1000,
          leavePolicy: 'absorb_sil',
          isManagerial: false,
          yearsOfService: 2,
          unusedSILDays: 5,
          unusedVLDays: 0,
          unusedSLDays: 0,
          monetizeSIL: true,
          monetizeVL: true
        },
        expected: {
          eligibleForSIL: true,
          silAbsorbed: false,
          statutorySILDays: 5,
          statutorySILPay: 5000.00,
          deMinimisVLDays: 0,
          deMinimisVLPay: 0.00,
          excessVLDays: 0,
          excessVLPay: 0.00,
          totalLeavePay: 5000.00
        }
      },
      {
        id: 'SIL-2',
        title: 'Outcome A with 1 unused VL day (< 5 threshold) -> SIL NOT absorbed (5 SIL + 1 VL paid)',
        params: {
          dailyRate: 1000,
          leavePolicy: 'absorb_sil',
          isManagerial: false,
          yearsOfService: 2,
          unusedSILDays: 5,
          unusedVLDays: 1,
          unusedSLDays: 0,
          monetizeSIL: true,
          monetizeVL: true
        },
        expected: {
          eligibleForSIL: true,
          silAbsorbed: false,
          statutorySILDays: 5,
          statutorySILPay: 5000.00,
          deMinimisVLDays: 1,
          deMinimisVLPay: 1000.00,
          excessVLDays: 0,
          excessVLPay: 0.00,
          totalLeavePay: 6000.00
        }
      },
      {
        id: 'SIL-3',
        title: 'Outcome A with 4 unused VL days (< 5 threshold) -> SIL NOT absorbed (5 SIL + 4 VL paid)',
        params: {
          dailyRate: 1000,
          leavePolicy: 'absorb_sil',
          isManagerial: false,
          yearsOfService: 2,
          unusedSILDays: 5,
          unusedVLDays: 4,
          unusedSLDays: 0,
          monetizeSIL: true,
          monetizeVL: true
        },
        expected: {
          eligibleForSIL: true,
          silAbsorbed: false,
          statutorySILDays: 5,
          statutorySILPay: 5000.00,
          deMinimisVLDays: 4,
          deMinimisVLPay: 4000.00,
          excessVLDays: 0,
          excessVLPay: 0.00,
          totalLeavePay: 9000.00
        }
      },
      {
        id: 'SIL-4',
        title: 'Outcome A with 5 annual paid VL days (>= 5 threshold) -> SIL absorbed (0 SIL + 5 VL paid)',
        params: {
          dailyRate: 1000,
          leavePolicy: 'absorb_sil',
          isManagerial: false,
          yearsOfService: 2,
          annualCompanyVLDays: 5,
          unusedSILDays: 5,
          unusedVLDays: 5,
          unusedSLDays: 0,
          monetizeSIL: true,
          monetizeVL: true
        },
        expected: {
          eligibleForSIL: true,
          silAbsorbed: true,
          statutorySILDays: 0,
          statutorySILPay: 0.00,
          deMinimisVLDays: 5,
          deMinimisVLPay: 5000.00,
          excessVLDays: 0,
          excessVLPay: 0.00,
          totalLeavePay: 5000.00
        }
      },
      {
        id: 'SIL-5',
        title: 'Outcome A with 10 annual paid VL days (>= 5 threshold) -> SIL absorbed (0 SIL + 10 VL paid)',
        params: {
          dailyRate: 1000,
          leavePolicy: 'absorb_sil',
          isManagerial: false,
          yearsOfService: 2,
          annualCompanyVLDays: 10,
          unusedSILDays: 5,
          unusedVLDays: 10,
          unusedSLDays: 0,
          monetizeSIL: true,
          monetizeVL: true
        },
        expected: {
          eligibleForSIL: true,
          silAbsorbed: true,
          statutorySILDays: 0,
          statutorySILPay: 0.00,
          deMinimisVLDays: 10,
          deMinimisVLPay: 10000.00,
          excessVLDays: 0,
          excessVLPay: 0.00,
          totalLeavePay: 10000.00
        }
      },
      {
        id: 'SIL-6',
        title: 'Outcome A with 10 unused VL days but monetizeVL === false -> SIL NOT absorbed (5 SIL paid)',
        params: {
          dailyRate: 1000,
          leavePolicy: 'absorb_sil',
          isManagerial: false,
          yearsOfService: 2,
          unusedSILDays: 5,
          unusedVLDays: 10,
          unusedSLDays: 0,
          monetizeSIL: true,
          monetizeVL: false
        },
        expected: {
          eligibleForSIL: true,
          silAbsorbed: false,
          statutorySILDays: 5,
          statutorySILPay: 5000.00,
          deMinimisVLDays: 0,
          deMinimisVLPay: 0.00,
          excessVLDays: 0,
          excessVLPay: 0.00,
          totalLeavePay: 5000.00
        }
      },
      {
        id: 'SIL-7',
        title: 'Managerial employee with 5 SIL days -> Ineligible under Art. 95 (0 SIL paid)',
        params: {
          dailyRate: 1000,
          leavePolicy: 'absorb_sil',
          isManagerial: true,
          yearsOfService: 3,
          unusedSILDays: 5,
          unusedVLDays: 0,
          unusedSLDays: 0,
          monetizeSIL: true,
          monetizeVL: true
        },
        expected: {
          eligibleForSIL: false,
          silAbsorbed: false,
          statutorySILDays: 0,
          statutorySILPay: 0.00,
          deMinimisVLDays: 0,
          deMinimisVLPay: 0.00,
          excessVLDays: 0,
          excessVLPay: 0.00,
          totalLeavePay: 0.00
        }
      },
      {
        id: 'SIL-8',
        title: 'Rank-and-file with < 1 year service (8 months) -> Ineligible under Art. 95 (0 SIL paid)',
        params: {
          dailyRate: 1000,
          leavePolicy: 'absorb_sil',
          isManagerial: false,
          yearsOfService: 8 / 12,
          unusedSILDays: 5,
          unusedVLDays: 0,
          unusedSLDays: 0,
          monetizeSIL: true,
          monetizeVL: true
        },
        expected: {
          eligibleForSIL: false,
          silAbsorbed: false,
          statutorySILDays: 0,
          statutorySILPay: 0.00,
          deMinimisVLDays: 0,
          deMinimisVLPay: 0.00,
          excessVLDays: 0,
          excessVLPay: 0.00,
          totalLeavePay: 0.00
        }
      }
    ];

    var results = [];
    for (var i = 0; i < silTestCases.length; i++) {
      var tc = silTestCases[i];
      var actual = calculateLeaveMonetization(tc.params);
      var exp = tc.expected;
      var failedFields = [];
      var keys = Object.keys(exp);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (actual[key] !== exp[key]) {
          failedFields.push(key);
        }
      }
      results.push({
        id: tc.id,
        title: tc.title,
        passed: failedFields.length === 0,
        failedFields: failedFields,
        actual: actual,
        expected: exp
      });
    }
    return results;
  }

  /**
   * Automated verification suite for Statutory Retirement (RA 7641) & Private Plan (RA 4917) Engine
   * Validates all 20 required core engine scenarios under Part 6B-3C-5A.
   *
   * @returns {Array<Object>} Test execution results
   */
  function runRetirementEngineTests() {
    var retTestCases = [
      {
        id: 'RET-01',
        title: 'Covered employer and eligible employee (Age 60, Svc 13 yrs, MBS ₱32k, Div 261) -> 100% Tax-Exempt Floor',
        params: {
          planType: 'statutory_only',
          employerCategory: 'private_general',
          age: 60,
          serviceYears: 13,
          serviceMonths: 0,
          monthlyBasicSalary: 32000,
          divisor: 261,
          taxAvailment: 'first_time'
        },
        expected: {
          isStatutorilyEligible: true,
          totalGrossRetirementPayable: 430344.83,
          confirmedTaxExemptTotal: 430344.83,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT
        }
      },
      {
        id: 'RET-02',
        title: 'Exempt employer (Retail establishment <= 10 employees) -> Statutorily Exempt (₱0.00)',
        params: {
          planType: 'statutory_only',
          employerCategory: 'private_retail_le10',
          age: 62,
          serviceYears: 10,
          serviceMonths: 0,
          monthlyBasicSalary: 30000,
          divisor: 261
        },
        expected: {
          isStatutorilyEligible: false,
          totalGrossRetirementPayable: 0,
          confirmedTaxExemptTotal: 0,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE
        }
      },
      {
        id: 'RET-03',
        title: 'Unknown employer coverage category -> Potential statutory floor (₱129,310.34) marked UNCONFIRMED_PROVISIONAL',
        params: {
          planType: 'statutory_only',
          employerCategory: 'unknown',
          age: 60,
          serviceYears: 5,
          serviceMonths: 0,
          monthlyBasicSalary: 25000,
          divisor: 261
        },
        expected: {
          isStatutorilyEligible: false,
          isCoveragePending: true,
          eligibilityStatus: 'PENDING_EMPLOYER_VERIFICATION',
          totalGrossRetirementPayable: 129310.34,
          confirmedTaxExemptTotal: 0,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 129310.34,
          overallTaxStatus: RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL
        }
      },
      {
        id: 'RET-03B',
        title: 'Unknown employer coverage with service < 5 years (4 yrs 0 mos) -> Ineligible, ₱0.00',
        params: {
          planType: 'statutory_only',
          employerCategory: 'unknown',
          age: 60,
          serviceYears: 4,
          serviceMonths: 0,
          monthlyBasicSalary: 30000,
          divisor: 261
        },
        expected: {
          isStatutorilyEligible: false,
          isCoveragePending: false,
          eligibilityStatus: 'INELIGIBLE_STATUTORY',
          totalGrossRetirementPayable: 0,
          confirmedTaxExemptTotal: 0,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE
        }
      },
      {
        id: 'RET-03C',
        title: 'Unknown employer coverage with age < 60 (55 yrs) -> Ineligible, ₱0.00',
        params: {
          planType: 'statutory_only',
          employerCategory: 'unknown',
          age: 55,
          serviceYears: 10,
          serviceMonths: 0,
          monthlyBasicSalary: 30000,
          divisor: 261
        },
        expected: {
          isStatutorilyEligible: false,
          isCoveragePending: false,
          eligibilityStatus: 'INELIGIBLE_STATUTORY',
          totalGrossRetirementPayable: 0,
          confirmedTaxExemptTotal: 0,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE
        }
      },
      {
        id: 'RET-03D',
        title: 'Unknown employer coverage category (₱30k MBS) -> Potential statutory floor (₱155,172.41) marked UNCONFIRMED_PROVISIONAL',
        params: {
          planType: 'statutory_only',
          employerCategory: 'unknown',
          age: 60,
          serviceYears: 5,
          serviceMonths: 0,
          monthlyBasicSalary: 30000,
          divisor: 261
        },
        expected: {
          isStatutorilyEligible: false,
          isCoveragePending: true,
          eligibilityStatus: 'PENDING_EMPLOYER_VERIFICATION',
          totalGrossRetirementPayable: 155172.41,
          confirmedTaxExemptTotal: 0,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 155172.41,
          overallTaxStatus: RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL
        }
      },
      {
        id: 'RET-04',
        title: 'Service below five years (4 yrs 0 mos) -> Ineligible under Art. 302 (₱0.00)',
        params: {
          planType: 'statutory_only',
          employerCategory: 'private_general',
          age: 60,
          serviceYears: 4,
          serviceMonths: 0,
          monthlyBasicSalary: 32000,
          divisor: 261
        },
        expected: {
          isStatutorilyEligible: false,
          roundingSensitivityFlag: false,
          totalGrossRetirementPayable: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE
        }
      },
      {
        id: 'RET-05',
        title: 'Service exactly five years (5 yrs 0 mos) -> Statutorily Eligible (5 yrs x 22.5d = ₱165,517.24)',
        params: {
          planType: 'statutory_only',
          employerCategory: 'private_general',
          age: 60,
          serviceYears: 5,
          serviceMonths: 0,
          monthlyBasicSalary: 32000,
          divisor: 261,
          taxAvailment: 'first_time'
        },
        expected: {
          isStatutorilyEligible: true,
          totalGrossRetirementPayable: 165517.24,
          confirmedTaxExemptTotal: 165517.24,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT
        }
      },
      {
        id: 'RET-06',
        title: 'Service of 4 yrs 6 mos -> Baseline ineligible (4.5 yrs < 5.0), rounding sensitivity flag = true',
        params: {
          planType: 'statutory_only',
          employerCategory: 'private_general',
          age: 60,
          serviceYears: 4,
          serviceMonths: 6,
          monthlyBasicSalary: 32000,
          divisor: 261
        },
        expected: {
          isStatutorilyEligible: false,
          roundingSensitivityFlag: true,
          totalGrossRetirementPayable: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE
        }
      },
      {
        id: 'RET-07',
        title: 'Service of 4 yrs 11 mos -> Baseline ineligible (4.92 yrs < 5.0), rounding sensitivity flag = true',
        params: {
          planType: 'statutory_only',
          employerCategory: 'private_general',
          age: 60,
          serviceYears: 4,
          serviceMonths: 11,
          monthlyBasicSalary: 32000,
          divisor: 261
        },
        expected: {
          isStatutorilyEligible: false,
          roundingSensitivityFlag: true,
          totalGrossRetirementPayable: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE
        }
      },
      {
        id: 'RET-08',
        title: 'Company plan below statutory floor (₱350k vs ₱430,344.83 floor) -> Top-Up of ₱80,344.83 applied, 100% Exempt',
        params: {
          planType: 'company_plan',
          employerCategory: 'private_general',
          age: 62,
          serviceYears: 13,
          serviceMonths: 0,
          monthlyBasicSalary: 32000,
          divisor: 261,
          companyPlanGrossAmount: 350000,
          taxAvailment: 'first_time'
        },
        expected: {
          isStatutorilyEligible: true,
          totalGrossRetirementPayable: 430344.83,
          confirmedTaxExemptTotal: 430344.83,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT
        }
      },
      {
        id: 'RET-09',
        title: 'Company plan exactly equal to statutory floor (₱430,344.83) -> Top-up ₱0.00, 100% Exempt',
        params: {
          planType: 'company_plan',
          employerCategory: 'private_general',
          age: 60,
          serviceYears: 13,
          serviceMonths: 0,
          monthlyBasicSalary: 32000,
          divisor: 261,
          companyPlanGrossAmount: 430344.83,
          taxAvailment: 'first_time'
        },
        expected: {
          isStatutorilyEligible: true,
          totalGrossRetirementPayable: 430344.83,
          confirmedTaxExemptTotal: 430344.83,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT
        }
      },
      {
        id: 'RET-10',
        title: 'Company plan above statutory floor (₱500k vs ₱430,344.83 floor, non-TQP) -> Base ₱430,344.83 Exempt, Excess ₱69,655.17 Taxable',
        params: {
          planType: 'company_plan',
          employerCategory: 'private_general',
          age: 60,
          serviceYears: 13,
          serviceMonths: 0,
          monthlyBasicSalary: 32000,
          divisor: 261,
          companyPlanGrossAmount: 500000,
          hasBirTqpApproval: 'no',
          taxAvailment: 'first_time'
        },
        expected: {
          isStatutorilyEligible: true,
          totalGrossRetirementPayable: 500000.00,
          confirmedTaxExemptTotal: 430344.83,
          confirmedTaxableTotal: 69655.17,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: 'PARTIALLY_EXEMPT_PARTIALLY_TAXABLE'
        }
      },
      {
        id: 'RET-11',
        title: 'Qualified private plan with employee coverage confirmed (Age 52, Svc 12 yrs, TQP all yes) -> 100% Exempt under RA 4917',
        params: {
          planType: 'company_plan',
          employerCategory: 'private_general',
          age: 52,
          serviceYears: 12,
          serviceMonths: 0,
          monthlyBasicSalary: 40000,
          divisor: 261,
          companyPlanGrossAmount: 600000,
          hasBirTqpApproval: 'yes',
          isPlanIdentityMatched: 'yes',
          isEmployeeCoveredByPlan: 'yes',
          isPaidUnderTrust: 'yes',
          taxAvailment: 'first_time'
        },
        expected: {
          isStatutorilyEligible: false,
          totalGrossRetirementPayable: 600000.00,
          confirmedTaxExemptTotal: 600000.00,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT
        }
      },
      {
        id: 'RET-12',
        title: 'Qualified private plan with employee coverage unknown -> Unconfirmed Provisional (₱600k isolated)',
        params: {
          planType: 'company_plan',
          employerCategory: 'private_general',
          age: 52,
          serviceYears: 12,
          serviceMonths: 0,
          monthlyBasicSalary: 40000,
          divisor: 261,
          companyPlanGrossAmount: 600000,
          hasBirTqpApproval: 'yes',
          isPlanIdentityMatched: 'yes',
          isEmployeeCoveredByPlan: 'unknown',
          isPaidUnderTrust: 'yes',
          taxAvailment: 'first_time'
        },
        expected: {
          isStatutorilyEligible: false,
          totalGrossRetirementPayable: 600000.00,
          confirmedTaxExemptTotal: 0,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 600000.00,
          overallTaxStatus: RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL
        }
      },
      {
        id: 'RET-13',
        title: 'Non-qualified private plan (TQP no, Age 52, Svc 12) -> 100% Taxable Compensation',
        params: {
          planType: 'company_plan',
          employerCategory: 'private_general',
          age: 52,
          serviceYears: 12,
          serviceMonths: 0,
          monthlyBasicSalary: 40000,
          divisor: 261,
          companyPlanGrossAmount: 600000,
          hasBirTqpApproval: 'no',
          taxAvailment: 'first_time'
        },
        expected: {
          isStatutorilyEligible: false,
          totalGrossRetirementPayable: 600000.00,
          confirmedTaxExemptTotal: 0,
          confirmedTaxableTotal: 600000.00,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAXABLE
        }
      },
      {
        id: 'RET-14',
        title: 'First-time qualifying statutory retirement (Age 61, Svc 10 yrs, ₱30k) -> 100% Tax-Exempt (₱310,344.83)',
        params: {
          planType: 'statutory_only',
          employerCategory: 'private_general',
          age: 61,
          serviceYears: 10,
          serviceMonths: 0,
          monthlyBasicSalary: 30000,
          divisor: 261,
          taxAvailment: 'first_time'
        },
        expected: {
          isStatutorilyEligible: true,
          totalGrossRetirementPayable: 310344.83,
          confirmedTaxExemptTotal: 310344.83,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT
        }
      },
      {
        id: 'RET-15',
        title: 'Repeat retirement claimant -> 100% Taxable (₱310,344.83)',
        params: {
          planType: 'statutory_only',
          employerCategory: 'private_general',
          age: 61,
          serviceYears: 10,
          serviceMonths: 0,
          monthlyBasicSalary: 30000,
          divisor: 261,
          taxAvailment: 'repeat'
        },
        expected: {
          isStatutorilyEligible: true,
          totalGrossRetirementPayable: 310344.83,
          confirmedTaxExemptTotal: 0,
          confirmedTaxableTotal: 310344.83,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAXABLE
        }
      },
      {
        id: 'RET-16',
        title: 'Unknown tax evidence (Availment history unknown) -> Unconfirmed Provisional (₱310,344.83 isolated)',
        params: {
          planType: 'statutory_only',
          employerCategory: 'private_general',
          age: 61,
          serviceYears: 10,
          serviceMonths: 0,
          monthlyBasicSalary: 30000,
          divisor: 261,
          taxAvailment: 'unknown'
        },
        expected: {
          isStatutorilyEligible: true,
          totalGrossRetirementPayable: 310344.83,
          confirmedTaxExemptTotal: 0,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 310344.83,
          overallTaxStatus: RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL
        }
      },
      {
        id: 'RET-17A',
        title: 'Age above 65 with employer consent YES -> 100% Tax-Exempt under RMC 13-2024 Q&A 11 (₱397,241.38)',
        params: {
          planType: 'statutory_only',
          employerCategory: 'private_general',
          age: 67,
          serviceYears: 12,
          serviceMonths: 0,
          monthlyBasicSalary: 32000,
          divisor: 261,
          post65Consent: 'yes',
          taxAvailment: 'first_time'
        },
        expected: {
          isStatutorilyEligible: true,
          totalGrossRetirementPayable: 397241.38,
          confirmedTaxExemptTotal: 397241.38,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAX_EXEMPT
        }
      },
      {
        id: 'RET-17B',
        title: 'Age above 65 with employer consent NO -> Unconfirmed Provisional (consent disputed/absent)',
        params: {
          planType: 'statutory_only',
          employerCategory: 'private_general',
          age: 67,
          serviceYears: 12,
          serviceMonths: 0,
          monthlyBasicSalary: 32000,
          divisor: 261,
          post65Consent: 'no',
          taxAvailment: 'first_time'
        },
        expected: {
          isStatutorilyEligible: true,
          totalGrossRetirementPayable: 397241.38,
          confirmedTaxExemptTotal: 0,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 397241.38,
          overallTaxStatus: RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL
        }
      },
      {
        id: 'RET-17C',
        title: 'Age above 65 with employer consent UNKNOWN -> Unconfirmed Provisional (consent unconfirmed)',
        params: {
          planType: 'statutory_only',
          employerCategory: 'private_general',
          age: 67,
          serviceYears: 12,
          serviceMonths: 0,
          monthlyBasicSalary: 32000,
          divisor: 261,
          post65Consent: 'unknown',
          taxAvailment: 'first_time'
        },
        expected: {
          isStatutorilyEligible: true,
          totalGrossRetirementPayable: 397241.38,
          confirmedTaxExemptTotal: 0,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 397241.38,
          overallTaxStatus: RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL
        }
      },
      {
        id: 'RET-18',
        title: 'Zero-value component (Ineligible employee, Age 35, Svc 2 yrs) -> Status NOT_APPLICABLE, ₱0.00',
        params: {
          planType: 'statutory_only',
          employerCategory: 'private_general',
          age: 35,
          serviceYears: 2,
          serviceMonths: 0,
          monthlyBasicSalary: 25000,
          divisor: 261
        },
        expected: {
          isStatutorilyEligible: false,
          totalGrossRetirementPayable: 0,
          confirmedTaxExemptTotal: 0,
          confirmedTaxableTotal: 0,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.NOT_APPLICABLE
        }
      },
      {
        id: 'RET-19',
        title: 'Contractual early retirement without statutory eligibility (Age 45, Svc 8 yrs, Plan ₱250k) -> 100% Taxable',
        params: {
          planType: 'company_plan',
          employerCategory: 'private_general',
          age: 45,
          serviceYears: 8,
          serviceMonths: 0,
          monthlyBasicSalary: 35000,
          divisor: 261,
          companyPlanGrossAmount: 250000,
          hasBirTqpApproval: 'no',
          taxAvailment: 'first_time'
        },
        expected: {
          isStatutorilyEligible: false,
          totalGrossRetirementPayable: 250000.00,
          confirmedTaxExemptTotal: 0,
          confirmedTaxableTotal: 250000.00,
          unconfirmedProvisionalTotal: 0,
          overallTaxStatus: RETIREMENT_TAX_STATUS.CONFIRMED_TAXABLE
        }
      },
      {
        id: 'RET-20',
        title: 'Separation & Retirement Coexistence (Both-Payable vs Contractual Offset with unconfirmed tax allocation)',
        customCheck: function() {
          var sepResult = calculateSeparationPay({
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            monthlyBasicSalary: 32000,
            creditedYears: 13,
            serviceYears: 13,
            serviceMonths: 0
          });
          var retResult = calculateRetirementPay({
            planType: 'statutory_only',
            employerCategory: 'private_general',
            age: 60,
            serviceYears: 13,
            serviceMonths: 0,
            monthlyBasicSalary: 32000,
            divisor: 261,
            taxAvailment: 'first_time'
          });

          // Test Mode A: Both Payable
          var bothCoex = calculateRetirementCoexistence({
            separationResult: sepResult,
            retirementResult: retResult,
            coexistenceMode: RETIREMENT_COEXISTENCE_MODES.BOTH_PAYABLE
          });

          // Test Mode B: Contractual Offset
          var offsetCoex = calculateRetirementCoexistence({
            separationResult: sepResult,
            retirementResult: retResult,
            coexistenceMode: RETIREMENT_COEXISTENCE_MODES.OFFSET
          });

          var bothPass = bothCoex.totalCombinedGross === 846344.83 &&
                         bothCoex.confirmedCombinedGross === 846344.83 &&
                         bothCoex.separationGrossDisbursed === 416000.00 &&
                         bothCoex.retirementGrossDisbursed === 430344.83 &&
                         bothCoex.confirmedRetirementGrossPayable === 430344.83 &&
                         bothCoex.provisionalRetirementGrossAmount === 0 &&
                         bothCoex.confirmedTaxExemptRetirement === 430344.83;

          var offsetPass = offsetCoex.totalCombinedGross === 430344.83 &&
                           offsetCoex.confirmedCombinedGross === 430344.83 &&
                           offsetCoex.separationGrossDisbursed === 416000.00 &&
                           offsetCoex.retirementGrossDisbursed === 14344.83 &&
                           offsetCoex.confirmedRetirementGrossPayable === 14344.83 &&
                           offsetCoex.offsetDeduction === 416000.00 &&
                           offsetCoex.provisionalOffsetDifference === 0 &&
                           offsetCoex.provisionalRetirementGrossAmount === 0 &&
                           offsetCoex.provisionalEntitlementAmount === 0 &&
                           offsetCoex.provisionalTaxClassificationAmount === 0 &&
                           offsetCoex.confirmedTaxExemptRetirement === 14344.83 &&
                           offsetCoex.offsetTaxStatus === RETIREMENT_TAX_STATUS.CONFIRMED_EXEMPT &&
                           offsetCoex.unconfirmedProvisionalRetirement === 0;

          return {
            passed: bothPass && offsetPass,
            details: {
              bothCoex: bothCoex,
              offsetCoex: offsetCoex
            }
          };
        }
      },
      {
        id: 'RET-21A',
        title: 'Final Pay Integration: Unknown employer coverage (Age 60, Svc 5y, MBS ₱30k) -> Provisional ₱155,172.41 excluded from confirmed net final pay',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 30000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 5,
            serviceMonths: 0,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'unknown',
              age: 60,
              serviceYears: 5,
              serviceMonths: 0,
              monthlyBasicSalary: 30000,
              divisor: 261
            }
          });
          var pass = fp.retirementPay.provisionalRetirementGrossAmount === 155172.41 &&
                     fp.retirementPay.confirmedRetirementGrossPayable === 0 &&
                     fp.taxReconciliation.taxExemptTotal === 0 &&
                     fp.taxReconciliation.taxableCompensationTotal === 0 &&
                     fp.taxReconciliation.unconfirmedProvisionalTotal === 155172.41 &&
                     fp.summary.confirmedRetirementGrossPayable === 0 &&
                     fp.summary.provisionalRetirementGrossAmount === 155172.41 &&
                     fp.summary.provisionalRetirementAdjustment === 155172.41 &&
                     fp.summary.provisionalRetirementStatus === RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL &&
                     fp.summary.confirmedGrossFinalPay === 0 &&
                     fp.summary.grossStatutoryFinalPay === 0 &&
                     fp.summary.confirmedNetFinalPay === 0 &&
                     fp.summary.statutoryNetFinalPay === 0;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              taxReconciliation: fp.taxReconciliation
            }
          };
        }
      },
      {
        id: 'RET-21B',
        title: 'Final Pay Integration: Verified covered employer & eligible employee -> Confirmed retirement flows into confirmed net payable',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              taxAvailment: 'first_time'
            }
          });
          var pass = fp.retirementPay.confirmedRetirementGrossPayable === 430344.83 &&
                     fp.retirementPay.provisionalRetirementGrossAmount === 0 &&
                     fp.taxReconciliation.taxExemptTotal === 430344.83 &&
                     fp.taxReconciliation.taxableCompensationTotal === 0 &&
                     fp.taxReconciliation.unconfirmedProvisionalTotal === 0 &&
                     fp.summary.confirmedRetirementGrossPayable === 430344.83 &&
                     fp.summary.provisionalRetirementAdjustment === 0 &&
                     fp.summary.provisionalRetirementStatus === RETIREMENT_TAX_STATUS.NOT_APPLICABLE &&
                     fp.summary.confirmedGrossFinalPay === 430344.83 &&
                     fp.summary.grossStatutoryFinalPay === 430344.83 &&
                     fp.summary.confirmedNetFinalPay === 430344.83 &&
                     fp.summary.statutoryNetFinalPay === 430344.83;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              taxReconciliation: fp.taxReconciliation
            }
          };
        }
      },
      {
        id: 'RET-21C',
        title: 'Final Pay Integration: Ineligible employee -> Zero provisional and zero confirmed retirement generated',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 30000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 4,
            serviceMonths: 0,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'unknown',
              age: 55,
              serviceYears: 4,
              serviceMonths: 0,
              monthlyBasicSalary: 30000,
              divisor: 261
            }
          });
          var pass = fp.retirementPay.confirmedRetirementGrossPayable === 0 &&
                     fp.retirementPay.provisionalRetirementGrossAmount === 0 &&
                     fp.summary.confirmedRetirementGrossPayable === 0 &&
                     fp.summary.provisionalRetirementGrossAmount === 0 &&
                     fp.summary.provisionalRetirementAdjustment === 0 &&
                     fp.summary.provisionalRetirementStatus === RETIREMENT_TAX_STATUS.NOT_APPLICABLE &&
                     fp.summary.confirmedNetFinalPay === 0 &&
                     fp.summary.statutoryNetFinalPay === 0;
          return {
            passed: pass,
            details: {
              summary: fp.summary
            }
          };
        }
      },
      {
        id: 'RET-21D',
        title: 'Final Pay Integration: Standard redundancy case without retirement input -> Existing net final pay unchanged',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 2,
            serviceMonths: 6,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            authorizedDeductions: {
              sssContribution: 1450,
              philHealthContribution: 800,
              pagIbigContribution: 200
            }
          });
          var pass = fp.retirementPay === null &&
                     fp.separationPay.amount === 96000.00 &&
                     fp.summary.grossStatutoryFinalPay === 96000.00 &&
                     fp.summary.confirmedGrossFinalPay === 96000.00 &&
                     fp.summary.totalAuthorizedDeductions === 2450.00 &&
                     fp.summary.statutoryNetFinalPay === 93550.00 &&
                     fp.summary.confirmedNetFinalPay === 93550.00 &&
                     fp.summary.provisionalRetirementAdjustment === 0;
          return {
            passed: pass,
            details: {
              summary: fp.summary
            }
          };
        }
      },
      {
        id: 'RET-21E',
        title: 'Final Pay Integration: Both separation pay (₱150k) and provisional retirement (₱155,172.41) -> Separation in confirmed net payable, provisional retirement kept separate',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 30000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 5,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            authorizedDeductions: {
              sssContribution: 1000
            },
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'unknown',
              age: 60,
              serviceYears: 5,
              serviceMonths: 0,
              monthlyBasicSalary: 30000,
              divisor: 261,
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.BOTH_PAYABLE
            }
          });
          var pass = fp.separationPay.amount === 150000.00 &&
                     fp.coexistenceLedger.separationGrossDisbursed === 150000.00 &&
                     fp.coexistenceLedger.confirmedRetirementGrossPayable === 0 &&
                     fp.coexistenceLedger.provisionalRetirementGrossAmount === 155172.41 &&
                     fp.summary.confirmedGrossFinalPay === 150000.00 &&
                     fp.summary.grossStatutoryFinalPay === 150000.00 &&
                     fp.summary.totalAuthorizedDeductions === 1000.00 &&
                     fp.summary.confirmedNetFinalPay === 149000.00 &&
                     fp.summary.statutoryNetFinalPay === 149000.00 &&
                     fp.summary.provisionalRetirementAdjustment === 155172.41 &&
                     fp.summary.provisionalRetirementStatus === RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL &&
                     fp.taxReconciliation.taxExemptTotal === 150000.00 &&
                     fp.taxReconciliation.taxableCompensationTotal === 0 &&
                     fp.taxReconciliation.unconfirmedProvisionalTotal === 155172.41;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger,
              taxReconciliation: fp.taxReconciliation
            }
          };
        }
      },
      {
        id: 'RET-22A',
        title: 'Higher-Of Defect Fix: Provisional retirement (₱155,172.41) vs confirmed separation (₱150,000) -> Confirmed separation ₱150k wins; provisional retirement ₱155,172.41 preserved separately',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 30000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 5,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'unknown',
              age: 60,
              serviceYears: 5,
              serviceMonths: 0,
              monthlyBasicSalary: 30000,
              divisor: 261,
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.HIGHER_OF
            }
          });
          var pass = fp.separationPay.amount === 150000.00 &&
                     fp.coexistenceLedger.separationGrossDisbursed === 150000.00 &&
                     fp.coexistenceLedger.confirmedRetirementGrossPayable === 0 &&
                     fp.coexistenceLedger.provisionalRetirementGrossAmount === 155172.41 &&
                     fp.coexistenceLedger.unconfirmedProvisionalRetirement === 155172.41 &&
                     fp.coexistenceLedger.confirmedCombinedGross === 150000.00 &&
                     fp.summary.confirmedGrossFinalPay === 150000.00 &&
                     fp.summary.grossStatutoryFinalPay === 150000.00 &&
                     fp.summary.confirmedNetFinalPay === 150000.00 &&
                     fp.summary.statutoryNetFinalPay === 150000.00 &&
                     fp.summary.confirmedRetirementGrossPayable === 0 &&
                     fp.summary.provisionalRetirementGrossAmount === 155172.41 &&
                     fp.summary.provisionalRetirementAdjustment === 155172.41 &&
                     fp.summary.provisionalRetirementStatus === RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger
            }
          };
        }
      },
      {
        id: 'RET-22B',
        title: 'Higher-Of: Verified confirmed retirement (₱430,344.83) vs confirmed separation (₱416,000) -> Confirmed retirement wins',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              taxAvailment: 'first_time',
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.HIGHER_OF
            }
          });
          var pass = fp.separationPay.amount === 416000.00 &&
                     fp.coexistenceLedger.separationGrossDisbursed === 0 &&
                     fp.coexistenceLedger.confirmedRetirementGrossPayable === 430344.83 &&
                     fp.coexistenceLedger.provisionalRetirementGrossAmount === 0 &&
                     fp.coexistenceLedger.confirmedCombinedGross === 430344.83 &&
                     fp.summary.confirmedGrossFinalPay === 430344.83 &&
                     fp.summary.confirmedNetFinalPay === 430344.83 &&
                     fp.summary.statutoryNetFinalPay === 430344.83;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger
            }
          };
        }
      },
      {
        id: 'RET-22C',
        title: 'Higher-Of: Confirmed separation (₱200,000) vs confirmed retirement (₱150,000) -> Separation wins',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 30000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 10,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            customSeparationPay: 200000,
            retirement: {
              planType: 'company_plan',
              employerCategory: 'private_retail_le10',
              age: 55,
              serviceYears: 10,
              serviceMonths: 0,
              monthlyBasicSalary: 30000,
              divisor: 261,
              companyPlanGrossAmount: 150000,
              hasBirTqpApproval: 'yes',
              isPlanIdentityMatched: 'yes',
              isEmployeeCoveredByPlan: 'yes',
              isPaidUnderTrust: 'yes',
              taxAvailment: 'first_time',
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.HIGHER_OF
            }
          });
          var pass = fp.separationPay.amount === 200000.00 &&
                     fp.retirementPay.confirmedRetirementGrossPayable === 150000.00 &&
                     fp.coexistenceLedger.separationGrossDisbursed === 200000.00 &&
                     fp.coexistenceLedger.confirmedRetirementGrossPayable === 0 &&
                     fp.coexistenceLedger.provisionalRetirementGrossAmount === 0 &&
                     fp.coexistenceLedger.confirmedCombinedGross === 200000.00 &&
                     fp.summary.confirmedGrossFinalPay === 200000.00 &&
                     fp.summary.confirmedNetFinalPay === 200000.00 &&
                     fp.summary.statutoryNetFinalPay === 200000.00;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger
            }
          };
        }
      },
      {
        id: 'RET-23',
        title: 'Offset Defect Fix: Unknown employer coverage (Provisional retirement ₱155,172.41 vs Confirmed separation ₱150,000) -> No offset calculated against unverified entitlement',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 30000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 5,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'unknown',
              age: 60,
              serviceYears: 5,
              serviceMonths: 0,
              monthlyBasicSalary: 30000,
              divisor: 261,
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.OFFSET
            }
          });
          var pass = fp.separationPay.amount === 150000.00 &&
                     fp.retirementPay.eligibilityStatus === 'PENDING_EMPLOYER_VERIFICATION' &&
                     fp.coexistenceLedger.separationGrossDisbursed === 150000.00 &&
                     fp.coexistenceLedger.offsetDeduction === 0 &&
                     fp.coexistenceLedger.retirementGrossDisbursed === 0 &&
                     fp.coexistenceLedger.confirmedRetirementGrossPayable === 0 &&
                     fp.coexistenceLedger.provisionalRetirementGrossAmount === 155172.41 &&
                     fp.coexistenceLedger.unconfirmedProvisionalRetirement === 155172.41 &&
                     fp.coexistenceLedger.offsetTaxStatus === RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL &&
                     fp.coexistenceLedger.offsetTaxNote.indexOf('EMPLOYER_COVERAGE_PENDING_VERIFICATION') === 0 &&
                     fp.summary.confirmedGrossFinalPay === 150000.00 &&
                     fp.summary.grossStatutoryFinalPay === 150000.00 &&
                     fp.summary.confirmedNetFinalPay === 150000.00 &&
                     fp.summary.statutoryNetFinalPay === 150000.00 &&
                     fp.summary.confirmedRetirementGrossPayable === 0 &&
                     fp.summary.provisionalRetirementGrossAmount === 155172.41 &&
                     fp.summary.provisionalRetirementAdjustment === 155172.41 &&
                     fp.summary.provisionalRetirementStatus === RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger
            }
          };
        }
      },
      {
        id: 'RET-24A',
        title: 'Both Payable Defect Fix: Confirmed statutory floor (₱430,344.83) + provisional plan-coverage excess (₱69,655.17) + separation (₱416,000) -> retirementGrossDisbursed excludes provisional entitlement excess',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            retirement: {
              planType: 'company_plan',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              companyPlanGrossAmount: 500000,
              hasBirTqpApproval: 'yes',
              isPlanIdentityMatched: 'yes',
              isEmployeeCoveredByPlan: 'unknown',
              isPaidUnderTrust: 'yes',
              taxAvailment: 'first_time',
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.BOTH_PAYABLE
            }
          });
          var pass = fp.coexistenceLedger.retirementGrossDisbursed === 430344.83 &&
                     fp.coexistenceLedger.confirmedRetirementGrossPayable === 430344.83 &&
                     fp.coexistenceLedger.provisionalRetirementGrossAmount === 69655.17 &&
                     fp.coexistenceLedger.separationGrossDisbursed === 416000.00 &&
                     fp.coexistenceLedger.offsetDeduction === 0 &&
                     fp.summary.confirmedGrossFinalPay === 846344.83 &&
                     fp.summary.confirmedNetFinalPay === 846344.83;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger
            }
          };
        }
      },
      {
        id: 'RET-24B',
        title: 'Higher-Of Defect Fix: Confirmed statutory floor (₱430,344.83) + provisional plan-coverage excess (₱69,655.17) vs separation (₱416,000) -> retirementGrossDisbursed is ₱430,344.83 (excludes provisional entitlement excess)',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            retirement: {
              planType: 'company_plan',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              companyPlanGrossAmount: 500000,
              hasBirTqpApproval: 'yes',
              isPlanIdentityMatched: 'yes',
              isEmployeeCoveredByPlan: 'unknown',
              isPaidUnderTrust: 'yes',
              taxAvailment: 'first_time',
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.HIGHER_OF
            }
          });
          var pass = fp.coexistenceLedger.retirementGrossDisbursed === 430344.83 &&
                     fp.coexistenceLedger.confirmedRetirementGrossPayable === 430344.83 &&
                     fp.coexistenceLedger.provisionalRetirementGrossAmount === 69655.17 &&
                     fp.coexistenceLedger.separationGrossDisbursed === 0 &&
                     fp.coexistenceLedger.offsetDeduction === 0 &&
                     fp.summary.confirmedGrossFinalPay === 430344.83 &&
                     fp.summary.confirmedNetFinalPay === 430344.83;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger
            }
          };
        }
      },
      {
        id: 'RET-24C',
        title: 'Offset Defect Fix: Confirmed statutory floor (₱430,344.83) + provisional plan-coverage excess (₱69,655.17) vs separation (₱416,000) -> Offset against confirmed floor only; confirmed retirement balance ₱14,344.83 payable; provisional excess ₱69,655.17 kept separate',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            retirement: {
              planType: 'company_plan',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              companyPlanGrossAmount: 500000,
              hasBirTqpApproval: 'yes',
              isPlanIdentityMatched: 'yes',
              isEmployeeCoveredByPlan: 'unknown',
              isPaidUnderTrust: 'yes',
              taxAvailment: 'first_time',
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.OFFSET
            }
          });
          var pass = fp.coexistenceLedger.retirementGrossDisbursed === 14344.83 &&
                     fp.coexistenceLedger.confirmedRetirementGrossPayable === 14344.83 &&
                     fp.coexistenceLedger.provisionalOffsetDifference === 0 &&
                     fp.coexistenceLedger.unverifiedPlanProvisionalAmount === 69655.17 &&
                     fp.coexistenceLedger.provisionalRetirementGrossAmount === 69655.17 &&
                     fp.coexistenceLedger.provisionalEntitlementAmount === 69655.17 &&
                     fp.coexistenceLedger.provisionalTaxClassificationAmount === 0 &&
                     fp.coexistenceLedger.separationGrossDisbursed === 416000.00 &&
                     fp.coexistenceLedger.offsetDeduction === 416000.00 &&
                     fp.coexistenceLedger.confirmedCombinedGross === 430344.83 &&
                     fp.summary.confirmedGrossFinalPay === 430344.83 &&
                     fp.summary.confirmedNetFinalPay === 430344.83 &&
                     fp.summary.provisionalEntitlementAmount === 69655.17 &&
                     fp.taxReconciliation.taxExemptTotal === 430344.83;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger
            }
          };
        }
      },
      {
        id: 'RET-24D',
        title: 'Offset Defect Fix: Unknown private-plan coverage (Age 52, Svc 12y, Plan ₱600k, Separation ₱150k) -> Zero offsetDeduction; confirmed separation ₱150k payable; provisional ₱600k kept separate',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 30000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 12,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            customSeparationPay: 150000,
            retirement: {
              planType: 'company_plan',
              employerCategory: 'private_general',
              age: 52,
              serviceYears: 12,
              serviceMonths: 0,
              monthlyBasicSalary: 30000,
              divisor: 261,
              companyPlanGrossAmount: 600000,
              hasBirTqpApproval: 'yes',
              isPlanIdentityMatched: 'yes',
              isEmployeeCoveredByPlan: 'unknown',
              isPaidUnderTrust: 'yes',
              taxAvailment: 'first_time',
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.OFFSET
            }
          });
          var pass = fp.coexistenceLedger.retirementGrossDisbursed === 0 &&
                     fp.coexistenceLedger.confirmedRetirementGrossPayable === 0 &&
                     fp.coexistenceLedger.provisionalRetirementGrossAmount === 600000.00 &&
                     fp.coexistenceLedger.separationGrossDisbursed === 150000.00 &&
                     fp.coexistenceLedger.offsetDeduction === 0 &&
                     fp.coexistenceLedger.offsetTaxStatus === RETIREMENT_TAX_STATUS.UNCONFIRMED_PROVISIONAL &&
                     fp.summary.confirmedGrossFinalPay === 150000.00 &&
                     fp.summary.confirmedNetFinalPay === 150000.00;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger
            }
          };
        }
      },
      {
        id: 'RET-25A',
        title: 'DEF-1 Fix (Scenario 3): Unknown prior tax-exemption history (Age 60, Svc 13y, Covered Employer, MBS ₱32k) -> Confirmed payable ₱430,344.83; Provisional tax ₱430,344.83; Provisional entitlement ₱0.00',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              taxAvailment: 'unknown'
            }
          });
          var pass = fp.retirementPay.confirmedBenefitEntitlement === 430344.83 &&
                     fp.retirementPay.confirmedRetirementGrossPayable === 430344.83 &&
                     fp.retirementPay.taxReconciliation.confirmedTaxExemptTotal === 0 &&
                     fp.retirementPay.taxReconciliation.confirmedTaxableTotal === 0 &&
                     fp.retirementPay.provisionalTaxClassificationAmount === 430344.83 &&
                     fp.retirementPay.provisionalEntitlementAmount === 0 &&
                     fp.retirementPay.provisionalRetirementGrossAmount === 0 &&
                     fp.taxReconciliation.taxExemptTotal === 0 &&
                     fp.taxReconciliation.taxableCompensationTotal === 0 &&
                     fp.taxReconciliation.provisionalTaxClassificationAmount === 430344.83 &&
                     fp.taxReconciliation.provisionalEntitlementAmount === 0 &&
                     fp.summary.confirmedGrossFinalPay === 430344.83 &&
                     fp.summary.confirmedNetFinalPay === 430344.83 &&
                     fp.summary.statutoryNetFinalPay === 430344.83;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              taxReconciliation: fp.taxReconciliation,
              retirementPay: fp.retirementPay
            }
          };
        }
      },
      {
        id: 'RET-25B',
        title: 'DEF-1 Regression: Repeat prior tax-exemption history (Age 60, Svc 13y, Covered Employer, MBS ₱32k) -> Confirmed payable & taxable ₱430,344.83; Provisional tax ₱0; Provisional entitlement ₱0',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              taxAvailment: 'repeat'
            }
          });
          var pass = fp.retirementPay.confirmedBenefitEntitlement === 430344.83 &&
                     fp.retirementPay.confirmedRetirementGrossPayable === 430344.83 &&
                     fp.retirementPay.taxReconciliation.confirmedTaxExemptTotal === 0 &&
                     fp.retirementPay.taxReconciliation.confirmedTaxableTotal === 430344.83 &&
                     fp.retirementPay.provisionalTaxClassificationAmount === 0 &&
                     fp.retirementPay.provisionalEntitlementAmount === 0 &&
                     fp.taxReconciliation.taxExemptTotal === 0 &&
                     fp.taxReconciliation.taxableCompensationTotal === 430344.83 &&
                     fp.taxReconciliation.provisionalTaxClassificationAmount === 0 &&
                     fp.taxReconciliation.provisionalEntitlementAmount === 0 &&
                     fp.summary.confirmedGrossFinalPay === 430344.83 &&
                     fp.summary.confirmedNetFinalPay === 430344.83;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              taxReconciliation: fp.taxReconciliation
            }
          };
        }
      },
      {
        id: 'RET-25C',
        title: 'DEF-1 Fix (Scenario 4): Age 67 with post-65 consent UNKNOWN (13 yrs, MBS ₱32k) -> Confirmed payable ₱430,344.83; Provisional tax ₱430,344.83; Provisional entitlement ₱0.00',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'private_general',
              age: 67,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              post65Consent: 'unknown',
              taxAvailment: 'first_time'
            }
          });
          var pass = fp.retirementPay.confirmedBenefitEntitlement === 430344.83 &&
                     fp.retirementPay.confirmedRetirementGrossPayable === 430344.83 &&
                     fp.retirementPay.taxReconciliation.confirmedTaxExemptTotal === 0 &&
                     fp.retirementPay.taxReconciliation.confirmedTaxableTotal === 0 &&
                     fp.retirementPay.provisionalTaxClassificationAmount === 430344.83 &&
                     fp.retirementPay.provisionalEntitlementAmount === 0 &&
                     fp.taxReconciliation.taxExemptTotal === 0 &&
                     fp.taxReconciliation.taxableCompensationTotal === 0 &&
                     fp.taxReconciliation.provisionalTaxClassificationAmount === 430344.83 &&
                     fp.taxReconciliation.provisionalEntitlementAmount === 0 &&
                     fp.summary.confirmedGrossFinalPay === 430344.83 &&
                     fp.summary.confirmedNetFinalPay === 430344.83;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              taxReconciliation: fp.taxReconciliation
            }
          };
        }
      },
      {
        id: 'RET-25D',
        title: 'DEF-1 Fix (Scenario 5): Age 67 with post-65 consent NO (13 yrs, MBS ₱32k) -> Confirmed payable ₱430,344.83; Provisional tax ₱430,344.83 (no assumed exemption or invented tax split); Provisional entitlement ₱0.00',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'private_general',
              age: 67,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              post65Consent: 'no',
              taxAvailment: 'first_time'
            }
          });
          var pass = fp.retirementPay.confirmedBenefitEntitlement === 430344.83 &&
                     fp.retirementPay.confirmedRetirementGrossPayable === 430344.83 &&
                     fp.retirementPay.taxReconciliation.confirmedTaxExemptTotal === 0 &&
                     fp.retirementPay.taxReconciliation.confirmedTaxableTotal === 0 &&
                     fp.retirementPay.provisionalTaxClassificationAmount === 430344.83 &&
                     fp.retirementPay.provisionalEntitlementAmount === 0 &&
                     fp.taxReconciliation.taxExemptTotal === 0 &&
                     fp.taxReconciliation.taxableCompensationTotal === 0 &&
                     fp.taxReconciliation.provisionalTaxClassificationAmount === 430344.83 &&
                     fp.taxReconciliation.provisionalEntitlementAmount === 0 &&
                     fp.summary.confirmedGrossFinalPay === 430344.83 &&
                     fp.summary.confirmedNetFinalPay === 430344.83;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              taxReconciliation: fp.taxReconciliation
            }
          };
        }
      },
      {
        id: 'RET-25E',
        title: 'DEF-1 Fix (Scenario 6): Company plan ₱500,000, Age 60, 13 yrs, Covered Employer, TQP approval unknown -> Confirmed payable ₱500k; Exempt ₱430,344.83; Provisional tax ₱69,655.17; Provisional entitlement ₱0',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            retirement: {
              planType: 'company_plan',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              companyPlanGrossAmount: 500000,
              hasBirTqpApproval: 'unknown',
              isPlanIdentityMatched: 'yes',
              isEmployeeCoveredByPlan: 'yes',
              isPaidUnderTrust: 'yes',
              taxAvailment: 'first_time'
            }
          });
          var pass = fp.retirementPay.confirmedBenefitEntitlement === 500000.00 &&
                     fp.retirementPay.confirmedRetirementGrossPayable === 500000.00 &&
                     fp.retirementPay.taxReconciliation.confirmedTaxExemptTotal === 430344.83 &&
                     fp.retirementPay.taxReconciliation.confirmedTaxableTotal === 0 &&
                     fp.retirementPay.provisionalTaxClassificationAmount === 69655.17 &&
                     fp.retirementPay.provisionalEntitlementAmount === 0 &&
                     fp.retirementPay.provisionalRetirementGrossAmount === 0 &&
                     fp.taxReconciliation.taxExemptTotal === 430344.83 &&
                     fp.taxReconciliation.taxableCompensationTotal === 0 &&
                     fp.taxReconciliation.provisionalTaxClassificationAmount === 69655.17 &&
                     fp.taxReconciliation.provisionalEntitlementAmount === 0 &&
                     fp.summary.confirmedGrossFinalPay === 500000.00 &&
                     fp.summary.confirmedNetFinalPay === 500000.00;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              taxReconciliation: fp.taxReconciliation,
              retirementPay: fp.retirementPay
            }
          };
        }
      },
      {
        id: 'RET-25F',
        title: 'DEF-1 Regression (Requirement 7): Unknown private-plan employee coverage (Age 52, Svc 12y, Plan ₱600k) -> Provisional entitlement ₱600k; Confirmed payable ₱0',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 40000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 12,
            serviceMonths: 0,
            retirement: {
              planType: 'company_plan',
              employerCategory: 'private_general',
              age: 52,
              serviceYears: 12,
              serviceMonths: 0,
              monthlyBasicSalary: 40000,
              divisor: 261,
              companyPlanGrossAmount: 600000,
              hasBirTqpApproval: 'yes',
              isPlanIdentityMatched: 'yes',
              isEmployeeCoveredByPlan: 'unknown',
              isPaidUnderTrust: 'yes',
              taxAvailment: 'first_time'
            }
          });
          var pass = fp.retirementPay.confirmedBenefitEntitlement === 0 &&
                     fp.retirementPay.confirmedRetirementGrossPayable === 0 &&
                     fp.retirementPay.provisionalEntitlementAmount === 600000.00 &&
                     fp.retirementPay.provisionalRetirementGrossAmount === 600000.00 &&
                     fp.retirementPay.provisionalTaxClassificationAmount === 0 &&
                     fp.taxReconciliation.taxExemptTotal === 0 &&
                     fp.taxReconciliation.taxableCompensationTotal === 0 &&
                     fp.taxReconciliation.provisionalTaxClassificationAmount === 0 &&
                     fp.taxReconciliation.provisionalEntitlementAmount === 600000.00 &&
                     fp.summary.confirmedGrossFinalPay === 0 &&
                     fp.summary.confirmedNetFinalPay === 0;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              taxReconciliation: fp.taxReconciliation
            }
          };
        }
      },
      {
        id: 'RET-25G',
        title: 'DEF-1 Regression (Requirement 7): Unknown RA 7641 employer coverage (Age 60, Svc 5y, MBS ₱30k) -> Provisional entitlement ₱155,172.41; Confirmed payable ₱0',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 30000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 5,
            serviceMonths: 0,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'unknown',
              age: 60,
              serviceYears: 5,
              serviceMonths: 0,
              monthlyBasicSalary: 30000,
              divisor: 261
            }
          });
          var pass = fp.retirementPay.confirmedBenefitEntitlement === 0 &&
                     fp.retirementPay.confirmedRetirementGrossPayable === 0 &&
                     fp.retirementPay.provisionalEntitlementAmount === 155172.41 &&
                     fp.retirementPay.provisionalRetirementGrossAmount === 155172.41 &&
                     fp.retirementPay.provisionalTaxClassificationAmount === 0 &&
                     fp.taxReconciliation.taxExemptTotal === 0 &&
                     fp.taxReconciliation.taxableCompensationTotal === 0 &&
                     fp.taxReconciliation.provisionalTaxClassificationAmount === 0 &&
                     fp.taxReconciliation.provisionalEntitlementAmount === 155172.41 &&
                     fp.summary.confirmedGrossFinalPay === 0 &&
                     fp.summary.confirmedNetFinalPay === 0;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              taxReconciliation: fp.taxReconciliation
            }
          };
        }
      },
      {
        id: 'RET-25H',
        title: 'DEF-1 Regression: Existing verified statutory retirement (Age 60, Svc 13y, MBS ₱32k, First-time) -> Confirmed payable & tax-exempt ₱430,344.83',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              taxAvailment: 'first_time'
            }
          });
          var pass = fp.retirementPay.confirmedBenefitEntitlement === 430344.83 &&
                     fp.retirementPay.confirmedRetirementGrossPayable === 430344.83 &&
                     fp.retirementPay.taxReconciliation.confirmedTaxExemptTotal === 430344.83 &&
                     fp.retirementPay.taxReconciliation.confirmedTaxableTotal === 0 &&
                     fp.retirementPay.provisionalTaxClassificationAmount === 0 &&
                     fp.retirementPay.provisionalEntitlementAmount === 0 &&
                     fp.summary.confirmedGrossFinalPay === 430344.83 &&
                     fp.summary.confirmedNetFinalPay === 430344.83;
          return {
            passed: pass,
            details: {
              summary: fp.summary
            }
          };
        }
      },
      {
        id: 'RET-25I',
        title: 'DEF-1 Regression: both_payable and higher_of modes with Company Plan ₱500k (TQP unknown, employee covered) + Separation ₱416k -> Full ₱500k retirement payable included in confirmed gross/net',
        customCheck: function() {
          var fpBoth = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            retirement: {
              planType: 'company_plan',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              companyPlanGrossAmount: 500000,
              hasBirTqpApproval: 'unknown',
              isPlanIdentityMatched: 'yes',
              isEmployeeCoveredByPlan: 'yes',
              isPaidUnderTrust: 'yes',
              taxAvailment: 'first_time',
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.BOTH_PAYABLE
            }
          });
          var fpHigher = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            retirement: {
              planType: 'company_plan',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              companyPlanGrossAmount: 500000,
              hasBirTqpApproval: 'unknown',
              isPlanIdentityMatched: 'yes',
              isEmployeeCoveredByPlan: 'yes',
              isPaidUnderTrust: 'yes',
              taxAvailment: 'first_time',
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.HIGHER_OF
            }
          });
          var passBoth = fpBoth.coexistenceLedger.retirementGrossDisbursed === 500000.00 &&
                         fpBoth.coexistenceLedger.confirmedRetirementGrossPayable === 500000.00 &&
                         fpBoth.coexistenceLedger.provisionalTaxClassificationAmount === 69655.17 &&
                         fpBoth.coexistenceLedger.provisionalEntitlementAmount === 0 &&
                         fpBoth.coexistenceLedger.separationGrossDisbursed === 416000.00 &&
                         fpBoth.summary.confirmedGrossFinalPay === 916000.00 &&
                         fpBoth.summary.confirmedNetFinalPay === 916000.00 &&
                         fpBoth.taxReconciliation.taxExemptTotal === 846344.83 &&
                         fpBoth.taxReconciliation.provisionalTaxClassificationAmount === 69655.17;

          var passHigher = fpHigher.coexistenceLedger.retirementGrossDisbursed === 500000.00 &&
                           fpHigher.coexistenceLedger.confirmedRetirementGrossPayable === 500000.00 &&
                           fpHigher.coexistenceLedger.provisionalTaxClassificationAmount === 69655.17 &&
                           fpHigher.coexistenceLedger.provisionalEntitlementAmount === 0 &&
                           fpHigher.coexistenceLedger.separationGrossDisbursed === 0 &&
                           fpHigher.summary.confirmedGrossFinalPay === 500000.00 &&
                           fpHigher.summary.confirmedNetFinalPay === 500000.00 &&
                           fpHigher.taxReconciliation.taxExemptTotal === 430344.83 &&
                           fpHigher.taxReconciliation.provisionalTaxClassificationAmount === 69655.17;

          return {
            passed: passBoth && passHigher,
            details: {
              fpBothSummary: fpBoth.summary,
              fpHigherSummary: fpHigher.summary
            }
          };
        }
      },
      {
        id: 'RET-25J',
        title: 'DEF-1 Regression: Existing separation-only calculation (Redundancy, 5 yrs, MBS ₱32k) -> Unchanged ₱160,000.00 gross/net/tax-exempt',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 5,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY
          });
          var pass = fp.retirementPay === null &&
                     fp.separationPay.amount === 160000.00 &&
                     fp.summary.confirmedGrossFinalPay === 160000.00 &&
                     fp.summary.confirmedNetFinalPay === 160000.00 &&
                     fp.taxReconciliation.taxExemptTotal === 160000.00 &&
                     fp.taxReconciliation.provisionalTaxClassificationAmount === 0 &&
                     fp.taxReconciliation.provisionalEntitlementAmount === 0;
          return {
            passed: pass,
            details: {
              summary: fp.summary
            }
          };
        }
      },
      {
        id: 'RET-26A',
        title: 'DEF-2 Fix (Main Scenario): Offset where both RA 7641 retirement (₱430,344.83) and Redundancy separation (₱416,000.00) are confirmed tax-exempt -> Confirmed retirement ₱14,344.83; Confirmed gross/net ₱430,344.83; Provisional entitlement ₱0.00',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              taxAvailment: 'first_time',
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.OFFSET
            }
          });
          var pass = fp.coexistenceLedger.separationGrossDisbursed === 416000.00 &&
                     fp.coexistenceLedger.confirmedRetirementGrossPayable === 14344.83 &&
                     fp.coexistenceLedger.retirementGrossDisbursed === 14344.83 &&
                     fp.coexistenceLedger.offsetDeduction === 416000.00 &&
                     fp.coexistenceLedger.confirmedCombinedGross === 430344.83 &&
                     fp.coexistenceLedger.provisionalEntitlementAmount === 0 &&
                     fp.coexistenceLedger.provisionalTaxClassificationAmount === 0 &&
                     fp.summary.confirmedRetirementGrossPayable === 14344.83 &&
                     fp.summary.provisionalEntitlementAmount === 0 &&
                     fp.summary.provisionalTaxClassificationAmount === 0 &&
                     fp.summary.confirmedGrossFinalPay === 430344.83 &&
                     fp.summary.confirmedNetFinalPay === 430344.83 &&
                     fp.taxReconciliation.taxExemptTotal === 430344.83 &&
                     fp.taxReconciliation.taxableCompensationTotal === 0;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger,
              taxReconciliation: fp.taxReconciliation
            }
          };
        }
      },
      {
        id: 'RET-26B',
        title: 'DEF-2 Fix: Offset where retirement tax availment is unknown (₱430,344.83) vs Redundancy (₱416,000.00) -> Confirmed retirement ₱14,344.83; Confirmed gross/net ₱430,344.83; Provisional tax classification ₱14,344.83; Provisional entitlement ₱0.00',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              taxAvailment: 'unknown',
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.OFFSET
            }
          });
          var pass = fp.coexistenceLedger.separationGrossDisbursed === 416000.00 &&
                     fp.coexistenceLedger.confirmedRetirementGrossPayable === 14344.83 &&
                     fp.coexistenceLedger.retirementGrossDisbursed === 14344.83 &&
                     fp.coexistenceLedger.offsetDeduction === 416000.00 &&
                     fp.coexistenceLedger.confirmedCombinedGross === 430344.83 &&
                     fp.coexistenceLedger.provisionalEntitlementAmount === 0 &&
                     fp.coexistenceLedger.provisionalTaxClassificationAmount === 14344.83 &&
                     fp.summary.confirmedRetirementGrossPayable === 14344.83 &&
                     fp.summary.provisionalEntitlementAmount === 0 &&
                     fp.summary.provisionalTaxClassificationAmount === 14344.83 &&
                     fp.summary.confirmedGrossFinalPay === 430344.83 &&
                     fp.summary.confirmedNetFinalPay === 430344.83 &&
                     fp.taxReconciliation.taxExemptTotal === 416000.00 &&
                     fp.taxReconciliation.taxableCompensationTotal === 0 &&
                     fp.taxReconciliation.provisionalTaxClassificationAmount === 14344.83 &&
                     fp.taxReconciliation.provisionalEntitlementAmount === 0;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger,
              taxReconciliation: fp.taxReconciliation
            }
          };
        }
      },
      {
        id: 'RET-26C',
        title: 'DEF-2 Fix: Offset where retirement is taxable (repeat availment, ₱430,344.83) vs tax-exempt Redundancy (₱416,000.00) -> Confirmed retirement ₱14,344.83; Provisional tax classification ₱14,344.83 (no invented priority); Provisional entitlement ₱0.00',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              taxAvailment: 'repeat',
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.OFFSET
            }
          });
          var pass = fp.coexistenceLedger.separationGrossDisbursed === 416000.00 &&
                     fp.coexistenceLedger.confirmedRetirementGrossPayable === 14344.83 &&
                     fp.coexistenceLedger.retirementGrossDisbursed === 14344.83 &&
                     fp.coexistenceLedger.confirmedCombinedGross === 430344.83 &&
                     fp.coexistenceLedger.provisionalEntitlementAmount === 0 &&
                     fp.coexistenceLedger.provisionalTaxClassificationAmount === 14344.83 &&
                     fp.summary.confirmedGrossFinalPay === 430344.83 &&
                     fp.summary.confirmedNetFinalPay === 430344.83 &&
                     fp.taxReconciliation.taxExemptTotal === 416000.00 &&
                     fp.taxReconciliation.taxableCompensationTotal === 0 &&
                     fp.taxReconciliation.provisionalTaxClassificationAmount === 14344.83 &&
                     fp.taxReconciliation.provisionalEntitlementAmount === 0;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger,
              taxReconciliation: fp.taxReconciliation
            }
          };
        }
      },
      {
        id: 'RET-26D',
        title: 'DEF-2 Fix: Offset where Separation pay (₱500,000.00) exceeds confirmed Retirement pay (₱430,344.83) -> Confirmed separation ₱500,000.00; Confirmed retirement ₱0.00 (never negative); Offset deduction ₱430,344.83',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            customSeparationPay: 500000,
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              taxAvailment: 'first_time',
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.OFFSET
            }
          });
          var pass = fp.coexistenceLedger.separationGrossDisbursed === 500000.00 &&
                     fp.coexistenceLedger.confirmedRetirementGrossPayable === 0 &&
                     fp.coexistenceLedger.retirementGrossDisbursed === 0 &&
                     fp.coexistenceLedger.offsetDeduction === 430344.83 &&
                     fp.coexistenceLedger.confirmedCombinedGross === 500000.00 &&
                     fp.coexistenceLedger.provisionalEntitlementAmount === 0 &&
                     fp.coexistenceLedger.provisionalTaxClassificationAmount === 0 &&
                     fp.summary.confirmedGrossFinalPay === 500000.00 &&
                     fp.summary.confirmedNetFinalPay === 500000.00 &&
                     fp.taxReconciliation.taxExemptTotal === 500000.00;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger
            }
          };
        }
      },
      {
        id: 'RET-26E',
        title: 'DEF-2 Fix: No double deduction of offsetDeduction (₱416,000.00) and no double counting in confirmed gross (₱430,344.83) or net (₱427,894.83 after ₱2,450.00 authorized payroll deductions)',
        customCheck: function() {
          var fp = calculateFinalPay({
            monthlyBasicSalary: 32000,
            divisor: 261,
            daysWorkedInCutoff: 0,
            serviceYears: 13,
            serviceMonths: 0,
            separationCause: SEPARATION_CAUSES.REDUNDANCY,
            authorizedDeductions: {
              sssContribution: 1450,
              philHealthContribution: 800,
              pagIbigContribution: 200
            },
            retirement: {
              planType: 'statutory_only',
              employerCategory: 'private_general',
              age: 60,
              serviceYears: 13,
              serviceMonths: 0,
              monthlyBasicSalary: 32000,
              divisor: 261,
              taxAvailment: 'first_time',
              coexistenceMode: RETIREMENT_COEXISTENCE_MODES.OFFSET
            }
          });
          var pass = fp.coexistenceLedger.offsetDeduction === 416000.00 &&
                     fp.coexistenceLedger.separationGrossDisbursed === 416000.00 &&
                     fp.coexistenceLedger.retirementGrossDisbursed === 14344.83 &&
                     fp.summary.confirmedGrossFinalPay === 430344.83 &&
                     fp.summary.totalAuthorizedDeductions === 2450.00 &&
                     fp.summary.confirmedNetFinalPay === 427894.83 &&
                     fp.summary.statutoryNetFinalPay === 427894.83;
          return {
            passed: pass,
            details: {
              summary: fp.summary,
              coexistenceLedger: fp.coexistenceLedger
            }
          };
        }
      }
    ];

    var results = [];
    for (var r = 0; r < retTestCases.length; r++) {
      var tc = retTestCases[r];
      if (tc.customCheck) {
        var customRes = tc.customCheck();
        results.push({
          id: tc.id,
          title: tc.title,
          passed: customRes.passed,
          failedFields: customRes.passed ? [] : ['custom_reconciliation_check'],
          actual: customRes.details,
          expected: tc.title
        });
        continue;
      }

      var actual = calculateRetirementPay(tc.params);
      var exp = tc.expected;
      var failedFields = [];

      var checkKeys = [
        'isStatutorilyEligible',
        'isCoveragePending',
        'eligibilityStatus',
        'roundingSensitivityFlag',
        'confirmedRetirementGrossPayable',
        'provisionalRetirementGrossAmount',
        'provisionalTaxClassificationAmount',
        'provisionalEntitlementAmount',
        'totalGrossRetirementPayable'
      ];
      for (var k = 0; k < checkKeys.length; k++) {
        var key = checkKeys[k];
        if (exp[key] !== undefined && actual[key] !== exp[key]) {
          failedFields.push(key + ' (exp: ' + exp[key] + ', act: ' + actual[key] + ')');
        }
      }

      var taxRec = actual.taxReconciliation || {};
      if (exp.confirmedTaxExemptTotal !== undefined && taxRec.confirmedTaxExemptTotal !== exp.confirmedTaxExemptTotal) {
        failedFields.push('confirmedTaxExemptTotal (exp: ' + exp.confirmedTaxExemptTotal + ', act: ' + taxRec.confirmedTaxExemptTotal + ')');
      }
      if (exp.confirmedTaxableTotal !== undefined && taxRec.confirmedTaxableTotal !== exp.confirmedTaxableTotal) {
        failedFields.push('confirmedTaxableTotal (exp: ' + exp.confirmedTaxableTotal + ', act: ' + taxRec.confirmedTaxableTotal + ')');
      }
      if (exp.unconfirmedProvisionalTotal !== undefined && taxRec.unconfirmedProvisionalTotal !== exp.unconfirmedProvisionalTotal) {
        failedFields.push('unconfirmedProvisionalTotal (exp: ' + exp.unconfirmedProvisionalTotal + ', act: ' + taxRec.unconfirmedProvisionalTotal + ')');
      }
      if (exp.overallTaxStatus !== undefined && taxRec.overallTaxStatus !== exp.overallTaxStatus) {
        failedFields.push('overallTaxStatus (exp: ' + exp.overallTaxStatus + ', act: ' + taxRec.overallTaxStatus + ')');
      }

      results.push({
        id: tc.id,
        title: tc.title,
        passed: failedFields.length === 0,
        failedFields: failedFields,
        actual: {
          isStatutorilyEligible: actual.isStatutorilyEligible,
          isCoveragePending: actual.isCoveragePending,
          eligibilityStatus: actual.eligibilityStatus,
          roundingSensitivityFlag: actual.roundingSensitivityFlag,
          confirmedRetirementGrossPayable: actual.confirmedRetirementGrossPayable,
          provisionalRetirementGrossAmount: actual.provisionalRetirementGrossAmount,
          provisionalTaxClassificationAmount: actual.provisionalTaxClassificationAmount,
          provisionalEntitlementAmount: actual.provisionalEntitlementAmount,
          totalGrossRetirementPayable: actual.totalGrossRetirementPayable,
          confirmedTaxExemptTotal: taxRec.confirmedTaxExemptTotal,
          confirmedTaxableTotal: taxRec.confirmedTaxableTotal,
          unconfirmedProvisionalTotal: taxRec.unconfirmedProvisionalTotal,
          overallTaxStatus: taxRec.overallTaxStatus
        },
        expected: exp
      });
    }

    return results;
  }

  return {
    DIVISORS: DIVISORS,
    SEPARATION_CAUSES: SEPARATION_CAUSES,
    STATUTORY_CONSTANTS: STATUTORY_CONSTANTS,
    RETIREMENT_CONSTANTS: RETIREMENT_CONSTANTS,
    RETIREMENT_ENTITLEMENT_STATUS: RETIREMENT_ENTITLEMENT_STATUS,
    RETIREMENT_TAX_STATUS: RETIREMENT_TAX_STATUS,
    RETIREMENT_EMPLOYER_COVERAGE: RETIREMENT_EMPLOYER_COVERAGE,
    RETIREMENT_COEXISTENCE_MODES: RETIREMENT_COEXISTENCE_MODES,
    round2: round2,
    parseCleanNumber: parseCleanNumber,
    calculateDailyRate: calculateDailyRate,
    calculateUnpaidSalary: calculateUnpaidSalary,
    calculate13thMonthPay: calculate13thMonthPay,
    calculateCreditedYears: calculateCreditedYears,
    calculateSeparationPay: calculateSeparationPay,
    calculateLeaveMonetization: calculateLeaveMonetization,
    classifyRetirementEmployerCoverage: classifyRetirementEmployerCoverage,
    evaluateStatutoryFloorComponent: evaluateStatutoryFloorComponent,
    evaluateStatutoryTopUpComponent: evaluateStatutoryTopUpComponent,
    evaluateQualifiedPrivatePlanComponent: evaluateQualifiedPrivatePlanComponent,
    evaluateContractualEarlyRetirementComponent: evaluateContractualEarlyRetirementComponent,
    evaluateCompanyPlanExcessComponent: evaluateCompanyPlanExcessComponent,
    calculateRetirementPay: calculateRetirementPay,
    calculateRetirementCoexistence: calculateRetirementCoexistence,
    calculateFinalPay: calculateFinalPay,
    formatPHP: formatPHP,
    runStage1Tests: runStage1Tests,
    runSILEdgeCaseTests: runSILEdgeCaseTests,
    runRetirementEngineTests: runRetirementEngineTests
  };
});
