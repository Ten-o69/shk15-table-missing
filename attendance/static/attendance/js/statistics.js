// сворачивание/разворачивание блоков
(function () {
    document.querySelectorAll('.collapse-toggle').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const targetId = this.dataset.targetId;
            const target = document.getElementById(targetId);
            if (!target) return;
            const collapsed = target.classList.toggle('collapsed');
            this.textContent = collapsed ? 'Развернуть' : 'Свернуть';
        });
    });
})();

function textMatches(el, needle) {
    if (!needle) return true;
    const txt = (el.textContent || '').toLowerCase();
    return txt.includes(needle.toLowerCase());
}

(function () {
    const globalInput = document.getElementById('global-search');
    const classInput = document.getElementById('filter-class');
    const studentInput = document.getElementById('filter-student');
    const minUnexcusedInput = document.getElementById('filter-min-unexcused');
    const minAbsencesInput = document.getElementById('filter-min-absences');
    const typeSelect = document.getElementById('filter-table-type');

    function applyFilters() {
        const globalTerm = globalInput.value.trim().toLowerCase();
        const classTerm = classInput.value.trim().toLowerCase();
        const studentTerm = studentInput.value.trim().toLowerCase();
        const minUnexcused = parseInt(minUnexcusedInput.value || '0', 10) || 0;
        const minAbsences = parseInt(minAbsencesInput.value || '0', 10) || 0;
        const tableType = typeSelect.value;

        // управление видимостью секций
        document.querySelectorAll('[data-section-block]').forEach(function (block) {
            const kind = block.dataset.sectionBlock;
            block.style.display =
                (tableType === 'all' || tableType === kind) ? '' : 'none';
        });

        // все строки во всех таблицах
        document.querySelectorAll('tr[data-row-type]').forEach(function (row) {
            const rowType = row.dataset.rowType;
            const className = (row.dataset.className || '').toLowerCase();
            const studentName = (row.dataset.studentName || '').toLowerCase();
            const unexcused = parseInt(row.dataset.unexcused || row.dataset.totalUnexcused || '0', 10) || 0;
            const absenceCount = parseInt(row.dataset.absenceCount || '0', 10) || 0;

            let visible = true;

            // фильтр по типу таблицы
            if (tableType !== 'all') {
                if (tableType === 'daily' && rowType !== 'daily') visible = false;
                if (tableType === 'by_class' && rowType !== 'by_class') visible = false;
                if (tableType === 'by_student' && rowType !== 'by_student') visible = false;
            }

            if (globalTerm && !textMatches(row, globalTerm)) {
                visible = false;
            }

            if (classTerm && !className.includes(classTerm)) {
                visible = false;
            }

            if (studentTerm) {
                if (rowType === 'by_student') {
                    if (!studentName.includes(studentTerm)) {
                        visible = false;
                    }
                } else if (!textMatches(row, studentTerm)) {
                    visible = false;
                }
            }

            if (minUnexcused > 0 &&
                (rowType === 'daily' || rowType === 'by_class')) {
                if (unexcused < minUnexcused) {
                    visible = false;
                }
            }

            if (minAbsences > 0 && rowType === 'by_student') {
                if (absenceCount < minAbsences) {
                    visible = false;
                }
            }

            row.style.display = visible ? '' : 'none';
        });
    }

    [globalInput, classInput, studentInput, minUnexcusedInput, minAbsencesInput, typeSelect]
        .forEach(function (el) {
            if (!el) return;
            el.addEventListener('input', applyFilters);
            el.addEventListener('change', applyFilters);
        });

    applyFilters();
})();