---
title: "Optimizing Performance and Temporal Integrity in Unity Engine: System Internals, DateTime.Now Bottleneck Analysis, and Frame Caching"
date: 2026-09-17 03:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, datetime, csharp, dotnet, frame-caching, multithreading, anticheat]
description: An in-depth analysis of DateTime.Now and DateTime.UtcNow internals in the .NET runtime, performance bottleneck quantification, temporal tearing, and a thread-safe Frame Caching architecture in Unity Engine.
lang: en
translation_id: unity-datetime-now-frame-caching
math: true
---

Retrieving and processing real-time wall-clock data is a foundational yet architecturally hazardous task in real-time applications built on Unity Engine[^1]. Although the `System.DateTime` struct in the .NET Base Class Library (BCL) provides comprehensive calendar and time-handling capabilities, calling `System.DateTime.Now` directly inside continuous update loops (hot paths) introduces severe performance bottlenecks and compromises state integrity[^2].

This report provides a deep-dive analysis of the underlying operating system and runtime (.NET/Mono/IL2CPP) mechanics, quantifies computational overhead through profiling data, examines the phenomenon of *temporal tearing*, and thoroughly evaluates the *Frame Caching* solution alongside related architectural best practices[^2].

---

## **1. Internals of DateTime.Now and DateTime.UtcNow in the .NET Runtime**

The `System.DateTime` struct is backed by a single 64-bit value field (`UInt64 _dateData`)[^6]. Within this layout:
- **The lower 62 bits** represent the accumulated number of Ticks since 00:00:00 on January 1, 0001 in the Gregorian calendar, where each tick equals $100\text{ ns}$ ($10^{-7}\text{ s}$ or $0.1\ \mu\text{s}$)[^1].
- **The upper 2 bits** are reserved for the `DateTimeKind` flags, identifying one of three contextual states: `Utc`, `Local`, or `Unspecified`[^1].

### **Low-Level Execution Flow of DateTime.UtcNow**

The `DateTime.UtcNow` property represents Coordinated Universal Time and is engineered for minimal CPU cycle consumption[^2]. When a process accesses `DateTime.UtcNow`, the .NET runtime performs a direct read from the system's hardware timer[^2]:

- On **Windows**, the runtime directly invokes the Win32 API function `GetSystemTimeAsFileTime` through an intrinsic function pointer attributed to bypass compilation optimization barriers (`TargetedPatchingOptOut`)[^2].
- On **POSIX** operating systems (including the Linux kernel on Android and the Darwin kernel on iOS/macOS), the system executes the low-level call `clock_gettime(CLOCK_REALTIME, ...)`[^5].

The raw timestamp returned by the OS only needs a fixed epoch offset added to align with the Gregorian calendar baseline, after which it is packed directly into a `DateTime` struct tagged with `DateTimeKind.Utc`[^2]. This path requires no lookup table resolution, performs zero heap allocations, and completes in a few nanoseconds[^2].

### **Complex Resolution Flow of DateTime.Now**

In contrast to `DateTime.UtcNow`, determining local time (`DateTime.Now`) requires a complex chain of conversion operations[^2]. The `DateTime.Now` property does not read an independent local clock from hardware; instead, it is built entirely on top of `DateTime.UtcNow` combined with a sequence of time zone offset calculations[^2]:

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

This process begins by fetching the current UTC time and then querying `TimeZoneInfo.Local` to resolve the device's time zone configuration[^2]. The primary source of overhead lies in `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc`, where the runtime must cross-reference the current timestamp against time zone *Adjustment Rules* and *Daylight Saving Time (DST)* definitions to determine whether the current instant falls within a one-hour offset window[^2].

Once the exact offset in Ticks is calculated, the runtime adds it to `utcNow.Ticks`, performs boundary overflow checks, and constructs a new `DateTime` instance tagged with `DateTimeKind.Local`[^2].

Performance profiling data from the official .NET Runtime repository breaks down the exact execution time distribution of `DateTime.get_Now()`[^4]:

| Execution Component in `System.DateTime.get_Now()` | Inclusive Execution Time (%) | Technical Nature of the Operation |
| :--- | :---: | :--- |
| `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc` | **88.1%** | Time zone rule lookup, DST flag evaluation, offset calculation[^4] |
| `System.DateTime.get_UtcNow()` | **5.8%** | System call (syscall) reading the hardware timer[^2] |
| Boundary checks and struct packing | **6.1%** | 64-bit integer overflow validation and `DateTimeKind.Local` tagging[^4][^7] |

> [!IMPORTANT]
> These figures demonstrate that reading the actual time from the hardware clock accounts for only **~5.8%** of total execution cost, whereas up to **~88.1%** of CPU time is spent resolving time zone rules and evaluating Daylight Saving Time[^4].

### **Amplified Complexity on Mobile Environments (Mono & IL2CPP)**

On mobile platforms running Unity via Mono or IL2CPP, the complexity of `DateTime.Now` is compounded even further[^5]. While Windows maintains a centralized Registry for time zone metadata, mobile operating systems such as Android store this data inside the binary `tzdata` database (`ZoneInfoDB`) located across system directories such as `/apex/com.android.tzdata/` or `/system/usr/share/zoneinfo`[^5].

When `TimeZoneInfo.Local` is initialized for the first time or needs revalidation, the Mono/IL2CPP runtime must perform file I/O, parse binary zone data, or even execute cross-runtime calls over the Java Native Interface (JNI) to `java.util.TimeZone` to retrieve the time zone identifier[^5].

> [!WARNING]
> If the time zone database file is malformed, relocated on custom ROMs, or restricted by file permissions, calling `DateTime.Now` can throw a critical `System.TimeZoneNotFoundException`, causing an abrupt application crash if left unhandled[^10].

---

## **2. Performance Benchmarking and Frame Budget Impact Analysis**

The execution cost of time-retrieval APIs varies dramatically depending on the underlying architecture and OS cache state[^5]. The table below summarizes normalized benchmark metrics across common timing mechanisms in Unity and .NET[^4]:

| Time Retrieval Method | Estimated Execution Time | Relative Speed Ratio | Core Execution Mechanism | Frame Spike Risk |
| :--- | :---: | :---: | :--- | :--- |
| `UnityEngine.Time.time` | $\sim 1\text{ - }2\text{ ns}$ | Fastest (Engine Native) | Directly reads a floating-point field cached at frame start | None |
| `System.DateTime.UtcNow` | $\sim 15\text{ - }20\text{ ns}$ | $\sim 15\text{ - }20\times$ faster than `Now` | Direct hardware clock read via minimal system call[^2] | Negligible |
| `System.DateTime.Now` (Warm Path) | $\sim 280\text{ - }350\text{ ns}$ | Baseline ($1\times$) | Calls UtcNow, reads time zone cache, computes DST offset[^2] | Medium to High if called repeatedly |
| `System.DateTime.Now` (Cold Path / Mobile) | $\sim 1\text{ - }5\text{ ms}$ | Thousands of times slower ($\gt 3.000\times$) | Initializes AndroidTzData tables, disk I/O, binary parsing[^5] | Very High (Frame Freeze) |

### **Frame Budget Constraints in the Game Loop**

In real-time interactive applications, the entire per-frame workload—including locomotion simulation, physics, gameplay logic, and GPU draw-call submission—must complete within a finite time budget defined by:

$$
T_{\text{frame}} = \frac{1000\text{ ms}}{\text{Target FPS}}
$$

- At a standard **$60\text{ Hz}$** ($60\text{ FPS}$) refresh rate, the budget per frame is **$16.67\text{ ms}$**.
- This shrinks to just **$8.33\text{ ms}$** on high-refresh-rate **$120\text{ Hz}$** ($120\text{ FPS}$) displays.

A codebase with scattered `DateTime.Now` calls inside entity update loops—such as skill cooldown timers for dozens of NPCs, buff duration checks, or real-time event evaluators—accumulates hundreds to thousands of system calls every frame.

With **500 warm `DateTime.Now` calls** per frame, the CPU spends approximately **$\sim 0.15\text{ ms}$** ($150\,\mu\text{s}$) solely on time zone offset calculations, consuming up to **$\sim 1.8\%$** of the entire **$120\text{ Hz}$** frame budget. This overhead directly contributes to frame drops and localized stuttering, explaining why Unity Project Auditor flags `DateTime.Now` usage in hot update paths as a high-severity warning (*Major Issue*)[^3].

---

## **3. Temporal Tearing and Data Integrity Failures**

Beyond CPU degradation, scattering `DateTime.Now` calls to extract individual components of a timestamp introduces a severe *Data Atomicity* bug. Legacy code falls into this trap when performing sequential independent comparisons:

```csharp
if (requirement.CheckYear)   results.Add(DateTime.Now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(DateTime.Now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(DateTime.Now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(DateTime.Now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(DateTime.Now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(DateTime.Now.Second == requirement.Second);
```

### **Mechanism Behind Anomalous Hybrid States**

By design, `DateTime.Now` is a property getter that computes a value dependent on the wall-clock state at the exact instant of invocation, rather than a static field[^20]. Every time code reads a sub-property such as `.Year`, `.Month`, or `.Day`, the runtime executes an entirely separate OS query cycle[^2].

Although only a few microseconds separate consecutive lines of code, execution can be preempted by the OS thread scheduler's time-slicing mechanism, or the execution window can straddle a natural rollover boundary of the system clock[^8].

> [!CAUTION]
> **Boundary Edge-Case Scenario:**  
> Suppose the thread executes the month check at `23:59:59.999` on August 31, 2024. `DateTime.Now.Month` evaluates against this instant and returns **August (8)**.  
>  
> Immediately after this instruction completes and before the day check executes, the system clock rolls over to `00:00:00.000` on September 1, 2024. When `DateTime.Now.Day` runs, the OS supplies the new timestamp and the property returns **day 1**.  
>  
> As a result, the game logic captures a nonsensical hybrid state: **August 1**—a point in time that never actually existed in physical reality!

If this corrupted timestamp drives limited-time event triggers, daily login reward validation, or in-game transaction logs, the mismatch can break conditional checks, lock features unintentionally, or allow players to claim duplicate rewards.

---

## **4. Technical Evaluation of the Frame Caching Solution**

To eliminate redundant computation and prevent temporal tearing altogether, the optimal solution is to apply *Frame Caching* (*Per-frame Memoization*), using Unity Engine's frame counter (`UnityEngine.Time.frameCount`) as the cache invalidation key[^22].

### **Execution Flow Analysis of the Frame Cache**

The caching implementation is structured as follows:

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

Whenever time-validation logic needs to evaluate conditions, the timestamp is fetched once into a local variable and reused across every subsequent check:

```csharp
DateTime now = GetCurrentSystemTime();  
if (requirement.CheckYear)   results.Add(now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(now.Second == requirement.Second);
```

This mechanism delivers two decisive improvements:

1. **Reduced Computational Complexity:** Scales down from $\mathcal{O}(N)$ linear complexity proportional to entity count to constant $\mathcal{O}(1)$ complexity per rendered frame. Every query after the first call in a frame simply reads the cached 64-bit `DateTime` struct from static memory, completely bypassing OS syscalls and time zone calculations[^2].
2. **Preserved Snapshot Atomicity:** The `now` variable acts as an immutable time slice for the entire frame, guaranteeing that every component from year down to second is mutually consistent and immune to OS scheduling interruptions.

### **Boundary Limitations and Real-World Deployment Risks**

While per-frame caching completely solves the issue on Unity's main thread, deploying it across large-scale architectures requires careful attention to three critical technical constraints:

1. **Main Thread Affinity:** `UnityEngine.Time.frameCount` is an internal C++ engine API strictly bound to the main thread[^24]. If a background process—such as a `Task.Run` worker, an asynchronous network callback, or a C# Job System task—invokes `GetCurrentSystemTime()`, Unity immediately throws `UnityException: get_frameCount can only be called from the main thread` and aborts execution[^24].
2. **Cadence Mismatch Between Update and FixedUpdate:** Unity's execution lifecycle maintains two independent loops: the graphics rendering loop (`Update`) and the fixed-timestep physics simulation loop (`FixedUpdate`)[^25]. `Time.frameCount` increments only once per rendered frame[^22]. When a client experiences a frame rate drop, the engine may execute multiple consecutive `FixedUpdate` steps within a single render frame to catch up with physics simulation[^23]. Every `FixedUpdate` step occurring in that same render frame will read the identical cached `_cachedSystemTime`, which may fail to reflect elapsed time across consecutive physics steps[^26].
3. **Data Race Risks:** Accessing static global fields `_cachedSystemTime` and `_lastSystemTimeFrame` without memory barriers or synchronization locks exposes the system to data races if worker threads read or write concurrently on multi-core CPUs with out-of-order execution.

### **Implementing a Thread-Safe System Time Provider**

To address all three constraints above, time retrieval should be standardized into a dedicated provider service capable of detecting thread execution context, ensuring safe access, and gracefully falling back on edge cases:

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

This architecture guarantees that the main thread always benefits from per-frame caching without redundant overhead, while background threads and Editor mode remain completely stable via direct fallback, eliminating any possibility of main-thread access violations[^24].

---

## **5. Time Domain Separation Standards in Game Engine Architecture**

A common mistake in game development is conflating distinct timing requirements under a single system API[^2]. To sustain peak performance and state consistency, system architecture should enforce clear boundaries between independent time domains:

| Time Domain | Recommended Standard API | Primary Use Cases | Risk of Using the Wrong API |
| :--- | :--- | :--- | :--- |
| **Internal Gameplay Simulation** | `UnityEngine.Time.time`, `Time.deltaTime` | Physics coordinates, character movement, skill cooldowns | Freezes when paused (`timeScale = 0`); inaccurate if wall-clock time is required[^26] |
| **Real-Time UI Presentation** | `UnityEngine.Time.unscaledTime`, `Time.realtimeSinceStartup` | Menu UI animations, transition effects while gameplay is paused | Tied to the client process session; cannot map to real-world calendar time |
| **Algorithm Benchmarking** | `System.Diagnostics.Stopwatch` | Measuring algorithm runtime, profiling code blocks, detecting performance regressions[^7] | `DateTime.Now` resolution is only $\sim 15.6\text{ ms}$, far too coarse for benchmarking[^7] |
| **Anti-Cheat Validation** | Server-synchronized Unix Epoch (UTC)[^28] | Energy systems, chest timers, online event windows[^28] | Trusting the client clock lets players manipulate OS time to exploit rewards[^28] |
| **Local Calendar Display** | `SystemTimeProvider.CurrentLocalTime` | Displaying the player's local wall-clock time in UI status bars[^2] | Causes frame stuttering if uncached `DateTime.Now` is called continuously[^2] |

### **Server Time Synchronization and Anti-Cheat Mechanisms**

For games with online features, allowing the client to validate action timestamps using local `DateTime.Now` or `DateTime.UtcNow` introduces a severe security vulnerability[^28]. Players can trivially adjust their OS clock settings to fast-forward building timers or reset daily cooldowns[^28].

A robust architecture to neutralize time-manipulation exploits requires establishing a virtual wall clock anchored to a *monotonic clock*[^5]:

1. **Send a Sync Request:** When the client establishes a network connection, it sends a time-sync request to the backend server to obtain the authoritative UTC Unix Epoch timestamp[^28].
2. **Measure Round-Trip Latency:** The client records the packet's round-trip time ($RTT$) and estimates the server's true time at the moment the response arrives using:
   $$T_{\text{server}} = T_{\text{server\_reply}} + \frac{RTT}{2}$$
3. **Compute the Monotonic Offset:** The client calculates and stores the fixed offset relative to the hardware monotonic counter:
   $$\Delta t = T_{\text{server}} - \text{Time.realtimeSinceStartupAsDouble}$$
4. **Query Cheat-Resistant Time:** Throughout the application lifecycle, any gameplay logic checking real-world time simply evaluates:
   $$\text{CurrentRealTime} = \text{Time.realtimeSinceStartupAsDouble} + \Delta t$$
   Because the engine's startup timer is backed by a hardware monotonic clock (`clock_gettime(CLOCK_MONOTONIC)` or `QueryPerformanceCounter`), this value advances strictly linearly and is completely immune to OS calendar clock tampering[^5].

### **Modernizing Architecture with TimeProvider (.NET 8+)**

Starting with .NET 8, Microsoft formally refactored time management by introducing the `System.TimeProvider` abstraction to replace direct static calls such as `DateTime.Now` and `DateTime.UtcNow`[^20]. In modern Unity projects, developers can adopt this pattern via the `Microsoft.Bcl.TimeProvider` compatibility package to improve code modularity[^32]:

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

Transitioning to this abstraction yields two major engineering advantages:

> [!TIP]
> 1. **Isolated Unit Testing:** Enables comprehensive unit testing[^20]. Engineers can inject a `FakeTimeProvider` mock into business logic to deterministically simulate tricky boundary jumps (such as DST transitions or New Year's Eve rollovers) without waiting for real time to pass or mutating the host OS clock[^20].  
> 2. **Type-Safe `DateTimeOffset`:** `GetLocalNow()` returns a `DateTimeOffset` struct rather than `DateTime`[^20]. `DateTimeOffset` permanently pairs the timestamp with an explicit UTC offset, eliminating the ambiguity of `DateTimeKind.Unspecified` and preserving integrity during network serialization[^1].

---

## **5. Practical Implementation: Optimizing the RequirementsManager System (Case Study)**

In a production project built on the RPG Builder framework (Project GLW), a major performance bottleneck was uncovered inside `RequirementsManager.cs`. Specifically, the game's time-condition evaluator (for example, checking whether an event occurs on a specific month, day, or hour) repeatedly invoked `DateTime.Now` across disjoint checks:

```csharp
if(requirement.CheckYear) results.Add(DateTime.Now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(DateTime.Now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(DateTime.Now.Day == requirement.Day);
// ... Lặp lại cho Hour, Minute, Second
```

**Issues identified in the legacy codebase:**
1. **Severe CPU Overhead:** Evaluating a single requirement could trigger 7–10 `DateTime.Now` calls (including inside helper methods like `GetWeekNumber()`). With 100 entities evaluating requirements simultaneously, thousands of OS syscalls occurred every frame, creating a major CPU bottleneck.
2. **Temporal Tearing:** If a second, minute, or day boundary rollover occurred mid-evaluation (for example, at millisecond 999), `Month` could be read from the outgoing month while `Day` was read from the incoming day, synthesizing an impossible calendar date.

**Implemented production solution (Per-Frame Caching):**
Frame Caching was integrated directly using `Time.frameCount` as the cache invalidation flag, leveraging a static lifecycle instead of an `Update` loop:

```csharp
private static DateTime _cachedSystemTime;
private static int _lastSystemTimeFrame = -1;

private static DateTime GetCurrentSystemTime()
{
    if (Application.isPlaying) 
    {
        int currentFrame = Time.frameCount;
        
        // Chỉ lấy giờ thật từ OS 1 lần duy nhất mỗi khung hình
        if (_lastSystemTimeFrame != currentFrame)
        {
            _lastSystemTimeFrame = currentFrame;
            _cachedSystemTime = DateTime.Now; 
        }
        
        return _cachedSystemTime;
    }
    return DateTime.Now; // Chế độ Editor
}
```

At every evaluation site, all conditional checks reference a single time **snapshot**:

```csharp
DateTime now = GetCurrentSystemTime();
if(requirement.CheckYear) results.Add(now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(now.Day == requirement.Day);
```

**Post-optimization results (`MOD-RPGB-008` patch):** 
- **Complete elimination of redundant syscalls:** Instead of thousands of calls, `DateTime.Now` is reduced to $\mathcal{O}(1)$—invoked strictly once per frame across all evaluations.
- **Absolute atomic consistency:** `Year`, `Month`, and `Day` are guaranteed to originate from the exact same instant.
- **Clean Unity Project Auditor report:** Completely cleared the "Major" system performance warning related to `System.DateTime`.

---

## **6. Conclusion**

Calling `System.DateTime.Now` directly inside high-frequency update loops in Unity Engine poses a serious engineering problem for both hardware performance and gameplay logic integrity[^3].

- The complexity of time zone rule lookups and Daylight Saving Time (DST) evaluation consumes over **88%** of the property's execution time, placing direct pressure on the game engine's frame budget[^4].
- Simultaneously, reading multiple sub-properties from separate `DateTime.Now` calls exposes the codebase to *temporal tearing*, producing hybrid timestamps that corrupt gameplay state[^21].

Combining **Frame Caching** with `Time.frameCount` resolves both issues cleanly by reducing CPU overhead to a constant **$\mathcal{O}(1)$** per frame while guaranteeing immutable snapshot atomicity[^22].

When deploying at commercial scale, this architecture should be reinforced with main-thread affinity protection (`SystemTimeProvider`), paired with *Server-Authoritative Time* validation for anti-cheat integrity, and aligned toward the `TimeProvider` abstraction to meet modern software engineering standards[^20].

---

## **References**

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
