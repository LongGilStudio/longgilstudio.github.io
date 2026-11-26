---
title: "심층 기술 보고서: GilongWorld 프로젝트 기능 분기 시 발생한 Unity 참조 손실 오류 해결 개발 로그"
date: 2026-06-16 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, guid, serialization, assetdatabase, git]
description: "Unity의 GUID 식별자 시스템과 YAML 직렬화 아키텍처에 대한 심층 분석 및 기능 브랜치 분리 시 발생하는 참조 오류 해결 방안."
lang: ko
translation_id: gilongworld-unity-guid-serialization
---

## **시스템 배경 소개 및 Long Gil Studio의 구조적 위기**

대규모 엔터테인먼트 소프트웨어의 개발 수명 주기에서 새로운 설계 요구사항을 충족하기 위해 시스템 아키텍처를 리팩토링하는 것은 피할 수 없는 과제입니다. Long Gil Studio의 엔지니어링 팀이 Unity 기반으로 개발 중인 **GilongWorld** 프로젝트 역시 시스템 규모를 확장하는 과정에서 심각한 기술적 장벽에 직면했습니다. 핵심 문제는 실무적인 운영 요구사항에서 비롯되었습니다. 개발팀은 게임 내 서로 다른 커스텀 메커니즘(custom)을 지원하기 위해 기존 기능 하나를 완전히 독립적인 두 개의 개발 방향으로 분리해야 했습니다. 이 요구사항에 따라 새로운 기능 브랜치는 기존 기능의 전체 로직 기반, 데이터 구조, 시각적 리소스를 모두 상속받되, 새 브랜치에서 가하는 어떠한 수정도 원본 기능을 망가뜨리는 파급 효과(ripple effect)를 일으키지 않도록 완벽하게 격리되어야 했습니다.

두 기능은 동일한 출발점을 공유했기 때문에 초기 디렉터리 구조에는 C# 스크립트(Script), 프리팹(Prefab), 머티리얼(Material), 텍스처(Texture)부터 애니메이션(Animation) 설정 파일에 이르기까지 물리적으로 완전히 중복된 수많은 파일이 포함되어 있었습니다. Long Gil Studio의 궁극적인 목표는 이 두 에셋 블록을 완전히 분리하는 것이었습니다. 그러나 Unity 에디터 환경에서 일반적인 복제(duplicate) 작업을 수행하자 심각한 참조 단절 현상이 즉시 발생했습니다. 새로 복제된 에셋 블록(Prefab, `ScriptableObject`)의 내부 연결 그래프 전체가 기존 브랜치의 원본 스크립트 파일 및 리소스에 자동으로 강하게 결합되어 버린 것입니다. 이 사고는 데이터 구조의 무결성을 복구하기 위한 길고 지난한 기술적 노력의 서막을 열었습니다. Long Gil Studio가 해결책을 찾아 나선 여정은 단순한 디버깅 과정을 넘어, Unity의 직렬화(serialization) 시스템과 에셋 데이터베이스(`AssetDatabase`)의 본질에 대한 깊이 있는 학습 과정이 되었습니다.

## **Unity의 직렬화(Serialization) 아키텍처와 식별자 해부**

일반적인 폴더 복제 작업이 왜 참조 단절과 중첩 현상을 일으키는지 이해하려면, Unity 엔진의 에셋 관리 아키텍처를 근본적인 수준에서 해부해 볼 필요가 있습니다. 문서를 찾기 위해 물리적 파일 경로(file path)나 파일 이름에 의존하는 운영체제 파일 관리자와 달리, Unity는 물리적 저장 공간의 변화에 영향을 받지 않도록 설계된 내부 데이터베이스 시스템을 운영합니다[^1].

### **YAML 직렬화 언어와 객관적 데이터 구조**

Unity 엔진은 씬(Scene), 프리팹(Prefab), 머티리얼(Material), `ScriptableObject` 등 대부분의 저작 에셋 데이터 상태를 저장하기 위해 YAML(YAML Ain't Markup Language) 사양의 부분집합을 구현한 고성능 직렬화 라이브러리를 사용합니다[^2]. 이러한 아키텍처 결정은 사람이 읽을 수 있는 투명한 텍스트 형식을 제공하여 개발자가 Git과 같은 버전 관리 시스템(Version Control System)을 통해 변경 사항을 쉽게 추적하고, 데이터 충돌을 효율적으로 해결할 수 있도록 하기 위함입니다[^3].

임의의 Prefab 또는 Scene 파일의 소스 코드를 일반 텍스트 편집기로 열어보면, YAML 구조는 객체 선언과 참조 하이퍼링크로 이루어진 복잡한 네트워크를 드러냅니다. YAML 파일 내의 모든 객체는 `!u!{CLASS ID} &{FILE ID}` 형식의 특수 식별자 문자열로 정의됩니다[^2]. 이 두 가지 요소는 Unity의 모든 종속성 그래프를 지탱하는 초석 역할을 합니다.

**Class ID**는 해당 객체가 속한 저수준 클래스(class)를 지정하는 정수(integer) 값으로, Unity 엔진의 C++ 소스 코드에 하드코딩되어 있습니다[^2]. 예를 들어, 숫자 `1`은 `GameObject`를, `4`는 `Transform` 컴포넌트를, `114`는 `MonoBehaviour`(사용자가 정의한 커스텀 C# 스크립트)를 나타냅니다[^2]. 한편, **File ID**(로컬 파일 식별자)는 단일 파일의 제한된 범위 내에서 해당 객체 자체의 식별자를 나타내는 숫자 값입니다[^2]. File ID는 `Transform` 컴포넌트가 부모 `GameObject`를 참조해야 하는 경우처럼, 동일한 파일 내에 존재하는 객체 간의 내부 상호 참조를 해결하는 데 사용됩니다[^2]. 3D 모델 파일(Model files)이나 Unity가 관리하는 내부 에셋의 경우, File ID는 보통 Unity가 파일을 처음 발견하고 분석할 때 생성하여 할당하는 예측 불가능한 거대한 난수입니다[^4]. 라이브러리 바이너리(DLL)에 포함된 C# 소스 파일(`.cs`)의 경우, Unity는 보다 결정론적인(deterministic) 접근 방식을 적용합니다. 시스템은 MD4 암호화 해시 함수를 사용하여 로컬 File ID를 계산합니다. 구체적인 알고리즘은 `"s\0\0\0" + t.Namespace + t.Name` 공식에 따른 문자열의 MD4 해시값에서 처음 4바이트를 추출하여 리틀 엔디언(little-endian) 형식의 32비트 정수를 생성합니다[^4].

아래 표는 Unity 에셋 네트워크를 구성하는 3계층 식별자에 대한 상세한 비교를 제공합니다:

| 식별자 분류 | 기술적 적용 범위 | 생성 출처 및 적용 알고리즘 | 시스템 아키텍처 내 핵심 역할 |
| :--- | :--- | :--- | :--- |
| **Class ID** | 전역 (엔진 내부에 깊이 통합됨) | Unity의 C++ 소스 코드에 정적으로 사전 정의됨. | 네이티브 컴포넌트 유형(`GameObject`, `Transform`, `Camera`, `Collider` 등) 식별[^2]. |
| **File ID** | 로컬 (단일 YAML 파일 내부로 제한됨) | 그래픽 에셋의 경우 난수; C# 스크립트/DLL의 경우 MD4 해시[^4]. | Prefab/Scene 내부의 하위 요소 식별. 내부 객체 그래프 참조 해결[^5]. |
| **GUID** | 전역 (프로젝트 전체에 걸쳐 적용) | 범용 고유 식별자 UUID v4 (하이픈 없는 16진수 32자리 문자열)[^7]. | 물리적 에셋 파일 식별. 프로젝트 내 서로 다른 파일 간의 상호 참조를 해결하는 유일한 열쇠[^1]. |

### **메타데이터(`.meta`) 파일과 전역 식별자 GUID의 중요성**

진정한 복잡성은 시스템이 독립적인 파일들 간의 연결 참조를 처리해야 할 때 나타납니다. 단일 YAML 파일의 범위를 벗어난 객체를 참조할 때, 로컬 File ID는 프로젝트 내 수천 개의 서로 다른 파일 간에 자연스럽게 중복될 수 있으므로 단독으로는 전혀 쓸모가 없게 됩니다[^2]. 무결성이 보장되는 데이터베이스를 구축하기 위해, Unity는 시스템 전체 규모에서 대상 파일 전체를 정확하게 특정할 수 있는 전용 보조 식별자를 필요로 합니다. 이것이 바로 **Global Unique Identifier (GUID)**가 작동하는 영역입니다.

Unity 에디터가 임포트(import), 신규 생성, 또는 복제 과정을 통해 프로젝트에 처음 유입된 새로운 에셋 파일을 감지할 때마다, 시스템은 이에 수반되는 메타데이터 파일을 자동으로 생성합니다. 이 메타데이터 파일은 원본 파일 이름에 `.meta` 확장자를 붙인 이름을 가집니다[^1]. `.meta` 파일은 에셋의 "신분증" 역할을 하며, 임포트 설정 정보(Import Settings)와 가장 중요한 `guid` 속성을 담고 있습니다. 이 속성은 예를 들어 `8c9c1e4a88e724a60a9ac0b0bb6a52c31`과 같이 32자의 16진수(hexadecimal) 문자로 구성된 고유 해시 문자열입니다.

게임 내 한 객체가 다른 에셋을 참조해야 할 때, YAML 직렬화 구문은 특수한 연관 배열 문법인 `{fileID: X, guid: Y, type: Z}`를 통해 두 식별자를 결합합니다[^2]. 이 구조에서 `fileID` 매개변수는 대상 파일 내부에 숨겨진 특정 객체의 위치를 지정하는 데 사용되고, `guid` 매개변수는 대상 에셋의 `.meta` 파일을 직접 가리키는 32자리 문자열을 제공하며, `type` 매개변수는 `AssetDatabase` 시스템이 에셋을 검색하는 방식을 지정합니다[^4]. 일반적으로 `type: 2`는 소스 코드 내부에 있지 않은 외부 참조 에셋에 사용되며, `type: 3`은 주로 내부 소스 스크립트 에셋을 나타냅니다[^4].

바로 이 분리된 저장 메커니즘 덕분에 개발 엔지니어는 프로젝트의 논리적 구조를 깨뜨리지 않고도 운영체제 상에서 파일 이름을 변경하거나 파일을 다른 디렉터리로 자유롭게 이동할 수 있습니다. Unity의 `AssetDatabase` 시스템은 깨지기 쉬운 상대 경로에 의존하는 대신 항상 `.meta` 파일을 조용히 순회하며 GUID 조회 테이블을 유지합니다[^1]. 그러나 이러한 GUID에 대한 절대적 의존성이 바로 Long Gil Studio가 겪은 난제의 근원이기도 했습니다.

## **문제 해결 연대기: 해결책을 찾아 나선 Long Gil Studio의 여정**

단일 기능 블록을 두 개의 독립적인 개체로 분리하는 작업은 처음에는 단순한 파일 관리 작업처럼 보였습니다. 그러나 Long Gil Studio 개발팀이 실제로 착수하자마자, Unity 내 그래프 데이터의 무결성과 관련된 복잡한 문제의 늪에 빠르게 빠져들었습니다. 이 여정은 가장 직관적인 방법부터 심층적인 시스템 프로그래밍 솔루션에 이르기까지 일련의 시행착오의 연속으로 기록되었습니다.

### **1단계: 파일 이름 변경(Renaming)과 직접 복제의 무력함**

엔지니어 팀의 첫 번째 직관적인 대응은 Unity 에디터 인터페이스를 통해 `Feature_A` 폴더를 `Feature_B` 폴더로 직접 복제(duplicate)하는 것이었습니다. 목적은 분리된 물리적 데이터 블록을 만드는 것이었습니다. 그러나 즉시 "기존 소스로 향하는 역참조(cross-reference back to the old source)" 현상이 나타났습니다[^10].

에디터 내부에서 복제할 때 Unity는 동일한 프로젝트 내에서 두 에셋이 같은 GUID를 공유할 수 없다는 점을 인지합니다. 시스템은 `Feature_B` 폴더 내의 모든 파일에 대해 완전히 새로운 임의의 GUID가 포함된 새 `.meta` 파일을 생성하여 자동으로 개입합니다[^1]. 이는 데이터베이스의 유효성을 보장하지만 논리적 재앙을 초래합니다. 방금 복제된 Prefab이나 `ScriptableObject` 파일 내부의 텍스트(YAML) 내용을 Unity가 전혀 재컴파일하거나 수정하지 않기 때문입니다. 즉, `Feature_B/UI_Window.prefab` 파일 안에서 소스 코드 스크립트에 대한 참조를 저장하는 YAML 구문은 여전히 `{fileID: 11500000, guid: [GUID_OF_OLD_FILE_IN_FEATURE_A]}` 상태로 정적으로 고정되어 있습니다[^10].

그 결과 새 폴더가 생성되었음에도 불구하고 새로운 개발 브랜치 내부의 모든 UI 컴포넌트, Prefab 및 변수는 기존 브랜치의 `.cs` 스크립트 파일과 물리적으로 연결된 상태를 유지하게 됩니다. 인스펙터(Inspector) 인터페이스를 통해 새 Prefab의 파라미터를 변경하면 구형 제어 클래스의 로직을 역으로 덮어쓸 위험이 발생하여 심각한 회귀 위험(regression risk)을 초래합니다. Long Gil Studio 팀은 새 폴더 내의 소스 코드 파일과 에셋 파일의 이름을 변경하여 이 문제를 해결하려 시도했습니다. 하지만 이름 변경 작업은 사용자 인터페이스에 표시되는 문자열과 디스크 상의 물리적 파일명만 바꿀 뿐, `.meta` 파일 내부의 GUID 해시값이나 YAML 설정 파일의 참조 문자열에는 전혀 영향을 미치지 못합니다[^5]. Unity의 데이터베이스는 파일 이름에 무관심하기 때문에, 이름 변경 방식은 연결 분리에 아무런 효과가 없어 즉시 폐기되었습니다.

### **2단계: 신규 생성 및 수동 재연결(Manual Re-linking)의 위기**

이름 변경이 실패한 후, 팀은 모든 파일을 새로 생성하고 전체 연결 그래프를 수동으로 다시 할당하는 더 비용이 큰 수동 방식으로 방향을 선회했습니다. 프로그래머는 새로 만든 각각의 Prefab이나 `ScriptableObject` 파일을 일일이 열어 연결 오류가 발생했거나 구 브랜치를 가리키는 컴포넌트를 삭제하고, 새 컴포넌트를 추가한 뒤, 모든 이미지와 오디오 리소스를 인스펙터 패널의 올바른 참조 슬롯에 일일이 드래그 앤 드롭해야 했습니다.

소규모 프로토타입 프로젝트라면 이 접근 방식이 용인될 수 있습니다. 그러나 중첩 프리팹(Nested Prefabs) 아키텍처를 통해 수십에서 수백 개의 파일이 서로 얽혀 있는 GilongWorld 프로젝트의 복잡한 기능에서는 종속성 그래프(dependency graph)가 사람의 힘으로는 관리할 수 없을 만큼 방대해졌습니다. UI 화면, `ScriptableObject` 설정 객체, 그리고 애니메이션 컨트롤러(Animation Controller) 간의 수천 개에 달하는 상호 참조를 다시 연결하는 작업은 수주의 개발 기간을 소모했습니다.

이 방식의 가장 큰 폐해는 인적 오류(human error) 요소였습니다[^1]. 엔지니어들은 끊임없이 연결 중첩, 참조 누락, 혹은 이름은 동일하지만 작업 공간(네임스페이스)이 다른 스크립트를 잘못 할당하는 상황에 직면했습니다. 수천 줄의 속성 사이에 단 하나의 참조만 누락되어도 정적 컴파일 테스트는 통과할 수 있지만, 프로젝트가 빌드되어 런타임(Runtime) 모드로 실행될 때 치명적인 `NullReferenceException` 시스템 오류를 유발합니다. 시간적 소진과 제품 품질 저하는 결국 Long Gil Studio가 더 깊은 계층의 자동화 방식을 모색하도록 내몰았습니다.

### **3단계: 운영체제 수준 복제(OS-Level Cloning)의 간섭 사고**

또 다른 의견으로는 Unity 에디터에서 복제하는 대신 운영체제의 파일 관리자(Windows Explorer 또는 macOS Finder)를 통해 폴더를 복사하는 방안이 제안되었습니다. 물리적 복제본을 만들어 Unity를 "속이는" 것이 목적이었습니다. 외부에서 복사를 수행하면 콘텐츠 파일과 GUID가 담긴 `.meta` 파일이 모두 똑같이 복제됩니다[^3].

그러나 Unity 에디터로 돌아오자 **GUID 충돌(GUID collision)**이라 불리는 새로운 문제가 발생했습니다. `AssetDatabase` 시스템이 동일한 GUID를 공유하는 두 파일이 병렬로 존재하는 것을 감지한 것입니다. Unity의 내부 충돌 처리 프로세스는 보통 두 가지 결과 중 하나로 이어집니다. 시스템이 두 파일 중 하나의 로드를 거부하거나, Unity가 사용자에게 어떠한 알림도 없이 한 파일의 GUID를 임의의 새 문자열로 조용히 덮어써 버리며, 특히 YAML 참조는 전혀 업데이트하지 않는 것입니다[^9]. 현장 보고에 따르면 동일한 공유 구조를 기반으로 한 여러 프로젝트에 직면했을 때, Unity는 파일 이름이 다르더라도 동일한 GUID를 가진 에셋 간의 차이를 구별하지 못해 참조를 잘못된 에셋에 무분별하게 연결해 버립니다[^1]. 이 방법은 수동으로 연결을 다시 할당하는 것보다 훨씬 더 큰 위험을 동반했습니다.

## **기술적 돌파구: 참조 손실 없는 GUID 재생성 솔루션**

일반적인 작업 방식의 막다른 골목에 다다른 Long Gil Studio는 핵심 과제가 물리적 파일의 복제가 아니라 데이터의 동기화된 연산에 있음을 깨달았습니다. 팀에는 새 폴더의 전체 YAML 파일 네트워크에 걸쳐 GUID 식별자 문자열을 일관되게 일괄 업데이트할 수 있는 방법이 필요했습니다. Unity 엔지니어 커뮤니티의 오픈소스 도구들을 연구하고 탐색한 끝에, 팀은 로컬 **GUID 재생성(GUID Regeneration)** 기법을 찾아내어 성공적으로 적용했습니다[^1].

이 기법은 프로젝트의 원본 텍스트 구조에 직접 개입하는 방식입니다. Unity 에디터가 기본 알고리즘에 따라 수동적으로 복제를 처리하도록 두는 대신, 커스텀 C# 에디터 스크립트(Editor Script) 도구를 통해 시스템을 스캔하고 처리합니다. 이 도구는 새 기능 브랜치 폴더 내의 모든 `.meta` 파일을 읽고, 완전히 새로운 GUID 세트를 생성하며, 이전 GUID와 새 GUID 간의 메모리 매핑 테이블(mapping table)을 구축한 뒤, 설정 파일들의 전체 텍스트 내용을 순회하며 해당 문자열들을 정확하게 치환합니다.

### **Long Gil Studio의 GUID 재생성 알고리즘 심층 분석**

검증된 오픈소스 알고리즘 기반(jeffjadulco, ZimM-LostPolygon, rrazgriz 등의 스크립트[^1])을 바탕으로, 엔지니어링 팀은 정교한 데이터 처리 단계를 포함하는 엄격한 실행 파이프라인을 구축했습니다.

#### **1단계: 에셋 편집 상태(Asset Editing State) 초기화**

순식간에 수천 개의 텍스트 파일을 수정하면 Unity의 자동 재컴파일(auto-refresh) 메커니즘이 작동하여 시스템이 멈추거나 메모리 부족 현상이 발생할 수 있습니다. 따라서 알고리즘은 `AssetDatabase.StartAssetEditing()` API 메서드를 호출하여 Unity의 파일 시스템 감시 프로세스를 일시 중단하는 것으로 시작합니다[^7]. 이 작업은 `AssetDatabase`를 일시적인 대기 상태로 전환하여 디스크 상에서 대량의 I/O 명령을 방해 없이 수행할 수 있게 합니다. 동시에 `*.meta`, `*.mat`, `*.anim`, `*.prefab`, `*.unity`, `*.asset`, `*.guiskin`, `*.fontsettings`, `*.controller` 등을 포함하여 분석할 형식을 규정하는 유효한 파일 확장자 필터(`kDefaultFileExtensions`)가 설정됩니다[^7].

#### **2단계: 재귀적 스캔 및 대상 GUID 집합 추출**

시스템은 프로젝트 창에서 사용자가 선택한 영역의 GUID 목록(`Selection.assetGUIDs`)을 수집하여 영향 범위를 결정합니다. 알고리즘은 모든 하위 디렉터리를 재귀적으로 순회하며 `AssetDatabase.AssetPathToGUID(file)` 함수를 통해 파일 경로를 물리적 GUID로 역매핑합니다. 이 단계의 정교한 점은 알고리즘이 직접 선택 목록에서 시작 `.meta` 파일을 의도적으로 제외(`Path.GetExtension(...) != ".meta"`)하여, `guidsToRegenerate` 목록에 원본 콘텐츠 에셋만 포함되도록 구성한다는 것입니다[^8].

#### **3단계: 구문 분석 및 연결 그래프 식별**

가장 많은 연산 자원을 소모하는 단계는 전체 텍스트 구조를 선형으로 스캔하는 과정입니다. 목록의 각 파일에 대해 시스템은 `File.ReadAllText(filePath)` 메서드를 사용하여 전체 문자열을 열고 읽습니다[^7]. 구문 분석(parsing) 기법은 대용량 YAML 블록에서의 성능 저하 때문에 정규 표현식(Regex)을 사용하지 않습니다. 대신 알고리즘은 6글자 길이의 상수 문자열 `"guid: "`를 순차적으로 검색합니다[^7].

참조 패턴이 발견되면 알고리즘은 바로 뒤에 이어지는 정확히 32개의 문자를 추출합니다. 그 직후 보안 검증 계층인 `IsGuid(string text)`가 활성화됩니다. 이 계층은 루프를 실행하여 해당 32자 문자열이 16진수 규칙(`'0'`~`'9'` 및 `'a'`~`'f'` 범위)을 준수하는지 확인합니다[^7]. 이 엄격한 검증을 통해 알고리즘이 C# 소스 코드 내의 임의 문자열이나 우연히 동일한 32자 길이를 가진 그래픽 시스템의 암호화 해시 데이터를 실수로 덮어쓰는 가능성을 배제합니다.

#### **4단계: 이중 매핑 사전(Dual Mapping Dictionary) 구축**

덮어쓰기 과정이 Unity의 핵심 에셋을 손상시키지 않도록 보장하기 위해, 시스템은 RAM 메모리에 세 가지 중요한 데이터 구조를 생성합니다[^7]:

1. **`ownGuids` 집합 (내부 에셋)**: 알고리즘은 모든 `.meta` 파일 내에 위치한 첫 번째 GUID 코드를 식별하여 `HashSet` 구조에 저장합니다. Unity의 기본 원칙상 `.meta` 파일의 첫 번째 GUID는 항상 해당 에셋 자신을 나타냅니다. 이 집합은 방화벽 역할을 하여 시스템이 현재 처리 중인 폴더 내부의 에셋과 외부 에셋(예: Unity 엔진의 기본 머티리얼 `Standard.mat`)을 구분할 수 있게 합니다[^7].
2. **`guidOldToNewMap` 사전 (치환 문자열 매핑)**: 발견된 각각의 고유한 이전 GUID에 대해 시스템은 표준 라이브러리 메서드 `Guid.NewGuid().ToString("N")`을 통해 완전히 새로운 UUID 문자열을 생성합니다[^7]. UUID 버전 4(v4) 생성 알고리즘은 하이픈이 포함되지 않은 문자열을 생성하며 충돌 확률(collision probability)이 0에 수렴하므로 데이터 측면에서 절대적인 안전성을 보장합니다.
3. **`guidsInFileMap` 사전 (할당 맵)**: 파일 경로(File Path)를 해당 파일 내부에서 호출되고 있는 이전 GUID 배열로 매핑하는 사전입니다. 이 구조는 시스템에 어떤 파일을 열고 어떤 문자열을 교체해야 하는지 직접 지시함으로써 덮어쓰기 단계를 최적화합니다.

#### **5단계: 동기화 덮어쓰기 및 상태 복원**

마지막 루프에서 시스템은 `guidsInFileMap`에 지정된 각 파일을 엽니다. 이때 이중 교차 검증 조건이 적용됩니다. 검토 중인 이전 GUID는 반드시 내부 에셋 집합(`ownGuids`)에 존재해야 **하며**, 동시에 사용자가 재생성을 요청한 에셋 목록(`guidsToRegenerate`)에도 포함되어 있어야 합니다[^8]. 이 보안 규칙은 솔루션의 중추로서, Engine 에셋이나 의도치 않은 공용 라이브러리의 식별자를 실수로 교체하는 현상을 원천적으로 차단합니다.

검증을 통과하면 `contents = contents.Replace("guid: " + oldGuid, "guid: " + newGuid)` 문자열 치환 명령이 실행됩니다[^7]. 시스템은 `File.WriteAllText`를 사용하여 새 텍스트 문자열을 디스크에 저장합니다. 모든 파일의 처리가 완료되면 `AssetDatabase.StopAssetEditing()` 플래그를 호출하여 Unity의 감시 시스템을 깨우고, 이어서 `AssetDatabase.Refresh()` 함수를 호출하여 완전히 새로운 GUID 구조로 전체 프로젝트를 재컴파일합니다[^7].

이 알고리즘을 통해 Long Gil Studio가 달성한 성과는 파일 수준에서 절대적인 독립성을 갖춘 기능 시스템의 완전한 복제 능력입니다. 엔지니어는 "Branch A"에 어떠한 파장도 일으키지 않으면서 "Branch B"에서 Prefab을 수정하고, 소스 코드를 변경하며, 파라미터를 재구성할 수 있습니다. 이제 Branch B의 상호 연결 네트워크는 완전히 격리된 새로운 식별자 세트를 통해 내부 통신을 유지하며, 어떠한 기술적 오류도 남기지 않고 초기 브랜치 분리 과제를 완벽하게 해결했습니다.

## **Unity 생태계 내 대안 솔루션에 대한 종합 평가**

커스텀 코드를 통한 GUID 재생성 솔루션이 Long Gil Studio의 심층 커스터마이징 요구사항을 완벽하게 해결했지만, Unity 생태계는 중복 관리와 기능 분기를 목표로 하는 다양한 설계 아키텍처를 여전히 제공합니다. 시스템 아키텍처에 대한 전반적인 시각을 확보하기 위해, 본 연구에서는 대규모 분기 요구사항에 대한 호환성과 한계를 평가하고자 다음과 같은 대안들을 분석했습니다.

### **5.1 상속 기반 솔루션: 프리팹 배리언트(Prefab Variants) 구조**

Unity 2018.3 버전에 도입된 **Prefab Variants** 기능은 기존 Prefab 시스템을 대체하여 객체 구조를 관리하는 데 있어 큰 진전을 이루었습니다[^17]. Prefab Variant의 핵심 메커니즘은 완전히 새로운 복사본을 만드는 것이 아니라, 원본 프리팹(Base Prefab)에 직접 연결된 오버라이드 계층(override layer) 역할을 한다는 점입니다[^17].

Variant를 사용할 때 프로그래머는 속성, 머티리얼 구성을 변경하거나 컴포넌트(기능 요소)를 추가·제거할 수 있으며, 이러한 변경 사항은 Variant 파일에 "오버라이드 메타데이터(override metadata)" 형태로만 저장됩니다[^20]. 동시에 Base Prefab의 핵심 속성이 업데이트되면, 해당 속성을 오버라이드하지 않은 모든 하위 Variant로 변경 사항이 자동으로 전파(propagate)됩니다[^22].

아래 비교 분석 표는 기능 분기 문제에 있어 이 두 아키텍처 철학의 차이점을 명확히 보여줍니다:

| 평가 기준 | GUID 재생성 방식 (심층 분기 - Deep Fork) | Prefab Variants 방식 (상대적 상속) |
| :--- | :--- | :--- |
| **저장 방식의 본질** | YAML 파일 수준에서 완전히 독립된 데이터 복사본. | 원본을 기반으로 한 차이 데이터(delta overrides) 저장[^17]. |
| **의존성 수준** | 0 수준 (원본과의 구조적 연결이 전혀 남지 않음). | 높음 (Base Prefab의 노드 구조에 종속됨)[^18]. |
| **소스 코드(Scripts) 분리** | 두 개의 독립적인 소스 코드 세트로 분기 및 재작성 가능. | 지원하지 않음; Variant는 Base와 동일한 스크립트 세트에서 실행되어야 함. |
| **구조 변경 가능성** | 전체 계층 구조(Hierarchy)를 자유롭게 삭제, 추가 또는 재구성 가능. | 제한적임. Base Prefab에 의해 정의된 핵심 GameObject는 삭제할 수 없음[^22]. |
| **시스템 회귀 위험** | 절대적 격리로 인해 거의 없음. | 높음. 원본 수정이나 조정이 의도치 않게 Variant 브랜치의 기능을 변형시킬 수 있음[^18]. |

**GilongWorld 프로젝트에 대한 결론**: Prefab Variant는 게임플레이 변형(예: 체력만 다른 파란색 적을 빨간색 적으로부터 파생시켜 생성하는 경우)을 만드는 데는 뛰어나지만[^20], "개별 커스터마이징(customization)"을 위한 분기 요구사항 앞에서는 완전히 무용지물입니다. Long Gil Studio의 프로젝트는 C# 스크립트 파일 자체의 분리를 필요로 했으나, Variant 아키텍처는 공개(public) 변수만 오버라이드할 뿐 컴포넌트를 새로운 로직 처리기로 가리키게 할 수 없기 때문에 이를 지원할 수 없습니다[^18]. 그래프 노드 간의 강한 결합성은 Prefab Variant를 이번 과제가 요구한 독립적 모듈 설계 철학에 역행하는 방식으로 만들었습니다.

### **5.2 독립 패키지 아키텍처: Unity Package Manager (UPM) 및 Local Packages**

참조 충돌을 최소화하기 위한 보다 거시적인 접근 방식은 **Unity Package Manager (UPM)**를 활용하여 멀티 패키지 아키텍처를 구축하는 것입니다[^25]. 이 아키텍처 모델은 컴포넌트나 기능을 `package.json` 파일을 통해 구성되고 어셈블리 정의(`.asmdef`) 파일을 통해 컴파일이 관리되는 개별 개발 패키지(development packages)로 전환합니다[^26].

분기 상황에서는 공유 시스템을 Core Package로 구성하고, Feature A와 Feature B가 공용 API를 소비하는 독립 패키지로 작동하도록 할 수 있습니다. Unity는 시스템 심볼릭 링크(symlink)를 통한 **로컬 패키지(Local Package)** 임베딩을 지원하므로, 소스 코드 폴더가 메인 프로젝트의 `Assets` 폴더와 완전히 분리된 별도의 Git 저장소 형태로 디스크에 존재할 수 있습니다[^27]. UPM을 통해 구성할 경우, GUID 중복이나 로컬 환경 충돌은 기존의 `AssetDatabase`에만 의존하는 대신 Unity의 패키지 관리자에 의해 처리됩니다[^28].

그러나 이 아키텍처를 도입하려면 막대한 분석 및 리팩토링(refactoring) 시간이 필요합니다. 이는 C# 소스 코드와 정적 라이브러리를 격리하는 데는 완벽하게 작동하지만, YAML 파일에 크게 의존하는 대량의 Prefab과 UI 레이아웃을 복제하는 문제를 해결하는 데는 효율이 떨어집니다. 따라서 Long Gil Studio와 같이 즉각적인 분리가 필요한 실무 요구사항에 대해 이 솔루션은 당장의 결과에 비해 지나치게 큰 운영 오버헤드(overhead)를 수반합니다.

### **5.3 메모리 비대화 위험: Addressables 시스템과 공용 파일**

GUID 시스템에 깊이 개입하는 모든 작업은 특히 프로젝트에 **Addressable Asset System**이 통합되어 있을 때, 시스템 엔지니어가 동적 메모리 관리 및 에셋 배포 메커니즘에 미치는 영향을 평가하도록 요구합니다. Addressables는 동적 주소를 통한 비동기 로드(load) 메커니즘을 사용하여 하드 참조를 제거하는 차세대 리소스 관리 프레임워크 역할을 합니다[^30].

GUID 재생성 기법을 사용할 때 보고된 한 가지 아키텍처 위험이 있습니다. 재생성 과정이 거대한 기능 블록을 두 개의 별개 블록으로 분리하면, 해당 폴더 구조 내에 연결된 모든 리소스(고해상도 텍스처나 오디오 파일 등) 역시 새로운 GUID를 할당받게 됩니다[^30]. 운영체제 관점에서 이 두 텍스처 파일은 동일한 이미지를 담고 있지만, Addressables의 패키징 시스템(packing system)은 서로 다른 식별자를 가진 완전히 독립적인 두 데이터 개체로 평가합니다[^13].

Content Build 컴파일 프로세스가 트리거되면 Unity는 첫 번째 복사본을 Feature A의 AssetBundle로 압축하고, 두 번째 복사본을 Feature B의 AssetBundle로 압축합니다. 이러한 중복은 **메모리 비대화(memory bloat)** 현상을 유발하여 게임 다운로드 용량을 늘리고 애플리케이션 실행 시(runtime) 막대한 양의 RAM 메모리를 낭비하게 만듭니다[^13]. 이 위험을 해결하기 위해 아키텍트 팀은 별도의 **"공용(Shared Resources)"** 저장 영역을 구축해야 합니다. GUID 재생성 명령을 실행하기 전에, 프로그래밍 로직 성격이 없는 모든 시각적 리소스는 처리 대상 영역 밖으로 이동시켜야 합니다. 이러한 이미지 에셋들의 `.meta` 파일은 원본 그대로 보호되어야 하며, 그래야 복제 과정 이후에도 신규 및 기존 설정 브랜치가 모두 동일한 단일 공용 머티리얼 GUID를 참조하여 시스템 리소스 관리의 경제성을 보장할 수 있습니다.

## **GilongWorld 프로젝트의 권고 사항 및 교훈**

Long Gil Studio에서 발생한 참조 단절 문제를 해결한 것은 단순히 최적의 스크립트 하나를 찾아낸 것에 그치지 않고, Unity 엔진의 사용자 인터페이스 아래에 숨겨진 하위 프로토콜 계층을 이해하는 것이 얼마나 중요한지를 입증한 사례입니다. YAML 형식의 데이터 연결 네트워크는 모든 객체 상호작용의 기반이며, GUID 메타데이터는 이 네트워크를 유지하는 유일한 언어입니다[^1].

새로운 식별자 구조를 생성하는 직접 개입 방식(**GUID Regeneration**)은 `AssetDatabase`와 같은 객체 지향 데이터베이스 위에 운영체제의 파일 관리 구조를 그대로 사용하려던 잘못된 통념을 타파했습니다[^1]. 텍스트 구문 분석, 식별자 추출, 메모리 영역 제어, 내부 덮어쓰기로 이어지는 5단계 알고리즘 프로세스는 절대적인 정확도를 보장하여 개발자들을 골치 아프게 하던 논리 그래프 단절 사고를 미연에 방지했습니다.

이 사건 분석 과정을 바탕으로, 대규모 게임 소프트웨어 아키텍처 설계자는 복잡한 복제 및 분기 작업을 수행할 때 항상 표준화된 작업 절차를 유지해야 합니다. 디스크 상의 광범위한 조작 명령을 내리기 전에 버전 관리 백업(version control backup) 시스템을 구축하는 것은 돌이킬 수 없는 데이터 손실을 방지하기 위한 최우선 규칙입니다[^7]. 동시에 개발자는 네임스페이스 이름 변경(namespace renaming) 과정으로 인해 C# 소스 파일(`.cs`) 내부의 `FileID`가 의도치 않게 변경되지 않도록 주의해야 합니다. 이는 표시 설정과 실행 스크립트 간의 저수준 연결을 직접적으로 파괴하기 때문입니다[^4].

GUID 재생성 방식을 성공적으로 찾아 적용한 Long Gil Studio의 성과는 GilongWorld 프로젝트의 자원을 수천 시간의 수동 설정 작업에서 해방시켰을 뿐만 아니라, 향후 시스템이 핵심 구조의 안정성을 희생하지 않고도 설계 분기 요구사항에 신속하게 대응하며 유연하게 커스터마이징할 수 있는 견고한 기술적 토대를 마련했습니다.

---

## **참고문헌**

[^1]: GUID Regenerator (com.jeffjadulco.guidregenerator) | OpenUPM Unity Package, [https://openupm.com/packages/com.jeffjadulco.guidregenerator/](https://openupm.com/packages/com.jeffjadulco.guidregenerator/)  
[^2]: Understanding Unity's serialization language, YAML, [https://unity.com/blog/engine-platform/understanding-unitys-serialization-language-yaml](https://unity.com/blog/engine-platform/understanding-unitys-serialization-language-yaml)  
[^3]: How to move or copy a Unity project (without breaking it) - Game Dev Beginner, [https://gamedevbeginner.com/how-to-move-or-copy-a-unity-project-without-breaking-it/](https://gamedevbeginner.com/how-to-move-or-copy-a-unity-project-without-breaking-it/)  
[^4]: Unity fileID and GUID - Unity Discussions, [https://discussions.unity.com/t/unity-fileid-and-guid/837621](https://discussions.unity.com/t/unity-fileid-and-guid/837621)  
[^5]: Question about m_Script in YAML Unity prefab format, [https://discussions.unity.com/t/question-about-m_script-in-yaml-unity-prefab-format/469197](https://discussions.unity.com/t/question-about-m_script-in-yaml-unity-prefab-format/469197)  
[^6]: YAML fileID hash function for DLL scripts - Unity Discussions, [https://discussions.unity.com/t/yaml-fileid-hash-function-for-dll-scripts/541112](https://discussions.unity.com/t/yaml-fileid-hash-function-for-dll-scripts/541112)  
[^7]: Unity asset GUIDs regenerator - GitHub Gist, [https://gist.github.com/ZimM-LostPolygon/7e2f8a3e5a1be183ac19](https://gist.github.com/ZimM-LostPolygon/7e2f8a3e5a1be183ac19)  
[^8]: Generate new GUIDs for Unity editor assets in-place. Tested working on 2019.4.31f1. Use at your peril - GitHub Gist, [https://gist.github.com/rrazgriz/1a5ab38f47a473c3272e1207bab6073f](https://gist.github.com/rrazgriz/1a5ab38f47a473c3272e1207bab6073f)  
[^9]: What is Unity GUID — How to Get & Change GUID — 2026 - Makaka Games, [https://makaka.org/unity-tutorials/guid](https://makaka.org/unity-tutorials/guid)  
[^10]: How can you duplicat folders and not share old dependencies? : r/Unity3D - Reddit, [https://www.reddit.com/r/Unity3D/comments/2jn4wk/how_can_you_duplicat_folders_and_not_share_old/](https://www.reddit.com/r/Unity3D/comments/2jn4wk/how_can_you_duplicat_folders_and_not_share_old/)  
[^11]: How can you duplicat folders and not share old dependencies? - Unity Discussions, [https://discussions.unity.com/t/how-can-you-duplicat-folders-and-not-share-old-dependencies/119815](https://discussions.unity.com/t/how-can-you-duplicat-folders-and-not-share-old-dependencies/119815)  
[^12]: jeffjadulco/unity-guid-regenerator: :id - GitHub, [https://github.com/jeffjadulco/unity-guid-regenerator](https://github.com/jeffjadulco/unity-guid-regenerator)  
[^13]: Resources folder and asset loading etiquette - Unity Discussions, [https://discussions.unity.com/t/resources-folder-and-asset-loading-etiquette/593210](https://discussions.unity.com/t/resources-folder-and-asset-loading-etiquette/593210)  
[^14]: How to make references point to the imported asset with new GUID? - Unity Discussions, [https://discussions.unity.com/t/how-to-make-references-point-to-the-imported-asset-with-new-guid/840444](https://discussions.unity.com/t/how-to-make-references-point-to-the-imported-asset-with-new-guid/840444)  
[^15]: I made a tool to regenerate GUID for Unity assets : r/Unity3D, [https://www.reddit.com/r/Unity3D/comments/gex8q5/i_made_a_tool_to_regenerate_guid_for_unity_assets/](https://www.reddit.com/r/Unity3D/comments/gex8q5/i_made_a_tool_to_regenerate_guid_for_unity_assets/)  
[^16]: Sudden "Assembly has duplicate references" on ALL imported assets - Unity Discussions, [https://discussions.unity.com/t/sudden-assembly-has-duplicate-references-on-all-imported-assets/1710510](https://discussions.unity.com/t/sudden-assembly-has-duplicate-references-on-all-imported-assets/1710510)  
[^17]: Create variations of prefabs - Unity - Manual, [https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabVariants.html](https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabVariants.html)  
[^18]: What is the difference between prefab(original) and variant prefab? - Stack Overflow, [https://stackoverflow.com/questions/58299669/what-is-the-difference-between-prefaboriginal-and-variant-prefab](https://stackoverflow.com/questions/58299669/what-is-the-difference-between-prefaboriginal-and-variant-prefab)  
[^19]: Ultimate Guide on Nested Prefab Workflows in Unity | Visual Design Cafe, [https://visualdesigncafe.com/learn/nested-prefabs](https://visualdesigncafe.com/learn/nested-prefabs)  
[^20]: Can someone explain the use case for Prefab variants - Unity Engine, [https://discussions.unity.com/t/can-someone-explain-the-use-case-for-prefab-variants/715072](https://discussions.unity.com/t/can-someone-explain-the-use-case-for-prefab-variants/715072)  
[^21]: Override prefab instances - Unity - Manual, [https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabInstanceOverrides.html](https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabInstanceOverrides.html)  
[^22]: Unity Tips | Part 6 - Prefabs - Daniel Ilett, [https://danielilett.com/2020-05-16-unity-tips-6-prefabs/](https://danielilett.com/2020-05-16-unity-tips-6-prefabs/)  
[^23]: What's the incentive on using prefab variants compared to just duplicating the original prefab? : r/Unity3D - Reddit, [https://www.reddit.com/r/Unity3D/comments/p2g10m/whats_the_incentive_on_using_prefab_variants/](https://www.reddit.com/r/Unity3D/comments/p2g10m/whats_the_incentive_on_using_prefab_variants/)  
[^24]: Is it better to make multiple prefabs or a single configurable prefab? : r/unity - Reddit, [https://www.reddit.com/r/unity/comments/1iu88js/is_it_better_to_make_multiple_prefabs_or_a_single/](https://www.reddit.com/r/unity/comments/1iu88js/is_it_better_to_make_multiple_prefabs_or_a_single/)  
[^25]: Package Development | 0.5.3-exp.1 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.upm.develop@0.5/manual/index.html](https://docs.unity3d.com/Packages/com.unity.upm.develop@0.5/manual/index.html)  
[^26]: Package development workflow - Unity - Manual, [https://docs.unity3d.com/6000.4/Documentation/Manual/CustomPackages.html](https://docs.unity3d.com/6000.4/Documentation/Manual/CustomPackages.html)  
[^27]: Switching between Local and Remote packages in Unity - Jakub Slaby, [https://www.jakubslaby.com/switching-between-local-and-remote-packages-in-unity/](https://www.jakubslaby.com/switching-between-local-and-remote-packages-in-unity/)  
[^28]: Confusion About How to Create a Custom Package - Unity Discussions, [https://discussions.unity.com/t/confusion-about-how-to-create-a-custom-package/739817](https://discussions.unity.com/t/confusion-about-how-to-create-a-custom-package/739817)  
[^29]: Best practices for parallel application + package development workflow - Unity Discussions, [https://discussions.unity.com/t/best-practices-for-parallel-application-package-development-workflow/900302](https://discussions.unity.com/t/best-practices-for-parallel-application-package-development-workflow/900302)  
[^30]: Asset dependencies overview | Addressables | 2.2.2 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@2.2//manual/AssetDependencies.html](https://docs.unity3d.com/Packages/com.unity.addressables@2.2//manual/AssetDependencies.html)  
[^31]: How to handle Addressable duplication for hybrid Scene Objects/Asset reference patterns, [https://discussions.unity.com/t/how-to-handle-addressable-duplication-for-hybrid-scene-objects-asset-reference-patterns/1704264](https://discussions.unity.com/t/how-to-handle-addressable-duplication-for-hybrid-scene-objects-asset-reference-patterns/1704264)
