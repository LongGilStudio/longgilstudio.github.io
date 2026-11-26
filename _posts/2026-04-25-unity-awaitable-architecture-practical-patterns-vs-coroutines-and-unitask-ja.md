---
title: "Unity Awaitableシステム入門：アーキテクチャ、実践パターン、およびCoroutines・UniTaskとの比較"
date: 2026-04-25 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, awaitable, async, coroutines, optimization]
description: "UnityのAwaitableシステムの詳細な分析、CoroutinesおよびUniTaskとの比較、そして実務プロジェクトにおける安全な導入戦略を解説します。"
lang: ja
translation_id: unity6-awaitable-vs-coroutines
---

{% include embed/youtube.html id='eXkFPoEp3BA' %}

## **Unityエコシステムにおける非同期アーキテクチャの概要**

Unityを用いたリアルタイムのビデオゲームやシミュレーションソフトウェアの開発において、メインフレームループ（`main frame loop`）を停滞させずに時間のかかる処理の実行フローを制御することは、常に最も中核的な技術課題の一つです。すべてのUnityアプリケーションの心臓部にあるのがメインスレッド（`Main Thread`）であり、ゲームロジック、物理演算、グラフィックス、ユーザーインターフェースの処理を担っています。ディスクからの大容量アセットファイルの読み込み、リモートデータベースへのクエリ送信、ネットワーク接続の確立など、待機を伴う同期処理をそのまま実行すると、メインスレッドがフリーズする危険性があります。この問題はフレームの引っかかり（`stuttering`）やフレームレートの低下（`frame rate drops`）として直接現れ、エンドユーザーの体験を大きく損ないます。[^1]

`Unity API`のような基本的にシングルスレッドの環境で並行性（`concurrency`）の課題を解決するため、プラットフォームはソフトウェアアーキテクチャ面で長い進化の過程を経てきました。[^3] 10年以上にわたり、Unityが提供してきた唯一のネイティブソリューションは`Coroutine`システムでした。[^3] `Coroutine`は並列実行スレッド（`multithreading`）ではなく、自身の実行を一時停止してエンジンループへ制御を戻し、特定の条件が満たされた将来のタイミングで自動的に処理を再開できるメソッドです。[^1] しかし、C#言語が上位バージョンへ進化するにつれ、`async`と`await`キーワードを用いる`Task-based Asynchronous Pattern (TAP)`モデルが次第に業界標準となりました。[^6] `.NET Task`モデルは明確で直線的な構文や戻り値のサポート、強力な例外処理機能を備えている一方で、割り当てサイクルごとに無視できない量のガベージメモリを生成し、Unityの`PlayerLoop`と本質的に同期しないという制約を抱えていました。[^5]

従来のCoroutineと`.NET Task`双方の限界により、CysharpのUniTaskに代表される強力なオープンソースライブラリが普及し、Unity向けに最適化されたゼロアロケーション（zero-allocation）の非同期ソリューションが提供されるようになりました。[^7] サードパーティ製ライブラリに依存せず、エンジンコアレベル（engine-level）で深く統合された標準化ソリューションの必要性を認識したUnityは、Unity 2023.1からAwaitable構造を正式に導入し、Unity 6でこれを完成させました。

Awaitableクラスは本質的に非同期処理を包むラッパー（wrapper）構造であり、処理の完了時に開発者のメソッドを一時停止・自動再開させることができます。Awaitableシステムは、async/awaitモデルの構文的な利点と、Coroutineの持つオブジェクトのライフタイム（object lifetime）およびフレームループ（frame loop）への親和性を兼ね備えるよう精巧に設計されています。本レポートでは、その動作メカニズムを詳しく解剖し、メモリのボトルネックを分析し、従来の仕組みと深く比較したうえで、実務プロジェクトへ安全に導入するためのアーキテクチャパターン（architectural patterns）を提示します。

## **Awaitableシステムのコアメカニズム解剖**

Awaitableシステムの誕生は、単にエンジンの語彙に新しいキーワードを一つ追加しただけのものではなく、C#のステートマシン（State Machine）がガベージコレクタ（Garbage Collector）およびUnityエンジンのスケジューリングシステムと連携する仕組みへの意図的な介入です。

### **オブジェクトプーリング（Object Pooling）とメモリ最適化**

通常のC#プログラミングでは、`async`メソッドが呼び出されて`System.Threading.Tasks.Task`オブジェクトを返すたびに、.NETランタイムは待機状態を管理するため、その`Task`オブジェクトと関連データ構造用のメモリを`Heap`上に確保する必要があります。[^6] 毎秒60フレームで動作するゲームにおいて、アニメーション、AI、UI更新を制御するために数百から数千もの非同期処理を連続して生成すると、割り当てられるオブジェクト量は指数関数的に膨れ上がります。[^5] これによりガベージコレクション（`Garbage Collection - GC`）に巨大な負荷がかかり、`GC`がより頻繁に動作せざるを得なくなり、システムが`Heap`を掃除するたびにフレームが一瞬止まる現象（`GC spikes`）を引き起こします。[^5]

この問題を根絶するため、UnityはAwaitableクラスを内部のオブジェクトプーリング（Object Pooling）機構に基づいて動作するよう設計しました。AwaitableとTaskの最も根本的な違いは、返されるオブジェクトのライフタイムにあります。Awaitableを返すメソッドが処理を終えても、そのAwaitableクラスのインスタンス（instance）はGCによる回収を待って破棄されるわけではありません。代わりに、Unityは即座にこのオブジェクトを隠されたプールへと回収します。[^11] 次に別の非同期メソッドが起動されると、エンジンはプールに保持されていたそのAwaitableオブジェクトを再利用します。[^8] この一連の流れにより、ゲームの実行時（runtime）における動的メモリ割り当てコストの大半が削減されます。

しかし、このプーリングアーキテクチャは、開発者が厳格に順守しなければならない極めて重要なソフトウェア設計原則を課します。それが単回使用ルール（The Single-Use Rule）です。Awaitableオブジェクトは再利用されるため、await（待機）できるのは厳密に1回限りとなります。開発者がAwaitableオブジェクトへの参照を保持し、同じインスタンスに対して2回awaitを実行しようとすると、アプリケーションは危険な状態に陥ります。2回目の時点では、そのAwaitableオブジェクトはすでにプールへ返却され、まったく別の処理へ割り当てられている可能性があり、予測不能な例外（exceptions）、デッドロック（deadlocks）、あるいはデータ間の干渉を引き起こします。[^11] この仕組みでは、業務アプリケーション開発でよく見られる「結果を複数回確認するためにTaskを変数に保存しておく」習慣を捨てる必要があります。

### **PlayerLoopの同期とスレッド切り替え（Thread Switching）**

Unityにおいて非同期システムが解決すべき2つ目の複雑な課題は、スレッド安全性（`thread safety`）です。空間座標（`Transform`）の変更からオブジェクトの生成（`Instantiate`）に至るまで、UnityのAPIのほとんどはマルチスレッド環境で安全ではなく、`Main Thread`からのみ呼び出すことが許されています。[^12] 従来の.NETの`Task`モデルで扱う場合、`await`の後に続く後続処理（`continuation`）は、保存されていた同期コンテキスト（`Synchronization Context`）上で実行されます。[^13]

デフォルトでは、Unityは標準の`SynchronizationContext`を`UnitySynchronizationContext`で上書きしています。[^13] このコンテキストは、バックグラウンドスレッド上に散らばって実行されている`.NET Task`のすべての後続処理を収集し、次フレームの更新ティック（`Update tick`）で安全に実行できるようメインスレッドへ押し戻す役割を担います。[^13] 安全ではあるものの、このコンテキスト切り替え処理は少なからぬパフォーマンスコスト（`overhead`）を生み、特に数千のオブジェクト規模へとシステムが拡大した際には遅延（`latency`）を増大させます。[^13]

`Awaitable`システムは、`PlayerLoop`アーキテクチャと直接やり取りすることでこのコストの大部分を取り除きます。別段の指定がない限り、UnityのAPIやユーザー定義メソッドから返されるすべての`Awaitable`は次の規則に従います。メインスレッドから呼び出されたメソッドはメインスレッド上で再開され、バックグラウンドスレッド（`ThreadPool`）から呼び出されたメソッドは自動的にバックグラウンドスレッド上で再開されます。[^13] さらに、`Coroutine`の従来の`yield return`命令を完全に置き換えるため、`Awaitable`クラスには`PlayerLoop`の周期を精密に再現する関数が組み込まれています。`await Awaitable.NextFrameAsync()`を使えば、処理がリソースを譲って次のフレームで再開されるため、`yield return null`命令によってガベージを生んでいた手法よりもはるかに直接的で高効率な代替手段となります。一方、`await Awaitable.EndOfFrameAsync()`は、エンジンがグラフィックスやUIのすべてのレンダリング（`rendering`）処理を完了したタイミングに再開を同期させることで、開発者が安全にスクリーンショットを撮影したりフレームバッファを読み取ったりできるようにします。[^8]

この低レベル統合の真価は、明示的なスレッド切り替え（`Explicit Thread Switching`）の制御能力にあります。常に`Main Thread`に縛られる`Coroutine`とは異なり、`Awaitable`はスレッドの境界をスマートに越える手段を提供します。Unityの内部エンジンスレッド（オーディオやグラフィックスレンダリングのスレッドなど）は通常裏側で動いていますが、カスタムのC#コード（`custom C# background threads`）については、従来開発者が`Thread`クラスや`Task.Run`を手動で扱う必要がありました。[^14] `Awaitable`を使えば、膨大な計算負荷をCPUのバックグラウンドスレッドへ逃がす操作は`await Awaitable.BackgroundThreadAsync()`を1回呼び出すだけで済みます。複雑な計算（プロシージャルマップ生成、ファイル展開、AIの経路探索など）が完了した後は、シーン（`scene`）構造を変更するあらゆる命令を実行する前に、`await Awaitable.MainThreadAsync()`を通じて安全にメインスレッドへ戻ることができます。

## **アーキテクチャ比較：Awaitable vs CoroutinesおよびUniTask**

システムアーキテクチャの移行を判断するためには、ソフトウェアアーキテクトが旧システムの欠陥と競合ツールの限界を明確に定量化する必要があります。以下の表は、Unity環境における並行プログラミング手法の中核的な技術特性を体系化したものです。

| 技術特性                               | `Coroutine` (`IEnumerator`)                                      | `.NET Task` (`System.Threading.Tasks`)        | `UniTask` (Cysharp)                           | Unity `Awaitable`                                        |
| :------------------------------------- | :--------------------------------------------------------------- | :-------------------------------------------- | :-------------------------------------------- | :------------------------------------------------------- |
| **アーキテクチャの本質**               | イテレータステートマシン (Iterator State Machine)                | Heap上のオブジェクト割り当て                  | IValueTaskSource構造体 (Struct-based)         | Object Poolで管理されるクラス                            |
| **メモリフットプリント (GC割り当て)**  | `yield return new YieldInstruction`のたびに継続的にガベージ生成  | 非常に高コスト (`Allocation-heavy`)           | ほぼゼロ (`Zero-allocation`)                  | 高度に最適化 (`Pooling mechanism`)                       |
| **戻り値 (Return values)**             | 直接サポートなし（コールバックデリゲートが必須）                 | あり (`Task<T>`)                              | あり (`UniTask<T>`)                           | あり (`Awaitable<T>`)                                    |
| **例外処理 (Exception Handling)**      | 不可（`yield return`に`try/catch`を使用できない）                | ネイティブな例外捕捉 (`try/catch/finally`)    | 強力なサポート、`PlayerLoop`ログ統合          | ネイティブな例外捕捉 (`try/catch/finally`)               |
| **ライフタイム依存性**                 | `MonoBehaviour`とともに自動破棄                                  | 独立、`Scene`を跨いで生存し続ける             | `CancellationToken`の受け渡しが必要           | `CancellationToken`の受け渡しが必要                      |
| **スレッド制御 (Thread Control)**      | 常に`Main Thread`上で動作                                        | 自動的に`ThreadPool`を使用                    | きめ細かな`PlayerLoopTiming`制御              | ネイティブAPI：`BackgroundThreadAsync`と`MainThreadAsync` |
| **Addressables連携**                   | 複雑な`event subscriptions`が必要                                | あり (`.Task`)                                | `extension methods`による連携                 | ネイティブ統合                                           |

### **Coroutinesの設計上の欠陥**

長年にわたり、Coroutinesは扱いやすさとエンジンループとの完全な同期性によってゴールドスタンダードと見なされてきました。しかし、コードベースの規模が拡大するにつれ、このモデルの構造的な欠陥が露呈し始めます。[^1]

`Coroutine`の最も深刻な欠点は、正規の例外処理機構が完全に欠如していることです。[^1] コンパイラが`IEnumerator`イテレータメソッドを暗黙のステートマシンクラスへ変換する性質上、`yield return`文を`try/catch`ブロックで囲むと即座にコンパイルエラー（`Compiler Error`）が発生します。[^18] 仮に`Coroutine`内のネットワーク読み込み処理でタイムアウト（`timeout`）や接続切断が起きても、`catch`によるリカバリ処理（`fallback logic`）や`finally`によるリソース解放を自動起動する手段がありません。[^1] エラーは水面下で発生し、`Coroutine`は黙って終了し、システムを中途半端な状態のまま放置してしまいます。[^1] 対照的に、`Awaitable`はネイティブの`async/await`構造の利点を継承しており、あらゆる`Exception`を確実に捕捉してスマートに処理できます。[^1]

さらに、双方向のデータ受け渡しも`Coroutine`における悩みの種です。[^20] `return`キーワードを使って値を返すことができないため、開発者はグローバル変数に頼るか、`Action<bool> onComplete`のようなコールバック関数（`callbacks/Actions`）を渡さざるを得ません。[^1] 一連の連続処理を数珠繋ぎにする必要が生じると、`callbacks`への依存によってコードは非線形な絡み合い（いわゆる「Callback Hell」）へと変貌します。[^2] `Awaitable`はジェネリック型`Awaitable<T>`を返せる機能により、この問題をあっさり解決します。[^8] 開発者はアセットを読み込み、結果を待ち、同期処理のように1行のコードで即座にローカル変数へ格納できます。[^15]

最後に、待機命令オブジェクトによるガベージ生成（`Garbage Generation`）は、パフォーマンス最適化における根本的な弱点です。[^5] `yield return new WaitForSeconds(2f)`という記述は無害に見えますが、このコードが実行されるたびに`Heap`上に新しい`WaitForSeconds`オブジェクトが確保され、2秒経過後に破棄されて`GC`による回収を強いることになります。[^5] `Awaitable.WaitForSecondsAsync(2f)`システムは`new`キーワードを必要とせず、内部機構を通じてタイマーを再利用するため、こうした割り当てによるリークを完全に排除します。

### **Cysharp UniTaskとの比較評価**

Awaitableの登場を語るうえで、Unityの非同期分野を長らく席巻してきたライブラリであるUniTaskとの比較は避けられません。[^6] 公平に見ても、AwaitableのアーキテクチャはUniTaskの設計思想から非常に大きな影響を受けて形作られています。[^22]

`UniTask`はもともと`struct`ベースの構造（クラスとしてのメモリ割り当てを完全に排除）であり、極めて巨大なエコシステムを備えています。[^9] `UniTask`は開発者が`PlayerLoop`の特定のタイミング（例：`EarlyUpdate`、`PreLateUpdate`）へ待機を細かく誘導することを可能にし、`Asynchronous LINQ`を提供し、コンパイラの警告を出さずにタスクを安全に投げっぱなしにできる有名な`.Forget()`メソッドを備えています。[^7] また、停止したタスクを検出する視覚的デバッグツール`Tracker Window`も搭載しており、これはネイティブの`Awaitable`にはまったく欠けている機能です。[^22]

`Awaitable`は機能の観点からは`UniTask`のサブセット（`subset`）と位置づけることができます。[^22] `pooling`機構によって割り当てられるクラスベースであることは、複数タスクの同時待機機能をネイティブに再現できないことを意味します。`UniTask`では`UniTask.WhenAll`が複数の並列処理を起動する中核となっています。[^7] 一方、`Awaitable`では`pooling`の`Single-Use Rule`の制約があるため、`Task.WhenAll`を使う前に`.AsTask()`拡張メソッドを使って`Awaitable`インスタンスを標準の`.NET Task`へ変換しなければなりません。それでもなお、`Awaitable`が持つ比類なき強みは、サードパーティ製のパッケージ（`package`）を一切必要とせず、エンジンの標準ライブラリに完全に組み込まれている点です。[^6] この特徴により、プラグインライブラリや共通アセットを構築する開発者、あるいは外部ライブラリの互換性管理という煩雑さに関わりたくないアーキテクトにとって絶対的な第一選択肢となります。[^23] なお、`UniTask`には`Awaitable`を逆変換できる`AsUniTask()`拡張メソッドが用意されており、同一プロジェクト内での両システムの平和的な共存を可能にしています。[^23]

## **代表的な実践ユースケース（Use Cases）**

Awaitableシステムがもたらす変革の力は、従来の処理構造を直線的でクリーンかつ安全な実行フローへと再構築する際に最も鮮明に現れます。以下に、Awaitableが圧倒的な優位性を発揮する具体的な活用シーンを詳述します。

### **1. Addressablesアセットシステムの管理（Asset Streaming & Management）**

`Addressables`アセット管理システムは、アプリケーションの起動時にカクつき（`stuttering`）を起こすことなく、端末ストレージやリモートサーバーから静的アセット（画像、音声、モデル）を読み込む標準的な手法を提供します。[^25] 従来、このロード処理はイベント駆動型アーキテクチャ（`event-driven callbacks`）に強く依存するか、毎フレーム`isDone`状態フラグを確認する`yield return`ループに組み込む必要がありました。[^25]

`Awaitable`の登場と`AsyncOperationHandle`クラスが返す`Task`プロパティの組み合わせは、アセット要求のあり方を再定義します。複雑な複数のロードループを連結する代わりに、アセット読み込みのロジックは構文上完全に同期的な流れで記述できるようになります。

```csharp
var handle = Addressables.LoadAssetAsync<Texture2D>("asset_key");
await handle.Task;
var texture = handle.Result;
```

キャラクターの生成にステータスデータ（`ScriptableObjects`）、ジオメトリモデル（`Prefabs`）、アニメーションコントローラ（`Animation Controllers`）がすべて必要な大規模プロジェクトでは、`InstantiateAsync`の処理を独立した`Awaitable`メソッドへと切り出すことができます。[^12] これら一連の処理を`Task.WhenAll(operation_1.AsTask(), operation_2.AsTask())`構造で集約することで、ロード画面（`loading screen`）のプログレスバーを極めて信頼性の高い正確な状態に保ち、帯域幅へのアセット集中による局所的な遅延現象を取り除くことができます。

### **2. UIロジックフローと会話カットシーンの実装（Sequencing）**

ロールプレイングゲーム（RPG）やユーザーチュートリアル（Onboarding/Tutorials）の区間では、カメラの移動、画面のフェードアウト、指定地点へのキャラクター移動、会話ウィンドウの表示、ユーザーの確認ボタン押下待ちといった厳密な時系列に沿った演出ロジックが頻繁に求められます。[^1]

`Coroutine`のエコシステムでこのイベント列を組むと、無数の細切れな`IEnumerator`関数にコードが散らばり「スパゲッティコード」へと化してしまいます。[^1] `Awaitable`では非同期コードが直線化されるため、これらのメソッドを散文のように自然に書き下ろすことができます。`await Awaitable.WaitForSecondsAsync`命令は必要な時間遅延を確実に担保します。同時に、従来`Coroutine`で`WaitUntil`を用いていた条件付き一時停止の仕組みも、`Awaitable`ループを実装することで強力にアップグレードできます。たとえば条件待機関数`AwaitableUntil(Func<bool> condition)`を用意すれば、絶えずポーリングする代わりに`NextFrameAsync`と`CancellationToken`を組み合わせて、（プレイヤーのマウスクリックなどの）論理式が真を返すまでCPUリソースを浪費することなくスレッドを一時停止できます。[^11]

### **3. 能動的なスレッド切り替えによる高負荷計算の最適化（Offloading CPU Work）**

高密度な座標グリッド上のA\*経路探索（Pathfinding）アルゴリズム、3Dプロシージャルボクセル地形生成（Procedural Voxel Generation）、あるいはサーバーから返された巨大なJSONデータの解析といった演算負荷の高い機能の実装は、フレームレート低下（FPS drops）の主因となります。[^2]

これらのアルゴリズムを`Awaitable`内に配置すると、能動的なスレッド切り替えアーキテクチャ（`explicit thread switching`）が絶大な価値を発揮します。コードはメインスレッド上で開始し、空間環境のデータを収集します。直後に`await Awaitable.BackgroundThreadAsync()`が呼び出され、この処理の実行コンテキスト全体がプロセッサの`ThreadPool`システムへと委譲されます。このバックグラウンドスレッド上で、経路探索アルゴリズムはゲームのUIを一切引っかけることなく、数十ミリ秒にわたり独立したCPUコアを100%占有して計算を実行できます。

ただし、エンジンの基盤オブジェクト（`Transform`、`GameObject`）はスレッド安全性のためロック（`thread-locked`）されているため、バックグラウンドスレッドから直接キャラクターを生成したり移動したりすることはできません。[^12] そこで処理は再び`await Awaitable.MainThreadAsync()`を用いて、コンテキストを安全に`Main Thread`へ引き戻します。この時点で計算ループの結果はすでに完了しているため、開発者はオブジェクトの座標を滑らかに更新する命令を下すことができます。[^12]

### **4. Job Systemのマルチスレッド機能との連携**

Unityで最も洗練されたツールの一つが、データ指向技術スタック（`Data-Oriented Technology Stack - DOTS`）向けに設計された`C# Job System`です。[^5] `Job System`は並列実行性能に最適化されているものの、`Main Thread`に`Job`の完了を待たせることは依然として`PlayerLoop`の流れを阻害し得ます。`Awaitable`は優れた中間スケジューリング（`scheduling`）の解決策を提供します。`Job`を実行して`Complete()`を呼び、`Main Thread`をフリーズさせて結果を待つ代わりに、`Awaitable`メソッドが`Job`をスケジュールし、`await Awaitable.NextFrameAsync()`で現在のフレームを描画するようエンジンへ制御を戻し、次のフレームで`jobHandle.Complete()`を呼び出して安全に計算結果を回収できます。[^11] この組み合わせにより、群衆物理シミュレーションや流体システムに対して最適なタイムスライス（`time-slicing`）処理を実現できます。[^14]

### **5. Unity Test Frameworkを用いた自動テスト**

自動化されたコードによる品質保証（`Automated Testing`）はソフトウェア工学の柱です。`Unity Test Framework`は、テストランナーが主に`IEnumerator`形式のテスト関数を認識するため、非同期コードの扱いに多くの障壁を抱えてきました。[^11] `Unity Test Framework`は現在`Awaitable`をテストの有効な戻り値型として認識しないため、開発者はローカル関数（`local functions`）を活用してこれを統合できます。反復可能な`IEnumerator`関数の中にローカル関数`async Awaitable TestImplementation()`を内包し、その中でモックサービス、ネットワーク呼び出し、アセット読み込みをテストする完全な`await`構文を記述して、標準のイテレータとして返却します。これにより、複雑なネットワークプロジェクトへ`Test-Driven Development (TDD)`を導入する際の障壁が取り払われます。[^11]

## **キャンセル管理アーキテクチャ（The Cancellation Architecture）：ライフタイムの安全性**

`Coroutine`から`Awaitable`、`Task`、あるいは`UniTask`へ移行する際の最大の思考の壁は、非同期処理の存在とライフタイム（寿命）に関する設計思想です。[^29] この点に対する誤解は、システムをクラッシュさせたり開発作業を妨げたりする追跡困難なシステムバグ（`memory leaks`、`phantom executions`）の温床となります。[^29]

### **独立したステートマシンの危険性**

本来の設計上、`Coroutine`はそれを起動した`MonoBehaviour`オブジェクトのライフタイムに強く結び付けられています。[^18] スクリプトを保持する`GameObject`が`Destroy()`関数によって破棄（`destroyed`）されたり、無効化されたり、シーン（`Scene`）が切り替わったりすると、Unityエンジンは静かに後始末を行い、`Coroutine`自体も消滅させます。[^29] たとえ`Coroutine`内部のループ条件が`while (true)`であっても、宿主となる本体より長く生き残ることはありません。この自動化は、長年にわたり開発者がメモリ解放の規律を怠ることを許容してきました。[^29]

対照的に、`async/await`メソッドは`Heap`上の別空間に存在する独立したステートマシン（`independent State Machine`）へとコンパイルされます。[^29] 明示的に指示しない限り、`Awaitable`の処理は`GameObject`の存続や消滅を一切認識しません。仮に敵AIがネットワーククエリを呼び出したり5秒間のアニメーションを待機したりしている最中に、2秒目でプレイヤーに倒されたとしても、非同期タスクはそのまま時間をカウントし続けます。[^29] そして5秒目にステートマシンが再開（`resume`）し、`transform.position`やキャラクターのプロパティを参照する次の行を実行した瞬間、アプリケーションはコンソール（`console`）を埋め尽くす大量の`NullReferenceException`や`MissingReferenceException`エラーを噴出します。[^29] さらに危険なのは、特に`Unity Editor`での開発時です。`Play Mode`を停止した際に適切にキャンセルされなかった`Awaitable`タスクは、`Edit Mode`の裏側で密かに動き続け、プロジェクト全体のデータ（`Scene data`）を削除・改変・破損させるといった壊滅的な結果を招く恐れがあります。[^24]

### **キャンセルオブジェクトモデル（CancellationTokenSource）**

こうした状況に対する.NETの唯一かつ最も標準的な解決策が、`CancellationToken`という軽量オブジェクトに基づく協調的キャンセル（`Cooperative Cancellation`）機構です。このモデルの原理はオブザーバーパターン（`Observer Pattern`）に似ています。初期化側のシステムが`CancellationTokenSource`を管理し、このオブジェクトが発行するトークン（`CancellationToken`）を非同期呼び出しチェーンの最下層メソッドまで伝播させます。[^31] 電源をいきなり引き抜くような強制終了とは異なり、トークンは処理自体を直接殺すのではなく、キャンセル要求を伝達する役割を担います。[^32] 実行中の各機能やスレッドは定期的にこのトークンのシグナルを確認または待機し、自発的に作業を停止する判断を下します。[^31]

この機構の極めて高い重要性を認識したUnityは（2022.2版以降）、基底の`MonoBehaviour`クラス内部に`destroyCancellationToken`プロパティを標準搭載しました。開発者が`await Awaitable.WaitForSecondsAsync(1, destroyCancellationToken)`のように読み込みや待機ループを記述すると、このプロパティはその`GameObject`に対してシステムから破棄命令が下されたまさにそのフレームで自動的にキャンセルシグナルを発火させます。この簡潔な連携によって、開発者による明示的なトークン受け渡しを前提としつつも、`Coroutine`と同等の自然なレベルまでライフタイムの安全性（`lifetime safety`）が回復されます。

### **設計思想の違い：静かな停止 vs キャンセル例外**

`Awaitable`の`Cancellation`モデルは、ベテランのUnity開発者ほど戸惑いを覚えがちです。`Coroutine`が停止されるときは「静かに（`silent stop`）」終了します。[^30] しかし`CancellationToken`が作動（`Cancel`）するか、開発者が直接`Awaitable.Cancel()`コマンドを呼び出すと、待機中だったメソッドは即座にシステムレベルの例外である`OperationCanceledException`（または`TaskCanceledException`）を送出します。[^10] この例外がUnityのログ出力システムまで伝播（`propagate`）すると、開発者を驚かせる赤いエラー警告が出力されます。[^10]

例外を送出する本質はプログラミング上のバグではなく、コードの整合性を守るための保護機構です。[^34] 処理が何の通知もなく停止すると、その処理が保持していたリソースは宙に浮いたまま放置されます。タスクは大容量メモリ領域を読み込んでいる最中かもしれませんし、データベース接続（Database socket）を開いたままかもしれませんし、プレイヤーのボタン二度押しを防ぐロックフラグ（lock flag）を立てている最中かもしれません。[^33] 合図なしに処理が断ち切られると、システムはこうしたリソースロックを二度と解放できず、メモリを静かに消費し続けたりサーバー上のアプリケーション全体をフリーズさせたりする「ゾンビプロセス」（zombie processes）を生み出してしまいます。[^34]

`OperationCanceledException`を送出することで、例外は`call stack`を遡り、標準の`catch`および`finally`ブロックで受け止めることが可能になります。[^19] `finally`ブロックにおいて、開発者は`connection.Dispose()`の呼び出し、`isWorking = false`のリセット、一時バッファ配列の解放などを容易に実行できます。[^19] これこそがソフトウェアアーキテクチャ上の優位性であり、中断されたすべてのタスクが周囲の環境のクリーンな状態を自発的に回復することを保証します。[^19]

### **複雑なロジックのための連結トークン（Linked Tokens）**

商用開発の実務においては、一つの処理に対してキャンセル理由が複数存在することが一般的です。たとえば、新しいステージのロード処理は、次の3条件のいずれかを満たした瞬間に即座に中断されなければなりません。（1）UI管理オブジェクトが破棄された、（2）ユーザーが手動で「キャンセル」ボタンを押した、または（3）待機時間が30秒を超えた（Timeout）。

至るところに無数の`if`分岐を散りばめる代わりに、.NETと`Awaitable`システムは`CancellationTokenSource.CreateLinkedTokenSource`パターン（`pattern`）を活用します。このメソッドは複数の独立した`Token`（`GameObject`の`destroyCancellationToken`、`Application.exitCancellationToken`、自己破棄タイムアウト用トークンなど）を受け取り、それらを単一の統合トークン（`Linked Token`）へと結合します。開発者はこの合成トークンをクエリシステムの最深層まで渡すだけで済みます。中核となる条件のどれか一つでも満たされればキャンセルシグナルが即座に発火し、一連のタスクチェーンが綺麗に断ち切られるため、極めて高い設計の柔軟性を得るとともに不確定な状態を完全に排除できます。

## **よくある落とし穴とアンチパターン（Anti-Patterns & Pitfalls）**

強力かつ高効率である一方、`Awaitable`システムには、従来の`.NET Task`システムと同じ感覚で扱おうとした経験の浅いアーキテクトを陥れる特有の罠が存在します。

### **1. 単回使用プーリング原則の破壊（The Single-Use Pooling Pitfall）**

メモリアーキテクチャの節で述べた通り、`Awaitable`インスタンスは結果を返した直後に`Pool`へ戻されるため、単回使用ルール（`single-use rule`）の制約を受けます。`C# Backend`の環境からUnityへ移ってきた開発者が最もよく犯す誤解は、`Awaitable`タスクを共通の変数に代入し、その変数をコード内の異なる箇所で複数回待機（`await`）してしまうことです。[^11] このような安全でないコード（`unsafe version`）は惨事を招きます。すでに`Pool`へ返却されたタスクが別の処理に割り当てられている可能性があり、2回目の`await`が結果へアクセスしようとした瞬間に深刻な例外を送出するか、UIを完全にフリーズさせる`Deadlock`を引き起こします。

この状況を乗り越えるための定石（`Best Practice`）は次の通りです。アルゴリズム上、単一のタスク結果を複数の実行フローで評価、待機、または共有する必要がある場合、開発者は必ず`.AsTask()`拡張メソッドを使って`Awaitable`を従来の形式へ変換しなければなりません。この処理は`Pool`から`Awaitable`を能動的に取り出し、`Heap`上に固定された`Task`を割り当てることで、並列待機や無制限の参照を可能にします。代償として`GC`のガベージが発生するため、本当に必要な場面に限定して使用すべきです。[^5]

### **2. タスク集約機能の不足（Task Aggregation Issues）**

ステージの初期化処理において、50個のクエリを同時に発火させ、50個すべてが完了したときにのみシーンを切り替えるというのはよくある要件です。[^7] `.NET Task`では`await Task.WhenAll(...)`という構文が完璧な指揮者の役割を果たし、`UniTask`システムでは`UniTask.WhenAll`がメモリゴミを出さずに同様の機能を提供します。[^7]

しかし、Unityネイティブの`Awaitable`は厳格な`pooling`の性質上、こうしたシステム集約API（`aggregation features`）が完全に欠落しています。[^22] `Task.WhenAll`を使うために`.AsTask()`で大量の`Awaitable`を`Task`へ変換する手法は代替案になりますが、最適化の原則に反します。さらに、従来の`WhenAll`機能には潜在的なリスクが潜んでいます。50個のタスクのうち1つでも例外を投げるかキャンセルされると、`WhenAll`命令は即座に早期終了（`exit early`）してしまいます。[^7] この状態は残り49個のタスクを制御不能（`unobserved`）なまま走らせ続け、孤立した状態変異（`orphaned state mutations`）を生み出す危険があります。[^7]

（プロジェクトで`UniTask`を併用するか同等の機能クラスを実装する場合）最も理想的な設計手法は、`WhenAllSettled`のような拡張バリアントを用いることです。[^7] この関数はシステムに対して監視を継続させ、すべてのタスクが（失敗であれ成功であれ）完全に終了するまで待機させたうえで、各処理領域の詳細なステータスを収集してから全体の判断を下すため、シミュレーションのデータ構造を完璧に保護できます。[^7]

### **3. キャンセル例外の握りつぶし問題（Swallowing Cancellation）**

`try/catch`ブロックは強力な武器ですが、伝播チェーン（`propagation`）の理解なしに乱用するとリスクへと転じます。[^34] `CancellationToken`が作動すると、子タスクから`OperationCanceledException`が伝わり上がってきます。[^10] 開発者がアプリのクラッシュを防ぐ目的で処理ブロック全体を汎用的な`catch (Exception e)`で囲んでしまうと、意図せずキャンセル例外まで一緒に「握りつぶして（`swallow`）」しまいます。[^34]

この誤った構造により、現在の関数は一般的なエラーとして記録するだけで、キャンセル例外を能動的に再送出（`re-throw`）しなくなります。その結果、外側にいる親メソッド（`parent caller`）は子タスクが問題なく完了したと無邪気に思い込み、後続のロジックを実行し続けてしまいます。[^34] こうして連鎖的な終了ループが断ち切られ、本来止まるべき処理がゾンビプロセスへと化します。[^34] 標準的な設計パターンでは、まず独立した`catch (OperationCanceledException)`ブロックでキャンセル例外を真っ先に捕捉して後処理を行い、上位の呼び出し元へ伝播させる必要がある場合は必ず`throw;`命令を使用するように義務付けます。[^19]

### **4. 「Async Void」メソッドに対するレッドカード**

戻り値を持たないメソッドを定義する際、`async void`キーワードは初学者にとって致命的な落とし穴です。[^18] コンパイラの仕組み上、`async void`メソッドは「撃ちっ放し（`fire and forget`）」モデルになります。呼び出されると元のメソッドのコンテキストから切り離されるため、誰も`await`で完了を待つことができず、内部から発生した例外を`catch`で受け止めることも不可能です。[^19] `async void`ブロック内で何らかの障害が起きると、環境設定に応じて静かに破綻するかシステム全体を停止させ、ソフトウェア構造のあらゆる保護層を完全に素通りしてしまいます。[^19]

`async void`の使用が許容される唯一の例外は、`async void Start()`、`OnEnable()`、あるいはUIボタンのクリックイベントなど、エンジン標準のイベントハンドラ（`Event Handlers`）のみです。[^8] それ以外の場所では、戻り値のないすべてのユーザー定義メソッドを例外なく`async Awaitable`または`async Task`の形式で統一するよう規約化する必要があります。[^15]

### **5. WebGLプラットフォームとの互換性**

Unityの`WebGL`技術を用いてWebブラウザ向けにプロジェクトをビルドする際、マルチスレッドに関しては多くの誤解がつきまといます。[^19] `WebAssembly (Wasm)`および`JavaScript`環境は本質的に厳格なシングルスレッドモデルで動作するため、C#の伝統的な`System.Threading.Thread`や`Task.Run`を使用するコードは`WebGL`上で頻繁にエラーを起こしたり、そもそもサポートされていなかったりします。[^19]

しかし、専門家は`Awaitable`および`Task`システムが`WebGL`上で完全に互換性があり、絶対的に安全であることを確認しています。[^19] 核心となる理由は、`IL2CPP`コンパイラが`async/await`キーワードをロジックが分割されたステートマシン（`State Machines`）関数へと変換する仕組みにあります。[^21] これらの処理はOSのハードウェアスレッド割り当て（`OS thread allocation`）を要求するのではなく、`PlayerLoop`ループ上でフレームを譲り合うことで擬似的な並行性（`pseudo-concurrency`）を再現しています。[^10] したがって、開発者が`Awaitable.BackgroundThreadAsync()`のように物理的なバックグラウンドスレッドを強制する命令を呼び出さない限り、`Awaitable.NextFrameAsync`、非同期の`Addressables`読み込み、`UnityWebRequest`通信に関わるアーキテクチャは`WebGL`展開時にも完璧かつ滑らかに動作します。[^19]

## **まとめと移行戦略（Migration Strategy）**

`Coroutines`から`Awaitable`への世代交代は、単なる構文コードのアップデートにとどまらず、Unityにおけるソフトウェア開発のアーキテクチャ思想と基準における大きな飛躍です。`Object Pooling`システムによる時間分散処理と、`PlayerLoop`反復システムへの障壁なき統合により、Unity `Awaitable`は調和の取れたツールを提供します。すなわち、エンタープライズ向けの`Task`システムのように表現力豊かで正確でありながら、`UniTask`に匹敵する軽さとシステムメモリへの優しさを兼ね備えているのです。

Unity 2023.1またはUnity 6以降をベースに新規立ち上げするプロジェクトにおいては、データストリーミング、ファイルI/O、ネットワーク通信のための基盤標準（`backbone architecture`）として`Awaitable`を採用することが明白なベストプラクティスとなっています。[^1] `Call Stack`の隅々まで行き渡る`CancellationToken`の存在、`OperationCanceledException`の丁寧な処理の徹底、そして`BackgroundThreadAsync`による演算負荷の明確な分離は、堅牢性と信頼性を最優先に据えたコードエコシステムを築き上げます。[^10]

一方で、すでに稼働中の巨大な既存プロジェクトをリファクタリング（`Refactoring`）する場合には、段階的な移行ロードマップ（`gradual migration`）が推奨されます。[^1] データ破損のリスクを根絶するため、まずはサーバーからのデータ受信処理（`network payload streams`）や静的アセットのロードパイプライン（`Addressables loading`）を切り離し、`Awaitable`の`try/catch/finally`機構で保護する形で優先的にアップグレードすべきです。[^1] 対照的に、数フレームで完結する単純なUIアニメーションやアルファ値のフェード処理などは、従来の`Coroutine`システムを使い続けても差し支えありません。[^1] 一貫したキャンセルアーキテクチャと`Pooling`メモリ違反の罠への十分な警戒が噛み合ったとき、`Awaitable`は計算負荷を解放する仕組みであるだけでなく、高い耐障害性と無限の拡張性を備えたソフトウェア構造を形作る礎となるでしょう。

## **参考文献**

[^1]: Async vs. Coroutines in Unity: Better Game Development! | by Azin | Medium, 2026年4月25日アクセス, [https://medium.com/@azinsf7/async-vs-coroutines-in-unity-better-game-development-bad059d8c004](https://medium.com/@azinsf7/async-vs-coroutines-in-unity-better-game-development-bad059d8c004)  
[^2]: Async in Unity: Main Thread First, Multithread When Needed - YouTube, 2026年4月25日アクセス, [https://www.youtube.com/watch?v=GSjBWnfBzb0](https://www.youtube.com/watch?v=GSjBWnfBzb0)  
[^3]: Should I use Async & Await, instead of Coroutines, in Unity?, 2026年4月25日アクセス, [https://gamedev.stackexchange.com/questions/185200/should-i-use-async-await-instead-of-coroutines-in-unity](https://gamedev.stackexchange.com/questions/185200/should-i-use-async-await-instead-of-coroutines-in-unity)  
[^4]: Async Programming in Unity - What You NEED To Know - YouTube, 2026年4月25日アクセス, [https://www.youtube.com/watch?v=fMZ8ErK3YEI](https://www.youtube.com/watch?v=fMZ8ErK3YEI)  
[^5]: Performance in Unity: async, await, and Tasks vs. coroutines, C# Job System, and burst compiler - LogRocket Blog, 2026年4月25日アクセス, [https://blog.logrocket.com/performance-unity-async-await-tasks-coroutines-c-job-system-burst-compiler/](https://blog.logrocket.com/performance-unity-async-await-tasks-coroutines-c-job-system-burst-compiler/)  
[^6]: Task vs UniTask vs Awaitable. Performance and API comparison. Is ..., 2026年4月25日アクセス, [https://medium.com/@DanielMcRon/task-vs-unitask-vs-awaitable-performance-and-api-comparison-is-awaitable-a-new-leader-0e4904dfb0d4](https://medium.com/@DanielMcRon/task-vs-unitask-vs-awaitable-performance-and-api-comparison-is-awaitable-a-new-leader-0e4904dfb0d4)  
[^7]: UniTask: How It Replaces Coroutines, Tasks and Awaitable - YouTube, 2026年4月25日アクセス, [https://www.youtube.com/watch?v=OlNJ2GkaPTE](https://www.youtube.com/watch?v=OlNJ2GkaPTE)  
[^8]: Introduction to asynchronous programming with Awaitable - Unity - Manual, 2026年4月25日アクセス, [https://docs.unity3d.com/6000.3/Documentation/Manual/async-awaitable-introduction.html](https://docs.unity3d.com/6000.3/Documentation/Manual/async-awaitable-introduction.html)  
[^9]: Benchmarking Async/Await, Coroutine, and UniTask in Unity: Which One Is Best? (1), 2026年4月25日アクセス, [https://prasetion.medium.com/benchmarking-async-await-coroutine-and-unitask-in-unity-which-one-is-best-1-59beec0fb53a](https://prasetion.medium.com/benchmarking-async-await-coroutine-and-unitask-in-unity-which-one-is-best-1-59beec0fb53a)  
[^10]: Cysharp/UniTask: Provides an efficient allocation free async/await integration for Unity. - GitHub, 2026年4月25日アクセス, [https://github.com/cysharp/UniTask](https://github.com/cysharp/UniTask)  
[^11]: Awaitable code example reference - Unity User Manual 2021.3 (LTS), 2026年4月25日アクセス, [https://docs.unity.cn/6000.0/Documentation/Manual/async-awaitable-examples.html](https://docs.unity.cn/6000.0/Documentation/Manual/async-awaitable-examples.html)  
[^12]: Am I shooting myself in the foot by using async/await/Task so much (Unity 2021.3.0f1)?, 2026年4月25日アクセス, [https://www.reddit.com/r/Unity3D/comments/141rmup/am\_i\_shooting\_myself\_in\_the\_foot\_by\_using/](https://www.reddit.com/r/Unity3D/comments/141rmup/am_i_shooting_myself_in_the_foot_by_using/)  
[^13]: Awaitable completion and continuation - Unity - Manual, 2026年4月25日アクセス, [https://docs.unity3d.com/6000.3/Documentation/Manual/async-awaitable-continuations.html](https://docs.unity3d.com/6000.3/Documentation/Manual/async-awaitable-continuations.html)  
[^14]: Understanding Threads, Async, and Delays in Unity | by Savva | Apr, 2026 | Medium, 2026年4月25日アクセス, [https://medium.com/@savva2003m6\_57528/understanding-threads-async-and-delays-in-unity-d13a4e7111e9](https://medium.com/@savva2003m6_57528/understanding-threads-async-and-delays-in-unity-d13a4e7111e9)  
[^15]: Awaitable code example reference - Unity - Manual, 2026年4月25日アクセス, [https://docs.unity3d.com/6000.3/Documentation/Manual/async-awaitable-examples.html](https://docs.unity3d.com/6000.3/Documentation/Manual/async-awaitable-examples.html)  
[^16]: Yield instruction reference - Unity - Manual, 2026年4月25日アクセス, [https://docs.unity3d.com/6000.3/Documentation/Manual/coroutines-yield-instructions.html](https://docs.unity3d.com/6000.3/Documentation/Manual/coroutines-yield-instructions.html)  
[^17]: Timely Coroutines: A simple trick to eliminate unwanted frame delays : r/Unity3D - Reddit, 2026年4月25日アクセス, [https://www.reddit.com/r/Unity3D/comments/1ivotdx/timely\_coroutines\_a\_simple\_trick\_to\_eliminate/](https://www.reddit.com/r/Unity3D/comments/1ivotdx/timely_coroutines_a_simple_trick_to_eliminate/)  
[^18]: Best practices: Async vs. coroutines - Unite Copenhagen 2019 | PPTX - Slideshare, 2026年4月25日アクセス, [https://www.slideshare.net/slideshow/best-practices-async-vs-coroutines-unite-copenhagen-2019/185010336](https://www.slideshare.net/slideshow/best-practices-async-vs-coroutines-unite-copenhagen-2019/185010336)  
[^19]: unity - Is this code using Awaitable correct? - Game Development Stack Exchange, 2026年4月25日アクセス, [https://gamedev.stackexchange.com/questions/212406/is-this-code-using-awaitable-correct](https://gamedev.stackexchange.com/questions/212406/is-this-code-using-awaitable-correct)  
[^20]: Async/Await & Unity Awaitable - Ali Emre Onur - Medium, 2026年4月25日アクセス, [https://aliemreonur.medium.com/async-await-unity-awaitable-63805595c67e](https://aliemreonur.medium.com/async-await-unity-awaitable-63805595c67e)  
[^21]: Do coroutines produce garbage? : r/Unity3D - Reddit, 2026年4月25日アクセス, [https://www.reddit.com/r/Unity3D/comments/10xqvof/do\_coroutines\_produce\_garbage/](https://www.reddit.com/r/Unity3D/comments/10xqvof/do_coroutines_produce_garbage/)  
[^22]: Unity 6 Async (new) vs Cysharp : r/Unity3D - Reddit, 2026年4月25日アクセス, [https://www.reddit.com/r/Unity3D/comments/1j0zlri/unity\_6\_async\_new\_vs\_cysharp/](https://www.reddit.com/r/Unity3D/comments/1j0zlri/unity_6_async_new_vs_cysharp/)  
[^23]: Guide for UniTask and Awaitable in Unity 6 #627 - GitHub, 2026年4月25日アクセス, [https://github.com/Cysharp/UniTask/discussions/627](https://github.com/Cysharp/UniTask/discussions/627)  
[^24]: Choose your poison : r/unity - Reddit, 2026年4月25日アクセス, [https://www.reddit.com/r/unity/comments/1elkqsb/choose\_your\_poison/](https://www.reddit.com/r/unity/comments/1elkqsb/choose_your_poison/)  
[^25]: Asynchronous operation handles | Addressables | 2.0.8 - Unity - Manual, 2026年4月25日アクセス, [https://docs.unity3d.com/Packages/com.unity.addressables@2.0/manual/AddressableAssetsAsyncOperationHandle.html](https://docs.unity3d.com/Packages/com.unity.addressables@2.0/manual/AddressableAssetsAsyncOperationHandle.html)  
[^26]: Addressables In Unity - Ali Emre Onur - Medium, 2026年4月25日アクセス, [https://aliemreonur.medium.com/addressables-in-unity-eec8b03198d7](https://aliemreonur.medium.com/addressables-in-unity-eec8b03198d7)  
[^27]: How to use Addressable w/ UniTask or async/await in Unity - YouTube, 2026年4月25日アクセス, [https://www.youtube.com/watch?v=0p0EGunlWTs](https://www.youtube.com/watch?v=0p0EGunlWTs)  
[^28]: Async operation handling | Addressables | 1.9.2 - Unity - Manual, 2026年4月25日アクセス, [https://docs.unity3d.com/Packages/com.unity.addressables@1.9/manual/AddressableAssetsAsyncOperationHandle.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.9/manual/AddressableAssetsAsyncOperationHandle.html)  
[^29]: Unity async / await: Coroutine's Hot Sister : r/gamedev - Reddit, 2026年4月25日アクセス, [https://www.reddit.com/r/gamedev/comments/sfjh0p/unity\_async\_await\_coroutines\_hot\_sister/](https://www.reddit.com/r/gamedev/comments/sfjh0p/unity_async_await_coroutines_hot_sister/)  
[^30]: Coroutines OR Async/await? : r/unity - Reddit, 2026年4月25日アクセス, [https://www.reddit.com/r/unity/comments/zr39d4/coroutines\_or\_asyncawait/](https://www.reddit.com/r/unity/comments/zr39d4/coroutines_or_asyncawait/)  
[^31]: How to Cancel Tasks in C# - Using CancellationTokenSource and CancellationToken, 2026年4月25日アクセス, [https://www.youtube.com/watch?v=TKc5A3exKBQ](https://www.youtube.com/watch?v=TKc5A3exKBQ)  
[^32]: A Deep Dive into C#'s CancellationToken | by Mitesh Shah | Medium, 2026年4月25日アクセス, [https://medium.com/@mitesh\_shah/a-deep-dive-into-c-s-cancellationtoken-44bc7664555f](https://medium.com/@mitesh_shah/a-deep-dive-into-c-s-cancellationtoken-44bc7664555f)  
[^33]: How to Handle 'Task was canceled' Exceptions in C# - OneUptime, 2026年4月25日アクセス, [https://oneuptime.com/blog/post/2025-12-23-handle-task-was-canceled-csharp/view](https://oneuptime.com/blog/post/2025-12-23-handle-task-was-canceled-csharp/view)  
[^34]: Mastering Coroutine Cancellation in Kotlin: Best Practices, Common Pitfalls, and Safe Handling of Repeating Tasks | by Shakarim Bazhenov | ProAndroidDev, 2026年4月25日アクセス, [https://proandroiddev.com/age-mastering-coroutine-cancellation-in-kotlin-best-practices-common-pitfalls-and-safe-handling-41f702503977](https://proandroiddev.com/age-mastering-coroutine-cancellation-in-kotlin-best-practices-common-pitfalls-and-safe-handling-41f702503977)  
[^35]: Scripting API: Awaitable.Cancel - Unity - Manual, 2026年4月25日アクセス, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Awaitable.Cancel.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Awaitable.Cancel.html)  
[^36]: The Silent Killer That's Crashing Your Coroutines | by Sam Cooper | Better Programming, 2026年4月25日アクセス, [https://medium.com/better-programming/the-silent-killer-thats-crashing-your-coroutines-9171d1e8f79b](https://medium.com/better-programming/the-silent-killer-thats-crashing-your-coroutines-9171d1e8f79b)  
[^37]: c# - Elegantly handle task cancellation - Stack Overflow, 2026年4月25日アクセス, [https://stackoverflow.com/questions/12633903/elegantly-handle-task-cancellation](https://stackoverflow.com/questions/12633903/elegantly-handle-task-cancellation)  
[^38]: Unity Coroutine yield return null EQUIVALENT with Task async await - Stack Overflow, 2026年4月25日アクセス, [https://stackoverflow.com/questions/47952972/unity-coroutine-yield-return-null-equivalent-with-task-async-await](https://stackoverflow.com/questions/47952972/unity-coroutine-yield-return-null-equivalent-with-task-async-await)  
[^39]: Unity async / await: Awaitable - YouTube, 2026年4月25日アクセス, [https://www.youtube.com/watch?v=X9Dtb\_4os1o](https://www.youtube.com/watch?v=X9Dtb_4os1o)
