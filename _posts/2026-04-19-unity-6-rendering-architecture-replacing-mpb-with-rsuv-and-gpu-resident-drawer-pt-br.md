---
title: "Arquitetura de Renderização no Unity 6: Substituindo o MPB por RSUV e GPU Resident Drawer"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: "Análise completa da transição arquitetônica de MaterialPropertyBlock para RSUV e GPU Resident Drawer visando desempenho AAA no Unity 6."
lang: pt-BR
translation_id: unity6-material-rsuv-grd
math: true
---

## **Resumo Executivo (Executive Summary)**

A transição para o Unity 6 marca uma mudança arquitetônica fundamental na forma como os pipelines de renderização (*render pipelines*) processam geometria instanciada em grande volume. Historicamente no desenvolvimento de jogos, a otimização de múltiplos objetos que compartilham um mesmo material, mas exigem variações individuais de propriedades (como alteração de cores — *color tints*), dependia da API `MaterialPropertyBlock` (MPB) combinada com o sistema padrão de GPU Instancing. No entanto, uma análise aprofundada do Universal Render Pipeline (URP) e do High Definition Render Pipeline (HDRP) no Unity 6 revela que essa abordagem legada (*legacy*) não é mais o caminho ideal e, em muitos cenários, provoca uma degradação severa de desempenho.

A avaliação do rascunho documental fornecido para o "Long Gil Studio DevLog" revela uma mistura entre teoria de otimização legada válida em versões antigas e um equívoco grave sobre os recursos modernos de renderização do Unity 6. Especificamente, a recomendação do rascunho de usar `MaterialPropertyBlock` entra em conflito direto com a nova tecnologia **GPU Resident Drawer (GRD)** do Unity 6 e com a API **BatchRendererGroup (BRG)** subjacente.[^1] Para alcançar o máximo desempenho de renderização, os desenvolvedores precisam obrigatoriamente adotar o **Renderer Shader User Value (RSUV)** ou migrar completamente para o **Data-Oriented Technology Stack (DOTS)**.[^3]

Este relatório técnico fornece uma análise minuciosa dos gargalos de renderização, dos mecanismos de funcionamento do Scriptable Render Pipeline (SRP) Batcher, das consequências sistêmicas da duplicação de materiais e dos padrões modernos necessários para atingir desempenho de renderização de nível AAA no Unity 6. Além disso, o relatório traz um artigo técnico revisado e estruturado profissionalmente para publicação no Long Gil Studio DevLog.

## **Parte I: Avaliação Técnica do Rascunho Original do Long Gil Studio**

O texto do rascunho inicial apresenta um problema de renderização bastante específico: otimizar uma cena (*Scene*) contendo inúmeros objetos idênticos que compartilham um único material, mas exigem modificações individuais de cor. O rascunho identificou corretamente os antipadrões (*anti-patterns*), porém prescreveu uma solução que prejudica o desempenho no contexto arquitetônico do Unity 6.

### **Pontos Corretos do Rascunho Original**

1. **A Penalidade da Duplicação de Materiais (Material Duplication):** O rascunho afirma corretamente que criar instâncias separadas de material para cada objeto (por exemplo, via `GetComponent<Renderer>().material.color`) leva ao inchaço de memória (*memory bloat*) e destrói completamente o agrupamento de chamadas de desenho (*draw call batching*).[^5] Acessar a propriedade `.material` força a engine Unity a clonar silenciosamente aquele material, perdendo de forma permanente a capacidade do SRP Batcher ou do GPU Instancing de agrupar esses objetos em uma única chamada SetPass.[^5]
2. **Mecânica do MaterialPropertyBlock (MPB):** O rascunho identifica com precisão que o MPB atua como um buffer de sobrescrita de dados (*data override buffer*), permitindo que o renderer envie propriedades por instância (*per-instance*) para a GPU sem criar uma nova cópia do material.[^7]
3. **Propriedades em String vs. Identificadores Inteiros (Integer IDs):** O rascunho destaca adequadamente a latência da Unidade Central de Processamento (CPU) causada pelo uso de strings para buscar propriedades de shader, defendendo a inicialização prévia de identificadores inteiros por meio de `Shader.PropertyToID()` para otimizar loops críticos.[^7]

### **Inconsistências Graves e Paradigmas Obsoletos**

1. **MPB como um "Padrão AAA" no Unity 6:** A falha mais expressiva no rascunho original é afirmar que o MPB representa a solução "AAA" ideal para o Unity 6. Embora o MPB fosse padrão no Built-In Render Pipeline (arquitetura antiga), ele atua como um agente destrutivo nas arquiteturas SRP modernas.[^8] Aplicar um MPB a um GameObject remove imediatamente esse objeto do fluxo do SRP Batcher.[^10]
2. **Dependência do GPU Instancing Legado:** O rascunho reconhece que o MPB quebra o SRP Batcher e sugere recorrer ao GPU Instancing tradicional como alternativa. Embora tecnicamente viável ao quebrar manualmente a compatibilidade SRP e ativar o Instancing, isso obriga a engine a ignorar a arquitetura SRP altamente otimizada.[^12]
3. **Omissão do GPU Resident Drawer (GRD):** O Unity 6 introduz o GPU Resident Drawer, um sistema que transfere a geração de chamadas de desenho (*draw calls*) para *compute shaders*, reduzindo a sobrecarga da CPU em até 50%.[^14] A presença de um `MaterialPropertyBlock` proíbe estritamente que um GameObject participe do GRD.[^1] Recomendar o MPB no Unity 6 impede fundamentalmente que os projetos aproveitem o novo recurso de otimização mais poderoso da engine.
4. **Ausência do Renderer Shader User Value (RSUV):** Introduzido no Unity 6.3 LTS, o RSUV é o substituto arquitetônico direto do MPB para lidar com variações simples por objeto.[^15] O RSUV permite enviar um inteiro de 24 bits ao shader para cada renderer sem quebrar o SRP Batcher nem o GPU Resident Drawer.[^3]

## **Parte II: Análise Fundamental dos Gargalos (Bottlenecks) de Renderização**

Para entender por que chamadas específicas de API destroem a taxa de quadros (*frame rate*), é necessário examinar o modelo de comunicação entre a Unidade Central de Processamento (CPU) e a Unidade de Processamento Gráfico (GPU). A arquitetura de hardware moderna exige uma sincronização rígida, porém sensível à latência, entre esses dois processadores.

### **Custo de Comunicação CPU-GPU (Overhead)**

O processo de renderizar um quadro exige que a CPU percorra todos os objetos visíveis no campo de visão da câmera (*frustum culling*), identifique suas propriedades de material, vincule (*bind*) as texturas e shaders necessários na memória da GPU e emita um comando de desenho (*draw command*). A operação mais custosa nesse pipeline não é a GPU desenhar os polígonos, mas sim as mudanças de estado obrigatórias antes da chamada de desenho — comumente chamadas de comandos **SetPass**.[^5]

Sempre que a CPU encontra um material diferente, ela precisa pausar o pipeline de renderização para enviar os novos parâmetros à GPU.[^18] Se uma cena contém 10.000 inimigos e cada inimigo possui uma instância exclusiva de material para viabilizar uma cor de armadura diferente, a CPU precisa executar 10.000 mudanças de estado. Isso gera uma sobrecarga gigantesca na CPU (*CPU Overhead*), criando um gargalo no qual a GPU fica ociosa aguardando instruções da CPU.

### **A Fragmentação de Memória da Propriedade `.material`**

Quando um script acessa `Renderer.material` para mudar uma cor, a engine é obrigada a proteger a integridade do asset compartilhado original. Ela executa internamente um `Instantiate()` naquele material. Isso traz duas penalidades severas para o desempenho:

1. **Destruição do Batching:** O objeto deixa de compartilhar a referência de material com seus pares. Imediatamente, o Unity interrompe qualquer forma de Static Batching, Dynamic Batching ou SRP Batching para esse objeto.[^5] A placa de vídeo terá de processá-lo como uma entidade totalmente isolada.
2. **Coleta de Lixo (Garbage Collection) e Vazamentos de Memória (Memory Leaks):** A nova cópia do material é criada no Heap gerenciado pelo C#. Ela não é coletada automaticamente pelo Garbage Collector quando o objeto é destruído. A menos que o desenvolvedor chame `Destroy(renderer.material)` explicitamente, a memória permanece alocada. Isso cria vazamentos de memória que obrigam o Garbage Collector (GC) a disparar ciclos de *Mark-and-Sweep*, causando travamentos severos (*spikes*) e quedas bruscas de FPS.[^5]

## **Parte III: Arquitetura do SRP Batcher e a Obsolescência do GPU Instancing Tradicional**

O Scriptable Render Pipeline (SRP) reorganizou fundamentalmente a forma como o Unity gerencia dados de shader. Entender o SRP Batcher é essencial para compreender por que os métodos antigos de otimização falham completamente no Unity 6.

### **Como Funciona o SRP Batcher**

Nos pipelines antigos (*Built-in*), os materiais enviavam dados à GPU por meio de variáveis uniformes separadas (*separate uniform variables*). O SRP Batcher substitui esse método utilizando grandes buffers persistentes na GPU chamados Buffers de Constantes (**Constant Buffers - CBUFFERs**).[^11]

A arquitetura SRP obriga os shaders a dividirem suas variáveis em dois blocos de buffer distintos 11:

* `UnityPerMaterial`: Um CBUFFER que armazena propriedades compartilhadas por todos os objetos que usam o mesmo material (por exemplo: cor base, mapas metálicos — *metallic maps*, rugosidade).
* `UnityPerDraw`: Um CBUFFER que armazena propriedades exclusivas de uma chamada de desenho específica (por exemplo: matrizes de transformação espacial do objeto — *transformation matrices*).

Como o buffer `UnityPerMaterial` permanece de forma persistente na memória da GPU, a CPU não precisa mais reenviar propriedades de material dentro do loop de renderização enquanto objetos consecutivos compartilharem a mesma variante de shader (*shader variant*).[^18] O SRP Batcher apenas vincula (*bind*) esse buffer persistente e atualiza o buffer `UnityPerDraw`, muito menor. Esse design reduz drasticamente o custo de CPU, chegando a acelerar o desempenho de renderização de 1,2x a 4x.[^21]

### **O Conflito Central com o `MaterialPropertyBlock`**

A API `MaterialPropertyBlock` foi originalmente projetada para sobrescrever propriedades de material no nível do renderer. No entanto, como o SRP Batcher depende da separação estrita e da persistência do CBUFFER `UnityPerMaterial`, injetar um MPB viola diretamente esse layout de memória.[^8]

Quando um MPB é aplicado, o Unity não consegue mais garantir que o buffer persistente de material seja aplicado uniformemente ao objeto. Consequentemente, a engine é forçada a ejetar abruptamente o objeto do pipeline do SRP Batcher.[^9] A documentação oficial do Unity confirma claramente: "Observe que esse recurso não é compatível com o SRP Batcher. Usar MPB no URP ou HDRP provavelmente resultará em queda de desempenho".[^8]

### **A Solução Alternativa Legada: `Graphics.DrawMeshInstanced`**

Historicamente, se um desenvolvedor precisava de variações em massa (por exemplo, uma floresta com árvores de cores diferentes), ele aceitava perder o SRP Batcher e recorria ao GPU Instancing.[^12] Isso exigia quebrar manualmente a compatibilidade SRP do shader declarando uma propriedade fora do buffer `UnityPerMaterial` e ativando "Enable GPU Instancing" no material.[^13]

Embora o GPU Instancing reduza as chamadas de desenho ao enviar arrays de matrizes de transformação e dados de cor, ele apresenta limitações severas.[^12] Ele sofre com *overdraw* pesado, exige malhas (*meshes*) idênticas e impõe uma carga elevada à CPU para coletar e enviar os arrays de instâncias (*instance arrays*) a cada quadro. No Unity 6, essa abordagem foi totalmente substituída pela arquitetura GPU Resident Drawer.[^23]

## **Parte IV: Incompatibilidade do `MaterialPropertyBlock` (MPB) com o Ecossistema do Unity 6**

Uma análise mais profunda do MPB mostra que ele não apenas quebra o SRP Batcher, mas também gera riscos estruturais para as ferramentas de depuração (*debugging tools*) e sistemas de iluminação (*lighting systems*) no Unity 6.

### **Impacto nos Dados de Lightmap e Global Illumination**

Uma das consequências menos comentadas do uso inadequado de MPB é a perda dos dados de Lightmap. Quando você cria um `new MaterialPropertyBlock()` e o atribui via `Renderer.SetPropertyBlock()`, o bloco de propriedades passado sobrescreve completamente o estado local do renderer.[^24]

Se o objeto estiver utilizando Global Illumination (GI) pré-calculada (*baked*), as informações sobre coordenadas UV do Lightmap e coeficientes de Light Probe ficam armazenadas implicitamente dentro do próprio property block do renderer.[^24] Se você não chamar `Renderer.GetPropertyBlock(block)` antes de definir a cor, apagará acidentalmente as informações de iluminação do objeto. Embora o rascunho original do Long Gil Studio tenha tratado bem essa parte do `GetPropertyBlock`, o próprio ato de chamar essa API repetidamente em milhares de objetos cria uma latência adicional de CPU nada desprezível.

| Técnica de Otimização | Causa vazamento de RAM | Compatível com SRP Batcher | Compatível com GRD | Compatível com DOTS | Uso recomendado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`Material.color`** | Sim | Não | Não | Não | Evitar a todo custo |
| **`MaterialPropertyBlock`** | Não | Não | Não | Não | Projetos Built-in antigos |
| **GPU Instancing** | Não | Não (Conflito) | Não | Não | Unity 2020-2022 |
| **Renderer Shader User Value** | Não | Sim | Sim | Sim | Padrão Unity 6.3+ |

Como mostra a tabela acima, o MPB é atualmente uma técnica de geração passada. Ele resolve o problema de memória RAM, mas compromete todo o pipeline de renderização moderno do Unity 6.

## **Parte V: O Ponto de Virada Arquitetônico: GPU Resident Drawer (GRD) e `BatchRendererGroup` (BRG)**

O Unity 6 introduz um caminho de renderização revolucionário: o **GPU Resident Drawer**. Esse sistema transforma o paradigma da geração de comandos de desenho controlada pela CPU para um loop de renderização altamente autônomo controlado pela GPU.[^1]

### **Arquitetura do GPU Resident Drawer**

O GPU Resident Drawer opera com base na API de baixo nível `BatchRendererGroup` (BRG).[^1] Em vez de a CPU avaliar quais objetos são visíveis (*frustum culling*) e enviar chamadas de desenho individuais ou instanciadas, a CPU envia todos os dados espaciais e de material da cena para a GPU.[^25] Em seguida, *compute shaders* executam o descarte de objetos fora da câmera, o descarte por oclusão (*occlusion culling*) e a geração de chamadas de desenho integralmente na GPU.[^14]

O ganho de desempenho é impressionante. Com o uso de renderização indireta (`DrawInstancedIndirect`), a carga de trabalho da CPU exigida para renderização pode cair em até 50% em cenas complexas.[^14] Além disso, quando combinado com o GPU Occlusion Culling, o processamento de triângulos pode ser reduzido em quase 90%, enquanto o tempo de quadro da GPU (*frame buffer time*) cai pela metade ou mais.[^28]

### **API `BatchRendererGroup` (BRG) e Culling**

Por trás do GRD está o `BatchRendererGroup`. O BRG exige inicialização com uma função de callback `OnPerformCulling`.[^30] Aqui, a CPU precisa apenas configurar a visibilidade (*visibility*) e gerar as chamadas de desenho em formato de array. Os dados do objeto (transformações, cores, flags) são enviados para um `GraphicsBuffer`.[^25] Isso permite que milhões de triângulos sejam enviados à GPU com apenas algumas chamadas SetPass.

### **A Incompatibilidade Fatal do MPB com o GRD**

A informação mais crítica sobre otimização no Unity 6 é a rigidez dos requisitos de elegibilidade para o GPU Resident Drawer. Para que um objeto seja processado pelo GRD, ele precisa obedecer a regras rígidas de layout de dados.[^2]

A documentação oficial do Unity 6.1+ declara claramente que GameObjects que usam a API `MaterialPropertyBlock` são imediatamente excluídos do GPU Resident Drawer.[^1] Além disso, o objeto não pode conter scripts que usem callbacks por instância, como `OnRenderObject`.[^2]

Quando um desenvolvedor anexa um MPB para alterar a cor de um objeto, ele força involuntariamente a engine a reverter para o modo de renderização legado baseado em CPU para aquele objeto específico. Se isso for feito em 10.000 unidades em um jogo de estratégia em tempo real, a sobrecarga de CPU disparará de forma vertiginosa, anulando por completo os benefícios da atualização para o Unity 6.

## **Parte VI: O Padrão Moderno: Renderer Shader User Value (RSUV) no Unity 6.3**

Reconhecendo o impasse arquitetônico gerado pela incompatibilidade do MPB com os pipelines modernos, o Unity introduziu o recurso **Renderer Shader User Value (RSUV)** na versão Unity 6.3 LTS.[^15] O RSUV atua como o substituto definitivo para o `MaterialPropertyBlock` quando os desenvolvedores precisam aplicar customizações simples por instância em vários renderers que compartilham um mesmo material.[^3]

### **Mecanismo de Funcionamento do RSUV**

O RSUV evita as modificações complexas de buffer que prejudicam o MPB. Em vez disso, ele aproveita um canal inteiro de 24 bits altamente eficiente, enviado diretamente junto aos dados padrão de desenho do renderer.[^3] Como esse inteiro é integrado à estrutura de dados existente em vez de exigir uma sobrescrita separada de buffer (*buffer override*), ele preserva 100% de compatibilidade tanto com o SRP Batcher quanto com o GPU Resident Drawer.[^3]

### **Implementação e Codificação Bitwise (Bitwise Encoding)**

Para usar o RSUV na variação de cores, a CPU precisa codificar os valores RGB desejados em um único inteiro sem sinal de 24 bits (`uint`). Cada canal de cor (Vermelho — *Red*, Verde — *Green*, Azul — *Blue*) ocupa 8 bits (fornecendo valores de 0 a 255).[^3]

A operação de codificação utiliza os operadores de deslocamento de bits à esquerda (`<<`) e OU bit a bit (`|`). A equação matemática é expressa assim:

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

Na implementação prática em C#, iterar sobre um array de componentes `MeshRenderer` para aplicar colorações aleatórias oferece altíssimo desempenho e nenhuma alocação de memória descartável (*zero garbage allocation*)[^3]:

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // Calcula uma cor aleatória (usando o sistema HSV para cores mais vivas)  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // Codifica RGB em um inteiro de 24 bits (Azul, Verde, Vermelho)  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // Aplica o valor diretamente ao renderer através da nova API do Unity 6.3
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **Decodificação no Shader (Shader Decoding)**

Do lado da GPU, o shader precisa desempacotar (*unpack*) esse inteiro de 24 bits de volta para um valor de cor `float4` normalizado. O Unity disponibiliza a variável interna `unity_RendererUserValue` para acessar esse bloco de dados.[^3]

O processo de decodificação utiliza o operador de deslocamento de bits à direita (`>>`) e o operador E bit a bit (`&`) com uma máscara de bits `255` para isolar cada segmento de 8 bits. Em seguida, o valor é multiplicado pelo inverso de 255 (`1.0 / 255.0`) para normalizá-lo no intervalo entre `0.0` e `1.0`.[^3]

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

Em High-Level Shader Language (HLSL) ou por meio de um nó Custom Function no Shader Graph, a lógica de desempacotamento é expressa da seguinte forma 3:

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // Canal Vermelho (Red)  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // Canal Verde (Green)  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // Canal Azul (Blue)  
    1.0 // Alpha fixo  
);
```

Essa mudança de paradigma demonstra uma estratégia de otimização profunda: trocar complexidade de estruturas de dados (como o MPB) por cálculo matemático (RSUV). Os processadores de GPU são extremamente eficientes em operações *bitwise*, o que significa que o custo de decodificação é praticamente imperceptível (custo mínimo de ciclos de relógio — *clock cycles*). Enquanto isso, preservar os fluxos do SRP Batcher e do GPU Resident Drawer proporciona reduções massivas no tempo de quadro (*frame-time*).[^16]

## **Parte VII: Solução em Escala Extrema: DOTS, ECS e `URPMaterialPropertyOverride`**

Para projetos que operam em uma escala além da capacidade de processamento dos GameObjects padrão (por exemplo, simulações de multidões com centenas de milhares de unidades independentes — *boids*, exércitos gigantescos de RTS), o Data-Oriented Technology Stack (DOTS) do Unity oferece a arquitetura de renderização definitiva.[^4]

### **Gerenciamento de Memória Orientado a Dados (Data-Oriented Memory)**

Diferentemente das limitações do sistema orientado a objetos, no qual os GameObjects ficam espalhados pelo Heap, as entidades (*entities*) no Entity Component System (ECS) existem integralmente como arrays contíguos de dados (*contiguous arrays of data*) na memória.[^4] Esse layout de memória alinha-se perfeitamente à estrutura exigida pela API `BatchRendererGroup` (BRG) para atingir o desempenho máximo.

No pacote Entities Graphics, os desenvolvedores podem utilizar o componente `URPMaterialPropertyOverride`.[^4] Esse sistema permite sobrescrever propriedades de material por entidade (*per-entity material overrides*) sem usar de forma alguma a prejudicial API `MaterialPropertyBlock`.

### **Como Funciona o DOTS Instancing**

Quando uma entidade é processada no DOTS, um shader configurado para DOTS Instancing (marcando *Override Property Declaration* e selecionando *Hybrid Per Instance* no Shader Graph) recebe um inteiro exclusivo de 32 bits (um valor de metadados — *metadata value*).[^34] Esse inteiro representa um deslocamento (*offset*) localizado dentro de um `GraphicsBuffer` estável na GPU.[^34]

O shader usa esse offset para carregar os dados de propriedade específicos para a instância que está renderizando no momento.[^34] O diferencial do DOTS Instancing é que, se várias entidades compartilharem o mesmo valor de propriedade, o DOTS Instancing permite que elas leiam esse valor exatamente da mesma posição de memória (o mesmo offset), economizando ciclos de GPU (*GPU cycles*) e minimizando a duplicação de memória.[^34] Como a propriedade é carregada por offset em vez de ficar confinada nos buffers de constantes tradicionais, o tamanho de uma chamada de desenho deixa de ter limites rígidos, possibilitando contagens gigantescas de instâncias.

```csharp
// Exemplo de atribuição de valores RSUV por meio do sistema DOTS / Burst Compile 

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // Processamento paralelo gravando valores diretamente em um NativeArray  
        // Proporcionando uma velocidade de execução que o MonoBehaviour nunca conseguirá alcançar.  
    }  
}
```

Alterar os valores dos componentes das entidades por meio de *Bursted Background Jobs* (tarefas em segundo plano compiladas com o Burst Compiler) pode ser feito com velocidade impressionante.[^4] É possível ter cercas mudando de cor conforme a inclinação do terreno ou grama alterando a tonalidade com base na altitude, tudo desenhado em um único fluxo de chamadas de desenho sem gargalos.[^4]

## **Parte VIII: Análise das Soluções Alternativas (Alternative Solutions)**

O rascunho original do Long Gil Studio mencionou brevemente técnicas alternativas de otimização. A análise a seguir confirma sua viabilidade, mas as posiciona dentro das restrições físicas da engine Unity 6.

1. **Vertex Colors (Cores de Vértice da Malha):**
   * *Mecânica:* Codificar dados de cor diretamente nos vértices (*vertices*) da malha 3D. O shader lê o atributo `TEXCOORD` ou `COLOR` da malha.
   * *Eficiência:* Extremamente leve e preserva perfeitamente todas as funcionalidades de *batching*, bem como a compatibilidade com o GRD.[^36]
   * *Ponto fraco:* Alterar cores de vértice em tempo de execução (*runtime*) exige manipular o array de dados da malha (`mesh.colors`). Essa ação cria uma cópia da malha na RAM, provocando travamentos de CPU (*CPU stalls*) e alocações de memória descartável. A coloração por vértice continua sendo ideal apenas para variações estáticas previamente assadas (*baked*) em softwares como Blender ou Maya.
2. **Texture Atlasing e UV Offsets:**
   * *Mecânica:* Consolidar múltiplas variações de cor em um único atlas de texturas (*texture atlas*) e deslocar as coordenadas UV de diferentes objetos para amostrar pixels específicos.[^36]
   * *Eficiência:* Essa técnica mantém um único material e uma única textura, garantindo compatibilidade total com o SRP Batcher.[^36]
   * *Ponto fraco:* Assim como as cores de vértice, alterar dinamicamente as coordenadas UV em objetos distintos em tempo de execução (*runtime*) normalmente exige a criação de instâncias de malha (*mesh instances*) exclusivas, trazendo inchaço de memória (*memory bloat*). Contudo, para o design de ambientes estáticos ou jogos Voxel (como Minecraft), essa técnica é imbatível.
3. **Low-Level `Graphics.DrawMeshInstanced` (GPU em Baixo Nível):**
   * *Mecânica:* Ignorar completamente a hierarquia de GameObjects para enviar diretamente matrizes de transformação e arrays de cor para a GPU via código C#.[^37]
   * *Eficiência:* Entrega enorme desempenho para sistemas como algoritmos de bando (*flocking*) ou folhagem procedural (*procedural foliage*).[^38]
   * *Ponto fraco no Unity 6:* A chegada da API `BatchRendererGroup` e do GPU Resident Drawer democratizou esse desempenho, eliminando a necessidade de escrever código complexo de *culling* e submissão de desenho na maioria dos cenários comuns de desenvolvimento.[^19] Manter um sistema `DrawMeshInstanced` personalizado hoje consome mais recursos de engenharia do que deixar o GPU Resident Drawer automatizá-lo.

## **Parte IX: Estrutura de Conteúdo Proposta para o Long Gil Studio DevLog**

Com base no processo abrangente de avaliação técnica, o texto abaixo é a proposta do artigo DevLog, totalmente revisado e demonstrando profissionalismo técnico de alto nível. Ele abandona a abordagem falha do MPB e conduz o leitor aos verdadeiros padrões arquitetônicos do Unity 6: RSUV e GPU Resident Drawer.

---

**Unity 6: Otimizando Milhares de Objetos que Compartilham Material – Abandonando o MPB rumo à Arquitetura Moderna**

**Por Long Gil Studio**

**🇻🇳 EDIÇÃO EM VIETNAMITA (Traduzida para português do Brasil)**

**1. O Gargalo de Renderização: O Problema da Duplicação de Materiais**

Durante o desenvolvimento de jogos em grande escala, surge um desafio arquitetônico extremamente comum: "Como mudar a cor de milhares de objetos que compartilham um mesmo material sem derrubar o FPS?"

Muitos programadores costumam usar o comando `GetComponent<Renderer>().material.color`. Esse é um erro fatal (*anti-pattern*). Chamar `.material` força o Unity a criar silenciosamente uma cópia (*clone*) daquele material na RAM. A consequência é um vazamento grave de memória, acionamento contínuo da coleta de lixo (*Garbage Collection*) e a destruição completa do sistema de Batching. A GPU fica passando fome, enquanto a CPU fica sobrecarregada processando milhares de Draw Calls individuais.

**2. A Armadilha Legada: Por que o MaterialPropertyBlock "Morreu" no Unity 6**

Antigamente, a solução "padrão Pro" era usar `MaterialPropertyBlock` (MPB) para enviar dados para cada objeto sem precisar clonar o material. **Mas se você está usando o Unity 6 (URP/HDRP), você precisa parar com esse método imediatamente.**

O Unity 6 depende fortemente do fluxo do **SRP Batcher** e de uma tecnologia revolucionária: o **GPU Resident Drawer (GRD)**. O GRD empurra todo o fluxo de processamento de renderização (geração de Draw Calls e Culling) para *Compute Shaders* na GPU, ajudando a reduzir em até 50% o tempo de cálculo da CPU. Porém, segundo a documentação central da engine, quando você anexa um `MaterialPropertyBlock` a um objeto, esse objeto é imediatamente removido do SRP Batcher e perde totalmente a compatibilidade com o GPU Resident Drawer. Usar MPB significa forçar o Unity a voltar ao fluxo de renderização legado, lento e custoso para a CPU em todo o seu exército.

**3. O Novo Padrão do Unity 6: Renderer Shader User Value (RSUV)**

Para resolver definitivamente esse impasse, a atualização Unity 6.3 LTS introduziu o **Renderer Shader User Value (RSUV)**. Essa API permite enviar diretamente um inteiro de 24 bits para o renderer. Como o RSUV não exige a alocação de novos buffers, ele mantém 100% de compatibilidade tanto com o SRP Batcher quanto com o GPU Resident Drawer.

**Passo 1: Codificação em C# (Zero Garbage Allocation)**

Em vez de usar strings como no MPB, vamos codificar a cor RGB em um inteiro de 24 bits usando operações de deslocamento de bits (*bitwise*):

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Codifica os 3 canais Azul, Verde e Vermelho em um inteiro de 24 bits  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Aplica o valor (Totalmente seguro para a arquitetura SRP e GRD!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Passo 2: Decodificação no Shader Graph**

Dentro do Shader Graph, crie um nó **Custom Function** (Type: String, Name: DecodeColor) com saída do tipo Vector4. Cole o trecho de código HLSL abaixo para desempacotar o inteiro de volta para uma cor padrão:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Conecte essa saída ao pino Base Color do Fragment Shader. Agora você tem variações infinitas de cores com latência de CPU igual a zero, aproveitando ao máximo o poder do sistema GPU Resident Drawer.

**Exemplo: Implementação prática em script de Shader (sem Shader Graph)**

Se você escreve shaders customizados via código (HLSL), pode intervir na função `BuildSurfaceData` para decodificar `unity_RendererUserValue` e multiplicar pelo `BaseColor`, conforme mostrado no trecho abaixo:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Decodificação do RSUV
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

*Saiba mais em:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Superando a Marca de 100.000 Objetos: Solução DOTS / ECS**

Se o seu jogo exigir a renderização de centenas de milhares de unidades independentes (como exércitos gigantescos), o sistema tradicional de GameObjects certamente vai gerar gargalo na CPU, por melhor que seja a sua otimização de renderização. Para essa escala, migre para a arquitetura Unity DOTS. O uso do componente `URPMaterialPropertyOverride` permite definir um layout de memória Data-Oriented, comunicando-se diretamente com a API `BatchRendererGroup` em baixo nível e entregando um desempenho imbatível de verdadeiro padrão AAA.

---

**🇺🇸 VERSÃO EM INGLÊS (Traducida para português do Brasil)**

**1. O Gargalo da Renderização: Duplicação de Materiais**

Ao desenvolver jogos de alta densidade, surge um desafio arquitetônico comum: "Como eu altero a cor de milhares de objetos que compartilham o mesmo material sem destruir o desempenho?"

Desenvolvedores costumam recorrer por padrão a `GetComponent<Renderer>().material.color`. Esse é um antipadrão fatal. Acessar `.material` força o Unity a clonar silenciosamente o material no heap gerenciado. Isso gera um inchaço severo de memória, provoca picos de coleta de lixo e destrói o *batching* de *draw calls*, elevando a sobrecarga da CPU a níveis incontroláveis enquanto deixa a GPU ociosa.

**2. A Armadilha Legada: Por que o MaterialPropertyBlock Está Morto no Unity 6**

Historicamente, a solução "Pro" era utilizar um `MaterialPropertyBlock` (MPB) para passar dados por instância sem clonar materiais. **Se você estiver usando o Unity 6 (URP/HDRP), você deve parar de usar esse método imediatamente.**

O Unity 6 depende intensamente do **SRP Batcher** e do novo e revolucionário **GPU Resident Drawer (GRD)**. O GRD transfere o *frustum culling* e a geração de *draw calls* para *compute shaders* da GPU, reduzindo o tempo de renderização da CPU em até 50%. Entretanto, de acordo com a documentação central da engine, aplicar um `MaterialPropertyBlock` a um objeto o desqualifica imediatamente do SRP Batcher e quebra completamente sua compatibilidade com o GPU Resident Drawer. Ao usar MPB, você força o Unity a voltar para um caminho de renderização legado, lento e limitado pela CPU para os seus exércitos massivos.

**3. O Padrão do Unity 6: Renderer Shader User Value (RSUV)**

Para resolver esse impasse arquitetônico, o Unity 6.3 LTS introduz o **Renderer Shader User Value (RSUV)**. Essa API permite enviar um inteiro de 24 bits diretamente para o pacote de dados base do renderer. Como evita modificar buffers constantes persistentes, o RSUV mantém 100% de compatibilidade tanto com o SRP Batcher quanto com o GPU Resident Drawer.

**Passo 1: A Codificação em C# (Zero Memory Allocation)**

Em vez de passar strings e criar blocos, empacotamos matematicamente uma cor RGB em um inteiro sem sinal de 24 bits utilizando operações bit a bit:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Codifica os canais Azul, Verde e Vermelho em um único inteiro de 24 bits  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Aplica o valor nativamente (100% seguro para SRP e GRD!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Passo 2: A Decodificação no Shader**

Dentro do seu Shader Graph, crie um nó **Custom Function** (Type: String, Name: DecodeColor) com uma saída Vector4. Cole este código HLSL para desempacotar o inteiro de volta para uma cor *float* normalizada:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Conecte essa saída à entrada Base Color do seu fragmento. Agora você possui variações infinitas de cores sem penalidades de *draw calls*, aproveitando ao máximo o GPU Resident Drawer.

**Exemplo: Implementação real em um Shader customizado (sem Shader Graph)**

Se você estiver escrevendo um shader customizado em código (HLSL), pode modificar a função `BuildSurfaceData` para decodificar `unity_RendererUserValue` e multiplicá-lo pelo `BaseColor`, como mostra o código abaixo:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Decodificação do RSUV
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

*Veja também:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Indo Além de 100.000 Objetos: DOTS / ECS**

Se o seu jogo exigir a renderização de centenas de milhares de unidades dinâmicas, GameObjects padrão acabarão criando um gargalo na thread principal da CPU, independentemente das otimizações gráficas. Para escalas massivas, faça a transição para o Unity DOTS. O uso do componente `URPMaterialPropertyOverride` permite layouts de memória estritamente orientados a dados (*Data-Oriented*). Isso se comunica diretamente com a API de baixo nível `BatchRendererGroup`, alcançando um desempenho puro e inigualável de nível AAA.

---

## **Parte X: Recomendações Estratégicas para Equipes de Desenvolvimento**

A análise dos modelos modernos de renderização evidencia uma diferença crucial entre o conhecimento de otimização antigo (*legacy*) e a arquitetura contemporânea da engine. A principal lição para os engenheiros gráficos é clara: modificar buffers de dados por objeto é algo intrinsecamente hostil à execução paralela e aos loops de renderização controlados pela GPU. Não é possível levar a mentalidade de otimização do Unity 5.x ou Unity 2019 para o Unity 6.

Para atingir o desempenho máximo no Unity 6, as equipes de desenvolvimento devem aplicar rigorosamente os seguintes protocolos:

1. **Auditar o Uso de MPB (Audit for MPB Usage):** Ferramentas de Profiling (por exemplo, Unity Profiler) e Frame Debuggers devem ser utilizadas continuamente para localizar e eliminar pela raiz os casos em que `MaterialPropertyBlock` é aplicado a geometrias instanciadas em massa (*mass-instanced geometry*). A conveniência de curto prazo do MPB é totalmente superada pela perda sistemática do recurso GPU Resident Drawer. As equipes devem criar alertas no código-fonte ou scripts de CI/CD para detectar alocações desnecessárias de MPB.
2. **Adotar Estratégias de Codificação Bitwise (Bitwise Encoding Strategies):** A adoção do Renderer Shader User Value (RSUV) exige uma mudança na metodologia de programação. Artistas técnicos (*Technical Artists*) e programadores de gameplay devem colaborar para definir esquemas rigorosos de empacotamento *bitwise* dentro do limite de 24 bits do RSUV. É preciso garantir que os diversos estados de dados (cor, dano, ID da equipe — *team ID*) sejam serializados com eficiência antes de chegarem ao renderer. Por exemplo: pode-se alocar 4 bits para "ID de Facção" (permitindo 16 facções), 8 bits para "Estado de Dano" (permitindo 256 níveis) e 12 bits para "Custom Tint" (cor personalizada) — todos decodificados simultaneamente por meio de máscaras de bits (*bitmasks*) dentro do shader.
3. **Avaliar Limites de Transição para ECS (Evaluate Thresholds for ECS Transition):** Embora o RSUV resolva o gargalo de variação de materiais para GameObjects, os limites da CPU relacionados a cálculos de física, cálculos de matrizes (*transform calculations*) e *culling* de GameObjects continuam existindo. Projetos que preveem mais de 10.000 agentes dinâmicos ativos (*dynamic agents*) devem projetar de maneira firme e proativa protótipos implementados em DOTS (Entity Component System). Utilizar o componente `URPMaterialPropertyOverride`[^34] para se comunicar nativamente com a API `BatchRendererGroup` é o único caminho para liberar todo o potencial de poder do hardware de PC e dos consoles de nova geração.

## **Referências**

[^1]: Enable the GPU Resident Drawer in URP - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)  
[^2]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^3]: Set and use the RSUV - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)  
[^4]: Migrated my game to ECS/DOTS and material overrides are awesome! : r/Unity3D - Reddit, acessado em 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)  
[^5]: Why You Should Stop Swapping Materials in Unity (And What to Do Instead) - Medium, acessado em 19 de abril de 2026, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)  
[^6]: Material Property Blocks - using them to store the original color of a material upon instantiation : r/Unity3D - Reddit, acessado em 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)  
[^7]: Instancing and Material Property Blocks | Ronja's tutorials, acessado em 19 de abril de 2026, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)  
[^8]: Scripting API: MaterialPropertyBlock - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)  
[^9]: Unity 6 and custom material bug - Spine Forum, acessado em 19 de abril de 2026, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)  
[^10]: Scriptable Render Pipeline (SRP) Batcher - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)  
[^11]: Scriptable Render Pipeline Batcher - Unity 6.3 User Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)  
[^12]: GPU instancing - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)  
[^13]: Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)  
[^14]: Beginning Game Development: GPU Resident Drawer | by Lem Apperson - Medium, acessado em 19 de abril de 2026, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)  
[^15]: Introduction to RSUV - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)  
[^16]: Renderer Shader User Value sample - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)  
[^17]: Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, acessado em 19 de abril de 2026, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)  
[^18]: Scriptable Render Pipeline Batcher - Unity User Manual 2021.3 (LTS), acessado em 19 de abril de 2026, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)  
[^19]: Unity Draw Call Batching: The Ultimate Guide (2026 Update), acessado em 19 de abril de 2026, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)  
[^20]: Scriptable Render Pipeline Batcher - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)  
[^21]: SRP Batcher: Speed up your rendering - Unity, acessado em 19 kwietnia 2026, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)  
[^22]: Remove SRP Batcher compatibility for GameObjects in URP - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)  
[^23]: GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D - Reddit, acessado em 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)  
[^24]: Scripting API: Renderer.GetPropertyBlock - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)  
[^25]: Create batches with the BatchRendererGroup API in URP - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)  
[^26]: Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)  
[^27]: Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, acessado em 19 de abril de 2026, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)  
[^28]: Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling - YouTube, acessado em 19 de abril de 2026, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)  
[^29]: Graphics Features and Tools in Unity 6 Feel Like MAGIC! STP, Resident Drawer, and Occlusion Culling! - YouTube, acessado em 19 de abril de 2026, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)  
[^30]: Initialize a BatchRendererGroup object in URP - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)  
[^31]: Boost performance of your game in Unity 6 with GPU Resident Drawer - The Knights of U, acessado em 19 de abril de 2026, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)  
[^32]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^33]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)  
[^34]: DOTS Instancing shaders in URP - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)  
[^35]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)  
[^36]: One Material multiple colors possible? : r/Unity3D - Reddit, acessado em 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)  
[^37]: Single-pass instanced rendering and custom shaders - Unity - Manual, acessado em 19 de abril de 2026, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)  
[^38]: Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, acessado em 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
