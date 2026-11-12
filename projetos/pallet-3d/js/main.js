// Controlador da interface: guarda a montagem e liga a tela, a cena 3D e os cálculos.

import { Cena3D } from './cena3d.js';
import {
  CAMADAS, ESTILOS_TOCO, LIMITES, MODELOS, TIPOS, criarPeca, dimensoesTotais,
  empilhar, gerarPallet, limparConfig, medidasPeca, nomePeca, renumerar,
} from './modelos.js';
import {
  CUSTOS_PADRAO, ESPECIES, G, MADEIRA_PADRAO, calcularCapacidade, calcularCustos, verificarProblemas,
} from './calculos.js';
import { UNIDADES, lerNumero, medida, moeda, numero, paraMm, valorCampo } from './unidades.js';
import { baixar, csvCustos, desenhoSVG, nomeArquivo, relatorioHTML } from './exportar.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- armazenamento no navegador

const CHAVE_ATUAL = 'pallet3d:atual';
const CHAVE_SALVOS = 'pallet3d:salvos';
const CHAVE_PRECOS = 'pallet3d:precos';

const local = {
  ler(chave, padrao) {
    try {
      const t = localStorage.getItem(chave);
      return t ? JSON.parse(t) : padrao;
    } catch {
      return padrao;
    }
  },
  gravar(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
      return true;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------- estado

const nomePadrao = (id) => `Pallet ${(MODELOS.find((m) => m.id === id) ?? MODELOS[0]).nome}`;

function limparNumeros(obj, padrao) {
  const out = { ...padrao };
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(padrao)) {
    if ((typeof v === 'number' || v === null) && Number.isFinite(obj[k])) out[k] = obj[k];
  }
  return out;
}

function estadoInicial(modeloId = 'pbr') {
  const modelo = MODELOS.find((m) => m.id === modeloId) ?? MODELOS[0];
  return {
    versao: 2,
    nome: nomePadrao(modelo.id),
    modeloId: modelo.id,
    config: { ...modelo.config },
    unidade: 'mm',
    pecas: gerarPallet(modelo.config),
    custos: { ...limparNumeros(local.ler(CHAVE_PRECOS, {}), CUSTOS_PADRAO), tipoMargem: 'margem' },
    madeira: { ...MADEIRA_PADRAO },
  };
}

/** Confere um estado vindo de arquivo ou do navegador. Devolve null se não servir. */
function validar(o) {
  if (!o || typeof o !== 'object') return null;
  const campos = ['x', 'y', 'z', 'dx', 'dy', 'dz'];
  const config = limparConfig(o.config ?? MODELOS.find((m) => m.id === o.modeloId)?.config);
  let pecas = Array.isArray(o.pecas) ? o.pecas
    .filter((p) => p && campos.every((k) => Number.isFinite(p[k])) && p.dx > 0 && p.dy > 0 && p.dz > 0)
    .map((p) => criarPeca({
      ...p,
      tipo: p.tipo === 'toco' ? 'toco' : 'tabua',
      camada: CAMADAS.some((c) => c.id === p.camada) ? p.camada : undefined,
      estilo: p.tipo === 'toco' ? (ESTILOS_TOCO[p.estilo] ? p.estilo : 'livre') : undefined,
    })) : null;
  if (!pecas || !pecas.length) pecas = gerarPallet(config);
  const custos = { ...limparNumeros(o.custos, CUSTOS_PADRAO), tipoMargem: o.custos?.tipoMargem === 'markup' ? 'markup' : 'margem' };
  const madeira = limparNumeros(o.madeira, MADEIRA_PADRAO);
  madeira.especie = ESPECIES[o.madeira?.especie] ? o.madeira.especie : 'pinus';
  return {
    versao: 2,
    nome: String(o.nome || 'Pallet').slice(0, 60),
    modeloId: MODELOS.some((m) => m.id === o.modeloId) ? o.modeloId : 'pbr',
    config,
    unidade: UNIDADES[o.unidade] ? o.unidade : 'mm',
    pecas,
    custos,
    madeira,
  };
}

let estado = validar(local.ler(CHAVE_ATUAL, null)) ?? estadoInicial();
const ui = { selecionado: null, explodida: false, arrastando: false };
let problemas = { sobrepostas: new Set(), semApoio: new Set() };
let resultado = null;
let capacidade = null;
let cena = null;

// ---------------------------------------------------------------- desfazer

const historico = [];
const foto = () => JSON.stringify({
  nome: estado.nome, modeloId: estado.modeloId, config: estado.config,
  pecas: estado.pecas, custos: estado.custos, madeira: estado.madeira,
});
let fotoFoco = null;

function registrar(f = foto()) {
  if (historico[historico.length - 1] === f) return;
  historico.push(f);
  if (historico.length > 120) historico.shift();
}

function desfazer() {
  if (!historico.length) return;
  estado = { ...estado, ...JSON.parse(historico.pop()) };
  if (ui.selecionado && !estado.pecas.some((p) => p.id === ui.selecionado)) ui.selecionado = null;
  atualizar();
  avisar('Alteração desfeita');
}

/** Guarda o estado quando a pessoa começa a mexer num campo ou controle deslizante… */
function marcarInicio() { fotoFoco = foto(); }
/** …e registra no histórico quando termina, se algo mudou. */
function marcarFim() {
  if (fotoFoco && fotoFoco !== foto()) registrar(fotoFoco);
  fotoFoco = null;
  renderTopo();
}

// ---------------------------------------------------------------- ciclo de atualização

const pecaSel = () => estado.pecas.find((p) => p.id === ui.selecionado) ?? null;

function atualizar() {
  empilhar(estado.pecas);
  renumerar(estado.pecas);
  problemas = verificarProblemas(estado.pecas);
  resultado = calcularCustos(estado.pecas, estado.custos, estado.madeira);
  capacidade = calcularCapacidade(estado.pecas, estado.madeira);

  cena?.atualizar(estado.pecas, { selecionado: ui.selecionado, unidade: estado.unidade });
  renderTopo();
  renderControles();
  renderLista();
  renderEditor();
  renderResumo();
  renderVolume();
  renderCustos();
  renderCapacidade();
  preencherVinculos();
  local.gravar(CHAVE_ATUAL, estado);
}

function selecionar(id, { rolarLista = false } = {}) {
  ui.selecionado = id && estado.pecas.some((p) => p.id === id) ? id : null;
  cena?.selecionar(ui.selecionado);
  renderEditor();
  for (const el of $$('#lista .item')) {
    const ativo = el.dataset.id === ui.selecionado;
    el.setAttribute('aria-current', String(ativo));
    if (ativo && rolarLista) {
      const lista = $('#lista');
      const topo = el.offsetTop - lista.offsetTop;
      if (topo < lista.scrollTop || topo > lista.scrollTop + lista.clientHeight - el.offsetHeight) {
        lista.scrollTop = topo - lista.clientHeight / 2;
      }
    }
  }
  for (const tr of $$('#vol-tabela tr[data-ids]')) {
    tr.classList.toggle('ativo', Boolean(ui.selecionado) && tr.dataset.ids.split(',').includes(ui.selecionado));
  }
}

// ---------------------------------------------------------------- topo e controles de montagem

function renderTopo() {
  const nome = $('#nome-montagem');
  if (document.activeElement !== nome) nome.value = estado.nome;
  for (const b of $$('#unidades button')) b.setAttribute('aria-checked', String(b.dataset.unidade === estado.unidade));
  $('#btn-desfazer').disabled = !historico.length;
  const bx = $('#btn-explodida');
  bx.setAttribute('aria-pressed', String(ui.explodida));
  $('span', bx).textContent = ui.explodida ? 'Montar de novo' : 'Vista explodida';
}

const CONTROLES = [
  { chave: 'comprimento', rotulo: 'Comprimento', medida: true },
  { chave: 'largura', rotulo: 'Largura', medida: true },
  { chave: 'tabuas', rotulo: 'Tábuas na face', medida: false },
  { chave: 'espessura', rotulo: 'Espessura das tábuas', medida: true },
];

function montarControles() {
  $('#modelos').innerHTML = MODELOS.map((m) => `<button type="button" role="radio" data-modelo="${m.id}" title="${esc(m.descricao)}">${m.nome}</button>`).join('');
  $('#controles').innerHTML = `${CONTROLES.map((c) => `
    <label class="controle" for="rng-${c.chave}">
      <span class="controle-cab"><span>${c.rotulo}</span><output id="out-${c.chave}"></output></span>
      <input type="range" id="rng-${c.chave}" data-config="${c.chave}"
        min="${LIMITES[c.chave].min}" max="${LIMITES[c.chave].max}" step="${LIMITES[c.chave].passo}">
    </label>`).join('')}
    <div class="controle">
      <span class="controle-cab"><span>Tocos</span></span>
      <div class="chips" role="radiogroup" aria-label="Modelo de toco" id="chips-toco">
        <button type="button" role="radio" data-toco="pequeno">Pequeno</button>
        <button type="button" role="radio" data-toco="pbr">Estilo PBR</button>
      </div>
    </div>
    <label class="interruptor" for="chk-base">
      <input type="checkbox" id="chk-base">
      <span>Tábuas de base (embaixo dos tocos)</span>
    </label>`;
}

function renderControles() {
  const c = estado.config;
  for (const b of $$('#modelos button')) b.setAttribute('aria-checked', String(b.dataset.modelo === estado.modeloId));
  for (const def of CONTROLES) {
    const inp = $(`#rng-${def.chave}`);
    let max = LIMITES[def.chave].max;
    if (def.chave === 'tabuas') max = Math.min(max, Math.floor(c.largura / 100));
    inp.max = max;
    if (document.activeElement !== inp) inp.value = c[def.chave];
    inp.style.setProperty('--pct', `${((c[def.chave] - inp.min) / (max - inp.min)) * 100}%`);
    $(`#out-${def.chave}`).textContent = def.medida ? medida(c[def.chave], estado.unidade) : `${c[def.chave]} un`;
  }
  for (const b of $$('#chips-toco button')) b.setAttribute('aria-checked', String(b.dataset.toco === c.toco));
  $('#chk-base').checked = c.base;
}

/** Gera o pallet de novo a partir da configuração (é aqui que o 3D muda "ao vivo"). */
function aplicarConfig(mudanca) {
  estado.config = limparConfig({ ...estado.config, ...mudanca });
  estado.pecas = gerarPallet(estado.config);
  if (ui.selecionado && !estado.pecas.some((p) => p.id === ui.selecionado)) ui.selecionado = null;
  atualizar();
}

// ---------------------------------------------------------------- resumo (números grandes)

function animar(el, valor, formatar) {
  const de = Number.isFinite(el._valor) ? el._valor : valor;
  el._valor = valor;
  cancelAnimationFrame(el._quadro);
  if (reduzirMovimento || !Number.isFinite(valor) || de === valor) {
    el.textContent = formatar(valor);
    return;
  }
  const inicio = performance.now();
  const passo = (agora) => {
    const t = Math.min(1, (agora - inicio) / 320);
    const s = 1 - (1 - t) ** 3;
    el.textContent = formatar(de + (valor - de) * s);
    if (t < 1) el._quadro = requestAnimationFrame(passo);
  };
  el._quadro = requestAnimationFrame(passo);
}

const kgArred = (kg) => numero(Math.round(kg / 10) * 10, 0);

function renderResumo() {
  const r = resultado;
  animar($('#k-volume'), r.volume.total, (v) => `${numero(v, 4)} m³`);
  $('#k-peso').textContent = `${numero(r.volume.pesoKg, 1)} kg de ${ESPECIES[estado.madeira.especie]?.nome.toLowerCase() ?? 'madeira'}`;
  animar($('#k-custo'), r.custoTotal, moeda);
  animar($('#k-preco'), r.preco, moeda);
  $('#k-margem').textContent = `${numero(estado.custos.margemPct, 0)}%`;
  const rng = $('#rng-margem');
  if (document.activeElement !== rng) rng.value = estado.custos.margemPct;
  rng.style.setProperty('--pct', `${(estado.custos.margemPct / Number(rng.max)) * 100}%`);
  const carga = $('#k-carga');
  if (Number.isFinite(capacidade.kg)) animar(carga, capacidade.kg, (v) => `≈ ${kgArred(v)} kg`);
  else carga.textContent = '—';
  $('#contador-pecas').textContent = estado.pecas.length;
}

// ---------------------------------------------------------------- lista de peças

function alertasDe(id) {
  const a = [];
  if (problemas.sobrepostas.has(id)) a.push('sobreposta');
  if (problemas.semApoio.has(id)) a.push('sem apoio');
  return a;
}

function textoMedidas(p, u = estado.unidade) {
  const m = medidasPeca(p);
  return `${medida(m.comprimento, u, false)} × ${medida(m.largura, u, false)} × ${medida(m.espessura, u)}`;
}

function renderLista() {
  const html = [];
  for (const tipo of ['tabua', 'toco']) {
    const doTipo = estado.pecas.filter((p) => p.tipo === tipo);
    if (!doTipo.length) continue;
    html.push(`<div class="grupo-tipo"><h3><span>${TIPOS[tipo].nome}</span><span class="qtd">${doTipo.length}</span></h3>`);
    for (const camada of [...CAMADAS].reverse()) {
      const pecas = doTipo.filter((p) => p.camada === camada.id).sort((a, b) => a.codigo.localeCompare(b.codigo));
      if (!pecas.length) continue;
      if (tipo === 'tabua') html.push(`<h4>${esc(camada.curto)} · ${pecas.length}</h4>`);
      for (const p of pecas) {
        const al = alertasDe(p.id);
        html.push(`<button type="button" class="item" data-id="${p.id}" aria-current="${p.id === ui.selecionado}">
          <span class="carimbo">${p.codigo}</span>
          <span class="med">${textoMedidas(p)}</span>
          ${al.length ? `<span class="alerta" title="${al.join(', ')}">!</span>` : ''}
        </button>`);
      }
    }
    html.push('</div>');
  }
  $('#lista').innerHTML = html.join('') || '<p class="nota">Sem peças. Use + Tábua ou + Toco.</p>';
}

// ---------------------------------------------------------------- cartão da peça selecionada

/** C = maior medida na horizontal, L = menor, E = altura. Mapeia para dx/dz/dy. */
function eixoDoCampo(p, campo) {
  if (campo === 'e') return 'dy';
  const longoX = p.dx >= p.dz;
  if (campo === 'c') return longoX ? 'dx' : 'dz';
  return longoX ? 'dz' : 'dx';
}

function renderEditor() {
  const el = $('#editor');
  const p = pecaSel();
  if (!p) {
    el.hidden = true;
    el.dataset.id = '';
    return;
  }
  // Mesma peça: só atualiza os números (não tira o foco de quem está digitando).
  if (el.dataset.id === p.id && !el.hidden) {
    for (const inp of $$('input[data-campo]', el)) {
      if (inp !== document.activeElement) inp.value = valorCampo(p[eixoDoCampo(p, inp.dataset.campo)], estado.unidade);
    }
    $('.carimbo', el).textContent = p.codigo;
    $('.peca-nome', el).textContent = nomePeca(p);
    for (const b of $$('[data-estilo]', el)) b.setAttribute('aria-checked', String(b.dataset.estilo === p.estilo));
    $('.peca-alerta', el).textContent = textoAlerta(alertasDe(p.id));
    for (const s of $$('.com-unidade i', el)) s.textContent = UNIDADES[estado.unidade].sigla;
    return;
  }
  const u = UNIDADES[estado.unidade].sigla;
  const campo = (rotulo, c) => `<label class="campo" for="ed-${c}"><span>${rotulo}</span><span class="com-unidade">
    <input type="text" inputmode="decimal" autocomplete="off" id="ed-${c}" data-campo="${c}"
      value="${valorCampo(p[eixoDoCampo(p, c)], estado.unidade)}"><i>${u}</i></span></label>`;
  el.dataset.id = p.id;
  el.hidden = false;
  el.innerHTML = `
    <div class="peca-cab">
      <span class="carimbo">${p.codigo}</span>
      <strong class="peca-nome">${esc(nomePeca(p))}</strong>
      <button type="button" class="icone" data-acao="fechar" aria-label="Fechar" title="Fechar (Esc)">✕</button>
    </div>
    <div class="peca-medidas">
      ${campo('Comprimento', 'c')}
      ${campo('Largura', 'l')}
      ${campo(p.tipo === 'toco' ? 'Altura' : 'Espessura', 'e')}
    </div>
    ${p.tipo === 'toco' ? `<div class="chips pequenos" role="radiogroup" aria-label="Modelo do toco">
      <button type="button" role="radio" data-estilo="pequeno" aria-checked="${p.estilo === 'pequeno'}">Pequeno</button>
      <button type="button" role="radio" data-estilo="pbr" aria-checked="${p.estilo === 'pbr'}">Estilo PBR</button>
    </div>` : ''}
    <div class="peca-acoes">
      <button type="button" data-acao="girar">Girar 90°</button>
      <button type="button" data-acao="duplicar">Duplicar</button>
      <button type="button" data-acao="remover" class="perigo">Remover</button>
    </div>
    <p class="peca-alerta">${textoAlerta(alertasDe(p.id))}</p>
    <p class="nota">Arraste a peça no 3D para mover.</p>`;
}

function textoAlerta(alertas) {
  if (alertas.includes('sobreposta')) return 'Esta peça está ocupando o lugar de outra. Arraste para ajustar.';
  if (alertas.includes('sem apoio')) return 'Esta peça não está apoiada em nada.';
  return '';
}

function aoDigitarNaPeca(e) {
  const inp = e.target.closest('input[data-campo]');
  const p = pecaSel();
  if (!inp || !p) return;
  const v = paraMm(lerNumero(inp.value), estado.unidade);
  const ok = Number.isFinite(v) && v >= 1 && v <= 20000;
  inp.closest('.campo').classList.toggle('invalido', !ok);
  if (!ok) return;
  const eixo = eixoDoCampo(p, inp.dataset.campo);
  p[eixo] = Math.round(v * 100) / 100;
  if (p.tipo === 'toco') p.estilo = 'livre';
  atualizar();
}

function aplicarEstilo(p, estilo) {
  const e = ESTILOS_TOCO[estilo];
  p.estilo = estilo;
  if (!e?.dx) return;
  const cx = p.x + p.dx / 2;
  const cz = p.z + p.dz / 2;
  Object.assign(p, { dx: e.dx, dy: e.dy, dz: e.dz });
  p.x = Math.round(cx - p.dx / 2);
  p.z = Math.round(cz - p.dz / 2);
}

function acaoPeca(acao) {
  const p = pecaSel();
  if (!p) return;
  if (acao === 'fechar') {
    selecionar(null);
    return;
  }
  registrar();
  if (acao === 'girar') {
    const cx = p.x + p.dx / 2;
    const cz = p.z + p.dz / 2;
    [p.dx, p.dz] = [p.dz, p.dx];
    p.x = Math.round(cx - p.dx / 2);
    p.z = Math.round(cz - p.dz / 2);
  } else if (acao === 'duplicar') {
    const copia = criarPeca({ ...p, id: undefined });
    if (p.tipo === 'tabua' && p.dx >= p.dz) copia.z += p.dz + 20;
    else copia.x += p.dx + 30;
    estado.pecas.push(copia);
    ui.selecionado = copia.id;
  } else if (acao === 'remover') {
    estado.pecas = estado.pecas.filter((x) => x.id !== p.id);
    ui.selecionado = null;
    avisar(`${p.codigo} removida. Ctrl+Z desfaz.`);
  }
  atualizar();
}

function adicionar(tipo) {
  registrar();
  const d = dimensoesTotais(estado.pecas);
  let nova;
  if (tipo === 'tabua') {
    nova = criarPeca({ tipo: 'tabua', camada: 'superior', dx: estado.config.comprimento, dy: estado.config.espessura, dz: 100 });
  } else {
    const estilo = estado.config.toco;
    nova = criarPeca({ tipo: 'toco', camada: 'tocos', estilo, ...ESTILOS_TOCO[estilo] });
    nova.estilo = estilo;
  }
  nova.x = Math.round(d.x0 + d.x / 2 - nova.dx / 2);
  nova.z = Math.round(d.z0 + d.z / 2 - nova.dz / 2);
  estado.pecas.push(nova);
  ui.selecionado = nova.id;
  atualizar();
  avisar('Peça adicionada no centro. Arraste no 3D para posicionar.');
}

// ---------------------------------------------------------------- campos ligados ao estado (preços)

function preencherVinculos() {
  for (const el of $$('[data-vinculo]')) {
    if (el === document.activeElement) continue;
    const [grupo, chave] = el.dataset.vinculo.split('.');
    const v = estado[grupo][chave];
    el.value = typeof v === 'number' ? String(v).replace('.', ',') : (v ?? '');
  }
}

const LIMITES_CAMPOS = {
  'custos.perdaPct': [0, 300],
  'custos.palletsPorFrete': [1, 100000],
};

function aoEditarVinculo(e) {
  const el = e.target.closest('[data-vinculo]');
  if (!el) return;
  const [grupo, chave] = el.dataset.vinculo.split('.');
  if (el.tagName === 'SELECT') {
    if (e.type !== 'change') return;
    registrar();
    estado[grupo][chave] = el.value;
    const esp = ESPECIES[el.value];
    if (el.dataset.vinculo === 'madeira.especie' && esp?.densidade) {
      Object.assign(estado.madeira, { densidade: esp.densidade, fm: esp.fm, fc90: esp.fc90 });
    }
    atualizar();
    return;
  }
  if (e.type !== 'input') return;
  const v = lerNumero(el.value);
  const [min, max] = LIMITES_CAMPOS[el.dataset.vinculo] ?? [0, 1e9];
  const ok = Number.isFinite(v) && v >= min && v <= max;
  el.closest('.campo')?.classList.toggle('invalido', !ok);
  if (!ok) return;
  estado[grupo][chave] = v;
  atualizar();
}

let contadorCampos = 0;
function campoVinculo(rotulo, vinculo, sufixo) {
  contadorCampos += 1;
  const id = `v-${vinculo.replace('.', '-')}-${contadorCampos}`;
  return `<label class="campo" for="${id}"><span>${rotulo}</span><span class="com-unidade">
    <input type="text" inputmode="decimal" autocomplete="off" id="${id}" data-vinculo="${vinculo}"><i>${sufixo}</i></span></label>`;
}

// ---------------------------------------------------------------- seções de detalhes

function montarDetalhes() {
  $('#aba-custos').innerHTML = `
    <div class="duas-colunas">
      <div class="pilha">
        <div class="form-custos">
          ${campoVinculo('Madeira', 'custos.precoM3', 'R$/m³')}
          ${campoVinculo('Perda no corte', 'custos.perdaPct', '%')}
          ${campoVinculo('Preço do prego', 'custos.precoPrego', 'R$')}
          ${campoVinculo('Pregos por encontro de peças', 'custos.pregosPorLigacao', 'un')}
          ${campoVinculo('Frete da carga', 'custos.freteTotal', 'R$')}
          ${campoVinculo('Pallets por carga', 'custos.palletsPorFrete', 'un')}
          ${campoVinculo('Outros custos por pallet', 'custos.outros', 'R$')}
        </div>
        <p class="nota">Os valores iniciais são exemplos. "Outros" é mão de obra, energia, tratamento etc.</p>
        <div><button type="button" id="btn-precos-padrao">Usar estes preços em novas montagens</button></div>
      </div>
      <div class="tabela-wrap" id="custo-tabela"></div>
    </div>`;

  $('#aba-volume').innerHTML = `
    <div class="duas-colunas">
      <ol class="passos" id="vol-passos"></ol>
      <div class="pilha">
        <div class="tabela-wrap" id="vol-tabela"></div>
        <p class="nota">Clique numa linha para destacar a peça no 3D.</p>
      </div>
    </div>`;

  $('#aba-capacidade').innerHTML = `
    <div class="duas-colunas">
      <div class="pilha">
        <div class="estimativa" id="cap-estimativa"></div>
        <label class="campo" for="v-madeira-especie"><span>Madeira</span>
          <select id="v-madeira-especie" data-vinculo="madeira.especie">
            ${Object.entries(ESPECIES).filter(([, e]) => e.densidade).map(([id, e]) => `<option value="${id}">${e.nome}</option>`).join('')}
          </select></label>
        <div class="barras" id="cap-barras"></div>
      </div>
      <ol class="passos" id="cap-passos"></ol>
    </div>`;
}

function renderVolume() {
  const { volume } = resultado;
  const u = estado.unidade;
  const g0 = volume.grupos[0];
  const m = (mm) => numero(mm / 1000, 3);
  if (!g0) {
    $('#vol-passos').innerHTML = '<li><div>Adicione peças para calcular.</div></li>';
    $('#vol-tabela').innerHTML = '';
    return;
  }
  $('#vol-passos').innerHTML = `
    <li><div><strong>Medidas em metros.</strong>
      <div class="formula">${medida(g0.comprimento, u)} = <b>${m(g0.comprimento)} m</b></div></div></li>
    <li><div><strong>Volume de uma peça</strong> = comprimento × largura × espessura.
      <div class="formula">${m(g0.comprimento)} × ${m(g0.largura)} × ${m(g0.espessura)} = <b>${numero(g0.volUnit, 6)} m³</b></div></div></li>
    <li><div><strong>Vezes a quantidade</strong> de peças iguais.
      <div class="formula">${g0.qtd} × ${numero(g0.volUnit, 6)} = <b>${numero(g0.volTotal, 6)} m³</b></div></div></li>
    <li><div><strong>Soma de todas as peças.</strong>
      <div class="formula">${volume.grupos.map((g) => numero(g.volTotal, 6)).join(' + ')} = <b>${numero(volume.total, 6)} m³</b></div></div></li>
    <li><div><strong>Mais a perda do corte</strong> (${numero(estado.custos.perdaPct, 0)}%) = madeira a comprar.
      <div class="formula">${numero(volume.total, 6)} × ${numero(1 + estado.custos.perdaPct / 100, 2)} = <b>${numero(volume.totalCompra, 6)} m³</b></div></div></li>`;

  const linhas = volume.grupos.map((g) => `
    <tr class="clicavel ${g.ids.includes(ui.selecionado) ? 'ativo' : ''}" data-ids="${g.ids.join(',')}" tabindex="0">
      <td>${esc(g.nome)}</td>
      <td class="n">${g.qtd}</td>
      <td class="n">${medida(g.comprimento, u, false)} × ${medida(g.largura, u, false)} × ${medida(g.espessura, u)}</td>
      <td class="n">${numero(g.volTotal, 4)}</td>
    </tr>`).join('');
  $('#vol-tabela').innerHTML = `<table>
    <thead><tr><th>Peça</th><th class="n">Qtd</th><th class="n">C × L × E</th><th class="n">m³</th></tr></thead>
    <tbody>${linhas}
      <tr class="total"><td>Total</td><td class="n">${estado.pecas.length}</td><td></td><td class="n">${numero(volume.total, 4)}</td></tr>
    </tbody></table>`;
}

function renderCustos() {
  const r = resultado;
  const c = estado.custos;
  const { volume, pregos, itens } = r;
  const formulaPreco = c.tipoMargem === 'markup'
    ? `${moeda(r.custoTotal)} × (1 + ${numero(c.margemPct, 0)}%)`
    : `${moeda(r.custoTotal)} ÷ (1 − ${numero(c.margemPct, 0)}%)`;
  $('#custo-tabela').innerHTML = `<table>
    <tbody>
      <tr><td>Madeira</td><td>${numero(volume.totalCompra, 4)} m³ × ${moeda(c.precoM3)}</td><td class="n">${moeda(itens.madeira)}</td></tr>
      <tr><td>Pregos</td><td>${pregos.quantidade} un × ${moeda(c.precoPrego)}</td><td class="n">${moeda(itens.pregos)}</td></tr>
      <tr><td>Frete</td><td>${moeda(c.freteTotal)} ÷ ${numero(c.palletsPorFrete, 0)}</td><td class="n">${moeda(itens.frete)}</td></tr>
      <tr><td>Outros</td><td></td><td class="n">${moeda(itens.outros)}</td></tr>
      <tr class="total"><td>Custo</td><td></td><td class="n">${moeda(r.custoTotal)}</td></tr>
      <tr><td>Preço</td><td>${formulaPreco}</td><td class="n">${moeda(r.preco)}</td></tr>
      <tr><td>Lucro</td><td>preço − custo</td><td class="n">${moeda(r.lucro)}</td></tr>
    </tbody></table>`;
}

function renderCapacidade() {
  const cap = capacidade;
  const lim = cap.limitante;
  $('#cap-estimativa').innerHTML = `
    <span class="selo">Estimativa · não é garantia de segurança</span>
    <div class="valor">${Number.isFinite(cap.kg) ? `≈ ${kgArred(cap.kg)} kg` : 'Sem estimativa'}</div>
    <p>${Number.isFinite(cap.kg)
    ? `Carga parada, espalhada por igual, com o pallet no chão. Parte mais fraca: <strong>${esc(lim.nome.toLowerCase())}</strong>.`
    : 'Monte pelo menos uma camada de tábuas sobre tocos ou travessas.'}</p>
    <p class="nota">Com madeira úmida, nós grandes, carga concentrada, empilhadeira ou porta-pallet, a carga real é menor.
      Antes de usar, valide com ensaio (ISO 8611) ou com um responsável técnico.</p>`;

  const finitos = cap.camadas.filter((c) => Number.isFinite(c.kg));
  const maior = Math.max(1, ...finitos.map((c) => c.kg));
  $('#cap-barras').innerHTML = cap.camadas.map((c) => {
    const fin = Number.isFinite(c.kg);
    return `<div class="barra ${lim && c.id === lim.id ? 'limitante' : ''}">
      <span>${esc(CAMADAS.find((x) => x.id === c.id).curto)}</span>
      <span class="trilho"><span class="enchimento" style="width:${fin ? Math.max(3, (c.kg / maior) * 100) : 100}%;${fin ? '' : 'opacity:.35'}"></span></span>
      <span class="n">${fin ? `${kgArred(c.kg)} kg` : 'no chão'}</span></div>`;
  }).join('');

  const md = estado.madeira;
  const pior = lim?.pior;
  const passos = [`<li><div><strong>Resistência com folga</strong> = resistência da madeira ÷ ${numero(md.fatorSeguranca, 1)} (fator de segurança).
    <div class="formula">${numero(md.fm, 0)} ÷ ${numero(md.fatorSeguranca, 1)} = <b>${numero(cap.sigma, 1)} MPa</b></div></div></li>`];
  if (pior?.critico) {
    passos.push(
      `<li><div><strong>Peça mais fraca:</strong> ${pior.codigo}, com vão de ${numero(pior.critico.L, 0)} mm entre apoios.
        <div class="formula">W = ${numero(pior.b, 0)} × ${numero(pior.h, 0)}² ÷ 6 = <b>${numero(pior.W, 0)} mm³</b></div></div></li>`,
      `<li><div><strong>Carga que ela aguenta</strong> (viga apoiada nas pontas).
        <div class="formula">${pior.critico.tipo === 'vão' ? '8' : '2'} × ${numero(cap.sigma, 1)} × ${numero(pior.W, 0)} ÷ ${numero(pior.critico.L, 0)}² × ${numero(pior.comp, 0)} mm ≈ <b>${numero(pior.N / G, 0)} kg</b></div></div></li>`,
    );
  } else if (pior?.area) {
    passos.push(`<li><div><strong>Toco mais fraco:</strong> ${pior.codigo}.
      <div class="formula">${numero(pior.area, 0)} mm² × ${numero(cap.fc90, 2)} MPa ≈ <b>${numero(pior.N / G, 0)} kg</b></div></div></li>`);
  }
  if (lim) {
    passos.push(`<li><div><strong>Soma das ${lim.qtd} peças da camada.</strong> A carga passa por todas as camadas; a mais fraca manda.
      <div class="formula">${esc(lim.nome)} ≈ <b>${kgArred(lim.kg)} kg</b></div></div></li>`);
  }
  $('#cap-passos').innerHTML = passos.join('');
}

// ---------------------------------------------------------------- salvar, abrir, exportar

function avisar(texto) {
  const el = $('#aviso');
  el.textContent = texto;
  el.classList.add('visivel');
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => el.classList.remove('visivel'), 3000);
}

function carregarEstado(novo, mensagem) {
  const v = validar(novo);
  if (!v) {
    avisar('Arquivo inválido: não encontrei uma montagem de pallet nele.');
    return false;
  }
  registrar();
  estado = v;
  ui.selecionado = null;
  atualizar();
  cena?.vista('iso');
  avisar(mensagem);
  return true;
}

function renderSalvos() {
  const salvos = local.ler(CHAVE_SALVOS, []);
  $('#lista-salvos').innerHTML = salvos.length
    ? salvos.map((s, i) => `<div class="salvo">
        <div><strong>${esc(s.nome)}</strong><small>${new Date(s.data).toLocaleString('pt-BR')}</small></div>
        <button type="button" data-abrir="${i}">Abrir</button>
        <button type="button" class="perigo" data-excluir="${i}">Excluir</button></div>`).join('')
    : '<p class="nota">Nada salvo neste navegador ainda.</p>';
}

function dadosExportacao() {
  return {
    nome: estado.nome,
    unidade: estado.unidade,
    custos: estado.custos,
    resultado,
    capacidade,
    madeira: { ...estado.madeira, nomeEspecie: ESPECIES[estado.madeira.especie]?.nome ?? '' },
  };
}

function exportar(tipo) {
  const nome = estado.nome;
  const svg = () => desenhoSVG(estado.pecas, { nome, unidade: estado.unidade, grupos: resultado.volume.grupos });
  try {
    if (tipo === 'png') {
      if (!cena) throw new Error('3D indisponível');
      baixar(nomeArquivo(nome, 'png'), cena.capturarPNG());
    } else if (tipo === 'svg') {
      baixar(nomeArquivo(nome, 'svg'), svg(), 'image/svg+xml');
    } else if (tipo === 'csv') {
      baixar(nomeArquivo(`${nome}-custos`, 'csv'), csvCustos(dadosExportacao()), 'text/csv;charset=utf-8');
    } else if (tipo === 'json') {
      baixar(nomeArquivo(nome, 'json'), JSON.stringify(estado, null, 2), 'application/json');
    } else {
      const html = relatorioHTML({ ...dadosExportacao(), imagemPNG: cena ? cena.capturarPNG() : null, svg: svg() });
      if (tipo === 'html') {
        baixar(nomeArquivo(`${nome}-relatorio`, 'html'), html, 'text/html');
      } else {
        const frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
        frame.srcdoc = html;
        frame.onload = () => {
          frame.contentWindow.focus();
          frame.contentWindow.print();
          setTimeout(() => frame.remove(), 60000);
        };
        document.body.appendChild(frame);
        return;
      }
    }
    avisar('Arquivo gerado. Confira a pasta de downloads.');
  } catch (err) {
    console.error(err);
    avisar('Não foi possível exportar neste navegador.');
  }
}

// ---------------------------------------------------------------- eventos

function ligarEventos() {
  // Topo
  const nome = $('#nome-montagem');
  nome.addEventListener('focus', marcarInicio);
  nome.addEventListener('input', () => {
    estado.nome = nome.value.slice(0, 60);
    local.gravar(CHAVE_ATUAL, estado);
  });
  nome.addEventListener('change', marcarFim);
  $('#unidades').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unidade]');
    if (!b) return;
    estado.unidade = b.dataset.unidade;
    $('#editor').dataset.id = ''; // redesenha o cartão com a nova unidade
    atualizar();
  });
  $('#btn-desfazer').addEventListener('click', desfazer);
  $('#btn-arquivo').addEventListener('click', () => {
    $('#salvar-nome').value = estado.nome;
    renderSalvos();
    $('#dlg-arquivo').showModal();
  });

  // Montar
  const lateral = $('.lateral');
  $('#modelos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-modelo]');
    if (!b) return;
    registrar();
    const eraPadrao = MODELOS.some((m) => nomePadrao(m.id) === estado.nome);
    const modelo = MODELOS.find((m) => m.id === b.dataset.modelo);
    estado.modeloId = modelo.id;
    if (eraPadrao) estado.nome = nomePadrao(modelo.id);
    aplicarConfig(modelo.config);
  });
  $('#btn-restaurar').addEventListener('click', () => {
    registrar();
    aplicarConfig(MODELOS.find((m) => m.id === estado.modeloId).config);
    avisar('Pallet voltou ao modelo original. Ctrl+Z desfaz.');
  });
  lateral.addEventListener('pointerdown', (e) => { if (e.target.matches('input[type=range]')) marcarInicio(); });
  lateral.addEventListener('focusin', (e) => { if (e.target.matches('input[type=range]')) marcarInicio(); });
  lateral.addEventListener('input', (e) => {
    const chave = e.target.dataset.config;
    if (chave) aplicarConfig({ [chave]: Number(e.target.value) });
  });
  lateral.addEventListener('change', (e) => {
    if (e.target.matches('input[type=range]')) marcarFim();
    if (e.target.id === 'chk-base') {
      registrar();
      aplicarConfig({ base: e.target.checked });
    }
  });
  $('#chips-toco').addEventListener('click', (e) => {
    const b = e.target.closest('[data-toco]');
    if (!b || b.dataset.toco === estado.config.toco) return;
    registrar();
    aplicarConfig({ toco: b.dataset.toco });
  });

  // Peças
  $('#lista').addEventListener('click', (e) => {
    const b = e.target.closest('.item');
    if (b) selecionar(b.dataset.id === ui.selecionado ? null : b.dataset.id);
  });
  $('#btn-add-tabua').addEventListener('click', () => adicionar('tabua'));
  $('#btn-add-toco').addEventListener('click', () => adicionar('toco'));

  // Cartão da peça
  const editor = $('#editor');
  editor.addEventListener('focusin', (e) => { if (e.target.matches('input')) marcarInicio(); });
  editor.addEventListener('input', aoDigitarNaPeca);
  editor.addEventListener('change', (e) => {
    if (!e.target.matches('input')) return;
    e.target.closest('.campo')?.classList.remove('invalido');
    marcarFim();
    renderEditor();
  });
  editor.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur?.(); });
  editor.addEventListener('click', (e) => {
    const estilo = e.target.closest('[data-estilo]')?.dataset.estilo;
    if (estilo) {
      registrar();
      aplicarEstilo(pecaSel(), estilo);
      atualizar();
      return;
    }
    const acao = e.target.closest('[data-acao]')?.dataset.acao;
    if (acao) acaoPeca(acao);
  });

  // Visor
  $('#btn-explodida').addEventListener('click', () => {
    ui.explodida = !ui.explodida;
    cena?.setExplodida(ui.explodida);
    renderTopo();
  });
  $('#btn-centralizar').addEventListener('click', () => cena?.vista('iso'));

  // Margem (no resumo)
  const margem = $('#rng-margem');
  margem.addEventListener('pointerdown', marcarInicio);
  margem.addEventListener('focus', marcarInicio);
  margem.addEventListener('input', () => {
    estado.custos.margemPct = Number(margem.value);
    estado.custos.tipoMargem = 'margem';
    atualizar();
  });
  margem.addEventListener('change', marcarFim);

  // Detalhes
  const detalhes = $('.detalhes');
  detalhes.addEventListener('focusin', (e) => { if (e.target.matches('[data-vinculo]')) marcarInicio(); });
  detalhes.addEventListener('input', aoEditarVinculo);
  detalhes.addEventListener('change', (e) => {
    if (e.target.matches('select[data-vinculo]')) aoEditarVinculo(e);
    else if (e.target.matches('input[data-vinculo]')) {
      e.target.closest('.campo')?.classList.remove('invalido');
      marcarFim();
      preencherVinculos();
    }
  });
  detalhes.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-ids]');
    if (tr) {
      const ids = tr.dataset.ids.split(',');
      selecionar(ids[(ids.indexOf(ui.selecionado) + 1) % ids.length], { rolarLista: true });
    }
    if (e.target.id === 'btn-precos-padrao') {
      const ok = local.gravar(CHAVE_PRECOS, estado.custos);
      avisar(ok ? 'Pronto. Novas montagens vão usar estes preços.' : 'O navegador bloqueou o armazenamento.');
    }
  });
  detalhes.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-ids]')) e.target.click();
    if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();
  });

  // Diálogo Salvar e exportar
  const dlg = $('#dlg-arquivo');
  $('[data-fechar]', dlg).addEventListener('click', () => dlg.close());
  $('#form-salvar').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = $('#salvar-nome').value.trim() || estado.nome;
    estado.nome = n;
    const salvos = local.ler(CHAVE_SALVOS, []).filter((s) => s.nome !== n);
    salvos.unshift({ nome: n, data: new Date().toISOString(), estado: JSON.parse(JSON.stringify(estado)) });
    const ok = local.gravar(CHAVE_SALVOS, salvos.slice(0, 50));
    renderSalvos();
    renderTopo();
    avisar(ok ? `“${n}” salvo.` : 'O navegador bloqueou o armazenamento. Use “Baixar .json”.');
  });
  $('#btn-salvar-arquivo').addEventListener('click', () => {
    estado.nome = $('#salvar-nome').value.trim() || estado.nome;
    exportar('json');
  });
  $('#lista-salvos').addEventListener('click', (e) => {
    const salvos = local.ler(CHAVE_SALVOS, []);
    const abrir = e.target.closest('[data-abrir]');
    const excluir = e.target.closest('[data-excluir]');
    if (abrir) {
      const s = salvos[Number(abrir.dataset.abrir)];
      if (s && carregarEstado(s.estado, `“${s.nome}” aberto.`)) dlg.close();
    } else if (excluir) {
      if (excluir.dataset.confirmar !== 'sim') {
        excluir.dataset.confirmar = 'sim';
        excluir.textContent = 'Confirmar';
        return;
      }
      salvos.splice(Number(excluir.dataset.excluir), 1);
      local.gravar(CHAVE_SALVOS, salvos);
      renderSalvos();
    }
  });
  $('#arquivo-json').addEventListener('change', (e) => {
    const arq = e.target.files?.[0];
    if (!arq) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        if (carregarEstado(JSON.parse(leitor.result), `“${arq.name}” carregado.`)) dlg.close();
      } catch {
        avisar('Não consegui ler esse arquivo. Use um .json salvo por aqui.');
      }
      e.target.value = '';
    };
    leitor.readAsText(arq);
  });
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-exportar]');
    if (b) exportar(b.dataset.exportar);
  });

  // Teclado
  document.addEventListener('keydown', (e) => {
    const digitando = e.target.closest('input, select, textarea, dialog');
    const ctrl = e.ctrlKey || e.metaKey;
    if (digitando) return;
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); desfazer(); return; }
    if (e.key === 'Escape') selecionar(null);
    if (!ui.selecionado) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); acaoPeca('remover'); }
    if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); acaoPeca('duplicar'); }
    const setas = { ArrowLeft: ['x', -10], ArrowRight: ['x', 10], ArrowUp: ['z', -10], ArrowDown: ['z', 10] };
    if (setas[e.key]) {
      e.preventDefault();
      registrar();
      const [eixo, d] = setas[e.key];
      pecaSel()[eixo] += d;
      atualizar();
    }
  });
}

// ---------------------------------------------------------------- arrastar peças no 3D

function aoArrastar(id, x, z) {
  const p = estado.pecas.find((q) => q.id === id);
  if (!p) return;
  if (!ui.arrastando) {
    registrar();
    ui.arrastando = true;
  }
  p.x = x;
  p.z = z;
  atualizar();
}

function aoSoltar() {
  ui.arrastando = false;
  atualizar();
}

// ---------------------------------------------------------------- início

function corGrade() {
  const cor = getComputedStyle(document.documentElement).getPropertyValue('--grade').trim();
  if (cor) cena?.setCorGrade(cor);
}

montarControles();
montarDetalhes();
ligarEventos();
try {
  cena = new Cena3D($('#visor'), {
    aoSelecionar: (id) => selecionar(id, { rolarLista: true }),
    aoArrastar,
    aoSoltar,
  });
  corGrade();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', corGrade);
  new MutationObserver(corGrade).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
} catch (err) {
  console.error(err);
  $('#visor-erro').hidden = false;
  $('#visor-dica').hidden = true;
}
atualizar();
cena?.vista('iso');
