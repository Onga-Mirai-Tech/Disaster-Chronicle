// Disaster Chronicle - 画面の処理（DOM操作・通信）。
// 日付判定・絞り込み・並び替えなどのロジックは js/logic.js（テスト済み）にある。
(function () {
  'use strict';

  const { PREFECTURES, buildQuery, processResults, sortResults, extractWikiTitle, stripInlineStyles } = window.DisasterLogic;

  const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
  const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php';
  const WIKIDATA_TIMEOUT_MS = 45000;
  const WIKIPEDIA_TIMEOUT_MS = 20000;
  const WIKI_CONCURRENCY = 5;

  // DOM要素
  const monthSelect = document.getElementById('monthSelect');
  const daySelect = document.getElementById('daySelect');
  const daysRange = document.getElementById('daysRange');
  const daysValue = document.getElementById('daysValue');
  const searchBtn = document.getElementById('searchBtn');
  const resultsContainer = document.getElementById('resultsContainer');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const messageBox = document.getElementById('messageBox');
  const prefecturesContainer = document.getElementById('prefecturesContainer');
  const clearPrefsBtn = document.getElementById('clearPrefsBtn');
  const sortContainer = document.getElementById('sortContainer');
  const sortSelect = document.getElementById('sortSelect');

  // 直近の検索結果（並び替え用）
  let currentResults = [];
  // 描画のたびに増やす。古い描画に紐づくWikipedia補完処理を打ち切るために使う
  let renderToken = 0;
  // 同じ月の再検索（日付や範囲だけを変えた検索）でWikidataに再問い合わせしないためのキャッシュ（月 → Promise）
  const wikidataCache = new Map();
  // 同じ記事のWikipedia補完を並び替えのたびに取得し直さないためのキャッシュ（URL → Promise）
  const wikiCache = new Map();

  // 利用者に見せてよいメッセージを持つエラー
  class UserFacingError extends Error {}

  // HTMLエスケープ（Wikidata/Wikipedia由来のテキストをinnerHTMLに埋め込む前に必ず通す）
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------
  // 入力UI
  // ---------------------------------------------------------------
  function updateDays() {
    const month = parseInt(monthSelect.value, 10);
    let daysInMonth = 31;
    if (month === 2) daysInMonth = 29;
    else if ([4, 6, 9, 11].includes(month)) daysInMonth = 30;

    const currentDay = parseInt(daySelect.value, 10) || 1;
    daySelect.innerHTML = '';
    for (let i = 1; i <= daysInMonth; i++) {
      const option = document.createElement('option');
      option.value = i;
      option.textContent = i;
      daySelect.appendChild(option);
    }
    daySelect.value = Math.min(currentDay, daysInMonth);
  }

  function getSelectedPrefectures() {
    return Array.from(document.querySelectorAll('.pref-checkbox:checked')).map(cb => cb.value);
  }

  function initUI() {
    for (let i = 1; i <= 12; i++) {
      const option = document.createElement('option');
      option.value = i;
      option.textContent = i;
      monthSelect.appendChild(option);
    }
    updateDays();
    monthSelect.addEventListener('change', updateDays);

    const today = new Date();
    monthSelect.value = today.getMonth() + 1;
    updateDays();
    daySelect.value = today.getDate();

    PREFECTURES.forEach(pref => {
      const label = document.createElement('label');
      label.className = 'flex items-center space-x-2 cursor-pointer p-1.5 hover:bg-white rounded transition select-none';
      label.innerHTML = `
        <input type="checkbox" value="${escapeHtml(pref)}" class="pref-checkbox w-4 h-4 text-sky-600 bg-white border-slate-300 rounded focus:ring-sky-500 cursor-pointer">
        <span class="text-sm font-medium text-slate-700">${escapeHtml(pref)}</span>
      `;
      prefecturesContainer.appendChild(label);
    });

    clearPrefsBtn.addEventListener('click', () => {
      document.querySelectorAll('.pref-checkbox').forEach(cb => { cb.checked = false; });
    });

    daysRange.addEventListener('input', e => {
      daysValue.textContent = e.target.value;
    });

    sortSelect.addEventListener('change', () => {
      if (currentResults.length > 0) renderCards();
    });

    searchBtn.addEventListener('click', handleSearch);
  }

  // ---------------------------------------------------------------
  // 通信
  // ---------------------------------------------------------------
  // タイムアウト付きで取得し、JSONとして返す（本文の読み取りもタイムアウトの対象）
  async function fetchJson(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestWikidata(month) {
    const url = `${WIKIDATA_ENDPOINT}?format=json&query=${encodeURIComponent(buildQuery(month))}`;
    try {
      const data = await fetchJson(url, { headers: { 'Accept': 'application/sparql-results+json' } }, WIKIDATA_TIMEOUT_MS);
      if (!data || !data.results || !Array.isArray(data.results.bindings)) throw new Error('unexpected response');
      return data.results.bindings;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new UserFacingError('Wikidataからの応答に時間がかかっています。時間をおいて再度お試しください。');
      }
      if (error.status === 429) {
        throw new UserFacingError('アクセスが集中しています。しばらく待ってから再度お試しください。');
      }
      if (error.status) {
        throw new UserFacingError('Wikidataからのデータ取得に失敗しました。時間をおいて再度お試しください。');
      }
      if (error instanceof SyntaxError || error.message === 'unexpected response') {
        throw new UserFacingError('Wikidataからの応答を正しく読み取れませんでした。時間をおいて再度お試しください。');
      }
      throw new UserFacingError('ネットワークエラーが発生しました。通信環境をご確認のうえ、再度お試しください。');
    }
  }

  function fetchDisasters(month) {
    if (!wikidataCache.has(month)) {
      const promise = requestWikidata(month).catch(error => {
        wikidataCache.delete(month); // 失敗はキャッシュしない（再検索でやり直せるように）
        throw error;
      });
      wikidataCache.set(month, promise);
    }
    return wikidataCache.get(month);
  }

  // ---------------------------------------------------------------
  // Wikipedia の概要欄（infobox）から、震度・規模・被害を補完する
  // ---------------------------------------------------------------
  const DAMAGE_KEYWORDS = ['被害', '死者', '負傷者', '行方不明', '死傷者'];
  const MAX_FIELD_LENGTH = 160;

  function cleanInfoboxText(text) {
    const cleaned = text.replace(/\[(?:注釈?\s*)?\d+\]/g, '').replace(/\s+/g, ' ').trim();
    return cleaned.length > MAX_FIELD_LENGTH ? `${cleaned.slice(0, MAX_FIELD_LENGTH)}…` : cleaned;
  }

  function parseInfobox(html) {
    const doc = new DOMParser().parseFromString(stripInlineStyles(html), 'text/html'); // 解析のみ（スクリプトは実行されない）
    const infobox = doc.querySelector('table.infobox');
    if (!infobox) return null;

    const details = { magnitude: null, intensity: null, damages: [] };
    const rows = infobox.querySelectorAll('tr');
    rows.forEach((row, i) => {
      const th = row.querySelector('th');
      if (!th) return;
      const label = th.textContent.trim();

      // 値は同じ行の td、なければ次の行の td（見出しだけの行の下に値が来る形式）
      let valueCell = row.querySelector('td');
      if (!valueCell && rows[i + 1] && rows[i + 1].querySelectorAll('th').length === 0) {
        valueCell = rows[i + 1].querySelector('td');
      }
      if (!valueCell) return;
      const value = cleanInfoboxText(valueCell.textContent);
      if (!value) return;

      if (!details.magnitude && (label.includes('マグニチュード') || label.includes('規模'))) details.magnitude = value;
      if (!details.intensity && label.includes('震度')) details.intensity = value;
      if (DAMAGE_KEYWORDS.some(keyword => label.includes(keyword))) details.damages.push({ label, value });
    });
    return details;
  }

  async function requestWikiDetails(wikipediaUrl) {
    const title = extractWikiTitle(wikipediaUrl);
    if (!title) return null;
    // 記事全文は1件で1MB以上になることがあるため、概要欄を含む冒頭部分（section=0）だけを取得する
    const params = new URLSearchParams({
      action: 'parse', page: title, prop: 'text', section: '0', redirects: '1',
      disablelimitreport: '1', format: 'json', formatversion: '2', origin: '*'
    });
    const data = await fetchJson(`${WIKIPEDIA_API}?${params}`, {}, WIKIPEDIA_TIMEOUT_MS);
    if (!data.parse || typeof data.parse.text !== 'string') return null;
    return parseInfobox(data.parse.text);
  }

  function loadWikiDetails(wikipediaUrl) {
    if (!wikiCache.has(wikipediaUrl)) {
      const promise = requestWikiDetails(wikipediaUrl).catch(error => {
        wikiCache.delete(wikipediaUrl); // 失敗はキャッシュしない
        console.error('Wikipediaの補完情報を取得できませんでした:', error);
        return null;
      });
      wikiCache.set(wikipediaUrl, promise);
    }
    return wikiCache.get(wikipediaUrl);
  }

  function applyWikiDetails(refs, details) {
    if (refs.magnitude && details.magnitude && details.magnitude.length <= 40) {
      refs.magnitude.textContent = /^[0-9.]+$/.test(details.magnitude) ? `M${details.magnitude}` : details.magnitude;
    }
    if (refs.intensity && details.intensity) {
      refs.intensity.textContent = details.intensity;
      refs.intensity.classList.remove('text-amber-600/60');
      // 「震度5強: 埼玉県川口市…」のように長い場合は文字を小さくする
      refs.intensity.classList.toggle('text-lg', details.intensity.length <= 12);
      refs.intensity.classList.toggle('text-sm', details.intensity.length > 12);
    }
    if (refs.damageList && details.damages.length > 0) {
      refs.damageList.innerHTML = '';
      details.damages.forEach(({ label, value }) => {
        const line = document.createElement('div');
        const strong = document.createElement('b');
        strong.textContent = `${label}: `;
        line.append(strong, document.createTextNode(value)); // textContentで入れるのでHTMLとして解釈されない
        refs.damageList.appendChild(line);
      });
      refs.damageContainer.classList.remove('hidden');
    }
  }

  // 同時実行数を絞ってバックグラウンドで補完する（大量の結果でWikipediaに負荷をかけすぎないため）。
  // 再描画（検索・並び替え）されたら、古い描画向けの処理はそこで打ち切る。
  async function processWikiQueue(jobs, token) {
    let cursor = 0;
    async function worker() {
      while (cursor < jobs.length && token === renderToken) {
        const job = jobs[cursor++];
        const details = await loadWikiDetails(job.url);
        if (details && token === renderToken) applyWikiDetails(job.refs, details);
      }
    }
    await Promise.all(Array.from({ length: Math.min(WIKI_CONCURRENCY, jobs.length) }, worker));
  }

  // ---------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------
  function showMessage(text, isError = false) {
    messageBox.textContent = text;
    messageBox.className = `rounded-lg p-4 mb-8 text-center font-medium shadow-sm border fade-in ${
      isError ? 'bg-red-100 text-red-700 border-red-200' : 'bg-sky-100 text-sky-800 border-sky-200'
    }`;
  }

  function createCard(data, index) {
    const card = document.createElement('article');
    card.className = 'bg-white rounded-xl shadow border border-slate-200 p-6 flex flex-col fade-in relative overflow-hidden';
    card.style.animationDelay = `${(index % 10) * 0.05}s`;

    const isEarthquake = data.type.includes('地震') || data.name.includes('地震');
    const earthquakeInfo = isEarthquake ? `
      <div class="flex flex-wrap gap-3 mb-4 bg-amber-50 p-3 rounded-lg border border-amber-200 shadow-inner">
        <div class="text-amber-800 text-sm font-medium"><i class="fa-solid fa-wave-square mr-1" aria-hidden="true"></i>マグニチュード: <span data-role="magnitude" class="text-lg font-bold">${data.magnitude ? `M${escapeHtml(data.magnitude)}` : '不明'}</span></div>
        <div class="text-amber-800 text-sm font-medium"><i class="fa-solid fa-house-crack mr-1" aria-hidden="true"></i>最大震度: <span data-role="intensity" class="text-lg font-bold text-amber-600/60">不明</span></div>
      </div>
    ` : '';

    // URLはSPARQLの制約で ja.wikipedia.org の記事に限られるが、href に出す前に念のため再検証する
    const wikiTitle = extractWikiTitle(data.wikipediaUrl);
    const wikiButton = wikiTitle ? `
      <div class="mt-5 pt-4 border-t border-slate-100">
        <a href="${escapeHtml(data.wikipediaUrl)}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center w-full bg-slate-50 hover:bg-sky-50 text-slate-700 hover:text-sky-700 font-medium py-2.5 px-4 rounded-lg transition duration-200 border border-slate-300 hover:border-sky-300">
          <i class="fa-brands fa-wikipedia-w mr-2" aria-hidden="true"></i> Wikipediaで詳細を見る<span class="sr-only">（新しいタブで開きます）</span>
        </a>
      </div>
    ` : '';

    const yearsAgoText = data.yearsAgo === 0
      ? '今年発生'
      : `発生から <span class="text-base">${data.yearsAgo}</span> 年`;

    card.innerHTML = `
      <div class="flex justify-between items-start mb-3 gap-2">
        <span class="inline-block bg-sky-100 text-sky-800 text-xs px-2.5 py-1 rounded-full font-semibold border border-sky-200">${escapeHtml(data.type)}</span>
        <span class="bg-red-50 text-red-600 font-bold px-3 py-1 rounded-full text-sm border border-red-200 shadow-sm whitespace-nowrap">${yearsAgoText}</span>
      </div>
      <h3 class="text-xl font-bold text-slate-800 mb-3 leading-tight">${escapeHtml(data.name)}</h3>
      ${earthquakeInfo}
      <div class="text-slate-600 text-sm mb-4 space-y-1.5">
        <p class="flex items-center"><i class="fa-regular fa-calendar text-slate-400 w-5" aria-hidden="true"></i> <span class="font-medium">${escapeHtml(data.dateStr)}</span>&nbsp;発生</p>
        <p class="flex items-start"><i class="fa-solid fa-location-dot text-slate-400 w-5 mt-1" aria-hidden="true"></i> <span>${escapeHtml(data.location)}</span></p>
      </div>
      <div class="mt-auto">
        <p class="text-slate-700 text-sm leading-relaxed">${escapeHtml(data.description)}</p>
        <div data-role="damage" class="hidden mt-3 bg-rose-50 p-3 rounded-lg border border-rose-200 shadow-inner">
          <div class="text-rose-800 text-sm font-bold mb-1"><i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>被害の概要</div>
          <div data-role="damage-list" class="text-rose-700 text-sm leading-relaxed space-y-1"></div>
        </div>
      </div>
      ${wikiButton}
    `;

    const refs = {
      magnitude: card.querySelector('[data-role="magnitude"]'),
      intensity: card.querySelector('[data-role="intensity"]'),
      damageContainer: card.querySelector('[data-role="damage"]'),
      damageList: card.querySelector('[data-role="damage-list"]')
    };
    return { card, refs, wikipediaUrl: wikiTitle ? data.wikipediaUrl : null, isEarthquake };
  }

  // 現在の並び順でカードを描画し、Wikipediaの補完をバックグラウンドで始める
  function renderCards() {
    const token = ++renderToken;
    resultsContainer.innerHTML = '';

    const fragment = document.createDocumentFragment();
    const jobs = [];
    sortResults(currentResults, sortSelect.value).forEach((data, index) => {
      const { card, refs, wikipediaUrl } = createCard(data, index);
      fragment.appendChild(card);
      if (wikipediaUrl) jobs.push({ url: wikipediaUrl, refs });
    });
    resultsContainer.appendChild(fragment);

    processWikiQueue(jobs, token);
  }

  function setLoading(isLoading) {
    loadingIndicator.classList.toggle('hidden', !isLoading);
    loadingIndicator.classList.toggle('flex', isLoading);
    searchBtn.disabled = isLoading;
    searchBtn.classList.toggle('opacity-50', isLoading);
    searchBtn.classList.toggle('cursor-not-allowed', isLoading);
    resultsContainer.setAttribute('aria-busy', String(isLoading));
  }

  async function handleSearch() {
    const month = parseInt(monthSelect.value, 10);
    const day = parseInt(daySelect.value, 10);
    const rangeDays = parseInt(daysRange.value, 10);
    const prefectures = getSelectedPrefectures();
    const prefText = prefectures.length > 0 ? `（${prefectures.join('、')}）` : '（全国）';

    renderToken++; // 前回の検索結果に紐づく補完処理を止める
    currentResults = [];
    resultsContainer.innerHTML = '';
    sortContainer.classList.add('hidden');
    messageBox.classList.add('hidden');
    setLoading(true);

    try {
      const bindings = await fetchDisasters(month);
      currentResults = processResults(bindings, {
        month, day, rangeDays, prefectures, currentYear: new Date().getFullYear()
      });

      if (currentResults.length === 0) {
        showMessage(`${month}月${day}日の前後${rangeDays}日間に発生した災害データ${prefText}は見つかりませんでした。`);
        return;
      }
      showMessage(`${month}月${day}日の前後${rangeDays}日間に発生した災害${prefText}が ${currentResults.length} 件見つかりました。`);
      sortContainer.classList.remove('hidden');
      renderCards();
    } catch (error) {
      console.error(error);
      showMessage(error instanceof UserFacingError ? error.message : '予期しないエラーが発生しました。時間をおいて再度お試しください。', true);
    } finally {
      setLoading(false);
    }
  }

  document.getElementById('currentYear').textContent = new Date().getFullYear();
  initUI();
  handleSearch();
})();
