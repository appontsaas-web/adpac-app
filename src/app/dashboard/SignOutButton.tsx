'use client';

import { signOut } from 'next-auth/react';

export default function SignOutButton() {
  return (
    <button
      className="btn btn-secondary"
      style={{ fontSize: '0.8rem' }}
      onClick={() => signOut({ callbackUrl: '/login' })}
    >
      Sign out
    </button>
  );
}
