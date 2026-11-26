---
title: "Unity 6向けCLAUDE.mdアーキテクチャ導入戦略計画：Prompt Cachingの最適化、自動スキルの統合、および6.7 LTSへのアップデートロードマップ"
date: 2026-11-25 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, claude-code, ai-agents, prompt-caching, coreclr, render-graph, awaitable, gilongworld]
description: Unity 6（6000.5から6.7 LTS）プロジェクト向けの階層型CLAUDE.mdアーキテクチャ設計戦略。Prompt Cachingによる90%のコスト削減、Agent Skills統合、およびAwaitable非同期ルールを解説します。
lang: ja
translation_id: unity6-claude-md-prompt-caching-skills
---

ソフトウェア開発における生成AIとリアルタイムグラフィックスエンジンの融合は、ビデオゲームおよびインタラクティブアプリケーション産業の制作手法全体を再構築しつつあります。このエコシステムの中で、Claude Codeは洗練された階層型コンテキスト管理アーキテクチャによって駆動される先進的なコマンドラインコーディングエージェントとして台頭しています。この振る舞い誘導システムの中核に位置するのが設定ファイル `CLAUDE.md` であり、AIエージェントが常に組織のエンジニアリング標準の枠組みに従って動作することを保証するプロジェクトメタデータリポジトリとして機能します[^1]。同時に、UnityプラットフォームはUnity 6リリーストレインによって世代的な転換点を迎えています。現行の `6000.5` バージョンは単なる機能アップデートではなく、レガシーシステムの終了を告げ、2027年初頭にリリースが予定されている長期サポート版（Long-Term Support）Unity 6.7 LTSの基盤を築く大規模なコア再構築です[^2]。

Unity 6の継続的な変化に適応する `CLAUDE.md` 構造を構築するには、3つの複雑な技術的柱を組み合わせる必要があります。第一に、技術的コンテキストを損なうことなく長時間の作業セッションにおける計算リソース（トークン）コストを徹底的に削減するため、AnthropicのPrompt Cachingシステムを制御・最適化することです[^3]。第二に、`Unity-Technologies/skills` リポジトリを通じてエージェントスキル（Agent Skills）エコシステムを統合し、静的メモリを肥大化させることなくUnityのコマンドラインインターフェースとの自動連携能力を最大限に引き出すことです[^5]。第三に、`Awaitable` を用いた非同期プログラミング、RenderGraphグラフィックスアーキテクチャ、そしてCoreCLRサポートのロードマップに至るまで、Unity 6000.5の最新技術メカニズムを深く理解し、プロジェクトが6.7 LTSバージョンへ移行する際にも陳腐化しない正確なAIガイドラインルールを構築することです[^6]。本包括的分析は、将来の変化に対して柔軟かつ高性能で同期された開発環境を実現するための戦略的計画を描き出します。

## **Claude CodeにおけるプレフィックスメモリのダイナミクスとPrompt Caching最適化の分析**

巨大なソースコードリポジトリで大規模言語モデル（LLM）を運用する際の中核的な課題は、コンテキストドリフト（context drift）現象と処理コストの指数関数的な増大です。Claude Codeは、Prompt Cachingと呼ばれる基盤アーキテクチャ機構によってこの問題を解決します。この機能は、モデルがプレフィックス（prefix）テキストセグメントを読み取り解析する過程で生成する中間数学行列（特にKVキャッシュメモリ内のKeyおよびValue行列）を保存しておくことで機能します[^3]。

開発環境で運用する際、初回のキャッシュ書き込み（cache write）には、有効期間（TTL）が5分のキャッシュ構成では通常のトークン処理より25%高いコストが、TTLが1時間の構成では基本コストの2倍がかかります[^4]。しかし、真の価値は後続のキャッシュ読み取り（cache read）にあり、消費コストは基本価格の約10%にまで低下し、プロジェクトコンテキスト全体で最大90%のコスト削減を実現します[^4]。この仕組みを機能させるには、入力構造がプレフィックス一致制約（prefix match constraint）のルールを絶対的に満たす必要があります。テキスト文字列内でたとえ1バイト、あるいは空白文字1つでも変更が生じると、その地点以降のすべてのキャッシュメモリが即座に無効化され、システムは最初から行列演算を再計算せざるを得なくなります[^3]。

この厳格さを踏まえ、Claude Codeはサーバーへ送信するプロンプトのレイアウト（prompt layout）を安定性の高い順から低い順へと並べるように設計されています。データブロックは固定のSystem Prompt（約4,000トークン）から始まり、ツール定義（Tool Definitions）が続き、その後に `CLAUDE.md` ファイルの内容が配置され、最後に動的な会話履歴で締めくくられます[^3]。この順序のおかげで、同一システム内の複数ユーザーはSystem Promptのキャッシュを共有でき、同じソースコードリポジトリで作業するエンジニア同士は `CLAUDE.md` ファイルのキャッシュを共有できます[^3]。日付の変更やgitステータス更新結果といったリアルタイムの変動からこのプレフィックスを守るため、Claude CodeはSystem Promptを直接編集することは決してありません。代わりに、これらの動的データを文字列末尾の最新ユーザーメッセージ内にあるセマンティックタグ `<system-reminder>` に格納し、上部の高価なプレフィックスが乱されないように保護しています[^3]。

規律あるセッション管理こそが、キャッシュメモリへの投資を守る鍵となります。開発者が日常的に行う多くの操作が意図せずこの構造を破壊し、不要なコスト急増を引き起こす可能性があります。

| 開発者の操作 | コンテキスト（Context）構造への影響 | Prompt Cacheの状態 |
| :---- | :---- | :---- |
| **セッション途中での `CLAUDE.md` ファイル編集** | システムプレフィックスの静的領域を直接変更する。 | キャッシュ全体が完全に無効化され、ゼロからの再計算が強制される（Cache Miss）[^10]。 |
| **EffortレベルまたはFast Modeの変更** | セッション初期化領域に新しい設定パラメータやヘッダータグを挿入する。 | パラメータがキャッシュキー（Cache Key）の一部であるため、まったく新しいキャッシュチェーンが初期化される[^4]。 |
| **コンテキスト整理のための `/compact` コマンド** | メモリ空間を解放するために会話履歴を切り詰めて要約する。 | 再構築された会話履歴がブレークポイント（Breakpoint）以降の構造を変えるため、古いキャッシュが無効化される[^1]。 |
| **モデル構成の切り替え（Model Switching）** | Claude 3.5 SonnetとClaude 3 Opus間の切り替え。 | 各モデルのKV行列構造が異なり共有できないため、キャッシュが失われる[^3]。 |
| **MCP Serverツールの動的ロード** | 送信ペイロード先頭の静的ツール一覧を再宣言する。 | ツール定義が変化するため、ルートプレフィックスが無効化される[^3]。 |

パフォーマンスを維持するには、メモリ機構とスマートなコマンド構造設計を組み合わせる必要があります。Claude CodeのPlan Modeは、機械学習を考慮した最適化の好例です。AIを読み取り専用状態にするためにコード編集可能なツールを取り外すとツール定義が変化してキャッシュが壊れてしまうため、Claude Codeはプレフィックス構造内のすべてのツールをそのまま維持します。起動時から `EnterPlanMode` と `ExitPlanMode` という2つの新ツールを追加しておくだけで、同時に会話履歴へモデルに編集を実行させない指示を追加します[^3]。これにより、キャッシュ読み取りによる90%割引を失うことなくシームレスな状態遷移が可能になります。Unity 6の計画を立てる際、プロジェクト管理者はこれらのメカニズムを精査し、あらゆるルールが適切な位置とタイミングで読み込まれるようにしなければなりません。

## **ゲーム開発エコシステムのための階層型メモリフレームワーク戦略**

Claude Codeの指示リポジトリは単一のテキストファイルに限定されず、6段階の優先順位を持つ設定解決階層（resolution hierarchy）システムを通じて運用されています。このシステムには、エンタープライズ向け管理ポリシー（Managed Policy）、ユーザーグローバル設定、プロジェクト単位設定、個人ローカル設定、ファイルパスに基づくルール、そして最後にAIが自ら統合する自動メモリが含まれます[^1]。このアーキテクチャにおいて優先度は「狭から広へ」の原則に従い、競合が発生した場合はローカルレベルやサブディレクトリの詳細な設定がグローバル設定を上書きします[^13]。

システムの中心に位置するのは、プロジェクトのルートディレクトリにある `CLAUDE.md` ファイルです。ここはゲームの環境、プログラミング言語、レンダリングシステム、および基盤アーキテクチャを定義する不変のルールを格納する場所です[^14]。開発者はエージェントのあらゆる振る舞いを制御しようとして、数千行にも及ぶ長大な設定ファイルを作成する傾向があります。しかし、1,650件のClaude Code作業セッションを対象とした大規模研究は、このファイル構造に関する多くの通説を覆しました。分析の結果、ファイルの長さ（25行から500行）の変更、ルールの配置位置（ファイルの先頭、中間、末尾）の変更、さらには相互読み込み構文（imports）によるファイル分割でさえも、AIの遵守率に統計的に有意な差を生まないことが判明しました[^16]。実質的な成否を分ける決定的な要因はタスクの性質にあります。モデルはまったく新しいコードを生成する際には最大71.3%の確率でルールに従いますが、既存コードを編集する際にはその割合が45.1%へと急落します。これは、画面上に存在する既存のコード自体がルールファイルと競合するコンテキストを形成してしまうためです[^16]。

したがって、`CLAUDE.md` ファイルを200行未満に保つという推奨事項は、ソフトウェア上の強制切り捨て境界（truncation point）ではなく、データのクリーンさを保つためのソフトターゲット（soft target）にすぎません[^16]。実際の200行切り捨て制限は、自動メモリ（Auto Memory）システムのインデックスファイルである `MEMORY.md` に対して適用されています[^16]。

| 設定管理レイヤー | 実際のパス / 保存場所 | Unityプロジェクトにおける役割 | Gitシステムでの追跡状態 |
| :---- | :---- | :---- | :---- |
| **ユーザーレベルルール（User Global）** | `~/.claude/CLAUDE.md` | 開発者個人の好み（例：エラー報告のスタイル、コードフォーマットの優先設定）[^13]。 | 追跡対象外（マシンローカル）[^13]。 |
| **プロジェクト中核ルール（Project Root）** | `./CLAUDE.md` | チーム全体で共有される設定（例：HDRP要件、C# 9.0、エンジンアーキテクチャ、標準パス名）[^13]。 | 追跡および共有（Committed）[^13]。 |
| **個人上書きルール（Project Local）** | `./.claude/CLAUDE.local.md` | 一時的なメモ、開発者マシン固有のテスト情報、ローカル開発サーバー接続文字列[^13]。 | `.gitignore` により除外（Ignored）[^13]。 |
| **パス指定ルール（Modular Rules）** | `paths:` を含む `.claude/rules/*.md` | サブシステム向け設定（例：`**/*CustomPass*.cs` にはHDRP Custom Passルール、`**/*Editor.cs` にはUI Toolkitルールを適用）[^13]。 | 追跡および共有（Committed）[^19]。 |
| **自動メモリ（Auto Memory）** | `~/.claude/projects/<id>/memory/MEMORY.md` | デバッグ手法、ライブラリ履歴、セッション中に繰り返されたミスについてAIが自動集約した知見[^17]。 | 追跡対象外（ローカルに分散保存）[^17]。 |

しばしば誤解されるコンポーネントの1つが自動メモリ（Auto Memory）システムです。コンテキストの重複問題を解消するために生まれたこの機能は、Claude Codeが反復的なコーディング習慣を検知した際、個人設定ディレクトリへMarkdownファイルを自動的に書き込みます[^17]。しかし、作業分割機構（worktrees）を用いて同一コードベース上で並行稼働するマルチエージェントチーム（multi-agent teams）環境では、自動メモリの致命的な弱点が露呈します。すなわち、スレッドセーフではない（not thread-safe）という点です[^22]。複数のエージェントが同時に `MEMORY.md` ファイルへ上書きを試みることで、バージョン競合（race condition）によるデータ損失が発生します[^22]。さらに、コンテキスト圧縮（compaction）の過程を経て、不要または不正確なメモが生き残り、元の指示と同等の高い優先度を獲得してしまうため、エージェントが自信満々に誤ったルールを提示する現象を引き起こします[^23]。自動メモリから有用な知見を精査し、恒久的なモジュラールール（Modular Rules）システムへと移管することは必須のガバナンス手順です。

モジュラールールシステム `.claude/rules/` は、Unityアーキテクチャの複雑性を扱うための理想的なツールです。YAMLフロントマターの `paths:` セクションでグロブパターン（glob patterns）を用いることで、設計者はAIが `.shader` または `.hlsl` ファイルを扱うときにのみShaderプログラミングルールが読み込まれるよう設定できます[^19]。`paths:` 属性がない場合、ファイルは `CLAUDE.md` と同様に毎セッション自動ロードされ、コンテキスト飽和（context saturation）のリスクを招きます[^19]。特にマルチツール互換性も推奨されます。チームがすでに `AGENTS.md`（他の数十のエージェントがサポートするオープン標準）を維持している場合、ベストプラクティスは全体を書き直すことではなく、`CLAUDE.md` 内で相互読み込み構文 `@AGENTS.md` を使用して情報をシームレスに連結し、単一の信頼できる情報源（single source of truth）を構築することです[^1]。

## **Unity-Technologies/skills エコシステムによるワークフロー自動化**

完璧なプロジェクトアーキテクチャは指針を示すだけでなく、強力な実行権限も与えなければなりません。`skills.sh` プロトコルを利用することで、AIエージェントは自然言語処理の枠を超え、システムを実際に制御する主体へと進化します[^27]。エージェントスキル（Agent Skills）ディレクトリには、コマンド構造と `SKILL.md` メタデータを含むパッケージ化された振る舞い群が格納されており、標準作業手順書（Standard Operating Procedures）として機能します[^27]。

公式リポジトリ `Unity-Technologies/skills` は、AIモデルが実行不可能なコードを「捏造」するのではなく、プロジェクト操作が標準APIを厳格に遵守することを保証する専門ツール群を提供します[^5]。セッション開始時に全体が読み込まれるプロジェクト指示ファイルとは異なり、スキルシステムは段階的開示（progressive disclosure）メカニズムで動作します[^29]。待機状態では、システムプレフィックスにはスキルの名前と簡潔な説明のみが登録されます（例：IAP設定時に使用する `implement-in-app-purchases`）。ユーザーがこの説明に一致するリクエストを行ったときにのみ、そのスキルのC#コードブロック全体と連携コマンドが実行メモリに投入され、維持コストを最大98%も大幅に節約します[^30]。

統合プロセスはコマンドラインツール（CLI）を通じて極めて簡単に行えます。`npx skills add Unity-Technologies/skills --agent claude-code` コマンドを実行すればGitHubからソースコードを複製でき、GLWでは共有スキルリポジトリが `.agents/skills/` ディレクトリに標準化され、`skills-lock.json` がアップストリームのUnity-Technologiesスキルを固定（pin）します[^5]。これにより、Claude Codeは以下の高度な機能へとアップグレードされます。

| スキル名（Agent Skill） | Unityプロジェクトにおける動作メカニズムと実行能力 |
| :---- | :---- |
| **`unity-cli`** | Unity Command Lineと直接やり取りするインターフェースを提供します。グラフィカルインターフェースを開くことなく、AIが自動でUnity Editorのインストール、空プロジェクトの初期化、ライセンス認証（auth）管理、ヘッドレスビルド（headless builds）の構成を行えます[^5]。 |
| **`unity-package-management`** | Unity Package Manager（UPM）構造に対する自動操作を行います。C#の `PackageManager.Client` 呼び出し関数を使用し、継続的インテグレーション（CI/CD）ワークフロー内でパッケージのスキャン、追加、削除、更新を実行します[^5]。 |
| **`build-live-game`** | Unity Gaming Services（UGS）プラットフォームに直接接続します。AIがプレイヤー認証（auth）、クラウドセーブ（cloud save）、サーバーコード（cloud code）、リーダーボード（leaderboards）、ゲーム内経済システム（economy）の設定といった複雑なフローを自動処理します[^5]。 |
| **`ui`（Router）およびバリエーション** | インテリジェントなスイッチとして機能します。プロジェクトを解析し、Flexbox準拠のUXML/USSコンパイル用の `ui-uitk`、Canvas階層を直接操作する `ui-ugui`、またはUnity Editor拡張プログラミング用の `ui-imgui` という3つの専門スキルのいずれかへ自動的に処理をルーティングします[^5]。 |
| **`setup-multiplayer-services`** | ネットワークインフラの構成を自動化します。Unity Multiplayer Servicesを通じてトポロジー（topology）、マッチメイキング（matchmaking）、セッション/ロビー（sessions/lobbies）管理を解決します[^5]。 |
| **`validate-urp-render-graph-renderer-feature`** | 独立したURPプロジェクトで作業する際に有用なスキルです。GLW/HDRP環境ではカスタムレンダリングのデフォルト標準としては使用せず、HDRP Custom Passと `.claude/rules/rendering-rules.md` ルールを優先します。 |
| **`shader-graph-create-custom-node`** | Shader Graphアーキテクチャと互換性のある汎用カスタムノード（Custom Nodes）を記述するため、HLSLソースコードを自動生成および処理します[^5]。 |

これらのスキル活用をAIに委任することで、`CLAUDE.md` ファイルをスリム化できます。IronSource広告ライブラリの設定方法を何百行も書く代わりに、アーキテクトは `levelplay-unity-integration` スキルをインストールするだけで済みます[^5]。リクエストが出されると、AIエージェントはリワード広告（rewarded ads）の連携からインタースティシャル広告バナー（interstitial ads）に至るまで、標準的なファイル形式と最適な実装手順を即座に利用できます[^5]。

## **Unity 6000.5向けグラフィックスおよび非同期プログラミング技術フレームワーク構造**

陳腐化しないプロジェクト指示セットを作成するには、Unity 6000.5のシステム中核における深い変革を掘り下げる必要があります。レガシーなプログラミングモデルから次世代アーキテクチャへの移行では、ソースコードが現在正常に動作するだけでなく、モバイルデバイスおよびハイスペックPCプラットフォームの双方で省電力・高効率に動作することが求められます。

### **非同期プログラミング：UnityEngine.Awaitableへの権限移譲**

従来のUnity実行環境はシングルスレッド（single thread）で動作するため、アセットの読み込みやAI計算のような重い処理を扱うとゲーム全体が停止（freeze）するリスクがありました[^32]。これまで開発者は、Coroutine（戻り値構造の扱いが難しくガベージコレクタGCにメモリ負荷をかける）や `System.Threading.Tasks.Task`（ゲームループ向けに最適化されていない高コストなオブジェクト割り当て構造）に頼らざるを得ませんでした[^7]。

Unity 6では、ビデオゲームにおける `async`/`await` モデルを最適化するために専用設計されたデータ型 `UnityEngine.Awaitable` 構造体が提供されます[^7]。`Awaitable` の画期的な特徴はオブジェクトプーリング（Object Pooling）による再利用メカニズムにあります。呼び出されるたびに新しいメモリを割り当てるのではなく、システムがプールから空のオブジェクトを取得して使用し、`await` 呼び出しが完了した直後に静かにクリーンアップして再利用のために返却します[^7]。このメモリ割り当ての排除により、最適化エンジニアを悩ませていたガベージコレクションによる遅延（GC spikes）問題が完全に解消されます[^7]。

この仕組みは圧倒的なパフォーマンスをもたらしますが、ルールファイル `.claude/rules/async.md` においてAIモデルに対し明確に警告すべき絶対的な制約を伴います：**同一の `Awaitable` オブジェクトに対して `await` 命令を複数回使用することは絶対に許されません**[^7]。最初の呼び出しが終了した時点で、そのオブジェクトはすでに共有プールへ返却されており、別の処理に割り当てられている可能性があります。意図的に2回目の `await` を実行すると未定義の動作を引き起こし、プログラムスレッドのハングや低レベル例外の送出につながります[^7]。

| 技術的特性 | `System.Threading.Tasks.Task` | 推奨構造：`UnityEngine.Awaitable` |
| :---- | :---- | :---- |
| **メモリ割り当て（Allocation）** | 関数呼び出しごとに継続的にメモリガベージ（GC）を生成する[^7]。 | デフォルトのプール（Pool）設計により、メモリ割り当てがほぼゼロ[^7]。 |
| **呼び出しの再利用（`await`）** | 同じタスクを複数箇所で `await` できる[^7]。 | **厳禁**。2回以上 `await` するとメモリ破損エラーを引き起こす[^7]。 |
| **スレッド継続（Continuation）** | 通常ThreadPoolへ切り替わり、メインスレッドへ戻る際に最低1フレームの遅延が生じる[^7]。 | 完了シグナルが発行された瞬間に、同一フレーム内で同期的に実行される[^7]。 |
| **スレッドライフサイクル制御** | 複雑な手動の `SynchronizationContext` 処理が必要[^35]。 | 超高速なネイティブAPIをサポート：`Awaitable.MainThreadAsync()` および `Awaitable.BackgroundThreadAsync()`[^7]。 |

さらに、スレッド切り替え（thread switching）の手順も極めてスムーズになりました。プログラミングにおいて、AIエージェントは `await Awaitable.BackgroundThreadAsync()` を通じて経路探索などの計算をバックグラウンドスレッドへ逃がすことができます。グラフィカルインターフェースの更新やUnityオブジェクトからのデータ取得が必要になった際には、コード上で `await Awaitable.MainThreadAsync()` を呼び出すだけで安全にメインスレッドへ制御権を戻せます[^34]。この即時スイッチング能力により、Unity APIのシングルスレッドアクセス原則に違反することなくCPU帯域幅を最大化できます[^34]。アニメーションイベントについては、Unity 6000.5で `AnimationEventInfo` という `ref struct` 型の構造体も追加されました。動的メモリ割り当てを防ぐこの構造体により、複雑なキャラクターシステムでもメモリガベージを残さずにイベント管理を行うことができ、高パフォーマンスプロジェクトで優先すべきベストプラクティスとなっています[^39]。

### **新グラフィックスアーキテクチャ：卓越したRenderGraphとPassコマンドブロックの分化**

過去10年間、Built-In Render Pipeline（BiRP）はUnityグラフィックスの柱でした。しかし、そのモノリシックなアーキテクチャは現代のマルチプラットフォーム最適化の要求に応えるだけの拡張性を備えていませんでした。Unity 6以降、プロジェクトは規模に応じて汎用性の高い **Universal Render Pipeline（URP）**、またはAAA級ビジュアル品質のための **High Definition Render Pipeline（HDRP）** のいずれかのグラフィックスプラットフォームを柔軟に選択できます。

URPとHDRPのどちらを使用する場合でも、**Render Graph** はパイプラインがレンダリングループ（render loop）を記述・最適化するための中核的な内部メカニズムです。重要な点は、AIエージェントがプロジェクトで稼働しているパイプラインを正確に識別し、適切なAPIを使用することです：

- **プロジェクトがURPを使用している場合**：`ScriptableRendererFeature`、`ScriptableRenderPass`、`RecordRenderGraph`、`AddRasterRenderPass`、および `ContextContainer` を使用しなければなりません。
- **プロジェクトがHDRPを使用している場合**：上記のURP APIを絶対に使用してはなりません。代わりにHDRP Custom Passシステムである `CustomPass`、`CustomPassVolume`、`FullScreenCustomPass`、`DrawRenderersCustomPass`、`CustomPassContext`、および `CustomPassUtils`/`HDUtils` のようなヘルパーを使用する必要があります。

レンダリングに関連するShaderGraph、HLSL、およびC#を扱う際のAIの責務は、構成されたパイプラインの境界を厳格に守ることです。すなわち、正しいインクルードライブラリを使用し、適切なシェーダータグ（`"RenderPipeline" = "UniversalPipeline"` または `"HDRenderPipeline"` など）を設定し、正しいワークフローを適用しなければなりません。

### **2D物理システムのアップデートとRoslynコンパイラの標準化**

グラフィックスに加え、プロジェクトには `com.unity.modules.physicscore2d` モジュールが含まれていますが、ゲームプレイスクリプトは引き続き `UnityEngine.Physics2D`、`Rigidbody2D`、`Collider2D`、`PhysicsScene2D` といった検証済みの公開APIを優先して使用する必要があります。AIエージェントは、インストールされているEditor/パッケージ内の実APIと照合することなく、名前空間を自動的に `Unity.U2D.Physics` へ変更したり、Physics 2Dに対して `UNITY_6000_5_OR_NEWER` ガードを適用したりしてはなりません。

同時に、Unity 6はRoslynコンパイラを採用していますが、現在のGLWプロジェクト設定では `<LangVersion>9.0</LangVersion>` で `.csproj` が生成されています。そのため、コンパイラ設定がアップグレードされUnityでのコンパイルが検証されるまでは、コレクション式（`List<int> values = [1, 2, 3];`）、スプレッド演算子（`[..arrayA, ..arrayB]`）、あるいは通常のclass/struct向けのプライマリコンストラクタ（primary constructors）といったC# 10+ / C# 12の構文をAIが使用してはなりません。

## **2026–2027年戦略ビジョン：Unity 6.7 LTSへのロードマップ**

成功するアーキテクチャ原則とは、現在の課題を解決するだけでなく将来のアップデートを見据えたものでなければなりません。2027年第1四半期にUnity 6世代の集大成となるリリースとして計画されているUnity 6.7 LTSプラットフォームは、OSレベル、インタープリタ、そしてブラウザ環境における刷新をもたらします[^2]。AIエージェントおよびソフトウェアアーキテクチャ部門は、これらの知見をソースコードレビュー基準に組み込む必要があります。

最も根本的な変化は仮想マシンランタイム（Runtime）にあります。10年以上にわたるMonoの採用を経て、Unity 6.7 LTSおよびUnity 6.8は、デスクトッププラットフォーム（Desktop Player）においてレガシーなMonoを置き換え、IL2CPPを補完する公式開発環境としてMicrosoftのモダンな.NET実行基盤であるCoreCLR技術を導入します[^8]。CoreCLRは旧来標準への依存を断ち切るだけでなく、ドメインリロード（domain reload）という大きな課題を解決し、ガベージコレクション性能を強化し、ECS（Entity Component System）システムを高速化します[^8]。この新システムの極めて高いメモリ効率最適化の特性上、無秩序に動的メモリ割り当てを行うC#コードを維持することは逆効果となります。

コアOS環境に関しては、6.7 LTS以降、UnityのWindows Playerビルドはライブラリのリンク方式を変更します。Microsoft Visual C++ライブラリ全体を静的パッケージングする代わりに、実行ファイルは `vcruntime140.dll` および `msvcp140.dll` ディストリビューションを介して動的リンクするようになります[^60]。この変更により、インストーラ作成システム（Patchers/Installers）の継続的インテグレーション（CI/CD）フローでは、`UnityPlayer.dll` 実行ファイルと並行してC++ Redistributableライブラリが確実に配布されるよう担保する必要があります[^60]。XR（拡張現実）分野でも、旧式のOculusXRパッケージが6.7で完全に姿を消し、マルチデバイス対応プラットフォームであるOpenXR Metaへ移行します[^60]。

Webベースアプリケーション市場でも目覚ましいブレークスルーが起きます。Unity 6.7 LTSは、従来のWebGLよりも並列ドローコールを数十倍効率的に処理できるWebGPUアーキテクチャによって新たなプロダクション標準を確立すると期待されています[^2]。4GBに厳しく制限されていたブラウザメモリのボトルネックは、WASM64コンパイラの登場によって完全に解消され、複雑なWebアプリケーションのメモリ割り当て上限が最大16GBまで拡張されます[^2]。プログレッシブアセットローディング（Progressive asset loading）機能により、ブラウザ上でのゲーム起動時間が最大40%短縮される見込みです[^57]。これらはグラフィックスチームがメモリ過負荷によるクラッシュを恐れることなくテクスチャ解像度を大幅に引き上げることを可能にするツール群です。

## **実践的導入ロードマップと階層型システムガバナンス**

分散型AIシステムへメモリ構造とコーディング規範を導入するには、厳格なバージョン管理プロセスが不可欠です。この技術の活用とは、すべての指示を1つのファイルに詰め込むことではなく、Claude Codeのコンテキスト収集アルゴリズムに適合するようデータを分割することです。以下のプロセスは、大規模なUnityアプリケーション制作チームに適したトップダウン型導入モデルを示します。

**ステップ1：共通運用ガバナンスの確立（アーキテクトの対応）** まず、開発システムに適切な権限を設定する必要があります。`.claude/settings.json` ファイル内に安全なコマンドを宣言することで、AIは手動のセキュリティ警告で中断されることなく検証タスク（`dotnet format` や `Bash(npm run *)` など）を自動実行できるようになります[^62]。このファイルで欠かせない設定が `claudeMdExcludes` です[^63]。除外領域（例：`**/Library/**` や `**/Packages/ThirdParty/**`）を指定することで、システムが外部アセットパッケージを含むディレクトリをスキャンするのを防ぎ、オープンソースエコシステム由来の `CLAUDE.md` ファイルを誤って読み込んでPrompt Caching機構を破壊する事態を回避します[^63]。同時に、エンジニア個人向けのルールやローカル端末テスト用のルーティング文字列は `.claude/CLAUDE.local.md` ファイルに保存し、このファイルをバージョン管理システムの無視リスト（`.gitignore`）に追加する必要があります[^13]。

**ステップ2：不変プレフィックスの構築（約150行程度を維持）** ルートディレクトリ（Root Directory）の `CLAUDE.md` ファイルは、AIが決して逸脱してはならない中核的認識を確立するプロジェクトの「憲法」として機能しなければなりません[^14]。このファイルでは、プロジェクトがURPまたはHDRPおよびC# 9.0を用いたUnity 6000.5を使用していることを明確に宣言し、すべての非同期呼び出しに `Awaitable` 構造を必須とし、`Update()` 更新ループ内でのガベージを発生させる動的割り当てコード（allocating code）の使用を禁止し、RPG Builder、Malbers、Survival Engine、およびFarming Engine間の権限境界を遵守することを定めます。この枠組みを超える複雑な解説や専門的なコーディング知識はすべて削ぎ落とし、プレフィックス領域を可能な限り軽量に保ちます[^16]。このファイルはリポジトリへコミット（commit）され、チーム全員のクローン（clone）が共通アーキテクチャを継承できるようにします。

**ステップ3：コンテキスト駆動ルールネットワークの構築（`.claude/rules`）** HLSLを用いたShaderプログラミングガイド、Custom Render Pass（URP/HDRP向け）、あるいはUI ToolkitでのUI構築規定といった膨大な専門知識は、モジュラールールとして隔離する必要があります。`.claude/rules/` ディレクトリ内の各テキストファイル（例：`rendering-rules.md`）には、`paths:` キーワードを含むYAMLフロントマター構造（3つのハイフンで始まるヘッダー領域）を付与します。`paths: ["**/*CustomPass*.cs"]` のようなパス一致表現を記述することで、開発者がAIにグラフィックス機能モジュールの作業を依頼したときにのみ、深いレンダリング指示がコンテキストウィンドウに投入されます。ゲームサーバーやデータ検証システムの記述に切り替わった際、このグラフィックス知識ブロックは「休眠状態」にとどまり、膨大なトークンコストの浪費を防ぎます[^19]。

**ステップ4：スキルプロトコルの組み込み（Agent Skills）** ストレージ構造が安定したら、プラットフォームおよび制御環境との通信課題を解決する必要があります。アーキテクトはコマンドラインツールを開き、`npx skills add Unity-Technologies/skills --agent claude-code` コマンドを実行してGitHubから `SKILL.md` ファイルとスクリプトコードを直接取得した後、GLWの共有スキルリポジトリを `.agents/skills/` ディレクトリに標準化します。この時点から、「UPM経由でUnity In-App Purchasingライブラリをインストールする」や「Multiplayer Servicesでゲームサーバーを設定する」といった定型的な手続きタスクが発生しても、Claude Codeモデルは自らドキュメントを読み込んだりコマンド構造を推測したりする必要がなくなります。代わりにスキルの説明（description-as-trigger）を用いて段階的開示メカニズムを通じ既存スクリプトを自動的に照合・読み込み・実行し、リクエストを完璧かつ標準準拠で完了させます[^30]。

**ステップ5：知識昇格ライフサイクル（自動メモリの抽出）** 運用プロセスは設定段階で終わりではありません。毎週、モデルがタスクを継続的に解決する中で、自動メモリシステムの `MEMORY.md` ディレクトリに「実践から得た教訓」を自動的に記録していきます[^17]。例えば、6000.5バージョンの互換性変更により一部の旧式Unity呼び出しがエラーになるといった知見です。技術管理担当者は `/memory` コマンドを使ってAIが自動集約した内容を確認する必要があります[^20]。マルチエージェント環境における上書き・データ競合の起こりやすさやコンテキスト圧縮（compaction）後の消失リスクを考慮し、長期的な戦略価値を持つあらゆるルールは必ず手動で抽出し、簡潔な指示文へと書き直して `.claude/rules/*.md` 内の不変ルールファイルへ逆反映させなければなりません[^22]。こうしてプロジェクトの「短期記憶」がシステムの「長期知識」へと定着し、来たるUnity 6.7 LTSリリースでの大規模な基盤刷新に向けた万全の体制が整います。

---

## **参考文献**

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

### 関連資料

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
