---
title: "Unity Engineにおけるパフォーマンス最適化と時刻データの整合性：システム機構、DateTime.Nowのボトルネック分析、およびFrame Cachingによる解決策"
date: 2026-09-17 03:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, datetime, csharp, dotnet, frame-caching, multithreading, anticheat]
description: ".NETランタイムにおけるDateTime.NowおよびDateTime.UtcNowの内部機構の深層分析、パフォーマンスボトルネックの定量化、時間的ティアリング（temporal tearing）現象、およびUnity Engine向けのスレッドセーフなFrame Cachingアーキテクチャの解説。"
lang: ja
translation_id: unity-datetime-now-frame-caching
math: true
---

リアルタイム時刻データの取得と処理は、Unity Engine上に構築されるリアルタイムアプリケーションにおいて最も基礎的でありながら、アーキテクチャ上多くのリスクを孕むタスクの一つです[^1]。.NET基本クラスライブラリ（BCL）の `System.DateTime` 構造体はカレンダーや時刻を扱うための充実した機能を提供していますが、継続的な更新ループ（ホットパス）内で `System.DateTime.Now` プロパティを直接呼び出すと、深刻なパフォーマンスボトルネックを引き起こし、状態の整合性を損なう原因となります[^2]。

本レポートでは、OSおよびランタイム（.NET/Mono/IL2CPP）層における内部機構を深く分析し、プロファイリングデータを通じて計算コストを定量化するとともに、時間的ティアリング（*temporal tearing*）現象を解明し、フレーム単位のキャッシング（*Frame Caching*）ソリューションと関連するアーキテクチャ標準を包括的に評価します[^2]。

---

## **1. .NETランタイムにおける DateTime.Now と DateTime.UtcNow の内部機構**

`System.DateTime` 構造体は、単一の64ビット値フィールド（`UInt64 _dateData`）として格納されています[^6]。この構造内では、以下のようにビットが割り当てられています：
- **下位62ビット**は、グレゴリオ暦の西暦0001年1月1日 00:00:00からの累積ティック（Ticks）数を表しており、1ティックは $100\text{ ns}$（$10^{-7}\text{ s}$ または $0.1\ \mu\text{s}$）に相当します[^1]。
- **上位2ビット**は `DateTimeKind` フラグの格納用に予約されており、`Utc`、`Local`、`Unspecified` の3つのコンテキスト状態のいずれかを識別できます[^1]。

### **DateTime.UtcNow の低レベル実行フロー**

`DateTime.UtcNow` プロパティは協定世界時（UTC）を表し、CPUサイクルの観点から最大限に最適化されるよう設計されています[^2]。プロセスが `DateTime.UtcNow` を呼び出すと、.NETランタイムはシステムのハードウェアタイマーから直接値を読み取ります[^2]：

- **Windows** OS上では、コンパイル最適化の障壁をバイパスする属性が付与された内部関数ポインタ（`TargetedPatchingOptOut`）を介して、Win32 API関数 `GetSystemTimeAsFileTime` を直接呼び出します[^2]。
- **POSIX** 系OS（Android上のLinuxカーネルやiOS/macOS上のDarwinカーネルを含む）では、低レベルシステムコール `clock_gettime(CLOCK_REALTIME, ...)` を実行します[^5]。

OSから返された生の時刻値には、グレゴリオ暦の基準時点と同期させるための固定オフセット定数を加算するだけでよく、その後 `DateTimeKind.Utc` ラベルとともに `DateTime` 構造体へ直接パックされます[^2]。この処理ではルックアップテーブルの解決やメモリ割り当てを一切必要とせず、数ナノ秒で完了します[^2]。

### **DateTime.Now の複雑な解決フロー**

`DateTime.UtcNow` とは対照的に、ローカル時刻（`DateTime.Now`）の取得には一連の複雑な変換処理が必要となります[^2]。`DateTime.Now` プロパティはハードウェアから独立したローカル時計を読み取るわけではなく、`DateTime.UtcNow` の結果と一連のタイムゾーンオフセット計算を組み合わせることで完全に構築されています[^2]：

```csharp
public static DateTime Now 
{
    get 
    {
        DateTime utcNow = UtcNow;
        bool isAmbiguousDst = false;
        long offset = TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc(utcNow, out isAmbiguousDst).Ticks;
        long ticks = utcNow.Ticks + offset;
        
        if (ticks > DateTime.MaxValue.Ticks)
            return new DateTime(DateTime.MaxValue.Ticks, DateTimeKind.Local);
        if (ticks < DateTime.MinValue.Ticks)
            return new DateTime(DateTime.MinValue.Ticks, DateTimeKind.Local);
            
        return new DateTime(ticks, DateTimeKind.Local);
    }
}
```

この処理は現在のUTC時刻を取得することから始まり、次にデバイスのタイムゾーン設定を特定するために `TimeZoneInfo.Local` オブジェクトを参照します[^2]。リソース消費の最大の原因は `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc` 関数にあり、ここでランタイムは現在時刻をタイムゾーン調整規則（*Adjustment Rules*）テーブルおよびサマータイム（*Daylight Saving Time - DST*）規約と照合し、現在が1時間加算される期間に該当するかどうかを判定しなければなりません[^2]。

ティック単位での正確なオフセットが特定されると、システムは `utcNow.Ticks` との算術加算を行い、境界値のオーバーフロー条件を検証した上で、`DateTimeKind.Local` ラベルを付与して新しい `DateTime` 構造体を生成します[^2]。

公式 .NET Runtime リポジトリのパフォーマンスプロファイリングデータは、`DateTime.get_Now()` メソッドにおける詳細な実行時間配分を示しています[^4]：

| `System.DateTime.get_Now()` 内の実行コンポーネント | 累積実行時間割合（Inclusive %） | 処理の技術的本質 |
| :--- | :---: | :--- |
| `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc` | **88.1%** | タイムゾーン変換規則の参照、DSTフラグの確認、オフセット計算[^4] |
| `System.DateTime.get_UtcNow()` | **5.8%** | ハードウェアカウンターを読み取るシステムコール（Syscall）[^2] |
| 境界チェックおよび構造体パッキング演算 | **6.1%** | 64ビット整数オーバーフロー検証および `DateTimeKind.Local` タグ付与[^4][^7] |

> [!IMPORTANT]
> 上記のデータは、ハードウェアクロックから実際の時刻を読み取る処理自体は全実行コストの **~5.8%** に過ぎないのに対し、処理時間の実に **~88.1%** もの割合がタイムゾーンの解決およびサマータイム規約の計算に費やされていることを証明しています[^4]。

### **モバイル環境（Mono & IL2CPP）における複雑性の増大**

MonoまたはIL2CPPを介してUnityを実行するモバイルプラットフォームでは、`DateTime.Now` の複雑さがさらに何倍にも増幅されます[^5]。Windowsがタイムゾーン情報を一元的なレジストリ（Registry）で管理しているのに対し、AndroidなどのモバイルOSは `/apex/com.android.tzdata/` や `/system/usr/share/zoneinfo` といったシステムディレクトリに分散配置されたバイナリデータベース `tzdata`（`ZoneInfoDB`）にこのデータを保存しています[^5]。

`TimeZoneInfo.Local` が初回初期化される際や再検証が必要になった際、Mono/IL2CPPランタイムはファイルI/O操作やバイナリデータの構文解析を実行し、さらにはタイムゾーン識別子を取得するために Java Native Interface（JNI）経由で `java.util.TimeZone` クラスへのクロスランタイム呼び出しまで行わなければなりません[^5]。

> [!WARNING]
> タイムゾーンデータベースファイルの形式が破損している場合や、カスタムROMで配置場所が変更されている場合、あるいはファイルアクセス権限が制限されている場合、`DateTime.Now` の呼び出しは致命的な `System.TimeZoneNotFoundException` 例外を送出する可能性があり、例外処理ブロックで保護されていなければアプリケーションの突然のクラッシュにつながります[^10]。

---

## **2. パフォーマンスベンチマークとフレームバジェットへの影響分析**

時刻取得メソッドの実行コストは、基盤となるアーキテクチャやOSのキャッシュ状態によって大きく異なります[^5]。以下の表は、Unityおよび.NET環境で一般的な時刻取得メカニズム間の正規化されたパフォーマンスベンチマーク結果をまとめたものです[^4]：

| 時刻取得メソッド | 推定実行時間 | 相対速度比 | コア実行メカニズム | フレームスパイク（Frame Spike）発生リスク |
| :--- | :---: | :---: | :--- | :--- |
| `UnityEngine.Time.time` | $\sim 1\text{ - }2\text{ ns}$ | 最速（エンジンネイティブ） | フレーム開始時にキャッシュされた浮動小数点数変数を直接読み取り | 完全にゼロ |
| `System.DateTime.UtcNow` | $\sim 15\text{ - }20\text{ ns}$ | `Now` より $\sim 15\text{ - }20\times$ 倍高速 | 最小限のシステムコールでハードウェアクロックを直接読み取り[^2] | 無視できるレベル |
| `System.DateTime.Now`（Warm Path） | $\sim 280\text{ - }350\text{ ns}$ | 比較基準（$1\times$） | UtcNow呼び出し、タイムゾーンキャッシュ参照、DSTオフセット計算[^2] | 反復呼び出し時は中〜高 |
| `System.DateTime.Now`（Cold Path / モバイル） | $\sim 1\text{ - }5\text{ ms}$ | 数千倍低速（$\gt 3.000\times$） | AndroidTzDataテーブル初期化、ディスクI/O、バイナリデータ解析[^5] | 非常に高い（フレームフリーズ） |

### **ゲームループにおけるフレームバジェットの制限**

リアルタイムインタラクティブアプリケーションでは、移動メカニクスのシミュレーション、物理演算、ゲームロジック処理、GPUへの描画コマンド送信を含むすべてのワークロードを、以下の式で定義される有限の時間内に完了させなければなりません：

$$
T_{\text{frame}} = \frac{1000\text{ ms}}{\text{Target FPS}}
$$

- 標準的なリフレッシュレート **$60\text{ Hz}$**（$60\text{ FPS}$）では、1フレームあたりのバジェットは **$16.67\text{ ms}$** です。
- この数値は、**$120\text{ Hz}$**（$120\text{ FPS}$）の高リフレッシュレートディスプレイではわずか **$8.33\text{ ms}$** に短縮されます。

数十体のNPCのスキルクールダウン計測システム、バフ状態チェックシステム、実時刻に基づくイベント判定ロジックなど、エンティティの更新ループ内に多数の `DateTime.Now` 呼び出しが散在するコードアーキテクチャは、毎フレーム数百〜数千回ものシステムコールを蓄積させます。

フレームあたり **500回のウォームな `DateTime.Now` 呼び出し** がある場合、システムはタイムゾーンのオフセット計算だけで約 **$\sim 0.15\text{ ms}$**（$150\,\mu\text{s}$）を消費し、**$120\text{ Hz}$** のフレーム時間バジェット全体の最大 **$\sim 1.8\%$** を食いつぶします。この消費はフレームレートの低下や局所的なカクつき（stuttering）を直接引き起こし、静的解析ツールである Unity Project Auditor が連続更新パスにおける `DateTime.Now` の使用に対して高重要度の赤色警告（*Major Issue*）を出力する理由となっています[^3]。

---

## **3. 時間的ティアリング（Temporal Tearing）現象とデータ整合性エラー**

CPUパフォーマンスの低下に加え、タイムスタンプの個別の構成要素を抽出するために `DateTime.Now` 呼び出しを分散させると、データのアトミック性（*Data Atomicity*）に関する深刻な欠陥が生じます。従来のコードは、以下のように独立した比較を連続して行う際にこの落とし穴に陥ります：

```csharp
if (requirement.CheckYear)   results.Add(DateTime.Now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(DateTime.Now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(DateTime.Now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(DateTime.Now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(DateTime.Now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(DateTime.Now.Second == requirement.Second);
```

### **異常なハイブリッド状態が発生するメカニズム**

`DateTime.Now` プロパティの本質は静的データフィールドではなく、呼び出し時点の客観的時刻に依存した状態を生成するメソッド呼び出しです[^20]。コードが `.Year`、`.Month`、`.Day` などのサブプロパティにアクセスするたびに、システムはOSへの問い合わせサイクルを完全に最初からやり直します[^2]。

連続する命令行の間の時間差はわずか数マイクロ秒に過ぎませんが、OSの時分割マルチタスクスケジューリング機構によって実行がプリエンプト（中断）されたり、実行タイミングが偶然システムクロックの自然な桁上がり境界を跨いだりすることがあります[^8]。

> [!CAUTION]
> **境界跨ぎエラーのシナリオ（Boundary Edge-Case）：**  
> スレッドが2024年8月31日 `23:59:59.999` の瞬間に月（Month）をチェックする行を実行したと仮定します。`DateTime.Now.Month` はこの時刻に基づいて計算され、**8月** という値を返します。  
>  
> この命令が完了した直後、かつ次の日（Day）をチェックする命令が実行される直前に、システムクロックが2024年9月1日 `00:00:00.000` へと切り替わります。`DateTime.Now.Day` の行が実行されると、OSは新しいタイムスタンプを供給し、このプロパティは **1日** を返します。  
>  
> その結果、ゲームロジックは物理的な時間経過の中で絶対に存在し得ないハイブリッド状態、すなわち **8月1日** という誤った時刻を取得してしまうのです！

この時刻データが期間限定イベントの発動条件、定期ログインボーナスの判定、またはゲーム内取引ログの記録に使用されている場合、このズレは条件チェックロジックを破綻させ、意図しない機能ロックを引き起こしたり、プレイヤーが報酬を重複受領できてしまう不具合につながります。

---

## **4. Frame Caching ソリューションの技術的評価**

冗長な計算コストを完全に排除し、時間的ティアリング現象を根絶するために採用される最適な解決策は、Unity Engineのフレームカウンター（`UnityEngine.Time.frameCount`）をデータの有効性判定キーとして利用するフレーム単位キャッシング（*Frame Caching / Per-frame Memoization*）パターンの適用です[^22]。

### **フレームキャッシュの実行フロー分析**

キャッシング機構を実装したソースコードは以下のように構成されます：

```csharp
private static DateTime _cachedSystemTime;  
private static int _lastSystemTimeFrame = -1;

private static DateTime GetCurrentSystemTime()  
{  
    if (Application.isPlaying)  
    {  
        int currentFrame = Time.frameCount;  
        if (_lastSystemTimeFrame != currentFrame)  
        {  
            _lastSystemTimeFrame = currentFrame;  
            _cachedSystemTime = DateTime.Now;  
        }  
        return _cachedSystemTime;  
    }  
    return DateTime.Now;  
}
```

時刻チェックロジックで問い合わせが必要になった際、タイムスタンプをローカル変数へ1回だけ取得し、以降のすべてのチェックでそれを使い回します：

```csharp
DateTime now = GetCurrentSystemTime();  
if (requirement.CheckYear)   results.Add(now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(now.Second == requirement.Second);
```

このメカニズムは2つの決定的な改善をもたらします：

1. **計算量の削減：** エンティティ数に依存する線形計算量 $\mathcal{O}(N)$ から、描画フレームあたり定数時間 $\mathcal{O}(1)$ へと削減されます。同一フレーム内で初回呼び出し以降に発生するすべての問い合わせは、静的メモリに保存された64ビット `DateTime` 構造体の値を直接読み取るだけとなり、OS呼び出しとタイムゾーン計算のコストを完全に排除します[^2]。
2. **タイムスナップショットのアトミック性維持（*Snapshot Atomicity*）：** 変数 `now` はフレーム全体に対する不変のタイムスライスとして機能し、年から秒までのすべての構成プロパティが一貫性を保ち、システム割り込みによって分断されないことを保証します。

### **実運用における境界制限とリスク分析**

フレーム単位キャッシングはUnityのメインスレッド上の問題を完全に解決しますが、大規模なソフトウェアアーキテクチャへ適用する際には、3つの重要な技術的制限を慎重に検討する必要があります：

1. **メインスレッド親和性の制約（Main Thread Affinity）：** `UnityEngine.Time.frameCount` プロパティはエンジン内部のC++層のAPIであり、メインスレッドに強く紐付いています[^24]。バックグラウンドのタスクスレッド（`Task.Run`）、非同期ネットワーク処理、あるいは C# Job System のタスクなどのバックグラウンドプロセスが `GetCurrentSystemTime()` メソッドを呼び出すと、Unityは即座に `UnityException: get_frameCount can only be called from the main thread` 例外を送出し、実行フローを中断させます[^24]。
2. **Update と FixedUpdate の周期のズレ：** Unityの実行ライフサイクルには、グラフィックス描画ループ（`Update`）と固定タイムステップ物理シミュレーションループ（`FixedUpdate`）という2つの独立した更新周期が存在します[^25]。`Time.frameCount` の値は、エンジンが新しい描画フレームに進むときにのみ1ずつインクリメントされます[^22]。クライアント側でフレームレート低下が発生した場合、エンジンは物理シミュレーションの進行に追いつくために、単一の描画フレーム内で複数回の `FixedUpdate` 周期を連続して実行せざるを得なくなることがあります[^23]。このとき、同じ描画周期内で実行されるすべての `FixedUpdate` は同一のキャッシュ時刻値 `_cachedSystemTime` を読み取ることになり、連続する物理シミュレーションステップ間の時間推移を正確に反映できなくなる恐れがあります[^26]。
3. **データ競合リスク（Data Race）：** メモリバリア（*Memory Barriers*）やアクセス排他ロックなしにグローバル静的変数 `_cachedSystemTime` および `_lastSystemTimeFrame` へアクセスすると、アウトオブオーダー実行（*out-of-order execution*）機構を備えたマルチコアCPUアーキテクチャ上でサブスレッドが同時に読み書きした際にデータ競合（コンフリクト）を引き起こす危険性があります。

### **スレッドセーフ（Thread-Safe）なシステム時刻プロバイダーの実装**

前述のすべての技術的制約を克服するため、時刻システムは実行スレッドのコンテキストを判別し、安全なアクセスを保証し、境界例外を自動的に処理できる専用サービスとして標準化する必要があります：

```csharp
using System;  
using System.Threading;  
using UnityEngine;

public static class SystemTimeProvider  
{  
    private static DateTime _mainThreadCachedTime;  
    private static int _lastFrameCount = -1;  
    private static int _mainThreadId;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]  
    private static void Initialize()  
    {  
        _mainThreadId = Thread.CurrentThread.ManagedThreadId;  
        _lastFrameCount = -1;  
    }

    public static DateTime CurrentLocalTime  
    {  
        get  
        {  
            if (Application.isPlaying && Thread.CurrentThread.ManagedThreadId == _mainThreadId)  
            {  
                int currentFrame = Time.frameCount;  
                if (_lastFrameCount != currentFrame)  
                {  
                    _lastFrameCount = currentFrame;  
                    _mainThreadCachedTime = DateTime.Now;  
                }  
                return _mainThreadCachedTime;  
            }

            return DateTime.Now;  
        }  
    }

    public static DateTime CurrentUtcTime => DateTime.UtcNow;  
}
```

このアーキテクチャにより、メインスレッドは重複計算コストを懸念することなく常にフレーム単位キャッシングの恩恵を受けられる一方、バックグラウンドスレッドやEditor上の編集モードでも直接フォールバック機構によって安定した動作が維持され、エンジンのスレッドアクセス権限違反例外が発生するリスクを完全に防ぎます[^24]。

---

## **5. ゲームエンジンアーキテクチャにおける時間ドメイン分離標準**

ゲーム開発においてよくある誤りは、異なる時間利用の目的を同じシステムAPIに混在させてしまうことです[^2]。最大のパフォーマンスとゲーム状態の一貫性を維持するため、システムアーキテクチャでは独立した時間ドメイン間の境界を明確に区分する必要があります：

| 時間ドメイン（Time Domain） | 推奨される標準API | 主なユースケース | 誤ったAPIを使用した場合のリスク |
| :--- | :--- | :--- | :--- |
| **内部ゲームプレイシミュレーション** | `UnityEngine.Time.time`、`Time.deltaTime` | 物理座標の計算、キャラクターの移動、スキルのクールタイム | ゲームの一時停止時に停止する（`timeScale = 0`）；実時刻が必要な場合は精度を失う[^26] |
| **リアルタイムUI表示** | `UnityEngine.Time.unscaledTime`、`Time.realtimeSinceStartup` | UIメニューのアニメーション、ゲーム一時停止中の画面遷移エフェクト | クライアントプロセスのセッションに紐付いており、現実世界のカレンダーへマッピング不可 |
| **アルゴリズム性能計測** | `System.Diagnostics.Stopwatch` | アルゴリズムの実行時間計測、コードブロックのプロファイリング、性能劣化の検知[^7] | `DateTime.Now` の分解能は $\sim 15.6\text{ ms}$ しかなく、ベンチマーク用の感度が不足[^7] |
| **アンチチート（不正防止）検証** | サーバーと同期された Unix Epoch（UTC）[^28] | スタミナ・エネルギーシステム、宝箱の開封時間、オンラインイベントの期間制限[^28] | クライアントの時計を信頼すると、プレイヤーがOS時刻を操作してアイテムを不正取得可能[^28] |
| **ローカルカレンダー表示** | `SystemTimeProvider.CurrentLocalTime` | UIステータスバーへのユーザーの現地実時刻の表示[^2] | キャッシュなしで生の `DateTime.Now` を呼び出し続けるとフレーム落ち・ラグが発生[^2] |

### **サーバー時刻同期とアンチチート（Anti-Cheat）機構**

オンライン機能を備えるゲームにおいて、クライアント側でローカルの `DateTime.Now` や `DateTime.UtcNow` に基づいてアクション実行時刻を自己検証させることは、深刻なセキュリティ脆弱性を生みます[^28]。ユーザーはOSの時刻設定を容易に変更し、建築物のカウントダウンを早送りしたり、デイリー回数をリセットしたりすることができます[^28]。

この種のチート行為を無効化するための標準化されたアーキテクチャでは、クライアントが単調増加クロック（*monotonic clock*）に基づいた仮想的な時刻基準を確立する必要があります[^5]：

1. **同期リクエストの送信：** クライアントがネットワーク接続を確立した際、サービスサーバーへ時刻同期リクエストを送信し、UTC基準の標準 Unix Epoch タイムスタンプを受信します[^28]。
2. **往復遅延時間（Round-Trip）の計測：** クライアントはパケットの往復時間（$RTT$）を記録し、以下の数式によってレスポンス到着時点のサーバー標準時刻を推定します：
   $$T_{\text{server}} = T_{\text{server\_reply}} + \frac{RTT}{2}$$
3. **単調オフセットの算出：** クライアントはハードウェアの単調増加カウンターに対する固定の差分値を計算し保持します：
   $$\Delta t = T_{\text{server}} - \text{Time.realtimeSinceStartupAsDouble}$$
4. **耐チート時刻の取得：** アプリケーションのライフサイクル全体を通じて、実時刻のチェックを必要とするすべてのゲームプレイロジックは以下の値を取得するだけで済みます：
   $$\text{CurrentRealTime} = \text{Time.realtimeSinceStartupAsDouble} + \Delta t$$
   エンジンの起動経過時間タイマーはハードウェアの単調増加カウント機構（`clock_gettime(CLOCK_MONOTONIC)` または `QueryPerformanceCounter`）を使用しているため、この値は厳密に線形増加し続け、OSのカレンダー時計改ざん操作に対する完全な耐性を持ちます[^5]。

### **TimeProvider（.NET 8+）を用いたモダンアーキテクチャへの移行**

.NET 8以降、Microsoftは `DateTime.Now` や `DateTime.UtcNow` のような直接的な静的呼び出しを完全に置き換えるため、抽象クラス `System.TimeProvider` を導入して時刻管理モデル全体を公式に再構築しました[^20]。モダンなUnityプロジェクトにおいても、開発者は互換パッケージ `Microsoft.Bcl.TimeProvider` を通じてこのアーキテクチャを採用し、ソースコードのモジュール性を高めることができます[^32]:

```csharp
public sealed class GameTimeService  
{  
    private readonly TimeProvider _timeProvider;

    public GameTimeService(TimeProvider timeProvider = null)  
    {  
        _timeProvider = timeProvider ?? TimeProvider.System;  
    }

    public DateTimeOffset GetCurrentTime() => _timeProvider.GetLocalNow();  
}
```

この抽象化モデルへ移行することで、技術面において2つの大きなメリットが得られます：

> [!TIP]
> 1. **独立した単体テスト（Unit Testing）：** 単体テストモデルを徹底して適用できるようになります[^20]。エンジニアはビジネスロジックにモックオブジェクト `FakeTimeProvider` を注入することで、実時間の経過を待ったりシステム時計に介入したりすることなく、複雑な時刻境界の切り替えケース（DSTタイムゾーンの切り替わりや年越しの瞬間など）を飛び越えて正確にシミュレートできます[^20]。  
> 2. **安全な DateTimeOffset データ型：** `GetLocalNow()` メソッドは `DateTime` の代わりに `DateTimeOffset` 構造体を返します[^20]。`DateTimeOffset` 構造体は明示的なタイムゾーンオフセット（*offset*）とともにタイムスタンプを固定的に保持するため、`DateTimeKind.Unspecified` フラグの曖昧な状態を完全に排除し、ネットワーク経由でシリアライズ送信する際のデータ整合性を保証します[^1]。

---

## **5. 実践導入事例：RequirementsManager システムの最適化（Case Study）**

RPG Builder フレームワークを採用した実プロジェクト（プロジェクトGLW）において、`RequirementsManager.cs` クラス内部で深刻なパフォーマンス問題が発見されました。具体的には、ゲームの時刻条件判定システム（例：特定の月・日・時にイベントを発生させる条件）が、以下のように `DateTime.Now` を複数回バラバラに連続呼び出ししていました：

```csharp
if(requirement.CheckYear) results.Add(DateTime.Now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(DateTime.Now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(DateTime.Now.Day == requirement.Day);
// ... Hour、Minute、Secondに対しても繰り返し
```

**旧ソースコードから発生していた問題：**
1. **莫大なCPUオーバーヘッド：** 1つのrequirementを判定するだけで、システムは最大7〜10回の `DateTime.Now` 呼び出し（`GetWeekNumber()` などの補助関数内を含む）を発火させる可能性がありました。100体のエンティティが同時にチェックを行うと毎フレーム数千回ものOS Syscallが発生し、深刻なボトルネックを引き起こしていました。
2. **Temporal Tearing（時刻のズレ）：** 秒（または分、日）が切り替わる瞬間が上記の読み取り処理の途中（例：999ミリ秒目）に差し掛かると、`Month` 変数は旧月から取得される一方で `Day` 変数は新日から取得されることがあり得ます。その結果、ゲームが現実には一切存在しない時刻を合成してしまいました。

**実運用で導入した解決策（Per-Frame Caching）：**
`Time.frameCount` をキャッシュ失効フラグ（cache invalidation）として利用する Frame Caching アーキテクチャを直接組み込みました。このアプローチは Update ループの代わりに静的（static）ライフサイクルを活用します：

```csharp
private static DateTime _cachedSystemTime;
private static int _lastSystemTimeFrame = -1;

private static DateTime GetCurrentSystemTime()
{
    if (Application.isPlaying) 
    {
        int currentFrame = Time.frameCount;
        
        // フレームごとに1回だけOSから実時刻を取得する
        if (_lastSystemTimeFrame != currentFrame)
        {
            _lastSystemTimeFrame = currentFrame;
            _cachedSystemTime = DateTime.Now; 
        }
        
        return _cachedSystemTime;
    }
    return DateTime.Now; // Editorモード
}
```

ロジック処理を行う箇所では、すべての判定処理が単一の時刻 **スナップショット（snapshot）** を参照するように統一しました：

```csharp
DateTime now = GetCurrentSystemTime();
if(requirement.CheckYear) results.Add(now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(now.Day == requirement.Day);
```

**最適化後の成果（パッチ `MOD-RPGB-008`）：** 
- **冗長なSyscallの完全排除：** 数千回もの呼び出しに代わり、`DateTime.Now` は計算量 $\mathcal{O}(1)$—毎フレームの全計算に対して厳密に1回のみに抑制されました。
- **絶対的なアトミック性（Atomic consistency）：** `Year`、`Month`、`Day` の各フィールドが確実に同一の瞬間に属することが保証されます。
- **Unity Project Auditor のクリーン化：** `System.DateTime` に関連するシステムパフォーマンスの「Major」警告を完全に解消しました。



## **6. 結論**

Unity Engineの高頻度更新ループ内における `System.DateTime.Now` の直接使用は、ハードウェアパフォーマンスと論理データの整合性の双方において深刻な技術的課題を構成します[^3]。

- タイムゾーン解決やサマータイム（DST）規約チェックのためのシステムコールが持つ複雑な性質により、このプロパティの実行時間の **88%** 以上が消費され、ゲームエンジンのフレームバジェットに直接的な負荷を与えます[^4]。
- 同時に、分離された `DateTime.Now` 呼び出しから複数のサブプロパティを取得する手法は時間的ティアリング（*temporal tearing*）の脆弱性を生み出し、ハイブリッドなタイムスタンプの発生とゲームロジックの破綻を引き起こします[^21]。

`Time.frameCount` プロパティと組み合わせたフレーム単位キャッシング（**Frame Caching**）ソリューションは、CPU消費をフレームあたり最小の定数レベル **$\mathcal{O}(1)$** に抑えつつ、時刻スナップショットの不変なアトミック性を保証することで、これら2つの問題を根底から解決します[^22]。

商用プロジェクト規模で展開する際には、このアーキテクチャに実行スレッド保護層（`SystemTimeProvider`）を追加し、不正防止のためのサーバー権威時刻（*Server-Authoritative Time*）検証機構と緊密に連携させ、ソフトウェア産業のモダンな技術標準を包括的に満たすべく `TimeProvider` 抽象クラスによる標準化を目指すべきです[^20]。

---

## **参考文献**

[^1]: [DateTime Struct (System) | Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.datetime?view=net-10.0)  
[^2]: [The Darkness Behind DateTime.Now - DZone](https://dzone.com/articles/darkness-behind-datetimenow)  
[^3]: [Changelog | Project Auditor | 1.0.2 - Unity - Manual](https://docs.unity3d.com/Packages/com.unity.project-auditor@1.0/changelog/CHANGELOG.html)  
[^4]: [Make DateTime.Now as efficient as DateTime.UtcNow · Issue #24277](https://github.com/dotnet/runtime/issues/24277)  
[^5]: [DateTimeOffset.Now TimeZone data impacts Android startup #71004](https://github.com/dotnet/runtime/issues/71004)  
[^6]: [mono/mcs/class/referencesource/mscorlib/system/datetime.cs at main](https://github.com/mono/mono/blob/master/mcs/class/referencesource/mscorlib/system/datetime.cs)  
[^7]: [[C#] DateTime 구조체 파헤치기 - Second Step - 티스토리](https://sikpang.tistory.com/41)  
[^8]: [c# - Optimizing alternatives to DateTime.Now - Stack Overflow](https://stackoverflow.com/questions/1561791/optimizing-alternatives-to-datetime-now)  
[^9]: [DateTime.Now return 1hour off when compared to device time in - Mono #20510](https://github.com/mono/mono/issues/20510)  
[^10]: [TimeZoneNotFoundException in DateTime.Now #8090 - GitHub](https://github.com/xamarin/xamarin-android/issues/8090)  
[^11]: [TimeZoneInfo.Unix.cs - GitHub](https://github.com/dotnet/corert/blob/master/src/System.Private.CoreLib/shared/System/TimeZoneInfo.Unix.cs)  
[^12]: [Abstracting System Time in ASP.NET Applications - Redgate](https://www.red-gate.com/simple-talk/development/dotnet-development/abstracting-system-time-asp-net-applications/)  
[^13]: [TimeZoneNotFoundException on calling DateTimeOffset.Now #5080](https://github.com/dotnet/android/issues/5080)  
[^14]: [mono/mcs/class/corlib/System/TimeZoneInfo.Android.cs at main](https://github.com/mono/mono/blob/master/mcs/class/corlib/System/TimeZoneInfo.Android.cs)  
[^15]: [[Bug] Occasional crash in TouchEffect because of wrong time zone #1999](https://github.com/xamarin/XamarinCommunityToolkit/issues/1999)  
[^16]: [Stopwatch is more efficient than DateTime.Now - Doug Linder](https://vathsalas.wordpress.com/2015/02/12/stopwatch-is-more-efficient-than-datetime-now/)  
[^17]: [C# SDK Release Notes - Realtime 5 - Photon Fusion 2](https://doc.photonengine.com/realtime/v5/getting-started/release-notes)  
[^18]: [Changelog | Project Auditor | 0.10.0 - Unity - Manual](https://docs.unity3d.com/Packages/com.unity.project-auditor@0.10/changelog/CHANGELOG.html)  
[^19]: [[Unity] Project Auditor로 프로젝트 최적화하기 - 조다록 - 티스토리](https://zodang.tistory.com/82)  
[^20]: [TimeProvider and ITimer: Writing Unit Tests with Time in .NET 8](https://www.infoq.com/articles/dotnet-unit-tests-time-timezone/)  
[^21]: [How frequent is DateTime.Now updated ? or is there a more precise - Stack Overflow](https://stackoverflow.com/questions/307582/how-frequent-is-datetime-now-updated-or-is-there-a-more-precise-api-to-get-the)  
[^22]: [Is Update() called on the very first frame in Unity? - GameDev Stack Exchange](https://gamedev.stackexchange.com/questions/163058/is-update-called-on-the-very-first-frame-in-unity)  
[^23]: [Is there an equivalent of Time.frameCount for physics updates? - Unity Discussions](https://discussions.unity.com/t/is-there-an-equivalent-of-time-framecount-for-physics-updates/160506)  
[^24]: [UniTask.Delay restricted to main thread? · Issue #96 - GitHub](https://github.com/Cysharp/UniTask/issues/96)  
[^25]: [Time and frame rate management - Unity - Manual](https://docs.unity3d.com/2021.3/Documentation/Manual/TimeFrameManagement.html)  
[^26]: [Manual: Time and Framerate Management - Unity](https://docs.unity.cn/520/Documentation/Manual/TimeFrameManagement.html)  
[^27]: [What runs more often? Update, FixedUpdate or OnGUI - Unity Discussions](https://discussions.unity.com/t/what-runs-more-often-update-fixedupdate-or-ongui-documentation-mistake/475289)  
[^28]: [Simple server time anti-cheat • Cloud Code - Unity Documentation](https://docs.unity.com/en-us/cloud-code/scripts/use-cases/server-time-anti-cheat)  
[^29]: [Time synchronization | Unity NetCode | 0.0.4-preview.0](https://docs.unity3d.com/Packages/com.unity.netcode@0.0/manual/time-synchronization.html)  
[^30]: [System.DateTime.now and how to avoid time cheats (468724) - Unity Discussions](https://discussions.unity.com/t/system-datetime-now-and-how-to-avoid-time-cheats-468724/468724)  
[^31]: [Unity, NTP time, gets blocked - Stack Overflow](https://stackoverflow.com/questions/29220820/unity-ntp-time-gets-blocked)  
[^32]: [ZLogger v2 Architecture: Leveraging .NET 8 to Maximize Performance](https://neuecc.medium.com/zlogger-v2-architecture-leveraging-net-8-to-maximize-performance-2d9733b43789)  
[^33]: [Microsoft.Extensions.TimeProvider.Testing 10.7.0 - NuGet](https://www.nuget.org/packages/Microsoft.Extensions.TimeProvider.Testing/10.7.0)  
[^34]: [ZLogger v2 による .NET 8活用事例 と Unity C# 11対応の紹介](https://neue.cc/2023/12/19_zlogger2.html)  
[^35]: [referencesource/mscorlib/system/datetimeoffset.cs at main - GitHub](https://github.com/microsoft/referencesource/blob/master/mscorlib/system/datetimeoffset.cs)
