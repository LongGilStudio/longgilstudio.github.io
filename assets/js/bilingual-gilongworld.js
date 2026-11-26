(function () {
  "use strict";

  var STORAGE_KEY = "lgs_lang";
  var config = window.__LGS_I18N__;
  if (!config) return;

  var LANG_OPTIONS = [
    { code: "en", label: "EN", flag: "🇬🇧", name: "English" },
    { code: "vi", label: "VI", flag: "🇻🇳", name: "Tiếng Việt" },
    { code: "fr", label: "FR", flag: "🇫🇷", name: "Français" },
    { code: "it", label: "IT", flag: "🇮🇹", name: "Italiano" },
    { code: "de", label: "DE", flag: "🇩🇪", name: "Deutsch" },
    { code: "es", label: "ES", flag: "🇪🇸", name: "Español (España)" },
    { code: "pl", label: "PL", flag: "🇵🇱", name: "Polski" },
    { code: "pt-BR", label: "PT-BR", flag: "🇧🇷", name: "Português (Brasil)" },
    { code: "pt-PT", label: "PT-PT", flag: "🇵🇹", name: "Português (Portugal)" },
    { code: "ko", label: "KO", flag: "🇰🇷", name: "한국어" },
    { code: "ru", label: "RU", flag: "🇷🇺", name: "Русский" },
    { code: "ja", label: "JA", flag: "🇯🇵", name: "日本語" },
    { code: "tr", label: "TR", flag: "🇹🇷", name: "Türkçe" },
    { code: "zh-CN", label: "ZH-CN", flag: "🇨🇳", name: "简体中文" },
    { code: "zh-TW", label: "ZH-TW", flag: "🇹🇼", name: "繁體中文" }
  ];

  var LANG_BY_CODE = Object.create(null);
  var SUPPORTED = [];
  LANG_OPTIONS.forEach(function (opt) {
    LANG_BY_CODE[opt.code] = opt;
    SUPPORTED.push(opt.code);
  });

  var DEFAULT_LANG = LANG_BY_CODE[config.defaultLang] ? config.defaultLang : "en";

  var UI_COPY = {
    en: {
      badge: "Sci-Fi ARPG",
      sidebarDesc: "Indie Action RPG with Alchemy, Creature Taming & Base Building — engineered in Unity 6.",
      sidebarSteam: "🎮 Wishlist on Steam",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇬🇧 Read in English: ",
      originalVi: "🇻🇳 Vietnamese Original: ",
      devlogHtml: "🎮 Engineering Devlog from <strong>GilongWorld</strong> (Sci-Fi Action RPG • Unity 6) → Wishlist on Steam",
      ctaKicker: "BUILT BY LONG GIL STUDIO",
      ctaTitle: "Discover GilongWorld — Powered by This Architecture",
      ctaDescHtml: "Every Unity 6 optimization and architecture deep-dive on this devlog is engineered directly for <strong>GilongWorld</strong> — our upcoming Sci-Fi Action RPG featuring Alchemy, Creature Taming, and Base Building. Support our indie team by adding it to your Steam Wishlist!",
      ctaPrimary: "🎮 Wishlist GilongWorld on Steam",
      ctaDiscord: "💬 Join Discord",
      furtherReading: "Further Reading",
      older: "Older",
      newer: "Newer"
    },
    vi: {
      badge: "Sci-Fi ARPG",
      sidebarDesc: "Game hành động nhập vai kết hợp luyện dược, thuần hóa sinh vật & xây căn cứ trên Unity 6.",
      sidebarSteam: "🎮 Wishlist Steam",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇻🇳 Đọc bản Tiếng Việt: ",
      originalVi: "🇻🇳 Bản gốc Tiếng Việt: ",
      devlogHtml: "🎮 Nghiên cứu từ dự án <strong>GilongWorld</strong> (Sci-Fi Action RPG • Unity 6) → Wishlist trên Steam",
      ctaKicker: "DỰ ÁN TỪ LONG GIL STUDIO",
      ctaTitle: "Khám phá GilongWorld — Tựa Game Ứng Dụng Kiến Trúc Này",
      ctaDescHtml: "Mọi giải pháp kiến trúc và tối ưu hóa Unity 6 trên blog đều được nghiên cứu trực tiếp cho <strong>GilongWorld</strong> — tựa game Sci-Fi Action RPG kết hợp Luyện dược, Thuần hóa sinh vật và Xây dựng căn cứ. Ủng hộ studio bằng một lượt Wishlist trên Steam nhé!",
      ctaPrimary: "🎮 Wishlist GilongWorld trên Steam",
      ctaDiscord: "💬 Tham gia Discord",
      furtherReading: "Bài viết liên quan",
      older: "Cũ hơn",
      newer: "Mới hơn"
    },
    fr: {
      badge: "ARPG Sci-Fi",
      sidebarDesc: "Action-RPG indépendant mêlant alchimie, dressage de créatures et construction de base sous Unity 6.",
      sidebarSteam: "🎮 Liste de souhaits Steam",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇫🇷 Lire en français : ",
      originalVi: "🇻🇳 Original vietnamien : ",
      devlogHtml: "🎮 Devlog technique de <strong>GilongWorld</strong> (Action-RPG Sci-Fi • Unity 6) → Liste de souhaits Steam",
      ctaKicker: "CRÉÉ PAR LONG GIL STUDIO",
      ctaTitle: "Découvrez GilongWorld — Propulsé par cette architecture",
      ctaDescHtml: "Chaque optimisation Unity 6 et étude architecturale de ce devlog est conçue directement pour <strong>GilongWorld</strong>, notre Action-RPG Sci-Fi alliant alchimie, dressage de créatures et construction de base. Soutenez notre studio en l'ajoutant à votre liste de souhaits Steam !",
      ctaPrimary: "🎮 Ajouter GilongWorld sur Steam",
      ctaDiscord: "💬 Rejoindre Discord",
      furtherReading: "Lectures complémentaires",
      older: "Plus ancien",
      newer: "Plus récent"
    },
    it: {
      badge: "ARPG Sci-Fi",
      sidebarDesc: "Action-RPG indie con alchimia, addestramento creature e costruzione basi — sviluppato in Unity 6.",
      sidebarSteam: "🎮 Lista desideri Steam",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇮🇹 Leggi in italiano: ",
      originalVi: "🇻🇳 Originale vietnamita: ",
      devlogHtml: "🎮 Devlog tecnico di <strong>GilongWorld</strong> (Action-RPG Sci-Fi • Unity 6) → Lista desideri Steam",
      ctaKicker: "SVILUPPATO DA LONG GIL STUDIO",
      ctaTitle: "Scopri GilongWorld — Alimentato da questa architettura",
      ctaDescHtml: "Ogni ottimizzazione Unity 6 e analisi architetturale su questo devlog è progettata direttamente per <strong>GilongWorld</strong>, il nostro Action-RPG Sci-Fi con alchimia, addestramento di creature e costruzione di basi. Supporta il nostro team indie aggiungendolo alla tua Lista dei desideri su Steam!",
      ctaPrimary: "🎮 Aggiungi GilongWorld su Steam",
      ctaDiscord: "💬 Unisciti a Discord",
      furtherReading: "Letture consigliate",
      older: "Precedente",
      newer: "Successivo"
    },
    de: {
      badge: "Sci-Fi-ARPG",
      sidebarDesc: "Indie-Action-RPG mit Alchemie, Kreaturenzähmung & Basisbau — entwickelt mit Unity 6.",
      sidebarSteam: "🎮 Auf Steam wünschen",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇩🇪 Auf Deutsch lesen: ",
      originalVi: "🇻🇳 Vietnamesisches Original: ",
      devlogHtml: "🎮 Engineering-Devlog aus <strong>GilongWorld</strong> (Sci-Fi-Action-RPG • Unity 6) → Steam-Wunschliste",
      ctaKicker: "ENTWICKELT VON LONG GIL STUDIO",
      ctaTitle: "Entdecke GilongWorld — Angetrieben von dieser Architektur",
      ctaDescHtml: "Jede Unity-6-Optimierung und Architektur-Analyse in diesem Devlog wird direkt für <strong>GilongWorld</strong> entwickelt — unser kommendes Sci-Fi-Action-RPG mit Alchemie, Kreaturenzähmung und Basisbau. Unterstütze unser Indie-Team über deine Steam-Wunschliste!",
      ctaPrimary: "🎮 GilongWorld auf Steam wünschen",
      ctaDiscord: "💬 Discord beitreten",
      furtherReading: "Weitere Artikel",
      older: "Älter",
      newer: "Neuer"
    },
    es: {
      badge: "ARPG Sci-Fi",
      sidebarDesc: "Action-RPG indie con alquimia, doma de criaturas y construcción de bases — desarrollado en Unity 6.",
      sidebarSteam: "🎮 Lista de deseados Steam",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇪🇸 Leer en español: ",
      originalVi: "🇻🇳 Original en vietnamita: ",
      devlogHtml: "🎮 Devlog técnico de <strong>GilongWorld</strong> (Action-RPG Sci-Fi • Unity 6) → Lista de deseados en Steam",
      ctaKicker: "CREADO POR LONG GIL STUDIO",
      ctaTitle: "Descubre GilongWorld — Impulsado por esta arquitectura",
      ctaDescHtml: "Cada optimización de Unity 6 y análisis de arquitectura de este devlog se desarrolla directamente para <strong>GilongWorld</strong>, nuestro próximo Action-RPG de ciencia ficción con alquimia, doma de criaturas y construcción de bases. ¡Apoya a nuestro equipo indie añadiéndolo a tu lista de deseados en Steam!",
      ctaPrimary: "🎮 Añadir GilongWorld a deseados",
      ctaDiscord: "💬 Unirse a Discord",
      furtherReading: "Lecturas recomendadas",
      older: "Anterior",
      newer: "Siguiente"
    },
    pl: {
      badge: "Sci-Fi ARPG",
      sidebarDesc: "Niezależne Action-RPG z alchemią, oswajaniem stworzeń i budową bazy — tworzone w Unity 6.",
      sidebarSteam: "🎮 Lista życzeń Steam",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇵🇱 Czytaj po polsku: ",
      originalVi: "🇻🇳 Wersja wietnamska: ",
      devlogHtml: "🎮 Devlog inżynieryjny z <strong>GilongWorld</strong> (Sci-Fi Action-RPG • Unity 6) → Lista życzeń Steam",
      ctaKicker: "STWORZONE PRZEZ LONG GIL STUDIO",
      ctaTitle: "Odkryj GilongWorld — Zasilane tą architekturą",
      ctaDescHtml: "Każda optymalizacja Unity 6 i analiza architektury na tym blogu powstaje bezpośrednio na potrzeby <strong>GilongWorld</strong> — naszego nadchodzącego Sci-Fi Action-RPG z alchemią, oswajaniem stworzeń i budową bazy. Wesprzyj nasze niezależne studio, dodając grę do listy życzeń Steam!",
      ctaPrimary: "🎮 Dodaj GilongWorld na Steam",
      ctaDiscord: "💬 Dołącz do Discorda",
      furtherReading: "Powiązane artykuły",
      older: "Starszy",
      newer: "Nowszy"
    },
    "pt-BR": {
      badge: "ARPG Sci-Fi",
      sidebarDesc: "Action-RPG indie com alquimia, doma de criaturas e construção de base — desenvolvido em Unity 6.",
      sidebarSteam: "🎮 Lista de desejos Steam",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇧🇷 Ler em português (BR): ",
      originalVi: "🇻🇳 Original em vietnamita: ",
      devlogHtml: "🎮 Devlog de engenharia de <strong>GilongWorld</strong> (Action-RPG Sci-Fi • Unity 6) → Lista de desejos Steam",
      ctaKicker: "FEITO POR LONG GIL STUDIO",
      ctaTitle: "Conheça GilongWorld — Movido por esta arquitetura",
      ctaDescHtml: "Cada otimização do Unity 6 e estudo de arquitetura neste devlog é desenvolvido diretamente para <strong>GilongWorld</strong> — nosso próximo Action-RPG Sci-Fi com alquimia, doma de criaturas e construção de bases. Apoie nossa equipe indie adicionando o jogo à sua Lista de Desejos no Steam!",
      ctaPrimary: "🎮 Adicionar GilongWorld no Steam",
      ctaDiscord: "💬 Entrar no Discord",
      furtherReading: "Leitura recomendada",
      older: "Mais antigo",
      newer: "Mais recente"
    },
    "pt-PT": {
      badge: "ARPG Sci-Fi",
      sidebarDesc: "Action-RPG indie com alquimia, domesticação de criaturas e construção de base — desenvolvido em Unity 6.",
      sidebarSteam: "🎮 Lista de desejos Steam",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇵🇹 Ler em português (PT): ",
      originalVi: "🇻🇳 Original em vietnamita: ",
      devlogHtml: "🎮 Devlog de engenharia de <strong>GilongWorld</strong> (Action-RPG Sci-Fi • Unity 6) → Lista de desejos Steam",
      ctaKicker: "DESENVOLVIDO POR LONG GIL STUDIO",
      ctaTitle: "Descubra GilongWorld — Impulsionado por esta arquitetura",
      ctaDescHtml: "Cada otimização do Unity 6 e análise de arquitetura neste devlog é concebida diretamente para <strong>GilongWorld</strong> — o nosso próximo Action-RPG Sci-Fi com alquimia, domesticação de criaturas e construção de bases. Apoie a nossa equipa indie adicionando o jogo à sua Lista de Desejos no Steam!",
      ctaPrimary: "🎮 Adicionar GilongWorld no Steam",
      ctaDiscord: "💬 Aderir ao Discord",
      furtherReading: "Leituras adicionais",
      older: "Mais antigo",
      newer: "Mais recente"
    },
    ko: {
      badge: "Sci-Fi ARPG",
      sidebarDesc: "연금술, 크리처 길들이기 & 기지 건설을 결합한 인디 액션 RPG — Unity 6 기반 개발.",
      sidebarSteam: "🎮 Steam 찜하기",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇰🇷 한국어로 읽기: ",
      originalVi: "🇻🇳 베트남어 원문: ",
      devlogHtml: "🎮 <strong>GilongWorld</strong> 엔지니어링 개발일지 (Sci-Fi 액션 RPG • Unity 6) → Steam 찜하기",
      ctaKicker: "LONG GIL STUDIO 개발",
      ctaTitle: "GilongWorld 만나보기 — 이 아키텍처로 구동되는 게임",
      ctaDescHtml: "이 개발일지의 모든 Unity 6 최적화와 아키텍처 연구는 연금술, 신화적 크리처 길들이기, 기지 건설을 특징으로 하는 차기 Sci-Fi 액션 RPG <strong>GilongWorld</strong>를 위해 직접 설계되었습니다. Steam 찜하기를 통해 인디 개발팀을 응원해 주세요!",
      ctaPrimary: "🎮 Steam에서 GilongWorld 찜하기",
      ctaDiscord: "💬 Discord 참여",
      furtherReading: "관련 글",
      older: "이전 글",
      newer: "다음 글"
    },
    ru: {
      badge: "Sci-Fi ARPG",
      sidebarDesc: "Инди Action-RPG с алхимией, приручением существ и строительством базы на движке Unity 6.",
      sidebarSteam: "🎮 В желаемое Steam",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇷🇺 Читать на русском: ",
      originalVi: "🇻🇳 Вьетнамский оригинал: ",
      devlogHtml: "🎮 Инженерный девлог <strong>GilongWorld</strong> (Sci-Fi Action-RPG • Unity 6) → В желаемое Steam",
      ctaKicker: "ОТ СТУДИИ LONG GIL STUDIO",
      ctaTitle: "Откройте GilongWorld — на базе этой архитектуры",
      ctaDescHtml: "Каждая оптимизация Unity 6 и архитектурный разбор в этом девлоге созданы непосредственно для <strong>GilongWorld</strong> — нашей грядущей Sci-Fi Action-RPG с алхимией, приручением существ и строительством базы. Поддержите инди-команду, добавив игру в список желаемого Steam!",
      ctaPrimary: "🎮 Добавить GilongWorld в Steam",
      ctaDiscord: "💬 Войти в Discord",
      furtherReading: "Читайте также",
      older: "Раньше",
      newer: "Новее"
    },
    ja: {
      badge: "Sci-Fi ARPG",
      sidebarDesc: "錬金術・クリーチャー調教・拠点建設を融合したインディーアクションRPG — Unity 6で開発。",
      sidebarSteam: "🎮 Steamウィッシュリスト",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇯🇵 日本語で読む: ",
      originalVi: "🇻🇳 ベトナム語原文: ",
      devlogHtml: "🎮 <strong>GilongWorld</strong> 技術開発ログ (Sci-Fi Action RPG • Unity 6) → Steamウィッシュリスト",
      ctaKicker: "LONG GIL STUDIO 開発作品",
      ctaTitle: "GilongWorld をチェック — この設計で動くゲーム",
      ctaDescHtml: "本ブログのUnity 6最適化とアーキテクチャ解説は、錬金術・幻獣調教・拠点建設を備えた新作Sci-FiアクションRPG <strong>GilongWorld</strong> のために直接開発されたものです。ぜひSteamウィッシュリストに追加して応援してください！",
      ctaPrimary: "🎮 SteamでGilongWorldをウィッシュリストに追加",
      ctaDiscord: "💬 Discordに参加",
      furtherReading: "関連記事",
      older: "古い記事",
      newer: "新しい記事"
    },
    tr: {
      badge: "Sci-Fi ARPG",
      sidebarDesc: "Simya, yaratık evcilleştirme ve üs kurma içeren bağımsız Aksiyon RPG — Unity 6 ile geliştirildi.",
      sidebarSteam: "🎮 Steam İstek Listesi",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇹🇷 Türkçe oku: ",
      originalVi: "🇻🇳 Vietnamca orijinali: ",
      devlogHtml: "🎮 <strong>GilongWorld</strong> Mühendislik Günlüğü (Sci-Fi Action RPG • Unity 6) → Steam İstek Listesi",
      ctaKicker: "LONG GIL STUDIO YAPIMI",
      ctaTitle: "GilongWorld'ü Keşfedin — Bu Mimariyle Güçlendirildi",
      ctaDescHtml: "Bu geliştirici günlüğündeki her Unity 6 optimizasyonu ve mimari inceleme, simya, yaratık evcilleştirme ve üs kurma mekanikleri sunan yakındaki Sci-Fi Aksiyon RPG oyunumuz <strong>GilongWorld</strong> için doğrudan geliştirilmektedir. Oyunu Steam İstek Listenize ekleyerek bağımsız ekibimize destek olun!",
      ctaPrimary: "🎮 GilongWorld'ü Steam İstek Listesine Ekle",
      ctaDiscord: "💬 Discord'a Katıl",
      furtherReading: "İlgili Yazılar",
      older: "Önceki",
      newer: "Sonraki"
    },
    "zh-CN": {
      badge: "科幻 ARPG",
      sidebarDesc: "融合炼金术、异兽驯服与基地建设的独立动作 RPG —— 基于 Unity 6 引擎打造。",
      sidebarSteam: "🎮 Steam 愿望单",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇨🇳 阅读简体中文版：",
      originalVi: "🇻🇳 越南语原文：",
      devlogHtml: "🎮 <strong>GilongWorld</strong> 工程开发日志（科幻动作 RPG • Unity 6）→ 添加 Steam 愿望单",
      ctaKicker: "LONG GIL STUDIO 匠心打造",
      ctaTitle: "探索 GilongWorld —— 由本架构驱动的作品",
      ctaDescHtml: "本博客中的每一项 Unity 6 性能优化与架构深度解析，均直接服务于我们即将推出的科幻动作 RPG <strong>GilongWorld</strong>（融合炼金术、神兽驯服与基地建设）。欢迎将其加入您的 Steam 愿望单，支持我们的独立开发团队！",
      ctaPrimary: "🎮 将 GilongWorld 加入 Steam 愿望单",
      ctaDiscord: "💬 加入 Discord",
      furtherReading: "延伸阅读",
      older: "上一篇",
      newer: "下一篇"
    },
    "zh-TW": {
      badge: "科幻 ARPG",
      sidebarDesc: "融合煉金術、異獸馴服與基地建設的獨立動作 RPG —— 基於 Unity 6 引擎打造。",
      sidebarSteam: "🎮 Steam 願望清單",
      sidebarDiscord: "💬 Discord",
      quickSwitch: "🇹🇼 閱讀繁體中文版：",
      originalVi: "🇻🇳 越南語原文：",
      devlogHtml: "🎮 <strong>GilongWorld</strong> 工程開發日誌（科幻動作 RPG • Unity 6）→ 加入 Steam 願望清單",
      ctaKicker: "LONG GIL STUDIO 傾力打造",
      ctaTitle: "探索 GilongWorld —— 由本架構驅動的作品",
      ctaDescHtml: "本部落格中的每一項 Unity 6 效能最佳化與架構深度解析，皆直接應用於我們即將推出的科幻動作 RPG <strong>GilongWorld</strong>（結合煉金術、神獸馴服與基地建設）。歡迎將遊戲加入您的 Steam 願望清單，支持我們的獨立開發團隊！",
      ctaPrimary: "🎮 將 GilongWorld 加入 Steam 願望清單",
      ctaDiscord: "💬 加入 Discord",
      furtherReading: "延伸閱讀",
      older: "上一篇",
      newer: "下一篇"
    }
  };

  var REF_HEADING_KEYWORDS = [
    "tài liệu tham khảo",
    "nguồn trích dẫn",
    "references",
    "bibliography",
    "références",
    "riferimenti",
    "referenzen",
    "quellen",
    "referencias",
    "bibliografía",
    "bibliografia",
    "przypisy",
    "referências",
    "참고문헌",
    "참고 문헌",
    "참고 자료",
    "список литературы",
    "источники",
    "参考文献",
    "引用文献",
    "kaynakça",
    "kaynaklar",
    "参考资料",
    "參考資料",
    "參考文獻"
  ];

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

  function getCopy(lang) {
    return UI_COPY[lang] || UI_COPY.en;
  }

  function getLangMeta(lang) {
    return LANG_BY_CODE[lang] || LANG_BY_CODE[DEFAULT_LANG];
  }

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

  function findAllTranslations(translationId) {
    if (!translationId) return [];
    var list = [];
    (config.posts || []).forEach(function (p) {
      if (p.id === translationId) list.push(p);
    });
    return list;
  }

  function findCounterpart(translationId, targetLang, currentUrl) {
    var translations = findAllTranslations(translationId);
    if (!translations.length) return null;
    var currentNorm = normalizePath(currentUrl || "");
    if (targetLang) {
      for (var i = 0; i < translations.length; i++) {
        if (translations[i].lang === targetLang) {
          return translations[i];
        }
      }
    }
    var fallbackOrder = [DEFAULT_LANG, "en", "vi"];
    for (var f = 0; f < fallbackOrder.length; f++) {
      for (var j = 0; j < translations.length; j++) {
        if (
          translations[j].lang === fallbackOrder[f] &&
          normalizePath(translations[j].url) !== currentNorm
        ) {
          return translations[j];
        }
      }
    }
    for (var k = 0; k < translations.length; k++) {
      if (normalizePath(translations[k].url) !== currentNorm) {
        return translations[k];
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

  function closeAllDropdowns(exceptEl) {
    document.querySelectorAll(".lgs-lang-switcher.is-open").forEach(function (sw) {
      if (exceptEl && sw === exceptEl) return;
      sw.classList.remove("is-open");
      var btn = sw.querySelector(".lgs-lang-dropdown-btn");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  function createSwitcherElement(extraClass, availableLangMap) {
    var wrap = document.createElement("div");
    wrap.className = "lgs-lang-switcher" + (extraClass ? " " + extraClass : "");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Language Switcher");

    var currentMeta = getLangMeta(activeLang);
    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "lgs-lang-dropdown-btn";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("title", currentMeta.name);
    trigger.innerHTML =
      '<span class="lgs-lang-trigger-flag">' + currentMeta.flag + "</span>" +
      '<span class="lgs-lang-trigger-label">' + currentMeta.label + "</span>" +
      '<span class="lgs-lang-caret" aria-hidden="true">▾</span>';

    var menu = document.createElement("div");
    menu.className = "lgs-lang-dropdown-menu";
    menu.setAttribute("role", "listbox");

    LANG_OPTIONS.forEach(function (opt) {
      var item = document.createElement("button");
      item.type = "button";
      var isAvailable = !availableLangMap || Boolean(availableLangMap[opt.code]);
      item.className =
        "lgs-lang-option" +
        (activeLang === opt.code ? " is-active" : "") +
        (!isAvailable ? " is-unavailable" : "");
      item.setAttribute("role", "option");
      item.setAttribute("data-lgs-lang", opt.code);
      item.setAttribute("aria-selected", activeLang === opt.code ? "true" : "false");
      item.setAttribute("title", opt.name);
      item.innerHTML =
        '<span class="lgs-lang-option-left">' +
          '<span aria-hidden="true">' + opt.flag + "</span>" +
          '<span class="lgs-lang-option-name">' + opt.name + "</span>" +
        "</span>" +
        '<span class="lgs-lang-option-code">' +
          (activeLang === opt.code ? "✓" : opt.label) +
        "</span>";

      item.addEventListener("click", function (e) {
        e.stopPropagation();
        closeAllDropdowns();
        handleLanguageSwitch(opt.code);
      });
      menu.appendChild(item);
    });

    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      var willOpen = !wrap.classList.contains("is-open");
      closeAllDropdowns(wrap);
      wrap.classList.toggle("is-open", willOpen);
      trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });

    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    return wrap;
  }

  function syncSwitcherButtons() {
    var currentMeta = getLangMeta(activeLang);
    document.querySelectorAll(".lgs-lang-switcher").forEach(function (sw) {
      var flagEl = sw.querySelector(".lgs-lang-trigger-flag");
      var labelEl = sw.querySelector(".lgs-lang-trigger-label");
      var trigger = sw.querySelector(".lgs-lang-dropdown-btn");
      if (flagEl) flagEl.textContent = currentMeta.flag;
      if (labelEl) labelEl.textContent = currentMeta.label;
      if (trigger) trigger.setAttribute("title", currentMeta.name);

      sw.querySelectorAll(".lgs-lang-option[data-lgs-lang]").forEach(function (optBtn) {
        var code = optBtn.getAttribute("data-lgs-lang");
        var meta = getLangMeta(code);
        var isActive = code === activeLang;
        optBtn.classList.toggle("is-active", isActive);
        optBtn.setAttribute("aria-selected", isActive ? "true" : "false");
        var codeEl = optBtn.querySelector(".lgs-lang-option-code");
        if (codeEl) codeEl.textContent = isActive ? "✓" : meta.label;
      });
    });
  }

  function handleLanguageSwitch(targetLang) {
    if (SUPPORTED.indexOf(targetLang) === -1) return;
    saveLang(targetLang);

    var page = config.page || {};
    if (page.layout === "post") {
      if (page.lang === targetLang) return;
      var counterpart = findCounterpart(page.translationId, targetLang, page.url);
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

  function getPostsForLang(lang) {
    var list = (config.posts || []).filter(function (p) {
      return p.lang === lang;
    });
    list.sort(function (a, b) {
      return (b.ts || 0) - (a.ts || 0);
    });
    return list;
  }

  function syncRecentlyUpdated(lang) {
    var container = document.getElementById("access-lastmod");
    if (!container) return;
    var ul = container.querySelector("ul");
    if (!ul) return;

    var langPosts = getPostsForLang(lang);
    if (!langPosts.length) {
      langPosts = getPostsForLang(DEFAULT_LANG);
    }
    var topFive = langPosts.slice(0, 5);
    if (!topFive.length) return;

    ul.innerHTML = "";
    topFive.forEach(function (post) {
      var li = document.createElement("li");
      li.className = "text-truncate lh-lg";
      var a = document.createElement("a");
      a.href = post.url;
      a.textContent = post.title;
      li.appendChild(a);
      ul.appendChild(li);
    });
  }

  function syncRelatedPosts(postLang) {
    var related = document.getElementById("related-posts");
    if (!related) return;
    var page = config.page || {};
    if (page.layout !== "post") return;

    var currentPost = postByPath[normalizePath(page.url)];
    var currentTags = (currentPost && currentPost.tags) || [];
    var currentCats = (currentPost && currentPost.categories) || [];

    var candidates = (config.posts || []).filter(function (p) {
      return p.lang === postLang && p.id !== page.translationId && normalizePath(p.url) !== normalizePath(page.url);
    });

    if (!candidates.length) {
      related.classList.add("lgs-lang-hidden");
      return;
    }

    candidates.sort(function (a, b) {
      function score(item) {
        var s = 0;
        (item.tags || []).forEach(function (t) {
          if (currentTags.indexOf(t) !== -1) s += 3;
        });
        (item.categories || []).forEach(function (c) {
          if (currentCats.indexOf(c) !== -1) s += 2;
        });
        return s;
      }
      var diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return (b.ts || 0) - (a.ts || 0);
    });

    var topThree = candidates.slice(0, 3);
    var row = related.querySelector(".row");
    if (row) {
      row.innerHTML = "";
      topThree.forEach(function (post) {
        var col = document.createElement("article");
        col.className = "col";

        var link = document.createElement("a");
        link.href = post.url;
        link.className = "post-preview card h-100";

        var body = document.createElement("div");
        body.className = "card-body";

        var timeEl = document.createElement("time");
        timeEl.setAttribute("data-ts", String(post.ts || ""));
        timeEl.textContent = post.date || "";

        var h4 = document.createElement("h4");
        h4.className = "pt-0 my-2";
        h4.textContent = post.title;

        var descWrap = document.createElement("div");
        descWrap.className = "text-muted";
        var p = document.createElement("p");
        p.textContent = post.desc || "";
        descWrap.appendChild(p);

        body.appendChild(timeEl);
        body.appendChild(h4);
        body.appendChild(descWrap);
        link.appendChild(body);
        col.appendChild(link);
        row.appendChild(col);
      });
    }

    var heading = related.querySelector("h3");
    if (heading) {
      heading.textContent = getCopy(postLang).furtherReading;
    }
    related.classList.remove("lgs-lang-hidden");
  }

  function syncPostNavigation(postLang) {
    var nav = document.querySelector(".post-navigation");
    if (!nav) return;
    var page = config.page || {};
    if (page.layout !== "post") return;

    var langPosts = getPostsForLang(postLang);
    var currentNorm = normalizePath(page.url);
    var idx = -1;
    for (var i = 0; i < langPosts.length; i++) {
      if (normalizePath(langPosts[i].url) === currentNorm) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return;

    // langPosts is sorted newest-first: idx + 1 is older, idx - 1 is newer
    var olderPost = idx + 1 < langPosts.length ? langPosts[idx + 1] : null;
    var newerPost = idx - 1 >= 0 ? langPosts[idx - 1] : null;
    var copy = getCopy(postLang);

    var buttons = nav.querySelectorAll(".btn");
    if (buttons.length < 2) return;

    function updateNavBtn(btn, targetPost, labelText) {
      var p = btn.querySelector("p");
      if (targetPost) {
        var newLink = btn;
        if (btn.tagName !== "A") {
          newLink = document.createElement("a");
          newLink.className = btn.className.replace(/\bdisabled\b/g, "").trim();
          newLink.innerHTML = btn.innerHTML;
          btn.parentNode.replaceChild(newLink, btn);
          p = newLink.querySelector("p");
        }
        newLink.classList.remove("disabled");
        newLink.setAttribute("href", targetPost.url);
        newLink.setAttribute("aria-label", labelText);
        if (p) p.textContent = targetPost.title;
      } else {
        btn.classList.add("disabled");
        btn.setAttribute("href", "#");
        btn.setAttribute("aria-label", labelText);
        if (p) p.textContent = "-";
      }
    }

    updateNavBtn(buttons[0], olderPost, copy.older);
    updateNavBtn(buttons[1], newerPost, copy.newer);
  }

  function applyLanguageFilter() {
    // 1. Homepage post cards (#post-list)
    filterCollectionList("#post-list article.card-wrapper", "a.post-preview, h1 a, a[href*='/posts/']");

    // 1b. Right-panel "Recently Updated" (#access-lastmod)
    syncRecentlyUpdated(activeLang);

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

    // 4. Related Posts & Post Navigation on a Post page
    var postLang = pageLayout === "post" ? ((config.page || {}).lang || activeLang) : activeLang;
    syncRelatedPosts(postLang);
    syncPostNavigation(postLang);

    // 5. Search results (#search-results > article)
    filterCollectionList("#search-results article", "h2 a, a");

    // 6. Explicit multilingual content sections (e.g. /about/)
    var langSections = document.querySelectorAll("[data-lang-section]");
    if (langSections.length > 0) {
      var hasMatch = false;
      langSections.forEach(function (sec) {
        if (sec.getAttribute("data-lang-section") === activeLang) hasMatch = true;
      });
      var displayLang = hasMatch ? activeLang : DEFAULT_LANG;
      langSections.forEach(function (sec) {
        var secLang = sec.getAttribute("data-lang-section");
        if (secLang === displayLang) {
          sec.style.display = "";
          sec.classList.remove("lgs-lang-hidden");
        } else {
          sec.style.display = "none";
          sec.classList.add("lgs-lang-hidden");
        }
      });
    }
  }

  function observeSearchResults() {
    var container = document.getElementById("search-results");
    if (!container || typeof MutationObserver === "undefined") return;
    var observer = new MutationObserver(function () {
      filterCollectionList("#search-results article", "h2 a, a");
    });
    observer.observe(container, { childList: true });
  }

  function getPostAvailableLangMap() {
    var page = config.page || {};
    if (page.layout !== "post" || !page.translationId) return null;
    var map = Object.create(null);
    findAllTranslations(page.translationId).forEach(function (t) {
      map[t.lang] = true;
    });
    return map;
  }

  function injectTopbarSwitcher() {
    var topbar = document.getElementById("topbar");
    if (!topbar || document.getElementById("lgs-topbar-switcher")) return;

    var switcher = createSwitcherElement("lgs-topbar-switcher", getPostAvailableLangMap());
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

  function updateSidebarCardText() {
    var card = document.getElementById("lgs-sidebar-card");
    if (!card) return;
    var copy = getCopy(activeLang);
    var badgeEl = card.querySelector(".lgs-sidebar-card-badge");
    var descEl = card.querySelector(".lgs-sidebar-card-desc");
    var steamEl = card.querySelector(".lgs-mini-btn-steam");
    var discordEl = card.querySelector(".lgs-mini-btn-discord");
    if (badgeEl) badgeEl.textContent = copy.badge;
    if (descEl) descEl.textContent = copy.sidebarDesc;
    if (steamEl) {
      steamEl.textContent = copy.sidebarSteam;
      steamEl.href = buildSteamUrl("sidebar_card", (config.page || {}).translationId || "sidebar", activeLang);
    }
    if (discordEl) discordEl.textContent = copy.sidebarDiscord;
  }

  function injectSidebarBlock() {
    var sidebar = document.getElementById("sidebar");
    if (!sidebar || document.getElementById("lgs-sidebar-block")) return;

    var gw = config.gilongworld || {};
    var copy = getCopy(activeLang);

    var block = document.createElement("div");
    block.id = "lgs-sidebar-block";
    block.className = "lgs-sidebar-block";

    var switcherWrap = document.createElement("div");
    switcherWrap.className = "lgs-sidebar-switcher-wrap";
    switcherWrap.appendChild(createSwitcherElement("lgs-sidebar-switcher lgs-lang-switcher--left", getPostAvailableLangMap()));
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
    desc.textContent = copy.sidebarDesc;

    var actions = document.createElement("div");
    actions.className = "lgs-sidebar-card-actions";

    var steamBtn = document.createElement("a");
    steamBtn.className = "lgs-mini-btn lgs-mini-btn-steam";
    steamBtn.href = buildSteamUrl("sidebar_card", (config.page || {}).translationId || "sidebar", activeLang);
    steamBtn.target = "_blank";
    steamBtn.rel = "noopener noreferrer";
    steamBtn.textContent = copy.sidebarSteam;

    var discordBtn = document.createElement("a");
    discordBtn.className = "lgs-mini-btn lgs-mini-btn-discord";
    discordBtn.href = gw.discord_url || "https://discord.gg/DbzpYe5T2P";
    discordBtn.target = "_blank";
    discordBtn.rel = "noopener noreferrer";
    discordBtn.textContent = copy.sidebarDiscord;

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

  function isReferenceHeading(text) {
    var t = (text || "").trim().toLowerCase();
    for (var i = 0; i < REF_HEADING_KEYWORDS.length; i++) {
      if (t.indexOf(REF_HEADING_KEYWORDS[i]) !== -1) return true;
    }
    return false;
  }

  function injectPostMarketingAndLanguageBars() {
    var page = config.page || {};
    if (page.layout !== "post") return;

    var contentEl = document.querySelector("article .content");
    if (!contentEl) return;

    var postLang = page.lang || "vi";
    var copy = getCopy(postLang);
    var gw = config.gilongworld || {};
    var availableMap = getPostAvailableLangMap();

    // Touchpoint A: Top-of-post language switch & GilongWorld Devlog badge
    if (!document.getElementById("lgs-post-top-bar")) {
      var topBar = document.createElement("div");
      topBar.id = "lgs-post-top-bar";
      topBar.className = "lgs-post-top-bar";

      var topRow = document.createElement("div");
      topRow.className = "lgs-post-top-row";

      var controls = document.createElement("div");
      controls.className = "lgs-post-lang-controls";
      controls.appendChild(createSwitcherElement("lgs-post-switcher lgs-lang-switcher--left", availableMap));

      var quickTargetLang = postLang === "vi" ? "en" : "vi";
      var quickTarget = findCounterpart(page.translationId, quickTargetLang, page.url);
      if (quickTarget && quickTarget.url) {
        var langLink = document.createElement("a");
        langLink.className = "lgs-post-lang-switch-link";
        langLink.href = quickTarget.url;
        langLink.textContent =
          (quickTargetLang === "vi" ? UI_COPY.vi.quickSwitch : UI_COPY.en.quickSwitch) + quickTarget.title;
        langLink.addEventListener("click", function () {
          saveLang(quickTargetLang);
        });
        controls.appendChild(langLink);
      }

      topRow.appendChild(controls);

      var devlogPill = document.createElement("a");
      devlogPill.className = "lgs-post-devlog-pill";
      devlogPill.href = buildSteamUrl("post_top_badge", page.translationId, postLang);
      devlogPill.target = "_blank";
      devlogPill.rel = "noopener noreferrer";
      devlogPill.innerHTML = copy.devlogHtml;

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

      var steamHref = buildSteamUrl("post_footer_cta", page.translationId, postLang);
      var capsuleSrc = gw.capsule_image || "/assets/img/steam/Header_Capsule_920x430.png";

      card.innerHTML =
        '<div class="lgs-steam-cta-grid">' +
          '<a class="lgs-steam-cta-media" href="' + steamHref + '" target="_blank" rel="noopener noreferrer">' +
            '<img src="' + capsuleSrc + '" alt="GilongWorld Sci-Fi Action RPG on Steam">' +
          "</a>" +
          '<div class="lgs-steam-cta-body">' +
            '<div class="lgs-steam-cta-kicker">' + copy.ctaKicker + "</div>" +
            '<div class="lgs-steam-cta-title" role="heading" aria-level="3" data-toc-skip>' +
              copy.ctaTitle +
            "</div>" +
            '<p class="lgs-steam-cta-desc">' + copy.ctaDescHtml + "</p>" +
            '<div class="lgs-steam-cta-actions">' +
              '<a class="lgs-steam-btn-primary" href="' + steamHref + '" target="_blank" rel="noopener noreferrer">' +
                copy.ctaPrimary +
              "</a>" +
              '<a class="lgs-steam-btn-secondary" href="' + (gw.discord_url || "https://discord.gg/DbzpYe5T2P") + '" target="_blank" rel="noopener noreferrer">' +
                copy.ctaDiscord +
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

      // Insert right before References heading in any of the 15 languages, or before .footnotes, or at end of .content
      var headings = contentEl.querySelectorAll("h2");
      var refHeading = null;
      headings.forEach(function (h2) {
        if (refHeading) return;
        if (isReferenceHeading(h2.textContent)) {
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

  function initGlobalDropdownDismiss() {
    document.addEventListener("click", function () {
      closeAllDropdowns();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeAllDropdowns();
      }
    });
  }

  function init() {
    document.documentElement.setAttribute("lang", activeLang);
    initGlobalDropdownDismiss();
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
