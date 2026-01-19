(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function textMatches(el, needle) {
    if (!needle) return true;
    const txt = (el.textContent || "").toLowerCase();
    return txt.includes(needle.toLowerCase());
  }

  function debounce(fn, wait = 150) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // -----------------------------
  // Section collapse helpers
  // -----------------------------
  const collapseInstance = new WeakMap();
  const SECTION_KINDS = ["privileged_types", "daily", "by_class", "by_student"];

  function hasBootstrapCollapse() {
    return typeof window !== "undefined" && !!window.bootstrap && !!window.bootstrap.Collapse;
  }

  function getCollapseInstance(el) {
    if (!el) return null;
    if (!hasBootstrapCollapse()) return null;

    if (collapseInstance.has(el)) return collapseInstance.get(el);

    const inst = window.bootstrap.Collapse.getInstance(el) || new window.bootstrap.Collapse(el, { toggle: false });
    collapseInstance.set(el, inst);
    return inst;
  }

  function setButtonExpanded(kind, expanded) {
    const btn = document.querySelector(`[data-section-toggle-btn="${kind}"]`);
    if (!btn) return;
    btn.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  function setSectionExpanded(kind, expanded) {
    const body = document.querySelector(`[data-section-collapse="${kind}"]`);
    if (!body) return;

    const section = body.closest("[data-section-block]");
    const sectionHidden = section && section.style.display === "none";
    if (sectionHidden && expanded) return;

    const inst = getCollapseInstance(body);
    if (inst) {
      if (expanded) inst.show();
      else inst.hide();
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
    if (tableType === "all") {
      // all показываем, но по умолчанию закрыты
      SECTION_KINDS.forEach(k => setSectionExpanded(k, false));
      return;
    }

    SECTION_KINDS.forEach(k => setSectionExpanded(k, k === tableType));

    if (doScroll) {
      setTimeout(() => scrollToSection(tableType), 60);
    }
  }

  // -----------------------------
  // Smart auto-open logic (only for tableType=all)
  // -----------------------------
  function isRowVisible(row) {
    // row.style.display может быть пустым -> считаем видимым
    return row && row.style.display !== "none";
  }

  function hasVisibleRowsInSection(kind) {
    const block = document.querySelector(`[data-section-block="${kind}"]`);
    if (!block || block.style.display === "none") return false;

    const rows = $$(`tr[data-row-type="${kind}"]`, block);
    return rows.some(isRowVisible);
  }

  function applySmartAutoCollapse({ tableType, isFiltering } = {}) {
    // ВАЖНО: умное авто-раскрытие действует только когда выбрано "Все"
    if (tableType !== "all") return;

    if (!isFiltering) {
      // фильтров нет -> все закрыты
      SECTION_KINDS.forEach(k => setSectionExpanded(k, false));
      return;
    }

    // фильтры есть -> открываем только секции с видимыми строками
    SECTION_KINDS.forEach(k => {
      const open = hasVisibleRowsInSection(k);
      setSectionExpanded(k, open);
    });
  }

  function syncDailyAccordionVisibility() {
    const dailyBlock = document.querySelector(`[data-section-block="daily"]`);
    if (!dailyBlock || dailyBlock.style.display === "none") return;

    // каждый день — accordion-item, внутри есть таблица со строками daily
    const items = $$(".accordion-item", dailyBlock);
    items.forEach(item => {
      const rows = $$(`tr[data-row-type="daily"]`, item);
      const hasVisible = rows.some(isRowVisible);
      item.style.display = hasVisible ? "" : "none";
    });
  }

  (function initFilters() {
    const globalInput = $("#global-search");
    const classInput = $("#filter-class");
    const studentInput = $("#filter-student");
    const minUnexcusedInput = $("#filter-min-unexcused");
    const minAbsencesInput = $("#filter-min-absences");
    const typeSelect = $("#filter-table-type");
    const resetBtn = $("#reset-filters");

    if (!globalInput || !classInput || !studentInput || !minUnexcusedInput || !minAbsencesInput || !typeSelect) return;

    function applyFilters({ doScroll = false } = {}) {
      const globalTerm = globalInput.value.trim().toLowerCase();
      const classTerm = classInput.value.trim().toLowerCase();
      const studentTerm = studentInput.value.trim().toLowerCase();
      const minUnexcused = parseInt(minUnexcusedInput.value || "0", 10) || 0;
      const minAbsences = parseInt(minAbsencesInput.value || "0", 10) || 0;
      const tableType = typeSelect.value;

      const isFiltering =
        !!globalTerm ||
        !!classTerm ||
        !!studentTerm ||
        minUnexcused > 0 ||
        minAbsences > 0;

      // sections visibility
      $$("[data-section-block]").forEach((block) => {
        const kind = block.dataset.sectionBlock;
        block.style.display = (tableType === "all" || tableType === kind) ? "" : "none";
      });

      // rows visibility
      $$("tr[data-row-type]").forEach((row) => {
        const rowType = row.dataset.rowType;
        const className = (row.dataset.className || "").toLowerCase();
        const studentName = (row.dataset.studentName || "").toLowerCase();
        const unexcused = parseInt(row.dataset.unexcused || row.dataset.totalUnexcused || "0", 10) || 0;
        const absenceCount = parseInt(row.dataset.absenceCount || "0", 10) || 0;

        let visible = true;

        // filter by table type
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

        if (visible && minUnexcused > 0 && (rowType === "daily" || rowType === "by_class")) {
          if (unexcused < minUnexcused) visible = false;
        }

        if (visible && minAbsences > 0 && rowType === "by_student") {
          if (absenceCount < minAbsences) visible = false;
        }

        row.style.display = visible ? "" : "none";
      });

      // daily: скрываем дни без строк после фильтрации
      syncDailyAccordionVisibility();

      // sync quick buttons state (UI only)
      $$("[data-table-type-btn]").forEach((btn) => {
        const v = btn.getAttribute("data-table-type-btn");
        const isActive = (tableType === v);
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });

      // collapse behavior
      if (tableType === "all") {
        // при "Все" работаем умно
        applySmartAutoCollapse({ tableType, isFiltering });
      } else {
        // при выборе конкретной таблицы — раскрываем её (как раньше)
        syncSectionsForTableType(tableType, { doScroll });
      }
    }

    const applyFiltersDebounced = debounce(() => applyFilters({ doScroll: false }), 150);

    [globalInput, classInput, studentInput, minUnexcusedInput, minAbsencesInput].forEach((el) => {
      el.addEventListener("input", applyFiltersDebounced);
      el.addEventListener("change", () => applyFilters({ doScroll: false }));
    });

    // select: раскрываем выбранную секцию и скроллим к ней
    typeSelect.addEventListener("change", () => applyFilters({ doScroll: true }));

    // quick buttons -> select (+scroll)
    $$("[data-table-type-btn]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-table-type-btn");
        if (!v) return;
        typeSelect.value = v;
        applyFilters({ doScroll: true });
      });
    });

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        globalInput.value = "";
        classInput.value = "";
        studentInput.value = "";
        minUnexcusedInput.value = "";
        minAbsencesInput.value = "";
        typeSelect.value = "all";
        applyFilters({ doScroll: false });
        globalInput.focus();
      });
    }

    // init (всё закрыто, как требуется)
    applyFilters({ doScroll: false });
  })();

  // Keep aria-expanded in sync if user manually collapses/expands
  (function syncAriaOnUserToggle() {
    document.addEventListener("shown.bs.collapse", (e) => {
      const kind = e.target && e.target.getAttribute("data-section-collapse");
      if (!kind) return;
      setButtonExpanded(kind, true);
    });

    document.addEventListener("hidden.bs.collapse", (e) => {
      const kind = e.target && e.target.getAttribute("data-section-collapse");
      if (!kind) return;
      setButtonExpanded(kind, false);
    });
  })();
})();