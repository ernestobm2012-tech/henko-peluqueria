# Henko · Peluquería & Estética

Web pública y panel del salón de Henko (Fuensalida, Toledo). HTML, CSS y JS sin compilación, publicada con GitHub Pages.

- `index.html`: web pública. Lee servicios, equipo, fotos y textos de la base de EBM (función `reservas`) y hace la reserva paso a paso con los huecos libres reales.
- `cita.html?t=…`: la clienta ve o anula su cita con el enlace que recibe al reservar.
- `admin.html`: panel del salón (agenda por persona, clientas, servicios y precios, equipo y horarios, fotos, vídeos y textos de la web, avisos al móvil). Entra con el usuario del panel de EBM; cada empleada con acceso propio solo ve su agenda.
- `assets/js/config.js`: datos del proyecto (clave pública de Supabase y negocio).
- El chat es el asistente de EBM (`ebmagenciaia.es/js/chat.js`, negocio `henko-peluqueria`).

Las fuentes están dentro de la web (`assets/fonts`), sin llamadas a Google Fonts.
