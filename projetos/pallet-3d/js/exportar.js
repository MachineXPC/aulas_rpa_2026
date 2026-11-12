// Exportações: desenho técnico (SVG), resumo de custos (CSV) e relatório (HTML).

import { camadaPorId, dimensoesTotais, medidasPeca } from './modelos.js';
import { medida, moeda, numero } from './unidades.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Baixa um texto ou dataURL como arquivo. */
export function baixar(nomeArquivo, conteudo, tipo = 'text/plain') {
  const url = conteudo.startsWith?.('data:') ? conteudo : URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (!conteudo.startsWith?.('data:')) setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function nomeArquivo(nome, ext) {
  const base = (nome || 'pallet').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'pallet';
  return `${base}.${ext}`;
}

// ---------------------------------------------------------------- desenho técnico

const COR_PECA = { inferior: '#e8d2ad', tocos: '#c99b63', travessa: '#dcbc8c', superior: '#f0dcb8' };

/**
 * Desenho com 3 vistas (superior, frontal e lateral) em projeção ortogonal,
 * com cotas gerais e a lista de peças.
 */
export function desenhoSVG(pecas, { nome = 'Pallet', unidade = 'mm', grupos = [] } = {}) {
  const d = dimensoesTotais(pecas);
  const W = 1200;
  const H = 860;
  const margem = 70;
  const areaW = 760;
  // Escala única para as 3 vistas caberem: topo (X×Z) em cima, frente (X×Y) embaixo, lateral (Z×Y) ao lado.
  const escala = Math.min(
    (areaW - margem * 2 - 40) / (d.x + d.z),
    (H - margem * 2 - 160) / (d.z + d.y),
  );
  const ox = margem + 20;
  const oyTopo = margem + 40;
  const oyFrente = oyTopo + d.z * escala + 90;
  const oxLado = ox + d.x * escala + 70;

  const partes = [];
  const ret = (x, y, w, h, cor) => partes.push(
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(w, 0.5).toFixed(1)}" height="${Math.max(h, 0.5).toFixed(1)}" fill="${cor}" stroke="#3b2a17" stroke-width="0.8"/>`,
  );
  const texto = (x, y, t, extra = '') => partes.push(
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${extra}>${esc(t)}</text>`,
  );
  const cotaH = (x0, x1, y, rot) => {
    partes.push(`<g class="cota"><line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`
      + `<line x1="${x0}" y1="${y - 6}" x2="${x0}" y2="${y + 6}"/><line x1="${x1}" y1="${y - 6}" x2="${x1}" y2="${y + 6}"/></g>`);
    texto((x0 + x1) / 2, y - 6, rot, 'class="cota-txt" text-anchor="middle"');
  };
  const cotaV = (x, y0, y1, rot) => {
    partes.push(`<g class="cota"><line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>`
      + `<line x1="${x - 6}" y1="${y0}" x2="${x + 6}" y2="${y0}"/><line x1="${x - 6}" y1="${y1}" x2="${x + 6}" y2="${y1}"/></g>`);
    texto(x + 8, (y0 + y1) / 2 + 4, rot, 'class="cota-txt"');
  };

  // Vista superior: peças mais altas desenhadas por último.
  texto(ox, oyTopo - 30, 'VISTA SUPERIOR', 'class="titulo-vista"');
  [...pecas].sort((a, b) => a.y + a.dy - (b.y + b.dy)).forEach((p) => {
    ret(ox + (p.x - d.x0) * escala, oyTopo + (p.z - d.z0) * escala, p.dx * escala, p.dz * escala, COR_PECA[p.camada] ?? '#ddd');
  });
  cotaH(ox, ox + d.x * escala, oyTopo - 12, medida(d.x, unidade));
  cotaV(ox + d.x * escala + 14, oyTopo, oyTopo + d.z * escala, medida(d.z, unidade));

  // Vista frontal (olhando de +Z para -Z): peças da frente por último.
  texto(ox, oyFrente - 30, 'VISTA FRONTAL', 'class="titulo-vista"');
  const baseFrente = oyFrente + d.y * escala;
  [...pecas].sort((a, b) => a.z + a.dz - (b.z + b.dz)).forEach((p) => {
    ret(ox + (p.x - d.x0) * escala, baseFrente - (p.y - d.y0 + p.dy) * escala, p.dx * escala, p.dy * escala, COR_PECA[p.camada] ?? '#ddd');
  });
  cotaH(ox, ox + d.x * escala, baseFrente + 22, medida(d.x, unidade));
  cotaV(ox - 18, oyFrente, baseFrente, '');
  texto(ox - 24, (oyFrente + baseFrente) / 2 + 4, medida(d.y, unidade), 'class="cota-txt" text-anchor="end"');

  // Vista lateral (olhando de +X para -X).
  texto(oxLado, oyFrente - 30, 'VISTA LATERAL', 'class="titulo-vista"');
  [...pecas].sort((a, b) => a.x + a.dx - (b.x + b.dx)).forEach((p) => {
    ret(oxLado + (d.z0 + d.z - (p.z + p.dz)) * escala, baseFrente - (p.y - d.y0 + p.dy) * escala, p.dz * escala, p.dy * escala, COR_PECA[p.camada] ?? '#ddd');
  });
  cotaH(oxLado, oxLado + d.z * escala, baseFrente + 22, medida(d.z, unidade));

  // Lista de peças (carimbo)
  const xl = areaW + 10;
  let yl = margem;
  texto(xl, yl, nome, 'class="titulo"');
  yl += 22;
  texto(xl, yl, `Medidas gerais: ${medida(d.x, unidade)} × ${medida(d.z, unidade)} × ${medida(d.y, unidade)}`, 'class="linha"');
  yl += 18;
  texto(xl, yl, `Data: ${new Date().toLocaleDateString('pt-BR')} · Unidade: ${unidade}`, 'class="linha"');
  yl += 34;
  texto(xl, yl, 'LISTA DE PEÇAS (C × L × E)', 'class="titulo-vista"');
  yl += 8;
  for (const g of grupos) {
    yl += 22;
    partes.push(`<rect x="${xl}" y="${yl - 11}" width="12" height="12" fill="${COR_PECA[g.camada] ?? '#ddd'}" stroke="#3b2a17" stroke-width="0.8"/>`);
    texto(xl + 20, yl, `${g.qtd}× ${g.nome}`, 'class="linha forte"');
    yl += 16;
    texto(xl + 20, yl, `${medida(g.comprimento, unidade)} × ${medida(g.largura, unidade)} × ${medida(g.espessura, unidade)}`, 'class="linha"');
  }
  yl += 34;
  texto(xl, yl, 'Desenho gerado pelo Montador de Pallets 3D.', 'class="nota"');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">
<style>
  .titulo { font-size: 20px; font-weight: 700; fill: #1d211c; }
  .titulo-vista { font-size: 12px; font-weight: 700; letter-spacing: 1.5px; fill: #3d4a3a; }
  .linha { font-size: 12px; fill: #1d211c; }
  .forte { font-weight: 700; }
  .nota { font-size: 10px; fill: #6a7366; }
  .cota line { stroke: #0f5fa8; stroke-width: 1; }
  .cota-txt { font-size: 12px; fill: #0f5fa8; font-weight: 700; }
</style>
<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
<rect x="12" y="12" width="${W - 24}" height="${H - 24}" fill="none" stroke="#1d211c" stroke-width="1.5"/>
<line x1="${areaW - 10}" y1="12" x2="${areaW - 10}" y2="${H - 12}" stroke="#1d211c" stroke-width="1"/>
${partes.join('\n')}
</svg>`;
}

// ---------------------------------------------------------------- CSV de custos

const n = (v, casas = 2) => numero(v, casas).replace(/\./g, '');

export function csvCustos({ nome, unidade, custos, resultado, capacidade, madeira }) {
  const linhas = [];
  const add = (...cols) => linhas.push(cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'));
  const { volume, pregos, itens } = resultado;
  add('Montador de Pallets 3D — resumo de custos');
  add('Montagem', nome);
  add('Data', new Date().toLocaleString('pt-BR'));
  add();
  add('LISTA DE CORTE');
  add('Peça', 'Camada', 'Qtd', `Comprimento (${unidade})`, `Largura (${unidade})`, `Espessura (${unidade})`, 'Volume unitário (m³)', 'Volume total (m³)', 'Códigos');
  for (const g of volume.grupos) {
    add(g.nome, camadaPorId[g.camada]?.nome ?? g.camada, g.qtd, medida(g.comprimento, unidade, false), medida(g.largura, unidade, false),
      medida(g.espessura, unidade, false), n(g.volUnit, 6), n(g.volTotal, 6), g.codigos.join(' '));
  }
  add();
  add('VOLUME');
  add('Volume líquido (m³)', n(volume.total, 6));
  add(`Perda (${n(custos.perdaPct, 1)}%) (m³)`, n(volume.perda, 6));
  add('Volume a comprar (m³)', n(volume.totalCompra, 6));
  add(`Peso estimado (kg) — densidade ${n(madeira.densidade, 0)} kg/m³`, n(volume.pesoKg, 1));
  add();
  add('CUSTOS POR PALLET', 'Base de cálculo', 'Valor (R$)');
  add('Madeira', `${n(volume.totalCompra, 6)} m³ × R$ ${n(custos.precoM3)}/m³`, n(itens.madeira));
  add('Pregos', `${pregos.quantidade} un × R$ ${n(custos.precoPrego, 3)}`, n(itens.pregos));
  add('Frete', `R$ ${n(custos.freteTotal)} ÷ ${custos.palletsPorFrete} pallets`, n(itens.frete));
  add('Outros custos', 'por pallet', n(itens.outros));
  add('Custo total', '', n(resultado.custoTotal));
  add(custos.tipoMargem === 'markup' ? `Markup ${n(custos.margemPct, 1)}%` : `Margem ${n(custos.margemPct, 1)}% sobre o preço`, '', '');
  add('Preço de venda sugerido', '', n(resultado.preco));
  add('Lucro por pallet', '', n(resultado.lucro));
  add();
  add(`PEDIDO DE ${resultado.pedido.qtd} PALLETS`);
  add('Custo total', '', n(resultado.pedido.custo));
  add('Venda total', '', n(resultado.pedido.venda));
  add('Lucro total', '', n(resultado.pedido.lucro));
  add();
  add('CAPACIDADE DE CARGA (ESTIMATIVA — NÃO É GARANTIA DE SEGURANÇA)');
  add('Carga estática distribuída estimada (kg)', Number.isFinite(capacidade.kg) ? n(capacidade.kg, 0) : 'não calculada');
  add('Camada limitante', capacidade.limitante?.nome ?? '—');
  add('Valide com ensaio (ex.: ISO 8611) ou responsável técnico antes de uso real.');
  return `﻿${linhas.join('\r\n')}`;
}

// ---------------------------------------------------------------- relatório HTML

export function relatorioHTML({ nome, unidade, custos, resultado, capacidade, madeira, imagemPNG, svg }) {
  const { volume, pregos, itens } = resultado;
  const linhasCorte = volume.grupos.map((g) => `<tr><td>${esc(g.nome)}</td><td>${g.qtd}</td>
    <td>${medida(g.comprimento, unidade)} × ${medida(g.largura, unidade)} × ${medida(g.espessura, unidade)}</td>
    <td class="n">${numero(g.volUnit, 6)}</td><td class="n">${numero(g.volTotal, 6)}</td><td>${esc(g.codigos.join(', '))}</td></tr>`).join('');
  const linhasCap = capacidade.camadas.map((c) => `<tr><td>${esc(c.nome)}</td><td>${c.qtd}</td>
    <td class="n">${Number.isFinite(c.kg) ? `${numero(c.kg, 0)} kg` : 'apoiada no chão'}</td></tr>`).join('');
  const svgLimpo = svg.replace(/^<\?xml[^>]*>\s*/, '').replace(/width="\d+" height="\d+"/, 'width="100%"');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(nome)} — relatório</title>
<style>
  body { font: 14px/1.5 Arial, Helvetica, sans-serif; color: #1d211c; margin: 24px auto; max-width: 960px; padding: 0 16px; }
  h1 { margin: 0 0 4px; } h2 { margin: 28px 0 8px; font-size: 16px; text-transform: uppercase; letter-spacing: 1px; color: #3d4a3a; }
  table { border-collapse: collapse; width: 100%; } td, th { border: 1px solid #cfd4cb; padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: #eef0eb; } .n { text-align: right; font-variant-numeric: tabular-nums; }
  .aviso { border: 2px solid #b35c00; background: #fff4e5; padding: 10px 14px; border-radius: 6px; }
  img { max-width: 100%; border: 1px solid #cfd4cb; border-radius: 6px; } .muted { color: #5d645a; }
  @media print { h2 { break-after: avoid; } table, img, svg { break-inside: avoid; } }
</style></head><body>
<h1>${esc(nome)}</h1>
<p class="muted">Gerado em ${new Date().toLocaleString('pt-BR')} · unidade das medidas: ${unidade}</p>
${imagemPNG ? `<h2>Vista 3D</h2><img src="${imagemPNG}" alt="Vista 3D do pallet">` : ''}
<h2>Desenho técnico</h2>${svgLimpo}
<h2>Lista de corte</h2>
<table><tr><th>Peça</th><th>Qtd</th><th>C × L × E</th><th>Vol. unit. (m³)</th><th>Vol. total (m³)</th><th>Códigos</th></tr>${linhasCorte}</table>
<h2>Volume de madeira</h2>
<table>
<tr><td>Volume líquido (soma das peças)</td><td class="n">${numero(volume.total, 6)} m³</td></tr>
<tr><td>Perda no corte (${numero(custos.perdaPct, 1)}%)</td><td class="n">${numero(volume.perda, 6)} m³</td></tr>
<tr><th>Volume a comprar</th><th class="n">${numero(volume.totalCompra, 6)} m³</th></tr>
<tr><td>Peso estimado (densidade ${numero(madeira.densidade, 0)} kg/m³)</td><td class="n">${numero(volume.pesoKg, 1)} kg</td></tr>
</table>
<h2>Custos por pallet</h2>
<table>
<tr><td>Madeira: ${numero(volume.totalCompra, 6)} m³ × ${moeda(custos.precoM3)}/m³</td><td class="n">${moeda(itens.madeira)}</td></tr>
<tr><td>Pregos: ${pregos.quantidade} un × ${moeda(custos.precoPrego)}</td><td class="n">${moeda(itens.pregos)}</td></tr>
<tr><td>Frete: ${moeda(custos.freteTotal)} ÷ ${custos.palletsPorFrete} pallets</td><td class="n">${moeda(itens.frete)}</td></tr>
<tr><td>Outros custos</td><td class="n">${moeda(itens.outros)}</td></tr>
<tr><th>Custo total</th><th class="n">${moeda(resultado.custoTotal)}</th></tr>
<tr><td>${custos.tipoMargem === 'markup' ? `Markup de ${numero(custos.margemPct, 1)}% sobre o custo` : `Margem de ${numero(custos.margemPct, 1)}% sobre o preço`}</td><td class="n">lucro ${moeda(resultado.lucro)}</td></tr>
<tr><th>Preço de venda sugerido</th><th class="n">${moeda(resultado.preco)}</th></tr>
<tr><td>Pedido de ${resultado.pedido.qtd} pallets: custo / venda / lucro</td><td class="n">${moeda(resultado.pedido.custo)} / ${moeda(resultado.pedido.venda)} / ${moeda(resultado.pedido.lucro)}</td></tr>
</table>
<h2>Capacidade de carga — estimativa</h2>
<p class="aviso"><strong>Estimativa teórica, não é garantia de segurança.</strong> Carga estática distribuída estimada:
<strong>${Number.isFinite(capacidade.kg) ? `≈ ${numero(capacidade.kg, 0)} kg` : 'não calculada'}</strong>
${capacidade.limitante ? ` (camada mais fraca: ${esc(capacidade.limitante.nome)})` : ''}.
O valor real depende da qualidade da madeira, da pregação e do uso (empilhadeira, porta-pallet, carga concentrada).
Valide com ensaio (ex.: ISO 8611) ou com um responsável técnico antes de usar.</p>
<table><tr><th>Camada</th><th>Peças</th><th>Capacidade estimada</th></tr>${linhasCap}</table>
<p class="muted">Madeira: ${esc(madeira.nomeEspecie ?? '')} · flexão adotada ${numero(madeira.fm, 1)} MPa · compressão normal ${numero(madeira.fc90, 1)} MPa · fator de segurança ${numero(madeira.fatorSeguranca, 1)}</p>
</body></html>`;
}

export function rotuloMedidas(p, unidade) {
  const m = medidasPeca(p);
  return `${medida(m.comprimento, unidade, false)} × ${medida(m.largura, unidade, false)} × ${medida(m.espessura, unidade)}`;
}
