// Same "discover after authorizing" shape as ConnectSnapchatButton — no
// advertiser ID needs to be entered up front, the callback reads every
// advertiser ID TikTok's token-exchange response grants the authorizing
// login (see exchangeCodeForTokens in lib/tiktok.ts). Just a plain link
// into the OAuth flow.
export default function ConnectTikTokButton({ clientId }: { clientId: string }) {
  return (
    <a href={`/api/tiktok/connect?clientId=${clientId}`} className="btn">
      Connect TikTok Ads
    </a>
  );
}
