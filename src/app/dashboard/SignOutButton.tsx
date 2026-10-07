'use client';

import { signOut } from 'next-auth/react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

export default function SignOutButton() {
  const { t } = useI18n();
  return (
    <button
      className="btn btn-secondary"
      style={{ fontSize: '0.8rem' }}
      onClick={() => signOut({ callbackUrl: '/login' })}
    >
      {t('common.signOut')}
    </button>
  );
}
