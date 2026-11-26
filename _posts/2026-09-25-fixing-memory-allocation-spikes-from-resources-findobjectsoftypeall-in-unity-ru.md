---
title: "Оптимизация производительности Unity: причины всплесков выделения памяти (GC Alloc) из-за Resources.FindObjectsOfTypeAll и способы их устранения"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: Подробное руководство для начинающих о том, почему злоупотребление Resources.FindObjectsOfTypeAll вызывает фризы (frame spike) в Unity, а также 4 самых точных способа оптимизации.
lang: ru
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

При разработке игр на Unity вы наверняка сталкивались с необходимостью найти какой-либо `GameObject` или `Component`. Unity предоставляет для этого множество методов, таких как `Find`, `FindObjectOfType` и особенно `Resources.FindObjectsOfTypeAll`.

Хотя `Resources.FindObjectsOfTypeAll` обладает огромной мощью, поскольку способен находить **всё** (включая выключенные объекты — inactive, префабы в папках проекта и ещё не заспавненные ресурсы), он также является одним из тихих «убийц» производительности вашей игры, если использовать его неправильно.

Эта статья поможет вам понять, почему этот метод опасен, как инструменты анализа (Profiler / Project Auditor) предупреждают о нём, и даст подробное руководство по способам оптимизации, позволяющим полностью избавиться от мусора в памяти (Garbage Collection Allocation — GC Alloc).

---

## **1. Почему `Resources.FindObjectsOfTypeAll` вредит производительности?**

Запустив Unity Memory Profiler или Project Auditor, вы можете увидеть жёлтое предупреждение (Moderate):
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

Чтобы понять причину, нужно рассмотреть, как этот метод работает под капотом движка (в C++-ядре):

1. **Полное сканирование памяти (высокая нагрузка на CPU)**: В отличие от `FindObjectOfType`, который сканирует только активные объекты в сцене, `Resources.FindObjectsOfTypeAll` сканирует **всю** память движка. Он проходит по всем объектам сцены, объектам редактора (если игра запущена в Editor) и всем ресурсам (Assets), загруженным в RAM. Чем крупнее проект, тем медленнее работает этот метод.
2. **Создание мусора в памяти (GC Allocation)**: Каждый раз по завершении работы этот метод **всегда** создаёт новый массив (`Array`) в управляемой куче C# (Managed Heap) для возврата результата.

**Последствие:** Если вы вызываете этот метод постоянно (например, в `Update()` или при каждом нажатии кнопки UI), вы непрерывно сбрасываете мусор (старые массивы) в память. Когда мусор накапливается, сборщик мусора (Garbage Collector — GC) Unity вынужден запуститься принудительно. Во время очистки игра на мгновение замирает, создавая крайне неприятный для игрока эффект **подтормаживания (stuttering)**.

---

## **2. 4 метода оптимизации (Best Practices)**

Чтобы решить эту проблему раз и навсегда, в зависимости от ситуации можно применить один из 4 проверенных способов, сформулированных инженерами по оптимизации Unity.

### **Метод 1: Прямая ссылка через Inspector (наиболее рекомендуемый)**
Самый быстрый способ, требующий 0 затрат CPU и RAM, — **вообще ничего не искать**. Вместо поиска объекта в коде объявите поле `public` или `[SerializeField]` и перетащите туда нужный объект прямо в окне Inspector в Unity.

```csharp
// ❌ ИЗБЕГАЙТЕ: Дорогостоящий поиск
void Start() {
    // Этот вызов создаёт GC Alloc
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ ЛУЧШИЙ ВАРИАНТ: Прямая ссылка
[SerializeField] private GameManager myManager; 
// (Перетащите GameManager в это поле в Unity Editor)
```

### **Метод 2: Кэширование (Caching) и Singleton**
Если вам всё же необходимо искать объект через код, **делайте это только один раз** (например, в `Awake()` или `Start()`), а затем сохраните (закэшируйте) ссылку в переменную для дальнейшего использования.

Для общих систем вроде `UIManager` или `AudioManager` используйте паттерн Singleton или статическое свойство (Static Property), чтобы получать к ним глобальный доступ без затрат на поиск.

```csharp
// ❌ ИЗБЕГАЙТЕ: Постоянный вызов поиска каждый раз, когда нужен текст
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ ЛУЧШЕ: Сохранение в статическую переменную-кэш (поиск только 1 раз)
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // Поиск 1 раз
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // Мгновенное повторное использование, 0 затрат
}
```

### **Метод 3: Переход на современные API Unity 6**
Ранее, в ранних версиях Unity 2023 при замене `FindObjectsOfType`, Unity использовала перечисление (enum) `FindObjectsSortMode`:
```csharp
// ⚠️ Устаревший вариант (Unity 2023.1 - 2023.2):
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```
Однако **начиная с Unity 6 перечисление `FindObjectsSortMode` официально помечено как устаревшее (Deprecated / Obsolete)**, поскольку движок перешёл с 32-битного `InstanceID` на новый механизм идентификации объектов и убрал сортировку для максимальной производительности.

Согласно официальной документации Unity 6, следует использовать следующие стандартизированные перегрузки:

```csharp
// ❌ Устаревший вариант (Unity 2022 и старше — медленный, принудительно сортирует массив)
var managers = FindObjectsOfType<GameManager>();

// ✅ Стандарт Unity 6: Получить 1 любой объект (Самый быстрый, Zero-Alloc)
// Не выделяет массив в куче (Heap), сразу возвращает первый найденный объект
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Стандарт Unity 6: Получить список из нескольких объектов (без устаревшего параметра SortMode)
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **Совет:** `FindAnyObjectByType<T>()` намного оптимальнее, чем `FindFirstObjectByType<T>()`, если у вас только один экземпляр объекта (например, Manager/Controller), так как он не учитывает порядок в иерархии и сразу возвращает первый найденный объект.

#### ⚠️ **Распространённое заблуждение: существует ли `Resources.FindObjectsOfTypeNonAlloc`?**
Многие разработчики привыкли к методам Unity, переиспользующим массивы (таким как `Physics.RaycastNonAlloc` или `GetComponentsNonAlloc`), и полагают, что у `Resources` тоже есть аналогичный метод `NonAlloc`.
На самом деле, согласно официальной документации Unity: **метода `Resources.FindObjectsOfTypeNonAlloc` НЕ существует вообще**. `Resources.FindObjectsOfTypeAll` **всегда** будет создавать новый массив в Managed Heap при каждом вызове.

Если вам нужно отслеживать список всех объектов в сцене и при этом **добиться абсолютного 0 GC Alloc**, используйте **паттерн статической саморегистрации (Static Registration Pattern)**:

```csharp
// ✅ Решение с Zero GC Alloc: Саморегистрация в списке при активации
public class Enemy : MonoBehaviour 
{
    // Общий статический список, переиспользующий память без новых выделений
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// В любом месте игры, где нужен доступ:
// Используйте напрямую Enemy.ActiveEnemies — в десятки раз быстрее Find и абсолютно 0 GC Alloc!
```

### **Метод 4: Оборачивайте инструменты редактора в `#if UNITY_EDITOR`**
Иногда вы скачиваете плагин из Asset Store (например, систему анимации или UI-инструмент), и в нём оказывается вызов `Resources.FindObjectsOfTypeAll`. Обычно такие методы служат только для работы удобных кнопок в среде разработки (Editor).

Чтобы не допустить попадания этих методов в финальную сборку игры (Build Player) и появления предупреждений, их можно обернуть в директиву препроцессора `#if UNITY_EDITOR`. Код внутри неё будет полностью удалён при экспорте игры.

```csharp
#if UNITY_EDITOR 
// Этот код выполняется только во время работы в Unity Editor
// При сборке в файлы .exe или .apk он будет полностью удалён
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. Практические примеры: полное устранение проблемы в игровом проекте**

Чтобы лучше понять, как применять эти подходы на практике, рассмотрим 2 самые частые ситуации, когда Unity Project Auditor или Profiler предупреждают о мусоре в памяти из-за сторонних пакетов ассетов:

### **Ситуация 1: Система UI-локализации постоянно сканирует RAM при смене языка**
* **Проблема**: Каждый раз, когда нужно отобразить текст в UI или воспроизвести звук интерфейса, вспомогательный метод вызывает `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]`. Из-за этого любое открытие меню сканирует всю оперативную память и порождает мусорный массив в куче.
* **Решение**:
  1. Использовать `FindAnyObjectByType<UIManager>()`, чтобы выполнить поиск ровно один раз при инициализации (`Awake`).
  2. Создать статическое свойство `SharedUIManager` для кэширования ссылки, превращая операцию поиска в мгновенный доступ за $O(1)$ с **0 байт мусора**.

```csharp
// ❌ ДО ОПТИМИЗАЦИИ: Сканирует всю память и создаёт мусор при каждом вызове метода
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ ПОСЛЕ ОПТИМИЗАЦИИ: Используется статический кэш (Zero GC Alloc)
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // Кэш быстрого доступа для всей игры
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // Используем API Unity 6 для однократного поиска без выделения массива
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// В любом месте, где нужно получить текст, достаточно обратиться к кэшу:
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **Ситуация 2: Сторонние утилиты редактора попадают в финальную сборку игры**
* **Проблема**: Многие пакеты инструментов (например, системы анимации или Level Design) содержат готовые функции поиска ресурсов `Resources.FindObjectsOfTypeAll` для кнопок вроде Reset или Setup в редакторе. Даже если игровой процесс их вообще не вызывает, наличие этого кода в открытом виде в runtime-сборках заставляет Unity помечать сборку игры (Player) предупреждением GC Alloc.
* **Решение**: Обернуть весь этот блок поиска директивой препроцессора `#if UNITY_EDITOR`. Когда вы соберёте игру в установочный или исполняемый файл (`.exe`, `.apk`), Unity автоматически полностью вырежет эти строки кода из runtime.

```csharp
// ❌ ДО ОПТИМИЗАЦИИ: Код поиска ресурсов для редактора открыт в Runtime
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ ПОСЛЕ ОПТИМИЗАЦИИ: Обёрнуто в директиву препроцессора #if UNITY_EDITOR
#if UNITY_EDITOR
// Этот блок кода существует только в Unity Editor и на 100% удаляется при сборке игры
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **Заключение**

Для тех, кто только начинает работать с Unity, «мусор в памяти» (GC Allocation) кажется довольно абстрактным понятием, поскольку C# выполняет очистку автоматически. Однако в разработке игр постоянное создание мусора приводит к вполне ощутимым подтормаживаниям на экране.

Золотое правило: **держитесь подальше от семейства методов `Find` (особенно `Resources.FindObjectsOfTypeAll`) внутри циклов вроде `Update()` или часто вызываемых событий.** Отдавайте приоритет ссылкам через Inspector, используйте кэширование (Cache / Singleton), обновитесь до стандартного API Unity 6 (`FindAnyObjectByType`) и оборачивайте вспомогательные инструменты редактора в `#if UNITY_EDITOR`. Оптимизация таких мелких деталей поможет вашей игре стабильно держать 60 FPS на любых устройствах!
