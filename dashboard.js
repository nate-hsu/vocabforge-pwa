// VocabForge PWA — Dashboard

/**
 * 比對 last_active_date 與今日，更新 streak_days。
 * 對齊 SDD §4.9, BR-PWA-018。
 * - 今日 = last_active_date → 不變
 * - 今日 = last_active_date + 1 天 → streak_days += 1
 * - 其他 → streak_days = 1（中斷重計）
 * @returns {Promise<void>}
 */
async function updateStreak() {
    await initLeitner();
    var today = todayStr();

    var streakRecord = await dbGet(STORE_APP, 'streak_days');
    var lastActiveRecord = await dbGet(STORE_APP, 'last_active_date');

    var streakDays = (streakRecord && streakRecord.value) || 0;
    var lastActive = (lastActiveRecord && lastActiveRecord.value) || '';

    if (lastActive === today) {
        // 今日已更新，不變
        return;
    }

    if (lastActive) {
        var diff = daysSince(lastActive);
        if (diff === 1) {
            streakDays += 1;
        } else {
            streakDays = 1;
        }
    } else {
        streakDays = 1;
    }

    await dbPut(STORE_APP, { key: 'streak_days', value: streakDays });
    await dbPut(STORE_APP, { key: 'last_active_date', value: today });
}

/**
 * 讀取 IndexedDB 統計，渲染儀表板。
 * 對齊 SDD §4.9, BR-PWA-019/020/021。
 * 顯示：今日待複習數、各箱子字數分佈、連續學習天數、易錯字清單。
 * @returns {Promise<void>}
 */
async function renderDashboard() {
    await initLeitner();
    await updateStreak();

    var container = document.getElementById('dashboard-container');
    container.textContent = '';

    var allStates = await dbGetAll(STORE_LEITNER);

    // 若無學習記錄 → 引導訊息（BR-PWA-021）
    if (allStates.length === 0) {
        var guide = document.createElement('div');
        guide.className = 'dashboard-guide';
        var guideTitle = document.createElement('h2');
        guideTitle.textContent = '歡迎使用 VocabForge！';
        guide.appendChild(guideTitle);
        var guideMsg = document.createElement('p');
        guideMsg.textContent = '尚無學習記錄。請先在「閃卡」頁瀏覽圖卡，開始你的學習之旅！';
        guide.appendChild(guideMsg);
        container.appendChild(guide);
        return;
    }

    // 計算統計資料
    var dueWords = await getDueWords();
    var dueCount = dueWords.length;

    // 箱子分佈（BR-PWA-019）
    var boxCounts = [0, 0, 0, 0, 0, 0]; // box 0-5
    var graduatedCount = 0;
    var mistakeWords = []; // mistake_count >= 3（BR-PWA-020）

    for (var i = 0; i < allStates.length; i++) {
        var s = allStates[i];
        if (s.graduated) {
            graduatedCount++;
        } else if (s.box >= 0 && s.box <= 5) {
            boxCounts[s.box]++;
        }
        if (s.mistake_count >= 3) {
            mistakeWords.push({ word: s.word, count: s.mistake_count });
        }
    }

    // 連續學習天數
    var streakRecord = await dbGet(STORE_APP, 'streak_days');
    var streakDays = (streakRecord && streakRecord.value) || 0;

    // --- 渲染 ---

    // 標題
    var title = document.createElement('h2');
    title.className = 'dashboard-title';
    title.textContent = '學習統計';
    container.appendChild(title);

    // 統計卡片容器
    var statsGrid = document.createElement('div');
    statsGrid.className = 'stats-grid';

    // 今日待複習
    statsGrid.appendChild(createStatCard('📋', '今日待複習', dueCount + ' 個字'));

    // 連續學習天數
    statsGrid.appendChild(createStatCard('🔥', '連續學習', streakDays + ' 天'));

    // 已學字數
    statsGrid.appendChild(createStatCard('📚', '已學字數', allStates.length + ' 個'));

    // 已畢業
    statsGrid.appendChild(createStatCard('🎓', '已畢業', graduatedCount + ' 個'));

    container.appendChild(statsGrid);

    // 箱子分佈（BR-PWA-019）
    var boxSection = document.createElement('div');
    boxSection.className = 'dashboard-section';
    var boxTitle = document.createElement('h3');
    boxTitle.textContent = '箱子分佈';
    boxSection.appendChild(boxTitle);

    var boxLabels = ['新字 (0)', '箱 1', '箱 2', '箱 3', '箱 4', '箱 5', '已畢業'];
    var boxValues = boxCounts.concat([graduatedCount]);
    var totalWords = allStates.length;

    for (var j = 0; j < boxLabels.length; j++) {
        var row = document.createElement('div');
        row.className = 'box-row';

        var label = document.createElement('span');
        label.className = 'box-label';
        label.textContent = boxLabels[j];
        row.appendChild(label);

        var barContainer = document.createElement('div');
        barContainer.className = 'box-bar-container';
        var bar = document.createElement('div');
        bar.className = 'box-bar';
        var pct = totalWords > 0 ? (boxValues[j] / totalWords * 100) : 0;
        bar.style.width = Math.max(pct, 0) + '%';
        if (j === 6) bar.classList.add('box-bar-graduated');
        barContainer.appendChild(bar);
        row.appendChild(barContainer);

        var count = document.createElement('span');
        count.className = 'box-count';
        count.textContent = boxValues[j];
        row.appendChild(count);

        boxSection.appendChild(row);
    }
    container.appendChild(boxSection);

    // 易錯字清單（BR-PWA-020）
    if (mistakeWords.length > 0) {
        mistakeWords.sort(function(a, b) { return b.count - a.count; });

        var mistakeSection = document.createElement('div');
        mistakeSection.className = 'dashboard-section';
        var mistakeTitle = document.createElement('h3');
        mistakeTitle.textContent = '⚠️ 易錯字（答錯 ≥ 3 次）';
        mistakeSection.appendChild(mistakeTitle);

        var list = document.createElement('ul');
        list.className = 'mistake-list';
        for (var k = 0; k < mistakeWords.length; k++) {
            var li = document.createElement('li');
            li.textContent = mistakeWords[k].word + '（答錯 ' + mistakeWords[k].count + ' 次）';
            list.appendChild(li);
        }
        mistakeSection.appendChild(list);
        container.appendChild(mistakeSection);
    }
}

/**
 * 建立統計卡片元素。
 * @param {string} icon
 * @param {string} label
 * @param {string} value
 * @returns {HTMLElement}
 */
function createStatCard(icon, label, value) {
    var card = document.createElement('div');
    card.className = 'stat-card';
    var iconEl = document.createElement('span');
    iconEl.className = 'stat-icon';
    iconEl.textContent = icon;
    card.appendChild(iconEl);
    var valEl = document.createElement('p');
    valEl.className = 'stat-value';
    valEl.textContent = value;
    card.appendChild(valEl);
    var labelEl = document.createElement('p');
    labelEl.className = 'stat-label';
    labelEl.textContent = label;
    card.appendChild(labelEl);
    return card;
}
