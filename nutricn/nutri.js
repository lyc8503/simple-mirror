// 简易 nutrimatic
// 数据从 data.json 异步加载, 加载完成后 window.DATA 就绪。
let DATA = null;
function initData(json) {
  DATA = json;
  window.DATA = json; // 页面/测试可访问
  DATA.initOf = initOf;
  DATA.finOf = finOf;
  return DATA;
}

// pattern 定长: 每项 = 字面量 或 {条件}
// 语法:
//   py:shang   拼音 shang, 任意音调
//   py:3       第三声
//   py:shang4  拼音 shang 且第四声
//   py:sh-     声母 sh
//   py:-ang    韵母 ang
//   py:-ang3   韵母 ang 且第三声 (等价 {py:-ang py:3})
//   bj:女      部件包含 女
//   bh:4       共 4 画
//   bh:横2     第二画是横
//   {}         空条件 = 匹配任意一个字符
// {} 内: 空格/逗号分隔 = AND, | 分隔 = OR
// 编译成 JS 函数源码展示, 遍历词库按词频排序输出。

const MAX_RESULTS = 200;
const INITIALS = ['zh','ch','sh','b','p','m','f','d','t','n','l','g','k','h','j','q','x','r','z','c','s','y','w'];

function splitPinyin(s) {
  for (const ini of INITIALS) {
    if (s.startsWith(ini) && s.length > ini.length) return { initial: ini, final: s.slice(ini.length) };
  }
  return { initial: '', final: s };
}

// ---------- 条件解析: 返回条件数组 ----------
function parseCond(raw) {
  raw = raw.trim();
  const m = raw.match(/^([a-zA-Z\u4e00-\u9fff]+):(.*)$/);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const val = m[2].trim();
  // 记录条件原文, 用于生成可读注释
  const mk = conds => (conds || []).map(c => ({ ...c, raw: raw }));

  if (key === 'py' || key === 'pinyin') {
    const v = val.toLowerCase();
    // 纯音调: py:3
    if (/^[1-5]$/.test(v)) return mk([{ type: 'tone', value: +v }]);
    // 韵母: py:-ang  /  py:-ang3
    if (v.startsWith('-')) {
      let fin = v.slice(1);
      let tone = 0;
      const tm = fin.match(/^(.+?)([1-5])$/);
      if (tm) { fin = tm[1]; tone = +tm[2]; }
      if (!fin) return null;
      if (tone) return mk([{ type: 'fin', value: fin }, { type: 'tone', value: tone }]);
      return mk([{ type: 'fin', value: fin }]);
    }
    // 声母: py:sh-
    if (v.endsWith('-')) {
      const ini = v.slice(0, -1);
      if (!ini) return null;
      return mk([{ type: 'init', value: ini }]);
    }
    // 声母+音调: py:sh-3
    if (v.includes('-')) {
      const parts = v.split('-');
      if (parts.length === 2 && /^[1-5]$/.test(parts[1]) && parts[0]) {
        return mk([{ type: 'init', value: parts[0] }, { type: 'tone', value: +parts[1] }]);
      }
      return null;
    }
    // 全拼+音调: py:shang4
    const tm = v.match(/^(.+?)([1-5])$/);
    if (tm) return mk([{ type: 'pyTone', bare: tm[1], tone: +tm[2] }]);
    // 全拼任意调: py:shang
    if (!v) return null;
    return mk([{ type: 'py', value: v }]);
  }

  if (key === 'bj' || key === 'rad' || key === 'comp' || key === 'component' || key === '部件' || key === '拆字') {
    if (!val) return null;
    return mk([{ type: 'component', value: val }]);
  }

  if (key === 'zc' || key === '组词') {
    const idx = val.indexOf('#');
    if (idx < 0) return null;
    return mk([{ type: 'zici', pre: val.slice(0, idx), post: val.slice(idx + 1) }]);
  }

  if (key === 'bh' || key === 'stroke' || key === '画') {
    // bh:4 共4画
    if (/^\d+$/.test(val)) return mk([{ type: 'strokeCount', value: +val }]);
    // bh:横2 第二画是横
    const sm = val.match(/^(.+?)(\d+)$/);
    if (sm) return mk([{ type: 'strokeAt', value: +sm[2], name: sm[1] }]);
    // bh:横 含横画
    if (!val) return null;
    return mk([{ type: 'strokeName', value: val }]);
  }

  return null;
}

// ---------- 条件 -> JS 表达式 ----------
function condExpr(cond, v) {
  // 每个条件转成简短表达式, 使用下方辅助函数:
  //   py(c) 拼音数组  tone(c) 音调数组  init(c) 声母数组
  //   fin(c) 韵母数组  comps(c) 部件数组  ods(c) 笔顺数组
  switch (cond.type) {
    case 'py':       return `py(${v}).includes(${JSON.stringify(cond.value)})`;
    case 'pyTone':   return `py(${v}).some(p => p.slice(0,-1) === ${JSON.stringify(cond.bare)} && +p.slice(-1) === ${cond.tone})`;
    case 'init':     return `init(${v}).includes(${JSON.stringify(cond.value)})`;
    case 'fin':      return `fin(${v}).includes(${JSON.stringify(cond.value)})`;
    case 'tone':     return `tone(${v}).includes(${cond.value})`;
    case 'strokeCount': return `D.st[${v}] === ${cond.value}`;
    case 'strokeName':  return `ods(${v}).includes(${JSON.stringify(cond.value)})`;
    case 'strokeAt':    return `ods(${v})[${cond.value-1}] === ${JSON.stringify(cond.name)}`;
    case 'component': {
      // 含 IDC 运算符 => 字形匹配 (fx 字段); 否则普通部件 (cp)
      if (/[⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻]/.test(cond.value)) {
        return `D.fx[${v}] && D.fx[${v}].split('|').some(s => s.includes(${JSON.stringify(cond.value)}))`;
      }
      return `comps(${v}).includes(${JSON.stringify(cond.value)})`;
    }
    case 'or':
      return '(' + cond.groups.map(g =>
        '(' + g.map(c => condExpr(c, v)).join(' && ') + ')'
      ).join(' || ') + ')';
    case 'zici':
      return `WORDSET.has(${JSON.stringify(cond.pre)} + ${v} + ${JSON.stringify(cond.post)})`;
    default:
      return 'false';
  }
}

// pattern 项 -> 单字表达式
function atomExpr(atom, v) {
  if (atom.t === 'lit') return `${v} === ${JSON.stringify(atom.c)}`;
  if (atom.t === 'set') {
    if (!atom.conds.length) return 'true'; // 空条件: 匹配任意字
    const parts = atom.conds.map(c => condExpr(c, v));
    return parts.length === 1 ? parts[0] : '(' + parts.join(' && ') + ')';
  }
  return 'false';
}

// ---------- pattern 解析 ----------
function parsePattern(input) {
  const atoms = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '{') {
      const end = input.indexOf('}', i);
      if (end < 0) return { error: '缺少 }' };
      const inner = input.slice(i+1, end).trim();
      if (!inner) {
        atoms.push({ t: 'set', conds: [] }); // 空条件 = 任意字
        i = end + 1;
        continue;
      }
      // 空格/逗号 = AND; 单项内 | = OR (更紧密):
      // py:3 bj:女|bj:日  => py3 && (女||日)
      const conds = [];
      for (const item of inner.split(/[,，\s]+/)) {
        if (!item.trim()) continue;
        const orParts = item.split('|').map(parseCond);
        if (orParts.some(p => !p)) return { error: '无法识别的条件: ' + item };
        if (orParts.length === 1) conds.push(...orParts[0]);
        else conds.push({ type: 'or', groups: orParts, raw: item });
      }
      if (!conds.length) return { error: '空的条件 {}' };
      atoms.push({ t: 'set', conds });
      i = end + 1;
    } else if (ch === '(' || ch === ')' || ch === '|' || ch === '?' || ch === '*' || ch === '+') {
      return { error: '不支持字符 "' + ch + '"（pattern 是定长的，只用字面量或 {}）' };
    } else {
      atoms.push({ t: 'lit', c: ch });
      i += ch.length;
    }
  }
  if (!atoms.length) return { error: '空 pattern' };
  return atoms;
}

// ---------- 编译为函数源码 ----------
function compileToSource(expr) {
  const atoms = parsePattern(expr);
  if (atoms.error) return { error: atoms.error };
  const n = atoms.length;
  const checks = atoms.map((a, i) => {
    const e = atomExpr(a, `c${i}`);
    const desc = atomDesc(a);
    return `  // 第${i+1}字: ${desc}
  if (!(${e})) return false;`;
  }).join('\n');
  const src = `function match(word) {
  // 辅助: 取单个字的各类数据
  const py = c => (D.py[c] || '').split('|').filter(Boolean);
  const tone = c => py(c).map(p => +p.slice(-1));
  const init = c => py(c).map(p => D.initOf(p));
  const fin = c => py(c).map(p => D.finOf(p));
  const comps = c => (D.cp[c] || '').split(',').filter(Boolean);
  const ods = c => (D.od[c] || '').split(',').filter(Boolean);
  if (word.length !== ${n}) return false;
  const c0 = word[0], c1 = word[1], c2 = word[2], c3 = word[3], c4 = word[4], c5 = word[5], c6 = word[6], c7 = word[7];
${checks}
  return true;
}`;
  return { src, n };
}

// 条件的可读描述(用于源码注释)
function atomDesc(atom) {
  if (atom.t === 'lit') return `字面量 "${atom.c}"`;
  if (atom.t === 'set' && !atom.conds.length) return '任意字';
  if (atom.t === 'set') {
    return atom.conds.map(c => c.raw || c.type).join(' 且 ');
  }
  return '';
}

// 编译: 真实函数 + 展示源码
function compile(expr) {
  const src = compileToSource(expr);
  if (src.error) return src;
  try {
    const body = src.src
      .replace('function match(word) {', 'return function(word) {')
      .replace(/\n  return true;\n}/, '\n  return true;\n};');
    const fn = new Function('D', body)(DATA);
    return { src: src.src, fn };
  } catch (e) {
    return { error: '编译失败: ' + e.message };
  }
}

// ---------- 主入口 ----------
function run(expr) {
  if (!DATA) return { words: [], src: '', error: '数据尚未加载完成' };
  const c = compile(expr);
  if (c.error) return { words: [], src: '', error: c.error };
  const results = [];
  for (const item of WORDS) {
    if (c.fn(item.word)) results.push(item);
  }
  results.sort((a, b) => b.freq - a.freq);
  return { words: results.slice(0, MAX_RESULTS), src: c.src, error: '' };
}

// 辅助: 拼音声母/韵母 (生成函数里用)
function initOf(p) { return splitPinyin(p.slice(0, -1).toLowerCase()).initial; }
function finOf(p) { return splitPinyin(p.slice(0, -1).toLowerCase()).final; }

window.runNutrimatic = run;
window.initData = initData;

// 查字: 返回某字的全部数据(用于"汉字数据" tab)
function lookupChar(ch) {
  if (!DATA) return { error: '数据尚未加载完成' };
  if (ch.length !== 1) return { error: '请输入单个汉字' };
  const d = { char: ch };
  d.pinyin = DATA.py[ch] ? DATA.py[ch].split('|') : [];
  d.stroke = DATA.st[ch] || null;
  d.order = DATA.od[ch] ? DATA.od[ch].split(',') : [];
  d.components = DATA.cp[ch] ? DATA.cp[ch].split(',') : [];
  d.forms = DATA.fx[ch] ? DATA.fx[ch].split('|') : [];
  // 拼音详情
  d.details = d.pinyin.map(p => {
    const bare = p.slice(0, -1);
    const tone = parseInt(p.slice(-1), 10) || 0;
    const sp = splitPinyin(bare.toLowerCase());
    return { full: bare, tone, initial: sp.initial, final: sp.final };
  });
  return d;
}

window.lookupChar = lookupChar;
