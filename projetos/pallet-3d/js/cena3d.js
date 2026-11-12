// Cena 3D do pallet (Three.js).
// Responsável só pelo desenho: recebe a lista de peças e avisa quando a pessoa clica numa peça.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { camadaPorId, medidasPeca, nomePeca } from './modelos.js';
import { medida } from './unidades.js';

const MM = 0.001; // a cena trabalha em metros
const SEPARACAO_EXPLODIDA = 0.17; // m entre camadas na vista explodida

// ---------------------------------------------------------------- textura de madeira

function texturaMadeira(base, veio, girar) {
  const w = 512;
  const h = 128;
  const cv = document.createElement('canvas');
  cv.width = girar ? h : w;
  cv.height = girar ? w : h;
  const ctx = cv.getContext('2d');
  if (girar) {
    ctx.translate(h, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // Gerador pseudoaleatório fixo para a madeira ficar sempre igual.
  let semente = 7;
  const rnd = () => {
    semente = (semente * 16807) % 2147483647;
    return semente / 2147483647;
  };
  for (let i = 0; i < 46; i++) {
    const y0 = rnd() * h;
    const amp = 1 + rnd() * 4;
    const freq = 0.004 + rnd() * 0.01;
    const fase = rnd() * 6;
    ctx.strokeStyle = veio;
    ctx.globalAlpha = 0.08 + rnd() * 0.22;
    ctx.lineWidth = 0.6 + rnd() * 1.8;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = y0 + Math.sin(x * freq + fase) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Alguns nós.
  for (let i = 0; i < 2; i++) {
    const cx = 60 + rnd() * (w - 120);
    const cy = 20 + rnd() * (h - 40);
    for (let r = 2; r < 12; r += 2.2) {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = veio;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 2.2, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const CORES = {
  tabua: { base: '#d8b07a', veio: '#8a5a2b' },
  toco: { base: '#b98a55', veio: '#6b4220' },
  tocoPequeno: { base: '#e0c08e', veio: '#9a6a36' },
};

// ---------------------------------------------------------------- classe principal

export class Cena3D {
  constructor(container, { aoSelecionar } = {}) {
    this.container = container;
    this.aoSelecionar = aoSelecionar ?? (() => {});
    this.pecas = [];
    this.objetos = new Map(); // id -> { mesh, arestas, peca }
    this.selecionado = null;
    this.unidade = 'mm';
    this.explodida = false;
    this.fatorExplosao = 0; // 0 = montado, 1 = explodido (animado)
    this.transparencia = true;
    this.reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.#criarRenderer();
    this.#criarCena();
    this.#criarMateriais();
    this.#criarCotas();
    this.#eventos();
    this.#loop();
  }

  // ---------------------------------------------------------------- montagem

  #criarRenderer() {
    const { container } = this;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.rotulos = new CSS2DRenderer();
    this.rotulos.domElement.className = 'camada-rotulos';
    container.appendChild(this.rotulos.domElement);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    this.controles = new OrbitControls(this.camera, this.renderer.domElement);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.09;
    this.controles.minDistance = 0.25;
    this.controles.maxDistance = 12;
    this.controles.maxPolarAngle = Math.PI * 0.495;

    this.redimensionar();
    new ResizeObserver(() => this.redimensionar()).observe(container);
  }

  #criarCena() {
    this.cena = new THREE.Scene();
    this.raiz = new THREE.Group();
    this.cena.add(this.raiz);

    this.cena.add(new THREE.HemisphereLight(0xfff6e8, 0x6b6656, 1.6));
    const sol = new THREE.DirectionalLight(0xffffff, 2.2);
    sol.position.set(1.6, 3, 1.2);
    sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048);
    Object.assign(sol.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 8 });
    sol.shadow.bias = -0.0004;
    this.cena.add(sol);

    // Chão que só recebe sombra + grade de 100 mm.
    const chao = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.ShadowMaterial({ opacity: 0.18 }),
    );
    chao.rotation.x = -Math.PI / 2;
    chao.receiveShadow = true;
    this.cena.add(chao);

    this.grade = new THREE.GridHelper(4, 40, 0x888888, 0x888888);
    this.grade.material.transparent = true;
    this.grade.material.opacity = 0.18;
    this.grade.position.y = -0.0005;
    this.cena.add(this.grade);
  }

  #criarMateriais() {
    const mat = (cor, girar, destaque) => new THREE.MeshStandardMaterial({
      map: texturaMadeira(cor.base, cor.veio, girar),
      roughness: 0.82,
      metalness: 0,
      emissive: destaque ? new THREE.Color(0x2a7fd4) : new THREE.Color(0x000000),
      emissiveIntensity: destaque ? 0.38 : 0,
      transparent: true,
      opacity: 1,
    });
    // Para cada "cor": [veio ao longo de u, veio girado] × [normal, destacado].
    this.materiais = {};
    for (const [nome, cor] of Object.entries(CORES)) {
      this.materiais[nome] = {
        normal: [mat(cor, false, false), mat(cor, true, false)],
        destaque: [mat(cor, false, true), mat(cor, true, true)],
        fantasma: [mat(cor, false, false), mat(cor, true, false)],
      };
      for (const m of this.materiais[nome].fantasma) {
        m.opacity = 0.32;
        m.depthWrite = false;
      }
    }
    this.matAresta = new THREE.LineBasicMaterial({ color: 0x4a2f16, transparent: true, opacity: 0.55 });
    this.matArestaFantasma = new THREE.LineBasicMaterial({ color: 0x4a2f16, transparent: true, opacity: 0.18 });
    this.matArestaSel = new THREE.LineBasicMaterial({ color: 0x1e88ff, depthTest: false, transparent: true });
  }

  /** Lista de 6 materiais (uma por face da caixa) para o veio seguir o comprimento da peça. */
  #materiaisDaPeca(p, estado) {
    let cor = 'tabua';
    if (p.tipo === 'toco') cor = p.estilo === 'pequeno' ? 'tocoPequeno' : 'toco';
    const [u, girado] = this.materiais[cor][estado];
    // Ordem das faces no BoxGeometry: +x, -x, +y, -y, +z, -z
    if (p.dx >= p.dz) return [u, u, u, u, u, u];
    return [u, u, girado, girado, u, u];
  }

  #criarCotas() {
    this.cotas = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x1e88ff, depthTest: false, transparent: true }),
    );
    this.cotas.renderOrder = 1000;
    this.cotas.visible = false;
    this.cena.add(this.cotas);

    const rotulo = (classe) => {
      const el = document.createElement('div');
      el.className = classe;
      const obj = new CSS2DObject(el);
      obj.visible = false;
      this.cena.add(obj);
      return obj;
    };
    this.rotuloC = rotulo('cota');
    this.rotuloL = rotulo('cota');
    this.rotuloE = rotulo('cota');
    this.rotuloNome = rotulo('cota-nome');
  }

  #eventos() {
    const el = this.renderer.domElement;
    let inicio = null;
    el.addEventListener('pointerdown', (e) => { inicio = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!inicio || e.button !== 0) return;
      const moveu = Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y);
      inicio = null;
      if (moveu > 5) return; // foi um arraste para girar, não um clique
      const id = this.#pecaSobPonteiro(e);
      this.aoSelecionar(id);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      el.style.cursor = this.#pecaSobPonteiro(e) ? 'pointer' : 'grab';
    });
  }

  #pecaSobPonteiro(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ponto = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ponto, this.camera);
    const meshes = [...this.objetos.values()].map((o) => o.mesh);
    const hits = ray.intersectObjects(meshes, false);
    return hits.length ? hits[0].object.userData.id : null;
  }

  redimensionar() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.rotulos.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- API usada pela interface

  /** Atualiza a cena com a lista de peças (em mm). */
  atualizar(pecas, { selecionado = this.selecionado, unidade = this.unidade } = {}) {
    this.pecas = pecas;
    this.unidade = unidade;
    const vistos = new Set();

    for (const p of pecas) {
      vistos.add(p.id);
      let obj = this.objetos.get(p.id);
      const assinatura = `${p.dx}|${p.dy}|${p.dz}|${p.tipo}|${p.estilo}`;
      if (!obj) {
        const mesh = new THREE.Mesh();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.id = p.id;
        const arestas = new THREE.LineSegments(new THREE.BufferGeometry(), this.matAresta);
        mesh.add(arestas);
        this.raiz.add(mesh);
        obj = { mesh, arestas, assinatura: '' };
        this.objetos.set(p.id, obj);
      }
      if (obj.assinatura !== assinatura) {
        obj.mesh.geometry.dispose();
        obj.mesh.geometry = new THREE.BoxGeometry(p.dx * MM, p.dy * MM, p.dz * MM);
        obj.arestas.geometry.dispose();
        obj.arestas.geometry = new THREE.EdgesGeometry(obj.mesh.geometry);
        obj.assinatura = assinatura;
      }
      obj.peca = p;
    }
    for (const [id, obj] of this.objetos) {
      if (!vistos.has(id)) {
        this.raiz.remove(obj.mesh);
        obj.mesh.geometry.dispose();
        obj.arestas.geometry.dispose();
        this.objetos.delete(id);
      }
    }
    this.#centralizar();
    this.selecionar(selecionado);
  }

  #centralizar() {
    if (!this.pecas.length) return;
    const xs = this.pecas.flatMap((p) => [p.x, p.x + p.dx]);
    const zs = this.pecas.flatMap((p) => [p.z, p.z + p.dz]);
    const ys = this.pecas.map((p) => p.y + p.dy);
    this.centro = {
      x: ((Math.min(...xs) + Math.max(...xs)) / 2) * MM,
      z: ((Math.min(...zs) + Math.max(...zs)) / 2) * MM,
    };
    this.tamanho = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 300) * MM;
    this.altura = Math.max(...ys) * MM;
    this.#posicionar();
  }

  #posicionar() {
    const t = this.fatorExplosao;
    for (const { mesh, peca: p } of this.objetos.values()) {
      const ordem = camadaPorId[p.camada]?.ordem ?? 0;
      mesh.position.set(
        (p.x + p.dx / 2) * MM - this.centro.x,
        (p.y + p.dy / 2) * MM + ordem * SEPARACAO_EXPLODIDA * t,
        (p.z + p.dz / 2) * MM - this.centro.z,
      );
    }
  }

  selecionar(id) {
    this.selecionado = id && this.objetos.has(id) ? id : null;
    const fantasma = this.transparencia && this.selecionado;
    for (const [pid, obj] of this.objetos) {
      const sel = pid === this.selecionado;
      const estado = sel ? 'destaque' : fantasma ? 'fantasma' : 'normal';
      obj.mesh.material = this.#materiaisDaPeca(obj.peca, estado);
      obj.mesh.renderOrder = sel ? 10 : 0;
      obj.arestas.material = sel ? this.matArestaSel : fantasma ? this.matArestaFantasma : this.matAresta;
      obj.arestas.renderOrder = sel ? 999 : 0;
      obj.mesh.castShadow = !fantasma || sel;
    }
    const visivel = Boolean(this.selecionado);
    this.cotas.visible = visivel;
    for (const r of [this.rotuloC, this.rotuloL, this.rotuloE, this.rotuloNome]) r.visible = visivel;
  }

  setTransparencia(ativo) {
    this.transparencia = ativo;
    this.selecionar(this.selecionado);
  }

  setExplodida(ativo) {
    this.explodida = ativo;
    if (this.reduzirMovimento) {
      this.fatorExplosao = ativo ? 1 : 0;
      this.#posicionar();
    }
    // Ajusta o alvo da câmera para a altura do conjunto.
    const alvoY = (this.altura ?? 0.15) / 2 + (ativo ? SEPARACAO_EXPLODIDA * 1.5 : 0);
    this.alvoSuave = new THREE.Vector3(0, alvoY, 0);
  }

  /** Posiciona a câmera: 'iso', 'topo', 'frente' ou 'lado'. */
  vista(tipo = 'iso') {
    // Distância para o pallet inteiro caber na tela, considerando a largura do visor (celular em pé).
    const raio = (this.tamanho ?? 1.2) * 0.78;
    const meiaV = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const meiaH = Math.atan(Math.tan(meiaV) * this.camera.aspect);
    const d = raio / Math.sin(Math.min(meiaV, meiaH)) / 1.35;
    const alvoY = (this.altura ?? 0.15) / 2 + (this.explodida ? SEPARACAO_EXPLODIDA * 1.5 : 0);
    const pos = {
      iso: [d * 0.78, d * 0.62, d * 0.92],
      topo: [0, d * 1.25, 0.0001],
      frente: [0, alvoY + d * 0.12, d * 1.2],
      lado: [d * 1.2, alvoY + d * 0.12, 0],
    }[tipo] ?? [d, d, d];
    this.camera.position.set(...pos);
    this.controles.target.set(0, alvoY, 0);
    this.alvoSuave = null;
    this.controles.update();
  }

  /** Imagem PNG do que está na tela (fundo branco). */
  capturarPNG() {
    const anterior = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0xffffff, 1);
    this.renderer.render(this.cena, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setClearColor(0x000000, anterior);
    return url;
  }

  setCorGrade(cor) {
    this.grade.material.color.set(cor);
  }

  // ---------------------------------------------------------------- cotas da peça selecionada

  #atualizarCotas() {
    if (!this.selecionado) return;
    const obj = this.objetos.get(this.selecionado);
    if (!obj) return;
    const p = obj.peca;
    const caixa = new THREE.Box3().setFromObject(obj.mesh, true);
    const { min, max } = caixa;
    const centro = caixa.getCenter(new THREE.Vector3());
    const cam = this.camera.position;
    const sx = cam.x >= centro.x ? 1 : -1;
    const sz = cam.z >= centro.z ? 1 : -1;
    const off = Math.max(0.035, (this.tamanho ?? 1) * 0.03);
    const tick = off * 0.35;

    const xBorda = sx > 0 ? max.x : min.x;
    const zBorda = sz > 0 ? max.z : min.z;
    const xLinha = xBorda + sx * off;
    const zLinha = zBorda + sz * off;
    const yTopo = max.y;

    const seg = [];
    const linha = (a, b) => seg.push(...a, ...b);
    // Cota em X (ao longo da borda virada para a câmera, no topo da peça)
    linha([min.x, yTopo, zBorda], [min.x, yTopo, zLinha + sz * tick]);
    linha([max.x, yTopo, zBorda], [max.x, yTopo, zLinha + sz * tick]);
    linha([min.x, yTopo, zLinha], [max.x, yTopo, zLinha]);
    // Cota em Z
    linha([xBorda, yTopo, min.z], [xLinha + sx * tick, yTopo, min.z]);
    linha([xBorda, yTopo, max.z], [xLinha + sx * tick, yTopo, max.z]);
    linha([xLinha, yTopo, min.z], [xLinha, yTopo, max.z]);
    // Cota em Y (no canto mais próximo da câmera)
    const xc = xBorda + sx * off;
    const zc = zBorda + sz * off;
    linha([xBorda, min.y, zBorda], [xc + sx * tick, min.y, zc + sz * tick]);
    linha([xBorda, max.y, zBorda], [xc + sx * tick, max.y, zc + sz * tick]);
    linha([xc, min.y, zc], [xc, max.y, zc]);

    const geo = this.cotas.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    geo.computeBoundingSphere();

    const m = medidasPeca(p);
    const u = this.unidade;
    const rotX = p.dx >= p.dz ? 'C' : 'L';
    const rotZ = p.dx >= p.dz ? 'L' : 'C';
    const rotY = p.tipo === 'toco' ? 'A' : 'E';
    this.rotuloC.element.textContent = `${rotX} ${medida(p.dx, u)}`;
    this.rotuloL.element.textContent = `${rotZ} ${medida(p.dz, u)}`;
    this.rotuloE.element.textContent = `${rotY} ${medida(m.espessura, u)}`;
    this.rotuloNome.element.textContent = `${p.codigo} · ${nomePeca(p)}`;

    this.rotuloC.position.set((min.x + max.x) / 2, yTopo, zLinha + sz * off * 0.6);
    this.rotuloL.position.set(xLinha + sx * off * 0.6, yTopo, (min.z + max.z) / 2);
    this.rotuloE.position.set(xc + sx * off * 0.8, (min.y + max.y) / 2, zc + sz * off * 0.8);
    this.rotuloNome.position.set(centro.x, max.y + off * 1.6, centro.z);
  }

  // ---------------------------------------------------------------- animação

  #loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      const alvo = this.explodida ? 1 : 0;
      if (Math.abs(this.fatorExplosao - alvo) > 0.001) {
        this.fatorExplosao += (alvo - this.fatorExplosao) * 0.14;
        if (Math.abs(this.fatorExplosao - alvo) < 0.002) this.fatorExplosao = alvo;
        this.#posicionar();
      }
      if (this.alvoSuave) {
        this.controles.target.lerp(this.alvoSuave, 0.12);
        if (this.controles.target.distanceTo(this.alvoSuave) < 0.001) this.alvoSuave = null;
      }
      this.controles.update();
      this.#atualizarCotas();
      this.renderer.render(this.cena, this.camera);
      this.rotulos.render(this.cena, this.camera);
    };
    tick();
  }
}
