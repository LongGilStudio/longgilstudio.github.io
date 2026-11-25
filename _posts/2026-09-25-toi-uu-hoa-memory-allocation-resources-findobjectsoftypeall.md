---
title: "Tối Ưu Hiệu Năng Unity: Hiểu Và Khắc Phục Lỗi Tràn Bộ Nhớ (GC Alloc) Từ Resources.FindObjectsOfTypeAll"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: Hướng dẫn chi tiết dành cho người mới về nguyên nhân gây giật lag (frame spike) khi lạm dụng Resources.FindObjectsOfTypeAll trong Unity và 4 phương pháp tối ưu hóa chuẩn xác nhất.
lang: vi
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

Trong quá trình làm game với Unity, chắc hẳn bạn đã từng gặp trường hợp cần tìm kiếm một GameObject hoặc Component nào đó. Unity cung cấp rất nhiều hàm như `Find`, `FindObjectOfType`, và đặc biệt là `Resources.FindObjectsOfTypeAll`. 

Mặc dù `Resources.FindObjectsOfTypeAll` vô cùng mạnh mẽ vì nó có thể tìm thấy **mọi thứ** (kể cả object đang bị tắt - inactive, prefab trong thư mục, hay tài nguyên chưa được spawn), đây lại là một trong những "sát thủ" thầm lặng giết chết hiệu năng game của bạn nếu không được sử dụng đúng cách. 

Bài viết này sẽ giúp bạn hiểu rõ tại sao hàm này lại nguy hiểm, cách công cụ phân tích (Profiler/Project Auditor) cảnh báo, và hướng dẫn chi tiết các phương pháp tối ưu hóa để loại bỏ hoàn toàn rác bộ nhớ (Garbage Collection Allocation - GC Alloc).

---

## **1. Tại Sao `Resources.FindObjectsOfTypeAll` Lại Gây Hại Cho Hiệu Năng?**

Khi bạn chạy Unity Memory Profiler hoặc Project Auditor, bạn có thể sẽ bắt gặp cảnh báo màu vàng (Moderate):
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

Để hiểu tại sao, chúng ta cần xem xét cách hàm này hoạt động bên dưới engine (C++ core):

1. **Quét Toàn Bộ Bộ Nhớ (Heavy CPU Cost)**: Không giống như `FindObjectOfType` chỉ quét các object đang hoạt động trong Scene, `Resources.FindObjectsOfTypeAll` quét **toàn bộ** bộ nhớ của engine. Nó duyệt qua tất cả Scene objects, Editor objects (nếu đang trong Editor), và các tài nguyên (Assets) đã được nạp vào RAM. Dự án càng lớn, hàm này chạy càng chậm.
2. **Tạo Rác Bộ Nhớ (GC Allocation)**: Mỗi khi hàm này chạy xong, nó **luôn luôn** tạo ra một mảng (Array) mới trên Managed Heap của C# để chứa kết quả trả về. 

**Hệ quả:** Nếu bạn gọi hàm này liên tục (ví dụ: trong hàm `Update()`, hoặc mỗi khi bấm một nút trên UI), bạn đang liên tục vứt rác (mảng cũ) vào bộ nhớ. Khi rác đầy, bộ dọn rác (Garbage Collector - GC) của Unity sẽ bị ép phải kích hoạt. Quá trình dọn rác này sẽ làm game bị khựng lại một khoảnh khắc, tạo ra hiện tượng **giật lag (stuttering)** rất khó chịu cho người chơi.

---

## **2. 4 Phương Pháp Tối Ưu Hóa (Best Practices)**

Để giải quyết triệt để vấn đề này, tùy vào hoàn cảnh, bạn có thể áp dụng 1 trong 4 phương pháp chuẩn xác sau đây, được đúc kết từ các kỹ sư tối ưu hóa Unity.

### **Phương pháp 1: Tham chiếu trực tiếp qua Inspector (Khuyên dùng nhất)**
Cách nhanh nhất và tốn 0 chi phí CPU/RAM là **không tìm kiếm gì cả**. Thay vì dùng code để tìm object, hãy khai báo biến public hoặc `[SerializeField]` và kéo thả object đó vào từ giao diện Inspector của Unity.

```csharp
// ❌ TRÁNH: Tìm kiếm tốn kém
void Start() {
    // Hàm này sẽ tạo ra GC Alloc
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ TỐT NHẤT: Tham chiếu trực tiếp
[SerializeField] private GameManager myManager; 
// (Kéo thả GameManager vào ô này trên Unity Editor)
```

### **Phương pháp 2: Caching (Lưu trữ bộ đệm) và Singleton**
Nếu bạn bắt buộc phải dùng code để tìm, **chỉ nên tìm 1 lần duy nhất** (ví dụ trong `Awake()` hoặc `Start()`), sau đó lưu lại (cache) vào một biến để dùng cho các lần sau.

Với các hệ thống dùng chung như `UIManager` hay `AudioManager`, hãy dùng mô hình Singleton hoặc Static Property để truy cập toàn cục mà không tốn chi phí tìm kiếm.

```csharp
// ❌ TRÁNH: Gọi hàm tìm kiếm liên tục mỗi khi cần text
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ TỐT HƠN: Lưu Cache vào biến static (chỉ tìm 1 lần)
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // Tìm 1 lần
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // Dùng lại ngay lập tức, 0 chi phí
}
```

### **Phương pháp 3: Nâng cấp lên API hiện đại của Unity 6**
Trước đây trong các phiên bản đầu của Unity 2023, khi thay thế `FindObjectsOfType`, Unity từng sử dụng enum `FindObjectsSortMode`:
```csharp
// ⚠️ Cũ (Unity 2023.1 - 2023.2):
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```
Tuy nhiên, **từ Unity 6 trở đi, enum `FindObjectsSortMode` đã chính thức bị đánh dấu lỗi thời (Deprecated / Obsolete)** do engine chuyển đổi từ `InstanceID` 32-bit sang cơ chế định danh đối tượng mới và lược bỏ việc sắp xếp để tối đa hóa hiệu năng.

Theo tài liệu chính thức từ Unity 6, bạn nên sử dụng các overload chuẩn hóa sau:

```csharp
// ❌ Cũ (Unity 2022 trở về trước - Chậm, ép buộc sắp xếp mảng)
var managers = FindObjectsOfType<GameManager>();

// ✅ Chuẩn Unity 6: Lấy 1 object bất kỳ (Nhanh nhất, Zero-Alloc)
// Không cấp phát mảng trên Heap, trả về ngay object đầu tiên tìm thấy
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Chuẩn Unity 6: Lấy danh sách nhiều object (Không cần tham số SortMode đã bị Obsolete)
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **Mẹo:** `FindAnyObjectByType<T>()` tối ưu hơn nhiều so với `FindFirstObjectByType<T>()` nếu bạn chỉ có 1 instance (như Manager/Controller), vì nó không quan tâm thứ tự trong hierarchy mà trả về ngay đối tượng tìm thấy đầu tiên.

#### ⚠️ **Hiểu lầm phổ biến: Có tồn tại `Resources.FindObjectsOfTypeNonAlloc` không?**
Nhiều bạn quen thuộc với các hàm tái sử dụng mảng của Unity (như `Physics.RaycastNonAlloc` hay `GetComponentsNonAlloc`) và cho rằng `Resources` cũng có hàm `NonAlloc` tương tự. 
Thực tế, theo tài liệu chính thức từ Unity: **Hoàn toàn KHÔNG tồn tại hàm `Resources.FindObjectsOfTypeNonAlloc`**. `Resources.FindObjectsOfTypeAll` sẽ **luôn luôn** tạo ra một mảng mới trên Managed Heap mỗi lần được gọi.

Nếu bạn cần theo dõi danh sách toàn bộ đối tượng trong Scene mà muốn **đạt 0 GC Alloc tuyệt đối**, hãy sử dụng kỹ thuật **Tự đăng ký (Static Registration Pattern)**:

```csharp
// ✅ Giải pháp Zero GC Alloc: Tự đăng ký danh sách khi kích hoạt
public class Enemy : MonoBehaviour 
{
    // Danh sách tĩnh dùng chung, tái sử dụng bộ nhớ không cấp phát mới
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// Bất kỳ đâu trong game cần truy cập:
// Dùng trực tiếp Enemy.ActiveEnemies — Nhanh gấp hàng chục lần Find và hoàn toàn 0 GC Alloc!
```

### **Phương pháp 4: Bọc mã (Wrap) bằng `#if UNITY_EDITOR` cho các công cụ Editor**
Đôi khi bạn tải một plugin trên Asset Store (ví dụ: hệ thống animation, công cụ UI) và nó chứa hàm `Resources.FindObjectsOfTypeAll`. Thường thì các hàm này chỉ dùng để phục vụ các nút bấm tiện ích trong môi trường lập trình (Editor). 

Để ngăn các hàm này "lọt" vào bản game cuối cùng (Build Player) và gây cảnh báo, bạn có thể bọc chúng lại bằng chỉ thị tiền biên dịch `#if UNITY_EDITOR`. Mã code bên trong sẽ bị "bay màu" hoàn toàn khi bạn xuất game.

```csharp
#if UNITY_EDITOR 
// Đoạn code này chỉ chạy khi bạn làm việc trên Unity Editor
// Sẽ bị xóa hoàn toàn khi Build ra file .exe, .apk
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. Ví Dụ Thực Tế: Xử Lý Triệt Để Trong Dự Án Game**

Để hiểu rõ cách áp dụng trong thực tế, hãy cùng xem xét 2 tình huống thường gặp nhất khi dự án bị Unity Project Auditor hoặc Profiler cảnh báo rác bộ nhớ từ các gói asset bên thứ 3:

### **Tình huống 1: Hệ thống UI Localization liên tục quét RAM mỗi khi đổi ngôn ngữ**
* **Vấn đề**: Mỗi khi một đoạn văn bản UI cần hiển thị hoặc âm thanh giao diện phát ra, hàm tiện ích lại gọi `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]`. Điều này khiến mỗi thao tác mở menu đều quét toàn bộ RAM và sinh mảng rác trên Heap.
* **Cách xử lý**: 
  1. Dùng `FindAnyObjectByType<UIManager>()` để tìm một lần duy nhất lúc khởi tạo (`Awake`).
  2. Tạo một thuộc tính tĩnh `SharedUIManager` để lưu trữ bộ đệm (cache), biến thao tác tìm kiếm thành truy xuất tức thì $O(1)$ với **0 byte rác**.

```csharp
// ❌ TRƯỚC KHI TỐI ƯU: Quét toàn bộ bộ nhớ và tạo rác mỗi lần gọi hàm
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ SAU KHI TỐI ƯU: Tận dụng Cache tĩnh (Zero GC Alloc)
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // Cache truy cập nhanh cho toàn bộ game
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // Dùng API Unity 6 tìm 1 lần duy nhất, không cấp phát mảng
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// Bất kỳ đâu cần lấy text chỉ việc gọi qua Cache:
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **Tình huống 2: Tiện ích Editor của bên thứ 3 bị lọt vào bản Build game**
* **Vấn đề**: Nhiều gói công cụ (như hệ thống Animation, Level Design) có sẵn các hàm tìm kiếm tài nguyên `Resources.FindObjectsOfTypeAll` để hỗ trợ các nút bấm Reset hay Setup trong Editor. Dù gameplay không hề gọi tới, việc mã này nằm lộ thiên trong mã nguồn runtime vẫn khiến bản Build game (Player) bị Unity gắn cờ cảnh báo GC Alloc.
* **Cách xử lý**: Bọc toàn bộ khối mã tìm kiếm đó bằng chỉ thị tiền biên dịch `#if UNITY_EDITOR`. Khi bạn build game ra file cài đặt (.exe, .apk), Unity sẽ tự động cắt bỏ hoàn toàn các dòng code này khỏi runtime.

```csharp
// ❌ TRƯỚC KHI TỐI ƯU: Mã tìm kiếm tài nguyên Editor nằm lộ thiên trong Runtime
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ SAU KHI TỐI ƯU: Bọc chỉ thị tiền biên dịch #if UNITY_EDITOR
#if UNITY_EDITOR
// Khối mã này chỉ tồn tại trên Unity Editor, bị loại bỏ 100% khi Build game
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **Kết Luận**

Đối với những bạn mới tiếp cận Unity, "Rác bộ nhớ" (GC Allocation) là một khái niệm khá trừu tượng vì C# làm việc dọn dẹp một cách tự động. Tuy nhiên, trong lập trình game, việc liên tục xả rác sẽ dẫn đến hậu quả giật lag hiển hiện rõ trên màn hình.

Quy tắc vàng: **Tránh xa họ hàm `Find` (đặc biệt là `Resources.FindObjectsOfTypeAll`) trong các vòng lặp như `Update()` hoặc các sự kiện gọi thường xuyên.** Hãy ưu tiên tham chiếu qua Inspector, tận dụng bộ đệm (Cache/Singleton), nâng cấp lên API chuẩn Unity 6 (`FindAnyObjectByType`), và bọc các công cụ tiện ích Editor bằng `#if UNITY_EDITOR`. Tối ưu hóa từ những chi tiết nhỏ này sẽ giúp tựa game của bạn duy trì 60 FPS ổn định trên mọi thiết bị!

