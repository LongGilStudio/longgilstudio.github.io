---
title: "面向 Unity 6 的 CLAUDE.md 架構部署策略計畫：Prompt Caching 最佳化、Agent 技能整合與 Unity 6.7 LTS 升級藍圖"
date: 2026-11-25 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, claude-code, ai-agents, prompt-caching, coreclr, render-graph, awaitable, gilongworld]
description: "針對 Unity 6（6000.5 升級至 6.7 LTS）專案的分層 CLAUDE.md 架構設計策略：運用 Prompt Caching 節省 90% 成本、整合 Agent Skills 與 Awaitable 非同步規範。"
lang: zh-TW
translation_id: unity6-claude-md-prompt-caching-skills
---

軟體開發領域的生成式人工智慧與即時圖形工具的匯流，正在徹底重塑電玩遊戲與互動式應用產業的整體生產模式。在這個生態系中，Claude Code 憑藉精密的分層上下文（context）管理架構，崛起成為卓越的命令列程式設計代理（Agent）。此行為導引系統的核心是 `CLAUDE.md` 設定檔——一個確保 AI 代理始終在組織規範框架內運作的專案中繼資料儲存庫[^1]。與此同時，Unity 平台正隨著 Unity 6 發行系列邁入世代轉折點。現行的 6000.5 版本不僅僅是一次功能更新，而是一場深度的核心重構，象徵舊有系統的退場，並為預計於 2027 年初釋出的長期支援版本（Long-Term Support）Unity 6.7 LTS 奠定基礎[^2]。

建構一套能適應 Unity 6 持續變動的 `CLAUDE.md` 結構，需要結合三大複雜的技術支柱。首先是管控並最佳化 Anthropic 的提示快取（Prompt Caching）系統，以在不遺失技術脈絡的前提下，徹底降低長時間工作階段的運算資源（token）成本[^3]。其次是透過 `Unity-Technologies/skills` 儲存庫整合代理技能（Agent Skills）生態系，在不讓靜態記憶體膨脹的情況下，充分發揮與 Unity 命令列介面自動化互動的能力[^5]。第三則是深入掌握 Unity 6000.5 的最新技術機制——從以 `Awaitable` 為基礎的非同步程式設計、RenderGraph 算繪圖形架構，到 CoreCLR 的支援路線圖——進而打造出精準且具備抗過時能力的 AI 導引規則集，陪伴專案順利演進至 6.7 LTS 版本[^6]。這份全面分析將勾勒出具體的策略藍圖，以實現同步、高效能且能靈活應對未來變化的開發環境。

## **Claude Code 中的前綴記憶體動態與 Prompt Caching 最佳化**

在龐大的程式碼儲存庫中運用大型語言模型（LLM）時，核心挑戰在於語境漂移（context drift）以及運算處理成本的指數級攀升。Claude Code 透過一項名為 Prompt Caching 的基礎架構機制解決此問題。該功能依賴儲存模型在讀取並解析前綴文本段落時所產生的中間數學矩陣（特別是 KV 快取中的 Key 與 Value 矩陣）[^3]。

在開發環境中運作時，針對存活時間（TTL）設定為 5 分鐘的快取組態，首次寫入快取（cache write）所需的費用比一般 token 處理高出 25%；若採用 1 小時 TTL 的組態，成本則為兩倍[^4]。然而，真正的價值在於後續的快取讀取（cache read）階段——此時消耗成本僅剩基礎定價的約 10%，相當於為整體專案脈絡省下高達 90% 的費用[^4]。要讓此機制順利運作，輸入結構必須絕對滿足前綴比對約束（prefix match constraint）。哪怕文本序列中出現任何極微小的變動（即使只是單一位元組或一個空白字元），從該點之後的所有快取都會立刻失效，迫使系統必須從頭重新計算矩陣運算[^3]。

深諳這項嚴苛限制後，Claude Code 的設計會依照穩定度由高到低的順序，編排傳送給伺服器的文本版面配置（prompt layout）。資料區塊以固定的系統提示（System Prompt，約 4,000 tokens）為首，接著是工具定義（Tool Definitions），其後為 `CLAUDE.md` 檔案的內容，最後以動態對話歷程收尾[^3]。憑藉此排列順序，同一系統內的多位使用者得以共用 System Prompt 快取，而共同協作同一份程式碼儲存庫的工程師則會共用 `CLAUDE.md` 檔案的快取[^3]。為了保護這段前綴免受即時動態資料（例如日期變更或 git 狀態更新結果）的干擾，Claude Code 絕不直接修改 System Prompt，而是將這些動態資訊放入序列尾端最新一則使用者訊息裡的 `<system-reminder>` 語意標籤中，確保上方昂貴的前綴不受擾動[^3]。

以紀律管理工作階段是保護快取投資的關鍵。開發人員許多常見的操作都可能無意間破壞此結構，進而引發不必要的成本暴增。

| 開發人員操作 | 對語境（Context）結構的影響 | Prompt Cache 狀態 |
| :---- | :---- | :---- |
| **在工作階段中途編輯 `CLAUDE.md` 檔案** | 直接修改系統前綴的靜態區段。 | 整份快取完全失效，強制重新計算（Cache Miss）[^10]。 |
| **變更努力程度（Effort）或 Fast Mode** | 於工作階段初始化區段插入新的組態參數或標頭標籤。 | 由於參數屬於快取鍵（Cache Key）的一部分，因此初始化全新的快取鏈[^4]。 |
| **執行 `/compact` 指令清理語境** | 截斷並摘要對話歷程以釋放記憶體空間。 | 由於重建後的對話歷程改變了斷點（Breakpoint）之後的結構，導致舊快取失效[^1]。 |
| **切換模型架構（Model Switching）** | 在 Claude 3.5 Sonnet 與 Claude 3 Opus 之間切換。 | 由於各模型的 KV 矩陣結構不同且無法共用，導致快取遺失[^3]。 |
| **動態載入額外 MCP Server 工具** | 於傳送序列開頭重新宣告靜態工具清單。 | 由於工具定義改變，導致根前綴失效[^3]。 |

為了維持高執行效能，快取機制必須結合智慧化的指令設計。Claude Code 的 Plan Mode 指令正是機器學習認知最佳化的經典範例。為了讓 AI 進入唯讀狀態，如果移除具備原始碼編輯能力的工具，將會改變工具定義並破壞快取；因此 Claude Code 並未這麼做，而是在前綴結構中完整保留所有工具。它僅在啟動時便新增 `EnterPlanMode` 與 `ExitPlanMode` 這兩個工具，同時在對話歷程中加入要求模型不得執行編輯的指示[^3]。這使得狀態轉換流暢無阻，同時不會損失快取讀取帶來的 90% 折扣。在為 Unity 6 進行規劃時，專案管理者必須審慎分析這些機制，確保任何規則都能在正確的位置與正確的時機載入。

## **面向遊戲開發生態系的分層記憶框架策略**

Claude Code 的指示儲存庫並不限於單一純文字檔案，而是透過一套包含六個不同優先權層級的組態解析階層（resolution hierarchy）運作。該體系涵蓋企業級原則（Managed Policy）、使用者全域組態、專案層級組態、個人本機組態、依檔案路徑劃分的規則，以及最後由 AI 自行彙整的自動記憶（Auto Memory）[^1]。在此架構中，優先順序遵循由窄到寬的原則：當發生衝突時，本機層級或子資料夾中的細部組態將覆寫全域組態[^13]。

系統的核心是位於專案根目錄下的 `CLAUDE.md` 檔案。這裡存放著不可變動的規則，負責定義遊戲的執行引擎環境、程式語言、算繪系統與基礎架構[^14]。開發人員經常傾向撰寫長達數千行的組態檔，企圖藉此掌控代理的每一個行為。然而，一項針對 1,650 次 Claude Code 工作階段進行的大規模研究，推翻了許多關於該檔案結構的刻板印象。分析結果顯示，改變檔案長度（從 25 行到 500 行）、調整規則位置（開頭、中間或結尾），甚至透過交叉匯入（imports）語法拆分檔案，在 AI 的規則遵循度上皆未產生具備統計顯著性的差異[^16]。真正決定成敗的關鍵在於任務本身的性質：當要求生成全新程式碼片段時，模型遵循規則的比例高達 71.3%；但當必須修改既有程式碼時，此比例大幅下滑至僅 45.1%，因為螢幕上的舊程式碼本身就建立了一個與規則檔案相互競爭的語境[^16]。

因此，建議將 `CLAUDE.md` 維持在 200 行以內僅是資料整潔度上的軟性最佳化目標（soft target），而非軟體強制截斷的邊界（truncation point）[^16]。200 行的實際截斷限制其實套用於 `MEMORY.md`——也就是自動記憶（Auto Memory）系統的索引檔案[^16]。

| 組態管理層級 | 實際檔案路徑 / 儲存位置 | 在 Unity 專案中的角色 | Git 系統中的追蹤狀態 |
| :---- | :---- | :---- | :---- |
| **使用者層級規則（User Global）** | `~/.claude/CLAUDE.md` | 開發人員的個人偏好（例如：錯誤回報風格、程式碼排版習慣）[^13]。 | 不追蹤（位於本機）[^13]。 |
| **專案核心規則（Project Root）** | `./CLAUDE.md` | 供全體團隊共用的設定（例如：HDRP 需求、C# 9.0、引擎架構、標準路徑名稱）[^13]。 | 追蹤並共用（Committed）[^13]。 |
| **個人覆寫規則（Project Local）** | `./.claude/CLAUDE.local.md` | 暫時性筆記、專屬於開發人員電腦的測試資訊、本機開發伺服器連線字串[^13]。 | 透過 `.gitignore` 排除（Ignored）[^13]。 |
| **依路徑劃分的規則（Modular Rules）** | 包含 `paths:` 的 `.claude/rules/*.md` | 針對特定子系統的組態（例如：`**/*CustomPass*.cs` 套用 HDRP Custom Pass 規則，`**/*Editor.cs` 套用 UI Toolkit 規則）[^13]。 | 追蹤並共用（Committed）[^19]。 |
| **自動記憶（Auto Memory）** | `~/.claude/projects/<id>/memory/MEMORY.md` | AI 自行彙整的除錯方式、函式庫歷程或工作階段中重複犯錯的經驗總結[^17]。 | 不追蹤（分散儲存於本機）[^17]。 |

一個經常被誤解的元件是自動記憶（Auto Memory）系統。這套機制旨在解決語境重複的問題，當 Claude Code 偵測到重複的編碼習慣時，會自動將 Markdown 檔案寫入個人組態資料夾[^17]。然而，在透過工作樹（worktrees）分片機制於同一份原始碼上平行運作的多代理團隊（multi-agent teams）環境中，自動記憶暴露了致命弱點：它並非執行緒安全（not thread-safe）[^22]。多個代理同時嘗試覆寫 `MEMORY.md` 檔案，會因版本競爭條件（race condition）而導致資料遺失[^22]。更糟的是，在語境壓縮（compaction）過程中，垃圾或錯誤的筆記可能會殘存下來，並獲得與原始指示同等的高優先權，進而導致代理自信地提出錯誤的規則[^23]。定期檢視並將自動記憶中的實用知識轉移至永久性的模組化規則系統（Modular Rules），是不可或缺的治理步驟。

模組化規則系統 `.claude/rules/` 是處理 Unity 架構複雜度的理想工具。藉由在 YAML frontmatter 的 `paths:` 欄位中使用萬用字元模式（glob patterns），設計者可以設定讓著色器（Shader）程式設計規則僅在 AI 與 `.shader` 或 `.hlsl` 檔案互動時才載入[^19]。若缺乏 `paths:` 屬性，檔案將會像 `CLAUDE.md` 一樣在每次工作階段開始時自動載入，進而產生語境飽和（context saturation）的風險[^19]。特別值得鼓勵的是跨工具相容性：若團隊正在維護 `AGENTS.md` 檔案（一種受到數十種其他代理支援的開放標準），最佳實務並非全部重寫，而是在 `CLAUDE.md` 內部使用 `@AGENTS.md` 交叉匯入語法無縫串接資訊，建立單一真實來源（single source of truth）[^1]。

## **透過 Unity-Technologies/skills 生態系實現流程自動化**

一套完善的專案架構不僅要提供方向指引，還必須賦予強大的執行權限。採用 `skills.sh` 協定能讓 AI 代理跨越自然語言處理的界限，成為真正掌控系統的實體[^27]。技能資料夾（Agent Skills）存放預先封裝的行為模組，內含命令結構與 `SKILL.md` 中繼資料，扮演標準作業程序（Standard Operating Procedures）的角色[^27]。

官方儲存庫 `Unity-Technologies/skills` 提供了一套專業工具，確保專案操作嚴格遵循標準 API，而非放任 AI 模型「自行編造」無法運作的程式碼片段[^5]。不同於在工作階段初期全數載入的專案指引檔案，技能系統採用漸進式揭露（progressive disclosure）機制運作[^29]。在待機狀態下，系統前綴僅記錄技能的名稱與簡短描述（例如：需要設定內購時使用的 `implement-in-app-purchases`）。只有當使用者提出符合此描述的需求時，技能完整的 C# 程式碼區塊與互動指令才會被載入執行記憶體中，藉此大幅節省高達 98% 的維護成本[^30]。

透過命令列工具（CLI）進行的整合過程相當簡易。只要執行 `npx skills add Unity-Technologies/skills --agent claude-code` 指令，系統便能從 GitHub 複製原始碼；在 GLW 中，共用技能庫已標準化於 `.agents/skills/` 資料夾，並透過 `skills-lock.json` 鎖定上游 Unity-Technologies 技能版本[^5]。自此，Claude Code 將獲得以下強大能力：

| 代理技能名稱（Agent Skill） | 在 Unity 專案中的運作機制與執行能力 |
| :---- | :---- |
| **`unity-cli`** | 提供與 Unity Command Line 直接互動的介面。AI 無須開啟圖形介面，即可自動安裝 Unity Editor、建立空白專案、管理授權驗證（auth），以及組態無介面建置（headless builds）[^5]。 |
| **`unity-package-management`** | 自動化操作 Unity Package Manager（UPM）結構。該技能在持續整合（CI/CD）工作流程中直接透過 `PackageManager.Client` C# 函式呼叫來掃描、新增、移除與更新套件[^5]。 |
| **`build-live-game`** | 直接介接 Unity Gaming Services（UGS）平台。AI 自動處理玩家驗證（auth）、雲端存檔管理（cloud save）、伺服器端程式碼（cloud code）、排行榜設定（leaderboards）與遊戲內經濟系統（economy）等繁複流程[^5]。 |
| **`ui`（路由器）及其變體** | 如同智慧型路由器般運作。分析專案後自動將架構派送至三個專用技能之一：依 Flexbox 標準編譯 UXML/USS 的 `ui-uitk`、直接操作 Canvas 階層的 `ui-ugui`，或撰寫 Unity Editor 擴充功能的 `ui-imgui`[^5]。 |
| **`setup-multiplayer-services`** | 自動化設定網路基礎架構。透過 Unity Multiplayer Services 處理連線拓樸（topology）、對戰配對系統（matchmaking）以及工作階段／大廳管理（sessions/lobbies）[^5]。 |
| **`validate-urp-render-graph-renderer-feature`** | 在獨立 URP 專案中相當實用的技能；針對 GLW/HDRP，不將其作為自訂算繪的預設標準，而是優先採用 HDRP Custom Pass 與 `.claude/rules/rendering-rules.md` 規則。 |
| **`shader-graph-create-custom-node`** | 自動合成並處理 HLSL 原始碼，以撰寫相容於 Shader Graph 架構的多功能自訂節點（Custom Nodes）[^5]。 |

將這些技能的使用權限交給 AI，有助於精簡 `CLAUDE.md` 檔案。架構設計者不再需要撰寫數百行文字來說明如何設定 IronSource 廣告函式庫，只需安裝 `levelplay-unity-integration` 技能即可[^5]。當需求出現時，AI 代理便已備妥標準的檔案格式與最正確的實作路線，涵蓋從串接獎勵式廣告（rewarded ads）系統到插頁式廣告（interstitial ads）的各項設定[^5]。

## **適用於 Unity 6000.5 的圖形與非同步程式設計技術框架結構**

為了打造一套不會過時的專案指示集，必須深入探討 Unity 6000.5 版本系統核心的深層變革。從傳統程式設計模型過渡到新世代架構，要求原始碼不僅在現階段運作良好，還必須在行動裝置平台以及高階運算電腦上達到能源效率最佳化。

### **非同步程式設計：將控制權移交給 UnityEngine.Awaitable**

傳統 Unity 執行環境於單一執行緒（single thread）中運作，使得處理資源載入或 AI 運算等複雜任務時，存在導致整款遊戲凍結（freeze）的風險[^32]。過去，開發人員往往只能仰賴協程（Coroutine，在處理資料回傳結構時相當棘手，且會透過垃圾回收器 GC 對記憶體造成壓力）或 `System.Threading.Tasks.Task` 系統（一種物件配置成本高昂且未針對遊戲迴圈最佳化的類別結構）[^7]。

到了 Unity 6，平台提供了 `UnityEngine.Awaitable` 結構，這是一種專為最佳化電玩遊戲中 `async`/`await` 模式而設計的資料型別[^7]。`Awaitable` 的突破性特色在於其物件池（Object Pooling）機制；系統不再於每次呼叫時配置新的記憶體，而是從物件池中取出一個空物件加以使用，並在 `await` 呼叫完成後立即靜默清理以供重複利用[^7]。消除記憶體配置徹底解決了長期困擾最佳化工程師的垃圾回收延遲尖峰（GC spikes）問題[^7]。

這項結合帶來了卓越的效能，但同時也帶來了一條必須在 `.claude/rules/async.md` 規則檔中明確告誡 AI 模型的絕對限制：**嚴禁在同一個 `Awaitable` 物件上多次使用 `await` 指令**[^7]。當第一次呼叫結束時，該物件已經歸還至共用物件池，並可能已指派給另一個程序使用。若刻意對其進行第二次 `await`，將會導致未定義行為、造成程式執行緒鎖死或擲出底層例外狀況[^7]。

| 技術屬性 | `System.Threading.Tasks.Task` | 建議採用結構：`UnityEngine.Awaitable` |
| :---- | :---- | :---- |
| **記憶體配置（Allocation）** | 每次函式呼叫都會持續產生記憶體垃圾（GC）[^7]。 | 憑藉預設的物件池（Pool）設計，幾乎不產生記憶體配置[^7]。 |
| **呼叫重複利用（`await`）** | 允許在多處對同一個任務執行 `await`[^7]。 | **嚴格禁止。** 若 `await` 達兩次以上將引發記憶體損毀錯誤[^7]。 |
| **執行緒接續（Continuation）** | 通常會切換回 ThreadPool，當必須返回主執行緒時至少造成 1 個畫格的延遲[^7]。 | 當完成訊號發出時，於同一個畫格內立即同步執行[^7]。 |
| **執行緒生命週期控制** | 需要繁瑣的手動 `SynchronizationContext` 處理[^35]。 | 支援極速原生 API：`Awaitable.MainThreadAsync()` 與 `Awaitable.BackgroundThreadAsync()`[^7]。 |

此外，執行緒切換（thread switching）流程如今變得極為順暢。在撰寫程式的過程中，AI 代理可以透過 `await Awaitable.BackgroundThreadAsync()` 將尋路分析運算推往背景執行緒。當需要更新圖形介面或從 Unity 物件存取資料時，原始碼只需呼叫 `await Awaitable.MainThreadAsync()` 即可安全地將控制權交還主執行緒[^34]。這種即時切換能力讓開發人員能在不違反 Unity API 單執行緒存取原則的前提下，將 CPU 頻寬發揮到極致[^34]。針對動畫事件，Unity 6000.5 也新增了名為 `AnimationEventInfo` 的 `ref struct` 型別結構。這種阻絕動態記憶體配置的結構可在複雜的角色系統中管理事件而不留下記憶體垃圾，是高效能專案中應優先採用的最佳實務（best practice）[^39]。

### **全新圖形架構：卓越的 RenderGraph 與 Pass 區塊分化**

在過去十年間，Built-In Render Pipeline（BiRP）系統一直是 Unity 的圖形支柱。然而，其單體式架構已無法擴展以滿足現代跨平台最佳化的需求。自 Unity 6 起，專案可依據規模彈性選擇圖形平台：追求高度通用性的 **Universal Render Pipeline（URP）**，或追求 AAA 級視覺品質的 **High Definition Render Pipeline（HDRP）**。

無論採用 URP 或 HDRP，**Render Graph** 依舊是管線用來描述與最佳化算繪迴圈（render loop）的核心內部機制。關鍵在於 AI 代理必須辨識出專案正在執行哪一條管線，才能選用正確的 API：

- **若專案使用 URP**：必須使用 `ScriptableRendererFeature`、`ScriptableRenderPass`、`RecordRenderGraph`、`AddRasterRenderPass` 與 `ContextContainer`。
- **若專案使用 HDRP**：絕對不可使用上述 URP 的 API。取而代之的是，必須使用 HDRP Custom Pass 系統：`CustomPass`、`CustomPassVolume`、`FullScreenCustomPass`、`DrawRenderersCustomPass`、`CustomPassContext`，以及如 `CustomPassUtils`/`HDUtils` 等輔助工具。

AI 在處理與算繪相關的 ShaderGraph、HLSL 及 C# 程式碼時的職責，是嚴守已組態管線的邊界：使用正確的 include 函式庫、設定正確的著色器標籤（例如 `"RenderPipeline" = "UniversalPipeline"` 或 `"HDRenderPipeline"`），並套用正確的工作流程。

### **2D 物理系統更新與 Roslyn 編譯器標準化**

除了圖形之外，專案雖包含 `com.unity.modules.physicscore2d` 模組，但遊戲玩法腳本仍須優先使用經過驗證的公開 API，例如 `UnityEngine.Physics2D`、`Rigidbody2D`、`Collider2D` 與 `PhysicsScene2D`。在未比對目前已安裝 Editor/套件中的實際 API 前，AI 代理不得擅自將命名空間替換為 `Unity.U2D.Physics`，或為 Physics 2D 套用 `UNITY_6000_5_OR_NEWER` 保護條件。

同時，Unity 6 採用 Roslyn 編譯器，但目前的 GLW 專案組態所產生的 `.csproj` 檔案帶有 `<LangVersion>9.0</LangVersion>`。因此，在升級編譯器組態並驗證 Unity 編譯通過之前，AI 不得使用集合運算式（`List<int> values = [1, 2, 3];`）、展開運算子（`[..arrayA, ..arrayB]`）或一般 class/struct 的主要建構函式（primary constructors）等 C# 10+ / C# 12 語法。

## **2026-2027 策略願景：邁向 Unity 6.7 LTS 之路**

一套成功的架構原則不僅要解決眼前的課題，還必須為未來的版本更新預作籌謀。規劃於 2027 年第一季作為 Unity 6 世代收尾版本推出的 Unity 6.7 LTS 平台，在作業系統、直譯器與瀏覽器環境層面帶來了全面革新[^2]。AI 代理與軟體架構部門必須將這些認知納入原始碼評估標準之中。

最根本的轉變在於虛擬機器執行階段（Runtime）。在堅守 Mono 超過十年後，Unity 6.7 LTS 與 Unity 6.8 將把 CoreCLR 技術（微軟現代化的 .NET 執行時期）引進官方開發環境，作為電腦平台（Desktop Player）上取代 Mono 並輔助 IL2CPP 的系統[^8]。CoreCLR 不僅消除了對舊標準的依賴，還解決了網域重載（domain reload）的重大難題、強化垃圾回收效能並加速 ECS（Entity Component System）系統運作[^8]。由於這套新系統具備極高的記憶體效能最佳化特性，繼續維持隨意進行動態配置的 C# 程式碼將會產生反效果。

針對底層作業系統環境，自 6.7 LTS 起，Unity 的 Windows Player 發行版本將改變函式庫的連結方式。可執行檔不再靜態封裝整套 Microsoft Visual C++ 函式庫，而是透過 `vcruntime140.dll` 與 `msvcp140.dll` 發行套件進行動態連結[^60]。這項變動要求安裝檔封裝系統（Patchers/Installers）中的持續整合（CI/CD）流程必須確保 C++ Redistributable 函式庫與 `UnityPlayer.dll` 可執行檔同步釋出[^60]。XR（延展實境）領域也將在 6.7 版本見證過時的 OculusXR 套件完全退場，讓位給跨裝置的 OpenXR Meta 平台[^60]。

網頁應用市場也迎來了驚人的突破。Unity 6.7 LTS 預期將以 WebGPU 架構樹立全新的生產標準，其處理平行算繪呼叫的效率比傳統 WebGL 高出數十倍[^2]。過去受限於 4GB 嚴格上限的瀏覽器記憶體瓶頸，也將隨著 WASM64 編譯器的登場而徹底解除，把複雜網頁應用的記憶體配置上限擴展至高達 16GB[^2]。漸進式資源載入（Progressive asset loading）功能預計可將遊戲在瀏覽器中的啟動時間縮減高達 40%[^57]。這些工具讓圖形團隊得以大膽拉高表面紋理的解析度，而不必擔心應用程式因過載而當機。

## **實務部署藍圖與分層系統治理**

將記憶體結構與編碼標準落實至分散式 AI 系統中，需要嚴謹的版本控制流程。應用這項技術並非把所有指令都寫進同一個檔案，而是將資料分區，以契合 Claude Code 的語境蒐集演算法。以下流程勾勒出適合大型 Unity 應用程式開發團隊由上而下（top-down）的部署模型。

**步驟 1：建立共用運作系統治理（架構師行動）** 首先，必須為開發系統設定適當的權限。在 `.claude/settings.json` 檔案中宣告安全指令，能讓 AI 自動執行驗證任務（例如 `dotnet format` 或 `Bash(npm run *)`），而不會因手動安全警告而中斷[^62]。該檔案中不可或缺的一項調整是設定 `claudeMdExcludes`[^63]。透過指定排除區域（例如 `**/Library/**` 與 `**/Packages/ThirdParty/**`），系統將防止 AI 掃描存放外部資產套件的資料夾，避免誤載入屬於開源生態系的 `CLAUDE.md` 檔案而破壞 Prompt Caching 機制[^63]。同時，專屬於個別工程師的規則或本機裝置測試路由字串，應儲存於 `.claude/CLAUDE.local.md` 檔案中，且此檔案必須加入版本控制系統的忽略清單（`.gitignore`）[^13]。

**步驟 2：建置不可變前綴（維持約 150 行左右）** 位於根目錄（Root Directory）的 `CLAUDE.md` 檔案必須扮演專案「憲法」的角色，負責建立 AI 絕不允許偏離的核心認知[^14]。該檔案將明確宣告本專案使用搭配 URP 或 HDRP 的 Unity 6000.5 與 C# 9.0，嚴格要求所有非同步呼叫皆須採用 `Awaitable` 程式設計結構，禁止在 `Update()` 更新迴圈中使用會產生垃圾的動態配置程式碼（allocating code），並遵守 RPG Builder、Malbers、Survival Engine 與 Farming Engine 之間的權責劃分。任何超出此框架的繁瑣說明或專業編碼知識都將予以精簡，讓前綴區段盡可能維持輕量[^16]。此檔案將提交（commit）至原始碼伺服器，使全體隊友的複本（clone）皆能繼承共通的架構規範。

**步驟 3：建立依語境觸發的規則網路（`.claude/rules`）** 針對龐大的深度知識——例如使用 HLSL 撰寫 Shader 的指南、Custom Render Pass（針對 URP/HDRP），或使用 UI Toolkit 建構介面的規定——必須將其隔離為模組化規則形式。在 `.claude/rules/` 資料夾內，每份文字檔案（例如 `rendering-rules.md`）都將搭配一個包含 `paths:` 關鍵字的 YAML frontmatter 資料結構（以三個連字號開頭的標頭區塊）。藉由填入諸如 `paths: ["**/*CustomPass*.cs"]` 的路徑匹配運算式，深層的算繪指令僅在開發人員要求 AI 操作圖形功能模組時才會送入語境視窗。當切換至撰寫遊戲伺服器或資料驗證系統時，這塊圖形知識仍維持「休眠」，不會浪費龐大的 token 成本[^19]。

**步驟 4：嵌入技能協定（Agent Skills）** 當儲存系統穩定後，專案需要解決與平台及控制環境溝通的課題。架構師將開啟命令列工具，執行 `npx skills add Unity-Technologies/skills --agent claude-code` 指令直接從 GitHub 下載 `SKILL.md` 檔案與腳本程式碼，隨後將 GLW 的共用技能庫標準化於 `.agents/skills/` 資料夾。從這一刻起，當面臨「透過 UPM 安裝 Unity In-App Purchasing 函式庫」或「透過 Multiplayer Services 設定遊戲伺服器」等繁瑣程序性任務時，Claude Code 模型無須自行閱讀文件，也無須猜測指令結構。它將利用技能描述（description-as-trigger），透過漸進式揭露機制自動比對、載入並執行既有的腳本，以完美且符合規範的準確度達成請求[^30]。

**步驟 5：知識流轉生命週期（萃取自動記憶）** 運作流程並不會在組態完成後便畫下句點。每週當模型持續解決各項任務時，它會自動將「血淚經驗」記錄到自動記憶系統的 `MEMORY.md` 資料夾中[^17]。例如發現某些舊版 Unity 呼叫方法因 6000.5 版本的相容性斷裂而發生錯誤。技術管理專家必須使用 `/memory` 指令來檢視 AI 自動彙整的內容[^20]。由於在多執行緒（multi-agent）條件下容易遭覆寫、發生資料競爭，以及在語境壓縮（compaction）後易遺失，任何具備長期策略價值的規律都必須經過人工萃取，改寫為精煉的指示並反向更新至 `.claude/rules/*.md` 的不可變規則檔案中[^22]。透過這種方式，專案的「短期記憶」將被鞏固為系統的「長期知識」，以最穩固的姿態迎接即將到來的 Unity 6.7 LTS 發行版本中的底層大改造。

---

## **參考文獻**

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

### 延伸閱讀

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
