(function () {
  "use strict";

  var STORAGE_KEY = "lgs_lang";
  var config = window.__LGS_I18N__;
  if (!config) return;

  var DEFAULT_LANG = config.defaultLang || "en";
  var SUPPORTED = ["en", "vi"];
  var postByPath = Object.create(null);

  function normalizePath(urlStr) {
    if (!urlStr) return "";
    try {
      var u = new URL(urlStr, window.location.origin);
      var p = u.pathname.replace(/\/+$/, "");
      return p || "/";
    } catch (_) {
      return String(urlStr).replace(/\/+$/, "") || "/";
    }
  }

  (config.posts || []).forEach(function (post) {
    var norm = normalizePath(post.url);
    if (norm) postByPath[norm] = post;
  });

  function getQueryLang() {
    try {
      var params = new URLSearchParams(window.location.search);
      var q = params.get("lang");
      if (q && SUPPORTED.indexOf(q) !== -1) return q;
    } catch (_) {}
    return null;
  }

  function getSavedLang() {
    try {
      var saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    } catch (_) {}
    return null;
  }

  function saveLang(lang) {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {}
  }

  function findCounterpart(translationId, currentUrl) {
    if (!translationId) return null;
    var currentNorm = normalizePath(currentUrl);
    for (var i = 0; i < (config.posts || []).length; i++) {
      var p = config.posts[i];
      if (p.id === translationId && normalizePath(p.url) !== currentNorm) {
        return p;
      }
    }
    return null;
  }

  function resolveInitialLang() {
    var page = config.page || {};
    if (page.layout === "post" && page.lang && SUPPORTED.indexOf(page.lang) !== -1) {
      return page.lang;
    }
    var q = getQueryLang();
    if (q) {
      saveLang(q);
      return q;
    }
    var saved = getSavedLang();
    if (saved) return saved;
    return DEFAULT_LANG;
  }

  var activeLang = resolveInitialLang();

  function buildSteamUrl(medium, campaign, lang) {
    var gw = config.gilongworld || {};
    var base = gw.steam_url || "https://store.steampowered.com/app/4615990/GilongWorld";
    var sep = base.indexOf("?") === -1 ? "?" : "&";
    return (
      base +
      sep +
      "utm_source=devlog" +
      "&utm_medium=" + encodeURIComponent(medium) +
      "&utm_campaign=" + encodeURIComponent(campaign || "blog") +
      "&utm_content=" + encodeURIComponent(lang || activeLang)
    );
  }

  function createSwitcherElement(extraClass) {
    var wrap = document.createElement("div");
    wrap.className = "lgs-lang-switcher" + (extraClass ? " " + extraClass : "");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Language Switcher");

    var options = [
      { code: "en", label: "EN", flag: "🇬🇧", title: "English" },
      { code: "vi", label: "VI", flag: "🇻🇳", title: "Tiếng Việt" }
    ];

    options.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lgs-lang-btn" + (activeLang === opt.code ? " is-active" : "");
      btn.setAttribute("data-lgs-lang", opt.code);
      btn.setAttribute("title", opt.title);
      btn.textContent = opt.flag + " " + opt.label;
      btn.addEventListener("click", function () {
        handleLanguageSwitch(opt.code);
      });
      wrap.appendChild(btn);
    });

    return wrap;
  }

  function syncSwitcherButtons() {
    var buttons = document.querySelectorAll(".lgs-lang-btn[data-lgs-lang]");
    buttons.forEach(function (btn) {
      var code = btn.getAttribute("data-lgs-lang");
      if (code === activeLang) {
        btn.classList.add("is-active");
      } else {
        btn.classList.remove("is-active");
      }
    });
  }

  function handleLanguageSwitch(targetLang) {
    if (SUPPORTED.indexOf(targetLang) === -1) return;
    saveLang(targetLang);

    var page = config.page || {};
    if (page.layout === "post") {
      if (page.lang === targetLang) return;
      var counterpart = findCounterpart(page.translationId, page.url);
      if (counterpart && counterpart.url) {
        window.location.href = counterpart.url;
        return;
      }
    }

    activeLang = targetLang;
    document.documentElement.setAttribute("lang", activeLang);
    syncSwitcherButtons();
    applyLanguageFilter();
    updateSidebarCardText();
  }

  function filterCollectionList(selector, linkSelector) {
    var items = document.querySelectorAll(selector);
    var visibleCount = 0;
    items.forEach(function (item) {
      var link = linkSelector ? item.querySelector(linkSelector) : item.querySelector("a");
      if (!link) return;
      var norm = normalizePath(link.getAttribute("href"));
      var meta = postByPath[norm];
      if (!meta) return;
      if (meta.lang === activeLang) {
        item.classList.remove("lgs-lang-hidden");
        visibleCount++;
      } else {
        item.classList.add("lgs-lang-hidden");
      }
    });
    return visibleCount;
  }

  function applyLanguageFilter() {
    // 1. Homepage post cards (#post-list)
    filterCollectionList("#post-list article.card-wrapper", "a.post-preview, h1 a, a[href*='/posts/']");

    // 1b. Right-panel "Recently Updated" (#access-lastmod)
    filterCollectionList("#access-lastmod ul li", "a");

    // 2. Archives (#archives)
    var archives = document.getElementById("archives");
    if (archives) {
      var yearLists = archives.querySelectorAll("ul");
      yearLists.forEach(function (ul) {
        var visibleInYear = 0;
        ul.querySelectorAll("li").forEach(function (li) {
          var link = li.querySelector("a");
          if (!link) return;
          var meta = postByPath[normalizePath(link.getAttribute("href"))];
          if (!meta) return;
          if (meta.lang === activeLang) {
            li.classList.remove("lgs-lang-hidden");
            visibleInYear++;
          } else {
            li.classList.add("lgs-lang-hidden");
          }
        });
        var prev = ul.previousElementSibling;
        if (visibleInYear === 0) {
          ul.classList.add("lgs-lang-hidden");
          if (prev && prev.classList.contains("year")) {
            prev.classList.add("lgs-lang-hidden");
          }
        } else {
          ul.classList.remove("lgs-lang-hidden");
          if (prev && prev.classList.contains("year")) {
            prev.classList.remove("lgs-lang-hidden");
          }
        }
      });
    }

    // 3. Category & Tag post lists
    var pageLayout = (config.page || {}).layout;
    if (pageLayout === "category" || pageLayout === "tag") {
      var count = filterCollectionList("#page-category ul.content li, #page-tag ul.content li, main ul.content li", "a");
      var badge = document.querySelector("main h1 span.lead");
      if (badge && count >= 0) {
        badge.textContent = String(count);
      }
    }

    // 4. Related Posts on a Post page
    var postLang = (config.page || {}).layout === "post" ? ((config.page || {}).lang || activeLang) : activeLang;
    var related = document.getElementById("related-posts");
    if (related) {
      var relatedCards = related.querySelectorAll("article.card");
      var visibleRelated = 0;
      relatedCards.forEach(function (card) {
        var link = card.querySelector("a");
        if (!link) return;
        var meta = postByPath[normalizePath(link.getAttribute("href"))];
        if (!meta) return;
        var col = card.closest(".col") || card;
        if (meta.lang === postLang) {
          col.classList.remove("lgs-lang-hidden");
          visibleRelated++;
        } else {
          col.classList.add("lgs-lang-hidden");
        }
      });
      if (relatedCards.length > 0 && visibleRelated === 0) {
        related.classList.add("lgs-lang-hidden");
      } else {
        related.classList.remove("lgs-lang-hidden");
      }
    }

    // 5. Search results (#search-results > article)
    filterCollectionList("#search-results article", "h2 a, a");

    // 6. Explicit bilingual content sections (e.g. /about/)
    document.querySelectorAll("[data-lang-section]").forEach(function (sec) {
      var secLang = sec.getAttribute("data-lang-section");
      if (secLang === activeLang) {
        sec.style.display = "";
        sec.classList.remove("lgs-lang-hidden");
      } else {
        sec.style.display = "none";
        sec.classList.add("lgs-lang-hidden");
      }
    });
  }

  function observeSearchResults() {
    var container = document.getElementById("search-results");
    if (!container || typeof MutationObserver === "undefined") return;
    var observer = new MutationObserver(function () {
      filterCollectionList("#search-results article", "h2 a, a");
    });
    observer.observe(container, { childList: true });
  }

  function injectTopbarSwitcher() {
    var topbar = document.getElementById("topbar");
    if (!topbar || document.getElementById("lgs-topbar-switcher")) return;

    var switcher = createSwitcherElement("lgs-topbar-switcher");
    switcher.id = "lgs-topbar-switcher";

    var searchTrigger = document.getElementById("search-trigger");
    var searchEl = document.getElementById("search");
    if (searchTrigger && searchTrigger.parentNode === topbar) {
      topbar.insertBefore(switcher, searchTrigger);
    } else if (searchEl && searchEl.parentNode === topbar) {
      topbar.insertBefore(switcher, searchEl);
    } else {
      topbar.appendChild(switcher);
    }
  }

  function getSidebarCopy(lang) {
    if (lang === "vi") {
      return {
        badge: "Sci-Fi ARPG",
        desc: "Game hành động nhập vai kết hợp luyện dược, thuần hóa sinh vật & xây căn cứ trên Unity 6.",
        steam: "🎮 Wishlist Steam",
        discord: "💬 Discord"
      };
    }
    return {
      badge: "Sci-Fi ARPG",
      desc: "Indie Action RPG with Alchemy, Creature Taming & Base Building — engineered in Unity 6.",
      steam: "🎮 Wishlist on Steam",
      discord: "💬 Discord"
    };
  }

  function updateSidebarCardText() {
    var card = document.getElementById("lgs-sidebar-card");
    if (!card) return;
    var copy = getSidebarCopy(activeLang);
    var descEl = card.querySelector(".lgs-sidebar-card-desc");
    var steamEl = card.querySelector(".lgs-mini-btn-steam");
    var discordEl = card.querySelector(".lgs-mini-btn-discord");
    if (descEl) descEl.textContent = copy.desc;
    if (steamEl) {
      steamEl.textContent = copy.steam;
      steamEl.href = buildSteamUrl("sidebar_card", (config.page || {}).translationId || "sidebar", activeLang);
    }
    if (discordEl) discordEl.textContent = copy.discord;
  }

  function injectSidebarBlock() {
    var sidebar = document.getElementById("sidebar");
    if (!sidebar || document.getElementById("lgs-sidebar-block")) return;

    var gw = config.gilongworld || {};
    var copy = getSidebarCopy(activeLang);

    var block = document.createElement("div");
    block.id = "lgs-sidebar-block";
    block.className = "lgs-sidebar-block";

    var switcherWrap = document.createElement("div");
    switcherWrap.className = "lgs-sidebar-switcher-wrap";
    switcherWrap.appendChild(createSwitcherElement("lgs-sidebar-switcher"));
    block.appendChild(switcherWrap);

    var card = document.createElement("div");
    card.id = "lgs-sidebar-card";
    card.className = "lgs-sidebar-card";

    var titleRow = document.createElement("div");
    titleRow.className = "lgs-sidebar-card-title";
    var titleSpan = document.createElement("span");
    titleSpan.textContent = "GilongWorld";
    var badgeSpan = document.createElement("span");
    badgeSpan.className = "lgs-sidebar-card-badge";
    badgeSpan.textContent = copy.badge;
    titleRow.appendChild(titleSpan);
    titleRow.appendChild(badgeSpan);

    var desc = document.createElement("p");
    desc.className = "lgs-sidebar-card-desc";
    desc.textContent = copy.desc;

    var actions = document.createElement("div");
    actions.className = "lgs-sidebar-card-actions";

    var steamBtn = document.createElement("a");
    steamBtn.className = "lgs-mini-btn lgs-mini-btn-steam";
    steamBtn.href = buildSteamUrl("sidebar_card", (config.page || {}).translationId || "sidebar", activeLang);
    steamBtn.target = "_blank";
    steamBtn.rel = "noopener noreferrer";
    steamBtn.textContent = copy.steam;

    var discordBtn = document.createElement("a");
    discordBtn.className = "lgs-mini-btn lgs-mini-btn-discord";
    discordBtn.href = gw.discord_url || "https://discord.gg/DbzpYe5T2P";
    discordBtn.target = "_blank";
    discordBtn.rel = "noopener noreferrer";
    discordBtn.textContent = copy.discord;

    actions.appendChild(steamBtn);
    actions.appendChild(discordBtn);

    card.appendChild(titleRow);
    card.appendChild(desc);
    card.appendChild(actions);
    block.appendChild(card);

    var bottom = sidebar.querySelector(".sidebar-bottom");
    if (bottom && bottom.parentNode === sidebar) {
      sidebar.insertBefore(block, bottom);
    } else {
      sidebar.appendChild(block);
    }
  }

  function injectPostMarketingAndLanguageBars() {
    var page = config.page || {};
    if (page.layout !== "post") return;

    var contentEl = document.querySelector("article .content");
    if (!contentEl) return;

    var postLang = page.lang || "vi";
    var counterpart = findCounterpart(page.translationId, page.url);
    var gw = config.gilongworld || {};

    // Touchpoint A: Top-of-post language switch & GilongWorld Devlog badge
    if (!document.getElementById("lgs-post-top-bar")) {
      var topBar = document.createElement("div");
      topBar.id = "lgs-post-top-bar";
      topBar.className = "lgs-post-top-bar";

      var topRow = document.createElement("div");
      topRow.className = "lgs-post-top-row";

      if (counterpart && counterpart.url) {
        var langLink = document.createElement("a");
        langLink.className = "lgs-post-lang-switch-link";
        langLink.href = counterpart.url;
        langLink.textContent =
          postLang === "en"
            ? "🇻🇳 Đọc bản Tiếng Việt: " + counterpart.title
            : "🇬🇧 Read in English: " + counterpart.title;
        topRow.appendChild(langLink);
      }

      var devlogPill = document.createElement("a");
      devlogPill.className = "lgs-post-devlog-pill";
      devlogPill.href = buildSteamUrl("post_top_badge", page.translationId, postLang);
      devlogPill.target = "_blank";
      devlogPill.rel = "noopener noreferrer";
      devlogPill.innerHTML =
        postLang === "vi"
          ? "🎮 Nghiên cứu từ dự án <strong>GilongWorld</strong> (Sci-Fi Action RPG • Unity 6) → Wishlist trên Steam"
          : "🎮 Engineering Devlog from <strong>GilongWorld</strong> (Sci-Fi Action RPG • Unity 6) → Wishlist on Steam";

      topBar.appendChild(topRow);
      topBar.appendChild(devlogPill);

      contentEl.parentNode.insertBefore(topBar, contentEl);
    }

    // Touchpoint C: Bottom-of-post GilongWorld Steam Wishlist Conversion Card
    if (!document.getElementById("lgs-steam-cta-card")) {
      var card = document.createElement("aside");
      card.id = "lgs-steam-cta-card";
      card.className = "lgs-steam-cta-card";
      card.setAttribute("aria-label", "GilongWorld on Steam");

      var isVi = postLang === "vi";
      var steamHref = buildSteamUrl("post_footer_cta", page.translationId, postLang);
      var capsuleSrc = gw.capsule_image || "/assets/img/steam/Header_Capsule_920x430.png";

      card.innerHTML =
        '<div class="lgs-steam-cta-grid">' +
          '<a class="lgs-steam-cta-media" href="' + steamHref + '" target="_blank" rel="noopener noreferrer">' +
            '<img src="' + capsuleSrc + '" alt="GilongWorld Sci-Fi Action RPG on Steam">' +
          "</a>" +
          '<div class="lgs-steam-cta-body">' +
            '<div class="lgs-steam-cta-kicker">' +
              (isVi ? "DỰ ÁN TỪ LONG GIL STUDIO" : "BUILT BY LONG GIL STUDIO") +
            "</div>" +
            '<div class="lgs-steam-cta-title" role="heading" aria-level="3" data-toc-skip>' +
              (isVi
                ? "Khám phá GilongWorld — Tựa Game Ứng Dụng Kiến Trúc Này"
                : "Discover GilongWorld — Powered by This Architecture") +
            "</div>" +
            '<p class="lgs-steam-cta-desc">' +
              (isVi
                ? "Mọi giải pháp kiến trúc và tối ưu hóa Unity 6 trên blog đều được nghiên cứu trực tiếp cho <strong>GilongWorld</strong> — tựa game Sci-Fi Action RPG kết hợp Luyện dược, Thuần hóa sinh vật và Xây dựng căn cứ. Ủng hộ studio bằng một lượt Wishlist trên Steam nhé!"
                : "Every Unity 6 optimization and architecture deep-dive on this devlog is engineered directly for <strong>GilongWorld</strong> — our upcoming Sci-Fi Action RPG featuring Alchemy, Creature Taming, and Base Building. Support our indie team by adding it to your Steam Wishlist!") +
            "</p>" +
            '<div class="lgs-steam-cta-actions">' +
              '<a class="lgs-steam-btn-primary" href="' + steamHref + '" target="_blank" rel="noopener noreferrer">' +
                (isVi ? "🎮 Wishlist GilongWorld trên Steam" : "🎮 Wishlist GilongWorld on Steam") +
              "</a>" +
              '<a class="lgs-steam-btn-secondary" href="' + (gw.discord_url || "https://discord.gg/DbzpYe5T2P") + '" target="_blank" rel="noopener noreferrer">' +
                (isVi ? "💬 Tham gia Discord" : "💬 Join Discord") +
              "</a>" +
              '<a class="lgs-steam-btn-secondary" href="' + (gw.youtube_url || "https://www.youtube.com/@LongGilStudio") + '" target="_blank" rel="noopener noreferrer">' +
                "📺 YouTube" +
              "</a>" +
              '<a class="lgs-steam-btn-secondary" href="' + (gw.website_url || "https://longgilstudio.com") + '" target="_blank" rel="noopener noreferrer">' +
                "🌐 Studio" +
              "</a>" +
            "</div>" +
          "</div>" +
        "</div>";

      // Insert right before References / Tài liệu Tham khảo heading, or before .footnotes, or at end of .content
      var headings = contentEl.querySelectorAll("h2");
      var refHeading = null;
      headings.forEach(function (h2) {
        if (refHeading) return;
        var t = (h2.textContent || "").trim().toLowerCase();
        if (
          t.indexOf("tài liệu tham khảo") !== -1 ||
          t.indexOf("nguồn trích dẫn") !== -1 ||
          t.indexOf("references") !== -1 ||
          t.indexOf("bibliography") !== -1
        ) {
          refHeading = h2;
        }
      });

      var footnotesEl = contentEl.querySelector(".footnotes");
      if (refHeading) {
        var prevEl = refHeading.previousElementSibling;
        if (prevEl && prevEl.tagName === "HR") {
          contentEl.insertBefore(card, prevEl);
        } else {
          contentEl.insertBefore(card, refHeading);
        }
      } else if (footnotesEl) {
        contentEl.insertBefore(card, footnotesEl);
      } else {
        contentEl.appendChild(card);
      }
    }
  }

  function init() {
    document.documentElement.setAttribute("lang", activeLang);
    injectTopbarSwitcher();
    injectSidebarBlock();
    injectPostMarketingAndLanguageBars();
    applyLanguageFilter();
    observeSearchResults();
    syncSwitcherButtons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
