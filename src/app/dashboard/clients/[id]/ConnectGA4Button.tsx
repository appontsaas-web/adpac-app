'use client';

import { useState } from 'react';

// Same manual-ID pattern as ConnectGoogleAdsButton, but for GA4. Unlike
// Google Ads, there's no Manager-account hierarchy here — the client has to
// add AdPac's Google login as a Viewer on their GA4 property first (Admin >
// Property Access Management), then the operator enters the property ID
// they were given.
export default function ConnectGA4Button({ clientId }: { clientId: string }) {
  const [propertyId, setPropertyId] = useState('');
  const digitsOnly = propertyId.replace(/[^0-9]/g, '');
  const isValid = digitsOnly.length > 0;

  return (
    <form action="/api/google-analytics/connect">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="propertyId" value={digitsOnly} />
      <label htmlFor="ga4PropertyId">
        GA4 Property ID
        <input
          id="ga4PropertyId"
          type="text"
          placeholder="123456789"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
        />
      </label>
      <p className="hint">
        Found in GA4 Admin &gt; Property Settings. Make sure the client has added your Google account as a
        Viewer on this property first — otherwise the connection will fail.
      </p>
      <button type="submit" className="btn" disabled={!isValid}>
        Connect GA4 property
      </button>
    </form>
  );
}
