---
title: "Arquitetura de Renderização no Unity 6: Substituir MPB por RSUV e GPU Resident Drawer"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: "Análise abrangente da transição arquitetónica de MaterialPropertyBlock para RSUV e GPU Resident Drawer visando desempenho AAA no Unity 6."
lang: pt-PT
translation_id: unity6-material-rsuv-grd
math: true
---

## **Resumo Executivo (Executive Summary)**

A transição para o Unity 6 assinala uma mudança arquitetónica fundamental na forma como os pipelines de renderização (*render pipelines*) processam geometria instanciada em grande volume. Historicamente, no desenvolvimento de videojogos, a otimização de múltiplos objetos que partilham um único material, mas exigem variantes de propriedades individuais (como alterações de cor — *color tints*), dependia frequentemente da interface de programação de aplicações (API) `MaterialPropertyBlock` (MPB) combinada com o sistema padrão de GPU Instancing. Contudo, uma análise aprofundada do Universal Render Pipeline (URP) e do High Definition Render Pipeline (HDRP) no Unity 6 revela que esta abordagem herdada (*legacy*) já não constitui o caminho ideal e, em diversos cenários, provoca uma degradação severa do desempenho.

A avaliação do rascunho documental fornecido para o «Long Gil Studio DevLog» revela uma mistura entre teoria de otimização legada válida em versões anteriores e um equívoco grave acerca das funcionalidades modernas de renderização do Unity 6. Em concreto, a recomendação do rascunho de utilizar `MaterialPropertyBlock` colide diretamente com a nova tecnologia **GPU Resident Drawer (GRD)** do Unity 6 e com a API **BatchRendererGroup (BRG)** subjacente.[^1] Para alcançar o máximo débito de renderização, os programadores têm obrigatoriamente de adotar o **Renderer Shader User Value (RSUV)** ou migrar integralmente para a **Data-Oriented Technology Stack (DOTS)**.[^3]

Este relatório técnico apresenta uma análise pormenorizada dos pontos de estrangulamento da renderização, dos mecanismos de funcionamento do Scriptable Render Pipeline (SRP) Batcher, das consequências sistémicas da duplicação de materiais e dos padrões modernos indispensáveis para atingir desempenho de renderização de nível AAA no Unity 6. Além disso, disponibiliza um artigo técnico revisto e redigido profissionalmente para publicação no Long Gil Studio DevLog.

## **Parte I: Avaliação Técnica do Rascunho Original do Long Gil Studio**

O texto do rascunho inicial coloca um problema de renderização muito específico: otimizar uma cena (*Scene*) repleta de inúmeros objetos idênticos que partilham um único material, mas exigem modificações de cor individuais. O rascunho identificou corretamente os antipadrões (*anti-patterns*), mas prescreveu uma solução que prejudica o desempenho no contexto arquitetónico do Unity 6.

### **Aspetos Corretos do Rascunho Original**

1. **A Penalização da Duplicação de Materiais (Material Duplication):** O rascunho indica corretamente que criar instâncias de material separadas para cada objeto (por exemplo, através de `GetComponent<Renderer>().material.color`) conduz ao inchaço de memória (*memory bloat*) e destrói por completo o agrupamento de chamadas de desenho (*draw call batching*).[^5] Aceder à propriedade `.material` obriga o motor Unity a clonar silenciosamente esse material, perdendo de forma permanente a capacidade do SRP Batcher ou do GPU Instancing para agrupar estes objetos numa única chamada SetPass.[^5]
2. **Mecânica do MaterialPropertyBlock (MPB):** O rascunho identifica com exatidão que o MPB funciona como um buffer de substituição de dados (*data override buffer*), permitindo ao renderer transmitir propriedades por instância (*per-instance*) para a GPU sem gerar um novo clone do material.[^7]
3. **Propriedades de Cadeia (String) versus Identificadores Inteiros (Integer IDs):** O rascunho salienta apropriadamente a latência da Unidade Central de Processamento (CPU) originada pelo uso de cadeias de texto para pesquisar propriedades de shader, defendendo a pré-inicialização de identificadores inteiros através de `Shader.PropertyToID()` para otimizar ciclos críticos.[^7]

### **Inexatidões Graves e Paradigmas Obsoletos**

1. **MPB como um «Padrão AAA» no Unity 6:** A falha mais significativa do rascunho original reside em afirmar que o MPB representa a solução «AAA» ideal para o Unity 6. Embora o MPB fosse norma no Built-In Render Pipeline (arquitetura antiga), atua como um fator disruptivo nas arquiteturas SRP modernas.[^8] Aplicar um MPB a um GameObject exclui imediatamente esse objeto do fluxo do SRP Batcher.[^10]
2. **Dependência do GPU Instancing Herdado:** O rascunho reconhece que o MPB quebra o SRP Batcher e sugere recorrer ao GPU Instancing tradicional como alternativa de recurso. Embora seja tecnicamente exequível ao quebrar manualmente a compatibilidade SRP e ativar o Instancing, tal força o motor a contornar a arquitetura SRP altamente otimizada.[^12]
3. **Omissão do GPU Resident Drawer (GRD):** O Unity 6 introduz o GPU Resident Drawer, um sistema que transfere a geração de chamadas de desenho (*draw calls*) para *compute shaders*, reduzindo a sobrecarga da CPU em até 50%.[^14] A presença de um `MaterialPropertyBlock` proíbe estritamente que um GameObject participe no GRD.[^1] Recomendar MPB no Unity 6 impede, na prática, que os projetos tirem partido da funcionalidade de otimização mais poderosa do motor.
4. **Ausência do Renderer Shader User Value (RSUV):** Introduzido no Unity 6.3 LTS, o RSUV constitui a substituição arquitetónica direta do MPB ao lidar com variações simples por objeto.[^15] O RSUV permite passar um número inteiro de 24 bits para o shader em cada renderer sem quebrar o SRP Batcher nem o GPU Resident Drawer.[^3]

## **Parte II: Análise Fundamental dos Pontos de Estrangulamento (Bottlenecks) na Renderização**

Para compreender por que razão determinadas chamadas de API destroem a taxa de fotogramas (*frame rate*), importa examinar o modelo de comunicação entre a Unidade Central de Processamento (CPU) e a Unidade de Processamento Gráfico (GPU). A arquitetura de hardware moderna exige uma sincronização estreita, mas sensível à latência, entre estes dois processadores.

### **Custo de Comunicação CPU-GPU (Overhead)**

O processo de renderizar um fotograma obriga a CPU a percorrer todos os objetos visíveis no campo de visão da câmara (*frustum culling*), determinar as suas propriedades de material, vincular (*bind*) as texturas e os shaders necessários na memória da GPU e emitir uma instrução de desenho (*draw command*). A operação mais dispendiosa neste pipeline não é a rasterização de polígonos pela GPU, mas sim as alterações de estado obrigatórias antes da chamada de desenho — designadas habitualmente por chamadas **SetPass**.[^5]

Sempre que a CPU encontra um novo material, vê-se obrigada a suspender o pipeline de renderização para carregar os novos parâmetros para a GPU.[^18] Se uma cena contiver 10 000 inimigos e cada inimigo possuir uma instância de material única para apresentar uma cor de armadura distinta, a CPU terá de executar 10 000 alterações de estado. Isto origina uma sobrecarga colossal na CPU (*CPU Overhead*), provocando um ponto de estrangulamento em que a GPU permanece inativa à espera de instruções da CPU.

### **Fragmentação de Memória da Propriedade `.material`**

Quando um script acede a `Renderer.material` para alterar uma cor, o motor vê-se forçado a proteger a integridade do recurso (*asset*) partilhado original. Para tal, executa internamente um `Instantiate()` sobre esse material. Isto acarreta duas penalizações severas para o desempenho:

1. **Destruição do Batching:** O objeto deixa de partilhar a referência de material com os seus pares. De imediato, o Unity interrompe qualquer forma de Static Batching, Dynamic Batching ou SRP Batching para esse objeto.[^5] A placa gráfica terá de o processar como uma entidade totalmente isolada.
2. **Recolha de Lixo (Garbage Collection) e Fugas de Memória (Memory Leaks):** A nova cópia do material é criada no Heap gerido pelo C#. Não é recolhida automaticamente aquando da destruição do objeto. A menos que o programador invoque explicitamente `Destroy(renderer.material)`, a memória mantém-se alocada. Isto gera fugas de memória que obrigam o Garbage Collector (GC) a desencadear ciclos de *Mark-and-Sweep*, provocando paragens súbitas (*spikes*) e quebras abruptas de FPS.[^5]

## **Parte III: Arquitetura do SRP Batcher e a Obsolescência do GPU Instancing Tradicional**

O Scriptable Render Pipeline (SRP) reorganizou pela raiz a forma como o Unity gere os dados dos shaders. Compreender o SRP Batcher revela-se fundamental para perceber por que razão os métodos antigos de otimização falham por completo no Unity 6.

### **Mecanismo de Funcionamento do SRP Batcher**

Nos pipelines antigos (*Built-in*), os materiais carregavam dados para a GPU através de variáveis uniformes separadas (*separate uniform variables*). O SRP Batcher substitui esta abordagem recorrendo a grandes buffers persistentes na GPU designados por Buffers de Constantes (**Constant Buffers - CBUFFERs**).[^11]

A arquitetura SRP obriga os shaders a dividir as suas variáveis em dois blocos de buffer distintos 11:

* `UnityPerMaterial`: Um CBUFFER que contém as propriedades partilhadas por todos os objetos que utilizam o mesmo material (por exemplo: cor base, mapas metálicos — *metallic maps*, suavidade).
* `UnityPerDraw`: Um CBUFFER que contém as propriedades exclusivas de uma chamada de desenho específica (por exemplo: matrizes de transformação espacial do objeto — *transformation matrices*).

Uma vez que o buffer `UnityPerMaterial` persiste de forma contínua na memória da GPU, a CPU deixa de necessitar de recarregar as propriedades do material no ciclo de renderização desde que os objetos consecutivos partilhem a mesma variante de shader (*shader variant*).[^18] O SRP Batcher limita-se a vincular (*bind*) este buffer persistente e a atualizar apenas o buffer `UnityPerDraw`, muito mais reduzido. Este desenho reduz drasticamente o custo de CPU, acelerando por vezes o desempenho de renderização entre 1,2x e 4x.[^21]

### **O Conflito Central com `MaterialPropertyBlock`**

A API `MaterialPropertyBlock` foi originalmente concebida para substituir propriedades de material ao nível do renderer. Todavia, dado que o SRP Batcher assenta na separação estrita e na persistência do CBUFFER `UnityPerMaterial`, injetar um MPB viola diretamente esta disposição de memória.[^8]

Quando um MPB é aplicado, o Unity deixa de poder garantir que o buffer persistente de material é aplicado uniformemente ao objeto. Consequentemente, o motor vê-se forçado a expulsar abruptamente o objeto do pipeline do SRP Batcher.[^9] A documentação oficial do Unity confirma-o explicitamente: «Note-se que esta funcionalidade não é compatível com o SRP Batcher. A utilização de MPB no URP ou HDRP resultará muito provavelmente numa quebra de desempenho».[^8]

### **A Solução de Recurso Legada: `Graphics.DrawMeshInstanced`**

Historicamente, se um programador necessitasse de variações em massa (por exemplo, uma floresta composta por árvores com cores diferentes), aceitava a perda do SRP Batcher e recorria ao GPU Instancing.[^12] Tal exigia quebrar manualmente a compatibilidade SRP do shader declarando uma propriedade fora do buffer `UnityPerMaterial` e ativando «Enable GPU Instancing» no material.[^13]

Embora o GPU Instancing reduza as chamadas de desenho ao transmitir matrizes de transformação e dados de cor em arrays, padece de limitações severas.[^12] Apresenta dificuldades perante *overdraw* acentuado, exige malhas (*meshes*) idênticas e impõe um fardo pesado à CPU para recolher e carregar os arrays de instâncias (*instance arrays*) em cada fotograma. No Unity 6, este método foi integralmente substituído pela arquitetura GPU Resident Drawer.[^23]

## **Parte IV: Incompatibilidade do `MaterialPropertyBlock` (MPB) com o Ecossistema do Unity 6**

Uma análise mais aprofundada do MPB demonstra que não só quebra o SRP Batcher, como também acarreta riscos estruturais para as ferramentas de depuração (*debugging tools*) e para os sistemas de iluminação (*lighting systems*) no Unity 6.

### **Impacto nos Dados de Lightmap e Global Illumination**

Uma das consequências menos referidas da utilização incorreta de MPB consiste na eliminação dos dados de Lightmap. Quando se cria um `new MaterialPropertyBlock()` e se atribui através de `Renderer.SetPropertyBlock()`, o bloco de propriedades transmitido substitui por completo o estado local do renderer.[^24]

Se o objeto estiver a utilizar Global Illumination (GI) pré-calculada (*baked*), a informação referente às coordenadas UV do Lightmap e aos coeficientes de Light Probe encontra-se armazenada implicitamente no próprio bloco de propriedades do renderer.[^24] Caso não se invoque `Renderer.GetPropertyBlock(block)` antes de definir a cor, apagar-se-á acidentalmente a informação de iluminação do objeto. Embora o rascunho original do Long Gil Studio tenha tratado corretamente essa parte do `GetPropertyBlock`, o próprio ato de invocar repetidamente esta API em milhares de objetos gera uma latência adicional de CPU nada despicienda.

| Técnica de Otimização | Provoca fuga de RAM | Compatível com SRP Batcher | Compatível com GRD | Compatível com DOTS | Utilização recomendada |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`Material.color`** | Sim | Não | Não | Não | Evitar a todo o custo |
| **`MaterialPropertyBlock`** | Não | Não | Não | Não | Projetos Built-in antigos |
| **GPU Instancing** | Não | Não (Conflito) | Não | Não | Unity 2020-2022 |
| **Renderer Shader User Value** | Não | Sim | Sim | Sim | Norma Unity 6.3+ |

Conforme ilustra a tabela acima, o MPB é atualmente uma técnica de geração passada. Resolve o problema da memória RAM, mas compromete todo o pipeline moderno de renderização do Unity 6.

## **Parte V: O Ponto de Viragem Arquitetónico: GPU Resident Drawer (GRD) e `BatchRendererGroup` (BRG)**

O Unity 6 introduz uma via de renderização revolucionária: o **GPU Resident Drawer**. Este sistema altera o paradigma da geração de comandos de desenho comandada pela CPU para um ciclo de renderização altamente autónomo gerido pela GPU.[^1]

### **Arquitetura do GPU Resident Drawer**

O GPU Resident Drawer opera com base na API de baixo nível `BatchRendererGroup` (BRG).[^1] Em vez de a CPU avaliar quais os objetos visíveis (*frustum culling*) e enviar chamadas de desenho individuais ou instanciadas, a CPU carrega todos os dados espaciais e de material da cena para a GPU.[^25] Os *compute shaders* executam então o descarte de objetos fora de câmara, o descarte por oclusão (*occlusion culling*) e a geração de chamadas de desenho inteiramente na GPU.[^14]

Os ganhos de desempenho são notáveis. Através da renderização indireta (`DrawInstancedIndirect`), a carga de trabalho da CPU necessária para a renderização pode diminuir até 50% em cenas complexas.[^14] Além disso, quando combinado com GPU Occlusion Culling, o processamento de triângulos pode ser reduzido em quase 90%, enquanto o tempo de fotograma da GPU (*frame buffer time*) baixa para menos de metade.[^28]

### **A API `BatchRendererGroup` (BRG) e o Culling**

Por trás do GRD encontra-se o `BatchRendererGroup`. O BRG requer inicialização com uma função *callback* `OnPerformCulling`.[^30] Aqui, a CPU limita-se a configurar a visibilidade (*visibility*) e a emitir as chamadas de desenho em formato de array. Os dados do objeto (transformações, cores, sinalizadores) são carregados para um `GraphicsBuffer`.[^25] Tal permite enviar milhões de triângulos para a GPU com apenas algumas chamadas SetPass.

### **A Incompatibilidade Crítica do MPB com o GRD**

A informação mais determinante acerca da otimização no Unity 6 reside na fragilidade dos requisitos de elegibilidade para o GPU Resident Drawer. Para que um objeto seja processado pelo GRD, tem de respeitar regras estritas de disposição de dados.[^2]

A documentação oficial do Unity 6.1+ declara claramente que os GameObjects que utilizam a API `MaterialPropertyBlock` são excluídos imediatamente do GPU Resident Drawer.[^1] Adicionalmente, o objeto não pode conter scripts que recorram a *callbacks* por instância como `OnRenderObject`.[^2]

Quando um programador associa um MPB para alterar a cor de um objeto, força inadvertidamente o motor a reverter para o modo de renderização legado baseado na CPU para esse objeto específico. Se isto for aplicado a 10 000 unidades num jogo de estratégia em tempo real, a sobrecarga da CPU dispara vertiginosamente, anulando por completo os benefícios da atualização para o Unity 6.

## **Parte VI: A Norma Moderna: Renderer Shader User Value (RSUV) no Unity 6.3**

Reconhecendo o impasse arquitetónico criado pela incompatibilidade do MPB com os pipelines modernos, o Unity introduziu a funcionalidade **Renderer Shader User Value (RSUV)** na versão Unity 6.3 LTS.[^15] O RSUV assume o papel de substituto definitivo do `MaterialPropertyBlock` sempre que os programadores necessitam de aplicar personalizações simples por instância em múltiplos renderers que partilham um único material.[^3]

### **Mecanismo de Funcionamento do RSUV**

O RSUV contorna as modificações complexas de buffer que penalizam o MPB. Em alternativa, tira partido de um canal inteiro de 24 bits sumamente eficiente, transmitido diretamente em conjunto com os dados de desenho padrão do renderer.[^3] Pelo facto de este número inteiro estar integrado na estrutura de dados existente em vez de exigir uma substituição de buffer separada (*buffer override*), mantém compatibilidade absoluta tanto com o SRP Batcher como com o GPU Resident Drawer.[^3]

### **Implementação e Codificação Bitwise (Bitwise Encoding)**

Para utilizar o RSUV na variação de cores, a CPU tem de codificar os valores RGB pretendidos num único inteiro sem sinal de 24 bits (`uint`). Cada canal de cor (Vermelho — *Red*, Verde — *Green*, Azul — *Blue*) ocupa 8 bits (fornecendo valores de 0 a 255).[^3]

A operação de codificação recorre aos operadores de deslocamento de bits à esquerda (`<<`) e OU bit a bit (`|`). A expressão matemática apresenta-se assim:

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

Na implementação prática em C#, iterar sobre um array de componentes `MeshRenderer` para aplicar tonalidades aleatórias proporciona um desempenho muito elevado sem qualquer alocação de memória descartável (*zero garbage allocation*)[^3]:

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // Calcula uma cor aleatória (utilizando o espaço HSV para cores mais vivas)  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // Codifica RGB num inteiro de 24 bits (Azul, Verde, Vermelho)  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // Aplica o valor diretamente ao renderer através da nova API do Unity 6.3
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **Descodificação no Shader (Shader Decoding)**

Do lado da GPU, o shader tem de desempacotar (*unpack*) este inteiro de 24 bits novamente num valor de cor `float4` normalizado. O Unity disponibiliza a variável interna `unity_RendererUserValue` para aceder a este bloco de dados.[^3]

O processo de descodificação utiliza o operador de deslocamento de bits à direita (`>>`) e o operador E bit a bit (`&`) com uma máscara de bits `255` para isolar cada segmento de 8 bits. Em seguida, multiplica-se pelo inverso de 255 (`1.0 / 255.0`) para normalizar o valor para o intervalo entre `0.0` e `1.0`.[^3]

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

Em High-Level Shader Language (HLSL) ou através de um nó Custom Function no Shader Graph, a lógica de desempacotamento expressa-se do seguinte modo 3:

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // Canal Vermelho (Red)  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // Canal Verde (Green)  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // Canal Azul (Blue)  
    1.0 // Alfa fixo  
);
```

Esta mudança de paradigma evidencia uma estratégia de otimização profunda: trocar complexidade de estruturas de dados (como o MPB) por cálculo matemático puro (RSUV). Os processadores de GPU são exímios em operações bit a bit, o que significa que o custo de descodificação é praticamente impercetível (com um custo mínimo em ciclos de relógio — *clock cycles*). Entretanto, a preservação dos fluxos do SRP Batcher e do GPU Resident Drawer proporciona reduções enormes no tempo de fotograma (*frame-time*).[^16]

## **Parte VII: Solução em Escala Extrema: DOTS, ECS e `URPMaterialPropertyOverride`**

Para projetos que operam numa escala que ultrapassa a capacidade de processamento dos GameObjects padrão (por exemplo, simulações de multidões com centenas de milhares de unidades independentes — *boids*, exércitos massivos em jogos RTS), a tecnologia Data-Oriented Technology Stack (DOTS) do Unity disponibiliza a arquitetura de renderização definitiva.[^4]

### **Gestão de Memória Orientada a Dados (Data-Oriented Memory)**

Ao contrário das limitações do sistema orientado a objetos, onde os GameObjects ficam dispersos pelo Heap, as entidades (*entities*) no Entity Component System (ECS) residem integralmente em arrays contíguos de dados (*contiguous arrays of data*) na memória.[^4] Esta disposição de memória alinha-se perfeitamente com a estrutura exigida pela API `BatchRendererGroup` (BRG) para atingir o máximo desempenho.

No pacote Entities Graphics, os programadores podem recorrer ao componente `URPMaterialPropertyOverride`.[^4] Este sistema permite substituir propriedades de material por entidade (*per-entity material overrides*) sem utilizar de todo a prejudicial API `MaterialPropertyBlock`.

### **Mecanismo de Funcionamento do DOTS Instancing**

Quando uma entidade é processada em DOTS, o shader configurado para DOTS Instancing (assinalando *Override Property Declaration* e selecionando *Hybrid Per Instance* no Shader Graph) recebe um inteiro exclusivo de 32 bits (um valor de metadados — *metadata value*).[^34] Este inteiro representa um deslocamento (*offset*) localizado dentro de um `GraphicsBuffer` persistente na GPU.[^34]

O shader utiliza este offset para carregar os dados da propriedade específica para a instância que está atualmente a renderizar.[^34] O que distingue o DOTS Instancing é o facto de, se várias entidades partilharem o mesmo valor de propriedade, o DOTS Instancing permitir que leiam esse valor exatamente a partir da mesma posição na memória (o mesmo offset), poupando ciclos de GPU (*GPU cycles*) e minimizando a duplicação de memória.[^34] Como a propriedade é carregada via offset em vez de ficar confinada nos buffers de constantes tradicionais, a dimensão de uma chamada de desenho deixa de estar estritamente limitada, possibilitando contagens de instâncias gigantescas.

```csharp
// Exemplo de atribuição de valores RSUV através do sistema DOTS / Burst Compile 

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // Processamento paralelo escrevendo valores diretamente num NativeArray  
        // Garantindo uma velocidade de execução que o MonoBehaviour nunca conseguirá atingir.  
    }  
}
```

Alterar os valores dos componentes das entidades através de *Bursted Background Jobs* (tarefas em segundo plano compiladas com o Burst Compiler) pode ser efetuado a uma velocidade assombrosa.[^4] É possível ter vedações a mudar de cor consoante a inclinação do terreno ou relva a alterar a tonalidade em função da altitude, tudo desenhado num único fluxo de chamadas de desenho sem estrangulamentos.[^4]

## **Parte VIII: Análise das Soluções Alternativas (Alternative Solutions)**

O rascunho original do Long Gil Studio mencionou brevemente técnicas de otimização alternativas. A análise seguinte confirma a sua exequibilidade, mas enquadra-as nas restrições físicas do motor Unity 6.

1. **Vertex Colors (Cores de Vértice da Malha):**
   * *Mecânica:* Codificar dados de cor diretamente nos vértices (*vertices*) da malha 3D. O shader lê o atributo `TEXCOORD` ou `COLOR` da malha.
   * *Eficácia:* Extremamente leve e preserva na perfeição todas as funcionalidades de *batching*, bem como a compatibilidade com o GRD.[^36]
   * *Ponto fraco:* Alterar as cores de vértice em tempo de execução (*runtime*) exige manipular o array de dados da malha (`mesh.colors`). Esta operação cria uma cópia da malha na RAM, originando paragens de CPU (*CPU stalls*) e alocações de memória descartável. A coloração por vértice continua a ser ótima apenas para variantes estáticas previamente assadas (*baked*) em software como Blender ou Maya.
2. **Texture Atlasing e UV Offsets:**
   * *Mecânica:* Reunir múltiplas variações de cor num único atlas de texturas (*texture atlas*) e deslocar as coordenadas UV dos diferentes objetos para amostrar píxeis específicos.[^36]
   * *Eficácia:* Esta técnica mantém um único material e uma única textura, garantindo compatibilidade absoluta com o SRP Batcher.[^36]
   * *Ponto fraco:* À semelhança das cores de vértice, alterar dinamicamente as coordenadas UV em objetos distintos em tempo de execução (*runtime*) requer normalmente a criação de instâncias de malha (*mesh instances*) exclusivas, reintroduzindo inchaço de memória (*memory bloat*). Todavia, para a conceção de ambientes estáticos ou jogos Voxel (como Minecraft), esta técnica é imbatível.
3. **Low-Level `Graphics.DrawMeshInstanced` (GPU de Baixo Nível):**
   * *Mecânica:* Contornar por completo a hierarquia de GameObjects para enviar diretamente matrizes de transformação e arrays de cor para a GPU através de código C#.[^37]
   * *Eficácia:* Proporciona um desempenho enorme para sistemas como algoritmos de bando (*flocking*) ou folhagem procedural (*procedural foliage*).[^38]
   * *Ponto fraco no Unity 6:* A introdução da API `BatchRendererGroup` e do GPU Resident Drawer democratizou este desempenho, eliminando a necessidade de escrever código complexo de *culling* e submissão de desenho na grande maioria dos cenários habituais.[^19] Manter um sistema `DrawMeshInstanced` personalizado consome hoje mais recursos de engenharia do que deixar que o GPU Resident Drawer o automatize.

## **Parte IX: Estrutura de Conteúdo Proposta para o Long Gil Studio DevLog**

Com base no processo de avaliação técnica abrangente, o texto abaixo apresenta o artigo DevLog proposto, totalmente revisto e refletindo um elevado rigor profissional de engenharia. Abandona o método defeituoso de MPB e orienta o leitor para as verdadeiras normas arquitetónicas do Unity 6: RSUV e GPU Resident Drawer.

---

**Unity 6: Otimizar Milhares de Objetos que Partilham Material – Abandonar o MPB Rumo à Arquitetura Moderna**

**Por Long Gil Studio**

**🇻🇳 EDIÇÃO VIETNAMITA (Traduzida para português europeu)**

**1. O Ponto de Estrangulamento da Renderização: O Problema da Duplicação de Materiais**

Durante o desenvolvimento de jogos em grande escala, surge um desafio arquitetónico extremamente comum: «Como alterar a cor de milhares de objetos que partilham um único material sem fazer cair os FPS?»

Muitos programadores recorrem frequentemente ao comando `GetComponent<Renderer>().material.color`. Trata-se de um erro fatal (*anti-pattern*). Invocar `.material` obriga o Unity a criar silenciosamente uma cópia (*clone*) desse material na RAM. A consequência é uma fuga de memória grave, o acionamento contínuo da recolha de lixo (*Garbage Collection*) e a destruição completa do sistema de Batching. A GPU fica subalimentada, enquanto a CPU fica sobrecarregada a processar milhares de Draw Calls individuais.

**2. A Armadilha Herdada: Por que Razão o MaterialPropertyBlock «Morreu» no Unity 6**

Anteriormente, a solução «norma Pro» consistia em usar `MaterialPropertyBlock` (MPB) para transmitir dados por objeto sem clonar o material. **Contudo, se estiver a utilizar o Unity 6 (URP/HDRP), tem de abandonar este método de imediato.**

O Unity 6 depende fortemente do fluxo do **SRP Batcher** e de uma tecnologia revolucionária: o **GPU Resident Drawer (GRD)**. O GRD transfere todo o fluxo de processamento de renderização (geração de Draw Calls e Culling) para *Compute Shaders* na GPU, ajudando a reduzir até 50% o tempo de cálculo da CPU. Todavia, segundo a documentação nuclear do motor, assim que associa um `MaterialPropertyBlock` a um objeto, esse objeto é imediatamente excluído do SRP Batcher e perde por completo a compatibilidade com o GPU Resident Drawer. Usar MPB significa estar a forçar o Unity a regressar ao fluxo de renderização herdado, lento e dispendioso para a CPU em todo o seu exército.

**3. A Nova Norma do Unity 6: Renderer Shader User Value (RSUV)**

Para resolver definitivamente este impasse, a atualização Unity 6.3 LTS introduziu o **Renderer Shader User Value (RSUV)**. Esta API permite transmitir diretamente um número inteiro de 24 bits para o renderer. Como o RSUV não requer a alocação de novos buffers, preserva 100% de compatibilidade quer com o SRP Batcher quer com o GPU Resident Drawer.

**Passo 1: Codificação em C# (Zero Garbage Allocation)**

Em vez de recorrer a strings como no MPB, vamos codificar a cor RGB num inteiro de 24 bits através de operações de deslocamento de bits (*bitwise*):

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Codificar os 3 canais Azul, Verde e Vermelho num inteiro de 24 bits  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Aplicar o valor (Totalmente seguro para a arquitetura SRP e GRD!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Passo 2: Descodificação no Shader Graph**

No interior do Shader Graph, crie um nó **Custom Function** (Type: String, Name: DecodeColor) com saída do tipo Vector4. Cole o excerto de código HLSL seguinte para desempacotar o inteiro de volta numa cor padrão:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Ligue esta saída ao pino Base Color do Fragment Shader. Dispõe agora de infinitas variações de cor com latência de CPU nula, tirando o máximo partido da potência do sistema GPU Resident Drawer.

**Exemplo: Implementação prática em script de Shader (sem Shader Graph)**

Se escrever shaders personalizados em código (HLSL), pode intervir na função `BuildSurfaceData` para descodificar `unity_RendererUserValue` e multiplicar por `BaseColor`, conforme ilustrado no excerto abaixo:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Descodificação do RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // Aplicação da cor rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ... 
}
```

*Consulte mais pormenores em:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Ultrapassar a Marca dos 100 000 Objetos: A Solução DOTS / ECS**

Se o seu jogo exigir a renderização de centenas de milhares de unidades independentes (como exércitos gigantescos), o sistema tradicional de GameObjects irá inevitavelmente estrangular a CPU, por melhor que seja a sua otimização de renderização. Para esta escala, transite para a arquitetura Unity DOTS. A utilização do componente `URPMaterialPropertyOverride` permite definir uma disposição de memória Data-Oriented que comunica diretamente com a API `BatchRendererGroup` a baixo nível, proporcionando um desempenho inigualável de verdadeiro nível AAA.

---

**🇺🇸 VERSÃO INGLESA (Traduzida para português europeu)**

**1. O Ponto de Estrangulamento da Renderização: Duplicação de Materiais**

Ao desenvolver jogos de elevada densidade, surge um desafio arquitetónico comum: «Como alterar a cor de milhares de objetos que partilham o mesmo material sem destruir o desempenho?»

Os programadores tendem a recorrer por defeito a `GetComponent<Renderer>().material.color`. Este é um antipadrão fatal. Aceder a `.material` força o Unity a clonar silenciosamente o material no heap gerido. Isto origina um inchaço severo de memória, provoca picos de recolha de lixo e destrói o *batching* de *draw calls*, elevando a sobrecarga da CPU a níveis ingeríveis enquanto deixa a GPU inativa.

**2. A Armadilha Herdada: Por que Razão o MaterialPropertyBlock Está Morto no Unity 6**

Historicamente, a solução «Pro» passava por utilizar um `MaterialPropertyBlock` (MPB) para transmitir dados por instância sem clonar materiais. **Se estiver a usar o Unity 6 (URP/HDRP), tem de deixar de usar este método de imediato.**

O Unity 6 apoia-se intensamente no **SRP Batcher** e no novo e revolucionário **GPU Resident Drawer (GRD)**. O GRD transfere o *frustum culling* e a geração de *draw calls* para *compute shaders* da GPU, reduzindo o tempo de renderização da CPU até 50%. Contudo, de acordo com a documentação nuclear do motor, aplicar um `MaterialPropertyBlock` a um objeto desqualifica-o imediatamente do SRP Batcher e quebra por completo a sua compatibilidade com o GPU Resident Drawer. Ao usar MPB, força o Unity a regressar a uma via de renderização herdada, lenta e limitada pela CPU para os seus exércitos massivos.

**3. A Norma do Unity 6: Renderer Shader User Value (RSUV)**

Para resolver este impasse arquitetónico, o Unity 6.3 LTS introduz o **Renderer Shader User Value (RSUV)**. Esta API permite passar um inteiro de 24 bits diretamente para a carga de dados base do renderer. Como evita modificar buffers constantes persistentes, o RSUV mantém 100% de compatibilidade quer com o SRP Batcher quer com o GPU Resident Drawer.

**Passo 1: A Codificação em C# (Zero Memory Allocation)**

Em vez de transmitir strings e criar blocos, empacotamos matematicamente uma cor RGB num inteiro sem sinal de 24 bits recorrendo a operações bit a bit:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Codificar os canais Azul, Verde e Vermelho num único inteiro de 24 bits  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Aplicar o valor nativamente (100% seguro para SRP e GRD!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Passo 2: A Descodificação no Shader**

No interior do seu Shader Graph, crie um nó **Custom Function** (Type: String, Name: DecodeColor) com uma saída Vector4. Cole este código HLSL para desempacotar o inteiro novamente numa cor *float* normalizada:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Ligue esta saída à entrada Base Color do seu fragmento. Dispõe agora de infinitas variações de cor sem penalizações de *draw calls*, tirando pleno partido do GPU Resident Drawer.

**Exemplo: Implementação real num Shader personalizado (sem Shader Graph)**

Se estiver a escrever um shader personalizado em código (HLSL), pode modificar a função `BuildSurfaceData` para descodificar `unity_RendererUserValue` e multiplicá-lo por `BaseColor`, conforme demonstrado abaixo:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Descodificação do RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // Aplicação do rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ...
}
```

*Ver também:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Ir Além dos 100 000 Objetos: DOTS / ECS**

Se o seu jogo exigir a renderização de centenas de milhares de unidades dinâmicas, os GameObjects padrão acabarão por estrangular a thread principal da CPU, independentemente das otimizações gráficas. Para escalas massivas, faça a transição para o Unity DOTS. A utilização do componente `URPMaterialPropertyOverride` permite disposições de memória estritamente orientadas a dados (*Data-Oriented*). Isto comunica diretamente com a API de baixo nível `BatchRendererGroup`, alcançando um desempenho puro e inigualável de nível AAA.

---

## **Parte X: Recomendações Estratégicas para Equipas de Desenvolvimento**

A análise dos modelos modernos de renderização revela uma diferença crucial entre o conhecimento de otimização antigo (*legacy*) e a arquitetura contemporânea do motor. A conclusão fundamental para os engenheiros gráficos é clara: alterar buffers de dados (*data buffers*) por objeto é intrinsecamente hostil à execução paralela e aos ciclos de renderização geridos pela GPU. Não é possível transportar a mentalidade de otimização do Unity 5.x ou do Unity 2019 para o Unity 6.

Para alcançar o desempenho máximo no Unity 6, as equipas de desenvolvimento devem aplicar rigorosamente os seguintes protocolos:

1. **Auditar a Utilização de MPB (Audit for MPB Usage):** Ferramentas de Profiling (por exemplo, Unity Profiler) e Frame Debuggers devem ser implementadas continuamente para identificar e erradicar os casos em que `MaterialPropertyBlock` é aplicado a geometria instanciada em massa (*mass-instanced geometry*). A conveniência a curto prazo do MPB é totalmente suplantada pela perda sistemática da funcionalidade GPU Resident Drawer. As equipas devem criar avisos no código-fonte ou verificações de CI/CD para detetar alocações desnecessárias de MPB.
2. **Adotar Estratégias de Codificação Bitwise (Bitwise Encoding Strategies):** A adoção do Renderer Shader User Value (RSUV) exige uma mudança na metodologia de programação. Os artistas técnicos (*Technical Artists*) e programadores de jogabilidade devem colaborar para definir esquemas rigorosos de empacotamento *bitwise* dentro do limite de 24 bits do RSUV. Importa garantir que os diversos estados de dados (cor, dano, ID de equipa — *team ID*) sejam serializados de forma eficiente antes de chegarem ao renderer. Por exemplo: podem-se alocar 4 bits para «ID de Facção» (permitindo 16 facções), 8 bits para «Estado de Dano» (permitindo 256 níveis) e 12 bits para «Custom Tint» (cor personalizada) — todos descodificados simultaneamente através de máscaras de bits (*bitmasks*) no interior do shader.
3. **Avaliar Limiares de Transição para ECS (Evaluate Thresholds for ECS Transition):** Embora o RSUV resolva o estrangulamento de variação de materiais para GameObjects, mantêm-se os limites da CPU associados a cálculos de física, cálculos de matrizes (*transform calculations*) e *culling* de GameObjects. Os projetos que prevejam ultrapassar as 10 000 entidades dinâmicas ativas (*dynamic agents*) devem conceber, de forma decidida e proativa, protótipos implementados em DOTS (Entity Component System). A utilização do componente `URPMaterialPropertyOverride`[^34] para comunicar nativamente com a API `BatchRendererGroup` constitui a única via para libertar integralmente o potencial de poder do hardware de PC e das consolas de nova geração.

## **Referências**

[^1]: Enable the GPU Resident Drawer in URP - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)  
[^2]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^3]: Set and use the RSUV - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)  
[^4]: Migrated my game to ECS/DOTS and material overrides are awesome! : r/Unity3D - Reddit, acedido em 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)  
[^5]: Why You Should Stop Swapping Materials in Unity (And What to Do Instead) - Medium, acedido em 19 de abril de 2026, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)  
[^6]: Material Property Blocks - using them to store the original color of a material upon instantiation : r/Unity3D - Reddit, acedido em 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)  
[^7]: Instancing and Material Property Blocks | Ronja's tutorials, acedido em 19 de abril de 2026, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)  
[^8]: Scripting API: MaterialPropertyBlock - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)  
[^9]: Unity 6 and custom material bug - Spine Forum, acedido em 19 de abril de 2026, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)  
[^10]: Scriptable Render Pipeline (SRP) Batcher - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)  
[^11]: Scriptable Render Pipeline Batcher - Unity 6.3 User Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)  
[^12]: GPU instancing - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)  
[^13]: Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)  
[^14]: Beginning Game Development: GPU Resident Drawer | by Lem Apperson - Medium, acedido em 19 de abril de 2026, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)  
[^15]: Introduction to RSUV - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)  
[^16]: Renderer Shader User Value sample - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)  
[^17]: Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, acedido em 19 de abril de 2026, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)  
[^18]: Scriptable Render Pipeline Batcher - Unity User Manual 2021.3 (LTS), acedido em 19 de abril de 2026, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)  
[^19]: Unity Draw Call Batching: The Ultimate Guide (2026 Update), acedido em 19 de abril de 2026, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)  
[^20]: Scriptable Render Pipeline Batcher - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)  
[^21]: SRP Batcher: Speed up your rendering - Unity, acedido em 19 de abril de 2026, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)  
[^22]: Remove SRP Batcher compatibility for GameObjects in URP - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)  
[^23]: GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D - Reddit, acedido em 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)  
[^24]: Scripting API: Renderer.GetPropertyBlock - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)  
[^25]: Create batches with the BatchRendererGroup API in URP - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)  
[^26]: Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)  
[^27]: Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, acedido em 19 de abril de 2026, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)  
[^28]: Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling - YouTube, acedido em 19 de abril de 2026, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)  
[^29]: Graphics Features and Tools in Unity 6 Feel Like MAGIC! STP, Resident Drawer, and Occlusion Culling! - YouTube, acedido em 19 de abril de 2026, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)  
[^30]: Initialize a BatchRendererGroup object in URP - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)  
[^31]: Boost performance of your game in Unity 6 with GPU Resident Drawer - The Knights of U, acedido em 19 de abril de 2026, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)  
[^32]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^33]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)  
[^34]: DOTS Instancing shaders in URP - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)  
[^35]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)  
[^36]: One Material multiple colors possible? : r/Unity3D - Reddit, acedido em 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)  
[^37]: Single-pass instanced rendering and custom shaders - Unity - Manual, acedido em 19 de abril de 2026, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)  
[^38]: Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, acessado em 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
