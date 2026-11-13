// 口パク母音入力の共通ロジック（ブラウザとnodeの両方で使う）
(function (root) {
  const ROWS = {
    a: 'あかさたなはまやらわがざだばぱぁゃゎ',
    i: 'いきしちにひみりぎじぢびぴぃ',
    u: 'うくすつぬふむゆるぐずづぶぷぅゅゔ',
    e: 'えけせてねへめれげぜでべぺぇ',
    o: 'おこそとのほもよろをごぞどぼぽぉょ',
  };
  const V = {};
  for (const [v, s] of Object.entries(ROWS)) for (const ch of s) V[ch] = v;
  const BILABIAL = new Set([...'まみむめもばびぶべぼぱぴぷぺぽ']);
  const SMALL_Y = { 'ゃ': 'a', 'ゅ': 'u', 'ょ': 'o' };
  const SMALL_V = { 'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o' };
  const NAME = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お', N: '閉' };

  function kataToHira(s) {
    return s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  // 読み（ひらがな）→ 唇で見える記号列。N = 唇が閉じる（ん・ま/ば/ぱ行の頭）
  function readingToVisemes(reading) {
    const s = kataToHira(reading || '');
    const out = [];
    for (const ch of s) {
      if (SMALL_Y[ch]) { if (out.length && out[out.length - 1] !== 'N') out[out.length - 1] = SMALL_Y[ch]; continue; }
      if (SMALL_V[ch]) { if (out.length && out[out.length - 1] !== 'N') out[out.length - 1] = SMALL_V[ch]; else out.push(SMALL_V[ch]); continue; }
      if (ch === 'ん') { out.push('N'); continue; }
      if (ch === 'っ') continue;
      if (ch === 'ー') { if (out.length) out.push(out[out.length - 1]); continue; }
      const prev = out[out.length - 1];
      // 「おう」「えい」は長音として発音されるので前の母音を伸ばす
      if (ch === 'う' && prev === 'o') { out.push('o'); continue; }
      if (ch === 'い' && prev === 'e') { out.push('e'); continue; }
      const v = V[ch];
      if (!v) continue;
      if (BILABIAL.has(ch)) out.push('N');
      out.push(v);
    }
    return out;
  }

  // 連続する同じ記号をまとめ、個数も数える
  function runs(seq) {
    const out = [];
    for (const x of seq) {
      const last = out[out.length - 1];
      if (last && last.v === x) last.n++; else out.push({ v: x, n: 1 });
    }
    return out;
  }

  // 唇で混同しやすい組は置換コストを下げる
  const NEAR = new Set(['u-o', 'o-u', 'i-e', 'e-i', 'u-N', 'N-u', 'a-e', 'e-a']);
  function subCost(obs, exp) {
    if (obs.v === exp) return 0;
    if (obs.alt === exp) return 0.25;
    return NEAR.has(obs.v + '-' + exp) ? 0.6 : 1;
  }

  // obs: [{v, alt?}]（まとめ済み）, exp: ['a', ...]（まとめ済み）
  function distance(obs, exp) {
    const m = obs.length, n = exp.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      const del = obs[i - 1].v === 'N' ? 0.5 : 1;   // 余計な「閉」は軽い誤り
      d[i][j] = Math.min(d[i - 1][j] + del, d[i][j - 1] + 1, d[i - 1][j - 1] + subCost(obs[i - 1], exp[j - 1]));
    }
    return d[m][n];
  }

  // 観測トークンをまとめる（同じ母音の連続を1つに、長さは合計）
  function mergeTokens(tokens) {
    const out = [];
    for (const t of tokens) {
      const last = out[out.length - 1];
      if (last && last.v === t.v) { last.ms += t.ms; if (!last.alt) last.alt = t.alt; }
      else out.push({ v: t.v, ms: t.ms, alt: t.alt });
    }
    while (out.length && out[0].v === 'N') out.shift();
    while (out.length && out[out.length - 1].v === 'N') out.pop();
    return out;
  }

  // 区間の長さから母音のモーラ数を見積もる
  function estimateMorae(tokens, unitMs) {
    return mergeTokens(tokens).filter(t => t.v !== 'N')
      .reduce((a, t) => a + Math.max(1, Math.round(t.ms / unitMs)), 0);
  }

  // 候補の点数（小さいほど良い）。dist: 口形の並びの食い違い、lenGap: モーラ数のずれ
  function scoreCandidate(tokens, reading, unitMs = 150) {
    const obs = mergeTokens(tokens);
    const expSeq = readingToVisemes(reading);
    const exp = runs(expSeq).map(r => r.v);
    const dist = distance(obs, exp);
    const expMorae = expSeq.filter(x => x !== 'N').length;
    const lenGap = Math.abs(expMorae - estimateMorae(tokens, unitMs));
    return { dist, lenGap, score: dist + 0.15 * lenGap };
  }

  function visemeString(reading) {
    return readingToVisemes(reading).map(x => NAME[x]).join('');
  }

  function tokensToText(tokens) {
    return mergeTokens(tokens).map(t => {
      const alt = t.alt ? `、${NAME[t.alt]}の可能性あり` : '';
      return `${NAME[t.v]}(${Math.round(t.ms)}ms${alt})`;
    }).join(' ');
  }

  const EXAMPLES = [
    ['こんにちは', 'こんにちは', 'お 閉 い(長い) あ'],
    ['ありがとう', 'ありがとう', 'あ い あ お(長い)'],
    ['もう無理', 'もうむり', '閉 お(長い) 閉 う い'],
    ['学校', 'がっこう', 'あ お(長い)'],
    ['大丈夫', 'だいじょうぶ', 'あ い お(長い) 閉 う'],
  ];

  function buildPrompt(tokens, committed, partner, feedback) {
    const lines = [
      'あなたは「口パク（無声）で話された日本語」を推定する入力システムです。',
      'カメラで唇の形だけを読み取っているので、子音は見えません。見えるのは次の記号の並びです。',
      '- あ/い/う/え/お: その母音の口の形の区間',
      '- 閉: 唇が閉じた区間。「ん」、またはま行・ば行・ぱ行の子音の始まり',
      '- 「っ」は見えず、長音「ー」や「おう」「えい」は前の母音の区間が長くなるだけです',
      '- 話者は口を止めずに続けて話すので、同じ母音が続くモーラは1つの長い区間になります。区間の長さ(ms)からモーラ数を見積もってください（目安1モーラ120〜200ms）',
      '- 認識誤りもあります。特に う↔お、い↔え の取り違えと、短い区間の見落とし。「〜の可能性あり」は2番目に近かった口形です',
      '',
      '変換の例（表記 → 読み → 見える並び）:',
      ...EXAMPLES.map(([t, r, v]) => `- ${t} → ${r} → ${v}`),
      '',
      partner ? `相手のメッセージ（これへの返信を書いています）: 「${partner}」` : '（会話の相手のメッセージはありません）',
      committed ? `ここまでに確定した文: 「${committed}」（この続きを推定します）` : '（文の書き始めです）',
      `今回の観測: ${tokensToText(tokens)}`,
    ];
    if (feedback) lines.push('', feedback);
    lines.push(
      '',
      '手順: まず観測に合う読みを、助詞や語尾も含めて複数考え、それぞれの読みを「見える並び」に直して観測と照らし合わせます。そのうえで、確定済みの文の続きとして、また相手への返信として自然なものを選びます。',
      '候補を8個、可能性が高い順に出してください。表記は漢字かな交じり、読みはひらがなです。',
      '出力はJSONのみ: {"candidates":[{"text":"表記","reading":"よみ"}]}',
    );
    return lines.join('\n');
  }

  function feedbackFor(ranked) {
    const bad = ranked.slice(0, 4).map(c => `「${c.text}」（読み ${c.reading} → ${visemeString(c.reading)}）`);
    return `前回の候補は観測と口形が合いませんでした: ${bad.join('、')}。観測の並びにもっと忠実な読みを考え直してください。`;
  }

  function parseCandidates(raw) {
    if (raw && typeof raw === 'object') return raw.candidates || [];
    const s = String(raw || '');
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try { return JSON.parse(m[0]).candidates || []; } catch { return []; }
  }

  function rank(tokens, cands, unitMs = 150) {
    const seen = new Set();
    return cands
      .filter(c => c && c.text && !seen.has(c.text) && seen.add(c.text))
      .map((c, i) => ({ ...c, ...scoreCandidate(tokens, c.reading || '', unitMs), order: i }))
      .sort((x, y) => (x.score - y.score) || (x.order - y.order));
  }

  const api = { readingToVisemes, runs, distance, mergeTokens, estimateMorae, scoreCandidate, visemeString, tokensToText, buildPrompt, feedbackFor, parseCandidates, rank, NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KP = api;
})(typeof window !== 'undefined' ? window : globalThis);
