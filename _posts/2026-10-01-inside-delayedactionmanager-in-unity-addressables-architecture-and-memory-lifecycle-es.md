---
title: "Informe de Investigación Técnica en Profundidad: Mecanismos de Funcionamiento, Arquitectura del Sistema e Impacto de DelayedActionManager en Unity Addressables"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: Análisis exhaustivo de la arquitectura ComponentSingleton de DelayedActionManager en Unity Addressables, su ejecución en LateUpdate, gestión de excepciones de proxy C#/C++ y estrategias de optimización de memoria de AssetBundles.
lang: es
translation_id: unity-addressables-delayedactionmanager
---

El sistema Addressable Asset System (abreviado como Addressables) representa un avance arquitectónico revolucionario en Unity, proporcionando una solución de gestión de contenido flexible, robusta y optimizada sobre la base tradicional de AssetBundles[^1]. Durante el diseño y la operación de videojuegos o aplicaciones interactivas a gran escala, gestionar flujos de datos asíncronos para cargar y liberar recursos de forma automática es un requisito esencial. Uno de los componentes centrales encargados de esta compleja tarea —aunque a menudo desconcierta a los ingenieros de software al inspeccionar la jerarquía (Hierarchy)— es un objeto generado automáticamente llamado DelayedActionManager, ubicado dentro de la escena DontDestroyOnLoad[^2].

Este informe técnico profundiza en la disección integral de la naturaleza arquitectónica de DelayedActionManager, explicando la razón de su existencia en el espacio DontDestroyOnLoad, analizando su mecanismo de ejecución dentro del bucle en tiempo real de Unity y desglosando los desafíos relativos a la gestión de memoria, las fugas de memoria (memory leaks) y las excepciones de ejecución habituales. A través del análisis de datos de diseño del sistema y buenas prácticas, este documento ofrece una visión profunda para ayudar a los arquitectos de software a optimizar la estabilidad de sus aplicaciones.

## La Evolución del Sistema de Carga de Recursos y los Fundamentos Asíncronos

Antes de adentrarse en las microestructuras de DelayedActionManager, es imprescindible comprender el contexto en el que nació el sistema Addressables. En versiones anteriores de Unity, los programadores dependían habitualmente de la carpeta Resources o utilizaban directamente scripts básicos de AssetBundle[^4]. El mecanismo `Resources.Load()` funciona de forma análoga a entrar manualmente en un almacén: exige la ruta exacta del directorio y obliga al hilo principal (main thread) a bloquearse hasta que el recurso se localiza y se carga en memoria[^4]. La desventaja de este enfoque es que impide la escalabilidad de la aplicación y provoca caídas graves de fotogramas por segundo (FPS drop) al procesar grandes volúmenes de datos.

Para resolver este problema, Addressables actúa como un servicio logístico moderno. El programador únicamente necesita proporcionar el identificador del recurso (address/key), y el sistema enruta automáticamente la búsqueda para obtenerlo desde el almacenamiento local o descargarlo desde servidores de red de distribución de contenidos (CDN - Content Delivery Network)[^4]. Lo más importante es que todo este ciclo se desarrolla de manera asíncrona. Una orden de carga, típicamente `Addressables.LoadAssetAsync`, no devuelve el objeto de inmediato, sino un identificador de control llamado `AsyncOperationHandle`[^4]. Esta interfaz proporciona un mecanismo de retrollamada (callback) cuando el recurso está listo, permitiendo que el hilo principal de la aplicación continúe procesando la lógica física y gráfica sin interrupciones[^4].

Esta transición de un modelo síncrono a uno completamente asíncrono conlleva un gran reto arquitectónico: cuando un proceso de carga de recursos tarda varios segundos en completarse debido a un ancho de banda de red lento, es posible que la aplicación ya haya cambiado a una escena (scene) completamente distinta[^1]. Gestionar las funciones de callback, las colas de tareas (command queues) y el conteo de referencias (reference counting) requiere una entidad de administración central que no se vea afectada por el ciclo de vida de creación y destrucción de las escenas convencionales. Ese es precisamente el motivo por el cual los desarrolladores de Unity integraron el modelo de escena DontDestroyOnLoad en el núcleo de Addressables.

## La Escena DontDestroyOnLoad (DDOL) y la Arquitectura de Persistencia Global

En el entorno de Unity, cargar una nueva escena (mediante `SceneManager.LoadScene` en el modo Single predeterminado) activa automáticamente el mecanismo de limpieza de memoria. El sistema destruye todos los GameObjects y Components pertenecientes a la escena anterior para garantizar la liberación de los recursos que ya no se utilizan[^7]. Aunque la carga aditiva de escenas (Additive scenes) permite mantener varias escenas activas en paralelo para gestionar el estado global (por ejemplo, una escena dedicada al Game Manager y otra al nivel), el mecanismo DontDestroyOnLoad (DDOL) sigue desempeñando un papel fundamental a nivel de sistema para proteger objetos de bajo nivel[^7].

La aparición de la escena DontDestroyOnLoad en la interfaz del Editor de Unity al pulsar el botón Play no es un error, sino un mecanismo interno predeterminado del motor destinado a agrupar los objetos marcados para no ser destruidos al cambiar de escena[^9]. Para que un GameObject sea admitido en esta zona segura, Unity impone una regla obligatoria: el objeto debe situarse en el nivel raíz (root level) de la escena[^8]. Cualquier intento de aplicar la función `DontDestroyOnLoad(gameObject)` sobre un objeto hijo (nested object) fracasará y registrará una advertencia[^8].

En el caso de Addressables, los procesos de carga y descarga de recursos son operaciones cuyo ciclo de vida abarca múltiples escenas. Por ejemplo, el seguimiento del estado de descarga de un AssetBundle desde un servidor remoto no puede cancelarse a mitad de camino solo porque el jugador haya cruzado un portal de cambio de nivel. El uso de `RuntimeInitializeOnLoadMethod` combinado con un patrón Singleton avanzado permite que el código fuente de Addressables cree automáticamente un objeto raíz y lo transfiera a la escena DDOL en cuanto arranca la aplicación[^2]. Esto explica por qué, incluso cuando el programador no ha escrito ni una sola línea de código relacionada con DDOL, sigue apareciendo automáticamente un objeto llamado «DelayedActionManager» en la esquina inferior izquierda de la lista de escenas[^2].

## Estructura Interna y Rol Técnico de DelayedActionManager

Al estudiar en profundidad el código fuente y la documentación de la API del paquete Addressables, se observa que DelayedActionManager es una clase concreta perteneciente al espacio de nombres `UnityEngine.ResourceManagement.Util`[^11]. Su estructura no corresponde a una simple clase de utilidad estática (static utility class), sino a un componente acoplado directamente a un GameObject mediante herencia de una arquitectura base[^12].

### El Patrón ComponentSingleton y la Automatización de la Inicialización

La arquitectura de DelayedActionManager se construye sobre el patrón de diseño ComponentSingleton, una clase fundamental definida en el mismo espacio de nombres[^13]. Emplear el patrón Singleton sobre un componente (Component) en lugar de una clase C# pura otorga al sistema la capacidad de interactuar directamente con el bucle de eventos en tiempo real de Unity (PlayerLoop).

Cuando el sistema ResourceManager recibe por primera vez una solicitud de carga o actualización de estado (por ejemplo, `Addressables.LoadAssetAsync` u operaciones de diagnóstico de red), invoca a la instancia de DelayedActionManager. En ese momento, el patrón ComponentSingleton ejecuta automáticamente un procedimiento oculto que incluye: crear un GameObject vacío, asignarle el nombre «DelayedActionManager», adjuntarle el script correspondiente y llamar de inmediato a `DontDestroyOnLoad` para trasladarlo al espacio de protección global[^2]. Este diseño de inicialización diferida (lazy initialization) garantiza que los recursos del sistema solo se consuman cuando la gestión de tareas diferidas sea realmente necesaria, resolviendo las dudas habituales de los programadores sobre la aparición «mágica» de este objeto en la interfaz[^3].

### Análisis del Mecanismo de Planificación y la Fase LateUpdate

La responsabilidad principal de DelayedActionManager es actuar como un planificador central (central scheduler) para acciones diferidas, funciones de retorno (callbacks), corrutinas y gestión de memoria a nivel microscópico[^11]. La diferencia sutil pero sumamente crítica en su arquitectura radica en que toda la lógica de procesamiento de colas se enruta para ejecutarse dentro de la función `LateUpdate()` del ciclo de vida de Unity[^11].

La elección de diseño orientada hacia `LateUpdate` en lugar del `Update` tradicional resuelve un problema arquitectónico profundo relacionado con la coherencia de los datos. La tabla siguiente ilustra el orden de ejecución de Unity y el papel de la fase `LateUpdate` en la protección de los datos de Addressables.

| Fase de Ejecución (PlayerLoop) | Funciones Típicas | Rol frente a Addressables y DelayedActionManager |
| :--- | :--- | :--- |
| **FixedUpdate** | Procesamiento de simulación física, colisiones estáticas y dinámicas. | La lógica del juego puede desencadenar solicitudes de destrucción de objetos tras una colisión. |
| **Update** | Entrada del jugador (Input), movimiento, lógica de IA, actualización del estado del juego. | Las funciones `Addressables.LoadAssetAsync` o `Release` se invocan manualmente. Los GameObjects pueden destruirse con `Destroy()` aquí. |
| **LateUpdate** | Actualización de la posición de la cámara, ajustes de posprocesado (post-processing). | DelayedActionManager limpia la memoria, actualiza los contadores de referencias y ejecuta los callbacks asíncronos para evitar conflictos con las órdenes de destrucción de la fase `Update`[^11]. |

Si ResourceManager ejecutase los callbacks de finalización inmediatamente en medio de la fase `Update`, correría un alto riesgo de interactuar con un subsistema (como el gráfico o el de interfaz de usuario) que se encuentre en un estado intermedio, sin haber completado el cálculo del fotograma. Al diferir (delaying) la invocación de las funciones OnComplete o la reducción de los contadores de referencias (ref-count decrements) hasta `LateUpdate()`, DelayedActionManager garantiza que todo el estado lógico del fotograma actual sea estable[^11]. Los datos recopilados en numerosos informes de seguimiento de pila (stack traces) muestran que `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` es el último puente antes de devolver el control al código del usuario[^15].

## Disección de Excepciones del Sistema (System Exceptions) y Trazas de Pila (Stack Traces)

A pesar de haber sido diseñado con un alto nivel de seguridad, la complejidad del mecanismo asíncrono, sumada a una gestión imprecisa del ciclo de vida por parte del programador, convierte con frecuencia a DelayedActionManager en el epicentro de excepciones graves. Los registros de errores aportan pistas esenciales sobre cómo interactúa el sistema con la memoria administrada (managed memory) y la memoria nativa (native memory).

### Error NullReferenceException y Conflicto en el Ciclo de Vida del Proxy C# - C++

Un escenario de fallo muy habitual en el entorno Addressables es la aparición de la excepción `ArgumentNullException: Value cannot be null. Parameter name: obj` originada en el método `StartCoroutine_Auto` de DelayedActionManager[^19]. Este error no constituye un fallo interno de Unity, sino que surge de la asincronía entre el recolector de basura de C# (Garbage Collector) y la gestión de punteros nativos en el código C++ subyacente[^19].

En Unity, objetos como GameObject o MonoBehaviour son en realidad clases proxy escritas en C# que mantienen una referencia interna hacia el objeto nativo asignado en C++ dentro del motor[^19]. Cuando el programador invoca `Destroy(gameObject)`, el objeto C++ se destruye de inmediato y su memoria se devuelve al sistema, convirtiendo en nula la referencia interna[^19]. Sin embargo, el envoltorio proxy de C# puede seguir existiendo en la memoria administrada durante un tiempo hasta que el recolector de basura realice un barrido[^19].

El desastre ocurre cuando los desarrolladores utilizan expresiones anónimas (lambdas/closures) combinadas con los procesos asíncronos de Addressables. Una expresión lambda tiene la propiedad de «capturar» las variables de su contexto circundante. Considérese el siguiente patrón de código:

```csharp
// Una acción añadida a la cola de DelayedActionManager
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

Cuando se ejecuta este código, la variable `_crawlerRobot` (un proxy de C#) queda capturada por la clausura[^19]. Si la lógica del juego destruye `_crawlerRobot` en ese mismo fotograma, el puntero C++ subyacente desaparece. Pero como DelayedActionManager ha programado la ejecución de esta lambda en la fase `LateUpdate` (o en un fotograma posterior), cuando la lambda se dispara finalmente, intenta acceder al miembro `BreakAwayLowerBody()` de un puntero C++ ya muerto[^19]. La consecuencia inevitable es que el sistema lanza una excepción `NullReferenceException` o el mensaje de error «El objeto ha sido destruido, pero sigues intentando acceder a él»[^19].

Para mitigar este riesgo arquitectónico, los especialistas en software recomiendan dos soluciones de diseño:

1. Evitar el abuso de expresiones lambda anidadas (lambdas nesting) al gestionar cambios de estado de bajo nivel[^19].
2. Realizar siempre comprobaciones seguras de nulidad, aprovechando que Unity ha sobrecargado (overloaded) el operador `==` de C# para verificar directamente el estado del puntero C++ subyacente[^19].

### Conflictos de PlayerLoop y el Error «Assertion failed on expression: ShouldRunBehaviour()»

Durante la gestión de versiones de los paquetes Addressables, un gran número de desarrolladores informó de que el Editor de Unity se inundaba con un mensaje de error de bajo nivel: `Assertion failed on expression: 'ShouldRunBehaviour()'` en el archivo `MonoBehaviour.cpp`[^3].

La traza de pila (stack trace) indica que este proceso se origina directamente en el GameObject «DelayedActionManager» ubicado en la escena DontDestroyOnLoad[^3]. El análisis de causa raíz (Root Cause Analysis) revela un fallo en el manejo del flujo de reproducción (Play Mode) del Editor de Unity. Cuando el editor pasa por una recompilación de dominio (Domain Reload) o cuando el usuario pulsa Detener (Stop) antes de que finalicen las cargas pendientes de recursos, DelayedActionManager queda atrapado como un objeto huérfano (orphaned object)[^3].

Al estar marcado como DontDestroyOnLoad, intenta seguir ejecutando ciclos de `LateUpdate` y comprobaciones de comportamiento (behaviour checks) aunque el entorno nativo de ejecución de Unity (PlayerLoop) ya haya ordenado detener todas las tareas[^3]. Este fallo se documentó con mayor gravedad en la transición del paquete Addressables 1.16.x a 1.18.x, obligando a muchos equipos de desarrollo a regresar manualmente a la versión 1.17.17 para garantizar la estabilidad de la API síncrona y eliminar los bloqueos de cola[^3].

### La Evolución de DelayedActionManager en el Historial de Versiones

Un dato curioso al investigar la documentación de la API y los registros de cambios (changelogs) de Unity Addressables es la presencia cíclica de DelayedActionManager. Versiones como la 0.7.5 y la 1.11.2 anunciaron explícitamente en sus notas de actualización la refactorización de la interfaz de scripts de compilación con el aviso: «Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading»[^20]. Esta decisión buscaba inicialmente simplificar la capa de la API y transferir el control a la clase personalizable `AsyncOperationBase`[^20].

No obstante, los informes de errores de versiones posteriores a LTS (Long-Term Support) como la 1.18.15, 1.19.19 y 1.21.21 dejaron al descubierto el regreso continuo de `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` en las trazas de pila[^11]. Esto refleja la filosofía de diseño iterativo de Unity: tras retirarlo para simplificar el paquete, los ingenieros del sistema comprendieron que carecer de un gestor centralizado de tareas diferidas generaba dificultades insalvables para recopilar eventos de diagnóstico (`DiagnosticEventCollector`), procesar tablas de precarga (preload tables) y garantizar la seguridad de la memoria al cerrar la aplicación[^11]. DelayedActionManager fue rediseñado y restaurado como una utilidad interna del sistema, sin exponerse en la interfaz pública pero encargado de resolver los riesgos de liberación (disposal) al apagar la aplicación[^20].

## Mecanismo de Conteo de Referencias y Dinámica de Fugas de Memoria

La existencia de DelayedActionManager está estrechamente ligada a uno de los pilares más complejos de Addressables: el Sistema de Gestión de Memoria (Memory Management). A diferencia de depender exclusivamente del recolector de basura, Addressables controla la permanencia de los datos en la memoria RAM mediante el Conteo de Referencias (Reference Counting)[^23].

### Dinámica de Referencias y Jerarquía de Dependencias

Cada vez que el sistema recibe una petición para cargar un recurso, el contador de referencias de dicho recurso se incrementa en uno. Al concluir su uso, la llamada `Addressables.Release` instruye al sistema para reducir dicho contador[^23]. La regla de oro es que la memoria física que aloja el recurso solo puede liberarse cuando el contador de referencias alcanza exactamente el valor cero[^23].

La complejidad aumenta exponencialmente porque Addressables gestiona las dependencias a través de la arquitectura AssetBundle. Al cargar un recurso (por ejemplo, un material), el sistema no carga únicamente ese material, sino también todos los AssetBundles que contienen sus elementos dependientes (por ejemplo, una textura)[^25]. El grafo de dependencias (dependency graph) se calcula a nivel de Bundle, lo que significa que si un recurso del Bundle A referencia a un recurso del Bundle B, todo el Bundle B debe cargarse en la memoria del host[^26].

La limitación técnica más estricta de Unity en esta arquitectura es que **el usuario no puede descargar parcialmente (partially unload) el contenido de un AssetBundle**[^23]. Para ilustrarlo, supóngase un AssetBundle llamado «stuff» que contiene tres recursos independientes: Árbol, Tanque y Vaca[^23].

1. Cuando se carga el recurso Árbol, el analizador de memoria (Profiler) muestra una referencia para Árbol y una referencia correspondiente para el bundle `stuff`[^23].
2. Cuando se carga a continuación el recurso Tanque, el contador de Tanque sube y el contador de `stuff` aumenta a 2[^23].
3. Si el juego ejecuta `Release(Árbol)`, el contador de Árbol baja a 0 y su barra azul desaparece en el Profiler[^23].
4. Sin embargo, los datos físicos de Árbol permanecen intactos en la memoria del sistema. Dado que Tanque sigue manteniendo activa la conexión que conserva el contador del AssetBundle `stuff` por encima de 0, no se permite destruir ningún recurso de este bundle hasta que todo el bundle quede liberado por completo[^23].

### El Síndrome de «Asset Churn» e Hinchazón de Memoria (Memory Bloat)

El fenómeno en el que los recursos se cargan y se liberan continuamente para volver a cargarse de inmediato en un corto intervalo de tiempo se define como «Asset Churn» (rotación agresiva de recursos)[^23]. Este problema suele aparecer durante las transiciones entre niveles. Supóngase que el Nivel 1 utiliza el recurso Barco y el Nivel 2 utiliza el recurso Avión (ambos comparten la textura Camuflaje). Al salir del Nivel 1, el desarrollador libera Barco, lo que provoca que Addressables descargue de inmediato la textura Camuflaje de la memoria. Un milisegundo después, cuando el Nivel 2 instancia Avión, el sistema obliga al disco duro a realizar de nuevo el ciclo de E/S para recargar esa misma textura Camuflaje desde cero[^23]. Este proceso genera picos pronunciados en el tiempo de fotograma y eleva el uso de memoria hasta umbrales peligrosos, especialmente en hardware móvil[^27].

Por otro lado, omitir una llamada a `Release` provoca la acumulación de referencias residuales, haciendo que la ocupación de RAM pase de cientos de megabytes a varios gigabytes tras unos pocos cambios de escena[^28]. Puesto que ni DelayedActionManager ni el propio Addressables rastrean el número de instancias creadas mediante el método `Instantiate` puro de MonoBehaviour, cualquier descuido en el seguimiento de los identificadores de memoria generará una fuga de memoria permanente[^6].

### Arquitectura de Compresión de Datos y Presión de Asignación de Memoria

El tamaño de los AssetBundles y el método de compresión de datos influyen directamente en cómo residen los datos en la RAM. Elegir el algoritmo de compresión adecuado determina si un AssetBundle ocupará un gran bloque de memoria de manera permanente o si podrá optimizar el ancho de banda.

Tabla resumen de las características de los algoritmos de compresión de AssetBundles y su impacto en el almacenamiento[^29]:

| Algoritmo de Compresión | Capacidad de Lectura Parcial Local | Requiere Cargar el Bundle Completo en RAM | Impacto en Rendimiento y Almacenamiento |
| :--- | :--- | :--- | :--- |
| **LZMA** | No. El bundle se comprime en un único bloque monolítico. | **Sí.** Debe descomprimirse todo el archivo en memoria. | Mayor tasa de compresión y menor tamaño de descarga, pero provoca hinchazón aguda de memoria (Memory Bloat) y un alto consumo de CPU al extraer[^29]. |
| **LZ4** | Sí. Compresión por bloques (chunk-based). | **No.** Solo carga las porciones a las que se está accediendo. | Recomendado como estándar predeterminado. Permite el almacenamiento en caché directo en disco local sin cargar todos los metadatos en RAM[^29]. |
| **Uncompressed** | Sí. Acceso independiente por cada recurso. | **No.** Acceso directo. | Sin coste de tiempo de descompresión, pero genera el mayor tamaño de archivo. Óptimo para carga instantánea si el ancho de banda del disco lo permite[^29]. |

Cuando se solicita un recurso minúsculo contenido en un enorme AssetBundle comprimido con LZMA, el archivo entero (incluidas cabeceras, metadatos y tablas de streaming) debe transferirse del disco duro a la memoria RAM[^27]. Este error de diseño convierte los AssetBundles gigantescos en bombas de relojería capaces de provocar cierres por falta de memoria (OOM crashes) en la aplicación[^27].

## Buenas Prácticas (Best Practices) en la Gestión de Recursos

Para dominar la complejidad del sistema de conteo de referencias y reducir la carga sobre DelayedActionManager, los arquitectos de sistemas deben aplicar una estructura de ciclo de vida sumamente rigurosa, combinada con técnicas de optimización de activos.

### 1. Sincronización del Ciclo de Inicialización y Liberación

Todo objeto `AsyncOperationHandle` devuelto por la API debe liberarse obligatoriamente al finalizar su ciclo de vida de uso[^6]. No hacerlo no solo causa fugas de memoria, sino que también puede provocar caídas del sistema[^6]. La siguiente tabla ilustra las operaciones simétricas obligatorias al programar con Addressables:

| Método de Inicialización / Carga | Método de Liberación Correspondiente | Funcionamiento Interno |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | Resta 1 al contador de referencias del AssetBundle que lo contiene[^6]. |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | Destruye el objeto instanciado (Instance) y resta automáticamente 1 al contador del Prefab original[^4]. |
| Asignación mediante `AssetReference` | `reference.ReleaseAsset()` | Equivalente a invocar Release mediante el handle; limpia las referencias estáticas[^6]. |

En particular, al utilizar ScriptableObjects para almacenar configuraciones del juego, referenciar directamente un objeto (`public Object _worldAsset`) genera referencias fuertes (hard references), forzando al sistema a cargar ese recurso entero en RAM de inmediato[^27]. La solución óptima consiste en usar AssetReference (`public AssetReference addressableAsset;`) para habilitar la carga asíncrona bajo demanda (on-demand loading)[^6].

### 2. Intervención de Bajo Nivel: Resources.UnloadUnusedAssets()

Ante un callejón sin salida en el que los AssetBundles compartidos quedan bloqueados en memoria debido a la propiedad de «no descarga parcial» (por ejemplo, el recurso Árbol atrapado junto a Tanque), la única vía de escape es recurrir a una API forzada de la capa base del motor: `Resources.UnloadUnusedAssets()`[^25].

Esta función ejecuta un escaneo profundo por toda la RAM para detectar cualquier recurso (incluidos los ocultos dentro de AssetBundles) cuyo número real de referencias internas (actual engine references) sea exactamente 0, y los destruye de forma forzosa[^25]. No obstante, se trata de una operación sumamente costosa para el rendimiento computacional, que produce severas caídas de fotogramas (FPS drops) porque la CPU debe detener el hilo lógico para llevar a cabo el barrido de limpieza[^27]. Los ingenieros solo deben invocarla durante transiciones prolongadas con pantallas de carga (loading screens), o dejar que el sistema la ejecute automáticamente al cambiar de escena con `SceneManager.LoadScene`[^29].

### 3. Planificación y Segmentación de AssetBundles (Bundle Packing Modes)

La organización de los grupos (Groups) en la configuración de Addressables determina directamente el rendimiento de carga en memoria y el consumo de ancho de banda. Escoger el modo de empaquetado (Bundle Mode) adecuado para cada tipo de recurso es un paso de diseño crucial[^6]:

* **Pack Together (Empaquetado Conjunto)**: Se emplea para recursos con ciclos de vida estrechamente ligados que siempre aparecen de forma simultánea. Reduce el coste de analizar el grafo de dependencias y las operaciones de E/S en red[^6].
* **Pack Separately (Empaquetado Individual)**: Óptimo para recursos enormes e independientes, o grandes mapas en los que no puede garantizarse que vayan a cargarse juntos. Elimina el riesgo de que un recurso pesado impida liberar otros recursos más pequeños[^6].
* **Pack Together By Label (Empaquetado por Etiqueta)**: Permite agrupar recursos dispersos mediante metadatos de etiquetas (por ejemplo, asignar la etiqueta «Halloween 2023» para reunir todo el contenido de un evento en un único bundle y actualizarlo fácilmente vía CDN)[^6].

Para reducir aún más el peso de la tabla de índices (TypeTree) en el AssetBundle, el programador puede activar la opción `BuildAssetBundleOptions.DisableWriteTypeTree`. Esta característica elimina metadatos innecesarios, aunque exige reconstruir los grupos locales (rebuild local groups) antes de generar el ejecutable si cambian las estructuras serializadas[^26].

### 4. Gestión de Memoria de Audio y Gráficos (Graphics & Audio)

Optimizar las capas auxiliares es la medida más eficaz para disminuir la frecuencia de intervención del recolector de basura. La configuración del modo de carga de los flujos de audio repercute directamente en la memoria[^27]:

* **Música de fondo (BGM) larga**: Debe configurarse en modo Streaming para ir cargando pequeños búferes desde el disco[^27].
* **Efectos de sonido largos**: Seleccionar Compressed In Memory para mantenerlos comprimidos en RAM y descomprimirlos en tiempo real al reproducirse[^27].
* **Efectos de sonido cortos o de alta frecuencia**: Utilizar Decompress On Load para disponer directamente de los datos sin comprimir, eliminando la carga de CPU[^27].

Además, desactivar la opción «Read/Write enabled» en las texturas y configurar la eliminación del búfer de profundidad (Depth Stencil Format a None) en las cámaras de interfaz de usuario (UI) reducirá al menos en un 50 % la cantidad innecesaria de RAM de renderizado[^27].

## Conclusión sobre la Interacción Global

El estudio sobre DelayedActionManager no solo descifra el origen de un objeto oculto dentro de la escena DontDestroyOnLoad, sino que revela la filosofía de diseño fundamental del sistema Addressables en Unity. Esta clase ComponentSingleton actúa como un sutil puente temporal que preserva la integridad de los datos al redirigir los procesos de liberación, las llamadas asíncronas y el manejo de colas hacia el ciclo LateUpdate. Aísla las alteraciones en la estructura de memoria frente a las interrupciones que podrían causar el código de físicas o la lógica de control en el flujo de Update, erigiéndose en un escudo contra las excepciones que corrompen el sistema al cambiar de escena.

Sin embargo, DelayedActionManager no es una varita mágica capaz de resolver las debilidades intrínsecas de la arquitectura de gestión de memoria. Impone a los arquitectos de software la exigencia estricta de mantener un ciclo completamente simétrico de carga y liberación de recursos, diseñar expresiones anónimas de C# (lambdas) que eviten capturar objetos nativos de C++ ya liberados y modularizar la estructura de los AssetBundles para prevenir fugas de memoria persistentes. Mediante una comprensión profunda del enrutamiento de carga asíncrona, el uso adecuado de métodos de compresión como LZ4 y la potencia forzada de `Resources.UnloadUnusedAssets`, los equipos de desarrollo pueden diseñar arquitecturas sólidas y altamente escalables en todas las plataformas sin tener que enfrentarse al temor de un agotamiento permanente de los recursos.

## **Referencias**

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

### Lecturas recomendadas

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
