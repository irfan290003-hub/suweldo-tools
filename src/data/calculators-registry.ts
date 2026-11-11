/**
 * SuweldoTools — Authoritative Bilingual Calculator Metadata Registry
 * Single source of truth for both build-time scripts and browser-side progressive enhancement.
 *
 * IMPORTANT:
 * - Only calculators with `status: 'live'` contribute to live calculator counts and live category counts.
 * - Utilities with `status: 'coming-soon'` are rendered separately and never inflate live counts.
 */

export type CalculatorLanguage = 'en' | 'tl';

export type CalculatorCategoryId =
  | 'salary-net-pay'
  | 'government-contributions'
  | 'overtime-holiday-pay'
  | 'contribution-tables-guides';

export type CalculatorStatus = 'live' | 'coming-soon';

export interface BilingualText {
  en: string;
  tl: string;
}

export interface CalculatorCategory {
  id: CalculatorCategoryId;
  order: number;
  label: BilingualText;
  shortLabel: BilingualText;
  description: BilingualText;
}

export interface CalculatorMetadata {
  id: string;
  category: CalculatorCategoryId;
  status: CalculatorStatus;
  isPopular: boolean;
  isRecentlyAdded: boolean;
  urls: {
    en: string;
    tl: string;
  };
  title: BilingualText;
  shortTitle: BilingualText;
  badge: BilingualText;
  legalBasis: BilingualText;
  description: BilingualText;
  highlights: {
    en: [string, string, string];
    tl: [string, string, string];
  };
  ctaLabel: BilingualText;
  keywords: string[];
}

export const CALCULATOR_CATEGORIES: readonly CalculatorCategory[] = [
  {
    id: 'salary-net-pay',
    order: 1,
    label: {
      en: 'Salary & Net Pay',
      tl: 'Sahod at Net Pay',
    },
    shortLabel: {
      en: 'Salary & Net Pay',
      tl: 'Sahod at Net Pay',
    },
    description: {
      en: 'Compute monthly and semi-monthly (kinsenas) take-home pay, mandatory payroll deductions, and statutory 13th month pay.',
      tl: 'Kuwentahin ang buwanan at kinsenas na take-home pay, mga mandatoryong kaltas sa payroll, at 13th month pay.',
    },
  },
  {
    id: 'government-contributions',
    order: 2,
    label: {
      en: 'Government Contributions',
      tl: 'Kontribusyon sa Gobyerno',
    },
    shortLabel: {
      en: 'Gov Contributions',
      tl: 'Kontribusyon',
    },
    description: {
      en: 'Calculate mandatory employee and employer contribution shares for Philippine social insurance agencies.',
      tl: 'Kuwentahin ang mandatoryong kontribusyon ng empleyado at employer para sa mga ahensya ng gobyerno sa Pilipinas.',
    },
  },
  {
    id: 'overtime-holiday-pay',
    order: 3,
    label: {
      en: 'Overtime & Holiday Pay',
      tl: 'Overtime at Holiday Pay',
    },
    shortLabel: {
      en: 'Overtime & Holiday',
      tl: 'Overtime at Holiday',
    },
    description: {
      en: 'Verify DOLE Labor Code multipliers for regular overtime, rest days, special non-working days, regular holidays, and night shift differential.',
      tl: 'I-verify ang mga DOLE Labor Code multiplier para sa overtime, rest day, special non-working day, regular holiday, at night shift differential.',
    },
  },
  {
    id: 'contribution-tables-guides',
    order: 4,
    label: {
      en: 'Contribution Tables & Guides',
      tl: 'Talahanayan at Gabay sa Kontribusyon',
    },
    shortLabel: {
      en: 'Tables & Guides',
      tl: 'Talahanayan at Gabay',
    },
    description: {
      en: 'Interactive 2026 statutory contribution schedules, Monthly Salary Credit (MSC) bracket lookups, and MPF/WISP breakdowns.',
      tl: 'Interactive na 2026 statutory contribution table, paghahanap ng Monthly Salary Credit (MSC) bracket, at MPF/WISP breakdown.',
    },
  },
] as const;

export const CALCULATORS_REGISTRY: readonly CalculatorMetadata[] = [
  {
    id: 'take-home-pay',
    category: 'salary-net-pay',
    status: 'live',
    isPopular: true,
    isRecentlyAdded: false,
    urls: {
      en: '/take-home-pay-calculator-philippines/',
      tl: '/tl/take-home-pay-calculator-philippines/',
    },
    title: {
      en: 'Take-Home Pay Calculator',
      tl: 'Take-Home Pay Calculator',
    },
    shortTitle: {
      en: 'Take-Home Pay',
      tl: 'Take-Home Pay',
    },
    badge: {
      en: 'Available Now · Most Popular',
      tl: 'Magagamit Ngayon · Pinakasikat',
    },
    legalBasis: {
      en: '2026 SSS, PhilHealth, Pag-IBIG & BIR TRAIN Law',
      tl: '2026 SSS, PhilHealth, Pag-IBIG at BIR TRAIN Law',
    },
    description: {
      en: 'Compute your net monthly and semi-monthly (kinsenas) salary after mandatory SSS, PhilHealth, Pag-IBIG, and BIR withholding tax deductions.',
      tl: 'Kuwentahin ang iyong buwanan at kinsenas na net pay matapos ibawas ang mandatoryong kontribusyon sa SSS, PhilHealth, Pag-IBIG, at BIR withholding tax.',
    },
    highlights: {
      en: [
        'Instant monthly and per-cutoff (semi-monthly) net pay breakdown.',
        '2026 SSS (with WISP/MPF), PhilHealth (5%), and Pag-IBIG (₱200 cap) schedules.',
        'Automatic BIR TRAIN Law graduated withholding tax & Minimum Wage Earner (MWE) toggle.',
      ],
      tl: [
        'Agarang breakdown ng buwanan at kinsenas (semi-monthly) na net pay.',
        '2026 SSS (may WISP/MPF), PhilHealth (5%), at Pag-IBIG (₱200 cap) schedules.',
        'Awtomatikong BIR TRAIN Law withholding tax at Minimum Wage Earner (MWE) toggle.',
      ],
    },
    ctaLabel: {
      en: 'Open Take-Home Pay Calculator',
      tl: 'Buksan ang Take-Home Pay Calculator',
    },
    keywords: [
      'take home pay',
      'net pay',
      'salary calculator philippines',
      'sahod',
      'suweldo',
      'kinsenas',
      'semi-monthly',
      'withholding tax',
      'bir tax',
      'train law',
      'minimum wage earner',
      'mwe',
      'gross to net',
      'deductions',
      'kaltas',
    ],
  },
  {
    id: '13th-month-pay',
    category: 'salary-net-pay',
    status: 'live',
    isPopular: true,
    isRecentlyAdded: false,
    urls: {
      en: '/13th-month-pay-calculator/',
      tl: '/tl/13th-month-pay-calculator/',
    },
    title: {
      en: '13th Month Pay Calculator',
      tl: '13th Month Pay Calculator',
    },
    shortTitle: {
      en: '13th Month Pay',
      tl: '13th Month Pay',
    },
    badge: {
      en: 'Available Now · PD 851 & TRAIN Law',
      tl: 'Magagamit Ngayon · PD 851 at TRAIN Law',
    },
    legalBasis: {
      en: 'Presidential Decree No. 851 & RA 10963',
      tl: 'Presidential Decree No. 851 at RA 10963',
    },
    description: {
      en: 'Calculate your mandatory 13th month pay for full-year or prorated employment and check the ₱90,000 BIR tax-exempt threshold.',
      tl: 'Kuwentahin ang iyong mandatoryong 13th month pay para sa buong taon o prorated na buwan at suriin ang ₱90,000 BIR tax-exempt limit.',
    },
    highlights: {
      en: [
        'Supports full 12-month, prorated months worked, or exact annual basic salary earned.',
        'Tracks the ₱90,000 aggregate tax-exempt ceiling with other year-end bonuses.',
        'Shows net tax-free 13th month pay vs. taxable excess portion.',
      ],
      tl: [
        'Suportado ang buong 12 buwan, prorated na buwan, o eksaktong kabuuang basic salary.',
        'Sinusuri ang ₱90,000 tax-exempt ceiling kasama ng iba pang bonus.',
        'Ipinapakita ang tax-free na bahagi at ang lampas na taxable portion.',
      ],
    },
    ctaLabel: {
      en: 'Open 13th Month Pay Calculator',
      tl: 'Buksan ang 13th Month Pay Calculator',
    },
    keywords: [
      '13th month pay',
      'thirteenth month',
      'bonus',
      'christmas bonus',
      'pd 851',
      '90000 tax exempt',
      'prorated 13th month',
      'year end pay',
      'december pay',
      'resigned 13th month',
    ],
  },
  {
    id: 'philhealth-calculator',
    category: 'government-contributions',
    status: 'live',
    isPopular: true,
    isRecentlyAdded: true,
    urls: {
      en: '/philhealth-contribution-calculator/',
      tl: '/tl/philhealth-contribution-calculator/',
    },
    title: {
      en: 'PhilHealth Contribution Calculator',
      tl: 'PhilHealth Contribution Calculator',
    },
    shortTitle: {
      en: 'PhilHealth Calculator',
      tl: 'PhilHealth Calculator',
    },
    badge: {
      en: 'Available Now · 5% Premium Rate',
      tl: 'Magagamit Ngayon · 5% Premium Rate',
    },
    legalBasis: {
      en: 'RA 11223 (UHC Act) · PhilHealth Advisory',
      tl: 'RA 11223 (UHC Act) · PhilHealth Advisory',
    },
    description: {
      en: 'Compute your 2026 PhilHealth monthly and per-cutoff premium using the 5.0% rate, ₱10,000 floor, ₱100,000 ceiling, and 50/50 employee-employer split.',
      tl: 'Kuwentahin ang iyong 2026 PhilHealth buwanan at kinsenas na kontribusyon gamit ang 5.0% rate, ₱10,000 floor, ₱100,000 ceiling, at 50/50 na hatian.',
    },
    highlights: {
      en: [
        'Equal 2.5% employee share and 2.5% employer share breakdown.',
        'Automatic ₱10,000 salary floor (₱250 EE) and ₱100,000 ceiling (₱2,500 EE) enforcement.',
        'Switch between monthly deduction and per-cutoff (kinsenas) deduction.',
      ],
      tl: [
        'Pantay na 2.5% bahagi ng empleyado at 2.5% bahagi ng employer.',
        'Awtomatikong ₱10,000 floor (₱250 EE) at ₱100,000 ceiling (₱2,500 EE).',
        'Lumipat sa pagitan ng buwanan at kinsenas (per-cutoff) na kaltas.',
      ],
    },
    ctaLabel: {
      en: 'Open PhilHealth Calculator',
      tl: 'Buksan ang PhilHealth Calculator',
    },
    keywords: [
      'philhealth',
      'nhip',
      'health insurance',
      '5 percent',
      '2.5 percent',
      'universal health care',
      'ra 11223',
      'philhealth table 2026',
      'philhealth contribution',
      'medical deduction',
    ],
  },
  {
    id: 'overtime-holiday-pay',
    category: 'overtime-holiday-pay',
    status: 'live',
    isPopular: true,
    isRecentlyAdded: true,
    urls: {
      en: '/overtime-holiday-pay-calculator-philippines/',
      tl: '/tl/overtime-holiday-pay-calculator-philippines/',
    },
    title: {
      en: 'Overtime & Holiday Pay Calculator',
      tl: 'Overtime & Holiday Pay Calculator',
    },
    shortTitle: {
      en: 'Overtime & Holiday Pay',
      tl: 'Overtime at Holiday Pay',
    },
    badge: {
      en: 'Available Now · DOLE Labor Code',
      tl: 'Magagamit Ngayon · DOLE Labor Code',
    },
    legalBasis: {
      en: 'DOLE Statutory Handbook & Labor Code',
      tl: 'DOLE Statutory Handbook at Labor Code',
    },
    description: {
      en: 'Calculate overtime pay, regular and special non-working holiday pay, rest day premiums, and 10% night shift differential (NSD) for Philippine employees.',
      tl: 'Kuwentahin ang overtime pay, regular at special non-working holiday pay, rest day premium, at 10% night shift differential (NSD) sa Pilipinas.',
    },
    highlights: {
      en: [
        'Supports ordinary workdays, rest days, special holidays (130%), and regular holidays (200%).',
        'Computes hourly overtime multipliers (125% / 130%) and combined double-holiday rates.',
        'Includes 10% Night Shift Differential (NSD) for both regular and overtime night hours.',
      ],
      tl: [
        'Suportado ang ordinary workday, rest day, special holiday (130%), at regular holiday (200%).',
        'Kinukuwenta ang hourly overtime multiplier (125% / 130%) at double-holiday rate.',
        'Kasama ang 10% Night Shift Differential (NSD) sa regular at overtime na oras sa gabi.',
      ],
    },
    ctaLabel: {
      en: 'Open Overtime & Holiday Calculator',
      tl: 'Buksan ang Overtime & Holiday Calculator',
    },
    keywords: [
      'overtime',
      'ot pay',
      'holiday pay',
      'regular holiday',
      'special non-working holiday',
      'rest day pay',
      'night shift differential',
      'nsd',
      'night diff',
      'dole',
      'labor code',
      'double holiday',
      'hourly rate',
      'daily rate',
    ],
  },
  {
    id: 'sss-table-2026',
    category: 'contribution-tables-guides',
    status: 'live',
    isPopular: true,
    isRecentlyAdded: true,
    urls: {
      en: '/sss-contribution-table-2026/',
      tl: '/tl/sss-contribution-table-2026/',
    },
    title: {
      en: 'SSS Contribution Table 2026',
      tl: 'Talahanayan ng Kontribusyon sa SSS 2026',
    },
    shortTitle: {
      en: 'SSS Table 2026',
      tl: 'Talahanayan ng SSS 2026',
    },
    badge: {
      en: 'Available Now · Interactive Lookup',
      tl: 'Magagamit Ngayon · Interactive Lookup',
    },
    legalBasis: {
      en: 'RA 11199 · Published SSS Contribution Schedules',
      tl: 'RA 11199 · Mga Nailathalang Iskedyul ng Kontribusyon ng SSS',
    },
    description: {
      en: 'Look up your 2026 SSS Monthly Salary Credit (MSC), 5% employee share, 10% employer share, Employees’ Compensation (EC), and Mandatory Provident Fund (MPF/WISP).',
      tl: 'Hanapin ang iyong 2026 SSS Monthly Salary Credit (MSC), 5% bahagi ng empleyado, 10% bahagi ng employer, EC, at Mandatory Provident Fund (MPF/WISP).',
    },
    highlights: {
      en: [
        'Instant salary lookup across all 61 official compensation brackets (₱5,000 to ₱35,000 MSC).',
        'Separates Regular Social Security (up to ₱20,000) and Mandatory Provident Fund (WISP).',
        'Filterable full schedule with Employee, Employer, EC (₱10/₱30), and Total remittances.',
      ],
      tl: [
        'Agarang paghahanap sa lahat ng 61 opisyal na bracket (₱5,000 hanggang ₱35,000 MSC).',
        'Hiwalay na Regular Social Security (hanggang ₱20,000) at Mandatory Provident Fund (WISP).',
        'kumpletong talahanayan na may bahagi ng Empleyado, Employer, EC (₱10/₱30), at Kabuuan.',
      ],
    },
    ctaLabel: {
      en: 'Open SSS Contribution Table',
      tl: 'Buksan ang SSS Contribution Table',
    },
    keywords: [
      'sss',
      'social security system',
      'sss table 2026',
      'msc',
      'monthly salary credit',
      'wisp',
      'mpf',
      'mandatory provident fund',
      'ec',
      'employees compensation',
      'ra 11199',
      '15 percent',
      '5 percent employee',
      'talahanayan ng sss',
    ],
  },
  {
    id: 'pagibig-mp2-estimator',
    category: 'government-contributions',
    status: 'live',
    isPopular: true,
    isRecentlyAdded: true,
    urls: {
      en: '/pagibig-mp2-savings-estimator/',
      tl: '/tl/pagibig-mp2-savings-estimator/',
    },
    title: {
      en: 'Pag-IBIG & MP2 Savings Estimator',
      tl: 'Pag-IBIG at MP2 Savings Estimator',
    },
    shortTitle: {
      en: 'Pag-IBIG & MP2 Estimator',
      tl: 'Pag-IBIG at MP2 Estimator',
    },
    badge: {
      en: '₱10,000 MFS · MP2 Dividends',
      tl: '₱10,000 MFS · MP2 Dibidendo',
    },
    legalBasis: {
      en: 'HDMF Circular No. 460 (₱10,000 MFS Ceiling) & MP2 Program',
      tl: 'HDMF Circular No. 460 (₱10,000 MFS Ceiling) at MP2 Program',
    },
    description: {
      en: 'Dedicated mandatory Pag-IBIG Regular Savings calculator (₱200 max employee share) paired with voluntary 1–5 year MP2 compounded vs. annual dividend payout projections.',
      tl: 'Nakalaang Pag-IBIG Regular Savings calculator (₱200 max na bahagi ng empleyado) kasama ng voluntary 1–5 taong MP2 compounded o taunang dividend payout projection.',
    },
    highlights: {
      en: [
        'Mandatory Pag-IBIG I employee & employer contribution calculator (1% / 2% up to ₱10,000 MFS ceiling).',
        '1 to 5-year Modified Pag-IBIG II (MP2) annual dividend payout vs. compounded maturity estimator.',
        'User-selectable assumed dividend rate with full year-by-year projection breakdown.',
      ],
      tl: [
        'Mandatoryong Pag-IBIG I employee at employer contribution calculator (1% / 2% hanggang ₱10,000 MFS ceiling).',
        '1 hanggang 5-taong Modified Pag-IBIG II (MP2) taunang payout vs. compounded maturity estimator.',
        'Mapipiling assumed dividend rate na may taon-taong talahanayan ng projection.',
      ],
    },
    ctaLabel: {
      en: 'Open Pag-IBIG & MP2 Calculator',
      tl: 'Buksan ang Pag-IBIG at MP2 Calculator',
    },
    keywords: [
      'pag-ibig',
      'pagibig',
      'hdmf',
      'mp2',
      'modified pag-ibig 2',
      'savings',
      'dividend',
      '200 pesos',
      'circular 460',
    ],
  },
  {
    id: 'final-pay-calculator',
    category: 'salary-net-pay',
    status: 'live',
    isPopular: true,
    isRecentlyAdded: true,
    urls: {
      en: '/final-pay-calculator-philippines/',
      tl: '/tl/final-pay-calculator-philippines/',
    },
    title: {
      en: 'Final Pay Calculator Philippines',
      tl: 'Final Pay Calculator Pilipinas',
    },
    shortTitle: {
      en: 'Final Pay Calculator',
      tl: 'Final Pay Calculator',
    },
    badge: {
      en: 'Available Now · DOLE Advisory 06-20',
      tl: 'Magagamit Ngayon · DOLE Advisory 06-20',
    },
    legalBasis: {
      en: 'DOLE Labor Advisory No. 06-20, Labor Code Arts. 95 & 297–300, PD 851 & TRAIN Law',
      tl: 'DOLE Labor Advisory No. 06-20, Labor Code Arts. 95 at 297–300, PD 851 at TRAIN Law',
    },
    description: {
      en: 'Estimate your Philippine final pay (back pay) upon resignation, redundancy, retrenchment, or contract completion including unpaid wages, prorated 13th month pay, SIL & leave conversion, separation pay, and BIR tax exemptions.',
      tl: 'Kalkulahin ang iyong Final Pay (Back Pay o Huling Sahod) sa Pilipinas kapag nag-resign, na-redundancy, o na-retrench kasama ang hindi pa nababayarang sahod, prorated 13th month pay, leave conversion (SIL/VL/SL), separation pay, at BIR tax exemptions.',
    },
    highlights: {
      en: [
        'Computes unpaid cutoff wages, prorated 13th month pay, and SIL/VL/SL cash conversion.',
        'Applies Labor Code Art. 298–299 separation pay rules (1 month or 1/2 month per year of service).',
        'Tracks BIR NIRC Sec. 32(B) tax exemptions (12-day VL de minimis & ₱90,000 cap) and separate clearance claims.',
      ],
      tl: [
        'Kinukuwenta ang hindi pa nababayarang sahod, prorated 13th month pay, at SIL/VL/SL cash conversion.',
        'Inilalapat ang Labor Code Art. 298–299 separation pay rules (1 buwan o 1/2 buwan bawat taon ng serbisyo).',
        'Sinusuri ang BIR NIRC Sec. 32(B) tax exemptions (12-araw VL de minimis at ₱90,000 cap) at hiwalay na clearance claims.',
      ],
    },
    ctaLabel: {
      en: 'Open Final Pay Calculator',
      tl: 'Buksan ang Final Pay Calculator',
    },
    keywords: [
      'final pay',
      'back pay',
      'backpay',
      'huling sahod',
      'separation pay',
      'resignation',
      'redundancy',
      'retrenchment',
      'dole labor advisory 06-20',
      'service incentive leave',
      'sil conversion',
      'leave monetization',
      'unused leave',
      'clearance',
      'prorated 13th month',
      'quitclaim',
    ],
  },
] as const;

/**
 * Returns only functional, live calculators (`status === 'live'`).
 * Coming Soon tools are strictly excluded so they never inflate live calculator counts.
 */
export function getLiveCalculators(): CalculatorMetadata[] {
  return CALCULATORS_REGISTRY.filter((tool) => tool.status === 'live');
}

/**
 * Returns the exact count of functional, live calculators (`6`).
 */
export function getTotalLiveCalculatorCount(): number {
  return getLiveCalculators().length;
}

/**
 * Computes the live calculator counts per category (excluding all `coming-soon` entries).
 */
export function getLiveCategoryCounts(): Record<'all' | CalculatorCategoryId, number> {
  const liveTools = getLiveCalculators();
  const counts: Record<'all' | CalculatorCategoryId, number> = {
    all: liveTools.length,
    'salary-net-pay': 0,
    'government-contributions': 0,
    'overtime-holiday-pay': 0,
    'contribution-tables-guides': 0,
  };

  for (const tool of liveTools) {
    counts[tool.category] = (counts[tool.category] || 0) + 1;
  }

  return counts;
}

/**
 * Evaluates whether a calculator matches a user search query across bilingual titles,
 * descriptions, highlights, legal basis, category labels, and keywords.
 */
export function matchesCalculatorSearch(
  tool: CalculatorMetadata,
  rawQuery: string,
  lang: CalculatorLanguage = 'en'
): boolean {
  const normalizedQuery = rawQuery.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const categoryObj = CALCULATOR_CATEGORIES.find((cat) => cat.id === tool.category);

  const searchableCorpus = [
    tool.id,
    tool.title.en,
    tool.title.tl,
    tool.shortTitle.en,
    tool.shortTitle.tl,
    tool.description.en,
    tool.description.tl,
    tool.legalBasis.en,
    tool.legalBasis.tl,
    tool.badge.en,
    tool.badge.tl,
    ...tool.highlights.en,
    ...tool.highlights.tl,
    ...tool.keywords,
    categoryObj ? categoryObj.label[lang] : '',
    categoryObj ? categoryObj.label.en : '',
    categoryObj ? categoryObj.label.tl : '',
  ]
    .join(' ')
    .toLowerCase();

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return tokens.every((token) => searchableCorpus.includes(token));
}
