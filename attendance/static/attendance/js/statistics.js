(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // --- Helpers ---
  function textMatches(el, needle) {
    if (!needle) return true;
    return (el.textContent || "").toLowerCase().includes(needle.toLowerCase());
  }

  function debounce(fn, wait = 150) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // --- Collapse Logic ---
  const collapseInstance = new WeakMap();
  const SECTION_KINDS = ["visuals", "privileged_types", "daily", "by_class", "by_student"];

  function getCollapseInstance(el) {
    if (!el || !window.bootstrap || !window.bootstrap.Collapse) return null;
    if (collapseInstance.has(el)) return collapseInstance.get(el);
    const inst = window.bootstrap.Collapse.getInstance(el) || new window.bootstrap.Collapse(el, { toggle: false });
    collapseInstance.set(el, inst);
    return inst;
  }

  function setButtonExpanded(kind, expanded) {
    const btn = document.querySelector(`[data-section-toggle-btn="${kind}"]`);
    if (btn) btn.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  function setSectionExpanded(kind, expanded) {
    const body = document.querySelector(`[data-section-collapse="${kind}"]`);
    if (!body) return;
    const inst = getCollapseInstance(body);
    if (inst) {
      expanded ? inst.show() : inst.hide();
    } else {
      body.classList.toggle("show", !!expanded);
    }
    setButtonExpanded(kind, expanded);
  }

  function scrollToSection(kind) {
    const btn = document.querySelector(`[data-section-toggle-btn="${kind}"]`);
    if (!btn) return;
    const top = btn.getBoundingClientRect().top + window.pageYOffset - 12;
    window.scrollTo({ top, behavior: "smooth" });
  }

  function syncSectionsForTableType(tableType, { doScroll = false } = {}) {
    if (tableType === "all") return;
    SECTION_KINDS.forEach(k => setSectionExpanded(k, k === tableType));
    if (doScroll) setTimeout(() => scrollToSection(tableType), 60);
  }

  // --- Smart Auto-Open ---
  function isRowVisible(row) {
    return row && row.style.display !== "none";
  }

  function hasVisibleRowsInSection(kind) {
    const block = document.querySelector(`[data-section-block="${kind}"]`);
    if (!block || block.style.display === "none") return false;
    if (kind === "visuals") return true;
    const rows = $$(`tr[data-row-type="${kind}"]`, block);
    return rows.some(isRowVisible);
  }

  function applySmartAutoCollapse({ tableType, isFiltering } = {}) {
    if (tableType !== "all" || !isFiltering) return;
    SECTION_KINDS.forEach(k => {
      if (k === "visuals") return;
      setSectionExpanded(k, hasVisibleRowsInSection(k));
    });
  }

  // --- Filtering ---
  (function initFilters() {
    const globalInput = $("#global-search");
    const classInput = $("#filter-class");
    const studentInput = $("#filter-student");
    const minUnexcusedInput = $("#filter-min-unexcused");
    const minAbsencesInput = $("#filter-min-absences");
    const typeSelect = $("#filter-table-type");
    const resetBtn = $("#reset-filters");

    if (!globalInput || !typeSelect) return;

    function applyFilters({ doScroll = false } = {}) {
      const globalTerm = globalInput.value.trim().toLowerCase();
      const classTerm = classInput ? classInput.value.trim().toLowerCase() : "";
      const studentTerm = studentInput ? studentInput.value.trim().toLowerCase() : "";
      const minUnexcused = minUnexcusedInput ? (parseInt(minUnexcusedInput.value || "0", 10) || 0) : 0;
      const minAbsences = minAbsencesInput ? (parseInt(minAbsencesInput.value || "0", 10) || 0) : 0;
      const tableType = typeSelect.value;

      const isFiltering = !!(globalTerm || classTerm || studentTerm || minUnexcused || minAbsences);

      $$("[data-section-block]").forEach((block) => {
        const kind = block.dataset.sectionBlock;
        block.style.display = (tableType === "all" || tableType === kind) ? "" : "none";
      });

      $$("tr[data-row-type]").forEach((row) => {
        const rowType = row.dataset.rowType;
        const className = (row.dataset.className || "").toLowerCase();
        const studentName = (row.dataset.studentName || "").toLowerCase();
        const unexcused = parseInt(row.dataset.unexcused || row.dataset.totalUnexcused || "0", 10) || 0;
        const absenceCount = parseInt(row.dataset.absenceCount || "0", 10) || 0;

        let visible = true;
        if (tableType !== "all" && rowType !== tableType) visible = false;
        if (visible && globalTerm && !textMatches(row, globalTerm)) visible = false;
        if (visible && classTerm && !className.includes(classTerm)) visible = false;
        if (visible && studentTerm) {
          if (rowType === "by_student") {
            if (!studentName.includes(studentTerm)) visible = false;
          } else if (!textMatches(row, studentTerm)) {
            visible = false;
          }
        }
        if (visible && minUnexcused > 0 && ["daily", "by_class"].includes(rowType) && unexcused < minUnexcused) visible = false;
        if (visible && minAbsences > 0 && rowType === "by_student" && absenceCount < minAbsences) visible = false;

        row.style.display = visible ? "" : "none";
      });

      const dailyBlock = document.querySelector(`[data-section-block="daily"]`);
      if (dailyBlock && dailyBlock.style.display !== "none") {
         $$(".accordion-item", dailyBlock).forEach(item => {
            const hasVis = $$(`tr[data-row-type="daily"]`, item).some(isRowVisible);
            item.style.display = hasVis ? "" : "none";
         });
      }

      $$("[data-table-type-btn]").forEach((btn) => {
        const v = btn.getAttribute("data-table-type-btn");
        const isActive = (tableType === v);
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-pressed", isActive);
      });

      if (tableType === "all") applySmartAutoCollapse({ tableType, isFiltering });
      else syncSectionsForTableType(tableType, { doScroll });
    }

    const applyDebounced = debounce(() => applyFilters({ doScroll: false }), 150);

    [globalInput, classInput, studentInput, minUnexcusedInput, minAbsencesInput].forEach(el => {
      if(el) {
          el.addEventListener("input", applyDebounced);
          el.addEventListener("change", () => applyFilters({ doScroll: false }));
      }
    });

    typeSelect.addEventListener("change", () => applyFilters({ doScroll: true }));

    $$("[data-table-type-btn]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-table-type-btn");
        if(v) { typeSelect.value = v; applyFilters({ doScroll: true }); }
      });
    });

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        globalInput.value = "";
        if(classInput) classInput.value = "";
        if(studentInput) studentInput.value = "";
        if(minUnexcusedInput) minUnexcusedInput.value = "";
        if(minAbsencesInput) minAbsencesInput.value = "";
        typeSelect.value = "all";
        applyFilters({ doScroll: false });
      });
    }

    applyFilters({ doScroll: false });
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

  function getSeriesRowCenters(chartEl, seriesOrder) {
    const seriesEls = Array.from(chartEl.querySelectorAll(".apexcharts-series"));
    if (!seriesEls.length) return [];
    const centers = [];

    seriesEls.forEach((seriesEl, idx) => {
      const rect = seriesEl.querySelector(".apexcharts-heatmap-rect");
      if (!rect) return;
      const r = rect.getBoundingClientRect();
      if (!r.height) return;
      const name = seriesEl.getAttribute("seriesname")
        || seriesEl.getAttribute("seriesName")
        || (seriesOrder[idx] && seriesOrder[idx].name);
      if (!name) return;
      centers.push({ name, center: r.top + (r.height / 2) });
    });

    return centers;
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

    const centers = getSeriesRowCenters(chartEl, seriesOrder);
    if (!centers.length) return false;

    list.style.height = `${chartRect.height}px`;
    list.style.paddingTop = "0";

    const items = new Map();
    list.querySelectorAll(".heatmap-side__item").forEach(item => {
      const name = (item.dataset.className || item.textContent || "").trim();
      if (name) items.set(name, item);
    });

    centers.forEach(({ name, center }) => {
      const item = items.get(name);
      if (!item) return;
      const top = center - listRect.top;
      item.style.position = "absolute";
      item.style.left = "0";
      item.style.right = "0";
      item.style.top = `${top}px`;
      item.style.transform = "translateY(-50%)";
    });

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
    chartData.heatmap = chartHeatmap;
    reorderHeatmapSideList(chartHeatmap);

    // ✅ Определяем текущую тему из HTML тега (data-theme="light" или "dark")
    // Если атрибута нет, считаем dark по умолчанию
    const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

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
        let clrClass = percentVal >= 95 ? 'text-success' : (percentVal >= 85 ? 'text-warning' : 'text-danger');

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
                { from: 0, to: 84.9, color: '#dc3545', name: 'Низкая (<85%)' },
                { from: 85, to: 94.9, color: '#ffc107', name: 'Средняя (85-94%)' },
                { from: 95, to: 100, color: '#198754', name: 'Норма (≥95%)' }
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
        reorderHeatmapSideList(chartData.heatmap);
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