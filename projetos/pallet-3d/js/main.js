// Controlador da interface: guarda o estado da montagem e liga a tela, a cena 3D e os cálculos.

import { Cena3D } from './cena3d.js';
import {
  CAMADAS, ESTILOS_TOCO, MODELOS, TIPOS, camadaPorId, criarPeca, dimensoesTotais,
  empilhar, gerarModelo, medidasPeca, nomePeca, renumerar,
} from './modelos.js';
import {
  CUSTOS_PADRAO, ESPECIES, G, MADEIRA_PADRAO, calcularCapacidade, calcularCustos, verificarProblemas,
} from './calculos.js';
import { UNIDADES, lerNumero, medida, moeda, numero, paraMm, valorCampo } from './unidades.js';
import { baixar, csvCustos, desenhoSVG, nomeArquivo, relatorioHTML } from './exportar.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

function nomePadrao(modeloId) {
  const m = MODELOS.find((x) => x.id === modeloId) ?? MODELOS[0];
  return `Pallet ${m.nome.split(' (')[0]}`;
}

function limparNumeros(obj, padrao) {
  const out = { ...padrao };
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(padrao)) {
    if (typeof v === 'number' || v === null) {
      if (Number.isFinite(obj[k])) out[k] = obj[k];
      else if (v === null) out[k] = null;
    }
  }
  return out;
}

function estadoInicial(modeloId = 'pbr') {
  const precos = local.ler(CHAVE_PRECOS, {});
  return {
    versao: 1,
    nome: nomePadrao(modeloId),
    modeloId,
    unidade: 'mm',
    empilhar: true,
    pecas: gerarModelo(modeloId),
    custos: {
      ...limparNumeros(precos, CUSTOS_PADRAO),
      tipoMargem: precos?.tipoMargem === 'markup' ? 'markup' : 'margem',
    },
    madeira: { ...MADEIRA_PADRAO },
  };
}

/** Confere um estado vindo de arquivo ou do navegador. Devolve null se não servir. */
function validar(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.pecas)) return null;
  const campos = ['x', 'y', 'z', 'dx', 'dy', 'dz'];
  const pecas = o.pecas
    .filter((p) => p && campos.every((k) => Number.isFinite(p[k])) && p.dx > 0 && p.dy > 0 && p.dz > 0)
    .map((p) => criarPeca({
      ...p,
      tipo: p.tipo === 'toco' ? 'toco' : 'tabua',
      camada: camadaPorId[p.camada] ? p.camada : undefined,
      estilo: p.tipo === 'toco' ? (ESTILOS_TOCO[p.estilo] ? p.estilo : 'livre') : undefined,
    }));
  const custos = limparNumeros(o.custos, CUSTOS_PADRAO);
  custos.tipoMargem = o.custos?.tipoMargem === 'markup' ? 'markup' : 'margem';
  const madeira = limparNumeros(o.madeira, MADEIRA_PADRAO);
  madeira.especie = ESPECIES[o.madeira?.especie] ? o.madeira.especie : 'personalizada';
  return {
    versao: 1,
    nome: String(o.nome || 'Pallet').slice(0, 60),
    modeloId: MODELOS.some((m) => m.id === o.modeloId) ? o.modeloId : 'pbr',
    unidade: UNIDADES[o.unidade] ? o.unidade : 'mm',
    empilhar: o.empilhar !== false,
    pecas,
    custos,
    madeira,
  };
}

let estado = validar(local.ler(CHAVE_ATUAL, null)) ?? estadoInicial();
const ui = { selecionado: null, explodida: false, passo: 10 };
let problemas = { sobrepostas: new Set(), semApoio: new Set() };
let resultado = null;
let capacidade = null;
let cena = null;

// ---------------------------------------------------------------- desfazer / refazer

const historico = { desfazer: [], refazer: [] };
const foto = () => JSON.stringify({
  nome: estado.nome, modeloId: estado.modeloId, empilhar: estado.empilhar,
  pecas: estado.pecas, custos: estado.custos, madeira: estado.madeira,
});
let fotoFoco = null;

function registrar(f = foto()) {
  historico.desfazer.push(f);
  if (historico.desfazer.length > 120) historico.desfazer.shift();
  historico.refazer.length = 0;
}

function aplicarFoto(f) {
  const dados = JSON.parse(f);
  estado = { ...estado, ...dados };
  if (ui.selecionado && !estado.pecas.some((p) => p.id === ui.selecionado)) ui.selecionado = null;
}

function desfazer() {
  if (!historico.desfazer.length) return;
  historico.refazer.push(foto());
  aplicarFoto(historico.desfazer.pop());
  atualizar();
  avisar('Alteração desfeita');
}

function refazer() {
  if (!historico.refazer.length) return;
  historico.desfazer.push(foto());
  aplicarFoto(historico.refazer.pop());
  atualizar();
  avisar('Alteração refeita');
}

// ---------------------------------------------------------------- ciclo de atualização

const pecaSel = () => estado.pecas.find((p) => p.id === ui.selecionado) ?? null;

function atualizar({ editor = true } = {}) {
  if (estado.empilhar) empilhar(estado.pecas);
  renumerar(estado.pecas);
  problemas = verificarProblemas(estado.pecas);
  const madeira = { ...estado.madeira };
  resultado = calcularCustos(estado.pecas, estado.custos, madeira);
  capacidade = calcularCapacidade(estado.pecas, madeira);

  cena?.atualizar(estado.pecas, { selecionado: ui.selecionado, unidade: estado.unidade });
  renderTopo();
  renderLista();
  if (editor) renderEditor();
  else atualizarCamposEditor();
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
    el.setAttribute('aria-current', ativo ? 'true' : 'false');
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

// ---------------------------------------------------------------- topo

function renderTopo() {
  const nome = $('#nome-montagem');
  if (document.activeElement !== nome) nome.value = estado.nome;
  $('#sel-modelo').value = estado.modeloId;
  for (const b of $$('#unidades button')) b.setAttribute('aria-checked', String(b.dataset.unidade === estado.unidade));
  $('#btn-desfazer').disabled = !historico.desfazer.length;
  $('#btn-refazer').disabled = !historico.refazer.length;
  $('#chk-empilhar').checked = estado.empilhar;
  const bx = $('#btn-explodida');
  bx.setAttribute('aria-pressed', String(ui.explodida));
  $('span', bx).textContent = ui.explodida ? 'Voltar à montagem' : 'Vista explodida';
}

function renderResumo() {
  const d = dimensoesTotais(estado.pecas);
  const u = estado.unidade;
  const alertas = problemas.sobrepostas.size + problemas.semApoio.size;
  $('#resumo-visor').innerHTML = `
    <span>Medidas gerais</span><strong>${medida(d.x, u, false)} × ${medida(d.z, u, false)} × ${medida(d.y, u)}</strong>
    <span>Madeira</span><strong>${numero(resultado.volume.total, 4)} m³ · ${numero(resultado.volume.pesoKg, 1)} kg</strong>
    <span>Preço sugerido</span><strong>${moeda(resultado.preco)}</strong>
    ${alertas ? `<span style="color:var(--warn)">${alertas} peça(s) com alerta</span>` : ''}`;
  $('#contador-pecas').textContent = `${estado.pecas.length} peças`;
}

// ---------------------------------------------------------------- lista de componentes

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
    html.push(`<div class="grupo-tipo"><h3><span>${TIPOS[tipo].nome}</span><span class="qtd">${doTipo.length} un</span></h3>`);
    if (!doTipo.length) html.push('<p class="nota">Nenhuma peça deste tipo.</p>');
    for (const camada of [...CAMADAS].reverse()) {
      const pecas = doTipo.filter((p) => p.camada === camada.id).sort((a, b) => a.codigo.localeCompare(b.codigo));
      if (!pecas.length) continue;
      html.push(`<div class="subgrupo"><h4><span>${esc(camada.nome)}</span><span>${pecas.length} un</span></h4>`);
      for (const p of pecas) {
        const al = alertasDe(p.id);
        html.push(`<button type="button" class="item" data-id="${p.id}" aria-current="${p.id === ui.selecionado}"
          title="${esc(nomePeca(p))} — C × L × ${p.tipo === 'toco' ? 'A' : 'E'}">
          <span class="carimbo">${p.codigo}</span>
          <span class="med">${textoMedidas(p)}</span>
          ${al.length ? `<span class="alerta">${al.join(', ')}</span>` : '<span></span>'}
        </button>`);
      }
      html.push('</div>');
    }
    html.push('</div>');
  }
  $('#lista').innerHTML = html.join('');
}

// ---------------------------------------------------------------- editor da peça

function campoMedida(rotulo, campo, valorMm, { desativado = false } = {}) {
  const u = UNIDADES[estado.unidade].sigla;
  return `<label class="campo"><span>${rotulo}</span><span class="com-unidade">
    <input type="text" inputmode="decimal" autocomplete="off" id="ed-${campo}" data-campo="${campo}"
      value="${valorCampo(valorMm, estado.unidade)}" ${desativado ? 'disabled' : ''}><i>${u}</i></span></label>`;
}

function renderEditor() {
  const el = $('#editor');
  const p = pecaSel();
  if (!p) {
    el.innerHTML = `<p class="editor-vazio"><strong>Nenhuma peça selecionada.</strong>
      Clique numa tábua ou toco no 3D ou na lista abaixo para ver as medidas e editar.
      Atalhos: <kbd>Del</kbd> remove, <kbd>Ctrl</kbd>+<kbd>D</kbd> duplica, setas movem, <kbd>Esc</kbd> limpa a seleção.</p>`;
    return;
  }
  const eixoX = p.dx >= p.dz;
  const rotY = p.tipo === 'toco' ? 'Altura (Y)' : 'Espessura (Y)';
  const opcoesCamada = CAMADAS.map((c) => `<option value="${c.id}" ${c.id === p.camada ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  const opcoesEstilo = Object.entries(ESTILOS_TOCO).map(([id, e]) => {
    const dims = e.dx ? ` — ${medida(e.dx, estado.unidade, false)} × ${medida(e.dz, estado.unidade, false)} × ${medida(e.dy, estado.unidade)}` : '';
    return `<option value="${id}" ${id === p.estilo ? 'selected' : ''}>${e.nome}${dims}</option>`;
  }).join('');
  const al = alertasDe(p.id);

  el.innerHTML = `
    <div class="editor-cab">
      <span class="carimbo" id="ed-codigo">${p.codigo}</span>
      <h2 id="ed-nome">${esc(nomePeca(p))}</h2>
      <button type="button" data-acao="fechar" aria-label="Limpar seleção" title="Limpar seleção (Esc)">✕</button>
    </div>
    <div class="alertas-peca" id="ed-alertas">${al.map((a) => `<div class="alerta-linha">${textoAlerta(a)}</div>`).join('')}</div>

    <div class="editor-sec">
      <div class="grade-campos dois">
        <label class="campo"><span>Camada</span><select id="ed-camada" data-campo="camada">${opcoesCamada}</select></label>
        ${p.tipo === 'toco'
    ? `<label class="campo"><span>Modelo do toco</span><select id="ed-estilo" data-campo="estilo">${opcoesEstilo}</select></label>`
    : `<label class="campo"><span>Tipo</span><input type="text" id="ed-tipo" value="Tábua" disabled></label>`}
      </div>
      ${p.tipo === 'toco' ? '<button type="button" data-acao="estilo-todos">Aplicar este modelo a todos os tocos</button>' : ''}
    </div>

    <div class="editor-sec">
      <h3>Medidas <span>${UNIDADES[estado.unidade].nome.toLowerCase()}</span></h3>
      <div class="grade-campos">
        ${campoMedida(eixoX ? 'Comprimento (X)' : 'Largura (X)', 'dx', p.dx)}
        ${campoMedida(eixoX ? 'Largura (Z)' : 'Comprimento (Z)', 'dz', p.dz)}
        ${campoMedida(rotY, 'dy', p.dy)}
      </div>
    </div>

    <div class="editor-sec">
      <h3>Posição <span>canto da peça</span></h3>
      <div class="grade-campos">
        ${campoMedida('X', 'x', p.x)}
        ${campoMedida('Z', 'z', p.z)}
        ${campoMedida(estado.empilhar ? 'Y (automático)' : 'Y', 'y', p.y, { desativado: estado.empilhar })}
      </div>
      <div class="mover" role="group" aria-label="Mover peça">
        <button type="button" data-mover="x:-1" title="Mover para a esquerda (←)" aria-label="Mover em X negativo">←</button>
        <button type="button" data-mover="x:1" title="Mover para a direita (→)" aria-label="Mover em X positivo">→</button>
        <button type="button" data-mover="z:-1" title="Mover para o fundo (↑)" aria-label="Mover em Z negativo">↑</button>
        <button type="button" data-mover="z:1" title="Mover para a frente (↓)" aria-label="Mover em Z positivo">↓</button>
        ${estado.empilhar ? '' : `<button type="button" data-mover="y:1" title="Subir (Page Up)" aria-label="Subir">▲</button>
        <button type="button" data-mover="y:-1" title="Descer (Page Down)" aria-label="Descer">▼</button>`}
        <label class="rotulo-passo" for="ed-passo">passo</label>
        <select id="ed-passo">
          ${[1, 5, 10, 50, 100].map((v) => `<option value="${v}" ${v === ui.passo ? 'selected' : ''}>${medida(v, estado.unidade)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="editor-sec editor-acoes">
      <button type="button" data-acao="girar" title="Troca comprimento e largura">Girar 90°</button>
      <button type="button" data-acao="duplicar" title="Ctrl+D">Duplicar</button>
      <button type="button" data-acao="remover" class="perigo" title="Delete">Remover</button>
    </div>`;
}

function textoAlerta(a) {
  if (a === 'sobreposta') return 'Esta peça ocupa o mesmo espaço que outra. Ajuste a posição ou as medidas.';
  return 'Esta peça não está apoiada em nada. Ela não entra na estimativa de carga.';
}

/** Atualiza só os campos que a pessoa não está digitando (para não tirar o foco). */
function atualizarCamposEditor() {
  const p = pecaSel();
  if (!p) return;
  for (const inp of $$('#editor input[data-campo]')) {
    if (inp !== document.activeElement) inp.value = valorCampo(p[inp.dataset.campo], estado.unidade);
  }
  const est = $('#ed-estilo');
  if (est) est.value = p.estilo;
  $('#ed-codigo').textContent = p.codigo;
  $('#ed-nome').textContent = nomePeca(p);
  $('#ed-alertas').innerHTML = alertasDe(p.id).map((a) => `<div class="alerta-linha">${textoAlerta(a)}</div>`).join('');
}

const LIMITE_MM = 20000;

function aoDigitarNoEditor(e) {
  const inp = e.target.closest('input[data-campo]');
  const p = pecaSel();
  if (!inp || !p) return;
  const campo = inp.dataset.campo;
  const v = paraMm(lerNumero(inp.value), estado.unidade);
  const ehMedida = ['dx', 'dy', 'dz'].includes(campo);
  const ok = Number.isFinite(v) && (ehMedida ? v >= 1 && v <= LIMITE_MM : Math.abs(v) <= LIMITE_MM);
  inp.closest('.campo').classList.toggle('invalido', !ok);
  if (!ok) return;
  p[campo] = Math.round(v * 100) / 100;
  if (ehMedida && p.tipo === 'toco') {
    const e2 = ESTILOS_TOCO[p.estilo];
    if (!e2?.dx || e2.dx !== p.dx || e2.dy !== p.dy || e2.dz !== p.dz) p.estilo = 'livre';
  }
  atualizar({ editor: false });
}

function aplicarEstilo(p, estilo) {
  const e = ESTILOS_TOCO[estilo];
  p.estilo = estilo;
  if (!e?.dx) return;
  const cx = p.x + p.dx / 2;
  const cz = p.z + p.dz / 2;
  p.dx = e.dx;
  p.dy = e.dy;
  p.dz = e.dz;
  p.x = Math.round((cx - p.dx / 2) * 10) / 10;
  p.z = Math.round((cz - p.dz / 2) * 10) / 10;
}

function mover(eixo, sentido) {
  const p = pecaSel();
  if (!p) return;
  if (eixo === 'y' && estado.empilhar) return;
  registrar();
  p[eixo] = Math.round((p[eixo] + sentido * ui.passo) * 100) / 100;
  atualizar({ editor: false });
}

function girar() {
  const p = pecaSel();
  if (!p) return;
  registrar();
  const cx = p.x + p.dx / 2;
  const cz = p.z + p.dz / 2;
  [p.dx, p.dz] = [p.dz, p.dx];
  p.x = Math.round((cx - p.dx / 2) * 10) / 10;
  p.z = Math.round((cz - p.dz / 2) * 10) / 10;
  atualizar();
}

function duplicar() {
  const p = pecaSel();
  if (!p) return;
  registrar();
  const copia = criarPeca({ ...p, id: undefined });
  if (p.tipo === 'tabua') {
    if (p.dx >= p.dz) copia.z += p.dz + 20;
    else copia.x += p.dx + 20;
  } else {
    copia.x += p.dx + 40;
  }
  estado.pecas.push(copia);
  ui.selecionado = copia.id;
  atualizar();
  avisar(`Peça duplicada como ${copia.codigo}. Ajuste a posição se precisar.`);
}

function remover() {
  const p = pecaSel();
  if (!p) return;
  registrar();
  estado.pecas = estado.pecas.filter((x) => x.id !== p.id);
  ui.selecionado = null;
  atualizar();
  avisar(`${p.codigo} removida. Ctrl+Z desfaz.`);
}

function adicionar(tipo) {
  registrar();
  const d = dimensoesTotais(estado.pecas);
  let nova;
  if (tipo === 'tabua') {
    const modelo = estado.pecas.find((p) => p.camada === 'superior' && p.tipo === 'tabua');
    const dims = modelo ? { dx: modelo.dx, dy: modelo.dy, dz: modelo.dz } : { dx: 1200, dy: 22, dz: 100 };
    nova = criarPeca({ tipo: 'tabua', camada: 'superior', ...dims });
  } else {
    const estilo = $('#sel-estilo-novo').value;
    nova = criarPeca({ tipo: 'toco', camada: 'tocos', estilo, ...ESTILOS_TOCO[estilo] });
    nova.estilo = estilo;
  }
  nova.x = Math.round(d.x0 + d.x / 2 - nova.dx / 2);
  nova.z = Math.round(d.z0 + d.z / 2 - nova.dz / 2);
  if (!estado.empilhar) nova.y = Math.round(d.y0 + d.y);
  estado.pecas.push(nova);
  ui.selecionado = nova.id;
  atualizar();
  avisar(`${nova.codigo} adicionada no centro do pallet. Ajuste a posição no editor.`);
}

// ---------------------------------------------------------------- vínculos de formulário (custos e madeira)

/** Campos com data-vinculo="custos.precoM3" ficam ligados direto ao estado. */
function preencherVinculos() {
  for (const el of $$('[data-vinculo]')) {
    if (el === document.activeElement) continue;
    const [grupo, chave] = el.dataset.vinculo.split('.');
    const v = estado[grupo][chave];
    el.value = typeof v === 'number' ? String(v).replace('.', ',') : (v ?? '');
  }
}

const LIMITES = {
  'custos.perdaPct': [0, 300],
  'custos.margemPct': [0, 1000],
  'custos.palletsPorFrete': [1, 100000],
  'custos.quantidadePedido': [0, 1000000],
  'madeira.fatorSeguranca': [1, 20],
  'madeira.densidade': [50, 2000],
};

function aoEditarVinculo(e) {
  const el = e.target.closest('[data-vinculo]');
  if (!el) return;
  const [grupo, chave] = el.dataset.vinculo.split('.');
  if (el.tagName === 'SELECT') {
    if (e.type !== 'change') return;
    registrar();
    estado[grupo][chave] = el.value;
    if (el.dataset.vinculo === 'madeira.especie' && ESPECIES[el.value]?.densidade) {
      const esp = ESPECIES[el.value];
      Object.assign(estado.madeira, { densidade: esp.densidade, fm: esp.fm, fc90: esp.fc90 });
    }
    atualizar({ editor: false });
    return;
  }
  if (e.type !== 'input') return;
  const campo = el.closest('.campo');
  const texto = el.value.trim();
  if (texto === '' && el.dataset.vazio === 'sim') {
    estado[grupo][chave] = null;
    campo?.classList.remove('invalido');
    atualizar({ editor: false });
    return;
  }
  const v = lerNumero(texto);
  const [min, max] = LIMITES[el.dataset.vinculo] ?? [0, 1e9];
  const ok = Number.isFinite(v) && v >= min && v <= max;
  campo?.classList.toggle('invalido', !ok);
  if (!ok) return;
  estado[grupo][chave] = v;
  if (grupo === 'madeira' && ['fm', 'fc90', 'densidade'].includes(chave)) estado.madeira.especie = 'personalizada';
  atualizar({ editor: false });
}

let contadorCampos = 0;
function campoVinculo(rotulo, vinculo, { sufixo = '', dica = '', vazio = false, classe = '' } = {}) {
  contadorCampos += 1;
  const id = `v-${vinculo.replace('.', '-')}-${contadorCampos}`;
  return `<label class="campo ${classe}" for="${id}"><span>${rotulo}</span><span class="com-unidade">
    <input type="text" inputmode="decimal" autocomplete="off" id="${id}" data-vinculo="${vinculo}" ${vazio ? 'data-vazio="sim" placeholder="automático"' : ''}>
    ${sufixo ? `<i>${sufixo}</i>` : ''}</span>${dica ? `<small class="nota">${dica}</small>` : ''}</label>`;
}

// ---------------------------------------------------------------- abas de cálculo

function montarAbas() {
  $('#aba-volume').innerHTML = `
    <div class="numeros" id="vol-numeros"></div>
    <div class="duas-colunas">
      <div style="display:grid;gap:12px">
        <h2>Passo a passo do cálculo</h2>
        <ol class="passos" id="vol-passos"></ol>
      </div>
      <div style="display:grid;gap:12px;min-width:0">
        <div class="form-custos">
          ${campoVinculo('Perda no corte', 'custos.perdaPct', { sufixo: '%' })}
          ${campoVinculo('Densidade da madeira', 'madeira.densidade', { sufixo: 'kg/m³' })}
        </div>
        <h2>Lista de corte</h2>
        <div class="tabela-wrap" id="vol-tabela"></div>
        <p class="nota">Clique numa linha para destacar a peça no 3D.</p>
      </div>
    </div>`;

  $('#aba-custos').innerHTML = `
    <div class="numeros" id="custo-numeros"></div>
    <div class="duas-colunas">
      <div style="display:grid;gap:12px">
        <h2>Valores usados no cálculo</h2>
        <div class="form-custos">
          ${campoVinculo('Madeira', 'custos.precoM3', { sufixo: 'R$/m³' })}
          ${campoVinculo('Perda no corte', 'custos.perdaPct', { sufixo: '%' })}
          ${campoVinculo('Preço de cada prego', 'custos.precoPrego', { sufixo: 'R$' })}
          ${campoVinculo('Pregos por ligação', 'custos.pregosPorLigacao', { sufixo: 'un', dica: 'Cada encontro entre duas peças.' })}
          ${campoVinculo('Total de pregos', 'custos.pregosManual', { sufixo: 'un', vazio: true, dica: 'Deixe vazio para contar automaticamente.' })}
          ${campoVinculo('Outros custos por pallet', 'custos.outros', { sufixo: 'R$', dica: 'Mão de obra, energia, tratamento térmico…' })}
          ${campoVinculo('Frete da carga', 'custos.freteTotal', { sufixo: 'R$' })}
          ${campoVinculo('Pallets por carga', 'custos.palletsPorFrete', { sufixo: 'un' })}
          ${campoVinculo('Margem', 'custos.margemPct', { sufixo: '%' })}
          <label class="campo" for="v-custos-tipoMargem"><span>Como aplicar a margem</span>
            <select id="v-custos-tipoMargem" data-vinculo="custos.tipoMargem">
              <option value="margem">Margem sobre o preço de venda</option>
              <option value="markup">Markup sobre o custo</option>
            </select></label>
          ${campoVinculo('Quantidade do pedido', 'custos.quantidadePedido', { sufixo: 'un', classe: 'largo' })}
        </div>
        <p class="nota">Os valores iniciais são exemplos. Troque pelos preços do seu fornecedor; eles ficam salvos com a montagem.</p>
        <div class="acoes-linha">
          <button type="button" id="btn-precos-padrao">Usar estes valores em novas montagens</button>
          <button type="button" id="btn-precos-exemplo">Voltar aos valores de exemplo</button>
        </div>
      </div>
      <div style="display:grid;gap:12px;min-width:0">
        <h2>Composição do preço (por pallet)</h2>
        <div class="tabela-wrap" id="custo-tabela"></div>
        <div class="tabela-wrap" id="custo-pedido"></div>
      </div>
    </div>`;

  $('#aba-capacidade').innerHTML = `
    <div class="duas-colunas">
      <div style="display:grid;gap:14px;min-width:0">
        <div class="estimativa" id="cap-estimativa"></div>
        <h2>Capacidade estimada por camada</h2>
        <div class="barras" id="cap-barras"></div>
        <h2>Como a estimativa foi feita</h2>
        <ol class="passos" id="cap-passos"></ol>
      </div>
      <div style="display:grid;gap:12px">
        <h2>Madeira</h2>
        <div class="form-custos">
          <label class="campo largo" for="v-madeira-especie"><span>Espécie</span>
            <select id="v-madeira-especie" data-vinculo="madeira.especie">
              ${Object.entries(ESPECIES).map(([id, e]) => `<option value="${id}">${e.nome}</option>`).join('')}
            </select></label>
          ${campoVinculo('Resistência à flexão adotada', 'madeira.fm', { sufixo: 'MPa' })}
          ${campoVinculo('Compressão normal às fibras', 'madeira.fc90', { sufixo: 'MPa' })}
          ${campoVinculo('Densidade', 'madeira.densidade', { sufixo: 'kg/m³' })}
          ${campoVinculo('Fator de segurança', 'madeira.fatorSeguranca', { sufixo: '×' })}
        </div>
        <p class="nota">Os valores das espécies são aproximados para madeira seca de qualidade comum de pallet
          (com nós). Madeira úmida ou com defeitos aguenta bem menos. Se tiver o laudo do fornecedor, use os valores dele.</p>
      </div>
    </div>`;
}

function renderVolume() {
  const { volume } = resultado;
  const u = estado.unidade;
  const g0 = volume.grupos[0];
  const m = (mm) => numero(mm / 1000, 3);
  const div = { mm: '÷ 1000', cm: '÷ 100', m: 'já está em metros' }[u];

  $('#vol-numeros').innerHTML = `
    <div class="numero"><span>Volume líquido</span><strong>${numero(volume.total, 4)} m³</strong><small>soma das peças</small></div>
    <div class="numero destaque"><span>Volume a comprar</span><strong>${numero(volume.totalCompra, 4)} m³</strong><small>com ${numero(estado.custos.perdaPct, 1)}% de perda</small></div>
    <div class="numero"><span>Peso estimado</span><strong>${numero(volume.pesoKg, 1)} kg</strong><small>${numero(estado.madeira.densidade, 0)} kg/m³</small></div>
    <div class="numero"><span>Peças</span><strong>${estado.pecas.length}</strong><small>${volume.grupos.length} medidas diferentes</small></div>`;

  const soma = volume.grupos.map((g) => numero(g.volTotal, 6)).join(' + ');
  $('#vol-passos').innerHTML = g0 ? `
    <li><div><strong>Converter as medidas para metros</strong> (${div}).
      <div class="formula">${medida(g0.comprimento, u)} = <b>${m(g0.comprimento)} m</b> · ${medida(g0.largura, u)} = <b>${m(g0.largura)} m</b> · ${medida(g0.espessura, u)} = <b>${m(g0.espessura)} m</b></div></div></li>
    <li><div><strong>Volume de uma peça = comprimento × largura × espessura.</strong> Exemplo: ${esc(g0.nome.toLowerCase())}.
      <div class="formula">${m(g0.comprimento)} × ${m(g0.largura)} × ${m(g0.espessura)} = <b>${numero(g0.volUnit, 6)} m³</b></div></div></li>
    <li><div><strong>Multiplicar pela quantidade de peças iguais.</strong>
      <div class="formula">${g0.qtd} × ${numero(g0.volUnit, 6)} = <b>${numero(g0.volTotal, 6)} m³</b></div>
      <p class="nota">A tabela ao lado faz isso para cada grupo de peças iguais.</p></div></li>
    <li><div><strong>Somar todos os grupos.</strong>
      <div class="formula">${soma} = <b>${numero(volume.total, 6)} m³</b></div></div></li>
    <li><div><strong>Acrescentar a perda do corte</strong> (serragem, refilo, peças com defeito).
      <div class="formula">${numero(volume.total, 6)} × (1 + ${numero(estado.custos.perdaPct, 1)}%) = <b>${numero(volume.totalCompra, 6)} m³</b></div></div></li>
    <li><div><strong>Peso estimado = volume líquido × densidade.</strong>
      <div class="formula">${numero(volume.total, 6)} m³ × ${numero(estado.madeira.densidade, 0)} kg/m³ = <b>${numero(volume.pesoKg, 1)} kg</b></div></div></li>`
    : '<li><div>Adicione peças para calcular o volume.</div></li>';

  const linhas = volume.grupos.map((g) => `
    <tr class="clicavel ${g.ids.includes(ui.selecionado) ? 'ativo' : ''}" data-ids="${g.ids.join(',')}" tabindex="0">
      <td>${esc(g.nome)}<br><small class="nota">${g.codigos.length > 4 ? `${g.codigos.slice(0, 3).join(', ')}…` : g.codigos.join(', ')}</small></td>
      <td class="n">${g.qtd}</td>
      <td class="n">${m(g.comprimento)} × ${m(g.largura)} × ${m(g.espessura)}</td>
      <td class="n">${numero(g.volUnit, 6)}</td>
      <td class="n">${numero(g.volTotal, 6)}</td>
    </tr>`).join('');
  $('#vol-tabela').innerHTML = `<table>
    <thead><tr><th>Peça</th><th class="n">Qtd</th><th class="n">C × L × E (m)</th><th class="n">m³ / peça</th><th class="n">m³ total</th></tr></thead>
    <tbody>${linhas}
      <tr class="total"><td>Total</td><td class="n">${estado.pecas.length}</td><td></td><td></td><td class="n">${numero(volume.total, 6)}</td></tr>
    </tbody></table>`;
}

function renderCustos() {
  const r = resultado;
  const c = estado.custos;
  const { volume, pregos, itens } = r;
  const margemInvalida = !Number.isFinite(r.preco);
  $('#custo-numeros').innerHTML = `
    <div class="numero"><span>Custo por pallet</span><strong>${moeda(r.custoTotal)}</strong></div>
    <div class="numero destaque"><span>Preço de venda sugerido</span><strong>${margemInvalida ? '—' : moeda(r.preco)}</strong>
      <small>${c.tipoMargem === 'markup' ? `markup de ${numero(c.margemPct, 1)}%` : `margem de ${numero(c.margemPct, 1)}% sobre o preço`}</small></div>
    <div class="numero"><span>Lucro por pallet</span><strong>${margemInvalida ? '—' : moeda(r.lucro)}</strong></div>
    <div class="numero"><span>Pregos</span><strong>${pregos.quantidade} un</strong><small>${pregos.manual ? 'quantidade informada' : `${pregos.ligacoes} ligações × ${pregos.porLigacao}`}</small></div>`;

  const formulaPreco = c.tipoMargem === 'markup'
    ? `${moeda(r.custoTotal)} × (1 + ${numero(c.margemPct, 1)}%)`
    : `${moeda(r.custoTotal)} ÷ (1 − ${numero(c.margemPct, 1)}%)`;
  $('#custo-tabela').innerHTML = `<table>
    <thead><tr><th>Item</th><th>Cálculo</th><th class="n">Valor</th></tr></thead>
    <tbody>
      <tr><td>Madeira</td><td>${numero(volume.totalCompra, 4)} m³ × ${moeda(c.precoM3)}/m³</td><td class="n">${moeda(itens.madeira)}</td></tr>
      <tr><td>Pregos</td><td>${pregos.quantidade} un × ${moeda(c.precoPrego)}${pregos.manual ? '' : `<br><small class="nota">${pregos.ligacoes} ligações entre peças × ${pregos.porLigacao} pregos</small>`}</td><td class="n">${moeda(itens.pregos)}</td></tr>
      <tr><td>Frete</td><td>${moeda(c.freteTotal)} ÷ ${numero(c.palletsPorFrete, 0)} pallets por carga</td><td class="n">${moeda(itens.frete)}</td></tr>
      <tr><td>Outros</td><td>valor por pallet</td><td class="n">${moeda(itens.outros)}</td></tr>
      <tr class="total"><td>Custo total</td><td>soma dos itens</td><td class="n">${moeda(r.custoTotal)}</td></tr>
      <tr><td>Preço sugerido</td><td>${formulaPreco}${margemInvalida ? '<br><small style="color:var(--bad)">Margem sobre o preço precisa ser menor que 100%.</small>' : ''}</td><td class="n">${margemInvalida ? '—' : moeda(r.preco)}</td></tr>
      <tr><td>Lucro</td><td>preço − custo${Number.isFinite(r.margemReal) && c.tipoMargem === 'markup' ? ` (margem real ${numero(r.margemReal * 100, 1)}% do preço)` : ''}</td><td class="n">${margemInvalida ? '—' : moeda(r.lucro)}</td></tr>
    </tbody></table>`;

  $('#custo-pedido').innerHTML = `<table>
    <thead><tr><th>Pedido de ${numero(r.pedido.qtd, 0)} pallets</th><th class="n">Valor</th></tr></thead>
    <tbody>
      <tr><td>Madeira a comprar</td><td class="n">${numero(volume.totalCompra * r.pedido.qtd, 3)} m³</td></tr>
      <tr><td>Pregos</td><td class="n">${numero(pregos.quantidade * r.pedido.qtd, 0)} un</td></tr>
      <tr><td>Custo total</td><td class="n">${moeda(r.pedido.custo)}</td></tr>
      <tr><td>Venda total</td><td class="n">${margemInvalida ? '—' : moeda(r.pedido.venda)}</td></tr>
      <tr class="total"><td>Lucro total</td><td class="n">${margemInvalida ? '—' : moeda(r.pedido.lucro)}</td></tr>
    </tbody></table>`;
}

const kgArred = (kg) => numero(Math.round(kg / 10) * 10, 0);

function renderCapacidade() {
  const cap = capacidade;
  const md = estado.madeira;
  const lim = cap.limitante;
  const semApoio = cap.semApoio.length
    ? `<p style="color:var(--bad)">Peças sem apoio (não entram no cálculo): ${cap.semApoio.join(', ')}.</p>` : '';
  $('#cap-estimativa').innerHTML = `
    <span class="selo">Estimativa · não é garantia de segurança</span>
    <div class="valor">${Number.isFinite(cap.kg) ? `≈ ${kgArred(cap.kg)} kg` : 'Sem estimativa'}</div>
    <p>${Number.isFinite(cap.kg)
    ? `Carga estática, distribuída por igual sobre a face, com o pallet apoiado no chão. Camada mais fraca: <strong>${esc(lim.nome.toLowerCase())}</strong>.`
    : 'Não há tábuas apoiadas em vãos para estimar. Monte pelo menos uma camada sobre tocos ou travessas.'}</p>
    ${semApoio}
    <p class="nota">O valor real pode ser bem menor com madeira úmida, nós grandes, pregação fraca, carga concentrada,
      movimentação com empilhadeira ou uso em porta-pallet. Antes de usar, valide com ensaio (por exemplo, ISO 8611)
      ou com um responsável técnico.</p>`;

  const finitos = cap.camadas.filter((c) => Number.isFinite(c.kg));
  const maior = Math.max(1, ...finitos.map((c) => c.kg));
  $('#cap-barras').innerHTML = cap.camadas.map((c) => {
    const fin = Number.isFinite(c.kg);
    const pct = fin ? Math.max(2, (c.kg / maior) * 100) : 100;
    return `<div class="barra ${lim && c.id === lim.id ? 'limitante' : ''}">
      <span>${esc(camadaPorId[c.id].curto)} <small class="nota">(${c.qtd})</small></span>
      <span class="trilho"><span class="enchimento" style="width:${pct}%;${fin ? '' : 'opacity:.35'}"></span></span>
      <span class="n">${fin ? `${kgArred(c.kg)} kg` : 'no chão'}</span></div>`;
  }).join('') || '<p class="nota">Sem peças.</p>';

  const passos = [
    `<li><div><strong>Tensão admissível</strong> = resistência ÷ fator de segurança.
      <div class="formula">flexão: ${numero(md.fm, 1)} ÷ ${numero(md.fatorSeguranca, 1)} = <b>${numero(cap.sigma, 2)} MPa</b> · compressão: ${numero(md.fc90, 1)} ÷ ${numero(md.fatorSeguranca, 1)} = <b>${numero(cap.fc90, 2)} MPa</b></div></div></li>`,
  ];
  const pior = lim?.pior;
  if (pior && pior.critico) {
    const vao = pior.critico.tipo === 'vão';
    passos.push(
      `<li><div><strong>Peça mais fraca da camada:</strong> ${pior.codigo}. Módulo resistente da seção W = b × h² ÷ 6.
        <div class="formula">${numero(pior.b, 1)} × ${numero(pior.h, 1)}² ÷ 6 = <b>${numero(pior.W, 0)} mm³</b></div></div></li>`,
      vao
        ? `<li><div><strong>Vão de cálculo</strong> = vão livre entre apoios + espessura.
          <div class="formula">${numero(pior.critico.vaoLivre, 1)} + ${numero(pior.h, 1)} = <b>${numero(pior.critico.L, 1)} mm</b></div></div></li>
          <li><div><strong>Carga máxima por mm de tábua</strong> (viga biapoiada): q = 8 × σ × W ÷ L².
          <div class="formula">8 × ${numero(cap.sigma, 2)} × ${numero(pior.W, 0)} ÷ ${numero(pior.critico.L, 1)}² = <b>${numero(pior.q, 2)} N/mm</b></div></div></li>`
        : `<li><div><strong>Ponta em balanço</strong> de ${numero(pior.critico.L, 1)} mm: q = 2 × σ × W ÷ a².
          <div class="formula">2 × ${numero(cap.sigma, 2)} × ${numero(pior.W, 0)} ÷ ${numero(pior.critico.L, 1)}² = <b>${numero(pior.q, 2)} N/mm</b></div></div></li>`,
      `<li><div><strong>Capacidade da peça</strong> = q × comprimento; em kg = N ÷ ${numero(G, 2)}.
        <div class="formula">${numero(pior.q, 2)} × ${numero(pior.comp, 0)} = ${numero(pior.N, 0)} N ≈ <b>${numero(pior.N / G, 0)} kg</b></div></div></li>`,
    );
  } else if (pior && pior.area) {
    passos.push(`<li><div><strong>Toco mais fraco:</strong> ${pior.codigo}. Capacidade = área de apoio × compressão admissível.
      <div class="formula">${numero(pior.area, 0)} mm² × ${numero(cap.fc90, 2)} MPa = ${numero(pior.N, 0)} N ≈ <b>${numero(pior.N / G, 0)} kg</b></div></div></li>`);
  }
  if (lim) {
    passos.push(`<li><div><strong>Capacidade da camada</strong> = soma das ${lim.qtd} peças. Toda a carga passa por todas as camadas,
      então a <strong>camada mais fraca</strong> define a estimativa.
      <div class="formula">${esc(lim.nome)}: <b>≈ ${kgArred(lim.kg)} kg</b></div></div></li>`);
  }
  $('#cap-passos').innerHTML = passos.join('');
}

// ---------------------------------------------------------------- salvar, abrir, exportar

function avisar(texto) {
  const el = $('#aviso');
  el.textContent = texto;
  el.classList.add('visivel');
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => el.classList.remove('visivel'), 3200);
}

function abrirDialogo(id) {
  const d = $(id);
  if (typeof d.showModal === 'function') d.showModal();
  else d.setAttribute('open', '');
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
        <div><strong>${esc(s.nome)}</strong><small>${new Date(s.data).toLocaleString('pt-BR')} · ${s.estado?.pecas?.length ?? 0} peças</small></div>
        <button type="button" data-abrir="${i}">Abrir</button>
        <button type="button" class="perigo" data-excluir="${i}">Excluir</button></div>`).join('')
    : '<p class="nota">Nenhuma montagem salva neste navegador ainda.</p>';
}

function dadosExportacao() {
  const especie = ESPECIES[estado.madeira.especie]?.nome ?? 'Personalizada';
  return {
    nome: estado.nome,
    unidade: estado.unidade,
    custos: estado.custos,
    resultado,
    capacidade,
    madeira: { ...estado.madeira, nomeEspecie: especie },
  };
}

function exportar(tipo) {
  const nome = estado.nome;
  const grupos = resultado.volume.grupos;
  try {
    if (tipo === 'png') {
      if (!cena) throw new Error('3D indisponível');
      baixar(nomeArquivo(nome, 'png'), cena.capturarPNG());
    } else if (tipo === 'svg') {
      baixar(nomeArquivo(nome, 'svg'), desenhoSVG(estado.pecas, { nome, unidade: estado.unidade, grupos }), 'image/svg+xml');
    } else if (tipo === 'csv') {
      baixar(nomeArquivo(`${nome}-custos`, 'csv'), csvCustos(dadosExportacao()), 'text/csv;charset=utf-8');
    } else if (tipo === 'json') {
      baixar(nomeArquivo(nome, 'json'), JSON.stringify(estado, null, 2), 'application/json');
    } else if (tipo === 'html' || tipo === 'imprimir') {
      const html = relatorioHTML({
        ...dadosExportacao(),
        imagemPNG: cena ? cena.capturarPNG() : null,
        svg: desenhoSVG(estado.pecas, { nome, unidade: estado.unidade, grupos }),
      });
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
      }
    }
    if (tipo !== 'imprimir') avisar('Arquivo gerado. Confira a pasta de downloads.');
  } catch (err) {
    console.error(err);
    avisar('Não foi possível exportar neste navegador.');
  }
}

// ---------------------------------------------------------------- eventos

function ligarEventos() {
  // Topo
  $('#sel-modelo').innerHTML = MODELOS.map((m) => `<option value="${m.id}">${m.nome}</option>`).join('');
  $('#sel-modelo').addEventListener('change', (e) => {
    registrar();
    const eraPadrao = MODELOS.some((m) => nomePadrao(m.id) === estado.nome) || !estado.nome.trim();
    estado.modeloId = e.target.value;
    estado.pecas = gerarModelo(estado.modeloId);
    estado.empilhar = true;
    if (eraPadrao) estado.nome = nomePadrao(estado.modeloId);
    ui.selecionado = null;
    atualizar();
    cena?.vista('iso');
    avisar('Modelo carregado. Ctrl+Z desfaz.');
  });
  $('#nome-montagem').addEventListener('focus', () => { fotoFoco = foto(); });
  $('#nome-montagem').addEventListener('input', (e) => {
    estado.nome = e.target.value.slice(0, 60);
    local.gravar(CHAVE_ATUAL, estado);
  });
  $('#nome-montagem').addEventListener('change', () => {
    if (fotoFoco && fotoFoco !== foto()) registrar(fotoFoco);
    renderTopo();
  });
  $('#unidades').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unidade]');
    if (!b) return;
    estado.unidade = b.dataset.unidade;
    atualizar();
  });
  $('#btn-desfazer').addEventListener('click', desfazer);
  $('#btn-refazer').addEventListener('click', refazer);
  $('#btn-restaurar').addEventListener('click', () => {
    registrar();
    estado.pecas = gerarModelo(estado.modeloId);
    estado.empilhar = true;
    ui.selecionado = null;
    atualizar();
    avisar('Pallet restaurado para o modelo original. Ctrl+Z desfaz.');
  });
  $('#btn-salvar').addEventListener('click', () => {
    $('#salvar-nome').value = estado.nome;
    abrirDialogo('#dlg-salvar');
  });
  $('#form-salvar').addEventListener('submit', (e) => {
    e.preventDefault();
    const nome = $('#salvar-nome').value.trim() || estado.nome;
    estado.nome = nome;
    const salvos = local.ler(CHAVE_SALVOS, []).filter((s) => s.nome !== nome);
    salvos.unshift({ nome, data: new Date().toISOString(), estado: JSON.parse(JSON.stringify(estado)) });
    const ok = local.gravar(CHAVE_SALVOS, salvos.slice(0, 50));
    $('#dlg-salvar').close();
    renderTopo();
    avisar(ok ? `“${nome}” salva neste navegador.` : 'O navegador bloqueou o armazenamento. Use “Baixar .json”.');
  });
  $('#btn-salvar-arquivo').addEventListener('click', () => {
    estado.nome = $('#salvar-nome').value.trim() || estado.nome;
    exportar('json');
    $('#dlg-salvar').close();
  });
  $('#btn-abrir').addEventListener('click', () => {
    renderSalvos();
    abrirDialogo('#dlg-abrir');
  });
  $('#lista-salvos').addEventListener('click', (e) => {
    const salvos = local.ler(CHAVE_SALVOS, []);
    const abrir = e.target.closest('[data-abrir]');
    const excluir = e.target.closest('[data-excluir]');
    if (abrir) {
      const s = salvos[Number(abrir.dataset.abrir)];
      if (s && carregarEstado(s.estado, `“${s.nome}” aberta.`)) $('#dlg-abrir').close();
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
        if (carregarEstado(JSON.parse(leitor.result), `“${arq.name}” carregado.`)) $('#dlg-abrir').close();
      } catch {
        avisar('Não consegui ler esse arquivo. Ele precisa ser um .json exportado por aqui.');
      }
      e.target.value = '';
    };
    leitor.readAsText(arq);
  });
  $('#btn-exportar').addEventListener('click', () => abrirDialogo('#dlg-exportar'));
  $('#dlg-exportar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-exportar]');
    if (!b) return;
    exportar(b.dataset.exportar);
  });
  for (const b of $$('[data-fechar]')) b.addEventListener('click', () => b.closest('dialog').close());

  // Visor
  $('#btn-explodida').addEventListener('click', () => {
    ui.explodida = !ui.explodida;
    cena?.setExplodida(ui.explodida);
    renderTopo();
  });
  $('#vistas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-vista]');
    if (b) cena?.vista(b.dataset.vista);
  });
  $('#chk-transparencia').addEventListener('change', (e) => cena?.setTransparencia(e.target.checked));

  // Lista e inclusão de peças
  $('#lista').addEventListener('click', (e) => {
    const b = e.target.closest('.item');
    if (b) selecionar(b.dataset.id === ui.selecionado ? null : b.dataset.id);
  });
  $('#btn-add-tabua').addEventListener('click', () => adicionar('tabua'));
  $('#btn-add-toco').addEventListener('click', () => adicionar('toco'));
  $('#chk-empilhar').addEventListener('change', (e) => {
    registrar();
    estado.empilhar = e.target.checked;
    atualizar();
  });

  // Editor
  const editor = $('#editor');
  editor.addEventListener('focusin', (e) => {
    if (e.target.matches('input[data-campo]')) fotoFoco = foto();
  });
  editor.addEventListener('input', aoDigitarNoEditor);
  editor.addEventListener('change', (e) => {
    const p = pecaSel();
    if (!p) return;
    const alvo = e.target;
    if (alvo.id === 'ed-passo') {
      ui.passo = Number(alvo.value);
    } else if (alvo.matches('select[data-campo="camada"]')) {
      registrar();
      p.camada = alvo.value;
      atualizar();
    } else if (alvo.matches('select[data-campo="estilo"]')) {
      registrar();
      aplicarEstilo(p, alvo.value);
      atualizar();
    } else if (alvo.matches('input[data-campo]')) {
      if (fotoFoco && fotoFoco !== foto()) registrar(fotoFoco);
      fotoFoco = foto();
      alvo.closest('.campo').classList.remove('invalido');
      alvo.value = valorCampo(p[alvo.dataset.campo], estado.unidade);
      renderTopo();
    }
  });
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();
  });
  editor.addEventListener('click', (e) => {
    const mov = e.target.closest('[data-mover]');
    if (mov) {
      const [eixo, s] = mov.dataset.mover.split(':');
      mover(eixo, Number(s));
      return;
    }
    const acao = e.target.closest('[data-acao]')?.dataset.acao;
    if (acao === 'fechar') selecionar(null);
    else if (acao === 'girar') girar();
    else if (acao === 'duplicar') duplicar();
    else if (acao === 'remover') remover();
    else if (acao === 'estilo-todos') {
      const p = pecaSel();
      registrar();
      for (const t of estado.pecas.filter((x) => x.tipo === 'toco')) aplicarEstilo(t, p.estilo);
      atualizar();
      avisar(`Modelo “${ESTILOS_TOCO[p.estilo].nome}” aplicado a todos os tocos.`);
    }
  });

  // Abas de cálculo
  $('.abas').addEventListener('click', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (!tab) return;
    for (const t of $$('.abas [role="tab"]')) {
      const ativo = t === tab;
      t.setAttribute('aria-selected', String(ativo));
      $(`#${t.getAttribute('aria-controls')}`).hidden = !ativo;
    }
  });
  const calculos = $('.calculos');
  calculos.addEventListener('focusin', (e) => {
    if (e.target.matches('[data-vinculo]')) fotoFoco = foto();
  });
  calculos.addEventListener('input', aoEditarVinculo);
  calculos.addEventListener('change', (e) => {
    if (e.target.matches('select[data-vinculo]')) {
      aoEditarVinculo(e);
    } else if (e.target.matches('input[data-vinculo]')) {
      if (fotoFoco && fotoFoco !== foto()) registrar(fotoFoco);
      fotoFoco = foto();
      e.target.closest('.campo')?.classList.remove('invalido');
      preencherVinculos();
      renderTopo();
    }
  });
  calculos.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-ids]');
    if (tr) {
      const ids = tr.dataset.ids.split(',');
      const i = ids.indexOf(ui.selecionado);
      selecionar(ids[(i + 1) % ids.length], { rolarLista: true });
    }
    if (e.target.id === 'btn-precos-padrao') {
      const ok = local.gravar(CHAVE_PRECOS, estado.custos);
      avisar(ok ? 'Valores guardados. Novas montagens vão começar com eles.' : 'O navegador bloqueou o armazenamento.');
    }
    if (e.target.id === 'btn-precos-exemplo') {
      registrar();
      estado.custos = { ...CUSTOS_PADRAO };
      local.gravar(CHAVE_PRECOS, {});
      atualizar({ editor: false });
      avisar('Valores de exemplo restaurados.');
    }
  });
  calculos.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-ids]')) e.target.click();
    if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();
  });

  // Teclado
  document.addEventListener('keydown', (e) => {
    const digitando = e.target.closest('input, select, textarea, dialog');
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z' && !digitando) {
      e.preventDefault();
      if (e.shiftKey) refazer();
      else desfazer();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'y' && !digitando) {
      e.preventDefault();
      refazer();
      return;
    }
    if (digitando) return;
    if (e.key === 'Escape') selecionar(null);
    if (!ui.selecionado) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remover(); }
    if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicar(); }
    const setas = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['z', -1], ArrowDown: ['z', 1], PageUp: ['y', 1], PageDown: ['y', -1] };
    if (setas[e.key]) {
      e.preventDefault();
      mover(...setas[e.key]);
    }
  });
}

// ---------------------------------------------------------------- tema da cena

function corGrade() {
  const cor = getComputedStyle(document.documentElement).getPropertyValue('--grade').trim();
  if (cor) cena?.setCorGrade(cor);
}

// ---------------------------------------------------------------- início

montarAbas();
ligarEventos();
try {
  cena = new Cena3D($('#visor'), { aoSelecionar: (id) => selecionar(id, { rolarLista: true }) });
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
