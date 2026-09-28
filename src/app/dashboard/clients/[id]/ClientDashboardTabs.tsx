'use client';

import { useState, useEffect } from 'react';

export interface DashboardTab {
  id: string;
  label: string;
  count?: number; // small pill next to the label, e.g. pending AI insights
  content: React.ReactNode;
}

// Left-hand tab navigation for the client detail page, CMS-style, replacing
// the old layout of every section's card stacked one after another. Purely
// a display switch: the server component (page.tsx) still fetches
// everything and decides which tabs even exist (based on capabilities), and
// every tab's content is already-rendered JSX handed in as a prop — this
// component only controls which one is visible. That matters for the
// client-side data-fetching cards inside each tab (ReportingDashboard,
// KeywordAdPerformanceCard, etc.): since a tab's content isn't unmounted
// once visited (kept in the DOM, just hidden), it fetches its data once
// when first switched to and stays put on switching away, rather than
// re-fetching every time you come back to it.
//
// The active tab is also mirrored into the URL as ?tab=xxx (shallow, no
// server round-trip) so a link to a specific tab (e.g. "here's the AI
// insights for this client") is shareable and survives a refresh.
export default function ClientDashboardTabs({ tabs }: { tabs: DashboardTab[] }) {
  const [activeId, setActiveId] = useState<string>(tabs[0]?.id ?? '');
  const [visited, setVisited] = useState<Set<string>>(new Set([tabs[0]?.id ?? '']));

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    if (fromUrl && tabs.some((t) => t.id === fromUrl)) {
      setActiveId(fromUrl);
      setVisited((prev) => new Set(prev).add(fromUrl));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectTab(id: string) {
    setActiveId(id);
    setVisited((prev) => new Set(prev).add(id));
    const url = new URL(window.location.href);
    url.searchParams.set('tab', id);
    window.history.replaceState(null, '', url.toString());
  }

  return (
    <div className="dash-shell">
      <nav className="dash-nav">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`dash-nav-btn${activeId === t.id ? ' active' : ''}`}
            onClick={() => selectTab(t.id)}
          >
            <span>{t.label}</span>
            {typeof t.count === 'number' && t.count > 0 && <span className="dash-nav-count">{t.count}</span>}
          </button>
        ))}
      </nav>
      <div className="dash-content">
        {tabs.map((t) => (
          // Only ever-visited tabs get mounted at all (skips the data-fetch
          // cost for tabs you never open), and only the active one is
          // displayed — the rest stay mounted-but-hidden so switching back
          // doesn't lose scroll position or re-trigger a fetch.
          (visited.has(t.id) || t.id === activeId) && (
            <div key={t.id} style={{ display: activeId === t.id ? 'block' : 'none' }}>
              {t.content}
            </div>
          )
        ))}
      </div>
    </div>
  );
}
