/* Chiang Mai Trip — загрузка мультиязычных данных, рендер дней, ссылки Google Maps, регистрация SW */

(function () {
  "use strict";

  var DATA_URL = "./chiang-mai-trip-data.i18n.json";
  var LANG_STORAGE_KEY = "cm-trip-lang";
  var FALLBACK_LANG = "en";

  /* Строки интерфейса, которых нет в ui[lang] датасета (обзорная карта, предупреждения,
     служебные тексты, форматы дат). Ключи датасета всегда имеют приоритет. */
  var EXTRA_UI = {
    en: {
      language: "Language",
      overview: "Day overview map",
      warn: "Warning",
      loading: "Loading…",
      dataError: "Could not load the trip data",
      dataHint: "Open the app over a local server (npx serve) or HTTPS — file:// is not supported.",
      noDays: "No days in the dataset.",
      footer: "Offline trip plan. Navigation opens in Google Maps.",
      months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    },
    ru: {
      language: "Язык",
      overview: "Обзорная карта дня",
      warn: "Внимание",
      loading: "Загрузка…",
      dataError: "Не удалось загрузить данные поездки",
      dataHint: "Откройте приложение через локальный сервер (npx serve) или по HTTPS — file:// не поддерживается.",
      noDays: "В данных нет дней.",
      footer: "Офлайн-план поездки. Навигация — в Google Maps.",
      months: ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
    },
    zh: {
      language: "语言",
      overview: "当天概览地图",
      warn: "注意",
      loading: "加载中…",
      dataError: "无法加载行程数据",
      dataHint: "请通过本地服务器（npx serve）或 HTTPS 打开应用——不支持 file://。",
      noDays: "数据中没有日程。",
      footer: "离线行程计划。导航将在 Google Maps 中打开。",
      months: null /* zh использует числовой формат: 2026年8月8日 */
    }
  };

  /* Акцент дня: оттенки вокруг бренд-зелёного, по одному на каждый из 12 дней */
  var DAY_ACCENTS = [
    "#14532D", "#166534", "#15803D", "#0F766E", "#0E7490", "#1D4ED8",
    "#4C1D95", "#86198F", "#9F1239", "#B45309", "#4D7C0F", "#115E59"
  ];

  var tabsEl = document.getElementById("day-tabs");
  var viewEl = document.getElementById("day-view");
  var titleEl = document.getElementById("trip-title");
  var datesEl = document.getElementById("trip-dates");
  var footerEl = document.getElementById("footer-note");
  var langSelect = document.getElementById("lang-select");
  var langLabelEl = document.getElementById("lang-label");

  var data = null;
  var trip = {};
  var days = [];
  var lang = FALLBACK_LANG;
  var dayIndex = 0;

  /* ---------- Язык ---------- */

  function availableLangs() {
    if (trip.languages && trip.languages.length) return trip.languages;
    return Object.keys(EXTRA_UI);
  }

  function storedLang() {
    try {
      return window.localStorage.getItem(LANG_STORAGE_KEY);
    } catch (e) {
      return null; /* приватный режим / отключённое хранилище */
    }
  }

  function storeLang(code) {
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, code);
    } catch (e) {
      /* не критично: язык просто не запомнится между запусками */
    }
  }

  /* Порядок: сохранённый выбор → язык браузера → FALLBACK_LANG (английский) */
  function resolveLang() {
    var supported = availableLangs();

    var saved = storedLang();
    if (saved && supported.indexOf(saved) >= 0) return saved;

    var candidates = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language || ""];

    for (var i = 0; i < candidates.length; i++) {
      var base = String(candidates[i]).toLowerCase().split("-")[0];
      if (supported.indexOf(base) >= 0) return base;
    }

    return supported.indexOf(FALLBACK_LANG) >= 0 ? FALLBACK_LANG : supported[0];
  }

  /* Строка интерфейса: сначала ui[lang] из датасета, затем EXTRA_UI, затем английский */
  function t(key) {
    var fromData = data && data.ui && data.ui[lang];
    if (fromData && fromData[key] != null) return fromData[key];

    var extra = EXTRA_UI[lang] || EXTRA_UI[FALLBACK_LANG];
    if (extra && extra[key] != null) return extra[key];

    var fallback = EXTRA_UI[FALLBACK_LANG];
    return (fallback && fallback[key] != null) ? fallback[key] : key;
  }

  /* Подписи из словарей ui[lang].categories / ui[lang].meals по языконезависимому коду */
  function label(group, code) {
    if (!code) return null;
    var ui = data && data.ui && data.ui[lang];
    if (ui && ui[group] && ui[group][code]) return ui[group][code];

    var en = data && data.ui && data.ui[FALLBACK_LANG];
    if (en && en[group] && en[group][code]) return en[group][code];

    return code;
  }

  /* Текстовое поле {en,ru,zh} → строка активного языка */
  function localized(field) {
    if (field == null) return "";
    if (typeof field === "string") return field;
    if (field[lang] != null) return field[lang];
    if (field[FALLBACK_LANG] != null) return field[FALLBACK_LANG];
    var keys = Object.keys(field);
    return keys.length ? field[keys[0]] : "";
  }

  /* ---------- Google Maps deep links (раздел 6 ТЗ) ---------- */

  function hasCoords(loc) {
    return typeof loc.lat === "number" && typeof loc.lng === "number";
  }

  /* Точка кликабельна, только если её можно однозначно найти на карте.
     Записи без координат и placeId (например, «заправиться по пути») — просто напоминания. */
  function isMappable(loc) {
    return hasCoords(loc) || !!loc.placeId;
  }

  function directionsUrl(loc) {
    var base = "https://www.google.com/maps/dir/?api=1";
    var url = hasCoords(loc)
      ? base + "&destination=" + loc.lat + "," + loc.lng
      : base + "&destination=" + encodeURIComponent(localized(loc.name));
    if (loc.placeId) url += "&destination_place_id=" + loc.placeId;
    return url;
  }

  function searchUrl(loc) {
    var url = "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(localized(loc.name));
    if (loc.placeId) url += "&query_place_id=" + loc.placeId;
    return url;
  }

  /* ---------- Хелперы ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function mapsLink(className, text, href) {
    var a = el("a", className, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  function stars(n) {
    var value = Math.max(0, Math.min(5, n || 0));
    return "★★★★★".slice(0, value) + "☆☆☆☆☆".slice(0, 5 - value);
  }

  function formatDate(day) {
    var parts = String(day.date).split("-");
    var weekday = localized(day.weekday);
    if (parts.length !== 3) return day.date;

    var year = parts[0];
    var month = parseInt(parts[1], 10);
    var date = parseInt(parts[2], 10);

    if (lang === "zh") {
      var zh = year + "年" + month + "月" + date + "日";
      return weekday ? weekday + "，" + zh : zh;
    }

    var months = (EXTRA_UI[lang] && EXTRA_UI[lang].months) || EXTRA_UI[FALLBACK_LANG].months;
    var text = date + " " + (months[month - 1] || parts[1]) + " " + year;
    return weekday ? weekday + ", " + text : text;
  }

  /* «День 14» / «Day 14» / «第14天» — ui[lang].dayWord */
  function dayWord(day) {
    var word = t("dayWord");
    return lang === "zh" ? word + day.day + "天" : word + " " + day.day;
  }

  function accentFor(index) {
    return DAY_ACCENTS[index % DAY_ACCENTS.length];
  }

  /* ---------- Переключатель языка ---------- */

  function buildLangSwitcher() {
    langSelect.textContent = "";

    availableLangs().forEach(function (code) {
      var option = document.createElement("option");
      option.value = code;
      var ui = data && data.ui && data.ui[code];
      option.textContent = (ui && ui.langName) || code.toUpperCase();
      if (code === lang) option.selected = true;
      langSelect.appendChild(option);
    });

    langSelect.setAttribute("aria-label", t("language"));
    if (langLabelEl) langLabelEl.textContent = t("language");
  }

  function setLang(code) {
    if (code === lang) return;
    lang = code;
    storeLang(code);
    renderAll();
  }

  langSelect.addEventListener("change", function () {
    setLang(langSelect.value);
  });

  /* ---------- Рендер ---------- */

  function renderBadges(loc) {
    var box = el("div", "badges");

    if (loc.category) box.appendChild(el("span", "badge", label("categories", loc.category)));
    if (loc.meal) box.appendChild(el("span", "badge badge--meal", label("meals", loc.meal)));
    if (loc.optional) box.appendChild(el("span", "badge badge--optional", t("optional")));
    if (loc.warn) box.appendChild(el("span", "badge badge--warn", t("warn")));

    return box;
  }

  function renderLocation(loc) {
    var item = el("li", "loc");
    if (loc.optional) item.classList.add("loc--optional");
    if (loc.warn) item.classList.add("loc--warn");

    var head = el("div", "loc__head");
    head.appendChild(el("span", "loc__time", loc.time || "—"));
    head.appendChild(el("h3", "loc__name", localized(loc.name)));
    item.appendChild(head);

    var note = localized(loc.note);
    if (note) item.appendChild(el("p", "loc__note", note));

    item.appendChild(renderBadges(loc));

    if (isMappable(loc)) {
      var actions = el("div", "loc__actions");
      actions.appendChild(mapsLink("btn btn--primary", t("directions"), directionsUrl(loc)));
      actions.appendChild(mapsLink("btn btn--ghost", t("viewOnMap"), searchUrl(loc)));
      item.appendChild(actions);
    }

    return item;
  }

  function renderDay(index) {
    var day = days[index];

    viewEl.textContent = "";
    viewEl.style.setProperty("--day-accent", accentFor(index));

    var head = el("section", "day-head");

    var left = el("div", "day-head__text");
    left.appendChild(el("p", "day-head__date", formatDate(day)));
    left.appendChild(el("h2", "day-head__title", localized(day.title)));
    head.appendChild(left);

    var busy = el("div", "busyness");
    busy.appendChild(el("div", "busyness__stars", stars(day.busyness)));
    busy.appendChild(el("span", "busyness__label", t("load")));
    busy.title = t("load") + ": " + (day.busyness || 0) + " / 5";
    head.appendChild(busy);

    viewEl.appendChild(head);

    var locations = day.locations || [];

    var first = locations.filter(isMappable)[0];
    if (first) {
      var overview = el("div", "day-overview");
      overview.appendChild(mapsLink("btn btn--ghost btn--wide", t("overview"), searchUrl(first)));
      viewEl.appendChild(overview);
    }

    var list = el("ul", "locations");
    locations.forEach(function (loc) {
      list.appendChild(renderLocation(loc));
    });
    viewEl.appendChild(list);
  }

  function buildTabs() {
    tabsEl.textContent = "";
    tabsEl.setAttribute("aria-label", t("dayWord"));

    days.forEach(function (day, index) {
      var btn = el("button", "tab");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", index === dayIndex ? "true" : "false");
      btn.setAttribute("aria-label", dayWord(day) + " — " + formatDate(day));
      btn.appendChild(el("span", "tab__weekday", localized(day.weekday)));
      btn.appendChild(el("span", "tab__day", String(day.day)));
      btn.addEventListener("click", function () {
        selectDay(index, true);
      });
      tabsEl.appendChild(btn);
    });
  }

  function selectDay(index, scrollTop) {
    if (index < 0 || index >= days.length) index = 0;
    dayIndex = index;

    Array.prototype.forEach.call(tabsEl.children, function (btn, i) {
      btn.setAttribute("aria-selected", i === index ? "true" : "false");
    });

    renderDay(index);

    var active = tabsEl.children[index];
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: "nearest", inline: "center" });
    }

    var hash = "#day-" + days[index].day;
    if (location.hash !== hash) history.replaceState(null, "", hash);

    if (scrollTop) window.scrollTo(0, 0);
  }

  /* Полная перерисовка: шапка, вкладки, карточка дня — всё на активном языке */
  function renderAll() {
    document.documentElement.lang = lang;

    var tripTitle = localized(trip.title);
    if (tripTitle) {
      titleEl.textContent = tripTitle;
      document.title = tripTitle;
    }
    if (trip.dates) datesEl.textContent = trip.dates;
    if (footerEl) footerEl.textContent = t("footer");

    buildLangSwitcher();
    buildTabs();
    selectDay(dayIndex, false);
  }

  /* ---------- Загрузка данных ---------- */

  function showError(message) {
    viewEl.textContent = "";
    viewEl.appendChild(el("p", "error", message));
  }

  /* Стартовый день: из хэша, иначе сегодняшний (если поездка идёт), иначе первый */
  function initialIndex() {
    var match = /^#day-(\d+)$/.exec(location.hash || "");
    if (match) {
      var wanted = parseInt(match[1], 10);
      for (var i = 0; i < days.length; i++) {
        if (days[i].day === wanted) return i;
      }
    }

    var now = new Date();
    var today = now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0");

    for (var j = 0; j < days.length; j++) {
      if (days[j].date === today) return j;
    }
    return 0;
  }

  function start(loaded) {
    data = loaded;
    trip = data.trip || {};
    days = data.days || [];

    lang = resolveLang(); /* повторно — теперь известен trip.languages */

    if (trip.brandColor) {
      document.documentElement.style.setProperty("--brand", trip.brandColor);
    }

    if (!days.length) {
      showError(t("noDays"));
      return;
    }

    dayIndex = initialIndex();
    renderAll();
  }

  /* Предварительный язык — до загрузки данных, чтобы «Загрузка…» была на нужном языке */
  lang = resolveLang();
  document.documentElement.lang = lang;
  var loadingEl = document.getElementById("loading");
  if (loadingEl) loadingEl.textContent = t("loading");
  if (footerEl) footerEl.textContent = t("footer");

  fetch(DATA_URL, { cache: "no-cache" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(start)
    .catch(function (err) {
      showError(t("dataError") + " (" + err.message + "). " + t("dataHint"));
    });

  /* ---------- Service worker ---------- */

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function (err) {
        console.warn("SW registration failed:", err);
      });
    });
  }
})();
