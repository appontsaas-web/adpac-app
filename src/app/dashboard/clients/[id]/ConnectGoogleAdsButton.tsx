'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

// Google Ads account linking is manual-ID based, not OAuth-account-guessed.
// Why: AdPac creates client accounts directly inside its own Manager (MCC)
// account, so there's no separate external party who needs to "grant access"
// via OAuth — AdPac's own Google login already has access to every account
// under the MCC. The only ambiguous part was ever *which* customer ID to
// link, so we just ask for it directly instead of guessing from whichever
// account Google's OAuth consent screen happens to return first.
export default function ConnectGoogleAdsButton({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const [customerId, setCustomerId] = useState('');

  const digitsOnly = customerId.replace(/[^0-9]/g, '');
  const isValid = digitsOnly.length === 10;

  return (
    // Plain GET form: the browser builds the query string from named fields
    // only (it ignores any query string already in `action`), so clientId
    // and the normalized digits-only customerId are passed as hidden inputs
    // rather than baked into the action URL.
    <form className="google-ads-connect-form" action="/api/google-ads/connect">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="customerId" value={digitsOnly} />
      <label htmlFor="googleAdsCustomerId">
        {t('cards.gadsCustomerId')}
        <input
          id="googleAdsCustomerId"
          type="text"
          placeholder="123-456-7890"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
        />
      </label>
      <p className="hint">
        {t('cards.gadsIdHint')}
      </p>
      <button type="submit" className="btn" disabled={!isValid}>
        {t('cards.connectGads')}
      </button>
    </form>
  );
}
