// Unidades de medida.
// Internamente TODAS as medidas são guardadas em milímetros (mm).
// A unidade escolhida pela pessoa só muda o que aparece na tela e
// como os números digitados são interpretados.

export const UNIDADES = {
  mm: { nome: 'Milímetros', sigla: 'mm', fator: 1, casas: 0 },
  cm: { nome: 'Centímetros', sigla: 'cm', fator: 10, casas: 1 },
  m: { nome: 'Metros', sigla: 'm', fator: 1000, casas: 3 },
};

const fmtCache = new Map();
function formatador(min, max) {
  const chave = `${min}-${max}`;
  if (!fmtCache.has(chave)) {
    fmtCache.set(chave, new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    }));
  }
  return fmtCache.get(chave);
}

/** Formata um número no padrão brasileiro (1.234,56). */
export function numero(valor, casas = 2, casasMin = casas) {
  if (!Number.isFinite(valor)) return '—';
  return formatador(casasMin, casas).format(valor);
}

/** Converte mm para a unidade escolhida (número puro). */
export function deMm(mm, unidade) {
  return mm / UNIDADES[unidade].fator;
}

/** Converte da unidade escolhida para mm. */
export function paraMm(valor, unidade) {
  return valor * UNIDADES[unidade].fator;
}

/** Texto da medida na unidade escolhida, ex.: "1.200 mm", "120 cm", "1,2 m". */
export function medida(mm, unidade, comSigla = true) {
  const u = UNIDADES[unidade];
  const txt = numero(mm / u.fator, u.casas, 0);
  return comSigla ? `${txt} ${u.sigla}` : txt;
}

/** Valor para preencher um campo de texto editável (sem separador de milhar). */
export function valorCampo(mm, unidade) {
  const u = UNIDADES[unidade];
  const v = Math.round((mm / u.fator) * 10 ** u.casas) / 10 ** u.casas;
  return String(v).replace('.', ',');
}

/**
 * Lê um número digitado pela pessoa. Aceita "1200", "1.200", "1,2", "1.200,5".
 * Retorna NaN se não for um número.
 */
export function lerNumero(texto) {
  if (typeof texto === 'number') return texto;
  let t = String(texto ?? '').trim().replace(/\s/g, '').replace(/^R\$/i, '');
  if (!t) return NaN;
  if (t.includes(',')) {
    // Formato brasileiro: ponto = milhar, vírgula = decimal.
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    // "1.200" sem vírgula: ponto como separador de milhar.
    t = t.replace(/\./g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function moeda(valor) {
  if (!Number.isFinite(valor)) return '—';
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
