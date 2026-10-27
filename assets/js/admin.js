// Panel del salón Henko. Entra con el usuario de la base de EBM y trabaja directamente
// con sus tablas; las reglas de la base deciden qué ve cada una (la dueña todo, cada
// empleada solo su agenda y sus clientas).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const H = window.HENKO;
const db = createClient(H.supabaseUrl, H.supabaseKey);
const CID = H.clientId;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const COLORS = ['#8E5CC9', '#D9A400', '#2FA36B', '#1483DC', '#E07A1F', '#B8325A'];

let me = null, owner = false;
let calendars = [], team = [], services = [], coupons = [];

// ---------- Utilidades de hora (siempre hora de España)
const madridParts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
}).formatToParts(d).map((p) => [p.type, p.value]));
const isoDay = (d) => { const p = madridParts(d); return `${p.year}-${p.month}-${p.day}`; };
const hhmm = (d) => { const p = madridParts(d); return `${p.hour}:${p.minute}`; };
const minsOf = (d) => { const p = madridParts(d); return +p.hour * 60 + +p.minute; };
function madridAt(day, time) {
  const [y, m, d] = day.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const off = (t) => { const p = madridParts(new Date(t)); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t; };
  let t = wall - off(wall); t = wall - off(t);
  return new Date(t);
}
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const weekday = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7; };
const longDay = (iso) => new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const phoneFmt = (p) => (p || '').replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');
const waLink = (phone, text) => `https://wa.me/${phone?.startsWith('+') ? phone.slice(1) : `34${phone}`}?text=${encodeURIComponent(text)}`;

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
}
function fail(err) { console.error(err); toast(err?.message?.includes('row-level') ? 'No tienes permiso para eso.' : (err?.message || 'Algo ha fallado.')); }

// ---------- Ventana modal
const modal = $('#modal'), card = $('#modalCard');
function openModal(html, onSave) {
  card.innerHTML = html;
  if (!modal.open) modal.showModal();
  card.onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    if (btn?.value === 'cancel') return modal.close();
    if (!onSave) return modal.close();
    if (btn) btn.disabled = true;
    try { if ((await onSave(new FormData(card), btn?.value)) !== false) modal.close(); }
    catch (err) { fail(err); }
    finally { if (btn) btn.disabled = false; }
  };
}

// ---------- Entrada
async function start() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return showLogin();
  const { data: prof } = await db.from('profiles').select('role, client_id, agenda_scope, full_name, email').eq('id', session.user.id).maybeSingle();
  if (!prof || (prof.role !== 'admin' && prof.client_id !== CID)) {
    await db.auth.signOut();
    return showLogin('Este usuario no es de Henko.');
  }
  me = { ...prof, id: session.user.id };
  owner = prof.role === 'admin' || prof.agenda_scope !== 'own';
  $('#who').textContent = prof.full_name || prof.email || '';
  $$('[data-owner]').forEach((el) => (el.hidden = !owner));
  $('#login').hidden = true; $('#app').hidden = false;
  await loadBase();
  showTab(location.hash.slice(1) || 'agenda');
}
function showLogin(msg) {
  $('#app').hidden = true; $('#login').hidden = false;
  const e = $('#loginError'); e.hidden = !msg; e.textContent = msg || '';
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, btn = $('button', f);
  btn.disabled = true;
  const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  btn.disabled = false;
  if (error) return showLogin('Correo o contraseña incorrectos.');
  start();
});
$('#logout').onclick = async () => { await db.auth.signOut(); location.reload(); };

async function loadBase() {
  const [c, t, s] = await Promise.all([
    db.from('calendars').select('id, name, color, member_id, booking_hours, booking_notice_minutes, booking_enabled, active').eq('client_id', CID).eq('active', true).not('member_id', 'is', null).order('created_at'),
    db.from('team_members').select('id, name, job_title, bio, photo_url, show_on_web, active, sort, profile_id').eq('client_id', CID).order('sort').order('name'),
    db.from('services').select('*').eq('client_id', CID).order('sort').order('name'),
  ]);
  coupons = (await db.from('coupons').select('*').eq('client_id', CID).order('created_at')).data || [];
  team = (t.data || []).filter((m) => !m.name.startsWith('[prueba'));
  calendars = (c.data || []).filter((cal) => team.some((m) => m.id === cal.member_id && m.active));
  services = (s.data || []).filter((x) => !x.name.startsWith('[prueba'));
}
const memberOf = (cal) => team.find((m) => m.id === cal.member_id);
const calOf = (memberId) => calendars.find((c) => c.member_id === memberId);

// ---------- Pestañas
function showTab(name) {
  if (!$(`[data-view="${name}"]`) || $(`.tabs [data-tab="${name}"]`)?.hidden) name = 'agenda';
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('[data-view]').forEach((v) => (v.hidden = v.dataset.view !== name));
  history.replaceState(null, '', `#${name}`);
  ({ agenda: renderAgenda, clientes: renderCustomers, numeros: renderNumbers, cupones: renderCoupons, servicios: renderServices, equipo: renderTeam, web: renderWeb, ajustes: renderSettings })[name]();
}
$$('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// =====================================================================
// AGENDA
// =====================================================================
let day = isoDay(new Date()), mode = 'dia';
$('#dPrev').onclick = () => { day = addDays(day, -1); renderAgenda(); };
$('#dNext').onclick = () => { day = addDays(day, 1); renderAgenda(); };
$('#dToday').onclick = () => { day = isoDay(new Date()); renderAgenda(); };
$('#dPick').onchange = (e) => { if (e.target.value) { day = e.target.value; renderAgenda(); } };
$$('#aMode button').forEach((b) => (b.onclick = () => { mode = b.dataset.mode; $$('#aMode button').forEach((x) => x.classList.toggle('on', x === b)); renderAgenda(); }));
$('#aNew').onclick = () => eventModal({ day, time: '10:00', calendar_id: calendars[0]?.id });
setInterval(() => { if (!$('[data-view="agenda"]').hidden && !modal.open) renderAgenda(true); }, 60_000);

async function eventsBetween(fromDay, toDay) {
  const { data, error } = await db.from('calendar_events')
    .select('id, calendar_id, title, description, starts_at, ends_at, all_day, source, service_id, customer_id, price_eur, coupon_id, discount_eur, no_show, customers(name, phone)')
    .eq('client_id', CID).in('calendar_id', calendars.map((c) => c.id))
    .lt('starts_at', madridAt(addDays(toDay, 1), '00:00').toISOString()).gt('ends_at', madridAt(fromDay, '00:00').toISOString())
    .order('starts_at');
  if (error) throw error;
  return data || [];
}

async function renderAgenda(quiet) {
  $('#dLabel').textContent = longDay(day).replace(/^\w/, (c) => c.toUpperCase());
  $('#dPick').value = day;
  $('#agenda').hidden = mode !== 'dia'; $('#agendaList').hidden = mode === 'dia';
  if (!calendars.length) { $('#agenda').innerHTML = '<p class="muted" style="padding:20px">Todavía no hay agendas. Añade a alguien en «Equipo».</p>'; return; }
  try {
    if (mode === 'dia') drawDay(await eventsBetween(day, day));
    else drawList(await eventsBetween(day, addDays(day, 6)));
    if (!quiet) drawStats();
    drawWaitlist();
  } catch (err) { fail(err); }
}

function drawDay(events) {
  const wd = String(weekday(day));
  const ranges = (cal) => (cal.booking_hours?.[wd] || []).map((r) => r.replace(/\s/g, '').split('-').map(toMin));
  let start = 9 * 60, end = 20 * 60;
  calendars.forEach((c) => ranges(c).forEach(([a, b]) => { start = Math.min(start, a); end = Math.max(end, b); }));
  events.forEach((e) => { if (!e.all_day && isoDay(new Date(e.starts_at)) === day) { start = Math.min(start, minsOf(new Date(e.starts_at))); end = Math.max(end, minsOf(new Date(e.ends_at)) || 24 * 60); } });
  start = Math.floor(start / 60) * 60; end = Math.min(24 * 60, Math.ceil(end / 60) * 60);
  const hourPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour')) || 64;
  const px = (m) => ((m - start) / 60) * hourPx;
  const cols = `56px repeat(${calendars.length}, minmax(150px, 1fr))`;

  const head = `<div class="ag-head" style="grid-template-columns:${cols}"><div style="border:0"></div>${calendars.map((c) => {
    const m = memberOf(c), n = events.filter((e) => e.calendar_id === c.id && !e.title.startsWith('Bloqueado')).length;
    return `<div><span style="color:${esc(c.color)}">●</span> ${esc(m?.name || c.name)}<small>${n} ${n === 1 ? 'cita' : 'citas'}</small></div>`;
  }).join('')}</div>`;
  let hours = '';
  for (let m = start; m < end; m += 60) hours += `<div>${fmtMin(m)}</div>`;
  const body = calendars.map((c) => {
    const open = ranges(c).sort((a, b) => a[0] - b[0]);
    const off = []; let cur = start;
    open.forEach(([a, b]) => { if (a > cur) off.push([cur, a]); cur = Math.max(cur, b); });
    if (cur < end) off.push([cur, end]);
    const evs = events.filter((e) => e.calendar_id === c.id && !e.all_day);
    // Si dos citas se pisan, se ponen una al lado de la otra.
    const lanes = [];
    const placed = evs.map((e) => {
      const a = Math.max(start, isoDay(new Date(e.starts_at)) < day ? start : minsOf(new Date(e.starts_at)));
      const b = isoDay(new Date(e.ends_at)) > day ? end : Math.max(a + 15, minsOf(new Date(e.ends_at)));
      let lane = lanes.findIndex((l) => l <= a); if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = b; return { e, a, b, lane };
    });
    const n = Math.max(1, lanes.length);
    return `<div class="ag-col" data-cal="${c.id}" style="height:${px(end)}px">
      ${off.map(([a, b]) => `<div class="ag-off" style="top:${px(a)}px;height:${px(b) - px(a)}px"></div>`).join('')}
      ${placed.map(({ e, a, b, lane }) => {
        const block = e.title.startsWith('Bloqueado');
        const who = e.customers?.name || e.title.split(' · ').slice(1).join(' · ');
        const what = block ? e.title : (services.find((s) => s.id === e.service_id)?.name || e.title.split(' · ')[0]);
        return `<div class="ev ${block ? 'block' : e.source === 'web' ? 'web' : ''}${e.no_show ? ' noshow' : ''}" data-ev="${e.id}" style="top:${px(a)}px;height:${Math.max(22, px(b) - px(a) - 2)}px;left:calc(${(lane / n) * 100}% + 4px);right:auto;width:calc(${100 / n}% - 8px);border-left-color:${block ? '' : esc(c.color)}">
          ${e.no_show ? '<span class="tag">No vino</span>' : e.coupon_id ? '<span class="tag">Cupón</span>' : e.source === 'web' ? '<span class="tag">Web</span>' : ''}<b>${fmtMin(a)} ${esc(block ? what : who)}</b>${block ? '' : esc(what)}</div>`;
      }).join('')}
    </div>`;
  }).join('');
  let nowLine = '';
  if (day === isoDay(new Date())) { const m = minsOf(new Date()); if (m >= start && m <= end) nowLine = `<div class="now-line" style="top:${px(m)}px;left:56px"></div>`; }
  const allDay = events.filter((e) => e.all_day);
  $('#agenda').innerHTML = head + (allDay.length ? `<div class="muted" style="padding:8px 14px">Todo el día: ${allDay.map((e) => esc(e.title)).join(' · ')}</div>` : '') +
    `<div class="ag-body" style="grid-template-columns:${cols}"><div class="ag-hours">${hours}</div>${body}${nowLine}</div>`;

  $$('#agenda .ev').forEach((el) => (el.onclick = (ev) => { ev.stopPropagation(); eventModal(events.find((e) => e.id === el.dataset.ev)); }));
  $$('#agenda .ag-col').forEach((col) => (col.onclick = (ev) => {
    const m = start + Math.floor(((ev.offsetY / hourPx) * 60) / 15) * 15;
    eventModal({ day, time: fmtMin(m), calendar_id: col.dataset.cal });
  }));
  if (day === isoDay(new Date())) { const box = $('#agenda'); box.scrollTop = Math.max(0, px(minsOf(new Date())) - 120); }
}

function drawList(events) {
  const byDay = {};
  events.forEach((e) => { (byDay[isoDay(new Date(e.starts_at))] ||= []).push(e); });
  const days = Array.from({ length: 7 }, (_, i) => addDays(day, i));
  $('#agendaList').innerHTML = days.map((d) => `<div class="day"><h3>${esc(longDay(d))}</h3>${(byDay[d] || []).map((e) => {
    const cal = calendars.find((c) => c.id === e.calendar_id);
    return `<div class="row-item" data-ev="${e.id}"><span class="t">${hhmm(new Date(e.starts_at))}</span>
      <div>${esc(e.customers?.name || e.title)}<small>${esc(services.find((s) => s.id === e.service_id)?.name || (e.customers ? e.title.split(' · ')[0] : ''))}</small></div>
      <span class="pill" style="border-left:4px solid ${esc(cal?.color || '#ccc')}">${esc(memberOf(cal || {})?.name?.split(' ')[0] || '')}</span></div>`;
  }).join('') || '<p class="muted">Sin citas.</p>'}</div>`).join('');
  $$('#agendaList [data-ev]').forEach((el) => (el.onclick = () => eventModal(events.find((e) => e.id === el.dataset.ev))));
}

async function drawStats() {
  const today = isoDay(new Date());
  const monthStart = `${today.slice(0, 8)}01`;
  try {
    const [t, w, web, cus] = await Promise.all([
      db.from('calendar_events').select('id', { count: 'exact', head: true }).eq('client_id', CID).not('title', 'like', 'Bloqueado%')
        .gte('starts_at', madridAt(today, '00:00').toISOString()).lt('starts_at', madridAt(addDays(today, 1), '00:00').toISOString()),
      db.from('calendar_events').select('id', { count: 'exact', head: true }).eq('client_id', CID).not('title', 'like', 'Bloqueado%')
        .gte('starts_at', madridAt(today, '00:00').toISOString()).lt('starts_at', madridAt(addDays(today, 7), '00:00').toISOString()),
      db.from('calendar_events').select('id', { count: 'exact', head: true }).eq('client_id', CID).eq('source', 'web').gte('created_at', madridAt(monthStart, '00:00').toISOString()),
      db.from('customers').select('id', { count: 'exact', head: true }).eq('client_id', CID).gte('created_at', madridAt(monthStart, '00:00').toISOString()),
    ]);
    $('#aStats').innerHTML = `<div class="stat"><b>${t.count ?? 0}</b>citas hoy</div><div class="stat"><b>${w.count ?? 0}</b>próximos 7 días</div>
      <div class="stat"><b>${web.count ?? 0}</b>reservas web este mes</div><div class="stat"><b>${cus.count ?? 0}</b>clientas nuevas este mes</div>`;
  } catch { /* sin resumen */ }
}

// ---------- Lista de espera del día que se está viendo
async function drawWaitlist() {
  const box = $('#aWait');
  const { data } = await db.from('waitlist').select('id, name, phone, email, notified_at, service_id, services(name)')
    .eq('client_id', CID).eq('day', day).order('created_at');
  const list = (data || []).filter((w) => !w.name.startsWith('[prueba'));
  box.hidden = !list.length;
  if (!list.length) return;
  box.innerHTML = `<b>Lista de espera del ${esc(longDay(day))}</b> · si se libera un hueco, les llega un correo solo. También puedes escribirles tú:
    <ul>${list.map((w) => `<li><span>${esc(w.name)} <span class="muted">${esc(phoneFmt(w.phone))}${w.services?.name ? ` · ${esc(w.services.name)}` : ''}${w.notified_at ? ' · ya avisada' : ''}</span></span>
      <span><a class="btn line" target="_blank" href="${waLink(w.phone, `¡Hola ${w.name.split(' ')[0]}! Te escribimos de Henko: se nos ha quedado un hueco libre el ${longDay(day)}. ¿Te viene bien?`)}">WhatsApp</a>
      <button class="btn" data-wdel="${w.id}" title="Quitar de la lista">×</button></span></li>`).join('')}</ul>`;
  $$('[data-wdel]', box).forEach((b) => (b.onclick = async () => { await db.from('waitlist').delete().eq('id', b.dataset.wdel); drawWaitlist(); }));
}

// ---------- Cita: crear, cambiar, anular o bloquear un hueco
async function eventModal(e) {
  const isNew = !e.id;
  const block = !isNew && e.title.startsWith('Bloqueado');
  const start = isNew ? null : new Date(e.starts_at);
  const dayV = isNew ? e.day : isoDay(start), timeV = isNew ? e.time : hhmm(start);
  const dur = isNew ? 45 : Math.round((new Date(e.ends_at) - start) / 60000);
  let cust = null;
  if (e.customer_id) cust = (await db.from('customers').select('id, name, phone, email, preferred_member_id').eq('id', e.customer_id).maybeSingle()).data;
  // Citas sin ficha de clienta (del chat o importadas): nombre y teléfono salen del título y las notas.
  if (!cust && !isNew && !block) {
    const phone = ((e.description || '').match(/Teléfono: (\+?\d+)/) || e.title.match(/(\d{9})/) || [])[1] || '';
    cust = { name: e.title.split(' · ').slice(1).join(' · ').replace(/\s*·?\s*\+?\d{9,}.*$/, ''), phone };
  }
  const notes = (e.description || '').split('\n').filter((l) => !/^(Teléfono|Correo): /.test(l) && l !== 'Reservada desde la web.').map((l) => l.replace(/^Notas: /, '')).join('\n');
  const svcOpts = services.filter((s) => s.active).map((s) => `<option value="${s.id}" data-d="${s.duration_minutes}" ${s.id === e.service_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  openModal(`
    <h2>${isNew ? 'Nueva cita' : block ? 'Hueco bloqueado' : 'Cita'}${!isNew && e.source === 'web' ? ' <span class="pill">Reservada en la web</span>' : ''}</h2>
    <label class="field check"><input type="checkbox" name="block" ${block ? 'checked' : ''}><span>Es un bloqueo (descanso, médico, vacaciones…)</span></label>
    <div class="grid2">
      <label class="field"><span>Agenda</span><select name="calendar_id">${calendars.map((c) => `<option value="${c.id}" ${c.id === e.calendar_id ? 'selected' : ''}>${esc(memberOf(c)?.name || c.name)}</option>`).join('')}</select></label>
      <label class="field js-svc"><span>Servicio</span><select name="service_id"><option value="">—</option>${svcOpts}</select></label>
    </div>
    <div class="grid3">
      <label class="field"><span>Día</span><input type="date" name="day" value="${dayV}" required></label>
      <label class="field"><span>Hora</span><input type="time" name="time" value="${timeV}" step="900" required></label>
      <label class="field"><span>Minutos</span><input type="number" name="minutes" value="${dur}" min="5" max="600" step="5" required></label>
    </div>
    <div class="js-cust">
      <div class="grid2">
        <label class="field"><span>Clienta</span><input name="cname" value="${esc(cust?.name || '')}" autocomplete="off" placeholder="Nombre"></label>
        <label class="field"><span>Teléfono</span><input name="cphone" value="${esc(cust?.phone || '')}" inputmode="tel" placeholder="600 000 000"></label>
      </div>
      <ul class="suggest" id="suggest" hidden></ul>
      <input type="hidden" name="customer_id" value="${esc(cust?.id || '')}">
    </div>
    <label class="field"><span>Notas</span><textarea name="notes" rows="2">${esc(block ? e.title.replace(/^Bloqueado ?·? ?/, '') : notes)}</textarea></label>
    <label class="field js-svc"><span>Cupón de descuento</span><select name="coupon_id"><option value="">Sin cupón</option>${coupons.filter((k) => k.active || k.id === e.coupon_id).map((k) => `<option value="${k.id}" ${k.id === e.coupon_id ? 'selected' : ''}>${esc(k.code)} · ${esc(couponText(k))}</option>`).join('')}</select></label>
    ${!isNew && !block && new Date(e.starts_at) < new Date() ? `<label class="field check"><input type="checkbox" name="no_show" ${e.no_show ? 'checked' : ''}><span>No vino a la cita (no cuenta para pedirle opinión ni en las estadísticas de servicios hechos)</span></label>` : ''}
    <div class="modal-actions">
      ${isNew ? '' : '<button class="btn danger" value="delete">Anular</button>'}
      ${cust?.phone ? `<a class="btn line" target="_blank" href="${waLink(cust.phone, `¡Hola ${cust.name.split(' ')[0]}! Te escribimos de Henko por tu cita del ${longDay(dayV)} a las ${timeV}.`)}">WhatsApp</a>` : ''}
      <div class="right"><button class="btn" value="cancel" formnovalidate>Cerrar</button><button class="btn solid" value="save">Guardar</button></div>
    </div>`, async (fd, action) => {
    if (action === 'delete') {
      if (!confirm('¿Anular esta cita? Se borra de la agenda.')) return false;
      const { error } = await db.from('calendar_events').delete().eq('id', e.id);
      if (error) throw error;
      toast('Cita anulada'); renderAgenda(); return;
    }
    const isBlock = fd.get('block') === 'on';
    const st = madridAt(fd.get('day'), fd.get('time'));
    const en = new Date(st.getTime() + Number(fd.get('minutes')) * 60000);
    const calId = fd.get('calendar_id');
    // Que no pise otra cita de la misma persona
    const { data: clash } = await db.from('calendar_events').select('id, title').eq('calendar_id', calId)
      .lt('starts_at', en.toISOString()).gt('ends_at', st.toISOString());
    const other = (clash || []).filter((c) => c.id !== e.id);
    if (other.length && !confirm(`A esa hora ya hay: ${other.map((c) => c.title).join(', ')}. ¿Guardar igualmente?`)) return false;
    let customerId = fd.get('customer_id') || null, cname = fd.get('cname').trim(), cphone = fd.get('cphone').replace(/[^\d+]/g, '');
    if (!isBlock && !customerId && cname) {
      if (cphone) customerId = (await db.from('customers').select('id').eq('client_id', CID).eq('phone', cphone).maybeSingle()).data?.id || null;
      if (!customerId) {
        const { data, error } = await db.from('customers').insert({ client_id: CID, name: cname, phone: cphone || null }).select('id').single();
        if (error) throw error; customerId = data.id;
      }
    }
    const svc = services.find((s) => s.id === fd.get('service_id'));
    const note = fd.get('notes').trim();
    const row = {
      calendar_id: calId, client_id: CID, starts_at: st.toISOString(), ends_at: en.toISOString(),
      title: isBlock ? `Bloqueado${note ? ` · ${note}` : ''}` : [svc?.name || 'Cita', cname].filter(Boolean).join(' · '),
      description: isBlock ? null : [cphone && `Teléfono: ${cphone}`, note && `Notas: ${note}`].filter(Boolean).join('\n') || null,
      service_id: isBlock ? null : svc?.id || null, customer_id: isBlock ? null : customerId, price_eur: isBlock ? null : svc?.price_eur ?? null,
    };
    const cp = isBlock ? null : coupons.find((k) => k.id === fd.get('coupon_id'));
    row.coupon_id = cp?.id || null;
    row.discount_eur = cp && row.price_eur != null ? Math.min(row.price_eur, cp.kind === 'percent' ? Math.round(row.price_eur * cp.value) / 100 : Number(cp.value)) : null;
    if (fd.has('no_show')) row.no_show = fd.get('no_show') === 'on';
    const { error } = isNew ? await db.from('calendar_events').insert({ ...row, source: 'panel' }) : await db.from('calendar_events').update(row).eq('id', e.id);
    if (error) throw error;
    if (customerId) await db.from('customers').update({ last_booking_at: new Date().toISOString() }).eq('id', customerId);
    toast(isNew ? 'Cita guardada' : 'Cambios guardados'); day = fd.get('day'); renderAgenda();
  });

  // Rellenar duración al elegir servicio y buscar clientas al escribir
  const f = card;
  f.service_id.onchange = () => { const o = f.service_id.selectedOptions[0]; if (o?.dataset.d) f.minutes.value = o.dataset.d; };
  const toggleBlock = () => { const b = f.block.checked; $('.js-cust', f).hidden = b; $('.js-svc', f).hidden = b; };
  f.block.onchange = toggleBlock; toggleBlock();
  let timer;
  const suggest = $('#suggest', f);
  const lookup = () => {
    clearTimeout(timer);
    f.customer_id.value = '';
    const q = (f.cname.value || f.cphone.value).trim();
    if (q.length < 2) { suggest.hidden = true; return; }
    timer = setTimeout(async () => {
      const digits = q.replace(/\D/g, '');
      let req = db.from('customers').select('id, name, phone').eq('client_id', CID).limit(6);
      req = digits.length >= 3 ? req.like('phone', `%${digits}%`) : req.ilike('name', `%${q}%`);
      const { data } = await req;
      suggest.hidden = !data?.length;
      suggest.innerHTML = (data || []).map((c) => `<li data-id="${c.id}" data-n="${esc(c.name)}" data-p="${esc(c.phone || '')}">${esc(c.name)} <span class="muted">${esc(phoneFmt(c.phone))}</span></li>`).join('');
      $$('li', suggest).forEach((li) => (li.onclick = () => { f.cname.value = li.dataset.n; f.cphone.value = li.dataset.p; f.customer_id.value = li.dataset.id; suggest.hidden = true; }));
    }, 250);
  };
  f.cname.oninput = lookup; f.cphone.oninput = lookup;
}

// =====================================================================
// CLIENTES
// =====================================================================
let customers = [];
$('#cSearch').oninput = () => drawCustomers();
$('#cNew').onclick = () => customerModal({});
async function renderCustomers() {
  const { data, error } = await db.from('customers').select('id, name, phone, email, notes, last_booking_at, preferred_member_id, created_at, birthday, marketing_ok')
    .eq('client_id', CID).order('name').limit(2000);
  if (error) return fail(error);
  customers = (data || []).filter((c) => !c.name.startsWith('[prueba'));
  drawCustomers();
}
function drawCustomers() {
  const q = $('#cSearch').value.trim().toLowerCase(), digits = q.replace(/\D/g, '');
  const list = customers.filter((c) => !q || c.name.toLowerCase().includes(q) || (digits && (c.phone || '').includes(digits)));
  $('#cList').innerHTML = list.map((c) => `<div class="row-item" data-id="${c.id}"><div>${esc(c.name)}<small>${esc(phoneFmt(c.phone))}${c.preferred_member_id ? ` · con ${esc(team.find((m) => m.id === c.preferred_member_id)?.name?.split(' ')[0] || '')}` : ''}</small></div>
    <small>${c.last_booking_at ? `última cita ${new Date(c.last_booking_at).toLocaleDateString('es-ES')}` : ''}</small></div>`).join('') ||
    `<p class="muted" style="padding:18px">${customers.length ? 'Nadie coincide con la búsqueda.' : 'Aún no hay clientas. Se apuntan solas al reservar en la web o al darles cita aquí.'}</p>`;
  $$('#cList [data-id]').forEach((el) => (el.onclick = () => customerModal(customers.find((c) => c.id === el.dataset.id))));
}
async function customerModal(c) {
  const isNew = !c.id;
  let history = [], records = [];
  if (!isNew) {
    [history, records] = await Promise.all([
      db.from('calendar_events').select('starts_at, title, calendar_id, no_show, coupon_id').eq('customer_id', c.id).order('starts_at', { ascending: false }).limit(30).then((r) => r.data || []),
      db.from('customer_records').select('id, kind, body, photo_path, member_id, created_at').eq('customer_id', c.id).order('created_at', { ascending: false }).limit(60).then((r) => r.data || []),
    ]);
  }
  const visits = history.filter((h) => new Date(h.starts_at) < new Date() && !h.no_show).length;
  const noShows = history.filter((h) => h.no_show).length;
  openModal(`
    <h2>${isNew ? 'Nueva clienta' : esc(c.name)}</h2>
    ${isNew ? '' : `<p class="muted" style="margin-top:-6px">${visits} ${visits === 1 ? 'visita' : 'visitas'}${noShows ? ` · ${noShows} sin venir` : ''}${c.marketing_ok ? ' · <span class="tag-ok">acepta ofertas por correo</span>' : ''}</p>`}
    <div class="grid2">
      <label class="field"><span>Nombre</span><input name="name" value="${esc(c.name || '')}" required></label>
      <label class="field"><span>Teléfono</span><input name="phone" value="${esc(c.phone || '')}" inputmode="tel"></label>
    </div>
    <div class="grid2">
      <label class="field"><span>Correo</span><input name="email" type="email" value="${esc(c.email || '')}"></label>
      <label class="field"><span>Cumpleaños</span><input name="birthday" type="date" value="${esc(c.birthday || '')}"></label>
    </div>
    <div class="grid2">
      <label class="field"><span>Le atiende normalmente</span><select name="preferred_member_id"><option value="">—</option>${team.filter((m) => m.active).map((m) => `<option value="${m.id}" ${m.id === c.preferred_member_id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <label class="field check" style="align-self:end"><input type="checkbox" name="marketing_ok" ${c.marketing_ok ? 'checked' : ''}><span>Me ha dicho que quiere recibir ofertas por correo</span></label>
    </div>
    <label class="field"><span>Notas (alergias, gustos…)</span><textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></label>
    ${isNew ? '' : `
    <h3 class="sub">Ficha técnica</h3>
    <div class="rec-form">
      <select name="rkind"><option value="color">Fórmula de color</option><option value="nota">Nota del servicio</option><option value="foto">Foto</option></select>
      <input name="rbody" placeholder="Ej.: raíz 6.1 + 20 vol, 35 min · medios 7.13 + 10 vol">
    </div>
    <div class="rec-form"><label class="btn line" style="justify-content:center">Añadir fotos<input type="file" name="rphoto" accept="image/*" multiple hidden></label><button class="btn solid" value="record">Guardar en la ficha</button></div>
    <ul class="records" id="records">${records.map((r) => `<li data-r="${r.id}"><span class="meta">${new Date(r.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })} · ${{ color: 'Color', nota: 'Nota', foto: 'Foto' }[r.kind]}${r.member_id ? ` · ${esc(team.find((m) => m.id === r.member_id)?.name?.split(' ')[0] || '')}` : ''}</span>
      ${r.body ? `<div>${esc(r.body)}</div>` : ''}${r.photo_path ? `<img data-photo="${esc(r.photo_path)}" alt="">` : ''}</li>`).join('') || '<li class="muted">Aún no hay nada. Apunta aquí las fórmulas de color y sube fotos del antes y el después.</li>'}</ul>
    <h3 class="sub">Citas</h3><ul class="history">${history.map((h) => `<li>${new Date(h.starts_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })} · ${esc(h.title)}${h.no_show ? ' · <b>no vino</b>' : ''}${h.coupon_id ? ' · con cupón' : ''}</li>`).join('') || '<li class="muted">Sin citas todavía.</li>'}</ul>`}
    <div class="modal-actions">
      ${!isNew && c.phone ? `<a class="btn line" target="_blank" href="${waLink(c.phone, `¡Hola ${c.name.split(' ')[0]}! Te escribimos de Henko.`)}">WhatsApp</a><a class="btn line" href="tel:${esc(c.phone)}">Llamar</a>` : ''}
      <div class="right"><button class="btn" value="cancel" formnovalidate>Cerrar</button><button class="btn solid" value="save">Guardar</button></div>
    </div>`, async (fd, action) => {
    if (action === 'record') {
      const files = fd.getAll('rphoto').filter((f) => f && f.size);
      const body = String(fd.get('rbody') || '').trim();
      if (!body && !files.length) { toast('Escribe algo o elige una foto.'); return false; }
      const mine = team.find((m) => m.profile_id === me.id)?.id || null;
      if (!files.length) {
        const { error } = await db.from('customer_records').insert({ client_id: CID, customer_id: c.id, kind: fd.get('rkind') === 'foto' ? 'nota' : fd.get('rkind'), body, member_id: mine });
        if (error) throw error;
      }
      for (const [k, file] of files.entries()) {
        if (file.size > 10 * 1024 * 1024) { toast(`${file.name} pesa más de 10 MB`); continue; }
        const path = `${CID}/${c.id}/${Date.now()}-${k}.${(file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`;
        const up = await db.storage.from('customer-photos').upload(path, file, { contentType: file.type });
        if (up.error) throw up.error;
        const { error } = await db.from('customer_records').insert({ client_id: CID, customer_id: c.id, kind: 'foto', body: k ? null : body || null, photo_path: path, member_id: mine });
        if (error) throw error;
      }
      toast('Guardado en la ficha');
      customerModal(c);
      return false;
    }
    const marketing = fd.get('marketing_ok') === 'on';
    const row = {
      name: fd.get('name').trim(), phone: fd.get('phone').replace(/[^\d+]/g, '') || null, email: fd.get('email').trim() || null,
      notes: fd.get('notes').trim() || null, preferred_member_id: fd.get('preferred_member_id') || null,
      birthday: fd.get('birthday') || null, marketing_ok: marketing,
      ...(marketing && !c.marketing_ok ? { marketing_ok_at: new Date().toISOString() } : {}),
    };
    const { error } = isNew ? await db.from('customers').insert({ ...row, client_id: CID }) : await db.from('customers').update(row).eq('id', c.id);
    if (error) throw error.code === '23505' ? new Error('Ya hay una clienta con ese teléfono.') : error;
    toast('Guardado'); renderCustomers();
  });
  // Fotos de la ficha: almacén privado, con enlaces que caducan.
  const imgs = $$('#records img[data-photo]', card);
  if (imgs.length) {
    const { data } = await db.storage.from('customer-photos').createSignedUrls(imgs.map((i) => i.dataset.photo), 3600);
    (data || []).forEach((d, i) => { if (d.signedUrl) { imgs[i].src = d.signedUrl; imgs[i].onclick = () => window.open(d.signedUrl, '_blank'); } });
  }
}

// =====================================================================
// CUPONES
// =====================================================================
const couponText = (k) => k.kind === 'percent' ? `${Number(k.value).toLocaleString('es-ES')} % de descuento` : `${Number(k.value).toLocaleString('es-ES')} € de descuento`;
const shortDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
$('#kNew').onclick = () => couponModal({ kind: 'percent', value: 10, once_per_customer: true, active: true, service_ids: [] });
async function renderCoupons() {
  renderGifts();
  coupons = (await db.from('coupons').select('*').eq('client_id', CID).order('created_at')).data || [];
  const { data: used } = await db.from('calendar_events').select('coupon_id').eq('client_id', CID).not('coupon_id', 'is', null);
  const uses = {}; (used || []).forEach((u) => (uses[u.coupon_id] = (uses[u.coupon_id] || 0) + 1));
  const today = isoDay(new Date());
  $('#kList').innerHTML = coupons.map((k) => {
    const expired = k.valid_until && k.valid_until < today;
    const rules = [k.service_ids?.length ? `solo ${k.service_ids.map((id) => services.find((s) => s.id === id)?.name).filter(Boolean).join(', ')}` : 'todos los servicios',
      k.new_customers_only && 'solo primera visita', k.once_per_customer && 'una vez por clienta',
      k.valid_until && `hasta el ${shortDate(k.valid_until)}`, k.max_uses && `máximo ${k.max_uses} usos`].filter(Boolean).join(' · ');
    return `<div class="coupon-card ${k.active && !expired ? '' : 'off'}" data-id="${k.id}"><span class="code">${esc(k.code)}</span>
      <div>${esc(k.title || couponText(k))}<small>${esc(couponText(k))} · ${esc(rules)}${k.show_on_web ? ' · se ve en la web' : ''}${!k.active ? ' · desactivado' : expired ? ' · caducado' : ''}</small></div>
      <span class="pill">${uses[k.id] || 0} ${uses[k.id] === 1 ? 'uso' : 'usos'}</span></div>`;
  }).join('') || '<p class="muted">Aún no hay cupones.</p>';
  $$('#kList [data-id]').forEach((el) => (el.onclick = () => couponModal(coupons.find((k) => k.id === el.dataset.id))));
}
function couponModal(k) {
  const isNew = !k.id;
  openModal(`
    <h2>${isNew ? 'Nuevo cupón' : `Cupón ${esc(k.code)}`}</h2>
    <div class="grid2">
      <label class="field"><span>Código (lo que escriben)</span><input name="code" value="${esc(k.code || '')}" required maxlength="20" placeholder="OTONO15" style="text-transform:uppercase;letter-spacing:.1em"></label>
      <label class="field"><span>Nombre para la web</span><input name="title" value="${esc(k.title || '')}" placeholder="Otoño en Henko"></label>
    </div>
    <div class="grid2">
      <label class="field"><span>Tipo</span><select name="kind"><option value="percent" ${k.kind === 'percent' ? 'selected' : ''}>Porcentaje (%)</option><option value="fixed" ${k.kind === 'fixed' ? 'selected' : ''}>Euros (€)</option></select></label>
      <label class="field"><span>Descuento</span><input name="value" type="number" min="1" step="0.5" value="${k.value ?? ''}" required></label>
    </div>
    <div class="grid3">
      <label class="field"><span>Desde</span><input name="valid_from" type="date" value="${esc(k.valid_from || '')}"></label>
      <label class="field"><span>Hasta</span><input name="valid_until" type="date" value="${esc(k.valid_until || '')}"></label>
      <label class="field"><span>Usos máximos</span><input name="max_uses" type="number" min="1" value="${k.max_uses ?? ''}" placeholder="Sin límite"></label>
    </div>
    <div class="field"><span>¿Para qué servicios?</span>${services.filter((s) => s.active && s.bookable).map((s) => `<label class="field check" style="margin:0"><input type="checkbox" name="svc" value="${s.id}" ${k.service_ids?.includes(s.id) ? 'checked' : ''}><span>${esc(s.name)}</span></label>`).join('')}<small class="muted">Si no marcas ninguno, vale para todos.</small></div>
    <label class="field check"><input type="checkbox" name="once_per_customer" ${k.once_per_customer ? 'checked' : ''}><span>Cada clienta solo puede usarlo una vez</span></label>
    <label class="field check"><input type="checkbox" name="new_customers_only" ${k.new_customers_only ? 'checked' : ''}><span>Solo para clientas nuevas (primera visita)</span></label>
    <label class="field check"><input type="checkbox" name="show_on_web" ${k.show_on_web ? 'checked' : ''}><span>Enseñarlo en la portada de la web</span></label>
    <label class="field check"><input type="checkbox" name="active" ${k.active ? 'checked' : ''}><span>Activo</span></label>
    <div class="modal-actions">${isNew ? '' : '<button class="btn danger" value="delete">Borrar</button>'}<div class="right"><button class="btn" value="cancel" formnovalidate>Cerrar</button><button class="btn solid" value="save">Guardar</button></div></div>`,
  async (fd, action) => {
    if (action === 'delete') {
      if (!confirm('¿Borrar este cupón? Las citas que ya lo usaron lo pierden. Si solo quieres pararlo, desmarca «Activo».')) return false;
      const { error } = await db.from('coupons').delete().eq('id', k.id); if (error) throw error;
    } else {
      const code = String(fd.get('code')).toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (code.length < 3) throw new Error('El código necesita al menos 3 letras o números (sin espacios ni tildes).');
      const row = {
        code, title: String(fd.get('title')).trim() || null, kind: fd.get('kind'), value: Number(fd.get('value')),
        valid_from: fd.get('valid_from') || null, valid_until: fd.get('valid_until') || null, max_uses: Number(fd.get('max_uses')) || null,
        service_ids: fd.getAll('svc'), once_per_customer: fd.get('once_per_customer') === 'on', new_customers_only: fd.get('new_customers_only') === 'on',
        show_on_web: fd.get('show_on_web') === 'on', active: fd.get('active') === 'on',
      };
      if (row.kind === 'percent' && row.value > 100) throw new Error('Un porcentaje no puede pasar de 100.');
      const { error } = isNew ? await db.from('coupons').insert({ ...row, client_id: CID }) : await db.from('coupons').update(row).eq('id', k.id);
      if (error) throw error.code === '23505' ? new Error('Ya hay un cupón con ese código.') : error;
    }
    toast('Guardado'); renderCoupons();
  });
}

// ---------- Tarjetas regalo (se reservan en la web y se pagan en el salón)
let gFilter = 'activas', gifts = [];
const eur2 = (n) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`;
const GSTATE = { reservada: 'Reservada · falta pagar', pagada: 'Pagada', usada: 'Gastada', anulada: 'Anulada' };
$$('#gFilter button').forEach((b) => (b.onclick = () => { gFilter = b.dataset.g; $$('#gFilter button').forEach((x) => x.classList.toggle('on', x === b)); drawGifts(); }));
$('#gNew').onclick = () => giftModal({});
async function renderGifts() {
  const { data, error } = await db.from('gift_cards').select('*').eq('client_id', CID).order('created_at', { ascending: false }).limit(500);
  if (error) return fail(error);
  gifts = data || [];
  drawGifts();
}
function drawGifts() {
  const today = isoDay(new Date());
  const list = gifts.filter((g) => gFilter === 'todas' || g.status === 'reservada' || (g.status === 'pagada' && Number(g.balance) > 0));
  $('#gList').innerHTML = list.map((g) => {
    const expired = g.status === 'pagada' && g.expires_at && g.expires_at < today;
    return `<div class="coupon-card ${g.status === 'reservada' || g.status === 'pagada' ? '' : 'off'}" data-id="${g.id}"><span class="code">${esc(g.code)}</span>
      <div>${eur2(Number(g.balance))}${Number(g.balance) !== Number(g.amount) ? ` <span class="muted">de ${eur2(Number(g.amount))}</span>` : ''} · ${esc(g.buyer_name)}${g.recipient_name ? ` para ${esc(g.recipient_name)}` : ''}
      <small>${new Date(g.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}${g.source === 'web' ? ' · reservada en la web' : ''}${g.expires_at ? ` · vale hasta el ${shortDate(g.expires_at)}` : ''}${expired ? ' · caducada' : ''}</small></div>
      <span class="pill" ${g.status === 'reservada' ? 'style="background:#F6E7C8"' : ''}>${GSTATE[g.status]}</span></div>`;
  }).join('') || `<p class="muted">${gifts.length ? 'No hay tarjetas pendientes.' : 'Aún no hay tarjetas regalo.'}</p>`;
  $$('#gList [data-id]').forEach((el) => (el.onclick = () => giftModal(gifts.find((g) => g.id === el.dataset.id))));
}
const GIFT_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newGiftCode = () => `HENKO-${[...crypto.getRandomValues(new Uint8Array(5))].map((b) => GIFT_CHARS[b % GIFT_CHARS.length]).join('')}`;
const inAYear = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return isoDay(d); };
function giftModal(g) {
  const isNew = !g.id;
  if (isNew) {
    openModal(`
      <h2>Vender una tarjeta regalo</h2>
      <p class="muted">Para cuando la compran en el salón. Queda como pagada y vale un año.</p>
      <div class="grid2">
        <label class="field"><span>Importe (€)</span><input name="amount" type="number" min="5" step="5" required></label>
        <label class="field"><span>¿Para quién?</span><input name="recipient_name"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Quién la compra</span><input name="buyer_name" required></label>
        <label class="field"><span>Su teléfono</span><input name="buyer_phone" inputmode="tel"></label>
      </div>
      <label class="field"><span>Mensaje</span><input name="message"></label>
      <div class="modal-actions"><div class="right"><button class="btn" value="cancel" formnovalidate>Cerrar</button><button class="btn solid" value="save">Guardar</button></div></div>`,
    async (fd) => {
      const amount = Number(fd.get('amount'));
      const row = { client_id: CID, code: newGiftCode(), amount, balance: amount, status: 'pagada', source: 'panel', paid_at: new Date().toISOString(), expires_at: inAYear(),
        buyer_name: fd.get('buyer_name').trim(), buyer_phone: fd.get('buyer_phone').replace(/[^\d+]/g, '') || null, recipient_name: fd.get('recipient_name').trim() || null, message: fd.get('message').trim() || null };
      const { error } = await db.from('gift_cards').insert(row);
      if (error) throw error;
      toast(`Tarjeta ${row.code} creada`); renderGifts();
    });
    return;
  }
  const open = g.status === 'reservada' || g.status === 'pagada';
  openModal(`
    <h2>Tarjeta ${esc(g.code)} <span class="pill">${GSTATE[g.status]}</span></h2>
    <p style="font-size:30px;font-family:var(--serif, serif);margin:4px 0 8px">${eur2(Number(g.balance))} <span class="muted" style="font-size:16px">${Number(g.balance) !== Number(g.amount) ? `quedan de ${eur2(Number(g.amount))}` : ''}</span></p>
    <ul class="history">
      <li>Compra: ${esc(g.buyer_name)}${g.buyer_phone ? ` · ${esc(phoneFmt(g.buyer_phone))}` : ''}${g.buyer_email ? ` · ${esc(g.buyer_email)}` : ''}</li>
      ${g.recipient_name ? `<li>Para: ${esc(g.recipient_name)}</li>` : ''}
      ${g.message ? `<li>Mensaje: «${esc(g.message)}»</li>` : ''}
      <li>${g.source === 'web' ? 'Reservada en la web' : 'Vendida en el salón'} el ${new Date(g.created_at).toLocaleDateString('es-ES')}${g.paid_at ? ` · pagada el ${new Date(g.paid_at).toLocaleDateString('es-ES')}` : ''}${g.expires_at ? ` · vale hasta el ${shortDate(g.expires_at)}` : ''}</li>
    </ul>
    ${g.status === 'pagada' && Number(g.balance) > 0 ? `<label class="field"><span>Descontar lo que se ha gastado (€)</span><input name="spend" type="number" min="0" step="0.5" max="${Number(g.balance)}" placeholder="Ej.: 25"></label>` : ''}
    <label class="field"><span>Notas</span><input name="notes" value="${esc(g.notes || '')}"></label>
    <div class="modal-actions">
      ${open ? '<button class="btn danger" value="void">Anular</button>' : ''}
      ${g.buyer_phone ? `<a class="btn line" target="_blank" href="${waLink(g.buyer_phone, `¡Hola ${g.buyer_name.split(' ')[0]}! Te escribimos de Henko por tu tarjeta regalo ${g.code}.`)}">WhatsApp</a>` : ''}
      <div class="right"><button class="btn" value="cancel" formnovalidate>Cerrar</button>
      ${g.status === 'reservada' ? '<button class="btn solid" value="paid">Ya la ha pagado</button>' : '<button class="btn solid" value="save">Guardar</button>'}</div>
    </div>`, async (fd, action) => {
    const patch = { notes: String(fd.get('notes') || '').trim() || null };
    if (action === 'void') {
      if (!confirm('¿Anular esta tarjeta regalo?')) return false;
      patch.status = 'anulada';
    } else if (action === 'paid') {
      Object.assign(patch, { status: 'pagada', paid_at: new Date().toISOString(), expires_at: inAYear() });
    } else if (fd.get('spend')) {
      const spend = Number(fd.get('spend'));
      if (!(spend > 0) || spend > Number(g.balance)) throw new Error(`Puedes descontar como mucho ${eur2(Number(g.balance))}.`);
      patch.balance = Math.round((Number(g.balance) - spend) * 100) / 100;
      if (patch.balance === 0) patch.status = 'usada';
    }
    const { error } = await db.from('gift_cards').update(patch).eq('id', g.id);
    if (error) throw error;
    toast(action === 'paid' ? 'Marcada como pagada' : action === 'void' ? 'Tarjeta anulada' : patch.balance !== undefined ? `Quedan ${eur2(patch.balance)}` : 'Guardado');
    renderGifts();
  });
}

// =====================================================================
// NÚMEROS: cómo va el salón
// =====================================================================
let nRange = 'mes';
$$('#nRange button').forEach((b) => (b.onclick = () => { nRange = b.dataset.r; $$('#nRange button').forEach((x) => x.classList.toggle('on', x === b)); renderNumbers(); }));
function rangeOf(r) {
  const today = isoDay(new Date()), m0 = `${today.slice(0, 8)}01`;
  const monthsBack = (iso, n) => { const [y, m] = iso.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 - n, 1)); return d.toISOString().slice(0, 10); };
  if (r === 'anterior') return [monthsBack(m0, 1), addDays(m0, -1)];
  if (r === '3m') return [monthsBack(m0, 2), today];
  if (r === '12m') return [monthsBack(m0, 11), today];
  return [m0, today];
}
const eur = (n) => `${Math.round(n).toLocaleString('es-ES')} €`;
const bars = (rows, fmt = (v) => v) => {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return `<div class="bars">${rows.map(([label, v]) => `<div class="bar-row"><span>${esc(label)}</span><span class="track"><span class="fill" style="width:${(v / max) * 100}%"></span></span><span class="v">${fmt(v)}</span></div>`).join('') || '<p class="muted">Sin datos todavía.</p>'}</div>`;
};
async function renderNumbers() {
  const [from, to] = rangeOf(nRange);
  const fromTs = madridAt(from, '00:00').toISOString(), toTs = madridAt(addDays(to, 1), '00:00').toISOString();
  $('#nBody').innerHTML = '<p class="muted">Calculando…</p>';
  try {
    const [ev, cus, all, wl, msg] = await Promise.all([
      db.from('calendar_events').select('id, calendar_id, starts_at, ends_at, title, source, service_id, customer_id, price_eur, discount_eur, coupon_id, no_show')
        .eq('client_id', CID).gte('starts_at', fromTs).lt('starts_at', toTs).limit(5000),
      db.from('customers').select('id, name, phone, created_at, marketing_ok').eq('client_id', CID).limit(5000),
      db.from('calendar_events').select('customer_id, starts_at, no_show').eq('client_id', CID).not('customer_id', 'is', null).limit(10000),
      db.from('waitlist').select('id', { count: 'exact', head: true }).eq('client_id', CID).gte('created_at', fromTs).lt('created_at', toTs),
      db.from('message_log').select('kind').eq('client_id', CID).eq('ok', true).gte('created_at', fromTs).lt('created_at', toTs),
    ]);
    const events = (ev.data || []).filter((e) => !e.title.startsWith('Bloqueado') && !e.title.includes('[prueba'));
    const done = events.filter((e) => !e.no_show && new Date(e.starts_at) < new Date());
    const upcoming = events.filter((e) => new Date(e.starts_at) >= new Date());
    const noShow = events.filter((e) => e.no_show).length;
    const revenue = done.reduce((t, e) => t + (Number(e.price_eur) || 0) - (Number(e.discount_eur) || 0), 0);
    const priced = done.filter((e) => e.price_eur != null).length;
    const web = events.filter((e) => e.source === 'web').length, chat = events.filter((e) => e.source === 'chat' || e.source === 'agent').length;
    const customers = (cus.data || []).filter((c) => !c.name.startsWith('['));
    const newOnes = customers.filter((c) => c.created_at >= fromTs && c.created_at < toTs).length;
    // Clientas que repiten y las que llevan tiempo sin venir
    const visits = {}; const last = {}; const future = new Set();
    (all.data || []).forEach((e) => {
      if (e.no_show) return;
      const t = new Date(e.starts_at).getTime();
      if (t > Date.now()) future.add(e.customer_id);
      else { visits[e.customer_id] = (visits[e.customer_id] || 0) + 1; last[e.customer_id] = Math.max(last[e.customer_id] || 0, t); }
    });
    const inRange = new Set(done.map((e) => e.customer_id).filter(Boolean));
    const repeat = [...inRange].filter((id) => visits[id] > 1).length;
    const asleep = customers.filter((c) => last[c.id] && !future.has(c.id) && Date.now() - last[c.id] > 56 * 86_400_000)
      .sort((a, b) => last[b.id] - last[a.id]).slice(0, 30);
    // Servicios y ocupación por persona
    const bySvc = {}; done.forEach((e) => { const n = services.find((s) => s.id === e.service_id)?.name || e.title.split(' · ')[0]; bySvc[n] = (bySvc[n] || 0) + 1; });
    const occ = calendars.map((c) => {
      let open = 0;
      for (let d = from; d <= to; d = addDays(d, 1)) (c.booking_hours?.[String(weekday(d))] || []).forEach((r) => { const [a, b] = r.replace(/\s/g, '').split('-').map(toMin); open += b - a; });
      const busy = events.filter((e) => e.calendar_id === c.id && !e.no_show).reduce((t, e) => t + (new Date(e.ends_at) - new Date(e.starts_at)) / 60000, 0);
      return [memberOf(c)?.name || c.name, open ? Math.min(100, Math.round((busy / open) * 100)) : 0];
    });
    const sources = [['Web', web], ['Asistente del chat', chat], ['En el salón / teléfono', events.length - web - chat]];
    const msgCount = {}; (msg.data || []).forEach((m) => (msgCount[m.kind] = (msgCount[m.kind] || 0) + 1));
    const coupUsed = events.filter((e) => e.coupon_id).length;
    // Visitas a la web pública (contador sin cookies); si falla, el resto de números sigue igual.
    let web2 = '';
    try {
      const { data: v, error: ve } = await db.rpc('client_web_stats', { p_client: CID, p_from: from, p_to: to });
      if (ve || !v || typeof v.people !== 'number') throw ve || new Error('sin datos');
      const days = (v.daily || []).map((d) => [new Date(`${d.day}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }), d.visits]);
      const pageName = (p) => ({ '/': 'Portada', '/cita.html': 'Ver o anular una cita', '/privacidad.html': 'Privacidad' }[p] || p);
      web2 = `<div class="panel"><h2>Visitas a la web</h2>
        <div class="kpis">
          <div class="kpi"><b>${v.people}</b>personas distintas<small>${v.visits} páginas vistas</small></div>
          <div class="kpi"><b>${web ? Math.round((web / Math.max(1, v.people)) * 100) : 0} %</b>acaban reservando<small>${web} reservas en la web</small></div>
        </div>
        <div class="cols2">
          <div><h3 class="muted" style="font-size:.9rem">Visitas por día</h3>${bars(days.slice(-14))}</div>
          <div><h3 class="muted" style="font-size:.9rem">Páginas más vistas</h3>${bars((v.pages || []).map((p) => [pageName(p.path), p.visits]))}</div>
          <div><h3 class="muted" style="font-size:.9rem">De dónde llegan</h3>${bars((v.referrers || []).map((r) => [r.ref, r.visits]))}</div>
          <div><h3 class="muted" style="font-size:.9rem">Desde qué aparato</h3>${bars((v.devices || []).map((d) => [d.device, d.visits]))}</div>
        </div>
        <p class="muted" style="margin-top:10px">No cuenta tus propias visitas si abres la web una vez con <b>?notrack=1</b> al final de la dirección.</p></div>`;
    } catch (e) { web2 = ''; }
    $('#nBody').innerHTML = `
      <div class="kpis">
        <div class="kpi"><b>${done.length}</b>citas hechas<small>${upcoming.length} más por venir</small></div>
        <div class="kpi"><b>${priced ? eur(revenue) : '—'}</b>facturado<small>${priced ? (priced < done.length ? `de ${priced} citas con precio` : 'según los precios') : 'pon precios en Servicios'}</small></div>
        <div class="kpi"><b>${web}</b>reservas en la web<small>${events.length ? Math.round((web / events.length) * 100) : 0} % del total</small></div>
        <div class="kpi"><b>${newOnes}</b>clientas nuevas<small>${repeat} repiten</small></div>
        <div class="kpi"><b>${noShow}</b>no vinieron<small>${events.length ? Math.round((noShow / events.length) * 100) : 0} % de las citas</small></div>
        <div class="kpi"><b>${coupUsed}</b>cupones usados<small>${wl.count || 0} en lista de espera</small></div>
      </div>
      <div class="cols2">
        <div class="panel"><h2>Lo que más se pide</h2>${bars(Object.entries(bySvc).sort((a, b) => b[1] - a[1]).slice(0, 8))}</div>
        <div class="panel"><h2>Ocupación de cada agenda</h2>${bars(occ, (v) => `${v} %`)}<p class="muted" style="margin-top:10px">Horas con cita sobre las horas de su horario.</p></div>
        <div class="panel"><h2>Cómo reservan</h2>${bars(sources)}</div>
        <div class="panel"><h2>Correos que han salido</h2>${bars([['Confirmaciones', msgCount.confirm || 0], ['Recordatorios', msgCount.reminder || 0], ['Peticiones de opinión', msgCount.review || 0], ['Te echamos de menos', msgCount.comeback || 0], ['Cumpleaños', msgCount.birthday || 0], ['Huecos liberados', msgCount.waitlist || 0]])}</div>
      </div>
      ${web2}
      <div class="panel"><h2>Hace más de 8 semanas que no vienen</h2>
        <p class="muted">Un mensaje a tiempo las trae de vuelta. ${asleep.length ? 'Escríbeles desde aquí:' : ''}</p>
        <ul class="history" style="max-height:none">${asleep.map((c) => `<li style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span>${esc(c.name)} <span class="muted">· última vez ${new Date(last[c.id]).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}${c.marketing_ok ? ' · le llega el correo solo' : ''}</span></span>${c.phone ? `<a class="btn line" target="_blank" href="${waLink(c.phone, `¡Hola ${c.name.split(' ')[0]}! Hace tiempo que no te vemos por Henko. ¿Te hacemos un hueco esta semana?`)}">WhatsApp</a>` : ''}</li>`).join('') || '<li class="muted">Nadie, ¡bien!</li>'}</ul>
      </div>`;
  } catch (err) { fail(err); }
}

// =====================================================================
// SERVICIOS
// =====================================================================
$('#sNew').onclick = () => serviceModal({ bookable: true, active: true, duration_minutes: 45, member_ids: [] });
function renderServices() {
  const cats = [...new Set(services.map((s) => s.category || 'Otros'))];
  $('#sList').innerHTML = cats.map((cat) => `<div class="svc-group"><h2>${esc(cat)}</h2>${services.filter((s) => (s.category || 'Otros') === cat).map((s) => `
    <div class="svc" data-id="${s.id}"><div class="${s.active ? '' : 'off'}"><span class="name">${esc(s.name)}</span><br><small class="muted">${s.duration_minutes} min · ${s.member_ids?.length ? s.member_ids.map((id) => esc(team.find((m) => m.id === id)?.name?.split(' ')[0] || '')).join(', ') : 'todo el equipo'}${s.bookable ? '' : ' · se pide por WhatsApp'}${s.active ? '' : ' · oculto'}</small></div>
    <span class="pill">${s.price_eur != null ? `${s.price_from ? 'desde ' : ''}${Number(s.price_eur).toLocaleString('es-ES')} €` : 'sin precio'}</span><span class="muted">›</span></div>`).join('')}</div>`).join('');
  $$('#sList [data-id]').forEach((el) => (el.onclick = () => serviceModal(services.find((s) => s.id === el.dataset.id))));
}
function serviceModal(s) {
  const isNew = !s.id;
  const cats = [...new Set(services.map((x) => x.category).filter(Boolean))];
  openModal(`
    <h2>${isNew ? 'Nuevo servicio' : esc(s.name)}</h2>
    <label class="field"><span>Nombre</span><input name="name" value="${esc(s.name || '')}" required></label>
    <div class="grid2">
      <label class="field"><span>Tipo</span><input name="category" list="cats" value="${esc(s.category || '')}" placeholder="Peluquería, Color…"><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="field"><span>Duración (minutos)</span><input name="duration_minutes" type="number" min="5" max="480" step="5" value="${s.duration_minutes}" required></label>
    </div>
    <div class="grid2">
      <label class="field"><span>Precio (€)</span><input name="price_eur" type="number" min="0" step="0.5" value="${s.price_eur ?? ''}" placeholder="Sin precio"></label>
      <label class="field check"><input type="checkbox" name="price_from" ${s.price_from ? 'checked' : ''}><span>Poner «desde»</span></label>
    </div>
    <label class="field"><span>Descripción para la web</span><textarea name="description" rows="2">${esc(s.description || '')}</textarea></label>
    <div class="field"><span>¿Quién lo hace?</span>${team.filter((m) => m.active).map((m) => `<label class="field check" style="margin:0"><input type="checkbox" name="member" value="${m.id}" ${s.member_ids?.includes(m.id) ? 'checked' : ''}><span>${esc(m.name)}</span></label>`).join('')}<small class="muted">Si no marcas a nadie, lo puede hacer cualquiera.</small></div>
    <label class="field check"><input type="checkbox" name="bookable" ${s.bookable ? 'checked' : ''}><span>Se puede reservar en la web (si no, se invita a escribir por WhatsApp)</span></label>
    <label class="field check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}><span>Visible en la web</span></label>
    <label class="field"><span>Orden</span><input name="sort" type="number" value="${s.sort ?? 0}"></label>
    <div class="modal-actions">${isNew ? '' : '<button class="btn danger" value="delete">Borrar</button>'}<div class="right"><button class="btn" value="cancel" formnovalidate>Cerrar</button><button class="btn solid" value="save">Guardar</button></div></div>`,
  async (fd, action) => {
    if (action === 'delete') {
      if (!confirm('¿Borrar este servicio? Si solo quieres quitarlo de la web, desmarca «Visible en la web».')) return false;
      const { error } = await db.from('services').delete().eq('id', s.id); if (error) throw error;
    } else {
      const price = fd.get('price_eur');
      const row = {
        name: fd.get('name').trim(), category: fd.get('category').trim() || null, description: fd.get('description').trim() || null,
        duration_minutes: Number(fd.get('duration_minutes')), price_eur: price === '' ? null : Number(price), price_from: fd.get('price_from') === 'on',
        member_ids: fd.getAll('member'), bookable: fd.get('bookable') === 'on', active: fd.get('active') === 'on', sort: Number(fd.get('sort')) || 0,
      };
      const { error } = isNew ? await db.from('services').insert({ ...row, client_id: CID }) : await db.from('services').update(row).eq('id', s.id);
      if (error) throw error;
    }
    toast('Guardado'); await loadBase(); renderServices();
  });
}

// =====================================================================
// EQUIPO Y HORARIOS
// =====================================================================
$('#tNew').onclick = () => memberModal({ active: true, show_on_web: true });
function hoursText(cal, d) { return (cal?.booking_hours?.[String(d)] || []).join(', '); }
function renderTeam() {
  $('#tList').innerHTML = team.map((m) => {
    const cal = calOf(m.id);
    return `<div class="card" data-id="${m.id}">
      <div class="face">${m.photo_url ? `<img src="${esc(m.photo_url)}" alt="">` : esc(m.name[0])}</div>
      <h2>${esc(m.name)}</h2><p class="muted">${esc(m.job_title || '')}${m.active ? '' : ' · desactivada'}${m.show_on_web ? '' : ' · no sale en la web'}</p>
      <div class="hours-grid">${DAYS.map((d, i) => `<span>${d}</span><span>${esc(hoursText(cal, i + 1)) || '<span class="muted">no trabaja</span>'}</span>`).join('')}</div>
      <button class="btn line">Editar</button></div>`;
  }).join('');
  $$('#tList [data-id]').forEach((el) => (el.onclick = () => memberModal(team.find((m) => m.id === el.dataset.id))));
}
function memberModal(m) {
  const isNew = !m.id, cal = calOf(m.id);
  openModal(`
    <h2>${isNew ? 'Nueva persona' : esc(m.name)}</h2>
    <div class="grid2">
      <label class="field"><span>Nombre</span><input name="name" value="${esc(m.name || '')}" required></label>
      <label class="field"><span>Puesto</span><input name="job_title" value="${esc(m.job_title || '')}" placeholder="Peluquería, Manicura…"></label>
    </div>
    <label class="field"><span>Presentación para la web</span><textarea name="bio" rows="2">${esc(m.bio || '')}</textarea></label>
    <label class="field"><span>Foto</span><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>
    <div class="field"><span>Horario de citas (por ejemplo: 09:30-13:30, 16:30-19:30)</span>
      <div class="hours-grid">${DAYS.map((d, i) => `<span>${d}</span><input name="h${i + 1}" value="${esc(hoursText(cal, i + 1))}" placeholder="no trabaja">`).join('')}</div></div>
    <div class="grid2">
      <label class="field"><span>Antelación mínima para reservar (minutos)</span><input name="notice" type="number" min="0" step="15" value="${cal?.booking_notice_minutes ?? 60}"></label>
      <div>
        <label class="field check"><input type="checkbox" name="show_on_web" ${m.show_on_web ? 'checked' : ''}><span>Sale en la web</span></label>
        <label class="field check"><input type="checkbox" name="active" ${m.active ? 'checked' : ''}><span>Activa (acepta citas)</span></label>
      </div>
    </div>
    <p class="muted">Para que tenga su propio acceso al panel (y vea solo su agenda), pídelo a quien te montó la web.</p>
    <div class="modal-actions"><div class="right"><button class="btn" value="cancel" formnovalidate>Cerrar</button><button class="btn solid" value="save">Guardar</button></div></div>`,
  async (fd) => {
    const hours = {};
    for (let d = 1; d <= 7; d++) {
      const parts = String(fd.get(`h${d}`) || '').split(/[,;y]+/).map((x) => x.replace(/\s/g, '').replace(/\./g, ':')).filter(Boolean);
      for (const p of parts) if (!/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(p)) throw new Error(`Revisa el horario del ${DAYS[d - 1].toLowerCase()}: escribe por ejemplo 09:30-13:30`);
      if (parts.length) hours[d] = parts.map((p) => p.split('-').map((t) => t.padStart(5, '0')).join('-'));
    }
    const row = { name: fd.get('name').trim(), job_title: fd.get('job_title').trim() || null, bio: fd.get('bio').trim() || null, show_on_web: fd.get('show_on_web') === 'on', active: fd.get('active') === 'on' };
    let id = m.id;
    if (isNew) {
      const { data, error } = await db.from('team_members').insert({ ...row, client_id: CID, role: 'otro', sort: team.length + 1 }).select('id').single();
      if (error) throw error; id = data.id;
    } else { const { error } = await db.from('team_members').update(row).eq('id', id); if (error) throw error; }
    const file = fd.get('photo');
    if (file && file.size) {
      const path = `${CID}/equipo-${id}-${Date.now()}.${(file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`;
      const { error } = await db.storage.from('site-media').upload(path, file, { contentType: file.type, upsert: true });
      if (error) throw error;
      await db.from('team_members').update({ photo_url: H.media(path.split('/').slice(1).join('/')) }).eq('id', id);
    }
    const calRow = { name: `Agenda de ${row.name.split(' ')[0]}`, booking_hours: hours, booking_notice_minutes: Number(fd.get('notice')) || 0, booking_enabled: true };
    const { error } = cal ? await db.from('calendars').update(calRow).eq('id', cal.id)
      : await db.from('calendars').insert({ ...calRow, client_id: CID, member_id: id, booking_minutes: 30, color: COLORS[calendars.length % COLORS.length] });
    if (error) throw error;
    toast('Guardado'); await loadBase(); renderTeam();
  });
}

// =====================================================================
// WEB: fotos, vídeos y textos
// =====================================================================
let wMode = 'fotos', media = [], settings = {};
$$('#wMode button').forEach((b) => (b.onclick = () => { wMode = b.dataset.w; $$('#wMode button').forEach((x) => x.classList.toggle('on', x === b)); renderWeb(); }));
async function renderWeb() {
  $$('[data-w-pane]').forEach((p) => (p.hidden = p.dataset.wPane !== wMode));
  const [m, s] = await Promise.all([
    db.from('site_media').select('*').eq('client_id', CID).order('sort').order('created_at', { ascending: false }),
    db.from('site_settings').select('data').eq('client_id', CID).maybeSingle(),
  ]);
  media = m.data || []; settings = s.data?.data || {};
  if (wMode === 'fotos') drawPhotos(); else if (wMode === 'videos') drawVideos(); else drawTexts();
}
const photoCats = () => [...new Set(media.map((x) => x.category).filter(Boolean).concat(['Color', 'Cortes', 'Recogidos', 'Manicura', 'El salón']))];
function drawPhotos() {
  const photos = media.filter((x) => x.kind === 'photo');
  $('#wPhotos').innerHTML = photos.map((p, i) => `<div class="ph ${p.published ? '' : 'hidden-ph'}" data-id="${p.id}">
    <img src="${esc(H.media(p.storage_path.split('/').slice(1).join('/')))}" alt="" loading="lazy">
    <div class="ph-body"><input data-f="title" value="${esc(p.title || '')}" placeholder="Título">
    <select data-f="category"><option value="">Sin tipo</option>${photoCats().map((c) => `<option ${c === p.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <div class="ph-actions"><span><button data-move="-1" ${i ? '' : 'disabled'} aria-label="Antes">←</button><button data-move="1" ${i < photos.length - 1 ? '' : 'disabled'} aria-label="Después">→</button></span>
    <button data-toggle>${p.published ? 'Ocultar' : 'Mostrar'}</button><button data-del>Borrar</button></div></div></div>`).join('') || '<p class="muted">Aún no hay fotos.</p>';
  $$('#wPhotos .ph').forEach((el) => {
    const p = photos.find((x) => x.id === el.dataset.id);
    $$('[data-f]', el).forEach((inp) => (inp.onchange = async () => { const { error } = await db.from('site_media').update({ [inp.dataset.f]: inp.value || null }).eq('id', p.id); error ? fail(error) : toast('Guardado'); }));
    $('[data-toggle]', el).onclick = async () => { const { error } = await db.from('site_media').update({ published: !p.published }).eq('id', p.id); error ? fail(error) : renderWeb(); };
    $('[data-del]', el).onclick = async () => {
      if (!confirm('¿Borrar esta foto de la web?')) return;
      const { error } = await db.from('site_media').delete().eq('id', p.id); if (error) return fail(error);
      if (p.storage_path.includes('/w-')) await db.storage.from('site-media').remove([p.storage_path]);
      renderWeb();
    };
    $$('[data-move]', el).forEach((b) => (b.onclick = async () => {
      const i = photos.indexOf(p), j = i + Number(b.dataset.move), q = photos[j];
      await Promise.all(photos.map((x, k) => db.from('site_media').update({ sort: k === i ? j : k === j ? i : k }).eq('id', x.id)));
      void q; renderWeb();
    }));
  });
}
$('#wFiles').onchange = async (e) => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  toast(`Subiendo ${files.length} ${files.length === 1 ? 'foto' : 'fotos'}…`);
  const base = media.filter((x) => x.kind === 'photo').length;
  for (const [k, file] of files.entries()) {
    if (file.size > 10 * 1024 * 1024) { toast(`${file.name} pesa más de 10 MB`); continue; }
    const name = `w-${Date.now()}-${k}.${(file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`;
    const { error } = await db.storage.from('site-media').upload(`${CID}/${name}`, file, { contentType: file.type });
    if (error) { fail(error); continue; }
    await db.from('site_media').insert({ client_id: CID, kind: 'photo', storage_path: `${CID}/${name}`, sort: base + k });
  }
  toast('Fotos subidas'); renderWeb();
};
function drawVideos() {
  const videos = media.filter((x) => x.kind === 'video');
  $('#wVideos').innerHTML = videos.map((v) => `<div class="ph" data-id="${v.id}"><img src="https://i.ytimg.com/vi/${esc(v.youtube_id)}/hqdefault.jpg" alt="" style="aspect-ratio:16/9">
    <div class="ph-body"><input data-f="title" value="${esc(v.title || '')}" placeholder="Título"><div class="ph-actions"><span></span><button data-del>Borrar</button></div></div></div>`).join('') || '<p class="muted">Pega el enlace de un vídeo de YouTube y saldrá en la web, debajo de los trabajos.</p>';
  $$('#wVideos .ph').forEach((el) => {
    $('[data-f]', el).onchange = async (ev) => { await db.from('site_media').update({ title: ev.target.value || null }).eq('id', el.dataset.id); toast('Guardado'); };
    $('[data-del]', el).onclick = async () => { if (confirm('¿Quitar este vídeo?')) { await db.from('site_media').delete().eq('id', el.dataset.id); renderWeb(); } };
  });
}
$('#wVideoForm').onsubmit = async (e) => {
  e.preventDefault();
  const url = e.target.url.value.trim();
  const id = (url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([A-Za-z0-9_-]{11})/) || [])[1];
  if (!id) return toast('Ese enlace no parece de YouTube.');
  const { error } = await db.from('site_media').insert({ client_id: CID, kind: 'video', youtube_id: id, title: e.target.title.value.trim() || null });
  if (error) return fail(error);
  e.target.reset(); toast('Vídeo añadido'); renderWeb();
};
const TEXTS = [
  ['hero_title', 'Título de la portada'], ['hero_text', 'Texto de la portada', true], ['about_title', 'Título de «El salón»'], ['about_text', 'Texto de «El salón»', true],
  ['address', 'Dirección'], ['maps_query', 'Dirección para el mapa'], ['phone', 'Teléfono'], ['whatsapp', 'WhatsApp (con 34 delante)'], ['instagram', 'Instagram (sin @)'],
];
function drawTexts() {
  const hours = (settings.hours || []).map((h) => `${h.days} | ${h.time}`).join('\n');
  $('#wTexts').innerHTML = `<div class="panel">${TEXTS.map(([k, label, long]) => `<label class="field"><span>${label}</span>${long ? `<textarea name="${k}" rows="3">${esc(settings[k] || '')}</textarea>` : `<input name="${k}" value="${esc(settings[k] || '')}">`}</label>`).join('')}
    <label class="field"><span>Horario que se ve en la web (una línea por fila: días | horas)</span><textarea name="hours" rows="3">${esc(hours)}</textarea></label>
    <label class="field"><span>Importes de la tarjeta regalo (separados por comas)</span><input name="gift" value="${esc((settings.gift_card?.amounts || []).join(', '))}"></label>
    <button class="btn solid">Guardar textos</button></div>`;
}
$('#wTexts').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target), data = { ...settings };
  TEXTS.forEach(([k]) => (data[k] = String(fd.get(k) || '').trim()));
  data.hours = String(fd.get('hours') || '').split('\n').map((l) => l.split('|')).filter((p) => p.length === 2 && p[0].trim()).map(([d, t]) => ({ days: d.trim(), time: t.trim() }));
  data.gift_card = { ...(settings.gift_card || {}), amounts: String(fd.get('gift') || '').split(',').map((x) => Number(x.trim())).filter((n) => n > 0) };
  const { error } = await db.from('site_settings').upsert({ client_id: CID, data });
  if (error) return fail(error);
  settings = data; toast('Textos guardados: ya se ven en la web');
};

// =====================================================================
// AJUSTES: avisos al móvil y reservas
// =====================================================================
async function renderSettings() {
  const { data } = await db.from('site_settings').select('data').eq('client_id', CID).maybeSingle();
  settings = data?.data || {};
  const f = $('#bookSettings');
  f.booking_days_ahead.value = settings.booking_days_ahead ?? 60;
  f.cancel_hours.value = settings.cancel_hours ?? 2;
  if (owner) drawMessages();
  pushState();
}

// ---- Correos automáticos a las clientas
const KINDS = { confirm: 'Confirmación', reminder: 'Recordatorio', review: 'Opinión en Google', comeback: 'Te echamos de menos', birthday: 'Cumpleaños', waitlist: 'Hueco liberado' };
async function drawMessages() {
  const f = $('#msgSettings'), m = settings.messages || {};
  ['reminder', 'review', 'comeback', 'birthday'].forEach((k) => (f[k].checked = settings.messages ? m[k] !== false : false));
  f.comeback_weeks.value = m.comeback_weeks || 7;
  f.review_url.value = settings.review_url || '';
  f.email.value = settings.email || '';
  coupons = (await db.from('coupons').select('*').eq('client_id', CID).order('created_at')).data || [];
  const opts = (sel) => `<option value="">Sin cupón</option>${coupons.filter((k) => k.active).map((k) => `<option value="${esc(k.code)}" ${k.code === sel ? 'selected' : ''}>${esc(k.code)} · ${esc(couponText(k))}</option>`).join('')}`;
  f.comeback_coupon.innerHTML = opts(m.comeback_coupon);
  f.birthday_coupon.innerHTML = opts(m.birthday_coupon);
  const { data } = await db.from('message_log').select('kind, to_email, ok, created_at, customers(name)').eq('client_id', CID).order('created_at', { ascending: false }).limit(25);
  $('#msgLog').innerHTML = (data || []).map((r) => `<li>${new Date(r.created_at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${esc(KINDS[r.kind] || r.kind)} · ${esc(r.customers?.name || r.to_email || '')}${r.ok ? '' : ' · <b>no salió</b>'}</li>`).join('') || '<li class="muted">Todavía no ha salido ninguno.</li>';
}
$('#msgSettings').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const data = {
    ...settings, review_url: f.review_url.value.trim(), email: f.email.value.trim(),
    messages: {
      reminder: f.reminder.checked, review: f.review.checked, comeback: f.comeback.checked, birthday: f.birthday.checked,
      comeback_weeks: Number(f.comeback_weeks.value) || 7, comeback_coupon: f.comeback_coupon.value || null, birthday_coupon: f.birthday_coupon.value || null,
    },
  };
  const { error } = await db.from('site_settings').upsert({ client_id: CID, data });
  if (error) return fail(error);
  settings = data; toast('Guardado');
};
$('#bookSettings').onsubmit = async (e) => {
  e.preventDefault();
  const data = { ...settings, booking_days_ahead: Number(e.target.booking_days_ahead.value) || 60, cancel_hours: Number(e.target.cancel_hours.value) || 0 };
  const { error } = await db.from('site_settings').upsert({ client_id: CID, data });
  if (error) return fail(error);
  settings = data; toast('Guardado');
};
async function pushState() {
  const el = $('#pushState');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { el.textContent = 'Este navegador no admite avisos. En iPhone, abre el panel desde la pantalla de inicio.'; $('#pushOn').disabled = true; return; }
  const reg = await navigator.serviceWorker.getRegistration('./');
  const sub = await reg?.pushManager.getSubscription();
  el.textContent = sub ? 'Los avisos están activados en este móvil.' : Notification.permission === 'denied' ? 'Los avisos están bloqueados en este navegador: actívalos en los ajustes del móvil.' : '';
  $('#pushOn').textContent = sub ? 'Enviar un aviso de prueba' : 'Activar avisos';
}
$('#pushOn').onclick = async () => {
  try {
    const { data: { session } } = await db.auth.getSession();
    const auth = { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
    const fn = `${H.supabaseUrl}/functions/v1/push`;
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if ((await Notification.requestPermission()) !== 'granted') return pushState();
      const { key } = await (await fetch(`${fn}?action=key`)).json();
      const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
      const res = await fetch(`${fn}?action=subscribe`, { method: 'POST', headers: auth, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!res.ok) throw new Error((await res.json()).error || 'No se pudo activar.');
      toast('Avisos activados');
    } else {
      await fetch(`${fn}?action=test`, { method: 'POST', headers: auth, body: '{}' });
      toast('Aviso de prueba enviado');
    }
  } catch (err) { fail(err); }
  pushState();
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
start();
