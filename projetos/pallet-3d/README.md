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

## O que dá para fazer

| Recurso | Onde fica |
|---|---|
| Escolher o modelo (PBR, Europeu, Descartável, Quadrado) | Topo → **Modelo** |
| Unidade de medida (mm, cm, m) | Topo → botões **mm / cm / m** |
| Restaurar o pallet original | Topo → **Restaurar modelo** (Ctrl+Z desfaz) |
| Girar, aproximar, mover a câmera | Arrastar, roda do mouse / pinça, botão direito / dois dedos |
| Vistas prontas | **3D, Topo, Frente, Lado** |
| Vista explodida (separa as camadas) | **Vista explodida** → clique de novo para voltar |
| Selecionar peça (mostra medidas sobre a madeira) | Clique na peça no 3D ou na lista. Clique fora limpa |
| Adicionar tábua ou toco (pequeno ou estilo PBR) | **+ Tábua**, **+ Toco** |
| Duplicar, remover, girar 90°, mover, editar medidas | Painel da peça selecionada |
| Lista de componentes agrupada por tipo e camada | Painel **Componentes** |
| Volume em m³ com passo a passo | Aba **Volume** |
| Custos (madeira, pregos, frete, outros) e preço sugerido | Aba **Custos e preço** |
| Estimativa de capacidade de carga | Aba **Capacidade de carga** |
| Salvar / abrir montagens | **Salvar** e **Abrir** (no navegador ou arquivo `.json`) |
| Exportar imagem, desenho técnico, CSV, relatório, PDF | **Exportar** |

Atalhos com uma peça selecionada: `Delete` remove, `Ctrl+D` duplica, setas movem em X/Z,
`Page Up/Down` movem em Y (com o empilhamento automático desligado), `Esc` limpa a seleção,
`Ctrl+Z` / `Ctrl+Y` desfazem e refazem.

## Como os cálculos funcionam

Todas as medidas são guardadas em **milímetros**. A unidade escolhida muda só a exibição.

- **Volume**: cada peça = comprimento × largura × espessura (em metros). Peças iguais são
  agrupadas, multiplicadas pela quantidade e somadas. A perda do corte (%) é somada para
  dar o volume a comprar.
- **Pregos**: o sistema conta as *ligações* (onde uma peça encosta na de baixo) e multiplica
  pelos pregos por ligação. Dá para digitar o total na mão.
- **Frete**: valor da carga ÷ pallets por carga.
- **Preço sugerido**: com *margem sobre o preço* → `custo ÷ (1 − margem)`; com *markup* →
  `custo × (1 + markup)`. Exemplo: custo R$ 75 com margem de 25% → R$ 100 (lucro de R$ 25 = 25% do preço).
  Com markup de 25%, o mesmo custo vira R$ 93,75.

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
│   ├── cena3d.js       # cena 3D (Three.js): peças, seleção, cotas, vista explodida
│   ├── modelos.js      # modelos prontos, camadas, tipos de toco, empilhamento
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

- Arrastar as peças com o mouse direto no 3D.
- Pallet de longarina (sem tocos) como modelo.
- Cálculo de pregos por área de contato e tipo de prego.
- Publicar no GitHub Pages para abrir sem servidor local.
