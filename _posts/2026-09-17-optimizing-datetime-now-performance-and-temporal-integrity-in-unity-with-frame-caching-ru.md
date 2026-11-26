---
title: "Оптимизация производительности и целостности временных данных в Unity Engine: системные механизмы, анализ узких мест DateTime.Now и решение Frame Caching"
date: 2026-09-17 03:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, datetime, csharp, dotnet, frame-caching, multithreading, anticheat]
description: Глубокий анализ внутренних механизмов DateTime.Now и DateTime.UtcNow в среде выполнения .NET, количественная оценка узких мест производительности, явление временного разрыва (temporal tearing) и потокобезопасное архитектурное решение Frame Caching в Unity Engine.
lang: ru
translation_id: unity-datetime-now-frame-caching
math: true
---

Получение и обработка данных реального времени являются одними из базовых, но при этом сопряжённых со множеством архитектурных рисков задач в приложениях реального времени на базе Unity Engine[^1]. Хотя структура `System.DateTime` из базовой библиотеки классов .NET (BCL) предоставляет исчерпывающий набор инструментов для работы с календарём и временем, прямое обращение к свойству `System.DateTime.Now` в циклах постоянного обновления (hot paths) создаёт серьёзные узкие места производительности и нарушает целостность состояния[^2].

В данном отчёте подробно рассматриваются внутренние механизмы на уровне операционной системы и среды выполнения (.NET/Mono/IL2CPP), даётся количественная оценка вычислительных затрат на основе данных профилирования, анализируется явление временного разрыва (*temporal tearing*), а также проводится всесторонняя оценка решения покадрового кэширования (*Frame Caching*) и смежных архитектурных стандартов[^2].

---

## **1. Внутренние механизмы DateTime.Now и DateTime.UtcNow в .NET Runtime**

Структура `System.DateTime` хранится в виде одного 64-битного поля значения (`UInt64 _dateData`)[^6]. В этой структуре:
- **Младшие 62 бита** представляют количество тиков (Ticks), накопленных с момента 00:00:00 1 января 0001 года по григорианскому календарю, где каждый тик соответствует $100\text{ ns}$ ($10^{-7}\text{ s}$ или $0.1\ \mu\text{s}$)[^1].
- **Старшие 2 бита** зарезервированы для хранения флагов `DateTimeKind`, позволяющих определить одно из трёх контекстных состояний: `Utc`, `Local` или `Unspecified`[^1].

### **Низкоуровневый поток выполнения DateTime.UtcNow**

Свойство `DateTime.UtcNow` представляет всемирное координированное время и спроектировано для максимальной оптимизации по циклам процессора[^2]. Когда процесс вызывает `DateTime.UtcNow`, среда выполнения .NET выполняет прямое чтение из аппаратного таймера системы[^2]:

- В операционной системе **Windows** код напрямую вызывает функцию Win32 API `GetSystemTimeAsFileTime` через внутренний указатель на функцию, помеченный атрибутом обхода барьеров оптимизации компиляции (`TargetedPatchingOptOut`)[^2].
- В операционных системах семейства **POSIX** (включая ядро Linux на Android и ядро Darwin на iOS/macOS) система выполняет низкоуровневый вызов `clock_gettime(CLOCK_REALTIME, ...)`[^5].

К необработанному значению времени, возвращённому операционной системой, достаточно прибавить фиксированную константу смещения для синхронизации с началом отсчёта григорианского календаря, после чего оно напрямую упаковывается в структуру `DateTime` с меткой `DateTimeKind.Utc`[^2]. Этот процесс не требует разрешения каких-либо таблиц поиска, не выделяет память в куче и завершается за несколько наносекунд[^2].

### **Сложный поток разрешения DateTime.Now**

В отличие от `DateTime.UtcNow`, определение локального времени (`DateTime.Now`) требует цепочки сложных операций преобразования[^2]. Свойство `DateTime.Now` не считывает независимые локальные часы с аппаратного обеспечения; вместо этого оно полностью строится на базе результата `DateTime.UtcNow` в сочетании с последовательностью вычислений смещения часового пояса[^2]:

```csharp
public static DateTime Now 
{
    get 
    {
        DateTime utcNow = UtcNow;
        bool isAmbiguousDst = false;
        long offset = TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc(utcNow, out isAmbiguousDst).Ticks;
        long ticks = utcNow.Ticks + offset;
        
        if (ticks > DateTime.MaxValue.Ticks)
            return new DateTime(DateTime.MaxValue.Ticks, DateTimeKind.Local);
        if (ticks < DateTime.MinValue.Ticks)
            return new DateTime(DateTime.MinValue.Ticks, DateTimeKind.Local);
            
        return new DateTime(ticks, DateTimeKind.Local);
    }
}
```

Этот процесс начинается с получения текущего времени UTC, после чего выполняется запрос к объекту `TimeZoneInfo.Local` для определения конфигурации часового пояса устройства[^2]. Основной источник потребления ресурсов находится в функции `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc`, где среда выполнения должна сопоставить текущую временную метку с таблицей правил корректировки часовых поясов (*Adjustment Rules*) и правилами перехода на летнее время (*Daylight Saving Time — DST*), чтобы определить, попадает ли текущий момент в период добавления одного часа[^2].

После точного определения смещения в тиках система выполняет арифметическое сложение с `utcNow.Ticks`, проверяет условия выхода за пределы допустимого диапазона значений и инициализирует новую структуру `DateTime` с меткой `DateTimeKind.Local`[^2].

Данные профилирования производительности из официального репозитория исходного кода .NET Runtime приводят детальное распределение времени выполнения метода `DateTime.get_Now()`[^4]:

| Компонент выполнения в `System.DateTime.get_Now()` | Доля совокупного времени (Inclusive %) | Техническая природа операции |
| :--- | :---: | :--- |
| `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc` | **88.1%** | Поиск правил преобразования часового пояса, проверка флага DST, вычисление смещения[^4] |
| `System.DateTime.get_UtcNow()` | **5.8%** | Системный вызов (Syscall) чтения аппаратного счётчика[^2] |
| Проверка границ и упаковка структуры | **6.1%** | Проверка переполнения 64-битного целого числа и присвоение метки `DateTimeKind.Local`[^4][^7] |

> [!IMPORTANT]
> Приведённые данные доказывают, что само чтение времени из аппаратных часов занимает лишь **~5.8%** от общих затрат на выполнение, в то время как до **~88.1%** процессорного времени тратится на разрешение часового пояса и вычисление правил летнего времени[^4].

### **Повышенная сложность на мобильных платформах (Mono & IL2CPP)**

На мобильных платформах, где Unity работает через Mono или IL2CPP, сложность `DateTime.Now` возрастает многократно[^5]. В то время как Windows хранит информацию о часовых поясах в централизованном реестре (Registry), мобильные операционные системы, такие как Android, хранят эти данные в двоичной базе данных `tzdata` (`ZoneInfoDB`), распределённой по системным каталогам, таким как `/apex/com.android.tzdata/` или `/system/usr/share/zoneinfo`[^5].

При первой инициализации `TimeZoneInfo.Local` или при необходимости повторной проверки среда выполнения Mono/IL2CPP вынуждена выполнять операции файлового ввода-вывода, синтаксический разбор двоичных данных или даже межсредовые вызовы через Java Native Interface (JNI) к классу `java.util.TimeZone` для получения идентификатора часового пояса[^5].

> [!WARNING]
> Если файл базы данных часовых поясов повреждён, перемещён в кастомных прошивках или права доступа к нему ограничены, вызов `DateTime.Now` может выбросить критическое исключение `System.TimeZoneNotFoundException`, что приведёт к внезапному аварийному завершению приложения, если вызов не обёрнут в блоки обработки исключений[^10].

---

## **2. Анализ бенчмаркинга производительности и влияния на бюджет кадра**

Стоимость выполнения методов получения времени существенно различается в зависимости от нижележащей архитектуры и состояния кэша операционной системы[^5]. В таблице ниже сведены нормализованные результаты измерения производительности наиболее распространённых механизмов времени в среде Unity и .NET[^4]:

| Метод получения времени | Оценочное время выполнения | Относительное соотношение скорости | Базовый механизм выполнения | Риск скачка времени кадра (Frame Spike) |
| :--- | :---: | :---: | :--- | :--- |
| `UnityEngine.Time.time` | $\sim 1\text{ - }2\text{ ns}$ | Наиболее быстрый (нативный в движке) | Прямое чтение переменной с плавающей запятой, кэшированной в начале кадра | Полностью отсутствует |
| `System.DateTime.UtcNow` | $\sim 15\text{ - }20\text{ ns}$ | Быстрее `Now` в $\sim 15\text{ - }20\times$ раз | Прямое чтение аппаратных часов через минимальный системный вызов[^2] | Незначительный |
| `System.DateTime.Now` (Warm Path) | $\sim 280\text{ - }350\text{ ns}$ | Базовый эталон сравнения ($1\times$) | Вызов UtcNow, обращение к кэшу часового пояса, вычисление смещения DST[^2] | От среднего до высокого при повторных вызовах |
| `System.DateTime.Now` (Cold Path / Мобильные) | $\sim 1\text{ - }5\text{ ms}$ | Медленнее в тысячи раз ($\gt 3.000\times$) | Инициализация таблиц AndroidTzData, дисковый ввод-вывод, разбор бинарных данных[^5] | Очень высокий (зависание кадра) |

### **Ограничения бюджета кадра в игровом цикле**

В интерактивных приложениях реального времени вся рабочая нагрузка—включая симуляцию механики движения, физические расчёты, обработку игровой логики и отправку команд отрисовки на GPU—должна завершаться в течение конечного интервала времени, определяемого формулой:

$$
T_{\text{frame}} = \frac{1000\text{ ms}}{\text{Target FPS}}
$$

- При стандартной частоте обновления **$60\text{ Hz}$** ($60\text{ FPS}$) бюджет на один кадр составляет **$16.67\text{ ms}$**.
- Это значение сокращается всего до **$8.33\text{ ms}$** для экранов с высокой частотой обновления **$120\text{ Hz}$** ($120\text{ FPS}$).

Архитектура исходного кода с множеством разбросанных вызовов `DateTime.Now` внутри циклов обновления сущностей—таких как системы обратного отсчёта перезарядки умений для десятков неигровых персонажей (NPC), системы проверки длительности эффектов или логика проверки событий по реальному времени—накапливает от сотен до тысяч системных вызовов в каждом кадре.

При **500 «тёплых» вызовах `DateTime.Now`** за кадр система тратит около **$\sim 0.15\text{ ms}$** ($150\,\mu\text{s}$) только на вычисления смещения часового пояса, расходуя до **$\sim 1.8\%$** всего бюджета времени кадра при **$120\text{ Hz}$**. Эти затраты напрямую вызывают падение частоты кадров и локальные подтормаживания, что объясняет, почему инструмент статического анализа Unity Project Auditor помечает использование `DateTime.Now` в горячих путях обновления красным предупреждением высокой критичности (*Major Issue*)[^3].

---

## **3. Явление временного разрыва (Temporal Tearing) и ошибки целостности данных**

Помимо деградации производительности CPU, рассредоточение вызовов `DateTime.Now` для извлечения отдельных компонентов временной метки приводит к серьёзному дефекту атомарности данных (*Data Atomicity*). Исходный код сталкивается с этой уязвимостью при выполнении независимых сравнений:

```csharp
if (requirement.CheckYear)   results.Add(DateTime.Now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(DateTime.Now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(DateTime.Now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(DateTime.Now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(DateTime.Now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(DateTime.Now.Second == requirement.Second);
```

### **Механизм возникновения аномального гибридного состояния**

По своей природе свойство `DateTime.Now` является вызовом метода, формирующим состояние, зависящее от объективного времени в момент вызова, а не статическим полем данных[^20]. Каждый раз, когда код обращается к подсвойству вроде `.Year`, `.Month` или `.Day`, система запускает совершенно новый цикл запроса к операционной системе[^2].

Хотя промежуток времени между последовательными строками кода составляет всего несколько микросекунд, выполнение потока может быть прервано механизмом многозадачного планирования времени операционной системы, либо момент выполнения может случайно совпасть с границей естественного перехода системных часов[^8].

> [!CAUTION]
> **Сценарий граничного сбоя (Boundary Edge-Case):**  
> Предположим, поток выполняет строку проверки месяца ровно в `23:59:59.999` 31 августа 2024 года. Свойство `DateTime.Now.Month` вычисляется на основе этой временной метки и возвращает значение **август (8)**.  
>  
> Сразу после завершения этой инструкции и до выполнения следующей проверки дня системные часы переходят на `00:00:00.000` 1 сентября 2024 года. Когда срабатывает строка `DateTime.Now.Day`, операционная система возвращает новую временную метку, и это свойство даёт значение **1-е число**.  
>  
> В результате игровая логика фиксирует гибридное состояние: **1 августа**—момент времени, которого вообще не существовало в ходе физического времени!

Если эта искажённая временная метка используется для запуска ограниченных по времени событий, проверки регулярного входа за наградой или записи транзакций в игре, подобное расхождение может нарушить логику проверки условий, вызвать непреднамеренную блокировку функций или позволить игрокам получать награды повторно.

---

## **4. Техническая оценка решения Frame Caching**

Для полного устранения избыточных вычислительных затрат и радикального предотвращения временного разрыва оптимальным решением является внедрение модели покадрового кэширования (*Frame Caching / Per-frame Memoization*), использующей счётчик кадров Unity Engine (`UnityEngine.Time.frameCount`) в качестве ключа валидации актуальности данных[^22].

### **Анализ потока работы буфера кадрового кэша**

Исходный код реализации механизма кэширования устроен следующим образом:

```csharp
private static DateTime _cachedSystemTime;  
private static int _lastSystemTimeFrame = -1;

private static DateTime GetCurrentSystemTime()  
{  
    if (Application.isPlaying)  
    {  
        int currentFrame = Time.frameCount;  
        if (_lastSystemTimeFrame != currentFrame)  
        {  
            _lastSystemTimeFrame = currentFrame;  
            _cachedSystemTime = DateTime.Now;  
        }  
        return _cachedSystemTime;  
    }  
    return DateTime.Now;  
}
```

Когда логике проверки времени требуется запрос, временная метка извлекается один раз в локальную переменную для использования на протяжении всех проверок:

```csharp
DateTime now = GetCurrentSystemTime();  
if (requirement.CheckYear)   results.Add(now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(now.Second == requirement.Second);
```

Этот механизм обеспечивает два решающих улучшения:

1. **Снижение вычислительной сложности:** Сложность уменьшается с линейного уровня $\mathcal{O}(N)$, зависящего от количества сущностей, до константного уровня $\mathcal{O}(1)$ для каждого отображаемого кадра. Все последующие запросы, возникающие после первого вызова в пределах того же кадра, лишь напрямую считывают 64-битную структуру `DateTime`, сохранённую в статической памяти, полностью устраняя затраты на обращение к операционной системе и расчёт часовых поясов[^2].
2. **Сохранение атомарности снимка времени (*Snapshot Atomicity*):** Переменная `now` выступает в роли неизменяемого среза времени для всего кадра, гарантируя, что все составляющие свойства от года до секунды согласованы между собой и не могут быть разделены системными прерываниями.

### **Анализ граничных ограничений и рисков при реальном внедрении**

Хотя решение покадрового кэширования полностью устраняет проблему в основном потоке выполнения Unity, его применение в крупных программных архитектурах требует тщательного учёта трёх важных технических ограничений:

1. **Привязка к главному потоку (Main Thread Affinity):** Свойство `UnityEngine.Time.frameCount` является API внутреннего уровня C++ движка и жёстко привязано к главному потоку[^24]. Если фоновый процесс—например, поток фоновых задач (`Task.Run`), асинхронный сетевой процесс или задача системы C# Job System—вызовет метод `GetCurrentSystemTime()`, Unity немедленно выбросит исключение `UnityException: get_frameCount can only be called from the main thread` и прервёт поток выполнения[^24].
2. **Рассинхронизация ритма между Update и FixedUpdate:** Жизненный цикл выполнения Unity содержит два независимых ритма обновления: цикл графической отрисовки (`Update`) и цикл физической симуляции с фиксированным шагом (`FixedUpdate`)[^25]. Значение `Time.frameCount` увеличивается движком на единицу только при переходе к новому кадру отрисовки[^22]. В случае падения частоты кадров на клиенте движок может быть вынужден запустить несколько циклов `FixedUpdate` подряд в пределах одного кадра отрисовки, чтобы наверстать физическую симуляцию[^23]. При этом каждый цикл `FixedUpdate`, происходящий в рамках одного цикла отрисовки, будет считывать одно и то же кэшированное значение времени `_cachedSystemTime`, что может не отражать смещение времени между последовательными шагами физической симуляции[^26].
3. **Риск гонки данных (Data Race):** Обращение к глобальным статическим переменным `_cachedSystemTime` и `_lastSystemTimeFrame` без механизмов синхронизации памяти (*Memory Barriers*) или блокировок разграничения доступа приведёт к риску конфликта данных при одновременном чтении или записи из побочных потоков на многоядерных процессорных архитектурах с внеочередным выполнением инструкций (*out-of-order execution*).

### **Реализация потокобезопасного (Thread-Safe) поставщика системного времени**

Чтобы преодолеть все перечисленные технические ограничения, система работы со временем должна быть стандартизирована в виде специализированного сервиса, способного распознавать контекст выполнения потока, обеспечивать безопасность доступа и автоматически обрабатывать граничные исключения:

```csharp
using System;  
using System.Threading;  
using UnityEngine;

public static class SystemTimeProvider  
{  
    private static DateTime _mainThreadCachedTime;  
    private static int _lastFrameCount = -1;  
    private static int _mainThreadId;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]  
    private static void Initialize()  
    {  
        _mainThreadId = Thread.CurrentThread.ManagedThreadId;  
        _lastFrameCount = -1;  
    }

    public static DateTime CurrentLocalTime  
    {  
        get  
        {  
            if (Application.isPlaying && Thread.CurrentThread.ManagedThreadId == _mainThreadId)  
            {  
                int currentFrame = Time.frameCount;  
                if (_lastFrameCount != currentFrame)  
                {  
                    _lastFrameCount = currentFrame;  
                    _mainThreadCachedTime = DateTime.Now;  
                }  
                return _mainThreadCachedTime;  
            }

            return DateTime.Now;  
        }  
    }

    public static DateTime CurrentUtcTime => DateTime.UtcNow;  
}
```

Эта архитектура гарантирует, что главный поток всегда использует преимущества покадрового кэширования без опасения повторных вычислительных затрат, в то время как фоновые потоки или режим редактирования в Editor сохраняют стабильную работу благодаря механизму прямого отката (fallback), полностью предотвращая риск выброса исключений нарушения прав доступа к потокам движка[^24].

---

## **5. Стандарты разделения временных доменов в архитектуре игровых движков**

Распространённой ошибкой при разработке игр является смешивание различных целей использования времени в одном системном API[^2]. Для поддержания максимальной производительности и согласованности состояния игры архитектура системы должна чётко разграничивать независимые временные домены:

| Временной домен (Time Domain) | Рекомендуемый стандартный API | Основные сценарии использования | Риски при использовании неверного API |
| :--- | :--- | :--- | :--- |
| **Внутренняя симуляция геймплея** | `UnityEngine.Time.time`, `Time.deltaTime` | Расчёт физических координат, движение персонажей, время перезарядки умений | Замирает при паузе игры (`timeScale = 0`); теряет точность, если требуется реальное время[^26] |
| **Отображение интерфейса в реальном времени** | `UnityEngine.Time.unscaledTime`, `Time.realtimeSinceStartup` | Анимации меню интерфейса (UI), эффекты переходов во время паузы игры | Жёстко привязан к сеансу процесса клиента, невозможно отобразить в реальный календарь |
| **Измерение производительности алгоритмов** | `System.Diagnostics.Stopwatch` | Измерение времени работы алгоритмов, профилирование блоков кода, выявление утечек производительности[^7] | Разрешение `DateTime.Now` достигает лишь $\sim 15.6\text{ ms}$, чувствительность недостаточна для бенчмарков[^7] |
| **Проверка логики античита** | Метка Unix Epoch (UTC), синхронизированная с сервером[^28] | Система энергии, время открытия сундуков с сокровищами, ограничения онлайн-событий[^28] | При доверии часам клиента игрок может перевести время ОС для нечестного получения предметов[^28] |
| **Отображение локального календаря** | `SystemTimeProvider.CurrentLocalTime` | Отображение реального времени пользователя на панели состояния UI[^2] | Вызывает рывки и просадки кадров при непрерывном вызове исходного `DateTime.Now` без кэша[^2] |

### **Механизм синхронизации серверного времени и защита от читерства (Anti-Cheat)**

Для игр с сетевыми функциями разрешение клиенту самостоятельно валидировать временную метку совершения действия на основе локального `DateTime.Now` или `DateTime.UtcNow` создаёт серьёзную уязвимость безопасности[^28]. Пользователи могут легко изменить настройки часов операционной системы, чтобы ускорить таймеры постройки или сбросить счётчики ежедневных попыток[^28].

Стандартизированная архитектура для нейтрализации этого вида мошенничества требует от клиента построения виртуальной временной базы на основе монотонных часов (*monotonic clock*)[^5]:

1. **Отправка запроса синхронизации:** При установлении сетевого соединения клиент отправляет запрос синхронизации времени на сервер сервиса для получения эталонной метки времени Unix Epoch по стандарту UTC[^28].
2. **Измерение круговой задержки (Round-Trip):** Клиент фиксирует время кругового обхода пакета ($RTT$) и оценивает эталонное серверное время в момент прибытия ответа по формуле:
   $$T_{\text{server}} = T_{\text{server\_reply}} + \frac{RTT}{2}$$
3. **Определение монотонного смещения:** Клиент вычисляет и сохраняет фиксированную разницу относительно аппаратного монотонного счётчика:
   $$\Delta t = T_{\text{server}} - \text{Time.realtimeSinceStartupAsDouble}$$
4. **Получение защищённого от читов времени:** На протяжении всего жизненного цикла приложения любая игровая логика, проверяющая реальное время, просто берёт значение:
   $$\text{CurrentRealTime} = \text{Time.realtimeSinceStartupAsDouble} + \Delta t$$
   Поскольку таймер запуска движка использует аппаратный механизм монотонного счёта (`clock_gettime(CLOCK_MONOTONIC)` или `QueryPerformanceCounter`), это значение растёт строго линейно и непрерывно и обладает полным иммунитетом к любым манипуляциям с календарными часами операционной системы[^5].

### **Переход на современную архитектуру с TimeProvider (.NET 8+)**

Начиная с версии .NET 8, компания Microsoft официально реструктурировала всю модель управления временем, представив абстрактный класс `System.TimeProvider` для полной замены прямых статических вызовов вроде `DateTime.Now` или `DateTime.UtcNow`[^20]. В современных проектах Unity с помощью пакета совместимости `Microsoft.Bcl.TimeProvider` разработчики могут внедрять эту архитектуру для повышения модульности исходного кода[^32]:

```csharp
public sealed class GameTimeService  
{  
    private readonly TimeProvider _timeProvider;

    public GameTimeService(TimeProvider timeProvider = null)  
    {  
        _timeProvider = timeProvider ?? TimeProvider.System;  
    }

    public DateTimeOffset GetCurrentTime() => _timeProvider.GetLocalNow();  
}
```

Переход к этой модели абстракции даёт два крупных технических преимущества:

> [!TIP]
> 1. **Изолированное модульное тестирование (Unit Testing):** Позволяет в полной мере применять модель модульного тестирования[^20]. Инженеры могут внедрять в бизнес-логику объект-заглушку `FakeTimeProvider` для точного моделирования тестовых сценариев с перескоком через сложные временные границы (например, проверка момента перехода часовых поясов DST или смены года) без необходимости ждать реального времени или вмешиваться в работу системы[^20].  
> 2. **Безопасный тип данных DateTimeOffset:** Метод `GetLocalNow()` возвращает структуру `DateTimeOffset` вместо `DateTime`[^20]. Структура `DateTimeOffset` жёстко хранит временную метку вместе с явным смещением часового пояса (*offset*), полностью исключая неоднозначные состояния флага `DateTimeKind.Unspecified` и гарантируя целостность при сериализации данных для передачи по сети[^1].

---

## **5. Практическое внедрение: оптимизация системы RequirementsManager (Case Study)**

В рамках реального проекта, использующего фреймворк RPG Builder (проект GLW), в классе `RequirementsManager.cs` была обнаружена серьёзная проблема производительности. В частности, система проверки временных условий игры (например, требование, чтобы событие происходило в определённый месяц, день, час) постоянно разрозненно вызывала `DateTime.Now` по нескольку раз:

```csharp
if(requirement.CheckYear) results.Add(DateTime.Now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(DateTime.Now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(DateTime.Now.Day == requirement.Day);
// ... Повторяется для Hour, Minute, Second
```

**Проблемы, возникшие из-за старого кода:**
1. **Огромные накладные расходы CPU:** Для проверки 1 требования система могла инициировать до 7–10 вызовов `DateTime.Now` (в том числе во вспомогательных функциях вроде `GetWeekNumber()`). Если 100 сущностей выполняли проверку одновременно, в каждом кадре происходили тысячи системных вызовов к ОС, вызывая серьёзное узкое место (bottleneck).
2. **Temporal Tearing (расхождение момента времени):** Если момент перехода между секундами (или минутами, днями) попадал ровно в середину процесса чтения указанных инструкций (например, на 999-й миллисекунде), переменная `Month` могла быть взята из старого месяца, а переменная `Day`—уже из нового дня. В результате игра склеивала временную метку, которой вообще не существует в реальности.

**Внедрённое на практике решение (Per-Frame Caching):**
Архитектура Frame Caching была интегрирована напрямую с использованием `Time.frameCount` в качестве флага истечения срока действия кэша (cache invalidation). Такой подход использует статический жизненный цикл вместо цикла Update:

```csharp
private static DateTime _cachedSystemTime;
private static int _lastSystemTimeFrame = -1;

private static DateTime GetCurrentSystemTime()
{
    if (Application.isPlaying) 
    {
        int currentFrame = Time.frameCount;
        
        // Получаем реальное время от ОС только 1 раз за кадр
        if (_lastSystemTimeFrame != currentFrame)
        {
            _lastSystemTimeFrame = currentFrame;
            _cachedSystemTime = DateTime.Now; 
        }
        
        return _cachedSystemTime;
    }
    return DateTime.Now; // Режим Editor
}
```

В месте обработки логики все проверки были переведены на обращение к единому **снимку (snapshot)** времени:

```csharp
DateTime now = GetCurrentSystemTime();
if(requirement.CheckYear) results.Add(now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(now.Day == requirement.Day);
```

**Результаты после оптимизации (патч `MOD-RPGB-008`):** 
- **Полное устранение избыточных системных вызовов:** Вместо тысяч обращений `DateTime.Now` сводится к сложности $\mathcal{O}(1)$—ровно 1 раз для всех вычислений в каждом кадре.
- **Абсолютная атомарность (Atomic consistency):** Поля `Year`, `Month`, `Day` гарантированно относятся к одному и тому же мгновению.
- **Очистка отчёта Unity Project Auditor:** Полностью устранено предупреждение «Major» о системной производительности, связанное с `System.DateTime`.



## **6. Заключение**

Прямое использование `System.DateTime.Now` в высокочастотных циклах обновления Unity Engine представляет собой серьёзную техническую проблему как с точки зрения аппаратной производительности, так и с точки зрения целостности логических данных[^3].

- Сложная природа системных вызовов для разрешения часовых поясов и проверки правил летнего времени (DST) поглощает более **88%** времени выполнения этого свойства, оказывая прямое давление на бюджет кадра игрового движка[^4].
- В то же время извлечение нескольких подсвойств из раздельных вызовов `DateTime.Now` открывает уязвимость временного разрыва (*temporal tearing*), что ведёт к появлению гибридных временных меток и нарушению игровой логики[^21].

Решение покадрового кэширования (**Frame Caching**) в сочетании со свойством `Time.frameCount` радикально решает обе проблемы, снижая нагрузку на CPU до минимального константного уровня **$\mathcal{O}(1)$** на кадр и одновременно гарантируя неизменную атомарность снимков времени[^22].

При развёртывании в масштабе коммерческого проекта эта архитектура должна быть дополнена слоем защиты потока выполнения (`SystemTimeProvider`), тесно интегрирована с механизмом валидации авторитетного серверного времени (*Server-Authoritative Time*) для предотвращения читерства и ориентирована на стандартизацию через абстрактный класс `TimeProvider` для полного соответствия современным техническим стандартам индустрии разработки программного обеспечения[^20].

---

## **Список литературы**

[^1]: [DateTime Struct (System) | Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.datetime?view=net-10.0)  
[^2]: [The Darkness Behind DateTime.Now - DZone](https://dzone.com/articles/darkness-behind-datetimenow)  
[^3]: [Changelog | Project Auditor | 1.0.2 - Unity - Manual](https://docs.unity3d.com/Packages/com.unity.project-auditor@1.0/changelog/CHANGELOG.html)  
[^4]: [Make DateTime.Now as efficient as DateTime.UtcNow · Issue #24277](https://github.com/dotnet/runtime/issues/24277)  
[^5]: [DateTimeOffset.Now TimeZone data impacts Android startup #71004](https://github.com/dotnet/runtime/issues/71004)  
[^6]: [mono/mcs/class/referencesource/mscorlib/system/datetime.cs at main](https://github.com/mono/mono/blob/master/mcs/class/referencesource/mscorlib/system/datetime.cs)  
[^7]: [[C#] DateTime 구조체 파헤치기 - Second Step - 티스토리](https://sikpang.tistory.com/41)  
[^8]: [c# - Optimizing alternatives to DateTime.Now - Stack Overflow](https://stackoverflow.com/questions/1561791/optimizing-alternatives-to-datetime-now)  
[^9]: [DateTime.Now return 1hour off when compared to device time in - Mono #20510](https://github.com/mono/mono/issues/20510)  
[^10]: [TimeZoneNotFoundException in DateTime.Now #8090 - GitHub](https://github.com/xamarin/xamarin-android/issues/8090)  
[^11]: [TimeZoneInfo.Unix.cs - GitHub](https://github.com/dotnet/corert/blob/master/src/System.Private.CoreLib/shared/System/TimeZoneInfo.Unix.cs)  
[^12]: [Abstracting System Time in ASP.NET Applications - Redgate](https://www.red-gate.com/simple-talk/development/dotnet-development/abstracting-system-time-asp-net-applications/)  
[^13]: [TimeZoneNotFoundException on calling DateTimeOffset.Now #5080](https://github.com/dotnet/android/issues/5080)  
[^14]: [mono/mcs/class/corlib/System/TimeZoneInfo.Android.cs at main](https://github.com/mono/mono/blob/master/mcs/class/corlib/System/TimeZoneInfo.Android.cs)  
[^15]: [[Bug] Occasional crash in TouchEffect because of wrong time zone #1999](https://github.com/xamarin/XamarinCommunityToolkit/issues/1999)  
[^16]: [Stopwatch is more efficient than DateTime.Now - Doug Linder](https://vathsalas.wordpress.com/2015/02/12/stopwatch-is-more-efficient-than-datetime-now/)  
[^17]: [C# SDK Release Notes - Realtime 5 - Photon Fusion 2](https://doc.photonengine.com/realtime/v5/getting-started/release-notes)  
[^18]: [Changelog | Project Auditor | 0.10.0 - Unity - Manual](https://docs.unity3d.com/Packages/com.unity.project-auditor@0.10/changelog/CHANGELOG.html)  
[^19]: [[Unity] Project Auditor로 프로젝트 최적화하기 - 조다록 - 티스토리](https://zodang.tistory.com/82)  
[^20]: [TimeProvider and ITimer: Writing Unit Tests with Time in .NET 8](https://www.infoq.com/articles/dotnet-unit-tests-time-timezone/)  
[^21]: [How frequent is DateTime.Now updated ? or is there a more precise - Stack Overflow](https://stackoverflow.com/questions/307582/how-frequent-is-datetime-now-updated-or-is-there-a-more-precise-api-to-get-the)  
[^22]: [Is Update() called on the very first frame in Unity? - GameDev Stack Exchange](https://gamedev.stackexchange.com/questions/163058/is-update-called-on-the-very-first-frame-in-unity)  
[^23]: [Is there an equivalent of Time.frameCount for physics updates? - Unity Discussions](https://discussions.unity.com/t/is-there-an-equivalent-of-time-framecount-for-physics-updates/160506)  
[^24]: [UniTask.Delay restricted to main thread? · Issue #96 - GitHub](https://github.com/Cysharp/UniTask/issues/96)  
[^25]: [Time and frame rate management - Unity - Manual](https://docs.unity3d.com/2021.3/Documentation/Manual/TimeFrameManagement.html)  
[^26]: [Manual: Time and Framerate Management - Unity](https://docs.unity.cn/520/Documentation/Manual/TimeFrameManagement.html)  
[^27]: [What runs more often? Update, FixedUpdate or OnGUI - Unity Discussions](https://discussions.unity.com/t/what-runs-more-often-update-fixedupdate-or-ongui-documentation-mistake/475289)  
[^28]: [Simple server time anti-cheat • Cloud Code - Unity Documentation](https://docs.unity.com/en-us/cloud-code/scripts/use-cases/server-time-anti-cheat)  
[^29]: [Time synchronization | Unity NetCode | 0.0.4-preview.0](https://docs.unity3d.com/Packages/com.unity.netcode@0.0/manual/time-synchronization.html)  
[^30]: [System.DateTime.now and how to avoid time cheats (468724) - Unity Discussions](https://discussions.unity.com/t/system-datetime-now-and-how-to-avoid-time-cheats-468724/468724)  
[^31]: [Unity, NTP time, gets blocked - Stack Overflow](https://stackoverflow.com/questions/29220820/unity-ntp-time-gets-blocked)  
[^32]: [ZLogger v2 Architecture: Leveraging .NET 8 to Maximize Performance](https://neuecc.medium.com/zlogger-v2-architecture-leveraging-net-8-to-maximize-performance-2d9733b43789)  
[^33]: [Microsoft.Extensions.TimeProvider.Testing 10.7.0 - NuGet](https://www.nuget.org/packages/Microsoft.Extensions.TimeProvider.Testing/10.7.0)  
[^34]: [ZLogger v2 による .NET 8活用事例 と Unity C# 11対応の紹介](https://neue.cc/2023/12/19_zlogger2.html)  
[^35]: [referencesource/mscorlib/system/datetimeoffset.cs at main - GitHub](https://github.com/microsoft/referencesource/blob/master/mscorlib/system/datetimeoffset.cs)
