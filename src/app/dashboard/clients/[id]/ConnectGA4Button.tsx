'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

// Same manual-ID pattern as ConnectGoogleAdsButton, but for GA4. Unlike
// Google Ads, there's no Manager-account hierarchy here — the client has to
// add AdPac's Google login as a Viewer on their GA4 property first (Admin >
// Property Access Management), then the operator enters the property ID
// they were given.
export default function ConnectGA4Button({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const [propertyId, setPropertyId] = useState('');
  const digitsOnly = propertyId.replace(/[^0-9]/g, '');
  const isValid = digitsOnly.length > 0;

  return (
    <form action="/api/google-analytics/connect">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="propertyId" value={digitsOnly} />
      <label htmlFor="ga4PropertyId">
        {t('cards.ga4PropertyId')}
        <input
          id="ga4PropertyId"
          type="text"
          placeholder="123456789"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
        />
      </label>
      <p className="hint">
        {t('cards.ga4IdHint')}
      </p>
      <button type="submit" className="btn" disabled={!isValid}>
        {t('cards.connectGa4')}
      </button>
    </form>
  );
}
