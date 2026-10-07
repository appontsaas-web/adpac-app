'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

export default function ConnectMerchantCenterButton({ clientId }: { clientId: string }) {
  const { tr } = useI18n();
  const [id, setId] = useState('');
  const digits = id.replace(/\D/g, '');
  return (
    <form action="/api/merchant-center/connect">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="merchantId" value={digits} />
      <label htmlFor="mcId">
        {tr('Merchant Center ID')}
        <input id="mcId" type="text" placeholder="123456789" value={id} onChange={(e) => setId(e.target.value)} />
      </label>
      <p className="hint">{tr("Find it top-right in Merchant Center. The client must first add AdPac's Google login as a user on the account.")}</p>
      <button type="submit" className="btn" disabled={digits.length < 4}>{tr('Connect Merchant Center')}</button>
    </form>
  );
}
