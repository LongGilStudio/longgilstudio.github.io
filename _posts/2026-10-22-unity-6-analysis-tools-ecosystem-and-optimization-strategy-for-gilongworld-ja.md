---
title: "技術詳細レポート：Unity 6の解析ツールエコシステムとGilongWorldプロジェクト向け実践的最適化戦略"
date: 2026-10-22 03:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, profiler, optimization, analysis, urp, render-graph, gilongworld]
description: "Unity 6のWindow > Analysisメニューにある全13種類のツール、隠れた詳細診断ツール、およびオープンワールドプロジェクトGilongWorld向けの実践的パフォーマンス最適化戦略を包括的に解説します。"
lang: ja
translation_id: unity6-analysis-tools-gilongworld
---

## **GilongWorldの技術的特性とパフォーマンス課題の分析**

Long Gil Studioおよび開発者Huynh Long Gilが開発・パブリッシングを手掛ける『*GilongWorld*』は、SF（サイエンス・フィクション）の世界観を持つアクションRPGとオープンワールドを融合させたハイクオリティなインディーゲーム（AAA Indie）プロジェクトです[^1]。『*GilongWorld*』の技術アーキテクチャにおいて最も複雑な点は、三人称視点（Third Person）のサンドボックス環境の中で、最もリソース消費の激しい5つのゲームプレイシステムが同時に稼働する点にあります[^2]。本作は、SF兵器・爆弾・毒物から放たれる膨大なパーティクルエフェクト（VFX）を伴うアクションRPG戦闘システムの高いフレーム応答性を要求すると同時に、固有のステータスと超常スキルを備えたドラゴンをはじめとする神話生物のテイム（調教）および使役システムを維持しなければなりません[^2]。このコンパニオン生物システムは、スケルタルアニメーションのボーン行列変換、経路探索（Pathfinding）アルゴリズム、そして主人公と騎乗生物部隊との間の継続的な状態データ通信を通じてCPUに大きな負荷をかけます[^2]。

戦闘とAIによる負荷に加え、『*GilongWorld*』はプレイヤーが未開の地を強固な要塞へと開拓できる拠点建設メカニズム、外来種の植物を育てる農業システム、そして霊薬・丸薬・爆発物を調合する錬金術クラフトシステムを統合しています[^2]。エンジンアーキテクチャの観点からは、プレイヤーによる自由な建築の許可が実行時に数千もの動的オブジェクトを生み出し、メモリを断片化させ、従来の静的バッチング（Static Batching）を破綻させると同時に、物理演算システムとナビゲーションメッシュ（NavMesh）に絶え間ない更新を強いることになります[^2]。並行して、農業システムは広範囲にわたる成長状態の更新ループと未踏領域を移動する際の永続データ保存メカニズムを必要とし、錬金術システムはUI上で数百に及ぶ複雑なクラフトレシピを管理しなければなりません[^2]。これら多層的なメカニズムのすべてを、Steamプラットフォーム上のあらかじめ定められたハードウェア予算内で、DirectX 12命令セット上で動作するフォトリアルなグラフィックス要件を満たしながら稼働させる必要があります[^2]。

| システム仕様 | 最低動作環境 (Minimum) | 推奨動作環境 (Recommended) | GilongWorldにおけるアーキテクチャ上の影響と最適化制約 |
| :---- | :---- | :---- | :---- |
| **OSおよびAPI** | Windows 10 (DirectX 12)[^2] | Windows 10/11 (DirectX 12)[^2] | 最新のDX12標準に準拠したグラフィックスコマンドストリーム（Render Thread）とGPUバッファ管理の最適化が必須[^2]。 |
| **プロセッサ (CPU)** | Intel Core i5-8500 / AMD Ryzen 5 2600X[^2] | Intel Core i5-11600K / AMD Ryzen 5 5600[^2] | 物理6コアに制限；生物AI、拠点の物理演算、農業ループはすべてマルチスレッド（Job System / Burst）へオフロードする必要がある[^2]。 |
| **システムメモリ (RAM)** | **16 GB RAM**[^2] | **16 GB RAM**[^2] | 両スペック間でメモリ上限が一切増加しない；メモリリーク（Memory Leak）およびAssetBundle内のアセット重複は厳禁[^2]。 |
| **グラフィックスカード (GPU)** | GTX 1060 / RX 6500 XT[^2] | RTX 2080 / RX 6700 XT[^2] | RX 6500 XTはVRAMが4GBしかなく帯域幅も狭い；一時的なRender Textureの再利用（Transient Resources）と徹底したテクスチャ圧縮が必須[^2]。 |
| **ストレージ容量** | **35 GB** 空き容量[^2] | **50 GB** 空き容量[^2] | 巨大なアセット規模（35–50 GB）により読み込み時のボトルネック（Asset Streaming）やEditorでのインポート時間長期化の恐れがある[^2]。 |

上記のスペック表から、一つの核心的な技術的パラドックスが浮かび上がります。ストレージ容量は35 GBから50 GBへと拡大し、GPUの処理能力は普及帯のGTX 1060 / RX 6500 XTからハイエンドのRTX 2080 / RX 6700 XTへと飛躍的に向上しているにもかかわらず、システムRAM容量は最低動作環境と推奨動作環境の双方で16 GBのまま据え置かれています[^2]。Windows 10/11およびDirectX 12ドライバがすでにバックグラウンドメモリの相当部分を占有する状況下において、『*GilongWorld*』の実行プロセスは、オープンワールドの地形全体、プレイヤーが建設した要塞構造物、テイムした生物モデル、そして錬金術エフェクトのすべてを収容するために極めて厳しい上限を課せられています[^2]。さらに、作業環境にRender Graph Viewer、Performance Markers、Project Auditorといった専門ツールが存在することは、本プロジェクトが最新のUniversal Render Pipeline (URP) レンダリングパイプラインを備えたUnity 6プラットフォーム上で開発されていることを示しています[^10]。`Window > Analysis`メニューにある全13種類のツールと隠れた診断ツールを完全に使いこなすことが、このパフォーマンス課題を解決するための生命線となります[^13]。

![GilongWorldのハードウェア予算とUnity 6における13種類のAnalysisツールマトリックス](/assets/img/posts/2026-10-22/gilongworld-hardware-budget-analysis-tools.png){: .shadow .rounded-10 }
_図1：GilongWorldのハードウェア予算（16 GB RAM、35–50 GB、GTX 1060 / RX 6500 XT、i5-8500）とUnity 6のAnalysisツールおよび隠しツールマトリックス_

## **Analysisメニュー内13ツールの詳細分析とGilongWorldへの実践的応用**

『*GilongWorld*』のような複雑なプロジェクトを最適化するため、`Window > Analysis`メニューの13ツールは、Unity Engineの核となるアーキテクチャ階層に対応した4つの専門機能グループに分類されます[^13]。

### **グループ1：実行パフォーマンス計測 (Runtime & Editor Performance Profiling)**

第1のグループは、ゲーム本体およびエディタの双方の稼働中におけるCPU実行時間、メモリ消費量、フレーム遅延を監視するレーダーシステムとして機能します[^8]。

#### **Profiler (Ctrl+7)**

Profilerは、Unity EngineのC++ソースコード内に組み込まれたマーカーと、`ProfilerMarker` APIを介してC#コードに追加されたカスタムマーカーの組み合わせに基づき、アプリケーションのフレームごとのテレメトリデータを収集するツールです[^19]。収集されたデータは、CPU Usage、Rendering、Memory、Audio、Physics、UIおよびUI Details、File Access、Global Illumination、Video、Asset Loadingといった専用モジュールに分割されます[^8]。『*GilongWorld*』の実践的な文脈において、このツールは戦闘時や錬金術クラフト時に発生する処理時間の急増（CPU Spikes）を制御する上で決定的な役割を果たします[^2]。プレイヤーが錬金爆弾を起爆させた際や神話生物が広範囲スキルを放った際、CPU Usageモジュールを分析することで、フレームの引っかかり（スタッタリング）の原因がメインスレッドでのパーティクル生成とガベージメモリ割り当てにあるのか、あるいはDirectX 12上での描画コマンド処理によるレンダースレッドの過負荷にあるのかを技術チームが正確に特定できます[^2]。同時に、Asset LoadingおよびFile Accessの2モジュールを追跡することで、プレイヤーが騎乗生物に乗って未踏領域を移動する際の35–50 GBストレージパッケージからのデータ読み込み速度を検証し、非同期アセットストリーミングスレッドがメインスレッドをブロックしないように保証できます[^2]。

#### **Profiler (Standalone Process)**

`Window > Analysis > Profiler (Standalone Process)`から起動すると、UnityはProfilerウィンドウをUnity Editorプロセスとは完全に独立したOSプロセスとして分離します[^16]。このプロセス分離メカニズムは2つの重要な技術的課題を解決します。第1に、メインEditor内部でProfilerのグラフUIを描画し履歴データを保持すること自体がCPUとメモリを消費するため、ゲームのスタンドアロンビルドに接続した際の計測結果にノイズが入りやすいという問題です。第2に、この分離されたプロセスはUnity Editor自体のパフォーマンスを計測するためにも専用設計されています[^16]。『*GilongWorld*』に適用する場合、最低ターゲット環境（Core i5-8500および16 GB RAM）でスタンドアロンビルドを検証する際にProfiler (Standalone Process)を使用することで、実行中プロセスからProfiler UIの負荷を取り除き、最も正確な数値を収集できます[^2]。さらに、Long Gil Studioの開発チームはこのツールを用いて、錬金レシピエディタ、生物ステータス設定ツール、Scene View上の拠点建築ツールといった社内開発ツールを診断し、日々の作業を遅延させているEditor関数を即座に洗い出すことができます[^2]。

#### **Profile Analyzer**

標準のProfilerウィンドウが単一フレームの詳細な解剖に焦点を当てるのに対し、Profile Analyzerは連続する複数フレームのシーケンスに対して数学的・統計的分析を行い、システム的なボトルネックを突き止めるツールです[^20]。数百から数千フレームにわたってマーカーの実行時間データを集計し、ソースコード修正前後の2つのキャプチャ記録を直接比較できるため、フレーム間のランダムな変動による偏りを排除できます[^24]。何百もの外来作物が成長する傍らで数十体の野生生物がプレイヤーの要塞周辺を移動するような相互作用密度の高い『*GilongWorld*』のオープンワールドでは、各フレームの処理時間は常に大きく変動します[^2]。Profilerの単一フレームだけを見ていては、最適化の効果について誤った結論を下しかねません。拠点での長時間の戦闘セッションのデータを収集してProfile Analyzerに取り込むことで、マルチスレッド化適用後のテイム生物の経路探索スクリプトや農場更新ループにおける中央値処理時間の短縮幅について、揺るぎない定量的根拠を得ることができます[^2]。

#### **Performance Markers**

Unity 6のエコシステムで`Window > Analysis > Performance Markers`に導入されたこの専用ウィンドウは、Performance Trackers（クエリ識別子`perf:`）とProfiler Markers（クエリ識別子`profile:`）という2つのデータプロバイダを通じてUnity Searchの検索機能を活用します[^14]。このツールは2種類のマーカーのデータを統計表として表示します。すなわち、Profilerを開いた際に有効化されて実行時間とメモリ割り当ての双方を詳細に記録する`ProfilerMarker`と、極めて低いオーバーヘッドでEditor内に常駐しタスクの実行時間を記録する`EditorPerformanceTracker`です[^21]。Performance Markersの卓越した強みは、`avg>1ms`、`avg<512kb`、`lastTime<1ms`、`peak=0.5`、`count>1000`、`total=0.5`といった時間・メモリ容量に基づく定量クエリフィルタと、任意のマーカーをダブルクリックして局所的なDeep Profilingを有効化し、そのマーカー配下のコールツリーのみを表示するProfilerウィンドウを開く機能の組み合わせにあります[^14]。『*GilongWorld*』において、拠点建築の配置システムや生物の距離認識システムがBurst Jobと`RaycastCommand`を介して毎フレーム数百回のレイキャストを実行する必要がある場合、エンジニアはフレーム全体の階層を手動で探り回ることなくPerformance Markersを開いて`Physics.Raycast`を直接検索するだけで、平均処理時間が数マイクロ秒（例：デバッグモードで3.7マイクロ秒）の水準に収まっているかを即座に確認できます[^2]。

### **グループ2：グラフィックスおよびレンダリングパイプラインのデバッグ (Graphics & Rendering Pipeline Debugging)**

DirectX 12命令セット上でSF世界観のフォトリアルなグラフィックスを実現しつつ、GTX 1060やRX 6500 XTといった普及帯グラフィックカードでも滑らかな動作を保証するため、グラフィックスツール群はGPU上のボトルネックを解放する鍵となります[^2]。

#### **Frame Debugger**

Frame Debuggerは任意の1フレームでレンダリング処理を凍結し、そのフレーム全体をGPUへ送信される一連の逐次的な描画イベント（Draw Calls）へと分解します[^10]。各描画ステップを検証することで、開発者はその描画コマンドが完了した時点での画像バッファの状態を観察し、Shaderに渡されるパラメータを確認して、オブジェクトがバッチング（結合）されなかった理由を特定できます[^10]。『*GilongWorld*』において、プレイヤーが外来作物の畑と騎乗生物の群れに囲まれた数千もの壁・床・冶金装置のパーツからなる大規模要塞を建設すると、DirectX 12経由で送信される描画コマンド数が急増し、Core i5-8500プロセッサに過負荷をかける恐れがあります[^2]。拠点を正面に捉えた視点でFrame Debuggerを使用すれば、グラフィックスエンジニアはモジュール式建築パーツに対してURPの描画コマンド結合メカニズム（SRP Batcher）が有効に機能しているか、あるいは不統一なマテリアルバリアントによって分断されているかを即座に検証できます[^2]。

#### **Rendering Debugger**

Rendering DebuggerはURPのレンダリングパイプラインに統合されたリアルタイム診断ツールであり、Shaderを再コンパイルすることなくゲーム実行中にマテリアル属性、ライティングモード、および各種画像バッファレイヤーを確認・上書きできます[^27]。『*GilongWorld*』では、錬金爆弾の爆発、毒霧、そして生物の超常スキルエフェクトを用いた戦闘において、半透明パーティクルの層が何重にも重なり合う現象が頻繁に発生します[^2]。メモリ帯域幅が厳しく制限された最低動作環境のグラフィックカードRX 6500 XTでは、こうした毒雲によるピクセルの重ね描き（Overdraw）がフレームレートを急速に低下させます[^2]。Rendering Debuggerを有効にすることで、テクニカルアーティストはOverdraw密度確認モードをオンにし、オープンワールドの多様なライティング条件下でSFマテリアルチャンネルの正確性を検証して、パーティクルサイズをその場で微調整できます[^2]。

#### **Render Graph Viewer**

Unity 6の`Window > Analysis > Render Graph Viewer`に導入されたこのツールは、フレームごとに最適化されたUniversal Render Pipelineのレンダリングチェーン全体を可視化します[^13]。メモリリークやグローバル変数を介した重複依存を招きやすい手動での画像バッファ確保・解放をプログラマに委ねる代わりに、Render Graphシステムは各描画パス（`ScriptableRenderPass`）に対し、`RecordRenderGraph`メソッド内でリソースの読み込み（`AccessFlags.Read`）および書き込み（`AccessFlags.Write`）意図を明確に宣言することを要求します[^6]。これらの宣言に基づき、Render Graphコンパイラは依存関係マップを自動構築して3つの核心的な最適化メカニズムを適用します。すなわち、最終出力画像に寄与しない描画パスの自動カリング（削除）、生存期間が重ならない一時バッファ（Transient Textures）向けGPUメモリの再利用、そして連続する複数パスの単一パスへの統合（Pass Merging）です[^6]。

Render Graph ViewerのUIでは、レンダリングパスが横軸に沿って左から右へ並べられ、画像リソースとデータバッファは縦軸に沿って上から下へと配置されます[^10]。ツールは読み込み操作を緑色、書き込み操作を赤色で強調表示し、統合に成功した一連の描画パス（例えばDraw Opaque ObjectsからSetup Post FXまでの5ステップの連続処理など）の下には途切れのない青い下線を表示します[^6]。さらに、このウィンドウはUnsafe Pass（`AddBlitPass`や旧互換APIである`SetRenderTarget`を使用するパス）およびCompute Passesを絞り込むフィルタを備えており、クリックするだけでC#コードエディタ内の該当パス定義行へ直接ジャンプできます[^10]。

![Render Graph図解：Read/Write操作、Merged Native Render PassおよびShared GPU Memory Pool](/assets/img/posts/2026-10-22/render-graph-pass-merging.png){: .shadow .rounded-10 }
_図2：Read（緑）/ Write（赤）操作、Merged Native Render Pass、およびShared GPU Memory Poolを介したTransient Textureの再利用を示すRender Graph図解_

『*GilongWorld*』にRender Graph Viewerを適用することで、技術チームはSFサーマルスキャンゴーグル、錬金毒によるめまいエフェクト、生物テイム時の発光エフェクトといったカスタムポストプロセスを実装する際、GTX 1060およびRX 6500 XT上のVRAM消費量を直接的に最適化できます[^2]。依存グラフを観察することで、グラフィックスエンジニアはCopy Colorのような冗長なバッファコピー処理を即座に発見し、パス間で共有されるすべてのデータがパフォーマンス低下を招くグローバル変数ではなく`FrameData`オブジェクト経由で受け渡されていることを確認できます[^10]。

### **グループ3：物理・入力・UIデバッグ (Physics, Input & IMGUI Debugging)**

第3のグループは、物理インタラクション層、プレイヤー操作信号の認識システム、および開発ツール用インターフェースに直接介入します。

#### **Physics Debugger**

Physics Debuggerは、Sceneの3次元空間内であらゆるコリジョン形状、物理オブジェクトの稼働状態、および衝突レイヤーマトリックスを視覚的に観察する機能を提供します。『*GilongWorld*』においては、自由な拠点建設メカニズムと巨大な神話生物との戦闘の組み合わせが、物理演算システム過負荷の極めて大きなリスクを生み出します[^2]。プレイヤーが数百個の要塞壁、冶金装置、農作区画を組み立てた際、これらのオブジェクトが静的コライダー（Static Collider）として正しく設定されていなかったり、スリープ状態（Sleeping）へ移行しなかったりすると、物理シミュレーションスレッドがCore i5-8500プロセッサのCPUサイクルを大量に消費します[^2]。Physics Debuggerを使用することで、エンジニアは要塞構造全体を視覚的に検査して不要な高負荷メッシュコライダーを排除し、高速な交戦中におけるドラゴンや野生生物のスケルトンに配置された被弾判定領域（ヒットボックス）の整合性も精査できます[^2]。

#### **Input Debugger**

Input Debuggerは操作入力システム向けの高度な診断ツールであり、ハードウェアデバイスの状態、入力イベントストリーム、および操作スクリプトの有効化状態をリアルタイムで追跡します。『*GilongWorld*』のような多機能ゲームでは、プレイヤーは三人称視点での戦闘操作、テイム生物へのスキル発動指示、錬金調合画面の開閉、拠点建築時のグリッドスナップモード、農作物の収穫など、数多くの異なる操作コンテキストを絶えず切り替えなければなりません[^2]。もし建築ブロックを配置するクリック操作が誤って武器攻撃や爆薬瓶の投擲を誘発してしまう競合バグが発生した場合、Input Debuggerを用いることで、ゲームプレイ状態の遷移時に適切に無効化されずバックグラウンドで動作し続けていた操作マップを正確にトレースできます[^2]。

#### **IMGUI Debugger**

IMGUI Debuggerは、従来のImmediate Mode GUIシステムで記述されたインターフェースのレイアウト構造、表示ルール、およびコールスタックを検査するために使用されます。『*GilongWorld*』の開発過程において、プレイヤー向けのメインUIが新技術で構築されていたとしても、Unity Editorの社内ツールウィンドウや、生物の召喚および錬金レシピの検証に用いるクイックテストコマンドパネル（Cheat Console）には、依然としてIMGUIシステムが多用されます[^2]。Editor内の設計ツールウィンドウで表示枠がずれたりマウスクリックを受け付けなくなったりする不具合が生じた際、IMGUI DebuggerはどのUI要素が操作権限を占有しているかを明確に示し、ツールプログラマによる即座の修正を可能にします。

### **グループ4：ソースコード・アセット・プロジェクト設定の検証 (Static Analysis, Asset Pipeline & Code Quality)**

第4のグループは、ソースコード層およびアセットデータベース層における自動品質管理システムとして機能し、製品パッケージングの直前で容量肥大化やパフォーマンス劣化のバグを未然に防ぎます[^17]。

#### **Code Coverage**

自動テストフレームワークであるUnity Test Frameworkと統合されたCode Coverageツールは、Edit ModeおよびPlay Modeのテストを通じて実行されたC#コードの行、条件分岐、およびメソッドの割合を計測します[^20]。『*GilongWorld*』では、錬金術の霊薬調合アルゴリズム、外来作物の成長時間計算式、拠点リソース管理システム、テイム生物の戦力換算テーブルといった厳密な計算とルールに基づくシステムに絶対的な正確性が求められます[^2]。これらの中核システムに対して自動テストスイートを構築しCode Coverageで追跡することで、技術チームはまだ一度も検証されていない例外ロジックの分岐（農作物収穫時のインベントリ溢れや、重複する毒ダメージの計算ミスなど）を発見し、ゲームの長期的な安定性を確保できます[^2]。

#### **Import Activity**

`Window > Analysis > Import Activity`から開くか、ProjectウィンドウまたはInspectorタイトルバー上の任意のアセットを右クリックして`View in Import Activity Window`を選択することで開くこのツールは、Asset Databaseへのアセットインポート処理における全履歴とパフォーマンスデータを公開します[^11]。Import ActivityのUIは、固有識別子GUID、ソースファイルサイズ（`Asset Size`）、ミリ秒単位のインポート時間（`Duration`）、アセットが再インポートされた具体的理由（`Reason for Import`）、Artifact IDを伴うLibraryフォルダ内の生成ファイル一覧（`Produced Files / Artifacts` — `PreviewImporter`によるプレビューファイルを含む）、そしてそのアセットの完全な依存関係チェーン（`Dependencies`）に関する詳細情報を提供します[^12]。特に、ツールバーから`Show Overview`を選択すると概要表が表示され、最も依存関係が多いアセット一覧（`Most Dependencies`）や最もインポートに時間を要するアセット一覧（`Longest Import Duration`）が集計されるほか、インポート手順の不備を自動指摘して修正ガイドを提示する`Analyze Import Process`機能も備えています[^11]。

注意すべき重要な技術的仕様として、過去のインポート履歴一覧（`Show previous imports`）はバックグラウンドで動作するArtifactガベージコレクタによってUnity Editorの再起動時に自動削除されます。詳細分析のために複数セッションを跨いで履歴を保持したい場合は、`Edit > Project Settings > Editor`へアクセスし、`Asset Pipeline`項目にある`Remove unused Artifacts on Restart`オプションを無効化する必要があります[^11]。また、カスタムスクリプト内の`OnPostprocessAllAssets`関数の処理時間は、統計表上の個別アセットのインポート時間には合算されません[^37]。『*GilongWorld*』プロジェクトでは、35–50 GBに達するアセット規模の中にマテリアルやアニメーションなど多数のサブアーティファクトを生成するドラゴンや神話生物の`.fbx`モデル群が大量に含まれ、さらにプラットフォーム切り替えや依存ファイル編集時に一斉再インポートを起こしやすい複雑なCompute Shaderと組み合わさっているため、Import Activityは開発チーム全体の待ち時間を削減する上で不可欠なツールとなります[^2]。

#### **Project Auditor**

Project Auditor（ルールパッケージ`com.unity.project-auditor-rules`と連携して動作する`com.unity.project-auditor`であり、Unity 6.4以降ではEditorに標準統合）は、C#ソースコード、アセット、プロジェクト設定、およびビルドレポート（`BuildReport`）を網羅的にスキャンし、最適化の警告を提示する包括的な静的解析ツールです[^15]。Project Auditorならではの際立った価値は、ビルド出力のたびに隠蔽されてしまう各ビルドステップ（`Build Steps`）の所要時間や各アセットの占有サイズ情報（`Size information`）を格納した`BuildReport`オブジェクトをデコードし、視覚的に表示できる点にあります[^18]。設定ファイル`ProjectAuditorConfig`（通常`Assets/Editor`に配置）内で`Save Build Reports`オプションを有効化することで、すべてのビルドレポートが`Assets/BuildReports`フォルダ内にアセットとして自動保存され、いつでも参照できるようになります[^18]。

『*GilongWorld*』への実践的適用として、Project Auditorを実行することで戦闘・農業・錬金術システムの全ソースコードを精査し、テスト投入前にガベージメモリ割り当てやCPU遅延を引き起こすAPI呼び出しを早期に発見できます[^2]。同時に、BuildReportおよびアセット分析機能により、技術チームはインストール容量を35–50 GBの枠内に厳格に管理し、DirectX 12環境および16 GB RAMメモリ向けに適切に圧縮されていないテクスチャや音声ファイルを迅速に見つけ出すことが可能になります[^2]。

## **GilongWorldの開発フェーズ別ツール配分戦略**

全13種類の分析ツールを散発的に使用したり、プロジェクト完成間際になるまで計測を先延ばしにしたりすると、コアアーキテクチャの全面的な書き直しを余儀なくされるリスクを招きます。『*GilongWorld*』のようなマルチシステム・オープンワールドプロジェクトでは、制作ライフサイクルの5つの段階全体を通じた戦略的ロードマップに沿ってAnalysisメニューのツール群を稼働させる必要があります[^2]。

| 開発フェーズ | GilongWorldにおける重点技術目標 | 使用すべき主力Analysisツール | 頻度および標準実行プロセス |
| :---- | :---- | :---- | :---- |
| **1. プリプロダクションとアセット取り込み (Pre-Production & Asset Ingestion)** | 3D生物モデル、SF拠点建築、テクスチャ、サウンドエフェクト（35–50 GB規模）のインポート手順の標準化[^2]。 | Import Activity、Project Auditor（Assets & Settingsモジュール）[^11]。 | 新規アセットパックを追加するたび、または`AssetPostprocessor`スクリプトを記述するたびに検証し、Import時間を最小限に維持する[^11]。 |
| **2. コア機能のプロトタイピングと反復開発 (Feature Prototyping & Iteration)** | アクションRPG戦闘、騎乗生物操作、拠点建築ブロック配置、農業および錬金術UIの構築[^2]。 | Input Debugger、Physics Debugger、Performance Markers、IMGUI Debugger[^7]。 | 各機能のコード記述中に毎日使用し、衝突判定ロジック、入力バインディング、新関数のマイクロ秒単位のコストを検証する[^7]。 |
| **3. グラフィックス・シェーダー・VFX開発 (LookDev, Shaders & VFX)** | オープンワールドのライティング構築、DirectX 12向けURP Custom Renderer Featureの実装、毒煙・錬金爆薬エフェクトの制作[^2]。 | Render Graph Viewer、Rendering Debugger、Frame Debugger[^13]。 | `RecordRenderGraph`の記述時やMaterial/VFXの調整時に直接開いておき、Passの統合とOverdrawが発生していないことを保証する[^6]。 |
| **4. 継続的インテグレーションと自動テスト (Automated Testing & CI/CD)** | 錬金レシピ計算の正確性、拠点のセーブ/ロード整合性の保護、および低品質コードのメインブランチ混入阻止[^2]。 | Code Coverage、Project Auditor（CLI `-batchmode`経由で実行）[^20]。 | `-executeMethod`コマンドライン引数を介してビルドサーバー上で毎晩、またはマージリクエスト作成ごとに自動化する[^40]。 |
| **5. 詳細最適化とスペック確定 (Deep Optimization & Pre-Release)** | Core i5-8500 + GTX 1060 / RX 6500 XT環境での安定FPS確保、16 GB RAM未満への消費抑え込み、35–50 GB以下でのパッケージング[^2]。 | Profiler、Profiler (Standalone Process)、Profile Analyzer、Project Auditor (BuildReport)[^16]。 | 最低ターゲットハードウェア上で動作するスタンドアロンビルドで計測し、修正前後の統計比較には必ずProfile Analyzerを使用する[^23]。 |

第1フェーズにおいて、3Dアーティストチームが神話生物モデル、拠点構造物、SFマテリアルを継続的にプロジェクトへ投入する際、Import ActivityおよびProject Auditorのアセット検査モジュールを即座に運用して標準インポートルール（Presets）を策定し、たった1つのアセットがチーム全体のコンパイル時間を引き延ばす事態を防がなければなりません[^2]。第2の機能実装フェーズへ移行した後は、ゲームプレイプログラマはPerformance Markersウィンドウを常時開いておき、`avg>1ms`や`avg<512kb`といったクイッククエリで書き終えたばかりのアルゴリズム（拠点設置時の地面判定レイキャストシステムなど）の実行コストを確認すると同時に、Physics DebuggerとInput Debuggerを有効化して戦闘の手触りと騎乗生物の操作応答性を緻密に調整します[^2]。

プロジェクトが第3のグラフィックス仕上げフェーズに入ると、Render Graph Viewer、Rendering Debugger、Frame Debuggerの3ツールがグラフィックスチームの主戦力となり、URP内の各Render Passを制御して、あらゆる錬金エフェクトとSFライティングがDirectX 12上でパス統合と一時メモリ再利用メカニズムを最大限に活用できるようにします[^2]。並行して、第4の継続的インテグレーションフェーズでは、コマンドライン経由でUnityをバックグラウンドモードで起動することにより、Code CoverageとProject Auditorを自動検証パイプラインに組み込む必要があります[^20]：

```bash
path/to/unity/executable -batchmode -quit -projectPath path/to/your/project -executeMethod ProjectAuditorCI.AuditAndExport
```

この自動化スクリプトの中で、エンジニアは`Assembly-CSharp`アセンブリを対象に`IssueCategory.Code`カテゴリを指定した`AnalysisParams`オブジェクトを生成し、`AnalysisParams.WithAdditionalDiagnosticRules`メソッドと組み合わせて検査ルールの重要度（Severity）を引き上げた上で結果を`.json`ファイルに出力でき、メイン開発ブランチへマージされる前にパフォーマンス低下を招くコードを即座に摘発できます[^40]。最後に、リリース前の第5フェーズである総力最適化においては、最低スペックの実機上で動作するビルドに接続したProfiler (Standalone Process)に、Profile AnalyzerとProject Auditor内のBuildReportを組み合わせることで、『*GilongWorld*』が16 GB RAMおよびGTX 1060 / RX 6500 XTという制約の中で確実に安定稼働することを保証します[^2]。

## **特に注目すべき隠れた分析ツールと拡張診断パッケージ**

`Window > Analysis`メニューに直接表示される13種類のツール以外にも、Unityのエコシステムには他のメニュー階層、内部診断設定パネル（`Edit > Preferences > Diagnostics`）、コマンドライン引数、あるいはPackage Manager内の拡張パッケージという形で、高度な分析ツールが数多く隠されています[^43]。『*GilongWorld*』のように技術要件が厳しいプロジェクトでは、これらの隠しツールを有効活用することが、標準ツール群だけでは埋めきれないギャップを補完する鍵となります。

### **専用の深層Memory Profilerパッケージ (`com.unity.memoryprofiler`)**

標準Profilerウィンドウ内に組み込まれているMemoryモジュールは、大まかなカテゴリ別に割り当てられたメモリ容量の概算カウンタを提供するにとどまります[^8]。『*GilongWorld*』の最低・推奨双方で変わらない**16 GB RAM**の上限を真に制御するためには、技術チームはPackage Managerから**Memory Profiler**パッケージ（`com.unity.memoryprofiler`）を追加インストールし、専用のメモリ分析ウィンドウを解放することが必須となります[^2]。このツールは包括的なメモリスナップショット（Memory Snapshots）を取得し、異なる2つの時点で撮影したスナップショットを比較の天秤にかけることでメモリリークを引き起こしている正確なオブジェクトを突き止めるとともに、仮想メモリ配置図（Memory Layout）を可視化してメモリの断片化現象を検出します[^8]。プレイヤーがオープンワールドを探索し、拠点を建設し続け、作物を収穫し、数十種類の生物を召喚する過程において、異なる地域を移動する前後のメモリスナップショットを比較すれば、RAMから解放されずに残っている重いグラフィックアセットを即座に発見できます[^2]。

### **Addressables Analyzeウィンドウ (`Window > Asset Management > Addressables > Analyze`)**

総ストレージ容量が**最低35 GB、推奨50 GB**に達する規模において、『*GilongWorld*』におけるアセットのパッケージングおよびロード方式は、ディスク容量とRAMメモリの双方に直接的な影響を及ぼします[^2]。Addressablesシステムを使用する場合、極めて重要な分析ツールが`Window > Asset Management > Addressables > Analyze`のパスに隠されています[^45]。このウィンドウはアセット配置の検証ルールを実行し、中でもパッケージ間の重複依存関係を検出するルール（`Check Duplicate Bundle Dependencies`）が際立っているほか、プロジェクトの要件に応じて開発者が独自の`AnalyzeRules`を記述することも可能です[^9]。仮にSF金属マテリアル、錬金パーティクルエフェクト、あるいはオーディオファイルが拠点アセットグループと生物アセットグループの双方から同時に参照され、かつ個別に切り出されていなければ、Unityはそのアセットを複数のAssetBundleパッケージへと複製してしまい、ディスク容量を浪費するだけでなくゲーム実行時の16 GB RAMにもデータを重複ロードすることになります[^2]。Addressables Analyzeでレポートを実行すれば、これらすべての重複箇所が白日の下に晒され、エンジニアがデータパッケージを最適に再構成できるようになります[^9]。

### **UI Toolkit DebuggerおよびEvent Debugger (`Window > UI Toolkit > Debugger`)**

多層的な錬金クラフトテーブル、アイテムインベントリ、農場管理UI、テイム生物リストなどを含む『*GilongWorld*』の複雑なユーザーインターフェースシステムについて、プロジェクトが最新のUI Toolkitプラットフォームを採用している場合、対応する診断ツールはAnalysisメニューではなく`Window > UI Toolkit > Debugger`に配置されています（またはPlay Mode中にショートカットキー``Ctrl + Shift + ` ``を押すか、Game ViewおよびUI Builderの隅にある3点リーダーメニューアイコン`⋮`から素早く開けます）[^2]。Webブラウザの要素検証ツールと同様に動作するUI Toolkit Debuggerは、リアルタイムで`VisualElement`階層ツリーを表示し、一致するすべてのUSSスタイルセレクタ（`Matching Selectors`）を列挙し、表示プロパティを直接編集して即座に結果を確認できるほか、再描画領域（Repaint）、レイアウト（Layout）、ワイヤーフレーム（Wireframe）を検査するカラーオーバーレイを有効化できます[^43]。

UI Builder内で直接デバッグを行う際は、ビューポート周囲にオレンジ色の枠線が表示されるPreviewモードを有効にし、デザイナ側のマウスイベントを捕捉する隠し要素を無効化することで、`Pick Element`ツールが実際のUI要素を正しく選択できるようにする必要があります[^43]。さらに、`ScrollView`、`ListView`、`Slider`、`DropdownField`といった複合コントロールには、UI Builder上では薄暗く表示される隠れた内部子要素（`#unity-content-container`など）が常に含まれているため、『*GilongWorld*』のUI設計において内部USSクラス名を特定しマウスイベントの流れを追跡するには、UI Toolkit DebuggerとEvent Debuggerを組み合わせて使用することが唯一の手段となります[^56]。

### **Preferences、Project Settingsおよびコマンドライン引数の低レベル診断スイッチ**

`Edit > Preferences > Diagnostics`（macOSでは`Unity > Settings > Diagnostics`）、`Edit > Preferences > Jobs`、そして`Asset Pipeline`設定の奥深くには、最も厄介なシステムバグを解決へと導く内部診断スイッチが潜んでいます[^12]。

| 隠し診断スイッチ / CLI引数 | Unity内の有効化パス | 深層診断メカニズムとGilongWorldへの応用 |
| :---- | :---- | :---- |
| **ObjectSetDirty診断フラグ** | `Edit > Preferences > Diagnostics > Core > ObjectSetDirty`（Editorを再起動し、Stack Trace LoggingをFullに設定）[^12]。 | オブジェクトに変更フラグが立てられた際（`Increment Dirty(count) : [InstanceID] ObjectName`）やフラグが解除された際（`Clear Dirty(0)`）の完全なコールスタックをEditor Logに出力します[^12]。『*GilongWorld*』の生物PrefabやSceneが勝手にDirty状態になってGitコンフリクトを起こし、Editorに絶えず再インポートを強いる原因を突き止めるのに役立ちます[^12]。 |
| **Enable FMOD Profiling** | `Edit > Preferences > Diagnostics > Audio > Enable FMOD Profiling`[^61]。 | Audio Mixer内の各オーディオエフェクトフィルタ（DSP Effect）ごとのCPU消費量計測機能を解放します[^61]。`Auto Mixer Suspend`機能（音量カットオフ閾値をデフォルトの`-80 dB`より高く引き上げる）と組み合わせることで、バックグラウンドで再生される数百もの環境音や生物の鳴き声によるCPUスパイクを防止します[^61]。 |
| **Jobs Leak Detection Level + CLI Stats** | `Edit > Preferences > Jobs > Leak Detection Level > Enabled with Stack Trace`および起動引数`-log-memory-performance-stats`の併用[^47]。 | 『*GilongWorld*』が経路探索やレイキャストシステムにBurst JobsおよびUniTaskを使用する際[^7]、`NativeContainer`で`Dispose()`を呼び忘れたり、（`Allocator.Persistent`ではなく）4フレームを超えて生存する一時アロケータを使用したりするとメモリリークが発生します[^47]。この設定はリークを引き起こした正確なコールスタックを出力します[^47]。 |
| **診断スイッチの復元 (`--reset-diagnostic-switches`)** | プロジェクト起動時にUnity Hubまたは`.bat`ファイル経由で引数`--reset-diagnostic-switches`を渡す[^47]。 | `Preferences > Diagnostics`内のフラグはEngineのコアに深く作用してEditorを不安定にする可能性があるため、このコマンドライン引数はすべての診断設定をデフォルト状態に戻す安全装置として機能します[^47]。 |
| **隠しアセットインポートパイプラインの最適化 (Asset Pipeline Tweaks)** | `Project Settings > Editor > Asset Pipeline > Parallel Import`および`Preferences > Asset Pipeline > Compress Textures on Import`[^12]。 | Textures、Models、Audioをマルチスレッドでインポートする`Parallel Import`を有効化し、`Compress Textures on Import`を無効化（または`EditorUserSettings.asset`内で`m_CompressAssetsOnImport: 0`を設定）し、Riderの自動リフレッシュと`Index on Editor Startup`（`Preferences > Search > Indexing`）をオフにして、35–50 GBのアセットリポジトリでの作業速度を向上させます[^12]。 |

上記の内部スイッチに加え、プログラマが『*GilongWorld*』のオープンワールド向けの一括アセット処理ツール（`AssetDatabase.CopyAsset`や`DeleteAsset`を用いて作物のPrefabや拠点の建築パーツを自動生成するツールなど）を記述する際には、1行ごとにデータベースが更新されてEditorがフリーズする事態を防ぐため、そのコマンドブロックを必ず呼び出し回数が厳密に一致する`AssetDatabase.StartAssetEditing()`と`AssetDatabase.StopAssetEditing()`のペアで囲むよう特に留意する必要があります[^2]。最後に、DirectX 12のハードウェア層において、UnityはGPUパフォーマンスマーカー（`D3DPERF_BeginEvent`および`D3DPERF_EndEvent`）をグラフィックスドライバへ直接出力する機能をすでにサポートしています[^2]。GTX 1060 / RTX 2080およびRX 6500 XT / RX 6700 XT向けの最終最適化フェーズでは、技術チームはハードウェアメーカー製の低レベルグラフィックスプロファイラ（NVIDIA NsightやAMDの解析ツールなど）を併用してこれらのマーカーを読み取り、ターゲットとなる各GPUアーキテクチャ上でのVertex Shader、Pixel Shader、Compute Shader各ステージの正確なビジー時間を計測すべきです[^2]。

## **総括とGilongWorld向け実践導入ロードマップ**

『*GilongWorld*』のように多数の複雑なメカニズムを統合した大規模プロジェクトが、**16 GB RAM**の上限、**35–50 GB**のストレージ予算、ならびに最低動作環境である**Core i5-8500 / Ryzen 5 2600X**および**GTX 1060 / RX 6500 XT**のハードウェア性能を超過することなくDirectX 12上で最適なパフォーマンスを発揮するためには、Long Gil Studioの開発チームがUnity 6の解析ツールエコシステムを一貫した技術ワークフローへと統合する必要があります[^2]。

日々の開発ワークフローにおいては、Parallel Importの有効化、Import Activityを通じた依存チェーンの制御、および隠しフラグ`ObjectSetDirty`の活用によって、膨大なアセット群を前にしてもエディタの作業速度を守り抜くことができます[^11]。戦闘、生物テイム、要塞建設、錬金術の各機能を実装する過程では、Performance Markers、Physics Debugger、Input Debugger、そしてUI Toolkit Debuggerを常時活用することで、プログラマは微細なボトルネックを芽のうちに発見し排除できます[^2]。グラフィックス層とメモリ層に対しては、Render Graph Viewer、Frame Debugger、Rendering Debugger、拡張Memory Profilerパッケージ、およびAddressables Analyzeウィンドウ間の緊密な連携により、すべての画像バッファが効率的に再利用され、いかなるアセットもメモリへ重複ロードされない状態を保証します[^6]。最後に、継続的インテグレーションパイプライン内でProject AuditorとCode Coverageを自動化し、Profiler (Standalone Process)とProfile Analyzerを通じた比較検証手法を組み合わせることで、強固な品質管理システムが構築され、『*GilongWorld*』を完成度の高いAAA Indieプロジェクトの技術水準へと引き上げることができます[^3]。

---

## **参考文献**

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
