import type {
  CampaignObjective,
  CampaignPlatform,
  CampaignState,
  FinishingStatus,
  LeadSource,
  LeadStage,
  PropertyType,
  UsageType,
} from '@alola/contracts';

/**
 * The fictional demonstration data, in one place.
 *
 * **Everything here is invented.** No client, customer, employee, project, phone number, e-mail
 * address, or national identifier in this file refers to a real person or company:
 *
 * - e-mail addresses use `demo.invalid`, a reserved top-level domain that can never be delivered to;
 * - phone numbers are a sequential synthetic series, not an allocated numbering range;
 * - national identifiers are written `DEMO-NID-…` so they cannot be mistaken for a real document;
 * - the developer, its projects, its buildings and its campaigns do not exist.
 *
 * Keeping it in one file, separate from the code that writes it, is what makes that claim checkable:
 * a reviewer reads this file and knows exactly what the demonstration contains, without tracing a
 * seeding routine. The amounts are plausible for the Egyptian market so the screens look like a
 * working system; they are not drawn from anyone's price list.
 */

export const DEMO_CURRENCY = 'EGP';
export const DEMO_TIME_ZONE = 'Africa/Cairo';

/* --------------------------------------------------------------- organization */

export const LEGAL_ENTITY = {
  code: 'LE-DEMO',
  name: { ar: 'دار المستقبل للتطوير العقاري', en: 'Future House Development' },
  taxNumber: 'DEMO-TAX-0001',
} as const;

export const BRANCHES = [
  {
    code: 'BR-CAI',
    name: { ar: 'فرع القاهرة الجديدة', en: 'New Cairo branch' },
    city: { ar: 'القاهرة الجديدة', en: 'New Cairo' },
  },
  {
    code: 'BR-ALX',
    name: { ar: 'فرع الإسكندرية', en: 'Alexandria branch' },
    city: { ar: 'الإسكندرية', en: 'Alexandria' },
  },
] as const;

export const DEPARTMENTS = [
  {
    code: 'DP-CAI-SALES',
    branchCode: 'BR-CAI',
    name: { ar: 'إدارة المبيعات', en: 'Sales' },
    costCenterCode: 'CC-SAL',
  },
  {
    code: 'DP-CAI-COLL',
    branchCode: 'BR-CAI',
    name: { ar: 'إدارة التحصيل', en: 'Collections' },
    costCenterCode: 'CC-COL',
  },
  {
    code: 'DP-CAI-MKT',
    branchCode: 'BR-CAI',
    name: { ar: 'إدارة التسويق', en: 'Marketing' },
    costCenterCode: 'CC-MKT',
  },
  {
    code: 'DP-CAI-ADM',
    branchCode: 'BR-CAI',
    name: { ar: 'الإدارة العامة', en: 'Administration' },
    costCenterCode: 'CC-ADM',
  },
  {
    code: 'DP-ALX-SALES',
    branchCode: 'BR-ALX',
    name: { ar: 'مبيعات الإسكندرية', en: 'Alexandria sales' },
    costCenterCode: 'CC-SAL',
  },
] as const;

export const TEAMS = [
  {
    code: 'TM-CAI-S1',
    departmentCode: 'DP-CAI-SALES',
    name: { ar: 'فريق المبيعات الأول', en: 'Sales team one' },
  },
  {
    code: 'TM-CAI-S2',
    departmentCode: 'DP-CAI-SALES',
    name: { ar: 'فريق المبيعات الثاني', en: 'Sales team two' },
  },
] as const;

export const JOB_TITLES = [
  { code: 'JT-EXEC', name: { ar: 'مدير عام', en: 'General manager' } },
  { code: 'JT-SYSADMIN', name: { ar: 'مسؤول النظام', en: 'System administrator' } },
  { code: 'JT-SALESMGR', name: { ar: 'مدير مبيعات', en: 'Sales manager' } },
  { code: 'JT-SALESREP', name: { ar: 'مندوب مبيعات', en: 'Sales representative' } },
  { code: 'JT-COLLOFF', name: { ar: 'مسؤول تحصيل', en: 'Collection officer' } },
  { code: 'JT-ACCOUNTANT', name: { ar: 'محاسب', en: 'Accountant' } },
  { code: 'JT-MKTMGR', name: { ar: 'مدير تسويق', en: 'Marketing manager' } },
] as const;

/* -------------------------------------------------------------------- accounts */

export interface DemoAccount {
  key: string;
  loginIdentifier: string;
  displayName: string;
  roleKey: string;
  roleLabel: string;
  scopeNote: string;
  jobTitleCode: string;
  departmentCode: string;
  teamCode?: string;
  managerKey?: string;
  /** Branch codes the account's data scope is limited to. Absent means the whole organization. */
  branchCodes?: string[];
}

/**
 * Eight accounts for seven roles: the sales representative role is seeded twice so the pipeline has
 * more than one owner and the dashboard has something to compare.
 *
 * Both representatives and their manager are scoped to the New Cairo branch, so the Alexandria
 * project is invisible to all three while the executive, the administrator, the collection officer
 * and the accountant see it. That is the scope difference this demonstration shows, and the server
 * enforces it inside the query — hiding a menu entry would not.
 */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    key: 'executive',
    loginIdentifier: 'executive@demo.invalid',
    displayName: 'هشام الجندي',
    roleKey: 'demo-executive',
    roleLabel: 'الإدارة التنفيذية — Executive management',
    scopeNote: 'Whole organization, read-only across sales, collections and marketing.',
    jobTitleCode: 'JT-EXEC',
    departmentCode: 'DP-CAI-ADM',
  },
  {
    key: 'admin',
    loginIdentifier: 'admin@demo.invalid',
    displayName: 'سلمى رضا',
    roleKey: 'demo-system-administrator',
    roleLabel: 'مسؤول النظام — System administrator',
    scopeNote:
      'Whole organization. Security, roles, grants, audit, approvals and the unit catalogue.',
    jobTitleCode: 'JT-SYSADMIN',
    departmentCode: 'DP-CAI-ADM',
    managerKey: 'executive',
  },
  {
    key: 'salesManager',
    loginIdentifier: 'sales.manager@demo.invalid',
    displayName: 'أحمد شوقي',
    roleKey: 'demo-sales-manager',
    roleLabel: 'مدير المبيعات — Sales manager',
    scopeNote: 'New Cairo branch only. Confirms reservations and approves discounts.',
    jobTitleCode: 'JT-SALESMGR',
    departmentCode: 'DP-CAI-SALES',
    managerKey: 'executive',
    branchCodes: ['BR-CAI'],
  },
  {
    key: 'rep1',
    loginIdentifier: 'sales.one@demo.invalid',
    displayName: 'نورهان سامي',
    roleKey: 'demo-sales-representative',
    roleLabel: 'مندوب مبيعات ١ — Sales representative one',
    scopeNote: 'New Cairo branch only. Alexandria is not visible to this account.',
    jobTitleCode: 'JT-SALESREP',
    departmentCode: 'DP-CAI-SALES',
    teamCode: 'TM-CAI-S1',
    managerKey: 'salesManager',
    branchCodes: ['BR-CAI'],
  },
  {
    key: 'rep2',
    loginIdentifier: 'sales.two@demo.invalid',
    displayName: 'كريم مصطفى',
    roleKey: 'demo-sales-representative',
    roleLabel: 'مندوب مبيعات ٢ — Sales representative two',
    scopeNote: 'New Cairo branch only. Alexandria is not visible to this account.',
    jobTitleCode: 'JT-SALESREP',
    departmentCode: 'DP-CAI-SALES',
    teamCode: 'TM-CAI-S2',
    managerKey: 'salesManager',
    branchCodes: ['BR-CAI'],
  },
  {
    key: 'collector',
    loginIdentifier: 'collections@demo.invalid',
    displayName: 'ياسمين فؤاد',
    roleKey: 'demo-collection-officer',
    roleLabel: 'مسؤول التحصيل — Collection officer',
    scopeNote: 'Whole organization. Records receipts, holds instruments, generates reminders.',
    jobTitleCode: 'JT-COLLOFF',
    departmentCode: 'DP-CAI-COLL',
    managerKey: 'executive',
  },
  {
    key: 'accountant',
    loginIdentifier: 'accounting@demo.invalid',
    displayName: 'محمود عبد العزيز',
    roleKey: 'demo-accountant',
    roleLabel: 'محاسب — Accountant',
    scopeNote: 'Whole organization. May reverse a receipt; may not record one.',
    jobTitleCode: 'JT-ACCOUNTANT',
    departmentCode: 'DP-CAI-COLL',
    managerKey: 'executive',
  },
  {
    key: 'marketing',
    loginIdentifier: 'marketing@demo.invalid',
    displayName: 'دينا حسن',
    roleKey: 'demo-marketing-manager',
    roleLabel: 'مدير التسويق — Marketing manager',
    scopeNote: 'Whole organization. Local campaign drafts only — no provider is connected.',
    jobTitleCode: 'JT-MKTMGR',
    departmentCode: 'DP-CAI-MKT',
    managerKey: 'executive',
  },
];

/* ------------------------------------------------------------------- inventory */

export const PROJECTS = [
  {
    code: 'PRJ-OASIS',
    branchCode: 'BR-CAI',
    name: { ar: 'كمبوند الواحة', en: 'Oasis Compound' },
    city: { ar: 'القاهرة الجديدة', en: 'New Cairo' },
    description: {
      ar: 'مشروع سكني متكامل (بيانات تجريبية)',
      en: 'An integrated residential project (demonstration data)',
    },
  },
  {
    code: 'PRJ-CORNICHE',
    branchCode: 'BR-ALX',
    name: { ar: 'أبراج الكورنيش', en: 'Corniche Towers' },
    city: { ar: 'الإسكندرية', en: 'Alexandria' },
    description: {
      ar: 'أبراج سكنية بإطلالة بحرية (بيانات تجريبية)',
      en: 'Residential towers with a sea view (demonstration data)',
    },
  },
] as const;

export const BUILDINGS = [
  {
    code: 'OASIS-A',
    projectCode: 'PRJ-OASIS',
    name: { ar: 'مبنى أ', en: 'Building A' },
    zone: { ar: 'المنطقة الشمالية', en: 'North zone' },
    floors: 6,
    unitsPerFloor: 4,
    pricePerSquareMeter: 24000,
  },
  {
    code: 'OASIS-B',
    projectCode: 'PRJ-OASIS',
    name: { ar: 'مبنى ب', en: 'Building B' },
    zone: { ar: 'المنطقة الجنوبية', en: 'South zone' },
    floors: 4,
    unitsPerFloor: 3,
    pricePerSquareMeter: 22500,
  },
  {
    code: 'CORNICHE-T1',
    projectCode: 'PRJ-CORNICHE',
    name: { ar: 'البرج الأول', en: 'Tower one' },
    zone: { ar: 'الواجهة البحرية', en: 'Sea front' },
    floors: 5,
    unitsPerFloor: 2,
    pricePerSquareMeter: 32000,
  },
] as const;

const PROPERTY_CYCLE: PropertyType[] = ['apartment', 'apartment', 'duplex', 'penthouse'];
const FINISHING_CYCLE: FinishingStatus[] = [
  'fullyFinished',
  'semiFinished',
  'fullyFinishedWithAppliances',
  'coreAndShell',
];
const VIEW_CYCLE = [
  { ar: 'إطلالة على الحديقة', en: 'Garden view' },
  { ar: 'إطلالة على حمام السباحة', en: 'Pool view' },
  { ar: 'إطلالة جانبية', en: 'Side view' },
  { ar: 'إطلالة بانورامية', en: 'Panoramic view' },
];

export interface DemoUnit {
  code: string;
  buildingCode: string;
  floor: number;
  propertyType: PropertyType;
  usageType: UsageType;
  area: string;
  basePrice: string;
  finishingStatus: FinishingStatus;
  view: { ar: string; en: string };
}

/**
 * Units are derived rather than listed, so the inventory is large enough to look like a real one
 * without a thousand hand-written lines. The derivation is **deterministic** — same codes, same
 * areas, same prices on every run — which is what lets the seed be idempotent and lets the
 * walkthrough script name a specific unit and find it there.
 */
export function buildUnits(): DemoUnit[] {
  const units: DemoUnit[] = [];
  for (const building of BUILDINGS) {
    for (let floor = 1; floor <= building.floors; floor += 1) {
      for (let index = 0; index < building.unitsPerFloor; index += 1) {
        const propertyType = PROPERTY_CYCLE[(floor + index) % PROPERTY_CYCLE.length] ?? 'apartment';
        const isPenthouse = floor === building.floors && propertyType === 'penthouse';
        const area = 95 + index * 18 + (floor - 1) * 4 + (isPenthouse ? 45 : 0);
        // A higher floor carries a premium, and the top floor carries more. Whole pounds only.
        const premium = 1 + floor * 0.015 + (isPenthouse ? 0.08 : 0);
        const price = Math.round(area * building.pricePerSquareMeter * premium);
        const floorPart = String(floor).padStart(2, '0');
        const indexPart = String(index + 1).padStart(2, '0');
        units.push({
          code: `${building.code}-${floorPart}${indexPart}`,
          buildingCode: building.code,
          floor,
          propertyType,
          usageType: 'residential',
          area: `${area}.00`,
          basePrice: `${price}.00`,
          finishingStatus:
            FINISHING_CYCLE[(floor + index) % FINISHING_CYCLE.length] ?? 'fullyFinished',
          view: VIEW_CYCLE[(floor + index) % VIEW_CYCLE.length] ?? { ar: 'بدون', en: 'None' },
        });
      }
    }
  }
  return units;
}

/* ------------------------------------------------------------------------- CRM */

export interface DemoLead {
  key: string;
  name: string;
  phoneSuffix: number;
  email?: string;
  source: LeadSource;
  stage: LeadStage;
  ownerKey: 'rep1' | 'rep2';
  branchCode: string;
  projectCode: string;
  budgetMin: number;
  budgetMax: number;
  campaignKey?: string;
  notes: string;
  /** Days from today; negative is in the past. Absent means no follow-up is scheduled. */
  followUpInDays?: number;
}

/** Synthetic and sequential — not an allocated numbering range. */
export function demoPhone(suffix: number): string {
  return `+2010${String(suffix).padStart(8, '0')}`;
}

export const DEMO_LEADS: DemoLead[] = [
  {
    key: 'mona',
    name: 'منى عبد الرحمن',
    phoneSuffix: 1001,
    email: 'mona@demo.invalid',
    source: 'facebook',
    stage: 'won',
    ownerKey: 'rep1',
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    budgetMin: 2500000,
    budgetMax: 3500000,
    campaignKey: 'oasis-launch',
    notes: 'مهتمة بوحدة بثلاث غرف بإطلالة على الحديقة.',
  },
  {
    key: 'tarek',
    name: 'طارق الشاذلي',
    phoneSuffix: 1002,
    email: 'tarek@demo.invalid',
    source: 'instagram',
    stage: 'negotiation',
    ownerKey: 'rep1',
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    budgetMin: 3000000,
    budgetMax: 4200000,
    campaignKey: 'oasis-launch',
    notes: 'يفاوض على خطة سداد أطول.',
    followUpInDays: 2,
  },
  {
    key: 'heba',
    name: 'هبة السيد',
    phoneSuffix: 1003,
    source: 'whatsapp',
    stage: 'visitScheduled',
    ownerKey: 'rep1',
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    budgetMin: 2000000,
    budgetMax: 2600000,
    notes: 'زيارة للموقع نهاية الأسبوع.',
    followUpInDays: 1,
  },
  {
    key: 'sameh',
    name: 'سامح رياض',
    phoneSuffix: 1004,
    email: 'sameh@demo.invalid',
    source: 'website',
    stage: 'qualified',
    ownerKey: 'rep1',
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    budgetMin: 1800000,
    budgetMax: 2400000,
    campaignKey: 'search-brand',
    notes: 'يبحث عن وحدة نصف تشطيب.',
    followUpInDays: 4,
  },
  {
    key: 'nada',
    name: 'ندى الشريف',
    phoneSuffix: 1005,
    source: 'referral',
    stage: 'contacted',
    ownerKey: 'rep1',
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    budgetMin: 1500000,
    budgetMax: 2000000,
    notes: 'ترشيح من عميل حالي.',
    followUpInDays: -1,
  },
  {
    key: 'omar',
    name: 'عمر الديب',
    phoneSuffix: 1006,
    source: 'phoneCall',
    stage: 'new',
    ownerKey: 'rep1',
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    budgetMin: 1200000,
    budgetMax: 1800000,
    notes: 'اتصال وارد، لم يتم التواصل بعد.',
    followUpInDays: 0,
  },
  {
    key: 'laila',
    name: 'ليلى منصور',
    phoneSuffix: 1007,
    email: 'laila@demo.invalid',
    source: 'facebook',
    stage: 'reservation',
    ownerKey: 'rep2',
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    budgetMin: 2800000,
    budgetMax: 3600000,
    campaignKey: 'oasis-launch',
    notes: 'في انتظار استكمال المستندات.',
    followUpInDays: 3,
  },
  {
    key: 'fady',
    name: 'فادي إبراهيم',
    phoneSuffix: 1008,
    source: 'broker',
    stage: 'negotiation',
    ownerKey: 'rep2',
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    budgetMin: 3500000,
    budgetMax: 4800000,
    notes: 'عن طريق وسيط، يطلب خصمًا إضافيًا.',
    followUpInDays: 5,
  },
  {
    key: 'rania',
    name: 'رانيا عبد الله',
    phoneSuffix: 1009,
    source: 'walkIn',
    stage: 'qualified',
    ownerKey: 'rep2',
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    budgetMin: 1900000,
    budgetMax: 2500000,
    notes: 'زيارة لمعرض البيع.',
    followUpInDays: 7,
  },
  {
    key: 'hossam',
    name: 'حسام النجار',
    phoneSuffix: 1010,
    source: 'instagram',
    stage: 'contacted',
    ownerKey: 'rep2',
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    budgetMin: 1400000,
    budgetMax: 1900000,
    campaignKey: 'oasis-retargeting',
    notes: 'رد على إعلان إعادة الاستهداف.',
    followUpInDays: 2,
  },
  {
    key: 'shaimaa',
    name: 'شيماء عادل',
    phoneSuffix: 1011,
    source: 'other',
    stage: 'lost',
    ownerKey: 'rep2',
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    budgetMin: 900000,
    budgetMax: 1200000,
    notes: 'الميزانية أقل من المتاح حاليًا.',
  },
  {
    key: 'walid',
    name: 'وليد قاسم',
    phoneSuffix: 1012,
    email: 'walid@demo.invalid',
    source: 'website',
    stage: 'won',
    ownerKey: 'rep2',
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    budgetMin: 4000000,
    budgetMax: 5500000,
    campaignKey: 'corniche-awareness',
    notes: 'تعاقد على وحدة بإطلالة بانورامية.',
  },
];

/* ------------------------------------------------------------------- marketing */

export interface DemoCampaign {
  key: string;
  name: string;
  platform: CampaignPlatform;
  objective: CampaignObjective;
  budget: number;
  branchCode: string;
  projectCode?: string;
  state: CampaignState;
  startsInDays: number;
  endsInDays?: number;
  audienceSummary: string;
  creativeHeadline: string;
  creativeBody: string;
  /**
   * Illustrative figures only. They are stored under `demoMetrics`, never `metrics`, and the
   * marketing screens label them as such: no provider is connected and nothing was ever delivered
   * (ADR-0026).
   */
  demoMetrics: { impressions: number; reach: number; clicks: number; leads: number; spend: number };
}

export const DEMO_CAMPAIGNS: DemoCampaign[] = [
  {
    key: 'oasis-launch',
    name: 'إطلاق كمبوند الواحة',
    platform: 'facebook',
    objective: 'leadGeneration',
    budget: 150000,
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    state: 'readyToPublish',
    startsInDays: -45,
    endsInDays: 15,
    audienceSummary: 'القاهرة الجديدة والتجمع، من ٣٠ إلى ٤٥ سنة، مهتمون بالعقارات.',
    creativeHeadline: 'وحدتك في كمبوند الواحة',
    creativeBody: 'خطط سداد حتى ٨ سنوات. سجّل بياناتك ليتواصل معك فريق المبيعات.',
    demoMetrics: { impressions: 412000, reach: 168000, clicks: 9400, leads: 320, spend: 96500 },
  },
  {
    key: 'oasis-retargeting',
    name: 'إعادة استهداف زوار الواحة',
    platform: 'instagram',
    objective: 'conversions',
    budget: 60000,
    branchCode: 'BR-CAI',
    projectCode: 'PRJ-OASIS',
    state: 'draft',
    startsInDays: -20,
    audienceSummary: 'زوار صفحة المشروع خلال آخر ٣٠ يومًا.',
    creativeHeadline: 'ما زالت وحدتك متاحة',
    creativeBody: 'عدد محدود من الوحدات بإطلالة على الحديقة.',
    demoMetrics: { impressions: 88000, reach: 41000, clicks: 3100, leads: 74, spend: 21300 },
  },
  {
    key: 'search-brand',
    name: 'حملة البحث باسم الشركة',
    platform: 'google',
    objective: 'traffic',
    budget: 45000,
    branchCode: 'BR-CAI',
    state: 'readyToPublish',
    startsInDays: -60,
    audienceSummary: 'عمليات البحث باسم الشركة وأسماء المشروعات.',
    creativeHeadline: 'دار المستقبل للتطوير العقاري',
    creativeBody: 'تعرف على مشروعاتنا في القاهرة الجديدة والإسكندرية.',
    demoMetrics: { impressions: 54000, reach: 38000, clicks: 6200, leads: 110, spend: 18700 },
  },
  {
    key: 'corniche-awareness',
    name: 'التوعية بأبراج الكورنيش',
    platform: 'tiktok',
    objective: 'awareness',
    budget: 80000,
    branchCode: 'BR-ALX',
    projectCode: 'PRJ-CORNICHE',
    state: 'archived',
    startsInDays: -120,
    endsInDays: -30,
    audienceSummary: 'الإسكندرية والساحل الشمالي، من ٢٥ إلى ٤٥ سنة.',
    creativeHeadline: 'إطلالة بحرية في قلب الإسكندرية',
    creativeBody: 'جولة داخل الوحدات النموذجية بأبراج الكورنيش.',
    demoMetrics: { impressions: 610000, reach: 295000, clicks: 12800, leads: 205, spend: 79200 },
  },
];
