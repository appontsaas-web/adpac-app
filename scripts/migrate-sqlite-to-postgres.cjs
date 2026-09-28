// One-time data migration: copies every row from the old local SQLite
// dev.db into the new production Postgres database, by POSTing batches to
// this app's own /api/admin/import endpoint (see that route for why — the
// production database only accepts connections from the app itself, not
// from an external machine like your laptop, so this goes over normal
// HTTPS to the app's public URL instead of connecting to the database
// directly).
//
// Usage:
//   APP_URL="https://adpac-app-gtav7.ondigitalocean.app" \
//   SYNC_SECRET="...same value set in DigitalOcean's env vars..." \
//     node scripts/migrate-sqlite-to-postgres.cjs
//
// Safe to re-run: every insert uses skipDuplicates, so rows already present
// (matched by primary key or a unique index) are silently skipped rather
// than erroring or duplicating.

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { Prisma } = require('@prisma/client');

const APP_URL = process.env.APP_URL;
const SYNC_SECRET = process.env.SYNC_SECRET;
const BATCH_SIZE = 200;

if (!APP_URL || !SYNC_SECRET) {
  console.error('Set both APP_URL and SYNC_SECRET env vars before running this script.');
  process.exit(1);
}

const sqlite = new DatabaseSync(path.join(__dirname, '..', 'prisma', 'dev.db'), { readOnly: true });

// Parent-before-child order, matching the FK dependency graph in schema.prisma.
const MODEL_ORDER = [
  'Position',
  'User',
  'Client',
  'ClientAssignment',
  'GoogleAdsAccount',
  'GoogleAnalyticsProperty',
  'GoogleTagManagerContainer',
  'GoogleBusinessProfileAccount',
  'BusinessLocation',
  'LocationMetric',
  'BusinessReview',
  'MetaAdAccount',
  'MetaCampaign',
  'MetaAdSetMetric',
  'MetaAdMetric',
  'MetaDailyMetric',
  'MetaAudienceMetric',
  'SnapAdAccount',
  'SnapCampaign',
  'SnapDailyMetric',
  'Campaign',
  'DailyMetric',
  'AudienceMetric',
  'KeywordMetric',
  'SearchTermMetric',
  'AdGroupMetric',
  'AdMetric',
  'AssetGroupMetric',
  'Invoice',
  'ActionLog',
  'AiImpactOverride',
  'TokenSetting',
  'AppSetting',
  'TokenTransaction',
];

function coerceValue(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') value = Number(value);
  if (field.type === 'Boolean') return !!value;
  if (field.type === 'DateTime') return new Date(value).toISOString();
  if (field.type === 'Int') return Math.trunc(Number(value));
  if (field.type === 'Float') return Number(value);
  return value;
}

async function postBatch(model, rows) {
  const res = await fetch(`${APP_URL}/api/admin/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-secret': SYNC_SECRET },
    body: JSON.stringify({ model, rows }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${model}: HTTP ${res.status} — ${JSON.stringify(json)}`);
  }
  return json;
}

async function migrateModel(modelName) {
  const dmmfModel = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  if (!dmmfModel) {
    console.log(`  (skipping ${modelName} — not found in current schema)`);
    return;
  }
  const scalarFields = dmmfModel.fields.filter((f) => f.kind === 'scalar');

  let rows;
  try {
    rows = sqlite.prepare(`SELECT * FROM "${modelName}"`).all();
  } catch (e) {
    console.log(`  (skipping ${modelName} — no such table in dev.db: ${e.message})`);
    return;
  }
  if (rows.length === 0) {
    console.log(`${modelName}: 0 rows, skipping`);
    return;
  }

  const data = rows.map((row) => {
    const out = {};
    for (const field of scalarFields) {
      if (!(field.name in row)) continue;
      out[field.name] = coerceValue(row[field.name], field);
    }
    return out;
  });

  let inserted = 0;
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    const result = await postBatch(modelName, batch);
    inserted += result.inserted ?? 0;
  }
  console.log(`${modelName}: ${inserted} of ${rows.length} rows inserted (rest skipped as duplicates)`);
}

async function main() {
  console.log(`Migrating from prisma/dev.db to ${APP_URL}\n`);
  for (const modelName of MODEL_ORDER) {
    await migrateModel(modelName);
  }
  console.log('\nDone.');
}

main()
  .catch((e) => {
    console.error('\nMigration failed:', e);
    process.exit(1);
  })
  .finally(() => {
    sqlite.close();
  });
