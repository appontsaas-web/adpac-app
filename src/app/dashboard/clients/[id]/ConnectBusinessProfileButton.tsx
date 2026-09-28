// Unlike GA4/GTM, no account/location ID needs to be entered up front —
// Business Profile accounts are discoverable via OAuth once authorized (see
// listAccounts in lib/googleBusinessProfile.ts), so this is just a plain
// link into the OAuth flow, same shape as any "Connect with Google" button.
export default function ConnectBusinessProfileButton({ clientId }: { clientId: string }) {
  return (
    <a href={`/api/google-business/connect?clientId=${clientId}`} className="btn">
      Connect Google Business Profile
    </a>
  );
}
