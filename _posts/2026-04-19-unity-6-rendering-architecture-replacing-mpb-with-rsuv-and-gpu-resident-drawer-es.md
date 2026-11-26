---
title: "Arquitectura de renderizado en Unity 6: Sustituir MPB por RSUV y GPU Resident Drawer"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: "Análisis exhaustivo de la transición arquitectónica de MaterialPropertyBlock a RSUV y GPU Resident Drawer para alcanzar un rendimiento AAA en Unity 6."
lang: es
translation_id: unity6-material-rsuv-grd
math: true
---

## **Resumen ejecutivo**

La transición a Unity 6 marca un cambio arquitectónico fundamental en la forma en que los pipelines de renderizado (*render pipelines*) procesan geometría instanciada de gran volumen. Históricamente en el desarrollo de videojuegos, la optimización de múltiples objetos que comparten un único material pero requieren variaciones de propiedades individuales (como tintes de color — *color tints*) dependía de la API `MaterialPropertyBlock` (MPB) combinada con el sistema estándar de *GPU Instancing*. Sin embargo, un análisis en profundidad del Universal Render Pipeline (URP) y del High Definition Render Pipeline (HDRP) en Unity 6 revela que este enfoque heredado (*legacy*) ya no es el camino óptimo y, en muchos escenarios, provoca una degradación grave del rendimiento.

La evaluación del borrador documental proporcionado para el «Long Gil Studio DevLog» muestra una mezcla entre teoría de optimización heredada válida en versiones anteriores y una comprensión errónea crítica sobre las funciones modernas de renderizado de Unity 6. En concreto, la recomendación del borrador de usar `MaterialPropertyBlock` entra en conflicto directo con la nueva tecnología **GPU Resident Drawer (GRD)** de Unity 6 y la API subyacente **BatchRendererGroup (BRG)**.[^1] Para lograr el máximo rendimiento de renderizado, los desarrolladores deben adoptar obligatoriamente **Renderer Shader User Value (RSUV)** o migrar por completo a **Data-Oriented Technology Stack (DOTS)**.[^3]

Este informe técnico ofrece un análisis minucioso de los cuellos de botella de renderizado, el funcionamiento del Scriptable Render Pipeline (SRP) Batcher, las consecuencias sistémicas de la duplicación de materiales y los patrones modernos necesarios para alcanzar un rendimiento de nivel AAA en Unity 6. Además, incluye un artículo técnico revisado y redactado profesionalmente para su publicación en Long Gil Studio DevLog.

## **Parte I: Evaluación técnica del borrador original de Long Gil Studio**

El texto del borrador inicial plantea un problema de renderizado muy específico: optimizar una escena (*Scene*) con incontables objetos idénticos que comparten un único material pero requieren modificaciones de color individuales. El borrador identifica correctamente los antipatrones (*anti-patterns*), pero prescribe una solución que degrada el rendimiento dentro del contexto arquitectónico de Unity 6.

### **Aciertos del borrador original**

1. **Penalización por duplicación de materiales (Material Duplication):** El borrador señala correctamente que crear instancias de material independientes para cada objeto (por ejemplo, mediante `GetComponent<Renderer>().material.color`) provoca un inflado de memoria (*memory bloat*) y destruye por completo la agrupación de llamadas de dibujo (*draw call batching*).[^5] Acceder a la propiedad `.material` obliga al motor Unity a clonar silenciosamente ese material, perdiendo de forma permanente la capacidad del SRP Batcher o del GPU Instancing para agrupar estos objetos en una única llamada SetPass.[^5]
2. **Mecánica de MaterialPropertyBlock (MPB):** El borrador identifica con precisión que MPB actúa como un búfer de sobreescritura de datos (*data override buffer*), permitiendo al renderer pasar propiedades por instancia (*per-instance*) a la GPU sin crear un nuevo clon del material.[^7]
3. **Propiedades de cadena (String) frente a identificadores enteros (Integer IDs):** El borrador destaca acertadamente la latencia de la Unidad Central de Procesamiento (CPU) generada al usar cadenas de texto para buscar propiedades de shader, defendiendo la inicialización previa de identificadores enteros mediante `Shader.PropertyToID()` para optimizar los bucles críticos.[^7]

### **Inexactitudes críticas y paradigmas obsoletos**

1. **MPB como «estándar AAA» en Unity 6:** El fallo más significativo del borrador original es afirmar que MPB representa la solución «AAA» óptima para Unity 6. Aunque MPB era el estándar en el Built-In Render Pipeline (arquitectura heredada), actúa como un agente disruptivo en las arquitecturas SRP modernas.[^8] Aplicar un MPB a un GameObject expulsa inmediatamente a ese objeto del flujo del SRP Batcher.[^10]
2. **Dependencia del GPU Instancing heredado:** El borrador reconoce que MPB rompe el SRP Batcher y propone recurrir al GPU Instancing tradicional como alternativa de respaldo. Aunque técnicamente es viable rompiendo manualmente la compatibilidad con SRP y activando el Instancing, esto obliga al motor a eludir la arquitectura SRP altamente optimizada.[^12]
3. **Omisión del GPU Resident Drawer (GRD):** Unity 6 introduce el GPU Resident Drawer, un sistema que delega la generación de llamadas de dibujo (*draw calls*) a *compute shaders*, reduciendo la carga de CPU hasta en un 50 %.[^14] La presencia de un `MaterialPropertyBlock` prohíbe estrictamente que un GameObject participe en GRD.[^1] Recomendar MPB en Unity 6 impide, en esencia, que los proyectos aprovechen la nueva herramienta de optimización más potente del motor.
4. **Omisión de Renderer Shader User Value (RSUV):** Introducido en Unity 6.3 LTS, RSUV es el reemplazo arquitectónico directo de MPB cuando se gestionan variaciones simples por objeto.[^15] RSUV permite pasar un entero de 24 bits al shader para cada renderer sin romper el SRP Batcher ni el GPU Resident Drawer.[^3]

## **Parte II: Análisis fundamental de los cuellos de botella en el renderizado**

Para comprender por qué determinadas llamadas a la API destruyen la tasa de fotogramas (*frame rate*), es necesario examinar el modelo de comunicación entre la Unidad Central de Procesamiento (CPU) y la Unidad de Procesamiento Gráfico (GPU). La arquitectura de hardware moderna exige una sincronización estrecha pero sensible a la latencia entre ambos procesadores.

### **Sobrecarga de comunicación CPU-GPU (Overhead)**

El proceso de renderizar un fotograma requiere que la CPU recorra todos los objetos visibles dentro del campo de visión de la cámara (*frustum culling*), determine las propiedades de sus materiales, vincule (*bind*) las texturas y shaders necesarios en la memoria de la GPU y emita un comando de dibujo (*draw command*). La operación más costosa en este pipeline no es la rasterización de polígonos por parte de la GPU, sino los cambios de estado obligatorios previos a la llamada de dibujo, denominados habitualmente llamadas **SetPass**.[^5]

Cada vez que la CPU encuentra un material distinto, debe detener el pipeline de renderizado para cargar los nuevos parámetros en la GPU.[^18] Si una escena contiene 10 000 enemigos y cada enemigo posee una instancia de material única para mostrar un color de armadura diferente, la CPU debe realizar 10 000 cambios de estado. Esto genera una enorme sobrecarga de CPU (*CPU Overhead*), provocando un cuello de botella en el que la GPU permanece inactiva esperando instrucciones de la CPU.

### **Fragmentación de memoria de la propiedad `.material`**

Cuando un script accede a `Renderer.material` para cambiar un color, el motor está obligado a proteger la integridad del recurso (*asset*) compartido original. Para ello ejecuta una llamada interna `Instantiate()` sobre ese material. Esto acarrea dos penalizaciones graves para el rendimiento:

1. **Destrucción del Batching:** El objeto deja de compartir la referencia de material con sus homólogos. De inmediato, Unity desactiva cualquier forma de Static Batching, Dynamic Batching o SRP Batching para dicho objeto.[^5] La tarjeta gráfica tendrá que procesarlo como una entidad totalmente independiente.
2. **Recolección de basura (Garbage Collection) y fugas de memoria (Memory Leaks):** El nuevo clon del material se crea en la memoria gestionada (*Heap*) de C#. No se recolecta automáticamente cuando el objeto es destruido. A menos que el desarrollador invoque explícitamente `Destroy(renderer.material)`, esa memoria permanece asignada. Esto genera fugas de memoria que obligan al recolector de basura (*Garbage Collector* - GC) a disparar ciclos de *Mark-and-Sweep*, causando tirones graves (*spikes*) y caídas repentinas de FPS.[^5]

## **Parte III: Arquitectura del SRP Batcher y obsolescencia del GPU Instancing tradicional**

El Scriptable Render Pipeline (SRP) reorganizó de raíz la forma en que Unity gestiona los datos de los shaders. Comprender el SRP Batcher resulta esencial para valorar por qué los métodos antiguos de optimización fracasan por completo en Unity 6.

### **Cómo funciona el SRP Batcher**

En los pipelines antiguos (*Built-in*), los materiales subían datos a la GPU mediante variables uniformes independientes (*separate uniform variables*). El SRP Batcher sustituye este método usando grandes búferes persistentes en la GPU denominados Búferes de Constantes (**Constant Buffers - CBUFFERs**).[^11]

La arquitectura SRP obliga a los shaders a dividir sus variables en dos bloques de búfer distintos 11:

* `UnityPerMaterial`: Un CBUFFER que contiene las propiedades compartidas por todos los objetos que utilizan el mismo material (por ejemplo: color base, mapas metálicos — *metallic maps*, rugosidad).
* `UnityPerDraw`: Un CBUFFER que contiene las propiedades exclusivas de una llamada de dibujo específica (por ejemplo: las matrices de transformación espacial del objeto — *transformation matrices*).

Dado que el búfer `UnityPerMaterial` persiste de forma continua en la memoria de la GPU, la CPU ya no necesita volver a subir las propiedades del material dentro del bucle de renderizado mientras los objetos consecutivos compartan la misma variante de shader (*shader variant*).[^18] El SRP Batcher simplemente vincula (*bind*) este búfer persistente y actualiza únicamente el búfer `UnityPerDraw`, mucho más pequeño. Este diseño reduce drásticamente el coste de CPU, llegando a acelerar el rendimiento de renderizado entre 1,2x y 4x.[^21]

### **El conflicto fundamental con `MaterialPropertyBlock`**

La API `MaterialPropertyBlock` se diseñó originalmente para sobrescribir propiedades de material a nivel de renderer. Sin embargo, dado que el SRP Batcher depende de la separación estricta y la persistencia del CBUFFER `UnityPerMaterial`, inyectar un MPB infringe directamente esta disposición de memoria.[^8]

Cuando se aplica un MPB, Unity ya no puede garantizar que el búfer persistente del material se aplique de forma uniforme al objeto. En consecuencia, el motor se ve obligado a expulsar abruptamente al objeto del pipeline del SRP Batcher.[^9] La documentación oficial de Unity confirma explícitamente: «Ten en cuenta que esta función no es compatible con el SRP Batcher. Usar MPB en URP o HDRP probablemente provocará una caída de rendimiento».[^8]

### **La solución de respaldo heredada: `Graphics.DrawMeshInstanced`**

Históricamente, si un desarrollador necesitaba variaciones masivas por instancia (por ejemplo, un bosque con árboles de distintos colores), aceptaba perder el SRP Batcher y recurría al GPU Instancing.[^12] Esto exigía romper manualmente la compatibilidad SRP del shader declarando una propiedad fuera del búfer `UnityPerMaterial` y activando la casilla «Enable GPU Instancing» en el material.[^13]

Aunque el GPU Instancing reduce las llamadas de dibujo pasando matrices de transformación y matrices de color, conlleva limitaciones severas.[^12] Sufre problemas con un *overdraw* elevado, exige mallas (*meshes*) idénticas y impone una fuerte carga a la CPU para recopilar y subir los arrays de instancias (*instance arrays*) en cada fotograma. En Unity 6, este método ha sido reemplazado por completo por la arquitectura GPU Resident Drawer.[^23]

## **Parte IV: Incompatibilidad de `MaterialPropertyBlock` (MPB) con el ecosistema de Unity 6**

Un análisis más profundo de MPB revela que no solo rompe el SRP Batcher, sino que también introduce riesgos estructurales para las herramientas de depuración (*debugging tools*) y los sistemas de iluminación (*lighting systems*) en Unity 6.

### **Impacto en los datos de Lightmap y Global Illumination**

Una de las consecuencias menos mencionadas del uso incorrecto de MPB es la eliminación de los datos de Lightmap. Cuando creas un `new MaterialPropertyBlock()` y lo asignas mediante `Renderer.SetPropertyBlock()`, el bloque de propiedades que pasas sobrescribe por completo el estado local del renderer.[^24]

Si tu objeto utiliza Global Illumination (GI) precalculada (*baked*), la información sobre las coordenadas UV del Lightmap y los coeficientes de Light Probe se almacena implícitamente dentro del propio bloque de propiedades del renderer.[^24] Si no llamas a `Renderer.GetPropertyBlock(block)` antes de establecer el color, borrarás accidentalmente la información de iluminación del objeto. Aunque el borrador original de Long Gil Studio gestionó bien la parte de `GetPropertyBlock`, el propio acto de invocar esta API repetidamente sobre miles de objetos introduce una latencia adicional de CPU nada despreciable.

| Técnica de optimización | Causa fuga de RAM | Compatible con SRP Batcher | Compatible con GRD | Compatible con DOTS | Uso recomendado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`Material.color`** | Sí | No | No | No | Evitar a toda costa |
| **`MaterialPropertyBlock`** | No | No | No | No | Proyectos Built-in antiguos |
| **GPU Instancing** | No | No (Conflicto) | No | No | Unity 2020-2022 |
| **Renderer Shader User Value** | No | Sí | Sí | Sí | Estándar Unity 6.3+ |

Como muestra la tabla anterior, MPB es ya una técnica de generación pasada. Resuelve el problema de la memoria RAM, pero destruye todo el pipeline de renderizado moderno de Unity 6.

## **Parte V: El punto de inflexión arquitectónico: GPU Resident Drawer (GRD) y `BatchRendererGroup` (BRG)**

Unity 6 introduce una ruta de renderizado revolucionaria: el **GPU Resident Drawer**. Este sistema transforma el paradigma desde la generación de llamadas de dibujo controlada por la CPU hacia un bucle de renderizado altamente autónomo impulsado por la GPU.[^1]

### **Arquitectura del GPU Resident Drawer**

El GPU Resident Drawer funciona sobre la API de bajo nivel `BatchRendererGroup` (BRG).[^1] En lugar de que la CPU evalúe qué objetos son visibles (*frustum culling*) y envíe llamadas de dibujo individuales o instanciadas, la CPU sube todos los datos espaciales y de materiales de la escena a la GPU.[^25] A continuación, los *compute shaders* ejecutan el descarte de objetos fuera de cámara, el descarte por oclusión (*occlusion culling*) y la generación de llamadas de dibujo íntegramente en la GPU.[^14]

El incremento de rendimiento es extraordinario. Mediante el renderizado indirecto (`DrawInstancedIndirect`), la carga de trabajo de CPU requerida para renderizar puede reducirse hasta en un 50 % en escenas complejas.[^14] Además, cuando se combina con GPU Occlusion Culling, el procesamiento de triángulos puede reducirse casi en un 90 %, mientras que el tiempo de fotograma de la GPU (*frame buffer time*) se reduce a menos de la mitad.[^28]

### **La API `BatchRendererGroup` (BRG) y el Culling**

Detrás de GRD se encuentra `BatchRendererGroup`. BRG requiere inicializarse con una función *callback* `OnPerformCulling`.[^30] Aquí, la CPU solo necesita configurar la visibilidad (*visibility*) y emitir las llamadas de dibujo en formato de array. Los datos del objeto (transformaciones, colores, banderas) se suben a un `GraphicsBuffer`.[^25] Esto permite enviar millones de triángulos a la GPU con apenas unas pocas llamadas SetPass.

### **Incompatibilidad crítica de MPB con GRD**

El dato más importante relativo a la optimización en Unity 6 es la fragilidad de los requisitos de elegibilidad para el GPU Resident Drawer. Para que un objeto sea procesado por GRD, debe cumplir estrictas reglas de disposición de datos.[^2]

La documentación oficial de Unity 6.1+ declara explícitamente que los GameObjects que utilizan la API `MaterialPropertyBlock` quedan excluidos inmediatamente del GPU Resident Drawer.[^1] Asimismo, el objeto no debe tener scripts que empleen *callbacks* por instancia como `OnRenderObject`.[^2]

Cuando un desarrollador adjunta un MPB para cambiar el color de un objeto, obliga inadvertidamente al motor a revertir al modo de renderizado heredado basado en CPU para ese objeto específico. Si esto se hace sobre 10 000 unidades en un juego de estrategia en tiempo real, la sobrecarga de CPU se dispara de forma vertiginosa, anulando por completo las ventajas de actualizar al motor Unity 6.

## **Parte VI: El estándar moderno: Renderer Shader User Value (RSUV) en Unity 6.3**

Al reconocer el callejón sin salida arquitectónico generado por la incompatibilidad de MPB con los pipelines modernos, Unity introdujo **Renderer Shader User Value (RSUV)** en la versión Unity 6.3 LTS.[^15] RSUV actúa como el reemplazo definitivo de `MaterialPropertyBlock` cuando los desarrolladores necesitan aplicar personalizaciones simples por instancia en múltiples renderers que comparten un mismo material.[^3]

### **Cómo funciona RSUV**

RSUV evita las complejas modificaciones de búfer que penalizan a MPB. En su lugar, aprovecha un canal entero de 24 bits sumamente eficiente que se transmite directamente junto con los datos de dibujo estándar del renderer.[^3] Debido a que este entero está integrado en la estructura de datos existente en lugar de requerir una sobreescritura de búfer independiente, mantiene una compatibilidad absoluta tanto con el SRP Batcher como con el GPU Resident Drawer.[^3]

### **Implementación y codificación bit a bit (Bitwise Encoding)**

Para usar RSUV en variaciones de color, la CPU debe empaquetar los valores RGB deseados en un único entero sin signo de 24 bits (`uint`). Cada canal de color (Rojo — *Red*, Verde — *Green*, Azul — *Blue*) ocupa 8 bits (proporcionando valores de 0 a 255).[^3]

La operación de codificación utiliza operadores de desplazamiento bit a bit a la izquierda (`<<`) y OR bit a bit (`|`). La expresión matemática se representa así:

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

En la implementación práctica en C#, iterar sobre un array de componentes `MeshRenderer` para aplicar tintes de color aleatorios ofrece un rendimiento altísimo y cero asignaciones de memoria basura (*zero garbage allocation*)[^3]:

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // Calcular un color aleatorio (usando el espacio HSV para colores más vivos)  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // Codificar RGB en un entero de 24 bits (Azul, Verde, Rojo)  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // Aplicar el valor directamente al renderer mediante la nueva API de Unity 6.3
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **Decodificación en el Shader (Shader Decoding)**

En el lado de la GPU, el shader debe desempaquetar (*unpack*) este entero de 24 bits para devolverlo a un valor de color `float4` normalizado. Unity proporciona la variable integrada `unity_RendererUserValue` para acceder a este bloque de datos.[^3]

El proceso de decodificación utiliza el operador de desplazamiento bit a bit a la derecha (`>>`) y el operador AND bit a bit (`&`) con una máscara de bits de `255` para aislar cada segmento de 8 bits. A continuación, se multiplica por el inverso de 255 (`1.0 / 255.0`) para normalizar el valor al rango entre `0.0` y `1.0`.[^3]

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

En High-Level Shader Language (HLSL) o mediante un nodo Custom Function en Shader Graph, la lógica de desempaquetado se expresa así 3:

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // Canal Rojo (Red)  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // Canal Verde (Green)  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // Canal Azul (Blue)  
    1.0 // Alfa fijo  
);
```

Este cambio de paradigma demuestra una estrategia de optimización profunda: intercambiar complejidad de estructuras de datos (como MPB) por cálculo matemático puro (RSUV). Los procesadores de la GPU sobresalen en operaciones bit a bit, lo que significa que el coste de decodificación es casi nulo (un coste mínimo en ciclos de reloj — *clock cycles*). Al mismo tiempo, preservar los flujos del SRP Batcher y del GPU Resident Drawer genera reducciones enormes en el tiempo de fotograma (*frame-time*).[^16]

## **Parte VII: Solución a escala extrema: DOTS, ECS y `URPMaterialPropertyOverride`**

Para proyectos que operan a una escala que supera la capacidad de procesamiento de los GameObjects estándar (por ejemplo, simulaciones de multitudes con cientos de miles de unidades independientes — *boids*, enormes ejércitos de RTS), la tecnología Data-Oriented Technology Stack (DOTS) de Unity proporciona la arquitectura de renderizado definitiva.[^4]

### **Gestión de memoria orientada a datos (Data-Oriented Memory)**

A diferencia de las limitaciones del enfoque orientado a objetos, donde los GameObjects quedan dispersos por el Heap, las entidades (*entities*) en el Entity Component System (ECS) residen íntegramente en arrays contiguos de datos en memoria.[^4] Esta disposición de memoria encaja a la perfección con la estructura que exige la API `BatchRendererGroup` (BRG) para lograr el máximo rendimiento.

Dentro del paquete Entities Graphics, los desarrolladores pueden utilizar el componente `URPMaterialPropertyOverride`.[^4] Este sistema permite sobrescribir propiedades de material por entidad (*per-entity material overrides*) sin recurrir jamás a la perjudicial API `MaterialPropertyBlock`.

### **Cómo funciona el DOTS Instancing**

Cuando se procesa una entidad en DOTS, el shader configurado para DOTS Instancing (marcando *Override Property Declaration* y seleccionando *Hybrid Per Instance* en Shader Graph) recibe un único entero de 32 bits (un valor de metadatos — *metadata value*).[^34] Este entero representa un desplazamiento (*offset*) ubicado dentro de un `GraphicsBuffer` persistente en la GPU.[^34]

El shader utiliza este offset para leer los datos de propiedad específicos de la instancia que está renderizando en ese momento.[^34] Lo que distingue a DOTS Instancing es que, si múltiples entidades comparten el mismo valor de propiedad, DOTS Instancing les permite leer ese valor desde exactamente la misma ubicación de memoria (el mismo offset), ahorrando ciclos de GPU (*GPU cycles*) y minimizando la duplicación de memoria.[^34] Como las propiedades se cargan mediante offset en lugar de confinarse en los búferes de constantes tradicionales, el tamaño de una llamada de dibujo deja de estar estrictamente limitado, permitiendo recuentos de instancias masivos.

```csharp
// Ejemplo de asignación de valores RSUV mediante el sistema DOTS / Burst Compile 

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // Procesar en paralelo asignando valores directamente a un NativeArray  
        // Ofreciendo una velocidad de ejecución que MonoBehaviour jamás podrá alcanzar.  
    }  
}
```

Modificar los valores de componentes de entidad a través de *Bursted Background Jobs* (trabajos en segundo plano compilados con Burst Compiler) puede ejecutarse a una velocidad asombrosa.[^4] Puedes hacer que las vallas cambien de color según la inclinación del terreno, o que la hierba cambie de tono en función de la altitud, todo dibujado en un único flujo de llamadas de dibujo sin cuellos de botella.[^4]

## **Parte VIII: Análisis de soluciones alternativas (Alternative Solutions)**

El borrador original de Long Gil Studio mencionaba brevemente técnicas de optimización alternativas. El siguiente análisis confirma su viabilidad, pero las sitúa dentro de las restricciones físicas del motor Unity 6.

1. **Vertex Colors (Colores de vértice en la malla):**
   * *Mecánica:* Codificar los datos de color directamente en los vértices (*vertices*) de la malla 3D. El shader lee el atributo `TEXCOORD` o `COLOR` desde la malla.
   * *Eficacia:* Extremadamente ligero y preserva a la perfección todas las funciones de *batching*, así como la compatibilidad con GRD.[^36]
   * *Debilidad:* Cambiar los colores de vértice en tiempo de ejecución (*runtime*) requiere manipular el array de datos de la malla (`mesh.colors`). Esta acción crea una copia de la malla en la RAM, provocando paradas de CPU (*CPU stalls*) y asignaciones de memoria basura. El coloreado por vértice sigue siendo óptimo únicamente para variaciones estáticas precalculadas (*baked*) en software como Blender o Maya.
2. **Texture Atlasing y UV Offsets:**
   * *Mecánica:* Consolidar múltiples variaciones de color en un único atlas de texturas (*texture atlas*) y desplazar las coordenadas UV de los diferentes objetos para muestrear píxeles específicos.[^36]
   * *Eficacia:* Esta técnica mantiene un único material y una única textura, garantizando compatibilidad total con el SRP Batcher.[^36]
   * *Debilidad:* Al igual que los colores de vértice, alterar dinámicamente las coordenadas UV en distintos objetos en tiempo de ejecución (*runtime*) suele exigir la creación de instancias de malla (*mesh instances*) únicas, generando inflado de memoria (*memory bloat*). Sin embargo, para el diseño de entornos estáticos o juegos de vóxeles (como Minecraft), esta técnica es imbatible.
3. **Low-Level `Graphics.DrawMeshInstanced` (GPU a bajo nivel):**
   * *Mecánica:* Omitir por completo la jerarquía de GameObjects para enviar directamente matrices de transformación y arrays de color a la GPU mediante código C#.[^37]
   * *Eficacia:* Ofrece un rendimiento enorme para sistemas como algoritmos de bandadas (*flocking*) o vegetación procedural (*procedural foliage*).[^38]
   * *Debilidad en Unity 6:* La llegada de la API `BatchRendererGroup` y el GPU Resident Drawer ha democratizado este rendimiento, eliminando la necesidad de escribir código complejo de *culling* y envío de dibujo en la gran mayoría de escenarios habituales.[^19] Mantener un sistema `DrawMeshInstanced` personalizado cuesta hoy más recursos de ingeniería que dejar que el GPU Resident Drawer lo automatice.

## **Parte IX: Estructura de contenido propuesta para Long Gil Studio DevLog**

Basándose en el proceso de evaluación técnica integral, el siguiente texto presenta el artículo DevLog propuesto, completamente revisado y redactado con estándares de ingeniería de alto nivel. Abandona el enfoque defectuoso de MPB y guía al lector hacia los verdaderos estándares arquitectónicos de Unity 6: RSUV y GPU Resident Drawer.

---

**Unity 6: Optimizar miles de objetos que comparten un material – Dejar atrás MPB hacia la arquitectura moderna**

**Por Long Gil Studio**

**🇻🇳 EDICIÓN EN VIETNAMITA (Traducida al español)**

**1. El cuello de botella de renderizado: el problema de la duplicación de materiales**

Durante el desarrollo de videojuegos a gran escala surge un reto arquitectónico sumamente habitual: «¿Cómo cambiar el color de miles de objetos que comparten un mismo material sin desplomar los FPS?».

Muchos programadores suelen recurrir a `GetComponent<Renderer>().material.color`. Esto es un error fatal (*anti-pattern*). Llamar a `.material` obliga a Unity a crear silenciosamente un clon de ese material en la RAM. La consecuencia es una fuga de memoria grave, disparos continuos de recolección de basura (*Garbage Collection*) y la destrucción total del sistema de Batching. La GPU queda infrautilizada mientras la CPU se sobrecarga procesando miles de Draw Calls individuales.

**2. La trampa heredada: por qué MaterialPropertyBlock ha «muerto» en Unity 6**

Antes, la solución «profesional» consistía en usar `MaterialPropertyBlock` (MPB) para pasar datos por objeto sin clonar el material. **Pero si estás usando Unity 6 (URP/HDRP), debes abandonar este método de inmediato.**

Unity 6 depende enormemente del flujo del **SRP Batcher** y de una tecnología revolucionaria: **GPU Resident Drawer (GRD)**. GRD traslada todo el pipeline de procesamiento de renderizado (generación de Draw Calls y Culling) a *Compute Shaders* en la GPU, logrando reducir hasta en un 50 % el tiempo de cálculo de la CPU. Sin embargo, según la documentación central del motor, en cuanto adjuntas un `MaterialPropertyBlock` a un objeto, ese objeto queda expulsado al instante del SRP Batcher y pierde por completo la compatibilidad con el GPU Resident Drawer. Usar MPB equivale a forzar a Unity a volver al pipeline heredado, lento y costoso en CPU para todas tus tropas.

**3. El nuevo estándar de Unity 6: Renderer Shader User Value (RSUV)**

Para resolver de raíz este bloqueo, la actualización Unity 6.3 LTS introdujo **Renderer Shader User Value (RSUV)**. Esta API permite pasar directamente un entero de 24 bits al renderer. Como RSUV no requiere asignar nuevos búferes (*buffers*), mantiene el 100 % de compatibilidad tanto con el SRP Batcher como con el GPU Resident Drawer.

**Paso 1: Codificación en C# (Zero Garbage Allocation)**

En lugar de usar cadenas (*strings*) como MPB, codificaremos el color RGB en un entero de 24 bits mediante operaciones de desplazamiento de bits (*bitwise*):

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Codificar los 3 canales Azul, Verde y Rojo en un entero de 24 bits  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Aplicar el valor (¡Totalmente seguro para la arquitectura SRP y GRD!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Paso 2: Decodificación en Shader Graph**

Dentro de Shader Graph, crea un nodo **Custom Function** (Type: String, Name: DecodeColor) con salida Vector4. Pega el siguiente fragmento HLSL para desempaquetar el entero de vuelta a un color estándar:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Conecta esta salida al pin Base Color del Fragment Shader. Ahora dispones de infinitas variaciones de color con latencia de CPU cero y aprovechando al máximo la potencia del sistema GPU Resident Drawer.

**Ejemplo: Implementación real en un script de Shader (sin Shader Graph)**

Si escribes un shader personalizado en código (HLSL), puedes intervenir en la función `BuildSurfaceData` para decodificar `unity_RendererUserValue` y multiplicarlo por `BaseColor` tal como muestra el siguiente código:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Decodificar RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // Aplicar el color rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ... 
}
```

*Consulta más detalles en:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Superar los 100 000 objetos: la solución DOTS / ECS**

Si tu juego exige renderizar cientos de miles de unidades independientes (como ejércitos gigantescos), el sistema tradicional de GameObjects acabará creando inevitablemente un cuello de botella en la CPU por muy bien que optimices el renderizado. Para esa escala, da el salto a la arquitectura Unity DOTS. Utilizar el componente `URPMaterialPropertyOverride` permite establecer una disposición de memoria Data-Oriented que se comunica directamente con la API de bajo nivel `BatchRendererGroup`, ofreciendo un rendimiento inigualable de auténtico nivel AAA.

---

**🇺🇸 VERSIÓN EN INGLÉS (Traducida al español)**

**1. El cuello de botella del renderizado: duplicación de materiales**

Al desarrollar juegos de alta densidad surge un desafío arquitectónico habitual: «¿Cómo cambio el color de miles de objetos que comparten el mismo material sin arruinar el rendimiento?».

Los desarrolladores suelen recurrir por defecto a `GetComponent<Renderer>().material.color`. Este es un antipatrón fatal. Acceder a `.material` obliga a Unity a clonar silenciosamente el material en el *heap* gestionado. Esto genera un grave inflado de memoria, provoca picos de recolección de basura y destruye el *batching* de *draw calls*, elevando la sobrecarga de CPU a niveles inmanejables mientras deja inactiva a la GPU.

**2. La trampa heredada: por qué MaterialPropertyBlock está muerto en Unity 6**

Históricamente, la solución «Pro» era usar un `MaterialPropertyBlock` (MPB) para pasar datos por instancia sin clonar materiales. **Si estás usando Unity 6 (URP/HDRP), debes dejar de usar este método de inmediato.**

Unity 6 se apoya intensamente en el **SRP Batcher** y en el nuevo y revolucionario **GPU Resident Drawer (GRD)**. El GRD delega el *frustum culling* y la generación de *draw calls* a *compute shaders* de la GPU, reduciendo el tiempo de renderizado en CPU hasta en un 50 %. Sin embargo, según la documentación oficial del motor, aplicar un `MaterialPropertyBlock` a un objeto lo descalifica de inmediato del SRP Batcher y rompe por completo su compatibilidad con el GPU Resident Drawer. Al usar MPB, obligas a Unity a retroceder a una ruta de renderizado heredada, lenta y dependiente de la CPU para tus enormes ejércitos.

**3. El estándar de Unity 6: Renderer Shader User Value (RSUV)**

Para resolver este bloqueo arquitectónico, Unity 6.3 LTS introduce **Renderer Shader User Value (RSUV)**. Esta API permite pasar un entero de 24 bits directamente a la carga de datos base del renderer. Al evitar modificar los búferes constantes persistentes, RSUV mantiene un 100 % de compatibilidad tanto con el SRP Batcher como con el GPU Resident Drawer.

**Paso 1: Codificación en C# (Zero Memory Allocation)**

En lugar de pasar cadenas y crear bloques, empaquetamos matemáticamente un color RGB en un entero sin signo de 24 bits usando operaciones bit a bit:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Codificar los canales Azul, Verde y Rojo en un único entero de 24 bits  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Aplicar el valor de forma nativa (¡100 % seguro para SRP y GRD!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Paso 2: Decodificación en el Shader**

Dentro de tu Shader Graph, crea un nodo **Custom Function** (Type: String, Name: DecodeColor) con una salida Vector4. Pega este código HLSL para desempaquetar el entero de vuelta a un color *float* normalizado:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Conecta esta salida a la entrada Base Color de tu fragmento. Ahora tienes infinitas variaciones de color sin penalizaciones en *draw calls*, mientras aprovechas al máximo el GPU Resident Drawer.

**Ejemplo: Implementación real en un Shader personalizado (sin Shader Graph)**

Si estás escribiendo un shader personalizado mediante código (HLSL), puedes modificar la función `BuildSurfaceData` para decodificar `unity_RendererUserValue` y multiplicarlo con `BaseColor` tal como se muestra en el siguiente bloque:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Decodificar RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // Aplicar rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ...
}
```

*Véase también:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Ir más allá de los 100 000 objetos: DOTS / ECS**

Si tu juego requiere renderizar cientos de miles de unidades dinámicas, los GameObjects estándar acabarán creando un cuello de botella en el hilo principal de la CPU sin importar las optimizaciones gráficas. Para escalas masivas, da el paso a Unity DOTS. El uso del componente `URPMaterialPropertyOverride` permite disposiciones de memoria estrictamente orientadas a datos (*Data-Oriented*). Esto interactúa directamente con la API de bajo nivel `BatchRendererGroup`, alcanzando un rendimiento puro de nivel AAA sin igual.

---

## **Parte X: Recomendaciones estratégicas para equipos de desarrollo**

El análisis de los modelos modernos de renderizado pone de manifiesto una importante brecha entre los conocimientos clásicos de optimización (*legacy*) y la arquitectura contemporánea del motor. La conclusión clave para los ingenieros gráficos es esta: modificar los búferes de datos (*data buffers*) por objeto resulta intrínsecamente hostil para la ejecución paralela y los bucles de renderizado impulsados por la GPU. No es posible trasladar la mentalidad de optimización de Unity 5.x o Unity 2019 a Unity 6.

Para alcanzar el máximo rendimiento en Unity 6, los equipos de desarrollo deben aplicar rigurosamente los siguientes protocolos:

1. **Auditar el uso de MPB (Audit for MPB Usage):** Deben desplegarse de forma continua herramientas de *profiling* (como Unity Profiler) y Frame Debuggers para localizar y erradicar los casos donde se aplique `MaterialPropertyBlock` sobre geometría instanciada masivamente (*mass-instanced geometry*). La comodidad a corto plazo de MPB queda totalmente superada por la pérdida sistemática del GPU Resident Drawer. Los equipos deben configurar advertencias en el código fuente o comprobaciones en CI/CD para detectar asignaciones innecesarias de MPB.
2. **Adoptar estrategias de codificación bit a bit (Bitwise Encoding Strategies):** Adoptar Renderer Shader User Value (RSUV) exige un cambio en la metodología de programación. Los artistas técnicos (*Technical Artists*) y programadores de *gameplay* deben colaborar para definir esquemas estrictos de empaquetado *bitwise* dentro del límite de 24 bits de RSUV. Es necesario garantizar que los diversos estados de datos (color, daño, ID de equipo — *team ID*) se serialicen de forma eficiente antes de llegar al renderer. Por ejemplo: se pueden asignar 4 bits para «ID de facción» (permitiendo 16 facciones), 8 bits para «Estado de daño» (permitiendo 256 niveles) y 12 bits para «Custom Tint» (color personalizado) — todo decodificado simultáneamente mediante máscaras de bits (*bitmasks*) dentro del shader.
3. **Evaluar umbrales de transición a ECS (Evaluate Thresholds for ECS Transition):** Aunque RSUV resuelve el cuello de botella de variación de materiales para GameObjects, siguen existiendo límites de CPU relacionados con la física, los cálculos de matrices de transformación (*transform calculations*) y el *culling* de GameObjects. Los proyectos que prevean superar las 10 000 entidades dinámicas activas (*dynamic agents*) deben diseñar de forma decidida y proactiva prototipos basados en DOTS (Entity Component System). Utilizar el componente `URPMaterialPropertyOverride`[^34] para comunicarse nativamente con la API `BatchRendererGroup` es la única vía para liberar todo el potencial del hardware de PC y consolas de nueva generación.

## **Referencias**

[^1]: Enable the GPU Resident Drawer in URP - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)  
[^2]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^3]: Set and use the RSUV - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)  
[^4]: Migrated my game to ECS/DOTS and material overrides are awesome! : r/Unity3D - Reddit, consultado el 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)  
[^5]: Why You Should Stop Swapping Materials in Unity (And What to Do Instead) - Medium, consultado el 19 de abril de 2026, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)  
[^6]: Material Property Blocks - using them to store the original color of a material upon instantiation : r/Unity3D - Reddit, consultado el 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)  
[^7]: Instancing and Material Property Blocks | Ronja's tutorials, consultado el 19 de abril de 2026, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)  
[^8]: Scripting API: MaterialPropertyBlock - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)  
[^9]: Unity 6 and custom material bug - Spine Forum, consultado el 19 de abril de 2026, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)  
[^10]: Scriptable Render Pipeline (SRP) Batcher - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)  
[^11]: Scriptable Render Pipeline Batcher - Unity 6.3 User Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)  
[^12]: GPU instancing - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)  
[^13]: Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)  
[^14]: Beginning Game Development: GPU Resident Drawer | by Lem Apperson - Medium, consultado el 19 de abril de 2026, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)  
[^15]: Introduction to RSUV - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)  
[^16]: Renderer Shader User Value sample - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)  
[^17]: Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, consultado el 19 de abril de 2026, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)  
[^18]: Scriptable Render Pipeline Batcher - Unity User Manual 2021.3 (LTS), consultado el 19 de abril de 2026, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)  
[^19]: Unity Draw Call Batching: The Ultimate Guide (2026 Update), consultado el 19 de abril de 2026, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)  
[^20]: Scriptable Render Pipeline Batcher - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)  
[^21]: SRP Batcher: Speed up your rendering - Unity, consultado el 19 de abril de 2026, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)  
[^22]: Remove SRP Batcher compatibility for GameObjects in URP - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)  
[^23]: GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D - Reddit, consultado el 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)  
[^24]: Scripting API: Renderer.GetPropertyBlock - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)  
[^25]: Create batches with the BatchRendererGroup API in URP - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)  
[^26]: Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)  
[^27]: Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, consultado el 19 de abril de 2026, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)  
[^28]: Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling - YouTube, consultado el 19 de abril de 2026, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)  
[^29]: Graphics Features and Tools in Unity 6 Feel Like MAGIC! STP, Resident Drawer, and Occlusion Culling! - YouTube, consultado el 19 de abril de 2026, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)  
[^30]: Initialize a BatchRendererGroup object in URP - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)  
[^31]: Boost performance of your game in Unity 6 with GPU Resident Drawer - The Knights of U, consultado el 19 de abril de 2026, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)  
[^32]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^33]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)  
[^34]: DOTS Instancing shaders in URP - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)  
[^35]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)  
[^36]: One Material multiple colors possible? : r/Unity3D - Reddit, consultado el 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)  
[^37]: Single-pass instanced rendering and custom shaders - Unity - Manual, consultado el 19 de abril de 2026, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)  
[^38]: Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, consultado el 19 de abril de 2026, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
