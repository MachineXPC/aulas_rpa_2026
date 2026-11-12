# Montador de Pallets 3D

Interface web para montar um pallet em 3D a partir de um modelo pronto, editar as peças
e calcular volume de madeira, custos, preço de venda e uma **estimativa** de carga.

Não precisa instalar nada além de um navegador. O Three.js (motor 3D) já vem na pasta
`vendor/`, então funciona até sem internet (só as fontes do Google ficam no padrão do sistema).

## Como abrir

O navegador bloqueia módulos JavaScript abertos direto do disco (`file://`), então é preciso
um servidor local. Com o Python (que você já usa nas aulas):

```bash
cd projetos/pallet-3d
```

```bash
python -m http.server 8000
```

Depois abra <http://localhost:8000> no navegador. Para parar o servidor: `Ctrl + C` no terminal.

## Como usar

1. **Escolha o modelo** (PBR, Europeu, Descartável, Quadrado) no painel **Montar**.
2. **Mexa nos controles deslizantes**: comprimento, largura, nº de tábuas na face e espessura.
   O pallet muda na hora. Escolha tocos **pequenos** ou **estilo PBR** e ligue/desligue a base.
3. **Clique numa peça** no 3D ou na lista: ela fica destacada e mostra as medidas sobre a madeira.
   No cartão da peça dá para mudar as medidas, girar, duplicar ou remover.
   **Arraste a peça selecionada** para mudar a posição. Clique fora para limpar.
4. Veja os **4 números** embaixo do 3D: madeira (m³ e kg), custo, preço sugerido e carga estimada.
   A **margem** se ajusta direto no controle do preço.
5. Abra as seções de baixo para ver **o passo a passo** do volume, **editar os preços**
   (madeira, pregos, frete, outros) e entender **a estimativa de carga**.
6. **Salvar e exportar**: salva no navegador ou em `.json`, e exporta imagem PNG,
   desenho técnico SVG, custos em CSV e relatório (HTML ou impressão/PDF).

Outros botões: **Vista explodida** (separa as camadas; clique de novo para montar),
**Centralizar** (volta a câmera), **Restaurar modelo**, **mm / cm / m** e **desfazer** (`Ctrl+Z`).

Atalhos com uma peça selecionada: `Delete` remove, `Ctrl+D` duplica, setas movem 10 mm, `Esc` limpa a seleção.

> Os controles deslizantes geram o pallet de novo. Se você tinha mexido em peças avulsas,
> essas mudanças são refeitas pelo controle (use `Ctrl+Z` para voltar).

## Como os cálculos funcionam

Todas as medidas são guardadas em **milímetros**. A unidade escolhida muda só a exibição.

- **Volume**: cada peça = comprimento × largura × espessura (em metros). Peças iguais são
  agrupadas, multiplicadas pela quantidade e somadas. A perda do corte (%) é somada para
  dar o volume a comprar.
- **Pregos**: o sistema conta as *ligações* (onde uma peça encosta na de baixo) e multiplica
  pelos pregos por ligação. Dá para digitar o total na mão.
- **Frete**: valor da carga ÷ pallets por carga.
- **Preço sugerido**: margem sobre o preço → `custo ÷ (1 − margem)`.
  Exemplo: custo R$ 75 com margem de 25% → R$ 100 (lucro de R$ 25 = 25% do preço).
  Repare que não é o mesmo que somar 25% no custo (isso daria R$ 93,75).

### Capacidade de carga — leia antes de usar

O número é uma **estimativa teórica simplificada, não uma garantia de segurança**.

O modelo trata cada tábua como uma viga com carga distribuída entre os apoios
(`q = 8·σ·W/L²`, com `W = b·h²/6` e `σ = resistência ÷ fator de segurança`) e cada toco
em compressão (`área × resistência`). Como toda a carga passa por todas as camadas,
a camada mais fraca define o resultado. Ele vale para carga estática, distribuída e com o
pallet no chão.

Ficam de fora: nós, umidade e rachaduras, a resistência dos pregos, carga concentrada,
impacto de empilhadeira e uso em porta-pallet. Para uso real, a capacidade precisa ser
confirmada em ensaio (por exemplo, ISO 8611) ou por um responsável técnico.

Os valores de resistência, densidade e preço das madeiras são **exemplos aproximados**.
Troque pelos dados do seu fornecedor.

## Estrutura

```
pallet-3d/
├── index.html          # página
├── css/estilo.css      # visual (tema claro e escuro)
├── js/
│   ├── main.js         # estado, tela e eventos
│   ├── cena3d.js       # cena 3D (Three.js): peças, seleção, arrastar, cotas, vista explodida
│   ├── modelos.js      # gerador do pallet por parâmetros, modelos, tipos de toco
│   ├── calculos.js     # volume, pregos, custos, preço e capacidade (funções puras)
│   ├── exportar.js     # desenho SVG, CSV, relatório HTML
│   └── unidades.js     # mm / cm / m e números no padrão brasileiro
├── tests/calculos.test.mjs
└── vendor/three/       # Three.js r170 (licença MIT)
```

## Testes

Os cálculos têm testes automáticos (Node.js 18 ou mais novo):

```bash
node --test tests/*.test.mjs
```

## Ideias para próximas versões

- Pallet de longarina (sem tocos) como modelo.
- Cálculo de pregos por área de contato e tipo de prego.
- Publicar no GitHub Pages para abrir sem servidor local.
