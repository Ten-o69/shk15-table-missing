(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // --- Helpers ---
  function debounce(fn, wait = 150) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function setButtonExpanded(kind, expanded) {
    const btn = document.querySelector(`[data-section-toggle-btn="${kind}"]`);
    if (btn) btn.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  (function initScrollRestore() {
    const storageKey = "statistics:scrollY";
    const pendingValue = window.sessionStorage.getItem(storageKey);

    if (pendingValue !== null) {
      window.sessionStorage.removeItem(storageKey);
      const scrollY = Number.parseFloat(pendingValue);
      if (Number.isFinite(scrollY)) {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: scrollY, behavior: "auto" });
        });
      }
    }

    function storeScrollPosition() {
      window.sessionStorage.setItem(storageKey, String(window.scrollY || window.pageYOffset || 0));
    }

    document.querySelectorAll("[data-preserve-scroll]").forEach((element) => {
      element.addEventListener("click", () => {
        storeScrollPosition();
      });
    });

    window.__storeStatisticsScroll = storeScrollPosition;
  })();

  (function initStudentLookup() {
    const input = $("#student-lookup-input");
    const results = $("#student-lookup-results");
    const items = Array.isArray(window.STUDENT_LOOKUP_DATA) ? window.STUDENT_LOOKUP_DATA : [];

    if (!input || !results || !items.length) return;

    function buildStudentUrl(studentId) {
      const params = new URLSearchParams(window.location.search);
      if (studentId) params.set("student_id", String(studentId));
      else params.delete("student_id");
      return `${window.location.pathname}?${params.toString()}`;
    }

    function closeResults() {
      results.innerHTML = "";
      results.classList.remove("is-open");
    }

    function openStudent(studentId) {
      if (typeof window.__storeStatisticsScroll === "function") {
        window.__storeStatisticsScroll();
      }
      window.location.href = buildStudentUrl(studentId);
    }

    function renderResults(term) {
      const query = (term || "").trim().toLowerCase();
      if (query.length < 2) {
        closeResults();
        return [];
      }

      const matches = items
        .filter(item => item.search_text.includes(query))
        .slice(0, 8);

      if (!matches.length) {
        results.innerHTML = '<div class="student-lookup__empty">Совпадений не найдено</div>';
        results.classList.add("is-open");
        return [];
      }

      results.innerHTML = "";
      matches.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "student-lookup__result";
        button.dataset.studentId = item.id;

        const name = document.createElement("span");
        name.className = "student-lookup__result-name";
        name.textContent = item.full_name;

        const meta = document.createElement("span");
        meta.className = "student-lookup__result-meta";
        meta.textContent = item.class_name;

        button.appendChild(name);
        button.appendChild(meta);
        results.appendChild(button);
      });
      results.classList.add("is-open");
      return matches;
    }

    let lastMatches = [];
    const syncResults = debounce(() => {
      lastMatches = renderResults(input.value);
    }, 100);

    input.addEventListener("input", syncResults);
    input.addEventListener("focus", () => {
      lastMatches = renderResults(input.value);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      if (!lastMatches.length) return;
      event.preventDefault();
      openStudent(lastMatches[0].id);
    });

    results.addEventListener("click", (event) => {
      const button = event.target.closest("[data-student-id]");
      if (!button) return;
      openStudent(button.getAttribute("data-student-id"));
    });

    document.addEventListener("click", (event) => {
      if (event.target === input || results.contains(event.target)) return;
      closeResults();
    });
  })();

  document.addEventListener("shown.bs.collapse", e => {
     const k = e.target.getAttribute("data-section-collapse");
     if(k) setButtonExpanded(k, true);
     if (k === "visuals") {
       if (window.__heatmapChart && typeof window.__heatmapChart.resize === "function") {
         window.__heatmapChart.resize();
       }
       setTimeout(() => scheduleHeatmapSync(), 60);
     }
  });
  document.addEventListener("hidden.bs.collapse", e => {
     const k = e.target.getAttribute("data-section-collapse");
     if(k) setButtonExpanded(k, false);
  });


  function sortHeatmapSeries(series) {
    if (!window.ClassSort || !Array.isArray(series)) return Array.isArray(series) ? series : [];
    return window.ClassSort.sortByClassName(series, item => (item && item.name) || "");
  }

  function reorderHeatmapSideList(series) {
    const list = document.querySelector(".heatmap-side__list");
    if (!list || !Array.isArray(series)) return;
    const items = new Map();
    list.querySelectorAll(".heatmap-side__item").forEach(item => {
      const name = (item.dataset.className || item.textContent || "").trim();
      if (name) items.set(name, item);
    });
    list.innerHTML = "";
    series.forEach(s => {
      const name = (s && s.name) || "";
      const item = items.get(name);
      if (item) list.appendChild(item);
    });
    items.forEach(item => {
      if (!list.contains(item)) list.appendChild(item);
    });
  }

  function parseTranslateY(transform) {
    if (!transform) return null;
    const match = transform.match(/translate\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(/[ ,]+/).filter(Boolean);
    if (parts.length < 2) return null;
    const y = parseFloat(parts[1]);
    return Number.isFinite(y) ? y : null;
  }

  function getRowMetricsFromRects(chartEl, rowCount) {
    const rects = Array.from(chartEl.querySelectorAll(".apexcharts-heatmap-rect"));
    if (!rects.length) return null;

    const chartRect = chartEl.getBoundingClientRect();
    const centers = [];
    let rectHeight = null;

    rects.forEach(rect => {
      const r = rect.getBoundingClientRect();
      if (r.height > 0) {
        const center = (r.top - chartRect.top) + (r.height / 2);
        centers.push(Math.round(center * 10) / 10);
        if (rectHeight == null) rectHeight = r.height;
      }
    });

    if (!centers.length) return null;
    centers.sort((a, b) => a - b);

    const rows = [];
    centers.forEach(c => {
      const last = rows[rows.length - 1];
      if (last == null || Math.abs(c - last) > 1) rows.push(c);
    });

    if (rowCount && rows.length && Math.abs(rows.length - rowCount) > 2) {
      return null;
    }

    let rowHeight = rectHeight;
    if (rows.length > 1) {
      const diffs = rows.slice(1).map((y, i) => y - rows[i]);
      const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      if (Number.isFinite(avg) && avg > 0) rowHeight = avg;
    }

    if (!rowHeight || rowHeight <= 0) return null;
    const topPad = rows[0] - (rowHeight / 2);

    return { rowHeight, topPad };
  }

  function getDistinctRowCenters(chartEl) {
    const rects = Array.from(chartEl.querySelectorAll(".apexcharts-heatmap-rect"));
    if (!rects.length) return [];

    const centers = [];
    rects.forEach(rect => {
      const r = rect.getBoundingClientRect();
      if (r.height > 0) {
        centers.push(Math.round((r.top + (r.height / 2)) * 10) / 10);
      }
    });

    if (!centers.length) return [];
    centers.sort((a, b) => a - b);

    const rows = [];
    centers.forEach(c => {
      const last = rows[rows.length - 1];
      if (last == null || Math.abs(c - last) > 1) rows.push(c);
    });

    return rows;
  }

  function resetHeatmapSideItems(list) {
    if (!list) return;
    list.style.height = "";
    list.style.paddingTop = "";
    list.querySelectorAll(".heatmap-side__item").forEach(item => {
      item.style.position = "";
      item.style.left = "";
      item.style.right = "";
      item.style.top = "";
      item.style.transform = "";
    });
  }

  function positionHeatmapSideItems() {
    const list = document.querySelector(".heatmap-side__list");
    const chartEl = document.querySelector("#chart-heatmap");
    const seriesOrder = (window.APP_CHART_DATA && Array.isArray(window.APP_CHART_DATA.heatmap))
      ? window.APP_CHART_DATA.heatmap
      : [];

    if (!list || !chartEl || !seriesOrder.length) return false;

    const chartRect = chartEl.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (!chartRect.height) return false;

    const rowCenters = getDistinctRowCenters(chartEl);
    if (!rowCenters.length) return false;

    list.style.height = `${chartRect.height}px`;
    list.style.paddingTop = "0";

    const items = Array.from(list.querySelectorAll(".heatmap-side__item"));
    const pairCount = Math.min(items.length, rowCenters.length);

    for (let i = 0; i < pairCount; i += 1) {
      const item = items[i];
      const top = rowCenters[i] - listRect.top;
      item.style.position = "absolute";
      item.style.left = "0";
      item.style.right = "0";
      item.style.top = `${top}px`;
      item.style.transform = "translateY(-50%)";
    }

    return true;
  }

  function syncHeatmapSideLayout() {
    const grid = document.querySelector(".heatmap-grid");
    const chartEl = document.querySelector("#chart-heatmap");
    const plotEl = chartEl ? chartEl.querySelector(".apexcharts-plot-area") : null;
    const rows = (window.APP_CHART_DATA && Array.isArray(window.APP_CHART_DATA.heatmap))
      ? window.APP_CHART_DATA.heatmap.length
      : 0;

    if (!grid || !chartEl || !rows) return false;

    if (window.matchMedia && window.matchMedia("(max-width: 992px)").matches) {
      const list = document.querySelector(".heatmap-side__list");
      resetHeatmapSideItems(list);
      return true;
    }

    if (positionHeatmapSideItems()) return true;

    const rectMetrics = getRowMetricsFromRects(chartEl, rows);
    if (rectMetrics) {
      grid.style.setProperty("--heatmap-row-h", `${rectMetrics.rowHeight}px`);
      grid.style.setProperty("--heatmap-top-pad", `${rectMetrics.topPad}px`);
      return true;
    }

    if (!plotEl) return false;

    let plotHeight = 0;
    if (typeof plotEl.getBBox === "function") {
      try { plotHeight = plotEl.getBBox().height || 0; } catch (e) { plotHeight = 0; }
    }
    if (!plotHeight) {
      const plotRect = plotEl.getBoundingClientRect();
      plotHeight = plotRect.height || 0;
    }

    if (!plotHeight || plotHeight < 1) return false;

    let topPad = parseTranslateY(plotEl.getAttribute("transform"));
    if (topPad == null) {
      const chartRect = chartEl.getBoundingClientRect();
      const plotRect = plotEl.getBoundingClientRect();
      topPad = plotRect.top - chartRect.top;
    }

    const rowHeight = plotHeight / rows;
    if (Number.isFinite(rowHeight) && rowHeight > 0) {
      grid.style.setProperty("--heatmap-row-h", `${rowHeight}px`);
    }
    if (Number.isFinite(topPad)) {
      grid.style.setProperty("--heatmap-top-pad", `${topPad}px`);
    }
    return true;
  }


  function scheduleHeatmapSync(retry = 0) {
    if (syncHeatmapSideLayout()) return;
    if (retry < 12) {
      requestAnimationFrame(() => scheduleHeatmapSync(retry + 1));
    }
  }

  // ==========================================
  // APEX CHARTS INIT (THEME AWARE)
  // ==========================================
  function initCharts() {
    if (!window.ApexCharts) return console.error("ApexCharts library missing");

    const chartData = window.APP_CHART_DATA;
    if (!chartData || !Array.isArray(chartData.heatmap)) return;

    const sortedHeatmap = sortHeatmapSeries(chartData.heatmap);
    const chartHeatmap = [...sortedHeatmap].reverse();
    const displayHeatmap = [...chartHeatmap].reverse();
    chartData.heatmap = chartHeatmap;
    reorderHeatmapSideList(displayHeatmap);

    // ✅ Определяем текущую тему из HTML тега (data-theme="light" или "dark")
    // Если атрибута нет, считаем dark по умолчанию
    const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const LOW_THRESHOLD = 40;
    const HIGH_THRESHOLD = 60;

    const commonOptions = {
      chart: {
        background: 'transparent',
        toolbar: { show: false },
        animations: { enabled: false },
        redrawOnParentResize: true
      },
      // ✅ Передаем тему в ApexCharts, чтобы он сам покрасил оси и подписи
      theme: {
          mode: currentTheme
      },
      dataLabels: { enabled: false },
      // Убираем явный цвет сетки, пусть ApexCharts сам решит, или используем прозрачный
      grid: {
          strokeDashArray: 4,
          borderColor: currentTheme === 'light' ? '#e5e7eb' : '#374151'
      },
    };

    // --- Helper для генерации HTML тултипа (Без хардкода цветов!) ---
    const generateTooltipHtml = (title, date, counts, percentVal) => {
        if (!counts) {
             return `
             <div class="chart-tooltip">
                <div class="chart-tooltip-header">
                    <span>${title} (${date})</span>
                </div>
                <div class="text-secondary">❌ Отчет не сдан</div>
             </div>`;
        }

        // Цвета Bootstrap (success/warning/danger) видны и на светлом, и на темном
        let clrClass = percentVal >= HIGH_THRESHOLD ? 'text-success' : (percentVal >= LOW_THRESHOLD ? 'text-warning' : 'text-danger');

        return `
        <div class="chart-tooltip">
            <div class="chart-tooltip-header">
                <span>${title}</span>
                <span class="${clrClass}">${percentVal}%</span>
            </div>
            
            <div class="chart-tooltip-row">
                <span class="text-success">Присутствуют:</span>
                <span class="fw-bold">${counts.p}</span>
            </div>
            ${counts.u > 0 ? `
            <div class="chart-tooltip-row">
                <span class="text-danger">Неуваж.:</span>
                <span class="fw-bold">${counts.u}</span>
            </div>` : ''}
            ${counts.o > 0 ? `
            <div class="chart-tooltip-row">
                <span class="text-warning">ОРВИ:</span>
                <span class="fw-bold">${counts.o}</span>
            </div>` : ''}
            ${counts.d > 0 ? `
            <div class="chart-tooltip-row">
                <span class="text-info">Другие:</span>
                <span class="fw-bold">${counts.d}</span>
            </div>` : ''}
            ${counts.f > 0 ? `
            <div class="chart-tooltip-row">
                <span class="text-secondary">Семейные:</span>
                <span class="fw-bold">${counts.f}</span>
            </div>` : ''}
        </div>`;
    };

    // 1. Timeline
    const tEl = document.querySelector("#chart-timeline");
    if (tEl) {
      tEl.innerHTML = "";
      new ApexCharts(tEl, {
        ...commonOptions,
        series: chartData.timeline,
        chart: { ...commonOptions.chart, type: 'area', height: 180 },
        colors: ['#0d6efd'],
        stroke: { curve: 'smooth', width: 2 },
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] } },
        yaxis: { min: 50, max: 100, tickAmount: 5, labels: { formatter: v => v.toFixed(0) } },
        xaxis: { tooltip: { enabled: false }, axisBorder: { show: false }, axisTicks: { show: false } },
        tooltip: {
            custom: function({series, seriesIndex, dataPointIndex, w}) {
                const dataPoint = w.config.series[seriesIndex].data[dataPointIndex];
                const date = dataPoint.x;
                const counts = dataPoint.counts;
                const val = dataPoint.y;
                return generateTooltipHtml("По школе", date, counts, val);
            }
        }
      }).render();
    }

    // 2. Heatmap
    const hEl = document.querySelector("#chart-heatmap");
    if (hEl) {
      hEl.innerHTML = "";
      const hHeight = Math.max(400, (chartData.heatmap.length * 28) + 50);

      const heatmapChart = new ApexCharts(hEl, {
        ...commonOptions,
        series: chartData.heatmap,
        chart: { ...commonOptions.chart, type: 'heatmap', height: hHeight, events: { mounted: () => scheduleHeatmapSync(), updated: () => scheduleHeatmapSync() } },
        plotOptions: {
          heatmap: {
            shadeIntensity: 0.5, radius: 4, useFillColorAsStroke: false,
            colorScale: {
              ranges: [
                { from: -1, to: -1, color: '#343a40', name: 'Нет отчета' },
                { from: 0, to: 39.9, color: '#dc3545', name: 'Низкая (<40%)' },
                { from: 40, to: 59.9, color: '#ffc107', name: 'Средняя (40-59%)' },
                { from: 60, to: 100, color: '#198754', name: 'Норма (≥60%)' }
              ]
            }
          }
        },
        // Цвет границ квадратиков зависит от темы (чтобы сливался с фоном)
        stroke: {
            width: 1,
            colors: [currentTheme === 'light' ? '#ffffff' : '#212529']
        },
        grid: { padding: { right: 20 } },
        xaxis: { tooltip: { enabled: false } },
        tooltip: {
            custom: function({series, seriesIndex, dataPointIndex, w}) {
                const dataPoint = w.config.series[seriesIndex].data[dataPointIndex];
                const className = w.globals.seriesNames[seriesIndex];
                const date = dataPoint.x;
                const counts = dataPoint.counts;
                const val = dataPoint.y;

                return generateTooltipHtml(className, date, counts, val);
            }
        }
      });

      window.__heatmapChart = heatmapChart;

      const renderResult = heatmapChart.render();
      const afterRender = () => {
        reorderHeatmapSideList([...chartData.heatmap].reverse());
        scheduleHeatmapSync();
        setTimeout(() => scheduleHeatmapSync(), 200);
      };
      if (renderResult && typeof renderResult.then === "function") {
        renderResult.then(() => afterRender());
      } else {
        afterRender();
      }
      window.addEventListener("resize", () => scheduleHeatmapSync());
    }
  }

  // Запуск
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initCharts);
  else initCharts();

})();
