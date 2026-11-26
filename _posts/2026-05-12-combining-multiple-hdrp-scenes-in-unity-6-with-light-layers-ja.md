---
title: "Unity 6 HDRPにおける複数シーン統合アーキテクチャ：技術分析とLight Layersによる包括的ソリューション"
date: 2026-05-12 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, hdrp, rendering, lighting, shadows, volumetrics, apv]
description: Light Layers、シャドウ、ボリュメトリクス、スカイボックス、ポストプロセス、Adaptive Probe Volumesを用いてUnity 6で2つのHDRPシーンを統合する方法の技術解説。
lang: ja
translation_id: unity6-hdrp-multi-scene-light-layers
---

## **初期検証：Light Layersによるライティング分離の基盤**

Unity 6のHigh Definition Render Pipeline（HDRP）を用いて複雑なグラフィックスプロジェクトを開発する際、完全に独立した2つの環境またはシーン空間（scenes）を1つの物理ファイルへ統合する要件は、重大なアーキテクチャ上の課題を突きつけます。Directional Light光源を分離し、特定のオブジェクト群への影響範囲を制限するための中核として**Light Layers**（またはRendering Layers）機構を採用したことは、エンジンのコア設計ドキュメントに厳密に準拠した、技術的に完全に正しい判断です。[^1]

現在のソリューションが採っている設定手順は、Frame SettingsおよびHDRP AssetにアクセスしてLight Layersを有効化し、Directional LightのGeneralセクションでLight Layerパラメータをカスタマイズし、最後にMesh RendererのAdditional SettingsにあるRendering Layer Maskパラメータを同期させるという流れです。この一連の操作により、第1空間（Scene 1）のメッシュが第1空間の太陽（Directional Light 1）からの光反射のみを計算し、第2空間（Scene 2）についても同様に動作することを保証する単方向の光学チャネルが正常に確立されます。[^1]

より深い技術的本質に踏み込むと、Unity HDRPのレンダリングシステムはG-bufferをビット単位で分類するためのツールとしてLayerMasksをサポートしています。3Dグラフィックス環境のレンダラー（Renderer）は、最大32種類の異なるレンダリングレイヤー（rendering layers）をサポート可能です。それにもかかわらず、計算パフォーマンスとVRAMメモリ帯域幅を最適化するため、Rendering Layers機構を使用するすべてのHDRPエフェクト（直接光ライティング、Decal、ボリュメトリックボリュームを含む）は、現在バッファの先頭16レイヤーのみでの演算をサポートしています。[^1] すなわち、Layer 1とLayer 2を割り当てるアプローチは完全に安全圏にあり、パフォーマンス面の安定性を保証します。また、Shader Graphにおいて`Sample Buffer`ノードと`RenderingLayerMask`を組み合わせて介入することで、該当レイヤーの光源下でのみエフェクトを表示する専用マテリアルをカスタマイズすることも可能になります。[^1]

しかし、現行ソリューションの限界は、物理ベースレンダリング（Physically Based Rendering：PBR）の第1の柱である**直接光（Direct Lighting）**しか解決していない点にあります。Unity 6 HDRPにおける完全でリアルな環境エコシステムは、互いに絡み合って動作する無数の複雑なサブシステムから構成されています。2つの空間が同じワールド空間（world space）座標系を共有するよう強制されると、直接光の独立性は、影の漏れ（shadow leaking）、大気（volumetrics）の干渉、スカイボックス（skybox）の不整合、そして間接反射光（Global Illumination）の混入によって即座に崩壊します。ソリューションを完成させるには、これら2つの空間が互いに真に不可視となるよう、レンダリングパイプライン全体に対する大規模な介入が不可欠です。

## **ディレクショナルシャドウ（Directional Shadows）の複雑なアーキテクチャ上の制約**

照明チャネルを分離した後に立ちはだかる最大の技術的障壁は、シャドウマッピング（Shadow Mapping）のパイプラインにあります。HDRPのデフォルト設定では、システムがLight Rendering LayersとShadow Rendering Layersを自動的に同期させます。この仕組みは、ある光源から光子を受け取るあらゆるジオメトリ表面が、同時にその光源の光を遮り影を落とす遮蔽物（occluder）としても機能することを暗黙の前提としています。[^1] しかし、Unityのレンダリングパイプラインにはハードコードされた（hard-coded）根本的な物理的制約が存在します。Universal Render Pipeline（URP）とHigh Definition Render Pipeline（HDRP）のいずれも、1つのカメラにつき任意の時点でリアルタイムに影を落とせる（real-time shadow-casting）Directional Lightは**ただ1つだけ**しかサポートしていません。[^4]

局所的な影響範囲を持つPoint LightやSpot Lightとは異なり、Directional Lightはワールド全体に及ぶ太陽光を表現します。計算リソースを枯渇させることなく広大な面積の影を処理するため、HDRPは**Cascade Shadow Maps（CSM）**技術（カスケードシャドウマップ）を採用しています。[^6] 超高解像度の単一シャドウマップを生成する代わりに、システムはカメラの視錐台空間を複数の階層（デフォルトは4カスケード、Volumeの`HD Shadow Settings`で調整可能）に分割します。[^6] 各カスケード階層では、エンジンが個別のジオメトリパス（geometry pass）を実行し、専用のシャドウマップを生成する必要があります。そのため、たった1つのDirectional Lightであっても、実際には毎フレーム最大4枚のシャドウマップを継続的にレンダリングしていることになります。[^6]

仮にUnityが2つのDirectional LightにCSM技術で同時に影を生成させた場合、計算すべき高解像度シャドウマップの数は毎フレーム8枚へと跳ね上がり、メモリ帯域幅の枯渇を招いて、最新鋭のハードウェア環境においてさえ許容できないレベルまでフレームレート（FPS）が急落します。[^4] ユーザーのシーン内に2つのDirectional Lightが共存すると、Unityはどちらか一方の影生成権限を剥奪します。2つ目のライトは色成分の寄与（color contribution）を提供するのみとなり、地面への落ち影（drop shadows）を生成できなくなるため、第2空間は平面的で奥行きがなく、非物理的な見た目になってしまいます。[^4]

さらに注意を怠ると、互いに光を受け取っていなくても、空間1のオブジェクトの影が誤って空間2のオブジェクトに落ちてしまうことがあります。このジオメトリ上の影漏れを防ぐには、Shadow Layersの分離に対処しなければなりません。デフォルトでは影はライトと同期していますが、完全に制御するにはDirectional Lightを選択してShadowsセクションへ進み、**Custom Shadow Layers**チェックボックスを有効にする必要があります。[^1] この機能によりShadow Rendering LayersをLight's Rendering Layersから切り離すことができ、空間1のメッシュ（Mesh）がShadow Layer 1チャネルにのみ影を落とし、空間2のシャドウ判定プロセスからは完全に不可視となることが保証されます。[^1]

## **マルチ環境向けのシャドウ投影制約を克服する戦略**

Unity 6における「太陽の影は1つまで」という制約を乗り越えるには、2つの空間にあるオブジェクトの静的・動的性質を分析し、以下に示す2つの技術的介入戦略のいずれかを適用する必要があります。各戦略には、CSM制限システムを巧みに回避するための精緻な設定操作が伴います。

### **Box-Shaped Spot Lightで太陽をシミュレートする戦略**

両方の空間で風になびく木々、絶えず移動するキャラクター、移り変わる昼夜サイクルといった高強度の動的シャドウ（dynamic shadows）相互作用が求められる場合、2つのDirectional Lightを使うことは不可能です。その代わりとなる最適な解決策は、空間2のDirectional LightをBox形状（Box shape）と組み合わせた**Spot Light**光源に置き換えることです。[^8]

Spot Lightはリソース管理の仕組みにおいてDirectional Lightと根本的に異なります。4枚の分割カスケードマップではなく、わずか1枚の単一シャドウマップ（1 shadow map）のみをレンダリングするため、エンジンの厳しいCSM制限から解放されます。[^6][^4] Spot Lightの設定画面でShapeプロパティをBox形式に切り替えることで、限定された局所領域内において太陽光線と同一の平行光線パスを正確に模倣する指向性ライティングボリュームを生成できます。[^8]

ただし、Spot Lightの物理的特性として距離による光の減衰（distance attenuation）が発生します。実際の太陽は地球上のスケールにおいてこのような減衰をほとんど持ちません。これを解消するには、Spot Lightの詳細設定を開いて「Range Attenuation」プロパティを見つけ、調整または無効化するだけです。[^8] 距離減衰が取り除かれると、このBox形状のSpot Lightは即座に均一で平行な光を放ち、カスタマイズ可能なハードシャドウまたはソフトシャドウを生成します。その見た目は従来のDirectional Lightと区別がつかないうえ、Light Layer 2によって完全に分離されます。[^8]

### **混合キャッシュシャドウ（Mixed Cached Shadows）戦略**

空間1または空間2が主に建物、地形、道路などの静的建築物で構成されており、プレイヤーキャラクターのような動的エンティティがごく少数しか存在しない場合、**Mixed Cached Shadows**（混合キャッシュシャドウ）機能の活用は画期的なアーキテクチャ上の判断となります。[^7] HDRPバージョン13.xおよび14.0から導入され（Unity 6では標準機能）、Directional Light向けに解放されたこの機能により、シャドウマップを「静的」と「動的」の2つの独立したデータストリームへ分割できます。[^7]

このソリューションを有効化する手順には、プロジェクト管理設定とローカルオブジェクト間の同期が求められます。最初に行うのは、HDRPがメモリを確保できるよう構成することです。InspectorウィンドウでHDRP Asset設定ファイルを開き、*Lighting > Shadows > Directional Light Shadows*のパスを辿って**Allow Mixed Cached Shadows**オプションを必ずオンにします。[^7] 次にシーン内のDirectional Lightで操作を行います。LightタブのShadows項目を展開して**Always draw dynamic**にチェックを入れ、ライトのUpdate Modeパラメータを*Every Frame*（毎フレーム）から*On Demand*（オンデマンド）または*OnEnable*へ変更します。[^7] 最後に、環境内のすべての静的オブジェクトを選択し、それらのMesh Rendererコンポーネントにある**Static Shadow Caster**オプションを有効化します。[^7]

内部動作として、システムがこのモードで稼働する際、HDRPはDirectional Lightのキャッシュ済み（cached）および非キャッシュ（non-cached）双方の影に対して同一のShadow Atlasを使用します。[^10] 静的とマークされたオブジェクトの影はメモリバッファへ一度だけ描画され、動的オブジェクトの影のみが継続的に更新されます。[^7] その後、HDRPはblit（Bit Block Transfer）演算を実行してキャッシュ済み静的マップのデータを動的マップへ統合し、膨大な量のジオメトリドローコール（geometry draw calls）を削減します。[^7]

この手法は2つのDirectional Lightが常時同時に影を落とすことを直接可能にするわけではありませんが、計算リソースを解放することで、カメラの位置に応じて光源間のシャドウレンダリング権限（shadow rendering authority）を素早く切り替えたり、1つのDirectional Lightをキャッシュ済みシャドウ用に割り当てて動的シャドウには局所光源を用いたりすることが可能になります。[^5] 注意点として、Directional Lightのカスケードシャドウマップ（cascade shadow maps）は視点依存（view-dependent）であるため、カメラがカスケード境界を横切って移動すると影の輪郭に視覚的アーティファクトが生じる恐れがあります。これを防ぐには、カメラが一定距離移動するたびに`RequestShadowMapRendering`関数を呼び出してキャッシュマップを更新するC#スクリプトを作成する必要があります。[^7] また、`SetShadowResolution()`や`SetShadowUpdateMode()`といった関数もAPI経由で提供されており、実行時のバッファ制御が可能です。[^7]

| マルチシーン向けシャドウ手法の比較 | 権限切替型 Directional Light | Box-Shaped Spot Light | Mixed Cached Shadows |
| :--- | :--- | :--- | :--- |
| **動作の仕組み** | スクリプト経由でライト1の影を無効化し、ライト2を有効化する。[^5] | 太陽を模倣する限定範囲のボリューム光源を使用する。[^8] | 静的影をバッファにキャッシュし、動的影のみを更新する。[^7] |
| **VRAMリソース消費** | 低（1つのカスケード系統のみ稼働）。[^6] | 中（非カスケードのシャドウマップ1枚を追加）。[^6] | 非常に高（静的マップと動的マップを並行保持）。[^7] |
| **Light Layers対応** | あり（全面対応）。[^1] | あり（全面対応）。[^1] | あり（全面対応）。[^1] |
| **有効な適用範囲** | 2つの空間が同時に画面に映らない場合に適する。 | 2つの太陽が同時に影を落とす必要がある重複エリアに最適。[^4] | 主に静的オブジェクトで構成される広大な背景に最適。[^7] |
| **技術的制約** | 急激な切り替えが視覚的な違和感を招く恐れがある。 | Range AttenuationとBoxサイズの慎重な調整が必要。[^8] | カメラ移動時のC#実装（`RequestShadowMapRendering`）が必要。[^7] |

## **ボリュメトリクス（Volumetrics）管理とスカイボックスの分離**

直接光と影は、物理ベースレンダリングパイプライン全体像の半分にすぎません。残りの半分は、空、大気層、そしてスクリーンエフェクトが担っています。元の質問の文脈では「個別のVolume」の使用が言及されていました。HDRPのVolumeアーキテクチャは、各Mesh上のLayerMaskで分類するのではなく、バウンディングボックス（bounding boxes）に対するカメラの空間位置に応じてプロパティ値を補間（interpolation）する基盤プラットフォームです。[^11] この設計思想の違いは、大気システム側からはオブジェクトがScene 1に属するかScene 2に属するかは無関係であり、カメラがどこに存在するかだけを参照することを意味します。

各シーンの環境的アイデンティティを保ったまま2つのシーンを統合するための大前提は、設計思想をGlobal Volume（グローバルボリューム）から**Local Volume**（ローカルボリューム）へと完全に切り替えることです。Global Volumeは3Dワールド内のどこにあってもカメラに影響を及ぼすため、2つの空間の分離を破壊する均一なベールをかけてしまいます。[^11]

環境を隔離する手順には以下の操作が必要です。デフォルトのGlobal Volumeを削除するか、そのPriority（優先度）を下げます。[^12] 2つの空間に対応する空のGameObjectを2つ作成し、Volumeコンポーネントを追加してMode設定を**Local**に設定します。[^11] その大気空間が存在する物理的境界を定義するため、**Is Trigger**プロパティを有効にしたBox Collider（またはMesh Collider）コンポーネントを必ず追加でアタッチしなければなりません。[^11] 空間1と空間2の間の遷移は**Blend Distance**（ブレンド距離）パラメータで制御されます。Blend Distanceの値は、Box Colliderの端から内側に向かってグラフィックスパラメータの補間が始まる余白距離を規定します。Blend Distanceを`0`に設定すると、プレイヤーが境界線を越えた瞬間に空間が「切り替わる」ようになります。この値を大きくすれば、フォグや光の色調といった環境要素が滑らかに溶け合うようになります。[^13]

### **`Visual Environment`による空のオーバーライド**

Unity 6 HDRPにおける空は、旧式のBuilt-in RPのようなEnvironment Lightingウィンドウでは定義されず、**Visual Environment**という専用のVolume Overrideによって完全に支配されます。[^15] 空を分離するには、空間1および空間2それぞれのLocal VolumeにVisual Environmentを割り当てる必要があります。

**Sky Type**パラメータを有効にすることで、空間1には`Physically Based Sky`（例：晴れた昼間）、空間2には`HDRI Sky`（例：おぼろげな月夜）といった異なる種類の空を選択できます。[^15] Volumeアーキテクチャはカメラ基準で動作するため、カメラが空間1のBox Collider内に入ると、エンジンは1行のコードも書かずに該当する空の映像を自動計算します。このオーバーライドは`Cloud Layer`（雲層）や`Ambient Indirect Lighting`（環境間接光）パラメータも同時に制御し、空が単なる背景にとどまらずグローバルな反射の色味にも正確に反映されるよう保証します。[^16] これにより、Scene 1が誤ってScene 2の空を反射してしまう現象が完全に排除されます。

### **`Local Volumetric Fog`による大気の独立化**

HDRPのフォグは2種類に大別されます。従来のExponential FogはZ-bufferの深度に基づいて単色を塗るだけです。一方、次世代グラフィックス品質に応える**Volumetric Fog**（ボリュメトリックフォグ）は光線と直接相互作用し、リアルなゴッドレイ（God-rays）効果を生み出します。[^18] 通常のVolume経由でVolumetric Fogを使用した場合、隣接空間の境界へ霧が漏れ出すリスクが依然として残ります。抜本的な解決策は、専用コンポーネントである**Local Volumetric Fog**を使用することです。[^18]

Local Volumetric Fogは、指向性ボックスとして境界を定義できる物理的な霧のボリュームです。[^18] 稼働させるには、Project Settings（*Quality > HDRP > Lighting > Volumetrics*）、HDRP Asset、およびカメラのFrame Settingsで一連のフラグ（flags）を有効化する必要があります。[^18] このコンポーネントは`Density Mask 3D Texture`による密度の絶対的な制御を可能にし、霧が均一にベタ塗りされるのではなく自然に渦巻く表現を実現します。[^18] 光の散乱色（`Single Scattering Albedo`）は、Directional Lightが透過した際の霧の色調を決定します。[^19]

Scene 1のフォグ空間がScene 2と混ざらないようにする鍵は、**Blending Mode**パラメータにあります。[^19] デフォルトではシステムは霧同士を重ね合わせる**Additive**（加算）を使用しています。Blending Modeを**Overwrite**（上書き）に変更すると、このフォグボリュームはその範囲内にある背景シーンのあらゆるフォグパラメータを容赦なく置き換えて消去します。[^19] 2つのシーンの境界で2つのLocal Volumetric Fogボリュームが重なり合う場合、**Priority**パラメータがどちらのレイヤーを手前に描画するかを決定します。HDRPでは優先度の低いボリュームを先に描画し、優先度の高いボリュームを最後に描画するルールに従います。[^19]

### **`Volume Layer Mask`とポストプロセスに関する誤解**

Bloom、Depth of Field、Color Gradingといったポストプロセス（Post-processing）効果を別々のオブジェクトごとに分離しようとするとき、Unity開発者の間で非常に多く見られる認識の落とし穴が存在します。多くの人がLight Layersと同じように機能すると期待して、Cameraの**Volume Layer Mask**プロパティを調整しようとします。[^20] しかし実際には、Volume Layer Maskは*どのオブジェクト*がポストプロセス効果を受け取るかを一切制御しません。それが制御するのは、*どのCamera*が*どのVolume*の影響を受けるかだけです。[^20]

というのも、Post-processingはスクリーンスペース（Screen Space）で実行されるレンダリング工程だからです。フレームがポストプロセス段階に到達した時点で、すべての3Dジオメトリはすでに色（RGB）と深度（Depth）データを持つ2Dピクセル配列へと「平坦化」されています。システムはもはや、どのピクセルがScene 1由来でどのピクセルがScene 2由来かを識別できません。[^22] したがって、Volume Maskを使ってBloomをScene 1にだけ適用させることは不可能です。[^22]

2つの環境を厳密に分離し、ポストプロセス効果やレンダリング手法を重ねて表示しつつ完全に独立させたい場合（例：Scene 1の一人称視点の手持ち武器をScene 2の背景の上に重ねて描画する場合）、従来の解決策はCamera Stacking（カメラスタッキング）でした。しかしHDRPにおいてCamera Stackingは極めてリソース消費が大きく、無数の同期バグを引き起こします。[^22] Unityが公式にサポートする標準かつ唯一のアーキテクチャ解は**Custom Pass Volume**です。[^25]

Custom Passを使用すると、グラフィックスパイプラインの特定フェーズ（例：*Before Transparent*、*After Post-Process*）にカスタムのレンダリングコマンドを注入（inject）できます。Custom Pass VolumeをLocalモードまたはCameraモードで動作させ[^27]、特定の`LayerMask`をターゲットに設定することで、システムは空間2のオブジェクト群全体を個別にレンダリングし、独立したポストプロセスシェーダー群を適用したうえで、空間の深度遮蔽情報（depth occlusion）を壊したりバッファを破損したりすることなく空間1の上に合成（composite）できます。[^25] シェーダー内の`_FadeValue`変数とC# APIの`CustomPass.fadeValue`を利用すれば、0から1のスケールに基づいてこれらの表示レイヤー間を滑らかにフェード・切り替えし、完璧な視覚的分離を実現できます。[^27]

## **Adaptive Probe Volumes（APV）による間接反射光の制御**

直接光は鮮やかさを生み出しますが、あらゆる物体を現実に根付かせるのは**間接光（Global Illumination：GI）**です。空間2の緑色の芝生表面に当たった光はスペクトルを吸収し、隣接する壁面に緑色の光を跳ね返します。2つの空間を1つのSceneファイルへ統合する際、両者の物理的距離は非常に近くなることがあります。隔離措置を講じなければ、空間1の鮮やかな赤い光が空間2へ激しく漏れ出し（`light bleeding`）、アートディレクション（Art Direction）を完全に台無しにします。

Unity 6以降、間接光のインフラは**Adaptive Probe Volumes（APV）**の登場によって革命的な進化を遂げました。[^28] この技術は、煩雑な手動によるLight Probe Groups配置の時代に終止符を打ちます。APVは「ブリック（bricks）」と呼ばれる構造のもとに光データ収集ポイント（Light Probes）のネットワークを自動配置します。[^28] 各ブリックには4×4×4の行列（合計64個のプローブ）が含まれます。[^28] APVのインテリジェントアルゴリズムはジオメトリ密度を解析し、複雑で狭い場所ではブリックを細分化してライティング解像度を高め、何もない空間では大きく疎なブリックを用いてメモリを節約します。[^28] さらにAPVはボリュメトリックフォグ（Volumetric Fog）やパーティクルシステム（VFX Graph）ともシームレスに連携し、グラフィックス環境の一貫性を保ちます。[^28]

### **APVにおけるRendering Layersのサポートと制約**

間接光システムにも2つの空間の境界を尊重させるには、最初のステップで設定したLight LayersをAPVシステムと同期させる必要があります。APVは**Rendering Layer Masks**を完全に理解しサポートしていますが、最適化に関する厳しい制約に縛られています。メモリと参照速度を保護するため、APVはベイク済みデータブロック内で同時に最大**4つのRendering Layer Masks**までしか有効化できません。[^29]

Unityのグローバルな「ライトベイク（baking）」処理は非常に精巧に行われます。システムは各プローブから何百万本ものレイテスト（ray tests）を放って周囲の空間を探索し、遮蔽解析（occlusion analysis）を実行します。[^30] 光線が反射する際、事前にrendering layersタグが設定されたジオメトリ表面（例：空間1のLayer 1および空間2のLayer 2）に次々と衝突します。1つのプローブは定義された4つのマスクのうちただ1つのマスクしか保持できないため、Unityは多数決アルゴリズムを用いてマスクを割り当てます。すなわち、あるプローブのレイの過半数がLayer 1にヒットすれば、そのプローブはLayer 1に固定されます。[^30]

しかし、この自動化は境界領域において破綻を招きます。空間1と空間2の間に浮かぶ光収集ポイントはデータが混在してしまい、予測不能なクロスライティング汚染や、明暗が斑に浮き出る四角いアーティファクト（`probe flares/square artifacts`）を引き起こします。[^31]

### **`Probe Adjustment Volume`（PAV）によるライティングの隔離**

アルゴリズムの自由度を抑制し、制作者の意図通りにシステムを従わせるには、アーキテクトは**Probe Adjustment Volume（PAV）**と呼ばれる制御ツールを配置する必要があります。[^29]

PAVはローカルな制御ボリュームであり、APVデータがオブジェクトへ渡される前の最もプリミティブな段階でデータを書き換える権限を持ちます。このボリュームで最も重要な機能が**Override Rendering Layer Mask**（レンダリングレイヤーマスクのオーバーライド）です。[^30] 2つの環境を分離する実装手順は以下の通りです：

1. 空間1のすべてのメッシュ構造を緻密に覆うBox形状の`Probe Adjustment Volume`を設置します。
2. PAVのInspectorパネル内で**Override Rendering Layer Mask**機能を有効にします。[^32]
3. 空間1に属さないすべてのレイヤー（空間2のLayer 2を含む）を完全に除外し、**Layer 1のみ**を残します。[^29]

この工程が完了すると、隔離メカニズムが確立されます。ランタイム（runtime）においてキャラクターや動的オブジェクトが空間1の境界内を移動する際、それらのレンダラー（renderer）はAPVグリッドを参照します。PAVのオーバーライド設定のおかげで、そのオブジェクトはLayer 1タグを持つプローブからのみライティングデータを抽出・サンプリング（sample）するよう厳格に制限されます。[^29] 空間2から誤って跳ね返ってきたすべての光子データはバッファレベルでアクセスを拒否されます。こうして2つの空間における間接光の隔離は絶対的なものとなります。

さらに、2つのシーンの統合がテレポート（teleportation）や時間帯の変化（同一エリアにおける昼の空間1と夜の空間2など）のシナリオを目的とする場合、Unity 6はAPVと連携する**Lighting Scenarios**（ライティングシナリオ）機能を提供します。[^28] HDRP Assetでこの機能を有効にすると、各空間のベイクデータを別々のシナリオアセットへ保存できます。ランタイムでは`ProbeReferenceVolume` APIを用いてわずか数ミリ秒でシナリオを有効化・切り替え可能です。さらに**Scenario Blending**を有効にすれば、`BlendLightingScenario`などのC#メソッドによって空間1のGIデータを空間2へCPUのボトルネックを起こすことなくフレーム単位（frame by frame）で滑らかに補間でき、最も幻想的でプロフェッショナルなシーン遷移演出を実現します。[^33]

## **メモリ最適化と低レベルリソース管理**

Unityのようなエンジンに、2つの複雑な環境のために複数のライティング、シャドウ、大気システムを並行レンダリングさせると、GPUのVRAMメモリには極めて重い負荷がかかります。システムアーキテクトの技量は、単にすべてを動かすことだけでなく、最小のフレーム時間（frametimes）を維持し、光学的なアーティファクト（artifacts）を完全に排除する点にあります。

### **`Dynamic Rescale`によるアトラス容量の解放**

シャドウメモリ内の領域競合は、グラフィックスの完全性に対する最大の脅威です。前述の通り、HDRPはHDRP Assetで宣言された静的アトラスシステム（デフォルトサイズは通常4096×4096ピクセル）を通じて影を割り当てます。[^6] Spot Light（空間2の太陽代替用を含む）およびPoint Lightから生成される影の総量がこの面積を超過すると、オブジェクトの影が崩れたり消滅したりします。[^34]

予防策として有効なのが、HDRP Asset内で*Punctual Light Shadows*および*Area Light Shadows*の両方に対して**Dynamic Rescale**（動的リスケール）機能を有効にすることです。[^7] この機能が働くと、HDRPは光源が占める画面面積の割合を解析します。遠方に位置する光源や部分的に遮蔽された光源は、シャドウ解像度が指数関数的に強制縮小され、カメラに近い重要な影領域のためにアトラス内の空き領域を譲ります。[^7] ただし、静的キャッシュデータは物理的な紐付けを壊さずに伸縮できないため、Mixed Cached Shadowsの静的にキャッシュされたシャドウマップ（cached shadow maps）に対してはDynamic Rescaleアルゴリズムが無効化される点に特に注意が必要です。[^7]

### **`Max Shadows on Screen`と`Shadow Bias`の厳格な制御**

HDRP AssetのShadowsセクションにある**Max Shadows on Screen**パラメータは、ハードウェアが1フレーム内に計算できる影の数に対して絶対的な上限を設けます。[^6] 両空間の一部を同時に視野へ収めるカメラアングルになった場合、この上限を非常に素早く超過してしまい、エンジンがランダムに影を間引く結果となります。メモリバッファへ読み込まれるオブジェクト数を最小限に抑えるため、2つの空間の境界間に物理的な遮蔽ジオメトリと併せてオクルージョンカリング（occlusion culling）を用いることが必須です。[^22]

ライティングチャネルの分割や疑似的な光源再現を行うと、非線形な投影角度によってメッシュ表面を光が突き抜ける現象（`light leaking`）やシャドウアクネ（`shadow acne`）がより頻繁に発生します。各Lightコンポーネントの**Shadow Bias**システムを管理することが、映像品質を保つ要となります。[^34] *Near Plane*パラメータを微調整して影の投影開始点を押し出し、*Normal Bias*を高めて表面法線方向にシャドウサンプリング面をオフセットすることで誤った自己遮蔽（self-shadowing）を防ぎ、傾斜面には*Slope-Scale Depth Bias*を補正します。[^34] これらの微調整をPCF（Percentage-Closer Filtering）やPCSS（Percentage-Closer Soft Shadows）といった高品質なシャドウフィルタリング（Shadow filtering）と組み合わせることで、影の境界が滑らかに保たれ、2つの光源使用に起因するあらゆる欠点を覆い隠すことができます。[^34]

### **レイヤー分割された光源数に関するハードウェア制約**

HDRPとURPは、**Forward+**と**Deferred**という2つの主要なレンダリングパスを提供します。マルチレイヤーライティング（Light Layers）を構築する際は、採用しているアーキテクチャの制約を明確に把握しておく必要があります。

* プロジェクトが**Forward+**アーキテクチャで動作している場合、システムはデスクトップ環境において1カメラあたり最大256個のライトという膨大な数をサポートします。[^38] しかし、同時に単一オブジェクトへ影響を与えうる追加ライト数は**最大8個**にハードロックされています。[^38] Light Layer 1とLight Layer 2によるチャネル分離は、無関係なライトを的確に除外し、メッシュがこの8ライト上限に達するのを防ぎます。
* 無制限に近いライト数への最適化を目指して**Deferred**アーキテクチャで動作させる場合、重大な制約に注意が必要です。Deferred機構のカリングマスク（culling mask）は、同時に**最大4つのレイヤー**までしか識別をサポートしていません。[^40] 空間をさらに細分化しようとして4つを超える複雑なLight Layersを乱用すると、システムは修復不能なグラフィックス破綻（graphical artifacts）に陥ります。[^40] 初期ソリューションで2つの基本レイヤー（Layer 1とLayer 2）のみを用いた手法は、メモリ面での効率性と絶対的な安全性を証明しています。[^1]

## **ソリューションマトリクス総覧とシステム要約**

Unity 6 HDRPの各コアサブシステムを分解検証した結果、ユーザーのアプローチは不可欠な第一歩として正当性が証明されたものの、2つのシーンを1ファイルに統合した完全なレンダリング環境を構築するには、多層的な戦略システムの連携が必要です。以下に、分析したすべての高度な技術手法をまとめたマトリクス表を示します：

| HDRPサブシステム | 初期アプローチ（ユーザー案） | 完成に向けた中核的補完技術ソリューション |
| :--- | :--- | :--- |
| **直接光（Direct Lighting）** | Directional LightとMesh RendererにLight Layer 1（Scene 1）とLight Layer 2（Scene 2）を設定。 | **正確性を検証済み**。Deferredアーキテクチャの競合を避けるため、有効レイヤー数を最小限に維持すること。[^1] |
| **ディレクショナルシャドウ（Directional Shadows）** | *未対処*。エンジンの「1フレーム1 Directional Shadow」制限に直面するリスク。[^4] | **Custom Shadow Layers**で影を切り離す。[^1] 両空間で影が必要な場合は、ライト2を**Box-shaped Spot Light**（Range Attenuationをオフ）に置き換えるか[^8]、HDRP Assetで静的メッシュ向けに**Mixed Cached Shadows**技術を使用する。[^7] |
| **スカイボックス（Skybox & Visual Environment）** | *未対処*。共通の空が2つの空間の隔離を破壊する。 | 2つの**Local Volumes**（Box Collider付き）を配置。**Visual Environment**オーバーライドで2種類のSky Typeを割り当てる。Blend Distanceを調整して滑らかに補間する。[^11] |
| **大気フォグ（Volumetric Fog）** | *未対処*。Global Volumetric Fogが他エリアへ漏れ出す。 | **Local Volumetric Fog**コンポーネントへ置き換える。Blending ModeパラメータをAdditiveから**Overwrite**へ切り替え、ローカルフォグで背景大気を上書き消去する。[^18] 重複箇所のPriorityを微調整する。 |
| **ポストプロセス分離（Post-Processing）** | *未対処*。（個別オブジェクトに対するVolume Layer Maskの誤解）。[^22] | **Custom Pass Volume**を構築。シェーダーC# APIとlayer masksを使ってポスト処理を個別にレンダリングし重ねて合成（composite）することで、非効率なCamera Stacking手法を廃する。[^22] |
| **間接光（Global Illumination / APV）** | *未対処*。反射光（Bounced light）が2環境の境界を越えて漏れ出す。 | **Adaptive Probe Volumes（APV）**を用いて同期する。空間1領域を覆う**Probe Adjustment Volume（PAV）**を配置し、**Override Rendering Layer Mask**機能を使用してLayer 2タグ付きプローブからの光データ補間を拒否する。[^28] |

Unity 6 HDRPの物理シミュレーション型グラフィックスエコシステムは、光に対するあらゆる変更が反射・遮蔽・空間屈折といった物理的連鎖を引き起こす、複雑かつ厳格なマシンです。Light Layersを用いて光チャネルを分離したことはシステムへの深い理解を示す完璧な出発点ですが、その理論を完結した芸術空間へと昇華させるには、精緻なマイクロ設定のネットワークによる支えが欠かせません。Custom Shadow LayersとMixed Cached Shadowsを徹底適用し、Local Volume Frameworkの空間制御力を最大限に引き出し、Probe Adjustment Volumeによって間接光データの流れを厳格に統制することで、グラフィックスアーキテクトはこの巨大なレンダリングエンジンに単一空間内部で2つの多次元現実を並行稼働させ、視覚品質上の妥協を一切見せない仕上がりへと導くことができます。バッファ（buffers）階層のコア構造とGPU上の光子フローを完全に掌握したとき、ジオメトリの影漏れとスペクトル汚染のあらゆる境界は完全に封鎖されるのです。

## **参考文献**

[^1]: Use light rendering layers | High Definition RP | 16.0.6 - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Rendering-Layers.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Rendering-Layers.html)  
[^2]: Light Layers | High Definition RP | 14.0.12 - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Light-Layers.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Light-Layers.html)  
[^3]: Rendering Layers | High Definition RP | 15.0.7 - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Rendering-Layers.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Rendering-Layers.html)  
[^4]: Is it possible to achieve shadows from two directional lights in URP? : r/Unity3D - Reddit, 2026年5月11日アクセス, [https://www.reddit.com/r/Unity3D/comments/1bndl5x/is\_it\_possible\_to\_achieve\_shadows\_from\_two/](https://www.reddit.com/r/Unity3D/comments/1bndl5x/is_it_possible_to_achieve_shadows_from_two/)  
[^5]: 2 or more directional lights simultaneously - Unity Discussions, 2026年5月11日アクセス, [https://discussions.unity.com/t/2-or-more-directional-lights-simultaneously/878090](https://discussions.unity.com/t/2-or-more-directional-lights-simultaneously/878090)  
[^6]: Shadows in the High Definition Render Pipeline - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@8.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@8.0/manual/Shadows-in-HDRP.html)  
[^7]: Shadows in the High Definition Render Pipeline | High Definition RP ..., 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Shadows-in-HDRP.html)  
[^8]: Multiple directional light shadow maps - Unity Discussions, 2026年5月11日アクセス, [https://discussions.unity.com/t/multiple-directional-light-shadow-maps/821372](https://discussions.unity.com/t/multiple-directional-light-shadow-maps/821372)  
[^9]: Mixed cached shadows for directional light broken when shadow cascade count is greater than 1 - Unity Discussions, 2026年5月11日アクセス, [https://discussions.unity.com/t/mixed-cached-shadows-for-directional-light-broken-when-shadow-cascade-count-is-greater-than-1/919216](https://discussions.unity.com/t/mixed-cached-shadows-for-directional-light-broken-when-shadow-cascade-count-is-greater-than-1/919216)  
[^10]: Shadows in the High Definition Render Pipeline - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.0/manual/Shadows-in-HDRP.html)  
[^11]: Volumes | High Definition RP | 10.2.2 - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.2/manual/Volumes.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.2/manual/Volumes.html)  
[^12]: HDRP Global Settings Window | High Definition RP | 15.0.7 - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Default-Settings-Window.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Default-Settings-Window.html)  
[^13]: Local Volumetric Fog | High Definition RP | 14.1.0, 2026年5月11日アクセス, [https://docs.unity.cn/cn/Packages-cn/com.unity.render-pipelines.high-definition@14.1/manual/Local-Volumetric-Fog.html](https://docs.unity.cn/cn/Packages-cn/com.unity.render-pipelines.high-definition@14.1/manual/Local-Volumetric-Fog.html)  
[^14]: Different Types of Post-Processing Volumes in Unity HDRP | by Liberty Depriest - Medium, 2026年5月11日アクセス, [https://medium.com/@youngchae.depriest/different-types-of-post-processing-volumes-in-unity-hdrp-4f36e3e6dbc5](https://medium.com/@youngchae.depriest/different-types-of-post-processing-volumes-in-unity-hdrp-4f36e3e6dbc5)  
[^15]: Visual Environment | High Definition RP | 16.0.6 - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Override-Visual-Environment.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Override-Visual-Environment.html)  
[^16]: Create environment lighting | High Definition RP | 16.0.6 - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Environment-Lighting.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Environment-Lighting.html)  
[^17]: Setting The Skybox In Unity HDRP - Vincent Taylor, 2026年5月11日アクセス, [https://vintay.medium.com/setting-the-skybox-in-unity-hdrp-ffc8f7e068ec](https://vintay.medium.com/setting-the-skybox-in-unity-hdrp-ffc8f7e068ec)  
[^18]: Local Volumetric Fog | High Definition RP | 14.0.12 - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Local-Volumetric-Fog.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Local-Volumetric-Fog.html)  
[^19]: Local Volumetric Fog Volume reference | High Definition Render Pipeline | 17.0.4, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/local-volumetric-fog-volume-reference.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/local-volumetric-fog-volume-reference.html)  
[^20]: Field volumeLayerMask | High Definition RP | 15.0.7 - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition%4015.0/api/UnityEngine.Rendering.HighDefinition.HDAdditionalCameraData.volumeLayerMask.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition%4015.0/api/UnityEngine.Rendering.HighDefinition.HDAdditionalCameraData.volumeLayerMask.html)  
[^21]: HDRP Camera | High Definition RP | 14.0.12 - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/HDRP-Camera.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/HDRP-Camera.html)  
[^22]: Unity/URP global volume with volume mask still applies effects to all layers, 2026年5月11日アクセス, [https://gamedev.stackexchange.com/questions/210918/unity-urp-global-volume-with-volume-mask-still-applies-effects-to-all-layers](https://gamedev.stackexchange.com/questions/210918/unity-urp-global-volume-with-volume-mask-still-applies-effects-to-all-layers)  
[^23]: Apply different post processing effects to separate cameras in URP - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/cameras/apply-different-post-proc-to-cameras.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/cameras/apply-different-post-proc-to-cameras.html)  
[^24]: HDRP - Volume Layer Mask - Unity Discussions, 2026年5月11日アクセス, [https://discussions.unity.com/t/hdrp-volume-layer-mask/754924](https://discussions.unity.com/t/hdrp-volume-layer-mask/754924)  
[^25]: [HDRP] Easiest way to force an object to render over everything else? : r/Unity3D - Reddit, 2026年5月11日アクセス, [https://www.reddit.com/r/Unity3D/comments/178uzdg/hdrp\_easiest\_way\_to\_force\_an\_object\_to\_render/](https://www.reddit.com/r/Unity3D/comments/178uzdg/hdrp_easiest_way_to_force_an_object_to_render/)  
[^26]: Struggling to render hands in separate layer (HDRP) any clean setup that actually works? : r/Unity3D - Reddit, 2026年5月11日アクセス, [https://www.reddit.com/r/Unity3D/comments/1lhpqhv/struggling\_to\_render\_hands\_in\_separate\_layer\_hdrp/](https://www.reddit.com/r/Unity3D/comments/1lhpqhv/struggling_to_render_hands_in_separate_layer_hdrp/)  
[^27]: Understand custom pass volumes | High Definition Render Pipeline | 17.0.4, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Custom-Pass-Volume-Workflow.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Custom-Pass-Volume-Workflow.html)  
[^28]: Unity 6's New Global Illumination Lighting Features, 2026年5月11日アクセス, [https://unity.com/blog/engine-platform/new-ways-of-applying-global-illumination-in-unity-6](https://unity.com/blog/engine-platform/new-ways-of-applying-global-illumination-in-unity-6)  
[^29]: Fix issues with Adaptive Probe Volumes | High Definition Render Pipeline | 17.0.4, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/probevolumes-fixissues.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/probevolumes-fixissues.html)  
[^30]: Override rendering layer masks in a volume - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/features/rendering-layer-masks-apv-override-probe-in-a-volume.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/features/rendering-layer-masks-apv-override-probe-in-a-volume.html)  
[^31]: How to use Adaptive Probe Volume Rendering Layer Mask - Unity Discussions, 2026年5月11日アクセス, [https://discussions.unity.com/t/how-to-use-adaptive-probe-volume-rendering-layer-mask/1650216](https://discussions.unity.com/t/how-to-use-adaptive-probe-volume-rendering-layer-mask/1650216)  
[^32]: Override Rendering Layer Mask in Probe Adjustment Volume - Unity Discussions, 2026年5月11日アクセス, [https://discussions.unity.com/t/override-rendering-layer-mask-in-probe-adjustment-volume/1645954](https://discussions.unity.com/t/override-rendering-layer-mask-in-probe-adjustment-volume/1645954)  
[^33]: Bake different lighting setups with Lighting Scenarios | High Definition RP - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/probevolumes-bakedifferentlightingsetups.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/probevolumes-bakedifferentlightingsetups.html)  
[^34]: Shadows in the High Definition Render Pipeline | High Definition RP | 12.0.0 - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@12.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@12.0/manual/Shadows-in-HDRP.html)  
[^35]: Control shadow resolution and quality | High Definition Render Pipeline - Unity - Manual, 2026年5月11日アクセス, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Shadows-in-HDRP.html)  
[^36]: Using Unity Layers to Control Lighting on Certain Objects (Layer and Occlusion Solution), 2026年5月11日アクセス, [https://www.youtube.com/watch?v=1cjKPU\_3A4A](https://www.youtube.com/watch?v=1cjKPU_3A4A)  
[^37]: Prototype\_Final/Library/PackageCache/com.unity.render-pipelines.high-definition@10.8.1/Documentation\~/Shadows-in-HDRP.md · main · PENGXI WANG / EAE6330\_Final · GitLab, 2026年5月11日アクセス, [https://gapp-git.eng.utah.edu/u1066693/eae6330\_final/-/blob/main/Prototype\_Final/Library/PackageCache/com.unity.render-pipelines.high-definition@10.8.1/Documentation\~/Shadows-in-HDRP.md](https://gapp-git.eng.utah.edu/u1066693/eae6330_final/-/blob/main/Prototype_Final/Library/PackageCache/com.unity.render-pipelines.high-definition@10.8.1/Documentation~/Shadows-in-HDRP.md)  
[^38]: Is there a maximum number of light you can create in a Project? - Unity Engine, 2026年5月11日アクセス, [https://discussions.unity.com/t/is-there-a-maximum-number-of-light-you-can-create-in-a-project/910450](https://discussions.unity.com/t/is-there-a-maximum-number-of-light-you-can-create-in-a-project/910450)  
[^39]: Limit of number of Lights in view : r/Unity3D - Reddit, 2026年5月11日アクセス, [https://www.reddit.com/r/Unity3D/comments/sh188j/limit\_of\_number\_of\_lights\_in\_view/](https://www.reddit.com/r/Unity3D/comments/sh188j/limit_of_number_of_lights_in_view/)  
[^40]: Too many layers used to exclude objects from lighting. in deferred only up to 4 layers can be used simultaneously - Unity Discussions, 2026年5月11日アクセス, [https://discussions.unity.com/t/too-many-layers-used-to-exclude-objects-from-lighting-in-deferred-only-up-to-4-layers-can-be-used-simultaneously/1518892](https://discussions.unity.com/t/too-many-layers-used-to-exclude-objects-from-lighting-in-deferred-only-up-to-4-layers-can-be-used-simultaneously/1518892)
