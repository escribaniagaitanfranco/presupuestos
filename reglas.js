// =====================================================================
//  REGLAS DE CÁLCULO
//  Todo lo que la app "sugiere" sale de acá. Los valores siempre se
//  pueden editar en el presupuesto; esto solo define la sugerencia.
// =====================================================================

const REGLAS = {
  // IVA que se suma a los honorarios calculados por escala.
  ivaHonorarios: 0.10,

  // Ley N.º 1307/87, art. 4.º — aplicada por tramos acumulados.
  // El primer tramo (hasta Gs. 1.000.000) es un honorario básico en jornales.
  escalaHonorarios: {
    basicoJornales: 5,
    basicoHasta: 1_000_000,
    tramos: [
      { desde: 1_000_000,   pct: 2.00 },
      { desde: 50_000_000,  pct: 1.75 },
      { desde: 75_000_000,  pct: 1.50 },
      { desde: 100_000_000, pct: 1.25 },
      { desde: 150_000_000, pct: 1.00 },
      { desde: 200_000_000, pct: 0.75 },
    ],
  },

  // Observación al pie del PDF en los trámites marcados con observacion: true.
  // (Texto inicial: se edita en Ajustes.)
  observacionPorDefecto: 'La retención del Impuesto a la Transferencia correspondiente al vendedor no está incluida en el presente presupuesto.',

  // Los porcentajes (pct) son los valores iniciales: los que se cargan en Ajustes tienen prioridad.

  // Catálogo de conceptos.
  //  seccion: 'tributos' | 'gastos'
  //  pct:     porcentaje sobre el monto de la operación en Gs. (sugerencia automática)
  //  fijo:    monto fijo que se suma al porcentaje (solo si hay monto)
  //  PROVISORIO = porcentaje ficticio hasta recibir las tablas reales.
  conceptos: {
    tasa_judicial:      { nombre: 'Tasa judicial por transferencia', seccion: 'tributos', pct: 0.85 }, // PROVISORIO
    tasa_fija:          { nombre: 'Tasa fija', seccion: 'tributos' },
    tasas_automotor:    { nombre: 'Tasas Registro del Automotor', seccion: 'tributos' },
    chapa_mercosur:     { nombre: 'Chapa Mercosur a elección', seccion: 'tributos' },
    cedula_verde:       { nombre: 'Cédula verde adicional', seccion: 'tributos' },
    imp_municipal:      { nombre: 'Imp. a la Transferencia Municipal', seccion: 'tributos', pct: 0.85,
                          variantes: {                                   // se elige en el presupuesto
                            // fijo: gastos administrativos que se suman al porcentaje
                            capital: { etiqueta: 'Capital', pct: 0.85, fijo: 30000 },          // pct PROVISORIO
                            otros:   { etiqueta: 'Otros municipios', pct: 0.85, fijo: 30000 }, // pct PROVISORIO
                          } },
    tasas_registrales:  { nombre: 'Tasas registrales', seccion: 'tributos' },

    gastos_admin:       { nombre: 'Gastos administrativos', seccion: 'gastos' },
    cert_dominio:       { nombre: 'Certificado de Condiciones de Dominio', seccion: 'gastos' },
    libre_disposicion:  { nombre: 'Libre disposición de bienes - vendedor', seccion: 'gastos' },
    vigencia_poder:     { nombre: 'Vigencia de poder', seccion: 'gastos' },
    vigencia_separacion:{ nombre: 'Vigencia de separación de bienes', seccion: 'gastos' },
    testimonio:         { nombre: 'Expedición de 1.º testimonio', seccion: 'gastos' },
    inscripcion:        { nombre: 'Inscripción registral', seccion: 'gastos' },
    cancelacion_prenda: { nombre: 'Cancelación de prenda', seccion: 'gastos' },
    cert_catastral:     { nombre: 'Certificado catastral', seccion: 'gastos' },
    cert_no_adeudar:    { nombre: 'Certificado de no adeudar (municipal)', seccion: 'gastos' },
  },

  // Plantillas por trámite: qué filas aparecen al elegirlo.
  //  monto:  etiqueta del monto de la operación (null = el trámite no usa monto)
  //  escala: true = sugerir honorarios con la escala del art. 4.º
  tramites: [
    {
      id: 'vehiculo', nombre: 'Transferencia de vehículo', monto: 'Precio de venta', escala: true, observacion: true,
      conceptos: ['tasa_judicial', 'tasa_fija', 'tasas_automotor', 'chapa_mercosur', 'cedula_verde', 'imp_municipal',
                  'gastos_admin', 'cert_dominio', 'libre_disposicion', 'vigencia_poder', 'vigencia_separacion',
                  'testimonio', 'inscripcion', 'cancelacion_prenda', 'cert_catastral'],
    },
    {
      id: 'inmueble', nombre: 'Transferencia de inmueble', monto: 'Precio de venta', escala: true, observacion: true,
      conceptos: ['tasa_judicial', 'imp_municipal', 'tasas_registrales',
                  'gastos_admin', 'cert_dominio', 'cert_catastral', 'cert_no_adeudar', 'libre_disposicion',
                  'vigencia_poder', 'vigencia_separacion', 'testimonio', 'inscripcion'],
    },
    {
      id: 'poder', nombre: 'Poder con inscripción', monto: null, escala: false,
      conceptos: ['tasas_registrales', 'gastos_admin', 'testimonio', 'inscripcion'],
    },
    {
      id: 'acta_constitucion', nombre: 'Acta de constitución', monto: 'Capital', escala: true,
      conceptos: ['tasas_registrales', 'gastos_admin', 'testimonio', 'inscripcion'],
    },
    {
      id: 'acta_intimacion', nombre: 'Acta de intimación', monto: null, escala: false,
      conceptos: ['gastos_admin', 'testimonio'],
    },
    {
      id: 'protocolizacion', nombre: 'Protocolización', monto: 'Monto del contrato', escala: true,
      conceptos: ['tasas_registrales', 'gastos_admin', 'testimonio', 'inscripcion'],
    },
    {
      id: 'otro', nombre: 'Otro trámite', monto: 'Monto', escala: false,
      conceptos: ['gastos_admin', 'testimonio'],
    },
  ],
};

// Honorario por escala (sin IVA), por tramos acumulados.
function honorarioEscala(montoGs, jornal) {
  const e = REGLAS.escalaHonorarios;
  if (!montoGs || montoGs <= 0) return 0;
  let total = e.basicoJornales * (jornal || 0);
  e.tramos.forEach((t, i) => {
    const hasta = i + 1 < e.tramos.length ? e.tramos[i + 1].desde : Infinity;
    const parte = Math.min(montoGs, hasta) - t.desde;
    if (parte > 0) total += parte * t.pct / 100;
  });
  return Math.round(total);
}

// Detalle legible del cálculo (se muestra solo en la app).
function detalleEscala(montoGs, jornal) {
  const e = REGLAS.escalaHonorarios;
  const partes = [`${e.basicoJornales} jornales (hasta ${fmt(e.basicoHasta)})`];
  e.tramos.forEach((t, i) => {
    const hasta = i + 1 < e.tramos.length ? e.tramos[i + 1].desde : Infinity;
    const parte = Math.min(montoGs, hasta) - t.desde;
    if (parte > 0) partes.push(`${String(t.pct).replace('.', ',')} % s/ ${fmt(parte)}`);
  });
  return partes.join(' + ');
}
