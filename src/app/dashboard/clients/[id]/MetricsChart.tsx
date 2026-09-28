'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Metric {
  date: string | Date;
  costCents: number;
  clicks: number;
  conversions: number;
}

export default function MetricsChart({ metrics }: { metrics: Metric[] }) {
  if (metrics.length === 0) {
    return (
      <p style={{ color: 'var(--text-dim)' }}>
        No performance data yet — this fills in once campaigns are live and{' '}
        <code>/api/metrics/sync</code> has run (wire it to a daily cron — see README).
      </p>
    );
  }

  const data = metrics.map((m) => ({
    date: new Date(m.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    spend: m.costCents / 100,
    clicks: m.clicks,
    conversions: m.conversions,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2230" />
        <XAxis dataKey="date" stroke="#9aa0b4" fontSize={12} />
        <YAxis stroke="#9aa0b4" fontSize={12} />
        <Tooltip contentStyle={{ background: '#12141d', border: '1px solid #1f2230', borderRadius: 8 }} />
        <Line type="monotone" dataKey="spend" name="Spend ($)" stroke="#6d5efc" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="conversions" name="Conversions" stroke="#22d3c9" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
