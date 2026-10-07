'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

export default function ConnectSearchConsoleButton({ clientId }: { clientId: string }) {
  const { tr } = useI18n();
  const [siteUrl, setSiteUrl] = useState('');
  const ok = /^(https?:\/\/.+|sc-domain:.+)$/.test(siteUrl.trim());
  return (
    <form action="/api/search-console/connect">
      <input type="hidden" name="clientId" value={clientId} />
      <label htmlFor="scSite">
        {tr('Search Console property')}
        <input id="scSite" name="siteUrl" type="text" placeholder="https://example.com/  or  sc-domain:example.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
      </label>
      <p className="hint">{tr("Enter the property exactly as Search Console shows it. The client must first add AdPac's Google login as a user on that property.")}</p>
      <button type="submit" className="btn" disabled={!ok}>{tr('Connect Search Console')}</button>
    </form>
  );
}
