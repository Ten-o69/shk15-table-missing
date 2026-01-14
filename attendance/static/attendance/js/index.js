(() => {
    // -----------------------------
    // Helpers
    // -----------------------------
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const REASON_MODES = ["unexcused", "orvi", "other", "family"];

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

    // удаляем ID из всех причин (используется когда удалили из ALL)
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

    // ✅ запрет дублей: при применении причины переносим выбранных учеников из других причин в текущую
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
    // Validation: no duplicates across reasons
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
            // не сбрасываем, если другой валидатор уже пометил; но тут безопасно:
            input.style.borderColor = "";
            input.style.backgroundColor = "";
            input.removeAttribute("data-invalid");
        }
    }

    function validateNoReasonDuplicates(classId) {
        // Собираем: id -> [modes...]
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

        // Где id встречается более 1 раза
        const duplicates = Array.from(map.entries()).filter(([_, modes]) => modes.length > 1);

        // Сначала почистим сообщения о "дублях" (но не трогаем другие ошибки, поэтому: добавляем/удаляем аккуратно)
        // Здесь проще: если дублей нет — ничего не делаем с существующими текстами validateReason().
        // Если дубли есть — добавим сообщение в каждый затронутый mode (дополнительно к count-ошибкам).
        if (!duplicates.length) return true;

        const row = getRowByClassId(classId);
        const nameMap = buildStudentMapForClass(classId);

        // сгруппируем: mode -> ids[]
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

            // Показать 1-3 фамилии/ID
            const preview = ids.slice(0, 3).map(id => nameMap.get(String(id)) || `ID ${id}`);
            const msg =
                `ОШИБКА: ученик не может быть сразу в нескольких причинах. ` +
                `Повторы: ${preview.join(", ")}${ids.length > 3 ? "…" : ""}`;

            // если там уже есть другая ошибка, добавим новую строку
            if (err) {
                const existing = (err.textContent || "").trim();
                if (existing) {
                    // чтобы не дублировать одно и то же сообщение
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

    // -----------------------------
    // Validation: number vs ids per mode
    // -----------------------------
    function validateReason(classId, mode) {
        const row = getRowByClassId(classId);
        if (!row) return;

        const cfg = MODES[mode];
        const input = getCountInput(row, mode);
        const err = document.getElementById(cfg.errorId(classId));
        const hidden = getHiddenEl(classId, mode);

        if (!err || !hidden) return;

        // если в этой строке сейчас не режим редактирования — input может отсутствовать
        if (!input) {
            // не трогаем (может быть readonly режим)
            return;
        }

        const ids = parseIdsList(hidden.value);
        const selectedCount = ids.length;

        const countValue = parseIntSafe(input.value);
        let hasError = false;

        if (countValue < 0) {
            hasError = true;
        } else if (countValue === 0 && selectedCount === 0) {
            hasError = false;
        } else if (countValue !== selectedCount) {
            hasError = true;
        }

        // ВАЖНО: не стираем тут сообщения о "дубликатах" (они добавляются позже).
        // Поэтому если ошибок по числу нет — просто очищаем ТОЛЬКО "числовую" часть.
        // Сделаем проще: если есть число-ошибка — перезапишем err полностью (она важнее),
        // а дубликаты всё равно добавятся validateNoReasonDuplicates().
        if (hasError) {
            setErrorText(
                err,
                `Число ${cfg.label} (${Number.isNaN(countValue) ? "—" : countValue}) ` +
                `должно совпадать с количеством выбранных учеников (${selectedCount}).`
            );
            input.style.borderColor = "#ff6b6b";
            input.style.backgroundColor = "rgba(255, 107, 107, 0.08)";
        } else {
            // если в err была только числовая ошибка — очистим, но если там есть "дубликаты", оставим
            const existing = (err.textContent || "").trim();
            if (existing && existing.includes("не может быть сразу в нескольких причинах")) {
                // оставляем, только не красим число отдельно (но оно может быть окрашено из-за дублей)
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
            // не сбрасываем, если она уже помечена как invalid другой логикой
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
        // 1) число vs список
        validateReason(classId, "unexcused");
        validateReason(classId, "orvi");
        validateReason(classId, "other");
        validateReason(classId, "family");

        // 2) all должен содержать union
        validateAllAbsent(classId);

        // 3) запрет дублей между столбцами причин
        const noDup = validateNoReasonDuplicates(classId);

        // 4) суммарные числа
        const okCounts = validateCountsForClass(classId);

        return noDup && okCounts;
    }

    // -----------------------------
    // Modal (one modal for all modes)
    // -----------------------------
    (function initStudentsModal() {
        const modal = document.getElementById("students-modal");
        if (!modal) return;

        const searchInput = document.getElementById("student-search");
        const studentsList = document.getElementById("students-list");
        const allHint = document.getElementById("all-absent-hint"); // может отсутствовать
        const cancelBtn = document.getElementById("modal-cancel");
        const applyBtn = document.getElementById("modal-apply");

        let currentClassId = null;
        let currentMode = null;

        // для режима "all": что было ДО открытия (разрешаем только удаление)
        let allBeforeOpen = [];

        function openModal(classId, mode) {
            currentClassId = String(classId);
            currentMode = mode;

            if (allHint) {
                if (mode === "all") allHint.classList.remove("hidden");
                else allHint.classList.add("hidden");
            }

            const hidden = getHiddenEl(currentClassId, currentMode);
            if (!hidden) return;

            const container = document.getElementById(`students-container-${currentClassId}`);
            if (!container) return;

            // sanitize hidden на открытии
            const sanitized = parseIdsList(hidden.value);
            hidden.value = joinIdsList(sanitized);

            let selectedIds = new Set(sanitized);

            if (currentMode === "all") {
                allBeforeOpen = Array.from(selectedIds);
            } else {
                allBeforeOpen = [];
            }

            studentsList.innerHTML = "";
            searchInput.value = "";

            // ✅ для режима ALL: разрешаем только удаление, плюс ограничиваем множеством union причин
            const allowedAllSet = currentMode === "all"
                ? new Set(getReasonUnionIds(currentClassId).map(String))
                : null;

            $$(".student-option", container).forEach(item => {
                const id = String(item.dataset.studentId || "").trim();
                const name = String(item.dataset.studentName || "").trim();
                if (!id || !/^\d+$/.test(id) || !name) return;

                const row = document.createElement("label");
                row.className = "student-row";
                row.dataset.name = name.toLowerCase();

                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.value = id;
                checkbox.checked = selectedIds.has(id);

                if (currentMode === "all") {
                    // нельзя добавлять новых + нельзя добавлять тех, кого нет в union причин
                    const canBeInAll = allowedAllSet ? allowedAllSet.has(id) : true;
                    if (!checkbox.checked) {
                        checkbox.disabled = true;
                        checkbox.title = "Добавлять через «Все отсутствующие» нельзя. Используйте столбцы причин.";
                    }
                    if (!canBeInAll) {
                        checkbox.checked = false;
                        checkbox.disabled = true;
                        checkbox.title = "Этот ученик не отмечен ни в одной причине отсутствия.";
                    }
                }

                const span = document.createElement("span");
                span.textContent = name;

                row.appendChild(checkbox);
                row.appendChild(span);
                studentsList.appendChild(row);
            });

            modal.classList.remove("hidden");
            searchInput.focus();
        }

        function closeModal() {
            modal.classList.add("hidden");
            currentClassId = null;
            currentMode = null;
            allBeforeOpen = [];
            if (allHint) allHint.classList.add("hidden");
        }

        function applySelection() {
            if (!currentClassId || !currentMode) return;

            const row = getRowByClassId(currentClassId);
            if (!row) return;

            const hidden = getHiddenEl(currentClassId, currentMode);
            const selectedContainer = getSelectedEl(currentClassId, currentMode);

            if (!hidden || !selectedContainer) {
                closeModal();
                return;
            }

            // checked
            const checked = $$('input[type="checkbox"]:checked', studentsList);
            const idsRaw = checked.map(cb => String(cb.value).trim());
            const ids = parseIdsList(idsRaw.join(","));

            if (currentMode === "all") {
                // ✅ только удаление:
                // newAll = (что было до открытия) ∩ (что осталось отмечено)
                const beforeSet = new Set(allBeforeOpen.map(String));
                const newAll = ids.filter(id => beforeSet.has(String(id)));

                const removed = allBeforeOpen.filter(id => !newAll.includes(String(id)));

                hidden.value = joinIdsList(newAll);
                renderPillsFromIds(selectedContainer, currentClassId, newAll);

                if (removed.length) {
                    // удалили из ALL => удалить из всех причин
                    removeIdsFromAllReasons(currentClassId, removed);
                }

                // ALL = union причин (после удаления)
                syncAllFromReasons(currentClassId);

                validateAllForClass(currentClassId);
                closeModal();
                return;
            }

            // ---- причины: unexcused/orvi/other/family ----

            // ✅ запрет повторов: если выбрали ученика в этой причине, убираем его из других причин
            removeIdsFromOtherReasons(currentClassId, currentMode, ids);

            // 1) hidden по причине
            hidden.value = joinIdsList(ids);

            // 2) pills по причине
            renderPillsFromIds(selectedContainer, currentClassId, ids);

            // 3) число = кол-ву выбранных
            syncCountFromIds(row, currentMode, ids.length);

            // ✅ ALL = UNION всех причин (и добавление, и удаление)
            syncAllFromReasons(currentClassId);

            validateAllForClass(currentClassId);
            closeModal();
        }

        // search inside modal
        searchInput.addEventListener("input", () => {
            const term = (searchInput.value || "").toLowerCase();
            $$(".student-row", studentsList).forEach(r => {
                const name = r.dataset.name || "";
                r.style.display = name.includes(term) ? "" : "none";
            });
        });

        // open modal buttons
        document.addEventListener("click", (e) => {
            const btn = e.target.closest(".open-modal-btn");
            if (!btn) return;

            const classId = btn.dataset.classId;
            const mode = btn.dataset.mode || "unexcused";
            openModal(classId, mode);
        });

        cancelBtn.addEventListener("click", closeModal);
        applyBtn.addEventListener("click", applySelection);

        modal.addEventListener("click", (e) => {
            if (e.target === modal) closeModal();
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
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

        const form = $("#main-table-body form");
        if (!form) return;

        form.addEventListener("submit", (e) => {
            let hasError = false;

            $$('tr[data-class-id]').forEach(row => {
                const classId = row.dataset.classId;

                // строка не в режиме редактирования => нет input => не валидируем
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
    // Initial sync when page loads (редактируемая строка)
    // -----------------------------
    (function initInitialSync() {
        $$('tr[data-class-id]').forEach(row => {
            const classId = row.dataset.classId;

            // sanitize hidden values (убираем None/null/undefined/мусор)
            Object.keys(MODES).forEach(mode => {
                const hidden = getHiddenEl(classId, mode);
                if (!hidden) return;
                const clean = parseIdsList(hidden.value);
                hidden.value = joinIdsList(clean);
            });

            // синхронизируем числа только если есть input (строка редактируется)
            ["unexcused", "orvi", "other", "family"].forEach(mode => {
                if (getHiddenEl(classId, mode) && getCountInput(row, mode)) {
                    syncCountFromHidden(classId, mode);
                }
            });

            // перерисуем pills из hidden
            Object.keys(MODES).forEach(mode => {
                const hidden = getHiddenEl(classId, mode);
                const container = getSelectedEl(classId, mode);
                if (!hidden || !container) return;

                const ids = parseIdsList(hidden.value);
                renderPillsFromIds(container, classId, ids);
            });

            // ALL на всякий случай пересоберём из причин (чтобы гарантировать консистентность)
            syncAllFromReasons(classId);

            // первичная валидация
            validateAllForClass(classId);
        });
    })();

    // -----------------------------
    // Privileged modal (как было)
    // -----------------------------
    (function initPrivilegedModal() {
        const modal = document.getElementById("privileged-modal");
        if (!modal) return;

        const titleEl = document.getElementById("privileged-modal-title");
        const subtitleEl = document.getElementById("privileged-modal-subtitle");
        const searchEl = document.getElementById("privileged-search");
        const listEl = document.getElementById("privileged-list");
        const closeBtn = document.getElementById("privileged-close");

        let allNames = [];
        let className = "";

        function sortRu(a, b) {
            return a.localeCompare(b, "ru", { sensitivity: "base" });
        }

        function render(names) {
            listEl.innerHTML = "";

            if (!names.length) {
                const empty = document.createElement("div");
                empty.className = "muted";
                empty.textContent = "Нет присутствующих льготников по этому классу.";
                listEl.appendChild(empty);
            } else {
                names.forEach(n => {
                    const item = document.createElement("div");
                    item.className = "readonly-item";
                    item.textContent = n;
                    listEl.appendChild(item);
                });
            }

            const shown = names.length;
            const total = allNames.length;

            if (subtitleEl) {
                const cls = className ? ("Класс " + className + " • ") : "";
                subtitleEl.textContent = cls + "Показано: " + shown + " из " + total;
            }
        }

        function openPrivModal(cid, cname) {
            className = cname || "";
            const container = document.getElementById("privileged-present-container-" + cid);

            const raw = [];
            if (container) {
                $$(".priv-option", container).forEach(el => {
                    const t = (el.textContent || "").trim();
                    if (t) raw.push(t);
                });
            }

            allNames = raw.sort(sortRu);

            if (titleEl) titleEl.textContent = "Льготники в школе сейчас";
            if (searchEl) searchEl.value = "";

            render(allNames);

            modal.classList.remove("hidden");
            if (searchEl) searchEl.focus();
        }

        function closePrivModal() {
            modal.classList.add("hidden");
            allNames = [];
            className = "";
        }

        document.addEventListener("click", (e) => {
            const btn = e.target.closest(".open-privileged-modal-btn");
            if (!btn) return;
            openPrivModal(btn.dataset.classId, btn.dataset.className);
        });

        if (searchEl) {
            searchEl.addEventListener("input", () => {
                const term = (searchEl.value || "").trim().toLowerCase();
                const filtered = !term
                    ? allNames
                    : allNames.filter(n => n.toLowerCase().includes(term));
                render(filtered);
            });
        }

        if (closeBtn) closeBtn.addEventListener("click", closePrivModal);

        modal.addEventListener("click", (e) => {
            if (e.target === modal) closePrivModal();
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !modal.classList.contains("hidden")) closePrivModal();
        });
    })();
})();