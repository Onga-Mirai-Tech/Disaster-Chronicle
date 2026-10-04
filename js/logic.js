// Disaster Chronicle の「画面に依存しない」ロジック。
// ブラウザでは window.DisasterLogic として、Node のテスト（tests/）では require() で使う。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DisasterLogic = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 日単位まで分かっている日付だけを使う（Wikidata の timePrecision: 9=年, 10=月, 11=日）。
  // 年だけ・月だけの日付は 1月1日 / 該当月1日として返ってくるため、そのまま使うと誤った日付で表示されてしまう。
  const MIN_TIME_PRECISION = 11;

  const WIKI_BASE = 'https://ja.wikipedia.org/wiki/';

  const PREFECTURES = [
    '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
    '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
    '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
    '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
    '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
    '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'
  ];

  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  }

  // 検索対象にする月（指定月とその前後。12月↔1月は循環させる）
  function monthsAround(month) {
    return [month === 1 ? 12 : month - 1, month, month === 12 ? 1 : month + 1];
  }

  // Wikidata に投げる SPARQL。指定月と前後1か月の「日本国内の自然災害」を取得する。
  // 地震の規模は P2527（モーメントマグニチュード）/ P2528（リヒター・スケール）。
  function buildQuery(month) {
    return `
SELECT ?disaster ?disasterLabel
  (GROUP_CONCAT(DISTINCT ?typeLabel; separator=", ") AS ?types)
  (GROUP_CONCAT(DISTINCT ?locationLabel; separator=", ") AS ?locations)
  ?date ?precision
  (SAMPLE(?desc) AS ?description)
  (MAX(?mw) AS ?magnitudeMw)
  (MAX(?ml) AS ?magnitudeMl)
  (SAMPLE(?article) AS ?wikipediaUrl)
WHERE {
  ?disaster wdt:P31/wdt:P279* wd:Q8065 ;
            wdt:P17 wd:Q17 .

  { ?disaster p:P585/psv:P585 ?time . } UNION { ?disaster p:P580/psv:P580 ?time . }
  ?time wikibase:timeValue ?date ;
        wikibase:timePrecision ?precision .
  FILTER(?precision >= ${MIN_TIME_PRECISION})
  FILTER(MONTH(?date) IN (${monthsAround(month).join(',')}))

  ?disaster rdfs:label ?disasterLabel .
  FILTER(LANG(?disasterLabel) = "ja")

  OPTIONAL { ?disaster wdt:P31 ?typeItem . ?typeItem rdfs:label ?typeLabel . FILTER(LANG(?typeLabel) = "ja") }
  OPTIONAL { ?disaster wdt:P276|wdt:P131 ?locationItem . ?locationItem rdfs:label ?locationLabel . FILTER(LANG(?locationLabel) = "ja") }
  OPTIONAL { ?disaster schema:description ?desc . FILTER(LANG(?desc) = "ja") }
  OPTIONAL { ?disaster wdt:P2527 ?mw . }
  OPTIONAL { ?disaster wdt:P2528 ?ml . }
  OPTIONAL { ?article schema:about ?disaster ; schema:isPartOf <https://ja.wikipedia.org/> . }
} GROUP BY ?disaster ?disasterLabel ?date ?precision
`;
  }

  // Wikidata の日付文字列（例 "1923-09-01T00:00:00Z" / "-0480-08-01T00:00:00Z"）を年月日に分解する。
  // new Date() を通すと実行環境のタイムゾーンで日付がずれる（米国では前日になる）ため、文字列から直接取り出す。
  function parseWikidataDate(str) {
    const m = /^(-?\d{1,6})-(\d{2})-(\d{2})(?:T|$)/.exec(String(str || ''));
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { year, month, day };
  }

  // 閏年でない年の 2/29 は 2/28 に寄せる（3/1 にロールオーバーさせない）。
  // タイムゾーン・夏時間の影響を受けないよう UTC で計算する。
  function utcDayNumber(year, month, day) {
    if (month === 2 && day === 29 && !isLeapYear(year)) day = 28;
    return Date.UTC(year, month - 1, day) / 86400000;
  }

  // 災害の「月日」が、指定した月日の前後 rangeDays 日以内か（年は無視。年末年始をまたぐ場合も考慮）
  function isWithinXDays(targetMonth, targetDay, disasterMonth, disasterDay, rangeDays) {
    const target = utcDayNumber(2004, targetMonth, targetDay);
    const diffs = [2003, 2004, 2005].map(year =>
      Math.abs(target - utcDayNumber(year, disasterMonth, disasterDay))
    );
    return Math.min(...diffs) <= rangeDays;
  }

  function toMagnitude(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n.toFixed(1) : null;
  }

  // Wikipedia の記事URLから、API に渡す記事タイトルを取り出す（ja.wikipedia.org の記事URL以外は null）。
  // 「/」を含むタイトルがあるため、URL を split('/') して最後を使ってはいけない。
  function extractWikiTitle(url) {
    if (typeof url !== 'string' || !url.startsWith(WIKI_BASE)) return null;
    const rest = url.slice(WIKI_BASE.length);
    if (!rest || /[?#]/.test(rest)) return null;
    try {
      return decodeURIComponent(rest);
    } catch (e) {
      return null;
    }
  }

  // Wikipedia のHTMLから <style> と style 属性を取り除く。
  // 解析結果から使うのはテキストだけだが、これらを含んだまま DOMParser に渡すと、
  // 本番の CSP（style-src 'self'）に違反するものとして1回の検索でコンソールに数百件のエラーが出てしまう。
  function stripInlineStyles(html) {
    return String(html)
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, '');
  }

  // SPARQL の結果から、指定した範囲に入る災害だけを取り出して整形する。
  // options: { month, day, rangeDays, prefectures: string[], currentYear }
  function processResults(bindings, options) {
    const { month, day, rangeDays, currentYear } = options;
    const prefectures = options.prefectures || [];
    const results = [];
    const seenIds = new Set();

    for (const item of bindings) {
      const id = item.disaster.value;
      if (seenIds.has(id)) continue;

      // ラベルが未登録（Q番号のまま）・英数字のみのものは表示しない
      const name = item.disasterLabel.value;
      if (/^Q\d+$/.test(name) || /^[a-zA-Z0-9\s\-.,()]+$/.test(name)) continue;

      // 日単位より粗い精度の日付は使わない（クエリでも除外しているが、念のため）
      if (item.precision && Number(item.precision.value) < MIN_TIME_PRECISION) continue;

      const date = parseWikidataDate(item.date.value);
      if (!date) continue;
      if (date.year < 1 || date.year > currentYear) continue;
      if (!isWithinXDays(month, day, date.month, date.day, rangeDays)) continue;

      const type = item.types?.value || '災害';
      const location = item.locations?.value || '日本国内 (詳細不明)';
      const description = item.description?.value || '概要情報が登録されていません。';

      if (prefectures.length > 0) {
        const searchText = `${name} ${type} ${location} ${description}`;
        if (!prefectures.some(pref => searchText.includes(pref))) continue;
      }

      seenIds.add(id);
      results.push({
        name,
        type,
        location,
        year: date.year,
        month: date.month,
        day: date.day,
        dateStr: `${date.year}年${date.month}月${date.day}日`,
        yearsAgo: currentYear - date.year,
        description,
        magnitude: toMagnitude(item.magnitudeMw?.value) ?? toMagnitude(item.magnitudeMl?.value),
        wikipediaUrl: item.wikipediaUrl ? item.wikipediaUrl.value : null
      });
    }

    return sortResults(results, 'newest');
  }

  // order: 'newest'（新しい順）/ 'oldest'（古い順）/ 'date'（1月1日〜12月31日の順、同日は新しい順）
  function sortResults(results, order) {
    const byTime = r => r.year * 10000 + r.month * 100 + r.day;
    const byMonthDay = r => r.month * 100 + r.day;
    const sorted = [...results];
    if (order === 'oldest') {
      sorted.sort((a, b) => byTime(a) - byTime(b));
    } else if (order === 'date') {
      sorted.sort((a, b) => byMonthDay(a) - byMonthDay(b) || byTime(b) - byTime(a));
    } else {
      sorted.sort((a, b) => byTime(b) - byTime(a));
    }
    return sorted;
  }

  return {
    PREFECTURES,
    MIN_TIME_PRECISION,
    isLeapYear,
    monthsAround,
    buildQuery,
    parseWikidataDate,
    isWithinXDays,
    extractWikiTitle,
    stripInlineStyles,
    processResults,
    sortResults
  };
});
