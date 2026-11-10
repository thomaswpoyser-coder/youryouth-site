#!/usr/bin/env node
/* =====================================================================
   generate-static-pages.mjs — real static pages for claimed
   youth-group addresses (findability pass, Nov 10, 2026).

   WHY: GitHub Pages serves youryouth.org/<slug> from the
   root 404 shell, so a claimed address answered HTTP 404 with
   the generic "Your Youth — group page" title — invisible to
   search engines in any useful way. This script generates a
   REAL page at <slug>/index.html (HTTP 200) from the group's
   own public payload (the youth-site Edge Function): the
   group's name in the title, its own published meeting time
   and place in the meta description and in a plain-HTML
   "static floor", and Organization structured data (JSON-LD)
   built only from fields the payload actually carries — the
   youth payload only ever holds what the leader chose to
   publish, so the floor can never show an unpublished fact.
   The page IS the usual shell —
   the live renderer (site/youth-site.js) boots over the floor
   exactly as it does over the shells and replaces it with the
   full page; a visitor notices no difference, and a leader's
   edit-in-place works the same. Unclaimed paths keep the
   404-shell behaviour untouched, and the ?c= / ?s= routes are
   not affected.

   USAGE:
     node tools/generate-static-pages.mjs [slug ...]
   With no arguments it regenerates the known claimed slugs in
   DEFAULT_SLUGS below. It also (re)writes sitemap.xml (the root
   page plus every slug whose static page exists) and robots.txt.

   WIRE-FOR-LATER: when slug-claim grows beyond a handful of
   groups, run this once per new claim (or on a schedule) —
   deliberately NOT a CI/cron pipeline at pilot scale. To cover
   a new group: add its slug to DEFAULT_SLUGS (or pass it as an
   argument) and re-run. A slug whose payload stops resolving is
   reported and left out of the sitemap; its stale page, if any,
   is left on disk for a human to remove.
   ===================================================================== */
'use strict';

const DOMAIN = 'https://youryouth.org';
const FUNCTION = 'youth-site';
const SUPABASE_URL = 'https://wsmqkhljjhaueahqizfr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4eoGwVeVNyN7jn-wmJsUkg_nShqdukt';
const DEFAULT_SLUGS = ['soulfireyouth'];

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function lines(text) {
  return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}
function firstLine(text) { return lines(text)[0] || ''; }

/* The payload's free-text address, taken apart only as far as
   its commas and the postal code allow: "870 Murray Dr,
   Centreville NS B0P 1J0" → street / Centreville / NS / B0P 1J0.
   Anything that does not fit that shape stays whole — the
   generator never invents a town or a postal code. */
function parseAddress(addr) {
  const raw = String(addr || '').trim();
  if (!raw) return null;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const out = { streetAddress: parts[0] || raw };
  if (parts.length > 1) {
    const rest = parts.slice(1).join(', ');
    const m = rest.match(/^(.+?)\s+([A-Z]{2})\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)?$/);
    if (m) {
      out.addressLocality = m[1].trim();
      out.addressRegion = m[2];
      if (m[3]) out.postalCode = m[3].replace(/\s+/, ' ');
      out.addressCountry = 'CA';
    } else {
      out.addressLocality = parts[1];
    }
    if (parts.length > 2 && !out.postalCode) out.extra = parts.slice(2).join(', ');
  }
  return out;
}
function townOf(data) {
  const p = parseAddress(data.address);
  return p && p.addressLocality ? p.addressLocality : '';
}

/* Meeting times are the group's own free text. A structured opening-hours entry is
   emitted for a line only when a weekday AND a clock time can
   be read straight out of it ("Morning" in the line reads as
   AM); a line that does not parse simply stays out — the times
   still appear in the description and the floor as written. */
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function openingHours(serviceTimes) {
  const out = [];
  for (const line of lines(serviceTimes)) {
    const day = DAYS.find((d) => line.toLowerCase().includes(d.toLowerCase().replace(/s$/, '')) || line.toLowerCase().includes(d.toLowerCase()));
    if (!day) continue;
    const tm = line.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!tm) continue;
    let hh = parseInt(tm[1], 10);
    const mm = tm[2] || '00';
    let mer = (tm[3] || '').toLowerCase();
    if (!mer && /morning/i.test(line)) mer = 'am';
    if (mer === 'pm' && hh < 12) hh += 12;
    if (mer === 'am' && hh === 12) hh = 0;
    out.push({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: 'https://schema.org/' + day,
      opens: String(hh).padStart(2, '0') + ':' + mm,
    });
  }
  return out;
}

function buildDescription(data) {
  const bits = [];
  const town = townOf(data);
  bits.push(town ? `${data.name} in ${town}.` : `${data.name}.`);
  const times = lines(data.serviceTimes);
  if (times.length) bits.push(times.join('. ') + '.');
  if (data.address) bits.push(String(data.address).trim());
  return bits.join(' ').slice(0, 300);
}

function buildJsonLd(data, url) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: data.name,
    url,
  };
  const desc = buildDescription(data);
  if (desc) ld.description = desc;
  if (data.logoUrl) ld.logo = data.logoUrl;
  if (data.logoUrl) ld.image = data.logoUrl;
  const addr = parseAddress(data.address);
  if (addr) {
    const a = { '@type': 'PostalAddress', streetAddress: addr.streetAddress };
    if (addr.addressLocality) a.addressLocality = addr.addressLocality;
    if (addr.addressRegion) a.addressRegion = addr.addressRegion;
    if (addr.postalCode) a.postalCode = addr.postalCode;
    if (addr.addressCountry) a.addressCountry = addr.addressCountry;
    ld.address = a;
  }
  const hours = openingHours(data.serviceTimes);
  if (hours.length) ld.openingHoursSpecification = hours;
  const socials = (data.socials && typeof data.socials === 'object') ? data.socials : {};
  const sameAs = ['facebook', 'instagram', 'youtube', 'x']
    .map((k) => socials[k]).filter((v) => typeof v === 'string' && /^https?:\/\//i.test(v));
  if (sameAs.length) ld.sameAs = sameAs;
  return ld;
}

function buildFloor(data) {
  const parts = [];
  parts.push(`      <h1>${esc(data.name)}</h1>`);
  const times = lines(data.serviceTimes);
  if (times.length) parts.push(`      <p>${times.map(esc).join('<br>\n      ')}</p>`);
  if (data.address) parts.push(`      <p>${esc(data.address)}</p>`);
  if (data.welcome) parts.push(`      <p>${esc(data.welcome)}</p>`);
  return [
    '  <!-- Static floor (generated by tools/generate-static-pages.mjs):',
    '       this group\'s own name and published facts in plain HTML,',
    '       for search engines and slow connections. The live renderer',
    '       removes it the moment the full page shows. -->',
    '  <div id="static-floor">',
    ...parts,
    '  </div>',
  ].join('\n');
}

function buildPage(shell, data, slug) {
  const url = `${DOMAIN}/${slug}`;
  const town = townOf(data);
  const title = town ? `${data.name} — ${town}` : data.name;
  const desc = buildDescription(data);
  let html = shell;
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${esc(desc)}">`);
  const image = data.logoUrl || '';
  const headExtra = [
    `  <link rel="canonical" href="${url}">`,
    `  <meta property="og:type" content="website">`,
    `  <meta property="og:title" content="${esc(title)}">`,
    `  <meta property="og:description" content="${esc(desc)}">`,
    `  <meta property="og:url" content="${url}">`,
    ...(image ? [`  <meta property="og:image" content="${esc(image)}">`] : []),
    `  <meta name="twitter:card" content="summary">`,
    `  <script type="application/ld+json">${JSON.stringify(buildJsonLd(data, url)).replace(/<\//g, '<\\/')}</script>`,
    `  <style>#static-floor{max-width:780px;margin:0 auto;padding:28px 20px 8px}` +
    `#static-floor h1{font-size:32px;margin:0 0 8px}#static-floor p{margin:6px 0}</style>`,
    '  <!-- Generated static page for this claimed address — do not',
    '       edit by hand; regenerate with tools/generate-static-pages.mjs. -->',
  ].join('\n');
  html = html.replace('</head>', headExtra + '\n</head>');
  html = html.replace(/<body>\s*/, '<body>\n' + buildFloor(data) + '\n');
  return html;
}

async function fetchPayload(slug) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${FUNCTION}?s=${encodeURIComponent(slug)}`, {
    headers: { apikey: SUPABASE_ANON_KEY },
  });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  return data && data.ok === true && data.name ? data : null;
}

async function main() {
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SLUGS;
  const shell = fs.readFileSync(path.join(REPO, 'site', 'index.html'), 'utf8');
  const made = [];
  for (const slug of slugs) {
    const clean = String(slug).trim().toLowerCase();
    if (!clean) continue;
    const data = await fetchPayload(clean);
    if (!data) {
      console.warn(`skip ${clean}: the ${FUNCTION} function did not resolve this slug`);
      continue;
    }
    const dir = path.join(REPO, clean);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), buildPage(shell, data, clean));
    console.log(`wrote ${clean}/index.html — ${data.name}`);
    made.push(clean);
  }
  /* sitemap: the root page + every slug whose static page
     exists on disk after this run (never a slug that stopped
     resolving without a page to show for it). */
  const today = new Date().toISOString().slice(0, 10);
  const urls = [`${DOMAIN}/`, ...slugs
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => s && fs.existsSync(path.join(REPO, s, 'index.html')))
    .map((s) => `${DOMAIN}/${s}`)];
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`),
    '</urlset>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(REPO, 'sitemap.xml'), sitemap);
  console.log('wrote sitemap.xml — ' + urls.length + ' urls');
  fs.writeFileSync(path.join(REPO, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${DOMAIN}/sitemap.xml\n`);
  console.log('wrote robots.txt');
  if (!made.length) {
    console.error('no static pages generated');
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
