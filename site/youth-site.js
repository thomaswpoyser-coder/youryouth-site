'use strict';
/* =====================================================================
   Your Youth — a youth group's public page (the one renderer).
   Two shells load this file: /site/ (addressed as ?c=<join code>
   or ?s=<slug>) and the root 404.html, which is how a vanity
   address — youryouth.org/<slug> — is served on static hosting:
   Pages answers unknown paths with the 404 shell, and this
   script reads the slug from the path's first segment.
   Either way the youth-site Edge Function answers with ONLY
   what the group's leader chose to publish. The default payload
   is the group's name, logo, join code and brand colours; the
   welcome, meeting time, meeting place and events arrive ONLY
   when the leader opted each one in. No member data, no photos,
   and nothing from chat, questions, prayers or announcements is
   ever in the payload — this page is the invitation, never the
   room. Until that function is deployed, this page says so
   plainly instead of failing.

   Layout (bare but pretty, in Your Youth's own visual language —
   the cream, deep green and gold of youryouth.org, Nunito
   throughout): sticky header, hero (the group's logo in the
   platform's lockup card, its name, its meeting time/place when
   published), the when-&-where card, the leader's welcome on the
   green band, upcoming events, the app card, a closing strip,
   footer. The template supplies ONLY bare functional labels —
   every sentence on the page is the group's own, from its data.
   Sections with no published data hide; there are no gradients
   and no stock or generated images anywhere.

   If the group's leader linked their church (the church's join
   code, saved in settings.site.linkedChurchCode and resolved to
   a name by the function), the footer quietly names the church
   and links to its Your People page.

   Edit-in-place: a signed-in LEADER of this group (the desk
   session carries over — same origin) gets a discreet edit bar
   and can write the welcome, meeting time and place, flip each
   item's publish toggle, set the site address and the church
   link right on this page, saving through the same
   read-merge-write of groups.settings the desks use. Anyone
   else's page contains no edit UI at all. All group-written
   text goes through textContent — nothing is ever parsed as
   HTML.

   Session pickup mirrors the desk exactly: same client config,
   so the same storage key (sb-<project ref>-auth-token) on the
   same origin. The session is acquired three ways — getSession,
   then the auth-state event, then an explicit refresh — because
   a one-shot getSession on a cold client can miss a stored
   session whose access token has expired. Every gate in that
   path logs its reason to the console ([youryouth edit] …):
   a silent no-bar once cost a whole debugging round on the
   church side. A leader can also flip to "View as visitor"
   (?view=visitor) to see the page exactly as the public does,
   with only a slim return strip added; the mode never signs
   anyone out and is ignored entirely for non-leaders.
   ===================================================================== */
const SUPABASE_URL = 'https://wsmqkhljjhaueahqizfr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4eoGwVeVNyN7jn-wmJsUkg_nShqdukt';

const $ = (id) => document.getElementById(id);
function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}
function show(id) {
  // Any finished view — the page itself or a graceful state —
  // settles the shell's self-healing watchdog.
  if (window.__yySettled) window.__yySettled();
  for (const v of ['view-loading', 'view-state', 'view-site']) {
    $(v).classList.toggle('hidden', v !== id);
  }
}
function state(title, text) {
  $('state-title').textContent = title;
  $('state-text').textContent = text;
  show('view-state');
}
function fmtWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return day + ' · ' + time;
}
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function fmtRange(e) {
  let s = fmtWhen(e.startsAt);
  if (e.endsAt) {
    const a = new Date(e.startsAt), b = new Date(e.endsAt);
    if (!isNaN(a.getTime()) && !isNaN(b.getTime())) {
      s += (a.toDateString() === b.toDateString()) ? ' – ' + fmtTime(e.endsAt) : ' – ' + fmtWhen(e.endsAt);
    }
  }
  return s;
}
function firstLine(text) {
  return (text || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
}
function directionsUrl(data) {
  const q = (data.name + ' ' + (data.address || '')).trim();
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

/* The browser tab carries the group's identity too: its logo
   once the page has loaded, the Your Youth mark until then and
   for groups with no logo. */
function setFavicon(url) {
  const link = $('favicon');
  if (!link || !url) return;
  link.href = url;
  const ext = ((url.split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
  const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon' };
  if (types[ext]) link.setAttribute('type', types[ext]);
  else link.removeAttribute('type');
}

/* The group's own colours — the same palette the app wears,
   laid over Your Youth's own tokens. Only plain #rrggbb values
   are applied (the function narrows them too; this is the
   second gate, not the only one). */
function hexOk(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()); }
function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return 'rgb(' + c.join(',') + ')';
}
function applyBrand(brand) {
  if (!brand || typeof brand !== 'object') return;
  const pal = brand.palette;
  if (!pal || typeof pal !== 'object' || !hexOk(pal.brand)) return;
  const root = document.documentElement;
  const set = (k, v) => { if (hexOk(v)) root.style.setProperty(k, v.trim()); };
  set('--green', pal.brand);
  set('--green-deep', pal.deep);
  set('--green-band', pal.deep);
  set('--gold', pal.accent);
  set('--bg', pal.background);
  set('--surface', pal.surface);
  set('--ink', pal.text);
  set('--ink-soft', pal.muted);
  if (hexOk(pal.background) && hexOk(pal.text)) {
    root.style.setProperty('--line', mixHex(pal.background, pal.text, 0.16));
  }
  root.dataset.theme = brand.mode === 'dark' ? 'dark' : 'light';
}

/* ---------------- render ---------------- */
function render(data) {
  document.title = data.name + ' — Your Youth';
  applyBrand(data.brand);
  if (data.logoUrl) setFavicon(data.logoUrl);

  // header
  $('head-name').textContent = data.name;
  if (data.logoUrl) {
    const img = $('head-logo');
    img.src = data.logoUrl;
    img.classList.remove('hidden');
    img.addEventListener('error', () => img.classList.add('hidden'));
  }

  // hero — the group's name and mark; the meeting time's first
  // line rides underneath ONLY when the leader published it
  // (the function omits the fields otherwise). The address is
  // NOT repeated here: it lives once, in the When & where card
  // below, with the directions button (Thomas, Nov 6).
  $('site-name').textContent = data.name;
  const lockup = $('hero-lockup'), lockImg = $('hero-logo');
  lockup.classList.toggle('hidden', !data.logoUrl);
  if (data.logoUrl) {
    lockImg.src = data.logoUrl;
    lockImg.alt = data.name;
    lockImg.addEventListener('error', () => lockup.classList.add('hidden'));
  }
  const mainTime = firstLine(data.serviceTimes);
  const placeLine = firstLine(data.address);
  $('hero-time').textContent = mainTime;
  $('hero-time').classList.toggle('hidden', !mainTime);

  // when & where — renders when either part was published;
  // each part shows only if it was published itself.
  const meetShown = !!(data.serviceTimes || data.address);
  $('meet').classList.toggle('hidden', !meetShown || PAGE.editing);
  if (data.serviceTimes) {
    $('meet-times').textContent = data.serviceTimes;
    $('meet-times').classList.remove('hidden');
  } else {
    $('meet-times').classList.add('hidden');
  }
  if (data.address) {
    $('meet-address').textContent = data.address;
    $('meet-address').classList.remove('hidden');
  } else {
    $('meet-address').classList.add('hidden');
  }
  for (const id of ['directions', 'closing-directions']) {
    const a = $(id);
    a.classList.toggle('hidden', !data.address);
    if (data.address) a.href = directionsUrl(data);
  }

  // welcome — the leader's own words, exactly; present in the
  // payload only when published, and hides when empty.
  $('site-welcome').textContent = data.welcome || '';
  $('sec-welcome').classList.toggle('hidden', !data.welcome || PAGE.editing);

  // upcoming events — future only, soonest first, at most
  // five; present in the payload only when published.
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const events = (Array.isArray(data.events) ? data.events : [])
    .filter((e) => { const d = new Date(e.startsAt); return !isNaN(d.getTime()) && d >= startToday; })
    .slice(0, 5);
  $('sec-events').classList.toggle('hidden', events.length === 0 && !PAGE.editing);
  if (events.length > 0) {
    const box = $('site-events');
    box.replaceChildren();
    for (const e of events) {
      const item = h('div', 'row');
      item.appendChild(h('div', 't', e.title));
      item.appendChild(h('div', 's', fmtRange(e) + (e.location ? ' · ' + e.location : '')));
      if (e.notes) item.appendChild(h('div', 'n', e.notes));
      box.appendChild(item);
    }
  }

  // the app card — the way in; joining is leader-approved
  // inside the app, which the card says plainly.
  $('sec-app').classList.toggle('hidden', !data.joinCode);
  if (data.joinCode) $('site-code').textContent = data.joinCode;

  // closing strip — the same published facts restated, no new
  // words; with nothing published there is nothing to restate.
  $('sec-closing').classList.toggle('hidden', !(data.serviceTimes || data.address));
  if (data.serviceTimes || data.address) {
    const bits = [data.name];
    if (mainTime) bits.push(mainTime);
    if (placeLine) bits.push(placeLine);
    $('closing-text').textContent = bits.join(' — ');
  }

  // footer — and the cross-link: this group's church, resolved
  // to a name by the function, gets one quiet line.
  $('foot-name').textContent = data.name;
  $('foot-name-2').textContent = data.name;
  const churchName = typeof data.linkedChurchName === 'string' ? data.linkedChurchName : '';
  const churchCode = typeof data.linkedChurchCode === 'string' ? data.linkedChurchCode.trim() : '';
  $('church-link-wrap').classList.toggle('hidden', !(churchName && churchCode));
  if (churchName && churchCode) {
    const a = $('church-link');
    a.textContent = churchName;
    a.href = 'https://yourpeople.church/site/?c=' + encodeURIComponent(churchCode);
  }
  const fl = [];
  if (placeLine) fl.push(placeLine);
  if (mainTime) fl.push(mainTime);
  $('foot-line').textContent = fl.join(' · ') + (fl.length ? ' · ' : '') + '© ' + new Date().getFullYear() + ' ' + data.name;

  show('view-site');
}

/* ---------------- edit-in-place (leaders only) ---------------- */
const PAGE = {
  data: null, client: null, user: null, settings: null,
  editing: false, visitor: false,
};
/* Every gate in the edit-bar path logs why it did or didn't
   open — visible in the browser console, invisible on the page. */
function elog() {
  try {
    console.warn.apply(console, ['[youryouth edit]'].concat([].slice.call(arguments)));
  } catch (e) { /* logging never breaks the page */ }
}
function barView(msg, kind) {
  const bar = $('editbar');
  bar.replaceChildren();
  bar.classList.remove('hidden');
  const who = h('span', 'who', 'You lead this group.');
  bar.appendChild(who);
  const btn = h('button', 'btn small', 'Edit page');
  btn.type = 'button';
  btn.addEventListener('click', enterEdit);
  bar.appendChild(btn);
  const vb = h('button', 'btn small plain', 'View as visitor');
  vb.type = 'button';
  vb.addEventListener('click', () => { setVisitorParam(true); enterVisitorMode(); });
  bar.appendChild(vb);
  if (msg) {
    const m = h('span', 'msg ' + (kind || ''), msg);
    bar.appendChild(m);
  }
}
function barEdit(msg, kind) {
  const bar = $('editbar');
  bar.replaceChildren();
  bar.classList.remove('hidden');
  const save = h('button', 'btn small', 'Save');
  save.type = 'button';
  save.addEventListener('click', saveEdit);
  const cancel = h('button', 'btn small plain', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', cancelEdit);
  bar.appendChild(save);
  bar.appendChild(cancel);
  const m = h('span', 'msg ' + (kind || ''), msg || 'Editing this page — nothing is public until its switch is on and you save.');
  bar.appendChild(m);
}
function barMsg(msg, kind) {
  const bar = $('editbar');
  const old = bar.querySelector('.msg');
  if (old) old.remove();
  const m = h('span', 'msg ' + (kind || ''), msg);
  bar.appendChild(m);
}
function slugMsg(msg, kind) {
  const m = $('slug-msg');
  m.textContent = msg || '';
  m.className = kind || '';
}

/* "View as visitor": the leader sees the pure public render.
   Only the return strip is added, and it exists only because a
   leader session was confirmed — the mode rides on the same
   initEdit gate as the edit bar itself, so the ?view=visitor
   parameter alone shows a non-leader nothing at all. It never
   signs out and never touches the desk's session. */
function visitorWanted() {
  try { return new URLSearchParams(window.location.search).get('view') === 'visitor'; }
  catch (e) { return false; }
}
function setVisitorParam(on) {
  try {
    const url = new URL(window.location.href);
    if (on) url.searchParams.set('view', 'visitor');
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', url.toString());
  } catch (e) { /* the mode still holds for this view */ }
}
function enterVisitorMode() {
  if (PAGE.editing) exitEdit();
  PAGE.visitor = true;
  $('editbar').classList.add('hidden');
  const strip = $('visitorstrip');
  strip.replaceChildren();
  strip.appendChild(h('span', null, 'You’re viewing this page as visitors see it.'));
  const back = h('button', 'btn small', 'Back to editing');
  back.type = 'button';
  back.addEventListener('click', exitVisitorMode);
  strip.appendChild(back);
  strip.classList.remove('hidden');
}
function exitVisitorMode() {
  PAGE.visitor = false;
  setVisitorParam(false);
  $('visitorstrip').classList.add('hidden');
  barView();
}

/* Find the desk's session in this browser. The client config is
   identical to the desk's, so the stored session sits under the
   same key on the same origin — but a cold client's one-shot
   getSession can still come back empty when the stored access
   token has expired and its inline refresh fails (the desk tab's
   own refresher is the usual contender). So: getSession, then
   the auth-state event the desk itself routes on, then an
   explicit refresh. Every step logs its outcome. */
async function acquireSession(client) {
  let eventSession = null;
  let sub = null;
  const eventPromise = new Promise((resolve) => {
    try {
      const r = client.auth.onAuthStateChange((_event, session) => {
        if (session && session.user && !eventSession) {
          eventSession = session;
          resolve(session);
        }
      });
      sub = r && r.data ? r.data.subscription : null;
    } catch (e) { resolve(null); }
    setTimeout(() => resolve(eventSession), 1800);
  });
  const finish = (s, via) => {
    try { if (sub) sub.unsubscribe(); } catch (e) { /* already gone */ }
    if (s) elog('session found via ' + via + ' —', s.user.email || s.user.id);
    return s;
  };
  try {
    const res = await client.auth.getSession();
    const s = res && res.data ? res.data.session : null;
    if (s && s.user) return finish(s, 'getSession');
    if (res && res.error) elog('getSession error —', res.error.message || res.error);
  } catch (e) { elog('getSession threw —', (e && e.message) || e); }
  const ev = await eventPromise;
  if (ev) return finish(ev, 'auth state change');
  try { if (sub) sub.unsubscribe(); } catch (e) { /* already gone */ }
  try {
    const res = await client.auth.refreshSession();
    const s = res && res.data ? res.data.session : null;
    if (s && s.user) return finish(s, 'refreshSession');
    if (res && res.error) elog('refreshSession error —', res.error.message || res.error);
  } catch (e) { elog('refreshSession threw —', (e && e.message) || e); }
  return null;
}

/* The leadership read. An error here (a stale token being the
   usual cause) is NOT the same answer as "not a member", so it
   is checked explicitly, retried once after a refresh, and
   logged either way. */
async function readMembership(client, userId, groupId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let mem = null;
    try {
      mem = await client
        .from('memberships')
        .select('group_id, role')
        .eq('user_id', userId)
        .eq('group_id', groupId);
    } catch (e) {
      elog('memberships read threw (attempt ' + (attempt + 1) + ') —', (e && e.message) || e);
      mem = { data: null, error: e };
    }
    if (mem && !mem.error) return { rows: mem.data || [], error: null };
    elog('memberships read failed (attempt ' + (attempt + 1) + ') —',
      (mem && mem.error && (mem.error.message || mem.error.code)) || 'unknown error');
    if (attempt === 0) {
      try { await client.auth.refreshSession(); }
      catch (e) { elog('refresh before retry threw —', (e && e.message) || e); }
    }
  }
  return { rows: [], error: true };
}

async function initEdit(data) {
  PAGE.data = data;
  if (!data.groupId) {
    elog('the youth-site payload carries no groupId — the deployed youth-site function is an older version; edit bar not shown.');
    return;
  }
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    elog('the Supabase client library did not load; edit bar not shown.');
    return;
  }
  let client;
  try {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    elog('createClient threw —', (e && e.message) || e);
    return;
  }
  const session = await acquireSession(client);
  if (!session) {
    elog('no signed-in session found in this browser. The desk session lives under the same origin and storage key, so this means: signed out here, a different browser/profile, or the stored session could not be refreshed. Edit bar not shown; the page is unaffected.');
    return;
  }
  PAGE.client = client;
  PAGE.user = session.user;
  const mem = await readMembership(client, session.user.id, data.groupId);
  if (mem.error) {
    elog('membership read failed after a retry; edit bar not shown.');
    return;
  }
  if (!mem.rows.some((r) => r.role === 'leader')) {
    elog('signed in as', session.user.email || session.user.id,
      '— membership rows for this group:', mem.rows.length,
      '(' + mem.rows.map((r) => r.role).join(', ') + ') — not a leader; edit bar not shown.');
    return;
  }
  try {
    const grp = await client.from('groups').select('settings').eq('id', data.groupId).maybeSingle();
    if (grp && grp.error) elog('group settings read failed —', grp.error.message || grp.error.code || 'unknown');
    PAGE.settings = grp && grp.data && grp.data.settings && typeof grp.data.settings === 'object'
      ? grp.data.settings : {};
  } catch (e) {
    elog('group settings read threw —', (e && e.message) || e);
    PAGE.settings = {};
  }
  if (visitorWanted()) {
    elog('leader confirmed; ?view=visitor — showing the visitor view strip.');
    enterVisitorMode();
  } else {
    elog('leader confirmed; showing the edit bar.');
    barView();
  }
}

/* The editor reads and writes settings.site RAW — including
   text the leader has written but not published yet, which the
   public payload rightly omits. */
function siteSettings() {
  const s = PAGE.settings && typeof PAGE.settings === 'object' ? PAGE.settings : {};
  return s.site && typeof s.site === 'object' ? s.site : {};
}

/* Site-address shape rules, mirroring the youth-site function's
   own copy and the church desk's — keep them in step. The
   function has the final word on availability (its ?check=
   mode); this side validates the shape first. */
const SLUG_RESERVED = new Set([
  'desk', 'site', 'app', 'api', 'www', 'mail', 'help', 'support',
  'admin', 'yourpeople', 'youryouth', 'login', 'join', 'c',
  'about', 'account', 'assets', 'blog', 'church', 'churches',
  'contact', 'cname', 'dashboard', 'find', 'groups', 'home',
  'index', 'new', 'news', 'pricing', 'privacy', 'robots',
  'search', 'settings', 'signin', 'signup', 'sitemap', 'static',
  'terms', 'your-people', 'your-youth', '404', 'centreville',
]);
function slugProblemText(slug) {
  if (slug.length < 3) return 'That’s a bit short — addresses run 3 to 40 characters.';
  if (slug.length > 40) return 'That’s too long — addresses run 3 to 40 characters.';
  if (/[^a-z0-9-]/.test(slug)) return 'Letters, numbers and hyphens only — no spaces or symbols.';
  if (slug.startsWith('-') || slug.endsWith('-')) return 'The address can’t start or end with a hyphen.';
  if (SLUG_RESERVED.has(slug)) return 'That word belongs to Your Youth itself — try adding your town or your group’s name.';
  return null;
}
function suggestSlug(name) {
  // The domain already says "youth", so the suggestion drops the
  // generic words and keeps the name's own: SoulFire Youth
  // suggests soulfire.
  const words = (name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const drop = new Set(['youth', 'group', 'the', 'of']);
  const kept = words.filter((w) => !drop.has(w));
  const joined = (kept.length ? kept : words).join('');
  return joined.length >= 3 ? joined.slice(0, 40) : '';
}

function enterEdit() {
  const data = PAGE.data;
  if (!data) return;
  const site = siteSettings();
  PAGE.editing = true;
  document.body.classList.add('editing');
  // when & where: the form replaces the card, toggles included.
  $('ed-times').value = typeof site.serviceTimes === 'string' ? site.serviceTimes : '';
  $('ed-address').value = typeof site.address === 'string' ? site.address : '';
  $('tg-time').checked = site.showMeetingTime === true;
  $('tg-place').checked = site.showPlace === true;
  $('meet').classList.remove('hidden');
  $('meet-view').classList.add('hidden');
  $('meet-edit').classList.remove('hidden');
  // welcome: the form replaces the band.
  $('ed-welcome').value = typeof site.welcome === 'string' ? site.welcome : '';
  $('tg-welcome').checked = site.showWelcome === true;
  $('welcome-empty-note').classList.toggle('hidden', !!$('ed-welcome').value);
  $('sec-welcome').classList.remove('hidden');
  $('welcome-view').classList.add('hidden');
  $('welcome-edit').classList.remove('hidden');
  // events: the list stays as it is; the toggle joins it.
  $('tg-events').checked = site.showEvents === true;
  $('sec-events').classList.remove('hidden');
  $('events-edit').classList.remove('hidden');
  // page choices: address + church link.
  const slug = typeof site.slug === 'string' ? site.slug : '';
  $('ed-slug').value = slug || suggestSlug(data.name);
  slugMsg(slug ? '' : 'This suggestion is only a start — saving claims it, if it’s free.', '');
  $('ed-church-code').value = typeof site.linkedChurchCode === 'string' ? site.linkedChurchCode : '';
  $('sec-pageset').classList.remove('hidden');
  barEdit();
}

function exitEdit() {
  PAGE.editing = false;
  document.body.classList.remove('editing');
  $('meet-view').classList.remove('hidden');
  $('meet-edit').classList.add('hidden');
  $('welcome-view').classList.remove('hidden');
  $('welcome-edit').classList.add('hidden');
  $('events-edit').classList.add('hidden');
  $('sec-pageset').classList.add('hidden');
}

function cancelEdit() {
  exitEdit();
  render(PAGE.data);
  barView();
}

async function readFreshSettings() {
  const grp = await PAGE.client.from('groups').select('settings').eq('id', PAGE.data.groupId).maybeSingle();
  if (grp && grp.data && grp.data.settings && typeof grp.data.settings === 'object') {
    return grp.data.settings;
  }
  return PAGE.settings || {};
}

/* The same read-merge-write the desks perform: settings.site
   fields replaced, everything else in settings (and every
   other site key this editor doesn't own) preserved. A slug of
   null DELETES settings.site.slug — the group keeps its ?c=
   address either way. */
async function writeSettings(siteFields) {
  const base = await readFreshSettings();
  const site = { ...(base.site && typeof base.site === 'object' ? base.site : {}), ...siteFields };
  if (siteFields.slug === null) delete site.slug;
  const next = { ...base, site };
  const { error } = await PAGE.client.from('groups').update({ settings: next }).eq('id', PAGE.data.groupId);
  if (error) return false;
  PAGE.settings = next;
  return true;
}

async function saveEdit() {
  const currentSlug = typeof siteSettings().slug === 'string' ? siteSettings().slug : '';
  const slug = $('ed-slug').value.trim().toLowerCase();
  $('ed-slug').value = slug;
  slugMsg('', '');
  let slugField = currentSlug;
  if (slug !== currentSlug) {
    if (!slug) {
      slugField = null; // clearing the box removes the address
    } else {
      const problem = slugProblemText(slug);
      if (problem) { slugMsg(problem, 'err'); barMsg('That site address needs a fix — see under Site address.', 'err'); return; }
      barMsg('Checking that address…');
      let verdict = null;
      try {
        const resp = await fetch(
          SUPABASE_URL + '/functions/v1/youth-site?check=' + encodeURIComponent(slug) +
          '&for=' + encodeURIComponent(PAGE.data.groupId),
          { headers: { 'apikey': SUPABASE_ANON_KEY } },
        );
        verdict = await resp.json();
      } catch (e) { verdict = null; }
      if (!verdict || typeof verdict.available !== 'boolean') {
        slugMsg('The address checker isn’t answering just now, so nothing was saved. Try again in a moment.', 'err');
        barMsg('Nothing was saved — the address checker isn’t answering.', 'err');
        return;
      }
      if (!verdict.available) {
        slugMsg(verdict.reason === 'taken'
          ? 'That address is taken — try another.'
          : (slugProblemText(slug) || 'That address can’t be used — try another.'), 'err');
        barMsg('Nothing was saved — that address is taken.', 'err');
        return;
      }
      slugField = slug;
    }
  }
  barMsg('Saving…');
  const fields = {
    welcome: $('ed-welcome').value.trim(),
    serviceTimes: $('ed-times').value.trim(),
    address: $('ed-address').value.trim(),
    showWelcome: $('tg-welcome').checked,
    showMeetingTime: $('tg-time').checked,
    showPlace: $('tg-place').checked,
    showEvents: $('tg-events').checked,
    linkedChurchCode: $('ed-church-code').value.trim(),
    slug: slugField,
  };
  const ok = await writeSettings(fields);
  if (!ok) {
    barMsg('Those changes did not save. Check your connection and try again.', 'err');
    return;
  }
  exitEdit();
  // Re-read through the door itself, so what renders next is
  // exactly what the public gets — opt-ins applied by the
  // function, not by this page's say-so.
  const look = resolveLookup();
  const fresh = look ? await fetchPayload(look) : null;
  if (fresh) {
    PAGE.data = fresh;
    render(fresh);
  } else {
    render(PAGE.data);
  }
  barView('Saved — this page shows it now.', 'ok');
}

/* ---------------- which group, and load ---------------- */
function resolveLookup() {
  const q = new URLSearchParams(window.location.search);
  const code = (q.get('c') || '').trim();
  if (code) return { kind: 'code', query: 'c=' + encodeURIComponent(code) };
  const slugParam = (q.get('s') || '').trim().toLowerCase();
  if (slugParam) return { kind: 'slug', query: 's=' + encodeURIComponent(slugParam) };
  const seg = window.location.pathname.split('/').filter(Boolean)[0] || '';
  let first = seg;
  try { first = decodeURIComponent(seg); } catch (e) { /* keep the raw segment */ }
  first = first.trim().toLowerCase();
  if (first && first !== 'site') return { kind: 'slug', query: 's=' + encodeURIComponent(first) };
  return null;
}

/* One fetch of the public payload. Returns the data, or null
   with the right graceful state already shown. */
async function fetchPayload(look) {
  let resp;
  try {
    resp = await fetch(SUPABASE_URL + '/functions/v1/youth-site?' + look.query, {
      headers: { 'apikey': SUPABASE_ANON_KEY },
    });
  } catch (e) {
    state('Not switched on yet', 'This group’s page isn’t switched on yet — check back soon.');
    return null;
  }
  if (resp.status === 404) {
    let body = null;
    try { body = await resp.json(); } catch (e) { /* non-JSON */ }
    if (body && body.error === 'not-found') {
      if (look.kind === 'slug') {
        state('No group page at this address', 'There’s no youth group page at this address. Check the spelling and try again — or start at youryouth.org to find your group.');
      } else {
        state('Group not found', 'We couldn’t find a youth group with that code. Check the code and try again — or ask a leader for the link.');
      }
    } else {
      state('Not switched on yet', 'This group’s page isn’t switched on yet — check back soon.');
    }
    return null;
  }
  if (!resp.ok) {
    state('Not switched on yet', 'This group’s page isn’t switched on yet — check back soon.');
    return null;
  }
  let data = null;
  try { data = await resp.json(); } catch (e) { /* non-JSON */ }
  if (!data || data.ok !== true || !data.name) {
    state('Not switched on yet', 'This group’s page isn’t switched on yet — check back soon.');
    return null;
  }
  return data;
}

async function load() {
  const look = resolveLookup();
  if (!look) {
    state('Find your group', 'This page needs a group’s join code — ask a leader for the link, or start at youryouth.org.');
    return;
  }
  const data = await fetchPayload(look);
  if (!data) return;
  render(data);
  initEdit(data);
}
load();
