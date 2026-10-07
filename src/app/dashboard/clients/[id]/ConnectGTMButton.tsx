'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

// Same manual-ID pattern as ConnectGoogleAdsButton/ConnectGA4Button. The
// client adds AdPac's Google login as a user on their GTM container first
// (Admin > User Management, with Edit + Publish permission), then the
// operator enters the account/container IDs they were given.
export default function ConnectGTMButton({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const [accountId, setAccountId] = useState('');
  const [containerId, setContainerId] = useState('');
  const accountDigits = accountId.replace(/[^0-9]/g, '');
  const containerDigits = containerId.replace(/[^0-9]/g, '');
  const isValid = accountDigits.length > 0 && containerDigits.length > 0;

  return (
    <form action="/api/google-tag-manager/connect">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="accountId" value={accountDigits} />
      <input type="hidden" name="containerId" value={containerDigits} />
      <label htmlFor="gtmAccountId">
        {t('cards.gtmAccountId')}
        <input
          id="gtmAccountId"
          type="text"
          placeholder="6012345678"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        />
      </label>
      <label htmlFor="gtmContainerId">
        {t('cards.gtmContainerId')}
        <input
          id="gtmContainerId"
          type="text"
          placeholder="98765432"
          value={containerId}
          onChange={(e) => setContainerId(e.target.value)}
        />
      </label>
      <p className="hint">
        {t('cards.gtmIdHint')}
      </p>
      <button type="submit" className="btn" disabled={!isValid}>
        {t('cards.connectGtm')}
      </button>
    </form>
  );
}
