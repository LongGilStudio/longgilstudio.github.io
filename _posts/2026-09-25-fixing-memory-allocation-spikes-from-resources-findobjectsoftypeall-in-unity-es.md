---
title: "Optimización de Rendimiento en Unity: Comprender y Solucionar los Picos de Asignación de Memoria (GC Alloc) de Resources.FindObjectsOfTypeAll"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: Guía detallada para principiantes sobre por qué el uso excesivo de Resources.FindObjectsOfTypeAll provoca tirones (frame spikes) en Unity y los 4 mejores métodos de optimización.
lang: es
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

Durante el desarrollo de videojuegos con Unity, seguro que alguna vez te has encontrado en la situación de tener que buscar un `GameObject` o un `Component` concreto. Unity ofrece numerosas funciones para ello, como `Find`, `FindObjectOfType` y, en especial, `Resources.FindObjectsOfTypeAll`.

Aunque `Resources.FindObjectsOfTypeAll` es extremadamente potente porque puede encontrar **absolutamente todo** (incluidos objetos desactivados —inactive—, prefabs en las carpetas del proyecto o recursos que aún no se han instanciado), también es uno de los «asesinos» silenciosos del rendimiento de tu juego si no se utiliza correctamente.

Este artículo te ayudará a entender por qué esta función es tan peligrosa, cómo la señalan las herramientas de análisis (Profiler / Project Auditor) y te guiará paso a paso por los métodos de optimización más efectivos para eliminar por completo la basura de memoria (Garbage Collection Allocation - GC Alloc).

---

## **1. ¿Por Qué `Resources.FindObjectsOfTypeAll` Perjudica el Rendimiento?**

Cuando ejecutas Unity Memory Profiler o Project Auditor, es posible que te encuentres con una advertencia amarilla (Moderate):
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

Para comprender el motivo, debemos fijarnos en cómo funciona este método por debajo, dentro del núcleo del motor (C++ core):

1. **Escaneo Completo de Memoria (Alto Coste de CPU)**: A diferencia de `FindObjectOfType`, que solo recorre los objetos activos en la escena (Scene), `Resources.FindObjectsOfTypeAll` escanea **toda** la memoria del motor. Recorre todos los objetos de la escena, los objetos del Editor (si estás trabajando en el Editor) y todos los recursos (Assets) cargados en la RAM. Cuanto más grande sea tu proyecto, más lento se ejecutará este método.
2. **Generación de Basura en Memoria (GC Allocation)**: Cada vez que termina de ejecutarse, este método **siempre** crea un nuevo array (`Array`) en el Managed Heap de C# para almacenar los resultados devueltos.

**Consecuencia:** Si llamas a esta función de forma repetida (por ejemplo, dentro de `Update()` o cada vez que se pulsa un botón de la UI), estás arrojando basura (arrays descartados) continuamente a la memoria. Cuando esa basura se acumula, el recolector de basura (Garbage Collector - GC) de Unity se ve obligado a activarse. Este proceso de limpieza congela el juego durante un instante, provocando molestos **tirones (stuttering)** para el jugador.

---

## **2. Los 4 Métodos de Optimización (Buenas Prácticas)**

Para resolver este problema de raíz, según el caso concreto, puedes aplicar uno de los siguientes 4 métodos contrastados por los ingenieros de optimización de Unity.

### **Método 1: Referencia directa a través del Inspector (El más recomendado)**
La forma más rápida y con 0 coste de CPU/RAM es **no buscar nada en tiempo de ejecución**. En lugar de usar código para localizar un objeto, declara una variable `public` o `[SerializeField]` y arrastra y suelta el objeto directamente desde el Inspector de Unity.

```csharp
// ❌ EVITAR: Búsqueda costosa
void Start() {
    // Esta llamada generará GC Alloc
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ LO MEJOR: Referencia directa
[SerializeField] private GameManager myManager; 
// (Arrastra y suelta GameManager en esta casilla en el Editor de Unity)
```

### **Método 2: Caching (Almacenamiento en caché) y Singleton**
Si no te queda más remedio que buscar mediante código, **haz la búsqueda una única vez** (por ejemplo, en `Awake()` o `Start()`) y guarda la referencia en caché dentro de una variable para reutilizarla en las siguientes llamadas.

Para sistemas compartidos como `UIManager` o `AudioManager`, emplea el patrón Singleton o una propiedad estática para acceder de forma global sin ningún coste de búsqueda.

```csharp
// ❌ EVITAR: Llamar a la función de búsqueda cada vez que se necesita un texto
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ MEJOR: Guardar en caché en una variable estática (buscar solo 1 vez)
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // Buscar 1 sola vez
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // Reutilización inmediata, coste 0
}
```

### **Método 3: Actualizar a las API modernas de Unity 6**
Anteriormente, en las primeras versiones de Unity 2023 al sustituir `FindObjectsOfType`, Unity utilizaba el enum `FindObjectsSortMode`:

```csharp
// ⚠️ Antiguo (Unity 2023.1 - 2023.2):
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```
Sin embargo, **a partir de Unity 6, el enum `FindObjectsSortMode` ha sido marcado oficialmente como obsoleto (Deprecated / Obsolete)** debido a que el motor pasó del `InstanceID` de 32 bits a un nuevo mecanismo de identificación de objetos y eliminó la ordenación para maximizar el rendimiento.

Según la documentación oficial de Unity 6, debes utilizar las siguientes sobrecargas estandarizadas:

```csharp
// ❌ Antiguo (Unity 2022 y anteriores - Lento, fuerza la ordenación del array)
var managers = FindObjectsOfType<GameManager>();

// ✅ Estándar de Unity 6: Obtener 1 objeto cualquiera (El más rápido, Zero-Alloc)
// No asigna ningún array en el Heap; devuelve de inmediato el primer objeto encontrado
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Estándar de Unity 6: Obtener una lista de varios objetos (Sin el parámetro SortMode obsoleto)
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **Consejo:** `FindAnyObjectByType<T>()` es mucho más óptimo que `FindFirstObjectByType<T>()` si solo tienes 1 instancia (como un Manager o Controller), ya que no le importa el orden en la jerarquía y devuelve al instante el primer objeto que encuentra.

#### ⚠️ **Error común: ¿Existe `Resources.FindObjectsOfTypeNonAlloc`?**
Muchos desarrolladores están acostumbrados a los métodos de Unity que reutilizan arrays (como `Physics.RaycastNonAlloc` o `GetComponentsNonAlloc`) y suponen que `Resources` también cuenta con una función `NonAlloc` equivalente.
En realidad, según la documentación oficial de Unity: **NO existe en absoluto ningún método `Resources.FindObjectsOfTypeNonAlloc`**. `Resources.FindObjectsOfTypeAll` **siempre** creará un nuevo array en el Managed Heap cada vez que sea invocado.

Si necesitas mantener un listado de todos los objetos de la escena logrando **0 GC Alloc absoluto**, recurre a la técnica de **autorregistro (Static Registration Pattern)**:

```csharp
// ✅ Solución Zero GC Alloc: Autorregistro en una lista al activarse
public class Enemy : MonoBehaviour 
{
    // Lista estática compartida que reutiliza memoria sin nuevas asignaciones
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// En cualquier lugar del juego donde necesites acceder:
// Usa directamente Enemy.ActiveEnemies — Decenas de veces más rápido que Find y con 0 GC Alloc absoluto.
```

### **Método 4: Envolver el código con `#if UNITY_EDITOR` para herramientas del Editor**
A veces descargas un plugin de la Asset Store (por ejemplo, un sistema de animaciones o una herramienta de UI) que contiene `Resources.FindObjectsOfTypeAll`. Por lo general, estas llamadas solo sirven para botones de utilidad dentro del entorno de desarrollo (Editor).

Para evitar que estas funciones se «cuelen» en la compilación final del juego (Build Player) y disparen advertencias, puedes envolverlas con la directiva de preprocesador `#if UNITY_EDITOR`. El código interior se eliminará por completo al exportar el juego.

```csharp
#if UNITY_EDITOR 
// Este bloque solo se ejecuta mientras trabajas en el Editor de Unity
// Se eliminará por completo al compilar a .exe o .apk
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. Casos Prácticos: Solución Integral en un Proyecto Real**

Para entender cómo aplicarlo en la práctica, veamos los 2 escenarios más frecuentes en los que Unity Project Auditor o el Profiler advierten de basura en memoria procedente de paquetes de terceros:

### **Escenario 1: Sistema de localización de UI que escanea la RAM cada vez que cambia el idioma**
* **Problema**: Cada vez que hay que mostrar un texto en la UI o reproducir un sonido de interfaz, una función auxiliar llama a `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]`. Esto hace que cada interacción al abrir un menú escanee toda la RAM y genere un array basura en el Heap.
* **Solución**:
  1. Utilizar `FindAnyObjectByType<UIManager>()` para buscar una sola vez al inicializar (`Awake`).
  2. Crear una propiedad estática `SharedUIManager` para almacenar la referencia en caché, convirtiendo la búsqueda en un acceso instantáneo $O(1)$ con **0 bytes de basura**.

```csharp
// ❌ ANTES DE OPTIMIZAR: Escanea toda la memoria y genera basura en cada llamada
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ DESPUÉS DE OPTIMIZAR: Aprovecha la caché estática (Zero GC Alloc)
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // Caché de acceso rápido para todo el juego
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // Usa la API de Unity 6 para buscar una sola vez sin asignar arrays
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// En cualquier punto donde se necesite texto, basta con leer de la caché:
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **Escenario 2: Utilidades de Editor de terceros que se filtran en la Build del juego**
* **Problema**: Muchos paquetes de herramientas (como sistemas de animación o diseño de niveles) incluyen funciones de búsqueda de recursos con `Resources.FindObjectsOfTypeAll` para los botones de Reset o Setup en el Editor. Aunque la lógica del juego nunca las llame, dejar ese código expuesto en los ensamblados de tiempo de ejecución hace que Unity marque la Build del juego (Player) con advertencias de GC Alloc.
* **Solución**: Envolver todo ese bloque de búsqueda con la directiva de preprocesador `#if UNITY_EDITOR`. Cuando compiles el juego en un archivo ejecutable (`.exe`, `.apk`), Unity descartará automáticamente estas líneas del tiempo de ejecución.

```csharp
// ❌ ANTES DE OPTIMIZAR: Código de búsqueda de recursos del Editor expuesto en Runtime
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ DESPUÉS DE OPTIMIZAR: Envuelto con la directiva de preprocesador #if UNITY_EDITOR
#if UNITY_EDITOR
// Este bloque solo existe en el Editor de Unity y se elimina al 100 % al compilar el juego
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **Conclusión**

Para quienes empiezan con Unity, la «basura de memoria» (GC Allocation) resulta un concepto bastante abstracto porque C# realiza la limpieza de forma automática. Sin embargo, en programación de videojuegos, generar basura de forma continua se traduce directamente en tirones visibles en pantalla.

La regla de oro: **Mantente alejado de la familia de métodos `Find` (especialmente `Resources.FindObjectsOfTypeAll`) dentro de bucles como `Update()` o eventos que se ejecuten con frecuencia.** Prioriza las referencias directas mediante el Inspector, aprovecha el almacenamiento en caché (Cache / Singleton), actualiza a la API estándar de Unity 6 (`FindAnyObjectByType`) y protege las herramientas de utilidad del Editor con `#if UNITY_EDITOR`. Optimizar estos pequeños detalles ayudará a que tu juego mantenga unos 60 FPS estables en cualquier dispositivo.
