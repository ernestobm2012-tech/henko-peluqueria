// Web de Henko: lee de la base de EBM (función reservas) los servicios, el equipo, las
// fotos y los textos, y lleva la reserva paso a paso con los huecos libres de verdad.
(() => {
  const H = window.HENKO;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const post = async (body) => {
    const res = await fetch(H.reservas, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: H.client, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'No se ha podido completar.'), { status: res.status });
    return data;
  };
  const DAY = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MONTH = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const minutes = (m) => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  const euros = (n) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: n % 1 ? 2 : 0 })} €`;

  // ---- Fotos fijas de la web (están en el almacén del negocio)
  $$('[data-photo]').forEach((img) => {
    img.src = H.media(img.dataset.photo);
    img.addEventListener('error', () => img.closest('figure, .about-strip') ? img.style.visibility = 'hidden' : img.remove(), { once: true });
  });

  // ---- Menú del móvil y cabecera
  const menu = $('#menu'), nav = $('#nav');
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', open);
    nav.classList.toggle('open', open);
  });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) { menu.setAttribute('aria-expanded', 'false'); nav.classList.remove('open'); } });
  const top = $('#top');
  const onScroll = () => top.classList.toggle('scrolled', scrollY > 10);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // ---- Aparición suave
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }), { rootMargin: '0px 0px -8% 0px' }) : null;
  const reveal = (el) => { if (io) { el.classList.add('reveal'); io.observe(el); } };
  $$('main > section:not(.hero) > *').forEach(reveal);

  // ---- Datos del negocio
  let INFO = { settings: {}, services: [], team: [], media: [] };
  const state = { service: null, member: null, from: null, day: null, time: null, slots: null };

  post({ action: 'info' }).then((info) => {
    INFO = info;
    applySettings(info.settings || {});
    renderServices();
    renderGallery();
    renderTeam();
    fillServiceSelect();
    // Si se llega con #reservar?servicio=… se deja elegido
    const pre = new URLSearchParams(location.hash.split('?')[1] || '').get('servicio');
    if (pre) chooseService(pre);
  }).catch(() => {
    $('#serviceList').innerHTML = '<li class="loading">No hemos podido cargar los servicios. Llámanos al 608 857 984.</li>';
  });

  function get(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }

  function applySettings(s) {
    $$('[data-set]').forEach((el) => {
      const v = get(s, el.dataset.set);
      if (typeof v !== 'string' || !v.trim()) return;
      // En el título se respeta la palabra en cursiva si el texto la sigue teniendo.
      if (el.tagName === 'H1' && v.includes('con mimo')) el.innerHTML = esc(v).replace('con mimo', '<em>con mimo</em>');
      else el.textContent = v;
    });
    if (s.whatsapp) {
      const wa = `https://wa.me/${s.whatsapp}`;
      $$('.js-wa').forEach((a) => a.href = `${wa}?text=${encodeURIComponent('¡Hola! Quería pedir cita en Henko.')}`);
      $$('.js-wa-gift').forEach((a) => a.href = `${wa}?text=${encodeURIComponent('¡Hola! Me gustaría una tarjeta regalo de Henko.')}`);
    }
    if (s.phone) $$('.js-tel').forEach((a) => { a.href = `tel:+34${s.phone}`; a.textContent = `Llamar al ${s.phone.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')}`; });
    if (s.instagram) $$('.js-ig').forEach((a) => a.href = `https://www.instagram.com/${s.instagram}/`);
    if (s.maps_query) $$('.js-map').forEach((a) => a.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.maps_query)}`);
    if (Array.isArray(s.gift_card?.amounts)) $('#giftAmounts').innerHTML = s.gift_card.amounts.map((n) => `<span>${esc(n)} €</span>`).join('');
    if (Array.isArray(s.hours)) renderHours(s.hours);
    renderOpenNow(s.opening);
  }

  function renderHours(hours) {
    const today = new Date().getDay();
    const isToday = (label) => {
      const l = label.toLowerCase();
      if (today === 0) return l.includes('domingo');
      if (today === 6) return l.includes('sábado');
      return l.includes('lunes a viernes') || l.includes(DAY[today]);
    };
    $('#hours').innerHTML = hours.map((h) => `<tr class="${isToday(h.days) ? 'today' : ''}"><td>${esc(h.days)}</td><td>${esc(h.time)}</td></tr>`).join('');
  }

  // «Abierto ahora» con la hora de España, a partir del horario {"1":["09:30-13:30",…]}
  function renderOpenNow(opening) {
    const el = $('#openNow');
    if (!opening) { el.textContent = 'Lunes a viernes 9:30–13:30 y 16:30–19:30 · Sábados 9:30–13:30'; return; }
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map((p) => [p.type, p.value]));
    const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
    const now = +parts.hour * 60 + +parts.minute;
    const ranges = (d) => (opening[String(d)] || []).map((r) => r.split('-').map((t) => { const [h, m] = t.split(':'); return +h * 60 + +m; }));
    const fmt = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    const open = ranges(wd).find(([a, b]) => now >= a && now < b);
    if (open) { el.classList.add('is-open'); el.textContent = `Abierto ahora · hasta las ${fmt(open[1])}`; return; }
    const later = ranges(wd).find(([a]) => a > now);
    if (later) { el.textContent = `Cerrado ahora · abrimos hoy a las ${fmt(later[0])}`; return; }
    for (let i = 1; i <= 7; i++) {
      const d = ((wd - 1 + i) % 7) + 1, r = ranges(d)[0];
      if (r) { el.textContent = `Cerrado ahora · abrimos ${i === 1 ? 'mañana' : `el ${DAY[d % 7]}`} a las ${fmt(r[0])}`; return; }
    }
  }

  // ---- Servicios
  let currentCat = null;
  function categories() { return [...new Set(INFO.services.map((s) => s.category || 'Otros'))]; }
  function renderServices() {
    const cats = categories();
    currentCat = currentCat || cats[0];
    $('#serviceTabs').innerHTML = cats.map((c) => `<button role="tab" aria-selected="${c === currentCat}">${esc(c)}</button>`).join('');
    $$('#serviceTabs button').forEach((b, i) => b.onclick = () => { currentCat = cats[i]; renderServices(); });
    $('#serviceList').innerHTML = INFO.services.filter((s) => (s.category || 'Otros') === currentCat).map((s) => `
      <li>
        <h3>${esc(s.name)}</h3>
        <span class="meta">${s.price_eur != null ? `<span class="price">${s.price_from ? 'desde ' : ''}${euros(s.price_eur)}</span> · ` : ''}${s.bookable ? minutes(s.duration_minutes) : 'a consultar'}</span>
        ${s.description ? `<p class="desc">${esc(s.description)}</p>` : '<span></span>'}
        <a class="go" href="#reservar" data-service="${s.id}">${s.bookable ? 'Reservar →' : 'Consultar →'}</a>
      </li>`).join('');
    $$('#serviceList [data-service]').forEach((a) => a.addEventListener('click', () => chooseService(a.dataset.service)));
  }

  // ---- Trabajos (fotos de la galería y vídeos de YouTube)
  let photos = [], workCat = 'Todo';
  function renderGallery() {
    photos = INFO.media.filter((m) => m.kind === 'photo');
    const cats = ['Todo', ...new Set(photos.map((p) => p.category).filter(Boolean))];
    $('#workChips').innerHTML = cats.length > 2 ? cats.map((c) => `<button aria-pressed="${c === workCat}">${esc(c)}</button>`).join('') : '';
    $$('#workChips button').forEach((b, i) => b.onclick = () => { workCat = cats[i]; renderGallery(); });
    const shown = photos.filter((p) => workCat === 'Todo' || p.category === workCat);
    $('#gallery').innerHTML = shown.map((p, i) => `<button data-i="${i}" aria-label="${esc(p.title || 'Ver foto')}"><img src="${esc(p.url)}" alt="${esc(p.title || '')}" loading="lazy">${p.title ? `<span class="cap">${esc(p.title)}</span>` : ''}</button>`).join('');
    $$('#gallery button').forEach((b) => b.onclick = () => openLightbox(shown, +b.dataset.i));
    if (!photos.length) $('#trabajos').hidden = true;
    const videos = INFO.media.filter((m) => m.kind === 'video');
    const box = $('#videos');
    box.hidden = !videos.length;
    box.innerHTML = videos.map((v) => `<div class="video"><button data-yt="${esc(v.youtube_id)}" aria-label="Ver vídeo ${esc(v.title || '')}">
      <img src="https://i.ytimg.com/vi/${esc(v.youtube_id)}/hqdefault.jpg" alt="" loading="lazy"><span class="play">▶</span></button></div>`).join('');
    // El vídeo de YouTube solo se carga al pulsar (sin cookies hasta entonces).
    $$('#videos [data-yt]').forEach((b) => b.onclick = () => {
      b.parentElement.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${b.dataset.yt}?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Vídeo"></iframe>`;
    });
  }

  const lb = $('#lightbox');
  let lbList = [], lbIndex = 0;
  function openLightbox(list, i) { lbList = list; lbIndex = i; showLb(); lb.hidden = false; document.body.style.overflow = 'hidden'; $('.lb-close', lb).focus(); }
  function showLb() { const p = lbList[lbIndex]; $('img', lb).src = p.url; $('img', lb).alt = p.title || ''; $('figcaption', lb).textContent = p.title || ''; }
  function closeLb() { lb.hidden = true; document.body.style.overflow = ''; }
  $('.lb-close', lb).onclick = closeLb;
  $('.lb-prev', lb).onclick = () => { lbIndex = (lbIndex - 1 + lbList.length) % lbList.length; showLb(); };
  $('.lb-next', lb).onclick = () => { lbIndex = (lbIndex + 1) % lbList.length; showLb(); };
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLb(); });
  addEventListener('keydown', (e) => {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLb();
    if (e.key === 'ArrowLeft') $('.lb-prev', lb).click();
    if (e.key === 'ArrowRight') $('.lb-next', lb).click();
  });

  // ---- Equipo
  function renderTeam() {
    $('#teamGrid').innerHTML = INFO.team.map((m) => `
      <article class="member">
        <div class="face">${m.photo_url ? `<img src="${esc(m.photo_url)}" alt="${esc(m.name)}" loading="lazy">` : `<span>${esc(m.name.trim()[0] || 'H')}</span>`}</div>
        <h3>${esc(m.name)}</h3>
        ${m.job_title ? `<p class="role">${esc(m.job_title)}</p>` : ''}
        ${m.bio ? `<p>${esc(m.bio)}</p>` : ''}
      </article>`).join('');
    if (!INFO.team.length) $('#equipo').hidden = true;
  }

  // ---- Reserva
  const panes = $$('.book-pane'), steps = $$('.book-steps li');
  function go(n) {
    panes.forEach((p) => p.hidden = +p.dataset.pane !== n);
    steps.forEach((s) => { const k = +s.dataset.step; s.classList.toggle('on', k === n); s.classList.toggle('past', k < n); });
    if (n > 1) $('#book').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $$('[data-back]').forEach((b) => b.onclick = () => go(+b.dataset.back));

  function fillServiceSelect() {
    const sel = $('#bService');
    sel.innerHTML = '<option value="">Elige un servicio</option>' + categories().map((c) => `<optgroup label="${esc(c)}">` +
      INFO.services.filter((s) => (s.category || 'Otros') === c).map((s) => `<option value="${s.id}">${esc(s.name)}${s.bookable ? ` · ${minutes(s.duration_minutes)}` : ''}</option>`).join('') + '</optgroup>').join('');
  }
  const svc = () => INFO.services.find((s) => s.id === state.service);
  const memberName = (id) => INFO.team.find((m) => m.id === id)?.name;
  const firstName = (name) => (name || '').split(' ')[0];

  function chooseService(id) {
    $('#bService').value = id;
    onService();
    go(1);
  }
  $('#bService').addEventListener('change', onService);
  function onService() {
    state.service = $('#bService').value || null;
    state.member = null; state.day = null; state.time = null;
    const s = svc();
    const note = $('#bServiceNote'), next = $('#bNext1'), whoWrap = $('#bWhoWrap');
    note.hidden = true; whoWrap.hidden = true; next.disabled = !s;
    if (!s) return;
    if (!s.bookable) {
      note.hidden = false; next.disabled = true;
      const wa = INFO.settings.whatsapp ? `https://wa.me/${INFO.settings.whatsapp}?text=${encodeURIComponent(`¡Hola! Me interesa: ${s.name}.`)}` : null;
      note.innerHTML = `${esc(s.description || 'Este servicio lo preparamos contigo.')} ${wa ? `<a href="${wa}" target="_blank" rel="noopener">Escríbenos por WhatsApp</a> y lo vemos.` : ''}`;
      return;
    }
    const able = INFO.team.filter((m) => m.bookable && (!s.member_ids?.length || s.member_ids.includes(m.id)));
    if (able.length > 1) {
      whoWrap.hidden = false;
      $('#bWho').innerHTML = `<button type="button" data-m="" aria-pressed="true">Me da igual<small>La primera que esté libre</small></button>` +
        able.map((m) => `<button type="button" data-m="${m.id}" aria-pressed="false">${esc(m.name)}${m.job_title ? `<small>${esc(m.job_title)}</small>` : ''}</button>`).join('');
      $$('#bWho button').forEach((b) => b.onclick = () => {
        $$('#bWho button').forEach((x) => x.setAttribute('aria-pressed', x === b));
        state.member = b.dataset.m || null;
      });
    } else state.member = able[0]?.id || null;
  }

  const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const DAYS_SHOWN = 14;

  $('#bNext1').onclick = () => { state.from = todayIso(); state.day = null; state.time = null; go(2); loadSlots(); };
  $('#bMore').onclick = () => { state.from = addDays(state.from, DAYS_SHOWN); loadSlots(); };
  $('#bPrev').onclick = () => { state.from = addDays(state.from, -DAYS_SHOWN); if (state.from < todayIso()) state.from = todayIso(); loadSlots(); };

  function summary() {
    const s = svc();
    const who = state.member ? ` con <strong>${esc(memberName(state.member))}</strong>` : '';
    return `<strong>${esc(s.name)}</strong> · ${minutes(s.duration_minutes)}${who}`;
  }

  async function loadSlots() {
    $('#bSum2').innerHTML = summary();
    $('#bPrev').disabled = state.from <= todayIso();
    $('#bDays').innerHTML = '<div class="skeleton" style="grid-column: 1 / -1"></div>';
    $('#bTimes').innerHTML = '';
    $('#bNext2').disabled = true;
    try {
      const data = await post({ action: 'slots', service_id: state.service, member_id: state.member, from: state.from, days: DAYS_SHOWN });
      state.slots = data.days;
      $('#bMore').disabled = !data.days.length || data.days.at(-1).date >= data.last_day;
      renderDays();
    } catch (err) {
      $('#bDays').innerHTML = '';
      $('#bTimes').innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    }
  }

  function renderDays() {
    const days = state.slots || [];
    $('#bDays').innerHTML = days.map((d) => {
      const dt = new Date(`${d.date}T12:00:00`);
      return `<button role="option" data-d="${d.date}" ${d.slots.length ? '' : 'disabled'} aria-selected="${d.date === state.day}">
        ${DAY[dt.getDay()].slice(0, 3)}<b>${dt.getDate()}</b>${MONTH[dt.getMonth()]}</button>`;
    }).join('');
    $$('#bDays button').forEach((b) => b.onclick = () => { state.day = b.dataset.d; state.time = null; renderDays(); });
    if (!state.day) {
      const first = days.find((d) => d.slots.length);
      if (first) { state.day = first.date; return renderDays(); }
      $('#bTimes').innerHTML = '<p class="empty">No quedan huecos en estos días. Prueba con los siguientes →</p>';
      return;
    }
    $(`#bDays [data-d="${state.day}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
    renderTimes();
  }

  function renderTimes() {
    const day = state.slots.find((d) => d.date === state.day);
    const slots = day?.slots || [];
    const morning = slots.filter((s) => s.time < '14:00'), afternoon = slots.filter((s) => s.time >= '14:00');
    const row = (list) => `<div class="row">${list.map((s) => `<button type="button" data-t="${s.time}" aria-pressed="${s.time === state.time}">${s.time}</button>`).join('')}</div>`;
    $('#bTimes').innerHTML = (morning.length ? `<h4>Mañana</h4>${row(morning)}` : '') + (afternoon.length ? `<h4>Tarde</h4>${row(afternoon)}` : '') || '<p class="empty">Ese día ya está completo.</p>';
    $$('#bTimes button').forEach((b) => b.onclick = () => { state.time = b.dataset.t; renderTimes(); $('#bNext2').disabled = false; });
    $('#bNext2').disabled = !state.time;
  }

  const longDate = (iso) => { const d = new Date(`${iso}T12:00:00`); return `${DAY[d.getDay()]} ${d.getDate()} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][d.getMonth()]}`; };
  $('#bNext2').onclick = () => {
    $('#bSum3').innerHTML = `${summary()}<br>El <strong>${longDate(state.day)}</strong> a las <strong>${state.time}</strong>`;
    $('#bError').hidden = true;
    go(3);
    setTimeout(() => $('#bForm [name=name]').focus({ preventScroll: true }), 350);
  };

  $('#bForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, err = $('#bError'), btn = $('#bSubmit');
    const phone = f.phone.value.replace(/\D/g, '');
    const fail = (msg, field) => { err.textContent = msg; err.hidden = false; field?.focus(); };
    if (f.name.value.trim().length < 2) return fail('Dinos tu nombre, por favor.', f.name);
    if (!f.phone.value.trim().startsWith('+') && phone.replace(/^34(?=\d{9}$)/, '').length !== 9) return fail('Revisa el teléfono: creo que le falta o le sobra alguna cifra.', f.phone);
    if (!f.ok.checked) return fail('Para reservar tienes que aceptar la política de privacidad.', f.ok);
    err.hidden = true; btn.disabled = true; btn.textContent = 'Reservando…';
    try {
      const r = await post({
        action: 'book', service_id: state.service, member_id: state.member, date: state.day, time: state.time,
        name: f.name.value, phone: f.phone.value, email: f.email.value, notes: f.notes.value, website: f.website.value,
      });
      done(r, f.name.value.trim());
    } catch (ex) {
      fail(ex.message);
      if (ex.status === 409) { state.time = null; setTimeout(() => { go(2); loadSlots(); }, 1600); }
    } finally { btn.disabled = false; btn.textContent = 'Confirmar cita'; }
  });

  function done(r, name) {
    const s = svc();
    $('#bDone').innerHTML = `${esc(firstName(name))}, tu cita para <strong>${esc(r.service)}</strong>${r.member ? ` con <strong>${esc(r.member)}</strong>` : ''} queda apuntada el <strong>${esc(r.when)}</strong>.<br>Av. San Crispín 72, Fuensalida.`;
    const manage = new URL(`cita.html?t=${r.token}`, location.href).href;
    $('#bManage').href = manage;
    // Archivo .ics para añadirla al calendario del móvil
    const [y, m, d] = state.day.split('-'), [hh, mm] = state.time.split(':');
    const start = `${y}${m}${d}T${hh}${mm}00`;
    const endDate = new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm + s.duration_minutes));
    const end = `${endDate.getUTCFullYear()}${String(endDate.getUTCMonth() + 1).padStart(2, '0')}${String(endDate.getUTCDate()).padStart(2, '0')}T${String(endDate.getUTCHours()).padStart(2, '0')}${String(endDate.getUTCMinutes()).padStart(2, '0')}00`;
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Henko//Reservas//ES', 'BEGIN:VEVENT',
      `UID:${r.token}@henko`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;TZID=Europe/Madrid:${start}`, `DTEND;TZID=Europe/Madrid:${end}`,
      `SUMMARY:${r.service} en Henko`, 'LOCATION:Av. San Crispín 72\\, Fuensalida', `DESCRIPTION:Ver o anular: ${manage}`,
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    $('#bIcs').href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    go(4);
  }
  $('#bAgain').onclick = () => { $('#bForm').reset(); $('#bService').value = ''; onService(); go(1); };
  go(1);
})();
