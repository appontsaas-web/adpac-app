'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';
import { useState } from 'react';
import CampaignCard from './CampaignCard';

interface CampaignDraft {
  imported?: boolean;
  campaignType?: string;
  targetLanguage?: string;
  targetLocations?: string[];
  keywords: string[];
  headlines: string[];
  descriptions: string[];
  rationale: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  dailyBudgetCents: number;
  aiBriefJson: string;
  googleCampaignId: string | null;
  hiddenFromList: boolean;
}

// Splits campaigns into shown/hidden based on the local hiddenFromList flag
// (see CampaignCard's Hide/Unhide button) and offers a toggle to reveal the
// hidden ones — a purely local declutter, nothing here reflects real
// campaign status on Google Ads. Hide/unhide and the "show hidden" toggle
// are admin-only by request: non-admins just see the un-hidden list, same
// as if the hide feature didn't exist.
export default function CampaignsList({
  campaigns,
  readOnly,
  isAdmin,
}: {
  campaigns: Campaign[];
  readOnly?: boolean;
  isAdmin?: boolean;
}) {
  const { tr } = useI18n();
  const [showHidden, setShowHidden] = useState(false);

  const visible = campaigns.filter((c) => !c.hiddenFromList);
  const hidden = campaigns.filter((c) => c.hiddenFromList);

  return (
    <div>
      {campaigns.length === 0 && <p style={{ color: 'var(--text-dim)' }}>{tr("No campaigns yet.")}</p>}

      {visible.map((c) => (
        <CampaignCard key={c.id} campaign={c} readOnly={readOnly} isAdmin={isAdmin} />
      ))}

      {isAdmin && visible.length === 0 && hidden.length > 0 && (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{tr("All campaigns are hidden.")}</p>
      )}

      {isAdmin && hidden.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={() => setShowHidden(!showHidden)} style={{ fontSize: '0.8rem' }}>
            {showHidden ? tr("Hide") : tr("Show")} {tr("hidden campaigns (")}{hidden.length})
          </button>
          {showHidden && (
            <div style={{ marginTop: 8 }}>
              {hidden.map((c) => (
                <CampaignCard key={c.id} campaign={c} readOnly={readOnly} isAdmin={isAdmin} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
