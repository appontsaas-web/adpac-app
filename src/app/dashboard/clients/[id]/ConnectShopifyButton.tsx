'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

export default function ConnectShopifyButton({ clientId }: { clientId: string }) {
  const { tr } = useI18n();
  const [shop, setShop] = useState('');
  return (
    <form action="/api/shopify/connect">
      <input type="hidden" name="clientId" value={clientId} />
      <label htmlFor="shopDomain">
        {tr('Shopify store')}
        <input id="shopDomain" name="shop" type="text" placeholder="my-store.myshopify.com" value={shop} onChange={(e) => setShop(e.target.value)} />
      </label>
      <p className="hint">{tr('The store owner approves read-only access to orders and products on the next screen.')}</p>
      <button type="submit" className="btn" disabled={!shop.trim()}>{tr('Connect Shopify')}</button>
    </form>
  );
}
