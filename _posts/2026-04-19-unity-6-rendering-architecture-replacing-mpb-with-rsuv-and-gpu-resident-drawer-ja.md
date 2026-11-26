---
title: "Unity 6のレンダリングアーキテクチャ：MPBを捨て、RSUVとGPU Resident Drawerへ移行する徹底マテリアル最適化"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: Unity 6でAAAレベルのパフォーマンスを達成するための、MaterialPropertyBlockからRSUVおよびGPU Resident Drawerへのアーキテクチャ移行に関する包括的分析。
lang: ja
translation_id: unity6-material-rsuv-grd
math: true
---

## **エグゼクティブサマリー (Executive Summary)**

Unity 6への移行は、レンダーパイプライン（render pipelines）が大量のインスタンス化ジオメトリ（instanced geometry）を処理する方法に根本的なアーキテクチャの変化をもたらします。ゲーム開発の歴史において、1つのマテリアルを共有しつつオブジェクトごとに個別のプロパティ変更（色のティント変更 - color tints など）を必要とする多数のオブジェクトを最適化する場合、従来は標準のGPU Instancingと組み合わせた `MaterialPropertyBlock` (MPB) APIに依存してきました。しかし、Unity 6におけるUniversal Render Pipeline (URP) とHigh Definition Render Pipeline (HDRP) を詳細に分析すると、このレガシー（legacy）なアプローチはもはや最適な手段ではなく、多くのケースで深刻なパフォーマンス低下を引き起こすことが明らかになります。

「Long Gil Studio DevLog」向けにユーザーから提供されたドラフト文書を精査すると、旧バージョンでは正しかったレガシーな最適化理論と、Unity 6の最新レンダリング機能に対する重大な誤解が混在していることがわかります。具体的には、ドラフトが `MaterialPropertyBlock` の使用を推奨している点は、Unity 6の新しい **GPU Resident Drawer (GRD)** 技術およびその基盤となる低レベル **BatchRendererGroup (BRG)** APIと真っ向から矛盾しています。[^1] 最大のレンダリングスループットを達成するには、開発者は **Renderer Shader User Value (RSUV)** を採用するか、**Data-Oriented Technology Stack (DOTS)** へ完全に移行する必要があります。[^3]

本調査レポートでは、レンダリングのボトルネック、Scriptable Render Pipeline (SRP) Batcherの動作メカニズム、マテリアル複製のシステム的帰結、およびUnity 6でAAAグレードのレンダリングパフォーマンスを実現するために不可欠な最新パターンについて徹底的な技術分析を提供します。さらに、Long Gil Studio DevLogへの公開に向けて修正・専門的に再構成した技術記事もあわせて提供します。

## **第1部：Long Gil Studioオリジナルドラフトの技術レビュー**

最初のドラフトは、非常に具体的なレンダリングの課題を提示しています。すなわち、単一のマテリアルを共有しながら個別の色変更を必要とする無数の同一オブジェクトを含むSceneを最適化することです。ドラフトは誤った設計パターン（anti-patterns）を正確に特定しているものの、Unity 6のアーキテクチャにおいてはパフォーマンスを低下させる解決策を指定してしまっています。

### **オリジナルドラフトの正確な点**

1. **マテリアル複製（Material Duplication）のペナルティ：** ドラフトは、オブジェクトごとに別々のマテリアルインスタンスを作成すること（例：`GetComponent<Renderer>().material.color` の使用）がメモリ肥大化（memory bloat）を招き、ドローコールバッチング（draw call batching）を完全に破壊することを正確に指摘しています。[^5] `.material` プロパティにアクセスすると、Unityエンジンはそのマテリアルのクローン（clone）を暗黙的に生成せざるを得なくなり、SRP BatcherやGPU Instancingがこれらのオブジェクトを単一のSetPassコールにまとめる能力を永久に失わせます。[^5]
2. **`MaterialPropertyBlock` (MPB) のメカニズム：** ドラフトは、MPBがデータオーバーライドバッファ（data override buffer）として機能し、新しいマテリアルクローンを作成せずにレンダラーからGPUへインスタンスごとの（per-instance）プロパティを渡せるという点を正しく特定しています。[^7]
3. **文字列（String）プロパティと整数識別子（Integer IDs）：** ドラフトは、シェーダープロパティの検索に文字列を使用することで生じる中央処理装置（CPU）の遅延を適切に強調し、ループを最適化するために `Shader.PropertyToID()` 命令で整数識別子を事前キャッシュすることを推奨しています。[^7]

### **重大な誤りと時代遅れのパラダイム**

1. **Unity 6における「AAA標準」としてのMPB：** オリジナルドラフトの最大の欠陥は、MPBがUnity 6における最適な「AAA」ソリューションであると主張している点です。MPBは旧来のBuilt-In Render Pipelineでは標準でしたが、現代のSRPアーキテクチャにおいては破壊的なアンチパターンとして機能します。[^8] GameObjectにMPBを適用すると、そのオブジェクトは即座にSRP Batcherのパイプラインから除外されます。[^10]
2. **レガシーGPU Instancingへの依存：** ドラフトはMPBがSRP Batcherを壊すことを認め、フォールバックとして従来のGPU Instancingに頼ることを提案しています。技術的には、手動でSRP互換性を解除してInstancingを有効にすることで実現可能ですが、これによりエンジンは高度に最適化されたSRPアーキテクチャをバイパスせざるを得なくなります。[^12]
3. **GPU Resident Drawer (GRD) の見落とし：** Unity 6ではGPU Resident Drawerが導入され、ドローコール生成をコンピュートシェーダー（compute shaders）にオフロードすることでCPU処理コストを最大50%削減します。[^14] `MaterialPropertyBlock` が存在すると、そのGameObjectはGRDへの参加を厳格に禁止されます。[^1] Unity 6でMPBを推奨することは、プロジェクトがエンジンの最も強力な新最適化機能を利用するのを事実上妨げることになります。
4. **Renderer Shader User Value (RSUV) の欠落：** Unity 6.3 LTSで導入されたRSUVは、単純なオブジェクトごとのバリエーションを処理する際にMPBを直接置き換えるアーキテクチャです。[^15] RSUVを使用すると、SRP BatcherやGPU Resident Drawerを壊すことなく、レンダラーごとに24ビット整数をシェーダーへ渡すことができます。[^3]

## **第2部：レンダリングにおけるボトルネックの根本原因分析**

特定のAPI呼び出しがなぜフレームレート（frame rate）を破壊するのかを理解するには、中央処理装置（CPU）とグラフィックス処理装置（GPU）間の通信モデルを検証する必要があります。現代のハードウェアアーキテクチャでは、これら2つのプロセッサ間での緊密かつ遅延に敏感な同期が求められます。

### **CPU-GPU間通信のオーバーヘッド（Overhead）**

1フレームをレンダリングするプロセスでは、CPUがカメラの視界内に表示されるすべてのオブジェクトを走査し（フラスタムカリング - frustum culling）、それらのマテリアルプロパティを特定し、必要なテクスチャ（textures）とシェーダーをGPUメモリにバインド（bind）して、描画コマンド（draw command）を発行する必要があります。このパイプラインで最もコストがかかる操作は、GPUがポリゴン（polygons）を描画することではなく、ドローコールの前に必須となる状態変更 — 一般に **SetPassコール** と呼ばれる処理です。[^5]

CPUは新しいマテリアルに遭遇するたびに、新しいパラメータをGPUへアップロードするためにレンダリングパイプラインを一時停止しなければなりません。[^18] もしSceneに10,000体の敵が存在し、それぞれが異なる鎧の色を表現するために固有のマテリアルインスタンスを所有している場合、CPUは10,000回の状態変更を実行する必要があります。これにより膨大なCPUオーバーヘッドが発生し、GPUがCPUからの指示を待ってアイドル状態になるボトルネックを引き起こします。

### **`.material` プロパティによるメモリ断片化**

スクリプトが色を変更するために `Renderer.material` にアクセスすると、エンジンは元の共有アセット（asset）の整合性を保護しなければなりません。そのため、そのマテリアルに対して内部的に `Instantiate()` を実行します。これにより、パフォーマンスに対して2つの深刻なペナルティが発生します。

1. **バッチングの破壊（Batching Destruction）：** オブジェクトは他の同種オブジェクトとマテリアル参照を共有しなくなります。直ちにUnityはこのオブジェクトに対するStatic Batching、Dynamic Batching、またはSRP Batchingをすべて停止します。[^5] グラフィックカードはそれを完全に独立した実体として処理しなければならなくなります。
2. **ガベージコレクション（Garbage Collection）とメモリリーク（Memory Leaks）：** 新しく作成されたマテリアルのコピーはC#が管理するマネージドヒープ（Heap）上に確保されます。オブジェクトが破棄されても自動的にガベージコレクションされることはありません。開発者が明示的に `Destroy(renderer.material)` を呼び出さない限り、メモリは割り当てられたまま残ります。これによりメモリリークが発生し、ガベージコレクタ（Garbage Collector - GC）がMark-and-Sweep処理を起動せざるを得なくなり、FPSが急落する深刻なスパイク（spikes）を引き起こします。[^5]

## **第3部：SRP Batcherのアーキテクチャと従来のGPU Instancingの陳腐化**

Scriptable Render Pipeline (SRP) は、Unityがシェーダーデータを管理する方法を根本的に再編しました。従来の最適化手法がUnity 6で完全に失敗する理由を評価するには、SRP Batcherを理解することが不可欠です。

### **SRP Batcherの動作メカニズム**

旧来のパイプライン（Built-in）では、マテリアルは個別のユニフォーム変数（separate uniform variables）を通じてGPUにデータをアップロードしていました。SRP Batcherはこの方式を、定数バッファ（Constant Buffers - CBUFFERs）と呼ばれる大規模で永続的なGPUバッファを使用する方法に置き換えます。[^11]

SRPアーキテクチャでは、シェーダーが変数を2つの独立したバッファブロックに分離することが義務付けられています[^11]：

* `UnityPerMaterial`：同じマテリアルを使用するすべてのオブジェクトで共有されるプロパティ（例：ベースカラー、メタリックマップ - metallic maps、滑らかさ）を格納するCBUFFER。
* `UnityPerDraw`：特定のドローコールに固有のプロパティ（例：オブジェクトの空間変換行列 - transformation matrices）を格納するCBUFFER。

`UnityPerMaterial` バッファはGPUメモリ内に永続するため、連続するオブジェクトが同じシェーダーバリアント（shader variant）を共有している限り、CPUはレンダーループ内でマテリアルプロパティを再アップロードする必要がなくなります。[^18] SRP Batcherはこの永続バッファをバインド（bind）し、はるかに小さい `UnityPerDraw` バッファを更新するだけで済みます。この設計によりCPUコストが劇的に削減され、レンダリング速度が1.2倍から4倍に向上することもあります。[^21]

### **`MaterialPropertyBlock` との根本的な矛盾**

`MaterialPropertyBlock` APIは本来、レンダラーレベルでマテリアルプロパティを上書きするために設計されました。しかし、SRP Batcherは `UnityPerMaterial` CBUFFERの厳密な分離と永続性に依存しているため、MPBを注入（inject）する行為はこのメモリレイアウトに直接違反します。[^8]

MPBが適用されると、Unityは永続的なマテリアルバッファがオブジェクトに対して均一に適用されることを保証できなくなります。そのため、エンジンはそのオブジェクトをSRP Batcherパイプラインから強制的に排除せざるを得なくなります。[^9] Unityの公式ドキュメントでも次のように明確に確認されています：*「この機能はSRP Batcherと互換性がないことに注意してください。URPまたはHDRPでMPBを使用すると、パフォーマンスが低下する可能性が高いです。」*[^8]

### **レガシーなフォールバック：`Graphics.DrawMeshInstanced`**

歴史的に、開発者が膨大なバリエーション（例：異なる色を持つ木々の森）を必要とする場合、SRP Batcherを失うことを受け入れてGPU Instancingに立ち戻っていました。[^12] これには、`UnityPerMaterial` バッファの外側にプロパティを宣言することで手動でシェーダーのSRP互換性を解除し、マテリアル上で「Enable GPU Instancing」を有効にする必要がありました。[^13]

GPU Instancingは変換行列の配列と色データを渡すことでドローコールを削減しますが、重大な制約が伴います。[^12] 重いオーバードロー（overdraw）に苦しみ、メッシュ（meshes）が完全に同一であることを要求し、毎フレームインスタンス配列（instance arrays）を収集してアップロードするという重い負荷をCPUに課します。Unity 6では、この手法はGPU Resident Drawerアーキテクチャによって完全に置き換えられました。[^23]

## **第4部：Unity 6エコシステムと `MaterialPropertyBlock` (MPB) の非互換性**

MPBをさらに深く分析すると、SRP Batcherを壊すだけでなく、Unity 6のデバッグツール（debugging tools）やライティングシステム（lighting systems）に対しても構造的なリスクをもたらすことがわかります。

### **ライトマップデータとGlobal Illuminationへの影響**

MPBの誤用に関して最も語られることの少ない影響の1つが、ライトマップ（Lightmap）データの消失です。`new MaterialPropertyBlock()` を作成して `Renderer.SetPropertyBlock()` で割り当てると、渡したプロパティブロックがレンダラーのローカル状態を完全に上書きします。[^24]

オブジェクトがベイク済み（baked）Global Illumination (GI) システムを使用している場合、LightmapのUV座標とLight Probeの係数に関する情報は、そのレンダラー自身のプロパティブロック内に暗黙的に保存されています。[^24] 色を設定する前に `Renderer.GetPropertyBlock(block)` を呼び出さないと、誤ってオブジェクトのライティング情報を完全に消去してしまいます。Long Gil Studioのオリジナルドラフトはこの `GetPropertyBlock` の部分を適切に処理していましたが、数千ものオブジェクトに対してこのAPIを繰り返し呼び出す行為自体が、決して無視できない追加のCPU遅延を生み出します。

| 最適化手法 | RAMリークを発生させるか | SRP Batcher互換 | GRD互換 | DOTS互換 | 使用の推奨 |
| :----------------------------- | :---------------------- | :-------------- | :------ | :------- | :------------------------ |
| **`Material.color`** | はい | いいえ | いいえ | いいえ | 絶対に避けるべき |
| **`MaterialPropertyBlock`** | いいえ | いいえ | いいえ | いいえ | 旧来のBuilt-inプロジェクト向け |
| **GPU Instancing** | いいえ | いいえ（競合） | いいえ | いいえ | Unity 2020-2022 |
| **Renderer Shader User Value** | いいえ | はい | はい | はい | Unity 6.3+ の標準 |

上の表が示すように、MPBは現在、旧世代に属する技術です。RAMの問題は解決しますが、Unity 6の現代的なレンダリングパイプライン全体を破壊してしまいます。

## **第5部：アーキテクチャの転換点 — GPU Resident Drawer (GRD) と `BatchRendererGroup` (BRG)**

Unity 6は画期的なレンダリングパスである **GPU Resident Drawer** を導入しています。このシステムは、CPUがドローコール生成を制御するモデルから、GPUが主導する高度に自律的なレンダリングループへとパラダイムを転換します。[^1]

### **GPU Resident Drawerのアーキテクチャ**

GPU Resident Drawerは低レベルAPIである `BatchRendererGroup` (BRG) に基づいて動作します。[^1] CPUがどのオブジェクトが可視であるかを評価し（フラスタムカリング）単一またはインスタンス化ドローコールを送信する代わりに、CPUはシーンの空間データおよびマテリアルデータ全体をGPUにアップロードします。[^25] その後、コンピュートシェーダーがカメラ外のオブジェクトの除外、遮蔽されたオブジェクトの除外（オクルージョンカリング - occlusion culling）、およびドローコールの生成をすべてGPU上で実行します。[^14]

パフォーマンスの向上は驚異的です。間接レンダリング（`DrawInstancedIndirect`）を使用することで、複雑なシーンにおいてレンダリングに必要なCPUの作業負荷を最大50%削減できます。[^14] さらに、GPU Occlusion Cullingと組み合わせることで、三角形の処理（triangle processing）を約90%削減でき、同時にGPUのフレーム時間（frame time）も半分以下に短縮されます。[^28]

### **`BatchRendererGroup` (BRG) APIとカリング**

GRDの背後にあるのが `BatchRendererGroup` です。BRGでは、ユーザーが `OnPerformCulling` コールバック関数を用いて初期化する必要があります。[^30] ここではCPUは可視性（visibility）を設定し、配列形式のドローコールを出力するだけです。オブジェクトのデータ（transform、色、フラグ）は `GraphicsBuffer` にアップロードされます。[^25] これにより、数百万もの三角形をわずか数回のSetPassコールでGPUへ送信できるようになります。

### **MPBとGRDの致命的な非互換性**

Unity 6における最適化に関して最も重要な情報は、GPU Resident Drawerの適格要件がいかに繊細であるかという点です。オブジェクトがGRDによって処理されるためには、厳格なデータレイアウト規則に従わなければなりません。[^2]

Unity 6.1+の公式ドキュメントには、`MaterialPropertyBlock` APIを使用するGameObjectsは即座にGPU Resident Drawerから除外されると明記されています。[^1] また、オブジェクトには `OnRenderObject` のようなインスタンスごとのコールバックを使用するスクリプトをアタッチしてはなりません。[^2]

開発者がオブジェクトの色を変えるためにMPBを取り付けると、意図せずエンジンに対して、その特定のオブジェクトについてレガシーなCPUベースのレンダリングモードへフォールバックするよう強制することになります。リアルタイムストラテジー（RTS）ゲームで10,000体の兵士ユニットにこれを行った場合、CPUのオーバーヘッド（overhead）が急激に跳ね上がり、Unity 6エンジンへのアップグレードによる恩恵を完全に打ち消してしまいます。

## **第6部：現代の標準 — Unity 6.3のRenderer Shader User Value (RSUV)**

MPBと最新パイプラインの非互換性によって生じたアーキテクチャ上の行き詰まりを認識したUnityは、Unity 6.3 LTSバージョンで **Renderer Shader User Value (RSUV)** 機能を導入しました。[^15] RSUVは、単一のマテリアルを共有する多数のレンダラーに対してシンプルなインスタンスごとのカスタマイズを適用する必要がある場合、`MaterialPropertyBlock` の決定的な代替手段として機能します。[^3]

### **RSUVの動作メカニズム**

RSUVは、MPBの欠点であった複雑なバッファ変更を回避します。代わりに、レンダラーの標準的な描画データとともに直接渡される、極めて効率的な24ビット整数チャネルを活用します。[^3] この整数は別個のバッファオーバーライド（buffer override）を必要とせず既存のデータ構造に統合されているため、SRP BatcherとGPU Resident Drawerの両方に対して絶対的な互換性を維持します。[^3]

### **実装とビットエンコーディング（Bitwise Encoding）**

色の変化にRSUVを使用するには、CPUが目的のRGB値を単一の24ビット符号なし整数（`uint`）にエンコードする必要があります。各色チャネル（赤 - Red、緑 - Green、青 - Blue）は8ビット（0から255までの値）を占有します。[^3]

エンコード演算には、ビット左シフト演算子（`<<`）とビットOR演算子（`|`）を使用します。数式では次のように表されます。

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

実際のC#実装において、`MeshRenderer` コンポーネントの配列をループしてランダムなカラーティントを適用する処理は非常に高いパフォーマンスを発揮し、ガベージメモリを一切割り当てません（zero garbage allocation）[^3]：

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // ランダムな色を計算（より鮮やかな発色のためにHSV色空間を使用）  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // RGBを24ビット整数にエンコード（Blue, Green, Red）  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // Unity 6.3の新しいAPIを通じてレンダラーに直接値を適用
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **シェーダーでのデコード（Shader Decoding）**

GPU側では、シェーダーはこの24ビット整数を正規化された `float4` カラー値へとアンパック（unpack）する必要があります。Unityはこのデータブロックにアクセスするための組み込み変数 `unity_RendererUserValue` を提供しています。[^3]

デコード処理では、ビット右シフト演算子（`>>`）とビットマスク `255` を用いたビットAND演算子（`&`）を使用して各8ビットセグメントを分離します。その後、255の逆数（`1.0 / 255.0`）を掛けて値を `0.0` から `1.0` の範囲に正規化します。[^3]

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

High-Level Shader Language (HLSL) またはShader GraphのCustom Functionノードを用いたアンパックのロジックは次のようになります[^3]：

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // 赤チャネル (Red)  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // 緑チャネル (Green)  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // 青チャネル (Blue)  
    1.0 // 固定アルファ  
);
```

このパラダイムシフトは、データ構造の複雑さ（MPBなど）を数学的計算（RSUV）とトレードオフするという洗練された最適化戦略を示しています。GPUプロセッサはビット演算に極めて優れているため、デコードコストは事実上見えないレベル（ごくわずかなクロックサイクル - clock cycles）に抑えられます。一方で、SRP BatcherとGPU Resident Drawerのパスを維持することにより、フレーム時間（frame-time）の劇的な短縮がもたらされます。[^16]

## **第7部：超大規模ソリューション — DOTS、ECS、および `URPMaterialPropertyOverride`**

標準のGameObjectsの処理能力を超える規模で動作するプロジェクト（例：数十万の独立ユニットを含む群衆シミュレーション - boids、巨大なRTSの軍隊）では、UnityのData-Oriented Technology Stack (DOTS) が究極のレンダリングアーキテクチャを提供します。[^4]

### **データ指向メモリ管理（Data-Oriented Memory）**

GameObjectsがヒープ（Heap）上に散在するオブジェクト指向（object-oriented）システムの制約とは異なり、Entity Component System (ECS) におけるエンティティ（entities）はメモリ内に完全に連続したデータ配列（contiguous arrays of data）として存在します。[^4] このメモリレイアウトは、`BatchRendererGroup` (BRG) APIが最高性能を引き出すために要求する構造と完全に合致しています。

Entities Graphicsパッケージ内では、開発者は `URPMaterialPropertyOverride` コンポーネントを使用できます。[^4] このシステムにより、有害な `MaterialPropertyBlock` APIを一切使用せずに、エンティティごとのマテリアルプロパティ上書き（per-entity material overrides）が可能になります。

### **DOTS Instancingの動作メカニズム**

エンティティがDOTSで処理される際、DOTS Instancing用に設定されたシェーダー（Shader GraphでOverride Property Declarationにチェックを入れ、Hybrid Per Instanceを選択）は、一意の32ビット整数（メタデータ値 - metadata value）を受け取ります。[^34] この整数は、GPU上の安定した `GraphicsBuffer` 内のオフセット（offset）を表しています。[^34]

シェーダーはこのオフセットを使用して、現在レンダリング中のインスタンス（instance）に固有のプロパティデータを読み込みます。[^34] DOTS Instancingを際立たせているのは次の点です。複数のエンティティが同じプロパティ値を共有している場合、DOTS Instancingはそれらがメモリ内の同じ場所（同じオフセット）からその値を読み込むことを可能にし、GPUサイクル（GPU cycles）を節約してメモリの重複を最小限に抑えます。[^34] プロパティが従来の定数バッファに収められるのではなくオフセット経由で読み込まれるため、1つのドローコールのサイズが厳しく制限されることはなくなり、極めて大量のインスタンス数を扱うことができます。

```csharp
// DOTS / Burstコンパイルシステムを通じてRSUV値を割り当てる例 

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // NativeArrayへ直接値を書き込むことで並列処理を実行  
        // MonoBehaviourでは決して到達できない実行速度をもたらします。  
    }  
}
```

Burst Compilerでコンパイルされたバックグラウンドジョブ（Bursted Background Jobs）を通じてエンティティのコンポーネント値を変更する処理は、驚異的な速度で実行できます。[^4] 地形の傾斜角に応じて色が変わる柵や、標高に基づいて色が変わる草などを、ボトルネックなしに単一のドローコールストリームですべて描画することができます。[^4]

## **第8部：代替ソリューションの分析 (Alternative Solutions)**

Long Gil Studioのオリジナルドラフトでは、代替の最適化手法についても簡潔に触れられていました。以下の分析ではそれらの実現可能性を確認しつつ、Unity 6エンジンの物理的制約という文脈の中で位置づけます。

1. **Vertex Colors（メッシュ頂点カラー）：**
   * *メカニズム：* 3Dメッシュの頂点（vertices）に色データを直接エンコードします。シェーダーはメッシュから `TEXCOORD` または `COLOR` 属性を読み取ります。
   * *効果：* 極めて軽量であり、すべてのバッチング機能およびGRD互換性を完全に維持します。[^36]
   * *弱点：* ランタイム（実行時）に頂点カラーを変更するには、メッシュデータ配列（`mesh.colors`）を操作する必要があります。この操作はRAM上にメッシュのコピーを生成し、CPUのストール（stalls）やガベージメモリ割り当てを引き起こします。頂点カラーは、BlenderやMayaなどのソフトウェアで事前に「ベイク（baked）」された静的バリエーションに対してのみ依然として最適です。
2. **Texture AtlasingおよびUVオフセット：**
   * *メカニズム：* 複数の色バリエーションを1つのテクスチャアトラス（texture atlas）に統合し、異なるオブジェクトのUV座標をずらして特定のピクセルをサンプリングします。[^36]
   * *効果：* この手法では1つのマテリアルと1つのテクスチャを維持するため、SRP Batcherとの完全な互換性が保証されます。[^36]
   * *弱点：* 頂点カラーと同様に、ランタイムに異なるオブジェクト上でUV座標を動的に変更する場合、通常は固有のメッシュインスタンス（mesh instances）を作成する必要があり、メモリ肥大化（memory bloat）をもたらします。ただし、静的な環境デザインやボクセルゲーム（Minecraftなど）においては無敵の手法です。
3. **低レベル `Graphics.DrawMeshInstanced`：**
   * *メカニズム：* GameObjectsの階層構造を完全にバイパスし、C#コードを通じて座標行列と色の配列をGPUへ直接プッシュします。[^37]
   * *効果：* 群れアルゴリズム（flocking）やプロシージャルな植生（procedural foliage）などのシステムにおいて莫大なスループットを提供します。[^38]
   * *Unity 6における弱点：* `BatchRendererGroup` APIとGPU Resident Drawerの登場によりこのパフォーマンスが「民主化」され、ほとんどの一般的な開発シナリオにおいて複雑なカリング（culling）や描画発行コードを書く必要がなくなりました。[^19] カスタムの `DrawMeshInstanced` システムを維持管理することは、現在ではGPU Resident Drawerに自動化させるよりも多くのエンジニアリングリソースを消費します。

## **第9部：Long Gil Studio DevLog向けの推奨コンテンツ構成**

包括的な技術評価に基づき、以下は全面的に改訂され高度な技術的専門性を備えた、推奨されるDevLog記事の本文です。誤ったMPBアプローチを放棄し、読者をUnity 6の真のアーキテクチャ標準であるRSUVとGPU Resident Drawerへと導きます。

---

**Unity 6：マテリアルを共有する数千のオブジェクトを最適化 – MPBを捨てて現代的アーキテクチャへ**

**By Long Gil Studio**

**🇻🇳 ベトナム語版（日本語訳）**

**1. レンダリングのボトルネック：マテリアル複製の弊害**

大規模なゲームを開発する過程で、極めて一般的なアーキテクチャ上の課題が浮上します。「1つのマテリアルを共有する数千個のオブジェクトの色を、FPSを低下させずにどう変更するか？」

多くのプログラマーは `GetComponent<Renderer>().material.color` というコマンドを使いがちです。これは致命的な誤り（アンチパターン）です。`.material` を呼び出すと、Unityはそのマテリアルのクローン（clone）をRAM上に暗黙的に作成せざるを得なくなります。その結果、深刻なメモリリークが発生し、ガベージコレクション（Garbage Collection）が絶えずトリガーされ、バッチング（Batching）システムが完全に破壊されます。CPUが数千もの個別のドローコールの処理で過負荷になる一方で、GPUは飢餓状態に陥ります。

**2. レガシーの罠：Unity 6で `MaterialPropertyBlock` が「死んだ」理由**

かつての「プロ仕様」の解決策は、マテリアルをクローンせずにオブジェクトごとのデータを渡すために `MaterialPropertyBlock` (MPB) を使うことでした。**しかし、Unity 6 (URP/HDRP) を使用しているなら、この手法を直ちにやめなければなりません。**

Unity 6は **SRP Batcher** パイプラインと革新的な技術である **GPU Resident Drawer (GRD)** に大きく依存しています。GRDはレンダリング処理フロー全体（ドローコール生成、カリング）をGPU上のコンピュートシェーダーへ委譲し、CPUの計算時間を最大50%削減します。しかし、エンジンのコア仕様書によれば、オブジェクトに `MaterialPropertyBlock` をアタッチした瞬間、そのオブジェクトは即座にSRP Batcherから除外され、GPU Resident Drawerとの互換性を完全に失います。MPBを使用するということは、軍隊全体に対してUnityを遅くてCPU負荷の高いレガシーなレンダーパイプラインへ強制的に引き戻していることに等しいのです。

**3. Unity 6の新標準：Renderer Shader User Value (RSUV)**

この行き詰まりを根本から解決するため、Unity 6.3 LTSアップデートでは **Renderer Shader User Value (RSUV)** が導入されました。このAPIにより、24ビット整数をレンダラーへ直接渡すことができます。RSUVは新しいバッファ（buffers）の割り当てを必要としないため、SRP BatcherとGPU Resident Drawerの双方と100%の互換性を維持します。

**ステップ1：C# エンコーディング（Zero Garbage Allocation）**

MPBのように文字列（string）を使う代わりに、ビットシフト演算（bitwise）によってRGBカラーを1つの24ビット整数にエンコードします：

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Blue、Green、Redの3チャネルを1つの24ビット整数にエンコード  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // 値を適用（SRPおよびGRDアーキテクチャにおいて絶対的に安全！）  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**ステップ2：Shader Graphでのデコード**

Shader Graph内で、Vector4を出力とする **Custom Function** ノード（Type: String, Name: DecodeColor）を作成してください。次のHLSLコードを貼り付けて、整数を標準の色に戻して展開します：

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

この出力をFragment ShaderのBase Colorポートに接続してください。これでCPU遅延ゼロで無限のカラーバリエーションを実現し、GPU Resident Drawerシステムのパワーを最大限に活用できます。

**例：シェーダースクリプトでの実装（Shader Graph不使用）**

コード（HLSL）でカスタムシェーダーを記述している場合は、以下のコードスニペットのように `BuildSurfaceData` 関数に介入して `unity_RendererUserValue` をデコードし、`BaseColor` と乗算することができます：

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // RSUVのデコード
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // rsuvColorの適用
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ... 
}
```

*詳細は以下を参照してください：*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. 100,000オブジェクトの壁を越える：DOTS / ECS ソリューション**

ゲームで数十万もの独立したユニット（巨大な軍団など）をレンダリングする必要がある場合、どれだけレンダリングを最適化しても、従来のGameObjectsシステムでは確実にCPUがボトルネックになります。この規模にはUnity DOTS構造へ移行してください。`URPMaterialPropertyOverride` コンポーネントを使用することでData-Orientedなメモリレイアウトを構築し、低レベルの `BatchRendererGroup` APIと直接やり取りすることで、真のAAA基準にふさわしい圧倒的なパフォーマンスを実現します。

---

**🇺🇸 英語版（日本語訳）**

**1. レンダリングのボトルネック：マテリアル複製**

高密度なゲームを開発する際、よくあるアーキテクチャ上の課題が生じます。「パフォーマンスを破壊せずに、同じマテリアルを共有する数千個のオブジェクトの色を変更するにはどうすればよいか？」

開発者はデフォルトで `GetComponent<Renderer>().material.color` を使いがちです。これは致命的なアンチパターンです。`.material` にアクセスすると、Unityはマネージドヒープ上にマテリアルを暗黙的にクローンせざるを得なくなります。これにより深刻なメモリ肥大化が発生し、ガベージコレクションのスパイクを誘発し、ドローコールバッチングを破壊して、GPUを飢餓状態にさせながらCPUオーバーヘッドを制御不能なレベルまで押し上げます。

**2. レガシーの罠：Unity 6でMaterialPropertyBlockが死んだ理由**

歴史的に「プロ」の解決策は、マテリアルをクローンせずにインスタンスごとのデータを渡すためにMaterialPropertyBlock (MPB) を使用することでした。**Unity 6 (URP/HDRP) を使用している場合、直ちにこの手法の使用を中止しなければなりません。**

Unity 6は **SRP Batcher** と画期的な新機能 **GPU Resident Drawer (GRD)** に大きく依存しています。GRDはフラスタムカリングとドローコール生成をGPUコンピュートシェーダーにオフロードし、CPUレンダリング時間を最大50%削減します。しかし、コアエンジンドキュメントによれば、オブジェクトにMaterialPropertyBlockを適用すると、即座にSRP Batcherの対象外となり、GPU Resident Drawerとの互換性が完全に失われます。MPBを使用することで、巨大な軍隊に対してUnityを遅くCPU依存のレガシーなレンダリングパスへと強制的に戻していることになるのです。

**3. Unity 6の標準：Renderer Shader User Value (RSUV)**

このアーキテクチャ上のデッドロックを解消するため、Unity 6.3 LTSでは **Renderer Shader User Value (RSUV)** が導入されました。このAPIを使用すると、24ビット整数をレンダラーの基本データペイロードに直接渡すことができます。永続的な定数バッファを変更しないため、RSUVはSRP BatcherとGPU Resident Drawerの双方と100%の互換性を維持します。

**ステップ1：C# エンコーディング（メモリ割り当てゼロ）**

文字列を渡してブロックを作成する代わりに、ビット演算を用いてRGBカラーを1つの24ビット符号なし整数に数学的にパックします：

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Blue、Green、Redチャネルを単一の24ビット整数にエンコード  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // ネイティブ方式で値を適用（SRPおよびGRDに対して100%安全！）  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**ステップ2：シェーダーでのデコード**

Shader Graph内で、Vector4を出力とする **Custom Function** ノード（Type: String, Name: DecodeColor）を作成します。このHLSLコードを貼り付けて、整数を正規化されたfloatカラーに戻してアンパックします：

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

この出力をフラグメントのBase Color入力に接続します。これにより、GPU Resident Drawerをフル活用しながら、ドローコールのペナルティなしで無限のカラーバリエーションを得ることができます。

**例：カスタムシェーダー（Shader Graph不使用）での実装**

コード（HLSL）でカスタムシェーダーを記述している場合、以下のdiffに示すように `BuildSurfaceData` 関数を変更して `unity_RendererUserValue` をデコードし、`BaseColor` と乗算できます：

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // RSUVのデコード
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // rsuvColorを適用
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ...
}
```

*関連項目：*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. 100,000オブジェクトのその先へ：DOTS / ECS**

ゲームで数十万の動的ユニットをレンダリングする必要がある場合、グラフィックスの最適化に関わらず、標準のGameObjectsはいずれCPUのメインスレッドでボトルネックになります。大規模なスケールに対応するには、Unity DOTSへ移行してください。URPMaterialPropertyOverrideコンポーネントを使用することで、厳格なData-Orientedメモリレイアウトが可能になります。これが低レベルのBatchRendererGroup APIと直接連携し、比類のない純粋なAAAレベルのレンダリングパフォーマンスを実現します。

---

## **第10部：開発チームへの戦略的推奨事項**

現代のレンダリングモデルの分析は、旧来の最適化知識（legacy）と現代のエンジンアーキテクチャとの間の重要な違いを示しています。グラフィックスエンジニアにとっての核心は次の通りです：オブジェクトごとにデータバッファ（data buffers）を変更する行為は、本質的に並列処理およびGPU駆動のレンダーループと敵対します。Unity 5.xやUnity 2019の最適化の発想をUnity 6にそのまま流用することはできません。

Unity 6で最高のパフォーマンスを達成するために、開発チームは以下のプロトコルを厳格に運用する必要があります。

1. **MPB使用状況の監査（Audit for MPB Usage）：** プロファイリングツール（例：Unity Profiler）やFrame Debuggersを継続的に運用し、大量にインスタンス化されるジオメトリ（mass-instanced geometry）に対して `MaterialPropertyBlock` が適用されている箇所を特定し、根絶する必要があります。MPBの短期的な利便性は、GPU Resident Drawer機能の体系的な喪失によって完全に帳消しになります。チームは不要なMPBの初期化を検出するため、ソースコードの警告やCI/CDスクリプトを導入すべきです。
2. **ビットエンコーディング戦略の採用（Bitwise Encoding Strategies）：** Renderer Shader User Value (RSUV) の導入にはプログラミング手法の変革が必要です。テクニカルアーティスト（Technical Artists）とゲームプレイプログラマーは協力して、RSUVの24ビット制限に合わせた厳密なビットパッキングスキーマを定義しなければなりません。多様なデータ状態（色、ダメージ、チームID - team ID）がレンダラーに到達する前に効率的にシリアライズ（serialized）されることを保証する必要があります。例として、「陣営ID」に4ビット（16陣営を許容）、「ダメージ状態」に8ビット（256段階を許容）、「Custom Tint」（カスタム色）に12ビットを割り当てることができ、これらすべてがシェーダー内のビットマスク（bitmasks）を通じて同時にデコードされます。
3. **ECS移行のしきい値評価（Evaluate Thresholds for ECS Transition）：** RSUVはGameObjectsにおけるマテリアルバリエーションのボトルネックを解決しますが、物理演算、行列計算（transform calculations）、およびGameObjectのカリングに関するCPUの限界境界は依然として存在します。アクティブなエンティティ数が10,000の動的エージェント（dynamic agents）を超えると予測されるプロジェクトは、大胆かつ積極的にDOTS (Entity Component System) 実装のプロトタイプを設計すべきです。`URPMaterialPropertyOverride`[^34] コンポーネントを使用して `BatchRendererGroup` APIとネイティブに連携することこそが、最新PCおよび次世代コンソールハードウェアの潜在能力を完全に解き放つ唯一の道です。

## **参考文献**

[^1]: Enable the GPU Resident Drawer in URP - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)  
[^2]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^3]: Set and use the RSUV - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)  
[^4]: Migrated my game to ECS/DOTS and material overrides are awesome! : r/Unity3D - Reddit, 2026年4月19日アクセス, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)  
[^5]: Why You Should Stop Swapping Materials in Unity (And What to Do Instead) - Medium, 2026年4月19日アクセス, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)  
[^6]: Material Property Blocks - using them to store the original color of a material upon instantiation : r/Unity3D - Reddit, 2026年4月19日アクセス, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)  
[^7]: Instancing and Material Property Blocks | Ronja's tutorials, 2026年4月19日アクセス, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)  
[^8]: Scripting API: MaterialPropertyBlock - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)  
[^9]: Unity 6 and custom material bug - Spine Forum, 2026年4月19日アクセス, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)  
[^10]: Scriptable Render Pipeline (SRP) Batcher - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)  
[^11]: Scriptable Render Pipeline Batcher - Unity 6.3 User Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)  
[^12]: GPU instancing - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)  
[^13]: Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)  
[^14]: Beginning Game Development: GPU Resident Drawer | by Lem Apperson - Medium, 2026年4月19日アクセス, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)  
[^15]: Introduction to RSUV - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)  
[^16]: Renderer Shader User Value sample - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)  
[^17]: Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, 2026年4月19日アクセス, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)  
[^18]: Scriptable Render Pipeline Batcher - Unity User Manual 2021.3 (LTS), 2026年4月19日アクセス, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)  
[^19]: Unity Draw Call Batching: The Ultimate Guide (2026 Update), 2026年4月19日アクセス, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)  
[^20]: Scriptable Render Pipeline Batcher - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)  
[^21]: SRP Batcher: Speed up your rendering - Unity, 2026年4月19日アクセス, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)  
[^22]: Remove SRP Batcher compatibility for GameObjects in URP - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)  
[^23]: GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D - Reddit, 2026年4月19日アクセス, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)  
[^24]: Scripting API: Renderer.GetPropertyBlock - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)  
[^25]: Create batches with the BatchRendererGroup API in URP - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)  
[^26]: Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)  
[^27]: Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, 2026年4月19日アクセス, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)  
[^28]: Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling - YouTube, 2026年4月19日アクセス, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)  
[^29]: Graphics Features and Tools in Unity 6 Feel Like MAGIC! STP, Resident Drawer, and Occlusion Culling! - YouTube, 2026年4月19日アクセス, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)  
[^30]: Initialize a BatchRendererGroup object in URP - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)  
[^31]: Boost performance of your game in Unity 6 with GPU Resident Drawer - The Knights of U, 2026年4月19日アクセス, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)  
[^32]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^33]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)  
[^34]: DOTS Instancing shaders in URP - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)  
[^35]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)  
[^36]: One Material multiple colors possible? : r/Unity3D - Reddit, 2026年4月19日アクセス, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)  
[^37]: Single-pass instanced rendering and custom shaders - Unity - Manual, 2026年4月19日アクセス, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)  
[^38]: Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, 2026年4月19日アクセス, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
