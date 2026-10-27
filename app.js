// =====================================================================
//  Presupuestos · Escribanía Gaitán Franco
// =====================================================================

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- Formato de números (es-PY: 1.234.567,89) ----------
function fmt(n) {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (v < 0 ? '-' : '') + s;
}
function fmtDec(n, dec = 2) {
  const v = Number(n) || 0;
  let [e, d] = Math.abs(v).toFixed(dec).split('.');
  e = e.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  d = (d || '').replace(/0+$/, '');
  return (v < 0 ? '-' : '') + e + (d ? ',' + d : '');
}
function parseNum(s) {
  if (typeof s === 'number') return s;
  const t = String(s || '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = parseFloat(t);
  return isFinite(n) ? n : 0;
}
// Formatea mientras se escribe, manteniendo el cursor en su lugar.
function enmascarar(el, decimales = 0) {
  const finDesdeAtras = el.value.length - (el.selectionStart ?? el.value.length);
  let [ent, dec] = el.value.replace(/\./g, '').split(',');
  ent = (ent || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  let out = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (decimales && dec !== undefined) out += ',' + dec.replace(/\D/g, '').slice(0, decimales);
  el.value = out;
  const pos = Math.max(0, out.length - finDesdeAtras);
  try { el.setSelectionRange(pos, pos); } catch (_) {}
}

const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const isoADMY = iso => iso ? iso.split('-').reverse().join('/') : '';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clonar = o => JSON.parse(JSON.stringify(o));

// ---------- Almacenamiento local (con tolerancia a fallos) ----------
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (_) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
};

// ---------- Estado ----------
let AJ = Object.assign({ jornal: CONFIG.jornalPorDefecto, validezDias: CONFIG.validezPorDefecto, sugeridos: {}, porcentajes: {}, fijos: {},
  observacion: REGLAS.observacionPorDefecto }, store.get('ajustes', {}));
let P = null;               // presupuesto en edición
let HIST = store.get('historial', {}); // id -> presupuesto
const ultimoPDF = { id: null, blob: null, nombre: null };

const tramite = id => REGLAS.tramites.find(t => t.id === id) || REGLAS.tramites[0];
const urlServicio = () => store.get('url', '') || CONFIG.urlServicio;
const pin = () => store.get('pin', '');

// ---------- Conexión con Apps Script ----------
async function api(accion, datos = {}) {
  const url = urlServicio();
  if (!url) throw new Error('Falta configurar la conexión con Google Drive en Ajustes.');
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ accion, pin: pin(), ...datos }) });
  let j;
  try { j = await res.json(); } catch (_) { throw new Error('El servicio no respondió correctamente.'); }
  if (!j.ok) {
    if (j.error === 'PIN incorrecto.' && accion !== 'ping') { store.set('pin', ''); mostrarBloqueo('El PIN cambió. Ingresá el nuevo.'); }
    throw new Error(j.error || 'Error del servicio.');
  }
  return j;
}

// ---------- Pantalla de ingreso con PIN ----------
function mostrarBloqueo(mensaje = '') {
  $('#bloqueo').hidden = false;
  $('#pin-error').textContent = mensaje;
  $('#pin-ingreso').value = '';
  setTimeout(() => $('#pin-ingreso').focus(), 50);
}

function initBloqueo() {
  $('#form-pin').addEventListener('submit', async e => {
    e.preventDefault();
    const valor = $('#pin-ingreso').value.trim();
    if (!valor) return;
    const btn = $('#btn-entrar');
    btn.disabled = true; btn.textContent = 'Verificando…'; $('#pin-error').textContent = '';
    const anterior = pin();
    store.set('pin', valor);
    try {
      await api('ping');
      $('#bloqueo').hidden = true;
      despuesDeEntrar();
    } catch (err) {
      store.set('pin', anterior === valor ? '' : anterior);
      $('#pin-error').textContent = err.message === 'PIN incorrecto.' ? 'PIN incorrecto.'
        : 'No se pudo verificar (¿hay conexión a internet?).';
      $('#pin-ingreso').select();
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });
}

// Lo que necesita conexión con Drive se hace una vez que se ingresó el PIN.
function despuesDeEntrar() {
  traerCotizacion();
  leerAjustesRemotos();
}

// ---------- Avisos y diálogos ----------
let avisoT;
function aviso(txt) {
  const a = $('#aviso');
  a.textContent = txt; a.classList.add('visible');
  clearTimeout(avisoT); avisoT = setTimeout(() => a.classList.remove('visible'), 2600);
}
function dialogo(titulo, texto, acciones = [{ txt: 'Cerrar' }]) {
  const d = $('#dlg');
  $('#dlg-titulo').textContent = titulo;
  $('#dlg-texto').textContent = texto;
  const cont = $('#dlg-acciones'); cont.innerHTML = '';
  acciones.forEach(a => {
    const b = document.createElement(a.href ? 'a' : 'button');
    b.className = 'btn' + (a.primario ? ' primario' : '');
    b.textContent = a.txt;
    if (a.href) { b.href = a.href; b.target = '_blank'; b.rel = 'noopener'; }
    b.onclick = async () => { if (a.fn) await a.fn(); if (!a.mantener) d.close(); };
    cont.appendChild(b);
  });
  d.showModal();
}

// =====================================================================
//  PRESUPUESTO: modelo y cálculos
// =====================================================================
function filasDeTramite(t) {
  return t.conceptos.map(key => {
    const c = REGLAS.conceptos[key];
    return { key, nombre: c.nombre, seccion: c.seccion, cant: 1, importe: Number(AJ.sugeridos[key]) || 0, auto: !!c.pct };
  });
}

function nuevoPresupuesto(tramiteId = REGLAS.tramites[0].id) {
  const ult = store.get('ultimaCotizacion', null);
  const t = tramite(tramiteId);
  return {
    id: uid(), numero: null, fecha: hoyISO(), cliente: '', concepto: '',
    tramiteId: t.id, tramiteNombre: t.nombre,
    moneda: 'USD', monto: 0, municipio: 'capital',
    cotizacion: ult ? ult.valor : 0, cotizacionFecha: ult ? ult.fecha : '', cotizacionFuente: ult ? 'BCP' : 'manual',
    jornal: Number(AJ.jornal) || 0,
    validezDias: Number(AJ.validezDias) || 30,
    filas: filasDeTramite(t),
    honorarios: { importe: 0, auto: true },
    descuento: 0,
    total: 0, estado: 'borrador',
  };
}

function montoGs(p = P) {
  if (!tramite(p.tramiteId).monto) return 0;
  return p.moneda === 'USD' ? Math.round((p.monto || 0) * (p.cotizacion || 0)) : Math.round(p.monto || 0);
}

// Porcentaje vigente de un concepto (Ajustes > reglas.js). Con variantes, según el municipio elegido.
function pctConcepto(key, p = P) {
  const c = REGLAS.conceptos[key];
  if (!c || !c.pct) return null;
  const variante = (p && p.municipio) || 'capital';
  const clave = c.variantes ? `${key}.${variante}` : key;
  const base = c.variantes ? c.variantes[variante].pct : c.pct;
  const aj = (AJ.porcentajes || {})[clave];
  return aj !== undefined && aj !== null && aj !== '' ? Number(aj) : base;
}
const fmtPct = n => String(n).replace('.', ',');

// Monto fijo que se suma al porcentaje (p. ej. gastos administrativos del impuesto municipal).
function fijoConcepto(key, p = P) {
  const c = REGLAS.conceptos[key];
  if (!c) return 0;
  const variante = (p && p.municipio) || 'capital';
  const clave = c.variantes ? `${key}.${variante}` : key;
  const base = (c.variantes ? c.variantes[variante].fijo : c.fijo) || 0;
  const aj = (AJ.fijos || {})[clave];
  return aj !== undefined && aj !== null && aj !== '' ? Number(aj) : base;
}

function nombreConcepto(key, p = P) {
  const c = REGLAS.conceptos[key];
  if (!c) return '';
  return c.variantes ? `${c.nombre} - ${c.variantes[(p && p.municipio) || 'capital'].etiqueta}` : c.nombre;
}

function sugerenciaFila(f, p = P) {
  const pct = pctConcepto(f.key, p);
  if (pct === null) return null;
  const mg = montoGs(p);
  if (mg <= 0) return 0;
  return Math.round(mg * pct / 100) + fijoConcepto(f.key, p);
}

function sugerenciaHonorarios(p = P) {
  const t = tramite(p.tramiteId);
  const mg = montoGs(p);
  if (!t.escala || mg <= 0) return null;
  const base = honorarioEscala(mg, p.jornal);
  return { base, iva: Math.round(base * REGLAS.ivaHonorarios), total: Math.round(base * (1 + REGLAS.ivaHonorarios)) };
}

// Aplica sugerencias a los valores "automáticos" y calcula totales.
function calcular(p = P) {
  p.filas.forEach(f => {
    if (f.key && REGLAS.conceptos[f.key] && REGLAS.conceptos[f.key].variantes) f.nombre = nombreConcepto(f.key, p);
    const s = sugerenciaFila(f, p);
    if (s !== null && f.auto) f.importe = s;
  });
  const sh = sugerenciaHonorarios(p);
  if (sh && p.honorarios.auto) p.honorarios.importe = sh.total;
  const sub = { tributos: 0, gastos: 0 };
  p.filas.forEach(f => { sub[f.seccion] += (f.cant || 0) * (f.importe || 0); });
  sub.honorarios = (p.honorarios.importe || 0) - (p.descuento || 0);
  p.subtotales = sub;
  p.total = sub.tributos + sub.gastos + sub.honorarios;
  p.totalUSD = tramite(p.tramiteId).monto && p.cotizacion > 0 ? p.total / p.cotizacion : 0;
  return p;
}

// =====================================================================
//  EDITOR: renderizado
// =====================================================================
function cargarEnEditor(p) {
  P = p;
  $('#ed-titulo').textContent = p.numero ? `Presupuesto N.º ${p.numero}` : 'Nuevo presupuesto';
  $('#f-fecha').value = p.fecha;
  $('#f-tramite').value = p.tramiteId;
  $('#f-cliente').value = p.cliente;
  $('#f-concepto').value = p.concepto;
  $('#f-monto').value = p.monto ? fmtDec(p.monto) : '';
  $('#f-cotizacion').value = p.cotizacion ? fmtDec(p.cotizacion) : '';
  $('#f-jornal').value = p.jornal ? fmt(p.jornal) : '';
  $('#f-municipio').value = p.municipio || 'capital';
  $('#f-descuento').value = p.descuento ? fmt(p.descuento) : '';
  $('#f-honorarios').value = '';
  marcarMoneda();
  renderFilas();
  refrescar();
}

function renderFilas() {
  ['tributos', 'gastos'].forEach(sec => {
    const cont = $(`.seccion[data-seccion="${sec}"] .filas`);
    cont.innerHTML = '';
    P.filas.forEach((f, i) => {
      if (f.seccion !== sec) return;
      const c = REGLAS.conceptos[f.key];
      const div = document.createElement('div');
      div.className = 'fila';
      div.dataset.i = i;
      div.innerHTML = `
        <div class="fila-nombre">
          ${f.key ? `<span></span>` : `<input type="text" class="nombre" placeholder="Nombre del concepto">`}
          ${c && c.pct ? `<small class="nota nota-pct"></small>` : ''}
        </div>
        <div class="fila-valores">
          <input type="text" inputmode="numeric" class="cant" aria-label="Cantidad">
          <input type="text" inputmode="numeric" class="num imp" placeholder="0" aria-label="Importe">
          ${c && c.pct ? `<button type="button" class="btn-icono restaurar" title="Volver al valor sugerido">↺</button>` : ''}
          ${f.key ? '' : `<button type="button" class="btn-icono quitar" title="Quitar">✕</button>`}
        </div>
        <div class="total-linea"></div>`;
      if (f.key) div.querySelector('.fila-nombre span').textContent = f.nombre;
      else div.querySelector('.nombre').value = f.nombre || '';
      div.querySelector('.cant').value = f.cant;
      cont.appendChild(div);
    });
  });
}

// Actualiza valores calculados en pantalla sin re-dibujar (no pierde el foco).
function refrescar() {
  calcular();
  const t = tramite(P.tramiteId);
  const activo = document.activeElement;

  $('#bloque-monto').hidden = !t.monto;
  $('#lbl-monto').textContent = t.monto || 'Monto';
  $('#campo-cotizacion').hidden = P.moneda !== 'USD';
  $('#campo-municipio').hidden = !P.filas.some(f => f.key && REGLAS.conceptos[f.key] && REGLAS.conceptos[f.key].variantes);
  $('#v-equivalente').textContent = 'Gs. ' + fmt(montoGs());
  notaCotizacion();

  $$('.seccion .fila[data-i]').forEach(div => {
    const f = P.filas[+div.dataset.i];
    const imp = div.querySelector('.imp');
    if (imp !== activo) imp.value = f.importe ? fmt(f.importe) : '';
    const s = sugerenciaFila(f);
    const np = div.querySelector('.nota-pct');
    if (np) {
      const fijo = fijoConcepto(f.key);
      np.textContent = `Sugerido: ${fmtPct(pctConcepto(f.key))} % del monto${fijo ? ` + Gs. ${fmt(fijo)} gastos adm.` : ''}`;
    }
    const nom = div.querySelector('.fila-nombre > span');
    if (nom && nom.textContent !== f.nombre) nom.textContent = f.nombre;
    div.classList.toggle('manual', s !== null && !f.auto);
    const r = div.querySelector('.restaurar');
    if (r) r.hidden = !(s !== null && !f.auto);
    div.classList.toggle('vacia', !(f.importe > 0));
    div.querySelector('.total-linea').textContent =
      f.cant > 1 && f.importe ? `${f.cant} × ${fmt(f.importe)} = ${fmt(f.cant * f.importe)}` : '';
  });

  const sh = sugerenciaHonorarios();
  const hon = $('#f-honorarios');
  if (hon !== activo) hon.value = P.honorarios.importe ? fmt(P.honorarios.importe) : '';
  $('#rest-honorarios').hidden = !(sh && !P.honorarios.auto);
  hon.closest('.fila').classList.toggle('manual', !!(sh && !P.honorarios.auto));
  $('#nota-honorarios').textContent = sh
    ? `Sugerido: escala Ley 1307 (${detalleEscala(montoGs(), P.jornal)}) = ${fmt(sh.base)} + IVA 10 % ${fmt(sh.iva)} = ${fmt(sh.total)}`
    : (t.escala ? 'Cargá el monto para calcular la escala.' : 'Monto libre (IVA incluido).');

  ['tributos', 'gastos', 'honorarios'].forEach(s => { $(`[data-subtotal="${s}"]`).textContent = fmt(P.subtotales[s]); });
  $('#v-total').textContent = 'Gs. ' + fmt(P.total);
  $('#v-total-usd').textContent = P.totalUSD ? `≈ USD ${fmt(P.totalUSD)}` : '';

  guardarBorrador();
}

function notaCotizacion() {
  const n = $('#nota-cotizacion');
  if (P.cotizacionFuente === 'BCP' && P.cotizacionFecha) n.textContent = `Ref. BCP al ${isoADMY(P.cotizacionFecha)} · editable`;
  else if (P.cotizacion) n.textContent = 'Cargada a mano · ↻ trae la del BCP';
  else n.textContent = urlServicio() ? 'Tocá ↻ para traer la del BCP' : 'Cargala a mano (o conectá Drive para traerla del BCP)';
}

function marcarMoneda() {
  $$('.moneda button').forEach(b => b.classList.toggle('activo', b.dataset.moneda === P.moneda));
}

let borradorT;
function guardarBorrador() {
  clearTimeout(borradorT);
  borradorT = setTimeout(() => store.set('borrador', P), 300);
}

// ---------- Cotización BCP ----------
async function traerCotizacion(forzar = false) {
  if (!urlServicio()) { if (forzar) aviso('Primero configurá la conexión en Ajustes.'); return; }
  if (!forzar && P.cotizacionFuente === 'manual' && P.cotizacion) return;
  const btn = $('#btn-bcp');
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await api('cotizacion', { fecha: P.fecha });
    P.cotizacion = r.valor; P.cotizacionFecha = r.fecha; P.cotizacionFuente = 'BCP';
    store.set('ultimaCotizacion', { valor: r.valor, fecha: r.fecha });
    $('#f-cotizacion').value = fmtDec(r.valor);
    refrescar();
    if (forzar) aviso(`Cotización BCP al ${isoADMY(r.fecha)}: Gs. ${fmtDec(r.valor)}`);
  } catch (e) {
    if (forzar) aviso('No se pudo traer la cotización: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '↻';
  }
}

// =====================================================================
//  EDITOR: eventos
// =====================================================================
function initEditor() {
  const sel = $('#f-tramite');
  REGLAS.tramites.forEach(t => sel.add(new Option(t.nombre, t.id)));

  $('#f-fecha').addEventListener('change', e => {
    P.fecha = e.target.value || hoyISO();
    if (P.cotizacionFuente === 'BCP') traerCotizacion();
    refrescar();
  });
  $('#f-cliente').addEventListener('input', e => { P.cliente = e.target.value; guardarBorrador(); });
  $('#f-concepto').addEventListener('input', e => { P.concepto = e.target.value; guardarBorrador(); });

  sel.addEventListener('change', e => {
    const t = tramite(e.target.value);
    const previas = P.filas;
    const nuevas = filasDeTramite(t);
    // Conserva lo ya cargado en conceptos que siguen existiendo, y las filas propias con importe.
    nuevas.forEach(n => {
      const v = previas.find(f => f.key === n.key);
      if (v) Object.assign(n, { cant: v.cant, importe: v.importe, auto: v.auto });
    });
    previas.filter(f => !f.key && f.importe > 0).forEach(f => nuevas.push(f));
    P.tramiteId = t.id; P.tramiteNombre = t.nombre; P.filas = nuevas;
    if (!t.escala) P.honorarios.auto = false;
    else if (!P.honorarios.importe) P.honorarios.auto = true;
    renderFilas(); refrescar();
  });

  $$('.moneda button').forEach(b => b.addEventListener('click', () => {
    P.moneda = b.dataset.moneda; marcarMoneda(); refrescar();
    if (P.moneda === 'USD' && !P.cotizacion) traerCotizacion();
  }));

  $('#f-monto').addEventListener('input', e => { enmascarar(e.target, 2); P.monto = parseNum(e.target.value); refrescar(); });
  $('#f-cotizacion').addEventListener('input', e => {
    enmascarar(e.target, 2); P.cotizacion = parseNum(e.target.value); P.cotizacionFuente = 'manual'; refrescar();
  });
  $('#btn-bcp').addEventListener('click', () => traerCotizacion(true));
  $('#f-jornal').addEventListener('input', e => { enmascarar(e.target); P.jornal = parseNum(e.target.value); refrescar(); });
  $('#f-municipio').addEventListener('change', e => { P.municipio = e.target.value; refrescar(); });

  $('#f-honorarios').addEventListener('input', e => {
    enmascarar(e.target); P.honorarios.importe = parseNum(e.target.value); P.honorarios.auto = false; refrescar();
  });
  $('#rest-honorarios').addEventListener('click', () => { P.honorarios.auto = true; refrescar(); });
  $('#f-descuento').addEventListener('input', e => { enmascarar(e.target); P.descuento = parseNum(e.target.value); refrescar(); });

  // Filas (delegación)
  $$('.seccion[data-seccion="tributos"], .seccion[data-seccion="gastos"]').forEach(secEl => {
    secEl.addEventListener('input', e => {
      const div = e.target.closest('.fila[data-i]'); if (!div) return;
      const f = P.filas[+div.dataset.i];
      if (e.target.classList.contains('imp')) {
        enmascarar(e.target); f.importe = parseNum(e.target.value);
        if (sugerenciaFila(f) !== null) f.auto = false;
      } else if (e.target.classList.contains('cant')) {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 3);
        f.cant = parseInt(e.target.value, 10) || 0;
      } else if (e.target.classList.contains('nombre')) {
        f.nombre = e.target.value;
      }
      refrescar();
    });
    secEl.addEventListener('click', e => {
      const div = e.target.closest('.fila[data-i]');
      if (e.target.classList.contains('restaurar') && div) { P.filas[+div.dataset.i].auto = true; refrescar(); }
      if (e.target.classList.contains('quitar') && div) { P.filas.splice(+div.dataset.i, 1); renderFilas(); refrescar(); }
      if (e.target.classList.contains('agregar')) {
        P.filas.push({ key: null, nombre: '', seccion: e.target.dataset.seccion, cant: 1, importe: 0, auto: false });
        renderFilas(); refrescar();
        const ult = $$(`.seccion[data-seccion="${e.target.dataset.seccion}"] .nombre`).pop();
        if (ult) ult.focus();
      }
    });
  });

  $('#btn-nuevo').addEventListener('click', () => {
    const vacio = !P.cliente && !P.monto && P.total === 0;
    const empezar = () => { cargarEnEditor(nuevoPresupuesto(P.tramiteId)); traerCotizacion(); window.scrollTo(0, 0); };
    if (vacio || P.estado === 'guardado') return empezar();
    dialogo('¿Empezar otro presupuesto?', 'Lo que no guardaste de este presupuesto se va a perder.', [
      { txt: 'Cancelar' }, { txt: 'Empezar otro', primario: true, fn: empezar },
    ]);
  });

  $('#btn-vista').addEventListener('click', verPDF);
  $('#btn-guardar').addEventListener('click', guardar);
}

// =====================================================================
//  PDF, guardar y compartir
// =====================================================================
function nombreArchivo(p) {
  const limpio = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  return `${p.fecha} - ${limpio(p.cliente) || 'Sin nombre'} - ${limpio(p.tramiteNombre)}.pdf`;
}

async function crearPDF(p) {
  calcular(p);
  const doc = await generarPDF(p, {
    validezDias: p.validezDias || AJ.validezDias,
    observacion: tramite(p.tramiteId).observacion ? (AJ.observacion || '') : '',
  });
  const blob = doc.output('blob');
  Object.assign(ultimoPDF, { id: p.id, blob, nombre: nombreArchivo(p) });
  return { doc, blob };
}

function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

async function verPDF() {
  const w = window.open('', '_blank');
  try {
    const { blob } = await crearPDF(P);
    const url = URL.createObjectURL(blob);
    if (w) w.location.href = url; else descargar(blob, nombreArchivo(P));
  } catch (e) {
    if (w) w.close();
    aviso('No se pudo generar el PDF: ' + e.message);
  }
}

async function compartir(p) {
  if (ultimoPDF.id !== p.id || !ultimoPDF.blob) await crearPDF(p);
  const file = new File([ultimoPDF.blob], ultimoPDF.nombre, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Presupuesto', text: `Presupuesto ${p.numero ? 'N.º ' + p.numero + ' ' : ''}- Escribanía Gaitán Franco` });
    } catch (e) { if (e.name !== 'AbortError') descargar(ultimoPDF.blob, ultimoPDF.nombre); }
  } else {
    descargar(ultimoPDF.blob, ultimoPDF.nombre);
    aviso('PDF descargado. Adjuntalo en WhatsApp.');
  }
}

function guardarEnHistorialLocal(p) {
  HIST[p.id] = clonar(p);
  store.set('historial', HIST);
}

async function subirADrive(p) {
  if (!p.numero) {
    const r = await api('reservarNumero', { fecha: p.fecha });
    p.numero = r.numero;
  }
  const { blob } = await crearPDF(p);
  const base64 = await new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(',')[1]);
    fr.onerror = mal;
    fr.readAsDataURL(blob);
  });
  const r = await api('guardar', { presupuesto: p, pdf: base64, nombreArchivo: nombreArchivo(p) });
  p.driveFileId = r.fileId; p.driveUrl = r.url;
  p.estado = 'guardado'; p.actualizado = new Date().toISOString();
  return p;
}

async function guardar() {
  if (!P.cliente.trim()) { aviso('Falta el nombre del cliente.'); $('#f-cliente').focus(); return; }
  const btn = $('#btn-guardar');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await subirADrive(P);
    guardarEnHistorialLocal(P);
    // Se limpia el formulario (mismo trámite) y el diálogo trabaja con la copia guardada.
    const guardado = clonar(P);
    cargarEnEditor(nuevoPresupuesto(guardado.tramiteId));
    store.set('borrador', P);
    traerCotizacion();
    window.scrollTo(0, 0);
    dialogo('Guardado en Drive', `Presupuesto N.º ${guardado.numero} · ${guardado.cliente} · Gs. ${fmt(guardado.total)}`, [
      ...(guardado.driveUrl ? [{ txt: 'Abrir en Drive', href: guardado.driveUrl }] : []),
      { txt: 'Cerrar' },
      { txt: 'Compartir', primario: true, fn: () => compartir(guardado) },
    ]);
  } catch (e) {
    P.estado = 'pendiente'; P.actualizado = new Date().toISOString();
    guardarEnHistorialLocal(P);
    dialogo('No se pudo guardar en Drive',
      `${e.message} El presupuesto quedó guardado en este dispositivo; podés reintentar desde Historial.`, [
        { txt: 'Descargar PDF', fn: async () => { const { blob } = await crearPDF(P); descargar(blob, nombreArchivo(P)); } },
        { txt: 'Cerrar', primario: true },
      ]);
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
}

// =====================================================================
//  HISTORIAL
// =====================================================================
async function sincronizarHistorial() {
  const est = $('#hist-estado');
  if (!urlServicio()) { est.textContent = 'Mostrando lo guardado en este dispositivo (Drive sin configurar).'; return; }
  est.textContent = 'Actualizando desde Drive…';
  try {
    const r = await api('listar');
    // Si la planilla devolvió todo (menos de 300), lo que ya estaba subido y no figura fue borrado en Drive.
    if (r.items.length < 300) {
      const enDrive = new Set(r.items.map(it => it.id));
      Object.keys(HIST).forEach(id => { if (HIST[id].estado === 'guardado' && !enDrive.has(id)) delete HIST[id]; });
    }
    r.items.forEach(it => {
      const local = HIST[it.id];
      if (local && local.estado === 'pendiente' && (local.actualizado || '') > (it.actualizado || '')) return;
      HIST[it.id] = it;
    });
    store.set('historial', HIST);
    est.textContent = '';
  } catch (e) {
    est.textContent = 'No se pudo actualizar desde Drive: ' + e.message;
  }
  renderHistorial();
}

function renderHistorial() {
  const q = $('#buscar').value.trim().toLowerCase();
  const items = Object.values(HIST)
    .filter(p => !q || [p.cliente, p.tramiteNombre, p.numero, p.concepto].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''));
  const ul = $('#lista-historial');
  ul.innerHTML = '';
  if (!items.length) { ul.innerHTML = '<li class="nota">No hay presupuestos guardados todavía.</li>'; return; }
  items.slice(0, 200).forEach(p => {
    const li = document.createElement('li');
    li.className = 'item';
    li.innerHTML = `
      <div class="item-cab"><strong></strong><span class="item-total"></span></div>
      <div class="item-sub"></div>
      <div class="item-acciones">
        <button data-a="abrir">Abrir</button>
        <button data-a="duplicar">Duplicar</button>
        <button data-a="compartir">Compartir</button>
        ${p.driveUrl ? '<a data-a="drive" target="_blank" rel="noopener">Drive</a>' : ''}
        ${p.estado === 'pendiente' ? '<button data-a="subir">Subir a Drive</button>' : ''}
        <button data-a="borrar" class="borrar">Borrar</button>
      </div>`;
    li.querySelector('strong').textContent = p.cliente || 'Sin nombre';
    if (p.estado === 'pendiente') li.querySelector('strong').insertAdjacentHTML('beforeend', '<span class="etiqueta">Sin subir</span>');
    li.querySelector('.item-total').textContent = 'Gs. ' + fmt(p.total);
    li.querySelector('.item-sub').textContent =
      `${p.numero ? 'N.º ' + p.numero + ' · ' : ''}${isoADMY(p.fecha)} · ${p.tramiteNombre}${p.concepto ? ' · ' + p.concepto : ''}`;
    const drv = li.querySelector('[data-a="drive"]'); if (drv) drv.href = p.driveUrl;
    li.addEventListener('click', async e => {
      const a = e.target.dataset.a; if (!a || a === 'drive') return;
      if (a === 'abrir') { cargarEnEditor(clonar(p)); mostrarVista('editor'); }
      if (a === 'duplicar') {
        const n = Object.assign(clonar(p), { id: uid(), numero: null, fecha: hoyISO(), driveFileId: null, driveUrl: null, estado: 'borrador', actualizado: null });
        cargarEnEditor(n); mostrarVista('editor'); aviso('Copia lista para editar.');
      }
      if (a === 'compartir') { e.target.textContent = '…'; try { await compartir(clonar(p)); } finally { e.target.textContent = 'Compartir'; } }
      if (a === 'borrar') return confirmarBorrado(p);
      if (a === 'subir') {
        e.target.textContent = 'Subiendo…';
        try { const q2 = await subirADrive(clonar(p)); guardarEnHistorialLocal(q2); aviso(`Subido: N.º ${q2.numero}`); renderHistorial(); }
        catch (err) { aviso('No se pudo subir: ' + err.message); e.target.textContent = 'Subir a Drive'; }
      }
    });
    ul.appendChild(li);
  });
}

function confirmarBorrado(p) {
  const enDrive = p.estado === 'guardado';
  dialogo(`¿Borrar el presupuesto${p.numero ? ' N.º ' + p.numero : ''}?`,
    `${p.cliente || 'Sin nombre'} · Gs. ${fmt(p.total)}. ` +
    (enDrive ? 'El PDF va a la papelera de Drive y se quita de la planilla.' : 'Se borra de este dispositivo.'), [
      { txt: 'Cancelar' },
      { txt: 'Borrar', primario: true, fn: async () => {
        try {
          if (enDrive) await api('borrar', { id: p.id });
          delete HIST[p.id];
          store.set('historial', HIST);
          if (P && P.id === p.id) cargarEnEditor(nuevoPresupuesto(P.tramiteId));
          renderHistorial();
          aviso('Presupuesto borrado.');
        } catch (e) {
          aviso(e.message === 'Acción desconocida.'
            ? 'Falta actualizar el script de Google para poder borrar.'
            : 'No se pudo borrar: ' + e.message);
        }
      } },
    ]);
}

// =====================================================================
//  AJUSTES
// =====================================================================
function renderAjustes() {
  $('#a-url').value = urlServicio();
  $('#a-jornal').value = fmt(AJ.jornal);
  $('#a-validez').value = AJ.validezDias;
  const cont = $('#lista-sugeridos');
  cont.innerHTML = '';
  ['tributos', 'gastos'].forEach(sec => {
    const h = document.createElement('h2'); h.textContent = sec === 'tributos' ? 'Tributos y tasas' : 'Gastos'; h.style.marginTop = '12px';
    cont.appendChild(h);
    Object.entries(REGLAS.conceptos).filter(([, c]) => c.seccion === sec).forEach(([key, c]) => {
      if (c.pct) {
        // Conceptos con porcentaje: uno por variante (p. ej. Capital / Otros municipios).
        const claves = c.variantes
          ? Object.keys(c.variantes).map(v => [`${key}.${v}`, `${c.nombre} - ${c.variantes[v].etiqueta}`, c.variantes[v].pct, c.variantes[v].fijo])
          : [[key, c.nombre, c.pct, c.fijo]];
        claves.forEach(([clave, nombre, base, fijoBase]) => {
          const d = document.createElement('div'); d.className = 'sug';
          d.innerHTML = `<span></span><div class="con-sufijo"><input type="text" inputmode="decimal" class="num" data-pct="${clave}"><span>% del monto</span></div>` +
            (fijoBase !== undefined ? `<span class="sug-fijo">+ gastos adm. Gs.</span><input type="text" inputmode="numeric" class="num" data-fijo="${clave}">` : '');
          d.querySelector('span').textContent = nombre;
          const inp = d.querySelector('input[data-pct]');
          const v = (AJ.porcentajes || {})[clave];
          inp.value = fmtPct(v !== undefined && v !== null && v !== '' ? v : base);
          inp.addEventListener('input', () => enmascarar(inp, 4));
          const inpF = d.querySelector('input[data-fijo]');
          if (inpF) {
            const vf = (AJ.fijos || {})[clave];
            inpF.value = fmt(vf !== undefined && vf !== null && vf !== '' ? vf : fijoBase);
            inpF.addEventListener('input', () => enmascarar(inpF));
          }
          cont.appendChild(d);
        });
        return;
      }
      const d = document.createElement('div'); d.className = 'sug';
      d.innerHTML = `<span></span><input type="text" inputmode="numeric" class="num" data-key="${key}" placeholder="—">`;
      d.querySelector('span').textContent = c.nombre;
      const inp = d.querySelector('input');
      inp.value = AJ.sugeridos[key] ? fmt(AJ.sugeridos[key]) : '';
      inp.addEventListener('input', () => enmascarar(inp));
      cont.appendChild(d);
    });
  });
  $('#a-observacion').value = AJ.observacion ?? REGLAS.observacionPorDefecto;
  $('#version-app').textContent = `Versión ${CONFIG.version}`;
}

function initAjustes() {
  $('#a-jornal').addEventListener('input', e => enmascarar(e.target));
  $('#btn-salir').addEventListener('click', () => {
    dialogo('¿Cerrar sesión?', 'Para volver a usar la app en este dispositivo vas a tener que ingresar el PIN.', [
      { txt: 'Cancelar' },
      { txt: 'Cerrar sesión', primario: true, fn: () => { store.set('pin', ''); mostrarBloqueo(); } },
    ]);
  });
  $('#btn-probar').addEventListener('click', async () => {
    store.set('url', $('#a-url').value.trim());
    const est = $('#estado-conexion'); est.textContent = 'Probando…';
    try { const r = await api('ping'); est.textContent = `✓ Conectado. Carpeta en Drive: ${r.carpeta}`; await leerAjustesRemotos(); renderAjustes(); }
    catch (e) { est.textContent = '✗ ' + e.message; }
  });
  $('#btn-guardar-ajustes').addEventListener('click', async () => {
    store.set('url', $('#a-url').value.trim());
    AJ.jornal = parseNum($('#a-jornal').value) || CONFIG.jornalPorDefecto;
    AJ.validezDias = parseInt($('#a-validez').value, 10) || CONFIG.validezPorDefecto;
    AJ.sugeridos = {};
    $$('#lista-sugeridos input[data-key]').forEach(i => { const v = parseNum(i.value); if (v > 0) AJ.sugeridos[i.dataset.key] = v; });
    AJ.porcentajes = {};
    $$('#lista-sugeridos input[data-pct]').forEach(i => { if (i.value.trim() !== '') AJ.porcentajes[i.dataset.pct] = parseNum(i.value); });
    AJ.fijos = {};
    $$('#lista-sugeridos input[data-fijo]').forEach(i => { AJ.fijos[i.dataset.fijo] = parseNum(i.value); });
    AJ.observacion = $('#a-observacion').value.trim();
    if (P) refrescar();
    store.set('ajustes', AJ);
    if (urlServicio()) {
      try { await api('guardarAjustes', { ajustes: AJ }); aviso('Ajustes guardados en todos los dispositivos.'); }
      catch (e) { aviso('Guardado en este dispositivo. Drive: ' + e.message); }
    } else aviso('Ajustes guardados.');
  });
}

async function leerAjustesRemotos() {
  if (!urlServicio()) return;
  try {
    const r = await api('leerAjustes');
    if (r.ajustes) { AJ = Object.assign(AJ, r.ajustes); store.set('ajustes', AJ); }
  } catch (_) {}
}

// =====================================================================
//  Actualizaciones: compara con la versión publicada y recarga si hay una nueva
// =====================================================================
async function buscarActualizacion(manual = false) {
  if (location.protocol === 'file:') return;
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    const { version } = await r.json();
    if (!version || version === CONFIG.version) { if (manual) aviso(`Ya tenés la última versión (${CONFIG.version}).`); return; }
    // Evita recargar en bucle si algo impide tomar la versión nueva.
    if (!manual && store.get('actualizandoA', '') === version) return;
    store.set('actualizandoA', version);
    if (P) store.set('borrador', P);
    if (manual) aviso('Actualizando…');
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update().catch(() => {});
    if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); }
    location.reload();
  } catch (_) {
    if (manual) aviso('No se pudo buscar la actualización (¿hay conexión?).');
  }
}

// =====================================================================
//  Navegación e inicio
// =====================================================================
function mostrarVista(v) {
  $$('.vista').forEach(s => s.classList.toggle('activa', s.id === 'vista-' + v));
  $$('.barra-nav button').forEach(b => b.classList.toggle('activo', b.dataset.vista === v));
  $('#barra-total').hidden = v !== 'editor';
  if (v === 'historial') { renderHistorial(); sincronizarHistorial(); }
  if (v === 'ajustes') renderAjustes();
  window.scrollTo(0, 0);
}

function init() {
  initEditor();
  initAjustes();
  initBloqueo();
  $$('.barra-nav button').forEach(b => b.addEventListener('click', () => mostrarVista(b.dataset.vista)));
  $('#buscar').addEventListener('input', renderHistorial);
  $('#btn-actualizar-hist').addEventListener('click', sincronizarHistorial);

  const borrador = store.get('borrador', null);
  cargarEnEditor(borrador && borrador.filas ? borrador : nuevoPresupuesto());
  precargarImagenesPDF();
  if (pin()) despuesDeEntrar(); else mostrarBloqueo();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
  $('#btn-actualizar').addEventListener('click', () => buscarActualizacion(true));
  buscarActualizacion();
  // En el celular la app suele quedar "dormida": se revisa también al volver a ella.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') buscarActualizacion(); });
}

document.addEventListener('DOMContentLoaded', init);
