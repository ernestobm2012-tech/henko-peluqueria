// Cuenta la visita a la web, sin cookies y sin guardar nada en tu navegador.
// Solo envía la página y de dónde vienes. Ver privacidad.html.
// Para que no cuenten tus propias visitas, abre una vez la web con ?notrack=1
// (se recuerda solo en ese navegador); con ?notrack=0 vuelve a contar.
(function () {
  try {
    var q = location.search;
    try {
      if (/[?&]notrack=1/.test(q)) localStorage.setItem('henko_notrack', '1');
      if (/[?&]notrack=0/.test(q)) localStorage.removeItem('henko_notrack');
      if (localStorage.getItem('henko_notrack')) return;
    } catch (e) { /* sin almacenamiento: se cuenta igual */ }
    var path = location.pathname.replace(/^\/henko-peluqueria(?=\/|$)/, '') || '/';
    if (/^\/admin/.test(path)) return;
    var body = JSON.stringify({ c: 'henko-peluqueria', p: path, r: document.referrer || '' });
    var url = (window.HENKO && window.HENKO.supabaseUrl || 'https://rhjbpkaesobsbnkvioyh.supabase.co') + '/functions/v1/track';
    if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
    else fetch(url, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' });
  } catch (e) { /* nunca debe romper la web */ }
})();
