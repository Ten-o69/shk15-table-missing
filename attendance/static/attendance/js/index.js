(() => {
    // -----------------------------
    // Helpers
    // -----------------------------
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const REASON_MODES = ["unexcused", "orvi", "other", "family"];

    // --- Bootstrap detection / waiting ---
    function hasBootstrap() {
        return typeof window !== "undefined" && !!window.bootstrap && !!window.bootstrap.Modal;
    }

    function waitForBootstrap(cb, { tries = 80, delay = 25 } = {}) {
        let t = 0;
        const tick = () => {
            if (hasBootstrap()) return cb(window.bootstrap);
            t += 1;
            if (t >= tries) {
                console.error("Bootstrap JS не загружен: window.bootstrap.Modal недоступен.");
                return;
            }
            setTimeout(tick, delay);
        };
        tick();
    }

    function parseIntSafe(value) {
        if (value === null || value === undefined) return 0;
        const s = String(value).trim();
        if (!s) return 0;
        const n = parseInt(s, 10);
        return Number.isNaN(n) ? 0 : n;
    }

    // IDs: только цифры. Убираем "None/null/undefined" и любой мусор.
    function parseIdsList(raw) {
        const s = (raw || "").trim();
        if (!s) return [];

        const parts = s
            .split(",")
            .map(x => String(x).trim())
            .filter(Boolean)
            .filter(p => {
                const low = p.toLowerCase();
                if (low === "none" || low === "null" || low === "undefined") return false;
                return /^\d+$/.test(p);
            });

        const seen = new Set();
        const out = [];
        parts.forEach(p => {
            if (!seen.has(p)) {
                seen.add(p);
                out.push(p);
            }
        });
        return out;
    }

    function joinIdsList(ids) {
        return (ids || [])
            .map(x => String(x).trim())
            .filter(Boolean)
            .filter(p => {
                const low = p.toLowerCase();
                if (low === "none" || low === "null" || low === "undefined") return false;
                return /^\d+$/.test(p);
            })
            .join(",");
    }

    function getRowByClassId(classId) {
        return document.querySelector(`tr[data-class-id="${classId}"]`);
    }

    // -----------------------------
    // Mode config (вся логика в одном месте)
    // -----------------------------
    const MODES = {
        unexcused: {
            label: "неуважительных",
            countPrefix: "unexcused_absent_",
            hiddenId: cid => `absent-students-${cid}`,
            selectedId: cid => `selected-students-${cid}`,
            errorId: cid => `error-${cid}`,
        },
        orvi: {
            label: "ОРВИ",
            countPrefix: "orvi_",
            hiddenId: cid => `orvi-students-${cid}`,
            selectedId: cid => `selected-orvi-students-${cid}`,
            errorId: cid => `error-orvi-${cid}`,
        },
        other: {
            label: "случаев по другим заболеваниям",
            countPrefix: "other_disease_",
            hiddenId: cid => `other-students-${cid}`,
            selectedId: cid => `selected-other-students-${cid}`,
            errorId: cid => `error-other-${cid}`,
        },
        family: {
            label: "отсутствий по семейным обстоятельствам",
            countPrefix: "family_",
            hiddenId: cid => `family-students-${cid}`,
            selectedId: cid => `selected-family-students-${cid}`,
            errorId: cid => `error-family-${cid}`,
        },
        all: {
            label: null,
            countPrefix: null,
            hiddenId: cid => `all-absent-students-${cid}`,
            selectedId: cid => `selected-all-students-${cid}`,
            errorId: cid => `error-all-${cid}`,
        }
    };

    function getHiddenEl(classId, mode) {
        const id = MODES[mode].hiddenId(classId);
        return document.getElementById(id);
    }

    function getSelectedEl(classId, mode) {
        const id = MODES[mode].selectedId(classId);
        return document.getElementById(id);
    }

    function getCountInput(row, mode) {
        const prefix = MODES[mode].countPrefix;
        if (!prefix) return null;
        return row.querySelector(`input[name^="${prefix}"]`);
    }

    // -----------------------------
    // Students cache: classId -> Map(id -> name)
    // -----------------------------
    const studentMapCache = new Map();

    function buildStudentMapForClass(classId) {
        if (studentMapCache.has(classId)) return studentMapCache.get(classId);

        const container = document.getElementById(`students-container-${classId}`);
        const map = new Map();

        if (container) {
            $$(".student-option", container).forEach(el => {
                const id = String(el.dataset.studentId || "").trim();
                const name = String(el.dataset.studentName || "").trim();
                if (id && /^\d+$/.test(id) && name) {
                    map.set(id, name);
                }
            });
        }

        studentMapCache.set(classId, map);
        return map;
    }

    function idToName(classId, id) {
        const map = buildStudentMapForClass(classId);
        return map.get(String(id)) || null;
    }

    // -----------------------------
    // UI render: pills list from IDs (один источник истины)
    // -----------------------------
    function renderPillsFromIds(containerEl, classId, ids) {
        containerEl.innerHTML = "";

        const cleanIds = (ids || []).map(String).filter(x => /^\d+$/.test(x));

        if (!cleanIds.length) {
            const span = document.createElement("span");
            span.className = "muted";
            span.textContent = "Ученики не выбраны";
            containerEl.appendChild(span);
            return;
        }

        const ul = document.createElement("ul");
        ul.className = "pill-list";

        cleanIds.forEach(id => {
            const name = idToName(classId, id) || `ID ${id}`;
            const li = document.createElement("li");
            li.className = "pill";
            li.textContent = name;
            ul.appendChild(li);
        });

        containerEl.appendChild(ul);
    }

    // -----------------------------
    // Sync number <-> hidden ids
    // -----------------------------
    function syncCountFromIds(row, mode, idsCount) {
        const input = getCountInput(row, mode);
        if (!input) return;

        input.value = String(idsCount || 0);
        input.readOnly = true;
        input.title = "Число выставляется автоматически по выбранным ученикам";
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function syncCountFromHidden(classId, mode) {
        const row = getRowByClassId(classId);
        if (!row) return;

        const hidden = getHiddenEl(classId, mode);
        const input = getCountInput(row, mode);

        if (!hidden || !input) return;

        const ids = parseIdsList(hidden.value);
        syncCountFromIds(row, mode, ids.length);
    }

    // -----------------------------
    // ALL sync helpers
    // -----------------------------
    function getReasonUnionIds(classId) {
        const set = new Set();
        REASON_MODES.forEach(mode => {
            const h = getHiddenEl(classId, mode);
            if (!h) return;
            parseIdsList(h.value).forEach(id => set.add(id));
        });
        return Array.from(set);
    }

    function syncAllFromReasons(classId) {
        const allHidden = getHiddenEl(classId, "all");
        const allContainer = getSelectedEl(classId, "all");
        if (!allHidden || !allContainer) return;

        const union = getReasonUnionIds(classId);
        allHidden.value = joinIdsList(union);
        renderPillsFromIds(allContainer, classId, union);
    }

    function removeIdsFromAllReasons(classId, removedIds) {
        const row = getRowByClassId(classId);
        if (!row) return;

        const removed = new Set((removedIds || []).map(String));
        REASON_MODES.forEach(mode => {
            const h = getHiddenEl(classId, mode);
            const c = getSelectedEl(classId, mode);
            if (!h || !c) return;

            const ids = parseIdsList(h.value).filter(id => !removed.has(String(id)));
            h.value = joinIdsList(ids);

            renderPillsFromIds(c, classId, ids);
            syncCountFromIds(row, mode, ids.length);
        });
    }

    function removeIdsFromOtherReasons(classId, currentMode, idsToMove) {
        const row = getRowByClassId(classId);
        if (!row) return;

        const moveSet = new Set((idsToMove || []).map(String));
        REASON_MODES.forEach(mode => {
            if (mode === currentMode) return;

            const h = getHiddenEl(classId, mode);
            const c = getSelectedEl(classId, mode);
            if (!h || !c) return;

            const before = parseIdsList(h.value);
            const after = before.filter(id => !moveSet.has(String(id)));

            if (after.length !== before.length) {
                h.value = joinIdsList(after);
                renderPillsFromIds(c, classId, after);
                syncCountFromIds(row, mode, after.length);
            }
        });
    }

    // -----------------------------
    // Validation
    // -----------------------------
    function setErrorText(errEl, text) {
        if (!errEl) return;
        errEl.textContent = text || "";
        errEl.style.display = text ? "block" : "none";
        errEl.style.color = text ? "#ff6b6b" : "";
    }

    function markInputInvalid(input, isInvalid) {
        if (!input) return;
        if (isInvalid) {
            input.style.borderColor = "#ff6b6b";
            input.style.backgroundColor = "rgba(255, 107, 107, 0.08)";
            input.setAttribute("data-invalid", "1");
        } else {
            input.style.borderColor = "";
            input.style.backgroundColor = "";
            input.removeAttribute("data-invalid");
        }
    }

    function validateNoReasonDuplicates(classId) {
        const map = new Map();

        REASON_MODES.forEach(mode => {
            const h = getHiddenEl(classId, mode);
            if (!h) return;
            parseIdsList(h.value).forEach(id => {
                const key = String(id);
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(mode);
            });
        });

        const duplicates = Array.from(map.entries()).filter(([_, modes]) => modes.length > 1);
        if (!duplicates.length) return true;

        const row = getRowByClassId(classId);
        const nameMap = buildStudentMapForClass(classId);

        const byMode = new Map();
        duplicates.forEach(([id, modes]) => {
            modes.forEach(m => {
                if (!byMode.has(m)) byMode.set(m, []);
                byMode.get(m).push(id);
            });
        });

        byMode.forEach((ids, mode) => {
            const err = document.getElementById(MODES[mode].errorId(classId));
            const input = row ? getCountInput(row, mode) : null;

            const preview = ids.slice(0, 3).map(id => nameMap.get(String(id)) || `ID ${id}`);
            const msg =
                `ОШИБКА: ученик не может быть сразу в нескольких причинах. ` +
                `Повторы: ${preview.join(", ")}${ids.length > 3 ? "…" : ""}`;

            if (err) {
                const existing = (err.textContent || "").trim();
                if (existing) {
                    if (!existing.includes("не может быть сразу в нескольких причинах")) {
                        err.textContent = existing + "\n" + msg;
                        err.style.display = "block";
                        err.style.color = "#ff6b6b";
                    }
                } else {
                    setErrorText(err, msg);
                }
            }

            if (input) markInputInvalid(input, true);
        });

        return false;
    }

    function validateReason(classId, mode) {
        const row = getRowByClassId(classId);
        if (!row) return;

        const cfg = MODES[mode];
        const input = getCountInput(row, mode);
        const err = document.getElementById(cfg.errorId(classId));
        const hidden = getHiddenEl(classId, mode);

        if (!err || !hidden) return;
        if (!input) return;

        const ids = parseIdsList(hidden.value);
        const selectedCount = ids.length;

        const countValue = parseIntSafe(input.value);
        let hasError = false;

        if (countValue < 0) hasError = true;
        else if (countValue === 0 && selectedCount === 0) hasError = false;
        else if (countValue !== selectedCount) hasError = true;

        if (hasError) {
            setErrorText(
                err,
                `Число ${cfg.label} (${Number.isNaN(countValue) ? "—" : countValue}) ` +
                `должно совпадать с количеством выбранных учеников (${selectedCount}).`
            );
            input.style.borderColor = "#ff6b6b";
            input.style.backgroundColor = "rgba(255, 107, 107, 0.08)";
        } else {
            const existing = (err.textContent || "").trim();
            if (existing && existing.includes("не может быть сразу в нескольких причинах")) {
                // оставляем
            } else {
                setErrorText(err, "");
                input.style.borderColor = "";
                input.style.backgroundColor = "";
            }
        }
    }

    function validateAllAbsent(classId) {
        const allField = getHiddenEl(classId, "all");
        const err = document.getElementById(MODES.all.errorId(classId));
        if (!allField || !err) return;

        const allIds = parseIdsList(allField.value);

        const union = []
            .concat(
                parseIdsList((getHiddenEl(classId, "unexcused") || {}).value),
                parseIdsList((getHiddenEl(classId, "orvi") || {}).value),
                parseIdsList((getHiddenEl(classId, "other") || {}).value),
                parseIdsList((getHiddenEl(classId, "family") || {}).value),
            );

        let hasError = false;

        if (union.length === 0) {
            hasError = false;
        } else if (allIds.length === 0) {
            hasError = true;
        } else {
            const setAll = new Set(allIds);
            union.forEach(id => {
                if (!setAll.has(id)) hasError = true;
            });
        }

        if (hasError) {
            setErrorText(
                err,
                "В списке всех отсутствующих должны быть как минимум все ученики из всех указанных списков причин " +
                "(неуважительные, ОРВИ, другие заболевания, семейные)."
            );
        } else {
            setErrorText(err, "");
        }
    }

    function validateCountsForClass(classId) {
        const row = getRowByClassId(classId);
        if (!row) return true;

        const totalStudents = parseIntSafe(row.dataset.totalStudents || "0");
        if (!totalStudents) return true;

        const presentInput = row.querySelector('input[name^="reported_present_"]');
        const unexcusedInput = row.querySelector('input[name^="unexcused_absent_"]');
        const orviInput = row.querySelector('input[name^="orvi_"]');
        const otherInput = row.querySelector('input[name^="other_disease_"]');
        const familyInput = row.querySelector('input[name^="family_"]');

        const unexcused = unexcusedInput ? parseIntSafe(unexcusedInput.value) : 0;
        const orvi = orviInput ? parseIntSafe(orviInput.value) : 0;
        const other = otherInput ? parseIntSafe(otherInput.value) : 0;
        const family = familyInput ? parseIntSafe(familyInput.value) : 0;

        const totalAbsent = unexcused + orvi + other + family;

        let present = 0;
        if (presentInput) {
            present = totalAbsent <= totalStudents ? (totalStudents - totalAbsent) : 0;
            presentInput.value = String(present);
        }

        let ok = true;

        function resetField(input) {
            if (!input) return;
            if (input.getAttribute("data-invalid") === "1") return;
            input.style.borderColor = "";
            input.style.backgroundColor = "";
        }

        function markInvalid(input) {
            if (!input) return;
            input.style.borderColor = "#ff6b6b";
            input.style.backgroundColor = "rgba(255, 107, 107, 0.08)";
            input.setAttribute("data-invalid", "1");
        }

        [presentInput, unexcusedInput, orviInput, otherInput, familyInput].forEach(resetField);

        function checkField(input, value) {
            if (!input) return;
            if (value < 0 || value > totalStudents) {
                ok = false;
                markInvalid(input);
            }
        }

        checkField(unexcusedInput, unexcused);
        checkField(orviInput, orvi);
        checkField(otherInput, other);
        checkField(familyInput, family);
        if (presentInput) checkField(presentInput, present);

        if (present + totalAbsent > totalStudents) {
            [presentInput, unexcusedInput, orviInput, otherInput, familyInput].forEach(markInvalid);
            ok = false;
        }

        return ok;
    }

    function validateAllForClass(classId) {
        validateReason(classId, "unexcused");
        validateReason(classId, "orvi");
        validateReason(classId, "other");
        validateReason(classId, "family");

        validateAllAbsent(classId);

        const noDup = validateNoReasonDuplicates(classId);
        const okCounts = validateCountsForClass(classId);

        return noDup && okCounts;
    }

    // -----------------------------
    // Unified table modal: students list
    // -----------------------------
    (function initStudentsModal() {
        const tableModal = window.TableModal;
        if (!tableModal) return;

        const sortOptions = [
            { value: "default", label: "По порядку" },
            { value: "name_asc", label: "ФИО А-Я" },
            { value: "name_desc", label: "ФИО Я-А" },
        ];

        const allHint =
            "В этом списке можно только удалять учеников (снимать галочки). " +
            "Чтобы добавить отсутствующего - используйте столбцы причин " +
            "(неуважительные/ОРВИ/другие/семейные).";

        let currentClassId = null;
        let currentMode = null;
        let allBeforeOpen = [];

        function resetState() {
            currentClassId = null;
            currentMode = null;
            allBeforeOpen = [];
        }

        function applySelection(selectedIds) {
            if (!currentClassId || !currentMode) return true;

            const row = getRowByClassId(currentClassId);
            const hidden = getHiddenEl(currentClassId, currentMode);
            const selectedContainer = getSelectedEl(currentClassId, currentMode);

            if (!row || !hidden || !selectedContainer) return true;

            const ids = parseIdsList((selectedIds || []).join(","));

            if (currentMode === "all") {
                const beforeSet = new Set(allBeforeOpen.map(String));
                const newAll = ids.filter(id => beforeSet.has(String(id)));
                const removed = allBeforeOpen.filter(id => !newAll.includes(String(id)));

                hidden.value = joinIdsList(newAll);
                renderPillsFromIds(selectedContainer, currentClassId, newAll);

                if (removed.length) removeIdsFromAllReasons(currentClassId, removed);

                syncAllFromReasons(currentClassId);
                validateAllForClass(currentClassId);
                return true;
            }

            removeIdsFromOtherReasons(currentClassId, currentMode, ids);
            hidden.value = joinIdsList(ids);
            renderPillsFromIds(selectedContainer, currentClassId, ids);
            syncCountFromIds(row, currentMode, ids.length);
            syncAllFromReasons(currentClassId);

            validateAllForClass(currentClassId);
            return true;
        }

        function openModal(classId, mode) {
            currentClassId = String(classId || "");
            currentMode = MODES[mode] ? mode : "unexcused";

            const hidden = getHiddenEl(currentClassId, currentMode);
            if (!hidden) return;

            const container = document.getElementById(`students-container-${currentClassId}`);
            if (!container) return;

            let sanitized = parseIdsList(hidden.value);

            const allowedAllSet = currentMode === "all"
                ? new Set(getReasonUnionIds(currentClassId).map(String))
                : null;

            if (allowedAllSet) {
                sanitized = sanitized.filter(id => allowedAllSet.has(String(id)));
            }

            hidden.value = joinIdsList(sanitized);

            const selectedSet = new Set(sanitized);
            allBeforeOpen = (currentMode === "all") ? Array.from(selectedSet) : [];

            const items = [];
            $$(".student-option", container).forEach(item => {
                const id = String(item.dataset.studentId || "").trim();
                const name = String(item.dataset.studentName || "").trim();
                if (!id || !/^\d+$/.test(id) || !name) return;

                let disabled = false;
                if (currentMode === "all") {
                    const canBeInAll = allowedAllSet ? allowedAllSet.has(id) : true;
                    if (!canBeInAll || !selectedSet.has(id)) disabled = true;
                }

                items.push({ id, label: name, disabled });
            });

            tableModal.open({
                title: "Выбор отсутствующих учеников",
                subtitle: "",
                items,
                selectable: true,
                selectedIds: sanitized,
                searchPlaceholder: "Поиск по ФИО...",
                sortOptions,
                defaultSort: "name_asc",
                hintText: currentMode === "all" ? allHint : "",
                size: "lg",
                onApply: applySelection,
                onClose: resetState,
            });
        }

        document.addEventListener("click", (e) => {
            const btn = e.target.closest(".open-modal-btn");
            if (!btn) return;
            openModal(btn.dataset.classId, btn.dataset.mode || "unexcused");
        });
    })();

    // -----------------------------
    // Table search by class
    // -----------------------------
    (function initTableSearch() {
        const searchInput = document.getElementById("main-table-search");
        if (!searchInput) return;

        const rows = $$('tr[data-class-name]');
        searchInput.addEventListener("input", () => {
            const term = (searchInput.value || "").toLowerCase().trim();
            rows.forEach(row => {
                const className = (row.dataset.className || "").toLowerCase();
                row.style.display = (!term || className.includes(term)) ? "" : "none";
            });
        });
    })();

    // -----------------------------
    // Live validation + submit validation
    // -----------------------------
    (function initValidation() {
        const rows = $$('tr[data-class-id]');

        rows.forEach(row => {
            const classId = row.dataset.classId;

            const inputs = row.querySelectorAll(
                'input[name^="reported_present_"], ' +
                'input[name^="unexcused_absent_"], ' +
                'input[name^="orvi_"], ' +
                'input[name^="other_disease_"], ' +
                'input[name^="family_"]'
            );

            inputs.forEach(inp => {
                inp.addEventListener("input", () => {
                    validateAllForClass(classId);
                });
            });
        });

        const form = document.querySelector("form[method='post']");
        if (!form) return;

        form.addEventListener("submit", (e) => {
            let hasError = false;

            $$('tr[data-class-id]').forEach(row => {
                const classId = row.dataset.classId;

                const editableMarker = row.querySelector('input[name^="unexcused_absent_"]');
                if (!editableMarker) return;

                if (!validateAllForClass(classId)) hasError = true;

                const errorIds = [
                    MODES.unexcused.errorId(classId),
                    MODES.orvi.errorId(classId),
                    MODES.other.errorId(classId),
                    MODES.family.errorId(classId),
                    MODES.all.errorId(classId),
                ];

                errorIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el && String(el.textContent || "").trim() !== "") hasError = true;
                });
            });

            if (hasError) {
                e.preventDefault();
                alert(
                    "Исправьте строки с ошибками: числа по каждому виду отсутствий должны совпадать со списками учеников, " +
                    "не быть отрицательными и не превышать количество по списку. " +
                    "Все ученики из этих списков должны входить в «Все отсутствующие». " +
                    "Также один ученик не может быть сразу в нескольких причинах отсутствия."
                );
            }
        });
    })();

    // -----------------------------
    // Initial sync when page loads
    // -----------------------------
    (function initInitialSync() {
        $$('tr[data-class-id]').forEach(row => {
            const classId = row.dataset.classId;

            Object.keys(MODES).forEach(mode => {
                const hidden = getHiddenEl(classId, mode);
                if (!hidden) return;
                const clean = parseIdsList(hidden.value);
                hidden.value = joinIdsList(clean);
            });

            ["unexcused", "orvi", "other", "family"].forEach(mode => {
                if (getHiddenEl(classId, mode) && getCountInput(row, mode)) {
                    syncCountFromHidden(classId, mode);
                }
            });

            Object.keys(MODES).forEach(mode => {
                const hidden = getHiddenEl(classId, mode);
                const container = getSelectedEl(classId, mode);
                if (!hidden || !container) return;

                const ids = parseIdsList(hidden.value);
                renderPillsFromIds(container, classId, ids);
            });

            syncAllFromReasons(classId);
            validateAllForClass(classId);
        });
    })();

    // -----------------------------
    // Unified table modal: privileged list
    // -----------------------------
    (function initPrivilegedModal() {
        const tableModal = window.TableModal;
        if (!tableModal) return;

        const sortOptions = [
            { value: "default", label: "По порядку" },
            { value: "name_asc", label: "ФИО А-Я" },
            { value: "name_desc", label: "ФИО Я-А" },
        ];

        function openPrivModal(cid, cname) {
            const className = cname || "";
            const container = document.getElementById("privileged-present-container-" + cid);

            const names = [];
            if (container) {
                $$(".priv-option", container).forEach(el => {
                    const t = (el.textContent || "").trim();
                    if (t) names.push(t);
                });
            }

            const items = names.map((name, idx) => ({ id: String(idx), label: name }));

            tableModal.open({
                title: "Льготники в школе сейчас",
                subtitle: "",
                subtitleBuilder: ({ shown, total }) => {
                    const cls = className ? ("Класс " + className + " • ") : "";
                    return cls + "Показано: " + shown + " из " + total;
                },
                items,
                selectable: false,
                showApply: false,
                cancelLabel: "Закрыть",
                searchPlaceholder: "Поиск по ФИО...",
                emptyText: "Нет присутствующих льготников по этому классу.",
                sortOptions,
                defaultSort: "name_asc",
                size: "lg",
            });
        }

        document.addEventListener("click", (e) => {
            const btn = e.target.closest(".open-privileged-modal-btn");
            if (!btn) return;
            openPrivModal(btn.dataset.classId, btn.dataset.className);
        });
    })();

})();
