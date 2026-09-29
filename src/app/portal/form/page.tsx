import { redirect } from 'next/navigation';
import { getCurrentPortalClient, currentPeriodKey } from '@/lib/clientPortalAuth';
import { db } from '@/lib/db';
import MonthlyInputForm from './MonthlyInputForm';

export default async function PortalFormPage() {
  const client = await getCurrentPortalClient();
  if (!client) redirect('/portal');

  const periodKey = currentPeriodKey();
  const existing = await db.monthlyInput.findUnique({
    where: { clientId_periodKey: { clientId: client.id, periodKey } },
  });

  return (
    <div className="container" style={{ maxWidth: 560, paddingTop: 60, paddingBottom: 60 }}>
      <h1 style={{ fontSize: '1.4rem', marginBottom: 6 }}>{periodKey} goals &amp; audience</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.88rem', marginBottom: 24 }}>
        A few questions each month so our AI can build audience personas, ad copy, and a plan grounded in what
        you're actually trying to do — not just guesswork from the numbers.
      </p>
      <MonthlyInputForm existing={existing} />
    </div>
  );
}
