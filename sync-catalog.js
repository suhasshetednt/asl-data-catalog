#!/usr/bin/env node
/**
 * ASL Data Catalog — Dremio Sync Script
 * ──────────────────────────────────────────────────────────────────────────
 * Crawls "dremio-db".source and VDS spaces via the Dremio REST API.
 * Writes catalog-data.json which the React app fetches at runtime.
 *
 * Usage:
 *   node scripts/sync-catalog.js                         → writes public/catalog-data.json
 *   node scripts/sync-catalog.js --output ./out.json     → custom output path
 *   node scripts/sync-catalog.js --dry-run               → logs only, no file write
 *
 * Environment variables (set in .env or GitHub Actions secrets):
 *   DREMIO_BASE_URL   https://data.eu.dremio.cloud        (EU Cloud)
 *   DREMIO_PAT        <Personal Access Token>             (recommended)
 *   DREMIO_USER       <username>                          (alternative)
 *   DREMIO_PASS       <password>                          (alternative)
 * ──────────────────────────────────────────────────────────────────────────
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Load .env if present ────────────────────────────────────────────────────
try {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8')
      .split('\n')
      .filter(l => l && !l.startsWith('#'))
      .forEach(l => {
        const [k, ...v] = l.split('=');
        if (k && !process.env[k.trim()]) process.env[k.trim()] = v.join('=').trim();
      });
  }
} catch (_) {}

// ── Config ──────────────────────────────────────────────────────────────────
const CFG = {
  baseUrl:    process.env.DREMIO_BASE_URL || 'https://data.eu.dremio.cloud',
  pat:        process.env.DREMIO_PAT,
  user:       process.env.DREMIO_USER,
  pass:       process.env.DREMIO_PASS,
  outputArg:  process.argv.find((a, i) => process.argv[i - 1] === '--output'),
  dryRun:     process.argv.includes('--dry-run'),
  verbose:    process.argv.includes('--verbose'),
  // Delay between API calls (ms) to avoid rate limiting
  rateDelay:  parseInt(process.env.DREMIO_RATE_DELAY || '80'),
  // Max concurrent leaf-dataset fetches
  concurrency: parseInt(process.env.DREMIO_CONCURRENCY || '5'),
};

const OUTPUT_PATH = CFG.outputArg
  ? path.resolve(CFG.outputArg)
  : path.resolve(__dirname, '../public/catalog-data.json');

// ── Paths to crawl in Dremio catalog ────────────────────────────────────────
// Add or remove paths here as new sources/VDS spaces are created in Dremio.
const CRAWL_PATHS = [
  ['dremio-db', 'source'],               // All raw CDC and direct sources
  ['dremio-db', 'Dev', 'SAP_HANA'],      // SAP HANA VDS (P&L, Balance Sheet)
  ['dremio-db', 'eagle_eye'],            // Eagle Eye operational VDS
];

// ── Domain inference rules (first match wins) ────────────────────────────────
const DOMAIN_RULES = [
  { terms: ['amos', 'mel', 'engine', 'mro', 'maintenance', 'shop_req'],   domain: 'Maintenance' },
  { terms: ['sap', 'hana', 'finance', 'p&l', 'pl_', 'bs_', 'balance', 'xero', 'ebitda'], domain: 'Finance' },
  { terms: ['occ', 'oracle', 'movement', 'flight_leg', 'schedule', 'delay', 'mm', 'iceberg'], domain: 'Operations' },
  { terms: ['aims', 'crew', 'pqs', 'perdiem', 'per_diem', 'roster', 'v_leg'], domain: 'Crew' },
];

const SOURCE_MAP = {
  amos:       'AMOS PostgreSQL',
  occ:        'Movement Manager',
  oracle:     'Oracle ADB',
  aims:       'AIMS Flat Files',
  'sap_hana': 'SAP HANA',
  hana:       'SAP HANA',
  xero:       'Xero GL',
};

const FREQ_MAP = {
  Maintenance: 'CDC real-time',
  Finance:     'Monthly',
  Operations:  'Real-time',
  Crew:        'Every 15 min',
  Engineering: 'On-demand',
};

const CLS_MAP = {
  Maintenance: 'Internal',
  Finance:     'Confidential',
  Operations:  'Internal',
  Crew:        'Restricted',
  Engineering: 'Internal',
};

const SENS_MAP = {
  Maintenance: 'Medium',
  Finance:     'Very High',
  Operations:  'Medium',
  Crew:        'High',
  Engineering: 'Low',
};

// Owner mapping: if a path segment matches, assign this owner
const OWNER_MAP = [
  { terms: ['amos', 'engine', 'oracle', 'iceberg'],         owner: 'Suhas Shete',    steward: 'Bhavya Shah' },
  { terms: ['sap', 'hana', 'p&l', 'pl_', 'bs_', 'xero'],   owner: 'Bhavya Shah',    steward: 'Isha Metange' },
  { terms: ['occ', 'flight', 'movement', 'delay', 'mm'],    owner: 'Marmik Patel',   steward: 'Harsh Sanghvi' },
  { terms: ['aims', 'crew', 'v_leg'],                        owner: 'Bikram Singh',   steward: 'Dhruv Mevada' },
];

// ── Auth / HTTP ──────────────────────────────────────────────────────────────
let _authToken = null;

async function getToken() {
  if (_authToken) return _authToken;
  if (CFG.pat) { _authToken = CFG.pat; return _authToken; }
  if (!CFG.user || !CFG.pass) throw new Error('Set DREMIO_PAT or DREMIO_USER + DREMIO_PASS');

  const res = await fetch(`${CFG.baseUrl}/apiv2/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ userName: CFG.user, password: CFG.pass }),
  });
  if (!res.ok) throw new Error(`Dremio login failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  _authToken = data.token;
  return _authToken;
}

async function dremioGet(endpoint) {
  const token = await getToken();
  await sleep(CFG.rateDelay);
  const res = await fetch(`${CFG.baseUrl}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
  });
  if (res.status === 404)  return null;
  if (res.status === 401)  { _authToken = null; throw new Error('Dremio auth expired — re-run'); }
  if (!res.ok) throw new Error(`GET ${endpoint} → ${res.status}: ${await res.text()}`);
  return res.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Catalog traversal ────────────────────────────────────────────────────────
async function getByPath(pathArr) {
  const encoded = pathArr.map(encodeURIComponent).join('/');
  return dremioGet(`/api/v3/catalog/by-path/${encoded}`);
}

async function getChildren(id) {
  const all = [];
  let pageToken = null;
  do {
    const url = `/api/v3/catalog/${id}/children?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const page = await dremioGet(url);
    if (!page) break;
    all.push(...(page.data || []));
    pageToken = page.nextPageToken || null;
  } while (pageToken);
  return all;
}

async function getDataset(id) {
  return dremioGet(`/api/v3/catalog/${id}`);
}

/**
 * Recursively crawl a container, collecting all DATASET entries.
 * Returns array of raw Dremio dataset objects (with .fields populated).
 */
async function crawlContainer(container, depth = 0, maxDepth = 10) {
  if (depth > maxDepth) return [];

  const children = await getChildren(container.id);
  if (CFG.verbose) console.log(`  ${'  '.repeat(depth)}${(container.path||[]).join('.')} → ${children.length} children`);

  const datasetRefs = [];
  const containerRefs = [];

  for (const child of children) {
    if (child.type === 'DATASET') {
      datasetRefs.push(child);
    } else if (child.type === 'CONTAINER') {
      containerRefs.push(child);
    }
  }

  // Fetch dataset details in batches (respects concurrency limit)
  const datasets = [];
  for (let i = 0; i < datasetRefs.length; i += CFG.concurrency) {
    const batch = datasetRefs.slice(i, i + CFG.concurrency);
    const results = await Promise.all(batch.map(d => getDataset(d.id).catch(() => null)));
    datasets.push(...results.filter(Boolean));
  }

  // Recurse into sub-containers sequentially
  for (const c of containerRefs) {
    const sub = await crawlContainer(c, depth + 1, maxDepth);
    datasets.push(...sub);
  }

  return datasets;
}

// ── Dataset transformation ───────────────────────────────────────────────────
function inferDomain(pathArr) {
  const joined = pathArr.join('/').toLowerCase();
  for (const rule of DOMAIN_RULES) {
    if (rule.terms.some(t => joined.includes(t))) return rule.domain;
  }
  return 'Engineering';
}

function inferSource(pathArr) {
  const joined = pathArr.join('/').toLowerCase();
  for (const [key, label] of Object.entries(SOURCE_MAP)) {
    if (joined.includes(key)) return label;
  }
  if (pathArr.includes('eagle_eye') || pathArr.includes('Dev')) return 'Dremio VDS';
  return pathArr[1] || 'Unknown';
}

function inferOwner(pathArr) {
  const joined = pathArr.join('/').toLowerCase();
  for (const rule of OWNER_MAP) {
    if (rule.terms.some(t => joined.includes(t))) return { owner: rule.owner, steward: rule.steward };
  }
  return { owner: 'Suhas Shete', steward: 'DnT Infotech' };
}

function computeQuality(dremioDs) {
  const fields = dremioDs.fields || [];
  const hasFields = fields.length > 0;

  // Completeness: penalise datasets with very few fields or no description
  const fieldScore   = hasFields ? Math.min(98, 70 + fields.length) : 50;
  const wikiScore    = (dremioDs.wiki && dremioDs.wiki.text) ? 100 : 75;
  const completeness = Math.round((fieldScore + wikiScore) / 2);

  // Freshness: VDS are considered live; physical datasets depend on CDC
  const freshness    = dremioDs.type === 'VIRTUAL_DATASET' ? 96 : 91;

  // Overall = weighted average
  const q = Math.round(completeness * 0.5 + freshness * 0.3 + (hasFields ? 95 : 60) * 0.2);

  return { q, comp: completeness, fresh: freshness };
}

function dremioPathStr(pathArr) {
  return pathArr.map(p => `"${p}"`).join('.');
}

function transformDataset(raw) {
  const pathArr  = raw.path || [];
  const name     = pathArr[pathArr.length - 1] || 'unknown';
  const domain   = inferDomain(pathArr);
  const source   = inferSource(pathArr);
  const { owner, steward } = inferOwner(pathArr);
  const { q, comp, fresh } = computeQuality(raw);

  const desc = (raw.wiki && raw.wiki.text)
    ? raw.wiki.text
    : `${raw.type === 'VIRTUAL_DATASET' ? 'Virtual dataset (VDS)' : 'Physical dataset'} · ${pathArr.slice(0, 5).join(' → ')}`;

  const tags = [
    ...(raw.tags && raw.tags.tags ? raw.tags.tags : []),
    domain.toLowerCase(),
    source.toLowerCase().split(' ')[0],
  ].filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 6);

  return {
    id:          raw.id,
    name,
    domain,
    source,
    path:        dremioPathStr(pathArr),
    type:        raw.type,                        // PHYSICAL_DATASET | VIRTUAL_DATASET
    owner,
    steward,
    desc,
    freq:        FREQ_MAP[domain] || 'Unknown',
    updated:     new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }),
    q, comp, fresh,
    cls:         CLS_MAP[domain]  || 'Internal',
    sens:        SENS_MAP[domain] || 'Medium',
    tags,
    rows:        null,                            // populated by row-count query (optional)
    cols:        (raw.fields || []).length,
    cols_list:   (raw.fields || []).map(f => ({
      n: f.name,
      t: f.type ? f.type.name : 'UNKNOWN',
      d: '',
    })),
    upstream:    [source],
    downstream:  [],
    related:     [],
    sql:         raw.sql || null,
    _dremioPath: pathArr,
  };
}

// ── Optional: row count via SQL query ───────────────────────────────────────
// Only runs when --with-counts flag is set (slow — one SQL job per table).
async function fetchRowCount(dremioPath) {
  try {
    const jobRes = await fetch(`${CFG.baseUrl}/api/v3/sql`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${await getToken()}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ sql: `SELECT COUNT(*) AS cnt FROM ${dremioPath}` }),
    });
    if (!jobRes.ok) return null;
    const { id: jobId } = await jobRes.json();

    // Poll until done (max 30s)
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const statusRes = await dremioGet(`/api/v3/job/${jobId}`);
      if (!statusRes) return null;
      if (statusRes.jobState === 'COMPLETED') {
        const rows = await dremioGet(`/api/v3/job/${jobId}/results?offset=0&limit=1`);
        return rows && rows.rows[0] ? rows.rows[0][0].toString() : null;
      }
      if (['FAILED', 'CANCELED'].includes(statusRes.jobState)) return null;
    }
  } catch (_) {
    return null;
  }
}

// ── Glossary (static — add entries as business terms evolve) ────────────────
const GLOSSARY = [
  { term:'AIMS',           domain:'Crew',        def:'Airline Information Management System — crew rostering, qualification, and duty management platform used across ASL.', related:['PQS','Per Diem'], datasets:[] },
  { term:'AMOS',           domain:'Maintenance', def:'Aircraft Maintenance & Operations System — primary MRO software tracking all maintenance planning, execution, parts, and compliance at ASL.', related:['MEL','Work Order','ATA Chapter'], datasets:[] },
  { term:'AOG',            domain:'Maintenance', def:'Aircraft on Ground — critical defect grounding an aircraft. Triggers priority parts orders and immediate maintenance response across ASL entities.', related:['MEL','Work Order'], datasets:[] },
  { term:'ATA Chapter',    domain:'Maintenance', def:'Air Transport Association chapter code — standardised aircraft system numbering (e.g. ATA 71 = Power Plant). Used to classify AMOS tasks and MEL defects.', related:['MEL','Work Order'], datasets:[] },
  { term:'Block Out Time', domain:'Operations',  def:'Time when aircraft doors close and brakes release for departure. Primary departure reference in Dremio: COALESCE(BlockOutTime, ETD, STD).', related:['ETD','STD'], datasets:[] },
  { term:'CDC',            domain:'Engineering', def:'Change Data Capture — real-time database change streaming. ASL uses Debezium on AMOS PostgreSQL and PySpark on Oracle ADB to land data into S3 Iceberg.', related:['Debezium','Iceberg'], datasets:[] },
  { term:'EBITDA',         domain:'Finance',     def:'Calculated from SAP Flash Codes (PL0016 category) plus GL 00630* depreciation add-back, filtered to ledger 0L. Used in all BE10 and IE10 dashboards.', related:['Flash Code','P&L'], datasets:[] },
  { term:'ETD',            domain:'Operations',  def:'Estimated Time of Departure — second priority in COALESCE(BlockOutTime, ETD, STD) departure chain used across Dremio flight leg queries.', related:['Block Out Time','STD'], datasets:[] },
  { term:'Flash Code',     domain:'Finance',     def:'SAP hierarchical P&L categorisation code. PL0016 is the parent EBITDA code in ASL reporting, used in all financial dashboards.', related:['EBITDA','P&L'], datasets:[] },
  { term:'Iceberg',        domain:'Engineering', def:'Apache Iceberg open table format on S3 — landing zone for Oracle ADB data, registered in AWS Glue (catlogdebeziumdnt) and queried via Dremio.', related:['CDC','S3','Glue'], datasets:[] },
  { term:'MEL',            domain:'Maintenance', def:'Minimum Equipment List — document listing equipment that may be inoperative for a limited time while maintaining airworthiness. Tracked in AMOS with ATA chapter and expiry.', related:['AOG','Work Order'], datasets:[] },
  { term:'MRO',            domain:'Maintenance', def:'Maintenance, Repair & Overhaul — core ASL service line across Ireland, Belgium, France, and UK facilities, managed entirely through AMOS.', related:['AMOS','Work Order'], datasets:[] },
  { term:'OCC',            domain:'Operations',  def:'Operations Control Centre — real-time flight monitoring hub. Primary consumer of the Technical Delay VDS and Flight Leg Latest data.', related:['Technical Delay','Flight Leg'], datasets:[] },
  { term:'PQS',            domain:'Crew',        def:'Personnel Qualification Standard — links crew members to aircraft types and roles. Cross-referenced between AMOS and AIMS flat files.', related:['AIMS','Crew'], datasets:[] },
  { term:'STD',            domain:'Operations',  def:'Scheduled Time of Departure — original planned departure time. Final fallback in COALESCE departure chain when BlockOutTime and ETD are null.', related:['Block Out Time','ETD'], datasets:[] },
  { term:'VDS',            domain:'Engineering', def:'Virtual Dataset — a named, versioned SQL view in Dremio combining and transforming multiple sources. Primary analytics delivery vehicle across ASL.', related:['Dremio','Iceberg'], datasets:[] },
];

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const startMs = Date.now();
  console.log(`\n🛫  ASL Catalog Sync — ${new Date().toISOString()}`);
  console.log(`   Dremio: ${CFG.baseUrl}`);
  console.log(`   Auth:   ${CFG.pat ? 'PAT' : 'User/Pass'}`);
  console.log(`   Output: ${CFG.dryRun ? 'DRY RUN' : OUTPUT_PATH}\n`);

  if (!CFG.pat && (!CFG.user || !CFG.pass)) {
    console.error('❌  Missing credentials. Set DREMIO_PAT (or DREMIO_USER + DREMIO_PASS).');
    process.exit(1);
  }

  const allRaw = [];

  for (const crawlPath of CRAWL_PATHS) {
    const label = crawlPath.join('.');
    process.stdout.write(`📂  Crawling ${label} … `);
    try {
      const container = await getByPath(crawlPath);
      if (!container) { console.log('not found (skip)'); continue; }
      const rawDatasets = await crawlContainer(container);
      console.log(`${rawDatasets.length} datasets`);
      allRaw.push(...rawDatasets);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  // Deduplicate by Dremio ID
  const dedupMap = {};
  for (const raw of allRaw) {
    if (raw && raw.id) dedupMap[raw.id] = raw;
  }
  const uniqueRaw = Object.values(dedupMap);

  // Transform
  const datasets = uniqueRaw.map(transformDataset);

  // Optional row counts
  if (process.argv.includes('--with-counts')) {
    console.log('\n📊  Fetching row counts (this takes a while)…');
    for (const ds of datasets) {
      if (ds.cols > 0) {
        ds.rows = await fetchRowCount(ds.path);
      }
    }
  }

  // Domain breakdown
  const byDomain = datasets.reduce((acc, ds) => {
    acc[ds.domain] = (acc[ds.domain] || 0) + 1;
    return acc;
  }, {});

  const output = {
    datasets,
    glossary:      GLOSSARY,
    syncedAt:      new Date().toISOString(),
    totalCount:    datasets.length,
    domainBreakdown: byDomain,
    crawledPaths:  CRAWL_PATHS.map(p => p.join('.')),
    durationMs:    Date.now() - startMs,
  };

  // Summary
  console.log('\n✅  Sync complete:');
  console.log(`    Total datasets : ${datasets.length}`);
  Object.entries(byDomain).forEach(([d, c]) => console.log(`    ${d.padEnd(14)}: ${c}`));
  console.log(`    Duration       : ${((Date.now() - startMs) / 1000).toFixed(1)}s`);

  if (CFG.dryRun) {
    console.log('\n   (dry-run — no file written)');
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n💾  Written → ${OUTPUT_PATH}\n`);
}

main().catch(err => {
  console.error('\n❌ ', err.message);
  if (CFG.verbose) console.error(err.stack);
  process.exit(1);
});
