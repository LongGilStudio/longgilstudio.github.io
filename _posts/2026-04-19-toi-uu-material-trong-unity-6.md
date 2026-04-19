---
title: "Kiến trúc Render trong Unity 6: Từ bỏ MPB để tối ưu Material chuyên sâu"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: Phân tích toàn diện về sự chuyển dịch kiến trúc từ MaterialPropertyBlock sang RSUV và GPU Resident Drawer để đạt hiệu suất AAA trong Unity 6.
math: true
---

## **Tóm tắt Điều hành (Executive Summary)**

Sự chuyển đổi sang Unity 6 đánh dấu một sự thay đổi kiến trúc cơ bản trong cách các luồng render (render pipelines) xử lý hình học dạng bản sao (instanced geometry) với khối lượng lớn. Trong lịch sử phát triển game, việc tối ưu hóa nhiều đối tượng chia sẻ chung một material nhưng yêu cầu các biến thể thuộc tính riêng biệt (chẳng hạn như đổi màu sắc \- color tints) thường phụ thuộc vào giao diện lập trình ứng dụng (API) MaterialPropertyBlock (MPB) kết hợp với hệ thống GPU Instancing tiêu chuẩn. Tuy nhiên, một phân tích chuyên sâu về Universal Render Pipeline (URP) và High Definition Render Pipeline (HDRP) trong Unity 6 tiết lộ rằng phương pháp tiếp cận kế thừa (legacy) này không còn là con đường tối ưu và trong nhiều trường hợp, nó gây ra sự suy giảm hiệu năng nghiêm trọng.

Đánh giá bản thảo tài liệu do người dùng cung cấp cho "Long Gil Studio DevLog" cho thấy một sự pha trộn giữa lý thuyết tối ưu hóa kế thừa có tính chính xác ở các phiên bản cũ và sự hiểu lầm nghiêm trọng về các tính năng render hiện đại của Unity 6\. Cụ thể, việc bản thảo khuyến nghị sử dụng MaterialPropertyBlock mâu thuẫn trực tiếp với công nghệ GPU Resident Drawer (GRD) mới của Unity 6 và API BatchRendererGroup (BRG) cốt lõi bên dưới.1 Để đạt được hiệu suất render tối đa, các nhà phát triển bắt buộc phải áp dụng Renderer Shader User Value (RSUV) hoặc chuyển đổi hoàn toàn sang Data-Oriented Technology Stack (DOTS).3

Báo cáo nghiên cứu này cung cấp một phân tích kỹ thuật thấu đáo về các điểm nghẽn render, cơ chế hoạt động của Scriptable Render Pipeline (SRP) Batcher, hệ quả hệ thống của việc nhân bản material, và các mô hình hiện đại cần thiết để đạt được hiệu suất render cấp độ AAA trong Unity 6\. Hơn nữa, báo cáo cung cấp một bài viết kỹ thuật đã được sửa chữa, tổng hợp chuyên nghiệp để xuất bản trên Long Gil Studio DevLog.

## **Phần I: Đánh giá Kỹ thuật Bản thảo Gốc của Long Gil Studio**

Văn bản dự thảo ban đầu trình bày một vấn đề render rất cụ thể: tối ưu hóa một Scene chứa vô số các đối tượng giống hệt nhau, chia sẻ một material duy nhất nhưng yêu cầu các sửa đổi màu sắc riêng biệt. Bản thảo đã xác định chính xác các mẫu thiết kế sai lầm (anti-patterns) nhưng lại chỉ định một giải pháp làm suy giảm hiệu suất trong bối cảnh kiến trúc của Unity 6\.

### **Những Điểm Chính Xác của Bản thảo Gốc**

1. **Hình phạt của việc Nhân bản Material (Material Duplication):** Bản thảo nêu chính xác rằng việc tạo các phiên bản material riêng biệt cho mỗi đối tượng (ví dụ: thông qua `GetComponent<Renderer>().material.color`) dẫn đến phình bộ nhớ (memory bloat) và phá hủy hoàn toàn việc gộp lệnh vẽ (draw call batching).5 Việc truy cập vào thuộc tính `.material` buộc engine Unity phải âm thầm sao chép bản thể (clone) của material đó, làm mất vĩnh viễn khả năng của hệ thống SRP Batcher hoặc GPU Instancing trong việc nhóm các đối tượng này vào một lệnh SetPass duy nhất.5  
2. **Cơ chế của MaterialPropertyBlock (MPB):** Bản thảo xác định đúng rằng MPB hoạt động như một bộ đệm ghi đè dữ liệu (data override buffer), cho phép renderer truyền các thuộc tính theo từng phiên bản (per-instance) đến GPU mà không tạo ra một bản sao material mới.7  
3. **Thuộc tính Chuỗi (String) so với Định danh Số nguyên (Integer IDs):** Bản thảo nêu bật một cách thích đáng về độ trễ của Đơn vị Xử lý Trung tâm (CPU) phát sinh do sử dụng chuỗi để tra cứu thuộc tính shader, ủng hộ việc khởi tạo các định danh số nguyên thông qua lệnh Shader.PropertyToID() để tối ưu hóa vòng lặp.7

### **Các Sai lệch Nghiêm trọng và Mô hình Lỗi thời**

1. **MPB như một "Tiêu chuẩn AAA" trong Unity 6:** Lỗ hổng đáng kể nhất trong bản thảo gốc là khẳng định MPB đại diện cho giải pháp "AAA" tối ưu cho Unity 6\. Mặc dù MPB là tiêu chuẩn trong Built-In Render Pipeline (kiến trúc cũ), nó lại hoạt động như một tác nhân phá hoại trong các kiến trúc SRP hiện đại.8 Việc áp dụng MPB cho một GameObject ngay lập tức loại bỏ đối tượng đó khỏi luồng SRP Batcher.10  
2. **Sự Phụ thuộc vào GPU Instancing Kế thừa:** Bản thảo thừa nhận rằng MPB phá vỡ SRP Batcher và đề xuất dựa vào GPU Instancing truyền thống như một giải pháp dự phòng. Mặc dù về mặt kỹ thuật, việc này có thể thực hiện được bằng cách phá vỡ tính tương thích SRP theo cách thủ công và bật Instancing, nhưng điều này buộc engine phải bỏ qua kiến trúc SRP đã được tối ưu hóa cao độ.12  
3. **Sự Bỏ qua GPU Resident Drawer (GRD):** Unity 6 giới thiệu GPU Resident Drawer, một hệ thống chuyển giao việc tạo lệnh draw call sang các compute shaders, giảm chi phí xử lý CPU lên đến 50%.14 Sự hiện diện của một MaterialPropertyBlock nghiêm cấm một GameObject tham gia vào GRD.1 Khuyến nghị MPB trong Unity 6 về cơ bản ngăn cản các dự án sử dụng tính năng tối ưu hóa mạnh mẽ nhất mới của engine.  
4. **Thiếu sót về Renderer Shader User Value (RSUV):** Được giới thiệu trong Unity 6.3 LTS, RSUV là sự thay thế kiến trúc trực tiếp cho MPB khi xử lý các biến thể đơn giản trên từng object.15 RSUV cho phép truyền một số nguyên 24-bit vào shader cho mỗi renderer mà không phá vỡ SRP Batcher hoặc GPU Resident Drawer.3

## **Phần II: Phân tích Cơ sở về Nghẽn cổ chai (Bottlenecks) trong Rendering**

Để hiểu tại sao các lệnh gọi API cụ thể lại phá hủy tốc độ khung hình (frame rate), cần phải kiểm tra mô hình giao tiếp giữa Đơn vị Xử lý Trung tâm (CPU) và Đơn vị Xử lý Đồ họa (GPU). Kiến trúc phần cứng hiện đại đòi hỏi một sự đồng bộ chặt chẽ nhưng có độ trễ giữa hai vi xử lý này.

### **Chi phí Giao tiếp CPU-GPU (Overhead)**

Quá trình render một khung hình yêu cầu CPU lặp qua tất cả các đối tượng hiển thị trong tầm nhìn của Camera (frustum culling), xác định các thuộc tính material của chúng, liên kết (bind) các kết cấu (textures) và shader cần thiết vào bộ nhớ của GPU, và phát hành một lệnh vẽ (draw command). Thao tác tốn kém nhất trong đường ống này không phải là việc GPU vẽ các đa giác (polygons), mà là các thay đổi trạng thái bắt buộc trước lệnh gọi vẽ — thường được gọi là các lệnh SetPass.5

Bất cứ khi nào CPU gặp một material mới, nó phải tạm dừng đường ống render để tải các tham số mới lên GPU.18 Nếu một Scene chứa 10.000 kẻ thù, và mỗi kẻ thù sở hữu một phiên bản material duy nhất để tạo điều kiện cho một màu áo giáp khác nhau, CPU phải thực hiện 10.000 lần thay đổi trạng thái. Điều này tạo ra chi phí CPU khổng lồ (CPU Overhead), dẫn đến tình trạng thắt cổ chai nơi GPU ngồi nhàn rỗi chờ đợi hướng dẫn từ CPU.

### **Sự Phân mảnh Bộ nhớ của Thuộc tính .material**

Khi một tập lệnh (script) truy cập vào Renderer.material để thay đổi màu sắc, engine buộc phải bảo vệ tính toàn vẹn của tài sản (asset) được chia sẻ ban đầu. Nó thực thi một lệnh Instantiate() nội bộ trên material đó. Điều này mang lại hai hình phạt nghiêm trọng đối với hiệu năng:

1. **Phá hủy Batching:** Đối tượng không còn chia sẻ tham chiếu material với các đối tượng đồng loại của nó nữa. Ngay lập tức, Unity sẽ dừng bất kỳ hình thức Static Batching, Dynamic Batching hoặc SRP Batching nào đối với object này.5 Card đồ họa sẽ phải xử lý nó như một thực thể hoàn toàn độc lập.  
2. **Thu gom Rác (Garbage Collection) và Rò rỉ Bộ nhớ (Memory Leaks):** Bản sao material mới được tạo ra trên vùng nhớ Heap quản lý bởi C\#. Nó không tự động bị thu gom rác khi đối tượng bị phá hủy. Trừ khi nhà phát triển gọi lệnh Destroy(renderer.material) một cách rõ ràng, bộ nhớ vẫn được phân bổ. Điều này tạo ra sự rò rỉ bộ nhớ dẫn đến việc bộ thu gom rác (Garbage Collector \- GC) phải kích hoạt quá trình Mark-and-Sweep, gây ra các đợt giật lag (spikes) nghiêm trọng làm tụt FPS đột ngột.5

## **Phần III: Kiến trúc của SRP Batcher và Sự lỗi thời của GPU Instancing Truyền thống**

Scriptable Render Pipeline (SRP) đã tổ chức lại cơ bản cách Unity quản lý dữ liệu shader. Hiểu được SRP Batcher là điều quan trọng để đánh giá tại sao các phương pháp tối ưu hóa cũ lại thất bại hoàn toàn trong Unity 6\.

### **Cơ chế Hoạt động của SRP Batcher**

Trong các pipeline cũ (Built-in), các material tải dữ liệu lên GPU thông qua các biến đồng nhất riêng biệt (separate uniform variables). SRP Batcher thay thế phương pháp này bằng cách sử dụng các bộ đệm GPU lớn, liên tục được gọi là Bộ đệm Hằng số (Constant Buffers \- CBUFFERs).11

Kiến trúc SRP bắt buộc các shader phải tách các biến của chúng thành hai khối bộ đệm riêng biệt 11:

* UnityPerMaterial: Một CBUFFER chứa các thuộc tính được chia sẻ bởi tất cả các đối tượng sử dụng chung material (ví dụ: màu cơ bản, bản đồ kim loại \- metallic maps, độ nhám).  
* UnityPerDraw: Một CBUFFER chứa các thuộc tính duy nhất cho lệnh gọi vẽ cụ thể (ví dụ: ma trận biến đổi không gian của đối tượng \- transformation matrices).

Bởi vì bộ đệm UnityPerMaterial tồn tại liên tục trong bộ nhớ GPU, CPU không còn cần phải tải các thuộc tính material trong vòng lặp render nếu các đối tượng liên tiếp chia sẻ cùng một biến thể shader (shader variant).18 SRP Batcher chỉ cần liên kết (bind) bộ đệm liên tục này và cập nhật bộ đệm UnityPerDraw nhỏ hơn nhiều. Thiết kế này làm giảm đáng kể chi phí CPU, đôi khi tăng tốc độ render lên tới 1.2x đến 4x.21

### **Sự Mâu thuẫn Cốt lõi với MaterialPropertyBlock**

API MaterialPropertyBlock ban đầu được thiết kế để ghi đè các thuộc tính material ở cấp độ renderer. Tuy nhiên, bởi vì SRP Batcher dựa vào sự tách biệt nghiêm ngặt và tính liên tục của CBUFFER UnityPerMaterial, việc tiêm (inject) một MPB vi phạm trực tiếp bố cục bộ nhớ này.8

Khi một MPB được áp dụng, Unity không còn có thể đảm bảo rằng bộ đệm material liên tục được áp dụng đồng nhất cho đối tượng. Do đó, engine buộc phải loại bỏ đối tượng khỏi luồng pipeline của SRP Batcher một cách mạnh bạo.9 Tài liệu chính thức của Unity xác nhận rõ ràng rằng: "Lưu ý rằng tính năng này không tương thích với SRP Batcher. Việc sử dụng MPB trong URP hoặc HDRP có khả năng dẫn đến sụt giảm hiệu suất".8

### **Giải pháp Dự phòng Kế thừa: Graphics.DrawMeshInstanced**

Trong lịch sử, nếu một nhà phát triển cần các biến thể khổng lồ (ví dụ: một khu rừng gồm các cây có màu sắc khác nhau), họ chấp nhận việc mất đi SRP Batcher và quay trở lại với GPU Instancing.12 Điều này yêu cầu phá vỡ tính tương thích SRP của shader một cách thủ công bằng cách khai báo một thuộc tính bên ngoài bộ đệm UnityPerMaterial và bật "Enable GPU Instancing" trên material.13

Mặc dù GPU Instancing làm giảm các lệnh gọi vẽ bằng cách truyền mảng ma trận biến đổi và dữ liệu màu sắc, nó đi kèm với những hạn chế nghiêm trọng.12 Nó gặp khó khăn với hiện tượng overdraw nặng nề, yêu cầu các lưới (meshes) phải giống hệt nhau, và đặt gánh nặng lớn lên CPU để thu thập và tải lên các mảng instance (instance arrays) mỗi khung hình. Trong Unity 6, phương pháp này đã bị thay thế hoàn toàn bởi kiến trúc GPU Resident Drawer.23

## **Phần IV: Sự không tương thích của MaterialPropertyBlock (MPB) với Hệ sinh thái Unity 6**

Phân tích sâu hơn về MPB cho thấy nó không chỉ phá vỡ SRP Batcher mà còn gây ra những rủi ro cấu trúc đối với các công cụ gỡ lỗi (debugging tools) và hệ thống ánh sáng (lighting systems) trong Unity 6\.

### **Tác động đến Dữ liệu Lightmap và Global Illumination**

Một trong những hệ lụy ít được nhắc đến nhất của việc sử dụng MPB không đúng cách là việc xóa sổ dữ liệu Lightmap. Khi bạn tạo một new MaterialPropertyBlock() và gán nó qua Renderer.SetPropertyBlock(), khối thuộc tính bạn truyền vào sẽ ghi đè hoàn toàn trạng thái cục bộ của renderer.24

Nếu đối tượng của bạn đang sử dụng hệ thống Global Illumination (GI) nướng sẵn (baked), thông tin về tọa độ UV của Lightmap và các hệ số Light Probe được lưu trữ ngầm trong chính property block của renderer.24 Nếu bạn không gọi Renderer.GetPropertyBlock(block) trước khi thiết lập màu sắc, bạn sẽ vô tình xóa sạch thông tin chiếu sáng của đối tượng. Mặc dù bản thảo gốc của Long Gil Studio đã xử lý tốt phần GetPropertyBlock này, nhưng bản thân hành động gọi API này liên tục trên hàng ngàn đối tượng lại tạo ra một độ trễ CPU bổ sung không hề nhỏ.

| Kỹ thuật Tối ưu                | Gây rò rỉ RAM | Tương thích SRP Batcher | Tương thích GRD | Tương thích DOTS | Khuyến nghị sử dụng   |
| :----------------------------- | :------------ | :---------------------- | :-------------- | :--------------- | :-------------------- |
| **Material.color**             | Có            | Không                   | Không           | Không            | Tránh tuyệt đối       |
| **MaterialPropertyBlock**      | Không         | Không                   | Không           | Không            | Cho dự án Built-in cũ |
| **GPU Instancing**             | Không         | Không (Xung đột)        | Không           | Không            | Unity 2020-2022       |
| **Renderer Shader User Value** | Không         | Có                      | Có              | Có               | Unity 6.3+ chuẩn mực  |

Như bảng trên chỉ ra, MPB hiện là một kỹ thuật thuộc thế hệ cũ. Nó giải quyết được bài toán RAM nhưng lại phá hỏng toàn bộ đường ống render hiện đại của Unity 6\.

## **Phần V: Bước ngoặt Kiến trúc: GPU Resident Drawer (GRD) và BatchRendererGroup (BRG)**

Unity 6 giới thiệu một con đường render mang tính cách mạng: GPU Resident Drawer. Hệ thống này chuyển đổi mô hình từ việc CPU điều khiển việc tạo lệnh vẽ sang một vòng lặp render tự chủ cao độ do GPU điều khiển.1

### **Kiến trúc của GPU Resident Drawer**

GPU Resident Drawer hoạt động dựa trên API cấp thấp BatchRendererGroup (BRG).1 Thay vì CPU đánh giá xem đối tượng nào có thể nhìn thấy được (frustum culling) và gửi các lệnh draw đơn lẻ hoặc instanced, CPU tải toàn bộ dữ liệu không gian và vật liệu của scene lên GPU.25 Các compute shaders sau đó thực hiện việc loại bỏ các đối tượng ngoài camera, loại bỏ các đối tượng bị che khuất (occlusion culling) và tạo lệnh vẽ hoàn toàn trên GPU.14

Mức tăng hiệu suất là đáng kinh ngạc. Bằng cách sử dụng render gián tiếp (DrawInstancedIndirect), khối lượng công việc CPU yêu cầu cho việc render có thể giảm tới 50% trong các cảnh phức tạp.14 Hơn nữa, khi kết hợp với GPU Occlusion Culling, quá trình xử lý tam giác (triangle processing) có thể giảm gần 90%, đồng thời thời gian khung hình (frame buffer time) của GPU giảm hơn một nửa.28

### **API BatchRendererGroup (BRG) và Culling**

Đằng sau GRD là BatchRendererGroup. BRG yêu cầu người dùng khởi tạo với một hàm callback OnPerformCulling.30 Tại đây, CPU chỉ cần định cấu hình tầm nhìn (visibility) và xuất ra các lệnh gọi vẽ dạng mảng. Dữ liệu của đối tượng (transform, màu sắc, cờ hiệu) được tải lên GraphicsBuffer.25 Điều này cho phép hàng triệu tam giác được gửi xuống GPU chỉ với vài lệnh SetPass.

### **Sự Không Tương Thích Chí Mạng của MPB với GRD**

Thông tin quan trọng nhất liên quan đến tối ưu hóa trong Unity 6 là tính mỏng manh của các yêu cầu tính hợp lệ đối với GPU Resident Drawer. Để một đối tượng được xử lý bởi GRD, nó phải tuân thủ các quy tắc bố cục dữ liệu nghiêm ngặt.2

Tài liệu chính thức của Unity 6.1+ tuyên bố rõ ràng rằng các GameObjects sử dụng API MaterialPropertyBlock ngay lập tức bị loại khỏi GPU Resident Drawer.1 Ngoài ra, đối tượng không được có các script sử dụng callback per-instance như OnRenderObject.2

Khi một nhà phát triển gắn một MPB để thay đổi màu sắc của đối tượng, họ đang vô tình buộc engine phải hoàn tác về chế độ render dựa trên CPU kế thừa cho đối tượng cụ thể đó. Nếu điều này được thực hiện trên 10.000 đơn vị lính trong một trò chơi chiến thuật thời gian thực, mức chi phí (overhead) của CPU sẽ tăng đột biến một cách chóng mặt, phủ nhận hoàn toàn lợi ích của việc nâng cấp engine Unity 6\.

## **Phần VI: Tiêu chuẩn Hiện đại: Renderer Shader User Value (RSUV) trong Unity 6.3**

Nhận ra sự bế tắc kiến trúc được tạo ra bởi sự không tương thích của MPB với các pipeline hiện đại, Unity đã giới thiệu tính năng Renderer Shader User Value (RSUV) trong phiên bản Unity 6.3 LTS.15 RSUV đóng vai trò là sự thay thế dứt khoát cho MaterialPropertyBlock khi các nhà phát triển cần áp dụng các tùy chỉnh per-instance đơn giản trên nhiều renderer chia sẻ một material duy nhất.3

### **Cơ chế Hoạt động của RSUV**

RSUV bỏ qua các sửa đổi bộ đệm phức tạp vốn là nhược điểm của MPB. Thay vào đó, nó tận dụng một kênh số nguyên 24-bit cực kỳ hiệu quả được truyền trực tiếp cùng với dữ liệu vẽ tiêu chuẩn của renderer.3 Bởi vì số nguyên này được tích hợp vào cấu trúc dữ liệu hiện có thay vì yêu cầu ghi đè một bộ đệm (buffer override) riêng biệt, nó duy trì khả năng tương thích tuyệt đối với cả SRP Batcher và GPU Resident Drawer.3

### **Triển khai và Mã hóa Bitwise (Bitwise Encoding)**

Để sử dụng RSUV cho sự biến đổi màu sắc, CPU phải mã hóa các giá trị RGB mong muốn vào một số nguyên không dấu 24-bit duy nhất (uint). Mỗi kênh màu (Đỏ \- Red, Xanh lá \- Green, Xanh dương \- Blue) chiếm 8 bit (cung cấp các giá trị từ 0 đến 255).3

Phép toán mã hóa sử dụng các toán tử dịch trái bitwise (`<<`) và toán tử OR bitwise (`|`). Phương trình toán học biểu diễn như sau:

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

Trong thực tế triển khai C\#, việc lặp qua một mảng các thành phần MeshRenderers để áp dụng màu tint ngẫu nhiên mang lại hiệu suất rất cao và không cấp phát bất kỳ bộ nhớ rác (zero garbage allocation) nào 3:

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // Tính toán một màu sắc ngẫu nhiên (sử dụng hệ màu HSV để màu tươi hơn)  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // Mã hóa RGB vào số nguyên 24-bit (Blue, Green, Red)  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // Áp dụng giá trị trực tiếp cho renderer thông qua API mới của Unity 6.3  
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **Giải mã tại Shader (Shader Decoding)**

Về phía GPU, shader phải giải nén (unpack) số nguyên 24-bit này trở lại thành một giá trị màu float4 đã được chuẩn hóa. Unity cung cấp biến nội bộ `unity_RendererUserValue` để truy cập khối dữ liệu này.3

Quá trình giải mã sử dụng toán tử dịch phải bitwise (`>>`) và toán tử AND bitwise (`&`) với một bitmask là `255` để cô lập mỗi phân đoạn 8-bit. Sau đó, nó được nhân với nghịch đảo của 255 (`1.0 / 255.0`) để chuẩn hóa giá trị về phạm vi giữa `0.0` và `1.0`.3

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

Bằng ngôn ngữ High-Level Shader Language (HLSL) hoặc thông qua một node Custom Function trong Shader Graph, logic giải nén được thể hiện như sau 3:

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // Kênh Đỏ (Red)  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // Kênh Xanh lá (Green)  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // Kênh Xanh dương (Blue)  
    1.0 // Alpha cố định  
);
```

Sự thay đổi mô hình này chứng minh một chiến lược tối ưu hóa sâu sắc: đánh đổi độ phức tạp của cấu trúc dữ liệu (như MPB) để lấy tính toán toán học (RSUV). Các bộ xử lý GPU cực kỳ xuất sắc trong các hoạt động bitwise, có nghĩa là chi phí giải mã gần như vô hình (với chi phí chu kỳ đồng hồ \- clock cycles siêu nhỏ). Trong khi đó, việc bảo tồn các luồng SRP Batcher và GPU Resident Drawer mang lại sự giảm thiểu thời gian khung hình (frame-time) khổng lồ.16

## **Phần VII: Giải pháp Quy mô Cực đại: DOTS, ECS và URPMaterialPropertyOverride**

Đối với các dự án hoạt động ở một quy mô vượt quá khả năng xử lý của GameObjects tiêu chuẩn (ví dụ: mô phỏng đám đông với hàng trăm ngàn đơn vị động lập biệt \- boids, RTS quân đội khổng lồ), công nghệ Data-Oriented Technology Stack (DOTS) của Unity cung cấp kiến trúc render tối thượng.4

### **Quản trị Bộ nhớ Dữ liệu Định hướng (Data-Oriented Memory)**

Khác với những hạn chế của hệ thống hướng đối tượng (object-oriented) nơi các GameObjects nằm rải rác trong Heap, các thực thể (entities) trong Entity Component System (ECS) tồn tại hoàn toàn dưới dạng các mảng dữ liệu liền kề (contiguous arrays of data) trong bộ nhớ.4 Bố cục bộ nhớ này hoàn toàn phù hợp với cấu trúc mà API BatchRendererGroup (BRG) đòi hỏi để đạt hiệu suất cao nhất.

Trong gói Entities Graphics, các nhà phát triển có thể sử dụng thành phần URPMaterialPropertyOverride.4 Hệ thống này cho phép ghi đè các thuộc tính vật liệu trên từng thực thể (per-entity material overrides) mà hoàn toàn không sử dụng API MaterialPropertyBlock có hại.

### **Cơ chế Hoạt động của DOTS Instancing**

Khi một thực thể được xử lý trong DOTS, shader được cấu hình DOTS Instancing (bằng cách tích vào Override Property Declaration và chọn Hybrid Per Instance trong Shader Graph) nhận một số nguyên 32-bit duy nhất (một giá trị siêu dữ liệu \- metadata value).34 Số nguyên này đại diện cho một độ lệch (offset) nằm trong một GraphicsBuffer ổn định trên GPU.34

Shader sử dụng offset này để tải dữ liệu thuộc tính cụ thể cho phiên bản (instance) mà nó hiện đang render.34 Điều làm nên sự khác biệt của DOTS Instancing là: Nếu nhiều thực thể chia sẻ cùng một giá trị thuộc tính, DOTS Instancing cho phép chúng tải giá trị đó từ cùng một vị trí trong bộ nhớ (cùng một offset), tiết kiệm chu kỳ GPU (GPU cycles) và giảm thiểu sự trùng lặp bộ nhớ.34 Do thuộc tính được tải qua offset thay vì nằm gọn trong các buffer hằng số truyền thống, kích thước của một lệnh draw call không còn bị giới hạn khắt khe, cho phép số lượng instance cực lớn.

```csharp
// Ví dụ về việc gán giá trị RSUV thông qua hệ thống DOTS / Burst Compile 

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // Xử lý song song bằng cách gán giá trị trực tiếp vào Native Array  
        // Mang lại tốc độ thực thi mà MonoBehaviour không bao giờ có thể đạt tới.  
    }  
}
```

Việc thay đổi các giá trị component của thực thể thông qua các Bursted Background Jobs (các công việc nền được biên dịch bằng Burst Compiler) có thể được thực hiện với tốc độ kinh ngạc.4 Người chơi có thể có các hàng rào đổi màu theo góc nghiêng của địa hình, hoặc cỏ thay đổi màu sắc dựa trên độ cao, tất cả được vẽ trong một luồng draw call duy nhất mà không bị thắt cổ chai.4

## **Phần VIII: Phân tích các Giải pháp Thay thế (Alternative Solutions)**

Bản thảo gốc của Long Gil Studio đã đề cập ngắn gọn đến các kỹ thuật tối ưu hóa thay thế. Phân tích dưới đây xác nhận tính khả thi của chúng nhưng đặt trong bối cảnh những hạn chế vật lý của engine Unity 6\.

1. **Vertex Colors (Tô màu đỉnh Mesh):**  
   * *Cơ chế:* Mã hóa dữ liệu màu trực tiếp vào các đỉnh (vertices) của lưới 3D. Shader đọc thuộc tính TEXCOORD hoặc COLOR từ mesh.  
   * *Hiệu quả:* Cực kỳ nhẹ và bảo tồn hoàn hảo tất cả các chức năng batching cũng như khả năng tương thích GRD.36  
   * *Điểm yếu:* Thay đổi màu sắc vertex tại runtime (trong thời gian chạy thực) đòi hỏi phải thao tác trên mảng dữ liệu mesh (mesh.colors). Hành động này tạo ra bản sao của mesh trong RAM, gây ra hiện tượng CPU stalls và cấp phát bộ nhớ rác. Tô màu đỉnh vẫn chỉ là tối ưu nhất cho các biến thể tĩnh đã được "nướng" (baked) sẵn từ các phần mềm như Blender hay Maya.  
2. **Texture Atlasing và UV Offsets:**  
   * *Cơ chế:* Hợp nhất nhiều biến thể màu sắc vào một tập bản đồ kết cấu (texture atlas) duy nhất và dịch chuyển tọa độ UV của các đối tượng khác nhau để lấy mẫu các pixel cụ thể.36  
   * *Hiệu quả:* Kỹ thuật này giữ nguyên một material và một texture, đảm bảo khả năng tương thích tuyệt đối với SRP Batcher.36  
   * *Điểm yếu:* Tương tự như màu vertex, việc thay đổi tọa độ UV linh hoạt trên các đối tượng khác nhau tại thời gian chạy (runtime) thường yêu cầu tạo ra các phiên bản lưới (mesh instances) độc đáo, mang lại sự phình to bộ nhớ (memory bloat). Tuy nhiên, đối với thiết kế môi trường tĩnh hoặc game Voxel (như Minecraft), đây là kỹ thuật vô địch.  
3. **Low-Level Graphics.DrawMeshInstanced (GPU cấp thấp):**  
   * *Cơ chế:* Bỏ qua phân cấp GameObjects hoàn toàn để đẩy trực tiếp các ma trận tọa độ và mảng màu xuống GPU thông qua mã C\#.37  
   * *Hiệu quả:* Cung cấp hiệu suất to lớn cho các hệ thống như thuật toán bầy đàn (flocking) hoặc tán lá thủ tục (procedural foliage).38  
   * *Điểm yếu trong Unity 6:* Sự ra đời của API BatchRendererGroup và GPU Resident Drawer đã "dân chủ hóa" hiệu suất này, loại bỏ sự cần thiết phải viết mã culling (loại bỏ) và đệ trình draw phức tạp trong hầu hết các kịch bản phát triển thông thường.19 Việc duy trì hệ thống DrawMeshInstanced tùy chỉnh hiện tốn nhiều tài nguyên kỹ thuật hơn là để GPU Resident Drawer tự động hóa nó.

## **Phần IX: Cấu trúc Nội dung Đề xuất cho Long Gil Studio DevLog**

Dựa trên quá trình đánh giá kỹ thuật toàn diện, phần văn bản dưới đây là bài viết DevLog được đề xuất, được chỉnh sửa hoàn toàn và thể hiện sự chuyên nghiệp kỹ thuật cấp cao. Nó từ bỏ phương pháp MPB bị lỗi và hướng dẫn người đọc đến các tiêu chuẩn kiến trúc thực sự của Unity 6: RSUV và GPU Resident Drawer.

### ---

**Unity 6: Tối ưu Hàng ngàn Object Dùng chung Material – Từ bỏ MPB để tiến tới Kiến trúc Hiện đại**

**By Long Gil Studio**

**🇻🇳 PHIÊN BẢN TIẾNG VIỆT**

**1\. Điểm nghẽn Render: Vấn nạn nhân bản Material**

Trong quá trình phát triển các tựa game quy mô lớn, một bài toán kiến trúc cực kỳ phổ biến được đặt ra: "Làm thế nào để đổi màu hàng ngàn object dùng chung một material mà không làm sụt giảm FPS?"

Nhiều lập trình viên thường dùng lệnh `GetComponent<Renderer>().material.color`. Đây là một sai lầm chí mạng (anti-pattern). Việc gọi `.material` buộc Unity phải âm thầm tạo ra một bản sao (clone) của material đó trên RAM. Hậu quả là rò rỉ bộ nhớ nghiêm trọng, kích hoạt quá trình dọn rác (Garbage Collection) liên tục, và phá vỡ hoàn toàn hệ thống Batching. GPU bị bỏ đói, trong khi CPU quá tải xử lý hàng ngàn Draw Calls riêng biệt.

**2\. Cái bẫy Legacy: Tại sao MaterialPropertyBlock đã "chết" trong Unity 6**

Trước đây, giải pháp "chuẩn Pro" là dùng MaterialPropertyBlock (MPB) để truyền dữ liệu cho từng object mà không phải clone material. **Nhưng nếu bạn đang dùng Unity 6 (URP/HDRP), bạn phải dừng ngay phương pháp này.**

Unity 6 phụ thuộc rất lớn vào luồng **SRP Batcher** và công nghệ mang tính cách mạng: **GPU Resident Drawer (GRD)**. GRD đẩy toàn bộ luồng xử lý Render (tạo Draw Calls, Culling) xuống các Compute Shaders trên GPU, giúp giảm tới 50% thời gian tính toán của CPU. Tuy nhiên, theo tài liệu cốt lõi của engine, khi bạn gắn MaterialPropertyBlock vào một object, object đó ngay lập tức bị loại khỏi SRP Batcher và mất hoàn toàn khả năng tương thích với GPU Resident Drawer. Việc dùng MPB đồng nghĩa với việc bạn đang ép Unity quay về luồng render kế thừa, chậm chạp và tốn CPU cho toàn bộ quân lính của bạn.

**3\. Tiêu chuẩn mới của Unity 6: Renderer Shader User Value (RSUV)**

Để giải quyết triệt để sự bế tắc này, bản cập nhật Unity 6.3 LTS đã giới thiệu **Renderer Shader User Value (RSUV)**. API này cho phép bạn truyền trực tiếp một số nguyên 24-bit vào renderer. Vì RSUV không yêu cầu cấp phát bộ đệm (buffers) mới, nó giữ nguyên 100% khả năng tương thích với cả SRP Batcher và GPU Resident Drawer.

**Bước 1: Mã hóa C\# (Zero Garbage Allocation)**

Thay vì dùng chuỗi (string) như MPB, chúng ta sẽ mã hóa màu RGB thành một số nguyên 24-bit bằng các phép toán dịch bit (bitwise):

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Mã hóa 3 kênh Blue, Green, và Red vào một số nguyên 24-bit  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Áp dụng giá trị (An toàn tuyệt đối cho kiến trúc SRP và GRD!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Bước 2: Giải mã trên Shader Graph**

Bên trong Shader Graph, hãy tạo một node **Custom Function** (Type: String, Name: DecodeColor) với đầu ra là Vector4. Dán đoạn mã HLSL sau để giải nén số nguyên trở lại thành màu sắc chuẩn:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Nối đầu ra này vào chân Base Color của Fragment Shader. Giờ đây, bạn đã có vô hạn biến thể màu sắc với độ trễ CPU bằng 0 và tận dụng tối đa sức mạnh của hệ thống GPU Resident Drawer.

**4\. Vượt mốc 100.000 Objects: Giải pháp DOTS / ECS**

Nếu game của bạn yêu cầu render hàng trăm ngàn đơn vị độc lập (như các binh đoàn khổng lồ), hệ thống GameObjects truyền thống chắc chắn sẽ thắt cổ chai CPU dù bạn tối ưu render tốt đến đâu. Đối với quy mô này, hãy chuyển sang cấu trúc Unity DOTS. Sử dụng component URPMaterialPropertyOverride cho phép thiết lập bố cục bộ nhớ Data-Oriented, giao tiếp trực tiếp với hệ thống BatchRendererGroup API ở cấp độ thấp, mang lại hiệu năng vô đối chuẩn AAA thực thụ.

---

**🇺🇸 ENGLISH VERSION**

**1\. The Rendering Bottleneck: Material Duplication**

When developing high-density games, a common architectural challenge arises: "How do I change the color of thousands of objects sharing the same material without destroying performance?"

Developers often default to `GetComponent<Renderer>().material.color`. This is a fatal anti-pattern. Accessing `.material` forces Unity to silently clone the material on the managed heap. This generates severe memory bloat, triggers garbage collection spikes, and destroys draw call batching, driving CPU overhead to unmanageable levels while starving the GPU.

**2\. The Legacy Trap: Why MaterialPropertyBlock is Dead in Unity 6**

Historically, the "Pro" solution was to use a MaterialPropertyBlock (MPB) to pass per-instance data without cloning materials. **If you are using Unity 6 (URP/HDRP), you must stop using this method immediately.**

Unity 6 relies heavily on the **SRP Batcher** and the revolutionary new **GPU Resident Drawer (GRD)**. The GRD offloads frustum culling and draw call generation to GPU compute shaders, reducing CPU rendering time by up to 50%. However, according to core engine documentation, applying a MaterialPropertyBlock to an object immediately disqualifies it from the SRP Batcher and entirely breaks its compatibility with the GPU Resident Drawer. By using MPB, you are forcing Unity to revert to a slow, legacy CPU-bound rendering path for your massive armies.

**3\. The Unity 6 Standard: Renderer Shader User Value (RSUV)**

To solve this architectural deadlock, Unity 6.3 LTS introduces the **Renderer Shader User Value (RSUV)**. This API allows you to pass a 24-bit integer directly to the renderer's base data payload. Because it avoids modifying persistent constant buffers, RSUV maintains 100% compatibility with both the SRP Batcher and the GPU Resident Drawer.

**Step 1: The C\# Encoding (Zero Memory Allocation)**

Instead of passing strings and creating blocks, we mathematically pack an RGB color into a 24-bit unsigned integer using bitwise operations:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Encode Blue, Green, and Red channels into a single 24-bit integer  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Apply the value natively (100% SRP and GRD Safe!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Step 2: The Shader Decoding**

Inside your Shader Graph, create a **Custom Function** node (Type: String, Name: DecodeColor) with a Vector4 output. Paste this HLSL code to unpack the integer back into a normalized float color:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Connect this output to your Base Color fragment input. You now have infinite color variations with zero draw call penalties, while fully utilizing the GPU Resident Drawer.

**4\. Going Beyond 100,000 Objects: DOTS / ECS**

If your game requires rendering hundreds of thousands of dynamic units, standard GameObjects will eventually bottleneck the CPU's main thread regardless of graphics optimizations. For massive scale, transition to Unity DOTS. Using the URPMaterialPropertyOverride component allows for strict Data-Oriented memory layouts. This interfaces directly with the low-level BatchRendererGroup API, achieving unmatched, pure AAA-level rendering performance.

## ---

**Phần X: Các Khuyến nghị Chiến lược cho Nhóm Phát triển**

Việc phân tích các mô hình render hiện đại cho thấy một sự khác biệt quan trọng giữa kiến thức tối ưu hóa cũ (legacy) và kiến trúc engine đương đại. Điểm cốt lõi dành cho các kỹ sư đồ họa là: Việc sửa đổi các bộ đệm dữ liệu (data buffers) trên từng đối tượng vốn có bản chất thù địch với xử lý song song và các vòng lặp render do GPU điều khiển. Không thể sử dụng tư duy tối ưu Unity 5.x hoặc Unity 2019 cho Unity 6\.

Để đạt được hiệu suất tối đa trong Unity 6, các nhóm phát triển phải thực thi nghiêm ngặt các giao thức sau:

1. **Kiểm toán việc Sử dụng MPB (Audit for MPB Usage):** Các công cụ Profiling (ví dụ: Unity Profiler) và Frame Debuggers nên được triển khai liên tục để xác định và loại bỏ tận gốc các trường hợp MaterialPropertyBlock được áp dụng cho hình học được tạo bản sao hàng loạt (mass-instanced geometry). Sự tiện lợi ngắn hạn của MPB bị lấn át hoàn toàn bởi sự mất mát có hệ thống của tính năng GPU Resident Drawer. Các nhóm cần tạo các cảnh báo trong mã nguồn hoặc các tập lệnh CI/CD để phát hiện việc khởi tạo MPB không cần thiết.  
2. **Áp dụng Chiến lược Mã hóa Bitwise (Bitwise Encoding Strategies):** Việc áp dụng Renderer Shader User Value (RSUV) đòi hỏi sự thay đổi trong phương pháp luận lập trình. Các nghệ sĩ kỹ thuật (Technical Artists) và lập trình viên gameplay phải hợp tác để định nghĩa các sơ đồ đóng gói bitwise nghiêm ngặt cho giới hạn 24-bit của RSUV. Cần đảm bảo rằng các trạng thái dữ liệu đa dạng (màu sắc, sát thương, ID đội nhóm \- team ID) được tuần tự hóa (serialized) hiệu quả trước khi chạm đến renderer. Ví dụ: Có thể phân bổ 4 bit cho "ID phe phái" (cho phép 16 phe), 8 bit cho "Trạng thái Sát thương" (cho phép 256 mức độ), và 12 bit cho "Custom Tint" (màu tùy chỉnh) \- tất cả được giải mã đồng thời thông qua mặt nạ bit (bitmasks) trong shader.  
3. **Đánh giá Ngưỡng Chuyển đổi ECS (Evaluate Thresholds for ECS Transition):** Mặc dù RSUV giải quyết được điểm nghẽn về biến thể material cho GameObjects, các ranh giới giới hạn CPU liên quan đến tính toán vật lý, tính toán ma trận (transform calculations) và culling của GameObject vẫn tồn tại. Các dự án dự đoán số lượng thực thể hoạt động vượt quá 10.000 tác nhân động (dynamic agents) nên mạnh dạn và tích cực thiết kế các nguyên mẫu (prototypes) triển khai DOTS (Entity Component System). Việc sử dụng thành phần URPMaterialPropertyOverride 34 để giao tiếp nội tại với API BatchRendererGroup là con đường duy nhất để giải phóng hoàn toàn tiềm năng sức mạnh của phần cứng máy tính và máy chơi game console thế hệ mới.

#### **Nguồn trích dẫn**

1. Enable the GPU Resident Drawer in URP \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)  
2. Make a GameObject compatible with the GPU Resident Drawer in URP \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
3. Set and use the RSUV \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)  
4. Migrated my game to ECS/DOTS and material overrides are awesome\! : r/Unity3D \- Reddit, truy cập vào tháng 4 19, 2026, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)  
5. Why You Should Stop Swapping Materials in Unity (And What to Do Instead) \- Medium, truy cập vào tháng 4 19, 2026, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)  
6. Material Property Blocks \- using them to store the original color of a material upon instantiation : r/Unity3D \- Reddit, truy cập vào tháng 4 19, 2026, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)  
7. Instancing and Material Property Blocks | Ronja's tutorials, truy cập vào tháng 4 19, 2026, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)  
8. Scripting API: MaterialPropertyBlock \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)  
9. Unity 6 and custom material bug \- Spine Forum, truy cập vào tháng 4 19, 2026, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)  
10. Scriptable Render Pipeline (SRP) Batcher \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)  
11. Scriptable Render Pipeline Batcher \- Unity 6.3 User Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)  
12. GPU instancing \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)  
13. Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)  
14. Beginning Game Development: GPU Resident Drawer | by Lem Apperson \- Medium, truy cập vào tháng 4 19, 2026, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)  
15. Introduction to RSUV \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)  
16. Renderer Shader User Value sample \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)  
17. Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, truy cập vào tháng 4 19, 2026, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)  
18. Scriptable Render Pipeline Batcher \- Unity User Manual 2021.3 (LTS), truy cập vào tháng 4 19, 2026, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)  
19. Unity Draw Call Batching: The Ultimate Guide (2026 Update), truy cập vào tháng 4 19, 2026, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)  
20. Scriptable Render Pipeline Batcher \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)  
21. SRP Batcher: Speed up your rendering \- Unity, truy cập vào tháng 4 19, 2026, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)  
22. Remove SRP Batcher compatibility for GameObjects in URP \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)  
23. GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D \- Reddit, truy cập vào tháng 4 19, 2026, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)  
24. Scripting API: Renderer.GetPropertyBlock \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)  
25. Create batches with the BatchRendererGroup API in URP \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)  
26. Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)  
27. Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, truy cập vào tháng 4 19, 2026, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)  
28. Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling \- YouTube, truy cập vào tháng 4 19, 2026, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)  
29. Graphics Features and Tools in Unity 6 Feel Like MAGIC\! STP, Resident Drawer, and Occlusion Culling\! \- YouTube, truy cập vào tháng 4 19, 2026, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)  
30. Initialize a BatchRendererGroup object in URP \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)  
31. Boost performance of your game in Unity 6 with GPU Resident Drawer \- The Knights of U, truy cập vào tháng 4 19, 2026, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)  
32. Make a GameObject compatible with the GPU Resident Drawer in URP \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
33. Material overrides using the Material Override Asset | Entities Graphics \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)  
34. DOTS Instancing shaders in URP \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)  
35. Material overrides using the Material Override Asset | Entities Graphics \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)  
36. One Material multiple colors possible? : r/Unity3D \- Reddit, truy cập vào tháng 4 19, 2026, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)  
37. Single-pass instanced rendering and custom shaders \- Unity \- Manual, truy cập vào tháng 4 19, 2026, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)  
38. Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, truy cập vào tháng 4 19, 2026, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
