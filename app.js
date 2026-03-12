/* global BX24, Chart */

const STATUS_LABELS = { 1: "Новая", 2: "Ждет выполнения", 3: "Выполняется", 4: "Ждет контроля", 5: "Завершена", 6: "Отложена", 7: "Отклонена" };
const NON_OVERDUE_STATUSES = new Set([5, 6, 7]);

const els = {
    btnReload: document.getElementById("btnReload"),
    groupSelect: document.getElementById("groupSelect"),
    userInput: document.getElementById("userInput"),
    periodSelect: document.getElementById("periodSelect"),
    log: document.getElementById("log"),
    kpiOverdueCount: document.getElementById("kpiOverdueCount"),
    kpiOverduePct: document.getElementById("kpiOverduePct"),
    kpiLeadMedian: document.getElementById("kpiLeadMedian"),
    kpiCycleMedian: document.getElementById("kpiCycleMedian"),
    kpiClosedCount: document.getElementById("kpiClosedCount"),
    chartStatuses: document.getElementById("chartStatuses"),
    chartAssignees: document.getElementById("chartAssignees"),
};

let charts = { statuses: null, assignees: null };

function logLine(msg) {
    const ts = new Date().toLocaleTimeString();
    els.log.textContent = `${ts}: ${msg}\n` + els.log.textContent;
}

// Главная функция запуска
function start() {
    if (typeof BX24 === 'undefined') {
        logLine("Ошибка: Битрикс SDK не найден.");
        return;
    }

    BX24.init(async () => {
        logLine("Битрикс24 готов. Начинаю загрузку...");
        await loadGroups();
        await reload();
        els.btnReload.addEventListener("click", reload);
    });
}

async function loadGroups() {
    return new Promise((res) => {
        BX24.callMethod("sonet_group.get", { order: { NAME: "ASC" } }, (result) => {
            if (result.error()) { logLine("Ошибка групп: " + result.error()); res(); return; }
            result.data().forEach(g => {
                const opt = document.createElement("option");
                opt.value = g.ID;
                opt.textContent = g.NAME;
                els.groupSelect.appendChild(opt);
            });
            res();
        });
    });
}

async function loadTasks({ groupId, responsibleId, periodDays }) {
    let allTasks = [];
    const filter = {};
    if (groupId) filter.GROUP_ID = groupId;
    if (responsibleId) filter.RESPONSIBLE_ID = responsibleId;
    if (periodDays > 0) {
        const d = new Date();
        d.setDate(d.getDate() - periodDays);
        filter[">=CREATED_DATE"] = d.toISOString();
    }

    return new Promise((resolve) => {
        function getNext(start = 0) {
            BX24.callMethod("tasks.task.list", {
                filter,
                select: ["ID", "TITLE", "STATUS", "CREATED_DATE", "CLOSED_DATE", "DATE_START", "DEADLINE", "RESPONSIBLE_NAME", "RESPONSIBLE_ID"],
                start
            }, (res) => {
                if (res.error()) { logLine("Ошибка API: " + res.error()); resolve(allTasks); return; }
                const chunk = res.data().tasks || res.data() || [];
                allTasks = allTasks.concat(chunk);
                if (res.more()) getNext(res.next());
                else resolve(allTasks);
            });
        }
        getNext();
    });
}

function computeMetrics(tasks) {
    const now = new Date();
    const stats = { total: tasks.length, overdue: 0, closed: 0, byStatus: {}, byAssignee: {}, leadTimes: [], cycleTimes: [] };

    tasks.forEach(t => {
        // Статусы
        const s = STATUS_LABELS[t.status] || `Статус ${t.status}`;
        stats.byStatus[s] = (stats.byStatus[s] || 0) + 1;

        // Просрочка
        if (t.deadline && new Date(t.deadline) < now && !NON_OVERDUE_STATUSES.has(Number(t.status))) {
            stats.overdue++;
        }

        // Исполнители
        const name = t.responsibleName || `ID ${t.responsibleId}`;
        stats.byAssignee[name] = (stats.byAssignee[name] || 0) + 1;

        // SLA
        if (t.closedDate) {
            stats.closed++;
            const created = new Date(t.createdDate);
            const closed = new Date(t.closedDate);
            stats.leadTimes.push((closed - created) / 86400000);
            if (t.dateStart) {
                stats.cycleTimes.push((closed - new Date(t.dateStart)) / 86400000);
            }
        }
    });

    return stats;
}

const median = arr => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function render(m) {
    els.kpiOverdueCount.textContent = m.overdue;
    els.kpiOverduePct.textContent = m.total ? Math.round((m.overdue / m.total) * 100) + "%" : "0%";
    els.kpiClosedCount.textContent = m.closed;
    els.kpiLeadMedian.textContent = median(m.leadTimes).toFixed(1);
    els.kpiCycleMedian.textContent = median(m.cycleTimes).toFixed(1);

    if (charts.statuses) charts.statuses.destroy();
    charts.statuses = new Chart(els.chartStatuses, {
        type: "doughnut",
        data: {
            labels: Object.keys(m.byStatus),
            datasets: [{ data: Object.values(m.byStatus), backgroundColor: ["#2fc6f6", "#ffb800", "#8bc34a", "#f64e60", "#8950fc"] }]
        }
    });

    if (charts.assignees) charts.assignees.destroy();
    const top15 = Object.entries(m.byAssignee).sort((a,b) => b[1] - a[1]).slice(0, 15);
    charts.assignees = new Chart(els.chartAssignees, {
        type: "bar",
        data: {
            labels: top15.map(x => x[0]),
            datasets: [{ label: "Задач", data: top15.map(x => x[1]), backgroundColor: "#2563eb" }]
        },
        options: { indexAxis: 'y' }
    });
}

async function reload() {
    els.btnReload.disabled = true;
    try {
        const tasks = await loadTasks({
            groupId: els.groupSelect.value,
            responsibleId: els.userInput.value,
            periodDays: els.periodSelect.value
        });
        render(computeMetrics(tasks));
    } finally {
        els.btnReload.disabled = false;
    }
}

start();