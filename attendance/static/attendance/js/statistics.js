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

  (function initFilters() {
    const globalInput = $("#global-search");
    const classInput = $("#filter-class");
    const studentInput = $("#filter-student");
    const minUnexcusedInput = $("#filter-min-unexcused");
    const minAbsencesInput = $("#filter-min-absences");
    const typeSelect = $("#filter-table-type");
    const resetBtn = $("#reset-filters");

    if (!globalInput || !classInput || !studentInput || !minUnexcusedInput || !minAbsencesInput || !typeSelect) return;

    function applyFilters() {
      const globalTerm = globalInput.value.trim().toLowerCase();
      const classTerm = classInput.value.trim().toLowerCase();
      const studentTerm = studentInput.value.trim().toLowerCase();
      const minUnexcused = parseInt(minUnexcusedInput.value || "0", 10) || 0;
      const minAbsences = parseInt(minAbsencesInput.value || "0", 10) || 0;
      const tableType = typeSelect.value;

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

      // sync quick buttons state (UI only)
      $$("[data-table-type-btn]").forEach((btn) => {
        const v = btn.getAttribute("data-table-type-btn");
        const isActive = (tableType === v);
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    const applyFiltersDebounced = debounce(applyFilters, 150);

    [globalInput, classInput, studentInput, minUnexcusedInput, minAbsencesInput].forEach((el) => {
      el.addEventListener("input", applyFiltersDebounced);
      el.addEventListener("change", applyFilters);
    });

    typeSelect.addEventListener("change", applyFilters);

    // quick buttons -> select
    $$("[data-table-type-btn]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-table-type-btn");
        if (!v) return;
        typeSelect.value = v;
        applyFilters();
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
        applyFilters();
        globalInput.focus();
      });
    }

    applyFilters();
  })();
})();