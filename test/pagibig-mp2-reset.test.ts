import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCRIPT_PATH = resolve(process.cwd(), 'public/js/pagibig-mp2-calculator.js');
const SCRIPT_CODE = readFileSync(SCRIPT_PATH, 'utf8');

const EN_HTML_PATH = resolve(process.cwd(), 'pagibig-mp2-savings-estimator/index.html');
const TL_HTML_PATH = resolve(process.cwd(), 'tl/pagibig-mp2-savings-estimator/index.html');

interface MockElement {
  id: string;
  tagName: string;
  value: string;
  validity: {
    badInput: boolean;
  };
  textContent: string;
  className: string;
  firstChild: MockElement | null;
  children: MockElement[];
  appendChild: (child: MockElement) => MockElement;
  removeChild: (child: MockElement) => MockElement;
  contains: (other: unknown) => boolean;
  blur: () => void;
  getBoundingClientRect: () => { top: number; bottom: number; height: number };
  classList: {
    classes: Set<string>;
    add: (...tokens: string[]) => void;
    remove: (...tokens: string[]) => void;
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

function createMockElement(
  id: string,
  initialValue = '',
  attrs: Record<string, string> = {},
  tagName = 'DIV'
): MockElement {
  const classes = new Set<string>();
  const listeners: Record<string, Array<(event?: unknown) => void>> = {};
  const attributes: Record<string, string> = { ...attrs };
  const children: MockElement[] = [];
  let internalValue = initialValue;
  const validity = { badInput: false };

  const el: MockElement = {
    id,
    tagName,
    get value() {
      return internalValue;
    },
    set value(newVal: string) {
      internalValue = String(newVal);
      // Browser behavior: programmatically assigning a valid value clears badInput
      validity.badInput = false;
    },
    validity,
    textContent: '',
    className: '',
    get firstChild() {
      return children.length > 0 ? children[0] : null;
    },
    children,
    appendChild: (child: MockElement) => {
      children.push(child);
      return child;
    },
    removeChild: (child: MockElement) => {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      return child;
    },
    contains: (other: unknown) => other === el || children.includes(other as MockElement),
    blur: () => {},
    getBoundingClientRect: () => ({ top: 400, bottom: 600, height: 200 }),
    classList: {
      classes,
      add: (...tokens: string[]) => {
        for (const t of tokens) classes.add(t);
      },
      remove: (...tokens: string[]) => {
        for (const t of tokens) classes.delete(t);
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
      el.dispatchEvent('click', { currentTarget: el, preventDefault: () => {} });
    },
  };

  return el;
}

function createEstimatorHarness(locale: 'en' | 'tl' = 'en', innerWidth = 1280) {
  const elements: Record<string, MockElement> = {
    // Part 1 Sections, Inputs & Controls
    regularSavingsInputSection: createMockElement('regularSavingsInputSection', ''),
    regularSavingsResultsSection: createMockElement('regularSavingsResultsSection', ''),
    piMobileCalculateBar: createMockElement('piMobileCalculateBar', ''),
    calculateRegularSavingsBtn: createMockElement('calculateRegularSavingsBtn', ''),
    piBasicSalary: createMockElement('piBasicSalary', '25000'),
    piEmployeeRateMode: createMockElement('piEmployeeRateMode', 'auto'),
    piEmployerRateMode: createMockElement('piEmployerRateMode', '2%'),
    piFreqMonthlyBtn: createMockElement('piFreqMonthlyBtn', '', { 'aria-pressed': 'true' }),
    piFreqCutoffBtn: createMockElement('piFreqCutoffBtn', '', { 'aria-pressed': 'false' }),
    piResetBtn: createMockElement('piResetBtn', ''),
    piValidationAlert: createMockElement('piValidationAlert', ''),
    piValidationText: createMockElement('piValidationText', ''),

    // Part 1 Outputs
    piHeroEmployeeShare: createMockElement('piHeroEmployeeShare', ''),
    piHeroFreqLabel: createMockElement('piHeroFreqLabel', ''),
    piEmployerShareDisplay: createMockElement('piEmployerShareDisplay', ''),
    piTotalMonthlyRemittance: createMockElement('piTotalMonthlyRemittance', ''),
    piCreditedSalaryBase: createMockElement('piCreditedSalaryBase', ''),
    piCutoffEmployeeShare: createMockElement('piCutoffEmployeeShare', ''),
    piAnnualEmployeeShare: createMockElement('piAnnualEmployeeShare', ''),
    piAnnualEmployerShare: createMockElement('piAnnualEmployerShare', ''),
    piAnnualTotalSavings: createMockElement('piAnnualTotalSavings', ''),
    piAppliedEeRateText: createMockElement('piAppliedEeRateText', ''),
    piAppliedErRateText: createMockElement('piAppliedErRateText', ''),
    piTierStatusBadge: createMockElement('piTierStatusBadge', ''),
    piMfsExplanationText: createMockElement('piMfsExplanationText', ''),

    // Part 2 Sections, Inputs & Controls
    mp2SavingsInputSection: createMockElement('mp2SavingsInputSection', ''),
    mp2SavingsResultsSection: createMockElement('mp2SavingsResultsSection', ''),
    mp2MobileCalculateBar: createMockElement('mp2MobileCalculateBar', ''),
    calculateMp2SavingsBtn: createMockElement('calculateMp2SavingsBtn', ''),
    mp2InitialDeposit: createMockElement('mp2InitialDeposit', '0'),
    mp2ContributionAmount: createMockElement('mp2ContributionAmount', '1000'),
    mp2FreqMonthlyBtn: createMockElement('mp2FreqMonthlyBtn', '', { 'aria-pressed': 'true' }),
    mp2FreqAnnualBtn: createMockElement('mp2FreqAnnualBtn', '', { 'aria-pressed': 'false' }),
    mp2Years: createMockElement('mp2Years', '5'),
    mp2DividendRate: createMockElement('mp2DividendRate', '7.0'),
    mp2TreatmentCompoundedBtn: createMockElement('mp2TreatmentCompoundedBtn', '', { 'aria-pressed': 'true' }),
    mp2TreatmentPayoutBtn: createMockElement('mp2TreatmentPayoutBtn', '', { 'aria-pressed': 'false' }),
    mp2ResetBtn: createMockElement('mp2ResetBtn', ''),
    mp2ValidationAlert: createMockElement('mp2ValidationAlert', ''),
    mp2ValidationText: createMockElement('mp2ValidationText', ''),

    // Part 2 Outputs
    mp2HeroTotalValue: createMockElement('mp2HeroTotalValue', ''),
    mp2HeroTreatmentBadge: createMockElement('mp2HeroTreatmentBadge', ''),
    mp2TotalPrincipalDisplay: createMockElement('mp2TotalPrincipalDisplay', ''),
    mp2TotalDividendsDisplay: createMockElement('mp2TotalDividendsDisplay', ''),
    mp2AssumedRateDisplay: createMockElement('mp2AssumedRateDisplay', ''),
    mp2SelectedTermDisplay: createMockElement('mp2SelectedTermDisplay', ''),
    mp2CompareCompoundedTotal: createMockElement('mp2CompareCompoundedTotal', ''),
    mp2CompareCompoundedDiv: createMockElement('mp2CompareCompoundedDiv', ''),
    mp2ComparePayoutTotal: createMockElement('mp2ComparePayoutTotal', ''),
    mp2ComparePayoutDiv: createMockElement('mp2ComparePayoutDiv', ''),
    mp2CompareDiffAmount: createMockElement('mp2CompareDiffAmount', ''),
    mp2CompareDiffNote: createMockElement('mp2CompareDiffNote', ''),
    mp2ScheduleBody: createMockElement('mp2ScheduleBody', '', {}, 'TBODY'),
  };

  elements.piValidationAlert.classList.add('hidden');
  elements.mp2ValidationAlert.classList.add('hidden');

  const salaryPresets = ['1500', '5000', '10000', '25000', '50000'].map((s) =>
    createMockElement(`pi-preset-${s}`, '', { 'data-salary': s })
  );
  const ratePresets = ['6.0', '7.0', '7.1', '8.0'].map((r) =>
    createMockElement(`mp2-preset-${r}`, '', { 'data-rate': r })
  );

  const scrollCalls: Array<{ top: number; behavior: string }> = [];

  const mockWindow: Record<string, unknown> = {
    innerWidth,
    innerHeight: 800,
    pageYOffset: 0,
    scrollTo: (opts: { top: number; behavior: string }) => {
      scrollCalls.push(opts);
    },
    matchMedia: () => ({ matches: false }),
  };

  const mockDocument: {
    documentElement: {
      getAttribute: (name: string) => string | null;
      scrollTop: number;
    };
    readyState: string;
    activeElement: MockElement | null;
    addEventListener: () => void;
    getElementById: (id: string) => MockElement | null;
    createElement: (tag: string) => MockElement;
    querySelector: () => null;
    querySelectorAll: (selector: string) => MockElement[];
  } = {
    documentElement: {
      getAttribute: (name: string) => (name === 'lang' ? (locale === 'tl' ? 'tl-PH' : 'en-PH') : null),
      scrollTop: 0,
    },
    readyState: 'complete',
    activeElement: null,
    addEventListener: () => {},
    getElementById: (id: string) => elements[id] || null,
    createElement: (tag: string) => createMockElement('', '', {}, tag.toUpperCase()),
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (selector === '.pi-salary-preset') return salaryPresets;
      if (selector === '.mp2-rate-preset') return ratePresets;
      return [];
    },
  };

  const mockSessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };

  const runner = new Function('window', 'document', 'sessionStorage', SCRIPT_CODE);
  runner(mockWindow, mockDocument, mockSessionStorage);

  return {
    elements,
    salaryPresets,
    ratePresets,
    scrollCalls,
    mockWindow,
    mockDocument,
    engine: mockWindow.PagIbigMp2Calculator as {
      updateRegularSavingsUI: () => boolean;
      updateMp2UI: () => boolean;
      resetRegularSavings: () => void;
      resetMp2Savings: () => void;
    },
  };
}

describe('Pag-IBIG & MP2 Savings Estimator — Issue 3B-B Reset Buttons', () => {
  it('1. Part 1 (piResetBtn) restores every default input and recalculates to ₱200 EE / ₱200 ER / ₱400 Combined', () => {
    const { elements, engine } = createEstimatorHarness('en');

    // Change every Part 1 input & toggle
    elements.piBasicSalary.value = '1200';
    elements.piEmployeeRateMode.value = '1%';
    elements.piEmployerRateMode.value = '0%';
    elements.piFreqCutoffBtn.click();
    engine.updateRegularSavingsUI();

    assert.equal(elements.piHeroEmployeeShare.textContent, '₱6.00');
    assert.equal(elements.piEmployerShareDisplay.textContent, '₱0.00');
    assert.equal(elements.piFreqCutoffBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(elements.piFreqMonthlyBtn.getAttribute('aria-pressed'), 'false');

    // Click Part 1 Reset button
    elements.piResetBtn.click();

    assert.equal(elements.piBasicSalary.value, '25000');
    assert.equal(elements.piEmployeeRateMode.value, 'auto');
    assert.equal(elements.piEmployerRateMode.value, '2%');
    assert.equal(elements.piFreqMonthlyBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(elements.piFreqCutoffBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(elements.piHeroEmployeeShare.textContent, '₱200.00');
    assert.equal(elements.piHeroFreqLabel.textContent, '/ month');
    assert.equal(elements.piEmployerShareDisplay.textContent, '₱200.00');
    assert.equal(elements.piTotalMonthlyRemittance.textContent, '₱400.00');
    assert.equal(elements.piCreditedSalaryBase.textContent, '₱10,000.00');
  });

  it('2. Part 2 (mp2ResetBtn) restores every default input and recalculates to ₱71,625.45 / ₱11,625.45 / ₱70,675.00 / +₱950.45', () => {
    const { elements, engine } = createEstimatorHarness('en');

    // Change every Part 2 input & toggle
    elements.mp2InitialDeposit.value = '50000';
    elements.mp2ContributionAmount.value = '2500';
    elements.mp2FreqAnnualBtn.click();
    elements.mp2Years.value = '3';
    elements.mp2DividendRate.value = '6.0';
    elements.mp2TreatmentPayoutBtn.click();
    engine.updateMp2UI();

    assert.notEqual(elements.mp2HeroTotalValue.textContent, '₱71,625.45');
    assert.equal(elements.mp2FreqAnnualBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(elements.mp2TreatmentPayoutBtn.getAttribute('aria-pressed'), 'true');

    // Click Part 2 Reset button
    elements.mp2ResetBtn.click();

    assert.equal(elements.mp2InitialDeposit.value, '0');
    assert.equal(elements.mp2ContributionAmount.value, '1000');
    assert.equal(elements.mp2Years.value, '5');
    assert.equal(elements.mp2DividendRate.value, '7.0');
    assert.equal(elements.mp2FreqMonthlyBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(elements.mp2FreqAnnualBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(elements.mp2TreatmentCompoundedBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(elements.mp2TreatmentPayoutBtn.getAttribute('aria-pressed'), 'false');

    // Verify expected recalculated default results
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱71,625.45');
    assert.equal(elements.mp2TotalPrincipalDisplay.textContent, '₱60,000.00');
    assert.equal(elements.mp2TotalDividendsDisplay.textContent, '₱11,625.45');
    assert.equal(elements.mp2CompareCompoundedTotal.textContent, '₱71,625.45');
    assert.equal(elements.mp2CompareCompoundedDiv.textContent, '₱11,625.45');
    assert.equal(elements.mp2ComparePayoutTotal.textContent, '₱70,675.00');
    assert.equal(elements.mp2ComparePayoutDiv.textContent, '₱10,675.00');
    assert.equal(elements.mp2CompareDiffAmount.textContent, '+₱950.45');
    assert.equal(elements.mp2ScheduleBody.children.length, 5);
  });

  it('3. Reset clears validation errors and invalid input states in both sections', () => {
    const { elements, engine } = createEstimatorHarness('en');

    // Trigger Part 1 validation error (negative salary)
    elements.piBasicSalary.value = '-5000';
    engine.updateRegularSavingsUI();
    assert.equal(elements.piValidationAlert.classList.contains('hidden'), false);
    assert.equal(elements.piHeroEmployeeShare.textContent, '₱0.00');

    elements.piResetBtn.click();
    assert.equal(elements.piValidationAlert.classList.contains('hidden'), true);
    assert.equal(elements.piValidationText.textContent, '');
    assert.equal(elements.piHeroEmployeeShare.textContent, '₱200.00');

    // Trigger Part 2 validation error (dividend rate > 20%)
    elements.mp2DividendRate.value = '25';
    engine.updateMp2UI();
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), false);
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱0.00');

    elements.mp2ResetBtn.click();
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), true);
    assert.equal(elements.mp2ValidationText.textContent, '');
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱71,625.45');
  });

  it('4. Resetting Part 1 does NOT change Part 2 inputs, and resetting Part 2 does NOT change Part 1 inputs', () => {
    const { elements, engine } = createEstimatorHarness('en');

    // Customize both Part 1 and Part 2
    elements.piBasicSalary.value = '5000';
    elements.piEmployeeRateMode.value = '1%';
    elements.piFreqCutoffBtn.click();
    engine.updateRegularSavingsUI();

    elements.mp2InitialDeposit.value = '10000';
    elements.mp2ContributionAmount.value = '3000';
    elements.mp2Years.value = '2';
    elements.mp2DividendRate.value = '8.0';
    elements.mp2FreqAnnualBtn.click();
    elements.mp2TreatmentPayoutBtn.click();
    engine.updateMp2UI();

    const customMp2Hero = elements.mp2HeroTotalValue.textContent;

    // Reset Part 1 only -> Part 2 must remain untouched
    elements.piResetBtn.click();
    assert.equal(elements.piBasicSalary.value, '25000');
    assert.equal(elements.piHeroEmployeeShare.textContent, '₱200.00');

    assert.equal(elements.mp2InitialDeposit.value, '10000');
    assert.equal(elements.mp2ContributionAmount.value, '3000');
    assert.equal(elements.mp2Years.value, '2');
    assert.equal(elements.mp2DividendRate.value, '8.0');
    assert.equal(elements.mp2FreqAnnualBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(elements.mp2TreatmentPayoutBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(elements.mp2HeroTotalValue.textContent, customMp2Hero);

    // Re-customize Part 1, then reset Part 2 only -> Part 1 must remain untouched
    elements.piBasicSalary.value = '1500';
    elements.piEmployerRateMode.value = '0%';
    elements.piFreqCutoffBtn.click();
    engine.updateRegularSavingsUI();
    const customPart1Share = elements.piHeroEmployeeShare.textContent;

    elements.mp2ResetBtn.click();
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱71,625.45');
    assert.equal(elements.mp2InitialDeposit.value, '0');
    assert.equal(elements.mp2ContributionAmount.value, '1000');

    assert.equal(elements.piBasicSalary.value, '1500');
    assert.equal(elements.piEmployerRateMode.value, '0%');
    assert.equal(elements.piFreqCutoffBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(elements.piHeroEmployeeShare.textContent, customPart1Share);
  });

  it('5. Both reset buttons work in Filipino (tl-PH) locale and HTML markup in both languages contains localized Reset buttons & Issue 3B-A values', () => {
    const tl = createEstimatorHarness('tl');

    tl.elements.piBasicSalary.value = '1500';
    tl.elements.piFreqCutoffBtn.click();
    tl.elements.mp2InitialDeposit.value = '20000';
    tl.elements.mp2Years.value = '1';
    tl.elements.mp2TreatmentPayoutBtn.click();

    tl.elements.piResetBtn.click();
    tl.elements.mp2ResetBtn.click();

    assert.equal(tl.elements.piHeroEmployeeShare.textContent, '₱200.00');
    assert.equal(tl.elements.piHeroFreqLabel.textContent, '/ buwan');
    assert.equal(tl.elements.mp2HeroTotalValue.textContent, '₱71,625.45');
    assert.equal(tl.elements.mp2TotalDividendsDisplay.textContent, '₱11,625.45');
    assert.equal(tl.elements.mp2SelectedTermDisplay.textContent, '5 Taon');

    const enHtml = readFileSync(EN_HTML_PATH, 'utf8');
    const tlHtml = readFileSync(TL_HTML_PATH, 'utf8');

    // Verify Reset buttons exist with expected IDs and localized labels
    assert.match(enHtml, /id="piResetBtn"[\s\S]*?<span>Reset<\/span>/);
    assert.match(enHtml, /id="mp2ResetBtn"[\s\S]*?<span>Reset<\/span>/);
    assert.match(tlHtml, /id="piResetBtn"[\s\S]*?<span>I-reset<\/span>/);
    assert.match(tlHtml, /id="mp2ResetBtn"[\s\S]*?<span>I-reset<\/span>/);

    // Verify Issue 3B-A static HTML summary values remain intact in both files
    for (const html of [enHtml, tlHtml]) {
      assert.match(html, /id="mp2HeroTotalValue"[^>]*>₱71,625\.45<\/span>/);
      assert.match(html, /id="mp2TotalDividendsDisplay"[^>]*>₱11,625\.45<\/span>/);
      assert.match(html, /id="mp2CompareCompoundedDiv"[^>]*>₱11,625\.45<\/span>/);
      assert.match(html, /id="mp2CompareCompoundedTotal"[^>]*>₱71,625\.45<\/span>/);
      assert.match(html, /id="mp2ComparePayoutDiv"[^>]*>₱10,675\.00<\/span>/);
      assert.match(html, /id="mp2ComparePayoutTotal"[^>]*>₱70,675\.00<\/span>/);
      assert.match(html, /id="mp2CompareDiffAmount"[^>]*>\+₱950\.45<\/span>/);
    }
  });
});

describe('Pag-IBIG & MP2 Savings Estimator — Issue 3C-1 Basic Salary badInput Validation', () => {
  it('1. #piBasicSalary with value="" and validity.badInput=true triggers validation error, zeroes outputs safely, and returns false', () => {
    const { elements, engine, salaryPresets } = createEstimatorHarness('en');

    elements.piBasicSalary.value = '';
    elements.piBasicSalary.validity.badInput = true;

    const isValid = engine.updateRegularSavingsUI();

    assert.equal(isValid, false);
    assert.equal(elements.piValidationAlert.classList.contains('hidden'), false);
    assert.equal(
      elements.piValidationText.textContent,
      'Please enter a valid monthly basic salary (₱0.00 or higher).'
    );
    assert.equal(elements.piHeroEmployeeShare.textContent, '₱0.00');
    assert.equal(elements.piEmployerShareDisplay.textContent, '₱0.00');
    assert.equal(elements.piTotalMonthlyRemittance.textContent, '₱0.00');
    assert.equal(elements.piCreditedSalaryBase.textContent, '₱0.00');

    // No quick salary preset should be highlighted when salary has badInput
    for (const btn of salaryPresets) {
      assert.equal(btn.classList.contains('font-bold'), false);
    }
  });

  it('2. Mobile Calculate button and Enter key do NOT scroll to results when #piBasicSalary has validity.badInput=true', () => {
    const { elements, scrollCalls, mockDocument } = createEstimatorHarness('en', 375);

    elements.piBasicSalary.value = '';
    elements.piBasicSalary.validity.badInput = true;
    mockDocument.activeElement = elements.piBasicSalary;

    // Click mobile Calculate Regular Savings button
    elements.calculateRegularSavingsBtn.click();
    assert.equal(scrollCalls.length, 0);
    assert.equal(elements.piValidationAlert.classList.contains('hidden'), false);

    // Press Enter key inside #piBasicSalary on mobile viewport (< 1024px)
    elements.piBasicSalary.dispatchEvent('keydown', {
      key: 'Enter',
      preventDefault: () => {},
    });
    assert.equal(scrollCalls.length, 0);
    assert.equal(elements.piValidationAlert.classList.contains('hidden'), false);

    // Once valid salary is entered, mobile Calculate scrolls to results
    elements.piBasicSalary.value = '25000';
    elements.calculateRegularSavingsBtn.click();
    assert.equal(scrollCalls.length, 1);
    assert.equal(elements.piValidationAlert.classList.contains('hidden'), true);
  });

  it('3. Correcting #piBasicSalary or clicking #piResetBtn clears the badInput error and recalculates', () => {
    const { elements, engine } = createEstimatorHarness('en');

    // Enter badInput state
    elements.piBasicSalary.value = '';
    elements.piBasicSalary.validity.badInput = true;
    assert.equal(engine.updateRegularSavingsUI(), false);
    assert.equal(elements.piValidationAlert.classList.contains('hidden'), false);

    // User types a valid salary (10000) -> clears badInput and recalculates
    elements.piBasicSalary.value = '10000';
    elements.piBasicSalary.dispatchEvent('input');
    assert.equal(elements.piValidationAlert.classList.contains('hidden'), true);
    assert.equal(elements.piHeroEmployeeShare.textContent, '₱200.00');

    // Re-trigger badInput, then click Reset button (#piResetBtn)
    elements.piBasicSalary.value = '';
    elements.piBasicSalary.validity.badInput = true;
    assert.equal(engine.updateRegularSavingsUI(), false);
    assert.equal(elements.piValidationAlert.classList.contains('hidden'), false);

    elements.piResetBtn.click();
    assert.equal(elements.piBasicSalary.value, '25000');
    assert.equal(elements.piBasicSalary.validity.badInput, false);
    assert.equal(elements.piValidationAlert.classList.contains('hidden'), true);
    assert.equal(elements.piHeroEmployeeShare.textContent, '₱200.00');
    assert.equal(elements.piTotalMonthlyRemittance.textContent, '₱400.00');
  });

  it('4. Intentional empty #piBasicSalary with validity.badInput=false does NOT trigger a false validation error, and Filipino locale displays localized badInput alert', () => {
    const en = createEstimatorHarness('en');

    // Intentional empty string (validity.badInput === false)
    en.elements.piBasicSalary.value = '';
    en.elements.piBasicSalary.validity.badInput = false;
    const isValidEmpty = en.engine.updateRegularSavingsUI();

    assert.equal(isValidEmpty, true);
    assert.equal(en.elements.piValidationAlert.classList.contains('hidden'), true);
    assert.equal(en.elements.piHeroEmployeeShare.textContent, '₱0.00');
    assert.equal(
      en.elements.piTierStatusBadge.textContent,
      'Enter a monthly basic salary above ₱0.00 to compute mandatory Pag-IBIG Regular Savings.'
    );

    // Filipino locale (tl-PH) with validity.badInput = true
    const tl = createEstimatorHarness('tl');
    tl.elements.piBasicSalary.value = '';
    tl.elements.piBasicSalary.validity.badInput = true;
    const isValidTl = tl.engine.updateRegularSavingsUI();

    assert.equal(isValidTl, false);
    assert.equal(tl.elements.piValidationAlert.classList.contains('hidden'), false);
    assert.equal(
      tl.elements.piValidationText.textContent,
      'Maglagay ng wastong buwanang basic salary (₱0.00 o mas mataas).'
    );
    assert.equal(tl.elements.piHeroEmployeeShare.textContent, '₱0.00');

    // Filipino Reset recovery from badInput
    tl.elements.piResetBtn.click();
    assert.equal(tl.elements.piValidationAlert.classList.contains('hidden'), true);
    assert.equal(tl.elements.piHeroEmployeeShare.textContent, '₱200.00');
  });
});

describe('Pag-IBIG & MP2 Savings Estimator — Issue 3C-2 MP2 Deposit & Contribution badInput Validation', () => {
  it('1. #mp2InitialDeposit with value="" and validity.badInput=true (while contribution is 1000) shows error, prevents partial projection, and returns false', () => {
    const { elements, engine } = createEstimatorHarness('en');

    // Contribution is valid (1000), but Initial Deposit has browser badInput
    elements.mp2ContributionAmount.value = '1000';
    elements.mp2InitialDeposit.value = '';
    elements.mp2InitialDeposit.validity.badInput = true;

    const isValid = engine.updateMp2UI();

    assert.equal(isValid, false);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), false);
    assert.equal(
      elements.mp2ValidationText.textContent,
      'Please enter valid non-negative amounts for your MP2 savings inputs.'
    );
    // Must NOT show partial projection (₱71,625.45) for the ₱1,000 contribution
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱0.00');
    assert.equal(elements.mp2TotalPrincipalDisplay.textContent, '₱0.00');
    assert.equal(elements.mp2TotalDividendsDisplay.textContent, '₱0.00');
    assert.equal(elements.mp2CompareCompoundedTotal.textContent, '₱0.00');
    assert.equal(elements.mp2ComparePayoutTotal.textContent, '₱0.00');
    assert.equal(elements.mp2CompareDiffAmount.textContent, '+₱0.00');

    // Part 1 Regular Savings remains completely unaffected
    assert.equal(elements.piValidationAlert.classList.contains('hidden'), true);
    assert.equal(elements.piHeroEmployeeShare.textContent, '₱200.00');
  });

  it('2. #mp2ContributionAmount with value="" and validity.badInput=true (while initial deposit is 50000) shows error, prevents partial projection, and returns false', () => {
    const { elements, engine } = createEstimatorHarness('en');

    // Initial deposit is valid (50000), but Contribution Amount has browser badInput
    elements.mp2InitialDeposit.value = '50000';
    elements.mp2ContributionAmount.value = '';
    elements.mp2ContributionAmount.validity.badInput = true;

    const isValid = engine.updateMp2UI();

    assert.equal(isValid, false);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), false);
    assert.equal(
      elements.mp2ValidationText.textContent,
      'Please enter valid non-negative amounts for your MP2 savings inputs.'
    );
    // Must NOT show partial projection for the ₱50,000 initial deposit
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱0.00');
    assert.equal(elements.mp2TotalPrincipalDisplay.textContent, '₱0.00');
    assert.equal(elements.mp2TotalDividendsDisplay.textContent, '₱0.00');
    assert.equal(elements.mp2CompareCompoundedTotal.textContent, '₱0.00');
    assert.equal(elements.mp2ComparePayoutTotal.textContent, '₱0.00');
    assert.equal(elements.mp2CompareDiffAmount.textContent, '+₱0.00');

    // Part 1 Regular Savings remains completely unaffected
    assert.equal(elements.piValidationAlert.classList.contains('hidden'), true);
    assert.equal(elements.piHeroEmployeeShare.textContent, '₱200.00');
  });

  it('3. Mobile Calculate and Enter-key handling do NOT scroll to results when either #mp2InitialDeposit or #mp2ContributionAmount has validity.badInput=true', () => {
    const { elements, scrollCalls, mockDocument } = createEstimatorHarness('en', 375);

    // Case A: #mp2InitialDeposit has badInput
    elements.mp2InitialDeposit.value = '';
    elements.mp2InitialDeposit.validity.badInput = true;
    mockDocument.activeElement = elements.mp2InitialDeposit;

    elements.calculateMp2SavingsBtn.click();
    assert.equal(scrollCalls.length, 0);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), false);

    elements.mp2InitialDeposit.dispatchEvent('keydown', {
      key: 'Enter',
      preventDefault: () => {},
    });
    assert.equal(scrollCalls.length, 0);

    // Fix #mp2InitialDeposit, break #mp2ContributionAmount
    elements.mp2InitialDeposit.value = '0';
    elements.mp2ContributionAmount.value = '';
    elements.mp2ContributionAmount.validity.badInput = true;
    mockDocument.activeElement = elements.mp2ContributionAmount;

    elements.calculateMp2SavingsBtn.click();
    assert.equal(scrollCalls.length, 0);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), false);

    elements.mp2ContributionAmount.dispatchEvent('keydown', {
      key: 'Enter',
      preventDefault: () => {},
    });
    assert.equal(scrollCalls.length, 0);

    // Once both inputs are valid, mobile Calculate scrolls to results
    elements.mp2ContributionAmount.value = '1000';
    elements.calculateMp2SavingsBtn.click();
    assert.equal(scrollCalls.length, 1);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), true);
  });

  it('4. Correcting invalid input or clicking #mp2ResetBtn clears the error and recalculates', () => {
    const { elements, engine } = createEstimatorHarness('en');

    // Trigger badInput on #mp2InitialDeposit
    elements.mp2InitialDeposit.value = '';
    elements.mp2InitialDeposit.validity.badInput = true;
    assert.equal(engine.updateMp2UI(), false);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), false);

    // User corrects #mp2InitialDeposit to '0' -> clears error and recalculates default ₱71,625.45
    elements.mp2InitialDeposit.value = '0';
    elements.mp2InitialDeposit.dispatchEvent('input');
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), true);
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱71,625.45');

    // Trigger badInput on #mp2ContributionAmount, then recover via #mp2ResetBtn
    elements.mp2ContributionAmount.value = '';
    elements.mp2ContributionAmount.validity.badInput = true;
    assert.equal(engine.updateMp2UI(), false);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), false);
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱0.00');

    elements.mp2ResetBtn.click();
    assert.equal(elements.mp2InitialDeposit.value, '0');
    assert.equal(elements.mp2ContributionAmount.value, '1000');
    assert.equal(elements.mp2ContributionAmount.validity.badInput, false);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), true);
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱71,625.45');
    assert.equal(elements.mp2TotalDividendsDisplay.textContent, '₱11,625.45');
  });

  it('5. Intentional empty values with badInput=false remain valid as zero, and Filipino locale displays localized badInput error', () => {
    const en = createEstimatorHarness('en');

    // Intentionally empty #mp2InitialDeposit (badInput=false) with valid #mp2ContributionAmount='1000'
    en.elements.mp2InitialDeposit.value = '';
    en.elements.mp2InitialDeposit.validity.badInput = false;
    en.elements.mp2ContributionAmount.value = '1000';
    assert.equal(en.engine.updateMp2UI(), true);
    assert.equal(en.elements.mp2ValidationAlert.classList.contains('hidden'), true);
    assert.equal(en.elements.mp2HeroTotalValue.textContent, '₱71,625.45');

    // Intentionally empty #mp2ContributionAmount (badInput=false) with valid #mp2InitialDeposit='50000'
    en.elements.mp2InitialDeposit.value = '50000';
    en.elements.mp2ContributionAmount.value = '';
    en.elements.mp2ContributionAmount.validity.badInput = false;
    assert.equal(en.engine.updateMp2UI(), true);
    assert.equal(en.elements.mp2ValidationAlert.classList.contains('hidden'), true);
    assert.equal(en.elements.mp2TotalPrincipalDisplay.textContent, '₱50,000.00');

    // Filipino locale (tl-PH) badInput validation on #mp2InitialDeposit and #mp2ContributionAmount
    const tl = createEstimatorHarness('tl');
    tl.elements.mp2InitialDeposit.value = '';
    tl.elements.mp2InitialDeposit.validity.badInput = true;
    assert.equal(tl.engine.updateMp2UI(), false);
    assert.equal(tl.elements.mp2ValidationAlert.classList.contains('hidden'), false);
    assert.equal(
      tl.elements.mp2ValidationText.textContent,
      'Maglagay ng wastong halaga (₱0 o mas mataas) para sa iyong MP2 savings.'
    );
    assert.equal(tl.elements.mp2HeroTotalValue.textContent, '₱0.00');

    tl.elements.mp2ResetBtn.click();
    assert.equal(tl.elements.mp2ValidationAlert.classList.contains('hidden'), true);
    assert.equal(tl.elements.mp2HeroTotalValue.textContent, '₱71,625.45');
  });
});

describe('Pag-IBIG & MP2 Savings Estimator — Issue 3C-3 MP2 Dividend Rate badInput Validation', () => {
  it('1. #mp2DividendRate with value="" and validity.badInput=true triggers localized range warning, prevents principal-only projection, unhighlights presets, and returns false', () => {
    const { elements, engine, ratePresets } = createEstimatorHarness('en');

    // Valid deposit (0) and contribution (1000), malformed dividend rate
    elements.mp2InitialDeposit.value = '0';
    elements.mp2ContributionAmount.value = '1000';
    elements.mp2DividendRate.value = '';
    elements.mp2DividendRate.validity.badInput = true;

    const isValid = engine.updateMp2UI();

    assert.equal(isValid, false);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), false);
    assert.equal(
      elements.mp2ValidationText.textContent,
      'Assumed annual dividend rate must be between 0% and 20%.'
    );

    // Must NOT show misleading principal-only projection (₱60,000.00)
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱0.00');
    assert.equal(elements.mp2TotalPrincipalDisplay.textContent, '₱0.00');
    assert.equal(elements.mp2TotalDividendsDisplay.textContent, '₱0.00');
    assert.equal(elements.mp2AssumedRateDisplay.textContent, '0.00% p.a.');
    assert.equal(elements.mp2CompareCompoundedTotal.textContent, '₱0.00');
    assert.equal(elements.mp2ComparePayoutTotal.textContent, '₱0.00');
    assert.equal(elements.mp2CompareDiffAmount.textContent, '+₱0.00');

    // Rate preset buttons must not be highlighted when dividend rate has badInput
    for (const btn of ratePresets) {
      assert.equal(btn.classList.contains('font-bold'), false);
    }

    // Part 1 Regular Savings remains unaffected
    assert.equal(elements.piValidationAlert.classList.contains('hidden'), true);
    assert.equal(elements.piHeroEmployeeShare.textContent, '₱200.00');
  });

  it('2. Mobile Calculate button and Enter key do NOT scroll to results when #mp2DividendRate has validity.badInput=true', () => {
    const { elements, scrollCalls, mockDocument } = createEstimatorHarness('en', 375);

    elements.mp2DividendRate.value = '';
    elements.mp2DividendRate.validity.badInput = true;
    mockDocument.activeElement = elements.mp2DividendRate;

    // Click mobile Calculate MP2 Savings button
    elements.calculateMp2SavingsBtn.click();
    assert.equal(scrollCalls.length, 0);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), false);

    // Press Enter key inside #mp2DividendRate on mobile (< 1024px)
    elements.mp2DividendRate.dispatchEvent('keydown', {
      key: 'Enter',
      preventDefault: () => {},
    });
    assert.equal(scrollCalls.length, 0);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), false);

    // Once valid rate is restored, mobile Calculate scrolls to results
    elements.mp2DividendRate.value = '7.0';
    elements.calculateMp2SavingsBtn.click();
    assert.equal(scrollCalls.length, 1);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), true);
  });

  it('3. Correcting #mp2DividendRate to 7.0, clicking a rate preset button, or clicking #mp2ResetBtn clears the error and recalculates', () => {
    const { elements, engine, ratePresets } = createEstimatorHarness('en');

    // Case A: Recover by typing valid rate '7.0'
    elements.mp2DividendRate.value = '';
    elements.mp2DividendRate.validity.badInput = true;
    assert.equal(engine.updateMp2UI(), false);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), false);
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱0.00');

    elements.mp2DividendRate.value = '7.0';
    elements.mp2DividendRate.dispatchEvent('input');
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), true);
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱71,625.45');
    assert.equal(elements.mp2TotalDividendsDisplay.textContent, '₱11,625.45');

    // Case B: Recover by clicking a valid rate preset button (e.g., 7.0%)
    elements.mp2DividendRate.value = '';
    elements.mp2DividendRate.validity.badInput = true;
    assert.equal(engine.updateMp2UI(), false);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), false);

    const preset70 = ratePresets.find((b) => b.getAttribute('data-rate') === '7.0');
    assert.ok(preset70);
    preset70.click();
    assert.equal(elements.mp2DividendRate.value, '7.0');
    assert.equal(elements.mp2DividendRate.validity.badInput, false);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), true);
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱71,625.45');
    assert.equal(preset70.classList.contains('font-bold'), true);

    // Case C: Recover by clicking #mp2ResetBtn
    elements.mp2DividendRate.value = '';
    elements.mp2DividendRate.validity.badInput = true;
    assert.equal(engine.updateMp2UI(), false);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), false);

    elements.mp2ResetBtn.click();
    assert.equal(elements.mp2DividendRate.value, '7.0');
    assert.equal(elements.mp2DividendRate.validity.badInput, false);
    assert.equal(elements.mp2ValidationAlert.classList.contains('hidden'), true);
    assert.equal(elements.mp2HeroTotalValue.textContent, '₱71,625.45');
  });

  it('4. Intentionally empty rate (badInput=false), explicit 0, below-minimum (<0), above-maximum (>20), validation precedence, and Filipino locale all work as expected', () => {
    const en = createEstimatorHarness('en');

    // Intentionally empty rate (value="" with badInput=false) remains valid and treated as 0%
    en.elements.mp2DividendRate.value = '';
    en.elements.mp2DividendRate.validity.badInput = false;
    assert.equal(en.engine.updateMp2UI(), true);
    assert.equal(en.elements.mp2ValidationAlert.classList.contains('hidden'), true);
    assert.equal(en.elements.mp2HeroTotalValue.textContent, '₱60,000.00');
    assert.equal(en.elements.mp2TotalDividendsDisplay.textContent, '₱0.00');

    // Explicit '0' rate remains valid
    en.elements.mp2DividendRate.value = '0';
    assert.equal(en.engine.updateMp2UI(), true);
    assert.equal(en.elements.mp2ValidationAlert.classList.contains('hidden'), true);
    assert.equal(en.elements.mp2HeroTotalValue.textContent, '₱60,000.00');
    assert.equal(en.elements.mp2TotalDividendsDisplay.textContent, '₱0.00');

    // Below minimum ('-1') and above maximum ('25') continue to trigger range warning
    en.elements.mp2DividendRate.value = '-1';
    assert.equal(en.engine.updateMp2UI(), false);
    assert.equal(en.elements.mp2ValidationAlert.classList.contains('hidden'), false);
    assert.equal(
      en.elements.mp2ValidationText.textContent,
      'Assumed annual dividend rate must be between 0% and 20%.'
    );
    assert.equal(en.elements.mp2HeroTotalValue.textContent, '₱0.00');

    en.elements.mp2DividendRate.value = '25';
    assert.equal(en.engine.updateMp2UI(), false);
    assert.equal(en.elements.mp2ValidationAlert.classList.contains('hidden'), false);
    assert.equal(
      en.elements.mp2ValidationText.textContent,
      'Assumed annual dividend rate must be between 0% and 20%.'
    );
    assert.equal(en.elements.mp2HeroTotalValue.textContent, '₱0.00');

    // Validation precedence: when both contribution and rate have badInput, deposit/contribution error takes precedence first
    en.elements.mp2ContributionAmount.value = '';
    en.elements.mp2ContributionAmount.validity.badInput = true;
    en.elements.mp2DividendRate.value = '';
    en.elements.mp2DividendRate.validity.badInput = true;
    assert.equal(en.engine.updateMp2UI(), false);
    assert.equal(
      en.elements.mp2ValidationText.textContent,
      'Please enter valid non-negative amounts for your MP2 savings inputs.'
    );

    // Filipino locale (tl-PH) displays localized range-warning message on dividend rate badInput
    const tl = createEstimatorHarness('tl');
    tl.elements.mp2DividendRate.value = '';
    tl.elements.mp2DividendRate.validity.badInput = true;
    assert.equal(tl.engine.updateMp2UI(), false);
    assert.equal(tl.elements.mp2ValidationAlert.classList.contains('hidden'), false);
    assert.equal(
      tl.elements.mp2ValidationText.textContent,
      'Ang assumed annual dividend rate ay dapat nasa pagitan ng 0% at 20%.'
    );
    assert.equal(tl.elements.mp2HeroTotalValue.textContent, '₱0.00');

    tl.elements.mp2ResetBtn.click();
    assert.equal(tl.elements.mp2ValidationAlert.classList.contains('hidden'), true);
    assert.equal(tl.elements.mp2HeroTotalValue.textContent, '₱71,625.45');
  });
});



