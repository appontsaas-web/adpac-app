// Message dictionaries. Phase 1 seeds the confirmed glossary (metrics + core UI
// terms); screens are migrated onto these in Phase 2. Rule for NEW features:
// never hardcode a user-facing string — add it here in BOTH languages.
//
// Metric labels in Arabic follow the confirmed format "Arabic (English)".

import type { Locale } from './config';

const en = {
  common: {
    appName: 'AdPac',
    dashboard: 'Dashboard',
    clients: 'Clients',
    client: 'Client',
    team: 'Team',
    account: 'Account',
    signOut: 'Sign out',
    language: 'Language',
    campaign: 'Campaign',
    campaigns: 'Campaigns',
    adGroup: 'Ad group',
    ad: 'Ad',
    budget: 'Budget',
    reporting: 'Reporting',
    summary: 'Summary',
    sync: 'Sync',
    connect: 'Connect',
    disconnect: 'Disconnect',
    dateRange: 'Date range',
    compare: 'Compare',
    exportReport: 'Export report',
    invoices: 'Invoices',
    finance: 'Finance',
    tokens: 'Tokens',
    position: 'Position',
    approve: 'Approve',
    dismiss: 'Dismiss',
    aiInsights: 'AI insights',
    monthlyGoal: 'Monthly goal',
    privacyPolicy: 'Privacy Policy',
    terms: 'Terms',
    save: 'Save',
    cancel: 'Cancel',
    loading: 'Loading…',
  },
  metrics: {
    spend: 'Spend',
    clicks: 'Clicks',
    clicksSwipes: 'Clicks (swipes)',
    impressions: 'Impressions',
    ctr: 'CTR',
    avgCpc: 'Avg. CPC',
    conversions: 'Conversions',
    costPerConversion: 'Cost / conversion',
    conversionValue: 'Conversion value',
    roas: 'ROAS',
    purchases: 'Purchases',
    storeVisits: 'Store visits',
    mapClicks: 'Map clicks',
    localActionsDirections: 'Local actions - Directions',
    businessProfileDirections: 'Business profile - Directions',
    searchImpressionShare: 'Search impr. share',
    budgetLostShare: 'Impr. share lost (budget)',
    rankLostShare: 'Impr. share lost (rank)',
    topImpressionRate: 'Top of page rate',
    absTopImpressionRate: 'Abs. top of page rate',
    cpm: 'CPM',
    avgDailyReach: 'Avg. daily reach',
  },
};

type Dict = typeof en;

const ar: Dict = {
  common: {
    appName: 'AdPac',
    dashboard: 'لوحة التحكم',
    clients: 'العملاء',
    client: 'العميل',
    team: 'الفريق',
    account: 'الحساب',
    signOut: 'تسجيل الخروج',
    language: 'اللغة',
    campaign: 'الحملة',
    campaigns: 'الحملات',
    adGroup: 'المجموعة الإعلانية',
    ad: 'الإعلان',
    budget: 'الميزانية',
    reporting: 'التقارير',
    summary: 'الملخص',
    sync: 'مزامنة',
    connect: 'ربط',
    disconnect: 'إلغاء الربط',
    dateRange: 'الفترة الزمنية',
    compare: 'مقارنة',
    exportReport: 'تصدير التقرير',
    invoices: 'الفواتير',
    finance: 'المالية',
    tokens: 'الرصيد (Tokens)',
    position: 'المنصب',
    approve: 'موافقة',
    dismiss: 'تجاهل',
    aiInsights: 'رؤى الذكاء الاصطناعي',
    monthlyGoal: 'الهدف الشهري',
    privacyPolicy: 'سياسة الخصوصية',
    terms: 'الشروط',
    save: 'حفظ',
    cancel: 'إلغاء',
    loading: 'جارٍ التحميل…',
  },
  metrics: {
    spend: 'الإنفاق (Spend)',
    clicks: 'النقرات (Clicks)',
    clicksSwipes: 'النقرات (Clicks – swipes)',
    impressions: 'مرات الظهور (Impressions)',
    ctr: 'معدل النقر إلى الظهور (CTR)',
    avgCpc: 'متوسط تكلفة النقرة (Avg. CPC)',
    conversions: 'التحويلات (Conversions)',
    costPerConversion: 'تكلفة التحويل (Cost / conversion)',
    conversionValue: 'قيمة التحويلات (Conversion value)',
    roas: 'العائد على الإنفاق الإعلاني (ROAS)',
    purchases: 'المشتريات (Purchases)',
    storeVisits: 'زيارات المتجر (Store visits)',
    mapClicks: 'النقرات على الخريطة (Map clicks)',
    localActionsDirections: 'الإجراءات المحلية – الاتجاهات (Directions)',
    businessProfileDirections: 'ملف النشاط التجاري – الاتجاهات (Directions)',
    searchImpressionShare: 'حصة ظهور البحث (Search impr. share)',
    budgetLostShare: 'حصة الظهور المفقودة بسبب الميزانية (Lost – budget)',
    rankLostShare: 'حصة الظهور المفقودة بسبب الترتيب (Lost – rank)',
    topImpressionRate: 'معدل الظهور في أعلى الصفحة (Top of page rate)',
    absTopImpressionRate: 'معدل الظهور في أول موضع (Abs. top of page rate)',
    cpm: 'تكلفة الألف ظهور (CPM)',
    avgDailyReach: 'متوسط الوصول اليومي (Avg. daily reach)',
  },
};

export const MESSAGES: Record<Locale, Dict> = { en, ar };
export type MessageKey = `common.${keyof Dict['common']}` | `metrics.${keyof Dict['metrics']}`;

export function translate(locale: Locale, key: MessageKey): string {
  const [section, name] = key.split('.') as [keyof Dict, string];
  const dict = MESSAGES[locale] ?? MESSAGES.en;
  return (dict[section] as Record<string, string>)[name] ?? (MESSAGES.en[section] as Record<string, string>)[name] ?? key;
}
