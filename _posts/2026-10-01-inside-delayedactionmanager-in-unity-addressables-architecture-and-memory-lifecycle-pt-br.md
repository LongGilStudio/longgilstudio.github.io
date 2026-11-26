---
title: "Relatório de Pesquisa Técnica Aprofundada: Mecanismos de Funcionamento, Arquitetura do Sistema e Impacto do DelayedActionManager no Ambiente Addressables da Unity"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: Análise aprofundada da arquitetura ComponentSingleton do DelayedActionManager no Unity Addressables, mecanismo de execução no LateUpdate, tratamento de exceções de proxy C#/C++ e estratégias de otimização de memória de AssetBundle.
lang: pt-BR
translation_id: unity-addressables-delayedactionmanager
---

O sistema Addressable Asset System (abreviado como Addressables) representa um avanço arquitetural revolucionário da Unity, fornecendo uma solução de gerenciamento de conteúdo flexível, robusta e otimizada sobre a base tradicional de AssetBundles[^1]. Durante o design e a operação de jogos ou aplicativos interativos em larga escala, gerenciar fluxos de dados assíncronos para carregar e liberar recursos automaticamente é um requisito essencial. Um dos componentes centrais responsáveis por essa tarefa complexa — mas que frequentemente confunde engenheiros de software ao analisar a hierarquia (Hierarchy) — é um objeto gerado automaticamente chamado DelayedActionManager, posicionado dentro da cena DontDestroyOnLoad[^2].

Este relatório técnico aprofunda a dissecação abrangente da natureza arquitetural do DelayedActionManager, explicando o motivo de sua existência no espaço DontDestroyOnLoad, analisando o mecanismo de execução dentro do loop em tempo real da Unity e destrinchando os desafios relacionados ao gerenciamento de memória, fenômenos de vazamento (memory leaks) e exceções de execução comuns. Por meio da análise de dados de design do sistema e boas práticas, o documento oferece uma visão aprofundada para ajudar arquitetos de software a otimizar a estabilidade do aplicativo.

## A Evolução do Sistema de Carregamento de Recursos e a Base Assíncrona

Antes de mergulhar nas microestruturas do DelayedActionManager, compreender o contexto de surgimento do sistema Addressables é condição indispensável. Em versões antigas da Unity, os programadores costumavam depender da pasta Resources ou utilizar diretamente scripts brutos de AssetBundle[^4]. O mecanismo `Resources.Load()` funciona de forma semelhante ao usuário ir pessoalmente a um depósito, exigindo o caminho exato da pasta, e a thread principal de execução (main thread) é forçada a travar (block) até que o recurso seja encontrado e carregado na memória[^4]. A desvantagem desse método é que ele impede a escalabilidade do aplicativo e provoca quedas severas de quadros por segundo (FPS drop) ao processar grandes volumes de dados.

Para solucionar esse problema, o Addressables atua como um serviço de entregas moderno. O programador precisa fornecer apenas o identificador do recurso (address/key), e o sistema roteia automaticamente para localizar o recurso no armazenamento local (Local) ou baixá-lo de servidores de rede de distribuição de conteúdo (CDN - Content Delivery Network)[^4]. Mais importante ainda, todo esse ciclo ocorre de maneira assíncrona (asynchronous). O comando de carregamento, tipicamente `Addressables.LoadAssetAsync`, não retorna o objeto imediatamente, mas devolve um manipulador de controle chamado `AsyncOperationHandle`[^4]. Essa interface fornece um mecanismo de retorno de chamada (callback) quando o recurso está pronto, permitindo que a thread principal do aplicativo continue processando a lógica de física e gráficos sem interrupções[^4].

Essa transição do modelo síncrono para o totalmente assíncrono traz consigo um grande desafio arquitetural: quando um processo de carregamento de recursos leva vários segundos para ser concluído devido à largura de banda de rede lenta, o aplicativo pode já ter mudado para uma cena (scene) completamente diferente[^1]. Gerenciar funções de callback, filas de tarefas (command queues) e contagem de referências (reference counting) exige uma entidade de gerenciamento central que não seja afetada pelo ciclo de vida de destruição/criação das cenas comuns. É exatamente por isso que os desenvolvedores da Unity integraram o modelo de cena DontDestroyOnLoad no núcleo do Addressables.

## A Cena DontDestroyOnLoad (DDOL) e a Arquitetura de Persistência Global

No ambiente Unity, a operação de carregar uma nova cena (por meio de `SceneManager.LoadScene` no modo Single padrão) aciona automaticamente o mecanismo de limpeza de memória. O sistema destrói (destroy) todos os GameObjects e Components pertencentes à cena anterior para garantir a liberação de recursos que não estão mais em uso[^7]. Embora o recurso de carregamento aditivo de cenas (Additive scenes) permita manter várias cenas ativas em paralelo para gerenciar o estado global (por exemplo, uma cena dedicada ao Game Manager e outra ao Level), o mecanismo DontDestroyOnLoad (DDOL) continua desempenhando um papel sistêmico importante na proteção de objetos de baixo nível[^7].

O aparecimento da cena DontDestroyOnLoad na interface do Editor da Unity ao pressionar o botão Play não é um erro, mas um mecanismo oculto padrão da engine destinado a agrupar objetos marcados para não serem destruídos ao carregar uma cena[^9]. Para que um GameObject seja aceito nessa área segura, o sistema Unity impõe uma regra obrigatória: esse objeto deve estar no nível raiz (root level) da cena[^8]. Qualquer tentativa de aplicar a função `DontDestroyOnLoad(gameObject)` a um objeto filho (nested object) falhará e registrará um aviso[^8].

Para o sistema Addressables, os processos de carregamento e liberação de recursos são operações cujo ciclo de vida abrange diversas cenas diferentes. Por exemplo, o acompanhamento do status de download de um AssetBundle a partir de um servidor remoto não pode ser cancelado no meio apenas porque o jogador acabou de atravessar um portal de mudança de fase. O uso do mecanismo `RuntimeInitializeOnLoadMethod` combinado com o padrão de projeto Singleton avançado permite que o código-fonte do Addressables crie automaticamente um objeto raiz e o coloque na cena DDOL assim que o aplicativo é iniciado[^2]. Isso explica por que, mesmo quando o programador não escreve nenhuma linha de código relacionada ao DDOL, um objeto chamado "DelayedActionManager" ainda aparece automaticamente no canto inferior esquerdo da lista de cenas[^2].

## Estrutura Interna e Papel Técnico do DelayedActionManager

Pesquisando profundamente no código-fonte e na documentação da API do pacote Addressables, o DelayedActionManager é uma classe concreta (concrete class) localizada no namespace `UnityEngine.ResourceManagement.Util`[^11]. Sua estrutura não é uma simples classe utilitária estática (static utility class), mas sim um componente acoplado diretamente a um GameObject por meio de herança de uma arquitetura base[^12].

### O Padrão ComponentSingleton e a Automação da Inicialização

A arquitetura do DelayedActionManager é construída sobre o padrão de projeto ComponentSingleton, uma classe fundamental definida no mesmo namespace[^13]. Utilizar o padrão Singleton em um componente (Component), em vez de uma classe C# pura, dá ao sistema a capacidade de interagir diretamente com o loop de eventos em tempo real (PlayerLoop) da Unity.

Quando o sistema ResourceManager recebe pela primeira vez uma solicitação de carregamento ou atualização de status (por exemplo, `Addressables.LoadAssetAsync` ou operações de diagnóstico de rede), ele chama a instância do DelayedActionManager. Nesse momento, o padrão ComponentSingleton executa automaticamente um procedimento oculto que inclui: criar um GameObject vazio, nomeá-lo como "DelayedActionManager", anexar o script correspondente a ele e chamar imediatamente a função `DontDestroyOnLoad` para colocá-lo no espaço de proteção global[^2]. Esse design de inicialização tardia (lazy initialization) garante que os recursos do sistema sejam consumidos somente quando a função de gerenciamento de tarefas adiadas for realmente necessária, respondendo às dúvidas comuns dos programadores sobre a aparição "mágica" desse objeto na interface[^3].

### Análise do Mecanismo de Agendamento e a Fase LateUpdate

A tarefa central do DelayedActionManager é atuar como um agendador central (central scheduler) para ações adiadas, funções de retorno (callbacks), corrotinas e gerenciamento de memória em nível micro[^11]. O diferencial sutil, porém extremamente importante, de sua arquitetura é que toda a lógica de processamento de filas é roteada para ser executada dentro da função `LateUpdate()` do ciclo de vida da Unity[^11].

A escolha de design direcionada para `LateUpdate` em vez do `Update` tradicional resolve um problema arquitetural profundo relacionado à consistência dos dados. A tabela a seguir ilustra a ordem de execução da Unity e o papel da fase `LateUpdate` na proteção dos dados do Addressables.

| Fase de Execução (PlayerLoop) | Funções Típicas | Papel em Relação ao Addressables e ao DelayedActionManager |
| :--- | :--- | :--- |
| **FixedUpdate** | Processamento de simulação física, colisões estáticas/dinâmicas. | A lógica do jogo pode acionar solicitações de destruição de objetos após colisões. |
| **Update** | Entrada do jogador (Input), movimentação, lógica de IA, atualização do estado do jogo. | As funções `Addressables.LoadAssetAsync` ou `Release` são chamadas manualmente. GameObjects podem sofrer `Destroy()` aqui. |
| **LateUpdate** | Atualização da posição da câmera, ajustes de pós-processamento (post-processing). | O DelayedActionManager limpa a memória, atualiza variáveis contadoras de referência e chama os callbacks assíncronos para garantir que não haja conflito com os comandos de destruição da fase `Update`[^11]. |

Se o sistema ResourceManager executasse os callbacks de conclusão de tarefa imediatamente no meio da fase `Update`, correria alto risco de interagir com um sistema (por exemplo, o sistema gráfico ou a interface de usuário) que ainda está em estado intermediário, sem ter concluído o cálculo do quadro. Ao adiar (delaying) a chamada das funções OnComplete ou executar a redução dos contadores de referência (ref-count decrements) até o `LateUpdate()`, o DelayedActionManager assegura que todo o estado lógico do quadro atual esteja estabilizado[^11]. Dados de diversos relatórios de rastreamento de pilha (stack traces) mostram que a função `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` é o último estágio intermediário antes de o controle ser devolvido ao código do usuário[^15].

## Dissecando Exceções do Sistema (System Exceptions) e Rastreamentos de Pilha (Stack Traces)

Embora projetado com alto nível de segurança, a complexidade do mecanismo assíncrono, combinada com operações imprecisas de gerenciamento de ciclo de vida por parte do programador, frequentemente coloca o DelayedActionManager no centro de exceções graves. Os relatórios de erro fornecem pistas importantes sobre como o sistema interage com a memória gerenciada (managed memory) e a memória nativa (native memory).

### Erro NullReferenceException e Conflito no Ciclo de Vida Proxy C# - C++

Um cenário de erro muito comum no ambiente Addressables é o surgimento da exceção `ArgumentNullException: Value cannot be null. Parameter name: obj` originada na função `StartCoroutine_Auto` do DelayedActionManager[^19]. Esse erro não é uma falha interna da Unity, mas decorre da dessincronia entre o mecanismo de coleta de lixo do C# (Garbage Collector) e o gerenciamento de ponteiros brutos do código-fonte C++ subjacente[^19].

Na Unity, objetos como GameObject ou MonoBehaviour são, na verdade, classes representantes (proxy classes) escritas em C#, contendo uma referência interna que aponta para o objeto original alocado em C++ na engine[^19]. Quando o programador chama o comando `Destroy(gameObject)`, o objeto C++ é destruído imediatamente e a região de memória é devolvida, fazendo com que a referência interna se torne nula[^19]. Contudo, a classe proxy em C# ainda pode permanecer na memória gerenciada (managed memory) por algum tempo até que o coletor de lixo faça a varredura[^19].

A catástrofe acontece quando os desenvolvedores utilizam expressões anônimas (lambdas/closures) combinadas com os processos assíncronos do Addressables. A expressão lambda tem a propriedade de "capturar" (capture) as variáveis de contexto ao seu redor. Considere o seguinte modelo de código-fonte:

```csharp
// Uma ação adicionada à fila do DelayedActionManager
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

Quando esse código é executado, a variável `_crawlerRobot` (que é um proxy C#) fica retida pela closure[^19]. Se a lógica do jogo destruir `_crawlerRobot` ainda naquele mesmo quadro, o ponteiro C++ subjacente desaparece. Mas, como o DelayedActionManager já agendou a execução dessa lambda para a fase `LateUpdate` (ou em um quadro posterior), quando a lambda é realmente acionada, ela tenta acessar o método `BreakAwayLowerBody()` de um ponteiro C++ já morto[^19]. A consequência inevitável é que o sistema lançará uma exceção `NullReferenceException` ou a mensagem de erro "O objeto foi destruído, mas você ainda está tentando acessá-lo"[^19].

Para contornar esse risco arquitetural, especialistas em software recomendam duas soluções de design:

1. Evitar o uso excessivo de aninhamento de expressões lambda (lambdas nesting) ao lidar com alterações de estado de baixo nível[^19].
2. Sempre realizar verificações seguras de nulo, baseando-se no fato de que a Unity sobrecarregou (overloaded) o operador `==` do C# para verificar diretamente o estado do ponteiro C++ subjacente[^19].

### Conflitos de PlayerLoop e o Erro "Assertion failed on expression: ShouldRunBehaviour()"

Durante o controle de versão (version control) dos pacotes Addressables, uma grande quantidade de desenvolvedores relatou que o Editor da Unity ficava inundado por uma mensagem de erro de baixo nível: `Assertion failed on expression: 'ShouldRunBehaviour()'` no arquivo `MonoBehaviour.cpp`[^3].

O rastreamento de pilha (stack trace) aponta que esse processo se origina diretamente no GameObject "DelayedActionManager" localizado na cena DontDestroyOnLoad[^3]. A análise de causa raiz (Root Cause Analysis) revela uma falha no tratamento do fluxo de reprodução (Play Mode) do Editor da Unity. Quando o editor passa por uma recompilação de domínio (Domain Reload) ou quando o carregamento de recursos ainda não foi concluído e o usuário clica para parar (Stop) o jogo, o DelayedActionManager fica preso como um objeto órfão (orphaned object)[^3].

Por estar marcado como DontDestroyOnLoad, ele tenta continuar executando ciclos de `LateUpdate` e verificações de comportamento (behaviour checks) mesmo quando o ambiente de execução nativo da Unity (PlayerLoop) já ordenou a parada de todas as tarefas[^3]. Esse erro foi registrado de forma mais severa durante a transição do pacote Addressables 1.16.x para 1.18.x, forçando muitas equipes de desenvolvimento a fazer o downgrade manual para a versão 1.17.17 a fim de garantir a estabilidade da API de tratamento síncrono e eliminar o travamento de filas[^3].

### A Oscilação do DelayedActionManager no Histórico de Versões

Um ponto curioso na pesquisa da documentação da API e dos registros de alterações (changelogs) do Unity Addressables é a presença cíclica do DelayedActionManager. Versões como 0.7.5 e 1.11.2 anunciaram claramente no registro de atualizações a refatoração da interface de scripts de build (build script interface) com a nota: "Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading"[^20]. Essa decisão visava originalmente simplificar a camada de API e transferir o controle para a classe personalizável `AsyncOperationBase`[^20].

Entretanto, relatórios de bugs de versões pós-LTS (Long-Term Support), como 1.18.15, 1.19.19 e 1.21.21, revelam o retorno contínuo de `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` nas pilhas de chamadas[^11]. Isso reflete a filosofia de design iterativo da Unity: após removê-lo para simplificar, os engenheiros de sistema perceberam que a ausência de um gerenciador central de tarefas adiadas criava dificuldades insuperáveis na coleta de eventos de diagnóstico (DiagnosticEventCollector), no tratamento de tabelas de pré-carregamento (preload tables) e na garantia da segurança de memória ao fechar o aplicativo[^11]. O DelayedActionManager foi reprojetado e restaurado como um utilitário oculto do sistema, não mais exposto na interface pública de usuário, mas responsável por lidar com os riscos de descarte (disposal) quando o aplicativo é encerrado[^20].

## Mecanismo de Contagem de Referências e Dinâmica de Vazamento de Memória

A existência do DelayedActionManager está intimamente ligada a um dos pilares mais complexos do Addressables: o Sistema de Gerenciamento de Memória (Memory Management). Ao contrário de depender totalmente do Garbage Collector, o Addressables controla a permanência dos dados na RAM por meio do mecanismo de Contagem de Referências (Reference Counting)[^23].

### Dinâmica de Referências e Hierarquia de Dependências

Sempre que o sistema recebe uma solicitação para carregar um recurso, o contador de referências desse recurso é incrementado em um (increment). Ao concluir o uso, o comando `Addressables.Release` instrui o sistema a reduzir esse contador (decrement)[^23]. A regra de ouro é que o sistema só permite liberar a memória física que contém o recurso quando o contador de referências retorna ao valor absoluto igual a 0[^23].

A complexidade cresce exponencialmente porque o Addressables gerencia dependências por meio da arquitetura AssetBundle. Ao carregar um recurso (por exemplo, um material - Material), o sistema não carrega apenas o material em si, mas carrega automaticamente todos os AssetBundles que contêm seus componentes dependentes (por exemplo, Texture)[^25]. O grafo de dependências (dependency graph) é calculado em nível de Bundle, o que significa que se um recurso no Bundle A referencia um recurso no Bundle B, todo o Bundle B precisa ser carregado na memória principal[^26].

A limitação técnica mais rígida da Unity nessa arquitetura é: **O usuário não pode liberar parcialmente (partially unload) o conteúdo de um AssetBundle**[^23]. Para esclarecer, considere um AssetBundle chamado "stuff" que contém três recursos independentes: Árvore, Tanque e Vaca[^23].

1. Quando o recurso Árvore é carregado, a ferramenta de análise de memória (Profiler) exibe uma referência para Árvore e uma referência correspondente para o bundle `stuff`[^23].
2. Quando o recurso Tanque continua sendo carregado, o contador de Tanque aumenta e o contador de `stuff` sobe para 2[^23].
3. Se o jogo executar o comando `Release(Árvore)`, o contador de Árvore cai para 0 e a barra azul no Profiler desaparece[^23].
4. No entanto, os dados físicos de Árvore permanecem intactos na memória do sistema. Como Tanque ainda mantém a conexão ativa deixando o contador do AssetBundle `stuff` maior que 0, nenhum recurso dentro desse bundle tem permissão para ser destruído até que o bundle inteiro seja totalmente liberado[^23].

### Síndrome de "Asset Churn" e Inchaço de Memória (Memory Bloat)

O fenômeno em que recursos são continuamente carregados, liberados e imediatamente recarregados em um curto intervalo de tempo é definido como "Asset Churn" (disputa constante de recursos)[^23]. Essa falha costuma surgir na transição entre fases (levels). Se a Fase 1 usa o recurso Barco e a Fase 2 usa o recurso Avião (ambos compartilham a textura Camuflagem). Ao sair da Fase 1, o desenvolvedor libera Barco, o que faz com que o sistema Addressables descarregue imediatamente a textura Camuflagem da memória. Um milissegundo depois, quando a Fase 2 instancia Avião, o sistema força novamente o disco rígido a executar o ciclo de I/O para recarregar aquela mesma textura Camuflagem do zero[^23]. Esse processo gera picos (spikes) abruptos no tempo de quadro e empurra o uso de memória para patamares perigosos, especialmente em hardware móvel[^27].

Além disso, esquecer o comando `Release` leva ao acúmulo de referências residuais, fazendo o consumo de RAM disparar de centenas de megabytes para a casa dos gigabytes após poucas trocas de cena[^28]. Como nem o DelayedActionManager nem o próprio Addressables monitoram a quantidade de instâncias criadas pelo método `Instantiate` puro de MonoBehaviour, qualquer falha no rastreamento dos manipuladores de memória criará vazamentos de memória permanentes[^6].

### Arquitetura de Compressão de Dados e Pressão de Alocação de Memória

O tamanho dos AssetBundles e o método de compressão de dados impactam diretamente a forma como os dados residem na RAM. A escolha do método de compressão define se o AssetBundle ocupará um grande volume de memória permanentemente ou se terá capacidade de otimizar a largura de banda.

Tabela comparativa das características dos algoritmos de compressão de AssetBundle e seu impacto no armazenamento[^29]:

| Algoritmo de Compressão | Capacidade de Reconhecimento de Arquivo Local | Exige Carregar o Bundle Inteiro na RAM | Impacto em Desempenho e Armazenamento |
| :--- | :--- | :--- | :--- |
| **LZMA** | Não. O bundle é comprimido em bloco único. | **Sim.** Precisa descomprimir todo o arquivo na memória. | Maior taxa de compressão e menor tamanho de download, mas causa inchaço agudo de memória (Memory Bloat) e consumo intenso de CPU na extração[^29]. |
| **LZ4** | Sim. Compressão por blocos (chunk-based). | **Não.** Carrega apenas a parte dos dados sendo acessada. | Recomendado como padrão (default). Permite armazenamento em cache (caching) direto no disco local sem carregar todos os metadados na RAM[^29]. |
| **Uncompressed** | Sim. Acesso independente por recurso. | **Não.** Acesso direto. | Sem gasto de tempo com descompressão, mas maior tamanho de arquivo original. Ideal para carregamento instantâneo se a largura de banda do disco permitir[^29]. |

Ao solicitar um pequeno recurso de dentro de um AssetBundle gigantesco comprimido com LZMA, o arquivo inteiro (incluindo cabeçalho, metadados e tabelas de buffer de streaming) precisa ser transferido do disco rígido para a RAM[^27]. Esse erro de design transforma AssetBundles enormes em bombas-relógio, causando travamentos por falta de memória (OOM crashes) no aplicativo[^27].

## Boas Práticas (Best Practices) na Governança de Recursos

Para domar a complexidade do sistema de contagem de referências e reduzir a carga sobre o DelayedActionManager, os arquitetos de sistemas devem aplicar uma estrutura de ciclo de vida extremamente rigorosa, combinada com técnicas de otimização do ciclo de vida dos recursos.

### 1. Sincronização do Ciclo de Inicialização e Liberação

Todo objeto `AsyncOperationHandle` retornado pela API deve obrigatoriamente ser liberado ao final de seu ciclo de uso[^6]. Deixar de fazer isso não só causa vazamentos de memória como também pode provocar falhas gerais no sistema (crashes)[^6]. A tabela abaixo ilustra as operações simétricas obrigatórias na programação com Addressables:

| Método de Inicialização / Carregamento | Método de Liberação Correspondente | Mecanismo de Funcionamento Interno |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | Subtrai 1 do contador de referências do AssetBundle que o contém[^6]. |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | Destrói o objeto exibido (Instance) e subtrai automaticamente 1 do contador do Prefab original[^4]. |
| Atribuição via `AssetReference` | `reference.ReleaseAsset()` | Semelhante a chamar Release pelo manipulador; limpa referências estáticas[^6]. |

Em especial, ao usar ScriptableObjects para armazenar configurações do jogo, referenciar diretamente um objeto (`public Object _worldAsset`) cria referências fortes (hard references), forçando todo o sistema a carregar esse recurso na RAM imediatamente[^27]. A solução ideal é utilizar AssetReference (`public AssetReference addressableAsset;`) para carregar de maneira assíncrona sob demanda (on-demand loading)[^6].

### 2. Intervenção de Baixo Nível: Resources.UnloadUnusedAssets()

Em cenários sem saída nos quais AssetBundles compartilhados ficam presos na memória devido à característica de "não liberação parcial" (por exemplo, o recurso Árvore preso junto com Tanque), a única saída é utilizar uma API forçada da camada base da engine: `Resources.UnloadUnusedAssets()`[^25].

Essa função realiza uma varredura profunda em toda a RAM do sistema para rastrear todos os recursos (incluindo aqueles ocultos em AssetBundles) cuja quantidade real de referências internas (actual engine references) seja absolutamente igual a 0, e os destrói à força[^25]. Ainda assim, trata-se de uma operação com custo computacional altíssimo, gerando quedas graves de quadros (FPS drops), pois a CPU precisa pausar a thread lógica para executar o processo de limpeza[^27]. Os engenheiros devem acionar esse comando apenas em grandes telas de carregamento (loading screens), ou deixar que o sistema o chame automaticamente ao utilizar `SceneManager.LoadScene` para trocar de cena[^29].

### 3. Planejamento e Fragmentação de AssetBundles (Bundle Packing Modes)

Organizar a estrutura dos grupos (Groups) na interface de configuração do Addressables determina diretamente o desempenho de carregamento em memória e a largura de banda de download. Escolher o modo de empacotamento (Bundle Mode) adequado ao tipo de recurso é um passo de design crucial[^6]:

* **Pack Together (Empacotar Juntos)**: Usado para recursos com ciclo de vida fortemente acoplado que sempre aparecem simultaneamente. Isso reduz o custo de análise do grafo de dependências e o I/O de rede[^6].
* **Pack Separately (Empacotar Separadamente)**: Ideal para recursos gigantescos e independentes, ou mapas grandes em que não é possível garantir o carregamento conjunto. Elimina o risco de um recurso grande impedir a liberação de outro menor[^6].
* **Pack Together By Label (Empacotar por Rótulo)**: Permite combinar recursos espalhados usando metadados de rótulos (por exemplo, atribuir o rótulo "Halloween 2023" para agrupar todo o conteúdo do evento em um único bundle, facilitando atualizações via CDN)[^6].

Para reduzir ainda mais a carga da tabela de índice (TypeTree) no AssetBundle, o programador pode ativar a opção `BuildAssetBundleOptions.DisableWriteTypeTree`. Esse recurso remove metadados desnecessários, porém exige a reconstrução dos grupos locais (rebuild local groups) antes da geração do arquivo executável[^26].

### 4. Gerenciamento de Memória de Áudio e Imagem (Graphics & Audio)

Otimizar as camadas auxiliares é a medida mais eficaz para reduzir a frequência de atuação do coletor de lixo. A configuração do formato de carregamento do fluxo de áudio impacta diretamente a memória[^27]:

* **Música de fundo (BGM) longa**: Deve ser configurada como Streaming para carregar pequenos buffers a partir do disco[^27].
* **Efeitos sonoros longos**: Selecionar Compressed In Memory para manter comprimido na RAM e descomprimir em tempo real durante a execução[^27].
* **Efeitos sonoros curtos / alta frequência**: Usar Decompress On Load para disponibilizar diretamente os dados descomprimidos, eliminando o custo de CPU[^27].

Além disso, desativar a opção "Read/Write enabled" em Texturas e configurar a remoção do buffer de profundidade (Depth Stencil Format para None) nas Câmeras de interface gráfica (UI) reduzirá em pelo menos 50% a quantidade desnecessária de RAM de renderização[^27].

## Conclusão sobre a Interação Global

O estudo sobre o DelayedActionManager não apenas decifra a origem de um objeto oculto na cena DontDestroyOnLoad, como também revela a filosofia fundamental de design do sistema Addressables na Unity. Essa classe ComponentSingleton atua como uma ponte temporal sutil, preservando a integridade dos dados ao redirecionar processos de liberação, chamadas assíncronas e tratamento de buffers para o ciclo LateUpdate. Ela isola as alterações na estrutura de memória das interrupções que podem ser causadas por código de física ou lógica de controle pertencente ao fluxo do Update, formando um escudo contra exceções que corrompem o sistema durante trocas de cena.

Contudo, o DelayedActionManager não é uma varinha mágica capaz de resolver as fraquezas intrínsecas da arquitetura de gerenciamento de memória. Ele impõe aos arquitetos de software a exigência rigorosa de manter o ciclo de carregamento/liberação de recursos totalmente simétrico, projetar expressões anônimas em C# (lambdas) evitando ciclos de captura de objetos C++ nativos e modularizar a estrutura de AssetBundles para prevenir vazamentos de memória persistentes. Com o domínio profundo do roteamento de carregamento assíncrono, uso racional de métodos de compressão como LZ4 e o poder coercitivo de `Resources.UnloadUnusedAssets`, as equipes de desenvolvimento podem projetar arquiteturas sólidas e altamente escaláveis em todas as plataformas sem enfrentar o temor do esgotamento permanente de recursos.

## **Referências**

[^1]: Addressables In Unity - Ali Emre Onur - Medium, [https://aliemreonur.medium.com/addressables-in-unity-eec8b03198d7](https://aliemreonur.medium.com/addressables-in-unity-eec8b03198d7)
[^2]: Latecomer to Chop Chop, with a question...! - Unity Discussions, [https://discussions.unity.com/t/latecomer-to-chop-chop-with-a-question/899280](https://discussions.unity.com/t/latecomer-to-chop-chop-with-a-question/899280)
[^3]: Error: Assertion failed on expression: ShouldRunBehaviour(), [https://discussions.unity.com/t/error-assertion-failed-on-expression-shouldrunbehaviour/839805](https://discussions.unity.com/t/error-assertion-failed-on-expression-shouldrunbehaviour/839805)
[^4]: Addressables - Unity Term Book, [https://unitytermbook.com/en/addressables/](https://unitytermbook.com/en/addressables/)
[^6]: Best Practices | Spatial Creator Toolkit, [https://toolkit.spatial.io/docs/addressables/best-practices](https://toolkit.spatial.io/docs/addressables/best-practices)
[^7]: How to use DontDestroyOnLoad - Scripting - Unity Discussions, [https://discussions.unity.com/t/how-to-use-dontdestroyonload/894016](https://discussions.unity.com/t/how-to-use-dontdestroyonload/894016)
[^8]: DontDestroyOnLoad is not Working on Scene? - Stack Overflow, [https://stackoverflow.com/questions/18328180/dontdestroyonload-is-not-working-on-scene](https://stackoverflow.com/questions/18328180/dontdestroyonload-is-not-working-on-scene)
[^9]: why does "DontDestroyOnLoad" show up when I press play, if its not, [https://www.reddit.com/r/unity/comments/p8pj82/why_does_dontdestroyonload_show_up_when_i_press/](https://www.reddit.com/r/unity/comments/p8pj82/why_does_dontdestroyonload_show_up_when_i_press/)
[^11]: Error when using GetTable() - Unity Engine - Unity Discussions, [https://discussions.unity.com/t/error-when-using-gettable/892883](https://discussions.unity.com/t/error-when-using-gettable/892883)
[^12]: Unity Resource Manager | Package Manager UI website, [https://docs.unity3d.com/Packages/com.unity.resourcemanager@2.2/index.html](https://docs.unity3d.com/Packages/com.unity.resourcemanager@2.2/index.html)
[^13]: Namespace UnityEngine.ResourceManagement.Util | Addressables, [https://docs.unity.cn/Packages/com.unity.addressables@2.0/api/UnityEngine.ResourceManagement.Util.html](https://docs.unity.cn/Packages/com.unity.addressables@2.0/api/UnityEngine.ResourceManagement.Util.html)
[^15]: 어드레서블 Sprite 관련해서 질문이있습니다. - 인프런, [https://www.inflearn.com/community/questions/1351466/%EC%96%B4%EB%93%9C%EB%A0%88%EC%84%9C%EB%B8%94-sprite-%EA%B4%80%EB%A0%A8%ED%95%B4%EC%84%9C-%EC%A7%88%EB%AC%B8%EC%9D%B4%EC%9E%88%EC%8A%B5%EB%8B%88%EB%8B%A4](https://www.inflearn.com/community/questions/1351466/%EC%96%B4%EB%93%9C%EB%A0%88%EC%84%9C%EB%B8%94-sprite-%EA%B4%80%EB%A0%A8%ED%95%B4%EC%84%9C-%EC%A7%88%EB%AC%B8%EC%9D%B4%EC%9E%88%EC%8A%B5%EB%8B%88%EB%8B%A4)
[^19]: ArgumentNullException in StartCoroutine_Auto - Unity Discussions, [https://discussions.unity.com/t/argumentnullexception-in-startcoroutine-auto/1701939](https://discussions.unity.com/t/argumentnullexception-in-startcoroutine-auto/1701939)
[^20]: Changelog | Addressables | 1.11.2 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@1.11/changelog/CHANGELOG.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.11/changelog/CHANGELOG.html)
[^23]: Memory management overview | Addressables | 2.0.8 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@2.0/manual/MemoryManagement.html](https://docs.unity3d.com/Packages/com.unity.addressables@2.0/manual/MemoryManagement.html)
[^25]: Memory management | Addressables | 1.16.19 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@1.16/manual/MemoryManagement.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.16/manual/MemoryManagement.html)
[^26]: Memory management | Addressables | 1.20.5 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@1.20/manual/MemoryManagement.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.20/manual/MemoryManagement.html)
[^27]: Unity game memory optimization on Android, [https://developer.android.com/games/engines/unity/unity-reduce-memory](https://developer.android.com/games/engines/unity/unity-reduce-memory)
[^28]: Addressables not freeing memory completely? - Unity Discussions, [https://discussions.unity.com/t/addressables-not-freeing-memory-completely/914086](https://discussions.unity.com/t/addressables-not-freeing-memory-completely/914086)
[^29]: Addressables: how to truly unload assets to free memory, [https://discussions.unity.com/t/addressables-how-to-truly-unload-assets-to-free-memory/808301](https://discussions.unity.com/t/addressables-how-to-truly-unload-assets-to-free-memory/808301)

### Leitura adicional

- How to structure your Unity project (best practice tips) - [https://gamedevbeginner.com/how-to-structure-your-unity-project-best-practice-tips/](https://gamedevbeginner.com/how-to-structure-your-unity-project-best-practice-tips/)
- DontDestroyOnLoad in Unity — Best Practices — Tutorial #1 - [https://makaka.org/unity-tutorials/dont-destroy-on-load](https://makaka.org/unity-tutorials/dont-destroy-on-load)
- Class ComponentSingleton | Addressables | 4.1.0 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@4.1/api/UnityEngine.ResourceManagement.Util.ComponentSingleton-1.html](https://docs.unity3d.com/Packages/com.unity.addressables@4.1/api/UnityEngine.ResourceManagement.Util.ComponentSingleton-1.html)
- Problema ao atribuir SkeletonData a SkeletonAnimation em… - Spine - [https://pt.esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime](https://pt.esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime)
- Problem when assigning SkeletonData to SkeletonAnimation - [https://esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime](https://esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime)
- Scriptable Object inside an Addressable Folder causes Exception - [https://discussions.unity.com/t/scriptable-object-inside-an-addressable-folder-causes-exception/855434](https://discussions.unity.com/t/scriptable-object-inside-an-addressable-folder-causes-exception/855434)
- Changelog | Package Manager UI website - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@0.7/changelog/CHANGELOG.html](https://docs.unity3d.com/Packages/com.unity.addressables@0.7/changelog/CHANGELOG.html)
- Changelog | Addressables | 1.15.2 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@1.15/changelog/CHANGELOG.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.15/changelog/CHANGELOG.html)
- Addressables introduction | Addressables | 4.1.0 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@4.1/manual/AddressableAssetsOverview.html](https://docs.unity3d.com/Packages/com.unity.addressables@4.1/manual/AddressableAssetsOverview.html)
- Explain Addressables For Performance To Me Like I Am A Child - [https://www.reddit.com/r/Unity3D/comments/1brakih/explain_addressables_for_performance_to_me_like_i/](https://www.reddit.com/r/Unity3D/comments/1brakih/explain_addressables_for_performance_to_me_like_i/)
- Addressables: Planning and best practices - Unity - [https://unity.com/blog/engine-platform/addressables-planning-and-best-practices](https://unity.com/blog/engine-platform/addressables-planning-and-best-practices)
