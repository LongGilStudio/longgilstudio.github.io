---
title: "Unity Awaitable 시스템 시작하기: 아키텍처, 실전 활용 패턴 및 Coroutines·UniTask와의 비교"
date: 2026-04-25 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, awaitable, async, coroutines, optimization]
description: "Unity Awaitable 시스템에 대한 심층 분석, Coroutines 및 UniTask와의 비교, 그리고 실무 프로젝트에서 안전하게 적용하기 위한 아키텍처 전략을 다룹니다."
lang: ko
translation_id: unity6-awaitable-vs-coroutines
---

{% include embed/youtube.html id='eXkFPoEp3BA' %}

## **Unity 생태계의 비동기 아키텍처 개요**

Unity를 활용한 실시간 게임 및 시뮬레이션 개발 환경에서, 메인 프레임 루프(`main frame loop`)를 멈추지 않고 시간이 오래 걸리는 작업의 실행 흐름을 제어하는 것은 가장 핵심적인 엔지니어링 과제 중 하나입니다. 모든 Unity 애플리케이션의 중심에는 게임 로직, 물리, 그래픽 렌더링, UI 처리를 담당하는 메인 스레드(`Main Thread`)가 있습니다. 디스크에서 대용량 에셋 파일을 로드하거나, 원격 데이터베이스에서 데이터를 조회하거나, 네트워크 연결을 설정하는 등의 대기 성격이 있는 동기 작업을 실행하면 메인 스레드가 멈출 위험이 있습니다. 이러한 문제는 프레임 끊김(`stuttering`)이나 프레임 속도 저하(`frame rate drops`)로 직결되어 최종 사용자 경험을 심각하게 해칩니다.[^1]

`Unity API`처럼 기본적으로 단일 스레드로 동작하는 환경에서 동시성(`concurrency`) 문제를 해결하기 위해, 플랫폼은 소프트웨어 아키텍처 측면에서 오랜 진화를 거쳐 왔습니다.[^3] 10년 이상 Unity가 제공한 유일한 네이티브 해법은 `Coroutine` 시스템이었습니다.[^3] `Coroutine`은 병렬 실행 스레드(`multithreading`)가 아니라, 자신의 실행을 일시 중지하고 제어권을 엔진 루프에 양보한 뒤 특정 조건이 충족되는 미래 시점에 자동으로 재개할 수 있는 메서드입니다.[^1] 그러나 C# 언어가 상위 버전으로 발전하면서 `async`와 `await` 키워드를 사용하는 `Task-based Asynchronous Pattern (TAP)` 모델이 점차 업계 표준으로 자리 잡았습니다.[^6] `.NET Task` 모델은 명확하고 선형적인 문법과 반환 값 지원, 강력한 예외 처리 기능을 제공하지만, 할당 주기마다 상당한 가비지 메모리를 생성하며 Unity의 `PlayerLoop`와 자연스럽게 동기화되지 않는 한계가 있습니다.[^5]

기존 Coroutine과 `.NET Task` 양쪽의 한계는 Unity에 특화되어 가비지 메모리 할당이 없는(zero-allocation) 비동기 솔루션을 제공하는 강력한 오픈소스 라이브러리, 대표적으로 Cysharp의 UniTask가 등장할 수 있는 토대를 마련했습니다.[^7] 서드파티 라이브러리에 의존하지 않고 엔진 코어 수준(engine-level)에 깊이 통합된 표준화 솔루션의 필수적인 요구를 인식한 Unity는 Unity 2023.1 버전부터 Awaitable 구조를 공식 출시했고, Unity 6에서 이를 완성했습니다.

Awaitable 클래스는 본질적으로 비동기 작업을 감싸는 래퍼(wrapper) 구조로, 개발자의 메서드가 작업 완료 시점까지 일시 중단되었다가 자동으로 재개되도록 합니다. Awaitable 시스템은 async/await 모델의 문법적 이점과 Coroutine이 가진 객체 수명 주기(object lifetime) 및 프레임 루프(frame loop) 친화적 특성을 결합하도록 정교하게 설계되었습니다. 이 글에서는 동작 메커니즘을 상세히 해부하고, 메모리 병목 지점을 분석하며, 기존 구조들과 심층 비교하는 동시에 실무 프로젝트에 안전하게 도입할 수 있는 아키텍처 패턴(architectural patterns)을 제시합니다.

## **Awaitable 시스템의 핵심 메커니즘 해부**

Awaitable 시스템의 등장은 단순히 엔진 어휘에 새로운 키워드를 하나 추가한 것이 아니라, C#의 상태 머신(State Machine)이 가비지 컬렉터(Garbage Collector) 및 Unity 엔진의 스케줄링 시스템과 상호작용하는 방식에 의도적으로 개입한 결과입니다.

### **오브젝트 풀링(Object Pooling) 메커니즘과 메모리 최적화**

일반적인 C# 프로그래밍에서는 `async` 메서드가 호출되어 `System.Threading.Tasks.Task` 객체를 반환할 때마다, .NET 런타임이 대기 상태를 관리하기 위해 해당 `Task` 객체와 관련 데이터 구조용 메모리를 `Heap`에 할당해야 합니다.[^6] 초당 60프레임으로 실행되는 게임에서 애니메이션, AI, UI 업데이트를 제어하기 위해 수백 또는 수천 개의 비동기 작업을 지속적으로 생성하면 할당되는 객체 수가 기하급수적으로 증가합니다.[^5] 이는 가비지 컬렉션(`Garbage Collection - GC`)에 막대한 부담을 주어 `GC`가 훨씬 더 자주 동작하게 만들며, 결과적으로 시스템이 `Heap`을 정리할 때 프레임이 멈추는 현상(`GC spikes`)을 유발합니다.[^5]

이 문제를 근본적으로 제거하기 위해 Unity는 Awaitable 클래스가 내부 오브젝트 풀링(Object Pooling) 메커니즘을 기반으로 동작하도록 설계했습니다. Awaitable과 Task의 가장 근본적인 차이는 반환되는 객체의 수명 주기에 있습니다. Awaitable을 반환하는 메서드가 작업을 완료하면 해당 Awaitable 클래스의 인스턴스(instance)는 GC가 수거하도록 버려지지 않습니다. 대신 Unity는 즉시 이 객체를 숨겨진 풀로 회수합니다.[^11] 이후 다른 비동기 메서드가 시작되면 엔진은 풀에 저장되어 있던 바로 그 Awaitable 객체를 재사용합니다.[^8] 이 과정은 게임 실행 중(runtime) 발생하는 동적 메모리 할당 비용을 거의 전부 없애 줍니다.

하지만 이러한 풀링 아키텍처는 개발자가 반드시 엄격하게 준수해야 하는 중대한 소프트웨어 설계 원칙을 강제합니다. 바로 일회용 규칙(The Single-Use Rule)입니다. Awaitable 객체는 재사용되므로 정확히 단 한 번만 await(대기)할 수 있습니다. 개발자가 Awaitable 객체에 대한 참조를 저장해 두고 두 번 await를 실행하려 하면 애플리케이션은 위험한 상태에 빠집니다. 이 시점에 해당 Awaitable 객체는 이미 풀로 반환되어 전혀 다른 프로세스에 할당되었을 수 있으며, 이는 예측 불가능한 예외(exceptions), 교착 상태(deadlocks), 또는 데이터 상호 오염으로 이어집니다.[^11] 따라서 개발자는 엔터프라이즈 소프트웨어 개발에서 흔히 보듯 결과를 여러 번 확인하기 위해 Task를 저장해 두는 습관을 버려야 합니다.

### **PlayerLoop 동기화와 스레드 전환(Thread Switching)**

Unity에서 비동기 시스템이 해결해야 하는 두 번째 복잡한 문제는 스레드 안전성(`thread safety`)입니다. 공간 좌표(`Transform`) 변경부터 객체 생성(`Instantiate`)에 이르기까지 대부분의 Unity API는 멀티스레드 환경에 안전하지 않으며 오직 `Main Thread`에서만 호출할 수 있습니다.[^12] 전통적인 `.NET Task` 모델에서 작업할 때는 `await` 이후의 연속 작업(`continuation`)이 저장된 동기화 컨텍스트(`Synchronization Context`) 환경에서 실행됩니다.[^13]

기본적으로 Unity는 표준 `SynchronizationContext`를 `UnitySynchronizationContext`로 재정의합니다.[^13] 이 컨텍스트는 백그라운드 스레드에서 흩어져 실행되던 `.NET Task`의 모든 연속 작업을 수집한 뒤, 다음 프레임의 업데이트 틱(`Update tick`)에서 안전하게 실행될 수 있도록 메인 스레드로 다시 밀어 넣는 역할을 맡습니다.[^13] 안전하기는 하지만, 이러한 컨텍스트 전환 절차는 특히 수천 개의 객체로 시스템 규모가 커질 때 상당한 성능 비용(`overhead`)과 지연 시간(`latency`) 증가를 초래합니다.[^13]

`Awaitable` 시스템은 `PlayerLoop` 아키텍처와 직접 상호작용함으로써 이 비용의 대부분을 제거합니다. 별도로 지정하지 않는 한 Unity API나 사용자 정의 메서드가 반환하는 모든 `Awaitable`은 다음 규칙을 따릅니다. 메인 스레드에서 호출된 메서드는 메인 스레드에서 재개되며, 백그라운드 스레드(`ThreadPool`)에서 호출된 메서드는 자동으로 백그라운드 스레드에서 재개됩니다.[^13] 더 나아가 `Coroutine`의 전통적인 `yield return` 명령을 완전히 대체하기 위해 `Awaitable` 클래스는 `PlayerLoop`의 주기를 정밀하게 모방하는 내장 함수를 제공합니다. `await Awaitable.NextFrameAsync()`를 사용하면 프로세스가 자원을 양보하고 다음 프레임에 이어서 실행되므로, `yield return null` 명령으로 가비지를 생성하던 방식보다 훨씬 직접적이고 효율적인 대체제가 됩니다. 한편 `await Awaitable.EndOfFrameAsync()`는 엔진이 그래픽과 UI의 모든 렌더링(`rendering`) 작업을 마친 시점에 재개를 동기화하여 개발자가 안전하게 스크린샷을 찍거나 프레임 버퍼를 읽을 수 있게 해 줍니다.[^8]

이 저수준 통합의 진정한 강점은 명시적 스레드 전환(`Explicit Thread Switching`) 제어 능력에 있습니다. 항상 `Main Thread`에 갇혀 있는 `Coroutine`과 달리 `Awaitable`은 스레드 경계를 우아하게 넘나드는 해법을 제공합니다. Unity의 내부 엔진 스레드(오디오 스레드, 그래픽 렌더링 스레드 등)는 보통 백그라운드에서 암묵적으로 동작하지만, 사용자 정의 C# 코드(`custom C# background threads`)의 경우 개발자가 수동으로 `Thread` 클래스나 `Task.Run`을 사용해야 했습니다.[^14] `Awaitable`을 사용하면 막대한 연산량을 백그라운드 CPU 스레드로 넘기는 작업이 `await Awaitable.BackgroundThreadAsync()` 호출 한 번만으로 해결됩니다. 복잡한 연산(예: 절차적 맵 생성, 파일 압축 해제, AI 경로 탐색)이 완료되면, 프로세스는 씬(`scene`) 공간 구조를 변경하는 어떠한 명령을 내리기 전에 `await Awaitable.MainThreadAsync()`를 통해 안전하게 메인 스레드로 복귀할 수 있습니다.

## **아키텍처 비교: Awaitable vs Coroutines 및 UniTask**

시스템 아키텍처 전환 결정을 내리기 위해서는 소프트웨어 아키텍트들이 기존 시스템의 결함과 경쟁 도구들의 한계를 명확히 정량화해야 합니다. 아래 표는 Unity 환경의 동시성 프로그래밍 기법 간 핵심 기술 특성을 체계적으로 정리한 것입니다.

| 기술적 특성                     | `Coroutine` (`IEnumerator`)                                      | `.NET Task` (`System.Threading.Tasks`)        | `UniTask` (Cysharp)                           | Unity `Awaitable`                                        |
| :------------------------------ | :--------------------------------------------------------------- | :-------------------------------------------- | :-------------------------------------------- | :------------------------------------------------------- |
| **아키텍처 본질**               | 반복자 상태 머신 (Iterator State Machine)                        | Heap 기반 객체 할당                           | IValueTaskSource 구조체 (Struct-based)        | Object Pool을 통해 관리되는 클래스                       |
| **메모리 풋프린트 (GC 할당)**   | `yield return new YieldInstruction` 호출 시마다 지속적 가비지 생성 | 매우 높은 비용 (`Allocation-heavy`)           | 가비지 거의 없음 (`Zero-allocation`)          | 고도로 최적화됨 (`Pooling mechanism`)                    |
| **반환 값 (Return values)**     | 직접 지원 안 함 (콜백 델리게이트 필수)                           | 지원 (`Task<T>`)                              | 지원 (`UniTask<T>`)                           | 지원 (`Awaitable<T>`)                                    |
| **예외 처리 (Exception Handling)** | 불가능 (`yield return`에 `try/catch` 사용 불가)                  | 네이티브 예외 포착 지원 (`try/catch/finally`) | 강력한 지원, `PlayerLoop` 로깅 통합           | 네이티브 예외 포착 지원 (`try/catch/finally`)            |
| **수명 주기 종속성**            | `MonoBehaviour`와 함께 자동 파괴됨                               | 독립적, `Scene` 전환 후에도 계속 살아남음     | `CancellationToken` 전달 필요                 | `CancellationToken` 전달 필요                            |
| **스레드 제어 (Thread Control)** | 항상 `Main Thread` 상에 위치                                     | 자동으로 `ThreadPool` 사용                    | 세밀한 `PlayerLoopTiming` 제어                | 네이티브 API: `BackgroundThreadAsync` 및 `MainThreadAsync` |
| **Addressables 통합**           | 복잡한 `event subscriptions` 필요                                | 지원 (`.Task`)                                | `extension methods`를 통한 통합               | 네이티브 통합                                            |

### **Coroutines의 설계상 결함**

수년 동안 Coroutines는 접근 용이성과 엔진 루프와의 완벽한 동기화 덕분에 황금 표준으로 여겨져 왔습니다. 그러나 코드베이스 규모가 커지면서 이 모델의 구조적 결함이 드러나기 시작했습니다.[^1]

`Coroutine`의 가장 치명적인 결점은 표준 예외 처리 메커니즘이 전무하다는 점입니다.[^1] 컴파일러가 `IEnumerator` 반복자 메서드를 암묵적 상태 머신 클래스로 변환하는 특성 때문에, `yield return` 구문을 `try/catch` 블록 내부에 감싸면 즉시 컴파일 오류(`Compiler Error`)가 발생합니다.[^18] 만약 `Coroutine` 내부의 네트워크 읽기 작업에서 시간 초과(`timeout`)나 연결 끊김 문제가 발생해도 `catch`를 통해 복구 로직(`fallback logic`)을 실행하거나 `finally`를 통해 자원을 정리할 방법이 전혀 없습니다.[^1] 오류는 조용히 묻히고 `Coroutine`은 침묵 속에 종료되어 시스템을 어중간한 상태로 방치합니다.[^1] 반면 `Awaitable`은 네이티브 `async/await` 구조의 강점을 물려받아 모든 `Exception`을 깔끔하게 포착하고 세련되게 처리할 수 있습니다.[^1]

또한 양방향 데이터 통신 역시 `Coroutine`에서 고질적인 골칫거리입니다.[^20] `return` 키워드로 개체를 반환할 수 없기 때문에 개발자는 전역 변수를 사용하거나 `Action<bool> onComplete` 같은 콜백 함수(`callbacks/Actions`)를 전달해야만 합니다.[^1] 여러 연속 작업을 체인으로 엮어야 할 때 `callbacks`에 의존하면 코드가 비선형적인 뒤엉킴(흔히 "Callback Hell"이라 부름)으로 변질됩니다.[^2] `Awaitable`은 제네릭 타입 `Awaitable<T>`를 반환하는 기능 덕분에 이 문제를 단번에 해결합니다.[^8] 개발자는 에셋을 로드하고 결과를 기다린 뒤, 마치 동기 코드처럼 한 줄에서 즉시 지역 변수에 저장할 수 있습니다.[^15]

마지막으로, 대기 명령 객체가 가비지를 생성하는 문제(`Garbage Generation`)는 성능 최적화의 핵심 약점입니다.[^5] `yield return new WaitForSeconds(2f)` 명령은 겉보기에 무해해 보이지만, 이 코드가 실행될 때마다 `Heap`에 새로운 `WaitForSeconds` 객체가 할당되며 2초가 지나면 이 객체는 버려져 `GC`가 정리해야 합니다.[^5] `Awaitable.WaitForSecondsAsync(2f)` 시스템은 `new` 키워드가 필요 없으며, 내부 메커니즘을 통해 타이머를 재사용하므로 이러한 할당 누수를 완전히 없애 줍니다.

### **Cysharp UniTask와의 상관관계 평가**

Awaitable의 등장은 오랫동안 Unity 비동기 분야를 지배해 온 라이브러리인 UniTask와 저울질하지 않을 수 없습니다.[^6] 공정하게 평가하자면, Awaitable의 아키텍처는 UniTask의 설계 철학에서 매우 큰 영감을 받아 형성되었습니다.[^22]

`UniTask`는 본래 `struct` 기반 구조로(클래스 메모리 할당을 완전히 배제함) 방대한 생태계를 제공합니다.[^9] `UniTask`는 개발자가 `PlayerLoop`의 특정 시점(예: `EarlyUpdate`, `PreLateUpdate`)으로 대기 흐름을 미세하게 조정할 수 있도록 지원하며, `Asynchronous LINQ`를 제공하고, 컴파일러 경고 없이 작업을 안전하게 흘려보내는 유명한 `.Forget()` 메서드를 갖추고 있습니다.[^7] 또한 멈춰 있는 작업을 탐지하는 시각적 디버깅 도구 `Tracker Window`도 보유하고 있는데, 이는 네이티브 `Awaitable`에는 전혀 없는 기능입니다.[^22]

`Awaitable`은 기능 면에서 `UniTask`의 부분집합(`subset`)으로 볼 수 있습니다.[^22] `pooling` 메커니즘으로 할당되는 클래스 기반이라는 점 때문에 다중 작업 대기 기능을 기본으로 모방할 수 없습니다. `UniTask`에서는 `UniTask.WhenAll`이 여러 병렬 프로세스를 실행하는 중추 역할을 합니다.[^7] 반면 `Awaitable`에서는 `pooling`의 `Single-Use Rule` 제약으로 인해 개발자가 `Task.WhenAll`을 사용하기 전에 `.AsTask()` 확장 메서드를 통해 `Awaitable` 인스턴스를 표준 `.NET Task`로 변환해야 합니다. 그럼에도 불구하고 `Awaitable`이 가진 비할 데 없는 장점은 서드파티 패키지(`package`)가 전혀 필요 없고 엔진의 표준 라이브러리 안에 온전히 포함되어 있다는 것입니다.[^6] 이 점 때문에 플러그인 라이브러리, 공용 에셋, 또는 외부 라이브러리 호환성 관리 문제에 얽히고 싶지 않은 구조를 구축하는 개발자들에게 절대적인 우선 선택지가 됩니다.[^23] 주목할 만한 점은 `UniTask`가 `Awaitable`을 역으로 변환할 수 있는 `AsUniTask()` 확장 메서드를 기본 제공하므로, 동일 프로젝트 내에서 두 시스템이 평화롭게 공존할 수 있다는 것입니다.[^23]

## **대표적인 실무 활용 사례 (Use Cases)**

Awaitable 시스템의 판도를 바꾸는 역량은 기존의 처리 아키텍처를 선형적이고 깔끔하며 안전한 실행 흐름으로 재구성할 때 가장 뚜렷하게 드러납니다. 아래에서는 Awaitable이 압도적으로 뛰어난 특화 활용 시나리오를 상세히 분석합니다.

### **1. Addressables 에셋 시스템 관리 (Asset Streaming & Management)**

`Addressables` 에셋 관리 시스템은 애플리케이션 초기화 중 끊김 현상(`stuttering`) 없이 기기 저장소나 원격 저장 서버에서 정적 요소(이미지, 사운드, 모델)를 로드하는 표준 방식을 제공합니다.[^25] 과거에는 이 로딩 절차가 이벤트 기반 아키텍처(`event-driven callbacks`)에 크게 의존하거나, 매 프레임마다 `isDone` 상태 플래그를 검사하는 `yield return` 루프에 의존해야 했습니다.[^25]

`Awaitable`의 등장과 `AsyncOperationHandle` 클래스가 반환하는 `Task` 속성의 결합은 에셋을 요청하는 방식을 재정의합니다. 복잡한 다중 로딩 루프를 이어 붙이는 대신, 에셋 로딩 로직의 흐름은 이제 문법적으로 완전히 동기식처럼 읽힙니다.

```csharp
var handle = Addressables.LoadAssetAsync<Texture2D>("asset_key");
await handle.Task;
var texture = handle.Result;
```

캐릭터 생성에 속성 데이터(`ScriptableObjects`), 지오메트리 모델(`Prefabs`), 애니메이션 스켈레톤(`Animation Controllers`)이 모두 필요한 대규모 프로젝트에서는 `InstantiateAsync` 과정을 별도의 `Awaitable` 메서드로 분리할 수 있습니다.[^12] 이 전체 과정을 `Task.WhenAll(operation_1.AsTask(), operation_2.AsTask())` 구조로 취합하면 로딩 화면(`loading screen`)의 진행률 표시줄이 절대적으로 신뢰할 수 있고 정확해지며, 대역폭에 에셋이 몰려 발생하는 국지적 지연 현상을 없앨 수 있습니다.

### **2. UI 로직 흐름과 대화 컷신 연출 시뮬레이션 (Sequencing)**

롤플레잉 게임(RPG)이나 사용자 튜토리얼(Onboarding/Tutorials) 구간에서는 연출 로직이 엄격한 시간 순서대로 실행되어야 하는 경우가 많습니다. 카메라 이동, 화면 페이드 아웃, 지정 지점으로 캐릭터 이동, 대화창 표시, 사용자 확인 버튼 입력 대기가 그 예입니다.[^1]

`Coroutine` 생태계에서 이러한 이벤트 시퀀스를 구성하면 수많은 자잘한 `IEnumerator` 함수에 코드가 흩어져 "스파게티" 코드로 변합니다.[^1] `Awaitable`에서는 비동기 코드의 선형화 특성 덕분에 이러한 메서드를 산문처럼 자연스럽게 작성할 수 있습니다. `await Awaitable.WaitForSecondsAsync` 명령은 필요한 시간 지연을 보장합니다. 동시에 기존에 `Coroutine`에서 `WaitUntil`을 쓰던 조건부 일시 중지 메커니즘도 `Awaitable` 루프를 구현하여 강력하게 업그레이드할 수 있습니다. 예를 들어 조건부 대기 함수 `AwaitableUntil(Func<bool> condition)`을 구현하면, 계속 검사하는 대신 `NextFrameAsync`와 `CancellationToken`을 결합해(예: 플레이어 마우스 클릭과 같은) 논리식이 참을 반환할 때까지 CPU 자원을 낭비하지 않고 스레드를 일시 중단할 수 있습니다.[^11]

### **3. 능동적 스레드 전환을 통한 고부하 연산 최적화 (Offloading CPU Work)**

조밀한 좌표 그리드 위의 A\* 길찾기(Pathfinding) 알고리즘, 3D 절차적 복셀 지형 생성(Procedural Voxel Generation), 혹은 서버에서 반환된 거대한 JSON 데이터 파싱처럼 연산량이 막대한 기능의 개발은 프레임 속도 저하(FPS drops)의 주원인입니다.[^2]

이러한 알고리즘을 `Awaitable`에 배치하면 능동적 스레드 전환 아키텍처(`explicit thread switching`)가 엄청난 가치를 발휘합니다. 코드는 메인 스레드에서 시작해 환경 공간 데이터를 수집할 수 있습니다. 그 즉시 `await Awaitable.BackgroundThreadAsync()` 명령이 호출되어 이 프로세스의 실행 컨텍스트 전체를 프로세서의 `ThreadPool` 시스템으로 넘깁니다. 이 백그라운드 스레드 아래에서 길찾기 알고리즘은 게임 UI를 단 한 순간도 멈추지 않은 채 수십 밀리초 동안 독립 CPU 코어를 100% 점유할 수 있습니다.

그러나 엔진의 기반 객체(`Transform`, `GameObject`)는 스레드 안전 잠금(`thread-locked`)이 걸려 있으므로 백그라운드 스레드에서 직접 캐릭터를 생성하거나 이동할 수 없습니다.[^12] 프로세스는 다시 `await Awaitable.MainThreadAsync()`를 사용해 컨텍스트를 `Main Thread`로 안전하게 되돌려 놓습니다. 이 시점에는 연산 루프의 결과가 이미 완료되어 있으므로 개발자는 객체의 좌표를 부드럽게 변경하도록 명령할 수 있습니다.[^12]

### **4. Job System의 멀티스레딩과 강력한 결합**

Unity의 가장 정교한 도구 중 하나는 데이터 지향 아키텍처(`Data-Oriented Technology Stack - DOTS`)를 위해 설계된 `C# Job System`입니다.[^5] `Job System`이 병렬 실행 성능에 최적화되어 있더라도, `Main Thread`가 `Job` 완료를 기다리게 하면 여전히 `PlayerLoop`의 흐름을 방해할 수 있습니다. `Awaitable`은 훌륭한 중간 스케줄링(`scheduling`) 해법을 제공합니다. `Job`을 실행하고 `Complete()`를 호출해 `Main Thread`가 결과를 기다리며 멈추게 하는 대신, `Awaitable` 메서드가 `Job`을 예약한 뒤 `await Awaitable.NextFrameAsync()` 명령으로 엔진이 현재 프레임을 렌더링하도록 제어권을 반환하고, 다음 프레임에 `jobHandle.Complete()`를 호출하여 연산 결과를 안전하게 수거할 수 있습니다.[^11] 이러한 결합은 군중 물리 시뮬레이션이나 유체 흐름 시스템에 최적화된 시간 분할(`time-slicing`) 기능을 제공합니다.[^14]

### **5. Unity Test Framework를 활용한 자동화 테스트**

자동화 코드를 통한 품질 관리(`Automated Testing`)는 소프트웨어 엔지니어링의 기둥입니다. `Unity Test Framework`는 테스트 도구가 주로 `IEnumerator` 테스트 함수를 인식하는 특성 때문에 비동기 코드 처리에 많은 난관을 겪어 왔습니다.[^11] `Unity Test Framework`는 현재 `Awaitable`을 유효한 테스트 반환 타입으로 인식하지 못하므로, 개발자는 로컬 함수(`local functions`)를 이용해 이를 통합할 수 있습니다. 반복 가능한 `IEnumerator` 함수가 `async Awaitable TestImplementation()` 로컬 함수를 감쌀 수 있으며, 그 내부에는 목업 서비스, 네트워크 호출, 에셋 로딩을 테스트하는 완전한 `await` 문법을 작성한 뒤 표준 iterator 형태로 반환합니다. 이는 복잡한 네트워크 프로젝트에 `Test-Driven Development (TDD)`를 적용하는 데 걸림돌이 되던 장벽을 허뭅니다.[^11]

## **취소 관리 아키텍처 (The Cancellation Architecture): 수명 주기 안전성**

`Coroutine`에서 `Awaitable`, `Task`, 또는 `UniTask`로 전환할 때 마주하는 가장 큰 사고의 장벽은 비동기 프로세스의 존재와 수명 주기에 대한 철학입니다.[^29] 이에 대한 오해는 시스템을 마비시키거나 개발자의 작업을 방해하는 추적하기 어려운 각종 시스템 오류(`memory leaks`, `phantom executions`)의 원인이 됩니다.[^29]

### **독립 상태 머신의 위험성**

원래 설계상 `Coroutine`은 이를 실행한 `MonoBehaviour` 객체의 수명 주기에 단단히 묶여 있습니다.[^18] 스크립트를 지닌 `GameObject` 객체가 `Destroy()` 함수를 통해 파괴(`destroyed`)되거나, 비활성화되거나, 씬(`Scene`)이 전환되면 Unity 엔진은 조용히 해당 `Coroutine`까지 정리하고 소멸시킵니다.[^29] `Coroutine` 내부의 반복 조건이 `while (true)`라 하더라도 본체보다 더 오래 살아남는 일은 결코 없습니다. 이러한 자동화는 개발자가 메모리 정리 작업에 나태해지도록 용인해 왔습니다.[^29]

반면 `async/await` 메서드는 `Heap` 위의 별도 공간에 존재하는 독립 상태 머신(`independent State Machine`)으로 컴파일됩니다.[^29] 명시적으로 지시하지 않는 한 `Awaitable` 프로세스는 `GameObject`들의 존재 여부나 소멸을 전혀 인지하지 못합니다. 만약 적 AI가 네트워크 요청을 호출하거나 5초짜리 애니메이션을 대기하던 중 2초 시점에 플레이어에게 처치되더라도, 비동기 작업은 계속해서 시간을 셉니다.[^29] 5초가 되는 순간 상태 머신이 깨어나(`resume`) `transform.position`이나 캐릭터 속성을 호출하는 다음 줄을 실행하게 되고, 애플리케이션은 콘솔(`console`)을 가득 채우는 수많은 `NullReferenceException` 또는 `MissingReferenceException` 오류를 쏟아냅니다.[^29] 더 위험한 것은, 특히 `Unity Editor`로 개발할 때 `Play Mode`가 중단되었는데도 올바르게 취소되지 않은 `Awaitable` 작업이 `Edit Mode`에서 몰래 계속 실행되면서 프로젝트 전체 데이터(`Scene data`)를 삭제, 변경 또는 변질시켜 치명적인 결과를 초래할 수 있다는 점입니다.[^24]

### **취소 객체 모델 (CancellationTokenSource)**

이러한 상황에 대한 .NET의 유일하고 가장 표준적인 해법은 `CancellationToken`이라는 경량 객체에 기반한 협력적 취소(`Cooperative Cancellation`) 메커니즘입니다. 이 모델의 원리는 옵저버 패턴(`Observer Pattern`)과 유사합니다. 초기화 시스템이 `CancellationTokenSource`를 관리하고, 이 객체는 비동기 호출 체인의 최하위 함수까지 전달되는 토큰(`CancellationToken`)을 생성합니다.[^31] 강제로 전원을 끊는 것과 달리, 토큰은 프로세스를 직접 죽이지 않고 요청을 전달하는 역할을 맡습니다.[^32] 실행 중인 각 기능이나 스레드는 주기적으로 이 토큰의 신호를 감지하거나 대기하면서 자발적으로 작업을 중단할지 결정합니다.[^31]

이 메커니즘의 절대적 중요성을 인식한 Unity는(2022.2 버전부터) 기본 `MonoBehaviour` 클래스 내부에 `destroyCancellationToken` 속성을 내장했습니다. 개발자가 `await Awaitable.WaitForSecondsAsync(1, destroyCancellationToken)`으로 로딩이나 대기 루프를 작성하면, 이 속성은 해당 `GameObject`에 시스템 파괴 명령이 내려지는 바로 그 프레임에 자동으로 취소 신호를 발생시킵니다. 이 간결한 연결은 수명 주기 안전성(`lifetime safety`)을 `Coroutine`과 동등한 자연스러운 수준으로 되돌려 주지만, 개발자가 능동적으로 토큰을 전달할 것을 요구합니다.

### **철학적 차이: 조용한 중단 vs 취소 예외**

`Awaitable`의 취소(`Cancellation`) 모델은 숙련된 Unity 개발자들에게 당혹감을 안겨 주곤 합니다. `Coroutine`이 중단될 때는 "조용히" 종료(`silent stop`)됩니다.[^30] 그러나 `CancellationToken`이 발동(`Cancel`)되거나 사용자가 직접 `Awaitable.Cancel()` 명령을 호출하면, 대기 중이던 메서드는 즉시 시스템 수준 예외인 `OperationCanceledException`(또는 `TaskCanceledException`)을 던집니다.[^10] 이 예외가 Unity의 로깅 시스템까지 전파(`propagate`)되면 개발자를 당황시키는 빨간색 경고를 출력합니다.[^10]

예외를 던지는 본질은 프로그래밍 오류가 아니라 코드 무결성에 대한 보호 장치입니다.[^34] 프로세스가 조용히 멈추면 그 프로세스가 점유하고 있던 자원들은 방치됩니다. 작업이 대용량 메모리 영역을 로드하는 도중이거나, 데이터베이스 연결(Database socket)을 열어 둔 상태이거나, 플레이어가 버튼을 두 번 누르지 못하도록 잠금 플래그(lock flag)를 걸어 둔 상태일 수 있습니다.[^33] 아무 신호 없이 프로세스가 끊어지면 시스템은 이 자원 잠금들을 결코 정리하지 못하며, 조용히 메모리를 잡아먹거나 서버 전체 애플리케이션을 멈추게 하는 "좀비 프로세스"(zombie processes)를 만들어 냅니다.[^34]

`OperationCanceledException`을 던짐으로써 예외는 `call stack`을 따라 타고 내려가며 표준 `catch` 및 `finally` 블록으로 포착될 수 있습니다.[^19] `finally` 블록에서 개발자는 `connection.Dispose()` 호출, `isWorking = false` 재설정, 또는 임시 버퍼 배열 해제 등을 손쉽게 수행할 수 있습니다.[^19] 이는 중단된 모든 작업이 주변 환경의 청결 상태를 자발적으로 복구하도록 보장하는 소프트웨어 아키텍처 측면의 우월성입니다.[^19]

### **복잡한 로직을 위한 다중 취소 연결 (Linked Tokens)**

상용 환경에서는 하나의 프로세스가 취소되어야 할 이유가 두 개 이상인 경우가 많습니다. 예를 들어 새 스테이지를 로딩하는 과정은 다음 세 조건 중 하나라도 충족되면 즉시 중단되어야 합니다. (1) UI 관리 객체가 파괴됨, (2) 사용자가 수동으로 "취소" 버튼을 누름, 또는 (3) 대기 시간이 30초를 초과함(Timeout).

사방에 수많은 `if` 루프를 흩뿌리는 대신, .NET과 `Awaitable` 시스템은 `CancellationTokenSource.CreateLinkedTokenSource` 패턴(`pattern`)을 활용합니다. 이 함수는 여러 독립적인 `Token`(`GameObject`의 `destroyCancellationToken`, `Application.exitCancellationToken`, 자동 파기 타임아웃 토큰 등)을 입력받아 하나의 통합 토큰(`Linked Token`)으로 결합합니다. 개발자는 이 복합 토큰을 조회 시스템의 가장 깊은 계층까지 전달하기만 하면 됩니다. 핵심 조건 중 어느 하나라도 위반되면 취소 신호가 즉시 활성화되어 작업 체인이 깔끔하게 끊어지므로, 극도로 강력한 설계 유연성과 함께 모든 불확정 상태를 배제할 수 있습니다.

## **흔한 함정과 오류 방지 설계 패턴 (Anti-Patterns & Pitfalls)**

강력하고 최적화되어 있지만, `Awaitable` 시스템은 이를 전통적인 `.NET Task` 시스템처럼 다루려 할 때 미숙한 아키텍트를 무너뜨릴 수 있는 특유의 함정들을 수반합니다.

### **1. 일회용 할당 원칙 위반 (The Single-Use Pooling Pitfall)**

메모리 아키텍처 부문에서 언급했듯이, `Awaitable` 인스턴스는 결과를 반환하자마자 즉시 `Pool`로 재투입되기 때문에 일회용 규칙(`single-use rule`)의 제약을 받습니다. `C# Backend` 환경에서 Unity로 넘어온 개발자들이 가장 흔히 범하는 오해는 `Awaitable` 작업을 공용 변수에 할당한 뒤, 서로 다른 코드 위치에서 이 변수를 여러 번 대기(`await`)하는 것입니다.[^11] 다음과 같은 안전하지 않은 코드(`unsafe version`)는 재앙을 부릅니다. 이미 `Pool`로 돌아간 작업이 다른 프로세스에 할당되었을 수 있으며, 두 번째 `await`가 결과에 접근하려 할 때 시스템은 치명적인 예외를 던지거나 UI를 완전히 얼려 버리는 `Deadlock`을 유발합니다.

이 상황을 극복하는 정석 절차(`Best Practice`)는 다음과 같습니다. 알고리즘상 하나의 작업 결과를 여러 실행 흐름에서 평가, 대기 또는 공유해야 한다면, 개발자는 반드시 `.AsTask()` 확장 메서드를 사용해 `Awaitable`을 전통적 형식으로 변환해야 합니다. 이 과정은 `Pool`에서 `Awaitable`을 능동적으로 꺼내 `Heap` 위에 고정된 `Task`를 할당함으로써 병렬 대기와 무제한 조회를 가능하게 합니다. 그 대가로 `GC` 가비지가 발생하므로 정말 필요한 경우에만 제한적으로 사용해야 합니다.[^5]

### **2. 작업 그룹화 시스템의 공백 (Task Aggregation Issues)**

스테이지를 초기화하는 과정에서 50개의 동시 요청을 실행하고 50개가 모두 완료되었을 때만 씬을 전환하는 것은 흔한 요구사항입니다.[^7] `.NET Task`에서는 `await Task.WhenAll(...)` 문법이 완벽한 지휘자 역할을 수행합니다. `UniTask` 시스템에서는 `UniTask.WhenAll`이 가비지 메모리 생성 없이 동일한 기능을 제공합니다.[^7]

그러나 Unity 네이티브 `Awaitable`은 엄격한 `pooling` 특성 때문에 시스템 취합 API(`aggregation features`)가 전혀 없습니다.[^22] `Task.WhenAll`을 쓰기 위해 `.AsTask()`로 대량의 `Awaitable`을 `Task`로 변환하는 것은 대안이 될 수 있지만 최적화 원칙에 위배됩니다. 게다가 전통적인 `WhenAll` 기능에는 잠재적 위험이 숨어 있습니다. 50개 작업 중 하나라도 오류를 던지거나 취소되면 `WhenAll` 명령은 즉시 조기 종료(`exit early`)됩니다.[^7] 이 상태는 나머지 49개 작업을 제어할 수 없는(`unobserved`) 상태로 내버려 두어 고아 상태 변이(`orphaned state mutations`)를 만들어 냅니다.[^7]

(프로젝트가 `UniTask`를 병행 적용하거나 유사한 기능 클래스를 구현할 경우) 가장 이상적인 설계 기법은 `WhenAllSettled` 같은 확장 변형을 사용하는 것입니다.[^7] 이 함수는 시스템이 계속 관찰 상태를 유지하며 모든 작업이(성공이든 오류든) 온전히 끝나도록 허용한 뒤, 각 프로세스 영역의 상세 상태를 모두 수집한 후에 전체 결정을 내리도록 강제하여 시뮬레이션 데이터 구조를 완벽하게 보존합니다.[^7]

### **3. 취소 예외를 삼켜 버리는 문제 (Swallowing Cancellation)**

`try/catch` 블록은 강력한 무기이지만, 전파 체인(`propagation`)에 대한 이해 없이 남용하면 위험 요소가 됩니다.[^34] `CancellationToken`이 발동하면 하위 작업에서 `OperationCanceledException`이 타고 내려옵니다.[^10] 개발자가 앱 크래시를 막겠다며 전체 코드 블록을 포괄적인 `catch (Exception e)` 블록으로 감싸면, 의도치 않게 취소 예외까지 함께 "삼켜 버리게(`swallow`)" 됩니다.[^34]

이 잘못된 구조는 현재 함수가 일반 오류만 기록한 채 취소 예외를 능동적으로 다시 던지지(`re-throw`) 않는 결과를 낳습니다. 따라서 바깥쪽의 부모 함수(`parent caller`)는 하위 작업이 정상적으로 완료되었다고 순진하게 착각하고 다음 로직 단계를 계속 실행합니다.[^34] 그 결과 연쇄 종료 루프가 끊어져 멈춰야 할 프로세스가 좀비 프로세스로 변질됩니다.[^34] 표준 설계 패턴은 먼저 독립적인 `catch (OperationCanceledException)` 블록에서 취소 예외를 가로채 정리 작업을 우선 처리하고, 상위 호출자에게 전파해야 할 필요가 있다면 능동적으로 `throw;` 명령을 사용하도록 강제합니다.[^19]

### **4. "Async Void" 메서드에 대한 적색 경보**

반환 값이 없는 메서드를 정의할 때마다 `async void` 키워드는 초보자에게 치명적인 함정이 됩니다.[^18] 컴파일러 아키텍처상 `async void` 메서드는 "쏘고 잊기(`fire and forget`)" 모델입니다. 호출되면 원래 메서드의 컨텍스트에서 분리되므로 아무도 `await` 명령으로 기다릴 수 없고, 그 안에서 발생한 예외를 `catch`로 잡아낼 수도 없습니다.[^19] `async void` 블록 내부에서 어떤 사고가 발생하든 환경 설정에 따라 조용히 붕괴하거나 시스템을 중단시키며, 소프트웨어 구조의 모든 보호 계층을 완전히 우회합니다.[^19]

`async void` 사용이 허용되는 유일한 예외 상황은 `async void Start()`, `OnEnable()`, 또는 UI 버튼 클릭 같은 엔진 기본 이벤트 핸들러(`Event Handlers`)뿐입니다.[^8] 이 경우를 제외하고 반환 값이 없는 모든 사용자 정의 메서드는 예외 없이 `async Awaitable` 또는 `async Task` 형태로 통일하여 규약화해야 합니다.[^15]

### **5. WebGL 플랫폼 호환성**

Unity의 `WebGL` 기술로 웹 브라우저에 프로젝트를 배포하려는 목표는 멀티스레딩과 관련된 많은 편견을 동반합니다.[^19] `WebAssembly (Wasm)`와 `JavaScript` 환경은 본질적으로 엄격한 단일 스레드 모델로 동작하기 때문에, C#의 전통적인 `System.Threading.Thread`나 `Task.Run`을 사용하는 구조는 `WebGL`에서 잦은 오류로 망가지거나 지원되지 않습니다.[^19]

그러나 전문가들은 `Awaitable`과 `Task` 시스템이 `WebGL`에서 완전히 호환되며 절대적으로 안전하다고 확인해 줍니다.[^19] 핵심 이유는 `IL2CPP` 컴파일러가 `async/await` 키워드를 로직이 분할된 상태 머신(`State Machines`) 함수로 변환하는 방식에 있습니다.[^21] 이 프로세스들은 운영체제 하드웨어 코어 할당(`OS thread allocation`)을 요청하지 않고, `PlayerLoop` 루프에서 프레임을 양보하는 방식으로 동시성 특성(`pseudo-concurrency`)을 모방합니다.[^10] 따라서 개발자가 `Awaitable.BackgroundThreadAsync()`처럼 물리적 멀티스레딩을 강제하는 명령 호출만 피한다면, `Awaitable.NextFrameAsync`, 비동기 `Addressables` 로딩, `UnityWebRequest` 연결 관련 아키텍처는 `WebGL` 배포 시 완벽하고 매끄럽게 동작합니다.[^19]

## **요약 및 전환 전략 (Migration Strategy)**

`Coroutines`에서 `Awaitable`로의 세대교체는 단순히 문법 코드 몇 줄을 최신화하는 작업이 아니라, Unity 소프트웨어 개발의 아키텍처 사고방식과 기준에 있어 일대 도약입니다. `Object Pooling`을 통한 시간 분할 처리와 `PlayerLoop` 반복 시스템에 대한 장벽 없는 통합을 통해, Unity `Awaitable`은 기업용 `Task` 시스템처럼 강력하고 정밀하면서도 `UniTask`에 버금가는 가벼움과 시스템 메모리 친화성을 갖춘 조화로운 도구를 제공합니다.

Unity 2023.1 또는 Unity 6 이상 기반으로 새로 시작하는 프로젝트에서는 데이터 스트리밍, 파일 I/O, 네트워크 연결을 위한 핵심 표준(`backbone architecture`)으로 `Awaitable`을 채택하는 것이 명백한 모범 사례가 되었습니다.[^1] `Call Stack` 구석구석까지 흐르는 `CancellationToken`의 존재, `OperationCanceledException`의 깔끔한 처리 의무화, 그리고 `BackgroundThreadAsync` 스레드 전환 함수를 통한 연산량 분리는 견고함과 신뢰성을 최우선으로 삼는 코드 생태계를 구축합니다.[^10]

반면 이미 운영 중인 거대한 기존 프로젝트를 리팩토링(`Refactoring`)하는 경우에는 점진적 대체 로드맵(`gradual migration`)이 권장됩니다.[^1] 데이터 손실 위험을 원천 차단하기 위해 네트워크 서버 데이터 수신 라우터(`network payload streams`)나 정적 에셋 로딩(`Addressables loading`) 파이프라인을 먼저 격리하여 `Awaitable`의 `try/catch/finally` 체계로 업그레이드해야 합니다.[^1] 반대로 단순한 UI 그래픽 조작이나 몇 프레임만 지속되는 알파 값 변경 작업은 기존 `Coroutine` 시스템을 계속 사용해도 무방합니다.[^1] 중앙 집중식 취소 아키텍처와 `Pooling` 메모리 위반 함정에 대한 주의가 하나로 맞물릴 때, `Awaitable`은 연산 부담을 덜어 줄 뿐만 아니라 높은 내결함성과 무한한 확장성을 갖춘 소프트웨어 구조를 형성하게 될 것입니다.

## **참고문헌**

[^1]: Async vs. Coroutines in Unity: Better Game Development! | by Azin | Medium, 2026년 4월 25일 접속, [https://medium.com/@azinsf7/async-vs-coroutines-in-unity-better-game-development-bad059d8c004](https://medium.com/@azinsf7/async-vs-coroutines-in-unity-better-game-development-bad059d8c004)  
[^2]: Async in Unity: Main Thread First, Multithread When Needed - YouTube, 2026년 4월 25일 접속, [https://www.youtube.com/watch?v=GSjBWnfBzb0](https://www.youtube.com/watch?v=GSjBWnfBzb0)  
[^3]: Should I use Async & Await, instead of Coroutines, in Unity?, 2026년 4월 25일 접속, [https://gamedev.stackexchange.com/questions/185200/should-i-use-async-await-instead-of-coroutines-in-unity](https://gamedev.stackexchange.com/questions/185200/should-i-use-async-await-instead-of-coroutines-in-unity)  
[^4]: Async Programming in Unity - What You NEED To Know - YouTube, 2026년 4월 25일 접속, [https://www.youtube.com/watch?v=fMZ8ErK3YEI](https://www.youtube.com/watch?v=fMZ8ErK3YEI)  
[^5]: Performance in Unity: async, await, and Tasks vs. coroutines, C# Job System, and burst compiler - LogRocket Blog, 2026년 4월 25일 접속, [https://blog.logrocket.com/performance-unity-async-await-tasks-coroutines-c-job-system-burst-compiler/](https://blog.logrocket.com/performance-unity-async-await-tasks-coroutines-c-job-system-burst-compiler/)  
[^6]: Task vs UniTask vs Awaitable. Performance and API comparison. Is ..., 2026년 4월 25일 접속, [https://medium.com/@DanielMcRon/task-vs-unitask-vs-awaitable-performance-and-api-comparison-is-awaitable-a-new-leader-0e4904dfb0d4](https://medium.com/@DanielMcRon/task-vs-unitask-vs-awaitable-performance-and-api-comparison-is-awaitable-a-new-leader-0e4904dfb0d4)  
[^7]: UniTask: How It Replaces Coroutines, Tasks and Awaitable - YouTube, 2026년 4월 25일 접속, [https://www.youtube.com/watch?v=OlNJ2GkaPTE](https://www.youtube.com/watch?v=OlNJ2GkaPTE)  
[^8]: Introduction to asynchronous programming with Awaitable - Unity - Manual, 2026년 4월 25일 접속, [https://docs.unity3d.com/6000.3/Documentation/Manual/async-awaitable-introduction.html](https://docs.unity3d.com/6000.3/Documentation/Manual/async-awaitable-introduction.html)  
[^9]: Benchmarking Async/Await, Coroutine, and UniTask in Unity: Which One Is Best? (1), 2026년 4월 25일 접속, [https://prasetion.medium.com/benchmarking-async-await-coroutine-and-unitask-in-unity-which-one-is-best-1-59beec0fb53a](https://prasetion.medium.com/benchmarking-async-await-coroutine-and-unitask-in-unity-which-one-is-best-1-59beec0fb53a)  
[^10]: Cysharp/UniTask: Provides an efficient allocation free async/await integration for Unity. - GitHub, 2026년 4월 25일 접속, [https://github.com/cysharp/UniTask](https://github.com/cysharp/UniTask)  
[^11]: Awaitable code example reference - Unity User Manual 2021.3 (LTS), 2026년 4월 25일 접속, [https://docs.unity.cn/6000.0/Documentation/Manual/async-awaitable-examples.html](https://docs.unity.cn/6000.0/Documentation/Manual/async-awaitable-examples.html)  
[^12]: Am I shooting myself in the foot by using async/await/Task so much (Unity 2021.3.0f1)?, 2026년 4월 25일 접속, [https://www.reddit.com/r/Unity3D/comments/141rmup/am\_i\_shooting\_myself\_in\_the\_foot\_by\_using/](https://www.reddit.com/r/Unity3D/comments/141rmup/am_i_shooting_myself_in_the_foot_by_using/)  
[^13]: Awaitable completion and continuation - Unity - Manual, 2026년 4월 25일 접속, [https://docs.unity3d.com/6000.3/Documentation/Manual/async-awaitable-continuations.html](https://docs.unity3d.com/6000.3/Documentation/Manual/async-awaitable-continuations.html)  
[^14]: Understanding Threads, Async, and Delays in Unity | by Savva | Apr, 2026 | Medium, 2026년 4월 25일 접속, [https://medium.com/@savva2003m6\_57528/understanding-threads-async-and-delays-in-unity-d13a4e7111e9](https://medium.com/@savva2003m6_57528/understanding-threads-async-and-delays-in-unity-d13a4e7111e9)  
[^15]: Awaitable code example reference - Unity - Manual, 2026년 4월 25일 접속, [https://docs.unity3d.com/6000.3/Documentation/Manual/async-awaitable-examples.html](https://docs.unity3d.com/6000.3/Documentation/Manual/async-awaitable-examples.html)  
[^16]: Yield instruction reference - Unity - Manual, 2026년 4월 25일 접속, [https://docs.unity3d.com/6000.3/Documentation/Manual/coroutines-yield-instructions.html](https://docs.unity3d.com/6000.3/Documentation/Manual/coroutines-yield-instructions.html)  
[^17]: Timely Coroutines: A simple trick to eliminate unwanted frame delays : r/Unity3D - Reddit, 2026년 4월 25일 접속, [https://www.reddit.com/r/Unity3D/comments/1ivotdx/timely\_coroutines\_a\_simple\_trick\_to\_eliminate/](https://www.reddit.com/r/Unity3D/comments/1ivotdx/timely_coroutines_a_simple_trick_to_eliminate/)  
[^18]: Best practices: Async vs. coroutines - Unite Copenhagen 2019 | PPTX - Slideshare, 2026년 4월 25일 접속, [https://www.slideshare.net/slideshow/best-practices-async-vs-coroutines-unite-copenhagen-2019/185010336](https://www.slideshare.net/slideshow/best-practices-async-vs-coroutines-unite-copenhagen-2019/185010336)  
[^19]: unity - Is this code using Awaitable correct? - Game Development Stack Exchange, 2026년 4월 25일 접속, [https://gamedev.stackexchange.com/questions/212406/is-this-code-using-awaitable-correct](https://gamedev.stackexchange.com/questions/212406/is-this-code-using-awaitable-correct)  
[^20]: Async/Await & Unity Awaitable - Ali Emre Onur - Medium, 2026년 4월 25일 접속, [https://aliemreonur.medium.com/async-await-unity-awaitable-63805595c67e](https://aliemreonur.medium.com/async-await-unity-awaitable-63805595c67e)  
[^21]: Do coroutines produce garbage? : r/Unity3D - Reddit, 2026년 4월 25일 접속, [https://www.reddit.com/r/Unity3D/comments/10xqvof/do\_coroutines\_produce\_garbage/](https://www.reddit.com/r/Unity3D/comments/10xqvof/do_coroutines_produce_garbage/)  
[^22]: Unity 6 Async (new) vs Cysharp : r/Unity3D - Reddit, 2026년 4월 25일 접속, [https://www.reddit.com/r/Unity3D/comments/1j0zlri/unity\_6\_async\_new\_vs\_cysharp/](https://www.reddit.com/r/Unity3D/comments/1j0zlri/unity_6_async_new_vs_cysharp/)  
[^23]: Guide for UniTask and Awaitable in Unity 6 #627 - GitHub, 2026년 4월 25일 접속, [https://github.com/Cysharp/UniTask/discussions/627](https://github.com/Cysharp/UniTask/discussions/627)  
[^24]: Choose your poison : r/unity - Reddit, 2026년 4월 25일 접속, [https://www.reddit.com/r/unity/comments/1elkqsb/choose\_your\_poison/](https://www.reddit.com/r/unity/comments/1elkqsb/choose_your_poison/)  
[^25]: Asynchronous operation handles | Addressables | 2.0.8 - Unity - Manual, 2026년 4월 25일 접속, [https://docs.unity3d.com/Packages/com.unity.addressables@2.0/manual/AddressableAssetsAsyncOperationHandle.html](https://docs.unity3d.com/Packages/com.unity.addressables@2.0/manual/AddressableAssetsAsyncOperationHandle.html)  
[^26]: Addressables In Unity - Ali Emre Onur - Medium, 2026년 4월 25일 접속, [https://aliemreonur.medium.com/addressables-in-unity-eec8b03198d7](https://aliemreonur.medium.com/addressables-in-unity-eec8b03198d7)  
[^27]: How to use Addressable w/ UniTask or async/await in Unity - YouTube, 2026년 4월 25일 접속, [https://www.youtube.com/watch?v=0p0EGunlWTs](https://www.youtube.com/watch?v=0p0EGunlWTs)  
[^28]: Async operation handling | Addressables | 1.9.2 - Unity - Manual, 2026년 4월 25일 접속, [https://docs.unity3d.com/Packages/com.unity.addressables@1.9/manual/AddressableAssetsAsyncOperationHandle.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.9/manual/AddressableAssetsAsyncOperationHandle.html)  
[^29]: Unity async / await: Coroutine's Hot Sister : r/gamedev - Reddit, 2026년 4월 25일 접속, [https://www.reddit.com/r/gamedev/comments/sfjh0p/unity\_async\_await\_coroutines\_hot\_sister/](https://www.reddit.com/r/gamedev/comments/sfjh0p/unity_async_await_coroutines_hot_sister/)  
[^30]: Coroutines OR Async/await? : r/unity - Reddit, 2026년 4월 25일 접속, [https://www.reddit.com/r/unity/comments/zr39d4/coroutines\_or\_asyncawait/](https://www.reddit.com/r/unity/comments/zr39d4/coroutines_or_asyncawait/)  
[^31]: How to Cancel Tasks in C# - Using CancellationTokenSource and CancellationToken, 2026년 4월 25일 접속, [https://www.youtube.com/watch?v=TKc5A3exKBQ](https://www.youtube.com/watch?v=TKc5A3exKBQ)  
[^32]: A Deep Dive into C#'s CancellationToken | by Mitesh Shah | Medium, 2026년 4월 25일 접속, [https://medium.com/@mitesh\_shah/a-deep-dive-into-c-s-cancellationtoken-44bc7664555f](https://medium.com/@mitesh_shah/a-deep-dive-into-c-s-cancellationtoken-44bc7664555f)  
[^33]: How to Handle 'Task was canceled' Exceptions in C# - OneUptime, 2026년 4월 25일 접속, [https://oneuptime.com/blog/post/2025-12-23-handle-task-was-canceled-csharp/view](https://oneuptime.com/blog/post/2025-12-23-handle-task-was-canceled-csharp/view)  
[^34]: Mastering Coroutine Cancellation in Kotlin: Best Practices, Common Pitfalls, and Safe Handling of Repeating Tasks | by Shakarim Bazhenov | ProAndroidDev, 2026년 4월 25일 접속, [https://proandroiddev.com/age-mastering-coroutine-cancellation-in-kotlin-best-practices-common-pitfalls-and-safe-handling-41f702503977](https://proandroiddev.com/age-mastering-coroutine-cancellation-in-kotlin-best-practices-common-pitfalls-and-safe-handling-41f702503977)  
[^35]: Scripting API: Awaitable.Cancel - Unity - Manual, 2026년 4월 25일 접속, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Awaitable.Cancel.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Awaitable.Cancel.html)  
[^36]: The Silent Killer That's Crashing Your Coroutines | by Sam Cooper | Better Programming, 2026년 4월 25일 접속, [https://medium.com/better-programming/the-silent-killer-thats-crashing-your-coroutines-9171d1e8f79b](https://medium.com/better-programming/the-silent-killer-thats-crashing-your-coroutines-9171d1e8f79b)  
[^37]: c# - Elegantly handle task cancellation - Stack Overflow, 2026년 4월 25일 접속, [https://stackoverflow.com/questions/12633903/elegantly-handle-task-cancellation](https://stackoverflow.com/questions/12633903/elegantly-handle-task-cancellation)  
[^38]: Unity Coroutine yield return null EQUIVALENT with Task async await - Stack Overflow, 2026년 4월 25일 접속, [https://stackoverflow.com/questions/47952972/unity-coroutine-yield-return-null-equivalent-with-task-async-await](https://stackoverflow.com/questions/47952972/unity-coroutine-yield-return-null-equivalent-with-task-async-await)  
[^39]: Unity async / await: Awaitable - YouTube, 2026년 4월 25일 접속, [https://www.youtube.com/watch?v=X9Dtb\_4os1o](https://www.youtube.com/watch?v=X9Dtb_4os1o)
