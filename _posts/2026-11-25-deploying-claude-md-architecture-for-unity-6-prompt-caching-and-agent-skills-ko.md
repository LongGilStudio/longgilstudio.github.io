---
title: "Unity 6용 CLAUDE.md 아키텍처 구축 전략 계획: Prompt Caching 최적화, 자동화 스킬 통합 및 6.7 LTS 업데이트 로드맵"
date: 2026-11-25 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, claude-code, ai-agents, prompt-caching, coreclr, render-graph, awaitable, gilongworld]
description: Unity 6(6000.5에서 6.7 LTS까지) 프로젝트를 위한 계층형 CLAUDE.md 아키텍처 설계 전략으로, Prompt Caching을 통한 90% 비용 절감, Agent Skills 통합, Awaitable 비동기 규칙을 다룹니다.
lang: ko
translation_id: unity6-claude-md-prompt-caching-skills
---

소프트웨어 개발에서의 생성형 AI와 실시간 그래픽스 엔진 간의 융합은 비디오 게임 및 인터랙티브 애플리케이션 산업의 전체 제작 방식을 재편하고 있습니다. 이러한 생태계 속에서 Claude Code는 정교한 계층형 컨텍스트 관리 아키텍처를 기반으로 동작하는 대표적인 커맨드라인 코딩 에이전트로 자리매김했습니다. 이 행동 지침 시스템의 중심에는 AI 에이전트가 항상 조직의 표준 규범 내에서 작동하도록 보장하는 프로젝트 메타데이터 저장소인 `CLAUDE.md` 설정 파일이 있습니다[^1]. 동시에 Unity 플랫폼은 Unity 6 릴리스 라인업과 함께 세대교체의 전환점을 맞이하고 있습니다. 현행 `6000.5` 버전은 단순한 기능 업데이트가 아니라 레거시 시스템의 종료를 알리고 2027년 초 출시 예정인 장기 지원(Long-Term Support) 버전 Unity 6.7 LTS의 토대를 다지는 대대적인 코어 재구축입니다[^2].

Unity 6의 지속적인 변화에 적응하는 `CLAUDE.md` 구조를 설계하려면 세 가지 복합적인 기술 축을 결합해야 합니다. 첫째, 장시간 작업 세션 동안 기술적 맥락을 잃지 않으면서 연산 자원(토큰) 비용을 획기적으로 절감하기 위해 Anthropic의 Prompt Caching 시스템을 제어하고 최적화하는 것입니다[^3]. 둘째, `Unity-Technologies/skills` 저장소를 통해 에이전트 스킬(Agent Skills) 생태계를 통합함으로써 정적 메모리를 비대화하지 않고도 Unity 커맨드라인 인터페이스와의 자동화 상호작용 역량을 극대화하는 것입니다[^5]. 셋째, `Awaitable`을 활용한 비동기 프로그래밍, RenderGraph 그래픽스 아키텍처, CoreCLR 지원 로드맵에 이르기까지 Unity 6000.5의 최신 기술 메커니즘을 깊이 이해하여 프로젝트가 6.7 LTS 버전으로 이행하는 과정에서도 구식이 되지 않는 정확한 AI 지침 규칙 세트를 구축하는 것입니다[^6]. 이 종합 분석은 향후 변화에 유연하고 고성능이며 일관된 개발 환경을 실현하기 위한 전략적 계획을 제시합니다.

## **Claude Code의 프리픽스 메모리 동역학 및 Prompt Caching 최적화 분석**

거대한 소스 코드 저장소에서 대형 언어 모델(LLM)을 운용할 때의 핵심 과제는 컨텍스트 드리프트(context drift) 현상과 처리 비용의 기하급수적 증가입니다. Claude Code는 Prompt Caching이라는 기반 아키텍처 메커니즘을 통해 이 문제를 해결합니다. 이 기능은 모델이 프리픽스(prefix) 텍스트 세그먼트를 읽고 분석하는 과정에서 생성한 중간 수학적 행렬(특히 KV 캐시 메모리의 Key 및 Value 행렬)을 저장하여 재사용하는 원리로 작동합니다[^3].

개발 환경에서 최초 캐시 쓰기(cache write)를 수행할 때는 5분 TTL(수명) 캐시 구성의 경우 일반 토큰 처리보다 25% 높은 비용이 발생하며, 1시간 TTL 구성의 경우 기본 비용의 두 배가 부과됩니다[^4]. 그러나 진정한 가치는 이후의 캐시 읽기(cache read)에서 나타납니다. 이 단계에서는 소비 비용이 기본 단가의 약 10% 수준으로 떨어져, 전체 프로젝트 컨텍스트에 대해 최대 90%에 달하는 비용 절감 효과를 얻을 수 있습니다[^4]. 이 메커니즘이 정상 작동하려면 입력 구조가 프리픽스 일치 제약(prefix match constraint) 규칙을 절대적으로 충족해야 합니다. 텍스트 문자열 내부에서 단 1바이트 또는 공백 문자 하나라도 미세한 변경이 발생하면, 그 지점 이후의 모든 캐시 메모리가 즉시 무효화되어 시스템이 행렬 연산을 처음부터 다시 계산해야 합니다[^3].

이러한 엄격한 제약을 고려하여 Claude Code는 서버로 전송하는 프롬프트 레이아웃(prompt layout)을 안정성이 높은 순서에서 낮은 순서로 배치하도록 설계되었습니다. 데이터 블록은 고정된 System Prompt(약 4,000토큰)로 시작해 도구 정의(Tool Definitions)가 뒤따르고, 그다음 `CLAUDE.md` 파일들의 내용이 위치하며, 마지막으로 동적인 대화 기록이 이어집니다[^3]. 이 순서 덕분에 동일 시스템 내 여러 사용자가 System Prompt 캐시를 공유할 수 있으며, 같은 소스 코드 저장소에서 협업하는 엔지니어들은 `CLAUDE.md` 파일의 캐시를 공동으로 활용할 수 있습니다[^3]. 날짜 변경이나 git 상태 업데이트 결과 같은 실시간 변동으로부터 이 프리픽스를 보호하기 위해 Claude Code는 System Prompt를 직접 수정하지 않습니다. 대신 이러한 동적 데이터를 프롬프트 말미의 최신 사용자 메시지 내부에 `<system-reminder>` 시맨틱 태그로 감싸 삽입함으로써, 상단의 값비싼 프리픽스가 훼손되지 않도록 보장합니다[^3].

규율 있는 세션 관리는 캐시 메모리에 대한 투자를 보호하는 열쇠입니다. 개발자의 일상적인 여러 작업이 의도치 않게 이 구조를 깨뜨려 불필요한 비용 급증을 초래할 수 있습니다.

| 개발자 작업 | 컨텍스트(Context) 구조에 미치는 영향 | Prompt Cache 상태 |
| :---- | :---- | :---- |
| **세션 도중 `CLAUDE.md` 파일 수정** | 시스템 프리픽스의 정적 영역을 직접 변경함. | 전체 캐시가 완전히 무효화되어 처음부터 재계산이 강제됨(Cache Miss)[^10]. |
| **노력 수준(Effort) 또는 Fast Mode 변경** | 세션 초기화 영역에 새로운 설정 매개변수나 헤더 태그를 삽입함. | 매개변수가 캐시 키(Cache Key)의 일부이므로 완전히 새로운 캐시 체인이 초기화됨[^4]. |
| **컨텍스트 정리를 위한 `/compact` 명령 실행** | 메모리 공간을 확보하기 위해 대화 기록을 잘라내고 요약함. | 재구성된 대화 기록이 중단점(Breakpoint) 이후 구조를 변경하므로 기존 캐시가 무효화됨[^1]. |
| **모델 구조 전환(Model Switching)** | Claude 3.5 Sonnet과 Claude 3 Opus 간 전환. | 각 모델의 KV 행렬 구조가 달라 공유할 수 없으므로 캐시가 손실됨[^3]. |
| **동적 MCP Server 도구 추가 로드** | 전송 페이로드 선두의 정적 도구 목록을 재선언함. | 도구 정의가 변경되어 루트 프리픽스가 무효화됨[^3]. |

성능을 유지하려면 메모리 메커니즘이 지능적인 명령 구조 설계와 결합되어야 합니다. Claude Code의 Plan Mode는 머신러닝 인지 최적화의 전형적인 사례입니다. AI를 읽기 전용 상태로 전환하기 위해 코드 수정 가능한 도구를 제거하면 도구 정의가 바뀌어 캐시가 깨지게 되므로, Claude Code는 프리픽스 구조 안에 모든 도구를 그대로 유지합니다. 대신 시작 시점부터 `EnterPlanMode`와 `ExitPlanMode` 두 가지 새로운 도구를 추가해 두고, 대화 기록에 모델이 수정을 실행하지 않도록 지시하는 안내를 덧붙입니다[^3]. 이를 통해 캐시 읽기의 90% 할인 혜택을 잃지 않으면서도 매끄러운 상태 전환이 가능해집니다. Unity 6 프로젝트를 계획할 때 프로젝트 관리자는 모든 규칙이 올바른 위치와 시점에 로드되도록 이러한 메커니즘을 면밀히 분석해야 합니다.

## **게임 개발 생태계를 위한 계층형 메모리 프레임워크 전략**

Claude Code의 지침 저장소는 단일 텍스트 파일에 국한되지 않고 여섯 단계의 우선순위를 가진 구성 해석 계층(resolution hierarchy) 시스템을 통해 운용됩니다. 이 체계에는 엔터프라이즈 관리 정책(Managed Policy), 사용자 전역 설정, 프로젝트 단위 설정, 개인 로컬 설정, 파일 경로 기반 규칙, 그리고 마지막으로 AI가 스스로 종합하는 자동 메모리가 포함됩니다[^1]. 이 아키텍처에서 우선순위는 좁은 범위에서 넓은 범위로 적용되는 원칙을 따르며, 충돌이 발생할 경우 로컬 수준이나 하위 디렉터리의 세부 설정이 전역 설정을 덮어씁니다[^13].

시스템의 핵심은 프로젝트 루트 디렉터리에 위치한 `CLAUDE.md` 파일입니다. 이곳은 게임의 환경, 프로그래밍 언어, 렌더링 시스템 및 기반 아키텍처를 규정하는 불변의 규칙을 담는 곳입니다[^14]. 개발자들은 에이전트의 모든 행동을 통제하려는 기대감으로 수천 줄에 달하는 방대한 설정 파일을 작성하는 경향이 있습니다. 그러나 Claude Code 세션 1,650건을 바탕으로 수행된 대규모 연구는 이 파일 구조에 대한 여러 통념을 뒤집었습니다. 분석 결과 파일 길이의 변화(25줄에서 500줄까지), 규칙 배치 위치의 변경(파일 상단, 중단, 하단), 심지어 교차 참조 구문(imports)을 사용한 파일 분할조차 AI의 준수율에 통계적으로 유의미한 차이를 만들지 못했습니다[^16]. 실질적으로 성패를 가르는 결정적 요인은 작업의 성격에 있습니다. 모델은 완전히 새로운 코드를 생성할 때는 최대 71.3%까지 규칙을 준수하지만, 기존 코드를 수정해야 할 때는 그 비율이 45.1%로 급격히 하락합니다. 화면에 존재하는 기존 코드 자체가 규칙 파일과 경쟁하는 맥락을 형성하기 때문입니다[^16].

따라서 `CLAUDE.md` 파일을 200줄 미만으로 유지하라는 권고는 소프트웨어의 강제 절단 한계(truncation point)가 아니라 데이터 청결도를 위한 소프트 목표(soft target)일 뿐입니다[^16]. 실제 200줄 절단 제한은 자동 메모리(Auto Memory) 시스템의 인덱스 파일인 `MEMORY.md`에 적용됩니다[^16].

| 구성 관리 계층 | 실제 경로 / 저장 위치 | Unity 프로젝트 내 역할 | Git 시스템 추적 상태 |
| :---- | :---- | :---- | :---- |
| **사용자 전역 규칙(User Global)** | `~/.claude/CLAUDE.md` | 개발자 개인 취향(예: 오류 보고 스타일, 코드 포맷팅 선호도)[^13]. | 추적 안 됨(로컬 머신 전용)[^13]. |
| **프로젝트 핵심 규칙(Project Root)** | `./CLAUDE.md` | 팀 전체 공통 설정(예: HDRP 요구 사항, C# 9.0, 엔진 아키텍처, 표준 경로 명명)[^13]. | 추적 및 공유됨(Committed)[^13]. |
| **개인 재정의 규칙(Project Local)** | `./.claude/CLAUDE.local.md` | 임시 메모, 개발자 머신 전용 테스트 정보, 로컬 개발 서버 연결 문자열[^13]. | `.gitignore`를 통해 제외됨(Ignored)[^13]. |
| **경로 기반 규칙(Modular Rules)** | `paths:`를 포함한 `.claude/rules/*.md` | 특정 하위 시스템용 설정(예: `**/*CustomPass*.cs`는 HDRP Custom Pass 규칙 적용, `**/*Editor.cs`는 UI Toolkit 규칙 적용)[^13]. | 추적 및 공유됨(Committed)[^19]. |
| **자동 메모리(Auto Memory)** | `~/.claude/projects/<id>/memory/MEMORY.md` | 디버깅 방법, 라이브러리 이력 또는 세션 중 반복된 실수에 대해 AI가 자체 종합한 지식[^17]. | 추적 안 됨(로컬 분산 저장)[^17]. |

자주 오해받는 구성 요소 중 하나는 자동 메모리(Auto Memory) 시스템입니다. 컨텍스트 반복 문제를 해결하기 위해 탄생한 이 시스템은 Claude Code가 반복적인 코딩 패턴을 감지할 때 개인 설정 디렉터리에 Markdown 파일을 자동으로 기록합니다[^17]. 그러나 작업 분할 메커니즘(worktrees)을 통해 동일한 코드베이스에서 병렬로 작업하는 멀티 에이전트 팀(multi-agent teams) 환경에서 자동 메모리는 치명적인 약점을 드러냅니다. 바로 스레드 안전성이 보장되지 않는다는 점(not thread-safe)입니다[^22]. 여러 에이전트가 동시에 `MEMORY.md` 파일을 덮어쓰려 하면서 경쟁 상태(race condition)로 인한 데이터 손실이 발생합니다[^22]. 게다가 컨텍스트 압축(compaction) 과정을 거치면서 불필요하거나 부정확한 메모가 살아남아 원본 지침과 동일한 높은 우선순위를 갖게 되고, 이로 인해 에이전트가 잘못된 규칙을 자신 있게 제시하는 현상이 발생합니다[^23]. 자동 메모리에서 유용한 지식을 검토하여 영구적인 모듈형 규칙(Modular Rules) 시스템으로 이관하는 것은 필수적인 거버넌스 단계입니다.

모듈형 규칙 시스템 `.claude/rules/`는 Unity 아키텍처의 복잡성을 다루는 데 이상적인 도구입니다. YAML frontmatter의 `paths:` 영역에 글롭 패턴(glob patterns)을 사용함으로써, 설계자는 AI가 `.shader` 또는 `.hlsl` 파일과 상호작용할 때만 Shader 프로그래밍 규칙이 로드되도록 구성할 수 있습니다[^19]. `paths:` 속성이 없으면 해당 파일은 `CLAUDE.md`와 마찬가지로 매 세션마다 자동 로드되어 컨텍스트 포화(context saturation) 위험을 초래합니다[^19]. 특히 다중 도구 호환성도 권장됩니다. 팀이 이미 `AGENTS.md`(수십 개의 다른 에이전트가 지원하는 개방형 표준)를 유지 관리하고 있다면, 전체를 다시 작성하는 것이 아니라 `CLAUDE.md` 내부에서 `@AGENTS.md` 교차 로드 구문을 사용하여 정보를 매끄럽게 연결하고 단일 진실 공급원(single source of truth)을 구축하는 것이 모범 사례입니다[^1].

## **Unity-Technologies/skills 생태계를 활용한 워크플로 자동화**

완벽한 프로젝트 아키텍처는 방향을 제시할 뿐만 아니라 강력한 실행 권한도 부여해야 합니다. `skills.sh` 프로토콜을 사용하면 AI 에이전트가 자연어 처리의 한계를 넘어 실질적인 시스템 제어 주체로 거듭날 수 있습니다[^27]. 에이전트 스킬(Agent Skills) 디렉터리에는 명령 구조와 `SKILL.md` 메타데이터를 포함해 사전 패키징된 행동 모음이 담겨 있으며, 이는 표준 운영 절차(Standard Operating Procedures) 역할을 수행합니다[^27].

공식 저장소 `Unity-Technologies/skills`는 AI 모델이 실행 불가능한 코드를 "임의로 지어내는" 대신 프로젝트 작업이 엄격하게 표준 API를 준수하도록 보장하는 특화 도구 모음을 제공합니다[^5]. 세션 시작 시 전체가 로드되는 프로젝트 지침 파일과 달리, 스킬 시스템은 점진적 공개(progressive disclosure) 메커니즘으로 동작합니다[^29]. 대기 상태에서는 시스템 프리픽스에 스킬의 이름과 간략한 설명만 등록됩니다(예: IAP 설정이 필요할 때 사용하는 `implement-in-app-purchases`). 사용자가 이 설명과 일치하는 요청을 할 때 비로소 해당 스킬의 전체 C# 코드 블록과 통신 명령이 실행 메모리에 적재되어, 유지 관리 비용을 최대 98%까지 획기적으로 절감합니다[^30].

통합 과정은 커맨드라인 도구(CLI)를 통해 매우 간단하게 이루어집니다. `npx skills add Unity-Technologies/skills --agent claude-code` 명령을 실행하면 GitHub에서 소스 코드를 복제할 수 있으며, GLW에서는 공유 스킬 저장소가 `.agents/skills/` 디렉터리로 표준화되어 있고 `skills-lock.json`이 업스트림 Unity-Technologies 스킬 버전을 고정(pin)합니다[^5]. 이를 통해 Claude Code는 다음과 같은 강력한 역량으로 업그레이드됩니다.

| 스킬 이름 (Agent Skill) | Unity 프로젝트 내 동작 메커니즘 및 실행 역량 |
| :---- | :---- |
| **`unity-cli`** | Unity Command Line과의 직접 상호작용 인터페이스를 제공합니다. 그래픽 인터페이스를 열지 않고도 AI가 Unity Editor 설치, 빈 프로젝트 초기화, 라이선스 인증(auth) 관리, 헤드리스 빌드(headless builds) 구성을 자동으로 수행할 수 있습니다[^5]. |
| **`unity-package-management`** | Unity Package Manager(UPM) 구조에 대해 자동화된 작업을 수행합니다. C# `PackageManager.Client` 호출 함수를 사용하여 지속적 통합(CI/CD) 워크플로 내에서 패키지를 스캔, 추가, 제거 및 업데이트합니다[^5]. |
| **`build-live-game`** | Unity Gaming Services(UGS) 플랫폼과 직접 연동됩니다. AI가 플레이어 인증(auth), 클라우드 저장(cloud save), 서버 코드(cloud code), 리더보드(leaderboards), 인게임 경제 시스템(economy) 설정 등 복잡한 흐름을 자동으로 처리합니다[^5]. |
| **`ui` (Router) 및 하위 변형** | 지능형 스위치처럼 동작합니다. 프로젝트를 분석하여 Flexbox 표준에 따른 UXML/USS 컴파일용 `ui-uitk`, Canvas 계층 구조를 직접 다루는 `ui-ugui`, Unity Editor 확장 프로그래밍용 `ui-imgui` 중 세 가지 특화 스킬 중 하나로 구조를 자동 라우팅합니다[^5]. |
| **`setup-multiplayer-services`** | 네트워크 인프라 구성을 자동화합니다. Unity Multiplayer Services를 통해 토폴로지(topology), 매치메이킹(matchmaking), 세션/로비(sessions/lobbies) 관리를 처리합니다[^5]. |
| **`validate-urp-render-graph-renderer-feature`** | 별도의 URP 프로젝트 작업 시 유용한 스킬입니다. GLW/HDRP 환경에서는 커스텀 렌더링의 기본 표준으로 사용하지 않으며, 대신 HDRP Custom Pass와 `.claude/rules/rendering-rules.md` 규칙을 우선합니다. |
| **`shader-graph-create-custom-node`** | Shader Graph 아키텍처와 호환되는 다목적 커스텀 노드(Custom Nodes)를 작성하기 위해 HLSL 소스 코드를 자동으로 합성하고 처리합니다[^5]. |

이러한 스킬 사용을 AI에 위임하면 `CLAUDE.md` 파일을 간소화할 수 있습니다. IronSource 광고 라이브러리 설정 방법을 수백 줄에 걸쳐 설명하는 대신, 아키텍트는 `levelplay-unity-integration` 스킬을 설치하기만 하면 됩니다[^5]. 요청이 들어오면 AI 에이전트는 보상형 광고(rewarded ads) 연동부터 전면 배너 광고(interstitial ads)에 이르기까지 검증된 파일 형식과 가장 올바른 구현 경로를 즉시 확보하게 됩니다[^5].

## **Unity 6000.5를 위한 그래픽스 및 비동기 프로그래밍 기술 프레임워크 구조**

구식이 되지 않는 프로젝트 지침 세트를 만들려면 Unity 6000.5 버전의 시스템 핵심부에서 일어난 심층적인 변화를 파고들어야 합니다. 기존 레거시 프로그래밍 모델에서 차세대 아키텍처로의 전환은 소스 코드가 현재 잘 동작할 뿐만 아니라 모바일 기기와 고사양 PC 플랫폼 모두에서 전력 및 성능 효율을 최적화할 것을 요구합니다.

### **비동기 프로그래밍: UnityEngine.Awaitable로의 권한 이양**

전통적인 Unity 실행 환경은 단일 스레드(single thread)에서 동작하므로 리소스 로딩이나 AI 연산 같은 복잡한 작업을 처리할 때 게임 전체가 멈추는 현상(freeze)이 발생할 위험이 있습니다[^32]. 과거에는 개발자들이 Coroutine(데이터 반환 구조 처리가 까다롭고 가비지 컬렉터 GC에 메모리 부담을 줌)이나 `System.Threading.Tasks.Task`(게임 루프에 최적화되지 않은 고비용 객체 할당 구조)에 의존해야 했습니다[^7].

Unity 6에서는 비디오 게임에서 `async`/`await` 모델을 최적화하도록 특별히 설계된 데이터 타입인 `UnityEngine.Awaitable` 구조를 제공합니다[^7]. `Awaitable`의 혁신적인 특징은 객체 풀링(Object Pooling) 기반의 재사용 메커니즘에 있습니다. 호출될 때마다 새 메모리를 할당하는 대신 시스템이 풀에서 빈 객체를 가져와 사용한 뒤, `await` 호출이 완료되는 즉시 조용히 정리하여 재사용을 위해 반환합니다[^7]. 이러한 메모리 할당 제거는 최적화 엔지니어들을 괴롭히던 가비지 컬렉션 지연(GC spikes) 문제를 근본적으로 해결합니다[^7].

이 조합은 탁월한 성능을 제공하지만, `.claude/rules/async.md` 규칙 파일에서 AI 모델에게 명확히 경고해야 하는 절대적 제약 사항 하나를 동반합니다: **동일한 `Awaitable` 객체에 대해 `await` 명령을 두 번 이상 사용하는 것은 절대 금지됩니다**[^7]. 첫 번째 호출이 끝나는 시점에 해당 객체는 이미 공용 풀로 반환되어 다른 프로세스에 재할당되었을 수 있기 때문입니다. 의도적으로 두 번째 `await`를 시도하면 정의되지 않은 동작(undefined behavior)이 발생하여 프로그램 스레드가 멈추거나 저수준 예외가 던져집니다[^7].

| 기술적 속성 | `System.Threading.Tasks.Task` | 권장 구조: `UnityEngine.Awaitable` |
| :---- | :---- | :---- |
| **메모리 할당(Allocation)** | 함수 호출마다 지속적으로 메모리 가비지(GC)를 생성함[^7]. | 기본 풀링(Pool) 설계 덕분에 메모리 할당이 거의 없음[^7]. |
| **호출 재사용(`await`)** | 여러 곳에서 동일한 작업을 `await`할 수 있음[^7]. | **엄격히 금지됨**. 두 번 이상 `await` 시 메모리 손상 오류 발생[^7]. |
| **스레드 이어받기(Continuation)** | 보통 ThreadPool로 전환되어 메인 스레드로 돌아올 때 최소 1프레임의 지연이 발생함[^7]. | 완료 신호가 발생하는 즉시 동일 프레임 내에서 동기적으로 실행됨[^7]. |
| **스레드 수명 주기 제어** | 복잡한 수동 `SynchronizationContext` 처리가 필요함[^35]. | 초고속 네이티브 API 지원: `Awaitable.MainThreadAsync()` 및 `Awaitable.BackgroundThreadAsync()`[^7]. |

더 나아가 스레드 전환(thread switching) 과정도 이제 매우 매끄럽게 이루어집니다. 프로그래밍 과정에서 AI 에이전트는 `await Awaitable.BackgroundThreadAsync()`를 통해 경로 탐색 연산을 백그라운드 스레드로 넘길 수 있습니다. 그래픽 인터페이스를 업데이트하거나 Unity 객체에서 데이터를 조회해야 할 때는 `await Awaitable.MainThreadAsync()`를 호출하기만 하면 안전하게 메인 스레드로 제어권을 되돌릴 수 있습니다[^34]. 이러한 즉각적인 스위칭 능력 덕분에 Unity API의 단일 스레드 접근 원칙을 위반하지 않으면서 CPU 대역폭을 극대화할 수 있습니다[^34]. 애니메이션 이벤트의 경우 Unity 6000.5는 `AnimationEventInfo`라는 `ref struct` 타입을 추가로 도입했습니다. 동적 메모리 할당을 원천 차단하는 이 구조체는 복잡한 캐릭터 시스템에서도 메모리 가비지를 남기지 않고 이벤트를 관리할 수 있게 해주며, 고성능 프로젝트에서 우선 적용해야 할 모범 사례(best practice)입니다[^39].

### **새로운 그래픽스 아키텍처: 압도적인 RenderGraph와 Pass 명령 블록의 분화**

지난 10년간 Built-In Render Pipeline(BiRP)은 Unity 그래픽스의 중추 역할을 해왔습니다. 그러나 그 모놀리식(monolithic) 아키텍처는 현대의 크로스 플랫폼 최적화 요구를 감당할 만큼 확장될 수 없었습니다. Unity 6부터 프로젝트는 규모에 따라 높은 범용성을 지닌 **Universal Render Pipeline(URP)** 또는 AAA급 시각적 품질을 위한 **High Definition Render Pipeline(HDRP)** 중 그래픽스 플랫폼을 유연하게 선택할 수 있습니다.

URP를 사용하든 HDRP를 사용하든 **Render Graph**는 파이프라인이 렌더 루프(render loop)를 기술하고 최적화하는 핵심 내부 메커니즘입니다. 핵심은 AI 에이전트가 현재 프로젝트가 어떤 파이프라인에서 실행 중인지 정확히 식별하여 올바른 API를 사용하는 것입니다:

- **프로젝트가 URP를 사용하는 경우**: `ScriptableRendererFeature`, `ScriptableRenderPass`, `RecordRenderGraph`, `AddRasterRenderPass`, 그리고 `ContextContainer`를 사용해야 합니다.
- **프로젝트가 HDRP를 사용하는 경우**: 위에서 언급한 URP API를 절대 사용해서는 안 됩니다. 대신 HDRP Custom Pass 시스템인 `CustomPass`, `CustomPassVolume`, `FullScreenCustomPass`, `DrawRenderersCustomPass`, `CustomPassContext` 및 `CustomPassUtils`/`HDUtils` 같은 헬퍼를 사용해야 합니다.

렌더링과 관련된 ShaderGraph, HLSL 및 C# 코드를 다룰 때 AI의 책임은 구성된 파이프라인의 경계를 엄격히 지키는 것입니다. 즉, 올바른 include 라이브러리를 사용하고, 올바른 셰이더 태그(예: `"RenderPipeline" = "UniversalPipeline"` 또는 `"HDRenderPipeline"`)를 설정하며, 올바른 워크플로를 적용해야 합니다.

### **2D 물리 시스템 업데이트 및 Roslyn 컴파일러 표준화**

그래픽스 외에도 프로젝트에는 `com.unity.modules.physicscore2d` 모듈이 포함되어 있지만, 게임플레이 스크립트는 여전히 `UnityEngine.Physics2D`, `Rigidbody2D`, `Collider2D` 및 `PhysicsScene2D`와 같이 검증된 공개 API를 우선 사용해야 합니다. AI 에이전트는 설치된 Editor/패키지의 실제 API를 대조 확인하지 않은 상태에서 임의로 네임스페이스를 `Unity.U2D.Physics`로 변경하거나 Physics 2D에 `UNITY_6000_5_OR_NEWER` 가드를 적용해서는 안 됩니다.

동시에 Unity 6는 Roslyn 컴파일러를 사용하지만, 현재 GLW 프로젝트 설정은 `<LangVersion>9.0</LangVersion>`으로 `.csproj` 파일을 생성하고 있습니다. 따라서 컴파일러 설정이 업그레이드되고 Unity 컴파일이 검증되기 전까지는 컬렉션 식(`List<int> values = [1, 2, 3];`), 스프레드 연산자(`[..arrayA, ..arrayB]`) 또는 일반 class/struct용 기본 생성자(primary constructors)와 같은 C# 10+ / C# 12 문법을 AI가 사용해서는 안 됩니다.

## **2026-2027 전략적 비전: Unity 6.7 LTS를 향한 로드맵**

성공적인 아키텍처 원칙 세트는 당면 과제를 해결하는 데 그치지 않고 향후 업데이트까지 내다보아야 합니다. 2027년 1분기에 Unity 6 세대의 마침표를 찍는 버전으로 계획된 Unity 6.7 LTS 플랫폼은 운영체제, 인터프리터, 브라우저 환경 전반에 걸친 개편을 동반합니다[^2]. AI 에이전트와 소프트웨어 아키텍처 부서는 이러한 지식을 소스 코드 리뷰 기준에 반드시 반영해야 합니다.

가장 근본적인 변화는 가상 머신 런타임(Runtime)에 있습니다. 10년 넘게 Mono를 고수한 끝에 Unity 6.7 LTS 및 Unity 6.8은 데스크톱 플랫폼(Desktop Player)에서 레거시 Mono를 대체하고 IL2CPP를 보완하는 공식 개발 환경으로 Microsoft의 최신 .NET 런타임 기술인 CoreCLR을 도입할 예정입니다[^8]. CoreCLR은 구형 표준에 대한 의존성을 제거할 뿐만 아니라 도메인 리로드(domain reload)의 난제를 해결하고 가비지 컬렉션 성능을 강화하며 ECS(Entity Component System)의 속도를 끌어올립니다[^8]. 이 새로운 시스템의 극도로 높은 메모리 효율 최적화 특성으로 인해, 무분별하게 동적 할당을 수행하는 C# 코드를 방치하는 것은 오히려 역효과를 낳게 됩니다.

코어 운영체제 환경의 경우 6.7 LTS부터 Unity의 Windows Player 배포본은 라이브러리 링크 방식을 변경합니다. 전체 Microsoft Visual C++ 라이브러리를 정적으로 패키징하는 대신 실행 파일이 이제 `vcruntime140.dll` 및 `msvcp140.dll` 배포판을 통해 동적으로 링크됩니다[^60]. 이 변화로 인해 설치 파일 패키징 시스템(Patchers/Installers)의 지속적 통합(CI/CD) 파이프라인에서는 `UnityPlayer.dll` 실행 파일과 함께 C++ Redistributable 라이브러리가 반드시 배포되도록 보장해야 합니다[^60]. XR(확장 현실) 분야에서도 구식 OculusXR 패키지가 6.7 버전에서 완전히 사라지고, 멀티 디바이스 대응 플랫폼인 OpenXR Meta로 대체됩니다[^60].

웹 기반 애플리케이션 시장 역시 눈부신 도약을 맞이합니다. Unity 6.7 LTS는 기존 WebGL보다 병렬 드로우 콜을 수십 배 더 효율적으로 처리할 수 있는 WebGPU 아키텍처를 통해 새로운 프로덕션 표준을 세울 것으로 기대됩니다[^2]. 4GB로 엄격히 제한되던 브라우저 메모리 병목 현상은 WASM64 컴파일러의 등장으로 완전히 해소되어, 복잡한 웹 애플리케이션의 메모리 할당 상한선이 최대 16GB까지 확장됩니다[^2]. 점진적 에셋 로딩(Progressive asset loading) 기능은 브라우저에서의 게임 초기 구동 시간을 최대 40%까지 단축할 것으로 예상됩니다[^57]. 이는 그래픽스 팀이 메모리 과부하로 인한 앱 충돌 걱정 없이 텍스처 해상도를 한껏 끌어올릴 수 있게 해주는 도구들입니다.

## **실전 구축 로드맵 및 계층형 시스템 거버넌스**

분산형 AI 시스템에 메모리 구조와 코딩 표준을 도입하려면 엄격한 버전 관리 프로세스가 필요합니다. 기술의 적용은 모든 지침을 하나의 파일에 몰아넣는 것이 아니라 Claude Code의 컨텍스트 수집 알고리즘에 부합하도록 데이터를 분할하는 것입니다. 다음 절차는 대규모 Unity 애플리케이션 제작 팀에 적합한 하향식(top-down) 구축 모델을 제시합니다.

**1단계: 공통 운영 거버넌스 수립(아키텍트의 조치)** 먼저 개발 시스템에 적절한 권한을 구성해야 합니다. `.claude/settings.json` 파일에 안전한 명령어를 선언해 두면 AI가 수동 보안 경고로 중단되지 않고 `dotnet format`이나 `Bash(npm run *)` 같은 검증 작업을 자동으로 실행할 수 있습니다[^62]. 이 파일에서 빼놓을 수 없는 필수 설정은 `claudeMdExcludes`입니다[^63]. 예외 영역(예: `**/Library/**` 및 `**/Packages/ThirdParty/**`)을 지정함으로써 시스템이 외부 에셋 패키지가 포함된 디렉터리를 스캔하는 것을 차단하고, 오픈소스 생태계에 속한 `CLAUDE.md` 파일을 실수로 로드하여 Prompt Caching 메커니즘을 망가뜨리는 일을 방지합니다[^63]. 동시에 엔지니어 개인별 규칙이나 로컬 디바이스 테스트용 라우팅 문자열은 `.claude/CLAUDE.local.md` 파일에 저장해야 하며, 이 파일은 반드시 버전 관리 시스템의 무시 목록(`.gitignore`)에 추가되어야 합니다[^13].

**2단계: 불변의 프리픽스 구축(약 150줄 내외 유지)** 루트 디렉터리(Root Directory)의 `CLAUDE.md` 파일은 AI가 결코 벗어나서는 안 되는 핵심 인식을 확립하는 프로젝트의 "헌법" 역할을 수행해야 합니다[^14]. 이 파일에는 본 프로젝트가 URP 또는 HDRP와 C# 9.0 기반의 Unity 6000.5를 사용한다는 점을 명확히 선언하고, 모든 비동기 호출에 `Awaitable` 구조를 필수적으로 사용하며, `Update()` 루프 내부에서 가비지를 생성하는 동적 할당 코드 사용을 금지하고, RPG Builder, Malbers, Survival Engine 및 Farming Engine 간의 권한 경계를 준수할 것을 명시합니다. 이 범위를 넘어서는 복잡한 설명이나 전문적인 코딩 지식은 모두 덜어내어 프리픽스 영역을 최대한 가볍게 유지합니다[^16]. 이 파일은 소스 저장소에 커밋(commit)되어 모든 팀원의 복제본(clone)이 동일한 공통 아키텍처를 상속받도록 합니다.

**3단계: 컨텍스트 기반 규칙 네트워크 구축(`.claude/rules`)** HLSL 기반 Shader 프로그래밍 가이드, Custom Render Pass(URP/HDRP용), 혹은 UI Toolkit 기반 인터페이스 구축 규정처럼 방대한 전문 지식은 모듈형 규칙 형태로 격리해야 합니다. `.claude/rules/` 디렉터리 내 각 텍스트 파일(예: `rendering-rules.md`)에는 `paths:` 키워드를 포함한 YAML frontmatter 구조(세 개의 하이픈으로 시작하는 헤더)가 함께 작성됩니다. `paths: ["**/*CustomPass*.cs"]`와 같은 경로 매칭 표현식을 입력하면, 개발자가 AI에게 그래픽스 기능 모듈 작업을 요청할 때만 심층 렌더링 지침이 컨텍스트 창에 투입됩니다. 게임 서버나 데이터 검증 시스템을 작성하는 작업으로 전환하면 이 그래픽스 지식 블록은 "휴면 상태"로 남아 막대한 토큰 비용이 낭비되는 것을 막아줍니다[^19].

**4단계: 스킬 프로토콜 임베딩(Agent Skills)** 저장 구조가 안정화되면 프로젝트는 플랫폼 및 제어 환경과의 통신 문제를 해결해야 합니다. 아키텍트는 커맨드라인 도구를 열어 `npx skills add Unity-Technologies/skills --agent claude-code` 명령을 실행해 GitHub에서 `SKILL.md` 파일과 스크립트 코드를 직접 내려받은 뒤, GLW의 공유 스킬 저장소를 `.agents/skills/` 디렉터리에 표준화합니다. 이 시점부터 "UPM을 통해 Unity In-App Purchasing 라이브러리 설치"나 "Multiplayer Services를 통한 게임 서버 설정" 같은 건조한 절차적 작업이 주어지면 Claude Code 모델은 직접 문서를 읽거나 명령 구조를 추측할 필요가 없습니다. 대신 스킬 설명(description-as-trigger)을 이용해 점진적 공개 메커니즘을 통해 기존 스크립트를 자동으로 대조, 로드 및 실행하여 요청을 완벽하고 표준 규격에 맞게 완수합니다[^30].

**5단계: 지식 승격 수명 주기(자동 메모리 추출)** 작업 프로세스는 초기 설정 단계에서 멈추지 않습니다. 매주 모델이 작업을 반복적으로 해결해 나가면서 자동 메모리 시스템의 `MEMORY.md` 디렉터리에 "뼈저린 실전 경험"을 자동으로 기록하게 됩니다[^17]. 예를 들어 6000.5 버전의 호환성 단절로 인해 특정 구식 Unity 호출 방식이 오류를 일으킨다는 사실을 포착하는 경우입니다. 기술 관리 책임자는 `/memory` 명령을 사용하여 AI가 자동으로 종합한 내용을 열람해야 합니다[^20]. 멀티 에이전트 환경에서의 덮어쓰기 및 데이터 경합 취약성과 컨텍스트 압축(compaction) 이후의 소실 가능성 때문에, 장기적 전략 가치가 있는 모든 규칙은 반드시 수동으로 추출해 간결한 지침으로 다듬어 `.claude/rules/*.md`의 불변 규칙 파일에 역으로 반영해야 합니다[^22]. 이러한 방식으로 프로젝트의 "단기 기억"이 시스템의 "장기 지식"으로 공고화되어, 다가오는 Unity 6.7 LTS 릴리스에서의 대규모 기반 개편에 가장 탄탄하게 대비할 수 있습니다.

---

## **참고문헌**

[^1]: CLAUDE.md Examples (2026): 6 Copy-Paste Templates + ... - Morph - [https://www.morphllm.com/claude-md-examples](https://www.morphllm.com/claude-md-examples)
[^2]: What is the Best Unity Version in 2026 — Unity 6.5, 6.3 LTS? - [https://makaka.org/unity-tutorials/best-version](https://makaka.org/unity-tutorials/best-version)
[^3]: How Prompt Caching Actually Works in Claude Code - [https://www.claudecodecamp.com/p/how-prompt-caching-actually-works-in-claude-code](https://www.claudecodecamp.com/p/how-prompt-caching-actually-works-in-claude-code)
[^4]: Claude Code Prompt Caching | Build This Now - BuildThisNow - [https://www.buildthisnow.com/fr/blog/guide/development/claude-code-prompt-caching](https://www.buildthisnow.com/fr/blog/guide/development/claude-code-prompt-caching)
[^5]: GitHub - Unity-Technologies/skills: A collection of reusable skills for - [https://github.com/Unity-Technologies/skills](https://github.com/Unity-Technologies/skills)
[^6]: Render Graph - Introduction - The Knights of U - [https://theknightsofu.com/render-graph-introduction/](https://theknightsofu.com/render-graph-introduction/)
[^7]: Manual: Introduction to asynchronous programming with Awaitable - [https://docs.unity3d.com/6000.0/Documentation/Manual/async-awaitable-introduction.html](https://docs.unity3d.com/6000.0/Documentation/Manual/async-awaitable-introduction.html)
[^8]: Unity's Path to CoreCLR: What the Mono Cutover Means for Your - [https://oceanviewgames.co.uk/blog/posts/unity-path-to-coreclr](https://oceanviewgames.co.uk/blog/posts/unity-path-to-coreclr)
[^10]: Prompt Caching in Claude Code: How to Save Millions of Tokens - [https://www.mindstudio.ai/blog/prompt-caching-claude-code-save-tokens](https://www.mindstudio.ai/blog/prompt-caching-claude-code-save-tokens)
[^13]: The Complete Guide to CLAUDE.md Files for AI Development 2026 - [https://serenitiesai.com/articles/claude-md-complete-guide-2026](https://serenitiesai.com/articles/claude-md-complete-guide-2026)
[^14]: Getting More Out of Claude Code (1) — Memory, Skills, and Hooks - [https://rhcwlq89.github.io/en/blog/claude-code-advanced-guide-1/](https://rhcwlq89.github.io/en/blog/claude-code-advanced-guide-1/)
[^16]: CLAUDE.md Best Practices: What the Evidence Supports (2026) - [https://www.alexdunlop.com/writing/claude-md-best-practices](https://www.alexdunlop.com/writing/claude-md-best-practices)
[^17]: Is CLAUDE.md no longer important? Understanding Claude Code's - [https://note.com/ai__worker/n/nf1d7829fe6a1?hl=en](https://note.com/ai__worker/n/nf1d7829fe6a1?hl=en)
[^19]: Rules | shanraisshan/claude-code-best-practice - DeepWiki - [https://deepwiki.com/shanraisshan/claude-code-best-practice/3.5-rules](https://deepwiki.com/shanraisshan/claude-code-best-practice/3.5-rules)
[^20]: claude-howto/02-memory/README.md at main - GitHub - [https://github.com/luongnv89/claude-howto/blob/main/02-memory/README.md](https://github.com/luongnv89/claude-howto/blob/main/02-memory/README.md)
[^22]: Auto Memory, Auto Forget - DEV Community - [https://dev.to/wkusnierczyk/auto-memory-auto-forget-g05](https://dev.to/wkusnierczyk/auto-memory-auto-forget-g05)
[^23]: Claude Code agents surfacing unverified MEMORY.md content - [https://www.reddit.com/r/ClaudeAI/comments/1tcuiql/claude_code_agents_surfacing_unverified_memorymd/](https://www.reddit.com/r/ClaudeAI/comments/1tcuiql/claude_code_agents_surfacing_unverified_memorymd/)
[^27]: Managing AI Agent Skills with `npx skills`: A Practical Guide - [https://dev.to/toyama0919/managing-ai-agent-skills-with-npx-skills-a-practical-guide-2an8](https://dev.to/toyama0919/managing-ai-agent-skills-with-npx-skills-a-practical-guide-2an8)
[^29]: The Complete Guide to Claude Code V2: CLAUDE.md, MCP - [https://www.reddit.com/r/ClaudeAI/comments/1qcwckg/the_complete_guide_to_claude_code_v2_claudemd_mcp/](https://www.reddit.com/r/ClaudeAI/comments/1qcwckg/the_complete_guide_to_claude_code_v2_claudemd_mcp/)
[^30]: How to Build a Production-Ready Claude Code Skill - [https://towardsdatascience.com/how-to-build-a-production-ready-claude-code-skill/](https://towardsdatascience.com/how-to-build-a-production-ready-claude-code-skill/)
[^32]: Introducing Asynchronous Programming in Unity - Technical Articles - [https://discussions.unity.com/t/introducing-asynchronous-programming-in-unity/1693772](https://discussions.unity.com/t/introducing-asynchronous-programming-in-unity/1693772)
[^34]: unity-coder | Skills Marketplace - LobeHub - [https://lobehub.com/skills/dmitriyyukhanov-claude-plugins-unity-coder](https://lobehub.com/skills/dmitriyyukhanov-claude-plugins-unity-coder)
[^35]: The complete asynchronous programming primer for Unity - Medium - [https://medium.com/my-games-company/the-complete-asynchronous-programming-primer-for-unity-e1b00d26e96b](https://medium.com/my-games-company/the-complete-asynchronous-programming-primer-for-unity-e1b00d26e96b)
[^39]: Unity 6000.5 - [https://unity.com/releases/editor/alpha/6000.5](https://unity.com/releases/editor/alpha/6000.5)
[^57]: Unity Engine 7: Changing the Development Paradigm ... - Inven Global - [https://www.invenglobal.com/articles/24003/unity-engine-7-changing-the-development-paradigm-and-the-roadmap-ahead](https://www.invenglobal.com/articles/24003/unity-engine-7-changing-the-development-paradigm-and-the-roadmap-ahead)
[^60]: Planned breaking changes in Unity 6.7 - Unity Engine - [https://discussions.unity.com/t/planned-breaking-changes-in-unity-6-7/1723293](https://discussions.unity.com/t/planned-breaking-changes-in-unity-6-7/1723293)
[^62]: Setting Up Claude Code for a Project - [https://claude.nagdy.me/learn/project-setup/](https://claude.nagdy.me/learn/project-setup/)
[^63]: Settings - Claude Code - [https://vineetagarwal-code-claude-code.mintlify.app/configuration/settings](https://vineetagarwal-code-claude-code.mintlify.app/configuration/settings)

### 추가 읽을거리

- What Is Prompt Caching in Claude Code? How to Save Millions of - [https://www.mindstudio.ai/blog/prompt-caching-claude-code-token-savings](https://www.mindstudio.ai/blog/prompt-caching-claude-code-token-savings)
- You Don't Know Claude Code: Architecture, Governance ... - Tw93 - [https://tw93.fun/en/2026-03-12/claude.html](https://tw93.fun/en/2026-03-12/claude.html)
- Claude Code Memory, How /memory and CLAUDE.md Actually Work - [https://blog.vibecoder.me/claude-code-memory-how-memory-command-claude-md-work](https://blog.vibecoder.me/claude-code-memory-how-memory-command-claude-md-work)
- CLAUDE.md for Game Devs: The File That Makes AI Actually - [https://www.mrphilgames.com/blog/claude-md-for-game-devs](https://www.mrphilgames.com/blog/claude-md-for-game-devs)
- GitHub - solanabr/solana-ai-kit: Claude Code / Codex / AI configs for - [https://github.com/solanabr/solana-ai-kit](https://github.com/solanabr/solana-ai-kit)
- Claude Code Memory: Give Your Agent Persistent Context Across - [https://blink.new/blog/claude-code-memory](https://blink.new/blog/claude-code-memory)
- claude-code-best-practice/CLAUDE.md at main - GitHub - [https://github.com/shanraisshan/claude-code-best-practice/blob/main/CLAUDE.md](https://github.com/shanraisshan/claude-code-best-practice/blob/main/CLAUDE.md)
- Cấu Trúc Project Claude Code Mà Mọi Frontend Dev Cần Biết - [https://viblo.asia/p/giai-ma-thu-muc-claude-cau-truc-project-claude-code-ma-moi-frontend-dev-can-biet-k74a9Kjl4eO](https://viblo.asia/p/giai-ma-thu-muc-claude-cau-truc-project-claude-code-ma-moi-frontend-dev-can-biet-k74a9Kjl4eO)
- One Source of Truth for Your AI Agent Rules: Cursor, Claude Code - [https://pub.towardsai.net/your-ai-agent-rules-one-source-of-truth-for-cursor-claude-code-and-every-tool-youll-adopt-next-cd7f1353dbbc](https://pub.towardsai.net/your-ai-agent-rules-one-source-of-truth-for-cursor-claude-code-and-every-tool-youll-adopt-next-cd7f1353dbbc)
- skills.sh - mảnh ghép quan trọng trong "stack agent" hiện tại - vnROM - [https://vnrom.net/2026/02/skills-sh-manh-ghep-quan-trong-trong-stack-agent-hien-tai/](https://vnrom.net/2026/02/skills-sh-manh-ghep-quan-trong-trong-stack-agent-hien-tai/)
- Unity - Manual: Awaitable code example reference - [https://docs.unity.cn/6000.0/Documentation/Manual/async-awaitable-examples.html](https://docs.unity.cn/6000.0/Documentation/Manual/async-awaitable-examples.html)
- On Async/Await with Awaitables as a Coroutine replacement - [https://discussions.unity.com/t/on-async-await-with-awaitables-as-a-coroutine-replacement/1554090](https://discussions.unity.com/t/on-async-await-with-awaitables-as-a-coroutine-replacement/1554090)
- Awaitable completion and continuation - Unity - Manual - [https://docs.unity3d.com/6000.2/Documentation/Manual/async-awaitable-continuations.html](https://docs.unity3d.com/6000.2/Documentation/Manual/async-awaitable-continuations.html)
- Use Unity API from another Thread or call a function in the main - [https://stackoverflow.com/questions/41330771/use-unity-api-from-another-thread-or-call-a-function-in-the-main-thread](https://stackoverflow.com/questions/41330771/use-unity-api-from-another-thread-or-call-a-function-in-the-main-thread)
- Unity 6000.5.0a9 - [https://unity.com/releases/editor/alpha/6000.5.0a9](https://unity.com/releases/editor/alpha/6000.5.0a9)
- Manual: Upgrade to Unity 6.0 LTS - [https://docs.unity3d.com/6000.5/Documentation/Manual/UpgradeGuideUnity6.html](https://docs.unity3d.com/6000.5/Documentation/Manual/UpgradeGuideUnity6.html)
- Manual: Upgrade to Unity 6.5 - [https://docs.unity3d.com/6000.5/Documentation/Manual/UpgradeGuideUnity65.html](https://docs.unity3d.com/6000.5/Documentation/Manual/UpgradeGuideUnity65.html)
- Migrating to Render Graph tutorial: Understanding the RenderGraph - [https://discussions.unity.com/t/migrating-to-render-graph-tutorial-understanding-the-rendergraph-samples/1715833](https://discussions.unity.com/t/migrating-to-render-graph-tutorial-understanding-the-rendergraph-samples/1715833)
- Unity 6 URP Render Graph Deep Dive: Why Rendering Moved to a - [https://gamedevllm.com/en/unity6-urp-render-graph-basics-en/](https://gamedevllm.com/en/unity6-urp-render-graph-basics-en/)
- Write a render pass using the render graph system in URP - [https://docs.unity3d.com/6000.0/Documentation/Manual/urp/render-graph-write-render-pass.html](https://docs.unity3d.com/6000.0/Documentation/Manual/urp/render-graph-write-render-pass.html)
- Unity 6 URP Render Graph Pass Types: AddBlitPass vs - [https://gamedevllm.com/en/unity6-urp-render-graph-pass-types-en/](https://gamedevllm.com/en/unity6-urp-render-graph-pass-types-en/)
- RenderGraph: Creating a RenderPass that alterate the Unity - [https://discussions.unity.com/t/rendergraph-creating-a-renderpass-that-alterate-the-unity-rendering-process/1614145](https://discussions.unity.com/t/rendergraph-creating-a-renderpass-that-alterate-the-unity-rendering-process/1614145)
- Understanding URP: Implementing Renderer Features with Render - [https://discussions.unity.com/t/understanding-urp-implementing-renderer-features-with-render-graph/1712280](https://discussions.unity.com/t/understanding-urp-implementing-renderer-features-with-render-graph/1712280)
- Documentation versions - Unity - Manual - [https://docs.unity3d.com/6000.5/Documentation/Manual/ManualVersions.html](https://docs.unity3d.com/6000.5/Documentation/Manual/ManualVersions.html)
- Custom shaders - Unity - Manual - [https://docs.unity3d.com/6000.5/Documentation/Manual/Shaders.html](https://docs.unity3d.com/6000.5/Documentation/Manual/Shaders.html)
- Physics Core 2D in Unity 6.5 - [https://discussions.unity.com/t/physics-core-2d-in-unity-6-5/1715178](https://discussions.unity.com/t/physics-core-2d-in-unity-6-5/1715178)
- Manual: New in Unity 6.5 - [https://docs.unity3d.com/6000.5/Documentation/Manual/WhatsNewUnity65.html](https://docs.unity3d.com/6000.5/Documentation/Manual/WhatsNewUnity65.html)
- What's new in C# 12 - Microsoft Learn - [https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-12](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-12)
- DaZombieKiller/UnityRoslynUpdater: A tool to update the Roslyn - [https://github.com/DaZombieKiller/UnityRoslynUpdater](https://github.com/DaZombieKiller/UnityRoslynUpdater)
- Create and use a source generator - Unity - Manual - [https://docs.unity3d.com/6000.5/Documentation/Manual/create-source-generator.html](https://docs.unity3d.com/6000.5/Documentation/Manual/create-source-generator.html)
- Roslyn analyzers and source generators - Unity - Manual - [https://docs.unity3d.com/6000.1/Documentation/Manual/roslyn-analyzers.html](https://docs.unity3d.com/6000.1/Documentation/Manual/roslyn-analyzers.html)
- CoreCLR, Scripting, and ECS Status Update - March 2026 - C# & .NET - [https://discussions.unity.com/t/coreclr-scripting-and-ecs-status-update-march-2026/1711852](https://discussions.unity.com/t/coreclr-scripting-and-ecs-status-update-march-2026/1711852)
- Unity's roadmap from 6.4 to 6.8: render pipelines, AI... - daily.dev - [https://daily.dev/posts/unity-s-roadmap-from-6-4-to-6-8-render-pipelines-ai-tools-coreclr-and-web-improvements-feibgy4zs](https://daily.dev/posts/unity-s-roadmap-from-6-4-to-6-8-render-pipelines-ai-tools-coreclr-and-web-improvements-feibgy4zs)
- Unity 6 Development and Migration | OVG - Ocean View Games - [https://oceanviewgames.co.uk/technologies/unity-6](https://oceanviewgames.co.uk/technologies/unity-6)
- How Claude remembers your project - Claude Code Docs - [https://code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)
- How to Use claude.md for AI Coding: Guide for Dev Teams - Apidog - [https://apidog.com/blog/claude-md/](https://apidog.com/blog/claude-md/)
- Claude Code Compaction and Long-Session Operations Guide - [https://hidekazu-konishi.com/entry/claude_code_compaction_and_long_session_guide.html](https://hidekazu-konishi.com/entry/claude_code_compaction_and_long_session_guide.html)
