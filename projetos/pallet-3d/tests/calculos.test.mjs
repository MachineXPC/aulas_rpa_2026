// Testes dos cálculos. Rode com:  node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELOS, gerarModelo, dimensoesTotais, empilhar } from '../js/modelos.js';
import {
  CUSTOS_PADRAO, MADEIRA_PADRAO, calcularCapacidade, calcularCustos, calcularVolume,
  encontrarContatos, precoVenda, verificarProblemas,
} from '../js/calculos.js';
import { lerNumero, medida, paraMm } from '../js/unidades.js';

const perto = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('todos os modelos montam sem peças sobrepostas nem soltas', () => {
  for (const m of MODELOS) {
    const p = gerarModelo(m.id);
    const pr = verificarProblemas(p);
    assert.equal(pr.sobrepostas.size, 0, `${m.id}: sobreposição`);
    assert.equal(pr.semApoio.size, 0, `${m.id}: peça sem apoio`);
  }
});

test('PBR: medidas gerais 1200 × 1000 × 144 mm', () => {
  const d = dimensoesTotais(gerarModelo('pbr'));
  assert.deepEqual([d.x, d.z, d.y], [1200, 1000, 144]);
});

test('volume do PBR confere com a conta feita à mão', () => {
  // 3 base (1,2×0,1×0,022) + 9 tocos (0,1×0,1×0,078) + 3 travessas (0,1×0,022×1,0) + 7 face (1,2×0,1×0,022)
  const esperado = 3 * 0.00264 + 9 * 0.00078 + 3 * 0.0022 + 7 * 0.00264;
  const v = calcularVolume(gerarModelo('pbr'), 10, 500);
  perto(v.total, esperado, 1e-9);
  perto(v.totalCompra, esperado * 1.1, 1e-9);
  perto(v.pesoKg, esperado * 500, 1e-6);
});

test('ligações do PBR: 9 base-toco + 9 toco-travessa + 21 travessa-face', () => {
  assert.equal(encontrarContatos(gerarModelo('pbr')).length, 39);
});

test('preço: margem sobre o preço e markup sobre o custo', () => {
  perto(precoVenda(75, 25, 'margem'), 100);
  perto(precoVenda(100, 25, 'markup'), 125);
  assert.ok(Number.isNaN(precoVenda(100, 100, 'margem')));
});

test('custos somam madeira, pregos, frete e outros', () => {
  const p = gerarModelo('pbr');
  const c = { ...CUSTOS_PADRAO, pregosManual: 100, precoPrego: 0.1, freteTotal: 500, palletsPorFrete: 100, outros: 2 };
  const r = calcularCustos(p, c);
  perto(r.itens.pregos, 10);
  perto(r.itens.frete, 5);
  perto(r.custoTotal, r.itens.madeira + 10 + 5 + 2, 1e-9);
});

test('capacidade: estimativa finita e positiva; madeira mais forte aguenta mais', () => {
  const p = gerarModelo('pbr');
  const fraca = calcularCapacidade(p, MADEIRA_PADRAO);
  const forte = calcularCapacidade(p, { ...MADEIRA_PADRAO, fm: 50 });
  assert.ok(fraca.kg > 0 && Number.isFinite(fraca.kg));
  assert.ok(forte.kg > fraca.kg);
});

test('capacidade: tábua sem apoio é avisada', () => {
  const p = gerarModelo('pbr');
  const solta = { ...p[p.length - 1], id: 'solta', x: 5000 };
  const cap = calcularCapacidade([...p, solta]);
  assert.equal(cap.semApoio.length, 1);
});

test('empilhar: mudar a altura dos tocos sobe as camadas de cima', () => {
  const p = gerarModelo('pbr');
  for (const t of p.filter((x) => x.tipo === 'toco')) t.dy = 100;
  empilhar(p);
  assert.equal(dimensoesTotais(p).y, 166);
});

test('unidades: leitura e formatação em pt-BR', () => {
  assert.equal(lerNumero('1.200'), 1200);
  assert.equal(lerNumero('1,5'), 1.5);
  assert.equal(lerNumero('1.234,5'), 1234.5);
  assert.ok(Number.isNaN(lerNumero('abc')));
  assert.equal(paraMm(1.2, 'm'), 1200);
  assert.equal(medida(1200, 'mm'), '1.200 mm');
  assert.equal(medida(1200, 'm'), '1,2 m');
  assert.equal(medida(22, 'cm'), '2,2 cm');
});
