// Next.js instrumentation hook — register() runs once when the server
// process boots (see next.config.js's experimental.instrumentationHook).
// This is where the background metrics-sync / AI-review scheduler gets
// started, so "keep the data and AI review current" doesn't depend on
// anyone remembering to click "Sync now" / "Run AI review" in the
// dashboard. See src/lib/scheduler.ts for what it actually does.
export async function register() {
  // Next.js also loads this file for the edge runtime; the scheduler uses
  // setInterval + fetch against our own Node server, so it only makes sense
  // under the nodejs runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Next's dev server can re-invoke register() across hot reloads — guard
  // with a global flag so this never starts a second overlapping interval.
  const g = globalThis as unknown as { __adpacSchedulerStarted?: boolean };
  if (g.__adpacSchedulerStarted) return;
  g.__adpacSchedulerStarted = true;

  const { startScheduler } = await import('./lib/scheduler');
  startScheduler();
}
