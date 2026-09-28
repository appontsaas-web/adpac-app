import { db } from '@/lib/db';

// Shared by every AI insight engine (lib/aiInsights.ts, lib/metaInsights.ts,
// lib/businessInsights.ts) — fetches the client's CURRENT calendar month
// goal (see ClientMonthlyGoal's schema comment) and formats it as a short
// line to drop straight into a Claude prompt. Returns null when no goal has
// been set for this month, so callers can just conditionally include it
// rather than needing their own "no goal" copy.
export async function getMonthlyGoalContext(clientId: string): Promise<string | null> {
  const d = new Date();
  const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const goal = await db.clientMonthlyGoal.findUnique({ where: { clientId_monthKey: { clientId, monthKey } } });
  if (!goal || (!goal.metricType && !goal.note)) return null;

  const parts: string[] = [];
  if (goal.metricType && goal.targetValue !== null) {
    const metricLabel: Record<string, string> = {
      SPEND: `spend $${goal.targetValue.toLocaleString()}`,
      CONVERSIONS: `reach ${goal.targetValue.toLocaleString()} conversions`,
      CPA: `hold cost per conversion at or below $${goal.targetValue.toLocaleString()}`,
      ROAS: `hit ${goal.targetValue}x ROAS`,
      LEADS: `reach ${goal.targetValue.toLocaleString()} leads`,
    };
    parts.push(metricLabel[goal.metricType] ?? `${goal.metricType} target: ${goal.targetValue}`);
  }
  if (goal.note) parts.push(goal.note);
  return `This month's stated goal for this client: ${parts.join(' — ')}. Weight recommendations toward this goal over generic optimization where the two would conflict.`;
}
