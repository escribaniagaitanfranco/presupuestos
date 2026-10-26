// =====================================================================
//  Generación del PDF (A4) con el diseño aprobado.
// =====================================================================

const IMG = { encabezado: null, titulo: null };

async function cargarImagen(url) {
  const r = await fetch(url);
  const b = await r.blob();
  return new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result);
    fr.onerror = mal;
    fr.readAsDataURL(b);
  });
}

async function precargarImagenesPDF() {
  if (!IMG.encabezado) IMG.encabezado = await cargarImagen('img/pdf-encabezado.png');
  if (!IMG.titulo) IMG.titulo = await cargarImagen('img/pdf-titulo.png');
}

const C = {
  navy: [30, 34, 66], gold: [242, 191, 79], ink: [29, 31, 43], muted: [107, 109, 120],
  line: [220, 219, 226], soft: [243, 243, 247], zebra: [250, 250, 252], red: [163, 58, 44], white: [255, 255, 255],
};

async function generarPDF(p, opts = {}) {
  await precargarImagenesPDF();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const X0 = 16, X1 = 194, W = X1 - X0, LIMITE = 276;
  const t = tramite(p.tramiteId);
  let y;

  const color = (c, tipo = 'text') => {
    if (tipo === 'text') doc.setTextColor(...c);
    if (tipo === 'fill') doc.setFillColor(...c);
    if (tipo === 'draw') doc.setDrawColor(...c);
  };
  const fuente = (estilo, tam) => { doc.setFont('helvetica', estilo); doc.setFontSize(tam); };
  const etiqueta = (txt, x, yy) => {
    fuente('normal', 5.8); color(C.muted);
    doc.text(txt.toUpperCase(), x, yy, { charSpace: 0.35 });
  };
  const recortar = (txt, ancho) => {
    let s = String(txt || '');
    while (s.length > 1 && doc.getTextWidth(s) > ancho) s = s.slice(0, -2) + '…';
    return s;
  };

  // ---------- Encabezado ----------
  function encabezado() {
    const hImg = W * 384 / 2720;
    doc.addImage(IMG.encabezado, 'PNG', X0, 11, W, hImg);
    y = 11 + hImg + 1;
    color(C.navy, 'fill'); doc.rect(X0, y, W, 0.5, 'F');
    color(C.gold, 'fill'); doc.rect(X0, y + 1.0, W, 0.6, 'F');
    y += 1.6;
  }
  function pie() {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      color(C.line, 'draw'); doc.setLineWidth(0.2); doc.line(X0, 285, X1, 285);
      fuente('normal', 6.6); color(C.muted);
      doc.text('Escribanía Gaitán Franco · Reg. Nro. 1114', X0, 289);
      doc.text(n > 1 ? `WhatsApp 0971 712710 · Página ${i} de ${n}` : 'WhatsApp 0971 712710', X1, 289, { align: 'right' });
    }
  }
  function nuevaPagina() {
    doc.addPage();
    y = 16;
  }
  function asegurar(h) { if (y + h > LIMITE) nuevaPagina(); }

  encabezado();

  // ---------- Título, número y fecha ----------
  y += 5;
  const hT = 10.5;
  doc.addImage(IMG.titulo, 'PNG', X0 - 0.5, y, hT * 920 / 192, hT);
  fuente('normal', 7.8); color(C.muted);
  const lineaMeta = (lbl, val, yy) => {
    fuente('bold', 7.8); color(C.ink);
    const wv = doc.getTextWidth(val);
    doc.text(val, X1, yy, { align: 'right' });
    fuente('normal', 7.8); color(C.muted);
    doc.text(lbl + ' ', X1 - wv, yy, { align: 'right' });
  };
  lineaMeta('N.º', p.numero || 'BORRADOR', y + 4.5);
  lineaMeta('Fecha', isoADMY(p.fecha), y + 8.8);
  y += hT + 4;

  // ---------- Datos del cliente ----------
  const hFila = 10.5;
  const conConcepto = !!(p.concepto || '').trim();
  const hDatos = hFila * (conConcepto ? 2 : 1);
  color(C.line, 'draw'); doc.setLineWidth(0.25);
  doc.roundedRect(X0, y, W, hDatos, 1.4, 1.4, 'S');
  doc.line(X0 + W / 2, y, X0 + W / 2, y + hFila);
  if (conConcepto) doc.line(X0, y + hFila, X1, y + hFila);
  const dato = (lbl, val, x, yy, ancho) => {
    etiqueta(lbl, x, yy + 3.9);
    fuente('normal', 9.3); color(C.ink);
    doc.text(recortar(val, ancho), x, yy + 8.1);
  };
  dato('Cliente', p.cliente, X0 + 3.2, y, W / 2 - 6);
  dato('Trámite', p.tramiteNombre, X0 + W / 2 + 3.2, y, W / 2 - 6);
  if (conConcepto) dato('Concepto', p.concepto, X0 + 3.2, y + hFila, W - 6);
  y += hDatos + 2.5;

  // ---------- Operación ----------
  const mg = montoGs(p);
  if (t.monto && mg > 0) {
    const cols = [];
    cols.push([t.monto, p.moneda === 'USD' ? `USD ${fmtDec(p.monto)}` : `Gs. ${fmt(p.monto)}`, '']);
    if (p.moneda === 'USD') {
      cols.push(['Cotización USD', `Gs. ${fmtDec(p.cotizacion)}`, p.cotizacionFuente === 'BCP' && p.cotizacionFecha ? `Ref. BCP ${isoADMY(p.cotizacionFecha)}` : '']);
      cols.push(['Equivalente', `Gs. ${fmt(mg)}`, '']);
    }
    cols.push(['Jornal mínimo', `Gs. ${fmt(p.jornal)}`, '']);
    const hOp = 12;
    color(C.soft, 'fill'); doc.roundedRect(X0, y, W, hOp, 1.4, 1.4, 'F');
    const wc = W / cols.length;
    cols.forEach(([lbl, val, nota], i) => {
      const x = X0 + wc * i;
      if (i) { color([226, 226, 234], 'draw'); doc.setLineWidth(0.25); doc.line(x, y + 1.5, x, y + hOp - 1.5); }
      etiqueta(lbl, x + 3.2, y + 3.9);
      fuente('normal', 9.3); color(C.ink); doc.text(val, x + 3.2, y + 7.9);
      if (nota) { fuente('normal', 5.8); color(C.muted); doc.text(nota, x + 3.2, y + 10.6); }
    });
    y += hOp;
  }

  // ---------- Tablas ----------
  const xCant = X1 - 38 - 8, xImp = X1 - 3.2;
  function cabeceraTabla(titulo, conCant) {
    const h = 6.2;
    color(C.navy, 'fill'); doc.rect(X0, y, W, h, 'F');
    fuente('bold', 6.4); color(C.white);
    doc.text(titulo.toUpperCase(), X0 + 3.2, y + 4.1, { charSpace: 0.35 });
    // jsPDF no considera el espaciado entre letras al alinear: se calcula a mano.
    const ancho = txt => doc.getTextWidth(txt) + 0.35 * (txt.length - 1);
    if (conCant) doc.text('CANT.', xCant - ancho('CANT.') / 2, y + 4.1, { charSpace: 0.35 });
    doc.text('IMPORTE (GS.)', xImp - ancho('IMPORTE (GS.)'), y + 4.1, { charSpace: 0.35 });
    y += h;
  }
  function tabla(titulo, filas, subtotalTxt, subtotal, conCant = true) {
    if (!filas.length) return;
    y += 6;
    asegurar(6.2 + 6 * Math.min(filas.length, 3) + 7);
    cabeceraTabla(titulo, conCant);
    filas.forEach((f, i) => {
      const h = 6;
      if (y + h > LIMITE) { nuevaPagina(); cabeceraTabla(titulo + ' (cont.)', conCant); }
      if (i % 2 === 1) { color(C.zebra, 'fill'); doc.rect(X0, y, W, h, 'F'); }
      color(C.line, 'draw'); doc.setLineWidth(0.2); doc.line(X0, y + h, X1, y + h);
      fuente('normal', 8.4); color(f.rojo ? C.red : C.ink);
      doc.text(recortar(f.nombre, xCant - X0 - 14), X0 + 3.2, y + 4.1);
      if (conCant && f.cant !== '') doc.text(String(f.cant), xCant, y + 4.1, { align: 'center' });
      doc.text(f.importe, xImp, y + 4.1, { align: 'right' });
      y += h;
    });
    asegurar(7);
    color(C.navy, 'draw'); doc.setLineWidth(0.35); doc.line(X0, y, X1, y);
    fuente('bold', 8.4); color(C.ink); doc.text(subtotalTxt, X0 + 3.2, y + 4.6);
    fuente('bold', 9.2); doc.text(fmt(subtotal), xImp, y + 4.6, { align: 'right' });
    y += 7;
  }

  const filasDe = sec => p.filas
    .filter(f => f.seccion === sec && (f.cant || 0) * (f.importe || 0) > 0)
    .map(f => ({ nombre: f.nombre || 'Concepto', cant: f.cant, importe: fmt(f.cant * f.importe) }));

  tabla('Tributos y tasas', filasDe('tributos'), 'Subtotal tributos', p.subtotales.tributos);
  tabla('Gastos', filasDe('gastos'), 'Subtotal gastos', p.subtotales.gastos);
  const hon = [];
  if (p.honorarios.importe > 0) hon.push({ nombre: 'Honorarios profesionales', cant: '', importe: fmt(p.honorarios.importe) });
  if (p.descuento > 0) hon.push({ nombre: 'Descuento sobre honorarios', cant: '', importe: '- ' + fmt(p.descuento), rojo: true });
  tabla('Honorarios', hon, 'Subtotal honorarios', p.subtotales.honorarios, false);

  // ---------- Resumen y total ----------
  const lineasRes = [['Tributos y tasas', p.subtotales.tributos], ['Gastos', p.subtotales.gastos], ['Honorarios', p.subtotales.honorarios]]
    .filter(([, v]) => v !== 0);
  const hRes = 6.4 * lineasRes.length + 10 + 0.7 + (p.totalUSD ? 5.6 : 0);
  y += 8;
  asegurar(hRes);
  const xr = X1 - 84, wr = 84;
  let yr = y;
  color(C.line, 'draw'); doc.setLineWidth(0.25);
  doc.roundedRect(xr, yr, wr, hRes, 1.4, 1.4, 'S');
  lineasRes.forEach(([l, v]) => {
    fuente('normal', 8.4); color(C.ink);
    doc.text(l, xr + 3.5, yr + 4.3);
    doc.text(fmt(v), X1 - 3.5, yr + 4.3, { align: 'right' });
    yr += 6.4;
    color(C.line, 'draw'); doc.line(xr, yr, X1, yr);
  });
  color(C.navy, 'fill'); doc.rect(xr, yr, wr, 10, 'F');
  fuente('bold', 7.2); color(C.white); doc.text('TOTAL A PAGAR', xr + 3.5, yr + 6.2, { charSpace: 0.45 });
  fuente('bold', 13); doc.text('Gs. ' + fmt(p.total), X1 - 3.5, yr + 6.9, { align: 'right' });
  yr += 10;
  color(C.gold, 'fill'); doc.rect(xr, yr, wr, 0.7, 'F');
  yr += 0.7;
  if (p.totalUSD) {
    color(C.soft, 'fill'); doc.rect(xr + 0.15, yr, wr - 0.3, 5.6 - 0.2, 'F');
    fuente('normal', 6.9); color(C.muted);
    doc.text(`Equivalente aprox. USD ${fmt(p.totalUSD)}`, X1 - 3.5, yr + 3.8, { align: 'right' });
  }

  // Notas al pie del resumen
  const notas = ['Todos los importes están expresados en guaraníes e incluyen IVA.'];
  if (t.monto && p.moneda === 'USD' && p.cotizacion) {
    notas.push(p.cotizacionFuente === 'BCP' && p.cotizacionFecha
      ? `Cotización referencial del Banco Central del Paraguay al ${isoADMY(p.cotizacionFecha)}.`
      : `Cotización aplicada: Gs. ${fmtDec(p.cotizacion)} por USD.`);
  }
  notas.push(`Presupuesto válido por ${opts.validezDias || 30} días.`);
  fuente('normal', 6.9); color(C.muted);
  notas.forEach((n, i) => doc.text(n, X0, y + hRes - 2 - (notas.length - 1 - i) * 3.8));

  pie();
  doc.setProperties({ title: `Presupuesto ${p.numero || ''} - ${p.cliente || ''}`.trim(), author: 'Escribanía Gaitán Franco' });
  return doc;
}
