---
title: "심층 기술 보고서: Unity Addressables 환경에서 DelayedActionManager의 동작 메커니즘, 시스템 아키텍처 및 영향"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: "Unity Addressables에서 DelayedActionManager의 ComponentSingleton 아키텍처, LateUpdate 실행 메커니즘, C#/C++ 프록시 예외 처리 및 AssetBundle 메모리 최적화 전략에 대한 심층 분석."
lang: ko
translation_id: unity-addressables-delayedactionmanager
---

Addressable Asset System(줄여서 Addressables)은 기존의 전통적인 AssetBundles를 기반으로 유연하고 강력하며 최적화된 콘텐츠 관리 솔루션을 제공하는, Unity의 혁신적인 아키텍처적 도약을 대표합니다[^1]. 대규모 게임이나 인터랙티브 애플리케이션을 설계하고 운영하는 과정에서, 리소스를 자동으로 로드하고 해제하기 위한 비동기 데이터 파이프라인을 관리하는 일은 필수적인 요구 사항입니다. 이 복잡한 작업을 담당하는 핵심 컴포넌트 중 하나이지만, 소프트웨어 엔지니어들이 하이어라키(Hierarchy)를 분석할 때 자주 의아하게 여기는 것이 바로 `DontDestroyOnLoad` 씬 내부에 자동으로 생성되는 `DelayedActionManager`라는 이름의 오브젝트입니다[^2].

이 기술 보고서는 `DelayedActionManager`의 아키텍처적 본질을 전방위적으로 해부하여 `DontDestroyOnLoad` 공간에 존재하는 이유를 규명하고, Unity의 실시간 루프(PlayerLoop) 내부에서의 실행 메커니즘을 분석하며, 메모리 관리와 관련된 과제, 메모리 누수(memory leaks) 현상 및 자주 발생하는 스레드/생명주기 예외(exceptions)를 심층적으로 파헤칩니다. 시스템 설계 데이터와 모범 사례 분석을 통해, 본 문서는 소프트웨어 아키텍트가 애플리케이션의 안정성을 최적화할 수 있도록 깊이 있는 통찰을 제공합니다.

## 리소스 로딩 시스템의 진화와 비동기 기반

`DelayedActionManager`의 미시적 아키텍처를 깊이 살펴보기에 앞서, Addressables 시스템이 탄생한 배경을 이해하는 것이 선행 조건입니다. 초기 Unity 버전에서 개발자들은 주로 `Resources` 폴더에 의존하거나 원시 AssetBundle 스크립트를 직접 사용했습니다[^4]. `Resources.Load()` 메커니즘은 사용자가 직접 창고에 들어가 정확한 디렉터리 경로를 지정하는 것과 유사하게 동작하며, 리소스를 찾아 메모리에 적재할 때까지 실행 스레드(main thread)가 강제로 블로킹(block)됩니다[^4]. 이 방식의 단점은 애플리케이션의 확장성을 저해하고, 대용량 데이터를 처리할 때 심각한 프레임 드롭(FPS drop)을 유발한다는 점입니다.

이 문제를 해결하기 위해 Addressables는 현대적인 물류 배송 서비스처럼 동작합니다. 개발자는 리소스의 식별자(address/key)만 제공하면 되며, 시스템이 자동으로 라우팅하여 로컬 스토리지(Local)에서 리소스를 찾거나 콘텐츠 전송 네트워크(CDN - Content Delivery Network) 서버에서 다운로드합니다[^4]. 가장 중요한 점은 이 전체 주기가 비동기(asynchronous) 방식으로 진행된다는 것입니다. 대표적으로 `Addressables.LoadAssetAsync`와 같은 로드 호출은 오브젝트를 즉시 반환하지 않고 `AsyncOperationHandle`이라는 이름의 핸들(handle)을 반환합니다[^4]. 이 인터페이스는 리소스가 준비되었을 때 콜백(callback) 메커니즘을 제공하여, 애플리케이션의 메인 스레드가 물리 연산과 그래픽 렌더링 로직을 중단 없이 계속 처리할 수 있게 해줍니다[^4].

완전한 동기 모델에서 비동기 모델로의 이러한 전환은 중대한 아키텍처적 과제를 동반합니다. 느린 네트워크 대역폭으로 인해 리소스 다운로드가 완료되는 데 몇 초가 걸릴 때, 애플리케이션은 이미 완전히 다른 씬(scene)으로 전환되었을 수 있습니다[^1]. 콜백(callbacks), 작업 큐(command queues), 그리고 참조 카운터(reference counting)를 관리하려면 일반 씬의 생성/파괴 생명주기에 영향을 받지 않는 중앙 관리 주체가 필요합니다. 바로 이러한 이유 때문에 Unity 개발자들은 Addressables의 코어에 `DontDestroyOnLoad` 씬 모델을 통합했습니다.

## DontDestroyOnLoad (DDOL) 씬과 전역 영속성 아키텍처

Unity 환경에서 새로운 씬을 로드하는 작업(기본값인 Single 모드의 `SceneManager.LoadScene` 사용 시)은 자동으로 메모리 정리 메커니즘을 트리거합니다. 엔진은 더 이상 사용되지 않는 리소스를 확실히 해제하기 위해 이전 씬에 속한 모든 `GameObject`와 `Component`를 파괴(destroy)합니다[^7]. 추가 씬 로딩(Additive scenes) 기능을 통해 전역 상태를 관리하기 위해 여러 씬을 동시에 활성 상태로 유지할 수 있지만(예: Game Manager 전용 씬과 Level 전용 씬 분리), `DontDestroyOnLoad`(DDOL) 메커니즘은 여전히 저수준에서 오브젝트를 보호하는 핵심 시스템 기법으로 자리 잡고 있습니다[^7].

Play 버튼을 눌렀을 때 Unity 에디터 인터페이스에 `DontDestroyOnLoad` 씬이 나타나는 것은 버그가 아니라, 씬 전환 시 파괴되지 않도록 표시된 오브젝트들을 묶어주는 엔진의 기본 내장 메커니즘입니다[^9]. `GameObject`가 이 안전 구역에 들어가려면 Unity가 정한 필수 규칙을 따라야 합니다. 해당 오브젝트는 반드시 씬 계층 구조의 루트 레벨(root level)에 위치해야 합니다[^8]. 중첩된 자식 오브젝트(nested object)에 `DontDestroyOnLoad(gameObject)` 함수를 적용하려는 시도는 모두 실패하며 경고가 기록됩니다[^8].

Addressables 시스템의 경우 리소스 로드 및 해제 과정은 여러 씬에 걸쳐 생명주기를 유지하는 작업입니다. 예를 들어, 원격 서버에서 AssetBundle의 다운로드 상태를 추적하는 작업은 플레이어가 스테이지 전환 포탈을 통과했다는 이유만으로 도중에 취소될 수 없습니다. `RuntimeInitializeOnLoadMethod` 메커니즘과 고도화된 싱글톤(Singleton) 디자인 패턴을 결합함으로써, Addressables 소스 코드는 애플리케이션이 시작되자마자 루트 오브젝트를 자동으로 생성하여 DDOL 씬으로 편입시킬 수 있습니다[^2]. 이는 개발자가 DDOL과 관련된 코드를 단 한 줄도 작성하지 않았음에도 `"DelayedActionManager"`라는 이름의 오브젝트가 씬 목록 하단 왼쪽에 자동으로 나타나는 이유를 설명해 줍니다[^2].

## DelayedActionManager의 내부 구조와 기술적 역할

Addressables 패키지의 소스 코드와 API 문서를 심층 분석하면, `DelayedActionManager`는 `UnityEngine.ResourceManagement.Util` 네임스페이스 내부에 위치한 구체 클래스(concrete class)임을 알 수 있습니다[^11]. 이 구조는 단순한 정적 유틸리티 클래스(static utility class)가 아니라, 기반 아키텍처로부터의 상속을 통해 `GameObject`에 직접 부착되는 컴포넌트입니다[^12].

### ComponentSingleton 패턴과 초기화 자동화

`DelayedActionManager`의 아키텍처는 동일한 네임스페이스에 정의된 기반 클래스인 `ComponentSingleton` 디자인 패턴을 토대로 구축되어 있습니다[^13]. 순수 C# 클래스 대신 컴포넌트(Component) 위에 싱글톤 패턴을 구현함으로써, 시스템은 Unity의 실시간 이벤트 루프(`PlayerLoop`)와 직접 상호작용할 수 있는 능력을 갖추게 됩니다.

`ResourceManager`가 처음으로 로드 요청이나 상태 업데이트 요청(예: `Addressables.LoadAssetAsync` 또는 네트워크 진단 작업)을 수신하면 `DelayedActionManager` 인스턴스를 호출합니다. 이 시점에 `ComponentSingleton` 패턴은 빈 `GameObject`를 생성하고 이름을 `"DelayedActionManager"`로 지정한 뒤, 해당 스크립트 컴포넌트를 부착하고 즉시 `DontDestroyOnLoad` 함수를 호출하여 전역 보호 공간으로 이동시키는 일련의 숨겨진 절차를 자동으로 수행합니다[^2]. 이러한 지연 초기화(lazy initialization) 설계는 지연 작업 관리 기능이 실제로 요구될 때만 시스템 리소스를 소비하도록 보장하며, 에디터 화면에 이 오브젝트가 "마법처럼" 나타나는 현상에 대한 개발자들의 흔한 의문을 해소해 줍니다[^3].

### 스케줄링 메커니즘과 LateUpdate 단계 분석

`DelayedActionManager`의 핵심 임무는 지연된 액션, 콜백(callbacks), 코루틴 및 미시적 수준의 메모리 관리를 위한 중앙 스케줄러(central scheduler) 역할을 수행하는 것입니다[^11]. 아키텍처에서 미묘하지만 극히 중요한 차이점은 모든 큐 처리 로직이 Unity 생명주기의 `LateUpdate()` 함수 내부에서 실행되도록 라우팅된다는 점입니다[^11].

전통적인 `Update` 대신 `LateUpdate`를 선택한 설계는 데이터 일관성과 관련된 심오한 아키텍처 문제를 해결합니다. 다음 표는 Unity의 실행 순서와 Addressables 데이터를 보호하는 데 있어 `LateUpdate` 단계의 역할을 보여줍니다.

| 실행 단계 (PlayerLoop) | 일반적 기능 | Addressables 및 DelayedActionManager에서의 역할 |
| :--- | :--- | :--- |
| **FixedUpdate** | 물리 시뮬레이션, 정적/동적 충돌 처리. | 게임 로직이 충돌 이후 오브젝트 파괴 요청을 트리거할 수 있음. |
| **Update** | 플레이어 입력(Input), 이동, AI 로직, 게임 상태 업데이트. | `Addressables.LoadAssetAsync` 또는 `Release`가 수동으로 호출됨. 여기서 GameObject가 `Destroy()`될 수 있음. |
| **LateUpdate** | 카메라 위치 업데이트, 포스트 프로세싱(post-processing) 보정. | `DelayedActionManager`가 메모리를 정리하고 참조 카운터를 갱신하며, `Update` 단계의 파괴 명령과 충돌하지 않도록 비동기 콜백을 호출함[^11]. |

만약 `ResourceManager`가 `Update` 단계 도중에 작업 완료 콜백을 즉시 실행한다면, 프레임 계산이 아직 끝나지 않은 중간 상태의 시스템(예: 그래픽스 또는 UI 시스템)과 상호작용할 위험이 매우 커집니다. `OnComplete` 함수 호출이나 참조 카운트 감소(ref-count decrements) 실행을 `LateUpdate()`까지 지연(delaying)함으로써, `DelayedActionManager`는 현재 프레임의 전체 로직 상태가 안정화되었음을 보장합니다[^11]. 수많은 스택 트레이스(stack traces) 보고서 데이터는 `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` 함수가 사용자 코드로 제어권이 넘어가기 전의 마지막 완충 단계임을 보여줍니다[^15].

## 시스템 예외(System Exceptions)와 스택 트레이스(Stack Traces) 해부

높은 안전성을 염두에 두고 설계되었음에도 불구하고, 비동기 메커니즘의 복잡성과 개발자의 부적절한 생명주기 관리 작업이 결합되면 `DelayedActionManager`가 종종 심각한 예외의 중심에 놓이게 됩니다. 오류 보고서는 시스템이 관리되는 메모리(managed memory) 및 네이티브 메모리(native memory)와 어떻게 상호작용하는지에 대한 중요한 단서를 제공합니다.

### NullReferenceException 오류와 C# - C++ 프록시 생명주기 충돌

Addressables 환경에서 매우 흔한 오류 시나리오는 `DelayedActionManager`의 `StartCoroutine_Auto` 함수에서 발생하는 `ArgumentNullException: Value cannot be null. Parameter name: obj` 예외입니다[^19]. 이 오류는 Unity 내부의 결함이 아니라, C#의 가비지 컬렉션(Garbage Collector) 메커니즘과 하부 C++ 소스 코드의 원시 포인터 관리 간의 불일치에서 비롯됩니다[^19].

Unity에서 `GameObject`나 `MonoBehaviour`와 같은 오브젝트는 실제로는 엔진 내부의 C++로 할당된 네이티브 오브젝트를 가리키는 내부 참조를 보유한 C# 대리 클래스(proxy classes)입니다[^19]. 개발자가 `Destroy(gameObject)` 명령을 호출하면 C++ 오브젝트는 즉시 파괴되고 메모리가 반환되어 내부 참조가 null이 됩니다[^19]. 그러나 C# 프록시 클래스 자체는 가비지 컬렉터가 수거할 때까지 관리되는 메모리(managed memory) 내에 일정 시간 동안 계속 남아 있을 수 있습니다[^19].

재앙은 개발자가 Addressables의 비동기 프로세스와 함께 익명 표현식(lambdas/closures)을 사용할 때 발생합니다. 람다 표현식은 주변 컨텍스트 변수를 "캡처(capture)"하는 특성을 가지고 있습니다. 다음 코드 패턴을 살펴보겠습니다:

```csharp
// DelayedActionManager의 큐에 대기열로 추가되는 작업
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

이 코드가 실행될 때, 변수 `_crawlerRobot`(C# 프록시)은 클로저에 의해 캡처됩니다[^19]. 만약 게임 내 로직이 바로 그 프레임에서 `_crawlerRobot`을 파괴하면 하부 C++ 포인터는 사라집니다. 하지만 `DelayedActionManager`가 이 람다를 `LateUpdate` 단계(또는 이후 프레임)에 실행하도록 예약해 두었기 때문에, 람다가 실제로 트리거될 때 이미 죽어버린 C++ 포인터의 `BreakAwayLowerBody()` 멤버에 접근하려고 시도합니다[^19]. 그 필연적인 결과로 시스템은 `NullReferenceException` 예외나 `"오브젝트가 파괴되었지만 여전히 접근하려고 합니다"`라는 오류 메시지를 발생시킵니다[^19].

이러한 아키텍처적 위험을 해결하기 위해 소프트웨어 전문가들은 두 가지 설계 솔루션을 권장합니다:

1. 저수준 상태 변경을 처리할 때 람다 표현식의 과도한 중첩(lambdas nesting)을 피합니다[^19].
2. Unity가 하부 C++ 포인터 상태를 직접 검사하도록 C#의 `==` 연산자를 오버로딩(overloaded)했다는 점을 활용하여, 항상 안전한 null 검증 체크를 수행합니다[^19].

### PlayerLoop 충돌과 "Assertion failed on expression: ShouldRunBehaviour()" 오류

Addressables 패키지의 버전 관리 과정에서 수많은 개발자가 Unity 에디터(Unity Editor) 콘솔에 `MonoBehaviour.cpp` 파일의 저수준 오류 메시지인 `Assertion failed on expression: 'ShouldRunBehaviour()'`가 도배되는 현상을 보고했습니다[^3].

스택 트레이스(stack trace)는 이 과정이 `DontDestroyOnLoad` 씬 내부에 있는 `"DelayedActionManager"` GameObject에서 직접 비롯되었음을 가리킵니다[^3]. 근본 원인 분석(Root Cause Analysis) 결과, Unity 에디터의 플레이 모드(Play Mode) 스레드 처리 과정에서 발생한 결함이 드러났습니다. 에디터가 도메인 리로드(Domain Reload)를 거치거나 리소스 로드 처리가 완료되지 않은 상태에서 사용자가 게임 중지(Stop)를 누르면, `DelayedActionManager`가 고아 오브젝트(orphaned object) 상태로 갇히게 됩니다[^3].

`DontDestroyOnLoad`로 지정되어 있기 때문에, Unity의 네이티브 실행 환경(`PlayerLoop`)이 모든 작업 중단을 명령했음에도 불구하고 `LateUpdate` 주기와 동작 검사(behaviour checks)를 계속 실행하려고 시도합니다[^3]. 이 오류는 Addressables 1.16.x 패키지에서 1.18.x로 전환하는 과정에서 가장 심각하게 기록되었으며, 당시 많은 개발 팀이 동기 처리 API의 안정성을 확보하고 큐 정체 현상을 제거하기 위해 수동으로 1.17.17 버전으로 다운그레이드해야 했습니다[^3].

### 버전 역사 속 DelayedActionManager의 변천사

Unity Addressables의 API 문서와 변경 이력(changelogs) 연구에서 흥미로운 점은 `DelayedActionManager`의 주기적인 부침입니다. `0.7.5` 및 `1.11.2` 같은 버전에서는 업데이트 로그의 빌드 스크립트 인터페이스 리팩토링 공지에 *"Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading"*이라고 명시적으로 발표했습니다[^20]. 이 결정은 본래 API 계층을 단순화하고 제어권을 커스텀 `AsyncOperationBase` 클래스로 이양하기 위함이었습니다[^20].

그러나 `1.18.15`, `1.19.19`, `1.21.21`과 같은 포스트 LTS(Long-Term Support) 버전의 버그 리포트에서는 스택 트레이스에 `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()`가 지속적으로 재등장하는 모습을 보입니다[^11]. 이는 Unity의 반복적 설계(iterative design) 철학을 반영합니다. 즉, 간소화를 위해 제거한 후, 시스템 엔지니어들은 중앙 집중식 지연 작업 관리자의 부재가 진단 이벤트 수집(`DiagnosticEventCollector`), 프리로드 테이블(preload tables) 처리, 그리고 애플리케이션 종료 시 메모리 안전성 보장에 있어 극복하기 어려운 난제를 초래한다는 사실을 깨달았습니다[^11]. `DelayedActionManager`는 더 이상 공개 사용자 인터페이스에 노출되지 않지만 애플리케이션 종료 시 자원 해제(disposal) 위험을 처리하는 내부 시스템 유틸리티로 재설계되어 복원되었습니다[^20].

## 참조 카운팅 메커니즘과 메모리 누수 역학

`DelayedActionManager`의 존재는 Addressables의 가장 복잡한 기둥 중 하나인 메모리 관리(Memory Management) 시스템과 긴밀하게 연결되어 있습니다. 가비지 컬렉터에 전적으로 의존하는 것과 달리, Addressables는 참조 카운팅(Reference Counting) 메커니즘을 통해 RAM 상의 데이터 존재 여부를 제어합니다[^23].

### 참조 역학과 의존성 계층

시스템이 리소스 로드 요청을 받을 때마다 해당 리소스의 참조 카운터가 1씩 증가(increment)합니다. 사용이 끝나면 `Addressables.Release` 명령이 시스템에 이 카운터를 감소(decrement)시키도록 지시합니다[^23]. 황금률은 참조 카운터가 절대적으로 0으로 돌아갈 때만 리소스를 담은 물리 메모리의 해제가 허용된다는 것입니다[^23].

Addressables가 AssetBundle 아키텍처를 통해 의존성을 관리하기 때문에 복잡도는 기하급수적으로 증가합니다. 하나의 리소스(예: 머티리얼 - Material)를 로드할 때 시스템은 해당 머티리얼 자체만 로드하는 것이 아니라, 그에 의존하는 구성 요소(예: Texture)를 포함한 모든 AssetBundle을 자동으로 로드합니다[^25]. 의존성 그래프(dependency graph)는 번들(Bundle) 단위로 계산되므로, Bundle A의 리소스가 Bundle B의 리소스를 참조하면 Bundle B 전체가 호스트 메모리에 로드되어야 합니다[^26].

이 아키텍처에서 Unity가 가진 가장 엄격한 기술적 제약은 다음과 같습니다: **사용자는 AssetBundle 내용물의 일부만 부분 해제(partially unload)할 수 없습니다**[^23]. 이를 명확히 하기 위해 `"stuff"`라는 이름의 AssetBundle에 `나무(Tree)`, `탱크(Tank)`, `소(Cow)`라는 세 개의 독립적인 리소스가 들어 있다고 가정해 보겠습니다[^23].

1. `나무` 리소스가 로드되면, 메모리 프로파일러(Profiler)는 `나무`에 대한 참조 1개와 `stuff` 번들에 대한 해당 참조 1개를 표시합니다[^23].
2. 이어서 `탱크` 리소스가 로드되면, `탱크`의 카운터가 증가하고 `stuff`의 카운터는 2로 증가합니다[^23].
3. 게임에서 `Release(나무)` 명령을 실행하면, `나무`의 카운터는 0으로 떨어지고 프로파일러의 파란색 막대는 사라집니다[^23].
4. 그러나 `나무`의 물리적 데이터는 여전히 시스템 메모리에 그대로 남아 있습니다. `탱크`가 여전히 연결을 유지하여 `stuff` AssetBundle의 카운터가 0보다 크기 때문에, 번들 전체가 완전히 해제될 때까지 이 번들 내의 어떤 리소스도 파기될 수 없습니다[^23].

### "Asset Churn" 증후군과 메모리 비대화(Memory Bloat)

리소스가 짧은 시간 내에 반복적으로 로드되었다가 해제되고 곧바로 다시 로드되는 현상을 **"Asset Churn"**(리소스 쟁탈/교체 현상)이라고 정의합니다[^23]. 이 취약점은 주로 스테이지(level) 간 전환 시 발생합니다. 레벨 1에서 `보트(Boat)` 리소스를 사용하고 레벨 2에서 `비행기(Plane)` 리소스를 사용하며 두 리소스가 동일한 `위장(Camouflage)` 텍스처를 공유한다고 가정합시다. 레벨 1을 빠져나올 때 개발자가 `보트`를 해제하면 Addressables 시스템은 즉시 메모리에서 `위장` 텍스처를 언로드합니다. 1밀리초 뒤 레벨 2가 `비행기`를 생성하면, 시스템은 하드 디스크가 처음부터 그 `위장` 텍스처를 다시 로드하도록 I/O 주기를 강제로 실행하게 됩니다[^23]. 이 과정은 프레임 타임의 급격한 스파이크(spikes)를 유발하고 특히 모바일 하드웨어에서 메모리 사용량을 위험 수위까지 끌어올립니다[^27].

게다가 `Release` 명령을 하나라도 누락하면 가비지 참조가 누적되어, 단 몇 번의 씬 전환만으로도 RAM 점유율이 수백 메가바이트에서 기가바이트 수준까지 치솟게 됩니다[^28]. `DelayedActionManager`나 Addressables 자체는 MonoBehaviour의 순수 `Instantiate` 메서드로 생성된 인스턴스(instances) 수를 추적하지 않으므로, 메모리 핸들 추적에 사소한 실수라도 발생하면 영구적인 메모리 누수가 발생합니다[^6].

### 데이터 압축 아키텍처와 메모리 할당 압박

AssetBundle의 크기와 데이터 압축 방식은 데이터가 RAM에 상주하는 방식에 직접적인 영향을 미칩니다. 압축 방식의 선택은 AssetBundle이 대량의 영구 메모리를 점유할지 아니면 대역폭을 최적화할 수 있을지를 결정합니다.

AssetBundle 압축 알고리즘의 특성 및 저장소 영향 요약표[^29]:

| 압축 알고리즘 | 로컬 파일 인식 가능 여부 | 전체 번들을 RAM에 로드 필요 여부 | 성능 및 저장소 영향 |
| :--- | :--- | :--- | :--- |
| **LZMA** | 불가. 번들이 통째로 압축됨. | **필요.** 전체 파일을 메모리에 압축 해제해야 함. | 압축률이 가장 높고 다운로드 용량이 작지만, 추출 시 급성 메모리 비대화(Memory Bloat)와 높은 CPU 부하를 유발함[^29]. |
| **LZ4** | 가능. 청크(chunk-based) 단위 압축. | **불필요.** 현재 접근 중인 데이터 부분만 로드. | 기본 표준(default)으로 권장됨. 전체 메타데이터를 RAM에 올리지 않고 로컬 디스크에 직접 캐싱(caching) 가능[^29]. |
| **Uncompressed** | 가능. 개별 리소스 독립 인식. | **불필요.** 직접 접근. | 압축 해제 시간 소모 없음, 원본 파일 크기 최대. 디스크 대역폭이 허용될 때 즉각적인 로딩에 최적화됨[^29]. |

거대한 LZMA 압축 AssetBundle에서 아주 작은 리소스 하나를 요청하더라도, 전체 파일(헤더, 메타데이터, 스트리밍 캐시 테이블 포함)을 하드 드라이브에서 RAM으로 옮겨야 합니다[^27]. 이러한 설계 오류는 거대한 AssetBundle을 애플리케이션의 메모리 부족 크래시(OOM crashes)를 유발하는 시한폭탄으로 만듭니다[^27].

## 리소스 관리 모범 사례(Best Practices)

참조 카운팅 시스템의 복잡성을 제어하고 `DelayedActionManager`에 가해지는 부담을 줄이기 위해, 시스템 아키텍트는 리소스 생명주기 최적화 기법과 결합된 극도로 엄격한 생명주기 구조를 적용해야 합니다.

### 1. 생성 및 해제 주기의 대칭적 동기화

API가 반환하는 모든 `AsyncOperationHandle` 오브젝트는 사용 수명이 끝났을 때 반드시 해제해야 합니다[^6]. 이를 이행하지 않으면 메모리 누수를 유발할 뿐만 아니라 시스템 크래시(crashes)를 일으킬 가능성이 높습니다[^6]. 아래 표는 Addressables 프로그래밍에서 필수적인 대칭 쌍을 보여줍니다:

| 생성 / 로드 메서드 | 대응하는 해제 메서드 | 내부 동작 메커니즘 |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | 해당 리소스를 포함하는 AssetBundle의 참조 카운터에서 1을 차감함[^6]. |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | 표시 오브젝트(Instance)를 파괴하고 원본 Prefab의 카운터에서 자동으로 1을 차감함[^4]. |
| `AssetReference`를 통한 할당 | `reference.ReleaseAsset()` | 핸들을 통해 Release를 호출하는 것과 동일하며 정적 참조를 정리함[^6]. |

특히 게임 설정 데이터를 저장하기 위해 `ScriptableObject`를 사용할 때, 오브젝트를 직접 참조(`public Object _worldAsset`)하면 강한 참조(hard references)가 생성되어 전체 시스템이 해당 리소스를 즉시 RAM에 로드하도록 강제합니다[^27]. 최적의 해결책은 `AssetReference`(`public AssetReference addressableAsset;`)를 사용하여 요청 시 비동기 로드(on-demand loading)를 수행하는 것입니다[^6].

### 2. 저수준 개입: Resources.UnloadUnusedAssets()

"부분 해제 불가" 특성으로 인해 공유 AssetBundle의 메모리 상태가 교착 상태에 빠진 딜레마 상황(예: `나무` 리소스가 `탱크`와 함께 묶여 있는 경우)에서, 유일한 탈출구는 엔진 기반 계층의 강제 API인 `Resources.UnloadUnusedAssets()`를 사용하는 것입니다[^25].

이 기능은 전체 시스템 RAM을 심층 스캔하여 실제 엔진 참조 수(actual engine references)가 완전히 0인 모든 리소스(AssetBundle에 숨겨진 리소스 포함)를 찾아내어 강제로 파괴합니다[^25]. 그럼에도 불구하고, 이는 CPU가 정리 스캔을 수행하기 위해 로직 스레드를 일시 정지시켜야 하므로 심각한 프레임 드롭(FPS drops)을 일으키는 엄청난 컴퓨팅 성능 비용을 유발하는 작업입니다[^27]. 엔지니어는 대규모 화면 전환 구간(loading screens)에서만 이 명령을 수동으로 호출하거나, `SceneManager.LoadScene`을 사용해 씬을 전환할 때 시스템이 자동으로 호출하도록 의존해야 합니다[^29].

### 3. AssetBundles 기획 및 분할(Bundle Packing Modes)

Addressables 설정 인터페이스에서 그룹(Groups) 구조를 구성하는 방식은 메모리 로드 성능과 다운로드 대역폭을 직접 결정합니다. 리소스 유형에 맞는 적절한 패키징 모드(Bundle Mode)를 선택하는 것은 매우 중요한 설계 단계입니다[^6]:

* **Pack Together (함께 패킹)**: 항상 동시에 등장하며 생명주기가 긴밀하게 결합된 리소스에 사용합니다. 이는 의존성 그래프 분석 비용과 네트워크 I/O를 최소화합니다[^6].
* **Pack Separately (개별 패킹)**: 항상 함께 로드된다고 보장할 수 없는 거대하고 독립적인 리소스나 대형 맵에 최적화되어 있습니다. 큰 리소스가 다른 작은 리소스의 해제를 방해하는 위험을 제거합니다[^6].
* **Pack Together By Label (라벨별 패킹)**: 라벨 메타데이터를 통해 흩어져 있는 리소스들을 결합할 수 있습니다(예: `"Halloween 2023"` 라벨을 부여하여 모든 이벤트 콘텐츠를 하나의 번들로 묶어 CDN을 통해 쉽게 업데이트)[^6].

AssetBundle의 타입 테이블(`TypeTree`) 부담을 더욱 깊이 줄이기 위해, 개발자는 `BuildAssetBundleOptions.DisableWriteTypeTree` 옵션을 활성화할 수 있습니다. 이 기능은 불필요한 메타데이터 양을 제거하지만, 실행 파일을 내보내기 전에 암호화된 메모리 재구축(rebuild local groups) 과정이 필요합니다[^26].

### 4. 오디오 및 그래픽 메모리 관리(Graphics & Audio)

보조 계층을 최적화하는 것은 가비지 컬렉터의 작동 빈도 부하를 줄이는 가장 효과적인 방법입니다. 오디오 스트림의 로드 포맷 설정은 메모리에 직접적인 영향을 미칩니다[^27]:

* **긴 배경 음악(BGM)**: 디스크에서 작은 버퍼 영역씩 로드하도록 **Streaming**을 설정해야 합니다[^27].
* **긴 효과음**: RAM 상에서 압축을 유지하고 재생 시 실시간으로 디코딩하도록 **Compressed In Memory**를 선택합니다[^27].
* **짧거나 빈번한 효과음**: CPU 비용을 없애고 비압축 데이터를 직접 준비하도록 **Decompress On Load**를 사용합니다[^27].

이와 함께, Texture에서 `"Read/Write enabled"` 옵션을 비활성화하고 UI 그래픽 카메라의 깊이 스텐실 포맷을 제거(Depth Stencil Format to None)하도록 설정하면 불필요한 렌더링 RAM 사용량을 최소 50% 이상 절감할 수 있습니다[^27].

## 전역 상호작용에 대한 결론

`DelayedActionManager`에 대한 연구는 `DontDestroyOnLoad` 씬에 숨겨진 오브젝트의 기원을 해독할 뿐만 아니라, Unity Addressables 시스템의 기본 설계 철학을 드러냅니다. 이 `ComponentSingleton` 클래스는 해제 프로세스, 비동기 호출 및 버퍼 처리를 `LateUpdate` 주기로 라우팅하여 데이터 무결성을 보존하는 정교한 시간적 가교 역할을 합니다. 이는 `Update` 스레드에 속한 물리 코드나 제어 로직으로 인해 발생할 수 있는 중단으로부터 메모리 구조 변경을 격리하여, 씬 전환 시 시스템 손상 예외에 맞서는 방패를 형성합니다.

그러나 `DelayedActionManager`가 메모리 관리 아키텍처의 내재적 약점을 해결할 수 있는 마법의 지팡이는 아닙니다. 이는 소프트웨어 아키텍트에게 완전히 대칭적인 리소스 로드/해제 주기를 유지하고, 원시 C++ 오브젝트를 캡처하는 루프를 피하도록 C# 익명 표현식(lambdas)을 설계하며, 고질적인 메모리 누수를 예방하기 위해 AssetBundle 구조를 세분화(modularize)할 것을 엄격히 요구합니다. 비동기 로딩 라우팅에 대한 철저한 이해와 LZ4 같은 압축 방식의 합리적인 활용, 그리고 `Resources.UnloadUnusedAssets`의 강제력을 결합함으로써, 개발 팀은 영구적인 리소스 고갈에 대한 걱정 없이 모든 플랫폼에서 강력한 확장성을 갖춘 견고한 아키텍처 모델을 설계할 수 있습니다.

## **참고문헌**

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

### 추가 읽을거리

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
