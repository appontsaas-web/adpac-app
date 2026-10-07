import { db } from '@/lib/db';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { PENDING_META_CONNECT_COOKIE, PendingMetaConnect } from '@/app/api/meta/callback/pendingConnectCookie';
import { PENDING_SNAPCHAT_CONNECT_COOKIE, PendingSnapchatConnect } from '@/app/api/snapchat/callback/pendingConnectCookie';
import { PENDING_TIKTOK_CONNECT_COOKIE, PendingTikTokConnect } from '@/app/api/tiktok/callback/pendingConnectCookie';
import { getCurrentUser, getClientAccess, hasCapability, canViewFinance, canViewReporting as canViewReportingFn, canEdit } from '@/lib/access';
import DashboardNav from '../../DashboardNav';
import ConnectGoogleAdsButton from './ConnectGoogleAdsButton';
import GenerateDraftButton from './GenerateDraftButton';
import ImportCampaignsButton from './ImportCampaignsButton';
import CampaignsList from './CampaignsList';
import RecommendationsPanel from './RecommendationsPanel';
import TargetingForm from './TargetingForm';
import PortalContactForm from './PortalContactForm';
import ClientLocaleForm from './ClientLocaleForm';
import { LocaleProvider } from '@/lib/i18n/LocaleProvider';
import { getLocale } from '@/lib/i18n/server';
import ReportingDashboard from './ReportingDashboard';
import SummaryReportDashboard from './SummaryReportDashboard';
import KeywordAdPerformanceCard from './KeywordAdPerformanceCard';
import BudgetPacingCard from './BudgetPacingCard';
import GA4ReportingCard from './GA4ReportingCard';
import ConnectGA4Button from './ConnectGA4Button';
import ConnectGTMButton from './ConnectGTMButton';
import TagManagerSection from './TagManagerSection';
import ConnectBusinessProfileButton from './ConnectBusinessProfileButton';
import BusinessProfileSection from './BusinessProfileSection';
import BusinessInsightsPanel from './BusinessInsightsPanel';
import ConnectMetaButton from './ConnectMetaButton';
import MetaReportingDashboard from './MetaReportingDashboard';
import MetaAdPerformanceCard from './MetaAdPerformanceCard';
import MetaInsightsPanel from './MetaInsightsPanel';
import CreativeTestsPanel from './CreativeTestsPanel';
import IndustryTrendsPanel from './IndustryTrendsPanel';
import PersonaPlanPanel from './PersonaPlanPanel';
import ConnectSnapchatButton from './ConnectSnapchatButton';
import SnapReportingDashboard from './SnapReportingDashboard';
import ConnectTikTokButton from './ConnectTikTokButton';
import TikTokReportingDashboard from './TikTokReportingDashboard';
import AIInsightsPanel from './AIInsightsPanel';
import AIImpactCard from './AIImpactCard';
import FinanceSection from './FinanceSection';
import InvoicesViewOnly from './InvoicesViewOnly';
import AccessManager from './AccessManager';
import ClientDashboardTabs, { DashboardTab } from './ClientDashboardTabs';
import SpendGuardrailCard from './SpendGuardrailCard';
import RealAIImpactCard from './RealAIImpactCard';
import { computeOutcomes } from '@/lib/aiInsights';
import { getRealImpactVisibleToStaff } from '@/lib/appSettings';

const AI_INSIGHT_TYPES = ['ADJUST_BUDGET', 'PAUSE_CAMPAIGN', 'REWRITE_AD_COPY', 'ANOMALY_ALERT', 'ADD_NEGATIVE_KEYWORDS', 'REALLOCATE_BUDGET', 'ADJUST_BID_MODIFIER', 'FUNNEL_OPTIMIZATION'];

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { googleAds?: string; ga4?: string; gtm?: string; gbp?: string; meta?: string; snapchat?: string; tiktok?: string; message?: string };
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');

  const access = await getClientAccess(me, params.id);
  if (!access) notFound();
  const isAdmin = me.role === 'ADMIN';
  const [canCampaigns, canGoogleAds, canTargeting, canInvoices, canReporting, canTagManager, canBusinessProfile, canMeta, canSnapchat, canTikTok] = await Promise.all([
    hasCapability(me, params.id, 'campaigns'),
    hasCapability(me, params.id, 'googleAds'),
    hasCapability(me, params.id, 'targeting'),
    canViewFinance(me, params.id),
    canViewReportingFn(me, params.id),
    hasCapability(me, params.id, 'tagManager'),
    hasCapability(me, params.id, 'businessProfile'),
    hasCapability(me, params.id, 'meta'),
    hasCapability(me, params.id, 'snapchat'),
    hasCapability(me, params.id, 'tiktok'),
  ]);

  const client = await db.client.findUnique({
    where: { id: params.id },
    include: {
      googleAdsAccounts: true,
      analyticsProperties: true,
      tagManagerContainers: true,
      businessProfileAccounts: { include: { locations: { include: { metrics: true, reviews: true } } } },
      metaAdAccounts: { include: { campaigns: { where: { hiddenFromList: false }, select: { id: true, name: true } } } },
      snapAdAccounts: true,
      tiktokAdAccounts: true,
      campaigns: { orderBy: { createdAt: 'desc' } },
      actionLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      invoices: { orderBy: { issuedAt: 'desc' } },
    },
  });
  if (!client) notFound();

  const account = client.googleAdsAccounts[0] ?? null;
  const ga4Property = client.analyticsProperties[0] ?? null;
  const gtmContainer = client.tagManagerContainers[0] ?? null;
  const gbpAccount = client.businessProfileAccounts[0] ?? null;
  const metaAccount = client.metaAdAccounts[0] ?? null;
  const snapAccount = client.snapAdAccounts[0] ?? null;
  const tiktokAccount = client.tiktokAdAccounts[0] ?? null;
  const gtmDeployments = client.actionLogs.filter((l) => l.actionType === 'DEPLOY_GTM_TAG');
  const campaignNames = Object.fromEntries(client.campaigns.map((c) => [c.id, c.name]));

  // Business Profile display data — flattened out of the nested include
  // above into the shapes BusinessProfileSection/BusinessInsightsPanel want.
  // Only computed when there's an account connected, since it's a non-trivial
  // amount of row-shaping otherwise wasted.
  let gbpLocations: import('./BusinessProfileSection').BusinessLocationRow[] = [];
  let gbpReviews: import('./BusinessProfileSection').BusinessReviewRow[] = [];
  let locationNames: Record<string, string> = {};
  let reviewSummaries: Record<string, { reviewerName: string | null; starRating: number; comment: string | null }> = {};
  let businessInsights: {
    id: string;
    locationId: string | null;
    businessReviewId: string | null;
    actionType: string;
    payloadJson: string;
    status: string;
    createdAt: Date;
    errorMessage: string | null;
  }[] = [];
  if (gbpAccount) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    for (const loc of gbpAccount.locations) {
      locationNames[loc.id] = loc.title;
      const last7dMetrics = loc.metrics.filter((m) => m.date >= sevenDaysAgo);
      gbpLocations.push({
        id: loc.id,
        title: loc.title,
        address: loc.address,
        primaryPhone: loc.primaryPhone,
        openStatus: loc.openStatus,
        last7d: {
          searchImpressions: last7dMetrics.reduce((a, m) => a + m.searchImpressions, 0),
          mapsImpressions: last7dMetrics.reduce((a, m) => a + m.mapsImpressions, 0),
          callClicks: last7dMetrics.reduce((a, m) => a + m.callClicks, 0),
          websiteClicks: last7dMetrics.reduce((a, m) => a + m.websiteClicks, 0),
          directionRequests: last7dMetrics.reduce((a, m) => a + m.directionRequests, 0),
        },
      });
      for (const r of loc.reviews) {
        reviewSummaries[r.id] = { reviewerName: r.reviewerName, starRating: r.starRating, comment: r.comment };
        gbpReviews.push({
          id: r.id,
          locationTitle: loc.title,
          reviewerName: r.reviewerName,
          starRating: r.starRating,
          comment: r.comment,
          createTime: r.createTime,
          replyState: r.replyState,
          replyComment: r.replyComment,
        });
      }
    }
    gbpReviews.sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());

    const BUSINESS_INSIGHT_TYPES = ['LOCATION_ANOMALY_ALERT', 'DRAFT_REVIEW_REPLY'];
    businessInsights = await db.actionLog.findMany({
      where: { clientId: client.id, actionType: { in: BUSINESS_INSIGHT_TYPES } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  // Meta campaign-name lookup (for MetaInsightsPanel) + insights list —
  // the per-campaign performance data itself now comes live from
  // /api/meta-metrics inside MetaReportingDashboard, not from this include.
  let metaCampaignNames: Record<string, string> = {};
  let metaInsights: {
    id: string;
    metaCampaignId: string | null;
    actionType: string;
    payloadJson: string;
    status: string;
    createdAt: Date;
    errorMessage: string | null;
  }[] = [];
  if (metaAccount) {
    for (const c of metaAccount.campaigns) {
      metaCampaignNames[c.id] = c.name;
    }

    const META_INSIGHT_TYPES = ['META_ADJUST_BUDGET', 'META_PAUSE_CAMPAIGN', 'META_ANOMALY_ALERT'];
    metaInsights = await db.actionLog.findMany({
      where: { clientId: client.id, actionType: { in: META_INSIGHT_TYPES } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  // Ad-account picker — only relevant right after an OAuth callback found
  // more than one ad account for this login (see /api/meta/callback and
  // pendingConnectCookie.ts). Read-only here; the actual connect happens in
  // /api/meta/connect/finish, which reads the same cookie server-side.
  let pendingMetaAccounts: PendingMetaConnect['accounts'] | null = null;
  if (searchParams.meta === 'choose') {
    const raw = cookies().get(PENDING_META_CONNECT_COOKIE)?.value;
    if (raw) {
      try {
        const pending: PendingMetaConnect = JSON.parse(raw);
        if (pending.clientId === client.id) pendingMetaAccounts = pending.accounts;
      } catch {
        // malformed/expired cookie — just don't show the picker
      }
    }
  }

  // Same picker pattern as Meta — see /api/snapchat/callback and
  // pendingConnectCookie.ts.
  let pendingSnapAccounts: PendingSnapchatConnect['accounts'] | null = null;
  if (searchParams.snapchat === 'choose') {
    const raw = cookies().get(PENDING_SNAPCHAT_CONNECT_COOKIE)?.value;
    if (raw) {
      try {
        const pending: PendingSnapchatConnect = JSON.parse(raw);
        if (pending.clientId === client.id) pendingSnapAccounts = pending.accounts;
      } catch {
        // malformed/expired cookie — just don't show the picker
      }
    }
  }

  // Same picker pattern as Snapchat — see /api/tiktok/callback and
  // pendingConnectCookie.ts.
  let pendingTikTokAccounts: PendingTikTokConnect['accounts'] | null = null;
  if (searchParams.tiktok === 'choose') {
    const raw = cookies().get(PENDING_TIKTOK_CONNECT_COOKIE)?.value;
    if (raw) {
      try {
        const pending: PendingTikTokConnect = JSON.parse(raw);
        if (pending.clientId === client.id) pendingTikTokAccounts = pending.accounts;
      } catch {
        // malformed/expired cookie — just don't show the picker
      }
    }
  }

  // Queried independently from the capped 20-row `actionLogs` above (which
  // mixes in every other action type — GTM deployments, campaign pushes,
  // etc.) so an approved AI insight doesn't silently scroll out of view just
  // because other, unrelated activity happened on the account afterward.
  const aiInsights = await db.actionLog.findMany({
    where: { clientId: client.id, actionType: { in: AI_INSIGHT_TYPES } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  // Live "did it actually work" numbers for anything already approved —
  // recomputed on every load from whatever DailyMetric rows have synced in
  // since it was applied, so this updates on its own as time passes.
  const insightOutcomes = await computeOutcomes(
    aiInsights
      .filter((l) => l.status === 'EXECUTED')
      .map((l) => ({ id: l.id, campaignId: l.campaignId, executedAt: l.executedAt }))
  );

  let staff: { id: string; email: string; name: string | null }[] = [];
  let assignments: { userId: string; permission: string }[] = [];
  if (isAdmin) {
    staff = await db.user.findMany({
      where: { role: 'STAFF' },
      select: { id: true, email: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    assignments = await db.clientAssignment.findMany({
      where: { clientId: client.id },
      select: { userId: true, permission: true },
    });
  }

  const pendingInsightCount = aiInsights.filter((l) => l.status === 'PENDING_APPROVAL').length;

  // The beta "measured" AI impact card (RealAIImpactCard) is admin-only
  // until an admin explicitly approves it for staff — see lib/appSettings.ts.
  // Admins always see it (with the toggle to flip this for everyone else).
  const realImpactVisibleToStaff = await getRealImpactVisibleToStaff();
  const showRealImpactCard = isAdmin || realImpactVisibleToStaff;

  // Most recent time the spend-ceiling guardrail actually fired for this
  // client (if ever) — admin-only context shown on SpendGuardrailCard.
  let lastGuardrailTrigger: { summary: string; createdAt: string } | null = null;
  if (isAdmin) {
    const log = await db.actionLog.findFirst({
      where: { clientId: client.id, actionType: 'SPEND_GUARDRAIL_PAUSE' },
      orderBy: { createdAt: 'desc' },
    });
    if (log) {
      let summary = log.actionType;
      try {
        summary = JSON.parse(log.payloadJson).summary ?? summary;
      } catch {
        /* ignore malformed payload */
      }
      lastGuardrailTrigger = { summary, createdAt: log.createdAt.toISOString() };
    }
  }

  const tabs: DashboardTab[] = [];

  tabs.push({
    id: 'overview',
    label: 'Overview',
    content: (
      <>
        <TargetingForm
          clientId={client.id}
          initialAdLanguage={client.adLanguage}
          initialTargetLocations={client.targetLocations}
          readOnly={!canTargeting}
        />

        <ClientLocaleForm
          clientId={client.id}
          initialCurrency={client.displayCurrency}
          initialPortalLocale={client.portalContactLocale}
          readOnly={!canTargeting}
        />

        <PortalContactForm
          clientId={client.id}
          initialName={client.portalContactName}
          initialEmail={client.portalContactEmail}
          readOnly={!canTargeting}
        />

        <div className="card">
          <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Google Ads connection</h2>
          {account ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <p style={{ margin: 0 }}>
                Connected — customer ID <code>{account.googleCustomerId}</code>
              </p>
              {canGoogleAds && (
                <form action="/api/google-ads/disconnect" method="POST">
                  <input type="hidden" name="clientId" value={client.id} />
                  <button type="submit" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>
                    Disconnect / relink
                  </button>
                </form>
              )}
            </div>
          ) : canGoogleAds ? (
            <>
              <p style={{ color: 'var(--text-dim)', marginBottom: 12 }}>
                Not connected yet. Enter this client's Google Ads Customer ID (from the account you created for
                them inside your AdPac Manager account) to connect it.
              </p>
              <ConnectGoogleAdsButton clientId={client.id} />
            </>
          ) : (
            <p style={{ color: 'var(--text-dim)' }}>Not connected yet.</p>
          )}
        </div>

        {isAdmin && (
          <SpendGuardrailCard
            clientId={client.id}
            initialEnabled={client.spendGuardrailEnabled}
            hasMonthlyBudget={!!client.monthlyBudget}
            lastTriggered={lastGuardrailTrigger}
          />
        )}
      </>
    ),
  });

  if (canReporting) {
    tabs.push({
      id: 'summary',
      label: 'Summary',
      content: <SummaryReportDashboard clientId={client.id} />,
    });
  }

  if (account && canReporting) {
    tabs.push({
      id: 'performance',
      label: 'Performance',
      content: (
        <>
          <ReportingDashboard googleAdsAccountId={account.id} isAdmin={isAdmin} />
          <BudgetPacingCard googleAdsAccountId={account.id} />
          <KeywordAdPerformanceCard googleAdsAccountId={account.id} />
        </>
      ),
    });
  }

  if (canReporting) {
    tabs.push({
      id: 'analytics',
      label: 'Analytics',
      content: (
        <>
          <div className="card">
            <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>GA4 connection</h2>
            {ga4Property ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <p style={{ margin: 0 }}>
                  Connected — property ID <code>{ga4Property.ga4PropertyId}</code>
                </p>
                <form action="/api/google-analytics/disconnect" method="POST">
                  <input type="hidden" name="clientId" value={client.id} />
                  <button type="submit" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>
                    Disconnect / relink
                  </button>
                </form>
              </div>
            ) : (
              <>
                <p style={{ color: 'var(--text-dim)', marginBottom: 12 }}>
                  Not connected yet. The client needs to add your Google account as a Viewer on their GA4
                  property first (Admin &gt; Property Access Management).
                </p>
                <ConnectGA4Button clientId={client.id} />
              </>
            )}
          </div>
          {ga4Property && <GA4ReportingCard clientId={client.id} />}
        </>
      ),
    });
  }

  if (canTagManager) {
    tabs.push({
      id: 'tag-manager',
      label: 'Tag Manager',
      content: (
        <>
          <div className="card">
            <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Tag Manager connection</h2>
            {gtmContainer ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <p style={{ margin: 0 }}>
                  Connected — account <code>{gtmContainer.gtmAccountId}</code>, container{' '}
                  <code>{gtmContainer.gtmContainerId}</code>
                </p>
                <form action="/api/google-tag-manager/disconnect" method="POST">
                  <input type="hidden" name="clientId" value={client.id} />
                  <button type="submit" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>
                    Disconnect / relink
                  </button>
                </form>
              </div>
            ) : (
              <>
                <p style={{ color: 'var(--text-dim)', marginBottom: 12 }}>
                  Not connected yet. The client needs to add your Google account as a user on their GTM
                  container first, with Edit + Publish permission (Admin &gt; User Management).
                </p>
                <ConnectGTMButton clientId={client.id} />
              </>
            )}
          </div>
          {gtmContainer && <TagManagerSection clientId={client.id} deployments={gtmDeployments} />}
        </>
      ),
    });
  }

  if (canBusinessProfile) {
    tabs.push({
      id: 'business-profile',
      label: 'Business Profile',
      content: (
        <>
          <div className="card">
            <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Business Profile connection</h2>
            {gbpAccount ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <p style={{ margin: 0 }}>
                  Connected — account <code>{gbpAccount.gbpAccountId}</code>
                </p>
                <form action="/api/google-business/disconnect" method="POST">
                  <input type="hidden" name="clientId" value={client.id} />
                  <button type="submit" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>
                    Disconnect / relink
                  </button>
                </form>
              </div>
            ) : (
              <>
                <p style={{ color: 'var(--text-dim)', marginBottom: 12 }}>
                  Not connected yet. The client needs to add your Google account as a Manager or Owner on their
                  Business Profile first. Note Google requires its own separate access-approval process for
                  this API family — expect connection or sync to fail with a quota error until that's granted.
                </p>
                <ConnectBusinessProfileButton clientId={client.id} />
              </>
            )}
          </div>
          {gbpAccount && (
            <>
              <BusinessProfileSection
                clientId={client.id}
                accountId={gbpAccount.id}
                locations={gbpLocations}
                reviews={gbpReviews}
              />
              <BusinessInsightsPanel
                clientId={client.id}
                locationNames={locationNames}
                reviewSummaries={reviewSummaries}
                insights={businessInsights}
              />
            </>
          )}
        </>
      ),
    });
  }

  if (canMeta) {
    tabs.push({
      id: 'meta',
      label: 'Meta Ads',
      content: (
        <>
          {pendingMetaAccounts && (
            <div className="card" style={{ borderColor: 'var(--accent2)' }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: 6 }}>Choose the Meta ad account to connect</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
                Your Meta login has access to {pendingMetaAccounts.length} ad accounts. Pick the one that belongs
                to this client — this selection expires in 10 minutes, so reconnect if you don't finish in time.
              </p>
              <form action="/api/meta/connect/finish" method="POST">
                <input type="hidden" name="clientId" value={client.id} />
                {pendingMetaAccounts.map((a, i) => (
                  <label
                    key={a.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < pendingMetaAccounts!.length - 1 ? '1px solid var(--card-border)' : 'none', cursor: 'pointer' }}
                  >
                    <input type="radio" name="metaAdAccountId" value={a.id} defaultChecked={i === 0} style={{ width: 'auto', margin: 0 }} />
                    <span>
                      <strong>{a.name}</strong>{' '}
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>
                        ({a.id} · {a.currency})
                      </span>
                    </span>
                  </label>
                ))}
                <button type="submit" className="btn" style={{ marginTop: 12 }}>
                  Connect this account
                </button>
              </form>
            </div>
          )}
          <div className="card">
            <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Meta Ads connection</h2>
            {metaAccount ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <p style={{ margin: 0 }}>
                  Connected — ad account <code>{metaAccount.metaAdAccountId}</code>
                </p>
                <form action="/api/meta/disconnect" method="POST">
                  <input type="hidden" name="clientId" value={client.id} />
                  <button type="submit" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>
                    Disconnect / relink
                  </button>
                </form>
              </div>
            ) : (
              <>
                <p style={{ color: 'var(--text-dim)', marginBottom: 12 }}>
                  Not connected yet. The client needs to add your Meta account as an admin/advertiser on their
                  ad account first (Business Settings &gt; Ad Accounts). Facebook and Instagram share this one
                  connection.
                </p>
                <ConnectMetaButton clientId={client.id} />
              </>
            )}
          </div>
          {metaAccount && (
            <>
              <MetaReportingDashboard metaAdAccountId={metaAccount.id} isAdmin={isAdmin} />
              <MetaAdPerformanceCard metaAdAccountId={metaAccount.id} />
              <MetaInsightsPanel clientId={client.id} campaignNames={metaCampaignNames} insights={metaInsights} />
            </>
          )}
        </>
      ),
    });
  }

  if (canSnapchat) {
    tabs.push({
      id: 'snapchat',
      label: 'Snapchat Ads',
      content: (
        <>
          {pendingSnapAccounts && (
            <div className="card" style={{ borderColor: 'var(--accent2)' }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: 6 }}>Choose the Snapchat ad account to connect</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
                Your Snapchat login has access to {pendingSnapAccounts.length} ad accounts across one or more
                Organizations. Pick the one that belongs to this client — this selection expires in 10 minutes,
                so reconnect if you don't finish in time.
              </p>
              <form action="/api/snapchat/connect/finish" method="POST">
                <input type="hidden" name="clientId" value={client.id} />
                {pendingSnapAccounts.map((a, i) => (
                  <label
                    key={a.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < pendingSnapAccounts!.length - 1 ? '1px solid var(--card-border)' : 'none', cursor: 'pointer' }}
                  >
                    <input type="radio" name="snapAdAccountId" value={a.id} defaultChecked={i === 0} style={{ width: 'auto', margin: 0 }} />
                    <span>
                      <strong>{a.name}</strong>{' '}
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>
                        ({a.organizationName} · {a.currency})
                      </span>
                    </span>
                  </label>
                ))}
                <button type="submit" className="btn" style={{ marginTop: 12 }}>
                  Connect this account
                </button>
              </form>
            </div>
          )}
          <div className="card">
            <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Snapchat Ads connection</h2>
            {snapAccount ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <p style={{ margin: 0 }}>
                  Connected — ad account <code>{snapAccount.snapAdAccountId}</code>
                </p>
                <form action="/api/snapchat/disconnect" method="POST">
                  <input type="hidden" name="clientId" value={client.id} />
                  <button type="submit" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>
                    Disconnect / relink
                  </button>
                </form>
              </div>
            ) : (
              <>
                <p style={{ color: 'var(--text-dim)', marginBottom: 12 }}>
                  Not connected yet. The client needs to add your Snapchat account as a member on their
                  Organization in Snap Business Manager first.
                </p>
                <ConnectSnapchatButton clientId={client.id} />
              </>
            )}
          </div>
          {snapAccount && <SnapReportingDashboard snapAdAccountId={snapAccount.id} isAdmin={isAdmin} />}
        </>
      ),
    });
  }

  if (canTikTok) {
    tabs.push({
      id: 'tiktok',
      label: 'TikTok Ads',
      content: (
        <>
          {pendingTikTokAccounts && (
            <div className="card" style={{ borderColor: 'var(--accent2)' }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: 6 }}>Choose the TikTok advertiser account to connect</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
                Your TikTok login has access to {pendingTikTokAccounts.length} advertiser accounts. Pick the one
                that belongs to this client — this selection expires in 10 minutes, so reconnect if you don't
                finish in time.
              </p>
              <form action="/api/tiktok/connect/finish" method="POST">
                <input type="hidden" name="clientId" value={client.id} />
                {pendingTikTokAccounts.map((a, i) => (
                  <label
                    key={a.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < pendingTikTokAccounts!.length - 1 ? '1px solid var(--card-border)' : 'none', cursor: 'pointer' }}
                  >
                    <input type="radio" name="advertiserId" value={a.id} defaultChecked={i === 0} style={{ width: 'auto', margin: 0 }} />
                    <span>
                      <strong>{a.name}</strong>{' '}
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>({a.currency})</span>
                    </span>
                  </label>
                ))}
                <button type="submit" className="btn" style={{ marginTop: 12 }}>
                  Connect this account
                </button>
              </form>
            </div>
          )}
          <div className="card">
            <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>TikTok Ads connection</h2>
            {tiktokAccount ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <p style={{ margin: 0 }}>
                  Connected — advertiser account <code>{tiktokAccount.advertiserId}</code>
                </p>
                <form action="/api/tiktok/disconnect" method="POST">
                  <input type="hidden" name="clientId" value={client.id} />
                  <button type="submit" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>
                    Disconnect / relink
                  </button>
                </form>
              </div>
            ) : (
              <>
                <p style={{ color: 'var(--text-dim)', marginBottom: 12 }}>
                  Not connected yet. The client needs to add your TikTok Business Center account to their
                  advertiser account first.
                </p>
                <ConnectTikTokButton clientId={client.id} />
              </>
            )}
          </div>
          {tiktokAccount && <TikTokReportingDashboard tiktokAdAccountId={tiktokAccount.id} isAdmin={isAdmin} />}
        </>
      ),
    });
  }

  if (canCampaigns) {
    tabs.push({
      id: 'campaigns',
      label: 'Campaigns',
      count: client.campaigns.length,
      content: (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ fontSize: '1.1rem' }}>Campaigns</h2>
            {account && (
              <div style={{ display: 'flex', gap: 8 }}>
                <ImportCampaignsButton clientId={client.id} googleAdsAccountId={account.id} />
                <GenerateDraftButton clientId={client.id} googleAdsAccountId={account.id} />
              </div>
            )}
          </div>
          <CampaignsList campaigns={client.campaigns} isAdmin={isAdmin} />
        </div>
      ),
    });
  }

  // Seeing and approving AI insights only needs EDIT-level client access —
  // unlike Campaigns/Google Ads/Targeting, it's not gated behind a specific
  // Position capability, so any staff member assigned EDIT access to this
  // client can use it without an admin having to also remember to flip a
  // capability toggle for them.
  if ((account || metaAccount) && canEdit(access)) {
    tabs.push({
      id: 'ai-insights',
      label: 'AI Insights',
      count: pendingInsightCount,
      content: (
        <>
          {account && <AIImpactCard clientId={client.id} isAdmin={isAdmin} />}
          {account && showRealImpactCard && (
            <RealAIImpactCard clientId={client.id} isAdmin={isAdmin} initialVisibleToStaff={realImpactVisibleToStaff} />
          )}
          {account && (
            <AIInsightsPanel
              clientId={client.id}
              campaignNames={campaignNames}
              insights={aiInsights}
              outcomes={insightOutcomes}
            />
          )}
          <CreativeTestsPanel
            clientId={client.id}
            googleCampaigns={client.campaigns.map((c) => ({ id: c.id, name: c.name }))}
            metaCampaigns={metaAccount ? metaAccount.campaigns.map((c) => ({ id: c.id, name: c.name })) : []}
          />
          <PersonaPlanPanel clientId={client.id} />
          {isAdmin && <IndustryTrendsPanel clientId={client.id} />}
        </>
      ),
    });
  }

  if (account && canTargeting) {
    tabs.push({
      id: 'recommendations',
      label: 'Recommendations',
      content: <RecommendationsPanel clientId={client.id} googleAdsAccountId={account.id} />,
    });
  }

  if (isAdmin || canInvoices) {
    tabs.push({
      id: 'finance',
      label: 'Finance',
      content: isAdmin ? (
        <FinanceSection
          clientId={client.id}
          invoices={client.invoices}
          requesterNames={Object.fromEntries(staff.map((s) => [s.id, s.name || s.email]))}
        />
      ) : (
        <InvoicesViewOnly clientId={client.id} invoices={client.invoices} />
      ),
    });
  }

  if (isAdmin) {
    tabs.push({
      id: 'access',
      label: 'Access',
      content: <AccessManager clientId={client.id} staff={staff} assignments={assignments} />,
    });
  }

  if (isAdmin) {
    tabs.push({
      id: 'activity',
      label: 'Activity',
      content: (
        <div className="card">
          <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Action log</h2>
          {client.actionLogs.length === 0 && <p style={{ color: 'var(--text-dim)' }}>No actions yet.</p>}
          {client.actionLogs.map((log) => (
            <div key={log.id} style={{ borderBottom: '1px solid var(--card-border)', padding: '10px 0', fontSize: '0.85rem' }}>
              <span className={`badge badge-${log.status.toLowerCase().replace('_approval', '').replace('pending','pending')}`}>
                {log.status}
              </span>{' '}
              {log.actionType} — {new Date(log.createdAt).toLocaleString()}
              {log.errorMessage && <div style={{ color: '#ef4444' }}>{log.errorMessage}</div>}
            </div>
          ))}
        </div>
      ),
    });
  }

  return (
    <LocaleProvider locale={getLocale()} currency={client.displayCurrency}>
    <div className="container-wide">
      <DashboardNav />
      <a href="/dashboard" style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
        ← All clients
      </a>
      <h1 style={{ fontSize: '1.6rem', margin: '8px 0 4px' }}>{client.name}</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 24 }}>
        {client.industry ?? 'No industry'} · Goal: {client.primaryGoal ?? 'Not set'} · Budget:{' '}
        {client.monthlyBudget ? `$${(client.monthlyBudget / 100).toLocaleString()}/mo` : 'Not set'}
        {' · '}
        {client.validUntil ? (
          (() => {
            const now = new Date();
            const msLeft = client.validUntil.getTime() - now.getTime();
            const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
            const label = `Valid until ${client.validUntil.toLocaleDateString()}`;
            const badgeClass = daysLeft < 0 ? 'badge-pending' : daysLeft <= 14 ? 'badge-draft' : 'badge-approved';
            const suffix = daysLeft < 0 ? ' (expired)' : daysLeft <= 14 ? ` (${daysLeft}d left)` : '';
            return <span className={`badge ${badgeClass}`}>{label}{suffix}</span>;
          })()
        ) : (
          <span className="badge badge-draft">Validity not set</span>
        )}
        {!isAdmin && (
          <>
            {' '}
            · <span className="badge badge-draft">{access === 'EDIT' ? 'Edit access' : 'View only'}</span>
          </>
        )}
      </p>

      {searchParams.googleAds === 'connected' && (
        <div className="card" style={{ borderColor: 'var(--accent2)' }}>
          Google Ads account connected successfully.
        </div>
      )}
      {searchParams.googleAds === 'error' && (
        <div className="card" style={{ borderColor: '#ef4444' }}>
          Connection failed: {searchParams.message}
        </div>
      )}
      {searchParams.ga4 === 'connected' && (
        <div className="card" style={{ borderColor: 'var(--accent2)' }}>
          GA4 property connected successfully.
        </div>
      )}
      {searchParams.ga4 === 'error' && (
        <div className="card" style={{ borderColor: '#ef4444' }}>
          GA4 connection failed: {searchParams.message}
        </div>
      )}
      {searchParams.gtm === 'connected' && (
        <div className="card" style={{ borderColor: 'var(--accent2)' }}>
          GTM container connected successfully.
        </div>
      )}
      {searchParams.gtm === 'error' && (
        <div className="card" style={{ borderColor: '#ef4444' }}>
          GTM connection failed: {searchParams.message}
        </div>
      )}
      {searchParams.gbp === 'connected' && (
        <div className="card" style={{ borderColor: 'var(--accent2)' }}>
          Business Profile account connected successfully.
        </div>
      )}
      {searchParams.gbp === 'error' && (
        <div className="card" style={{ borderColor: '#ef4444' }}>
          Business Profile connection failed: {searchParams.message}
        </div>
      )}
      {searchParams.meta === 'connected' && (
        <div className="card" style={{ borderColor: 'var(--accent2)' }}>
          Meta ad account connected successfully.
        </div>
      )}
      {searchParams.meta === 'error' && (
        <div className="card" style={{ borderColor: '#ef4444' }}>
          Meta connection failed: {searchParams.message}
        </div>
      )}
      {searchParams.snapchat === 'connected' && (
        <div className="card" style={{ borderColor: 'var(--accent2)' }}>
          Snapchat ad account connected successfully.
        </div>
      )}
      {searchParams.snapchat === 'error' && (
        <div className="card" style={{ borderColor: '#ef4444' }}>
          Snapchat connection failed: {searchParams.message}
        </div>
      )}
      {searchParams.tiktok === 'connected' && (
        <div className="card" style={{ borderColor: 'var(--accent2)' }}>
          TikTok ad account connected successfully.
        </div>
      )}
      {searchParams.tiktok === 'error' && (
        <div className="card" style={{ borderColor: '#ef4444' }}>
          TikTok connection failed: {searchParams.message}
        </div>
      )}

      <ClientDashboardTabs tabs={tabs} />
    </div>
    </LocaleProvider>
  );
}
