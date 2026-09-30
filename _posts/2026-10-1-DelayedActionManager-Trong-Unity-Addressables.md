---
layout: post
title: "Báo cáo Nghiên cứu Kỹ thuật Chuyên sâu: Cơ chế Hoạt động, Kiến trúc Hệ thống và Tác động của DelayedActionManager trong Môi trường Addressables của Unity"
date: 2026-10-01
---

# Báo cáo Nghiên cứu Kỹ thuật Chuyên sâu: Cơ chế Hoạt động, Kiến trúc Hệ thống và Tác động của DelayedActionManager trong Môi trường Addressables của Unity

Hệ thống Addressable Asset System (gọi tắt là Addressables) đại diện cho một bước tiến kiến trúc mang tính cách mạng của Unity, cung cấp một giải pháp quản lý nội dung linh hoạt, mạnh mẽ và tối ưu hóa dựa trên nền tảng AssetBundles truyền thống[^1]. Trong quá trình thiết kế và vận hành các trò chơi hoặc ứng dụng tương tác quy mô lớn, việc quản lý luồng dữ liệu bất đồng bộ để tải và giải phóng tài nguyên một cách tự động là yêu cầu thiết yếu. Một trong những thành phần cốt lõi đảm nhận nhiệm vụ phức tạp này, nhưng lại thường xuyên gây bối rối cho các kỹ sư phần mềm khi phân tích hệ thống phân cấp (Hierarchy), là một đối tượng tự động sinh ra mang tên DelayedActionManager nằm gọn bên trong phân cảnh DontDestroyOnLoad[^2].

Báo cáo kỹ thuật này sẽ đi sâu vào việc giải phẫu toàn diện bản chất kiến trúc của DelayedActionManager, lý giải nguyên nhân sự tồn tại của nó trong không gian DontDestroyOnLoad, phân tích cơ chế thực thi bên trong vòng lặp thời gian thực của Unity, đồng thời mổ xẻ các thách thức liên quan đến quản lý bộ nhớ, hiện tượng rò rỉ (memory leaks) và các ngoại lệ luồng (exceptions) thường gặp. Thông qua việc phân tích dữ liệu thiết kế hệ thống và thực tiễn tốt nhất, tài liệu cung cấp một cái nhìn sâu sắc nhằm hỗ trợ các kiến trúc sư phần mềm tối ưu hóa độ ổn định của ứng dụng.

## Sự Tiến hóa của Hệ thống Tải Tài nguyên và Nền tảng Bất đồng bộ

Trước khi đi sâu vào các cấu trúc vi mô của DelayedActionManager, việc hiểu rõ bối cảnh ra đời của hệ thống Addressables là điều kiện tiên quyết. Trong các phiên bản Unity cũ, lập trình viên thường phụ thuộc vào thư mục Resources hoặc sử dụng trực tiếp các tập lệnh AssetBundle thô sơ[^4]. Cơ chế `Resources.Load()` hoạt động tương tự như việc người dùng tự đi vào một nhà kho, yêu cầu đường dẫn thư mục chính xác và luồng thực thi (main thread) buộc phải đóng băng (block) cho đến khi tài nguyên được tìm thấy và nạp vào bộ nhớ[^4]. Khuyết điểm của phương pháp này là nó ngăn cản khả năng mở rộng của ứng dụng và gây ra tình trạng tụt giảm số khung hình trên giây (FPS drop) nghiêm trọng khi xử lý dữ liệu lớn.

Để giải quyết bài toán này, Addressables hoạt động như một dịch vụ vận chuyển hiện đại. Lập trình viên chỉ cần cung cấp định danh của tài nguyên (address/key), hệ thống sẽ tự động định tuyến để tìm tài nguyên trên bộ nhớ cục bộ (Local) hoặc tải về từ các máy chủ mạng phân phối nội dung (CDN - Content Delivery Network)[^4]. Quan trọng nhất, toàn bộ chu trình này diễn ra một cách bất đồng bộ (asynchronous). Lệnh tải tài nguyên, điển hình là `Addressables.LoadAssetAsync`, không trả về đối tượng ngay lập tức mà trả về một tay cầm định hướng có tên `AsyncOperationHandle`[^4]. Giao diện này cung cấp một cơ chế gọi lại (callback) khi tài nguyên đã sẵn sàng, cho phép luồng chính của ứng dụng tiếp tục xử lý các logic vật lý và đồ họa mà không bị gián đoạn[^4].

Sự chuyển dịch từ mô hình đồng bộ sang bất đồng bộ hoàn toàn này kéo theo một thách thức lớn về kiến trúc: Khi một tiến trình tải tài nguyên mất vài giây để hoàn thành do băng thông mạng chậm, ứng dụng có thể đã chuyển sang một phân cảnh (scene) hoàn toàn khác[^1]. Việc quản lý các hàm gọi lại (callbacks), hàng đợi tác vụ (command queues) và bộ đếm tham chiếu (reference counting) đòi hỏi một thực thể quản trị trung tâm, không bị ảnh hưởng bởi vòng đời hủy/tạo của các phân cảnh thông thường. Đó chính là lý do các nhà phát triển Unity đã tích hợp mô hình phân cảnh DontDestroyOnLoad vào lõi của Addressables.

## Phân cảnh DontDestroyOnLoad (DDOL) và Kiến trúc Bền vững Toàn cục

Trong môi trường Unity, thao tác tải một phân cảnh mới (thông qua `SceneManager.LoadScene` với chế độ Single mặc định) sẽ tự động kích hoạt cơ chế dọn dẹp bộ nhớ. Hệ thống sẽ tiêu hủy (destroy) toàn bộ các GameObjects và Component thuộc phân cảnh trước đó nhằm đảm bảo giải phóng tài nguyên không còn sử dụng[^7]. Mặc dù tính năng tải phân cảnh cộng gộp (Additive scenes) cho phép duy trì nhiều phân cảnh hoạt động song song để quản lý trạng thái toàn cục (ví dụ: một phân cảnh dành riêng cho Game Manager và một phân cảnh cho Level), cơ chế DontDestroyOnLoad (DDOL) vẫn đóng vai trò là một kỹ thuật hệ thống quan trọng để bảo vệ các đối tượng ở cấp độ thấp[^7].

Sự xuất hiện của phân cảnh DontDestroyOnLoad trong giao diện Editor của Unity khi nhấn nút Play không phải là một lỗi, mà là một cơ chế ẩn mặc định của engine nhằm gom nhóm các đối tượng được đánh dấu không bị tiêu hủy khi tải phân cảnh[^9]. Để một GameObject được chấp nhận vào vùng an toàn này, hệ thống Unity đặt ra một quy tắc bắt buộc: đối tượng đó phải nằm ở cấp bậc gốc (root level) của phân cảnh[^8]. Bất kỳ nỗ lực nào nhằm áp dụng hàm `DontDestroyOnLoad(gameObject)` lên một đối tượng con (nested object) đều sẽ thất bại và cảnh báo sẽ được ghi nhận[^8].

Đối với hệ thống Addressables, quá trình tải và giải phóng tài nguyên là các hoạt động có vòng đời bao trùm lên nhiều phân cảnh khác nhau. Ví dụ, việc theo dõi trạng thái tải xuống của một AssetBundle từ máy chủ từ xa không thể bị hủy bỏ giữa chừng chỉ vì người chơi vừa đi qua một cánh cửa chuyển màn. Việc sử dụng cơ chế `RuntimeInitializeOnLoadMethod` kết hợp với mẫu thiết kế Singleton nâng cao cho phép mã nguồn Addressables tự động tạo ra một đối tượng gốc và đưa nó vào phân cảnh DDOL ngay khi ứng dụng khởi chạy[^2]. Điều này lý giải tại sao ngay cả khi lập trình viên không viết bất kỳ dòng mã nào liên quan đến DDOL, một đối tượng mang tên "DelayedActionManager" vẫn tự động xuất hiện ở góc trái bên dưới danh sách phân cảnh[^2].

## Cấu trúc Nội tại và Vai trò Kỹ thuật của DelayedActionManager

Nghiên cứu sâu vào mã nguồn và tài liệu API của gói Addressables, DelayedActionManager là một lớp cụ thể (concrete class) nằm trong không gian tên `UnityEngine.ResourceManagement.Util`[^11]. Cấu trúc của nó không phải là một lớp tiện ích tĩnh (static utility class) đơn thuần, mà là một thành phần được gắn trực tiếp vào một GameObject thông qua việc kế thừa từ kiến trúc cơ sở[^12].

### Mô hình ComponentSingleton và Sự Tự động Hóa Khởi tạo

Kiến trúc của DelayedActionManager được xây dựng dựa trên mẫu thiết kế ComponentSingleton, một lớp nền tảng được định nghĩa trong cùng không gian tên[^13]. Việc sử dụng mẫu Singleton trên một thành phần (Component) thay vì một lớp C# thuần túy mang lại cho hệ thống khả năng tương tác trực tiếp với vòng lặp sự kiện thời gian thực (PlayerLoop) của Unity.

Khi hệ thống ResourceManager lần đầu tiên nhận được một yêu cầu tải hoặc cập nhật trạng thái (ví dụ: `Addressables.LoadAssetAsync` hoặc các thao tác chuẩn đoán mạng), nó sẽ gọi đến thực thể DelayedActionManager. Tại thời điểm này, mẫu ComponentSingleton tự động thực hiện một quy trình ẩn bao gồm: tạo một GameObject trống, đặt tên là "DelayedActionManager", gắn tập lệnh tương ứng vào nó và lập tức gọi hàm `DontDestroyOnLoad` để đưa nó vào không gian bảo vệ toàn cục[^2]. Thiết kế khởi tạo trễ (lazy initialization) này đảm bảo rằng tài nguyên hệ thống chỉ được tiêu thụ khi chức năng quản lý tác vụ trì hoãn thực sự được yêu cầu, giải đáp những thắc mắc phổ biến của các lập trình viên về sự xuất hiện "ma thuật" của đối tượng này trên giao diện[^3].

### Phân tích Cơ chế Lập lịch và Giai đoạn LateUpdate

Nhiệm vụ cốt lõi của DelayedActionManager là đóng vai trò như một bộ lập lịch trung tâm (central scheduler) cho các hành động bị trì hoãn, các hàm gọi lại (callbacks), coroutine và quản lý bộ nhớ ở cấp độ vi mô[^11]. Điểm khác biệt tinh tế nhưng cực kỳ quan trọng trong kiến trúc của nó là mọi logic xử lý hàng đợi đều được định tuyến để thực thi bên trong hàm `LateUpdate()` của vòng đời Unity[^11].

Lựa chọn thiết kế nhắm vào `LateUpdate` thay vì `Update` truyền thống giải quyết một bài toán kiến trúc sâu sắc liên quan đến tính nhất quán của dữ liệu. Bảng sau đây minh họa thứ tự thực thi của Unity và vai trò của pha `LateUpdate` trong việc bảo vệ dữ liệu Addressables.

| Giai đoạn Thực thi (PlayerLoop) | Chức năng Điển hình | Vai trò đối với Addressables và DelayedActionManager |
| :--- | :--- | :--- |
| **FixedUpdate** | Xử lý mô phỏng vật lý, va chạm tĩnh/động. | Logic trò chơi có thể kích hoạt yêu cầu tiêu hủy đối tượng sau va chạm. |
| **Update** | Đầu vào của người chơi (Input), di chuyển, logic AI, cập nhật trạng thái trò chơi. | Các hàm `Addressables.LoadAssetAsync` hoặc `Release` được gọi thủ công. GameObjects có thể bị `Destroy()` tại đây. |
| **LateUpdate** | Cập nhật vị trí Camera, hiệu chỉnh hậu kỳ (post-processing). | DelayedActionManager dọn dẹp bộ nhớ, cập nhật biến đếm tham chiếu, và gọi các callback bất đồng bộ để đảm bảo không xung đột với các lệnh tiêu hủy ở pha `Update`[^11]. |

Nếu hệ thống ResourceManager thực thi các callback hoàn thành tác vụ ngay lập tức giữa pha `Update`, nó có nguy cơ cao tương tác với một hệ thống (ví dụ: hệ thống đồ họa hoặc giao diện người dùng) đang trong trạng thái trung gian, chưa hoàn tất việc tính toán khung hình. Bằng cách trì hoãn (delaying) việc gọi các hàm OnComplete hoặc thực thi giảm bộ đếm tham chiếu (ref-count decrements) cho đến `LateUpdate()`, DelayedActionManager đảm bảo rằng toàn bộ trạng thái logic của khung hình hiện tại đã ổn định[^11]. Dữ liệu từ hàng loạt báo cáo theo dõi ngăn xếp (stack traces) cho thấy hàm `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` là bước đệm cuối cùng trước khi quyền điều khiển được trao lại cho mã nguồn của người dùng[^15].

## Mổ xẻ Ngoại lệ Hệ thống (System Exceptions) và Dấu vết Ngăn xếp (Stack Traces)

Mặc dù được thiết kế với độ an toàn cao, sự phức tạp của cơ chế bất đồng bộ, kết hợp với các thao tác quản lý vòng đời không chuẩn xác từ phía lập trình viên, thường khiến DelayedActionManager trở thành tâm điểm của các ngoại lệ nghiêm trọng. Các báo cáo lỗi cung cấp manh mối quan trọng về cách hệ thống tương tác với bộ nhớ máy chủ (managed memory) và bộ nhớ gốc (native memory).

### Lỗi NullReferenceException và Xung đột Vòng đời Proxy C# - C++

Một kịch bản lỗi rất phổ biến trong môi trường Addressables là sự xuất hiện của ngoại lệ `ArgumentNullException: Value cannot be null. Parameter name: obj` phát sinh từ hàm `StartCoroutine_Auto` của DelayedActionManager[^19]. Lỗi này không phải là sự cố nội tại của Unity, mà xuất phát từ sự bất đồng nhất giữa cơ chế thu gom rác của C# (Garbage Collector) và việc quản lý con trỏ nguyên thủy của mã nguồn C++ bên dưới[^19].

Trong Unity, các đối tượng như GameObject hoặc MonoBehaviour thực chất là các lớp đại diện (proxy classes) viết bằng C#, chứa một tham chiếu nội bộ trỏ tới đối tượng gốc được cấp phát bằng C++ trong engine[^19]. Khi lập trình viên gọi lệnh `Destroy(gameObject)`, đối tượng C++ lập tức bị tiêu hủy và vùng nhớ được trả lại, làm cho tham chiếu nội bộ trở thành null[^19]. Tuy nhiên, lớp C# proxy vẫn có thể tồn tại trong bộ nhớ quản lý (managed memory) một khoảng thời gian cho đến khi bộ thu gom rác quét qua[^19].

Thảm họa xảy ra khi các nhà phát triển sử dụng các biểu thức ẩn danh (lambdas/closures) kết hợp với các tiến trình bất đồng bộ của Addressables. Biểu thức lambda có đặc tính "bắt giữ" (capture) các biến ngữ cảnh xung quanh nó. Xem xét mô hình mã nguồn sau:

```csharp
// Một hành động được đưa vào hàng đợi của DelayedActionManager
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

Khi mã này được thực thi, biến `_crawlerRobot` (là một proxy C#) bị closure giữ lại[^19]. Nếu logic trong trò chơi tiêu hủy `_crawlerRobot` ngay trong khung hình đó, con trỏ C++ bên dưới biến mất. Nhưng bởi vì DelayedActionManager đã lên lịch để chạy lambda này vào pha `LateUpdate` (hoặc ở một khung hình sau đó), khi lambda thực sự được kích hoạt, nó cố gắng truy cập vào thành phần `BreakAwayLowerBody()` của một con trỏ C++ đã chết[^19]. Hệ quả tất yếu là hệ thống sẽ ném ra ngoại lệ `NullReferenceException` hoặc thông báo lỗi "Đối tượng đã bị tiêu hủy nhưng bạn vẫn cố gắng truy cập nó"[^19].

Để khắc phục rủi ro kiến trúc này, các chuyên gia phần mềm khuyến nghị hai giải pháp thiết kế:

1. Tránh lạm dụng việc lồng ghép các biểu thức lambda (lambdas nesting) khi xử lý các thay đổi trạng thái cấp thấp[^19].
2. Luôn thực hiện kiểm tra kiểm chứng null an toàn, dựa vào thực tế là Unity đã nạp chồng (overloaded) toán tử `==` của C# để kiểm tra trực tiếp trạng thái của con trỏ C++ bên dưới[^19].

### Xung đột PlayerLoop và Lỗi "Assertion failed on expression: ShouldRunBehaviour()"

Trong quá trình quản lý phiên bản (version control) của các gói Addressables, một lượng lớn các nhà phát triển báo cáo về việc trình soạn thảo Unity (Unity Editor) tràn ngập một thông báo lỗi cấp thấp: `Assertion failed on expression: 'ShouldRunBehaviour()'` tại tệp `MonoBehaviour.cpp`[^3].

Dấu vết theo dõi (stack trace) chỉ ra rằng quá trình này bắt nguồn trực tiếp từ GameObject "DelayedActionManager" nằm trong phân cảnh DontDestroyOnLoad[^3]. Phân tích căn nguyên (Root Cause Analysis) tiết lộ một lỗ hổng trong quá trình xử lý luồng phát lại (Play Mode) của Unity Editor. Khi trình soạn thảo trải qua một đợt biên dịch lại luồng miền (Domain Reload) hoặc khi quá trình xử lý tải tài nguyên chưa hoàn tất mà người dùng đã bấm dừng (Stop) trò chơi, DelayedActionManager bị mắc kẹt lại với tư cách là một đối tượng mồ côi (orphaned object)[^3].

Bởi vì nó được chỉ định là DontDestroyOnLoad, nó cố gắng tiếp tục thực thi các chu kỳ `LateUpdate` và kiểm tra hành vi (behaviour checks) mặc dù môi trường thực thi gốc của Unity (PlayerLoop) đã ra lệnh ngừng chạy toàn bộ các tác vụ[^3]. Lỗi này được ghi nhận nghiêm trọng nhất trong quá trình chuyển tiếp từ gói Addressables 1.16.x lên 1.18.x, buộc nhiều nhóm phát triển phải hạ cấp thủ công về phiên bản 1.17.17 để đảm bảo độ ổn định của API xử lý đồng bộ và loại bỏ tình trạng kẹt hàng đợi[^3].

### Sự Biến động của DelayedActionManager Trong Lịch sử Phiên Bản

Một điểm thú vị trong nghiên cứu tài liệu API và nhật ký thay đổi (changelogs) của Unity Addressables là sự tồn tại mang tính chu kỳ của DelayedActionManager. Các phiên bản như 0.7.5 và 1.11.2 công bố rõ ràng trong nhật ký cập nhật việc tái cấu trúc giao diện tập lệnh xây dựng (build script interface) bằng thông báo: "Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading"[^20]. Quyết định này ban đầu nhằm đơn giản hóa lớp API và chuyển giao quyền kiểm soát cho lớp `AsyncOperationBase` tùy biến[^20].

Tuy nhiên, hồ sơ lỗi từ các phiên bản hậu LTS (Long-Term Support) như 1.18.15, 1.19.19 và 1.21.21 lại phơi bày sự trở lại liên tục của `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` trong các chuỗi ngăn xếp[^11]. Điều này phản ánh triết lý thiết kế lặp lại (iterative design) của Unity: sau khi gỡ bỏ để tinh giản, các kỹ sư hệ thống nhận ra rằng việc thiếu đi một trình quản lý tác vụ trì hoãn trung tâm tạo ra những khó khăn không thể khắc phục trong việc thu thập các sự kiện chuẩn đoán (DiagnosticEventCollector), xử lý các bảng tải trước (preload tables), và đảm bảo an toàn bộ nhớ khi đóng ứng dụng[^11]. DelayedActionManager được thiết kế lại và khôi phục như một tiện ích hệ thống ngầm, không còn phơi bày qua giao diện người dùng công khai, nhưng chịu trách nhiệm xử lý các rủi ro dọn dẹp rác (disposal) khi ứng dụng tắt[^20].

## Cơ chế Đếm Tham chiếu và Động lực Học Rò rỉ Bộ nhớ

Sự tồn tại của DelayedActionManager gắn liền mật thiết với một trong những trụ cột phức tạp nhất của Addressables: Hệ thống Quản lý Bộ nhớ (Memory Management). Không giống như việc phụ thuộc hoàn toàn vào Garbage Collector, Addressables kiểm soát sự tồn tại của dữ liệu trong RAM thông qua cơ chế Đếm tham chiếu (Reference Counting)[^23].

### Động học Tham chiếu và Phân cấp Phụ thuộc

Mỗi khi hệ thống nhận được yêu cầu tải một tài nguyên, bộ đếm tham chiếu của tài nguyên đó sẽ được tăng lên một (increment). Khi hoàn tất việc sử dụng, lệnh `Addressables.Release` sẽ ra chỉ thị cho hệ thống giảm bộ đếm này (decrement)[^23]. Quy tắc vàng là hệ thống chỉ cho phép giải phóng bộ nhớ vật lý chứa tài nguyên khi bộ đếm tham chiếu quay trở về giá trị tuyệt đối bằng 0[^23].

Tính phức tạp gia tăng theo cấp số nhân do Addressables quản lý các phụ thuộc thông qua kiến trúc AssetBundle. Khi tải một tài nguyên (ví dụ: một vật liệu - Material), hệ thống không chỉ tải bản thân vật liệu đó mà tự động tải toàn bộ các AssetBundle chứa các thành phần phụ thuộc của nó (ví dụ: Texture)[^25]. Đồ thị phụ thuộc (dependency graph) được tính toán ở cấp độ Bundle, nghĩa là nếu một tài nguyên trong Bundle A tham chiếu đến một tài nguyên trong Bundle B, toàn bộ Bundle B phải được tải vào bộ nhớ máy chủ[^26].

Giới hạn kỹ thuật cứng nhắc nhất của Unity trong kiến trúc này là: **Người dùng không thể giải phóng một phần (partially unload) nội dung của một AssetBundle**[^23]. Để làm rõ, nếu một AssetBundle mang tên "stuff" chứa ba tài nguyên độc lập: Cây, XeTăng, và ConBò[^23].

1. Khi tài nguyên Cây được tải, công cụ phân tích bộ nhớ (Profiler) hiển thị một tham chiếu cho Cây, và một tham chiếu tương ứng cho bundle `stuff`[^23].
2. Khi tài nguyên XeTăng tiếp tục được tải, bộ đếm của XeTăng tăng lên, và bộ đếm của `stuff` tăng lên 2[^23].
3. Nếu trò chơi thực thi lệnh `Release(Cây)`, bộ đếm của Cây giảm về 0, thanh biểu diễn màu xanh trên Profiler biến mất[^23].
4. Tuy nhiên, dữ liệu vật lý của Cây vẫn nằm nguyên trong bộ nhớ hệ thống. Do XeTăng vẫn đang duy trì kết nối khiến bộ đếm của AssetBundle `stuff` lớn hơn 0, không có bất kỳ tài nguyên nào trong bundle này được phép hủy bỏ cho đến khi toàn bộ bundle được giải phóng hoàn toàn[^23].

### Hội chứng "Asset Churn" và Phình Bộ nhớ (Memory Bloat)

Hiện tượng các tài nguyên liên tục được tải lên rồi giải phóng, sau đó lập tức nạp lại trong một thời gian ngắn, được định nghĩa là "Asset Churn" (sự giằng co tài nguyên)[^23]. Lỗ hổng này thường xuất hiện khi chuyển đổi giữa các cấp độ (levels). Nếu Cấp độ 1 sử dụng tài nguyên Thuyền và Cấp độ 2 sử dụng tài nguyên MáyBay. Khi thoát Cấp độ 1, nhà phát triển giải phóng Thuyền, điều này kéo theo việc hệ thống Addressables lập tức gỡ bỏ kết cấu NgụyTrang khỏi bộ nhớ. Một mili-giây sau, khi Cấp độ 2 khởi tạo MáyBay, hệ thống lại buộc ổ đĩa cứng thực thi chu trình I/O để tải lại kết cấu NgụyTrang đó từ đầu[^23]. Quá trình này tạo ra các đỉnh (spikes) tăng đột biến về thời gian khung hình và đẩy bộ nhớ lên ngưỡng nguy hiểm, đặc biệt trên phần cứng di động[^27].

Bên cạnh đó, việc bỏ sót lệnh `Release` dẫn đến sự tích tụ tham chiếu rác, khiến dung lượng RAM trôi dạt từ hàng trăm megabyte lên tới mức gigabyte chỉ qua vài lần chuyển cảnh[^28]. Vì DelayedActionManager hay bản thân Addressables không theo dõi số lượng các phiên bản (instances) được khởi tạo bằng phương pháp `Instantiate` thuần túy của MonoBehaviour, bất kỳ sai sót nào trong việc theo dõi tay cầm bộ nhớ sẽ tạo ra rò rỉ bộ nhớ vĩnh viễn[^6].

### Kiến trúc Nén Dữ Liệu và Áp lực Cấp phát Bộ nhớ

Kích thước của AssetBundles và phương thức nén dữ liệu tác động trực tiếp đến cách dữ liệu cư trú trên RAM. Việc lựa chọn phương thức nén quyết định liệu AssetBundle sẽ chiếm dụng một khối lượng lớn bộ nhớ vĩnh viễn hay có khả năng tối ưu hóa băng thông.

Bảng tổng hợp đặc tính các thuật toán nén AssetBundle và tác động lưu trữ[^29]:

| Thuật toán Nén | Khả năng Nhận diện Tệp Cục bộ | Yêu cầu Tải Toàn bộ Bundle vào RAM | Tác động Hiệu suất & Lưu trữ |
| :--- | :--- | :--- | :--- |
| **LZMA** | Không. Bundle bị nén nguyên khối. | **Có.** Phải giải nén toàn bộ tập tin vào bộ nhớ. | Tỷ lệ nén cao nhất, dung lượng tải về nhỏ, nhưng gây ra phình bộ nhớ cấp tính (Memory Bloat) và tiêu thụ CPU cường độ cao khi trích xuất[^29]. |
| **LZ4** | Có. Nén theo khối (chunk-based). | **Không.** Chỉ tải phần dữ liệu đang được truy xuất. | Khuyến nghị làm chuẩn mặc định (default). Cho phép lưu trữ đệm (caching) trực tiếp lên đĩa cục bộ mà không cần nạp toàn bộ metadata lên RAM[^29]. |
| **Uncompressed** | Có. Nhận diện độc lập từng tài nguyên. | **Không.** Truy xuất trực tiếp. | Không tốn thời gian giải nén, dung lượng tệp gốc lớn nhất. Tối ưu cho nạp tức thời nếu băng thông đĩa cho phép[^29]. |

Khi yêu cầu một tài nguyên nhỏ bé từ một gói AssetBundle được nén bằng LZMA khổng lồ, toàn bộ tệp (bao gồm tiêu đề, siêu dữ liệu, bảng bộ đệm streaming) buộc phải chuyển từ ổ cứng lên RAM[^27]. Lỗi thiết kế này biến các AssetBundle khổng lồ thành những quả bom nổ chậm, gây tràn bộ nhớ (OOM crashes) cho ứng dụng[^27].

## Các Thực tiễn Tốt nhất (Best Practices) trong Quản trị Tài nguyên

Để chế ngự sự phức tạp của hệ thống đếm tham chiếu và hạn chế gánh nặng lên DelayedActionManager, các nhà thiết kế hệ thống phải áp dụng cấu trúc vòng đời vô cùng nghiêm ngặt, kết hợp với các kỹ thuật tối ưu hóa vòng đời tài nguyên.

### 1. Đồng bộ Hóa Chu trình Khởi tạo và Giải Phóng

Mọi đối tượng `AsyncOperationHandle` do API trả về bắt buộc phải được giải phóng khi kết thúc vòng đời sử dụng[^6]. Việc không thực thi điều này không chỉ gây rò rỉ bộ nhớ mà còn có khả năng gây tràn hệ thống (crashes)[^6]. Bảng dưới đây minh họa các phép đối xứng bắt buộc trong lập trình Addressables:

| Phương thức Khởi tạo / Nạp | Phương thức Giải phóng Tương ứng | Cơ chế Hoạt động Nội bộ |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | Trừ 1 vào bộ đếm tham chiếu của AssetBundle chứa nó[^6]. |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | Tiêu hủy đối tượng hiển thị (Instance) và tự động trừ 1 vào bộ đếm của Prefab gốc[^4]. |
| Gán thông qua `AssetReference` | `reference.ReleaseAsset()` | Tương tự việc gọi Release thông qua tay cầm, dọn dẹp tham chiếu tĩnh[^6]. |

Đặc biệt, khi sử dụng ScriptableObjects để lưu trữ thiết lập trò chơi, việc tham chiếu trực tiếp một đối tượng (`public Object _worldAsset`) sẽ tạo ra tham chiếu cứng (hard references), ép buộc toàn bộ hệ thống nạp tài nguyên đó lên RAM ngay lập tức[^27]. Giải pháp tối ưu là sử dụng AssetReference (`public AssetReference addressableAsset;`) để tải bất đồng bộ theo yêu cầu (on-demand loading)[^6].

### 2. Sự can thiệp Cấp thấp: Resources.UnloadUnusedAssets()

Trong tình huống tiến thoái lưỡng nan khi các AssetBundle chia sẻ bị kẹt trạng thái bộ nhớ do đặc tính "không giải phóng một phần" (ví dụ: tài nguyên Cây kẹt cùng XeTăng), lối thoát duy nhất là sử dụng một API cưỡng chế từ lớp cơ sở của engine: `Resources.UnloadUnusedAssets()`[^25].

Chức năng này thực hiện một quá trình quét sâu toàn bộ hệ thống RAM để dò tìm mọi tài nguyên (kể cả những tài nguyên ẩn trong AssetBundles) có số lượng tham chiếu nội tại (actual engine references) hoàn toàn bằng 0, và cưỡng bức tiêu hủy chúng[^25]. Dẫu vậy, đây là một thao tác gây tốn kém hiệu năng máy tính khủng khiếp, tạo ra các rớt khung hình (FPS drops) nghiêm trọng vì CPU phải tạm dừng luồng logic để thực hiện quá trình quét dọn[^27]. Các kỹ sư chỉ nên kích hoạt lệnh này trong các phân đoạn chuyển màn hình lớn (loading screens), hoặc được hệ thống gọi tự động khi sử dụng `SceneManager.LoadScene` chuyển đổi phân cảnh[^29].

### 3. Quy hoạch và Phân mảnh AssetBundles (Bundle Packing Modes)

Tổ chức cấu trúc các nhóm (Groups) trong giao diện cấu hình Addressables quyết định trực tiếp hiệu năng nạp bộ nhớ và băng thông tải xuống. Lựa chọn chế độ đóng gói (Bundle Mode) phù hợp với loại tài nguyên là bước thiết kế tối quan trọng[^6]:

* **Pack Together (Đóng gói Chung)**: Sử dụng cho các tài nguyên có vòng đời kết dính chặt chẽ, luôn luôn xuất hiện đồng thời. Điều này giảm thiểu chi phí phân tích đồ thị phụ thuộc và I/O mạng[^6].
* **Pack Separately (Đóng gói Riêng biệt)**: Tối ưu cho các tài nguyên khổng lồ, độc lập, hoặc các bản đồ lớn mà không thể đảm bảo luôn được tải cùng nhau. Loại bỏ rủi ro một tài nguyên lớn cản trở việc giải phóng một tài nguyên nhỏ lẻ khác[^6].
* **Pack Together By Label (Đóng gói Theo Nhãn)**: Cho phép kết hợp các tài nguyên nằm rải rác thông qua siêu dữ liệu nhãn (ví dụ: gán nhãn "Halloween 2023" để nhóm toàn bộ nội dung sự kiện vào một bundle, dễ dàng cập nhật qua CDN)[^6].

Để cắt giảm sâu hơn gánh nặng của bảng mục lục (TypeTree) trong AssetBundle, lập trình viên có thể kích hoạt tùy chọn `BuildAssetBundleOptions.DisableWriteTypeTree`. Tính năng này sẽ loại bỏ lượng siêu dữ liệu không cần thiết, tuy nhiên đòi hỏi quá trình xây dựng lại bộ nhớ mã hóa (rebuild local groups) trước khi xuất tệp thực thi[^26].

### 4. Quản trị Bộ nhớ Âm thanh và Hình ảnh (Graphics & Audio)

Tối ưu hóa các lớp phụ trợ là biện pháp hữu hiệu nhất giảm tải tần suất hoạt động của bộ thu gom rác. Cấu hình định dạng tải của luồng âm thanh trực tiếp ảnh hưởng đến bộ nhớ[^27]:

* **Âm nhạc nền (BGM) dài**: Cần cấu hình Streaming để nạp từng vùng nhớ đệm nhỏ từ đĩa[^27].
* **Hiệu ứng âm thanh dài**: Chọn Compressed In Memory để nén trên RAM và giải nén trong thời gian thực khi chơi[^27].
* **Hiệu ứng âm thanh ngắn/tần suất cao**: Dùng Decompress On Load để sẵn sàng dữ liệu không nén trực tiếp, loại bỏ chi phí CPU[^27].

Bên cạnh đó, việc vô hiệu hóa tùy chọn "Read/Write enabled" trên Texture và cấu hình lược bỏ bộ đệm chiều sâu (Depth Stencil Format to None) đối với Camera đồ họa giao diện (UI) sẽ giảm trừ ít nhất 50% lượng RAM kết xuất không cần thiết[^27].

## Kết Luận Sự Tương tác Toàn Cục

Nghiên cứu về DelayedActionManager không chỉ giải mã nguồn gốc của một đối tượng ẩn trong phân cảnh DontDestroyOnLoad, mà còn phơi bày triết lý thiết kế cơ bản của hệ thống Addressables trong Unity. Lớp ComponentSingleton này đóng vai trò như cầu nối thời gian tinh tế, bảo toàn tính toàn vẹn của dữ liệu bằng cách điều hướng các tiến trình giải phóng, lệnh gọi bất đồng bộ và xử lý bộ đệm sang chu kỳ LateUpdate. Nó cô lập các thay đổi cấu trúc bộ nhớ khỏi sự gián đoạn có thể gây ra bởi mã vật lý hay logic điều khiển thuộc luồng Update, tạo thành tấm khiên chống lại các ngoại lệ hư hỏng hệ thống khi chuyển cảnh.

Tuy nhiên, DelayedActionManager không phải là chiếc đũa thần có thể giải quyết các điểm yếu nội tại của kiến trúc quản lý bộ nhớ. Nó đặt ra yêu cầu khắc nghiệt đối với các nhà thiết kế kiến trúc phần mềm trong việc duy trì chu trình tải/giải phóng tài nguyên hoàn toàn đối xứng, thiết kế biểu thức C# ẩn danh (lambdas) tránh vòng lặp bắt giữ đối tượng C++ nguyên thủy, và chia nhỏ (modularize) cấu trúc AssetBundle để phòng ngừa rò rỉ bộ nhớ cứng đầu. Bằng sự am hiểu thấu đáo về định tuyến tải bất đồng bộ, sử dụng hợp lý phương thức nén như LZ4, kết hợp sức mạnh cưỡng chế từ `Resources.UnloadUnusedAssets`, các nhóm phát triển có thể thiết kế nên những mô hình kiến trúc vững chắc, có khả năng mở rộng mạnh mẽ trên mọi nền tảng mà không phải đối diện với nỗi lo cạn kiệt tài nguyên vĩnh viễn.

## Nguồn trích dẫn

[^1]: Addressables In Unity - Ali Emre Onur - Medium, [https://aliemreonur.medium.com/addressables-in-unity-eec8b03198d7](https://aliemreonur.medium.com/addressables-in-unity-eec8b03198d7)
[^2]: Latecomer to Chop Chop, with a question...! - Unity Discussions, [https://discussions.unity.com/t/latecomer-to-chop-chop-with-a-question/899280](https://discussions.unity.com/t/latecomer-to-chop-chop-with-a-question/899280)
[^3]: Error: Assertion failed on expression: ShouldRunBehaviour(), [https://discussions.unity.com/t/error-assertion-failed-on-expression-shouldrunbehaviour/839805](https://discussions.unity.com/t/error-assertion-failed-on-expression-shouldrunbehaviour/839805)
[^4]: Addressables - Unity Term Book, [https://unitytermbook.com/en/addressables/](https://unitytermbook.com/en/addressables/)
[^5]: How to structure your Unity project (best practice tips), [https://gamedevbeginner.com/how-to-structure-your-unity-project-best-practice-tips/](https://gamedevbeginner.com/how-to-structure-your-unity-project-best-practice-tips/)
[^6]: Best Practices | Spatial Creator Toolkit, [https://toolkit.spatial.io/docs/addressables/best-practices](https://toolkit.spatial.io/docs/addressables/best-practices)
[^7]: How to use DontDestroyOnLoad - Scripting - Unity Discussions, [https://discussions.unity.com/t/how-to-use-dontdestroyonload/894016](https://discussions.unity.com/t/how-to-use-dontdestroyonload/894016)
[^8]: DontDestroyOnLoad is not Working on Scene? - Stack Overflow, [https://stackoverflow.com/questions/18328180/dontdestroyonload-is-not-working-on-scene](https://stackoverflow.com/questions/18328180/dontdestroyonload-is-not-working-on-scene)
[^9]: why does "DontDestroyOnLoad" show up when I press play, if its not, [https://www.reddit.com/r/unity/comments/p8pj82/why_does_dontdestroyonload_show_up_when_i_press/](https://www.reddit.com/r/unity/comments/p8pj82/why_does_dontdestroyonload_show_up_when_i_press/)
[^10]: DontDestroyOnLoad in Unity — Best Practices — Tutorial #1, [https://makaka.org/unity-tutorials/dont-destroy-on-load](https://makaka.org/unity-tutorials/dont-destroy-on-load)
[^11]: Error when using GetTable() - Unity Engine - Unity Discussions, [https://discussions.unity.com/t/error-when-using-gettable/892883](https://discussions.unity.com/t/error-when-using-gettable/892883)
[^12]: Unity Resource Manager | Package Manager UI website, [https://docs.unity3d.com/Packages/com.unity.resourcemanager@2.2/index.html](https://docs.unity3d.com/Packages/com.unity.resourcemanager@2.2/index.html)
[^13]: Namespace UnityEngine.ResourceManagement.Util | Addressables, [https://docs.unity.cn/Packages/com.unity.addressables@2.0/api/UnityEngine.ResourceManagement.Util.html](https://docs.unity.cn/Packages/com.unity.addressables@2.0/api/UnityEngine.ResourceManagement.Util.html)
[^14]: Class ComponentSingleton | Addressables | 4.1.0 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@4.1/api/UnityEngine.ResourceManagement.Util.ComponentSingleton-1.html](https://docs.unity3d.com/Packages/com.unity.addressables@4.1/api/UnityEngine.ResourceManagement.Util.ComponentSingleton-1.html)
[^15]: 어드레서블 Sprite 관련해서 질문이있습니다. - 인프런, [https://www.inflearn.com/community/questions/1351466/%EC%96%B4%EB%93%9C%EB%A0%88%EC%84%9C%EB%B8%94-sprite-%EA%B4%80%EB%A0%A8%ED%95%B4%EC%84%9C-%EC%A7%88%EB%AC%B8%EC%9D%B4%EC%9E%88%EC%8A%B5%EB%8B%88%EB%8B%A4](https://www.inflearn.com/community/questions/1351466/%EC%96%B4%EB%93%9C%EB%A0%88%EC%84%9C%EB%B8%94-sprite-%EA%B4%80%EB%A0%A8%ED%95%B4%EC%84%9C-%EC%A7%88%EB%AC%B8%EC%9D%B4%EC%9E%88%EC%8A%B5%EB%8B%88%EB%8B%A4)
[^16]: Problema ao atribuir SkeletonData a SkeletonAnimation em… - Spine, [https://pt.esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime](https://pt.esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime)
[^17]: Problem when assigning SkeletonData to SkeletonAnimation, [https://esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime](https://esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime)
[^18]: Scriptable Object inside an Addressable Folder causes Exception, [https://discussions.unity.com/t/scriptable-object-inside-an-addressable-folder-causes-exception/855434](https://discussions.unity.com/t/scriptable-object-inside-an-addressable-folder-causes-exception/855434)
[^19]: ArgumentNullException in StartCoroutine_Auto - Unity Discussions, [https://discussions.unity.com/t/argumentnullexception-in-startcoroutine-auto/1701939](https://discussions.unity.com/t/argumentnullexception-in-startcoroutine-auto/1701939)
[^20]: Changelog | Addressables | 1.11.2 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@1.11/changelog/CHANGELOG.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.11/changelog/CHANGELOG.html)
[^21]: Changelog | Package Manager UI website - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@0.7/changelog/CHANGELOG.html](https://docs.unity3d.com/Packages/com.unity.addressables@0.7/changelog/CHANGELOG.html)
[^22]: Changelog | Addressables | 1.15.2 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@1.15/changelog/CHANGELOG.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.15/changelog/CHANGELOG.html)
[^23]: Memory management overview | Addressables | 2.0.8 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@2.0/manual/MemoryManagement.html](https://docs.unity3d.com/Packages/com.unity.addressables@2.0/manual/MemoryManagement.html)
[^24]: Addressables introduction | Addressables | 4.1.0 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@4.1/manual/AddressableAssetsOverview.html](https://docs.unity3d.com/Packages/com.unity.addressables@4.1/manual/AddressableAssetsOverview.html)
[^25]: Memory management | Addressables | 1.16.19 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@1.16/manual/MemoryManagement.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.16/manual/MemoryManagement.html)
[^26]: Memory management | Addressables | 1.20.5 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@1.20/manual/MemoryManagement.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.20/manual/MemoryManagement.html)
[^27]: Unity game memory optimization on Android, [https://developer.android.com/games/engines/unity/unity-reduce-memory](https://developer.android.com/games/engines/unity/unity-reduce-memory)
[^28]: Addressables not freeing memory completely? - Unity Discussions, [https://discussions.unity.com/t/addressables-not-freeing-memory-completely/914086](https://discussions.unity.com/t/addressables-not-freeing-memory-completely/914086)
[^29]: Addressables: how to truly unload assets to free memory, [https://discussions.unity.com/t/addressables-how-to-truly-unload-assets-to-free-memory/808301](https://discussions.unity.com/t/addressables-how-to-truly-unload-assets-to-free-memory/808301)
[^30]: Explain Addressables For Performance To Me Like I Am A Child, [https://www.reddit.com/r/Unity3D/comments/1brakih/explain_addressables_for_performance_to_me_like_i/](https://www.reddit.com/r/Unity3D/comments/1brakih/explain_addressables_for_performance_to_me_like_i/)
[^31]: Addressables: Planning and best practices - Unity, [https://unity.com/blog/engine-platform/addressables-planning-and-best-practices](https://unity.com/blog/engine-platform/addressables-planning-and-best-practices)