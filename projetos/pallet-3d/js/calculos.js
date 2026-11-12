// Cálculos do pallet: volume, pregos, custos, preço de venda e estimativa de carga.
// Funções "puras": recebem dados e devolvem resultados, sem mexer na tela.
// Isso facilita testar (veja tests/calculos.test.mjs).

import { CAMADAS, camadaPorId, caixa, medidasPeca, nomePeca } from './modelos.js';

const G = 9.81; // aceleração da gravidade (m/s²), para converter N → kgf
const TOL = 0.5; // tolerância em mm para considerar que duas faces se encostam

/**
 * Madeiras de referência. Os valores são APROXIMADOS e servem de ponto de partida.
 * densidade: kg/m³ (madeira seca) · fm: resistência à flexão adotada (MPa)
 * fc90: compressão perpendicular às fibras adotada (MPa) · precoM3: R$/m³ (exemplo)
 */
export const ESPECIES = {
  pinus: { nome: 'Pinus', densidade: 500, fm: 25, fc90: 3, precoM3: 1500 },
  eucalipto: { nome: 'Eucalipto', densidade: 650, fm: 40, fc90: 6, precoM3: 1800 },
  personalizada: { nome: 'Personalizada' },
};

export const MADEIRA_PADRAO = {
  especie: 'pinus',
  densidade: 500,
  fm: 25,
  fc90: 3,
  fatorSeguranca: 2.5,
};

export const CUSTOS_PADRAO = {
  precoM3: 1500, // R$ por m³ de madeira
  perdaPct: 10, // % de desperdício no corte
  precoPrego: 0.07, // R$ por prego
  pregosPorLigacao: 3, // pregos em cada encontro entre duas peças
  pregosManual: null, // se preenchido, substitui a contagem automática
  freteTotal: 600, // R$ por viagem/carga
  palletsPorFrete: 120, // quantos pallets vão na mesma carga
  outros: 10, // R$ por pallet (mão de obra, energia, tratamento…)
  margemPct: 25,
  tipoMargem: 'margem', // 'margem' (sobre o preço) ou 'markup' (sobre o custo)
  quantidadePedido: 100,
};

// ---------------------------------------------------------------- volume

export function volumePecaM3(p) {
  return (p.dx / 1000) * (p.dy / 1000) * (p.dz / 1000);
}

/** Agrupa peças iguais (mesmo tipo, camada e medidas) — é a "lista de corte". */
export function agruparIguais(pecas) {
  const grupos = new Map();
  for (const p of pecas) {
    const m = medidasPeca(p);
    const chave = [p.tipo, p.camada, m.comprimento, m.largura, m.espessura].join('|');
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        chave,
        tipo: p.tipo,
        camada: p.camada,
        nome: nomePeca(p),
        ...m,
        qtd: 0,
        codigos: [],
        ids: [],
        volUnit: volumePecaM3(p),
      });
    }
    const g = grupos.get(chave);
    g.qtd += 1;
    g.codigos.push(p.codigo);
    g.ids.push(p.id);
  }
  const ordem = (g) => (camadaPorId[g.camada]?.ordem ?? 9) * 10 + (g.tipo === 'toco' ? 0 : 1);
  return [...grupos.values()]
    .map((g) => ({ ...g, volTotal: g.volUnit * g.qtd }))
    .sort((a, b) => ordem(b) - ordem(a) || b.comprimento - a.comprimento);
}

export function calcularVolume(pecas, perdaPct = 0, densidade = 0) {
  const grupos = agruparIguais(pecas);
  const total = grupos.reduce((s, g) => s + g.volTotal, 0);
  const perda = total * (perdaPct / 100);
  return {
    grupos,
    total,
    perdaPct,
    perda,
    totalCompra: total + perda,
    pesoKg: total * densidade,
    densidade,
  };
}

// ---------------------------------------------------------------- contatos

function sobreposicao(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * Encontra os pontos onde uma peça está apoiada em outra
 * (face de cima de uma encostando na face de baixo da outra, com área em comum).
 */
export function encontrarContatos(pecas) {
  const contatos = [];
  const cx = pecas.map(caixa);
  for (let i = 0; i < pecas.length; i++) {
    for (let j = 0; j < pecas.length; j++) {
      if (i === j) continue;
      const baixo = cx[i];
      const cima = cx[j];
      if (Math.abs(baixo.y1 - cima.y0) > TOL) continue;
      const ox = sobreposicao(baixo.x0, baixo.x1, cima.x0, cima.x1);
      const oz = sobreposicao(baixo.z0, baixo.z1, cima.z0, cima.z1);
      if (ox > TOL && oz > TOL) {
        contatos.push({ baixo: pecas[i].id, cima: pecas[j].id, area: ox * oz });
      }
    }
  }
  return contatos;
}

/** Peças que se atravessam (ocupam o mesmo espaço). */
export function encontrarSobreposicoes(pecas) {
  const ids = new Set();
  const cx = pecas.map(caixa);
  for (let i = 0; i < pecas.length; i++) {
    for (let j = i + 1; j < pecas.length; j++) {
      const a = cx[i];
      const b = cx[j];
      const ox = sobreposicao(a.x0, a.x1, b.x0, b.x1);
      const oy = sobreposicao(a.y0, a.y1, b.y0, b.y1);
      const oz = sobreposicao(a.z0, a.z1, b.z0, b.z1);
      if (ox > TOL && oy > TOL && oz > TOL) {
        ids.add(pecas[i].id);
        ids.add(pecas[j].id);
      }
    }
  }
  return ids;
}

/** Peças "flutuando": não estão no chão e não têm nada embaixo. */
export function encontrarSemApoio(pecas, contatos = encontrarContatos(pecas)) {
  if (!pecas.length) return new Set();
  const chao = Math.min(...pecas.map((p) => p.y));
  const apoiadas = new Set(contatos.map((c) => c.cima));
  return new Set(pecas.filter((p) => p.y - chao > TOL && !apoiadas.has(p.id)).map((p) => p.id));
}

export function verificarProblemas(pecas) {
  const contatos = encontrarContatos(pecas);
  return {
    sobrepostas: encontrarSobreposicoes(pecas),
    semApoio: encontrarSemApoio(pecas, contatos),
    contatos,
  };
}

// ---------------------------------------------------------------- pregos e custos

export function calcularPregos(pecas, custos, contatos = encontrarContatos(pecas)) {
  const ligacoes = contatos.length;
  const automatico = ligacoes * custos.pregosPorLigacao;
  const manual = Number.isFinite(custos.pregosManual) && custos.pregosManual >= 0;
  return {
    ligacoes,
    porLigacao: custos.pregosPorLigacao,
    automatico,
    manual,
    quantidade: manual ? custos.pregosManual : automatico,
  };
}

export function precoVenda(custo, margemPct, tipoMargem) {
  const m = margemPct / 100;
  if (tipoMargem === 'markup') return custo * (1 + m);
  if (m >= 1) return NaN; // margem de 100% ou mais sobre o preço é impossível
  return custo / (1 - m);
}

export function calcularCustos(pecas, custos, madeira = MADEIRA_PADRAO) {
  const volume = calcularVolume(pecas, custos.perdaPct, madeira.densidade);
  const pregos = calcularPregos(pecas, custos);
  const madeiraR = volume.totalCompra * custos.precoM3;
  const pregosR = pregos.quantidade * custos.precoPrego;
  const freteR = custos.palletsPorFrete > 0 ? custos.freteTotal / custos.palletsPorFrete : 0;
  const outrosR = custos.outros || 0;
  const custoTotal = madeiraR + pregosR + freteR + outrosR;
  const preco = precoVenda(custoTotal, custos.margemPct, custos.tipoMargem);
  const lucro = preco - custoTotal;
  const qtd = Math.max(0, Math.round(custos.quantidadePedido || 0));
  return {
    volume,
    pregos,
    itens: { madeira: madeiraR, pregos: pregosR, frete: freteR, outros: outrosR },
    custoTotal,
    preco,
    lucro,
    margemReal: preco > 0 ? lucro / preco : NaN,
    pedido: { qtd, custo: custoTotal * qtd, venda: preco * qtd, lucro: lucro * qtd },
  };
}

// ---------------------------------------------------------------- capacidade de carga

/** Junta intervalos [a, b] que se encostam ou se sobrepõem. */
function unirIntervalos(lista) {
  const ord = lista.filter(([a, b]) => b - a > TOL).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [a, b] of ord) {
    const ult = out[out.length - 1];
    if (ult && a <= ult[1] + TOL) ult[1] = Math.max(ult[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Capacidade de UMA tábua em flexão, tratando-a como viga com carga distribuída.
 *   vão entre apoios:  q = 8·σ·W / L²   (viga biapoiada)
 *   balanço na ponta:  q = 2·σ·W / a²   (viga em balanço)
 *   W = b·h²/6 (módulo resistente da seção) · σ = fm / fator de segurança
 * Capacidade da tábua (N) = menor q × comprimento da tábua.
 */
function capacidadeTabua(p, apoios, sigma, noChao) {
  const eixoX = p.dx >= p.dz;
  const ini = eixoX ? p.x : p.z;
  const comp = eixoX ? p.dx : p.dz;
  const b = eixoX ? p.dz : p.dx;
  const h = p.dy;
  const W = (b * h * h) / 6;

  if (noChao) return { N: Infinity, motivo: 'apoiada no chão' };
  if (!apoios.length) return { N: 0, motivo: 'sem apoio embaixo' };

  const intervalos = unirIntervalos(apoios.map((a) => {
    const c = caixa(a);
    return eixoX ? [Math.max(c.x0, p.x), Math.min(c.x1, p.x + p.dx)]
      : [Math.max(c.z0, p.z), Math.min(c.z1, p.z + p.dz)];
  }));
  if (!intervalos.length) return { N: 0, motivo: 'sem apoio embaixo' };

  let qMin = Infinity;
  let critico = null;
  for (let i = 1; i < intervalos.length; i++) {
    const vaoLivre = intervalos[i][0] - intervalos[i - 1][1];
    const L = vaoLivre + h; // vão de cálculo ≈ vão livre + espessura
    const q = (8 * sigma * W) / (L * L);
    if (q < qMin) { qMin = q; critico = { tipo: 'vão', L, vaoLivre }; }
  }
  const balancos = [intervalos[0][0] - ini, ini + comp - intervalos[intervalos.length - 1][1]];
  for (const a of balancos) {
    if (a > 5) {
      const q = (2 * sigma * W) / (a * a);
      if (q < qMin) { qMin = q; critico = { tipo: 'balanço', L: a }; }
    }
  }
  if (!critico) return { N: Infinity, motivo: 'apoiada em todo o comprimento' };
  return { N: qMin * comp, q: qMin, W, b, h, comp, critico, motivo: critico.tipo };
}

/**
 * ESTIMATIVA de carga estática uniformemente distribuída, com o pallet no chão.
 * Modelo bem simplificado: cada camada precisa aguentar a carga inteira;
 * a camada mais fraca define o resultado. NÃO substitui ensaio nem projeto técnico.
 */
export function calcularCapacidade(pecas, madeira = MADEIRA_PADRAO) {
  const sigma = madeira.fm / madeira.fatorSeguranca; // N/mm² (MPa)
  const fc90 = madeira.fc90 / madeira.fatorSeguranca;
  const contatos = encontrarContatos(pecas);
  const porId = Object.fromEntries(pecas.map((p) => [p.id, p]));
  const chao = pecas.length ? Math.min(...pecas.map((p) => p.y)) : 0;

  const detalhes = pecas.map((p) => {
    if (p.tipo === 'toco') {
      const area = p.dx * p.dz;
      return { id: p.id, codigo: p.codigo, camada: p.camada, N: area * fc90, area, motivo: 'compressão' };
    }
    const apoios = contatos.filter((c) => c.cima === p.id).map((c) => porId[c.baixo]);
    return { id: p.id, codigo: p.codigo, camada: p.camada, ...capacidadeTabua(p, apoios, sigma, p.y - chao <= TOL) };
  });

  const camadas = CAMADAS.map((c) => {
    const d = detalhes.filter((x) => x.camada === c.id);
    if (!d.length) return null;
    const N = d.reduce((s, x) => s + x.N, 0);
    // A peça mais fraca da camada, para mostrar o cálculo.
    const finitos = d.filter((x) => Number.isFinite(x.N));
    const pior = finitos.sort((a, b) => a.N - b.N)[0] ?? null;
    return { id: c.id, nome: c.nome, N, kg: N / G, qtd: d.length, pior };
  }).filter(Boolean);

  const limitantes = camadas.filter((c) => Number.isFinite(c.N));
  const limitante = limitantes.sort((a, b) => a.N - b.N)[0] ?? null;
  const semApoio = detalhes.filter((d) => d.N === 0).map((d) => d.codigo);

  return {
    sigma,
    fc90,
    camadas: CAMADAS.map((c) => camadas.find((x) => x.id === c.id)).filter(Boolean),
    limitante,
    kg: limitante ? limitante.kg : NaN,
    semApoio,
  };
}

export { G };
