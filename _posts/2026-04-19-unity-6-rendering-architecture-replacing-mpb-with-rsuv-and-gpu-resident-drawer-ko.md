---
title: "Unity 6 렌더링 아키텍처: MPB를 버리고 RSUV와 GPU Resident Drawer로 전환하는 심층 머티리얼 최적화"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: Unity 6에서 AAA급 렌더링 성능을 달성하기 위한 MaterialPropertyBlock에서 RSUV 및 GPU Resident Drawer로의 아키텍처 전환에 대한 종합 분석.
lang: ko
translation_id: unity6-material-rsuv-grd
math: true
---

## **경영진 요약 (Executive Summary)**

Unity 6로의 전환은 렌더 파이프라인(render pipelines)이 대량의 인스턴스 지오메트리(instanced geometry)를 처리하는 방식에 근본적인 아키텍처 변화를 가져옵니다. 게임 개발 역사에서 하나의 머티리얼을 공유하면서도 개별 속성 변형(예: 색상 틴트 - color tints)이 필요한 다수의 오브젝트를 최적화할 때, 흔히 표준 GPU Instancing과 결합한 `MaterialPropertyBlock` (MPB) API에 의존해 왔습니다. 그러나 Unity 6의 Universal Render Pipeline (URP)과 High Definition Render Pipeline (HDRP)을 심층 분석해 보면, 이 레거시(legacy) 접근 방식은 더 이상 최적의 경로가 아니며 많은 경우 심각한 성능 저하를 유발한다는 사실이 드러납니다.

"Long Gil Studio DevLog"용으로 제공된 초안 문서를 검토한 결과, 구버전에서는 타당했던 레거시 최적화 이론과 Unity 6의 최신 렌더링 기능에 대한 심각한 오해가 혼재되어 있음을 확인할 수 있습니다. 구체적으로, 초안에서 `MaterialPropertyBlock` 사용을 권장한 것은 Unity 6의 새로운 **GPU Resident Drawer (GRD)** 기술 및 그 기반인 저수준 **BatchRendererGroup (BRG)** API와 정면으로 충돌합니다.[^1] 최대의 렌더링 처리량을 달성하려면 개발자는 반드시 **Renderer Shader User Value (RSUV)**를 도입하거나 **Data-Oriented Technology Stack (DOTS)**으로 완전히 전환해야 합니다.[^3]

본 연구 보고서는 렌더링 병목 현상, Scriptable Render Pipeline (SRP) Batcher의 동작 메커니즘, 머티리얼 복제가 시스템에 미치는 파급 효과, 그리고 Unity 6에서 AAA급 렌더링 성능을 구현하기 위해 필수적인 최신 패턴에 대한 철저한 기술 분석을 제공합니다. 또한 Long Gil Studio DevLog에 게시할 수 있도록 수정 및 전문적으로 재구성된 기술 아티클을 함께 제공합니다.

## **제1부: Long Gil Studio 원본 초안에 대한 기술 검토**

초기 초안은 매우 구체적인 렌더링 문제를 다루고 있습니다. 즉, 하나의 머티리얼을 공유하지만 서로 다른 색상 수정이 필요한 수많은 동일 오브젝트가 배치된 Scene을 최적화하는 것입니다. 초안은 잘못된 설계 패턴(anti-patterns)을 정확히 짚어냈지만, Unity 6의 아키텍처 맥락에서는 오히려 성능을 저하시키는 해결책을 제시하고 있습니다.

### **원본 초안의 정확한 지점**

1. **머티리얼 복제(Material Duplication)의 페널티:** 초안은 오브젝트마다 별도의 머티리얼 인스턴스를 생성하는 것(예: `GetComponent<Renderer>().material.color` 사용)이 메모리 비대화(memory bloat)를 초래하고 드로우 콜 배칭(draw call batching)을 완전히 파괴한다고 정확하게 지적합니다.[^5] `.material` 속성에 접근하면 Unity 엔진이 해당 머티리얼을 내부적으로 암묵적 복제(clone)하게 되어, SRP Batcher나 GPU Instancing이 이러한 오브젝트들을 단일 SetPass 호출로 묶을 수 있는 능력을 영구적으로 상실하게 됩니다.[^5]
2. **MaterialPropertyBlock (MPB)의 메커니즘:** 초안은 MPB가 데이터 오버라이드 버퍼(data override buffer)로 작동하여, 새 머티리얼 복제본을 생성하지 않고도 렌더러가 GPU에 인스턴스별(per-instance) 속성을 전달할 수 있게 한다는 점을 올바르게 설명하고 있습니다.[^7]
3. **문자열(String) 속성 대 정수 식별자(Integer IDs):** 초안은 셰이더 속성을 문자열로 조회할 때 발생하는 중앙 처리 장치(CPU)의 지연 시간을 적절히 강조하며, 루프 최적화를 위해 `Shader.PropertyToID()` 명령으로 정수 식별자를 사전 캐싱할 것을 권장합니다.[^7]

### **치명적인 오류와 구시대적 패러다임**

1. **Unity 6에서 "AAA 표준"으로 제시된 MPB:** 원본 초안의 가장 큰 결함은 MPB가 Unity 6를 위한 최적의 "AAA" 솔루션이라고 주장하는 점입니다. MPB는 구형 Built-In Render Pipeline에서는 표준이었지만, 현대적인 SRP 아키텍처에서는 시스템을 방해하는 안티패턴으로 작용합니다.[^8] GameObject에 MPB를 적용하면 해당 오브젝트는 즉시 SRP Batcher 파이프라인에서 배제됩니다.[^10]
2. **레거시 GPU Instancing에 대한 의존:** 초안은 MPB가 SRP Batcher를 깨뜨린다는 점을 인정하고 대안으로 전통적인 GPU Instancing에 의존할 것을 제안합니다. 기술적으로는 수동으로 SRP 호환성을 깨고 Instancing을 활성화하여 구현할 수 있지만, 이는 엔진이 고도로 최적화된 SRP 아키텍처를 우회하도록 강제합니다.[^12]
3. **GPU Resident Drawer (GRD)의 누락:** Unity 6는 드로우 콜 생성을 컴퓨트 셰이더(compute shaders)로 오프로드하여 CPU 처리 비용을 최대 50%까지 절감하는 GPU Resident Drawer를 도입했습니다.[^14] `MaterialPropertyBlock`이 존재하면 해당 GameObject는 GRD에 참여하는 것이 엄격히 금지됩니다.[^1] Unity 6에서 MPB를 권장하는 것은 사실상 프로젝트가 엔진의 가장 강력한 신규 최적화 기능을 사용하지 못하도록 막는 결과를 낳습니다.
4. **Renderer Shader User Value (RSUV)의 누락:** Unity 6.3 LTS에 도입된 RSUV는 단순한 오브젝트별 변형을 처리할 때 MPB를 직접 대체하는 아키텍처입니다.[^15] RSUV를 사용하면 SRP Batcher나 GPU Resident Drawer를 깨뜨리지 않고도 렌더러마다 24비트 정수를 셰이더로 전달할 수 있습니다.[^3]

## **제2부: 렌더링 병목 현상(Bottlenecks)의 근본 원인 분석**

특정 API 호출이 왜 프레임 레이트(frame rate)를 파괴하는지 이해하려면, 중앙 처리 장치(CPU)와 그래픽 처리 장치(GPU) 간의 통신 모델을 살펴봐야 합니다. 현대의 하드웨어 아키텍처는 이 두 프로세서 간의 긴밀하면서도 지연 시간에 민감한 동기화를 요구합니다.

### **CPU-GPU 통신 오버헤드(Overhead)**

단일 프레임을 렌더링하려면 CPU는 카메라 시야 내에 보이는 모든 오브젝트를 순회하며(frustum culling) 머티리얼 속성을 확인하고, 필요한 텍스처(textures)와 셰이더를 GPU 메모리에 바인딩(bind)한 뒤 그리기 명령(draw command)을 발행해야 합니다. 이 파이프라인에서 가장 비용이 큰 작업은 GPU가 폴리곤(polygons)을 그리는 것이 아니라, 드로우 콜 직전에 반드시 수행해야 하는 상태 변경 — 흔히 **SetPass 호출**이라 불리는 작업입니다.[^5]

CPU는 새로운 머티리얼을 만날 때마다 GPU에 새 파라미터를 업로드하기 위해 렌더링 파이프라인을 일시 중단해야 합니다.[^18] 만약 Scene에 10,000명의 적이 있고 각 적이 서로 다른 갑옷 색상을 표현하기 위해 고유한 머티리얼 인스턴스를 보유한다면, CPU는 10,000번의 상태 변경을 수행해야 합니다. 이는 막대한 CPU 오버헤드를 발생시켜, GPU는 CPU의 명령을 기다리며 유휴 상태로 놀고 있는 병목 현상을 초래합니다.

### **`.material` 속성에 의한 메모리 단편화**

스크립트가 색상을 변경하기 위해 `Renderer.material`에 접근하면, 엔진은 원래의 공유 에셋(asset) 무결성을 보호해야 합니다. 이를 위해 해당 머티리얼에 대해 내부적으로 `Instantiate()`를 실행합니다. 이는 성능에 두 가지 심각한 페널티를 부과합니다.

1. **배칭 파괴(Batching Destruction):** 해당 오브젝트는 더 이상 동료 오브젝트들과 머티리얼 참조를 공유하지 않습니다. 즉시 Unity는 이 오브젝트에 대한 Static Batching, Dynamic Batching 또는 SRP Batching을 모두 중단합니다.[^5] 그래픽 카드는 이를 완전히 독립된 개체로 처리해야 합니다.
2. **가비지 컬렉션(Garbage Collection)과 메모리 누수(Memory Leaks):** 새로 복제된 머티리얼은 C# 관리 힙(Managed Heap)에 생성됩니다. 오브젝트가 파괴되더라도 이 머티리얼은 자동으로 가비지 컬렉션되지 않습니다. 개발자가 명시적으로 `Destroy(renderer.material)`를 호출하지 않는 한 메모리는 계속 할당된 상태로 남습니다. 이로 인해 메모리 누수가 발생하고, 가비지 컬렉터(Garbage Collector - GC)가 Mark-and-Sweep 과정을 실행하게 되어 심각한 프레임 스파이크(spikes)와 급격한 FPS 저하를 유발합니다.[^5]

## **제3부: SRP Batcher 아키텍처와 전통적 GPU Instancing의 도태**

Scriptable Render Pipeline (SRP)은 Unity가 셰이더 데이터를 관리하는 방식을 근본적으로 재구성했습니다. 구형 최적화 기법이 Unity 6에서 완전히 실패하는 이유를 파악하려면 SRP Batcher를 이해하는 것이 핵심입니다.

### **SRP Batcher의 작동 메커니즘**

구형 파이프라인(Built-in)에서는 머티리얼이 개별 유니폼 변수(separate uniform variables)를 통해 GPU에 데이터를 업로드했습니다. SRP Batcher는 이 방식을 **상수 버퍼(Constant Buffers - CBUFFERs)**라고 불리는 거대하고 영속적인(persistent) GPU 버퍼를 사용하는 방식으로 대체합니다.[^11]

SRP 아키텍처는 셰이더가 변수를 두 개의 별도 버퍼 블록으로 분리할 것을 요구합니다[^11]:

* `UnityPerMaterial`: 동일한 머티리얼을 사용하는 모든 오브젝트가 공유하는 속성(예: 기본 색상, 메탈릭 맵 - metallic maps, 매끄러움)을 담는 CBUFFER입니다.
* `UnityPerDraw`: 특정 드로우 콜에만 고유한 속성(예: 오브젝트의 공간 변환 행렬 - transformation matrices)을 담는 CBUFFER입니다.

`UnityPerMaterial` 버퍼가 GPU 메모리에 상주하기 때문에, 연속된 오브젝트들이 동일한 셰이더 베리언트(shader variant)를 공유하는 한 CPU는 렌더 루프 도중에 머티리얼 속성을 다시 업로드할 필요가 없습니다.[^18] SRP Batcher는 이 영속적 버퍼를 바인딩하기만 하고 훨씬 크기가 작은 `UnityPerDraw` 버퍼만 업데이트합니다. 이 설계는 CPU 비용을 획기적으로 줄여 렌더링 속도를 종종 1.2배에서 4배까지 향상시킵니다.[^21]

### **`MaterialPropertyBlock`과의 근본적 충돌**

`MaterialPropertyBlock` API는 원래 렌더러 수준에서 머티리얼 속성을 재정의(override)하기 위해 설계되었습니다. 그러나 SRP Batcher는 `UnityPerMaterial` CBUFFER의 엄격한 분리와 영속성에 의존하기 때문에, MPB를 주입(inject)하는 행위는 이러한 메모리 레이아웃을 정면으로 위반합니다.[^8]

MPB가 적용되면 Unity는 해당 오브젝트에 영속적 머티리얼 버퍼가 균일하게 적용된다고 더 이상 보장할 수 없습니다. 그 결과 엔진은 해당 오브젝트를 SRP Batcher 파이프라인에서 강제로 퇴출시키게 됩니다.[^9] Unity 공식 문서는 다음과 같이 명확히 확인해 줍니다: *"이 기능은 SRP Batcher와 호환되지 않습니다. URP 또는 HDRP에서 MPB를 사용하면 성능 저하가 발생할 가능성이 높습니다."*[^8]

### **레거시 폴백(Fallback): `Graphics.DrawMeshInstanced`**

과거에는 개발자에게 방대한 변형(예: 색상이 각기 다른 나무들로 이루어진 숲)이 필요할 때, SRP Batcher를 포기하는 대신 GPU Instancing으로 돌아가곤 했습니다.[^12] 이를 위해서는 `UnityPerMaterial` 버퍼 외부에 속성을 선언하여 수동으로 셰이더의 SRP 호환성을 깨뜨리고, 머티리얼에서 "Enable GPU Instancing"을 활성화해야 했습니다.[^13]

GPU Instancing은 변환 행렬 배열과 색상 데이터를 전달하여 드로우 콜을 줄여주지만, 심각한 한계를 동반합니다.[^12] 심한 오버드로우(overdraw)에 취약하고, 메시(meshes)가 완전히 동일해야 하며, 매 프레임마다 인스턴스 배열(instance arrays)을 수집하고 업로드하는 무거운 부담을 CPU에 지웁니다. Unity 6에서는 이 방식이 GPU Resident Drawer 아키텍처로 완전히 대체되었습니다.[^23]

## **제4부: Unity 6 생태계와 `MaterialPropertyBlock` (MPB)의 비호환성**

MPB를 더 깊이 분석해 보면, SRP Batcher를 깨뜨릴 뿐만 아니라 Unity 6의 디버깅 도구(debugging tools) 및 라이팅 시스템(lighting systems)에도 구조적인 위험을 초래한다는 것을 알 수 있습니다.

### **라이트맵 데이터와 Global Illumination에 미치는 영향**

MPB를 잘못 사용할 때 가장 덜 언급되는 부작용 중 하나는 라이트맵(Lightmap) 데이터가 소실된다는 점입니다. `new MaterialPropertyBlock()`을 생성하여 `Renderer.SetPropertyBlock()`으로 할당하면, 전달한 프로퍼티 블록이 렌더러의 로컬 상태를 완전히 덮어쓰게 됩니다.[^24]

오브젝트가 베이크된(baked) Global Illumination (GI) 시스템을 사용하고 있다면, 라이트맵 UV 좌표와 Light Probe 계수 정보가 해당 렌더러의 프로퍼티 블록 내부에 암묵적으로 저장되어 있습니다.[^24] 색상을 설정하기 전에 `Renderer.GetPropertyBlock(block)`을 호출하지 않으면, 실수로 오브젝트의 조명 정보를 완전히 지워버리게 됩니다. Long Gil Studio의 원본 초안은 이 `GetPropertyBlock` 부분을 잘 처리했지만, 수천 개의 오브젝트에 대해 이 API를 반복 호출하는 행위 자체만으로도 결코 무시할 수 없는 추가 CPU 지연 시간이 발생합니다.

| 최적화 기법 | RAM 누수 유발 | SRP Batcher 호환 | GRD 호환 | DOTS 호환 | 사용 권장 사항 |
| :----------------------------- | :------------ | :---------------------- | :-------------- | :--------------- | :-------------------- |
| **`Material.color`** | 예 | 아니오 | 아니오 | 아니오 | 절대 피해야 함 |
| **`MaterialPropertyBlock`** | 아니오 | 아니오 | 아니오 | 아니오 | 구형 Built-in 프로젝트용 |
| **GPU Instancing** | 아니오 | 아니오 (충돌) | 아니오 | 아니오 | Unity 2020-2022 |
| **Renderer Shader User Value** | 아니오 | 예 | 예 | 예 | Unity 6.3+ 표준 |

위 표에서 알 수 있듯이 MPB는 이제 구세대 기술입니다. RAM 문제는 해결하지만, Unity 6의 현대적인 렌더링 파이프라인 전체를 무너뜨립니다.

## **제5부: 아키텍처의 전환점 — GPU Resident Drawer (GRD)와 `BatchRendererGroup` (BRG)**

Unity 6는 혁신적인 렌더링 경로인 **GPU Resident Drawer**를 선보입니다. 이 시스템은 CPU가 드로우 콜 생성을 주도하는 모델에서 GPU가 주도하는 고도로 자율적인 렌더링 루프로 패러다임을 전환합니다.[^1]

### **GPU Resident Drawer의 아키텍처**

GPU Resident Drawer는 저수준 API인 `BatchRendererGroup` (BRG)을 기반으로 작동합니다.[^1] CPU가 어떤 오브젝트가 보이는지 평가(frustum culling)하고 개별 또는 인스턴스 드로우 콜을 전송하는 대신, CPU는 Scene의 전체 공간 및 머티리얼 데이터를 GPU에 업로드합니다.[^25] 그 후 컴퓨트 셰이더가 카메라 밖 오브젝트 제거, 가려진 오브젝트 제거(occlusion culling), 그리고 드로우 콜 생성을 전적으로 GPU 상에서 수행합니다.[^14]

성능 향상 폭은 놀라운 수준입니다. 간접 렌더링(`DrawInstancedIndirect`)을 활용하면 복잡한 씬에서 렌더링에 필요한 CPU 작업량을 최대 50%까지 줄일 수 있습니다.[^14] 더욱이 GPU Occlusion Culling과 결합하면 삼각형 처리량(triangle processing)을 거의 90%까지 절감할 수 있으며, GPU 프레임 시간(frame time)도 절반 이상 단축됩니다.[^28]

### **`BatchRendererGroup` (BRG) API와 컬링**

GRD의 이면에는 `BatchRendererGroup`이 있습니다. BRG는 `OnPerformCulling` 콜백 함수를 통해 초기화해야 합니다.[^30] 여기서 CPU는 가시성(visibility)을 구성하고 배열 형태의 드로우 콜을 출력하기만 하면 됩니다. 오브젝트의 데이터(transform, 색상, 플래그)는 `GraphicsBuffer`에 업로드됩니다.[^25] 이를 통해 수백만 개의 삼각형을 단 몇 번의 SetPass 호출만으로 GPU에 전송할 수 있습니다.

### **MPB와 GRD의 치명적 비호환성**

Unity 6 최적화와 관련해 가장 중요한 정보는 GPU Resident Drawer의 적격성 요구 조건이 얼마나 엄격하고 깨지기 쉬운가입니다. 오브젝트가 GRD에 의해 처리되려면 엄격한 데이터 레이아웃 규칙을 준수해야 합니다.[^2]

Unity 6.1+ 공식 문서는 `MaterialPropertyBlock` API를 사용하는 GameObject가 즉시 GPU Resident Drawer에서 제외된다고 명시하고 있습니다.[^1] 또한 오브젝트에는 `OnRenderObject`와 같은 인스턴스별 콜백을 사용하는 스크립트가 부착되어서는 안 됩니다.[^2]

개발자가 오브젝트 색상을 바꾸기 위해 MPB를 부착하면, 의도치 않게 엔진이 해당 특정 오브젝트에 대해 레거시 CPU 기반 렌더링 모드로 되돌아가도록 강제하게 됩니다. 실시간 전략 게임(RTS)에서 10,000개의 병력 유닛에 이를 적용하면 CPU 오버헤드가 걷잡을 수 없이 치솟아, Unity 6 엔진 업그레이드의 이점을 완전히 무효화합니다.

## **제6부: 현대의 표준 — Unity 6.3의 Renderer Shader User Value (RSUV)**

MPB가 최신 파이프라인과 호환되지 않아 발생하는 아키텍처 교착 상태를 인식한 Unity는 Unity 6.3 LTS 버전에서 **Renderer Shader User Value (RSUV)** 기능을 도입했습니다.[^15] RSUV는 단일 머티리얼을 공유하는 여러 렌더러에 간단한 인스턴스별 커스터마이징을 적용해야 할 때 `MaterialPropertyBlock`을 완벽하게 대체하는 수단입니다.[^3]

### **RSUV의 작동 메커니즘**

RSUV는 MPB의 단점이었던 복잡한 버퍼 수정을 우회합니다. 대신 렌더러의 표준 드로우 데이터와 함께 직접 전달되는 극도로 효율적인 24비트 정수 채널을 활용합니다.[^3] 이 정수는 별도의 버퍼 오버라이드(buffer override)를 요구하는 대신 기존 데이터 구조에 통합되므로, SRP Batcher와 GPU Resident Drawer 모두와 100% 호환성을 유지합니다.[^3]

### **구현 및 비트 인코딩(Bitwise Encoding)**

색상 변형에 RSUV를 사용하려면, CPU가 원하는 RGB 값을 단일 24비트 부호 없는 정수(`uint`)로 인코딩해야 합니다. 각 색상 채널(빨강 - Red, 초록 - Green, 파랑 - Blue)은 8비트(0에서 255까지의 값)를 차지합니다.[^3]

인코딩 연산에는 비트 왼쪽 시프트 연산자(`<<`)와 비트 OR 연산자(`|`)를 사용합니다. 수학적 표현식은 다음과 같습니다.

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

실제 C# 구현에서 `MeshRenderer` 컴포넌트 배열을 순회하며 무작위 색상 틴트를 적용하는 코드는 매우 높은 성능을 발휘하며 가비지 메모리 할당이 전혀 발생하지 않습니다(zero garbage allocation)[^3]:

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // 무작위 색상 계산 (더 선명한 색감을 위해 HSV 색상 공간 사용)  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // RGB를 24비트 정수로 인코딩 (Blue, Green, Red)  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // Unity 6.3 신규 API를 통해 렌더러에 직접 값 적용
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **셰이더에서의 디코딩(Shader Decoding)**

GPU 측에서는 셰이더가 이 24비트 정수를 다시 정규화된 `float4` 색상 값으로 압축 해제(unpack)해야 합니다. Unity는 이 데이터 블록에 접근할 수 있도록 내장 변수 `unity_RendererUserValue`를 제공합니다.[^3]

디코딩에는 비트 오른쪽 시프트 연산자(`>>`)와 비트마스크 `255`를 이용한 비트 AND 연산자(`&`)를 사용하여 각 8비트 세그먼트를 분리합니다. 그런 다음 255의 역수(`1.0 / 255.0`)를 곱하여 값을 `0.0`에서 `1.0` 범위로 정규화합니다.[^3]

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

High-Level Shader Language (HLSL) 또는 Shader Graph의 Custom Function 노드를 통해 표현한 언패킹 로직은 다음과 같습니다[^3]:

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // Red 채널  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // Green 채널  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // Blue 채널  
    1.0 // 고정 Alpha  
);
```

이러한 패러다임 전환은 심오한 최적화 전략을 보여줍니다. 즉, 데이터 구조의 복잡성(MPB 등)을 수학적 연산(RSUV)으로 맞바꾸는 것입니다. GPU 프로세서는 비트 연산에 극도로 뛰어나므로 디코딩 비용은 사실상 제로에 가깝습니다(극소량의 클럭 사이클만 소모). 반면 SRP Batcher와 GPU Resident Drawer 경로를 보존함으로써 얻는 프레임 시간(frame-time) 단축 효과는 엄청납니다.[^16]

## **제7부: 초거대 규모 솔루션 — DOTS, ECS 및 `URPMaterialPropertyOverride`**

표준 GameObject가 처리할 수 있는 한계를 넘어서는 규모로 작동하는 프로젝트(예: 수십만 개의 독립 개체가 움직이는 군중 시뮬레이션 - boids, 대규모 RTS 군대)의 경우, Unity의 Data-Oriented Technology Stack (DOTS)이 궁극의 렌더링 아키텍처를 제공합니다.[^4]

### **데이터 지향 메모리 관리(Data-Oriented Memory)**

GameObject들이 힙(Heap) 메모리에 흩어져 저장되는 객체 지향(object-oriented) 방식의 제약과 달리, Entity Component System (ECS)의 엔티티(entities)는 메모리 내에 완벽하게 연속된 데이터 배열(contiguous arrays of data) 형태로 존재합니다.[^4] 이러한 메모리 레이아웃은 `BatchRendererGroup` (BRG) API가 최고 성능을 내기 위해 요구하는 구조와 완벽히 일치합니다.

Entities Graphics 패키지 내에서 개발자는 `URPMaterialPropertyOverride` 컴포넌트를 사용할 수 있습니다.[^4] 이 시스템은 유해한 `MaterialPropertyBlock` API를 전혀 사용하지 않고도 엔티티별 머티리얼 속성 재정의(per-entity material overrides)를 가능하게 합니다.

### **DOTS Instancing의 작동 메커니즘**

엔티티가 DOTS에서 처리될 때, DOTS Instancing용으로 구성된 셰이더(Shader Graph에서 Override Property Declaration을 체크하고 Hybrid Per Instance를 선택)는 고유한 32비트 정수(메타데이터 값)를 전달받습니다.[^34] 이 정수는 GPU 상의 영속적인 `GraphicsBuffer` 내부의 오프셋(offset)을 나타냅니다.[^34]

셰이더는 이 오프셋을 사용하여 현재 렌더링 중인 인스턴스(instance)의 특정 속성 데이터를 로드합니다.[^34] DOTS Instancing을 특별하게 만드는 점은, 여러 엔티티가 동일한 속성 값을 공유할 경우 메모리 내의 동일한 위치(동일한 오프셋)에서 그 값을 읽어올 수 있게 하여 GPU 사이클(GPU cycles)을 절약하고 메모리 중복을 최소화한다는 것입니다.[^34] 속성이 기존의 상수 버퍼에 갇히지 않고 오프셋을 통해 로드되므로, 단일 드로우 콜의 크기가 엄격히 제한되지 않아 엄청난 수의 인스턴스를 처리할 수 있습니다.

```csharp
// DOTS / Burst 컴파일 시스템을 통해 RSUV 값을 할당하는 예시 

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // NativeArray에 값을 직접 기록하여 병렬 처리 수행  
        // MonoBehaviour로는 결코 도달할 수 없는 실행 속도를 제공합니다.  
    }  
}
```

Burst Compiler로 컴파일된 백그라운드 잡(Bursted Background Jobs)을 통해 엔티티의 컴포넌트 값을 변경하는 작업은 놀라운 속도로 수행됩니다.[^4] 지형의 경사각에 따라 울타리 색상이 바뀌거나 고도에 따라 풀잎의 색상이 변하는 장면을 병목 현상 없이 단 하나의 드로우 콜 스트림으로 모두 그려낼 수 있습니다.[^4]

## **제8부: 대안 솔루션 분석 (Alternative Solutions)**

Long Gil Studio의 원본 초안은 대체 최적화 기법들을 간략하게 언급했습니다. 아래 분석은 그 실현 가능성을 검증하되, Unity 6 엔진의 물리적 제약이라는 맥락 속에 배치하여 평가합니다.

1. **Vertex Colors (메시 정점 색상):**
   * *메커니즘:* 3D 메시의 정점(vertices)에 색상 데이터를 직접 인코딩합니다. 셰이더는 메시에서 `TEXCOORD` 또는 `COLOR` 속성을 읽습니다.
   * *효과:* 매우 가볍고 모든 배칭 기능과 GRD 호환성을 완벽하게 보존합니다.[^36]
   * *약점:* 런타임(실행 중)에 정점 색상을 변경하려면 메시 데이터 배열(`mesh.colors`)을 조작해야 합니다. 이 동작은 RAM에 메시의 복제본을 생성하여 CPU 멈춤(stalls)과 가비지 메모리 할당을 유발합니다. 정점 색상은 Blender나 Maya 같은 소프트웨어에서 미리 "베이크(baked)"된 정적 변형에 대해서만 여전히 최적입니다.
2. **Texture Atlasing 및 UV 오프셋:**
   * *메커니즘:* 여러 색상 변형을 하나의 텍스처 아틀라스(texture atlas)로 통합하고, 각 오브젝트의 UV 좌표를 이동시켜 특정 픽셀을 샘플링합니다.[^36]
   * *효과:* 하나의 머티리얼과 하나의 텍스처를 유지하므로 SRP Batcher와의 완벽한 호환성을 보장합니다.[^36]
   * *약점:* 정점 색상과 마찬가지로, 런타임에 서로 다른 오브젝트의 UV 좌표를 동적으로 변경하려면 일반적으로 고유한 메시 인스턴스를 생성해야 하므로 메모리 비대화(memory bloat)가 발생합니다. 그러나 정적 환경 디자인이나 복셀(Voxel) 게임(예: Minecraft)에서는 타의 추종을 불허하는 기법입니다.
3. **저수준 `Graphics.DrawMeshInstanced`:**
   * *메커니즘:* GameObject 계층 구조를 완전히 우회하여 C# 코드를 통해 변환 행렬과 색상 배열을 GPU로 직접 밀어 넣습니다.[^37]
   * *효과:* 군집 알고리즘(flocking)이나 절차적 식생(procedural foliage)과 같은 시스템에 막대한 처리량을 제공합니다.[^38]
   * *Unity 6에서의 약점:* `BatchRendererGroup` API와 GPU Resident Drawer의 등장은 이러한 성능을 "대중화"하여, 대부분의 일반적인 개발 시나리오에서 복잡한 컬링(culling) 및 드로우 제출 코드를 직접 작성할 필요성을 없애버렸습니다.[^19] 커스텀 `DrawMeshInstanced` 시스템을 유지보수하는 것은 이제 GPU Resident Drawer가 이를 자동화하게 두는 것보다 더 많은 엔지니어링 리소스를 소모합니다.

## **제9부: Long Gil Studio DevLog를 위한 권장 콘텐츠 구조**

포괄적인 기술 검토 결과를 바탕으로, 아래 본문은 전면 수정되어 높은 수준의 기술적 전문성을 갖춘 권장 DevLog 아티클입니다. 잘못된 MPB 접근 방식을 버리고 독자들을 Unity 6의 진정한 아키텍처 표준인 RSUV와 GPU Resident Drawer로 안내합니다.

---

**Unity 6: 동일 머티리얼을 공유하는 수천 개 오브젝트 최적화 – MPB를 버리고 현대적 아키텍처로 나아가기**

**By Long Gil Studio**

**🇻🇳 베트남어 에디션 (한국어 번역)**

**1. 렌더링 병목 현상: 머티리얼 복제의 폐해**

대규모 게임을 개발할 때 매우 흔하게 마주치는 아키텍처 과제가 있습니다. "하나의 머티리얼을 공유하는 수천 개 오브젝트의 색상을 FPS 저하 없이 어떻게 바꿀 것인가?"

많은 개발자들이 습관적으로 `GetComponent<Renderer>().material.color` 명령을 사용합니다. 이는 치명적인 실수(anti-pattern)입니다. `.material`을 호출하면 Unity가 해당 머티리얼의 복제본(clone)을 RAM에 암묵적으로 생성하게 됩니다. 그 결과 심각한 메모리 누수가 발생하고, 가비지 컬렉션(Garbage Collection)이 지속적으로 촉발되며, 배칭(Batching) 시스템이 완전히 파괴됩니다. CPU가 수천 개의 개별 드로우 콜을 처리하느라 과부하에 걸리는 동안 GPU는 굶주리게 됩니다.

**2. 레거시의 함정: Unity 6에서 `MaterialPropertyBlock`이 "죽은" 이유**

과거의 "프로다운" 해결책은 머티리얼을 복제하지 않고 오브젝트별 데이터를 전달하기 위해 `MaterialPropertyBlock` (MPB)을 사용하는 것이었습니다. **하지만 Unity 6 (URP/HDRP)를 사용 중이라면 이 방식을 즉시 중단해야 합니다.**

Unity 6는 **SRP Batcher** 파이프라인과 혁신적인 기술인 **GPU Resident Drawer (GRD)**에 크게 의존합니다. GRD는 전체 렌더링 처리 흐름(드로우 콜 생성, 컬링)을 GPU의 컴퓨트 셰이더로 넘겨 CPU 연산 시간을 최대 50%까지 단축합니다. 그러나 엔진 핵심 문서에 따르면, 오브젝트에 `MaterialPropertyBlock`을 부착하는 순간 해당 오브젝트는 즉시 SRP Batcher에서 제외되며 GPU Resident Drawer와의 호환성을 완전히 상실합니다. MPB를 사용한다는 것은 곧 병력 전체에 대해 Unity가 느리고 CPU 소모가 극심한 레거시 렌더 파이프라인으로 되돌아가도록 강제하는 셈입니다.

**3. Unity 6의 새로운 표준: Renderer Shader User Value (RSUV)**

이러한 교착 상태를 근본적으로 해결하기 위해 Unity 6.3 LTS 업데이트는 **Renderer Shader User Value (RSUV)**를 도입했습니다. 이 API를 사용하면 24비트 정수를 렌더러에 직접 전달할 수 있습니다. RSUV는 새로운 버퍼(buffers) 할당을 요구하지 않으므로 SRP Batcher 및 GPU Resident Drawer 모두와 100% 호환성을 유지합니다.

**1단계: C# 인코딩 (Zero Garbage Allocation)**

MPB처럼 문자열(string)을 사용하는 대신, 비트 시프트 연산(bitwise)을 통해 RGB 색상을 하나의 24비트 정수로 인코딩합니다:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Blue, Green, Red 3개 채널을 하나의 24비트 정수로 인코딩  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // 값 적용 (SRP 및 GRD 아키텍처에서 100% 안전!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**2단계: Shader Graph에서 디코딩**

Shader Graph 내부에서 Vector4 출력을 가지는 **Custom Function** 노드(Type: String, Name: DecodeColor)를 생성하세요. 다음 HLSL 코드를 붙여넣어 정수를 표준 색상으로 다시 압축 해제합니다:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

이 출력을 Fragment Shader의 Base Color 포트에 연결하세요. 이제 CPU 지연 시간 제로로 무한한 색상 변형을 구현하고 GPU Resident Drawer 시스템의 성능을 온전히 활용할 수 있습니다.

**예제: Shader 스크립트에서의 실제 구현 (Shader Graph 미사용 시)**

코드(HLSL)로 커스텀 셰이더를 직접 작성하는 경우, 아래 스니펫과 같이 `BuildSurfaceData` 함수에 개입하여 `unity_RendererUserValue`를 디코딩하고 `BaseColor`와 곱할 수 있습니다:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // RSUV 디코딩
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // rsuvColor 적용
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ... 
}
```

*더 자세히 알아보기:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. 100,000개 오브젝트 돌파: DOTS / ECS 솔루션**

게임에서 수십만 개의 독립적인 유닛(거대한 군단 등)을 렌더링해야 한다면, 렌더링을 아무리 잘 최적화하더라도 전통적인 GameObject 시스템은 필연적으로 CPU 병목을 일으킵니다. 이러한 규모에서는 Unity DOTS 구조로 전환하세요. `URPMaterialPropertyOverride` 컴포넌트를 사용하면 Data-Oriented 메모리 레이아웃을 구성하여 저수준 `BatchRendererGroup` API와 직접 통신함으로써 진정한 AAA급의 압도적인 성능을 달성할 수 있습니다.

---

**🇺🇸 영어 버전 (한국어 번역)**

**1. 렌더링 병목 현상: 머티리얼 복제**

고밀도 게임을 개발할 때 흔히 다음과 같은 아키텍처 과제에 직면합니다. "성능을 파괴하지 않으면서 동일한 머티리얼을 공유하는 수천 개 오브젝트의 색상을 어떻게 변경할 수 있을까?"

개발자들은 종종 기본값처럼 `GetComponent<Renderer>().material.color`에 손을 댑니다. 이는 치명적인 안티패턴입니다. `.material`에 접근하면 Unity가 관리 힙(managed heap) 상에서 머티리얼을 암묵적으로 복제하게 됩니다. 이로 인해 심각한 메모리 비대화가 발생하고, 가비지 컬렉션 스파이크가 유발되며, 드로우 콜 배칭이 파괴되어 GPU를 굶주리게 만드는 동시에 CPU 오버헤드를 감당할 수 없는 수준까지 끌어올립니다.

**2. 레거시의 함정: Unity 6에서 MaterialPropertyBlock이 죽은 이유**

역사적으로 "프로" 솔루션은 머티리얼을 복제하지 않고 인스턴스별 데이터를 전달하기 위해 MaterialPropertyBlock (MPB)을 사용하는 것이었습니다. **Unity 6 (URP/HDRP)를 사용하고 있다면 즉시 이 방식의 사용을 중단해야 합니다.**

Unity 6는 **SRP Batcher**와 혁신적인 신규 기능인 **GPU Resident Drawer (GRD)**에 크게 의존합니다. GRD는 절두체 컬링(frustum culling)과 드로우 콜 생성을 GPU 컴퓨트 셰이더로 오프로드하여 CPU 렌더링 시간을 최대 50%까지 줄여줍니다. 그러나 핵심 엔진 문서에 따르면, 오브젝트에 MaterialPropertyBlock을 적용하면 즉시 SRP Batcher에서 실격 처리되며 GPU Resident Drawer와의 호환성이 완전히 깨집니다. MPB를 사용함으로써 여러분은 대규모 군대에 대해 Unity가 느린 레거시 CPU 기반 렌더링 경로로 되돌아가도록 강제하고 있는 것입니다.

**3. Unity 6 표준: Renderer Shader User Value (RSUV)**

이 아키텍처 교착 상태를 해결하기 위해 Unity 6.3 LTS는 **Renderer Shader User Value (RSUV)**를 도입했습니다. 이 API를 사용하면 렌더러의 기본 데이터 페이로드에 직접 24비트 정수를 전달할 수 있습니다. 영속적 상수 버퍼를 수정하지 않기 때문에 RSUV는 SRP Batcher와 GPU Resident Drawer 모두와 100% 호환성을 유지합니다.

**1단계: C# 인코딩 (메모리 할당 제로)**

문자열을 전달하고 블록을 생성하는 대신, 비트 연산을 사용하여 RGB 색상을 하나의 24비트 부호 없는 정수로 수학적으로 패킹합니다:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Blue, Green, Red 채널을 단일 24비트 정수로 인코딩  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // 네이티브 방식으로 값 적용 (100% SRP 및 GRD 안전!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**2단계: 셰이더 디코딩**

Shader Graph 내부에서 Vector4 출력을 갖는 **Custom Function** 노드(Type: String, Name: DecodeColor)를 생성하세요. 이 HLSL 코드를 붙여넣어 정수를 다시 정규화된 float 색상으로 언패킹합니다:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

이 출력을 Base Color 프래그먼트 입력에 연결하세요. 이제 GPU Resident Drawer를 온전히 활용하면서도 드로우 콜 페널티 없이 무한한 색상 변형을 구현할 수 있습니다.

**예제: 커스텀 셰이더(Shader Graph 미사용)에서의 실제 구현**

코드(HLSL)로 커스텀 셰이더를 작성하고 있다면, 아래의 diff에 표시된 것처럼 `BuildSurfaceData` 함수를 수정하여 `unity_RendererUserValue`를 디코딩하고 `BaseColor`와 곱할 수 있습니다:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // RSUV 디코딩
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // rsuvColor 적용
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ...
}
```

*참고:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. 100,000개 오브젝트 그 너머로: DOTS / ECS**

게임이 수십만 개의 동적 유닛을 렌더링해야 한다면, 그래픽 최적화와 무관하게 표준 GameObject는 결국 CPU의 메인 스레드에 병목을 일으키게 됩니다. 대규모 스케일을 위해서는 Unity DOTS로 전환하세요. URPMaterialPropertyOverride 컴포넌트를 사용하면 엄격한 Data-Oriented 메모리 레이아웃을 구성할 수 있습니다. 이는 저수준 BatchRendererGroup API와 직접 연동되어 타의 추종을 불허하는 순수 AAA급 렌더링 성능을 달성합니다.

---

## **제10부: 개발 팀을 위한 전략적 권장 사항**

현대 렌더링 모델을 분석해 보면 구형 최적화 지식(legacy)과 동시대 엔진 아키텍처 간의 중요한 차이가 드러납니다. 그래픽 엔지니어를 위한 핵심 요점은 다음과 같습니다: 오브젝트별로 데이터 버퍼(data buffers)를 수정하는 행위는 본질적으로 병렬 처리 및 GPU 주도 렌더 루프와 적대적입니다. Unity 5.x나 Unity 2019의 최적화 사고방식을 Unity 6에 그대로 적용할 수는 없습니다.

Unity 6에서 최대 성능을 달성하기 위해 개발 팀은 다음 프로토콜을 엄격히 준수해야 합니다.

1. **MPB 사용 감사 (Audit for MPB Usage):** 프로파일링 도구(예: Unity Profiler)와 Frame Debugger를 지속적으로 운용하여 대량으로 인스턴싱되는 지오메트리(mass-instanced geometry)에 `MaterialPropertyBlock`이 적용된 사례를 찾아내고 뿌리 뽑아야 합니다. MPB의 단기적 편의성은 GPU Resident Drawer 기능을 체계적으로 상실하는 손실에 의해 완전히 압도됩니다. 팀은 불필요한 MPB 초기화를 탐지하기 위해 소스 코드 경고나 CI/CD 스크립트를 구축해야 합니다.
2. **비트 인코딩 전략 도입 (Bitwise Encoding Strategies):** Renderer Shader User Value (RSUV)의 도입은 프로그래밍 방법론의 변화를 요구합니다. 테크니컬 아티스트(Technical Artists)와 게임플레이 프로그래머는 협력하여 RSUV의 24비트 한계에 맞춘 엄격한 비트 패킹 스키마를 정의해야 합니다. 다양한 데이터 상태(색상, 대미지, 팀 ID - team ID)가 렌더러에 도달하기 전에 효율적으로 직렬화(serialized)되도록 보장해야 합니다. 예를 들어, "진영 ID"에 4비트(16개 진영 허용), "대미지 상태"에 8비트(256단계 허용), "Custom Tint"(사용자 지정 색상)에 12비트를 할당할 수 있으며, 이 모든 값은 셰이더 내의 비트마스크(bitmasks)를 통해 동시에 디코딩됩니다.
3. **ECS 전환 임계값 평가 (Evaluate Thresholds for ECS Transition):** RSUV가 GameObject의 머티리얼 변형 병목 현상을 해결해 주기는 하지만, 물리 연산, 행렬 계산(transform calculations), GameObject의 컬링과 관련된 CPU 한계 경계는 여전히 존재합니다. 활성 엔티티 수가 10,000개의 동적 에이전트(dynamic agents)를 초과할 것으로 예상되는 프로젝트는 과감하고 적극적으로 DOTS (Entity Component System) 구현 프로토타입을 설계해야 합니다. `URPMaterialPropertyOverride`[^34] 컴포넌트를 사용하여 `BatchRendererGroup` API와 직접 통신하는 것이 최신 PC 및 차세대 콘솔 하드웨어의 잠재력을 온전히 해방할 수 있는 유일한 길입니다.

## **참고문헌**

[^1]: Enable the GPU Resident Drawer in URP - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)  
[^2]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^3]: Set and use the RSUV - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)  
[^4]: Migrated my game to ECS/DOTS and material overrides are awesome! : r/Unity3D - Reddit, 2026년 4월 19일 접속, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)  
[^5]: Why You Should Stop Swapping Materials in Unity (And What to Do Instead) - Medium, 2026년 4월 19일 접속, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)  
[^6]: Material Property Blocks - using them to store the original color of a material upon instantiation : r/Unity3D - Reddit, 2026년 4월 19일 접속, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)  
[^7]: Instancing and Material Property Blocks | Ronja's tutorials, 2026년 4월 19일 접속, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)  
[^8]: Scripting API: MaterialPropertyBlock - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)  
[^9]: Unity 6 and custom material bug - Spine Forum, 2026년 4월 19일 접속, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)  
[^10]: Scriptable Render Pipeline (SRP) Batcher - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)  
[^11]: Scriptable Render Pipeline Batcher - Unity 6.3 User Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)  
[^12]: GPU instancing - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)  
[^13]: Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)  
[^14]: Beginning Game Development: GPU Resident Drawer | by Lem Apperson - Medium, 2026년 4월 19일 접속, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)  
[^15]: Introduction to RSUV - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)  
[^16]: Renderer Shader User Value sample - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)  
[^17]: Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, 2026년 4월 19일 접속, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)  
[^18]: Scriptable Render Pipeline Batcher - Unity User Manual 2021.3 (LTS), 2026년 4월 19일 접속, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)  
[^19]: Unity Draw Call Batching: The Ultimate Guide (2026 Update), 2026년 4월 19일 접속, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)  
[^20]: Scriptable Render Pipeline Batcher - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)  
[^21]: SRP Batcher: Speed up your rendering - Unity, 2026년 4월 19일 접속, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)  
[^22]: Remove SRP Batcher compatibility for GameObjects in URP - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)  
[^23]: GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D - Reddit, 2026년 4월 19일 접속, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)  
[^24]: Scripting API: Renderer.GetPropertyBlock - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)  
[^25]: Create batches with the BatchRendererGroup API in URP - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)  
[^26]: Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)  
[^27]: Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, 2026년 4월 19일 접속, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)  
[^28]: Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling - YouTube, 2026년 4월 19일 접속, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)  
[^29]: Graphics Features and Tools in Unity 6 Feel Like MAGIC! STP, Resident Drawer, and Occlusion Culling! - YouTube, 2026년 4월 19일 접속, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)  
[^30]: Initialize a BatchRendererGroup object in URP - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)  
[^31]: Boost performance of your game in Unity 6 with GPU Resident Drawer - The Knights of U, 2026년 4월 19일 접속, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)  
[^32]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^33]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)  
[^34]: DOTS Instancing shaders in URP - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)  
[^35]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)  
[^36]: One Material multiple colors possible? : r/Unity3D - Reddit, 2026년 4월 19일 접속, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)  
[^37]: Single-pass instanced rendering and custom shaders - Unity - Manual, 2026년 4월 19일 접속, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)  
[^38]: Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, 2026년 4월 19일 접속, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
