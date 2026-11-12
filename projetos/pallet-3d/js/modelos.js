// Modelos prontos de pallet e regras das peças.
//
// Sistema de eixos (igual ao da cena 3D):
//   X = comprimento do pallet (esquerda → direita)
//   Y = altura (chão → topo)
//   Z = largura do pallet (fundo → frente)
// Cada peça guarda o canto mínimo (x, y, z) e o tamanho (dx, dy, dz), tudo em mm.

/** Camadas de baixo para cima. A "ordem" também define a separação na vista explodida. */
export const CAMADAS = [
  { id: 'inferior', nome: 'Tábuas inferiores (base)', curto: 'Base', prefixo: 'TI', tipo: 'tabua', ordem: 0 },
  { id: 'tocos', nome: 'Tocos (blocos)', curto: 'Tocos', prefixo: 'TC', tipo: 'toco', ordem: 1 },
  { id: 'travessa', nome: 'Travessas', curto: 'Travessas', prefixo: 'TR', tipo: 'tabua', ordem: 2 },
  { id: 'superior', nome: 'Tábuas superiores (face)', curto: 'Face', prefixo: 'TS', tipo: 'tabua', ordem: 3 },
];

export const camadaPorId = Object.fromEntries(CAMADAS.map((c) => [c.id, c]));

export const TIPOS = {
  tabua: { nome: 'Tábuas', singular: 'Tábua' },
  toco: { nome: 'Tocos', singular: 'Toco' },
};

/** Modelos de toco. dx = comprimento, dy = altura, dz = largura (mm). */
export const ESTILOS_TOCO = {
  pequeno: { nome: 'Pequeno', rotulo: 'Toco pequeno', dx: 80, dy: 70, dz: 80 },
  pbr: { nome: 'Estilo PBR', rotulo: 'Toco estilo PBR', dx: 100, dy: 78, dz: 100 },
  livre: { nome: 'Personalizado', rotulo: 'Toco' },
};

let contadorId = 0;
export function novoId() {
  contadorId += 1;
  return `p${Date.now().toString(36)}${contadorId.toString(36)}`;
}

export function criarPeca(dados) {
  const camada = dados.camada ?? (dados.tipo === 'toco' ? 'tocos' : 'superior');
  return {
    id: dados.id ?? novoId(),
    codigo: '',
    tipo: dados.tipo ?? camadaPorId[camada].tipo,
    camada,
    estilo: dados.estilo ?? (dados.tipo === 'toco' ? 'livre' : undefined),
    x: dados.x ?? 0,
    y: dados.y ?? 0,
    z: dados.z ?? 0,
    dx: dados.dx,
    dy: dados.dy,
    dz: dados.dz,
  };
}

// ---------------------------------------------------------------- modelos (por parâmetros)

/**
 * O pallet é gerado a partir de poucos números (a "configuração").
 * Mexer num controle deslizante gera o pallet de novo, na hora.
 */
export const LIMITES = {
  comprimento: { min: 600, max: 1600, passo: 10 },
  largura: { min: 600, max: 1600, passo: 10 },
  tabuas: { min: 3, max: 12, passo: 1 },
  espessura: { min: 12, max: 40, passo: 1 },
};

export const MODELOS = [
  { id: 'pbr', nome: 'PBR', descricao: '1200 × 1000, tocos PBR',
    config: { comprimento: 1200, largura: 1000, tabuas: 7, espessura: 22, toco: 'pbr', base: true } },
  { id: 'europeu', nome: 'Europeu', descricao: '1200 × 800',
    config: { comprimento: 1200, largura: 800, tabuas: 5, espessura: 22, toco: 'pbr', base: true } },
  { id: 'descartavel', nome: 'Descartável', descricao: '1200 × 1000, tocos pequenos, sem base',
    config: { comprimento: 1200, largura: 1000, tabuas: 5, espessura: 18, toco: 'pequeno', base: false } },
  { id: 'quadrado', nome: 'Quadrado', descricao: '1100 × 1100',
    config: { comprimento: 1100, largura: 1100, tabuas: 8, espessura: 22, toco: 'pbr', base: true } },
];

const LARGURA_TABUA = 100;

/** Garante que a configuração está dentro dos limites. */
export function limparConfig(c = {}) {
  const base = MODELOS[0].config;
  const lim = (k) => {
    const v = Number.isFinite(c[k]) ? c[k] : base[k];
    return Math.min(LIMITES[k].max, Math.max(LIMITES[k].min, Math.round(v / LIMITES[k].passo) * LIMITES[k].passo));
  };
  const largura = lim('largura');
  return {
    comprimento: lim('comprimento'),
    largura,
    // As tábuas da face não podem passar da largura do pallet.
    tabuas: Math.min(lim('tabuas'), Math.floor(largura / LARGURA_TABUA)),
    espessura: lim('espessura'),
    toco: c.toco === 'pequeno' ? 'pequeno' : 'pbr',
    base: c.base !== false,
  };
}

/**
 * Gera as peças: 9 tocos em grade 3 × 3, travessas sobre cada coluna de tocos,
 * tábuas da face espaçadas por igual e (opcional) 3 tábuas de base.
 * Os ids são fixos (ex.: "face-3"), assim a cena 3D anima as peças de um formato para outro.
 */
export function gerarPallet(config) {
  const c = limparConfig(config);
  const t = ESTILOS_TOCO[c.toco];
  const X = c.comprimento;
  const Z = c.largura;
  const e = c.espessura;
  const colunas = [0, (X - t.dx) / 2, X - t.dx];
  const linhas = [0, (Z - t.dz) / 2, Z - t.dz];
  const p = [];
  if (c.base) {
    linhas.forEach((z, i) => p.push(criarPeca({ id: `base-${i}`, tipo: 'tabua', camada: 'inferior', x: 0, z, dx: X, dy: e, dz: t.dz })));
  }
  colunas.forEach((x, i) => linhas.forEach((z, j) => p.push(criarPeca({
    id: `toco-${i}-${j}`, tipo: 'toco', camada: 'tocos', estilo: c.toco, x, z, dx: t.dx, dy: t.dy, dz: t.dz,
  }))));
  colunas.forEach((x, i) => p.push(criarPeca({ id: `trav-${i}`, tipo: 'tabua', camada: 'travessa', x, z: 0, dx: t.dx, dy: e, dz: Z })));
  const passo = c.tabuas > 1 ? (Z - LARGURA_TABUA) / (c.tabuas - 1) : 0;
  for (let i = 0; i < c.tabuas; i++) {
    p.push(criarPeca({ id: `face-${i}`, tipo: 'tabua', camada: 'superior', x: 0, z: i * passo, dx: X, dy: e, dz: LARGURA_TABUA }));
  }
  const pecas = p.map((q) => ({ ...q, x: arred(q.x), z: arred(q.z) }));
  empilhar(pecas);
  renumerar(pecas);
  return pecas;
}

export function gerarModelo(id) {
  const modelo = MODELOS.find((m) => m.id === id) ?? MODELOS[0];
  return gerarPallet(modelo.config);
}

function arred(v) {
  return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------- regras

/**
 * Empilhamento automático: cada camada começa onde a camada de baixo termina.
 * Assim, se a altura dos tocos mudar, as travessas e a face sobem junto.
 */
export function empilhar(pecas) {
  let base = 0;
  for (const camada of CAMADAS) {
    const daCamada = pecas.filter((p) => p.camada === camada.id);
    if (!daCamada.length) continue;
    for (const p of daCamada) p.y = base;
    base += Math.max(...daCamada.map((p) => p.dy));
  }
  return pecas;
}

/**
 * Gera os códigos das peças: tocos = TC-01, TC-02…; tábuas pelo prefixo da camada
 * (TI = inferior, TR = travessa, TS = superior, TM = tábua na camada dos tocos).
 * Ordem: camada de baixo para cima, depois fundo → frente, esquerda → direita.
 */
export function renumerar(pecas) {
  const ordem = (p) => camadaPorId[p.camada]?.ordem ?? 9;
  const ordenadas = [...pecas].sort((a, b) => ordem(a) - ordem(b) || a.z - b.z || a.x - b.x || a.y - b.y);
  const contagem = {};
  for (const p of ordenadas) {
    let prefixo = 'TC';
    if (p.tipo === 'tabua') prefixo = p.camada === 'tocos' ? 'TM' : camadaPorId[p.camada].prefixo;
    contagem[prefixo] = (contagem[prefixo] ?? 0) + 1;
    p.codigo = `${prefixo}-${String(contagem[prefixo]).padStart(2, '0')}`;
  }
  return pecas;
}

/** Comprimento, largura e espessura "de marceneiro" (maior medida horizontal = comprimento). */
export function medidasPeca(p) {
  const comprimento = Math.max(p.dx, p.dz);
  const largura = Math.min(p.dx, p.dz);
  return { comprimento, largura, espessura: p.dy };
}

const NOME_SINGULAR = {
  inferior: 'Tábua inferior',
  tocos: 'Tábua na camada dos tocos',
  travessa: 'Travessa',
  superior: 'Tábua superior',
};

export function nomePeca(p) {
  if (p.tipo === 'toco') {
    return (ESTILOS_TOCO[p.estilo] ?? ESTILOS_TOCO.livre).rotulo;
  }
  return NOME_SINGULAR[p.camada] ?? 'Tábua';
}

/** Retângulo ocupado pela peça. */
export function caixa(p) {
  return {
    x0: p.x, x1: p.x + p.dx,
    y0: p.y, y1: p.y + p.dy,
    z0: p.z, z1: p.z + p.dz,
  };
}

/** Medidas totais do pallet montado (mm). */
export function dimensoesTotais(pecas) {
  if (!pecas.length) return { x: 0, y: 0, z: 0, x0: 0, y0: 0, z0: 0 };
  const c = pecas.map(caixa);
  const x0 = Math.min(...c.map((b) => b.x0));
  const y0 = Math.min(...c.map((b) => b.y0));
  const z0 = Math.min(...c.map((b) => b.z0));
  return {
    x0, y0, z0,
    x: Math.max(...c.map((b) => b.x1)) - x0,
    y: Math.max(...c.map((b) => b.y1)) - y0,
    z: Math.max(...c.map((b) => b.z1)) - z0,
  };
}
