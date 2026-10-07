import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';
import { inboxScope } from '@/lib/inbox';
import { getTr } from '@/lib/i18n/server';
import DashboardNav from '../DashboardNav';
import InboxList, { type InboxRow } from './InboxList';

export const dynamic = 'force-dynamic';

// Customer messages and call requests sent from the portal ("Message your agent" / "Book a call").
export default async function InboxPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  const tr = getTr();

  const msgs = await db.agentMessage.findMany({
    where: inboxScope(me),
    orderBy: [{ handledAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
    take: 200,
    include: { client: { select: { id: true, name: true, agent: true, portalContactEmail: true } } },
  });

  const rows: InboxRow[] = msgs.map((m) => ({
    id: m.id,
    kind: m.kind as 'MESSAGE' | 'CALL',
    body: m.body,
    preferredTime: m.preferredTime,
    createdAt: m.createdAt.toISOString(),
    handled: !!m.handledAt,
    clientId: m.client.id,
    clientName: m.client.name,
    agent: m.client.agent,
    email: m.client.portalContactEmail,
  }));

  return (
    <div className="container">
      <DashboardNav />
      <h1 style={{ fontSize: '1.6rem', marginBottom: 4 }}>{tr('Inbox')}</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>{tr('Messages and call requests from your clients, sent from their portal.')}</p>
      <InboxList rows={rows} />
    </div>
  );
}
