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

// ---------------------------------------------------------------- modelos

function tabua(camada, x, z, dx, dy, dz) {
  return criarPeca({ tipo: 'tabua', camada, x, z, dx, dy, dz });
}

function toco(estilo, x, z, dx, dy, dz) {
  return criarPeca({ tipo: 'toco', camada: 'tocos', estilo, x, z, dx, dy, dz });
}

function pbr() {
  // 1200 × 1000 mm, 4 entradas, tocos 100 × 100 × 78.
  const p = [];
  for (const z of [0, 450, 900]) p.push(tabua('inferior', 0, z, 1200, 22, 100));
  for (const x of [0, 550, 1100]) {
    for (const z of [0, 450, 900]) p.push(toco('pbr', x, z, 100, 78, 100));
  }
  for (const x of [0, 550, 1100]) p.push(tabua('travessa', x, 0, 100, 22, 1000));
  for (const z of [0, 150, 300, 450, 600, 750, 900]) p.push(tabua('superior', 0, z, 1200, 22, 100));
  return p;
}

function europeu() {
  // 1200 × 800 mm. Tábuas das bordas e do meio mais largas (145 mm).
  const p = [];
  p.push(tabua('inferior', 0, 0, 1200, 22, 100));
  p.push(tabua('inferior', 0, 327.5, 1200, 22, 145));
  p.push(tabua('inferior', 0, 700, 1200, 22, 100));
  for (const x of [0, 527.5, 1055]) {
    p.push(toco('livre', x, 0, 145, 78, 100));
    p.push(toco('livre', x, 327.5, 145, 78, 145));
    p.push(toco('livre', x, 700, 145, 78, 100));
  }
  for (const x of [0, 527.5, 1055]) p.push(tabua('travessa', x, 0, 145, 22, 800));
  const face = [[0, 145], [186.25, 100], [327.5, 145], [513.75, 100], [655, 145]];
  for (const [z, l] of face) p.push(tabua('superior', 0, z, 1200, 22, l));
  return p;
}

function descartavel() {
  // 1200 × 1000 mm, uso único: sem base, tocos pequenos e tábuas finas.
  const p = [];
  for (const x of [0, 560, 1120]) {
    for (const z of [0, 460, 920]) p.push(toco('pequeno', x, z, 80, 70, 80));
  }
  for (const x of [0, 560, 1120]) p.push(tabua('travessa', x, 0, 80, 20, 1000));
  for (const z of [0, 225, 450, 675, 900]) p.push(tabua('superior', 0, z, 1200, 18, 100));
  return p;
}

function quadrado() {
  // 1100 × 1100 mm, tocos estilo PBR.
  const p = [];
  for (const z of [0, 500, 1000]) p.push(tabua('inferior', 0, z, 1100, 22, 100));
  for (const x of [0, 500, 1000]) {
    for (const z of [0, 500, 1000]) p.push(toco('pbr', x, z, 100, 78, 100));
  }
  for (const x of [0, 500, 1000]) p.push(tabua('travessa', x, 0, 100, 22, 1100));
  for (let i = 0; i < 8; i++) p.push(tabua('superior', 0, i * 142.857, 1100, 22, 100));
  return p;
}

export const MODELOS = [
  { id: 'pbr', nome: 'PBR 1200 × 1000 (tocos PBR)', gerar: pbr },
  { id: 'europeu', nome: 'Europeu 1200 × 800', gerar: europeu },
  { id: 'descartavel', nome: 'Descartável 1200 × 1000 (tocos pequenos)', gerar: descartavel },
  { id: 'quadrado', nome: 'Quadrado 1100 × 1100 (tocos PBR)', gerar: quadrado },
];

export function gerarModelo(id) {
  const modelo = MODELOS.find((m) => m.id === id) ?? MODELOS[0];
  const pecas = modelo.gerar().map((p) => ({
    ...p,
    x: arred(p.x), z: arred(p.z), dx: arred(p.dx), dz: arred(p.dz),
  }));
  empilhar(pecas);
  renumerar(pecas);
  return pecas;
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
