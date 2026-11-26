---
title: "심층 기술 보고서: Unity 6 분석 도구 생태계와 GilongWorld 프로젝트를 위한 실전 최적화 전략"
date: 2026-10-22 03:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, profiler, optimization, analysis, urp, render-graph, gilongworld]
description: "Unity 6의 Window > Analysis 메뉴에 포함된 13개 도구, 숨겨진 심층 진단 도구 및 오픈 월드 프로젝트 GilongWorld를 위한 실전 성능 최적화 전략을 종합적으로 분석합니다."
lang: ko
translation_id: unity6-analysis-tools-gilongworld
---

## **GilongWorld의 기술적 특성과 성능 과제 분석**

Long Gil Studio와 개발자 Huynh Long Gil이 개발 및 퍼블리싱하는 *GilongWorld*는 SF 액션 RPG와 오픈 월드를 결합한 하이퀄리티 인디 게임(AAA Indie) 프로젝트입니다[^1]. *GilongWorld*의 기술 아키텍처에서 가장 복잡한 지점은 3인칭 샌드박스(Third Person Sandbox) 환경 안에서 가장 리소스 소모가 큰 다섯 가지 게임플레이 시스템이 동시에 맞물려 작동한다는 점입니다[^2]. 이 게임은 SF 무기, 폭발물, 독성 물질에서 뿜어져 나오는 수많은 파티클 이펙트(VFX)와 함께 높은 프레임 응답성을 요구하는 액션 RPG 전투 시스템을 구현해야 하는 동시에, 고유의 능력치와 초자연적 스킬을 지닌 드래곤을 포함한 신화 속 생물을 길들이고 조종하는 시스템을 유지해야 합니다[^2]. 이러한 동료 생물 시스템은 스켈레탈 애니메이션 행렬 변환, 길찾기(Pathfinding) 알고리즘, 그리고 주인공과 탑승물 편대 간의 지속적인 상태 데이터 통신을 통해 CPU에 막대한 부하를 가합니다[^2].

전투와 인공지능의 부하 외에도 *GilongWorld*는 플레이어가 황무지를 개척해 견고한 요새로 탈바꿈시킬 수 있는 거점 건설(Base Building) 메커니즘, 외계 식물 품종을 재배하는 농업 시스템, 그리고 영약·알약·폭발물을 제조하는 연금술 제작 시스템을 통합하고 있습니다[^2]. 엔진 아키텍처 관점에서 플레이어가 자유롭게 구조물을 건설하도록 허용하면 런타임에 수천 개의 동적 오브젝트가 생성되어 메모리 단편화를 일으키고 기존의 정적 배칭(Static Batching)을 깨뜨리며, 물리 시스템과 내비게이션 메시(NavMesh)가 지속적으로 갱신되도록 강제합니다[^2]. 이와 동시에 농업 시스템은 광범위한 성장 상태 업데이트 루프와 미개척 영토를 이동할 때의 영구 데이터 저장 메커니즘을 요구하며, 연금술 시스템은 UI 상에서 수백 개의 복잡한 제작 레시피를 관리해야 합니다[^2]. 이 모든 복합 메커니즘은 DirectX 12 명령어 집합 기반의 사실적인 그래픽을 필수 요건으로 내건 Steam 플랫폼의 정해진 하드웨어 예산 안에서 원활히 작동해야 합니다[^2].

| 시스템 사양 | 최소 사양 (Minimum) | 권장 사양 (Recommended) | GilongWorld의 아키텍처적 영향 및 최적화 제약 |
| :---- | :---- | :---- | :---- |
| **운영체제 및 API** | Windows 10 (DirectX 12)[^2] | Windows 10/11 (DirectX 12)[^2] | 최신 DX12 표준에 맞춘 그래픽 명령 스트림(Render Thread) 최적화 및 GPU 버퍼 관리 필수[^2]. |
| **프로세서 (CPU)** | Intel Core i5-8500 / AMD Ryzen 5 2600X[^2] | Intel Core i5-11600K / AMD Ryzen 5 5600[^2] | 물리 코어 6개 제한; 모든 몬스터 AI, 거점 물리, 농업 루프는 멀티스레딩(Job System / Burst)으로 오프로드해야 함[^2]. |
| **시스템 메모리 (RAM)** | **16 GB RAM**[^2] | **16 GB RAM**[^2] | 두 사양 등급 간에 절대 메모리 상한이 증가하지 않음; 메모리 누수(Memory Leak)와 AssetBundle 내 리소스 중복 엄격히 금지[^2]. |
| **그래픽 카드 (GPU)** | GTX 1060 / RX 6500 XT[^2] | RTX 2080 / RX 6700 XT[^2] | RX 6500 XT는 4GB VRAM과 좁은 대역폭만 보유; 임시 Render Texture 재사용(Transient Resources)과 철저한 텍스처 압축 필수[^2]. |
| **저장 공간** | **35 GB** 사용 가능 공간[^2] | **50 GB** 사용 가능 공간[^2] | 방대한 리소스 규모(35–50 GB)로 인해 로딩 시 병목(Asset Streaming) 발생 및 Editor 내 Import 시간 장기화 위험[^2]. |

위 사양표에서 한 가지 핵심적인 기술적 역설이 드러납니다. 저장 공간은 35 GB에서 50 GB로 확대되고 GPU 연산 성능은 보급형 GTX 1060 / RX 6500 XT에서 하이엔드 RTX 2080 / RX 6700 XT로 대폭 상승하는 반면, 시스템 RAM 용량은 최소 사양과 권장 사양 모두 16 GB로 동일하게 고정되어 있습니다[^2]. Windows 10/11 운영체제와 DirectX 12 드라이버가 이미 상당한 백그라운드 메모리를 점유하는 상황에서, *GilongWorld* 실행 프로세스는 오픈 월드 지형 전체, 플레이어가 건설한 요새 구조물, 길들인 생물 모델, 연금술 이펙트를 모두 담아내기 위해 극도로 엄격한 메모리 상한선을 견뎌야 합니다[^2]. 또한 작업 환경에 Render Graph Viewer, Performance Markers, Project Auditor 같은 전문 도구가 존재한다는 것은 이 프로젝트가 최신 Universal Render Pipeline (URP) 렌더링 파이프라인을 갖춘 Unity 6 플랫폼 기반으로 개발되고 있음을 보여줍니다[^10]. `Window > Analysis` 메뉴의 13개 도구 전체와 숨겨진 진단 도구를 완벽히 숙달하는 것은 이 성능 과제를 해결하기 위한 생존의 필수 조건입니다[^13].

![GilongWorld 하드웨어 예산과 Unity 6의 13개 Analysis 도구 매트릭스](/assets/img/posts/2026-10-22/gilongworld-hardware-budget-analysis-tools.png){: .shadow .rounded-10 }
_그림 1: GilongWorld의 하드웨어 예산(16 GB RAM, 35–50 GB, GTX 1060 / RX 6500 XT, i5-8500)과 Unity 6의 Analysis 도구 및 숨겨진 도구 매트릭스_

## **Analysis 메뉴의 13개 도구 상세 분석 및 GilongWorld 실전 적용**

*GilongWorld*처럼 복합적인 프로젝트를 최적화하기 위해 `Window > Analysis` 메뉴의 13개 도구는 Unity Engine의 핵심 아키텍처 계층에 대응하는 네 개의 전문 기능 그룹으로 나뉩니다[^13].

### **그룹 1: 실행 성능 측정 (Runtime & Editor Performance Profiling)**

첫 번째 그룹은 게임과 에디터 양쪽의 구동 과정 전반에서 CPU 실행 시간, 메모리 소비량, 프레임 지연을 감시하는 레이더 시스템 역할을 합니다[^8].

#### **Profiler (Ctrl+7)**

Profiler는 Unity Engine의 C++ 소스 코드에 내장된 마커와 `ProfilerMarker` API를 통해 C# 코드에 추가한 커스텀 마커를 결합하여 애플리케이션의 프레임별 원격 측정 데이터를 수집하는 도구입니다[^19]. 수집된 데이터는 CPU Usage, Rendering, Memory, Audio, Physics, UI and UI Details, File Access, Global Illumination, Video, Asset Loading 등 전문 모듈로 세분화됩니다[^8]. *GilongWorld*의 실제 개발 맥락에서 이 도구는 전투 및 연금술 제작 시 발생하는 CPU 처리 시간 급증(CPU Spikes)을 제어하는 데 결정적인 역할을 합니다[^2]. 플레이어가 연금술 폭약을 기폭시키거나 신화 속 생물이 광역 스킬을 시전할 때 CPU Usage 모듈을 분석하면, 프레임 끊김의 원인이 메인 스레드에서의 파티클 오브젝트 인스턴스화 및 가비지 메모리 할당 때문인지, 아니면 DirectX 12에서 드로우 콜을 처리하느라 렌더 스레드가 과부하에 걸렸기 때문인지를 정확히 판별할 수 있습니다[^2]. 동시에 Asset Loading과 File Access 모듈을 모니터링하면 플레이어가 탈것을 타고 미개척 영토를 질주할 때 35–50 GB 저장 패키지에서 데이터를 읽어들이는 속도를 점검하여, 비동기 에셋 스트리밍 스레드가 메인 스레드를 막지 않도록 보장할 수 있습니다[^2].

#### **Profiler (Standalone Process)**

`Window > Analysis > Profiler (Standalone Process)` 경로로 실행하면 Unity는 Profiler 창을 Unity Editor 프로세스와 완전히 분리된 독립 운영체제 프로세스로 띄웁니다[^16]. 이러한 프로세스 분리 메커니즘은 두 가지 중요한 기술적 문제를 해결합니다. 첫째, 메인 Editor 내부에서 Profiler 그래프 UI를 그리고 히스토리 데이터를 저장하는 것 자체가 CPU와 메모리를 소모하여 독립 빌드(Standalone Build)에 연결했을 때 측정 결과를 왜곡하기 쉽다는 점입니다. 둘째, 이 분리된 프로세스는 Unity Editor 자체의 성능을 측정하기 위해 특별히 설계되었습니다[^16]. *GilongWorld*에 적용할 경우, 최소 목표 사양(Core i5-8500 및 16 GB RAM)에서 빌드를 테스트할 때 Profiler (Standalone Process)를 사용하면 실행 중인 프로세스에서 Profiler UI의 부담을 제거해 가장 정확한 수치를 수집할 수 있습니다[^2]. 더 나아가 Long Gil Studio 개발팀은 이 도구를 사용해 연금술 레시피 에디터, 몬스터 능력치 설정 도구, Scene View 거점 건설 도구 같은 내부 제작 툴을 진단하여 일상적인 작업 흐름을 느리게 만드는 Editor 함수를 즉시 찾아낼 수 있습니다[^2].

#### **Profile Analyzer**

표준 Profiler 창이 단일 프레임을 세밀하게 해부하는 데 집중하는 반면, Profile Analyzer는 연속된 다수의 프레임 시퀀스에 대해 수학적·통계적 분석을 수행하여 시스템 전반에 깔린 병목을 찾아내는 도구입니다[^20]. 수백 또는 수천 프레임에 걸쳐 마커의 실행 시간 데이터를 집계하고 소스 코드 수정 전후의 두 캡처 기록을 직접 비교할 수 있어, 프레임 간의 무작위 변동으로 인한 왜곡을 제거합니다[^24]. 수백 그루의 외계 작물이 성장하는 동시에 수십 마리의 야생 생물이 플레이어의 요새 주변을 배회하는 *GilongWorld*처럼 상호작용 밀도가 높은 오픈 월드에서는 매 프레임의 처리 시간이 크게 출렁입니다[^2]. Profiler에서 단 한 프레임만 들여다보면 최적화 효과에 대해 잘못된 결론을 내리기 쉽습니다. 거점에서의 장시간 전투 세션 데이터를 수집해 Profile Analyzer에 넣으면, 멀티스레딩 적용 후 길들인 생물의 길찾기 스크립트나 농장 업데이트 루프의 중앙값(Median) 처리 시간이 얼마나 줄었는지에 대한 확고한 정량적 근거를 확보할 수 있습니다[^2].

#### **Performance Markers**

Unity 6 생태계의 `Window > Analysis > Performance Markers` 경로에 새롭게 등장한 이 창은 Performance Trackers(쿼리 접두사 `perf:`)와 Profiler Markers(쿼리 접두사 `profile:`)라는 두 데이터 공급자를 통해 Unity Search의 강력한 검색 기능을 활용하는 전용 도구입니다[^14]. 이 도구는 두 종류의 마커에서 수집한 데이터를 통계표 형태로 표시합니다. 하나는 Profiler를 열었을 때 활성화되어 실행 시간과 메모리 할당 정보를 모두 상세히 기록하는 `ProfilerMarker`이며, 다른 하나는 극히 낮은 오버헤드로 Editor 내부에서 항상 작동하며 작업 실행 시간을 기록하는 `EditorPerformanceTracker`입니다[^21]. Performance Markers의 압도적인 강점은 `avg>1ms`, `avg<512kb`, `lastTime<1ms`, `peak=0.5`, `count>1000`, `total=0.5`와 같은 시간 및 메모리 용량 기반 정량 쿼리 필터에 더해, 특정 마커를 더블클릭하면 국소 Deep Profiling을 켜고 해당 마커 하위의 호출 트리만 보여주는 Profiler 창을 여는 기능에 있습니다[^14]. *GilongWorld*에서 거점 건설 배치 시스템이나 몬스터의 거리 감지 시스템이 Burst Job과 `RaycastCommand`를 통해 매 프레임 수백 번의 레이캐스트를 수행해야 할 때, 엔지니어는 전체 프레임 계층 구조를 수작업으로 뒤질 필요 없이 Performance Markers를 열어 `Physics.Raycast`를 직접 조회함으로써 평균 처리 시간이 수 마이크로초 수준(예: 디버그 모드 기준 3.7마이크로초)으로 유지되는지 즉시 확인할 수 있습니다[^2].

### **그룹 2: 그래픽 및 렌더링 파이프라인 디버깅 (Graphics & Rendering Pipeline Debugging)**

DirectX 12 명령어 집합 위에서 SF 배경의 사실적인 그래픽을 구현하면서도 GTX 1060 및 RX 6500 XT 같은 보급형 그래픽 카드에서 부드러운 성능을 보장해야 하므로, 그래픽 도구 그룹은 GPU 병목을 해소하는 핵심 열쇠입니다[^2].

#### **Frame Debugger**

Frame Debugger는 임의의 한 프레임에서 렌더링 과정을 동결하고 해당 프레임 전체를 GPU로 전송되는 일련의 순차적 드로우 이벤트(Draw Calls)로 분해해 줍니다[^10]. 각 드로우 단계를 확인하면서 개발자는 해당 드로우 콜이 완료된 직후의 이미지 버퍼 상태를 관찰하고, Shader에 전달되는 파라미터를 검증하며, 오브젝트들이 왜 하나로 배칭(Batching)되지 않았는지 원인을 규명할 수 있습니다[^10]. *GilongWorld*에서 플레이어가 외계 작물 밭과 탈것 무리로 둘러싸인 수천 개의 벽체, 바닥, 야금 기계 부재로 구성된 거대 요새를 건설하면, DirectX 12를 통해 전송되는 드로우 콜 수가 급증하여 Core i5-8500 프로세서에 과부하를 줄 수 있습니다[^2]. 거점을 정면으로 바라보는 시점에서 Frame Debugger를 사용하면 그래픽 엔지니어는 조립식 건축 파츠들에 URP의 드로우 콜 배칭 메커니즘(SRP Batcher)이 제대로 작동하고 있는지, 아니면 일관되지 않은 머티리얼 배리언트로 인해 배칭이 깨지고 있는지를 즉각 검증할 수 있습니다[^2].

#### **Rendering Debugger**

Rendering Debugger는 URP 렌더링 파이프라인에 통합된 실시간 진단 도구로, Shader를 재컴파일하지 않고도 게임 실행 중에 머티리얼 속성, 라이팅 모드, 이미지 버퍼 레이어를 검사하고 덮어쓸 수 있게 해줍니다[^27]. *GilongWorld*에서는 연금술 폭탄 폭발, 독성 안개, 몬스터의 초자연적 스킬 이펙트가 결합된 전투에서 반투명 파티클 레이어가 여러 겹 겹치는 현상이 빈번하게 발생합니다[^2]. 메모리 대역폭이 엄격히 제한된 최소 사양 그래픽 카드 RX 6500 XT에서는 이러한 독구름으로 인한 픽셀 중복 그리기(Overdraw) 현상이 프레임 속도를 급격히 떨어뜨립니다[^2]. Rendering Debugger를 활성화하면 테크니컬 아티스트가 오버드로우 밀도 검사 모드를 켜고 오픈 월드의 다양한 조명 조건 아래에서 SF 머티리얼 채널의 정확성을 검증하여 파티클 크기를 현장에서 즉시 미세 조정할 수 있습니다[^2].

#### **Render Graph Viewer**

Unity 6의 `Window > Analysis > Render Graph Viewer` 경로에 도입된 이 도구는 프레임마다 최적화된 Universal Render Pipeline의 전체 렌더링 체인을 시각화합니다[^13]. 개발자가 이미지 버퍼를 수동으로 할당·해제하다가 메모리 누수나 전역 변수를 통한 중복 의존성을 유발하는 대신, Render Graph 시스템은 각 렌더 패스(`ScriptableRenderPass`)가 `RecordRenderGraph` 메서드 내부에서 리소스 읽기(`AccessFlags.Read`)와 쓰기(`AccessFlags.Write`) 의도를 명확히 선언하도록 요구합니다[^6]. 이 선언을 바탕으로 Render Graph 컴파일러는 의존성 맵을 구축하고 세 가지 핵심 최적화 메커니즘을 자동 적용합니다. 최종 출력 이미지에 기여하지 않는 렌더 패스를 자동으로 제거(Pass Culling)하고, 생명 주기가 겹치지 않는 임시 버퍼(Transient Textures)의 GPU 메모리를 재사용하며, 연속된 여러 렌더 패스를 하나의 네이티브 패스로 병합(Pass Merging)합니다[^6].

Render Graph Viewer의 UI에서는 렌더 패스가 가로축을 따라 왼쪽에서 오른쪽으로 나열되며, 이미지 리소스와 데이터 버퍼는 세로축을 따라 위에서 아래로 배치됩니다[^10]. 도구는 읽기 작업을 녹색, 쓰기 작업을 빨간색으로 표시하고, 성공적으로 병합된 렌더 패스들(예: Draw Opaque Objects에서 Setup Post FX까지 이어지는 5단계 시퀀스) 아래에는 끊김 없는 파란색 밑줄을 표시합니다[^6]. 또한 이 창은 Unsafe Pass(`AddBlitPass` 또는 구형 호환 API인 `SetRenderTarget`을 사용하는 패스)와 Compute Passes를 필터링해 보여주는 기능을 제공하며, 클릭 한 번으로 C# 코드 편집기에서 해당 렌더 패스가 정의된 줄로 바로 이동할 수 있도록 지원합니다[^10].

![Render Graph 다이어그램: Read/Write 작업, Merged Native Render Pass 및 Shared GPU Memory Pool](/assets/img/posts/2026-10-22/render-graph-pass-merging.png){: .shadow .rounded-10 }
_그림 2: Read(녹색) / Write(적색) 작업, Merged Native Render Pass 및 Shared GPU Memory Pool을 통한 Transient Texture 재사용을 보여주는 Render Graph 다이어그램_

*GilongWorld*에 Render Graph Viewer를 적용하면, 개발팀은 SF 열화상 스캔 고글, 연금술 독소 현기증 효과, 몬스터 길들이기 발광 효과 등 커스텀 포스트 프로세싱 이펙트를 구현할 때 GTX 1060 및 RX 6500 XT에서의 VRAM 소비량을 직접적으로 최적화할 수 있습니다[^2]. 의존성 그래프를 관찰함으로써 그래픽 엔지니어는 Copy Color와 같은 불필요한 버퍼 복사 패스를 즉시 찾아내고, 패스 간에 공유되는 모든 데이터가 성능을 저하시키는 전역 변수 대신 `FrameData` 객체를 통해 전달되고 있음을 확인할 수 있습니다[^10].

### **그룹 3: 물리, 입력 및 인터페이스 디버깅 (Physics, Input & IMGUI Debugging)**

세 번째 그룹은 물리 상호작용 계층, 플레이어 제어 신호 인식 시스템, 그리고 프로그래밍 툴 인터페이스에 직접 개입합니다.

#### **Physics Debugger**

Physics Debugger는 Scene의 3차원 공간 내에서 모든 콜라이더(Collider) 형상, 물리 오브젝트의 활성 상태, 그리고 레이어별 충돌 매트릭스를 시각적으로 관찰할 수 있게 해줍니다. *GilongWorld*에서는 자유로운 거점 건설 메커니즘과 거대한 신화 속 생물과의 전투가 결합되어 물리 시스템 과부하 위험이 매우 큽니다[^2]. 플레이어가 수백 개의 요새 벽, 야금 설비, 경작지 블록을 조립할 때 이 오브젝트들이 정적 콜라이더(Static Collider)로 올바르게 설정되지 않거나 휴면 상태(Sleeping)로 전환되지 않으면, 물리 시뮬레이션 스레드가 Core i5-8500 프로세서의 CPU 사이클을 대량으로 소모하게 됩니다[^2]. Physics Debugger를 활용하면 엔지니어가 전체 요새 구조를 육안으로 점검하여 불필요하게 복잡한 메시 콜라이더(Mesh Collider)를 제거하고, 고속 교전 중에 드래곤과 야생 몬스터의 뼈대에 부착된 히트박스 영역이 정확히 일치하는지 점검할 수 있습니다[^2].

#### **Input Debugger**

Input Debugger는 입력 제어 시스템을 위한 심층 진단 도구로, 하드웨어 장치 상태, 입력 이벤트 스트림, 그리고 제어 스크립트(Action Map)의 활성화 상태를 실시간으로 추적합니다. *GilongWorld*처럼 복합 메커니즘을 갖춘 게임에서 플레이어는 3인칭 전투 캐릭터 조작, 길들인 몬스터의 스킬 사용 명령, 연금술 제작 창 열기, 거점 건설 시 그리드 정렬 모드, 농작물 수확 등 다양한 제어 컨텍스트 사이를 끊임없이 전환해야 합니다[^2]. 만약 건축 블록을 배치하려고 클릭했는데 실수로 무기 공격이 나가거나 폭약 병을 던지는 충돌 버그가 발생한다면, Input Debugger를 통해 게임플레이 상태가 전환될 때 제때 비활성화되지 않고 백그라운드에서 계속 작동하던 제어 맵이 무엇인지 정확히 추적할 수 있습니다[^2].

#### **IMGUI Debugger**

IMGUI Debugger는 기존의 Immediate Mode GUI 시스템으로 작성된 인터페이스의 레이아웃 구조, 표시 규칙, 호출 스택을 검사하는 데 사용됩니다. *GilongWorld*의 주된 플레이어용 UI는 최신 기술로 구축되더라도, Unity Editor의 내부 도구 창이나 생물을 소환하고 연금술 레시피를 테스트하기 위한 빠른 치트 콘솔(Cheat Console)에는 여전히 IMGUI 시스템이 빈번히 사용됩니다[^2]. Editor 내 설계 도구 창에서 화면 영역이 어긋나거나 마우스 클릭을 받지 못하는 오류가 발생했을 때, IMGUI Debugger는 어떤 UI 요소가 입력 제어권을 가로채고 있는지 정확히 지목하여 툴 프로그래머가 즉시 수정할 수 있도록 돕습니다.

### **그룹 4: 소스 코드, 리소스 및 프로젝트 설정 검증 (Static Analysis, Asset Pipeline & Code Quality)**

네 번째 그룹은 소스 코드 및 에셋 데이터베이스 계층에서 자동화된 품질 관리 시스템으로 작동하여, 제품 패키징 직전에 용량 비대화와 성능 저하 버그를 사전에 차단합니다[^17].

#### **Code Coverage**

자동화 테스트 프레임워크인 Unity Test Framework와 통합된 Code Coverage 도구는 Edit Mode 및 Play Mode 테스트를 통해 실행된 C# 코드 라인, 조건 분기, 메서드의 비율을 백분율로 측정합니다[^20]. *GilongWorld*에서는 연금술 영약 배합 알고리즘, 외계 작물의 성장 시간 계산 공식, 거점 자원 관리 시스템, 길들인 몬스터의 전투력 환산 테이블처럼 엄격한 규칙과 수학적 연산에 기반한 시스템들이 절대적인 정확성을 요구합니다[^2]. 이러한 핵심 시스템에 대한 자동화 테스트 세트를 구축하고 Code Coverage로 추적하면, 개발팀은 아직 한 번도 검증되지 않은 예외 로직 분기(예: 작물 수확 시 인벤토리 초과 상황이나 중첩 독성 피해 계산 오류)를 찾아내어 게임의 장기적인 안정성을 보장할 수 있습니다[^2].

#### **Import Activity**

`Window > Analysis > Import Activity`를 통하거나 Project 창 또는 Inspector 제목 표시줄에서 임의의 에셋을 우클릭해 `View in Import Activity Window`를 선택하여 여는 이 도구는 Asset Database에 에셋을 임포트하는 과정의 전체 이력과 성능 데이터를 투명하게 공개합니다[^11]. Import Activity UI는 고유 식별자 GUID, 원본 파일 크기(`Asset Size`), 밀리초 단위의 임포트 소요 시간(`Duration`), 에셋이 재임포트된 구체적인 사유(`Reason for Import`), Artifact ID와 함께 Library 폴더에 생성된 결과 파일 목록(`Produced Files / Artifacts` — `PreviewImporter`의 미리보기 파일 포함), 그리고 해당 에셋의 전체 의존성 체인(`Dependencies`)에 대한 상세 정보를 제공합니다[^12]. 특히 툴바에서 `Show Overview`를 선택하면 개요 표가 열려 의존성이 가장 많은 에셋 목록(`Most Dependencies`)과 임포트 시간이 가장 오래 걸리는 에셋 목록(`Longest Import Duration`)을 집계해 주며, 임포트 파이프라인의 비효율을 자동으로 짚어내고 해결 가이드를 제시하는 `Analyze Import Process` 기능을 제공합니다[^11].

주의해야 할 중요한 기술적 세부 사항은, 이전 임포트 기록 목록(`Show previous imports`)이 백그라운드에서 실행되는 Artifact 가비지 컬렉터로 인해 Unity Editor를 재시작할 때 자동으로 삭제된다는 점입니다. 심층 분석을 위해 여러 작업 세션에 걸쳐 이 기록을 보존하려면 `Edit > Project Settings > Editor`로 이동해 `Asset Pipeline` 항목에서 `Remove unused Artifacts on Restart` 옵션을 꺼야 합니다[^11]. 또한 커스텀 스크립트의 `OnPostprocessAllAssets` 함수 처리 시간은 통계표의 개별 에셋 임포트 시간에 합산되지 않습니다[^37]. 드래곤과 신화 속 생물들의 방대한 `.fbx` 모델(머티리얼과 애니메이션 같은 다수의 하위 artifact를 생성함)을 비롯해 플랫폼 변경이나 의존성 파일 수정 시 대량 재임포트가 발생하기 쉬운 복잡한 Compute Shader를 포함해 총 35–50 GB 규모에 달하는 *GilongWorld* 프로젝트에서, Import Activity는 전체 개발팀의 대기 시간을 단축하는 데 없어서는 안 될 필수 도구입니다[^2].

#### **Project Auditor**

Project Auditor(`com.unity.project-auditor`가 규칙 패키지 `com.unity.project-auditor-rules`와 함께 동작하며, Unity 6.4 버전부터는 Editor에 기본 내장됨)는 C# 소스 코드, 에셋, 프로젝트 설정 및 빌드 보고서(`BuildReport`)를 전수 스캔하여 최적화 경고를 제시하는 종합 정적 분석 도구입니다[^15]. Project Auditor의 특히 뛰어난 가치는 빌드 출력 시마다 숨겨지던 각 빌드 단계(`Build Steps`)별 소요 시간과 개별 에셋의 용량 점유 정보(`Size information`)를 담은 `BuildReport` 객체를 해독하여 시각적으로 표시해 주는 능력에 있습니다[^18]. `ProjectAuditorConfig` 설정 파일(보통 `Assets/Editor`에 위치)에서 `Save Build Reports` 옵션을 활성화하면, 모든 빌드 보고서가 `Assets/BuildReports` 폴더에 에셋 형태로 자동 저장되어 언제든 조회할 수 있습니다[^18].

*GilongWorld*에 실전 적용하면 Project Auditor 실행을 통해 전투, 농장, 연금술 시스템의 전체 소스 코드를 점검하여 테스트 단계에 들어가기 전에 가비지 메모리 할당을 유발하거나 CPU를 지연시키는 API 호출을 조기에 발견할 수 있습니다[^2]. 동시에 BuildReport 및 에셋 분석 기능은 개발팀이 설치 용량을 35–50 GB 범위 내로 엄격히 통제하고, DirectX 12 환경과 16 GB RAM 메모리에 맞게 올바르게 압축되지 않은 텍스처나 오디오 파일을 신속히 적발하는 데 큰 도움을 줍니다[^2].

## **GilongWorld의 개발 단계별 도구 배분 전략**

13개의 분석 도구를 산발적으로 사용하거나 프로젝트가 거의 완성될 때까지 측정을 미루면 결국 핵심 아키텍처를 전면 재작성해야 하는 위험을 초래합니다. *GilongWorld*와 같은 다중 시스템 오픈 월드 프로젝트에서는 생산 수명 주기의 다섯 단계 전반에 걸쳐 Analysis 메뉴의 도구들을 전략적인 로드맵에 따라 가동해야 합니다[^2].

| 개발 단계 | GilongWorld의 핵심 기술 목표 | 사용해야 할 주력 Analysis 도구 | 표준 실행 주기 및 워크플로우 |
| :---- | :---- | :---- | :---- |
| **1. 사전 제작 및 에셋 인제스천 (Pre-Production & Asset Ingestion)** | 3D 몬스터 모델, SF 거점 건축물, 텍스처 및 오디오 이펙트(35–50 GB 규모)의 임포트 파이프라인 표준화[^2]. | Import Activity, Project Auditor (Assets & Settings 모듈)[^11]. | 신규 에셋 팩을 추가하거나 `AssetPostprocessor` 스크립트를 작성할 때마다 점검하여 Import 시간을 최소화[^11]. |
| **2. 핵심 기능 프로토타이핑 및 반복 개발 (Feature Prototyping & Iteration)** | 액션 RPG 전투, 탈것 제어, 거점 건설 블록 배치, 작물 재배 및 연금술 UI 구축[^2]. | Input Debugger, Physics Debugger, Performance Markers, IMGUI Debugger[^7]. | 각 기능 코드를 작성하는 과정에서 매일 사용하여 충돌 로직, 입력 바인딩, 신규 함수의 마이크로초 단위 비용을 검증[^7]. |
| **3. 그래픽 룩데브, 셰이더 및 VFX 개발 (LookDev, Shaders & VFX)** | 오픈 월드 라이팅 구축, DirectX 12용 URP Custom Renderer Feature 작성, 독성 연기/연금술 폭약 이펙트 제작[^2]. | Render Graph Viewer, Rendering Debugger, Frame Debugger[^13]. | `RecordRenderGraph`를 작성하거나 Material/VFX를 미세 조정할 때 직접 열어 두어 Pass가 병합되고 Overdraw가 없는지 보장[^6]. |
| **4. 지속적 통합 및 자동화 테스트 (Automated Testing & CI/CD)** | 연금술 레시피 계산 정확도, 거점 저장/불러오기 무결성 보호 및 메인 브랜치로의 저품질 코드 유입 차단[^2]. | Code Coverage, Project Auditor (CLI `-batchmode` 실행)[^20]. | `-executeMethod` 명령줄 인자를 통해 매일 밤 빌드 서버에서 실행하거나 병합 요청(Pull Request) 시마다 자동화[^40]. |
| **5. 심층 최적화 및 출시 전 사양 확정 (Deep Optimization & Pre-Release)** | Core i5-8500 + GTX 1060 / RX 6500 XT 환경에서 안정적 FPS 확보, 16 GB RAM 미만 소비 유지 및 35–50 GB 이하 패키징[^2]. | Profiler, Profiler (Standalone Process), Profile Analyzer, Project Auditor (BuildReport)[^16]. | 최소 사양 타겟 하드웨어에서 실행되는 독립 빌드(Standalone Build)를 측정하고, 수정 전후 통계 비교에는 항상 Profile Analyzer 활용[^23]. |

첫 번째 단계에서 3D 아티스트 팀이 신화 속 생물 모델, 거점 구조물, SF 머티리얼을 지속적으로 프로젝트에 투입할 때, Import Activity와 Project Auditor의 에셋 검사 모듈을 즉각 활용해 표준 임포트 규칙(Presets)을 수립함으로써 단 하나의 잘못 설정된 에셋이 팀 전체의 컴파일 시간을 지연시키는 사태를 막아야 합니다[^2]. 두 번째 기능 구현 단계로 넘어가면, 게임플레이 프로그래머는 Performance Markers 창을 상시 띄워 두고 방금 작성한 알고리즘(예: 거점 건물 배치 시 지면 확인용 레이캐스트 시스템)의 실행 비용을 `avg>1ms` 또는 `avg<512kb` 같은 빠른 쿼리로 검증하는 동시에, Physics Debugger와 Input Debugger를 켜서 전투 손맛과 탈것 조작 응답성을 정교하게 다듬어야 합니다[^2].

세 번째 그래픽 고도화 단계에 진입하면 Render Graph Viewer, Rendering Debugger, Frame Debugger 3종 세트가 그래픽 팀의 주력 작업 도구가 되어 URP의 모든 Render Pass를 제어하고, 모든 연금술 이펙트와 SF 조명이 DirectX 12 환경에서 패스 병합과 임시 메모리 재사용 메커니즘을 최대한 활용하도록 보장합니다[^2]. 이와 병행해 네 번째 지속적 통합 단계에서는 명령줄을 통해 헤드리스(백그라운드) 모드로 Unity를 실행함으로써 Code Coverage와 Project Auditor를 자동화 검증 파이프라인에 통합해야 합니다[^20]:

```bash
path/to/unity/executable -batchmode -quit -projectPath path/to/your/project -executeMethod ProjectAuditorCI.AuditAndExport
```

이 자동화 스크립트 안에서 엔지니어는 `Assembly-CSharp` 어셈블리를 대상으로 `IssueCategory.Code` 카테고리를 지정한 `AnalysisParams` 객체를 생성하고 `AnalysisParams.WithAdditionalDiagnosticRules` 메서드를 결합하여 검사 규칙의 심각도(Severity)를 상향 조정한 뒤 결과를 `.json` 파일로 내보낼 수 있으며, 이를 통해 성능 저하를 유발하는 코드가 메인 개발 브랜치에 병합되기 전에 즉시 적발할 수 있습니다[^40]. 마지막으로 출시 직전 다섯 번째 총력 최적화 단계에서는 최소 사양 하드웨어에서 구동되는 빌드에 연결한 Profiler (Standalone Process), Profile Analyzer, 그리고 Project Auditor의 BuildReport를 결합하여 *GilongWorld*가 16 GB RAM과 GTX 1060 / RX 6500 XT 그래픽 카드 한계 내에서 완벽히 안정적으로 작동하도록 만듭니다[^2].

## **특별히 주목해야 할 숨겨진 분석 도구와 확장 진단 패키지**

`Window > Analysis` 메뉴에 직접 노출된 13개 도구 외에도, Unity 생태계에는 다른 메뉴 하위, 내부 진단 설정 패널(`Edit > Preferences > Diagnostics`), 명령줄 인자 또는 Package Manager의 확장 패키지 형태로 숨겨진 다수의 심층 분석 도구가 존재합니다[^43]. *GilongWorld*처럼 기술적 요구 수준이 까다로운 프로젝트에서는 이러한 숨겨진 도구들을 활성화함으로써 기본 도구 모음이 미처 해결하지 못하는 공백을 메울 수 있습니다.

### **전용 심층 Memory Profiler 패키지 (`com.unity.memoryprofiler`)**

표준 Profiler 창 내부에 내장된 Memory 모듈은 큰 범주별로 할당된 메모리 용량의 개괄적인 카운터만 제공합니다[^8]. *GilongWorld*의 최소 사양과 권장 사양 모두에서 변동 없는 **16 GB RAM** 상한을 진정으로 제어하려면, 개발팀은 Package Manager를 통해 **Memory Profiler** 패키지(`com.unity.memoryprofiler`)를 반드시 추가 설치하여 전용 메모리 분석 창을 활성화해야 합니다[^2]. 이 도구는 포괄적인 메모리 스냅샷(Memory Snapshots)을 촬영하고 서로 다른 시점에 찍은 두 스냅샷을 비교 저울에 올려 메모리 누수를 일으키는 정확한 오브젝트를 추적할 수 있으며, 가상 메모리 배치도(Memory Layout)를 시각화해 메모리 단편화 현상을 찾아냅니다[^8]. 플레이어가 오픈 월드를 탐험하며 끊임없이 거점을 짓고 작물을 수확하며 수십 종의 몬스터를 소환하는 과정에서, 여러 영토를 이동하기 전후의 메모리 스냅샷을 비교하면 RAM에서 해제되지 않은 무거운 그래픽 리소스를 즉각 포착할 수 있습니다[^2].

### **Addressables Analyze 창 (`Window > Asset Management > Addressables > Analyze`)**

최소 사양 **35 GB, 권장 사양 50 GB**에 달하는 총 저장 용량 규모를 고려할 때, *GilongWorld*에서 에셋을 패키징하고 로드하는 방식은 하드 디스크 용량과 RAM 메모리 양쪽에 직접적인 영향을 미칩니다[^2]. Addressables 시스템을 사용할 때 매우 중요한 분석 도구가 `Window > Asset Management > Addressables > Analyze` 경로에 숨어 있습니다[^45]. 이 창은 에셋 배치 검증 규칙을 실행하며 그중에서도 패키지 간 중복 의존성을 탐지하는 규칙(`Check Duplicate Bundle Dependencies`)이 가장 돋보이고, 프로젝트 요구에 맞춰 개발자가 직접 커스텀 `AnalyzeRules`를 작성하는 것도 허용합니다[^9]. 만약 SF 금속 머티리얼, 연금술 파티클 이펙트 또는 오디오 파일이 거점 에셋 그룹과 몬스터 에셋 그룹 양쪽에서 동시에 참조되면서 별도 분리되지 않았다면, Unity는 해당 에셋을 여러 AssetBundle 패키지에 중복 복제하여 디스크 공간을 낭비하고 게임 실행 중 16 GB RAM 메모리에 데이터를 중복 로드하게 됩니다[^2]. Addressables Analyze에서 보고서를 실행하면 이러한 모든 중복 지점을 낱낱이 드러내어 엔지니어가 데이터 번들을 최적으로 재구조화할 수 있게 해줍니다[^9].

### **UI Toolkit Debugger 및 Event Debugger (`Window > UI Toolkit > Debugger`)**

다층 구조의 연금술 제작 창, 아이템 인벤토리, 농장 관리 화면, 길들인 생물 목록 등 *GilongWorld*의 복잡한 사용자 인터페이스 시스템이 최신 UI Toolkit 기반으로 구축된다면, 이에 대응하는 진단 도구는 Analysis 메뉴가 아닌 `Window > UI Toolkit > Debugger`에 위치합니다(또는 Play Mode에서 단축키 ``Ctrl + Shift + ` ``를 누르거나 Game View 및 UI Builder 우측 상단의 점 세 개 메뉴 아이콘 `⋮`를 통해 빠르게 열 수 있습니다)[^2]. 웹 브라우저의 요소 검사기(DevTools)와 유사하게 작동하는 UI Toolkit Debugger는 실시간 `VisualElement` 계층 트리를 표시하고 일치하는 모든 USS 스타일 선택자(`Matching Selectors`)를 나열하며, 화면 속성을 실시간으로 편집해 즉시 결과를 확인하거나 다시 그리기 영역(Repaint), 레이아웃(Layout), 와이어프레임(Wireframe) 검사 컬러 오버레이를 켤 수 있습니다[^43].

UI Builder 내에서 직접 디버깅할 때는 뷰포트 주변에 주황색 테두리가 표시되는 Preview 모드를 켜야 디자이너의 숨겨진 마우스 이벤트 가로채기 요소를 비활성화하여 `Pick Element` 도구가 실제 UI 요소를 정확히 선택할 수 있습니다[^43]. 나아가 `ScrollView`, `ListView`, `Slider`, `DropdownField` 같은 복합 컨트롤에는 UI Builder에서 흐리게 표시되는 숨겨진 내부 자식 요소(예: `#unity-content-container`)가 항상 포함되어 있으므로, *GilongWorld* UI를 설계할 때 내부 USS 클래스 이름을 파악하고 마우스 이벤트 흐름을 추적하려면 UI Toolkit Debugger와 Event Debugger를 함께 사용하는 것이 유일한 방법입니다[^56].

### **Preferences, Project Settings 및 명령줄 인자의 저수준 진단 스위치**

`Edit > Preferences > Diagnostics`(macOS에서는 `Unity > Settings > Diagnostics`), `Edit > Preferences > Jobs` 창과 `Asset Pipeline` 설정 내부 깊이에는 가장 까다로운 시스템 버그를 해결해 주는 내부 진단 스위치들이 자리하고 있습니다[^12].

| 숨겨진 진단 스위치 / CLI 인자 | Unity 내 활성화 경로 | 심층 진단 메커니즘 및 GilongWorld 적용 방안 |
| :---- | :---- | :---- |
| **ObjectSetDirty 진단 플래그** | `Edit > Preferences > Diagnostics > Core > ObjectSetDirty` (Editor 재시작 및 Stack Trace Logging을 Full로 설정)[^12]. | 오브젝트가 변경됨으로 표시되거나(`Increment Dirty(count) : [InstanceID] ObjectName`) 플래그가 지워질 때(`Clear Dirty(0)`) 전체 호출 스택을 Editor Log에 출력합니다[^12]. *GilongWorld*의 몬스터 Prefab이나 Scene이 자동으로 Dirty 상태가 되어 Git 충돌을 일으키고 Editor가 에셋을 계속 재임포트하게 만드는 원인을 찾아내는 데 도움을 줍니다[^12]. |
| **Enable FMOD Profiling** | `Edit > Preferences > Diagnostics > Audio > Enable FMOD Profiling`[^61]. | Audio Mixer 내 개별 오디오 이펙트 필터(DSP Effect)별 CPU 소비량 측정 기능을 잠금 해제합니다[^61]. `Auto Mixer Suspend` 기능(음량 차단 임계값을 기본값 `-80 dB`보다 높게 설정)과 결합해 백그라운드에서 실행되는 수백 개의 환경음 및 몬스터 울음소리로 인한 CPU 스파이크를 차단합니다[^61]. |
| **Jobs Leak Detection Level + CLI Stats** | `Edit > Preferences > Jobs > Leak Detection Level > Enabled with Stack Trace` 및 실행 인자 `-log-memory-performance-stats` 병행[^47]. | *GilongWorld*가 길찾기나 레이캐스트 시스템에 Burst Jobs와 UniTask를 사용할 때[^7], `NativeContainer`에서 `Dispose()` 호출을 누락하거나 (`Allocator.Persistent` 대신) 4프레임 이상 유지되는 임시 할당자를 사용하면 메모리 누수가 발생합니다[^47]. 이 설정은 누수를 일으킨 정확한 호출 스택을 출력해 줍니다[^47]. |
| **진단 스위치 초기화 (`--reset-diagnostic-switches`)** | 프로젝트 실행 시 Unity Hub 또는 `.bat` 파일을 통해 `--reset-diagnostic-switches` 인자 전달[^47]. | `Preferences > Diagnostics`의 플래그들은 Engine 코어 깊숙이 영향을 주어 Editor를 불안정하게 만들 수 있으므로, 이 명령줄 인자는 모든 진단 설정을 기본 상태로 되돌리는 안전장치 역할을 합니다[^47]. |
| **숨겨진 에셋 임포트 파이프라인 최적화 (Asset Pipeline Tweaks)** | `Project Settings > Editor > Asset Pipeline > Parallel Import` 및 `Preferences > Asset Pipeline > Compress Textures on Import`[^12]. | Textures, Models, Audio를 멀티스레드로 임포트하도록 `Parallel Import`를 켜고, `Compress Textures on Import`를 끄며(`EditorUserSettings.asset`에서 `m_CompressAssetsOnImport: 0` 설정 가능), Rider 자동 새로고침과 `Index on Editor Startup`(`Preferences > Search > Indexing`)을 꺼서 35–50 GB 에셋 저장소에서의 작업 속도를 가속합니다[^12]. |

위 내부 스위치 외에도 프로그래머가 *GilongWorld*의 오픈 월드를 위해 에셋 일괄 처리 도구(예: `AssetDatabase.CopyAsset` 또는 `DeleteAsset`을 사용해 작물 Prefab이나 거점 건축 파츠를 자동 생성하는 도구)를 작성할 때는, 각 명령줄마다 데이터베이스가 새로고침되어 Editor가 멈추는 현상을 막기 위해 반드시 호출 횟수가 정확히 짝을 이루는 `AssetDatabase.StartAssetEditing()`과 `AssetDatabase.StopAssetEditing()` 함수 쌍으로 해당 코드 블록을 감싸야 합니다[^2]. 마지막으로 DirectX 12 하드웨어 계층에서 Unity는 GPU 성능 마커(`D3DPERF_BeginEvent` 및 `D3DPERF_EndEvent`)를 그래픽 드라이버로 직접 전달하는 기능을 지원합니다[^2]. GTX 1060 / RTX 2080 및 RX 6500 XT / RX 6700 XT를 위한 최종 최적화 단계에서, 개발팀은 하드웨어 제조사의 저수준 그래픽 프로파일러(예: NVIDIA Nsight 또는 AMD 분석 도구)를 함께 활용해 이 마커들을 읽어 들이고 각 목표 GPU 아키텍처에서 Vertex Shader, Pixel Shader, Compute Shader 단계별 정확한 점유 시간을 측정해야 합니다[^2].

## **요약 및 GilongWorld 실전 도입 로드맵**

*GilongWorld*처럼 여러 복합 메커니즘을 결합한 대규모 프로젝트가 **16 GB RAM** 한계, **35–50 GB** 저장 용량 예산, 그리고 최소 사양 **Core i5-8500 / Ryzen 5 2600X** 및 **GTX 1060 / RX 6500 XT** 성능을 초과하지 않으면서 DirectX 12 위에서 최적의 퍼포먼스를 달성하려면, Long Gil Studio 개발팀은 Unity 6의 분석 도구 생태계를 일관된 엔지니어링 워크플로우로 통합해야 합니다[^2].

일상적인 제작 워크플로우에서는 Parallel Import 활성화, Import Activity를 통한 의존성 체인 점검, 그리고 숨겨진 `ObjectSetDirty` 플래그 활용을 통해 방대한 에셋 규모 앞에서도 에디터의 작업 속도를 지켜낼 수 있습니다[^11]. 전투, 몬스터 길들이기, 요새 건설 및 연금술 기능을 구현하는 동안에는 Performance Markers, Physics Debugger, Input Debugger, UI Toolkit Debugger를 상시 활용하여 미세 병목이 싹트는 즉시 찾아내고 제거할 수 있습니다[^2]. 그래픽 및 메모리 계층에서는 Render Graph Viewer, Frame Debugger, Rendering Debugger, 확장 Memory Profiler 패키지, Addressables Analyze 창 간의 긴밀한 공조를 통해 모든 이미지 버퍼가 효율적으로 재사용되고 어떠한 리소스도 메모리에 중복 로드되지 않도록 보장합니다[^6]. 마지막으로 지속적 통합 파이프라인에 Project Auditor와 Code Coverage를 자동화하고 Profiler (Standalone Process) 및 Profile Analyzer를 통한 대조 측정을 결합하면, 견고한 품질 보증 체계를 구축하여 *GilongWorld*를 완성도 높은 AAA Indie 프로젝트의 기술적 표준으로 끌어올릴 수 있습니다[^3].

---

## **참고문헌**

[^1]: GilongWorld trên Steam - [https://store.steampowered.com/app/4615990/GilongWorld/?l=vietnamese](https://store.steampowered.com/app/4615990/GilongWorld/?l=vietnamese)
[^2]: GilongWorld on Steam - [https://store.steampowered.com/app/4615990/GilongWorld/](https://store.steampowered.com/app/4615990/GilongWorld/)
[^3]: Support Long Gil Studio - Ko-fi - [https://ko-fi.com/A0A01PQDEB/posts](https://ko-fi.com/A0A01PQDEB/posts)
[^4]: GilongWorld - SteamDB - [https://steamdb.info/app/4615990/](https://steamdb.info/app/4615990/)
[^5]: GilongWorld - Steam Community - [https://steamcommunity.com/app/4615990](https://steamcommunity.com/app/4615990)
[^6]: Unity 6 URP Render Graph Deep Dive: Why Rendering Moved to a - [https://gamedevllm.com/en/unity6-urp-render-graph-basics-en/](https://gamedevllm.com/en/unity6-urp-render-graph-basics-en/)
[^7]: Best way to detect a true range of a transform? : r/Unity3D - Reddit - [https://www.reddit.com/r/Unity3D/comments/1s1xhs6/best_way_to_detect_a_true_range_of_a_transform/](https://www.reddit.com/r/Unity3D/comments/1s1xhs6/best_way_to_detect_a_true_range_of_a_transform/)
[^8]: Memory Profiler module introduction • Unity Editor • Unity Docs - [https://docs.unity.com/en-us/engine/6000.5/manual/analysis/profiler/visualizing-data/memory/introduction](https://docs.unity.com/en-us/engine/6000.5/manual/analysis/profiler/visualizing-data/memory/introduction)
[^9]: Suggested Addressables Analyze tool improvements - [https://discussions.unity.com/t/suggested-addressables-analyze-tool-improvements/777614](https://discussions.unity.com/t/suggested-addressables-analyze-tool-improvements/777614)
[^10]: Migrating to Render Graph tutorial: Understanding the RenderGraph - [https://discussions.unity.com/t/migrating-to-render-graph-tutorial-understanding-the-rendergraph-samples/1715833](https://discussions.unity.com/t/migrating-to-render-graph-tutorial-understanding-the-rendergraph-samples/1715833)
[^11]: Import Activity window introduction - Unity Documentation - [https://docs.unity.com/en-us/engine/7000.0/manual/assets-and-media/import-assets/import-analyze/import-activity-window](https://docs.unity.com/en-us/engine/7000.0/manual/assets-and-media/import-assets/import-analyze/import-activity-window)
[^12]: Reducing Assets Import times in Unity - DEV Community - [https://dev.to/attiliohimeki/reducing-assets-import-times-in-unity-2kn2](https://dev.to/attiliohimeki/reducing-assets-import-times-in-unity-2kn2)
[^13]: Analyze a render graph in URP - Unity - Manual - [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/render-graph-view.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/render-graph-view.html)
[^14]: Search performance trackers - Unity Docs - [https://docs.unity.com/en-us/engine/6000.6/manual/unity-editor/editor-navigating-managing/editor-searching/search-overview/search-by-provider/search-performance-and-debugging-overview/search-performance](https://docs.unity.com/en-us/engine/6000.6/manual/unity-editor/editor-navigating-managing/editor-searching/search-overview/search-by-provider/search-performance-and-debugging-overview/search-performance)
[^15]: Project Auditor package - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.project-auditor@latest/](https://docs.unity3d.com/Packages/com.unity.project-auditor@latest/)
[^16]: Running the Profiler in its own process - Unity - Manual - [https://docs.unity3d.com/Manual/profiler-standalone-process.html](https://docs.unity3d.com/Manual/profiler-standalone-process.html)
[^17]: Import Activity window reference - Unity Docs - [https://docs.unity.com/en-us/engine/7000.0/manual/assets-and-media/import-assets/import-analyze/import-activity-window-reference](https://docs.unity.com/en-us/engine/7000.0/manual/assets-and-media/import-assets/import-analyze/import-activity-window-reference)
[^18]: Getting Started with Project Auditor - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.project-auditor@0.10/manual/GettingStarted.html](https://docs.unity3d.com/Packages/com.unity.project-auditor@0.10/manual/GettingStarted.html)
[^19]: Import Activity window - Unity - Manual - [https://docs.unity3d.com/2021.3/Documentation/Manual/ImportActivityWindow.html](https://docs.unity3d.com/2021.3/Documentation/Manual/ImportActivityWindow.html)
[^20]: Search profiler markers - Unity - Manual - [https://docs.unity3d.com/6000.2/Documentation/Manual/search-profiler-markers.html](https://docs.unity3d.com/6000.2/Documentation/Manual/search-profiler-markers.html)
[^21]: Performance Markers Editor Window - Unity Discussions - [https://discussions.unity.com/t/performance-markers-editor-window/1668474](https://discussions.unity.com/t/performance-markers-editor-window/1668474)
[^22]: UI Toolkit Debugger - Unity - Manual - [https://docs.unity3d.com/2022.3/Documentation/Manual/UIE-ui-debugger.html](https://docs.unity3d.com/2022.3/Documentation/Manual/UIE-ui-debugger.html)
[^23]: Understanding Memory usage - Unity Discussions - [https://discussions.unity.com/t/understanding-memory-usage/934773](https://discussions.unity.com/t/understanding-memory-usage/934773)
[^24]: Remote Visualization and Optimization of Fluid Dynamics Using - [https://www.mdpi.com/2076-3417/15/16/9017](https://www.mdpi.com/2076-3417/15/16/9017)
[^25]: Remote Visualization and Optimization in Fluid Dynamics via Mixed - [https://par.nsf.gov/servlets/purl/10597014](https://par.nsf.gov/servlets/purl/10597014)
[^26]: Search profiler markers • Unity Editor • Unity Docs - [https://docs.unity.com/en-us/engine/7000.0/manual/unity-editor/editor-navigating-managing/editor-searching/search-overview/search-by-provider/search-performance-and-debugging-overview/search-profiler-markers](https://docs.unity.com/en-us/engine/7000.0/manual/unity-editor/editor-navigating-managing/editor-searching/search-overview/search-by-provider/search-performance-and-debugging-overview/search-profiler-markers)
[^27]: Render graph system in URP - Unity - Manual - [https://docs.unity3d.com/6000.5/Documentation/Manual/urp/render-graph.html](https://docs.unity3d.com/6000.5/Documentation/Manual/urp/render-graph.html)
[^28]: Render graph system in URP - Unity Docs - [https://docs.unity.com/en-us/engine/6000.0/manual/render-pipelines/universal-render-pipeline/customizing-urp/render-graph](https://docs.unity.com/en-us/engine/6000.0/manual/render-pipelines/universal-render-pipeline/customizing-urp/render-graph)
[^29]: Render Graph Viewer window reference for URP - Unity - Manual - [https://docs.unity3d.com/6000.0/Documentation/Manual/urp/render-graph-viewer-reference.html](https://docs.unity3d.com/6000.0/Documentation/Manual/urp/render-graph-viewer-reference.html)
[^30]: Analyze a render graph in URP - Unity Docs - [https://docs.unity.com/en-us/engine/7000.0/manual/render-pipelines/universal-render-pipeline/customizing-urp/render-graph/view](https://docs.unity.com/en-us/engine/7000.0/manual/render-pipelines/universal-render-pipeline/customizing-urp/render-graph/view)
[^31]: Render Graph - Introduction - The Knights of U - [https://theknightsofu.com/render-graph-introduction/](https://theknightsofu.com/render-graph-introduction/)
[^32]: Introduction of Render Graph in the Universal Render Pipeline (URP) - [https://discussions.unity.com/t/introduction-of-render-graph-in-the-universal-render-pipeline-urp/930355?page=16](https://discussions.unity.com/t/introduction-of-render-graph-in-the-universal-render-pipeline-urp/930355?page=16)
[^33]: Render graph system in URP - Unity - Manual - [https://docs.unity3d.com/6000.0/Documentation/Manual/urp/render-graph.html](https://docs.unity3d.com/6000.0/Documentation/Manual/urp/render-graph.html)
[^34]: Unity 6000.0.23f1 - [https://unity.com/releases/editor/whats-new/6000.0.23f1](https://unity.com/releases/editor/whats-new/6000.0.23f1)
[^35]: Manual: Optimize a render graph - Unity - [https://docs.unity.cn/6000.6/Documentation/Manual/urp/render-graph-optimize.html](https://docs.unity.cn/6000.6/Documentation/Manual/urp/render-graph-optimize.html)
[^36]: Project Auditor • Unity Editor • Unity Docs - [https://docs.unity.com/ko-KR/engine/6000.3/manual/packages-list/packages-all/pack-safe/com-unity-project-auditor](https://docs.unity.com/ko-KR/engine/6000.3/manual/packages-list/packages-all/pack-safe/com-unity-project-auditor)
[^37]: 【Unity2021.2新機能】各アセットのインポート時間が一覧表示 - [https://light11.hatenadiary.com/entry/2021/09/06/201931](https://light11.hatenadiary.com/entry/2021/09/06/201931)
[^38]: Unity Docs - Project Auditor Rules - [https://docs.unity.com/en-us/engine/6000.6/manual/packages-list/packages-all/pack-safe/com-unity-project-auditor-rules](https://docs.unity.com/en-us/engine/6000.6/manual/packages-list/packages-all/pack-safe/com-unity-project-auditor-rules)
[^39]: Importing assets - Unity Docs - [https://docs.unity.com/engine/6000.5/manual/assets-and-media/import-assets](https://docs.unity.com/engine/6000.5/manual/assets-and-media/import-assets)
[^40]: Run Project Auditor from the command line - Unity Documentation - [https://docs.unity.com/en-us/engine/7000.0/manual/analysis/project-auditor/programming/run-from-command-line](https://docs.unity.com/en-us/engine/7000.0/manual/analysis/project-auditor/programming/run-from-command-line)
[^41]: Static code and project analysis with Project Auditor : r/Unity3D - [https://www.reddit.com/r/Unity3D/comments/1cbxlco/static_code_and_project_analysis_with_project/](https://www.reddit.com/r/Unity3D/comments/1cbxlco/static_code_and_project_analysis_with_project/)
[^42]: Creating custom analyzers | Project Auditor | 2.0.0 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.project-auditor@2.0/manual/custom-analyzers.html](https://docs.unity3d.com/Packages/com.unity.project-auditor@2.0/manual/custom-analyzers.html)
[^43]: UI Toolkit Debugger - Unity Docs - [https://docs.unity.com/engine/7000.0/manual/uitoolkits/uielements/uie-test-ui/uie-ui-debugger](https://docs.unity.com/engine/7000.0/manual/uitoolkits/uielements/uie-test-ui/uie-ui-debugger)
[^44]: Memory Profiler module - Unity - Manual - [https://docs.unity3d.com/2022.3/Documentation/Manual/ProfilerMemory.html](https://docs.unity3d.com/2022.3/Documentation/Manual/ProfilerMemory.html)
[^45]: Analyze tool | Addressables | 1.25.1 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@1.25/manual/AnalyzeTool.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.25/manual/AnalyzeTool.html)
[^46]: Reducing Assets Import times in Unity - Technical Articles - [https://discussions.unity.com/t/reducing-assets-import-times-in-unity/1702346](https://discussions.unity.com/t/reducing-assets-import-times-in-unity/1702346)
[^47]: How to get useful information from memory leak log? - [https://discussions.unity.com/t/how-to-get-useful-information-from-memory-leak-log/949612](https://discussions.unity.com/t/how-to-get-useful-information-from-memory-leak-log/949612)
[^48]: Memory Profiler | 1.0.0 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.memoryprofiler@1.0/manual/index.html](https://docs.unity3d.com/Packages/com.unity.memoryprofiler@1.0/manual/index.html)
[^49]: Unity Editor • Unity Docs - Memory Profiler - [https://docs.unity.com/ko-KR/engine/6000.0/manual/packages-list/packages-all/pack-safe/com-unity-memoryprofiler](https://docs.unity.com/ko-KR/engine/6000.0/manual/packages-list/packages-all/pack-safe/com-unity-memoryprofiler)
[^50]: Extended Q&A: Optimizing memory and build size with Addressables - [https://unity.com/blog/engine-platform/extended-q-a-optimizing-memory-and-build-size-with-addressables](https://unity.com/blog/engine-platform/extended-q-a-optimizing-memory-and-build-size-with-addressables)
[^51]: Addressables Analyze window reference - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@2.7/manual/analyze-addressables-window-reference.html](https://docs.unity3d.com/Packages/com.unity.addressables@2.7/manual/analyze-addressables-window-reference.html)
[^52]: Addressables Analyze window | Addressables | 3.1.0 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@3.1/manual/analyze-addressables-window.html](https://docs.unity3d.com/Packages/com.unity.addressables@3.1/manual/analyze-addressables-window.html)
[^53]: Addressables Analyze | Package Manager UI website - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@1.1/manual/AddressableAssetsAnalyze.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.1/manual/AddressableAssetsAnalyze.html)
[^54]: Addressables-Sample - Unity-Technologies - GitHub - [https://github.com/Unity-Technologies/Addressables-Sample](https://github.com/Unity-Technologies/Addressables-Sample)
[^55]: UI Toolkit Debugger - Unity - Manual - [https://docs.unity3d.com/6000.1/Documentation/Manual/UIE-ui-debugger.html](https://docs.unity3d.com/6000.1/Documentation/Manual/UIE-ui-debugger.html)
[^56]: Mastering Unity UI Toolkit: Styling Complex Elements - Medium - [https://medium.com/@lemapp09/mastering-unity-ui-toolkit-styling-complex-elements-9d339636de00](https://medium.com/@lemapp09/mastering-unity-ui-toolkit-styling-complex-elements-9d339636de00)
[^57]: Manual: UI Toolkit - Unity - [https://docs.unity.cn/2020.3/Documentation/Manual/UIElements.html](https://docs.unity.cn/2020.3/Documentation/Manual/UIElements.html)
[^58]: Test UI in UI Builder - Unity Docs - [https://docs.unity.com/en-us/engine/6000.5/manual/uitoolkits/uielements/uibuilder/uib-testing-ui](https://docs.unity.com/en-us/engine/6000.5/manual/uitoolkits/uielements/uibuilder/uib-testing-ui)
[^59]: Test UI - Unity Docs - [https://docs.unity.com/en-us/engine/7000.0/manual/uitoolkits/uielements/uie-test-ui](https://docs.unity.com/en-us/engine/7000.0/manual/uitoolkits/uielements/uie-test-ui)
[^60]: Inspect UI Toolkit events with Event Debugger - Unity Documentation - [https://docs.unity.com/ko-kr/engine/6000.7/manual/uitoolkits/uielements/uie-test-ui/event-debugger](https://docs.unity.com/ko-kr/engine/6000.7/manual/uitoolkits/uielements/uie-test-ui/event-debugger)
[^61]: AudioGroup Inspector - Unity - Manual - [https://docs.unity3d.com/6000.1/Documentation/Manual/AudioMixerInspectors.html](https://docs.unity3d.com/6000.1/Documentation/Manual/AudioMixerInspectors.html)
[^62]: AudioGroup Inspector - Unity - Manual - [https://docs.unity3d.com/6000.6/Documentation/Manual/AudioMixerInspectors.html](https://docs.unity3d.com/6000.6/Documentation/Manual/AudioMixerInspectors.html)
[^63]: Unity 2020.1.0a25 - [https://unity.com/releases/editor/alpha/2020.1.0a25](https://unity.com/releases/editor/alpha/2020.1.0a25)
[^64]: Previous version features and release notes - AMD GPUOpen - [https://gpuopen.com/archived/previous-version-features-release-notes/](https://gpuopen.com/archived/previous-version-features-release-notes/)
