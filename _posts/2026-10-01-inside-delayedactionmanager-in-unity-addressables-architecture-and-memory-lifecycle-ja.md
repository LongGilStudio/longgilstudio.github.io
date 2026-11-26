---
title: "詳細技術レポート：Unity Addressables 環境における DelayedActionManager の動作メカニズム、システムアーキテクチャおよび影響"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: "Unity Addressables における DelayedActionManager の ComponentSingleton アーキテクチャ、LateUpdate 実行メカニズム、C#/C++ プロキシ例外処理、および AssetBundle メモリ最適化戦略の詳細分析。"
lang: ja
translation_id: unity-addressables-delayedactionmanager
---

Addressable Asset System（略称 Addressables）は、従来の AssetBundles を基盤としながら柔軟で強力かつ最適化されたコンテンツ管理ソリューションを提供する、Unity の画期的なアーキテクチャ上の進歩を象徴しています[^1]。大規模なゲームやインタラクティブアプリケーションを設計・運用するうえで、アセットを自動的にロードおよび解放するための非同期データフローを管理することは不可欠な要件です。この複雑な処理を担う中核コンポーネントの 1 つでありながら、ソフトウェアエンジニアがヒエラルキー（Hierarchy）を分析する際にしばしば戸惑うのが、`DontDestroyOnLoad` シーン内に自動生成される `DelayedActionManager` という名前のオブジェクトです[^2]。

本技術レポートでは、`DelayedActionManager` のアーキテクチャ上の本質を徹底的に解剖し、`DontDestroyOnLoad` 空間に存在する理由を解明するとともに、Unity のリアルタイムループ（PlayerLoop）内部における実行メカニズムを分析し、さらにメモリ管理に関する課題、メモリリーク（memory leaks）現象、および頻発するスレッド／ライフサイクル例外（exceptions）を掘り下げて検証します。システム設計データとベストプラクティスの分析を通じ、本稿はソフトウェアアーキテクトがアプリケーションの安定性を最適化するための深い洞察を提供します。

## アセットロードシステムの進化と非同期基盤

`DelayedActionManager` のミクロ構造を詳しく見ていく前に、Addressables システムが生まれた背景を理解しておくことが前提条件となります。初期の Unity バージョンでは、開発者は主に `Resources` フォルダに依存するか、生の AssetBundle スクリプトを直接使用していました[^4]。`Resources.Load()` の仕組みは、ユーザーが自ら倉庫に入って正確なディレクトリパスを指定するようなものであり、アセットが見つかってメモリに読み込まれるまで実行スレッド（main thread）が強制的にブロック（block）されます[^4]。この手法の欠点は、アプリケーションのスケーラビリティを阻害し、大容量データを扱う際に深刻なフレームレート低下（FPS drop）を引き起こす点にあります。

この課題を解決するため、Addressables は現代の配送サービスのように機能します。開発者はアセットの識別子（address/key）を指定するだけでよく、システムが自動的にルーティングを行い、ローカルストレージ（Local）からアセットを探すか、コンテンツ配信ネットワーク（CDN - Content Delivery Network）のサーバーからダウンロードします[^4]。最も重要な点として、この全サイクルは非同期（asynchronous）で実行されます。代表的なロード命令である `Addressables.LoadAssetAsync` は、オブジェクトを即座に返すのではなく、`AsyncOperationHandle` と呼ばれるハンドルを返します[^4]。このインターフェースは、アセットの準備が整った際に呼び出されるコールバック（callback）機構を提供し、アプリケーションのメインスレッドが物理演算や描画ロジックを中断することなく処理し続けられるようにします[^4].

完全な同期モデルから完全な非同期モデルへの移行は、アーキテクチャ上の大きな課題を伴います。ネットワーク帯域幅の不足によりアセットのダウンロード完了までに数秒かかる場合、アプリケーションはすでにまったく別のシーン（scene）へ遷移している可能性があります[^1]。コールバック（callbacks）、タスクキュー（command queues）、および参照カウント（reference counting）を管理するには、通常シーンの破棄・生成ライフサイクルに影響されない中央管理エンティティが必要です。これこそが、Unity の開発者が Addressables の中核に `DontDestroyOnLoad` シーンモデルを組み込んだ理由です。

## DontDestroyOnLoad（DDOL）シーンとグローバル永続化アーキテクチャ

Unity 環境では、新しいシーンをロードする操作（デフォルトの Single モードでの `SceneManager.LoadScene`）によって自動的にメモリクリーンアップ機構が起動します。エンジンは、使用されなくなったアセットを確実に解放するため、前のシーンに属するすべての `GameObject` と `Component` を破棄（destroy）します[^7]。加算シーンロード（Additive scenes）機能を使えば、グローバル状態を管理するために複数のシーンを同時にアクティブに保つことができますが（例：Game Manager 専用シーンと Level 専用シーンの分離）、`DontDestroyOnLoad`（DDOL）メカニズムは依然として低レベルでオブジェクトを保護するための重要なシステム技術であり続けています[^7]。

Play ボタンを押した際に Unity エディタのインターフェースに `DontDestroyOnLoad` シーンが現れるのはバグではなく、シーンロード時に破棄されないようマークされたオブジェクトをまとめるためのエンジン標準の隠しメカニズムです[^9]。`GameObject` がこの安全領域に受け入れられるためには、Unity が定める必須ルールに従う必要があります。すなわち、そのオブジェクトはシーン階層のルートレベル（root level）に配置されていなければなりません[^8]。ネストされた子オブジェクト（nested object）に対して `DontDestroyOnLoad(gameObject)` 関数を適用しようとする試みはすべて失敗し、警告が記録されます[^8]。

Addressables システムにとって、アセットのロードおよび解放プロセスは複数のシーンにまたがるライフサイクルを持つ処理です。たとえば、リモートサーバーからの AssetBundle ダウンロード状態の追跡は、プレイヤーがステージ移動のポータルを通過したという理由だけで途中で中断されるわけにはいきません。`RuntimeInitializeOnLoadMethod` 機構と高度な Singleton デザインパターンを組み合わせることで、Addressables のソースコードはアプリケーション起動直後にルートオブジェクトを自動生成し、DDOL シーンへ格納することができます[^2]。これにより、プログラマが DDOL に関するコードを 1 行も書いていなくても、`"DelayedActionManager"` という名前のオブジェクトがシーン一覧の左下に自動的に出現する理由が説明できます[^2]。

## DelayedActionManager の内部構造と技術的役割

Addressables パッケージのソースコードおよび API ドキュメントを精査すると、`DelayedActionManager` は `UnityEngine.ResourceManagement.Util` 名前空間に属する具象クラス（concrete class）であることがわかります[^11]。その構造は単なる静的ユーティリティクラス（static utility class）ではなく、基底アーキテクチャからの継承を通じて `GameObject` に直接アタッチされるコンポーネントです[^12]。

### ComponentSingleton パターンと初期化の自動化

`DelayedActionManager` のアーキテクチャは、同じ名前空間で定義された基盤クラスである `ComponentSingleton` デザインパターンを土台として構築されています[^13]。純粋な C# クラスではなくコンポーネント（Component）上に Singleton パターンを実装することで、システムは Unity のリアルタイムイベントループ（`PlayerLoop`）と直接対話する能力を獲得します。

`ResourceManager` が最初にロード要求や状態更新要求（例：`Addressables.LoadAssetAsync` やネットワーク診断処理）を受け取ると、`DelayedActionManager` インスタンスを呼び出します。この時点で `ComponentSingleton` パターンは、空の `GameObject` を生成して `"DelayedActionManager"` と命名し、対応するスクリプトコンポーネントをアタッチして即座に `DontDestroyOnLoad` 関数を呼び出しグローバル保護空間へ移行させる、という一連の隠れた処理を自動的に実行します[^2]。この遅延初期化（lazy initialization）設計により、遅延タスク管理機能が実際に必要となったときにのみシステムリソースが消費されることが保証され、エディタ画面上にこのオブジェクトが「魔法のように」現れることに対する開発者のよくある疑問が解消されます[^3]。

### スケジューリング機構と LateUpdate フェーズの分析

`DelayedActionManager` の中核的な役割は、遅延アクション、コールバック（callbacks）、コルーチン、およびミクロレベルでのメモリ管理のための中央スケジューラ（central scheduler）として機能することです[^11]。そのアーキテクチャにおける繊細かつ極めて重要な特徴は、すべてのキュー処理ロジックが Unity ライフサイクルの `LateUpdate()` 関数内で実行されるようルーティングされている点にあります[^11]。

従来の `Update` ではなく `LateUpdate` を選択した設計は、データの整合性に関する深いアーキテクチャ上の課題を解決します。次の表は、Unity の実行順序と Addressables データの保護における `LateUpdate` フェーズの役割を示したものです。

| 実行フェーズ（PlayerLoop） | 代表的な役割 | Addressables および DelayedActionManager における役割 |
| :--- | :--- | :--- |
| **FixedUpdate** | 物理シミュレーション、静的／動的衝突の判定。 | ゲームロジックが衝突後のオブジェクト破棄要求をトリガーする場合がある。 |
| **Update** | プレイヤー入力（Input）、移動、AI ロジック、ゲーム状態の更新。 | `Addressables.LoadAssetAsync` や `Release` が手動で呼び出される。ここで GameObject が `Destroy()` されることがある。 |
| **LateUpdate** | カメラ位置の更新、ポストプロセス（post-processing）の調整。 | `DelayedActionManager` がメモリを解放し、参照カウントを更新し、`Update` フェーズでの破棄命令と競合しないように非同期コールバックを呼び出す[^11]。 |

仮に `ResourceManager` が `Update` フェーズの途中でタスク完了コールバックを即座に実行した場合、フレーム計算がまだ完了していない中間状態のシステム（グラフィックスや UI システムなど）と相互作用してしまう高いリスクが生じます。`OnComplete` 関数の呼び出しや参照カウントの減算（ref-count decrements）の実行を `LateUpdate()` まで遅延（delaying）させることで、`DelayedActionManager` は現在フレームの論理状態全体が安定していることを保証します[^11]。数多くのスタックトレース（stack traces）報告データは、`UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` 関数がユーザーコードへ制御権が渡される前の最終的な緩衝ステップであることを示しています[^15]。

## システム例外（System Exceptions）とスタックトレース（Stack Traces）の解剖

高い安全性を備えて設計されているにもかかわらず、非同期メカニズムの複雑さと開発者側による不適切なライフサイクル管理操作が組み合わさることで、しばしば `DelayedActionManager` が深刻な例外の中心となることがあります。エラーレポートは、システムがマネージドメモリ（managed memory）およびネイティブメモリ（native memory）とどのように相互作用しているかについて重要な手がかりを提供します。

### NullReferenceException エラーと C# - C++ プロキシのライフサイクル競合

Addressables 環境で非常に一般的なエラーシナリオは、`DelayedActionManager` の `StartCoroutine_Auto` 関数から発生する `ArgumentNullException: Value cannot be null. Parameter name: obj` 例外です[^19]。このエラーは Unity 内部のバグではなく、C# のガベージコレクション（Garbage Collector）機構と下層にある C++ ソースコードのネイティブポインタ管理との間の不整合に起因します[^19]。

Unity において、`GameObject` や `MonoBehaviour` などのオブジェクトは、実際にはエンジン内部の C++ で確保されたネイティブオブジェクトを指す内部参照を保持する、C# で記述されたプロキシクラス（proxy classes）です[^19]。プログラマが `Destroy(gameObject)` 命令を呼び出すと、C++ オブジェクトは即座に破棄されてメモリ領域が返還され、内部参照は null になります[^19]。しかし、C# プロキシクラス自体は、ガベージコレクタによる回収が行われるまでマネージドメモリ（managed memory）内に一定時間存続し続けることがあります[^19]。

惨事は、開発者が Addressables の非同期処理と組み合わせて匿名式（lambdas/closures）を使用するときに発生します。ラムダ式には周囲のコンテキスト変数を「キャプチャ（capture）」する特性があります。次のコードパターンを見てみましょう：

```csharp
// DelayedActionManager のキューに積まれるアクション
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

このコードが実行されると、変数 `_crawlerRobot`（C# プロキシ）がクロージャによって保持されます[^19]。もしゲーム内のロジックがまさにそのフレーム内で `_crawlerRobot` を破棄すると、下層の C++ ポインタは消滅します。しかし、`DelayedActionManager` はこのラムダを `LateUpdate` フェーズ（または後続のフレーム）で実行するようスケジュールしているため、ラムダが実際に発火した際、すでに死んだ C++ ポインタの `BreakAwayLowerBody()` メンバーへアクセスしようとします[^19]。必然的な結果として、システムは `NullReferenceException` 例外、あるいは「オブジェクトは破棄されましたが、まだアクセスしようとしています」というエラーメッセージを送出します[^19]。

このアーキテクチャ上のリスクを解消するため、ソフトウェアの専門家は 2 つの設計ソリューションを推奨しています：

1. 低レベルの状態変更を扱う際、ラムダ式の過度なネスト（lambdas nesting）を避ける[^19]。
2. Unity が下層の C++ ポインタ状態を直接チェックできるように C# の `==` 演算子をオーバーロード（overloaded）していることを踏まえ、常に安全な null 検証チェックを行う[^19]。

### PlayerLoop の競合と「Assertion failed on expression: ShouldRunBehaviour()」エラー

Addressables パッケージのバージョン管理を行う過程で、多くの開発者から、Unity エディタ（Unity Editor）のコンソールが `MonoBehaviour.cpp` ファイルにおける低レベルエラーメッセージ `Assertion failed on expression: 'ShouldRunBehaviour()'` で埋め尽くされる現象が報告されています[^3]。

スタックトレース（stack trace）は、この処理が `DontDestroyOnLoad` シーン内に存在する `"DelayedActionManager"` GameObject から直接発生していることを示しています[^3]。根本原因分析（Root Cause Analysis）により、Unity エディタのプレイモード（Play Mode）におけるスレッド処理の欠陥が明らかになりました。エディタがドメインリロード（Domain Reload）を経た際や、アセットのロード処理が完了していない状態でユーザーがゲームの停止（Stop）を押した際、`DelayedActionManager` が孤立オブジェクト（orphaned object）として取り残されてしまいます[^3]。

`DontDestroyOnLoad` として指定されているため、Unity のネイティブ実行環境（`PlayerLoop`）がすべてのタスクの停止を命じた後でも、`LateUpdate` サイクルや振る舞いチェック（behaviour checks）を実行し続けようとします[^3]。このエラーは Addressables `1.16.x` から `1.18.x` パッケージへの移行時に最も深刻に記録されており、多くの開発チームが同期処理 API の安定性を確保しキューの詰まりを解消するため、手動でバージョン `1.17.17` へダウングレードせざるを得なくなりました[^3]。

### バージョン履歴における DelayedActionManager の変遷

Unity Addressables の API ドキュメントおよび変更履歴（changelogs）の調査において興味深いのは、`DelayedActionManager` の周期的な浮沈です。`0.7.5` や `1.11.2` といったバージョンのアップデートログでは、ビルドスクリプトインターフェース（build script interface）のリファクタリングについて、*"Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading"* と明確に発表されていました[^20]。この決定は当初、API 層を簡素化し、制御権をカスタムの `AsyncOperationBase` クラスへ委譲することを目的としていました[^20]。

しかし、`1.18.15`、`1.19.19`、`1.21.21` といったポスト LTS（Long-Term Support）バージョンのバグレポートでは、スタックトレース上に `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` が継続的に再登場していることが明らかになっています[^11]。これは Unity の反復的設計（iterative design）哲学を反映しています。つまり、簡素化のために一度削除したものの、システムエンジニアたちは中央集権的な遅延タスクマネージャの欠如が診断イベントの収集（`DiagnosticEventCollector`）、プリロードテーブル（preload tables）の処理、およびアプリケーション終了時のメモリ安全性確保において克服困難な課題を生むことに気づいたのです[^11]。`DelayedActionManager` は再設計され、公開ユーザーインターフェースには露出しないもののアプリケーション終了時の破棄（disposal）リスクを処理する内部システムユーティリティとして復元されました[^20]。

## 参照カウント機構とメモリリークのダイナミクス

`DelayedActionManager` の存在は、Addressables における最も複雑な柱の 1 つであるメモリ管理（Memory Management）システムと密接に結びついています。ガベージコレクタのみに全面的に依存するのとは異なり、Addressables は参照カウント（Reference Counting）メカニズムを通じて RAM 上のデータの存続を制御します[^23]。

### 参照のダイナミクスと依存関係の階層

システムがアセットのロード要求を受け取るたび、そのアセットの参照カウントは 1 増加（increment）します。使用が完了すると、`Addressables.Release` 命令がシステムに対してこのカウントを減算（decrement）するよう指示します[^23]。黄金律として、システムは参照カウントが完全に 0 に戻ったときにのみ、そのアセットを保持している物理メモリの解放を許可します[^23]。

Addressables が AssetBundle アーキテクチャを介して依存関係を管理しているため、複雑さは指数関数的に増大します。1 つのアセット（例：マテリアル - Material）をロードする際、システムはそのマテリアル自体をロードするだけでなく、それが依存するコンポーネント（例：Texture）を含むすべての AssetBundle を自動的にロードします[^25]。依存関係グラフ（dependency graph）はバンドル（Bundle）単位で計算されるため、Bundle A 内のアセットが Bundle B 内のアセットを参照している場合、Bundle B 全体がホストメモリにロードされなければなりません[^26]。

このアーキテクチャにおける Unity の最も厳格な技術的制約は、**ユーザーが AssetBundle の内容を部分的に解放（partially unload）することはできない**という点です[^23]。具体例として、`"stuff"` という名前の AssetBundle に `木（Tree）`、`戦車（Tank）`、`牛（Cow）` という 3 つの独立したアセットが含まれていると仮定します[^23]。

1. `木` アセットがロードされると、メモリ分析ツール（Profiler）には `木` に対する 1 つの参照と、`stuff` バンドルに対する 1 つの参照が表示されます[^23]。
2. 続いて `戦車` アセットがロードされると、`戦車` のカウントが増え、`stuff` のカウントは 2 に増加します[^23]。
3. ゲームが `Release(木)` 命令を実行すると、`木` のカウントは 0 に下がり、Profiler 上の青いバーは消えます[^23]。
4. しかし、`木` の物理データは依然としてシステムメモリ内に残ったままになります。`戦車` がなお接続を維持しているため `stuff` AssetBundle のカウントが 0 より大きく、バンドル全体が完全に解放されるまで、このバンドル内のいかなるアセットも破棄することが許されないのです[^23]。

### 「Asset Churn」症候群とメモリ肥大化（Memory Bloat）

アセットが短時間のうちに繰り返しロード・解放され、直後に再ロードされる現象は **「Asset Churn」**（アセットの頻繁な入れ替え／せめぎ合い）と定義されます[^23]。この問題は通常、レベル（levels）間の切り替え時に発生します。レベル 1 で `ボート（Boat）` アセットを使用し、レベル 2 で `飛行機（Plane）` アセットを使用し、双方が共通の `迷彩（Camouflage）` テクスチャを共有している場合を考えます。レベル 1 を抜ける際に開発者が `ボート` を解放すると、Addressables システムは即座にメモリから `迷彩` テクスチャをアンロードします。その 1 ミリ秒後、レベル 2 が `飛行機` を生成すると、システムはハードディスクに対してその `迷彩` テクスチャを最初から再読み込みするための I/O サイクルを強制実行することになります[^23]。このプロセスはフレーム時間の急激なスパイク（spikes）を生み、特にモバイルハードウェアにおいてメモリ使用量を危険水準まで押し上げます[^27]。

さらに、`Release` 命令の呼び出し漏れがあるとゴミ参照が蓄積し、わずか数回のシーン遷移だけで RAM 使用量が数百メガバイトからギガバイト規模へと膨れ上がってしまいます[^28]。`DelayedActionManager` や Addressables 自体は MonoBehaviour の純粋な `Instantiate` メソッドによって生成されたインスタンス（instances）の数を追跡しないため、メモリハンドルの追跡にわずかなミスでもあれば永久的なメモリリークを引き起こします[^6]。

### データ圧縮アーキテクチャとメモリ割り当てへの負荷

AssetBundle のサイズとデータ圧縮方式は、データが RAM 上にどのように常駐するかに直接影響します。圧縮方式の選択によって、AssetBundle が大量の永続メモリを占有するか、あるいは帯域幅を最適化できるかが決まります。

AssetBundle 圧縮アルゴリズムの特性とストレージへの影響まとめ表[^29]：

| 圧縮アルゴリズム | ローカルファイルの認識可否 | バンドル全体の RAM ロード要否 | パフォーマンスおよびストレージへの影響 |
| :--- | :--- | :--- | :--- |
| **LZMA** | 不可。バンドルが一塊で圧縮される。 | **必要。** ファイル全体をメモリへ展開する必要がある。 | 圧縮率が最も高くダウンロード容量は小さいが、展開時に急激なメモリ肥大化（Memory Bloat）と高負荷な CPU 消費を引き起こす[^29]。 |
| **LZ4** | 可能。チャンク単位（chunk-based）圧縮。 | **不要。** アクセス中のデータ部分のみをロードする。 | デフォルトの標準として推奨。すべてのメタデータを RAM に展開せずローカルディスクへ直接キャッシュ（caching）可能[^29]。 |
| **Uncompressed** | 可能。各アセットを独立認識。 | **不要。** 直接アクセスする。 | 展開時間のコストなし、元ファイルサイズは最大。ディスク帯域幅が許す場合の即時ロードに最適[^29]。 |

巨大な LZMA 圧縮された AssetBundle からごく小さなアセットを 1 つ要求しただけでも、ファイル全体（ヘッダ、メタデータ、ストリーミングキャッシュテーブルを含む）をハードドライブから RAM へ転送しなければなりません[^27]。この設計ミスは、巨大な AssetBundle をアプリケーションのメモリ不足クラッシュ（OOM crashes）を引き起こす時限爆弾へと変えてしまいます[^27]。

## アセット管理のベストプラクティス（Best Practices）

参照カウントシステムの複雑さを制御し、`DelayedActionManager` への負担を抑えるため、システムアーキテクトはアセットライフサイクル最適化技術と組み合わせた極めて厳格なライフサイクル構造を適用しなければなりません。

### 1. 生成と解放サイクルの対称的な同期

API から返されるすべての `AsyncOperationHandle` オブジェクトは、使用ライフサイクルの終了時に必ず解放されなければなりません[^6]。これを怠ると、メモリリークを引き起こすだけでなくシステムクラッシュ（crashes）につながる恐れがあります[^6]。以下の表は、Addressables プログラミングにおいて必須となる対称ペアを示しています：

| 生成 / ロードメソッド | 対応する解放メソッド | 内部の動作メカニズム |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | 対象アセットを含む AssetBundle の参照カウントから 1 を減算する[^6]。 |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | 表示オブジェクト（Instance）を破棄し、元の Prefab のカウントから自動的に 1 を減算する[^4]。 |
| `AssetReference` 経由での割り当て | `reference.ReleaseAsset()` | ハンドル経由での Release 呼び出しと同等で、静的参照をクリーンアップする[^6]。 |

特に、ゲーム設定を保存するために `ScriptableObject` を使用する際、オブジェクトを直接参照（`public Object _worldAsset`）するとハード参照（hard references）が生成され、システム全体がそのアセットを即座に RAM へロードするよう強制されます[^27]。最適な解決策は、`AssetReference`（`public AssetReference addressableAsset;`）を使用して必要に応じた非同期ロード（on-demand loading）を行うことです[^6]。

### 2. 低レベルでの介入：Resources.UnloadUnusedAssets()

「部分解放不可」の特性により共有 AssetBundle のメモリ状態がデッドロック状態に陥ったジレンマ的状況（例：`木` アセットが `戦車` と一緒に閉じ込められている場合）において、唯一の脱出口となるのがエンジン基底層からの強制 API である `Resources.UnloadUnusedAssets()` の使用です[^25]。

この機能はシステム RAM 全体を深くスキャンして、実際のエンジン内部参照数（actual engine references）が完全に 0 であるすべてのアセット（AssetBundle 内に隠れたアセットを含む）を探索し、強制的に破棄します[^25]。とはいえ、これは CPU がクリーンアップスキャンを実行するためにロジックスレッドを一時停止しなければならないため、極めて高い計算パフォーマンスコストを伴い、深刻なフレームレート低下（FPS drops）を引き起こす処理です[^27]。エンジニアはこのコマンドを大規模な画面切り替え区間（loading screens）でのみトリガーするか、あるいは `SceneManager.LoadScene` によるシーン遷移時にシステムが自動的に呼び出す仕組みに委ねるべきです[^29]。

### 3. AssetBundles の設計と分割（Bundle Packing Modes）

Addressables 設定画面でグループ（Groups）構造をどう編成するかは、メモリロード性能とダウンロード帯域幅を直接決定づけます。アセットの種類に適したパッケージングモード（Bundle Mode）を選択することは、極めて重要な設計ステップです[^6]：

* **Pack Together（まとめてパック）**：常に同時に出現し、ライフサイクルが密接に結びついているアセットに使用します。これにより依存関係グラフの解析コストとネットワーク I/O を最小限に抑えられます[^6]。
* **Pack Separately（個別にパック）**：常に一緒にロードされる保証がない巨大な独立アセットや大規模なマップに最適です。大きなアセットが別の小さなアセットの解放を妨げてしまうリスクを排除します[^6]。
* **Pack Together By Label（ラベル別にパック）**：ラベルのメタデータを通じて散在するアセットを結合できます（例：`"Halloween 2023"` ラベルを付与してイベントコンテンツ全体を 1 つのバンドルにまとめ、CDN 経由で容易に更新できるようにする）[^6]。

AssetBundle 内の型情報テーブル（`TypeTree`）の負荷をさらに深く削減するため、開発者は `BuildAssetBundleOptions.DisableWriteTypeTree` オプションを有効にすることができます。この機能は不要なメタデータ量を削除しますが、実行ファイルを出力する前に暗号化メモリの再構築（rebuild local groups）を行う必要があります[^26]。

### 4. オーディオとグラフィックスのメモリ管理（Graphics & Audio）

補助レイヤーを最適化することは、ガベージコレクタの稼働頻度による負荷を軽減する最も効果的な手段です。オーディオストリームのロード形式設定はメモリに直接影響します[^27]：

* **長い背景音楽（BGM）**：ディスクから小さなバッファ領域ごとに読み込むよう **Streaming** を設定する必要があります[^27]。
* **長い効果音**：RAM 上で圧縮状態を維持し、再生時にリアルタイムでデコードする **Compressed In Memory** を選択します[^27]。
* **短い／高頻度の効果音**：CPU コストを排除して非圧縮データを直接準備できるよう **Decompress On Load** を使用します[^27]。

これに加えて、Texture の `"Read/Write enabled"` オプションを無効化し、UI グラフィックスカメラの深度ステンシルフォーマットを無効（Depth Stencil Format to None）に設定することで、不要なレンダリング RAM 使用量を少なくとも 50% 削減できます[^27]。

## グローバルな相互作用についての結論

`DelayedActionManager` に関する調査は、`DontDestroyOnLoad` シーンに隠されたオブジェクトの起源を解き明かすだけでなく、Unity における Addressables システムの基本的な設計哲学を浮き彫りにします。この `ComponentSingleton` クラスは、解放プロセス、非同期呼び出し、およびバッファ処理を `LateUpdate` サイクルへ誘導することでデータの整合性を保つ、精巧な時間的架け橋として機能します。これにより、`Update` スレッドに属する物理コードや制御ロジックによって引き起こされ得る中断からメモリ構造の変更を隔離し、シーン遷移時のシステム破損例外に対する盾を形成しています。

しかし、`DelayedActionManager` はメモリ管理アーキテクチャに内在する弱点をすべて解決できる魔法の杖ではありません。それはソフトウェアアーキテクトに対し、完全に対称的なアセットのロード／解放サイクルを維持すること、ネイティブ C++ オブジェクトをキャプチャするループを避けるよう C# の匿名式（lambdas）を設計すること、そして根強いメモリリークを防ぐために AssetBundle 構造を分割（modularize）することを厳格に要求します。非同期ロードのルーティングに対する深い理解と、LZ4 のような圧縮方式の適切な活用、そして `Resources.UnloadUnusedAssets` の強制力を組み合わせることで、開発チームは恒久的なリソース枯渇の懸念なく、あらゆるプラットフォーム上で高い拡張性を備えた堅牢なアーキテクチャモデルを設計できるでしょう。

## **参考文献**

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

### 関連資料

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
