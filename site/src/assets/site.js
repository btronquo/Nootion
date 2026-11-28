// Nootion's website: theme, sliders, downloads, copy buttons and the documentation's search.
// No framework and no build step: this file is served as it is.
(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("js");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Theme ----------
  // The system's theme by default; the toggle saves a choice, which wins from then on.
  var THEME_KEY = "nootion-site-theme";
  function applyTheme(dark) {
    root.classList.toggle("dark", dark);
    // The hero shows the app in the same theme as the page.
    document.querySelectorAll("img[data-dark]").forEach(function (img) {
      var source = img.parentElement.querySelector("source[data-theme-source]");
      if (source) source.remove();
      img.src = dark ? img.dataset.dark : img.dataset.light;
    });
  }
  document.querySelectorAll(".theme-toggle").forEach(function (button) {
    button.addEventListener("click", function () {
      var dark = !root.classList.contains("dark");
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
      applyTheme(dark);
    });
  });
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  systemDark.addEventListener("change", function (e) {
    if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches);
  });
  if (localStorage.getItem(THEME_KEY)) applyTheme(root.classList.contains("dark"));

  // ---------- Header border once the page has scrolled ----------
  var header = document.querySelector(".site-header");
  if (header && "IntersectionObserver" in window) {
    var sentinel = document.createElement("div");
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.style.cssText = "position:absolute;top:0;height:8px;width:1px;pointer-events:none";
    document.body.prepend(sentinel);
    new IntersectionObserver(function (entries) {
      header.classList.toggle("scrolled", !entries[0].isIntersecting);
    }).observe(sentinel);
  }

  // ---------- Sections appear as they come into view ----------
  var reveals = document.querySelectorAll(".reveal");
  if (!reduceMotion && "IntersectionObserver" in window) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    reveals.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    reveals.forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  // ---------- Copy buttons ----------
  var CHECK_ICON =
    '<svg class="icon" aria-hidden="true" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>';
  document.addEventListener("click", function (e) {
    var button = e.target.closest(".copy");
    if (!button) return;
    var text = button.dataset.copy;
    if (!text && button.dataset.copyTarget) text = document.getElementById(button.dataset.copyTarget).textContent;
    if (!text) {
      var code = button.parentElement.querySelector("pre code");
      text = code ? code.textContent : "";
    }
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text.trim()).then(function () {
      var previous = button.innerHTML;
      button.classList.add("copied");
      button.innerHTML = CHECK_ICON;
      setTimeout(function () {
        button.classList.remove("copied");
        button.innerHTML = previous;
      }, 1600);
    });
  });

  // ---------- Screenshot tabs and sliders ----------
  var ARROW_LEFT =
    '<svg class="icon" aria-hidden="true" viewBox="0 0 256 256" fill="currentColor"><path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"/></svg>';
  var ARROW_RIGHT =
    '<svg class="icon" aria-hidden="true" viewBox="0 0 256 256" fill="currentColor"><path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"/></svg>';

  function setupSlider(slider) {
    var track = slider.querySelector(".slider-track");
    var slides = Array.prototype.slice.call(track.children);
    var controls = document.createElement("div");
    controls.className = "slider-controls";
    var dots = document.createElement("div");
    dots.className = "slider-dots";
    var arrows = document.createElement("div");
    arrows.className = "slider-arrows";
    var prev = document.createElement("button");
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous screenshot");
    prev.innerHTML = ARROW_LEFT;
    var next = document.createElement("button");
    next.type = "button";
    next.setAttribute("aria-label", "Next screenshot");
    next.innerHTML = ARROW_RIGHT;
    arrows.append(prev, next);
    var current = 0;

    slides.forEach(function (slide, i) {
      slide.setAttribute("role", "group");
      slide.setAttribute("aria-roledescription", "slide");
      slide.setAttribute("aria-label", i + 1 + " of " + slides.length);
      var dot = document.createElement("button");
      dot.type = "button";
      dot.setAttribute("aria-label", "Screenshot " + (i + 1));
      dot.addEventListener("click", function () {
        go(i);
      });
      dots.append(dot);
    });
    controls.append(dots, arrows);
    slider.append(controls);

    function go(i) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      track.scrollTo({ left: slides[i].offsetLeft - track.offsetLeft, behavior: reduceMotion ? "auto" : "smooth" });
    }
    function update(i) {
      current = i;
      Array.prototype.forEach.call(dots.children, function (dot, j) {
        dot.setAttribute("aria-current", j === i ? "true" : "false");
      });
      prev.disabled = i === 0;
      next.disabled = i === slides.length - 1;
    }
    prev.addEventListener("click", function () {
      go(current - 1);
    });
    next.addEventListener("click", function () {
      go(current + 1);
    });
    slider.addEventListener("keydown", function (e) {
      if (e.target.closest("[role=tablist]")) return;
      if (e.key === "ArrowLeft") go(current - 1);
      else if (e.key === "ArrowRight") go(current + 1);
    });
    // The slide most in view is the current one.
    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) update(slides.indexOf(entry.target));
          });
        },
        { root: track, threshold: 0.6 },
      );
      slides.forEach(function (s) {
        observer.observe(s);
      });
    }
    update(0);
  }
  document.querySelectorAll(".slider").forEach(setupSlider);

  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tour-tabs [role=tab]"));
  function selectTab(tab, focus) {
    tabs.forEach(function (t) {
      var selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !selected;
    });
    if (focus) tab.focus();
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () {
      selectTab(tab, false);
    });
    tab.addEventListener("keydown", function (e) {
      var to = null;
      if (e.key === "ArrowRight") to = tabs[(i + 1) % tabs.length];
      else if (e.key === "ArrowLeft") to = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") to = tabs[0];
      else if (e.key === "End") to = tabs[tabs.length - 1];
      if (to) {
        e.preventDefault();
        selectTab(to, true);
      }
    });
  });

  // ---------- Desktop downloads ----------
  // The visitor's system comes first; the links point to the files of the latest GitHub release when it can be read,
  // and to the release page otherwise (no network, API limit, or a file missing from the release).
  var repo = document.body.dataset.repo;
  var platforms = document.querySelectorAll(".platform");
  if (platforms.length) {
    var ua = navigator.userAgent;
    var os = /Windows/i.test(ua)
      ? "windows"
      : /Mac/i.test(ua) && !/iPhone|iPad/i.test(ua)
        ? "mac"
        : /Linux|X11/i.test(ua) && !/Android/i.test(ua)
          ? "linux"
          : null;
    var labels = { windows: "Download for Windows", mac: "Download for macOS", linux: "Download for Linux" };
    if (os) {
      var current = document.querySelector('.platform[data-os="' + os + '"]');
      current.classList.add("is-current");
      current.parentElement.prepend(current);
      var primary = document.querySelector("[data-download-primary] span");
      if (primary) primary.textContent = labels[os];
    }

    // File names made by the desktop workflow (Tauri): Nootion_4.3.0_x64-setup.exe, Nootion_4.3.0_aarch64.dmg…
    var PATTERNS = {
      "windows-exe": /setup\.exe$/i,
      "windows-msi": /\.msi$/i,
      "mac-arm": /(aarch64|arm64|universal).*\.dmg$/i,
      "mac-intel": /(x64|x86_64|intel|universal).*\.dmg$/i,
      "linux-appimage": /\.AppImage$/i,
      "linux-deb": /\.deb$/i,
      "linux-rpm": /\.rpm$/i,
    };
    var api = repo.replace("https://github.com/", "https://api.github.com/repos/") + "/releases/latest";
    fetch(api, { headers: { Accept: "application/vnd.github+json" } })
      .then(function (r) {
        return r.ok ? r.json() : Promise.reject(r.status);
      })
      .then(function (release) {
        var assets = (release.assets || []).filter(function (a) {
          return !/\.(sig|json|tar\.gz|zip)$/i.test(a.name);
        });
        document.querySelectorAll("[data-asset]").forEach(function (link) {
          var pattern = PATTERNS[link.dataset.asset];
          var asset = assets.find(function (a) {
            return pattern.test(a.name);
          });
          if (asset) {
            link.href = asset.browser_download_url;
            link.title = asset.name;
          }
        });
        var name = document.querySelector("[data-release-name]");
        if (name && release.tag_name) name.textContent = "Latest version: " + release.tag_name.replace(/^v/, "");
        // The hero button downloads the visitor's installer straight away.
        var hero = document.querySelector("[data-download-primary]");
        var mainAsset = { windows: "windows-exe", mac: "mac-arm", linux: "linux-appimage" }[os];
        var link = mainAsset && document.querySelector('[data-asset="' + mainAsset + '"]');
        if (hero && link && link.href.indexOf("/releases/download/") !== -1) {
          hero.href = link.href;
          // Apple chip or Intel can't be told reliably from the browser: on a Mac, the button goes to the choice.
          if (os === "mac") hero.href = "#download";
        }
      })
      .catch(function () {
        /* The links keep pointing to the release page. */
      });
  }

  // ---------- Documentation ----------
  var sidebar = document.querySelector(".doc-sidebar");
  if (sidebar) {
    var toggle = sidebar.querySelector(".sidebar-toggle");
    toggle.addEventListener("click", function () {
      var open = sidebar.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    var active = sidebar.querySelector('[aria-current="page"]');
    if (active && window.matchMedia("(min-width: 801px)").matches) active.scrollIntoView({ block: "center" });
  }

  // The table of contents follows the reading.
  var tocLinks = document.querySelectorAll(".doc-toc a");
  if (tocLinks.length && "IntersectionObserver" in window) {
    var byId = {};
    tocLinks.forEach(function (a) {
      byId[decodeURIComponent(a.hash.slice(1))] = a;
    });
    var headings = document.querySelectorAll(".prose h2[id]");
    var tocObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          tocLinks.forEach(function (a) {
            a.classList.remove("active");
          });
          var link = byId[entry.target.id];
          if (link) link.classList.add("active");
        });
      },
      { rootMargin: "-10% 0px -75% 0px" },
    );
    headings.forEach(function (h) {
      tocObserver.observe(h);
    });
  }

  // Search: a small index made at build time (docs/search-index.json), loaded on the first focus.
  var input = document.getElementById("doc-search-input");
  if (input) {
    var results = document.querySelector(".search-results");
    var base = document.body.dataset.root || "";
    var index = null;
    var selected = -1;
    function load() {
      if (index) return Promise.resolve(index);
      return fetch(base + "docs/search-index.json")
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          index = data;
          return data;
        });
    }
    function normalise(s) {
      return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    }
    function escape(s) {
      return s.replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }
    function highlight(text, words) {
      var html = escape(text);
      words.forEach(function (w) {
        if (w.length < 2) return;
        html = html.replace(new RegExp("(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>");
      });
      return html;
    }
    function snippet(text, word) {
      var i = normalise(text).indexOf(word);
      if (i < 0) return text.slice(0, 120);
      var start = Math.max(0, i - 40);
      return (start ? "…" : "") + text.slice(start, start + 140);
    }
    function search(query) {
      var words = normalise(query).split(/\s+/).filter(Boolean);
      if (!words.length) {
        results.hidden = true;
        return;
      }
      var scored = [];
      index.forEach(function (entry) {
        var title = normalise(entry.title);
        var text = normalise(entry.text);
        var score = 0;
        for (var i = 0; i < words.length; i++) {
          var w = words[i];
          var inTitle = title.indexOf(w) !== -1;
          var inText = text.indexOf(w) !== -1;
          if (!inTitle && !inText) return;
          score += (inTitle ? 10 : 0) + (inText ? 1 : 0);
        }
        scored.push({ entry: entry, score: score });
      });
      scored.sort(function (a, b) {
        return b.score - a.score;
      });
      selected = -1;
      if (!scored.length) {
        results.innerHTML = '<li class="empty">No results for “' + escape(query) + "”.</li>";
      } else {
        results.innerHTML = scored
          .slice(0, 8)
          .map(function (s) {
            var e = s.entry;
            return (
              '<li><a href="' +
              base +
              e.url +
              '"><span class="result-page">' +
              escape(e.page) +
              '</span><span class="result-title">' +
              highlight(e.title, words) +
              '</span><span class="result-text">' +
              highlight(snippet(e.text, words[0]), words) +
              "</span></a></li>"
            );
          })
          .join("");
      }
      results.hidden = false;
    }
    input.addEventListener("focus", load);
    input.addEventListener("input", function () {
      var q = input.value;
      load().then(function () {
        if (input.value === q) search(q);
      });
    });
    input.addEventListener("keydown", function (e) {
      var links = results.querySelectorAll("a");
      if (e.key === "Escape") {
        results.hidden = true;
        input.blur();
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && links.length) {
        e.preventDefault();
        selected = (selected + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
        links.forEach(function (a, i) {
          a.classList.toggle("active", i === selected);
        });
      } else if (e.key === "Enter" && links.length) {
        e.preventDefault();
        (links[selected] || links[0]).click();
      }
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".doc-search")) results.hidden = true;
    });
    // "/" or Ctrl+K opens the search, as in the app.
    document.addEventListener("keydown", function (e) {
      var typing = /input|textarea|select/i.test(document.activeElement.tagName);
      if ((e.key === "/" && !typing) || (e.key === "k" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        if (sidebar && !sidebar.classList.contains("open") && window.matchMedia("(max-width: 800px)").matches) sidebar.querySelector(".sidebar-toggle").click();
        input.focus();
      }
    });
  }
})();
