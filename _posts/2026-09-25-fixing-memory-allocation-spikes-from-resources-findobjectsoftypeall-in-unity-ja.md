---
title: "Unityパフォーマンス最適化：Resources.FindObjectsOfTypeAllによるメモリ割り当て（GC Alloc）の原因と解消法"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: UnityでResources.FindObjectsOfTypeAllを過度に使用した際にフレームスパイク（カクつき）が発生する原因と、最も正確な4つの最適化手法を初心者向けに詳しく解説します。
lang: ja
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

Unityでゲームを制作していると、特定の`GameObject`や`Component`を検索する必要に迫られる場面が必ずあります。Unityには`Find`、`FindObjectOfType`、そして特に`Resources.FindObjectsOfTypeAll`といった数多くのメソッドが用意されています。

`Resources.FindObjectsOfTypeAll`は非アクティブ（inactive）なオブジェクト、フォルダ内のプレハブ（prefab）、まだ生成されていないアセットなど**あらゆるもの**を見つけられるため非常に強力ですが、正しく使わなければゲームのパフォーマンスを静かに蝕む「キラー」の一つでもあります。

本記事では、なぜこのメソッドが危険なのか、解析ツール（Profiler / Project Auditor）がどのように警告を出すのかを理解し、メモリ上のゴミ（Garbage Collection Allocation - GC Alloc）を完全に排除するための最適化手法を詳しく解説します。

---

## **1. なぜ`Resources.FindObjectsOfTypeAll`はパフォーマンスに悪影響を及ぼすのか？**

Unity Memory ProfilerやProject Auditorを実行すると、黄色い警告（Moderate）が表示されることがあります：
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

その理由を理解するには、このメソッドがエンジン内部（C++コア）でどのように動作しているかを確認する必要があります：

1. **メモリ全体の走査（高いCPU負荷）**: シーン上でアクティブなオブジェクトのみを検索する`FindObjectOfType`とは異なり、`Resources.FindObjectsOfTypeAll`はエンジンの**メモリ全体**を走査します。すべてのシーンオブジェクト、エディタオブジェクト（エディタ上で実行中の場合）、そしてRAMに読み込まれているすべてのアセット（Assets）を巡回します。プロジェクトが大きくなるほど、このメソッドの実行時間は遅くなります。
2. **メモリゴミの生成（GC Allocation）**: このメソッドの実行が完了するたび、戻り値を格納するためにC#のManaged Heap上に**毎回必ず**新しい配列（Array）を作成します。

**結果:** このメソッドを頻繁に呼び出すと（例：`Update()`内や、UIボタンを押すたびなど）、メモリにゴミ（使い捨てられた古い配列）を絶えず排出し続けることになります。ゴミが溜まると、Unityのガベージコレクタ（Garbage Collector - GC）が強制的に起動します。この回収処理の間、ゲームが一瞬停止し、プレイヤーにとって非常に不快な**カクつき（stuttering）**を引き起こします。

---

## **2. 4つの最適化手法（ベストプラクティス）**

この問題を根本的に解決するには、状況に応じて、Unityの最適化エンジニアによって体系化された以下の4つの的確な手法から1つを適用できます。

### **手法1：Inspectorを通じた直接参照（最も推奨）**
CPUとRAMのコストを0にする最も高速な方法は、**そもそも検索を行わないこと**です。コードでオブジェクトを探す代わりに、`public`または`[SerializeField]`フィールドを宣言し、UnityのInspector画面からそのオブジェクトをドラッグ＆ドロップで設定してください。

```csharp
// ❌ 避けるべき：負荷の高い検索処理
void Start() {
    // このメソッドはGC Allocを発生させます
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ 最適：直接参照
[SerializeField] private GameManager myManager; 
// (Unityエディタ上でこの枠にGameManagerをドラッグ＆ドロップ)
```

### **手法2：キャッシング（キャッシュ保持）とシングルトン**
どうしてもコードから検索する必要がある場合は、**1回だけ検索し**（例：`Awake()`や`Start()`内）、その後再利用できるように変数へ保存（キャッシュ）しておくべきです。

`UIManager`や`AudioManager`のような共通システムには、シングルトン（Singleton）パターンや静的プロパティ（Static Property）を使い、検索コストなしでどこからでもアクセスできるようにしましょう。

```csharp
// ❌ 避けるべき：テキストが必要になるたびに検索メソッドを連続呼び出し
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ より良い方法：static変数にキャッシュ保存（1回だけ検索）
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // 1回だけ検索
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // 即座に再利用、コスト0
}
```

### **手法3：Unity 6の最新APIへアップグレードする**
以前、Unity 2023の初期バージョンで`FindObjectsOfType`を置き換えた際には、`FindObjectsSortMode`列挙型が使用されていました：
```csharp
// ⚠️ 旧式 (Unity 2023.1 - 2023.2):
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```
しかし、**Unity 6以降、`FindObjectsSortMode`列挙型は正式に非推奨（Deprecated / Obsolete）となりました。** エンジンが32ビットの`InstanceID`から新しいオブジェクト識別機構へ移行し、パフォーマンスを最大化するためにソート処理を廃止したためです。

Unity 6の公式ドキュメントに従い、以下の標準化されたオーバーロードを使用してください：

```csharp
// ❌ 旧式 (Unity 2022以前 - 低速で配列のソートを強制する)
var managers = FindObjectsOfType<GameManager>();

// ✅ Unity 6標準：任意のオブジェクトを1つ取得（最速、Zero-Alloc）
// ヒープに配列を割り当てず、最初に見つかったオブジェクトを即座に返します
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Unity 6標準：複数オブジェクトのリストを取得（ObsoleteになったSortMode引数は不要）
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **ヒント：** インスタンスが1つしかない場合（ManagerやControllerなど）、`FindFirstObjectByType<T>()`よりも`FindAnyObjectByType<T>()`の方がはるかに高速です。ヒエラルキー上の順序を気にせず、最初に見つけたオブジェクトを即座に返すためです。

#### ⚠️ **よくある誤解：`Resources.FindObjectsOfTypeNonAlloc`は存在するのか？**
Unityの配列を再利用するメソッド（`Physics.RaycastNonAlloc`や`GetComponentsNonAlloc`など）に慣れていると、`Resources`にも同様の`NonAlloc`版があると思いがちです。
しかし、Unityの公式ドキュメントによれば、**`Resources.FindObjectsOfTypeNonAlloc`というメソッドは一切存在しません。** `Resources.FindObjectsOfTypeAll`は呼び出されるたびに**必ず**Managed Heap上に新しい配列を生成します。

シーン内の全オブジェクトのリストを追跡しつつ**完全な0 GC Allocを達成したい**場合は、**自己登録パターン（Static Registration Pattern）**を使用してください：

```csharp
// ✅ Zero GC Allocの解決策：有効化時にリストへ自己登録する
public class Enemy : MonoBehaviour 
{
    // メモリを再利用し、新規割り当てを行わない共有の静的リスト
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// ゲーム内のどこからでもアクセスしたいとき：
// Enemy.ActiveEnemiesを直接参照 — Findより数十倍高速で、完全な0 GC Alloc！
```

### **手法4：エディタ用ツールを`#if UNITY_EDITOR`で囲む（ラップする）**
Asset Storeからダウンロードしたプラグイン（アニメーションシステムやUIツールなど）に`Resources.FindObjectsOfTypeAll`が含まれていることがあります。多くの場合、これらのメソッドは開発環境（Editor）上の便利なボタンを動かすためだけに使われています。

こうしたメソッドが最終的なゲームビルド（Build Player）に紛れ込んで警告が出るのを防ぐには、プリプロセッサディレクティブ`#if UNITY_EDITOR`で囲みます。これにより、ゲームを書き出す際に内部のコードが完全に除去されます。

```csharp
#if UNITY_EDITOR 
// このコードはUnityエディタで作業しているときのみ実行されます
// .exeや.apkファイルにビルドする際には完全に削除されます
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. 実例：ゲームプロジェクトで根本的に対処する**

実務での適用方法を理解するため、サードパーティ製アセットパッケージが原因でUnity Project AuditorやProfilerからメモリゴミの警告が出た際に、最もよく遭遇する2つのケースを見てみましょう：

### **ケース1：言語を切り替えるたびにRAM全体をスキャンするUIローカライズシステム**
* **問題点**：UIのテキストを表示したりUIサウンドを再生したりするたびに、ユーティリティメソッドが`Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]`を呼び出しています。そのため、メニューを開く操作を行うたびにRAM全体がスキャンされ、ヒープ上にゴミ配列が生成されてしまいます。
* **対処法**：
  1. `FindAnyObjectByType<UIManager>()`を使い、初期化時（`Awake`）に1回だけ検索します。
  2. キャッシュを保持するための静的プロパティ`SharedUIManager`を用意し、検索処理を**ゴミ0バイト**かつ即座にアクセスできる$O(1)$の操作へと変えます。

```csharp
// ❌ 最適化前：呼び出すたびにメモリ全体を走査してゴミを生成する
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ 最適化後：静的キャッシュを活用（Zero GC Alloc）
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // ゲーム全体で使える高速アクセス用キャッシュ
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // Unity 6 APIを使い、配列を割り当てず1回だけ検索
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// テキストが必要なときはどこからでもキャッシュ経由で呼び出すだけ：
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **ケース2：サードパーティ製のエディタ用ユーティリティがゲームビルドに混入する**
* **問題点**：多くのツールパッケージ（アニメーションやレベルデザインシステムなど）には、エディタ上のResetボタンやSetupボタンを動作させるための`Resources.FindObjectsOfTypeAll`検索メソッドが組み込まれています。ゲームプレイ中から一切呼ばれていなくても、そのコードがランタイム側のソースコードに露出したままだと、Unityはゲームビルド（Player）に対してGC Allocの警告フラグを立ててしまいます。
* **対処法**：その検索コードブロック全体をプリプロセッサディレクティブ`#if UNITY_EDITOR`で囲みます。ゲームをパッケージ（`.exe`や`.apk`）としてビルドすると、Unityはこれらの行をランタイムから自動的に完全に切り離します。

```csharp
// ❌ 最適化前：エディタ用のアセット検索コードがランタイムに露出している
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ 最適化後：プリプロセッサディレクティブ #if UNITY_EDITOR で囲む
#if UNITY_EDITOR
// このコードブロックはUnityエディタ上にのみ存在し、ゲームビルド時には100%除去されます
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **まとめ**

Unityを始めたばかりの方にとって、「メモリゴミ」（GC Allocation）はC#が自動で掃除してくれるため少し抽象的な概念に感じられるかもしれません。しかしゲームプログラミングにおいては、ゴミを出し続けることが画面上の明らかなカクつきへと直結します。

黄金律：**`Update()`のようなループ内や頻繁に呼ばれるイベント内では、`Find`系のメソッド（特に`Resources.FindObjectsOfTypeAll`）を避けましょう。** Inspectorからの直接参照を最優先し、キャッシュ（Cache / Singleton）を活用し、Unity 6標準API（`FindAnyObjectByType`）へアップグレードして、エディタ専用の便利ツールは`#if UNITY_EDITOR`で囲んでください。こうした細部からの最適化が、あらゆる端末で安定した60 FPSを維持する助けになります！
