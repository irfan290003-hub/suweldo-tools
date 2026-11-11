import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CALCULATOR_SCRIPT_PATH = resolve(process.cwd(), 'public/js/thirteenth-month-calculator.js');
const CALCULATOR_SCRIPT_CODE = readFileSync(CALCULATOR_SCRIPT_PATH, 'utf8');

interface MockElement {
  id: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  textContent: string;
  className: string;
  validity: { badInput: boolean };
  classList: {
    classes: Set<string>;
    add: (...tokens: string[]) => void;
    remove: (...tokens: string[]) => void;
    toggle: (token: string, force?: boolean) => boolean;
    contains: (token: string) => boolean;
  };
  attributes: Record<string, string>;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, val: string) => void;
  listeners: Record<string, Array<(event?: unknown) => void>>;
  addEventListener: (type: string, listener: (event?: unknown) => void) => void;
  dispatchEvent: (type: string, event?: unknown) => void;
  click: () => void;
}

function createMockElement(id: string, initialValue = '', attrs: Record<string, string> = {}): MockElement {
  const classes = new Set<string>();
  const listeners: Record<string, Array<(event?: unknown) => void>> = {};
  const attributes: Record<string, string> = { ...attrs };

  const el: MockElement = {
    id,
    value: initialValue,
    checked: false,
    disabled: false,
    textContent: '',
    className: '',
    validity: { badInput: false },
    classList: {
      classes,
      add: (...tokens: string[]) => {
        for (const t of tokens) classes.add(t);
      },
      remove: (...tokens: string[]) => {
        for (const t of tokens) classes.delete(t);
      },
      toggle: (token: string, force?: boolean) => {
        if (force === true) {
          classes.add(token);
          return true;
        }
        if (force === false) {
          classes.delete(token);
          return false;
        }
        if (classes.has(token)) {
          classes.delete(token);
          return false;
        }
        classes.add(token);
        return true;
      },
      contains: (token: string) => classes.has(token),
    },
    attributes,
    getAttribute: (name: string) => (name in attributes ? attributes[name] : null),
    setAttribute: (name: string, val: string) => {
      attributes[name] = val;
    },
    listeners,
    addEventListener: (type: string, listener: (event?: unknown) => void) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(listener);
    },
    dispatchEvent: (type: string, event?: unknown) => {
      const list = listeners[type] || [];
      for (const fn of list) {
        fn.call(el, event);
      }
    },
    click: () => {
      el.dispatchEvent('click', { preventDefault: () => {} });
    },
  };

  return el;
}

function createCalculatorHarness(locale: 'en' | 'tl' = 'en') {
  const elements: Record<string, MockElement> = {
    tmMonthlySalary: createMockElement('tmMonthlySalary', '25000'),
    tmMonthsWorked: createMockElement('tmMonthsWorked', '12'),
    tmExactTotal: createMockElement('tmExactTotal', '300000'),
    tmCustomTotalToggle: createMockElement('tmCustomTotalToggle', ''),
    tmCustomTotalContainer: createMockElement('tmCustomTotalContainer', ''),
    tmOtherBenefits: createMockElement('tmOtherBenefits', '0'),
    tmResetBtn: createMockElement('tmResetBtn', ''),
    tmValidationAlert: createMockElement('tmValidationAlert', ''),
    tmResGrossPay: createMockElement('tmResGrossPay', ''),
    tmResProratedBadge: createMockElement('tmResProratedBadge', ''),
    tmResCalculationFormula: createMockElement('tmResCalculationFormula', ''),
    tmResTotalEarned: createMockElement('tmResTotalEarned', ''),
    tmResMonthsWorked: createMockElement('tmResMonthsWorked', ''),
    tmResMonthlyEquivalent: createMockElement('tmResMonthlyEquivalent', ''),
    tmResEligibilityNote: createMockElement('tmResEligibilityNote', ''),
    tmResTaxExemptPortion: createMockElement('tmResTaxExemptPortion', ''),
    tmResTaxableExcess: createMockElement('tmResTaxableExcess', ''),
    tmResTotalBenefits: createMockElement('tmResTotalBenefits', ''),
    tmResTaxBadge: createMockElement('tmResTaxBadge', ''),
    tmResTaxExplanation: createMockElement('tmResTaxExplanation', ''),
  };

  elements.tmCustomTotalContainer.classList.add('hidden');
  elements.tmValidationAlert.classList.add('hidden');
  elements.tmResEligibilityNote.classList.add('hidden');

  const presetMonthsButtons = ['3', '6', '9', '12'].map((m) =>
    createMockElement(`preset-month-${m}`, '', { 'data-months-preset': m })
  );

  const mockWindow: Record<string, unknown> = {
    location: {
      pathname: locale === 'tl' ? '/tl/13th-month-pay-calculator/' : '/13th-month-pay-calculator/',
      search: '',
      href:
        locale === 'tl'
          ? 'https://suweldotools.com/tl/13th-month-pay-calculator/'
          : 'https://suweldotools.com/13th-month-pay-calculator/',
    },
    innerWidth: 1280,
    innerHeight: 800,
  };

  const mockDocument = {
    documentElement: {
      lang: locale === 'tl' ? 'tl-PH' : 'en-PH',
    },
    readyState: 'complete',
    activeElement: null,
    addEventListener: () => {},
    getElementById: (id: string) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (selector === '[data-months-preset]') {
        return presetMonthsButtons;
      }
      return [];
    },
  };

  const runner = new Function('window', 'document', CALCULATOR_SCRIPT_CODE);
  runner(mockWindow, mockDocument);

  const engine = mockWindow.ThirteenthMonthCalculator as {
    calculate13thMonth: (params: {
      monthlySalary: number | string;
      monthsWorked: number | string;
      exactTotalEarned: number | string | null;
      otherBenefits: number | string;
    }) => {
      monthlySalary: number;
      effectiveMonthlySalary: number;
      monthsWorked: number;
      totalBasicEarned: number;
      isCustomTotal: boolean;
      gross13thMonth: number;
      isProrated: boolean;
      isEligible: boolean;
      otherBenefits: number;
      totalAggregateBenefits: number;
      taxExemptionCap: number;
      taxExemptPortion: number;
      potentialTaxableExcess: number;
    };
    formatPHP: (amount: number) => string;
    recalculate: () => void;
    config: {
      year: number;
      annualDivisor: number;
      minimumServiceMonths: number;
      taxExemptionCap: number;
    };
  };

  return { elements, presetMonthsButtons, engine };
}

describe('13th Month Pay Calculator — Issue 3A & Statutory Verification', () => {
  it('1. Standard full-year calculation (PD 851: total basic salary earned ÷ 12)', () => {
    const { elements, engine } = createCalculatorHarness('en');

    const res = engine.calculate13thMonth({
      monthlySalary: 25000,
      monthsWorked: 12,
      exactTotalEarned: null,
      otherBenefits: 0,
    });

    assert.equal(res.isCustomTotal, false);
    assert.equal(res.totalBasicEarned, 300000);
    assert.equal(res.gross13thMonth, 25000);
    assert.equal(res.effectiveMonthlySalary, 25000);
    assert.equal(res.isProrated, false);
    assert.equal(res.isEligible, true);
    assert.equal(res.taxExemptPortion, 25000);
    assert.equal(res.potentialTaxableExcess, 0);

    assert.equal(elements.tmResGrossPay.textContent, '₱25,000.00');
    assert.equal(elements.tmResTotalEarned.textContent, '₱300,000.00');
    assert.equal(elements.tmResMonthlyEquivalent.textContent, '₱25,000.00');
    assert.equal(elements.tmResProratedBadge.textContent, 'Full Calendar Year (12/12 mos)');
    assert.equal(elements.tmResCalculationFormula.textContent, '₱300,000.00 ÷ 12 months = ₱25,000.00');
  });

  it('2. Standard prorated calculation (e.g., 6 months worked)', () => {
    const { elements, engine } = createCalculatorHarness('en');

    elements.tmMonthlySalary.value = '30000';
    elements.tmMonthsWorked.value = '6';
    engine.recalculate();

    assert.equal(elements.tmResTotalEarned.textContent, '₱180,000.00');
    assert.equal(elements.tmResGrossPay.textContent, '₱15,000.00');
    assert.equal(elements.tmResMonthlyEquivalent.textContent, '₱30,000.00');
    assert.equal(elements.tmResProratedBadge.textContent, 'Prorated Estimate (6/12 mos)');
    assert.equal(elements.tmResCalculationFormula.textContent, '₱180,000.00 ÷ 12 months = ₱15,000.00');
  });

  it('3. ₱90,000 TRAIN Law aggregate tax-exempt threshold and excess calculation', () => {
    const { elements, engine } = createCalculatorHarness('en');

    elements.tmMonthlySalary.value = '80000';
    elements.tmMonthsWorked.value = '12';
    elements.tmOtherBenefits.value = '25000';
    engine.recalculate();

    assert.equal(elements.tmResGrossPay.textContent, '₱80,000.00');
    assert.equal(elements.tmResTotalBenefits.textContent, '₱105,000.00');
    assert.equal(elements.tmResTaxExemptPortion.textContent, '₱90,000.00');
    assert.equal(elements.tmResTaxableExcess.textContent, '₱15,000.00');
    assert.equal(elements.tmResTaxBadge.textContent, 'Exceeds ₱90,000 Cap');
  });

  it('4. Custom mode with blank input returns zero and does NOT fall back to monthlySalary × monthsWorked', () => {
    const { elements, engine } = createCalculatorHarness('en');

    elements.tmMonthlySalary.value = '25000';
    elements.tmMonthsWorked.value = '12';
    elements.tmCustomTotalToggle.checked = true;
    elements.tmExactTotal.value = '';
    engine.recalculate();

    assert.equal(elements.tmResGrossPay.textContent, '₱0.00');
    assert.equal(elements.tmResTotalEarned.textContent, '₱0.00');
    assert.equal(elements.tmResMonthlyEquivalent.textContent, '₱0.00');
    assert.equal(elements.tmResCalculationFormula.textContent, '₱0.00 ÷ 12 months = ₱0.00');
    assert.equal(elements.tmResProratedBadge.textContent, 'No Basic Salary Entered');
  });

  it('5. Custom mode with ₱180,000 over 6 months returns ₱15,000 gross and ₱30,000 effective monthly equivalent', () => {
    const { elements, engine } = createCalculatorHarness('en');

    elements.tmMonthlySalary.value = '25000';
    elements.tmMonthsWorked.value = '6';
    elements.tmCustomTotalToggle.checked = true;
    elements.tmExactTotal.value = '180000';
    engine.recalculate();

    assert.equal(elements.tmResTotalEarned.textContent, '₱180,000.00');
    assert.equal(elements.tmResGrossPay.textContent, '₱15,000.00');
    assert.equal(elements.tmResMonthlyEquivalent.textContent, '₱30,000.00');
    assert.equal(elements.tmResProratedBadge.textContent, 'Custom Annual Earnings');

    // Also verify when monthsWorked is 0 in custom mode (effectiveMonthlySalary = totalBasicEarned / 12)
    elements.tmMonthsWorked.value = '0';
    engine.recalculate();
    assert.equal(elements.tmResGrossPay.textContent, '₱15,000.00');
    assert.equal(elements.tmResMonthlyEquivalent.textContent, '₱15,000.00');
    assert.equal(elements.tmResProratedBadge.textContent, 'Custom Annual Earnings');
  });

  it('6. Custom mode badge in English and Filipino (both positive and zero custom earnings)', () => {
    const enHarness = createCalculatorHarness('en');
    enHarness.elements.tmMonthsWorked.value = '6';
    enHarness.elements.tmCustomTotalToggle.checked = true;
    enHarness.elements.tmExactTotal.value = '180000';
    enHarness.engine.recalculate();
    assert.equal(enHarness.elements.tmResProratedBadge.textContent, 'Custom Annual Earnings');

    enHarness.elements.tmExactTotal.value = '0';
    enHarness.engine.recalculate();
    assert.equal(enHarness.elements.tmResProratedBadge.textContent, 'No Basic Salary Entered');

    const tlHarness = createCalculatorHarness('tl');
    tlHarness.elements.tmMonthsWorked.value = '6';
    tlHarness.elements.tmCustomTotalToggle.checked = true;
    tlHarness.elements.tmExactTotal.value = '180000';
    tlHarness.engine.recalculate();
    assert.equal(tlHarness.elements.tmResProratedBadge.textContent, 'Custom na Taunang Kita');

    tlHarness.elements.tmExactTotal.value = '';
    tlHarness.engine.recalculate();
    assert.equal(tlHarness.elements.tmResProratedBadge.textContent, 'Walang Nailagay na Basic Salary');
  });

  it('7. Zero, negative, decimal, invalid/badInput, and large custom values', () => {
    const { elements, engine } = createCalculatorHarness('en');
    elements.tmCustomTotalToggle.checked = true;

    // Zero value
    elements.tmExactTotal.value = '0';
    engine.recalculate();
    assert.equal(elements.tmResGrossPay.textContent, '₱0.00');
    assert.equal(elements.tmResMonthlyEquivalent.textContent, '₱0.00');
    assert.equal(elements.tmResProratedBadge.textContent, 'No Basic Salary Entered');
    assert.equal(elements.tmValidationAlert.classList.contains('hidden'), true);

    // Negative value
    elements.tmExactTotal.value = '-15000';
    engine.recalculate();
    assert.equal(elements.tmResGrossPay.textContent, '₱0.00');
    assert.equal(elements.tmResMonthlyEquivalent.textContent, '₱0.00');
    assert.equal(elements.tmResProratedBadge.textContent, 'No Basic Salary Entered');
    assert.equal(elements.tmValidationAlert.classList.contains('hidden'), false);
    assert.equal(
      elements.tmValidationAlert.textContent.includes('Actual total basic salary earned cannot be negative.'),
      true
    );

    // Browser badInput simulation (when user types invalid text into <input type="number"> and browser exposes value === "")
    elements.tmExactTotal.value = '';
    elements.tmExactTotal.validity.badInput = true;
    engine.recalculate();
    assert.equal(elements.tmResGrossPay.textContent, '₱0.00');
    assert.equal(elements.tmResTotalEarned.textContent, '₱0.00');
    assert.equal(elements.tmResProratedBadge.textContent, 'No Basic Salary Entered');
    assert.equal(elements.tmValidationAlert.classList.contains('hidden'), false);
    assert.equal(
      elements.tmValidationAlert.textContent.includes(
        'Please enter a valid number for actual total basic salary earned.'
      ),
      true
    );
    elements.tmExactTotal.validity.badInput = false;

    // Decimal custom value with currency rounding (₱100,000.55 over 7 months)
    elements.tmMonthsWorked.value = '7';
    elements.tmExactTotal.value = '100000.55';
    engine.recalculate();
    // Gross 13th = 100000.55 / 12 = 8333.379166... -> ₱8,333.38
    // Effective monthly = 100000.55 / 7 = 14285.792857... -> ₱14,285.79
    assert.equal(elements.tmResGrossPay.textContent, '₱8,333.38');
    assert.equal(elements.tmResMonthlyEquivalent.textContent, '₱14,285.79');
    assert.equal(elements.tmResProratedBadge.textContent, 'Custom Annual Earnings');

    // Large custom value exceeding ₱90,000 tax-exempt cap (₱2,400,000 over 12 months)
    elements.tmMonthsWorked.value = '12';
    elements.tmExactTotal.value = '2400000';
    elements.tmOtherBenefits.value = '0';
    engine.recalculate();
    assert.equal(elements.tmResGrossPay.textContent, '₱200,000.00');
    assert.equal(elements.tmResMonthlyEquivalent.textContent, '₱200,000.00');
    assert.equal(elements.tmResTaxExemptPortion.textContent, '₱90,000.00');
    assert.equal(elements.tmResTaxableExcess.textContent, '₱110,000.00');
    assert.equal(elements.tmResProratedBadge.textContent, 'Custom Annual Earnings');
  });

  it('8. Reset behavior restores default values and normal mode', () => {
    const { elements, engine } = createCalculatorHarness('en');

    elements.tmMonthlySalary.value = '45000';
    elements.tmMonthsWorked.value = '5';
    elements.tmOtherBenefits.value = '10000';
    elements.tmCustomTotalToggle.checked = true;
    elements.tmCustomTotalContainer.classList.remove('hidden');
    elements.tmExactTotal.value = '180000';
    engine.recalculate();

    assert.equal(elements.tmResGrossPay.textContent, '₱15,000.00');
    assert.equal(elements.tmResProratedBadge.textContent, 'Custom Annual Earnings');

    // Trigger Reset button click
    elements.tmResetBtn.click();

    assert.equal(elements.tmMonthlySalary.value, '25000');
    assert.equal(elements.tmMonthsWorked.value, '12');
    assert.equal(elements.tmOtherBenefits.value, '0');
    assert.equal(elements.tmCustomTotalToggle.checked, false);
    assert.equal(elements.tmCustomTotalContainer.classList.contains('hidden'), true);
    assert.equal(elements.tmExactTotal.value, '300000.00');
    assert.equal(elements.tmResGrossPay.textContent, '₱25,000.00');
    assert.equal(elements.tmResTotalEarned.textContent, '₱300,000.00');
    assert.equal(elements.tmResMonthlyEquivalent.textContent, '₱25,000.00');
    assert.equal(elements.tmResProratedBadge.textContent, 'Full Calendar Year (12/12 mos)');
  });
});
