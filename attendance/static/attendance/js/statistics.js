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
  });
  document.addEventListener("hidden.bs.collapse", e => {
     const k = e.target.getAttribute("data-section-collapse");
     if(k) setButtonExpanded(k, false);
  });


  // ==========================================
  // APEX CHARTS INIT (THEME AWARE)
  // ==========================================
  function initCharts() {
    if (!window.ApexCharts) return console.error("ApexCharts library missing");

    const chartData = window.APP_CHART_DATA;
    if (!chartData || !chartData.heatmap) return;

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

      new ApexCharts(hEl, {
        ...commonOptions,
        series: chartData.heatmap,
        chart: { ...commonOptions.chart, type: 'heatmap', height: hHeight },
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
      }).render();
    }
  }

  // Запуск
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initCharts);
  else initCharts();

})();