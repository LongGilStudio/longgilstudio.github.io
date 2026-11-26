---
title: "Otimização de Desempenho no Unity: Compreender e Corrigir Picos de Alocação de Memória (GC Alloc) com Resources.FindObjectsOfTypeAll"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: Guia detalhado para iniciantes sobre a origem das quebras de desempenho (frame spikes) ao abusar de Resources.FindObjectsOfTypeAll no Unity e os 4 métodos de otimização mais eficazes.
lang: pt-PT
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

Durante o desenvolvimento de jogos com o Unity, já te deparaste certamente com situações em que precisas de localizar um determinado `GameObject` ou `Component`. O Unity disponibiliza várias funções para esse fim, tais como `Find`, `FindObjectOfType` e, em particular, `Resources.FindObjectsOfTypeAll`.

Embora `Resources.FindObjectsOfTypeAll` seja extremamente poderoso por conseguir encontrar **tudo** (incluindo objetos desativados — inactive, prefabs nas pastas do projeto ou recursos que ainda não foram instanciados), trata-se também de um dos «assassinos» silenciosos do desempenho do teu jogo caso não seja utilizado corretamente.

Este artigo vai ajudar-te a compreender claramente por que razão esta função é tão perigosa, como as ferramentas de análise (Profiler / Project Auditor) emitem avisos e quais os métodos de otimização detalhados para eliminar por completo o lixo de memória (Garbage Collection Allocation — GC Alloc).

---

## **1. Porque é que `Resources.FindObjectsOfTypeAll` Prejudica o Desempenho?**

Ao executares o Unity Memory Profiler ou o Project Auditor, poderás encontrar um aviso amarelo (Moderate):
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

Para perceber o porquê, importa analisar o funcionamento interno desta função no motor (C++ core):

1. **Pesquisa Integral da Memória (Elevado Custo de CPU)**: Ao contrário de `FindObjectOfType`, que analisa apenas os objetos ativos na cena (Scene), `Resources.FindObjectsOfTypeAll` percorre **toda** a memória do motor. Passa por todos os objetos da cena, objetos do Editor (se estiver a correr no Editor) e todos os recursos (Assets) carregados em RAM. Quanto maior for o projeto, mais lenta se torna a execução desta função.
2. **Geração de Lixo na Memória (GC Allocation)**: Sempre que termina a sua execução, esta função cria **invariavelmente** um novo array (`Array`) no Managed Heap de C# para guardar o resultado devolvido.

**Consequência:** Se invocares esta função de forma contínua (por exemplo, dentro de `Update()`, ou sempre que um botão da UI é premido), estás a despejar lixo (arrays antigos) na memória sem parar. Quando a memória fica cheia, o coletor de lixo (Garbage Collector — GC) do Unity é forçado a entrar em ação. Este processo de limpeza bloqueia o jogo por um instante, provocando **engasgos (stuttering)** muito desagradáveis no ecrã para o jogador.

---

## **2. Os 4 Métodos de Otimização (Boas Práticas)**

Para resolver este problema de vez, consoante o caso, podes aplicar um dos 4 métodos rigorosos que se seguem, reunidos por engenheiros de otimização do Unity.

### **Método 1: Referência direta através do Inspector (Mais recomendado)**
A forma mais rápida e que consome 0 de CPU e RAM consiste em **não efetuar qualquer pesquisa**. Em vez de usares código para procurar um objeto, declara uma variável `public` ou `[SerializeField]` e arrasta e larga o objeto diretamente na interface do Inspector do Unity.

```csharp
// ❌ EVITAR: Pesquisa dispendiosa
void Start() {
    // Esta função vai gerar GC Alloc
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ MELHOR SOLUÇÃO: Referência direta
[SerializeField] private GameManager myManager; 
// (Arrasta e larga o GameManager neste campo no Editor do Unity)
```

### **Método 2: Caching (Armazenamento em cache) e Singleton**
Se fores mesmo obrigado a usar código para procurar, **efetua a pesquisa apenas 1 única vez** (por exemplo, em `Awake()` ou `Start()`), guardando depois a referência em cache numa variável para reutilizações futuras.

Para sistemas partilhados como `UIManager` ou `AudioManager`, utiliza o padrão Singleton ou uma propriedade estática para aceder globalmente sem custos de pesquisa.

```csharp
// ❌ EVITAR: Invocar a função de pesquisa sempre que for necessário texto
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ MELHOR: Guardar em cache numa variável static (pesquisar apenas 1 vez)
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // Pesquisa apenas 1 vez
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // Reutilização imediata, custo 0
}
```

### **Método 3: Atualizar para a API moderna do Unity 6**
Anteriormente, nas primeiras versões do Unity 2023 ao substituir `FindObjectsOfType`, o Unity recorria ao enum `FindObjectsSortMode`:

```csharp
// ⚠️ Antigo (Unity 2023.1 - 2023.2):
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```
Contudo, **a partir do Unity 6, o enum `FindObjectsSortMode` passou oficialmente a estar marcado como obsoleto (Deprecated / Obsolete)** devido à transição do motor de `InstanceID` de 32 bits para um novo mecanismo de identificação de objetos e à eliminação da ordenação para maximizar o desempenho.

Segundo a documentação oficial do Unity 6, deves utilizar as seguintes sobrecargas normalizadas:

```csharp
// ❌ Antigo (Unity 2022 e anteriores - Lento, obriga à ordenação do array)
var managers = FindObjectsOfType<GameManager>();

// ✅ Norma Unity 6: Obter 1 objeto qualquer (O mais rápido, Zero-Alloc)
// Não aloca array no Heap; devolve de imediato o primeiro objeto encontrado
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Norma Unity 6: Obter uma lista de vários objetos (Sem o parâmetro SortMode já obsoleto)
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **Sugestão:** `FindAnyObjectByType<T>()` é muito mais eficiente do que `FindFirstObjectByType<T>()` quando tens apenas 1 instância (como um Manager ou Controller), pois ignora a ordem na hierarquia e devolve imediatamente o primeiro objeto encontrado.

#### ⚠️ **Equívoco frequente: Existe `Resources.FindObjectsOfTypeNonAlloc`?**
Muitos programadores estão habituados às funções de reutilização de arrays do Unity (como `Physics.RaycastNonAlloc` ou `GetComponentsNonAlloc`) e presumem que `Resources` também dispõe de uma função `NonAlloc` idêntica.
Na realidade, de acordo com a documentação oficial do Unity: **NÃO existe de todo a função `Resources.FindObjectsOfTypeNonAlloc`**. `Resources.FindObjectsOfTypeAll` cria **sempre** um novo array no Managed Heap cada vez que é invocada.

Se precisares de acompanhar uma lista de todos os objetos na cena mantendo **0 GC Alloc absoluto**, aplica a técnica de **autorregisto (Static Registration Pattern)**:

```csharp
// ✅ Solução Zero GC Alloc: Autorregisto numa lista ao ativar
public class Enemy : MonoBehaviour 
{
    // Lista estática partilhada, reutiliza memória sem novas alocações
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// Em qualquer ponto do jogo onde seja necessário aceder:
// Usa diretamente Enemy.ActiveEnemies — dezenas de vezes mais rápido do que Find e com 0 GC Alloc!
```

### **Método 4: Envolver o código com `#if UNITY_EDITOR` para ferramentas do Editor**
Por vezes descarregas um plugin da Asset Store (por exemplo, um sistema de animação ou ferramenta de UI) e este inclui `Resources.FindObjectsOfTypeAll`. Na maioria dos casos, essas chamadas destinam-se apenas a botões utilitários no ambiente de desenvolvimento (Editor).

Para evitar que estas funções se «infiltrem» na compilação final do jogo (Build Player) e originem avisos, podes envolvê-las com a diretiva de pré-processador `#if UNITY_EDITOR`. O código no interior é completamente removido aquando da exportação do jogo.

```csharp
#if UNITY_EDITOR 
// Este bloco de código só é executado enquanto trabalhas no Editor do Unity
// Será completamente removido ao compilar para o ficheiro .exe, .apk
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. Casos Práticos: Resolução Completa num Projeto de Jogo**

Para perceberes melhor como aplicar na prática, analisemos os 2 cenários mais comuns em que o Unity Project Auditor ou o Profiler sinaliza lixo de memória proveniente de pacotes de assets de terceiros:

### **Cenário 1: Sistema de localização da UI a percorrer a RAM sempre que o idioma muda**
* **Problema**: Sempre que um texto da UI precisa de ser apresentado ou é reproduzido um som de interface, uma função auxiliar invoca `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]`. Isto faz com que cada ação de abertura de menu percorra toda a RAM e gere um array de lixo no Heap.
* **Como resolver**:
  1. Usar `FindAnyObjectByType<UIManager>()` para localizar uma única vez na inicialização (`Awake`).
  2. Criar uma propriedade estática `SharedUIManager` para guardar em cache, convertendo a pesquisa num acesso instantâneo $O(1)$ com **0 bytes de lixo**.

```csharp
// ❌ ANTES DA OTIMIZAÇÃO: Percorre toda a memória e gera lixo em cada chamada
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ DEPOIS DA OTIMIZAÇÃO: Aproveitamento de Cache estática (Zero GC Alloc)
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // Cache de acesso rápido para todo o jogo
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // Usa a API do Unity 6 para procurar uma única vez, sem alocar array
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// Em qualquer local onde seja preciso obter texto, basta aceder através da Cache:
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **Cenário 2: Utilitários de Editor de terceiros a passarem para a Build do jogo**
* **Problema**: Muitos pacotes de ferramentas (como sistemas de Animation ou Level Design) trazem funções de pesquisa de recursos `Resources.FindObjectsOfTypeAll` para suportar botões de Reset ou Setup no Editor. Mesmo que a jogabilidade nunca as chame, manter esse código exposto no código-fonte de runtime leva o Unity a assinalar a Build do jogo (Player) com avisos de GC Alloc.
* **Como resolver**: Envolver todo esse bloco de pesquisa com a diretiva de pré-processador `#if UNITY_EDITOR`. Quando compilares o jogo para um ficheiro executável (`.exe`, `.apk`), o Unity elimina automaticamente essas linhas do runtime.

```csharp
// ❌ ANTES DA OTIMIZAÇÃO: Código de pesquisa de recursos do Editor exposto em Runtime
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ DEPOIS DA OTIMIZAÇÃO: Envolvido pela diretiva de pré-processador #if UNITY_EDITOR
#if UNITY_EDITOR
// Este bloco existe apenas no Editor do Unity e é removido a 100% ao compilar o jogo
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **Conclusão**

Para quem está a começar no Unity, «lixo de memória» (GC Allocation) é um conceito algo abstrato porque o C# trata da limpeza de forma automática. Porém, na programação de jogos, gerar lixo continuamente traduz-se em engasgos claramente visíveis no ecrã.

A regra de ouro: **Mantém-te afastado da família de funções `Find` (em especial `Resources.FindObjectsOfTypeAll`) dentro de ciclos como `Update()` ou em eventos acionados com frequência.** Dá prioridade a referências diretas pelo Inspector, tira partido do armazenamento em cache (Cache / Singleton), atualiza para a API padrão do Unity 6 (`FindAnyObjectByType`) e protege utilitários do Editor com `#if UNITY_EDITOR`. Otimizar estes pequenos pormenores ajudará o teu jogo a manter 60 FPS estáveis em qualquer dispositivo!
