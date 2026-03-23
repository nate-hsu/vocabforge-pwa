// VocabForge PWA — LeitnerEngine + QuizEngine

// 萊特納間隔常數（SDD §4.6）：index = box number
// Box 1=1天, Box 2=2天, Box 3=4天, Box 4=7天, Box 5=14天（遺忘曲線指數遞增）
var LEITNER_INTERVALS = [0, 1, 2, 4, 7, 14];

var DB_NAME = 'vocabforge';
var DB_VERSION = 1;
var STORE_LEITNER = 'leitner_state';
var STORE_APP = 'app_state';

/** @type {IDBDatabase|null} */
var db = null;

// ---------- DB Initialization ----------

/**
 * 開啟 IndexedDB，初始化 leitner_state + app_state Object Store。
 * 對齊 SDD §4.6。
 * @returns {Promise<void>}
 */
function initLeitner() {
    return new Promise(function(resolve, reject) {
        if (db) { resolve(); return; }
        var request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function(event) {
            var database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_LEITNER)) {
                database.createObjectStore(STORE_LEITNER, { keyPath: 'word' });
            }
            if (!database.objectStoreNames.contains(STORE_APP)) {
                database.createObjectStore(STORE_APP, { keyPath: 'key' });
            }
        };
        request.onsuccess = function(event) {
            db = event.target.result;
            resolve();
        };
        request.onerror = function() {
            reject(request.error);
        };
    });
}

// ---------- DB Helpers ----------

/**
 * 取得指定 Object Store 中的一筆記錄。
 * @param {string} storeName
 * @param {string} key
 * @returns {Promise<any>}
 */
function dbGet(storeName, key) {
    return new Promise(function(resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var req = store.get(key);
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
    });
}

/**
 * 寫入或更新一筆記錄。
 * @param {string} storeName
 * @param {any} value
 * @returns {Promise<void>}
 */
function dbPut(storeName, value) {
    return new Promise(function(resolve, reject) {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        var req = store.put(value);
        req.onsuccess = function() { resolve(); };
        req.onerror = function() { reject(req.error); };
    });
}

/**
 * 取得指定 Object Store 中的所有記錄。
 * @param {string} storeName
 * @returns {Promise<any[]>}
 */
function dbGetAll(storeName) {
    return new Promise(function(resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var req = store.getAll();
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
    });
}

// ---------- Card State Management ----------

/**
 * 新字首次瀏覽後進入 box 1（box: 0 → 1）。
 * 若該字已存在且 box > 0，不覆蓋。
 * 對齊 SDD §4.6, BR-PWA-004。
 * @param {string} word
 * @returns {Promise<void>}
 */
async function startNewCard(word) {
    await initLeitner();
    var existing = await dbGet(STORE_LEITNER, word);
    if (existing && existing.box > 0) return; // 已進入複習，不覆蓋
    await dbPut(STORE_LEITNER, {
        word: word,
        box: 1,
        last_reviewed: null,
        mistake_count: 0,
        graduated: false
    });
}

// ---------- Due Words Scheduling ----------

/**
 * 取得今日日期字串 YYYY-MM-DD。
 * @returns {string}
 */
function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * 計算兩個日期字串之間的天數差。
 * 正規化為 YYYY-MM-DD 以避免時間戳精度問題（相容舊的 ISO 時間戳格式）。
 * @param {string} dateStr - YYYY-MM-DD 或 ISO 8601 日期字串
 * @returns {number}
 */
function daysSince(dateStr) {
    // 正規化：取前 10 字元（YYYY-MM-DD），相容舊的完整 ISO 時間戳
    var thenStr = dateStr.slice(0, 10);
    var then = new Date(thenStr + 'T00:00:00');
    var now = new Date(todayStr() + 'T00:00:00');
    return Math.round((now - then) / (1000 * 60 * 60 * 24));
}

/**
 * 依 LEITNER_INTERVALS 計算今日到期字卡清單。
 * 對齊 SDD §4.6, BR-PWA-007, BR-PWA-010, BR-PWA-012。
 * - box 1-5: daysSince(last_reviewed) >= LEITNER_INTERVALS[box]
 * - last_reviewed=null（新字首次進入）→ 視為到期
 * - graduated=true 的字不出現
 * @returns {Promise<string[]>}
 */
async function getDueWords() {
    await initLeitner();
    var all = await dbGetAll(STORE_LEITNER);
    var due = [];
    for (var i = 0; i < all.length; i++) {
        var state = all[i];
        // graduated 不出現（BR-PWA-010）
        if (state.graduated) continue;
        // box 0 = 新字尚未進入複習
        if (state.box === 0) continue;
        // last_reviewed 為 null → 從未複習，立即到期
        if (!state.last_reviewed) {
            due.push(state.word);
            continue;
        }
        // box 1-5: 統一以間隔天數判斷是否到期
        var elapsed = daysSince(state.last_reviewed);
        if (elapsed >= LEITNER_INTERVALS[state.box]) {
            due.push(state.word);
        }
    }
    return due;
}

// ---------- Promote & Demote ----------

/**
 * 答對升箱；box 5 答對 → graduated=true。
 * 對齊 SDD §4.6, BR-PWA-008。
 * @param {string} word
 * @returns {Promise<void>}
 */
async function promote(word) {
    await initLeitner();
    var state = await dbGet(STORE_LEITNER, word);
    if (!state) return;
    if (state.box >= 5) {
        state.graduated = true;
    } else {
        state.box = state.box + 1;
    }
    state.last_reviewed = todayStr();
    await dbPut(STORE_LEITNER, state);
}

/**
 * 答錯退回 box 1；mistake_count += 1。
 * 對齊 SDD §4.6, BR-PWA-009。
 * @param {string} word
 * @returns {Promise<void>}
 */
async function demote(word) {
    await initLeitner();
    var state = await dbGet(STORE_LEITNER, word);
    if (!state) return;
    state.box = 1;
    state.mistake_count = (state.mistake_count || 0) + 1;
    state.last_reviewed = todayStr();
    await dbPut(STORE_LEITNER, state);
}

// ---------- Quiz Engine ----------

/**
 * 預設詞庫——已學字不足 4 個時的干擾項補充來源。
 * 對齊 D3 TG FE Step 7 規格。
 */
var FALLBACK_MEANINGS = [
    '蘋果', '書本', '貓', '門', '雞蛋',
    '花', '玻璃', '房子', '冰', '果汁',
    '鑰匙', '燈', '月亮', '夜晚', '海洋',
    '紙', '皇后', '雨', '太陽', '樹'
];

/**
 * 產生四選一題目（1 正確 + 3 隨機干擾項）。
 * 對齊 SDD §4.9, BR-PWA-013/014。
 * - 已學字 ≥ 4 時從其他字的 meaning 抽取干擾項
 * - 已學字 < 4 時從 FALLBACK_MEANINGS 補充
 * - 干擾項不得重複且不得與正確答案相同
 * @param {string} word
 * @param {Card[]} allWords
 * @returns {Quiz}
 */
function generateQuiz(word, allWords) {
    // 找出正確答案的 meaning
    var correctMeaning = '';
    for (var i = 0; i < allWords.length; i++) {
        if (allWords[i].word === word) {
            correctMeaning = allWords[i].meaning;
            break;
        }
    }

    // 收集其他字的 meaning 作為候選干擾項
    var otherMeanings = [];
    for (var j = 0; j < allWords.length; j++) {
        if (allWords[j].word !== word && allWords[j].meaning !== correctMeaning) {
            otherMeanings.push(allWords[j].meaning);
        }
    }

    // 不足時從 FALLBACK_MEANINGS 補充（排除正確答案）
    if (otherMeanings.length < 3) {
        for (var k = 0; k < FALLBACK_MEANINGS.length; k++) {
            if (FALLBACK_MEANINGS[k] !== correctMeaning && otherMeanings.indexOf(FALLBACK_MEANINGS[k]) === -1) {
                otherMeanings.push(FALLBACK_MEANINGS[k]);
            }
        }
    }

    // 隨機抽取 3 個不重複干擾項
    var distractors = [];
    var used = {};
    while (distractors.length < 3 && otherMeanings.length > 0) {
        var idx = Math.floor(Math.random() * otherMeanings.length);
        var candidate = otherMeanings[idx];
        if (!used[candidate]) {
            used[candidate] = true;
            distractors.push(candidate);
        }
        otherMeanings.splice(idx, 1);
    }

    // 組合選項並隨機排列
    var options = [
        { text: correctMeaning, correct: true }
    ];
    for (var m = 0; m < distractors.length; m++) {
        options.push({ text: distractors[m], correct: false });
    }
    // Fisher-Yates shuffle
    for (var n = options.length - 1; n > 0; n--) {
        var r = Math.floor(Math.random() * (n + 1));
        var tmp = options[n];
        options[n] = options[r];
        options[r] = tmp;
    }

    // 取得例句（若有）
    var sentence = '';
    // 注意：allWords 是 Card[]（索引資料），不含例句。
    // 測驗畫面會另行從 loadCard 取得例句。此處提供空字串佔位。

    return {
        targetWord: word,
        sentence: sentence,
        options: options
    };
}
