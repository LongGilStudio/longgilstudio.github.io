---
title: "Углублённый технический отчёт: механизмы работы, системная архитектура и влияние DelayedActionManager в среде Unity Addressables"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: "Углублённый анализ архитектуры ComponentSingleton класса DelayedActionManager в Unity Addressables, механизма выполнения LateUpdate, обработки исключений C#/C++ прокси и стратегий оптимизации памяти AssetBundle."
lang: ru
translation_id: unity-addressables-delayedactionmanager
---

Система Addressable Asset System (сокращённо Addressables) представляет собой революционный архитектурный шаг вперёд для Unity, предлагая гибкое, мощное и оптимизированное решение для управления контентом на базе традиционных AssetBundles[^1]. При проектировании и эксплуатации масштабных игр или интерактивных приложений управление асинхронными потоками данных для автоматической загрузки и выгрузки ресурсов является обязательным требованием. Одним из ключевых компонентов, выполняющих эту сложную задачу — но при этом нередко сбивающих с толку инженеров-программистов при анализе иерархии (Hierarchy) — является автоматически создаваемый объект под названием `DelayedActionManager`, размещённый внутри сцены `DontDestroyOnLoad`[^2].

В данном техническом отчёте проводится всесторонний разбор архитектурной природы `DelayedActionManager`: объясняются причины его присутствия в пространстве `DontDestroyOnLoad`, анализируется механизм его выполнения внутри цикла реального времени Unity, а также исследуются проблемы управления памятью, явления утечек (memory leaks) и распространённые исключения (exceptions). На основе анализа системного проектирования и лучших практик документ даёт глубокое понимание, позволяющее архитекторам ПО оптимизировать стабильность приложений.

## Эволюция системы загрузки ресурсов и асинхронный фундамент

Прежде чем углубляться в микроструктуру `DelayedActionManager`, необходимо понять контекст появления системы Addressables. В более ранних версиях Unity разработчики обычно полагались на папку `Resources` или напрямую использовали сырые скрипты AssetBundle[^4]. Механизм `Resources.Load()` работает подобно тому, как пользователь сам заходит на склад: требуется точный путь к каталогу, а поток выполнения (main thread) принудительно блокируется (block) до тех пор, пока ресурс не будет найден и загружен в память[^4]. Недостаток этого подхода заключается в том, что он препятствует масштабируемости приложения и вызывает серьёзное падение частоты кадров (FPS drop) при обработке больших объёмов данных.

Чтобы решить эту задачу, Addressables работает как современная служба доставки. Разработчику достаточно указать идентификатор ресурса (address/key), а система автоматически определит маршрут для поиска ресурса в локальном хранилище (Local) или загрузки его с серверов сети доставки контента (CDN — Content Delivery Network)[^4]. Самое важное, что весь этот цикл выполняется асинхронно (asynchronous). Вызов загрузки, типичным примером которого является `Addressables.LoadAssetAsync`, не возвращает объект немедленно, а возвращает дескриптор под названием `AsyncOperationHandle`[^4]. Этот интерфейс предоставляет механизм обратного вызова (callback) по готовности ресурса, позволяя основному потоку приложения без прерываний продолжать обработку физики и графики[^4].

Переход от полностью синхронной к полностью асинхронной модели влечёт за собой серьёзный архитектурный вызов: когда процесс загрузки ресурса занимает несколько секунд из-за низкой пропускной способности сети, приложение может уже перейти на совершенно другую сцену (scene)[^1]. Управление функциями обратного вызова (callbacks), очередями задач (command queues) и подсчётом ссылок (reference counting) требует центрального управляющего узла, не зависящего от жизненного цикла создания и уничтожения обычных сцен. Именно поэтому разработчики Unity интегрировали модель сцены `DontDestroyOnLoad` в ядро Addressables.

## Сцена DontDestroyOnLoad (DDOL) и архитектура глобальной персистентности

В среде Unity операция загрузки новой сцены (через `SceneManager.LoadScene` в стандартном режиме Single) автоматически запускает механизм очистки памяти. Движок уничтожает (destroy) все `GameObject` и `Component`, принадлежащие предыдущей сцене, чтобы гарантировать освобождение неиспользуемых ресурсов[^7]. Хотя аддитивная загрузка сцен (Additive scenes) позволяет поддерживать несколько одновременно активных сцен для управления глобальным состоянием (например, отдельная сцена для Game Manager и отдельная для Level), механизм `DontDestroyOnLoad` (DDOL) по-прежнему играет важнейшую роль низкоуровневой защиты системных объектов[^7].

Появление сцены `DontDestroyOnLoad` в интерфейсе редактора Unity при нажатии кнопки Play — это не ошибка, а встроенный по умолчанию механизм движка для группировки объектов, отмеченных как неуничтожаемые при загрузке новой сцены[^9]. Чтобы `GameObject` был принят в эту безопасную область, система Unity устанавливает обязательное правило: объект должен находиться на корневом уровне (root level) иерархии сцены[^8]. Любая попытка применить функцию `DontDestroyOnLoad(gameObject)` к дочернему объекту (nested object) завершится неудачей с выводом предупреждения[^8].

Для системы Addressables процессы загрузки и выгрузки ресурсов представляют собой операции, жизненный цикл которых охватывает множество различных сцен. Например, отслеживание состояния загрузки AssetBundle с удалённого сервера не может быть прервано на полпути только потому, что игрок прошёл через дверь перехода на другой уровень. Использование механизма `RuntimeInitializeOnLoadMethod` в сочетании с расширенным паттерном проектирования Singleton позволяет коду Addressables автоматически создать корневой объект и поместить его в сцену DDOL сразу при запуске приложения[^2]. Это объясняет, почему, даже если программист не написал ни единой строчки кода, связанной с DDOL, объект под названием `"DelayedActionManager"` автоматически появляется в нижней левой части списка сцен[^2].

## Внутренняя структура и техническая роль DelayedActionManager

Глубокое изучение исходного кода и документации API пакета Addressables показывает, что `DelayedActionManager` — это конкретный класс (concrete class), расположенный в пространстве имён `UnityEngine.ResourceManagement.Util`[^11]. По своей структуре он не является обычным статическим классом утилит (static utility class), а представляет собой компонент, прикрепляемый непосредственно к `GameObject` путём наследования от базовой архитектуры[^12].

### Паттерн ComponentSingleton и автоматизация инициализации

Архитектура `DelayedActionManager` построена на базе паттерна проектирования `ComponentSingleton` — базового класса, определённого в том же пространстве имён[^13]. Использование паттерна Singleton на базе компонента (`Component`) вместо чистого класса C# даёт системе возможность напрямую взаимодействовать с циклом событий реального времени (`PlayerLoop`) движка Unity.

Когда система `ResourceManager` впервые получает запрос на загрузку или обновление состояния (например, `Addressables.LoadAssetAsync` или операции сетевой диагностики), она обращается к экземпляру `DelayedActionManager`. В этот момент паттерн `ComponentSingleton` автоматически выполняет скрытую процедуру: создаёт пустой `GameObject`, называет его `"DelayedActionManager"`, прикрепляет к нему соответствующий скрипт-компонент и немедленно вызывает `DontDestroyOnLoad`, чтобы переместить его в глобальное защищённое пространство[^2]. Такое ленивое проектирование инициализации (lazy initialization) гарантирует, что системные ресурсы расходуются только тогда, когда функциональность управления отложенными задачами действительно востребована, снимая распространённые вопросы разработчиков о «магическом» появлении этого объекта в интерфейсе[^3].

### Анализ механизма планирования и фазы LateUpdate

Ключевая задача `DelayedActionManager` — служить центральным планировщиком (central scheduler) для отложенных действий, функций обратного вызова (callbacks), корутин и микроуровневого управления памятью[^11]. Тонкая, но чрезвычайно важная деталь его архитектуры заключается в том, что вся логика обработки очередей маршрутизируется для выполнения внутри функции `LateUpdate()` жизненного цикла Unity[^11].

Выбор `LateUpdate` вместо традиционного `Update` решает глубокую архитектурную проблему, связанную с согласованностью данных. Следующая таблица иллюстрирует порядок выполнения Unity и роль фазы `LateUpdate` в защите данных Addressables.

| Фаза выполнения (PlayerLoop) | Типичные задачи | Роль для Addressables и DelayedActionManager |
| :--- | :--- | :--- |
| **FixedUpdate** | Обработка симуляции физики, статических/динамических столкновений. | Игровая логика может инициировать запросы на уничтожение объектов после столкновений. |
| **Update** | Ввод игрока (Input), перемещение, логика ИИ, обновление состояния игры. | Функции `Addressables.LoadAssetAsync` или `Release` вызываются вручную. `GameObject` могут уничтожаться через `Destroy()`. |
| **LateUpdate** | Обновление позиции камеры, постобработка (post-processing). | `DelayedActionManager` очищает память, обновляет счётчики ссылок и вызывает асинхронные колбэки, исключая конфликты с командами уничтожения из фазы `Update`[^11]. |

Если бы система `ResourceManager` выполняла колбэки завершения операций немедленно посреди фазы `Update`, возник бы высокий риск взаимодействия с подсистемами (например, графикой или пользовательским интерфейсом), находящимися в промежуточном состоянии с незавершённым расчётом кадра. Откладывая (delaying) вызов функций `OnComplete` или уменьшение счётчиков ссылок (ref-count decrements) до фазы `LateUpdate()`, `DelayedActionManager` гарантирует, что всё логическое состояние текущего кадра уже стабилизировалось[^11]. Данные из многочисленных отчётов трассировки стека (stack traces) показывают, что `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` является последним буферным шагом перед возвратом управления пользовательскому коду[^15].

## Разбор системных исключений (System Exceptions) и трассировок стека (Stack Traces)

Несмотря на высокую надёжность архитектуры, сложность асинхронного механизма в сочетании с некорректным управлением жизненным циклом со стороны программиста нередко ставит `DelayedActionManager` в центр серьёзных исключений. Отчёты об ошибках дают ключевые подсказки о том, как система взаимодействует с управляемой памятью (managed memory) и нативной памятью (native memory).

### Ошибка NullReferenceException и конфликт жизненного цикла прокси C# – C++

Очень распространённым сценарием ошибки в среде Addressables является появление исключения `ArgumentNullException: Value cannot be null. Parameter name: obj`, возникающего в методе `StartCoroutine_Auto` класса `DelayedActionManager`[^19]. Эта ошибка не является внутренним багом Unity, а вызвана несогласованностью между механизмом сборки мусора C# (Garbage Collector) и управлением сырыми указателями в нижележащем коде C++[^19].

В Unity такие объекты, как `GameObject` или `MonoBehaviour`, по сути являются классами-представителями (proxy classes), написанными на C# и содержащими внутреннюю ссылку на нативный объект, выделенный на C++ внутри движка[^19]. Когда программист вызывает `Destroy(gameObject)`, объект C++ немедленно уничтожается и область памяти освобождается, в результате чего внутренняя ссылка становится равной null[^19]. Однако сам прокси-класс C# может оставаться в управляемой памяти (managed memory) ещё некоторое время, пока по нему не пройдётся сборщик мусора[^19].

Катастрофа происходит, когда разработчики используют анонимные лямбда-выражения (lambdas/closures) в паре с асинхронными процессами Addressables. Лямбда-выражение обладает свойством «захватывать» (capture) переменные окружающего контекста. Рассмотрим следующий шаблон кода:

```csharp
// Действие, поставленное в очередь DelayedActionManager
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

При выполнении этого кода переменная `_crawlerRobot` (являющаяся C#-прокси) захватывается замыканием (closure)[^19]. Если игровая логика уничтожает `_crawlerRobot` в том же кадре, нижележащий указатель C++ исчезает. Но поскольку `DelayedActionManager` запланировал запуск этой лямбды на фазе `LateUpdate` (или в одном из последующих кадров), при фактическом срабатывании лямбда пытается обратиться к методу `BreakAwayLowerBody()` уже мёртвого указателя C++[^19]. Неизбежным следствием становится выброс исключения `NullReferenceException` или сообщение об ошибке «Объект был уничтожен, но вы всё ещё пытаетесь получить к нему доступ»[^19].

Для устранения этого архитектурного риска эксперты по ПО рекомендуют два проектных решения:

1. Избегать чрезмерной вложенности лямбда-выражений (lambdas nesting) при обработке низкоуровневых изменений состояния[^19].
2. Всегда выполнять безопасную проверку на null, опираясь на тот факт, что Unity перегрузила (overloaded) оператор `==` в C# для прямой проверки состояния нижележащего указателя C++[^19].

### Конфликт PlayerLoop и ошибка «Assertion failed on expression: ShouldRunBehaviour()»

В процессе контроля версий пакетов Addressables значительное число разработчиков сообщало о том, что редактор Unity (Unity Editor) переполняется низкоуровневым сообщением об ошибке: `Assertion failed on expression: 'ShouldRunBehaviour()'` в файле `MonoBehaviour.cpp`[^3].

Трассировка стека (stack trace) указывает на то, что этот процесс берёт начало непосредственно от `GameObject` с именем `"DelayedActionManager"`, находящегося в сцене `DontDestroyOnLoad`[^3]. Анализ первопричин (Root Cause Analysis) выявил уязвимость в обработке режима воспроизведения (Play Mode) редактора Unity. Когда редактор проходит через этап перекомпиляции домена (Domain Reload) или когда пользователь нажимает «Стоп» (Stop) до завершения текущей загрузки ресурсов, `DelayedActionManager` застревает в виде осиротевшего объекта (orphaned object)[^3].

Поскольку он помечен как `DontDestroyOnLoad`, он пытается продолжать выполнять циклы `LateUpdate` и проверки поведения (behaviour checks), несмотря на то что нативная среда выполнения Unity (`PlayerLoop`) уже отдала команду остановить все задачи[^3]. Наиболее остро эта ошибка проявилась при переходе с пакета Addressables `1.16.x` на `1.18.x`, что вынудило многие команды разработчиков вручную откатиться к версии `1.17.17` для обеспечения стабильности синхронного API и устранения зависания очереди[^3].

### Эволюция DelayedActionManager в истории версий

Интересным фактом при изучении документации API и журналов изменений (changelogs) Unity Addressables является циклическое присутствие `DelayedActionManager`. В таких версиях, как `0.7.5` и `1.11.2`, в списке изменений явно объявлялся рефакторинг интерфейса скриптов сборки (build script interface) с формулировкой: *«Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading»*[^20]. Изначально это решение было направлено на упрощение слоя API и передачу контроля пользовательскому классу `AsyncOperationBase`[^20].

Однако отчёты об ошибках из пост-LTS (Long-Term Support) версий, таких как `1.18.15`, `1.19.19` и `1.21.21`, вновь демонстрируют постоянное присутствие `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` в стеках вызовов[^11]. Это отражает философию итеративного проектирования (iterative design) Unity: после удаления компонента ради упрощения системные инженеры осознали, что отсутствие центрального менеджера отложенных задач создаёт непреодолимые трудности при сборе диагностических событий (`DiagnosticEventCollector`), обработке таблиц предзагрузки (preload tables) и обеспечении безопасности памяти при закрытии приложения[^11]. `DelayedActionManager` был перепроектирован и возвращён в качестве скрытой системной утилиты, которая больше не выставляется в публичный пользовательский интерфейс, но отвечает за устранение рисков очистки (disposal) при завершении работы приложения[^20].

## Механизм подсчёта ссылок и динамика утечек памяти

Существование `DelayedActionManager` тесно связано с одним из самых сложных столпов Addressables — системой управления памятью (Memory Management). В отличие от полной зависимости от Garbage Collector, Addressables контролирует нахождение данных в оперативной памяти с помощью механизма подсчёта ссылок (Reference Counting)[^23].

### Динамика ссылок и иерархия зависимостей

Каждый раз, когда система получает запрос на загрузку ресурса, счётчик ссылок этого ресурса увеличивается на единицу (increment). По завершении использования вызов `Addressables.Release` даёт системе команду уменьшить этот счётчик (decrement)[^23]. Золотое правило заключается в том, что система разрешает освобождение физической памяти, занимаемой ресурсом, только тогда, когда его счётчик ссылок возвращается к абсолютному нулю[^23].

Сложность возрастает в геометрической прогрессии из-за того, что Addressables управляет зависимостями через архитектуру AssetBundle. При загрузке одного ресурса (например, материала — `Material`) система загружает не только сам материал, но и автоматически подгружает все AssetBundle, содержащие его зависимые компоненты (например, `Texture`)[^25]. Граф зависимостей (dependency graph) рассчитывается на уровне бандла (Bundle), то есть если ресурс в Bundle A ссылается на ресурс в Bundle B, весь Bundle B должен быть загружен в память хоста[^26].

Самое жёсткое техническое ограничение Unity в этой архитектуре звучит так: **пользователь не может частично выгрузить (partially unload) содержимое AssetBundle**[^23]. Чтобы проиллюстрировать это, представим AssetBundle под названием `"stuff"`, содержащий три независимых ресурса: `Дерево`, `Танк` и `Корова`[^23]:

1. Когда загружается ресурс `Дерево`, инструмент анализа памяти (Profiler) отображает одну ссылку для `Дерева` и одну соответствующую ссылку для бандла `stuff`[^23].
2. Когда далее загружается ресурс `Танк`, счётчик `Танка` увеличивается, а счётчик `stuff` возрастает до 2[^23].
3. Если игра выполняет команду `Release(Дерево)`, счётчик `Дерева` снижается до 0, и синяя полоса в Profiler исчезает[^23].
4. Тем не менее физические данные `Дерева` остаются в системной памяти. Поскольку `Танк` продолжает удерживать связь, из-за чего счётчик AssetBundle `stuff` больше 0, ни один ресурс внутри этого бандла не может быть удалён, пока не будет полностью освобождён весь бандл целиком[^23].

### Синдром «Asset Churn» и раздувание памяти (Memory Bloat)

Явление, при котором ресурсы постоянно загружаются, выгружаются и тут же загружаются вновь за короткий промежуток времени, называется **«Asset Churn»** (метание/ротация ресурсов)[^23]. Эта проблема часто возникает при переключении между уровнями (levels). Допустим, на Уровне 1 используется ресурс `Лодка`, а на Уровне 2 — ресурс `Самолёт` (оба используют общую текстуру `Камуфляж`). При выходе из Уровня 1 разработчик освобождает `Лодку`, что приводит к немедленной выгрузке текстуры `Камуфляж` системой Addressables из памяти. Спустя миллисекунду, когда Уровень 2 создаёт `Самолёт`, система вынуждена заново выполнять цикл дискового ввода-вывода (I/O), чтобы снова загрузить текстуру `Камуфляж` с нуля[^23]. Этот процесс создаёт резкие скачки (spikes) времени кадра и доводит потребление памяти до опасного порога, особенно на мобильном оборудовании[^27].

Кроме того, пропуск хотя бы одного вызова `Release` приводит к накоплению мусорных ссылок, из-за чего объём занимаемой RAM вырастает с сотен мегабайт до гигабайт всего за несколько смен сцен[^28]. Поскольку ни `DelayedActionManager`, ни сама система Addressables не отслеживают количество экземпляров (instances), созданных обычным методом `Instantiate` из `MonoBehaviour`, любая ошибка в отслеживании дескрипторов памяти вызывает постоянную утечку памяти[^6].

### Архитектура сжатия данных и давление на выделение памяти

Размер AssetBundles и метод сжатия данных напрямую влияют на то, как данные располагаются в RAM. Выбор метода сжатия определяет, будет ли AssetBundle постоянно занимать большой объём памяти или сможет эффективно оптимизировать пропускную способность.

Сводная таблица характеристик алгоритмов сжатия AssetBundle и их влияния на память[^29]:

| Алгоритм сжатия | Возможность локального распознавания файлов | Требование загрузки всего бандла в RAM | Влияние на производительность и хранение |
| :--- | :--- | :--- | :--- |
| **LZMA** | Нет. Бандл сжат монолитным блоком. | **Да.** Требуется распаковать весь файл в память. | Наивысшая степень сжатия и минимальный размер загрузки, но вызывает острое раздувание памяти (Memory Bloat) и интенсивную нагрузку на CPU при распаковке[^29]. |
| **LZ4** | Да. Сжатие по блокам (chunk-based). | **Нет.** Загружается только та часть данных, к которой идёт обращение. | Рекомендуется в качестве стандарта по умолчанию (default). Позволяет кэшировать (caching) напрямую на локальный диск без загрузки всех метаданных в RAM[^29]. |
| **Uncompressed** | Да. Независимое распознавание каждого ресурса. | **Нет.** Прямой доступ. | Нет затрат времени на распаковку, максимальный исходный размер файла. Оптимален для мгновенной загрузки, если позволяет пропускная способность диска[^29]. |

При запросе крошечного ресурса из гигантского AssetBundle, сжатого алгоритмом LZMA, весь файл целиком (включая заголовок, метаданные и таблицы потокового кэша) должен быть перенесён с жёсткого диска в RAM[^27]. Эта ошибка проектирования превращает огромные AssetBundle в бомбы замедленного действия, вызывающие аварийное завершение приложения из-за нехватки памяти (OOM crashes)[^27].

## Лучшие практики (Best Practices) в управлении ресурсами

Чтобы обуздать сложность системы подсчёта ссылок и снизить нагрузку на `DelayedActionManager`, системные архитекторы обязаны применять предельно строгую структуру жизненного цикла в сочетании с методами оптимизации ресурсов.

### 1. Симметричная синхронизация циклов создания и освобождения

Каждый объект `AsyncOperationHandle`, возвращаемый API, должен быть в обязательном порядке освобождён по окончании срока его использования[^6]. Невыполнение этого требования не только вызывает утечки памяти, но и способно привести к падению системы (crashes)[^6]. В таблице ниже показаны обязательные симметричные пары в программировании с Addressables:

| Метод создания / загрузки | Соответствующий метод освобождения | Внутренний механизм работы |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | Вычитает 1 из счётчика ссылок содержащего ресурс AssetBundle[^6]. |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | Уничтожает отображаемый объект (Instance) и автоматически вычитает 1 из счётчика исходного Prefab[^4]. |
| Назначение через `AssetReference` | `reference.ReleaseAsset()` | Аналогично вызову Release через дескриптор; очищает статические ссылки[^6]. |

В частности, при использовании `ScriptableObject` для хранения игровых настроек прямая ссылка на объект (`public Object _worldAsset`) создаёт жёсткие ссылки (hard references), вынуждая всю систему немедленно загружать этот ресурс в RAM[^27]. Оптимальным решением является использование `AssetReference` (`public AssetReference addressableAsset;`) для асинхронной загрузки по требованию (on-demand loading)[^6].

### 2. Низкоуровневое вмешательство: Resources.UnloadUnusedAssets()

В безвыходной ситуации, когда общие AssetBundle оказываются заблокированы в памяти из-за свойства «невозможности частичной выгрузки» (например, ресурс `Дерево` застрял вместе с `Танком`), единственным выходом является использование принудительного API базового уровня движка: `Resources.UnloadUnusedAssets()`[^25].

Эта функция выполняет глубокое сканирование всей оперативной памяти системы для поиска всех ресурсов (включая скрытые в AssetBundles), чьё фактическое количество внутренних ссылок движка (actual engine references) строго равно 0, и принудительно уничтожает их[^25]. Тем не менее это операция с колоссальной стоимостью для производительности: она вызывает серьёзные падения FPS (FPS drops), поскольку CPU вынужден приостанавливать логический поток для выполнения процесса очистки[^27]. Инженеры должны вызывать эту команду только на крупных экранах загрузки (loading screens) либо полагаться на её автоматический вызов системой при переходе между сценами через `SceneManager.LoadScene`[^29].

### 3. Планирование и разделение AssetBundles (Bundle Packing Modes)

Организация структуры групп (Groups) в интерфейсе конфигурации Addressables напрямую определяет эффективность загрузки памяти и пропускную способность скачивания. Выбор подходящего режима упаковки (Bundle Mode) для каждого типа ресурсов является критически важным этапом проектирования[^6]:

* **Pack Together (Упаковать вместе)**: используется для ресурсов с тесно связанным жизненным циклом, которые всегда появляются одновременно. Это снижает затраты на анализ графа зависимостей и сетевой ввод-вывод[^6].
* **Pack Separately (Упаковать раздельно)**: оптимально для огромных независимых ресурсов или больших карт уровней, совместная загрузка которых не гарантирована. Устраняет риск того, что крупный ресурс заблокирует выгрузку другого мелкого ресурса[^6].
* **Pack Together By Label (Упаковать по метке)**: позволяет объединять разрозненные ресурсы через метаданные меток (например, присвоив метку `"Halloween 2023"`, чтобы сгруппировать весь контент события в один бандл для удобного обновления через CDN)[^6].

Чтобы ещё сильнее снизить нагрузку таблицы типов (`TypeTree`) в AssetBundle, разработчики могут активировать опцию `BuildAssetBundleOptions.DisableWriteTypeTree`. Эта функция удаляет объём избыточных метаданных, однако требует пересборки локальных групп (rebuild local groups) перед экспортом исполняемых файлов[^26].

### 4. Управление памятью аудио и графики (Graphics & Audio)

Оптимизация вспомогательных слоёв — наиболее эффективный способ снизить частоту срабатывания сборщика мусора. Настройка формата загрузки аудиопотоков напрямую влияет на память[^27]:

* **Длинная фоновая музыка (BGM)**: следует настроить **Streaming** для подгрузки небольшими буферными фрагментами с диска[^27].
* **Длинные звуковые эффекты**: выбирайте **Compressed In Memory** для хранения в сжатом виде в RAM и декодирования в реальном времени при воспроизведении[^27].
* **Короткие / частые звуковые эффекты**: используйте **Decompress On Load**, чтобы заранее подготовить несжатые данные и исключить затраты CPU[^27].

Наряду с этим отключение опции `"Read/Write enabled"` на текстурах (Texture) и настройка отключения буфера глубины (Depth Stencil Format to None) для камер графического интерфейса (UI) сократят ненужный расход RAM на рендеринг как минимум на 50%[^27].

## Заключение о глобальном взаимодействии

Исследование `DelayedActionManager` не только расшифровывает происхождение скрытого объекта в сцене `DontDestroyOnLoad`, но и раскрывает фундаментальную философию проектирования системы Addressables в Unity. Этот класс `ComponentSingleton` выступает в роли тонкого временного моста, обеспечивающего целостность данных путём перенаправления процессов освобождения, асинхронных вызовов и обработки буферов в цикл `LateUpdate`. Он изолирует изменения структуры памяти от сбоев, которые могут быть вызваны физическим кодом или логикой управления в потоке `Update`, формируя щит против системных исключений при смене сцен.

Однако `DelayedActionManager` не является волшебной палочкой, способной устранить внутренние слабости архитектуры управления памятью. Он предъявляет жёсткие требования к архитекторам ПО в части поддержания абсолютно симметричного цикла загрузки/выгрузки ресурсов, проектирования анонимных C#-выражений (lambdas) без замыканий на нативные C++-объекты, а также модульного разделения (modularize) структуры AssetBundle для предотвращения упорных утечек памяти. Благодаря глубокому пониманию маршрутизации асинхронной загрузки, грамотному использованию методов сжатия вроде LZ4 и принудительной мощи `Resources.UnloadUnusedAssets`, команды разработчиков способны создавать надёжные, высокомасштабируемые архитектурные модели для любых платформ без страха перед необратимым исчерпанием ресурсов.

## **Список литературы**

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

### Дополнительная литература

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
