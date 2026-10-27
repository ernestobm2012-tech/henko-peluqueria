// Datos del negocio en la base de EBM (proyecto ebm-agentes). La clave es pública por
// diseño: lo que se puede leer o escribir lo deciden las reglas de la base (RLS).
window.HENKO = {
  supabaseUrl: 'https://rhjbpkaesobsbnkvioyh.supabase.co',
  supabaseKey: 'sb_publishable_MlzXIojQfbcUDiHUGJ_4wg_lcWCmJ27',
  client: 'henko-peluqueria',
  clientId: 'ecca73a0-720d-43d2-80ce-8435cb8b9dcb',
};
window.HENKO.reservas = `${window.HENKO.supabaseUrl}/functions/v1/reservas`;
window.HENKO.media = (name) => `${window.HENKO.supabaseUrl}/storage/v1/object/public/site-media/${window.HENKO.clientId}/${name}`;
