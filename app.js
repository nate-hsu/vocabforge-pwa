// VocabForge PWA — CardLoader + FlashcardViewer + SpeechSynthesizer

/** @typedef {{ word: string, meaning: string, frequency: string, image_status: string, created: string }} Card */
/** @typedef {{ word: string, roots: string, root_story: string, meaning: string, example_sentences: string[], formal_usage: string, frequency: string, image_prompt: string, image_status: string, source?: string, created: string }} CardDetail */
/** @typedef {{ targetWord: string, sentence: string, options: {text: string, correct: boolean}[] }} Quiz */

// ---------- Card Index Loader ----------

/**
 * fetch vocab-index.md，解析 Markdown 表格為 Card 陣列。
 * 對齊 SDD §4.5：按 | 分割行，跳過表頭與分隔線。
 * @returns {Promise<Card[]>}
 */
async function loadIndex() {
    var res = await fetch('vocab-index.md');
    if (!res.ok) return [];
    var text = await res.text();
    var lines = text.split('\n');
    var cards = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line.startsWith('|')) continue;
        var cols = line.split('|').map(function(c) { return c.trim(); }).filter(function(c) { return c !== ''; });
        if (cols.length < 5) continue;
        // 跳過表頭（含 "word"）與分隔線（含 "---"）
        if (cols[0] === 'word' || cols[0].indexOf('---') !== -1) continue;
        cards.push({
            word: cols[0],
            meaning: cols[1],
            frequency: cols[2],
            image_status: cols[3],
            created: cols[4]
        });
    }
    return cards;
}

// ---------- Filename Sanitization (mirrors writer.py _sanitize_filename) ----------

/**
 * 消毒檔名：小寫、空格轉連字號、僅保留 [a-z0-9-]。
 * 對齊 writer.py _sanitize_filename (D9 SecAD §9.1 CR-06)。
 * @param {string} word
 * @returns {string}
 */
function sanitizeFilename(word) {
    return word.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
}

// ---------- Card Detail Loader ----------

/**
 * 解析 YAML frontmatter 的 key: value（支援帶引號與不帶引號的值）。
 * @param {string} frontmatter
 * @returns {Object}
 */
function parseFrontmatter(frontmatter) {
    var result = {};
    var lines = frontmatter.split('\n');
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var idx = line.indexOf(':');
        if (idx === -1) continue;
        var key = line.substring(0, idx).trim();
        var val = line.substring(idx + 1).trim();
        // 去除引號包裹
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.substring(1, val.length - 1);
        }
        result[key] = val;
    }
    return result;
}

/**
 * 按需 fetch vocab-cards/{word}.md，解析 YAML frontmatter + body。
 * 對齊 SDD §4.4 + §4.9。
 * @param {string} word
 * @returns {Promise<CardDetail>}
 */
async function loadCard(word) {
    var res = await fetch('vocab-cards/' + encodeURIComponent(sanitizeFilename(word)) + '.md');
    if (!res.ok) throw new Error('Card not found: ' + word);
    var text = await res.text();

    // 分離 frontmatter 與 body
    var parts = text.split('---');
    var fm = parseFrontmatter(parts[1] || '');
    var body = parts.slice(2).join('---').trim();

    // 解析 body sections
    var exampleSentences = [];
    var formalUsage = '';
    var sections = body.split(/^## /m);
    for (var i = 0; i < sections.length; i++) {
        var section = sections[i].trim();
        if (section.startsWith('情境例句')) {
            var sLines = section.split('\n').slice(1);
            for (var j = 0; j < sLines.length; j++) {
                var s = sLines[j].trim();
                if (s === '') continue;
                // 移除 "1. " 等編號前綴
                s = s.replace(/^\d+\.\s*/, '');
                if (s) exampleSentences.push(s);
            }
        } else if (section.startsWith('文件語境')) {
            var fLines = section.split('\n').slice(1);
            var usages = [];
            for (var k = 0; k < fLines.length; k++) {
                var f = fLines[k].trim();
                if (f) usages.push(f);
            }
            formalUsage = usages.join('\n');
        }
    }

    return {
        word: fm.word || word,
        roots: fm.roots || '',
        root_story: fm.root_story || '',
        meaning: fm.meaning || '',
        example_sentences: exampleSentences,
        formal_usage: formalUsage,
        frequency: fm.frequency || '',
        image_prompt: fm.image_prompt || '',
        image_status: fm.image_status || 'failed',
        source: fm.source || undefined,
        created: fm.created || ''
    };
}

// ---------- Flashcard Viewer ----------

/** @type {Card[]} */
var allCards = [];
/** @type {CardDetail|null} */
var currentCard = null;
var isFlipped = false;

/**
 * 渲染閃卡正面（圖片 + 單字 + 🔊）。
 * 對齊 SDD §4.9；DOM API 渲染（禁 innerHTML，SDD §6.2 FE-02）。
 * BR-PWA-001: image_status=failed 時僅顯示文字。
 * @param {CardDetail} card
 */
function renderFront(card) {
    var front = document.getElementById('card-front');
    front.textContent = '';
    isFlipped = false;

    // 圖片（僅 image_status=success）
    if (card.image_status === 'success') {
        var img = document.createElement('img');
        img.src = 'vocab-cards/' + encodeURIComponent(sanitizeFilename(card.word)) + '.png';
        img.alt = card.word;
        img.className = 'card-image';
        img.onerror = function() { img.style.display = 'none'; };
        front.appendChild(img);
    }

    // 單字
    var wordEl = document.createElement('h2');
    wordEl.className = 'card-word';
    wordEl.textContent = card.word;
    front.appendChild(wordEl);

    // 按鈕列（🔊 + 翻牌 + 返回列表）
    var actions = document.createElement('div');
    actions.className = 'card-actions';

    var speakBtn = document.createElement('button');
    speakBtn.className = 'btn btn-speak';
    speakBtn.textContent = '🔊';
    speakBtn.setAttribute('aria-label', '播放發音 ' + card.word);
    speakBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        speak(card.word);
    });
    actions.appendChild(speakBtn);

    var flipBtn = document.createElement('button');
    flipBtn.className = 'btn btn-primary';
    flipBtn.textContent = '翻牌';
    flipBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        flipCard();
    });
    actions.appendChild(flipBtn);

    var backBtn = document.createElement('button');
    backBtn.className = 'btn';
    backBtn.textContent = '返回列表';
    backBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        backToList();
    });
    actions.appendChild(backBtn);

    front.appendChild(actions);
}

/**
 * 渲染閃卡背面（語義 + 字根拆解 + 組合故事 + 情境例句 + 文件語境）。
 * 對齊 SDD §4.9；DOM API 渲染（禁 innerHTML，SDD §6.2 FE-02）。
 * @param {CardDetail} card
 */
function renderBack(card) {
    var back = document.getElementById('card-back');
    back.textContent = '';

    // 中文語義
    var meaningEl = document.createElement('h3');
    meaningEl.className = 'card-meaning';
    meaningEl.textContent = card.meaning;
    back.appendChild(meaningEl);

    // 字根拆解
    if (card.roots) {
        var rootsLabel = document.createElement('p');
        rootsLabel.className = 'card-section-label';
        rootsLabel.textContent = '字根拆解';
        back.appendChild(rootsLabel);
        var rootsEl = document.createElement('p');
        rootsEl.className = 'card-roots';
        rootsEl.textContent = card.roots;
        back.appendChild(rootsEl);
    }

    // 組合故事
    if (card.root_story) {
        var storyLabel = document.createElement('p');
        storyLabel.className = 'card-section-label';
        storyLabel.textContent = '組合故事';
        back.appendChild(storyLabel);
        var storyEl = document.createElement('p');
        storyEl.className = 'card-story';
        storyEl.textContent = card.root_story;
        back.appendChild(storyEl);
    }

    // 情境例句
    if (card.example_sentences.length > 0) {
        var exLabel = document.createElement('p');
        exLabel.className = 'card-section-label';
        exLabel.textContent = '情境例句';
        back.appendChild(exLabel);
        var ol = document.createElement('ol');
        ol.className = 'card-examples';
        for (var i = 0; i < card.example_sentences.length; i++) {
            var li = document.createElement('li');
            li.textContent = card.example_sentences[i];
            ol.appendChild(li);
        }
        back.appendChild(ol);
    }

    // 文件語境
    if (card.formal_usage) {
        var formalLabel = document.createElement('p');
        formalLabel.className = 'card-section-label';
        formalLabel.textContent = '文件語境';
        back.appendChild(formalLabel);
        var formalEl = document.createElement('p');
        formalEl.className = 'card-formal';
        formalEl.textContent = card.formal_usage;
        back.appendChild(formalEl);
    }

    // 底部按鈕列（翻回 + 返回列表）
    var actions = document.createElement('div');
    actions.className = 'card-actions';

    var flipBtn = document.createElement('button');
    flipBtn.className = 'btn btn-primary';
    flipBtn.textContent = '翻回';
    flipBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        flipCard();
    });
    actions.appendChild(flipBtn);

    var backBtn = document.createElement('button');
    backBtn.className = 'btn';
    backBtn.textContent = '返回列表';
    backBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        backToList();
    });
    actions.appendChild(backBtn);

    back.appendChild(actions);
}

// ---------- Speech Synthesizer ----------

/**
 * Web Speech API 播放英文發音；不支援時靜默失敗。
 * 對齊 SDD §4.9, BR-PWA-003。
 * @param {string} word
 */
function speak(word) {
    if (!('speechSynthesis' in window)) return;
    var utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
}

// ---------- Card List & Navigation ----------

var currentFilter = 'all';

/**
 * 取得單字的學習狀態分類。
 * @param {string} word
 * @param {Object} stateMap - word → leitner_state 的映射
 * @returns {{ category: string, label: string, cssClass: string }}
 */
function getCardStatus(word, stateMap) {
    var state = stateMap[word];
    if (!state || state.box === 0) {
        return { category: 'new', label: '新', cssClass: 'badge-new' };
    }
    if (state.graduated) {
        return { category: 'mastered', label: '已掌握 ✓', cssClass: 'badge-mastered' };
    }
    if (state.box <= 2) {
        return { category: 'learning', label: '學習中', cssClass: 'badge-learning' };
    }
    return { category: 'reviewing', label: '複習中', cssClass: 'badge-reviewing' };
}

/**
 * 渲染篩選按鈕列。
 * @param {Object} counts - { all, new, learning, reviewing, mastered }
 */
function renderFilterBar(counts) {
    var existing = document.getElementById('filter-bar');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.id = 'filter-bar';
    bar.className = 'filter-bar';

    var filters = [
        { key: 'all', label: '全部', count: counts.all },
        { key: 'new', label: '新字', count: counts['new'] },
        { key: 'learning', label: '學習中', count: counts.learning },
        { key: 'reviewing', label: '複習中', count: counts.reviewing },
        { key: 'mastered', label: '已掌握', count: counts.mastered }
    ];

    for (var i = 0; i < filters.length; i++) {
        (function(f) {
            var btn = document.createElement('button');
            btn.className = 'filter-btn' + (currentFilter === f.key ? ' active' : '');
            btn.textContent = f.label + ' (' + f.count + ')';
            btn.addEventListener('click', function() {
                currentFilter = f.key;
                renderCardListWithStatus();
            });
            bar.appendChild(btn);
        })(filters[i]);
    }

    var container = document.getElementById('card-list');
    container.parentNode.insertBefore(bar, container);
}

/**
 * 渲染圖卡清單（含狀態 badge 與篩選）。
 */
async function renderCardListWithStatus() {
    await initLeitner();
    var allStates = await dbGetAll(STORE_LEITNER);
    var stateMap = {};
    for (var i = 0; i < allStates.length; i++) {
        stateMap[allStates[i].word] = allStates[i];
    }

    var counts = { all: allCards.length, 'new': 0, learning: 0, reviewing: 0, mastered: 0 };
    var categorized = [];
    for (var j = 0; j < allCards.length; j++) {
        var status = getCardStatus(allCards[j].word, stateMap);
        counts[status.category]++;
        categorized.push({ card: allCards[j], status: status });
    }

    renderFilterBar(counts);
    renderCardList(categorized, currentFilter);
}

/**
 * 渲染圖卡清單供使用者選擇。
 * @param {{ card: Card, status: { category: string, label: string, cssClass: string } }[]} items
 * @param {string} filter
 */
function renderCardList(items, filter) {
    var container = document.getElementById('card-list');
    container.textContent = '';

    if (items.length === 0) {
        var empty = document.createElement('p');
        empty.className = 'empty-msg';
        empty.textContent = '尚無圖卡。請先透過 CLI 生產圖卡。';
        container.appendChild(empty);
        return;
    }

    var shown = 0;
    for (var i = 0; i < items.length; i++) {
        (function(entry) {
            if (filter && filter !== 'all' && entry.status.category !== filter) return;
            shown++;
            var item = document.createElement('button');
            item.className = 'card-list-item';
            var wordSpan = document.createElement('span');
            wordSpan.className = 'card-list-word';
            wordSpan.textContent = entry.card.word;
            item.appendChild(wordSpan);
            var rightGroup = document.createElement('span');
            rightGroup.className = 'card-list-right';
            var meaningSpan = document.createElement('span');
            meaningSpan.className = 'card-list-meaning';
            meaningSpan.textContent = entry.card.meaning;
            rightGroup.appendChild(meaningSpan);
            var badge = document.createElement('span');
            badge.className = 'card-badge ' + entry.status.cssClass;
            badge.textContent = entry.status.label;
            rightGroup.appendChild(badge);
            item.appendChild(rightGroup);
            item.setAttribute('data-word', entry.card.word);
            item.addEventListener('click', function() { openCard(entry.card.word); });
            container.appendChild(item);
        })(items[i]);
    }

    if (shown === 0) {
        var noMatch = document.createElement('p');
        noMatch.className = 'empty-msg';
        noMatch.textContent = '此分類目前沒有字卡。';
        container.appendChild(noMatch);
    }
}

/**
 * 開啟單張圖卡閃卡模式。
 * @param {string} word
 */
async function openCard(word) {
    try {
        currentCard = await loadCard(word);
    } catch (e) {
        return;
    }

    renderFront(currentCard);
    renderBack(currentCard);

    // 顯示覆蓋層
    var overlay = document.getElementById('card-overlay');
    overlay.hidden = false;
    overlay.scrollTop = 0;

    // 新字進入 box 1（若 leitner.js 已載入）
    if (typeof startNewCard === 'function') {
        startNewCard(word);
    }
}

/** 翻牌切換（正面 ↔ 背面 show/hide） */
function flipCard() {
    isFlipped = !isFlipped;
    var front = document.getElementById('card-front');
    var back = document.getElementById('card-back');
    if (front && back) {
        front.hidden = isFlipped;
        back.hidden = !isFlipped;
    }
    // 翻牌後捲回頂部
    var overlay = document.getElementById('card-overlay');
    if (overlay) overlay.scrollTop = 0;
}

/** 關閉卡片覆蓋層，返回列表 */
function backToList() {
    var overlay = document.getElementById('card-overlay');
    if (overlay) overlay.hidden = true;
    currentCard = null;
    isFlipped = false;
    // 重新渲染列表以更新狀態 badge
    renderCardListWithStatus();
    // 重設正反面
    var front = document.getElementById('card-front');
    var back = document.getElementById('card-back');
    if (front) { front.hidden = false; front.textContent = ''; }
    if (back) { back.hidden = true; back.textContent = ''; }
}

// ---------- Quiz View ----------

var quizQueue = [];
var quizIndex = 0;
var quizAnswered = false;

/**
 * 初始化複習測驗視圖。
 * 對齊 SS-PWA-008 業務流程。
 */
async function initQuizView() {
    await initLeitner();
    var dueWords = await getDueWords();
    var statusEl = document.getElementById('quiz-status');
    var cardEl = document.getElementById('quiz-card');

    if (dueWords.length === 0) {
        // BR-PWA-012: 無到期字卡
        statusEl.textContent = '🎉 今日已完成！沒有待複習的字卡。';
        cardEl.hidden = true;
        return;
    }

    quizQueue = dueWords;
    quizIndex = 0;
    statusEl.textContent = '待複習：' + dueWords.length + ' 個字';
    cardEl.hidden = false;
    showQuizQuestion();
}

/**
 * 顯示目前測驗題目。
 * BR-PWA-013/017: 四選一出題，例句中目標字高亮。
 */
async function showQuizQuestion() {
    if (quizIndex >= quizQueue.length) {
        document.getElementById('quiz-status').textContent = '🎉 本輪複習完成！';
        document.getElementById('quiz-card').hidden = true;
        return;
    }

    quizAnswered = false;
    var word = quizQueue[quizIndex];
    var quiz = generateQuiz(word, allCards);

    // 載入卡片詳情以取得例句
    var detail = null;
    try { detail = await loadCard(word); } catch (e) { /* ignore */ }

    var sentenceEl = document.getElementById('quiz-sentence');
    sentenceEl.textContent = '';

    if (detail && detail.example_sentences.length > 0) {
        // BR-PWA-017: 例句中目標字以粗體標記
        var sentence = detail.example_sentences[0];
        // 建立詞幹：移除所有格 's，去掉尾部 e/y 以覆蓋規則變化形
        var clean = word.toLowerCase().replace(/'s\b/g, '');
        var stem = clean.replace(/[ey]$/, '');
        if (stem.length < 3) stem = clean;
        var escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var splitRe = new RegExp('(\\b' + escaped + "[a-z']*)", 'gi');
        var matchRe = new RegExp('^' + escaped, 'i');
        var parts = sentence.split(splitRe);
        for (var i = 0; i < parts.length; i++) {
            if (!parts[i]) continue;
            if (matchRe.test(parts[i])) {
                var bold = document.createElement('strong');
                bold.className = 'quiz-highlight';
                bold.textContent = parts[i];
                sentenceEl.appendChild(bold);
            } else {
                sentenceEl.appendChild(document.createTextNode(parts[i]));
            }
        }
    } else {
        sentenceEl.textContent = word;
    }

    // 渲染選項
    var optionsEl = document.getElementById('quiz-options');
    optionsEl.textContent = '';
    for (var j = 0; j < quiz.options.length; j++) {
        (function(option) {
            var btn = document.createElement('button');
            btn.className = 'btn quiz-option';
            btn.textContent = option.text;
            btn.addEventListener('click', function() {
                if (quizAnswered) return;
                quizAnswered = true;
                handleQuizAnswer(word, option.correct, btn, optionsEl, detail);
            });
            optionsEl.appendChild(btn);
        })(quiz.options[j]);
    }

    document.getElementById('quiz-result').hidden = true;
    document.getElementById('btn-quiz-next').hidden = true;

    // 更新進度
    document.getElementById('quiz-status').textContent =
        '第 ' + (quizIndex + 1) + ' / ' + quizQueue.length + ' 題';
}

/**
 * 處理測驗作答。
 * BR-PWA-015: 答對顯示「正確 ✅」+ promote
 * BR-PWA-016: 答錯顯示「錯誤 ❌」+ 正確答案 + demote
 */
async function handleQuizAnswer(word, isCorrect, clickedBtn, optionsEl, detail) {
    var resultEl = document.getElementById('quiz-result');
    resultEl.textContent = '';
    resultEl.hidden = false;

    // 標記按鈕
    var buttons = optionsEl.querySelectorAll('.quiz-option');
    for (var i = 0; i < buttons.length; i++) {
        buttons[i].disabled = true;
        if (buttons[i].textContent === (detail ? detail.meaning : '')) {
            buttons[i].classList.add('correct');
        }
    }

    if (isCorrect) {
        clickedBtn.classList.add('correct');
        var successMsg = document.createElement('p');
        successMsg.className = 'quiz-correct';
        successMsg.textContent = '正確 ✅';
        resultEl.appendChild(successMsg);
        await promote(word);
    } else {
        clickedBtn.classList.add('wrong');
        var failMsg = document.createElement('p');
        failMsg.className = 'quiz-wrong';
        failMsg.textContent = '錯誤 ❌';
        resultEl.appendChild(failMsg);
        if (detail) {
            var correctInfo = document.createElement('p');
            correctInfo.textContent = '正確答案：' + detail.meaning;
            resultEl.appendChild(correctInfo);
        }
        await demote(word);
    }

    // 顯示完整圖卡資訊
    if (detail) {
        var infoEl = document.createElement('div');
        infoEl.className = 'quiz-card-info';
        var wordInfo = document.createElement('p');
        wordInfo.textContent = detail.word + ' — ' + detail.meaning;
        wordInfo.className = 'quiz-info-word';
        infoEl.appendChild(wordInfo);
        if (detail.roots) {
            var rootsInfo = document.createElement('p');
            rootsInfo.textContent = '字根：' + detail.roots;
            infoEl.appendChild(rootsInfo);
        }
        resultEl.appendChild(infoEl);
    }

    document.getElementById('btn-quiz-next').hidden = false;
}

// ---------- Initialization ----------

/**
 * 頁面載入時初始化閃卡視圖。
 */
async function initFlashcardView() {
    allCards = await loadIndex();
    await renderCardListWithStatus();

    // Quiz next button
    document.getElementById('btn-quiz-next').addEventListener('click', function() {
        quizIndex++;
        showQuizQuestion();
    });
}

// 啟動
initFlashcardView();
