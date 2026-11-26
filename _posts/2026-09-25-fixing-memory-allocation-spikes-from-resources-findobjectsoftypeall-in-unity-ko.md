---
title: "Unity 성능 최적화: Resources.FindObjectsOfTypeAll로 인한 메모리 할당(GC Alloc) 이해 및 해결"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: Unity에서 Resources.FindObjectsOfTypeAll을 과도하게 사용할 때 프레임 스파이크(끊김 현상)가 발생하는 원인과 이를 해결하는 가장 정확한 4가지 최적화 기법을 초보자를 위해 상세히 안내합니다.
lang: ko
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

Unity로 게임을 개발하다 보면 특정 `GameObject`나 `Component`를 찾아야 하는 상황을 반드시 겪게 됩니다. Unity는 이를 위해 `Find`, `FindObjectOfType`, 그리고 특히 `Resources.FindObjectsOfTypeAll` 같은 다양한 함수를 제공합니다.

`Resources.FindObjectsOfTypeAll`은 비활성화된(inactive) 오브젝트, 프로젝트 폴더 안의 프리팹(prefab), 아직 스폰되지 않은 에셋까지 **모든 것**을 찾아낼 수 있어 매우 강력하지만, 올바르게 사용하지 않으면 게임 성능을 서서히 갉아먹는 조용한 "킬러" 중 하나이기도 합니다.

이 글에서는 이 함수가 왜 위험한지, 프로파일링 도구(Profiler / Project Auditor)가 어떻게 경고를 띄우는지 이해하고, 메모리 쓰레기(Garbage Collection Allocation — GC Alloc)를 완전히 제거하기 위한 최적화 방법들을 자세히 살펴보겠습니다.

---

## **1. `Resources.FindObjectsOfTypeAll`은 왜 성능에 해로울까요?**

Unity Memory Profiler나 Project Auditor를 실행해 보면 노란색(Moderate) 경고를 마주칠 수 있습니다:
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

그 이유를 이해하려면 이 함수가 엔진 내부(C++ 코어)에서 어떻게 동작하는지 살펴볼 필요가 있습니다:

1. **전체 메모리 스캔 (높은 CPU 비용)**: 현재 씬(Scene)에서 활성화된 오브젝트만 스캔하는 `FindObjectOfType`과 달리, `Resources.FindObjectsOfTypeAll`은 엔진의 **전체** 메모리를 스캔합니다. 모든 씬 오브젝트, 에디터 오브젝트(에디터에서 실행 중인 경우), 그리고 RAM에 로드된 모든 에셋(Assets)을 순회합니다. 프로젝트 규모가 커질수록 이 함수의 실행 속도는 점점 느려집니다.
2. **메모리 쓰레기 생성 (GC Allocation)**: 이 함수가 실행을 마칠 때마다 반환 결과를 담기 위해 C#의 Managed Heap에 **항상** 새로운 배열(Array)을 할당합니다.

**결과:** 이 함수를 반복적으로 호출하면(예: `Update()` 내부나 UI 버튼을 누를 때마다) 메모리에 계속해서 쓰레기(더 이상 쓰지 않는 이전 배열)를 버리게 됩니다. 쓰레기가 쌓이면 Unity의 가비지 컬렉터(Garbage Collector - GC)가 강제로 동작하게 됩니다. 이 정리 작업 동안 게임이 순간적으로 멈추면서 플레이어에게 매우 불쾌한 **버벅임(stuttering)** 현상을 유발합니다.

---

## **2. 4가지 최적화 방법 (모범 사례)**

이 문제를 근본적으로 해결하려면 상황에 따라 Unity 최적화 엔지니어들이 정리한 다음 4가지 검증된 방법 중 하나를 적용할 수 있습니다.

### **방법 1: Inspector를 통한 직접 참조 (가장 권장됨)**
CPU와 RAM 비용을 0으로 만드는 가장 빠른 방법은 **아예 검색하지 않는 것**입니다. 코드로 오브젝트를 찾는 대신, `public` 또는 `[SerializeField]` 변수를 선언하고 Unity Inspector 창에서 해당 오브젝트를 드래그 앤 드롭으로 연결하세요.

```csharp
// ❌ 피해야 할 방식: 비용이 큰 검색 호출
void Start() {
    // 이 호출은 GC Alloc을 발생시킵니다
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ 최선의 방식: Inspector 직접 참조
[SerializeField] private GameManager myManager; 
// (Unity 에디터에서 이 슬롯에 GameManager를 드래그 앤 드롭)
```

### **방법 2: 캐싱(Caching)과 싱글톤(Singleton)**
반드시 코드로 찾아야 하는 경우라면 **단 한 번만 검색**하고(예: `Awake()` 또는 `Start()`에서), 이후 재사용할 수 있도록 변수에 저장(캐시)해 두어야 합니다.

`UIManager`나 `AudioManager`처럼 공용으로 쓰이는 시스템에는 싱글톤(Singleton) 패턴이나 정적 프로퍼티(Static Property)를 사용해 검색 비용 없이 전역에서 접근할 수 있도록 하세요.

```csharp
// ❌ 피해야 할 방식: 텍스트가 필요할 때마다 매번 검색 함수 호출
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ 더 나은 방식: static 변수에 캐싱 (단 1회만 검색)
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // 1회만 검색
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // 즉시 재사용, 비용 0
}
```

### **방법 3: Unity 6의 최신 API로 업그레이드**
과거 Unity 2023 초기 버전에서 `FindObjectsOfType`을 대체할 때는 `FindObjectsSortMode` 열거형(enum)을 사용했습니다:
```csharp
// ⚠️ 구버전 (Unity 2023.1 - 2023.2):
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```
하지만 **Unity 6부터는 `FindObjectsSortMode` 열거형이 공식적으로 사용 중단(Deprecated / Obsolete) 처리되었습니다.** 엔진이 32비트 `InstanceID`에서 새로운 오브젝트 식별 체계로 전환하면서 성능을 극대화하기 위해 정렬 과정을 제거했기 때문입니다.

Unity 6 공식 문서에 따라 다음과 같은 표준 오버로드(overload)를 사용하는 것이 좋습니다:

```csharp
// ❌ 구버전 (Unity 2022 이하 - 느리고 배열을 강제로 정렬함)
var managers = FindObjectsOfType<GameManager>();

// ✅ Unity 6 표준: 임의의 오브젝트 1개 가져오기 (가장 빠름, Zero-Alloc)
// 힙에 배열을 할당하지 않고, 찾은 첫 번째 오브젝트를 즉시 반환합니다
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Unity 6 표준: 여러 오브젝트 목록 가져오기 (Obsolete된 SortMode 매개변수 불필요)
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **팁:** Manager나 Controller처럼 인스턴스가 하나뿐이라면 `FindFirstObjectByType<T>()`보다 `FindAnyObjectByType<T>()`가 훨씬 효율적입니다. 하이어라키(Hierarchy) 순서를 따지지 않고 처음 발견한 오브젝트를 즉시 반환하기 때문입니다.

#### ⚠️ **흔한 오해: `Resources.FindObjectsOfTypeNonAlloc`이 존재할까요?**
많은 개발자가 Unity의 배열 재사용 함수(`Physics.RaycastNonAlloc`이나 `GetComponentsNonAlloc` 등)에 익숙해져 `Resources`에도 비슷한 `NonAlloc` 함수가 있을 거라 생각합니다.
실제로 Unity 공식 문서에 따르면 **`Resources.FindObjectsOfTypeNonAlloc`이라는 함수는 전혀 존재하지 않습니다.** `Resources.FindObjectsOfTypeAll`은 호출될 때마다 **항상** Managed Heap에 새로운 배열을 생성합니다.

씬 내의 모든 오브젝트 목록을 추적하면서도 **완벽한 0 GC Alloc을 달성**하려면 **정적 등록 패턴(Static Registration Pattern)**을 사용하세요:

```csharp
// ✅ Zero GC Alloc 해결책: 활성화될 때 정적 리스트에 스스로 등록
public class Enemy : MonoBehaviour 
{
    // 새로운 할당 없이 메모리를 재사용하는 공용 정적 리스트
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// 게임 내 어디서든 접근이 필요할 때:
// Enemy.ActiveEnemies를 직접 사용 — Find보다 수십 배 빠르며 완벽한 0 GC Alloc!
```

### **방법 4: 에디터 도구용 코드는 `#if UNITY_EDITOR`로 감싸기(Wrap)**
가끔 Asset Store에서 받은 플러그인(예: 애니메이션 시스템, UI 도구 등) 내부에 `Resources.FindObjectsOfTypeAll`이 포함되어 있는 경우가 있습니다. 대개 이러한 호출은 개발 환경(Editor)에서 편의 기능 버튼을 동작시키기 위한 용도입니다.

이 함수들이 최종 게임 빌드(Build Player)에 섞여 들어가 경고를 발생시키는 것을 막으려면, 전처리기 지시문 `#if UNITY_EDITOR`로 감싸 주세요. 이렇게 하면 게임을 빌드할 때 내부 코드가 완전히 제거됩니다.

```csharp
#if UNITY_EDITOR 
// 이 코드는 Unity 에디터에서 작업할 때만 실행됩니다
// .exe, .apk 파일로 빌드할 때는 완전히 제거됩니다
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. 실전 예제: 게임 프로젝트에서 근본적으로 해결하기**

실제 프로젝트에서 어떻게 적용하는지 이해하기 위해, 서드파티 에셋 패키지로 인해 Unity Project Auditor나 Profiler가 메모리 할당 경고를 띄우는 가장 흔한 두 가지 사례를 살펴보겠습니다:

### **사례 1: 언어를 바꿀 때마다 RAM을 전체 스캔하는 UI 로컬라이제이션 시스템**
* **문제점**: UI 텍스트를 표시하거나 인터페이스 사운드를 재생할 때마다 유틸리티 함수가 `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]`을 호출합니다. 이로 인해 메뉴를 여는 매 동작마다 전체 RAM을 스캔하고 힙에 쓰레기 배열을 생성하게 됩니다.
* **해결 방법**:
  1. 초기화 시점(`Awake`)에 `FindAnyObjectByType<UIManager>()`를 사용해 단 한 번만 찾습니다.
  2. 참조를 캐싱할 수 있도록 정적 프로퍼티 `SharedUIManager`를 만들어, 검색 작업을 **0바이트 쓰레기**로 즉시 접근하는 $O(1)$ 연산으로 바꿉니다.

```csharp
// ❌ 최적화 전: 함수가 호출될 때마다 전체 메모리를 스캔하고 가비지 생성
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ 최적화 후: 정적 캐시 활용 (Zero GC Alloc)
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // 게임 전체에서 빠르게 접근하기 위한 캐시
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // Unity 6 API를 사용해 배열 할당 없이 단 1회만 검색
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// 텍스트가 필요한 곳 어디서든 캐시를 통해 호출:
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **사례 2: 서드파티 에디터 유틸리티가 게임 빌드에 포함되는 경우**
* **문제점**: 많은 툴 패키지(예: 애니메이션, 레벨 디자인 시스템)에는 에디터의 Reset이나 Setup 버튼을 지원하기 위한 `Resources.FindObjectsOfTypeAll` 리소스 검색 함수가 들어 있습니다. 실제 게임플레이에서는 호출하지 않더라도, 이 코드가 런타임 코드에 그대로 노출되어 있으면 Unity가 게임 빌드(Player)에 GC Alloc 경고를 표시합니다.
* **해결 방법**: 해당 검색 코드 블록 전체를 전처리기 지시문 `#if UNITY_EDITOR`로 감싸 주세요. 게임을 실행 파일(`.exe`, `.apk`)로 빌드할 때 Unity가 런타임에서 이 코드들을 자동으로 완전히 제거해 줍니다.

```csharp
// ❌ 최적화 전: 에디터용 리소스 검색 코드가 런타임에 그대로 노출됨
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ 최적화 후: 전처리기 지시문 #if UNITY_EDITOR로 감싸기
#if UNITY_EDITOR
// 이 블록은 Unity 에디터에서만 존재하며, 게임 빌드 시 100% 제거됩니다
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **결론**

Unity를 처음 접하는 분들에게 "메모리 쓰레기"(GC Allocation)는 C#이 자동으로 정리를 해주는 덕분에 꽤 추상적인 개념으로 느껴질 수 있습니다. 하지만 게임 프로그래밍에서는 쓰레기를 계속 만들어 내면 화면상에서 눈에 띄는 끊김 현상으로 직결됩니다.

황금률: **`Update()` 같은 루프나 자주 호출되는 이벤트 안에서는 `Find` 계열 함수(특히 `Resources.FindObjectsOfTypeAll`)를 멀리하세요.** Inspector를 통한 직접 참조를 우선 사용하고, 캐싱(Cache / Singleton)을 적극 활용하며, Unity 6 표준 API(`FindAnyObjectByType`)로 업그레이드하고, 에디터 전용 유틸리티 코드는 `#if UNITY_EDITOR`로 감싸세요. 이러한 작은 부분부터 최적화하면 게임이 모든 기기에서 안정적인 60 FPS를 유지하는 데 큰 도움이 될 것입니다!
