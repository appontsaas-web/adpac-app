// Same "discover after authorizing" shape as ConnectMetaButton — no ad
// account ID needs to be entered up front, the callback lists every
// Organization + Ad Account the authorizing Snapchat login can manage (see
// listOrgAdAccounts in lib/snapchat.ts). Just a plain link into the OAuth flow.
export default function ConnectSnapchatButton({ clientId }: { clientId: string }) {
  return (
    <a href={`/api/snapchat/connect?clientId=${clientId}`} className="btn">
      Connect Snapchat Ads
    </a>
  );
}
