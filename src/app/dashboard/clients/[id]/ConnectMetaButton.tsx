// Same "discover after authorizing" shape as ConnectBusinessProfileButton —
// no ad account ID needs to be entered up front, the callback lists the ad
// accounts the authorizing Meta login can manage (see listAdAccounts in
// lib/meta.ts) and picks the first one. Just a plain link into the OAuth flow.
export default function ConnectMetaButton({ clientId }: { clientId: string }) {
  return (
    <a href={`/api/meta/connect?clientId=${clientId}`} className="btn">
      Connect Meta Ads (Facebook &amp; Instagram)
    </a>
  );
}
