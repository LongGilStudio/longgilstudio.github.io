---
title: "Relatório de Investigação Técnica Aprofundada: Mecanismos de Funcionamento, Arquitetura do Sistema e Impacto do DelayedActionManager no Ambiente Addressables da Unity"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: Análise aprofundada da arquitetura ComponentSingleton do DelayedActionManager no Unity Addressables, mecanismo de execução em LateUpdate, tratamento de exceções de proxy C#/C++ e estratégias de otimização de memória de AssetBundle.
lang: pt-PT
translation_id: unity-addressables-delayedactionmanager
---

O sistema Addressable Asset System (abreviado como Addressables) representa um avanço arquitetural revolucionário da Unity, ao disponibilizar uma solução de gestão de conteúdos flexível, robusta e otimizada sobre a base tradicional de AssetBundles[^1]. Durante a conceção e operação de jogos ou aplicações interativas de grande escala, gerir fluxos de dados assíncronos para carregar e libertar recursos de forma automática é um requisito essencial. Um dos componentes nucleares encarregues desta tarefa complexa — mas que deixa frequentemente os engenheiros de software perplexos ao analisarem a hierarquia (Hierarchy) — é um objeto gerado automaticamente denominado DelayedActionManager, alojado no interior da cena DontDestroyOnLoad[^2].

Este relatório técnico aprofunda a dissecação abrangente da natureza arquitetural do DelayedActionManager, explicando o motivo da sua existência no espaço DontDestroyOnLoad, analisando o mecanismo de execução dentro do ciclo em tempo real da Unity e dissecando os desafios ligados à gestão de memória, fenómenos de fugas (memory leaks) e exceções de execução habituais. Através da análise de dados de conceção do sistema e de boas práticas, o documento proporciona uma visão aprofundada destinada a auxiliar os arquitetos de software a otimizar a estabilidade da aplicação.

## A Evolução do Sistema de Carregamento de Recursos e a Base Assíncrona

Antes de entrar nas microestruturas do DelayedActionManager, compreender o contexto em que surgiu o sistema Addressables é condição prévia indispensável. Em versões antigas da Unity, os programadores dependiam frequentemente da pasta Resources ou utilizavam diretamente scripts básicos de AssetBundle[^4]. O mecanismo `Resources.Load()` funciona de modo semelhante ao utilizador deslocar-se pessoalmente a um armazém, ao exigir o caminho exato da pasta, e o fluxo principal de execução (main thread) fica obrigado a bloquear até que o recurso seja encontrado e carregado em memória[^4]. A desvantagem deste método reside no facto de impedir a escalabilidade da aplicação e provocar quebras acentuadas na taxa de fotogramas por segundo (FPS drop) ao processar grandes volumes de dados.

Para resolver este problema, o Addressables funciona como um serviço logístico moderno. O programador necessita apenas de fornecer o identificador do recurso (address/key), e o sistema encaminha-o automaticamente para localizar o recurso no armazenamento local (Local) ou descarregá-lo a partir de servidores de rede de distribuição de conteúdos (CDN - Content Delivery Network)[^4]. Mais importante ainda, todo este ciclo decorre de modo assíncrono (asynchronous). O comando de carregamento, tipicamente `Addressables.LoadAssetAsync`, não devolve o objeto de imediato, antes devolve um manipulador de controlo chamado `AsyncOperationHandle`[^4]. Esta interface faculta um mecanismo de chamada de retorno (callback) quando o recurso fica pronto, permitindo que o fluxo principal da aplicação continue a processar a lógica de física e gráficos sem interrupções[^4].

Esta transição do modelo síncrono para o modelo totalmente assíncrono acarreta um enorme desafio arquitetural: quando um processo de carregamento de recursos demora vários segundos a concluir devido a largura de banda de rede reduzida, a aplicação pode já ter transitado para uma cena (scene) inteiramente distinta[^1]. Gerir as funções de callback, as filas de tarefas (command queues) e a contagem de referências (reference counting) exige uma entidade de gestão central, imune ao ciclo de vida de destruição e criação das cenas comuns. É precisamente por essa razão que os programadores da Unity integraram o modelo de cena DontDestroyOnLoad no núcleo do Addressables.

## A Cena DontDestroyOnLoad (DDOL) e a Arquitetura de Persistência Global

No ambiente Unity, a operação de carregar uma nova cena (através de `SceneManager.LoadScene` no modo Single predefinido) desencadeia automaticamente o mecanismo de limpeza de memória. O sistema destrói (destroy) todos os GameObjects e Components pertencentes à cena anterior para assegurar a libertação dos recursos que deixaram de ser utilizados[^7]. Embora a funcionalidade de carregamento aditivo de cenas (Additive scenes) permita manter várias cenas ativas em paralelo para gerir o estado global (por exemplo, uma cena dedicada ao Game Manager e outra ao Level), o mecanismo DontDestroyOnLoad (DDOL) continua a desempenhar um papel sistémico crucial na proteção dos objetos de baixo nível[^7].

O aparecimento da cena DontDestroyOnLoad na interface do Editor da Unity ao premir o botão Play não constitui um erro, mas sim um mecanismo oculto predefinido do motor destinado a agrupar os objetos assinalados para não serem destruídos ao carregar uma nova cena[^9]. Para que um GameObject seja aceite nesta zona segura, o sistema Unity impõe uma regra obrigatória: esse objeto tem de se encontrar no nível raiz (root level) da cena[^8]. Qualquer tentativa de aplicar a função `DontDestroyOnLoad(gameObject)` a um objeto filho (nested object) falhará e será registado um aviso[^8].

Para o sistema Addressables, os processos de carregamento e libertação de recursos são operações cujo ciclo de vida abrange diversas cenas distintas. Por exemplo, o acompanhamento do estado de descarga de um AssetBundle a partir de um servidor remoto não pode ser cancelado a meio apenas porque o jogador acabou de atravessar um portal de mudança de nível. A utilização do mecanismo `RuntimeInitializeOnLoadMethod` combinado com o padrão de desenho Singleton avançado permite ao código-fonte do Addressables criar automaticamente um objeto raiz e colocá-lo na cena DDOL logo no arranque da aplicação[^2]. Isto explica por que razão, mesmo quando o programador não escreve uma única linha de código relativa a DDOL, um objeto com o nome "DelayedActionManager" aparece automaticamente no canto inferior esquerdo da lista de cenas[^2].

## Estrutura Interna e Papel Técnico do DelayedActionManager

Ao investigar em profundidade o código-fonte e a documentação da API do pacote Addressables, verifica-se que o DelayedActionManager é uma classe concreta (concrete class) situada no namespace `UnityEngine.ResourceManagement.Util`[^11]. A sua estrutura não corresponde a uma mera classe utilitária estática (static utility class), mas sim a um componente anexado diretamente a um GameObject mediante herança a partir de uma arquitetura de base[^12].

### O Padrão ComponentSingleton e a Automatização da Inicialização

A arquitetura do DelayedActionManager assenta no padrão de desenho ComponentSingleton, uma classe fundamental definida no mesmo namespace[^13]. A adoção do padrão Singleton num componente (Component), em vez de uma classe C# pura, confere ao sistema a capacidade de interagir diretamente com o ciclo de eventos em tempo real (PlayerLoop) da Unity.

Quando o sistema ResourceManager recebe pela primeira vez um pedido de carregamento ou atualização de estado (por exemplo, `Addressables.LoadAssetAsync` ou operações de diagnóstico de rede), invoca a instância do DelayedActionManager. Nesse instante, o padrão ComponentSingleton executa automaticamente um procedimento oculto que inclui: criar um GameObject vazio, atribuir-lhe o nome "DelayedActionManager", anexar-lhe o script correspondente e invocar de imediato a função `DontDestroyOnLoad` para o transferir para o espaço de proteção global[^2]. Esta conceção de inicialização tardia (lazy initialization) assegura que os recursos do sistema só são consumidos quando a funcionalidade de gestão de tarefas adiadas é efetivamente solicitada, esclarecendo as dúvidas frequentes dos programadores acerca do aparecimento "mágico" deste objeto na interface[^3].

### Análise do Mecanismo de Agendamento e da Fase LateUpdate

A função nuclear do DelayedActionManager consiste em atuar como um agendador central (central scheduler) para ações adiadas, chamadas de retorno (callbacks), corrotinas e gestão de memória a nível micro[^11]. A diferença subtil, porém extremamente relevante, na sua arquitetura reside no facto de toda a lógica de processamento de filas ser encaminhada para execução no interior da função `LateUpdate()` do ciclo de vida da Unity[^11].

A opção de conceção focada em `LateUpdate`, ao invés do `Update` tradicional, resolve um problema arquitetural profundo relativo à consistência dos dados. A tabela seguinte ilustra a ordem de execução da Unity e o papel da fase `LateUpdate` na salvaguarda dos dados do Addressables.

| Fase de Execução (PlayerLoop) | Funções Típicas | Papel face ao Addressables e ao DelayedActionManager |
| :--- | :--- | :--- |
| **FixedUpdate** | Processamento de simulação física, colisões estáticas/dinâmicas. | A lógica do jogo pode desencadear pedidos de destruição de objetos após colisões. |
| **Update** | Entrada do jogador (Input), movimentação, lógica de IA, atualização do estado do jogo. | As funções `Addressables.LoadAssetAsync` ou `Release` são invocadas manualmente. Os GameObjects podem ser destruídos com `Destroy()` aqui. |
| **LateUpdate** | Atualização da posição da câmara, correções de pós-processamento (post-processing). | O DelayedActionManager limpa a memória, atualiza variáveis contadoras de referência e invoca os callbacks assíncronos para garantir que não ocorram conflitos com as ordens de destruição da fase `Update`[^11]. |

Caso o sistema ResourceManager executasse os callbacks de conclusão de tarefa imediatamente a meio da fase `Update`, correria um elevado risco de interagir com um sistema (por exemplo, o sistema gráfico ou a interface de utilizador) que ainda se encontra num estado intermédio, sem ter concluído o cálculo do fotograma. Ao adiar (delaying) a invocação das funções OnComplete ou a decrementação dos contadores de referência (ref-count decrements) até ao `LateUpdate()`, o DelayedActionManager garante que todo o estado lógico do fotograma atual está estabilizado[^11]. Os dados de inúmeros relatórios de rastreio de pilha (stack traces) revelam que a função `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` constitui a última ponte antes de o controlo ser devolvido ao código do utilizador[^15].

## Dissecação de Exceções do Sistema (System Exceptions) e Rastreios de Pilha (Stack Traces)

Apesar de concebido com elevado rigor de segurança, a complexidade do mecanismo assíncrono, aliada a operações imprecisas de gestão do ciclo de vida por parte do programador, coloca frequentemente o DelayedActionManager no centro de exceções graves. Os registos de erro fornecem pistas cruciais sobre o modo como o sistema interage com a memória gerida (managed memory) e a memória nativa (native memory).

### Erro NullReferenceException e Conflito no Ciclo de Vida Proxy C# - C++

Um cenário de erro muito recorrente no ambiente Addressables é o aparecimento da exceção `ArgumentNullException: Value cannot be null. Parameter name: obj`, gerada a partir da função `StartCoroutine_Auto` do DelayedActionManager[^19]. Este erro não constitui uma falha interna da Unity, antes resulta da assincronia entre o mecanismo de recolha de lixo do C# (Garbage Collector) e a gestão de ponteiros brutos do código-fonte C++ subjacente[^19].

Na Unity, objetos como GameObject ou MonoBehaviour são, na realidade, classes representantes (proxy classes) escritas em C#, contendo uma referência interna que aponta para o objeto original alocado em C++ no motor[^19]. Quando o programador invoca o comando `Destroy(gameObject)`, o objeto C++ é de imediato destruído e a região de memória restituída, tornando nula a referência interna[^19]. Todavia, a classe proxy em C# pode permanecer na memória gerida (managed memory) durante algum tempo até ser varrida pelo coletor de lixo[^19].

A catástrofe acontece quando os programadores utilizam expressões anónimas (lambdas/closures) em conjunto com os processos assíncronos do Addressables. A expressão lambda possui a propriedade de "capturar" (capture) as variáveis de contexto ao seu redor. Analise-se o seguinte modelo de código-fonte:

```csharp
// Uma ação adicionada à fila do DelayedActionManager
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

Quando este código é executado, a variável `_crawlerRobot` (um proxy C#) fica retida pela closure[^19]. Se a lógica do jogo destruir `_crawlerRobot` ainda nesse mesmo fotograma, o ponteiro C++ subjacente desaparece. Contudo, como o DelayedActionManager já agendou a execução desta lambda para a fase `LateUpdate` (ou num fotograma posterior), no momento em que a lambda é finalmente ativada, tenta aceder ao membro `BreakAwayLowerBody()` de um ponteiro C++ já morto[^19]. A consequência inevitável é o lançamento de uma exceção `NullReferenceException` ou da mensagem de erro "O objeto foi destruído, mas ainda está a tentar aceder-lhe"[^19].

Para mitigar este risco arquitetural, os especialistas em software recomendam duas soluções de conceção:

1. Evitar o uso abusivo de aninhamento de expressões lambda (lambdas nesting) ao lidar com alterações de estado de baixo nível[^19].
2. Efetuar sempre verificações seguras de nulo, tirando partido do facto de a Unity ter sobrecarregado (overloaded) o operador `==` do C# para inspecionar diretamente o estado do ponteiro C++ subjacente[^19].

### Conflitos de PlayerLoop e o Erro "Assertion failed on expression: ShouldRunBehaviour()"

Durante o controlo de versões (version control) dos pacotes Addressables, um grande número de programadores relatou que o Editor da Unity ficava inundado por uma mensagem de erro de baixo nível: `Assertion failed on expression: 'ShouldRunBehaviour()'` no ficheiro `MonoBehaviour.cpp`[^3].

O rastreio de pilha (stack trace) indica que este processo tem origem diretamente no GameObject "DelayedActionManager" situado na cena DontDestroyOnLoad[^3]. A análise de causa raiz (Root Cause Analysis) revela uma falha no tratamento do fluxo de reprodução (Play Mode) do Editor da Unity. Quando o editor atravessa uma recompilação de domínio (Domain Reload) ou quando o processamento de carregamento de recursos ainda não terminou e o utilizador prime Parar (Stop) no jogo, o DelayedActionManager fica retido como um objeto órfão (orphaned object)[^3].

Por estar marcado como DontDestroyOnLoad, tenta continuar a executar ciclos de `LateUpdate` e verificações de comportamento (behaviour checks) mesmo depois de o ambiente de execução nativo da Unity (PlayerLoop) ter dado ordem de paragem a todas as tarefas[^3]. Este erro manifestou-se com maior gravidade durante a transição do pacote Addressables 1.16.x para 1.18.x, forçando muitas equipas de desenvolvimento a efetuar o downgrade manual para a versão 1.17.17 a fim de assegurar a estabilidade da API de tratamento síncrono e eliminar os bloqueios de fila[^3].

### A Oscilação do DelayedActionManager no Histórico de Versões

Um aspeto interessante na investigação da documentação da API e dos registos de alterações (changelogs) do Unity Addressables é a presença cíclica do DelayedActionManager. Versões como a 0.7.5 e a 1.11.2 anunciaram claramente no registo de atualizações a refatoração da interface de scripts de compilação (build script interface) com a nota: "Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading"[^20]. Esta decisão visava originalmente simplificar a camada de API e transferir o controlo para a classe personalizável `AsyncOperationBase`[^20].

Porém, relatórios de erros provenientes de versões pós-LTS (Long-Term Support), tais como 1.18.15, 1.19.19 e 1.21.21, expõem o regresso contínuo de `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` nas cadeias de pilha[^11]. Isto reflete a filosofia de conceção iterativa da Unity: após a remoção para simplificar, os engenheiros de sistemas aperceberam-se de que a falta de um gestor central de tarefas adiadas originava dificuldades inultrapassáveis na recolha de eventos de diagnóstico (DiagnosticEventCollector), no tratamento das tabelas de pré-carregamento (preload tables) e na garantia de segurança de memória ao encerrar a aplicação[^11]. O DelayedActionManager foi redesenhado e restaurado como um utilitário interno oculto do sistema, deixando de estar exposto na interface pública de utilizador, mas assumindo a responsabilidade de tratar os riscos de libertação (disposal) quando a aplicação se encerra[^20].

## Mecanismo de Contagem de Referências e Dinâmica de Fugas de Memória

A existência do DelayedActionManager está estreitamente ligada a um dos pilares mais complexos do Addressables: o Sistema de Gestão de Memória (Memory Management). Ao invés de depender inteiramente do Garbage Collector, o Addressables controla a permanência dos dados em RAM através do mecanismo de Contagem de Referências (Reference Counting)[^23].

### Dinâmica de Referências e Hierarquia de Dependências

Sempre que o sistema recebe um pedido de carregamento de um recurso, o contador de referências desse recurso é incrementado em um (increment). Concluída a utilização, o comando `Addressables.Release` dá indicação ao sistema para decrementar esse contador (decrement)[^23]. A regra de ouro determina que o sistema apenas permite libertar a memória física que aloja o recurso quando o contador de referências regressa ao valor absoluto igual a 0[^23].

A complexidade cresce exponencialmente devido ao facto de o Addressables gerir dependências através da arquitetura AssetBundle. Ao carregar um recurso (por exemplo, um material - Material), o sistema não carrega somente esse material, mas carrega automaticamente todos os AssetBundles que contêm os respetivos componentes dependentes (por exemplo, Texture)[^25]. O grafo de dependências (dependency graph) é calculado ao nível do Bundle, o que significa que se um recurso no Bundle A referenciar um recurso no Bundle B, todo o Bundle B terá de ser carregado para a memória principal[^26].

A limitação técnica mais rígida da Unity nesta arquitetura é: **O utilizador não pode libertar parcialmente (partially unload) o conteúdo de um AssetBundle**[^23]. Para clarificar, suponha-se um AssetBundle denominado "stuff" que contém três recursos independentes: Árvore, Tanque e Vaca[^23].

1. Quando o recurso Árvore é carregado, a ferramenta de análise de memória (Profiler) apresenta uma referência para Árvore e uma referência correspondente para o bundle `stuff`[^23].
2. Quando o recurso Tanque é carregado de seguida, o contador de Tanque aumenta e o contador de `stuff` sobe para 2[^23].
3. Se o jogo executar o comando `Release(Árvore)`, o contador de Árvore desce para 0 e a barra azul no Profiler desaparece[^23].
4. Contudo, os dados físicos de Árvore permanecem intactos na memória do sistema. Dado que Tanque continua a manter a ligação ativa fazendo com que o contador do AssetBundle `stuff` seja superior a 0, nenhum recurso contido neste bundle pode ser destruído até que todo o bundle seja libertado na íntegra[^23].

### Síndrome de "Asset Churn" e Inchaço de Memória (Memory Bloat)

O fenómeno em que os recursos são continuamente carregados, libertados e de imediato recarregados num curto espaço de tempo é definido como "Asset Churn" (rotatividade excessiva de recursos)[^23]. Esta falha surge frequentemente na transição entre níveis (levels). Se o Nível 1 utiliza o recurso Barco e o Nível 2 utiliza o recurso Avião (ambos partilham a textura Camuflagem). Ao sair do Nível 1, o programador liberta Barco, o que leva o sistema Addressables a descarregar de imediato a textura Camuflagem da memória. Um milissegundo depois, quando o Nível 2 instancia Avião, o sistema volta a forçar o disco rígido a executar o ciclo de E/S para recarregar aquela textura Camuflagem do zero[^23]. Este processo gera picos (spikes) abruptos no tempo de fotograma e impele o consumo de memória para patamares perigosos, sobretudo em dispositivos móveis[^27].

Além disso, a omissão do comando `Release` conduz à acumulação de referências residuais, fazendo com que a ocupação de RAM derive de centenas de megabytes até atingir gigabytes após apenas algumas mudanças de cena[^28]. Uma vez que nem o DelayedActionManager nem o próprio Addressables acompanham o número de instâncias criadas pelo método `Instantiate` puro de MonoBehaviour, qualquer lapso no controlo dos manipuladores de memória criará fugas de memória permanentes[^6].

### Arquitetura de Compressão de Dados e Pressão de Alocação de Memória

A dimensão dos AssetBundles e o método de compressão de dados influenciam diretamente o modo como os dados residem na RAM. A escolha do método de compressão determina se o AssetBundle ocupará um grande volume de memória de forma permanente ou se conseguirá otimizar a largura de banda.

Tabela comparativa das características dos algoritmos de compressão de AssetBundle e do impacto no armazenamento[^29]:

| Algoritmo de Compressão | Capacidade de Reconhecimento de Ficheiro Local | Exige Carregar o Bundle Inteiro em RAM | Impacto no Desempenho e Armazenamento |
| :--- | :--- | :--- | :--- |
| **LZMA** | Não. O bundle é comprimido em bloco único. | **Sim.** É necessário descomprimir todo o ficheiro em memória. | Taxa de compressão mais elevada e menor dimensão de descarga, mas origina inchaço agudo de memória (Memory Bloat) e consumo intenso de CPU na extração[^29]. |
| **LZ4** | Sim. Compressão por blocos (chunk-based). | **Não.** Carrega apenas a fração de dados que está a ser acedida. | Recomendado como norma predefinida (default). Permite armazenamento em cache (caching) direto no disco local sem carregar todos os metadados para a RAM[^29]. |
| **Uncompressed** | Sim. Acesso independente por recurso. | **Não.** Acesso direto. | Sem custo temporal de descompressão, mas maior dimensão de ficheiro original. Ótimo para carregamento instantâneo caso a largura de banda do disco o permita[^29]. |

Ao solicitar um pequeno recurso de dentro de um enorme AssetBundle comprimido com LZMA, todo o ficheiro (incluindo cabeçalho, metadados e tabelas de buffer de streaming) tem de ser transferido do disco rígido para a RAM[^27]. Este erro de conceção transforma AssetBundles gigantescos em bombas-relógio, provocando falhas por esgotamento de memória (OOM crashes) na aplicação[^27].

## Boas Práticas (Best Practices) na Gestão de Recursos

Para dominar a complexidade do sistema de contagem de referências e atenuar o encargo sobre o DelayedActionManager, os arquitetos de sistemas têm de aplicar uma estrutura de ciclo de vida extremamente rigorosa, aliada a técnicas de otimização do ciclo de vida dos recursos.

### 1. Sincronização do Ciclo de Inicialização e Libertação

Todo o objeto `AsyncOperationHandle` devolvido pela API tem de ser obrigatoriamente libertado no termo do respetivo ciclo de utilização[^6]. Omitir este passo não só origina fugas de memória como também pode provocar falhas gerais do sistema (crashes)[^6]. A tabela abaixo ilustra as operações simétricas obrigatórias na programação com Addressables:

| Método de Inicialização / Carregamento | Método de Libertação Correspondente | Mecanismo de Funcionamento Interno |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | Subtrai 1 ao contador de referências do AssetBundle que o contém[^6]. |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | Destrói o objeto apresentado (Instance) e subtrai automaticamente 1 ao contador do Prefab original[^4]. |
| Atribuição através de `AssetReference` | `reference.ReleaseAsset()` | Equivalente a invocar Release através do manipulador; limpa referências estáticas[^6]. |

Em especial, ao utilizar ScriptableObjects para guardar definições do jogo, referenciar diretamente um objeto (`public Object _worldAsset`) cria referências rígidas (hard references), obrigando todo o sistema a carregar esse recurso para a RAM de imediato[^27]. A solução ótima consiste em utilizar AssetReference (`public AssetReference addressableAsset;`) para carregar de forma assíncrona consoante a necessidade (on-demand loading)[^6].

### 2. Intervenção de Baixo Nível: Resources.UnloadUnusedAssets()

Numa situação sem saída em que AssetBundles partilhados ficam retidos em memória devido à propriedade de "não libertação parcial" (por exemplo, o recurso Árvore preso juntamente com Tanque), a única saída reside no recurso a uma API forçada da camada base do motor: `Resources.UnloadUnusedAssets()`[^25].

Esta função realiza uma pesquisa profunda em toda a RAM do sistema para detetar todos os recursos (incluindo os ocultos em AssetBundles) cujo número efetivo de referências internas (actual engine references) seja rigorosamente igual a 0, e força a sua destruição[^25]. Ainda assim, trata-se de uma operação com custo computacional elevadíssimo, provocando quebras graves de fotogramas (FPS drops) porque o CPU tem de suspender o fluxo lógico para efetuar a limpeza[^27]. Os engenheiros devem acionar este comando apenas durante ecrãs de carregamento prolongados (loading screens), ou deixar que o sistema o invoque automaticamente ao utilizar `SceneManager.LoadScene` na transição de cenas[^29].

### 3. Planeamento e Fragmentação de AssetBundles (Bundle Packing Modes)

A organização da estrutura dos grupos (Groups) na interface de configuração do Addressables determina diretamente o desempenho de carregamento em memória e a largura de banda de descarga. Selecionar o modo de empacotamento (Bundle Mode) adequado ao tipo de recurso constitui uma etapa de conceção crucial[^6]:

* **Pack Together (Empacotar em Conjunto)**: Utilizado para recursos com ciclo de vida fortemente interligado que surgem sempre em simultâneo. Reduz o custo de análise do grafo de dependências e o E/S de rede[^6].
* **Pack Separately (Empacotar Separadamente)**: Ótimo para recursos gigantescos e independentes, ou mapas amplos em que não é possível garantir o carregamento conjunto. Elimina o risco de um recurso de grande dimensão impedir a libertação de outro mais pequeno[^6].
* **Pack Together By Label (Empacotar por Etiqueta)**: Permite combinar recursos dispersos através de metadados de etiquetas (por exemplo, atribuir a etiqueta "Halloween 2023" para reunir todo o conteúdo do evento num único bundle, facilitando a atualização via CDN)[^6].

Para reduzir ainda mais o peso da tabela de índice (TypeTree) no AssetBundle, o programador pode ativar a opção `BuildAssetBundleOptions.DisableWriteTypeTree`. Esta funcionalidade remove metadados desnecessários, todavia exige a reconstrução dos grupos locais (rebuild local groups) antes da exportação do ficheiro executável[^26].

### 4. Gestão de Memória de Áudio e Imagem (Graphics & Audio)

Otimizar as camadas auxiliares constitui a medida mais eficaz para reduzir a frequência de atuação do coletor de lixo. A configuração do formato de carregamento do fluxo de áudio influencia diretamente a memória[^27]:

* **Música de fundo (BGM) longa**: Deve ser configurada em modo Streaming para ir carregando pequenos buffers a partir do disco[^27].
* **Efeitos sonoros longos**: Selecionar Compressed In Memory para manter comprimido em RAM e descomprimir em tempo real durante a reprodução[^27].
* **Efeitos sonoros curtos / alta frequência**: Usar Decompress On Load para disponibilizar diretamente os dados descomprimidos, eliminando o custo de CPU[^27].

Além disso, desativar a opção "Read/Write enabled" em Texturas e configurar a supressão do buffer de profundidade (Depth Stencil Format para None) nas Câmaras de interface gráfica (UI) reduzirá em pelo menos 50% a quantidade desnecessária de RAM de renderização[^27].

## Conclusão sobre a Interação Global

A investigação sobre o DelayedActionManager não só descodifica a origem de um objeto oculto na cena DontDestroyOnLoad, como também expõe a filosofia fundamental de conceção do sistema Addressables na Unity. Esta classe ComponentSingleton atua como uma ponte temporal subtil, preservando a integridade dos dados ao encaminhar os processos de libertação, as chamadas assíncronas e o tratamento de buffers para o ciclo LateUpdate. Isola as alterações estruturais de memória das perturbações que poderiam ser provocadas por código de física ou lógica de controlo pertencentes ao fluxo de Update, formando um escudo contra exceções suscetíveis de corromper o sistema aquando das transições de cena.

Contudo, o DelayedActionManager não é uma varinha mágica capaz de sanar as fragilidades intrínsecas da arquitetura de gestão de memória. Impõe aos arquitetos de software a exigência rigorosa de manter o ciclo de carregamento e libertação de recursos totalmente simétrico, conceber expressões anónimas em C# (lambdas) evitando ciclos de captura de objetos C++ nativos e modularizar a estrutura de AssetBundles para prevenir fugas de memória persistentes. Através de uma compreensão aprofundada do encaminhamento de carregamento assíncrono, do uso criterioso de métodos de compressão como LZ4 e da força coerciva de `Resources.UnloadUnusedAssets`, as equipas de desenvolvimento podem conceber arquiteturas sólidas e altamente escaláveis em qualquer plataforma sem enfrentar o receio do esgotamento permanente de recursos.

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

### Leituras adicionais

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
