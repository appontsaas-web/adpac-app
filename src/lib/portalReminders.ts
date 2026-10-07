import { db } from './db';
import { sendMail } from './mailer';

// Automated portal reminder emails, run from the scheduler cycle. Each
// (client, kind, period) is sent at most once — PortalReminder's unique key
// is the dedupe, so running every cycle is cheap and safe.
//   MONTHLY_FORM    — from the 3rd of the month, if this month's goals form is still missing
//   UNPAID_INVOICE  — an invoice unpaid for 7+ days (once per month)
export async function runPortalReminders(): Promise<{ sent: number }> {
  const now = new Date();
  const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3010';
  let sent = 0;

  const clients = await db.client.findMany({
    where: { portalContactEmail: { not: null }, isFreeAnalysis: false },
    select: { id: true, name: true, portalContactName: true, portalContactEmail: true, portalContactLocale: true },
  });

  for (const c of clients) {
    const first = c.portalContactName?.split(' ')[0] ?? '';
    const ar = c.portalContactLocale === 'ar';

    async function once(kind: string, subject: string, text: string) {
      try {
        await db.portalReminder.create({ data: { clientId: c.id, kind, periodKey } }); // throws on duplicate
      } catch {
        return;
      }
      try {
        await sendMail({ to: c.portalContactEmail!, subject, text });
        sent++;
      } catch (err: any) {
        console.error('[reminders] send failed:', err.message);
        await db.portalReminder.deleteMany({ where: { clientId: c.id, kind, periodKey } }); // retry next cycle
      }
    }

    if (now.getUTCDate() >= 3) {
      const input = await db.monthlyInput.findUnique({ where: { clientId_periodKey: { clientId: c.id, periodKey } }, select: { id: true } });
      if (!input) {
        await once(
          'MONTHLY_FORM',
          ar ? `أهداف هذا الشهر — ${c.name}` : `Your goals for this month — ${c.name}`,
          ar
            ? `مرحباً ${first}،\n\nنحتاج دقيقة واحدة لتحديث أهدافك لهذا الشهر حتى نبني خطتك بدقة. نملأ النموذج مسبقاً من الشهر الماضي.\n\n${base}/portal/form\n\n— فريق AdPac`
            : `Hi ${first},\n\nIt takes about a minute to update your goals for this month so we can build your plan around what you actually want. We prefill it from last month.\n\n${base}/portal/form\n\n— The AdPac team`
        );
      }
    }

    const overdue = await db.invoice.findFirst({
      where: { clientId: c.id, status: 'UNPAID', issuedAt: { lte: new Date(now.getTime() - 7 * 86400000) } },
      select: { invoiceNumber: true },
    });
    if (overdue) {
      await once(
        'UNPAID_INVOICE',
        ar ? `تذكير بفاتورة غير مدفوعة — ${c.name}` : `Reminder: unpaid invoice — ${c.name}`,
        ar
          ? `مرحباً ${first}،\n\nلديك فاتورة غير مدفوعة (${overdue.invoiceNumber}). يمكنك عرضها ودفعها من بوابتك:\n\n${base}/portal/billing\n\n— فريق AdPac`
          : `Hi ${first},\n\nYou have an unpaid invoice (${overdue.invoiceNumber}). You can view and pay it in your portal:\n\n${base}/portal/billing\n\n— The AdPac team`
      );
    }
  }
  return { sent };
}
