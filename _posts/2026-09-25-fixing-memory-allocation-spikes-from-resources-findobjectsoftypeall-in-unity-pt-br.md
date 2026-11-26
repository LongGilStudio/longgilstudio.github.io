---
title: "Otimização de Desempenho no Unity: Entendendo e Corrigindo Picos de Alocação de Memória (GC Alloc) com Resources.FindObjectsOfTypeAll"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: Guia detalhado para iniciantes sobre o que causa travamentos (frame spikes) ao abusar de Resources.FindObjectsOfTypeAll no Unity e os 4 métodos de otimização mais precisos.
lang: pt-BR
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

Durante o desenvolvimento de jogos no Unity, você com certeza já precisou encontrar algum `GameObject` ou `Component` específico. O Unity oferece diversas funções para isso, como `Find`, `FindObjectOfType` e, em especial, `Resources.FindObjectsOfTypeAll`.

Embora `Resources.FindObjectsOfTypeAll` seja extremamente poderoso por conseguir localizar **tudo** (incluindo objetos desativados — inactive, prefabs nas pastas do projeto ou recursos que ainda não foram instanciados), ele também é um dos "assassinos" silenciosos do desempenho do seu jogo se não for usado da maneira correta.

Este artigo vai ajudar você a entender exatamente por que essa função é tão perigosa, como as ferramentas de análise (Profiler / Project Auditor) emitem alertas sobre ela e mostrar em detalhes os métodos de otimização para eliminar completamente o lixo de memória (Garbage Collection Allocation — GC Alloc).

---

## **1. Por Que `Resources.FindObjectsOfTypeAll` Prejudica o Desempenho?**

Ao executar o Unity Memory Profiler ou o Project Auditor, você pode se deparar com um aviso amarelo (Moderate):
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

Para entender o motivo, precisamos observar como essa função opera por baixo dos panos no núcleo da engine (C++ core):

1. **Varredura Completa de Memória (Alto Custo de CPU)**: Diferente de `FindObjectOfType`, que verifica apenas os objetos ativos na cena (Scene), `Resources.FindObjectsOfTypeAll` varre **toda** a memória da engine. Ele percorre todos os objetos da cena, objetos do Editor (quando executado no Editor) e todos os recursos (Assets) carregados na memória RAM. Quanto maior for o projeto, mais lenta se torna a execução dessa função.
2. **Criação de Lixo de Memória (GC Allocation)**: Sempre que termina de rodar, essa função **sempre** cria um novo array (`Array`) no Managed Heap do C# para armazenar o resultado retornado.

**Consequência:** Se você chamar essa função continuamente (por exemplo, dentro de `Update()`, ou toda vez que um botão da UI for clicado), estará jogando lixo (arrays antigos) na memória sem parar. Quando a memória enche, o coletor de lixo (Garbage Collector — GC) do Unity é forçado a entrar em ação. Esse processo de limpeza congela o jogo por um instante, causando o fenômeno de **travamentos e engasgos (stuttering)** bastante incômodos para o jogador.

---

## **2. Os 4 Métodos de Otimização (Boas Práticas)**

Para resolver esse problema de forma definitiva, dependendo do cenário, você pode aplicar um dos 4 métodos comprovados a seguir, reunidos a partir da experiência de engenheiros de otimização do Unity.

### **Método 1: Referência direta pelo Inspector (Mais recomendado)**
A maneira mais rápida e que consome 0 de CPU e RAM é **não buscar nada**. Em vez de escrever código para procurar um objeto, declare uma variável `public` ou `[SerializeField]` e arraste e solte o objeto diretamente pela interface do Inspector do Unity.

```csharp
// ❌ EVITE: Busca custosa
void Start() {
    // Esta função vai gerar GC Alloc
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ MELHOR OPÇÃO: Referência direta
[SerializeField] private GameManager myManager; 
// (Arraste e solte o GameManager neste campo no Unity Editor)
```

### **Método 2: Caching (Armazenamento em cache) e Singleton**
Se você realmente precisar usar código para localizar um objeto, **busque apenas 1 única vez** (por exemplo, em `Awake()` ou `Start()`) e depois salve (faça cache) em uma variável para reutilizar nas próximas vezes.

Para sistemas compartilhados como `UIManager` ou `AudioManager`, utilize o padrão Singleton ou uma propriedade estática para ter acesso global sem nenhum custo de busca.

```csharp
// ❌ EVITE: Chamar a função de busca sempre que precisar de texto
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ MELHOR: Salvar em cache numa variável static (buscar só 1 vez)
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // Busca apenas 1 vez
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // Reutilização imediata, custo 0
}
```

### **Método 3: Atualizar para a API moderna do Unity 6**
Anteriormente, nas primeiras versões do Unity 2023 ao substituir `FindObjectsOfType`, o Unity utilizava o enum `FindObjectsSortMode`:

```csharp
// ⚠️ Antigo (Unity 2023.1 - 2023.2):
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```
No entanto, **a partir do Unity 6, o enum `FindObjectsSortMode` foi oficialmente marcado como obsoleto (Deprecated / Obsolete)** porque a engine mudou do `InstanceID` de 32 bits para um novo mecanismo de identificação de objetos e removeu a ordenação para maximizar o desempenho.

De acordo com a documentação oficial do Unity 6, você deve utilizar as seguintes sobrecargas padronizadas:

```csharp
// ❌ Antigo (Unity 2022 e anteriores - Lento, força a ordenação do array)
var managers = FindObjectsOfType<GameManager>();

// ✅ Padrão Unity 6: Obter 1 objeto qualquer (Mais rápido, Zero-Alloc)
// Não aloca array no Heap; retorna imediatamente o primeiro objeto encontrado
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Padrão Unity 6: Obter uma lista de vários objetos (Sem o parâmetro SortMode que ficou obsoleto)
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **Dica:** `FindAnyObjectByType<T>()` é muito mais eficiente do que `FindFirstObjectByType<T>()` quando você possui apenas 1 instância (como um Manager ou Controller), pois ele não se importa com a ordem na hierarquia e devolve de imediato o primeiro objeto encontrado.

#### ⚠️ **Equívoco comum: Existe `Resources.FindObjectsOfTypeNonAlloc`?**
Muitos desenvolvedores estão acostumados com as funções do Unity que reutilizam arrays (como `Physics.RaycastNonAlloc` ou `GetComponentsNonAlloc`) e acham que `Resources` também possui uma função `NonAlloc` parecida.
Na realidade, segundo a documentação oficial do Unity: **NÃO existe de forma alguma a função `Resources.FindObjectsOfTypeNonAlloc`**. `Resources.FindObjectsOfTypeAll` **sempre** criará um novo array no Managed Heap cada vez que for chamada.

Se você precisa manter uma lista de todos os objetos na cena alcançando **0 GC Alloc absoluto**, utilize a técnica de **autorregistro (Static Registration Pattern)**:

```csharp
// ✅ Solução Zero GC Alloc: Autorregistro na lista ao ativar
public class Enemy : MonoBehaviour 
{
    // Lista estática compartilhada, reutilizando memória sem novas alocações
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// Em qualquer lugar do jogo que precisar acessar:
// Use diretamente Enemy.ActiveEnemies — dezenas de vezes mais rápido que Find e com 0 GC Alloc!
```

### **Método 4: Envolver o código com `#if UNITY_EDITOR` para ferramentas do Editor**
Às vezes você baixa um plugin na Asset Store (por exemplo, um sistema de animação ou ferramenta de UI) e ele contém `Resources.FindObjectsOfTypeAll`. Normalmente, essas funções servem apenas para botões utilitários no ambiente de desenvolvimento (Editor).

Para impedir que essas chamadas "vazem" para a versão final do jogo (Build Player) e disparem avisos, você pode envolvê-las com a diretiva de pré-processamento `#if UNITY_EDITOR`. Todo o código lá dentro será completamente removido ao exportar o jogo.

```csharp
#if UNITY_EDITOR 
// Este trecho de código só é executado enquanto você trabalha no Unity Editor
// Será totalmente removido ao gerar a Build (.exe, .apk)
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. Exemplos Práticos: Resolvendo de Forma Definitiva no Projeto do Jogo**

Para compreender melhor como aplicar na prática, vamos analisar os 2 cenários mais comuns em que o Unity Project Auditor ou o Profiler alerta sobre lixo de memória vindo de pacotes de assets de terceiros:

### **Cenário 1: Sistema de localização de UI varrendo a RAM toda vez que o idioma muda**
* **Problema**: Sempre que um texto da UI precisa ser exibido ou um som de interface é tocado, uma função utilitária chama `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]`. Isso faz com que cada ação ao abrir um menu escaneie toda a RAM e gere um array de lixo no Heap.
* **Como resolver**:
  1. Usar `FindAnyObjectByType<UIManager>()` para localizar uma única vez na inicialização (`Awake`).
  2. Criar uma propriedade estática `SharedUIManager` para armazenar em cache, transformando a operação de busca em um acesso instantâneo $O(1)$ com **0 bytes de lixo**.

```csharp
// ❌ ANTES DA OTIMIZAÇÃO: Varre toda a memória e gera lixo a cada chamada
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ DEPOIS DA OTIMIZAÇÃO: Aproveitando o Cache estático (Zero GC Alloc)
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // Cache de acesso rápido para todo o jogo
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // Usa a API do Unity 6 para buscar 1 única vez, sem alocar array
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// Em qualquer lugar que precisar pegar texto, basta ler pelo Cache:
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **Cenário 2: Utilitários de Editor de terceiros vazando para a Build do jogo**
* **Problema**: Muitos pacotes de ferramentas (como sistemas de Animation ou Level Design) vêm com funções de busca de recursos `Resources.FindObjectsOfTypeAll` para dar suporte a botões de Reset ou Setup no Editor. Mesmo que o gameplay nunca os chame, deixar esse código exposto no código-fonte de runtime faz o Unity marcar a Build do jogo (Player) com alertas de GC Alloc.
* **Como resolver**: Envolver todo esse bloco de busca com a diretiva de pré-processamento `#if UNITY_EDITOR`. Quando você compilar o jogo para um arquivo instalável (`.exe`, `.apk`), o Unity cortará automaticamente essas linhas do runtime.

```csharp
// ❌ ANTES DA OTIMIZAÇÃO: Código de busca de recursos do Editor exposto no Runtime
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ DEPOIS DA OTIMIZAÇÃO: Envolvido pela diretiva de pré-processamento #if UNITY_EDITOR
#if UNITY_EDITOR
// Este bloco existe apenas no Unity Editor e é removido em 100% na Build do jogo
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **Conclusão**

Para quem está começando no Unity, "Lixo de memória" (GC Allocation) é um conceito bastante abstrato porque o C# cuida da limpeza de forma automática. No entanto, na programação de jogos, gerar lixo continuamente leva a engasgos claramente visíveis na tela.

A regra de ouro: **Fique longe da família de funções `Find` (especialmente `Resources.FindObjectsOfTypeAll`) dentro de loops como `Update()` ou eventos acionados com frequência.** Priorize referências diretas pelo Inspector, aproveite o armazenamento em cache (Cache / Singleton), atualize para a API padrão do Unity 6 (`FindAnyObjectByType`) e proteja ferramentas utilitárias do Editor com `#if UNITY_EDITOR`. Otimizar esses pequenos detalhes ajudará seu jogo a manter 60 FPS estáveis em qualquer dispositivo!
