import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';
import PDFDocument from 'pdfkit';
import path from 'path';

// GET /api/reports/export?platform=google&accountId=xxx&since=...&until=...
//   [&campaignId=xxx][&audienceDimension=age_range&audienceValue=...]
//   [&compareSince=...&compareUntil=...][&sections=kpis,trend,campaigns,audience,comparison]
// GET /api/reports/export?platform=meta&accountId=xxx&... (same params,
//   audienceDimension values are Meta's own: age|gender|country|region|
//   platform|hour)
//
// `sections` is the report-builder control — a comma-separated subset of
// kpis|trend|campaigns|audience|comparison choosing which blocks appear in
// the PDF. Omitting it (or passing nothing recognized) includes every
// section, so the plain "Export PDF" quick button — which never sends this
// param — keeps behaving exactly as it did before the builder existed.
// `comparison` only ever renders when a compare range was also given; it's
// a real section rather than an implicit one so the report builder can let
// someone hide the comparison line even while a compare period is active.
//
// Renders an AdPac-branded, watermarked PDF performance report — KPI
// summary, a spend trend chart, the per-campaign breakdown, audience
// breakdown tables, and (when a comparison range is given) a side-by-side
// period comparison. Built with pdfkit, same on-the-fly-generation pattern
// as /api/invoices/[id]/pdf (no stored file, always reflects current data).
// Deliberately re-queries the DB directly here rather than importing the
// GET handlers from /api/metrics and /api/meta-metrics (Next.js route
// handlers aren't meant to be called as plain functions) — the aggregation
// logic below is a trimmed-down mirror of those routes, kept in sync by
// hand. If those routes' totals shape changes, this should be revisited.

const ALL_SECTIONS = ['kpis', 'trend', 'campaigns', 'audience', 'comparison'] as const;
type ReportSection = (typeof ALL_SECTIONS)[number];

function parseSections(req: NextRequest): Set<ReportSection> {
  const raw = req.nextUrl.searchParams.get('sections');
  if (!raw) return new Set(ALL_SECTIONS);
  const picked = raw.split(',').map((s) => s.trim()).filter((s): s is ReportSection => (ALL_SECTIONS as readonly string[]).includes(s));
  return picked.length > 0 ? new Set(picked) : new Set(ALL_SECTIONS);
}

const LOGO_PATH = path.join(process.cwd(), 'public', 'adpac-logo.png');
const BRAND_PURPLE = '#6d5efc';
const BRAND_TEAL = '#22d3c9';
const INK = '#111';
const DIM = '#666';
const RULE = '#ddd';

function money(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(s: string | Date) {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function parseDateRange(req: NextRequest): { since: Date; until: Date } | null {
  const sinceParam = req.nextUrl.searchParams.get('since');
  const untilParam = req.nextUrl.searchParams.get('until');
  if (!sinceParam || !untilParam) return null;
  const since = new Date(sinceParam);
  const until = new Date(untilParam);
  if (isNaN(since.getTime()) || isNaN(until.getTime())) return null;
  until.setHours(23, 59, 59, 999);
  return { since, until };
}

interface ReportKpi {
  label: string;
  value: string;
}

interface ReportData {
  clientName: string;
  platformLabel: string; // "Google Ads" | "Meta Ads (Facebook & Instagram)"
  scopeLabel: string; // "All campaigns" or a specific campaign name, plus audience filter if any
  kpis: ReportKpi[];
  daily: { date: string; costCents: number }[];
  campaigns: { name: string; costCents: number; clicks: number; impressions: number; conversions: number }[];
  audience: { title: string; rows: { value: string; costCents: number; conversions: number }[] }[];
  compareTotalsCostCents?: number;
  compareTotalsConversions?: number;
  compareLabel?: string;
}

async function buildGoogleData(
  accountId: string,
  since: Date,
  until: Date,
  campaignId: string | null,
  audienceDimension: string | null,
  audienceValue: string | null
): Promise<ReportData | null> {
  const account = await db.googleAdsAccount.findUnique({ where: { id: accountId }, include: { client: true } });
  if (!account) return null;

  const campaigns = await db.campaign.findMany({
    where: { googleAdsAccountId: accountId, ...(campaignId ? { id: campaignId } : {}) },
    select: { id: true, name: true, status: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  const metrics =
    audienceDimension && audienceValue
      ? campaignIds.length
        ? (
            await db.audienceMetric.findMany({
              where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until }, dimension: audienceDimension, dimensionValue: audienceValue },
            })
          ).map((r) => ({ ...r, conversionValueCents: r.conversionValueCents }))
        : []
      : campaignIds.length
        ? await db.dailyMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } } })
        : [];

  const totals = metrics.reduce(
    (acc, m) => {
      acc.impressions += m.impressions;
      acc.clicks += m.clicks;
      acc.costCents += m.costCents;
      acc.conversions += m.conversions;
      acc.conversionValueCents += m.conversionValueCents;
      return acc;
    },
    { impressions: 0, clicks: 0, costCents: 0, conversions: 0, conversionValueCents: 0 }
  );
  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const avgCpcCents = totals.clicks > 0 ? totals.costCents / totals.clicks : 0;
  const costPerConvCents = totals.conversions > 0 ? totals.costCents / totals.conversions : 0;
  const roas = totals.costCents > 0 ? totals.conversionValueCents / totals.costCents : 0;

  const byDate = new Map<string, number>();
  for (const m of metrics) {
    const key = m.date.toISOString().slice(0, 10);
    byDate.set(key, (byDate.get(key) ?? 0) + m.costCents);
  }
  const daily = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, costCents]) => ({ date, costCents }));

  const byCampaign = new Map<string, { name: string; costCents: number; clicks: number; impressions: number; conversions: number }>();
  for (const m of metrics) {
    const c = campaigns.find((c) => c.id === m.campaignId);
    if (!c) continue;
    const entry = byCampaign.get(c.id) ?? { name: c.name, costCents: 0, clicks: 0, impressions: 0, conversions: 0 };
    entry.costCents += m.costCents;
    entry.clicks += m.clicks;
    entry.impressions += m.impressions;
    entry.conversions += m.conversions;
    byCampaign.set(c.id, entry);
  }
  const campaignRows = Array.from(byCampaign.values()).sort((a, b) => b.costCents - a.costCents);

  const audienceRows = campaignIds.length
    ? await db.audienceMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } } })
    : [];
  function summarizeDim(dim: string, prettify: (v: string) => string) {
    const byVal = new Map<string, { costCents: number; conversions: number }>();
    for (const r of audienceRows) {
      if (r.dimension !== dim) continue;
      const entry = byVal.get(r.dimensionValue) ?? { costCents: 0, conversions: 0 };
      entry.costCents += r.costCents;
      entry.conversions += r.conversions;
      byVal.set(r.dimensionValue, entry);
    }
    return Array.from(byVal.entries())
      .map(([value, m]) => ({ value: prettify(value), ...m }))
      .sort((a, b) => b.costCents - a.costCents)
      .slice(0, 6);
  }
  const prettifyAge = (v: string) => v.replace('AGE_RANGE_', '').replace('_', '-');
  const prettifyPlain = (v: string) => v;

  const kpis: ReportKpi[] = [
    { label: 'Spend', value: money(totals.costCents) },
    { label: 'Clicks', value: totals.clicks.toLocaleString() },
    { label: 'Impressions', value: totals.impressions.toLocaleString() },
    { label: 'CTR', value: `${(ctr * 100).toFixed(2)}%` },
    { label: 'Avg. CPC', value: money(avgCpcCents) },
    { label: 'Conversions', value: totals.conversions.toLocaleString() },
    { label: 'Cost / conversion', value: totals.conversions > 0 ? money(costPerConvCents) : '—' },
    { label: 'Conversion value', value: money(totals.conversionValueCents) },
    { label: 'ROAS', value: totals.costCents > 0 ? `${roas.toFixed(2)}x` : '—' },
  ];

  let scopeLabel = campaignId ? campaigns.find((c) => c.id === campaignId)?.name ?? 'Selected campaign' : 'All campaigns';
  if (audienceDimension && audienceValue) {
    scopeLabel += ` · ${audienceDimension.replace(/_/g, ' ')}: ${audienceDimension === 'age_range' ? prettifyAge(audienceValue) : audienceValue}`;
  }

  return {
    clientName: account.client.name,
    platformLabel: 'Google Ads',
    scopeLabel,
    kpis,
    daily,
    campaigns: campaignRows,
    audience: [
      { title: 'Age', rows: summarizeDim('age_range', prettifyAge) },
      { title: 'Gender', rows: summarizeDim('gender', prettifyPlain) },
      { title: 'Region', rows: summarizeDim('region', prettifyPlain) },
      { title: 'Device', rows: summarizeDim('device', prettifyPlain) },
    ],
  };
}

async function buildMetaData(
  accountId: string,
  since: Date,
  until: Date,
  campaignId: string | null,
  audienceDimension: string | null,
  audienceValue: string | null
): Promise<ReportData | null> {
  const account = await db.metaAdAccount.findUnique({ where: { id: accountId }, include: { client: true } });
  if (!account) return null;

  const campaigns = await db.metaCampaign.findMany({
    where: { adAccountId: accountId, ...(campaignId ? { id: campaignId } : {}) },
    select: { id: true, name: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  const metrics =
    audienceDimension && audienceValue
      ? campaignIds.length
        ? (
            await db.metaAudienceMetric.findMany({
              where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until }, dimension: audienceDimension, dimensionValue: audienceValue },
            })
          ).map((r) => ({ ...r, conversionValueCents: 0 }))
        : []
      : campaignIds.length
        ? await db.metaDailyMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } } })
        : [];

  const totals = metrics.reduce(
    (acc, m: any) => {
      acc.impressions += m.impressions;
      acc.clicks += m.clicks;
      acc.costCents += m.costCents;
      acc.conversions += m.conversions;
      acc.conversionValueCents += m.conversionValueCents ?? 0;
      return acc;
    },
    { impressions: 0, clicks: 0, costCents: 0, conversions: 0, conversionValueCents: 0 }
  );
  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const avgCpcCents = totals.clicks > 0 ? totals.costCents / totals.clicks : 0;
  const costPerConvCents = totals.conversions > 0 ? totals.costCents / totals.conversions : 0;
  const roas = totals.costCents > 0 ? totals.conversionValueCents / totals.costCents : 0;

  const byDate = new Map<string, number>();
  for (const m of metrics) {
    const key = m.date.toISOString().slice(0, 10);
    byDate.set(key, (byDate.get(key) ?? 0) + m.costCents);
  }
  const daily = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, costCents]) => ({ date, costCents }));

  const byCampaign = new Map<string, { name: string; costCents: number; clicks: number; impressions: number; conversions: number }>();
  for (const m of metrics) {
    const c = campaigns.find((c) => c.id === m.campaignId);
    if (!c) continue;
    const entry = byCampaign.get(c.id) ?? { name: c.name, costCents: 0, clicks: 0, impressions: 0, conversions: 0 };
    entry.costCents += m.costCents;
    entry.clicks += m.clicks;
    entry.impressions += m.impressions;
    entry.conversions += m.conversions;
    byCampaign.set(c.id, entry);
  }
  const campaignRows = Array.from(byCampaign.values()).sort((a, b) => b.costCents - a.costCents);

  const audienceRows = campaignIds.length
    ? await db.metaAudienceMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } } })
    : [];
  function summarizeDim(dim: string) {
    const byVal = new Map<string, { costCents: number; conversions: number }>();
    for (const r of audienceRows) {
      if (r.dimension !== dim) continue;
      const entry = byVal.get(r.dimensionValue) ?? { costCents: 0, conversions: 0 };
      entry.costCents += r.costCents;
      entry.conversions += r.conversions;
      byVal.set(r.dimensionValue, entry);
    }
    return Array.from(byVal.entries())
      .map(([value, m]) => ({ value, ...m }))
      .sort((a, b) => b.costCents - a.costCents)
      .slice(0, 6);
  }

  const kpis: ReportKpi[] = [
    { label: 'Spend', value: money(totals.costCents) },
    { label: 'Clicks', value: totals.clicks.toLocaleString() },
    { label: 'Impressions', value: totals.impressions.toLocaleString() },
    { label: 'CTR', value: `${(ctr * 100).toFixed(2)}%` },
    { label: 'Avg. CPC', value: money(avgCpcCents) },
    { label: 'Conversions', value: totals.conversions.toLocaleString() },
    { label: 'Cost / conversion', value: totals.conversions > 0 ? money(costPerConvCents) : '—' },
    { label: 'Conversion value', value: money(totals.conversionValueCents) },
    { label: 'ROAS', value: totals.costCents > 0 && !audienceDimension ? `${roas.toFixed(2)}x` : '—' },
  ];

  let scopeLabel = campaignId ? campaigns.find((c) => c.id === campaignId)?.name ?? 'Selected campaign' : 'All campaigns';
  if (audienceDimension && audienceValue) {
    scopeLabel += ` · ${audienceDimension}: ${audienceValue}`;
  }

  return {
    clientName: account.client.name,
    platformLabel: 'Meta Ads (Facebook & Instagram)',
    scopeLabel,
    kpis,
    daily,
    campaigns: campaignRows,
    audience: [
      { title: 'Age', rows: summarizeDim('age') },
      { title: 'Gender', rows: summarizeDim('gender') },
      { title: 'Region', rows: summarizeDim('region') },
      { title: 'Placement', rows: summarizeDim('platform') },
    ],
  };
}

// Combines Google Ads + Meta + Snapchat into one ReportData shape for the
// Summary tab's "Export PDF" — same shape the platform-specific builders
// above produce, so it reuses every rendering block below unchanged. No
// audience breakdown (none of the three platforms' audience dimensions are
// directly comparable to combine), and campaign rows are prefixed with
// their platform so a combined table stays legible. Doesn't accept
// campaignId/audienceDimension filters — the Summary tab is a whole-account
// rollup, not a single-campaign drill-down.
async function buildSummaryData(clientId: string, since: Date, until: Date): Promise<ReportData | null> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    include: { googleAdsAccounts: { take: 1 }, metaAdAccounts: { take: 1 }, snapAdAccounts: { take: 1 } },
  });
  if (!client) return null;

  const daily = new Map<string, number>();
  const campaigns: ReportData['campaigns'] = [];
  const totals = { impressions: 0, clicks: 0, costCents: 0, conversions: 0, conversionValueCents: 0 };

  function addDaily(rows: { date: Date; costCents: number }[]) {
    for (const r of rows) {
      const key = r.date.toISOString().slice(0, 10);
      daily.set(key, (daily.get(key) ?? 0) + r.costCents);
    }
  }
  function addTotals(rows: { impressions: number; clicks: number; costCents: number; conversions: number; conversionValueCents: number }[]) {
    for (const r of rows) {
      totals.impressions += r.impressions;
      totals.clicks += r.clicks;
      totals.costCents += r.costCents;
      totals.conversions += r.conversions;
      totals.conversionValueCents += r.conversionValueCents;
    }
  }

  const googleAccount = client.googleAdsAccounts[0];
  if (googleAccount) {
    const camps = await db.campaign.findMany({ where: { googleAdsAccountId: googleAccount.id }, select: { id: true, name: true } });
    const campIds = camps.map((c) => c.id);
    const metrics = campIds.length ? await db.dailyMetric.findMany({ where: { campaignId: { in: campIds }, date: { gte: since, lte: until } } }) : [];
    addDaily(metrics);
    addTotals(metrics);
    const byCampaign = new Map<string, { name: string; costCents: number; clicks: number; impressions: number; conversions: number }>();
    for (const m of metrics) {
      const c = camps.find((c) => c.id === m.campaignId);
      if (!c) continue;
      const entry = byCampaign.get(c.id) ?? { name: `[Google] ${c.name}`, costCents: 0, clicks: 0, impressions: 0, conversions: 0 };
      entry.costCents += m.costCents;
      entry.clicks += m.clicks;
      entry.impressions += m.impressions;
      entry.conversions += m.conversions;
      byCampaign.set(c.id, entry);
    }
    campaigns.push(...byCampaign.values());
  }

  const metaAccount = client.metaAdAccounts[0];
  if (metaAccount) {
    const camps = await db.metaCampaign.findMany({ where: { adAccountId: metaAccount.id }, select: { id: true, name: true } });
    const campIds = camps.map((c) => c.id);
    const metrics = campIds.length ? await db.metaDailyMetric.findMany({ where: { campaignId: { in: campIds }, date: { gte: since, lte: until } } }) : [];
    addDaily(metrics);
    addTotals(metrics);
    const byCampaign = new Map<string, { name: string; costCents: number; clicks: number; impressions: number; conversions: number }>();
    for (const m of metrics) {
      const c = camps.find((c) => c.id === m.campaignId);
      if (!c) continue;
      const entry = byCampaign.get(c.id) ?? { name: `[Meta] ${c.name}`, costCents: 0, clicks: 0, impressions: 0, conversions: 0 };
      entry.costCents += m.costCents;
      entry.clicks += m.clicks;
      entry.impressions += m.impressions;
      entry.conversions += m.conversions;
      byCampaign.set(c.id, entry);
    }
    campaigns.push(...byCampaign.values());
  }

  const snapAccount = client.snapAdAccounts[0];
  if (snapAccount) {
    const camps = await db.snapCampaign.findMany({ where: { adAccountId: snapAccount.id }, select: { id: true, name: true } });
    const campIds = camps.map((c) => c.id);
    const metrics = campIds.length ? await db.snapDailyMetric.findMany({ where: { campaignId: { in: campIds }, date: { gte: since, lte: until } } }) : [];
    addDaily(metrics);
    addTotals(metrics);
    const byCampaign = new Map<string, { name: string; costCents: number; clicks: number; impressions: number; conversions: number }>();
    for (const m of metrics) {
      const c = camps.find((c) => c.id === m.campaignId);
      if (!c) continue;
      const entry = byCampaign.get(c.id) ?? { name: `[Snapchat] ${c.name}`, costCents: 0, clicks: 0, impressions: 0, conversions: 0 };
      entry.costCents += m.costCents;
      entry.clicks += m.clicks;
      entry.impressions += m.impressions;
      entry.conversions += m.conversions;
      byCampaign.set(c.id, entry);
    }
    campaigns.push(...byCampaign.values());
  }

  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const avgCpcCents = totals.clicks > 0 ? totals.costCents / totals.clicks : 0;
  const costPerConvCents = totals.conversions > 0 ? totals.costCents / totals.conversions : 0;
  const roas = totals.costCents > 0 ? totals.conversionValueCents / totals.costCents : 0;

  const kpis: ReportKpi[] = [
    { label: 'Total spend', value: money(totals.costCents) },
    { label: 'Clicks', value: totals.clicks.toLocaleString() },
    { label: 'Impressions', value: totals.impressions.toLocaleString() },
    { label: 'CTR', value: `${(ctr * 100).toFixed(2)}%` },
    { label: 'Avg. CPC', value: money(avgCpcCents) },
    { label: 'Conversions', value: totals.conversions.toLocaleString() },
    { label: 'Cost / conversion', value: totals.conversions > 0 ? money(costPerConvCents) : '—' },
    { label: 'Conversion value', value: money(totals.conversionValueCents) },
    { label: 'ROAS', value: totals.costCents > 0 ? `${roas.toFixed(2)}x` : '—' },
  ];

  const connectedPlatforms = [googleAccount && 'Google Ads', metaAccount && 'Meta Ads', snapAccount && 'Snapchat Ads'].filter(Boolean).join(', ') || 'no platforms connected';

  return {
    clientName: client.name,
    platformLabel: 'All connected platforms',
    scopeLabel: connectedPlatforms,
    kpis,
    daily: Array.from(daily.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, costCents]) => ({ date, costCents })),
    campaigns: campaigns.sort((a, b) => b.costCents - a.costCents),
    audience: [],
  };
}

// Diagonal, low-opacity "ADPAC" tiled across the current page — applied to
// every page (including ones added later via doc.addPage()) by re-running
// this after generating all content, via bufferPages + switchToPage.
function drawWatermark(doc: PDFKit.PDFDocument) {
  const { width, height } = doc.page;
  doc.save();
  doc.opacity(0.06);
  doc.fontSize(60).font('Helvetica-Bold').fillColor(BRAND_PURPLE);
  doc.rotate(-35, { origin: [width / 2, height / 2] });
  for (let y = -height; y < height * 2; y += 160) {
    for (let x = -width; x < width * 2; x += 260) {
      doc.text('ADPAC', x, y, { lineBreak: false });
    }
  }
  doc.restore();
  doc.opacity(1);
}

function drawFooter(doc: PDFKit.PDFDocument, pageNum: number, pageCount: number) {
  const { width, height } = doc.page;
  doc
    .fontSize(8)
    .font('Helvetica')
    .fillColor(DIM)
    .text(`Generated by AdPac · ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`, 50, height - 40, {
      width: width - 100,
      align: 'left',
    });
  doc.text(`Page ${pageNum} of ${pageCount}`, 50, height - 40, { width: width - 100, align: 'right' });
}

function drawBarChart(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, points: { date: string; costCents: number }[]) {
  if (points.length === 0) {
    doc.fontSize(9).font('Helvetica').fillColor(DIM).text('No daily spend data for this period.', x, y);
    return;
  }
  // Cap to ~40 bars — sample evenly if there's more days than that, so the
  // chart stays readable instead of becoming an unreadable comb of hairlines.
  const maxBars = 40;
  const sampled =
    points.length <= maxBars ? points : points.filter((_, i) => i % Math.ceil(points.length / maxBars) === 0);

  const max = Math.max(...sampled.map((p) => p.costCents), 1);
  const barGap = 3;
  const barWidth = Math.max(2, (w - barGap * (sampled.length - 1)) / sampled.length);
  const chartBottom = y + h;

  doc.fontSize(9).font('Helvetica-Bold').fillColor(INK).text('Spend trend', x, y - 16);

  sampled.forEach((p, i) => {
    const barH = Math.max(1, (p.costCents / max) * (h - 4));
    const barX = x + i * (barWidth + barGap);
    doc.rect(barX, chartBottom - barH, barWidth, barH).fill(BRAND_TEAL);
  });

  doc.moveTo(x, chartBottom).lineTo(x + w, chartBottom).strokeColor(RULE).stroke();
  doc
    .fontSize(7)
    .font('Helvetica')
    .fillColor(DIM)
    .text(fmtDate(sampled[0].date), x, chartBottom + 4, { width: 100 })
    .text(fmtDate(sampled[sampled.length - 1].date), x + w - 100, chartBottom + 4, { width: 100, align: 'right' });
  doc.text(money(max), x - 2, y - 2, { width: 0 }); // just a peak-value label near the top-left of the chart area
}

// Shared tail end for every platform (google/meta/summary) — draws the PDF
// from an already-built ReportData and returns it as the HTTP response.
// Pulled out so the summary branch (which has no accountId/campaign-filter
// concept) doesn't need to duplicate ~150 lines of pdfkit drawing calls.
async function renderReportPdf(
  data: ReportData,
  range: { since: Date; until: Date },
  sections: Set<ReportSection>,
  platform: string
): Promise<NextResponse> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // --- Header ---
  try {
    doc.image(LOGO_PATH, 460, 45, { width: 65 });
  } catch {
    doc.fontSize(20).font('Helvetica-Bold').fillColor(BRAND_PURPLE).text('AdPac', 460, 50, { width: 90, align: 'right' });
  }
  doc.fontSize(20).font('Helvetica-Bold').fillColor(INK).text('Performance Report', 50, 50);
  doc
    .fontSize(10)
    .font('Helvetica')
    .fillColor(DIM)
    .text(data.clientName, 50, 76)
    .text(data.platformLabel, 50, 92)
    .text(`${fmtDate(range.since)} → ${fmtDate(range.until)}`, 50, 108)
    .text(data.scopeLabel, 50, 124);

  doc.moveTo(50, 148).lineTo(545, 148).strokeColor(RULE).stroke();

  // --- KPI grid (3 columns) ---
  let cursorY = 164;
  if (sections.has('kpis')) {
    const ky = cursorY;
    const kpiColW = 165;
    data.kpis.forEach((kpi, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const kx = 50 + col * kpiColW;
      const kyRow = ky + row * 46;
      doc.fontSize(8).font('Helvetica').fillColor(DIM).text(kpi.label.toUpperCase(), kx, kyRow);
      doc.fontSize(14).font('Helvetica-Bold').fillColor(INK).text(kpi.value, kx, kyRow + 12);
    });
    const kpiRows = Math.ceil(data.kpis.length / 3);
    cursorY = ky + kpiRows * 46 + 10;
  }

  // --- Period comparison (if requested) ---
  if (sections.has('comparison') && data.compareLabel) {
    const spend = data.daily.reduce((s, d) => s + d.costCents, 0);
    const spendDelta = data.compareTotalsCostCents ? ((spend - data.compareTotalsCostCents) / data.compareTotalsCostCents) * 100 : null;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(INK).text('Compared to', 50, cursorY);
    doc.fontSize(9).font('Helvetica').fillColor(DIM).text(data.compareLabel, 140, cursorY);
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor(spendDelta === null ? DIM : spendDelta >= 0 ? '#166534' : '#991b1b')
      .text(
        `Spend ${spendDelta === null ? '—' : `${spendDelta >= 0 ? '+' : ''}${spendDelta.toFixed(1)}%`} vs. previous (${money(data.compareTotalsCostCents ?? 0)})`,
        300,
        cursorY
      );
    cursorY += 20;
  }

  // --- Trend chart ---
  if (sections.has('trend')) {
    drawBarChart(doc, 50, cursorY + 20, 495, 90, data.daily);
    cursorY += 130;
  }

  // --- Campaign breakdown table ---
  if (sections.has('campaigns')) {
    doc.fontSize(11).font('Helvetica-Bold').fillColor(INK).text('Campaign breakdown', 50, cursorY);
    cursorY += 16;
    doc.fontSize(8).font('Helvetica-Bold').fillColor(DIM);
    doc.text('Campaign', 50, cursorY, { width: 220 });
    doc.text('Spend', 280, cursorY, { width: 70, align: 'right' });
    doc.text('Clicks', 355, cursorY, { width: 60, align: 'right' });
    doc.text('Impr.', 420, cursorY, { width: 60, align: 'right' });
    doc.text('Conv.', 485, cursorY, { width: 60, align: 'right' });
    cursorY += 12;
    doc.moveTo(50, cursorY).lineTo(545, cursorY).strokeColor(RULE).stroke();
    cursorY += 6;

    for (const c of data.campaigns.slice(0, 20)) {
      if (cursorY > 740) {
        doc.addPage();
        cursorY = 60;
      }
      doc.fontSize(8).font('Helvetica').fillColor(INK);
      doc.text(c.name, 50, cursorY, { width: 220 });
      doc.text(money(c.costCents), 280, cursorY, { width: 70, align: 'right' });
      doc.text(c.clicks.toLocaleString(), 355, cursorY, { width: 60, align: 'right' });
      doc.text(c.impressions.toLocaleString(), 420, cursorY, { width: 60, align: 'right' });
      doc.text(c.conversions.toLocaleString(), 485, cursorY, { width: 60, align: 'right' });
      cursorY += 14;
    }
    if (data.campaigns.length === 0) {
      doc.fontSize(9).font('Helvetica').fillColor(DIM).text('No campaign data for this period.', 50, cursorY);
      cursorY += 14;
    }
    cursorY += 16;
  }

  // --- Audience & placement breakdowns (2 per row) ---
  if (sections.has('audience')) {
    if (cursorY > 640) {
      doc.addPage();
      cursorY = 60;
    }
    doc.fontSize(11).font('Helvetica-Bold').fillColor(INK).text('Audience & placement', 50, cursorY);
    cursorY += 18;

    const tables = data.audience.filter((t) => t.rows.length > 0);
    const colWidth = 247;
    for (let i = 0; i < tables.length; i += 2) {
      if (cursorY > 700) {
        doc.addPage();
        cursorY = 60;
      }
      const rowTables = tables.slice(i, i + 2);
      const startY = cursorY;
      let maxRowsY = startY;
      rowTables.forEach((t, colIdx) => {
        const tx = 50 + colIdx * (colWidth + 8);
        let ty = startY;
        doc.fontSize(9).font('Helvetica-Bold').fillColor(INK).text(t.title, tx, ty);
        ty += 14;
        for (const r of t.rows) {
          doc.fontSize(8).font('Helvetica').fillColor(DIM).text(r.value, tx, ty, { width: 140 });
          doc.fillColor(INK).text(money(r.costCents), tx + 140, ty, { width: 60, align: 'right' });
          doc.fillColor(DIM).text(`${r.conversions.toLocaleString()} c.`, tx + 190, ty, { width: 55, align: 'right' });
          ty += 12;
        }
        maxRowsY = Math.max(maxRowsY, ty);
      });
      cursorY = maxRowsY + 12;
    }
  }

  // --- Watermark + footer on every page ---
  const range2 = doc.bufferedPageRange();
  for (let i = 0; i < range2.count; i++) {
    doc.switchToPage(i);
    drawWatermark(doc);
    drawFooter(doc, i + 1, range2.count);
  }

  doc.end();
  const buffer = await done;

  const filenameSafe = data.clientName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="adpac-${platform}-report-${filenameSafe}.pdf"`,
      'Content-Length': String(buffer.length),
    },
  });
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const platform = req.nextUrl.searchParams.get('platform');
  const accountId = req.nextUrl.searchParams.get('accountId');
  if (platform !== 'google' && platform !== 'meta' && platform !== 'summary') {
    return NextResponse.json({ error: 'platform must be "google", "meta", or "summary"' }, { status: 400 });
  }

  const range = parseDateRange(req);
  if (!range) return NextResponse.json({ error: 'since and until (YYYY-MM-DD) are required' }, { status: 400 });

  const campaignId = req.nextUrl.searchParams.get('campaignId');
  const audienceDimension = req.nextUrl.searchParams.get('audienceDimension');
  const audienceValue = req.nextUrl.searchParams.get('audienceValue');
  const sections = parseSections(req);

  if (platform === 'summary') {
    const clientId = req.nextUrl.searchParams.get('clientId');
    if (!clientId) return NextResponse.json({ error: 'clientId is required for platform=summary' }, { status: 400 });
    if (!(await canViewReporting(me, clientId))) {
      return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
    }
    const data = await buildSummaryData(clientId, range.since, range.until);
    if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    return renderReportPdf(data, range, sections, 'summary');
  }

  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });

  // Access check — same clientId lookup either platform's account resolves to.
  const clientId =
    platform === 'google'
      ? (await db.googleAdsAccount.findUnique({ where: { id: accountId }, select: { clientId: true } }))?.clientId
      : (await db.metaAdAccount.findUnique({ where: { id: accountId }, select: { clientId: true } }))?.clientId;
  if (!clientId) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  if (!(await canViewReporting(me, clientId))) {
    return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  }

  const data =
    platform === 'google'
      ? await buildGoogleData(accountId, range.since, range.until, campaignId, audienceDimension, audienceValue)
      : await buildMetaData(accountId, range.since, range.until, campaignId, audienceDimension, audienceValue);
  if (!data) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  // Optional period comparison — only totals cost/conversions are needed
  // (the report shows a compact comparison line, not a second full KPI grid).
  const compareSinceParam = req.nextUrl.searchParams.get('compareSince');
  const compareUntilParam = req.nextUrl.searchParams.get('compareUntil');
  if (sections.has('comparison') && compareSinceParam && compareUntilParam) {
    const cSince = new Date(compareSinceParam);
    const cUntil = new Date(compareUntilParam);
    if (!isNaN(cSince.getTime()) && !isNaN(cUntil.getTime())) {
      cUntil.setHours(23, 59, 59, 999);
      const compareData =
        platform === 'google'
          ? await buildGoogleData(accountId, cSince, cUntil, campaignId, audienceDimension, audienceValue)
          : await buildMetaData(accountId, cSince, cUntil, campaignId, audienceDimension, audienceValue);
      if (compareData) {
        const spend = compareData.daily.reduce((s, d) => s + d.costCents, 0);
        const conv = Number(compareData.kpis.find((k) => k.label === 'Conversions')?.value.replace(/,/g, '') ?? 0);
        data.compareTotalsCostCents = spend;
        data.compareTotalsConversions = conv;
        data.compareLabel = `${fmtDate(cSince)} → ${fmtDate(cUntil)}`;
      }
    }
  }

  return renderReportPdf(data, range, sections, platform);
}
