import { google } from 'googleapis';

// ---------------------------------------------------------------------------
// Google Tag Manager integration
//
// Talks to the real GTM API v2 — nothing here is mocked. This is the one
// integration in AdPac that can WRITE to a client's live site tracking, so
// every deployment goes through ActionLog approval (actionType
// "DEPLOY_GTM_TAG") before createTagAndTrigger/publishVersion ever run — see
// /api/gtm-deployments. Nothing here is called automatically.
//
// Same trust model as GA4: the client adds AdPac's own Google login as a
// user on their GTM container (Admin > User Management) with Edit + Publish
// permission, then the operator enters the account/container IDs they were
// given and authorizes with AdPac's own login.
//
// You need, from Google Cloud Console:
//   GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET — same OAuth client used
//     for Google Ads/Analytics (add the tagmanager scopes below to it)
//   GOOGLE_TAG_MANAGER_REDIRECT_URI — its own registered redirect URI
// Also enable "Tag Manager API" in the Cloud project.
//
// NOTE on tag type/parameter schemas: the constants below (awct, gaawc, sp)
// are Google's documented built-in GTM tag type identifiers, but Google
// doesn't publish a formal schema doc for every parameter key — these match
// what GTM's own UI produces when you create each tag type by hand. Sanity
// check a first deployment against a real test container (or GTM's "export
// container" JSON) before relying on this for a live client site.
// ---------------------------------------------------------------------------

const GTM_API_BASE = 'https://tagmanager.googleapis.com/tagmanager/v2';

const SCOPES = [
  'https://www.googleapis.com/auth/tagmanager.readonly',
  'https://www.googleapis.com/auth/tagmanager.edit.containers',
  'https://www.googleapis.com/auth/tagmanager.publish',
];

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return val;
}

function oauthClient() {
  return new google.auth.OAuth2(
    requireEnv('GOOGLE_ADS_CLIENT_ID'),
    requireEnv('GOOGLE_ADS_CLIENT_SECRET'),
    requireEnv('GOOGLE_TAG_MANAGER_REDIRECT_URI')
  );
}

export function getGoogleTagManagerAuthUrl(state: string): string {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh_token returned. Google only issues one on first consent, or when ' +
        'prompt=consent is forced (which we do) — check your OAuth client config.'
    );
  }
  return tokens;
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to refresh Google Tag Manager access token');
  return token;
}

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

/** Confirms the authorizing login actually has access to this container before we store it, and returns its default workspace ID. */
export async function verifyContainerAccess(
  accountId: string,
  containerId: string,
  refreshToken: string
): Promise<{ workspaceId: string }> {
  const accessToken = await getAccessToken(refreshToken);
  const path = `accounts/${accountId}/containers/${containerId}`;
  const res = await fetch(`${GTM_API_BASE}/${path}`, { headers: authHeaders(accessToken) });
  if (!res.ok) {
    throw new Error(
      `Couldn't access GTM container ${containerId}: ${res.status} ${await res.text()}. ` +
        `Make sure the client has added your Google account as a user on this container.`
    );
  }

  const wsRes = await fetch(`${GTM_API_BASE}/${path}/workspaces`, { headers: authHeaders(accessToken) });
  if (!wsRes.ok) throw new Error(`Failed to list GTM workspaces: ${wsRes.status} ${await wsRes.text()}`);
  const wsData = await wsRes.json();
  const workspaces = wsData.workspace ?? [];
  // "Default Workspace" is created automatically for every container — fall
  // back to whichever workspace comes back first if it's been renamed/deleted.
  const workspace = workspaces.find((w: any) => w.name === 'Default Workspace') ?? workspaces[0];
  if (!workspace) throw new Error(`No workspaces found on GTM container ${containerId}`);
  return { workspaceId: workspace.workspaceId };
}

export type GtmTagType = 'GA4_CONFIG' | 'GOOGLE_ADS_CONVERSION' | 'REMARKETING';

export interface GtmTagRequest {
  type: GtmTagType;
  name: string; // human-readable name shown in the GTM UI, e.g. "GA4 Config - adpac"
  // GA4_CONFIG
  measurementId?: string; // "G-XXXXXXX"
  // GOOGLE_ADS_CONVERSION
  conversionId?: string; // numeric Google Ads conversion ID
  conversionLabel?: string;
  // REMARKETING
  // (conversionId reused above)
}

function buildTagPayload(req: GtmTagRequest, triggerId: string) {
  const base = { name: req.name, firingTriggerId: [triggerId] };
  switch (req.type) {
    case 'GA4_CONFIG':
      return {
        ...base,
        type: 'gaawc',
        parameter: [{ type: 'template', key: 'measurementId', value: req.measurementId }],
      };
    case 'GOOGLE_ADS_CONVERSION':
      return {
        ...base,
        type: 'awct',
        parameter: [
          { type: 'template', key: 'conversionId', value: req.conversionId },
          { type: 'template', key: 'conversionLabel', value: req.conversionLabel },
        ],
      };
    case 'REMARKETING':
      return {
        ...base,
        type: 'sp',
        parameter: [{ type: 'template', key: 'conversionId', value: req.conversionId }],
      };
  }
}

/**
 * Creates an "All Pages" trigger and a tag firing on it in the given
 * workspace. This is a draft change in the workspace only — nothing is live
 * on the client's site until publishVersion() below is also called.
 */
export async function createTagAndTrigger(
  accountId: string,
  containerId: string,
  workspaceId: string,
  refreshToken: string,
  req: GtmTagRequest
): Promise<{ tagId: string; triggerId: string }> {
  const accessToken = await getAccessToken(refreshToken);
  const base = `accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`;

  const triggerRes = await fetch(`${GTM_API_BASE}/${base}/triggers`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ name: `All Pages - ${req.name}`, type: 'pageview' }),
  });
  if (!triggerRes.ok) throw new Error(`GTM trigger creation failed: ${triggerRes.status} ${await triggerRes.text()}`);
  const trigger = await triggerRes.json();

  const tagRes = await fetch(`${GTM_API_BASE}/${base}/tags`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(buildTagPayload(req, trigger.triggerId)),
  });
  if (!tagRes.ok) throw new Error(`GTM tag creation failed: ${tagRes.status} ${await tagRes.text()}`);
  const tag = await tagRes.json();

  return { tagId: tag.tagId, triggerId: trigger.triggerId };
}

/** Creates a new container version from the current workspace state and publishes it live. This is the step that actually changes what's running on the client's site. */
export async function publishVersion(
  accountId: string,
  containerId: string,
  workspaceId: string,
  refreshToken: string,
  versionName: string
): Promise<{ versionId: string }> {
  const accessToken = await getAccessToken(refreshToken);
  const base = `accounts/${accountId}/containers/${containerId}`;

  const versionRes = await fetch(`${GTM_API_BASE}/${base}/workspaces/${workspaceId}:create_version`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ name: versionName, notes: 'Created by AdPac' }),
  });
  if (!versionRes.ok) throw new Error(`GTM version creation failed: ${versionRes.status} ${await versionRes.text()}`);
  const versionData = await versionRes.json();
  const versionId = versionData.containerVersion?.containerVersionId;
  if (!versionId) {
    throw new Error(
      `GTM version created but had no ID (compiler errors: ${versionData.compilerError ?? 'none reported'})`
    );
  }

  const publishRes = await fetch(`${GTM_API_BASE}/${base}/versions/${versionId}:publish`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  if (!publishRes.ok) throw new Error(`GTM publish failed: ${publishRes.status} ${await publishRes.text()}`);

  return { versionId };
}
