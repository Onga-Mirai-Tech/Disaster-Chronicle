// js/logic.js（日付判定・絞り込み・並び替え・クエリ）のテスト。
// タイムゾーンで結果が変わらないことを確認するため、npm test は TZ を変えて2回実行する。
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

// SPARQL の1行ぶんを作る
function row(overrides = {}) {
  const base = {
    disaster: 'http://www.wikidata.org/entity/Q1',
    disasterLabel: '東北地方太平洋沖地震',
    date: '2011-03-11T00:00:00Z',
    types: '地震',
    locations: '宮城県, 岩手県',
    description: '2011年に東日本で発生した地震',
    ...overrides
  };
  const binding = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && value !== null) binding[key] = { value: String(value) };
  }
  return binding;
}

const search = (bindings, options = {}) =>
  L.processResults(bindings, { month: 3, day: 11, rangeDays: 0, prefectures: [], currentYear: 2026, ...options });

// ---------------------------------------------------------------
test('parseWikidataDate: 年月日を文字列から取り出す（タイムゾーンに依存しない）', () => {
  assert.deepEqual(L.parseWikidataDate('1923-09-01T00:00:00Z'), { year: 1923, month: 9, day: 1 });
  assert.deepEqual(L.parseWikidataDate('0800-01-01T00:00:00Z'), { year: 800, month: 1, day: 1 });
  assert.deepEqual(L.parseWikidataDate('-0480-08-01T00:00:00Z'), { year: -480, month: 8, day: 1 });
});

test('parseWikidataDate: 不正な値は null', () => {
  for (const bad of [undefined, null, '', 'abc', '2011-13-01T00:00:00Z', '2011-00-10T00:00:00Z', '2011-03-32T00:00:00Z']) {
    assert.equal(L.parseWikidataDate(bad), null, String(bad));
  }
});

// ---------------------------------------------------------------
test('isWithinXDays: 当日・前後の範囲', () => {
  assert.equal(L.isWithinXDays(3, 11, 3, 11, 0), true);
  assert.equal(L.isWithinXDays(3, 11, 3, 12, 0), false);
  assert.equal(L.isWithinXDays(3, 11, 3, 12, 1), true);
  assert.equal(L.isWithinXDays(3, 11, 3, 1, 10), true);
  assert.equal(L.isWithinXDays(3, 11, 3, 1, 9), false);
});

test('isWithinXDays: 年末年始をまたいでも判定できる', () => {
  assert.equal(L.isWithinXDays(1, 2, 12, 28, 5), true);   // 1/2 ← 12/28（5日前）
  assert.equal(L.isWithinXDays(12, 30, 1, 3, 5), true);   // 12/30 → 1/3（4日後）
  assert.equal(L.isWithinXDays(1, 2, 12, 28, 3), false);
});

test('isWithinXDays: 2/29 は 3/1 にロールオーバーせず 2/28 として扱う', () => {
  assert.equal(L.isWithinXDays(2, 29, 2, 29, 0), true);
  assert.equal(L.isWithinXDays(2, 29, 3, 1, 0), false);
  assert.equal(L.isWithinXDays(3, 1, 2, 29, 1), true);
  assert.equal(L.isWithinXDays(2, 28, 2, 29, 0), false, '2/28 と 2/29 は別の日');
  assert.equal(L.isWithinXDays(2, 28, 2, 29, 1), true);
});

// ---------------------------------------------------------------
test('processResults: 基本の整形（発生年・経過年数・日付表記）', () => {
  const [r] = search([row()]);
  assert.equal(r.name, '東北地方太平洋沖地震');
  assert.equal(r.dateStr, '2011年3月11日');
  assert.equal(r.yearsAgo, 15);
  assert.equal(r.type, '地震');
});

test('processResults: 指定範囲外の災害は除く', () => {
  assert.equal(search([row({ date: '2011-03-20T00:00:00Z' })], { rangeDays: 5 }).length, 0);
  assert.equal(search([row({ date: '2011-03-20T00:00:00Z' })], { rangeDays: 9 }).length, 1);
});

test('processResults: 日単位より粗い精度の日付は除く（年だけ判明 → 1月1日、の誤表示を防ぐ）', () => {
  const coarse = row({ date: '1991-01-01T00:00:00Z', precision: 9 });
  assert.equal(search([coarse], { month: 1, day: 1 }).length, 0);
  const exact = row({ date: '1991-01-01T00:00:00Z', precision: 11 });
  assert.equal(search([exact], { month: 1, day: 1 }).length, 1);
});

test('processResults: ラベル未登録（Q番号）・英数字のみの名前は除く', () => {
  assert.equal(search([row({ disasterLabel: 'Q12345' })]).length, 0);
  assert.equal(search([row({ disasterLabel: 'Great Kanto earthquake' })]).length, 0);
});

test('processResults: 同じ災害は1件にまとめる', () => {
  assert.equal(search([row(), row()]).length, 1);
});

test('processResults: 紀元前・未来の年は除く', () => {
  assert.equal(search([row({ date: '-0480-03-11T00:00:00Z' })]).length, 0);
  assert.equal(search([row({ date: '2027-03-11T00:00:00Z' })]).length, 0);
  assert.equal(search([row({ date: '2026-03-11T00:00:00Z' })]).length, 1);
});

test('processResults: 都道府県で絞り込む（複数選択は OR）', () => {
  const rows = [
    row({ disaster: 'Q1', disasterLabel: '宮城の地震', locations: '宮城県' }),
    row({ disaster: 'Q2', disasterLabel: '熊本の地震', locations: '熊本県', date: '2016-03-11T00:00:00Z' }),
    row({ disaster: 'Q3', disasterLabel: '場所不明の地震', locations: undefined, description: undefined })
  ];
  assert.deepEqual(search(rows, { prefectures: ['熊本県'] }).map(r => r.name), ['熊本の地震']);
  assert.equal(search(rows, { prefectures: ['熊本県', '宮城県'] }).length, 2);
  assert.equal(search(rows, { prefectures: [] }).length, 3);
});

test('processResults: 「京都府」の絞り込みで東京都の災害を拾わない', () => {
  const tokyo = row({ locations: '東京都', disasterLabel: '東京の地震' });
  assert.equal(search([tokyo], { prefectures: ['京都府'] }).length, 0);
});

test('processResults: 値が無い項目には既定の文言を入れる', () => {
  const [r] = search([row({ types: undefined, locations: undefined, description: undefined })]);
  assert.equal(r.type, '災害');
  assert.equal(r.location, '日本国内 (詳細不明)');
  assert.equal(r.description, '概要情報が登録されていません。');
});

test('processResults: マグニチュードはモーメント（P2527）を優先し、無ければリヒター（P2528）', () => {
  assert.equal(search([row({ magnitudeMw: '9.0', magnitudeMl: '8.4' })])[0].magnitude, '9.0');
  assert.equal(search([row({ magnitudeMl: '7.25' })])[0].magnitude, '7.3');
  assert.equal(search([row()])[0].magnitude, null);
  assert.equal(search([row({ magnitudeMw: 'abc' })])[0].magnitude, null, '数値でなければ NaN を表示しない');
});

// ---------------------------------------------------------------
test('sortResults: 新しい順・古い順・日付順', () => {
  const items = [
    { name: 'a', year: 2000, month: 3, day: 5 },
    { name: 'b', year: 2020, month: 3, day: 1 },
    { name: 'c', year: 1990, month: 2, day: 28 },
    { name: 'd', year: 2010, month: 3, day: 5 }
  ];
  const names = order => L.sortResults(items, order).map(r => r.name).join('');
  assert.equal(names('newest'), 'bdac');
  assert.equal(names('oldest'), 'cadb');
  assert.equal(names('date'), 'cbda', '2/28 → 3/1 → 3/5（同日は新しい順）');
  assert.deepEqual(items.map(r => r.name), ['a', 'b', 'c', 'd'], '元の配列は変更しない');
});

// ---------------------------------------------------------------
test('extractWikiTitle: ja.wikipedia.org の記事URLだけを受け付ける', () => {
  assert.equal(L.extractWikiTitle('https://ja.wikipedia.org/wiki/' + encodeURIComponent('東北地方太平洋沖地震')), '東北地方太平洋沖地震');
  assert.equal(L.extractWikiTitle('https://ja.wikipedia.org/wiki/' + encodeURIComponent('A/B') ), 'A/B');
  assert.equal(L.extractWikiTitle('https://ja.wikipedia.org/wiki/A/B'), 'A/B', 'タイトルに含まれる「/」を切り捨てない');
  for (const bad of [
    'https://en.wikipedia.org/wiki/Earthquake',
    'http://ja.wikipedia.org/wiki/x',
    'https://ja.wikipedia.org.evil.example/wiki/x',
    'https://ja.wikipedia.org/wiki/',
    'https://ja.wikipedia.org/wiki/x?action=raw',
    'javascript:alert(1)', null, undefined, 123
  ]) {
    assert.equal(L.extractWikiTitle(bad), null, String(bad));
  }
});

test('stripInlineStyles: <style> と style 属性だけを取り除く', () => {
  const html = '<style>.a{color:red}</style><table class="infobox" style="width:20em"><tr><th style=\'x:y\'>規模</th><td>M9.0</td></tr></table>';
  assert.equal(L.stripInlineStyles(html), '<table class="infobox"><tr><th>規模</th><td>M9.0</td></tr></table>');
  assert.equal(L.stripInlineStyles('<p class="a">style="x" はそのまま</p>'), '<p class="a">style="x" はそのまま</p>');
});

// ---------------------------------------------------------------
test('monthsAround: 12月と1月は循環する', () => {
  assert.deepEqual(L.monthsAround(1), [12, 1, 2]);
  assert.deepEqual(L.monthsAround(6), [5, 6, 7]);
  assert.deepEqual(L.monthsAround(12), [11, 12, 1]);
});

test('buildQuery: 地震の規模は P2527/P2528 を使い、無関係なプロパティを使わない', () => {
  const q = L.buildQuery(10);
  assert.match(q, /wdt:P2527/);
  assert.match(q, /wdt:P2528/);
  for (const wrong of ['P2522', 'P1086', 'P4024']) assert.doesNotMatch(q, new RegExp(wrong));
});

test('buildQuery: 日単位の精度に絞り、前後の月を含める', () => {
  const q = L.buildQuery(12);
  assert.match(q, /FILTER\(\?precision >= 11\)/);
  assert.match(q, /MONTH\(\?date\) IN \(11,12,1\)/);
});

test('PREFECTURES: 47都道府県', () => {
  assert.equal(L.PREFECTURES.length, 47);
  assert.equal(new Set(L.PREFECTURES).size, 47);
});
