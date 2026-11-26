---
title: "Unity 6 HDRP 다중 씬 통합 아키텍처: Light Layers를 활용한 기술 분석 및 종합 솔루션"
date: 2026-05-12 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, hdrp, rendering, lighting, shadows, volumetrics, apv]
description: Light Layers, 방향성 그림자, 볼류메트릭, 스카이박스, 포스트 프로세싱, Adaptive Probe Volumes를 활용해 Unity 6에서 두 HDRP 씬을 하나로 병합하는 심층 기술 분석.
lang: ko
translation_id: unity6-hdrp-multi-scene-light-layers
---

## **초기 검증: Light Layers 기반 조명 분리의 토대**

Unity 6의 High Definition Render Pipeline(HDRP)으로 복잡한 그래픽 프로젝트를 개발할 때, 서로 완전히 독립된 두 환경이나 두 개의 씬(scene) 공간을 하나의 물리적 씬 파일로 통합해야 하는 요구사항은 심각한 아키텍처 과제를 제기합니다. Directional Light 광원을 분리하고 특정 오브젝트 그룹으로 영향 범위를 제한하기 위한 핵심 수단으로 **Light Layers**(또는 Rendering Layers) 메커니즘을 선택한 것은 엔진의 핵심 설계 문서에 엄격히 부합하는 완전히 타당한 기술적 결정입니다.[^1]

현재 적용된 구성 절차는 Frame Settings와 HDRP Asset에 접근해 Light Layers를 활성화한 뒤, Directional Light의 General 섹션에서 Light Layer 파라미터를 커스터마이징하고, 마지막으로 Mesh Renderer의 Additional Settings에서 Rendering Layer Mask 파라미터를 동기화하는 흐름으로 이루어집니다. 이 일련의 설정은 첫 번째 공간(Scene 1)의 메시가 오직 첫 번째 공간의 태양(Directional Light 1)으로부터만 빛 반사를 계산하고, 두 번째 공간(Scene 2) 역시 동일하게 동작하도록 보장하는 단방향 광학 채널을 성공적으로 구축합니다.[^1]

기술적 본질을 더 깊이 살펴보면, Unity HDRP의 렌더링 시스템은 G-buffer를 비트 단위로 분류하기 위한 도구로 LayerMasks를 지원합니다. 3D 환경의 렌더러(Renderer)는 이론적으로 최대 32개의 서로 다른 렌더링 레이어(rendering layers)를 지원할 수 있습니다. 그러나 연산 성능과 VRAM 메모리 대역폭을 최적화하기 위해, 현재 Rendering Layers 메커니즘을 사용하는 모든 HDRP 효과(직접광 조명, Decal, 볼류메트릭 볼륨 포함)는 버퍼의 상위 16개 레이어에 대해서만 연산을 지원합니다.[^1] 이는 Layer 1과 Layer 2를 할당하는 방식이 완전히 안전 영역 내에 있으며 성능 안정성을 보장한다는 것을 의미합니다. 또한 Shader Graph에서 `Sample Buffer` 노드와 `RenderingLayerMask`를 결합해 개입하면 해당 레이어의 광원 아래에서만 효과를 표시하는 전용 머티리얼을 커스터마이징할 수도 있습니다.[^1]

하지만 현재 솔루션의 한계는 물리 기반 렌더링(Physically Based Rendering, PBR)의 첫 번째 기둥인 **직접광(Direct Lighting)**만 해결했다는 데 있습니다. Unity 6 HDRP에서 완전하고 사실적인 환경 생태계는 서로 맞물려 작동하는 수많은 복합 시스템으로 구성됩니다. 두 공간이 동일한 월드 공간(world space) 좌표계를 공유하도록 강제되면, 직접광의 독립성은 그림자 누출(shadow leaking), 대기(volumetrics) 간섭, 스카이박스(skybox) 불일치, 그리고 전역 조명(Global Illumination)의 간접광 오염에 의해 즉시 무너집니다. 솔루션을 완성하려면 두 공간이 서로에게 진정으로 보이지 않게 되도록 렌더링 파이프라인 전반에 걸친 대대적인 개입이 필요합니다.

## **다방향 그림자(Directional Shadows)의 복합적 아키텍처 한계**

조명 채널을 분리한 뒤 마주하는 가장 큰 기술적 장벽은 그림자 매핑(Shadow Mapping) 파이프라인에 있습니다. HDRP의 기본 구성에서는 시스템이 Light Rendering Layers와 Shadow Rendering Layers를 자동으로 동기화합니다. 이 메커니즘은 특정 광원으로부터 빛 광자를 받는 모든 기하 표면이 동시에 그 광원의 빛을 가리고 그림자를 드리우는 차폐물(occluder) 역할도 수행함을 전제합니다.[^1] 그러나 Unity 렌더링 파이프라인에는 하드코딩된(hard-coded) 핵심 물리적 제약이 존재합니다. Universal Render Pipeline(URP)과 High Definition Render Pipeline(HDRP) 모두 어느 시점에서든 카메라 하나당 실시간 그림자 투사(real-time shadow-casting)가 가능한 Directional Light를 **단 하나만** 지원합니다.[^4]

국소적인 영향 범위를 가지는 Point Light나 Spot Light와 달리, Directional Light는 전역적인 영향 범위를 가진 태양광을 대표합니다. 컴퓨터 자원을 고갈시키지 않으면서 광대한 영역의 그림자를 처리하기 위해 HDRP는 **Cascade Shadow Maps(CSM)** 기술을 적용합니다.[^6] 초고해상도 단일 그림자 맵을 생성하는 대신, 엔진은 카메라의 시야 공간을 여러 계층(기본값은 4 cascades이며 Volume의 `HD Shadow Settings`에서 조정 가능)으로 분할합니다.[^6] 각 캐스케이드 계층은 엔진이 별도의 지오메트리 패스(geometry pass)를 수행하고 독립된 그림자 맵을 생성하도록 요구합니다. 따라서 단 하나의 Directional Light가 실제로는 매 프레임마다 최대 4개의 그림자 맵을 지속적으로 렌더링해야 합니다.[^6]

만약 Unity가 두 개의 Directional Light가 동시에 CSM 기법으로 그림자를 생성하도록 허용한다면, 프레임당 계산해야 할 고해상도 shadow maps 수가 8개로 급증하여 메모리 대역폭이 고갈되고 최첨단 하드웨어 시스템에서도 프레임 속도(FPS)가 수용 불가능한 수준으로 급락하게 됩니다.[^4] 사용자 씬에 두 개의 Directional Light가 공존하면 Unity는 둘 중 하나의 그림자 생성 권한을 박탈합니다. 두 번째 광원은 색상 기여(color contribution)만 제공할 뿐 바닥에 그림자(drop shadows)를 드리울 수 없게 되어, 두 번째 공간이 평면적이고 깊이감이 없으며 비물리적인 모습으로 전락합니다.[^4]

더 나아가 주의하지 않으면, 서로 빛을 전혀 받지 않는데도 공간 1의 오브젝트 그림자가 공간 2의 오브젝트 위에 의도치 않게 드리워질 수 있습니다. 이러한 기하학적 그림자 누출을 방지하려면 Shadow Layers 분리를 반드시 해결해야 합니다. 기본적으로 그림자는 조명과 동기화되지만, 완전한 제어를 위해서는 Directional Light를 클릭한 뒤 Shadows 섹션으로 이동해 **Custom Shadow Layers** 체크박스를 활성화해야 합니다.[^1] 이 기능은 Shadow Rendering Layers를 Light's Rendering Layers로부터 분리해, 공간 1의 메시(Mesh)가 오직 Shadow Layer 1 채널에만 그림자를 드리우고 공간 2의 그림자 레이 트레이싱 과정에서는 완전히 투명하게 보이도록 보장합니다.[^1]

## **다중 환경을 위한 그림자 투사 한계 극복 전략**

Unity 6의 단일 태양 그림자 제약을 극복하려면 두 공간 내 오브젝트의 정적·동적 특성을 분석해 다음 두 가지 기술적 개입 전략 중 하나를 적용해야 합니다. 각 전략에는 CSM 제한 시스템을 우회하기 위한 정교한 설정 작업이 수반됩니다.

### **Box-Shaped Spot Light로 태양 시뮬레이션하기**

두 공간 모두 바람에 흔들리는 나무, 끊임없이 움직이는 캐릭터, 교차하는 낮과 밤의 주기 등 높은 강도의 동적 그림자(dynamic shadows) 상호작용을 요구한다면 두 개의 Directional Light를 사용하는 것은 불가능합니다. 대신 최적의 해법은 공간 2의 Directional Light를 Box 공간 형태(Box shape)와 결합된 **Spot Light** 광원으로 대체하는 것입니다.[^8]

Spot Light는 리소스 관리 방식에서 Directional Light와 완전히 다릅니다. 4개의 캐스케이드 분할 맵 대신 단 하나의 그림자 맵(shadow map 1개)만 렌더링하기 때문에 엔진의 엄격한 CSM 제한에서 벗어납니다.[^6][^4] Spot Light 설정 인터페이스에서 Shape 속성을 Box 형태로 전환하면, 제한된 국소 영역 내에서 태양광선과 동일한 평행 광선 경로를 정밀하게 모사하는 지향성 조명 볼륨을 생성할 수 있습니다.[^8]

그러나 Spot Light의 물리적 특성은 거리에 따라 빛이 감쇠(distance attenuation)한다는 점입니다. 실제 태양은 지구 범위 내에서 이러한 감쇠가 사실상 없습니다. 이를 해결하려면 Spot Light의 고급 설정에 접근해 "Range Attenuation" 속성을 찾아 조정하거나 비활성화하면 됩니다.[^8] 빛 세기의 감쇠가 제거되면 Box 형태의 이 Spot Light는 즉시 균일하고 평행한 빛을 생성하며, 전통적인 Directional Light와 구별할 수 없는 맞춤형 하드 또는 소프트 그림자를 드리우는 동시에 Light Layer 2를 통해 완벽하게 분리됩니다.[^8]

### **혼합 캐시 그림자(Mixed Cached Shadows) 전략**

공간 1 또는 공간 2가 주로 건물, 지형, 도로와 같은 정적 구조물로 이루어져 있고 플레이어 캐릭터처럼 움직이는 개체가 소수에 불과하다면, **Mixed Cached Shadows**(혼합 캐시 그림자) 기능을 활용하는 것이 획기적인 아키텍처 결정이 됩니다.[^7] HDRP 13.x 및 14.0 버전부터 도입되어 Unity 6에서 표준이 된 이 기능은 Directional Light용으로 잠금 해제되어, 그림자 맵을 정적(static)과 동적(dynamic)이라는 두 개의 독립된 데이터 스트림으로 분할할 수 있게 합니다.[^7]

이 솔루션을 활성화하는 절차는 프로젝트 관리 시스템과 로컬 오브젝트 간의 동기화를 요구합니다. 첫 번째 단계는 HDRP가 메모리를 할당할 수 있도록 구성하는 것입니다. Inspector 창에서 HDRP Asset 설정 파일을 열고 *Lighting > Shadows > Directional Light Shadows* 경로로 이동해 **Allow Mixed Cached Shadows** 옵션을 반드시 체크해야 합니다.[^7] 다음으로 씬의 Directional Light에서 작업합니다. Light 탭에서 Shadows 항목을 확장하고 **Always draw dynamic**을 체크한 뒤, 조명의 Update Mode 파라미터를 *Every Frame* 상태에서 *On Demand* 또는 *OnEnable*로 설정합니다.[^7] 마지막으로 환경 내 모든 정적 오브젝트를 선택하고 Mesh Renderer 컴포넌트의 **Static Shadow Caster** 옵션을 활성화합니다.[^7]

내부 동작 원리를 보면, 시스템이 이 모드로 작동할 때 HDRP는 Directional Light의 캐시된(cached) 그림자와 캐시되지 않은(non-cached) 그림자 모두에 동일한 Shadow Atlas를 사용합니다.[^10] 정적으로 표시된 오브젝트는 그림자가 메모리 버퍼에 단 한 번만 그려지는 반면, 동적 오브젝트의 그림자는 지속적으로 갱신됩니다.[^7] 이후 HDRP는 blit(Bit Block Transfer) 연산을 수행해 캐시된 정적 맵의 데이터를 동적 맵에 병합함으로써 막대한 양의 지오메트리 드로우 콜(geometry draw calls)을 절감합니다.[^7]

이 솔루션이 두 개의 Directional Light가 항상 동시에 그림자를 드리우도록 직접 허용하는 것은 아니지만, 연산 리소스를 확보해 카메라 위치에 따라 광원 간 그림자 렌더링 권한(shadow rendering authority)을 빠르게 전환하거나, 하나의 Directional Light를 캐시된 그림자용으로 사용하고 국소 광원을 동적 그림자용으로 사용할 수 있게 해줍니다.[^5] 주의할 점은 Directional Light의 캐스케이드 그림자 맵(cascade shadow maps)이 시점에 의존적(view-dependent)이므로 카메라가 캐스케이드 경계를 가로질러 이동할 때 그림자 가장자리에 시각적 왜곡이 발생할 수 있다는 것입니다. 이를 방지하려면 카메라가 일정 거리만큼 이동할 때마다 `RequestShadowMapRendering` 함수를 호출해 캐시 맵을 갱신하는 C# 스크립트를 작성해야 합니다.[^7] `SetShadowResolution()`이나 `SetShadowUpdateMode()` 같은 함수 역시 런타임 실행 중 이 버퍼를 제어할 수 있도록 API를 통해 제공됩니다.[^7]

| 다중 씬 그림자 솔루션 비교 | 권한 전환형 Directional Light | Box-Shaped Spot Light | Mixed Cached Shadows |
| :--- | :--- | :--- | :--- |
| **동작 원리** | 스크립트를 통해 조명 1의 그림자를 끄고 조명 2를 켬.[^5] | 태양을 모사하는 제한된 볼륨 광원 사용.[^8] | 정적 그림자는 버퍼에 캐시하고 동적 그림자만 갱신.[^7] |
| **VRAM 리소스 소모** | 낮음(1개의 캐스케이드 시스템만 활성).[^6] | 중간(비분할 shadow map 1개 추가).[^6] | 매우 높음(정적 맵과 동적 맵을 병행 저장).[^7] |
| **Light Layers 지원** | 예(전면 지원).[^1] | 예(전면 지원).[^1] | 예(전면 지원).[^1] |
| **유효 범위** | 두 공간이 화면에 동시에 나타나지 않을 때 적합. | 두 태양이 동시에 그림자를 드리워야 하는 중첩 구역에 탁월.[^4] | 주로 정적 오브젝트로 구성된 광활한 배경에 최적화.[^7] |
| **기술적 제약** | 갑작스러운 전환 시 시각적 단절이 발생할 수 있음. | Range Attenuation과 Box 크기를 세심하게 조정해야 함.[^8] | 카메라 이동 시 C# 프로그래밍(`RequestShadowMapRendering`) 필요.[^7] |

## **대기 볼류메트릭(Volumetrics) 관리 및 스카이박스 분리**

직접광과 그림자는 물리 기반 렌더링 파이프라인 그림의 절반만을 차지합니다. 나머지 절반은 하늘, 대기층, 그리고 화면 후처리 효과에 속합니다. 원 질문 디렉터리에서 사용자는 "별도의 Volume" 사용을 언급했습니다. HDRP의 Volume 아키텍처는 개별 메시 위의 LayerMask로 분류하는 방식이 아니라, 경계 상자(bounding boxes) 대비 카메라의 공간적 위치에 따라 속성 값을 보간(interpolation)하는 기반 플랫폼입니다.[^11] 이러한 설계 철학적 차이는 대기가 해당 오브젝트가 Scene 1에 속하는지 Scene 2에 속하는지 신경 쓰지 않으며, 오직 카메라가 어디에 위치해 있는지에만 관심을 갖는다는 것을 뜻합니다.

각 씬의 환경 정체성을 그대로 유지하면서 두 씬을 병합하려면, 전제 조건으로 전체 설계 사고방식을 Global Volume(전역 볼륨)에서 **Local Volume**(로컬 볼륨)으로 완전히 전환해야 합니다. Global Volume은 카메라가 3D 세계 어디에 있든 영향을 미쳐, 두 공간의 분리를 파괴하는 균일한 덮개를 생성합니다.[^11]

환경 격리 절차는 다음 작업을 요구합니다. 기본 Global Volume을 제거하거나 Priority(우선순위)를 낮춥니다.[^12] 두 공간에 각각 대응하는 빈 GameObject 2개를 생성하고 Volume 컴포넌트를 추가한 뒤 Mode 설정을 **Local**로 지정합니다.[^11] 해당 대기 공간이 존재하는 물리적 경계를 정의하기 위해 **Is Trigger** 속성이 켜진 Box Collider(또는 Mesh Collider) 컴포넌트를 반드시 추가로 부착해야 합니다.[^11] 공간 1과 공간 2 사이의 전환은 **Blend Distance**(혼합 거리) 파라미터를 통해 제어됩니다. Blend Distance 값은 그래픽 파라미터 보간이 시작되는 Box Collider 가장자리에서 안쪽으로 들어가는 여백 거리를 규정합니다. Blend Distance를 `0`으로 설정하면 플레이어가 경계선을 넘을 때 공간이 즉시 "잘리듯" 전환됩니다. 이 값을 늘리면 안개나 조명 색감 같은 환경 요소가 서서히 서로 어우러집니다.[^13]

### **`Visual Environment`를 통한 하늘 오버라이드**

Unity 6 HDRP에서 하늘은 구식 Built-in RP의 Environment Lighting 창으로 정의되지 않으며, **Visual Environment**라는 특수한 Volume Override에 의해 전적으로 지배됩니다.[^15] 하늘을 분리하려면 공간 1과 공간 2 각각의 Local Volume에 Visual Environment를 할당해야 합니다.

**Sky Type** 파라미터를 활성화하면 공간 1에는 `Physically Based Sky`(예: 맑은 한낮), 공간 2에는 `HDRI Sky`(예: 희미한 달빛이 비치는 밤)처럼 서로 다른 하늘 유형을 선택할 수 있습니다.[^15] Volume 아키텍처가 카메라 기준으로 작동하므로, 카메라가 공간 1의 Box Collider 안으로 들어가면 엔진은 단 한 줄의 코드도 없이 해당 하늘 이미지를 자동으로 계산합니다. 또한 `Cloud Layer`(구름층)와 `Ambient Indirect Lighting`(간접 환경광) 파라미터까지 제어해, 하늘이 단순한 배경 장식에 그치지 않고 전역 반사 색조에도 정확히 기여하도록 보장합니다.[^16] 이로써 Scene 1이 Scene 2의 하늘을 의도치 않게 반사하는 현상이 완전히 제거됩니다.

### **`Local Volumetric Fog`를 통한 대기 독립화**

HDRP의 안개는 두 종류로 나뉩니다. 전통적인 Exponential Fog는 Z-buffer 깊이에 따라 단색만 덧씌웁니다. 반면 차세대 그래픽 품질에 부응하기 위한 **Volumetric Fog**(볼류메트릭 포그)는 빛줄기와 직접 상호작용해 사실적인 갓 레이(God-rays) 효과를 만들어냅니다.[^18] 일반 Volume을 통해 Volumetric Fog를 사용하면 인접 공간의 경계로 번져 나갈 위험이 여전히 존재합니다. 근본적인 해법은 전용 컴포넌트인 **Local Volumetric Fog**를 사용하는 것입니다.[^18]

Local Volumetric Fog는 방향 지정 상자 형태로 경계를 설정할 수 있는 물리적 안개 볼륨입니다.[^18] 이를 가동하려면 Project Settings(*Quality > HDRP > Lighting > Volumetrics*), HDRP Asset, 그리고 카메라의 Frame Settings에서 일련의 플래그(flags)를 활성화해야 합니다.[^18] 이 컴포넌트는 `Density Mask 3D Texture`를 통해 밀도를 절대적으로 제어할 수 있어, 안개가 빽빽하게 뭉쳐 있는 대신 자연스럽게 소용돌이치게 합니다.[^18] 빛 반사 색상(`Single Scattering Albedo`)은 Directional Light가 관통할 때 안개의 색조를 결정합니다.[^19]

Scene 1의 안개 공간이 Scene 2와 섞이지 않게 하는 핵심은 **Blending Mode** 파라미터에 있습니다.[^19] 기본적으로 시스템은 안개를 서로 중첩시키는 **Additive**(가산) 방식을 사용합니다. Blending Mode를 **Overwrite**(덮어쓰기)로 변경하면, 이 안개 볼륨은 자신의 범위 내에 놓인 배경 씬의 모든 안개 파라미터를 가차 없이 대체하고 지워버립니다.[^19] 두 개의 Local Volumetric Fog 볼륨이 두 씬의 경계에서 교차할 때는 **Priority** 파라미터가 어느 레이어가 위에 표시될지 결정하며, HDRP는 우선순위가 낮은 볼륨을 먼저 렌더링하고 높은 볼륨을 마지막에 렌더링하는 규칙을 따릅니다.[^19]

### **`Volume Layer Mask`와 포스트 프로세싱에 대한 오해**

서로 다른 오브젝트에 대해 Bloom, Depth of Field, Color Grading 같은 포스트 프로세싱(Post-processing) 효과를 분리하려 할 때 Unity 개발자들 사이에서 매우 흔히 발생하는 인식의 공백이 있습니다. 많은 사람이 Camera의 **Volume Layer Mask** 속성이 Light Layers처럼 작동할 것이라 기대하며 이를 조정합니다.[^20] 실제로 Volume Layer Mask는 *어떤 오브젝트*가 포스트 프로세싱 효과를 받을지 전혀 제어하지 못합니다. 오직 *어떤 Camera*가 *어떤 Volume*의 영향을 받을지만 제어할 뿐입니다.[^20]

포스트 프로세싱은 본질적으로 스크린 공간(Screen Space) 렌더링 과정이기 때문입니다. 프레임이 Post-processing 단계에 도달할 때쯤이면 모든 3D 오브젝트는 색상(RGB)과 깊이(Depth) 데이터를 담은 2D 픽셀 배열로 "납작하게 압축"된 상태입니다. 시스템은 더 이상 어떤 픽셀이 Scene 1에 속하고 어떤 픽셀이 Scene 2에 속하는지 인식하지 못합니다.[^22] 따라서 Volume Mask를 사용해 Bloom이 Scene 1에만 적용되길 바라는 것은 불가능합니다.[^22]

두 환경의 분리 요구가 매우 엄격해서 포스트 프로세싱 효과나 렌더링 알고리즘이 겹쳐 보이면서도 완전히 독립적이어야 한다면(예: Scene 1의 1인칭 손에 든 무기가 Scene 2의 배경 위에 겹쳐 렌더링되는 경우), 전통적인 해법은 Camera Stacking(카메라 스태킹)입니다. 그러나 HDRP에서 Camera Stacking은 리소스를 극도로 많이 소모하고 수많은 동기화 오류를 유발합니다.[^22] Unity가 공식 지원하는 표준이자 유일한 아키텍처 해법은 **Custom Pass Volume**입니다.[^25]

Custom Pass는 그래픽 파이프라인의 특정 단계(예: *Before Transparent*, *After Post-Process*)에 커스텀 렌더링 명령을 주입(inject)할 수 있게 해줍니다. Custom Pass Volume을 Local 또는 Camera 모드로 동작하도록 설정하고[^27] 특정 `LayerMask`를 타겟팅하면, 시스템은 공간 2의 전체 오브젝트 그룹을 별도로 렌더링해 별개의 포스트 프로세싱 셰이더 세트를 적용한 다음, 공간 깊이 가려짐(depth occlusion) 정보를 깨뜨리거나 버퍼를 손상시키지 않으면서 공간 1 위에 합성(composite)할 수 있습니다.[^25] 셰이더의 `_FadeValue` 변수와 C# API의 `CustomPass.fadeValue`를 활용하면 0에서 1 사이의 스케일을 기반으로 이 표시 레이어들 사이를 부드럽게 흐리거나 전환해 완벽한 시각적 분리를 구현할 수 있습니다.[^27]

## **Adaptive Probe Volumes(APV)를 통한 간접 반사광 제어**

직접광은 화사함을 만들어내지만, 모든 사물을 현실에 단단히 닻 내리게 하는 것은 바로 **간접광(Global Illumination, GI)**입니다. 공간 2의 초록색 잔디 표면에 닿은 빛은 스펙트럼을 흡수하고 인접한 벽면에 초록빛 광선을 튕겨 보냅니다. 두 공간을 병합할 때 Scene 파일 내 물리적 거리는 매우 가까울 수 있습니다. 격리 조치가 없다면 공간 1의 강렬한 붉은빛이 공간 2로 심하게 누출(`light bleeding`)되어 아트 디렉션(Art Direction)을 완전히 파괴할 것입니다.

Unity 6부터는 **Adaptive Probe Volumes(APV)**의 등장으로 간접광 인프라가 일대 혁명을 겪었습니다.[^28] 이 기술은 번거로운 수동 Light Probe Groups 배치 시대의 종말을 고합니다. APV는 "브릭(bricks)"이라 불리는 구조 아래 빛 데이터 수집 지점(Light Probes)의 네트워크를 자동으로 배치합니다.[^28] 각 브릭은 4×4×4 행렬(총 64개 프로브)을 포함합니다.[^28] APV의 지능형 알고리즘은 기하 밀도를 분석하여, 복잡하고 좁은 곳에서는 브릭을 세분화해 조명 해상도를 높이고 빈 공간에서는 넓고 성긴 브릭을 사용해 메모리를 절약합니다.[^28] 나아가 APV는 볼류메트릭 포그(Volumetric Fog) 및 파티클 시스템(VFX Graph)과도 완벽하게 상호작용하여 그래픽 환경의 일관성을 보장합니다.[^28]

### **APV에서의 Rendering Layers 지원 및 제한**

간접광 시스템 역시 두 공간의 경계를 존중하도록 보장하려면, 첫 단계에서 사용자가 구성한 Light Layers를 APV 시스템과 동기화해야 합니다. APV는 **Rendering Layer Masks**를 완벽히 이해하고 지원하지만, 최적화 측면의 엄격한 제한에 묶여 있습니다. 메모리와 조회 속도를 보호하기 위해 APV는 저장 데이터 블록 내에 동시에 최대 **4개의 Rendering Layers Masks**만 활성화할 수 있도록 허용합니다.[^29]

Unity의 전역 "라이트 베이킹(baking)" 과정은 매우 정교하게 진행됩니다. 시스템은 주변 공간을 탐색하고 차폐 분석(occlusion analysis)을 수행하기 위해 각 프로브에서 수백만 개의 광선 테스트(ray tests)를 발사합니다.[^30] 빛 광선이 튕기면서 미리 rendering layers 태그가 지정된 지오메트리 표면(예: 공간 1의 Layer 1 및 공간 2의 Layer 2)과 지속적으로 충돌합니다. 하나의 프로브는 정의된 4개의 마스크 중 단 하나의 마스크만 가질 수 있으므로, Unity는 다수결 알고리즘을 사용해 해당 마스크를 할당합니다. 즉, 한 프로브의 광선 다수가 Layer 1에 부딪히면 그 프로브는 Layer 1에 고정됩니다.[^30]

그러나 이러한 자동화는 경계 구역에서 재앙이 됩니다. 공간 1과 공간 2 사이에 떠 있는 빛 수집 지점들은 데이터가 뒤섞여 예측 불가능한 교차 조명 오염이나 얼룩덜룩한 밝고 어두운 사각형 아티팩트(`probe flares/square artifacts`)를 유발합니다.[^31]

### **`Probe Adjustment Volume`(PAV)을 통한 조명 격리**

알고리즘의 자유도를 억누르고 제작자의 의도를 따르도록 강제하려면, 아키텍트는 **Probe Adjustment Volume(PAV)**이라는 제어 도구를 배치해야 합니다.[^29]

PAV는 APV 데이터가 오브젝트로 전달되기 전 가장 원시적인 수준에서 데이터를 변경할 수 있는 권한을 가진 로컬 제어 볼륨입니다. 이 볼륨에서 가장 중요한 기능은 **Override Rendering Layer Mask**(렌더링 레이어 마스크 재정의)입니다.[^30] 두 환경을 분리하기 위한 구축 단계는 다음과 같습니다:

1. 공간 1의 모든 메시 구조를 빈틈없이 감싸는 Box 형태의 `Probe Adjustment Volume`을 설정합니다.
2. PAV의 Inspector 패널 내부에서 **Override Rendering Layer Mask** 기능을 활성화합니다.[^32]
3. 공간 1에 속하지 않는 모든 레이어(공간 2의 Layer 2 포함)를 완전히 제거하고 **오직 Layer 1만** 남깁니다.[^29]

이 과정이 완료되면 격리 메커니즘이 확립됩니다. 런타임(runtime)에 캐릭터나 동적 오브젝트가 공간 1의 경계 내에서 이동할 때, 해당 오브젝트의 렌더러(renderer)는 APV 그리드를 조회합니다. PAV의 오버라이드 설정 덕분에 해당 오브젝트는 오직 Layer 1 태그가 붙은 프로브에서만 조명 데이터를 추출해 샘플링(sample)하도록 엄격히 제한됩니다.[^29] 공간 2에서 실수로 튕겨 들어온 모든 빛 광자 데이터는 버퍼 수준에서 접근이 거부됩니다. 이로써 두 공간 간의 간접광 격리는 이제 절대적인 수준이 됩니다.

더 나아가, 두 씬의 병합이 순간이동(teleportation)이나 시간대 변화(예: 동일 지역의 낮인 공간 1과 밤인 공간 2) 시나리오를 위한 것이라면, Unity 6는 APV와 결합된 **Lighting Scenarios**(조명 시나리오) 기능을 제공합니다.[^28] HDRP Asset에서 이 기능을 켜면 각 공간의 베이킹 데이터를 서로 다른 시나리오 에셋에 저장할 수 있습니다. 런타임에는 `ProbeReferenceVolume` API를 통해 단 몇 밀리초 만에 시나리오를 활성화하고 교체할 수 있습니다. 심지어 **Scenario Blending**을 활성화하면 `BlendLightingScenario` 같은 C# 함수가 CPU 병목을 일으키지 않으면서 매 프레임마다 공간 1의 GI 데이터를 공간 2로 부드럽게 보간해, 가장 환상적이고 전문적인 장면 전환 효과를 선사합니다.[^33]

## **메모리 최적화 및 저수준 리소스 관리**

Unity 같은 엔진이 두 개의 복잡한 환경을 위해 여러 조명, 그림자, 대기 시스템을 병행 렌더링하도록 강제하면 GPU의 VRAM 메모리는 극심한 부담을 안게 됩니다. 시스템 아키텍트의 역량은 단순히 모든 것이 돌아가게 만드는 데 그치지 않고, 최소한의 프레임 지연 시간(frametimes)을 유지하며 광학 아티팩트(artifacts)를 완전히 제거하는 데 있습니다.

### **`Dynamic Rescale`을 통한 아틀라스 용량 확보**

그림자 메모리 내 공간 경쟁은 그래픽 무결성에 대한 가장 큰 위협입니다. 앞서 분석했듯 HDRP는 HDRP Asset에 선언된 정적 아틀라스 시스템(기본 크기는 보통 4096×4096 픽셀)을 통해 그림자를 할당합니다.[^6] Spot Light(공간 2의 태양 대체용 포함)와 Point Light에서 생성되는 그림자 수가 이 면적을 초과하면 개체의 그림자가 깨지거나 사라집니다.[^34]

예방책은 HDRP Asset에서 *Punctual Light Shadows*와 *Area Light Shadows* 모두에 대해 **Dynamic Rescale**(동적 크기 조정) 기능을 활성화하는 것입니다.[^7] 이 기능이 작동하면 HDRP는 광원이 차지하는 화면 면적 비율을 분석합니다. 멀리 떨어져 있거나 부분적으로 가려진 광원은 그림자 해상도가 지수적으로 강제 축소되어, 카메라에 가까운 핵심 그림자 영역을 위해 아틀라스 내 여유 공간을 양보합니다.[^7] 단, 정적 캐시 데이터는 물리적 연결을 깨뜨리지 않고는 신축적으로 변형할 수 없으므로, Mixed Cached Shadows의 정적으로 캐시된 그림자 맵(cached shadow maps)에 대해서는 Dynamic Rescale 알고리즘이 비활성화된다는 점에 각별히 유의해야 합니다.[^7]

### **`Max Shadows on Screen` 및 `Shadow Bias`의 엄격한 제어**

HDRP Asset의 Shadows 섹션에 있는 **Max Shadows on Screen** 파라미터는 하드웨어가 한 프레임 내에서 계산할 수 있는 그림자 수에 절대적인 상한선을 설정합니다.[^6] 카메라가 두 공간의 일부를 동시에 조망할 수 있는 각도에 놓이면 이 한계치를 매우 빠르게 초과해 엔진이 무작위로 그림자를 탈락시키는 결과를 낳습니다. 메모리 버퍼에 적재되는 오브젝트 수를 최소화하기 위해 두 공간의 경계 사이에 물리적 차폐 지오메트리와 함께 오클루전 컬링(occlusion culling)을 사용하는 것이 필수적입니다.[^22]

조명 채널을 분할하고 시뮬레이션할 때, 비선형 투사 각도로 인해 메시 표면을 뚫고 빛이 새어 나오는 현상(`light leaking`)과 그림자 여드름 현상(`shadow acne`)이 더 빈번하게 발생합니다. 각 Light 컴포넌트의 **Shadow Bias** 시스템을 관리하는 것이 시각적 품질을 유지하는 핵심입니다.[^34] *Near Plane* 파라미터를 미세 조정해 그림자 투사 시작점을 뒤로 밀어내고, *Normal Bias*를 높여 표면 법선을 따라 그림자 샘플링 표면을 이동시켜 잘못된 자기 그림자(self-shadowing)를 방지하며, 경사진 표면에는 *Slope-Scale Depth Bias*를 보정합니다.[^34] 이러한 미세 조정을 PCF(Percentage-Closer Filtering)나 PCSS(Percentage-Closer Soft Shadows) 같은 고품질 그림자 필터링(Shadow filtering)과 결합하면, 그림자 경계가 부드럽게 유지되고 두 개의 광원 사용으로 인해 발생하는 모든 결점을 가릴 수 있습니다.[^34]

### **레이어 분할 광원 수에 관한 하드웨어 제약**

HDRP와 URP는 두 가지 핵심 렌더링 경로인 **Forward+**와 **Deferred**를 제공합니다. 다중 레이어 조명(Light Layers)을 구성하는 과정에서는 사용 중인 아키텍처의 한계를 명확히 인지해야 합니다.

* 프로젝트가 **Forward+** 아키텍처로 구동되는 경우, 시스템은 데스크톱 기기 기준 카메라당 최대 256개의 광원이라는 거대한 수치를 지원합니다.[^38] 그러나 동시에 단일 오브젝트에 영향을 미칠 수 있는 추가 광원 수는 **최대 8개**로 하드 락(hard-lock)되어 있습니다.[^38] 사용자가 Light Layer 1과 Light Layer 2로 채널을 분리한 방식은 무관한 조명을 훌륭하게 배제하여 메시가 이 8개 광원 한계치에 도달하는 것을 방지합니다.
* 무제한에 가까운 광원 수를 최적화하기 위해 **Deferred** 아키텍처로 프로젝트를 구동하는 경우, 치명적인 제약을 주의해야 합니다. Deferred 메커니즘의 컬링 마스크(culling mask)는 동시에 **최대 4개의 레이어**까지만 구분을 지원합니다.[^40] 공간을 더 잘게 나누기 위해 복잡한 Light Layers를 4개 초과해 남용하면 시스템은 복구 불가능한 그래픽 깨짐(graphical artifacts) 상태에 빠집니다.[^40] 초기 솔루션에서 두 개의 기본 레이어(Layer 1과 Layer 2)만 사용한 방식은 메모리 측면에서 그 효율성과 절대적 안전성을 입증합니다.[^1]

## **솔루션 매트릭스 및 시스템 요약**

Unity 6 HDRP의 각 핵심 서브시스템을 해부해 본 결과, 사용자의 접근 방식은 필수적인 첫걸음으로 검증되었으나 두 개의 씬을 하나의 파일로 결합한 완전한 렌더링 환경을 구축하려면 다층적 전략 시스템의 조율이 필요합니다. 아래 매트릭스 표는 분석된 모든 심층 기술 기법을 종합한 것입니다:

| HDRP 서브시스템 | 초기 접근 방식 (사용자) | 완성을 위한 핵심 보완 기술 솔루션 |
| :--- | :--- | :--- |
| **직접광 (Direct Lighting)** | Directional Light와 Mesh Renderer에 Light Layer 1(Scene 1)과 Light Layer 2(Scene 2) 구성. | **정확성 검증 완료**. Deferred 아키텍처 충돌을 피하기 위해 활성 레이어 수를 최소한으로 유지할 것.[^1] |
| **다방향 그림자 (Directional Shadows)** | *미해결*. 엔진의 프레임당 1 Directional Shadow 한계에 직면할 위험.[^4] | **Custom Shadow Layers**로 그림자 분리.[^1] 두 공간 모두 그림자가 필요하면 조명 2를 **Box-shaped Spot Light**(Range Attenuation 끄기)로 대체하거나[^8], HDRP Asset에서 정적 메시용 **Mixed Cached Shadows** 기술 사용.[^7] |
| **스카이박스 (Skybox & Visual Environment)** | *미해결*. 공유 하늘이 두 공간 간의 격리를 무너뜨림. | 2개의 **Local Volumes**(Box Collider 포함) 배치. **Visual Environment** 오버라이드를 사용해 2개의 서로 다른 Sky Type 할당. Blend Distance를 조정해 부드럽게 보간.[^11] |
| **대기 안개 (Volumetric Fog)** | *미해결*. Global Volumetric Fog가 다른 구역으로 번져 나감. | **Local Volumetric Fog** 컴포넌트로 대체. Blending Mode 파라미터를 Additive에서 **Overwrite**로 전환해 로컬 안개가 배경 대기를 덮어쓰게 함.[^18] 교차 구역의 Priority 미세 조정. |
| **포스트 프로세싱 분리 (Post-Processing)** | *미해결*. (개별 오브젝트에 대한 Volume Layer Mask 오해).[^22] | **Custom Pass Volume** 구성. 셰이더 C# API와 layer masks를 사용해 포스트 프로세싱을 별도로 렌더링한 뒤 겹쳐 합성하며, 비효율적인 Camera Stacking 방식 포기.[^22] |
| **간접광 (Global Illumination / APV)** | *미해결*. 반사광(Bounced light)이 두 환경의 경계를 넘어 누출됨. | **Adaptive Probe Volumes(APV)**를 사용해 동기화. 공간 1 영역을 감싸는 **Probe Adjustment Volume(PAV)**을 배치하고 **Override Rendering Layer Mask** 기능을 사용해 Layer 2 태그가 붙은 프로브의 조명 데이터 보간을 거부.[^28] |

Unity 6 HDRP의 물리 시뮬레이션 그래픽 생태계는 빛에 대한 모든 변화가 반사, 차폐, 공간 굴절이라는 물리적 연쇄 결과를 끌어내는 복잡하고 까다로운 머신입니다. Light Layers를 사용해 조명 채널을 분리한 것은 시스템에 대한 깊은 이해를 보여주는 완벽한 출발점이지만, 그 이론을 온전한 예술적 공간으로 구현하려면 정교한 미세 구성 네트워크의 뒷받침이 필요합니다. Custom Shadow Layers와 Mixed Cached Shadows를 철저히 적용하고, Local Volume Framework의 공간 제어력을 활용하며, Probe Adjustment Volume으로 간접광 정보 흐름을 엄격히 분리함으로써 그래픽 아키텍트는 시각적 품질에 대한 어떠한 타협도 드러내지 않고 이 거대한 렌더링 엔진이 단일 공간 내부에서 두 개의 다차원 현실을 병행 구동하도록 완벽하게 제어할 수 있습니다. 설계자가 버퍼(buffers) 계층의 핵심 구조와 GPU 상에서의 광자 흐름을 완전히 장악한다면 기하학적 그림자 누출과 스펙트럼 오염의 모든 경계는 완벽히 봉쇄될 수 있습니다.

## **참고문헌**

[^1]: Use light rendering layers | High Definition RP | 16.0.6 - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Rendering-Layers.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Rendering-Layers.html)  
[^2]: Light Layers | High Definition RP | 14.0.12 - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Light-Layers.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Light-Layers.html)  
[^3]: Rendering Layers | High Definition RP | 15.0.7 - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Rendering-Layers.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Rendering-Layers.html)  
[^4]: Is it possible to achieve shadows from two directional lights in URP? : r/Unity3D - Reddit, 2026년 5월 11일 확인, [https://www.reddit.com/r/Unity3D/comments/1bndl5x/is\_it\_possible\_to\_achieve\_shadows\_from\_two/](https://www.reddit.com/r/Unity3D/comments/1bndl5x/is_it_possible_to_achieve_shadows_from_two/)  
[^5]: 2 or more directional lights simultaneously - Unity Discussions, 2026년 5월 11일 확인, [https://discussions.unity.com/t/2-or-more-directional-lights-simultaneously/878090](https://discussions.unity.com/t/2-or-more-directional-lights-simultaneously/878090)  
[^6]: Shadows in the High Definition Render Pipeline - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@8.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@8.0/manual/Shadows-in-HDRP.html)  
[^7]: Shadows in the High Definition Render Pipeline | High Definition RP ..., 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Shadows-in-HDRP.html)  
[^8]: Multiple directional light shadow maps - Unity Discussions, 2026년 5월 11일 확인, [https://discussions.unity.com/t/multiple-directional-light-shadow-maps/821372](https://discussions.unity.com/t/multiple-directional-light-shadow-maps/821372)  
[^9]: Mixed cached shadows for directional light broken when shadow cascade count is greater than 1 - Unity Discussions, 2026년 5월 11일 확인, [https://discussions.unity.com/t/mixed-cached-shadows-for-directional-light-broken-when-shadow-cascade-count-is-greater-than-1/919216](https://discussions.unity.com/t/mixed-cached-shadows-for-directional-light-broken-when-shadow-cascade-count-is-greater-than-1/919216)  
[^10]: Shadows in the High Definition Render Pipeline - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.0/manual/Shadows-in-HDRP.html)  
[^11]: Volumes | High Definition RP | 10.2.2 - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.2/manual/Volumes.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.2/manual/Volumes.html)  
[^12]: HDRP Global Settings Window | High Definition RP | 15.0.7 - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Default-Settings-Window.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Default-Settings-Window.html)  
[^13]: Local Volumetric Fog | High Definition RP | 14.1.0, 2026년 5월 11일 확인, [https://docs.unity.cn/cn/Packages-cn/com.unity.render-pipelines.high-definition@14.1/manual/Local-Volumetric-Fog.html](https://docs.unity.cn/cn/Packages-cn/com.unity.render-pipelines.high-definition@14.1/manual/Local-Volumetric-Fog.html)  
[^14]: Different Types of Post-Processing Volumes in Unity HDRP | by Liberty Depriest - Medium, 2026년 5월 11일 확인, [https://medium.com/@youngchae.depriest/different-types-of-post-processing-volumes-in-unity-hdrp-4f36e3e6dbc5](https://medium.com/@youngchae.depriest/different-types-of-post-processing-volumes-in-unity-hdrp-4f36e3e6dbc5)  
[^15]: Visual Environment | High Definition RP | 16.0.6 - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Override-Visual-Environment.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Override-Visual-Environment.html)  
[^16]: Create environment lighting | High Definition RP | 16.0.6 - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Environment-Lighting.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Environment-Lighting.html)  
[^17]: Setting The Skybox In Unity HDRP - Vincent Taylor, 2026년 5월 11일 확인, [https://vintay.medium.com/setting-the-skybox-in-unity-hdrp-ffc8f7e068ec](https://vintay.medium.com/setting-the-skybox-in-unity-hdrp-ffc8f7e068ec)  
[^18]: Local Volumetric Fog | High Definition RP | 14.0.12 - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Local-Volumetric-Fog.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Local-Volumetric-Fog.html)  
[^19]: Local Volumetric Fog Volume reference | High Definition Render Pipeline | 17.0.4, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/local-volumetric-fog-volume-reference.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/local-volumetric-fog-volume-reference.html)  
[^20]: Field volumeLayerMask | High Definition RP | 15.0.7 - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition%4015.0/api/UnityEngine.Rendering.HighDefinition.HDAdditionalCameraData.volumeLayerMask.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition%4015.0/api/UnityEngine.Rendering.HighDefinition.HDAdditionalCameraData.volumeLayerMask.html)  
[^21]: HDRP Camera | High Definition RP | 14.0.12 - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/HDRP-Camera.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/HDRP-Camera.html)  
[^22]: Unity/URP global volume with volume mask still applies effects to all layers, 2026년 5월 11일 확인, [https://gamedev.stackexchange.com/questions/210918/unity-urp-global-volume-with-volume-mask-still-applies-effects-to-all-layers](https://gamedev.stackexchange.com/questions/210918/unity-urp-global-volume-with-volume-mask-still-applies-effects-to-all-layers)  
[^23]: Apply different post processing effects to separate cameras in URP - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/cameras/apply-different-post-proc-to-cameras.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/cameras/apply-different-post-proc-to-cameras.html)  
[^24]: HDRP - Volume Layer Mask - Unity Discussions, 2026년 5월 11일 확인, [https://discussions.unity.com/t/hdrp-volume-layer-mask/754924](https://discussions.unity.com/t/hdrp-volume-layer-mask/754924)  
[^25]: [HDRP] Easiest way to force an object to render over everything else? : r/Unity3D - Reddit, 2026년 5월 11일 확인, [https://www.reddit.com/r/Unity3D/comments/178uzdg/hdrp\_easiest\_way\_to\_force\_an\_object\_to\_render/](https://www.reddit.com/r/Unity3D/comments/178uzdg/hdrp_easiest_way_to_force_an_object_to_render/)  
[^26]: Struggling to render hands in separate layer (HDRP) any clean setup that actually works? : r/Unity3D - Reddit, 2026년 5월 11일 확인, [https://www.reddit.com/r/Unity3D/comments/1lhpqhv/struggling\_to\_render\_hands\_in\_separate\_layer\_hdrp/](https://www.reddit.com/r/Unity3D/comments/1lhpqhv/struggling_to_render_hands_in_separate_layer_hdrp/)  
[^27]: Understand custom pass volumes | High Definition Render Pipeline | 17.0.4, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Custom-Pass-Volume-Workflow.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Custom-Pass-Volume-Workflow.html)  
[^28]: Unity 6's New Global Illumination Lighting Features, 2026년 5월 11일 확인, [https://unity.com/blog/engine-platform/new-ways-of-applying-global-illumination-in-unity-6](https://unity.com/blog/engine-platform/new-ways-of-applying-global-illumination-in-unity-6)  
[^29]: Fix issues with Adaptive Probe Volumes | High Definition Render Pipeline | 17.0.4, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/probevolumes-fixissues.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/probevolumes-fixissues.html)  
[^30]: Override rendering layer masks in a volume - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/features/rendering-layer-masks-apv-override-probe-in-a-volume.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/features/rendering-layer-masks-apv-override-probe-in-a-volume.html)  
[^31]: How to use Adaptive Probe Volume Rendering Layer Mask - Unity Discussions, 2026년 5월 11일 확인, [https://discussions.unity.com/t/how-to-use-adaptive-probe-volume-rendering-layer-mask/1650216](https://discussions.unity.com/t/how-to-use-adaptive-probe-volume-rendering-layer-mask/1650216)  
[^32]: Override Rendering Layer Mask in Probe Adjustment Volume - Unity Discussions, 2026년 5월 11일 확인, [https://discussions.unity.com/t/override-rendering-layer-mask-in-probe-adjustment-volume/1645954](https://discussions.unity.com/t/override-rendering-layer-mask-in-probe-adjustment-volume/1645954)  
[^33]: Bake different lighting setups with Lighting Scenarios | High Definition RP - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/probevolumes-bakedifferentlightingsetups.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/probevolumes-bakedifferentlightingsetups.html)  
[^34]: Shadows in the High Definition Render Pipeline | High Definition RP | 12.0.0 - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@12.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@12.0/manual/Shadows-in-HDRP.html)  
[^35]: Control shadow resolution and quality | High Definition Render Pipeline - Unity - Manual, 2026년 5월 11일 확인, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Shadows-in-HDRP.html)  
[^36]: Using Unity Layers to Control Lighting on Certain Objects (Layer and Occlusion Solution), 2026년 5월 11일 확인, [https://www.youtube.com/watch?v=1cjKPU\_3A4A](https://www.youtube.com/watch?v=1cjKPU_3A4A)  
[^37]: Prototype\_Final/Library/PackageCache/com.unity.render-pipelines.high-definition@10.8.1/Documentation\~/Shadows-in-HDRP.md · main · PENGXI WANG / EAE6330\_Final · GitLab, 2026년 5월 11일 확인, [https://gapp-git.eng.utah.edu/u1066693/eae6330\_final/-/blob/main/Prototype\_Final/Library/PackageCache/com.unity.render-pipelines.high-definition@10.8.1/Documentation\~/Shadows-in-HDRP.md](https://gapp-git.eng.utah.edu/u1066693/eae6330_final/-/blob/main/Prototype_Final/Library/PackageCache/com.unity.render-pipelines.high-definition@10.8.1/Documentation~/Shadows-in-HDRP.md)  
[^38]: Is there a maximum number of light you can create in a Project? - Unity Engine, 2026년 5월 11일 확인, [https://discussions.unity.com/t/is-there-a-maximum-number-of-light-you-can-create-in-a-project/910450](https://discussions.unity.com/t/is-there-a-maximum-number-of-light-you-can-create-in-a-project/910450)  
[^39]: Limit of number of Lights in view : r/Unity3D - Reddit, 2026년 5월 11일 확인, [https://www.reddit.com/r/Unity3D/comments/sh188j/limit\_of\_number\_of\_lights\_in\_view/](https://www.reddit.com/r/Unity3D/comments/sh188j/limit_of_number_of_lights_in_view/)  
[^40]: Too many layers used to exclude objects from lighting. in deferred only up to 4 layers can be used simultaneously - Unity Discussions, 2026년 5월 11일 확인, [https://discussions.unity.com/t/too-many-layers-used-to-exclude-objects-from-lighting-in-deferred-only-up-to-4-layers-can-be-used-simultaneously/1518892](https://discussions.unity.com/t/too-many-layers-used-to-exclude-objects-from-lighting-in-deferred-only-up-to-4-layers-can-be-used-simultaneously/1518892)
