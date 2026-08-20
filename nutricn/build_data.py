#!/usr/bin/env python3
"""构建 data.json: 汉字数据表(纯数据, 无 JS)。

数据源(自动下载, 可离线缓存):
  1. cnchar (MIT) 的 npm 包: 拼音(带调+多音), 总笔画, 笔顺形码
  2. cjkvi-ids (GPL/CC?) 的 ids.txt: 拆字部件
  - npm 包从 registry.npmjs.org 下载, 本脚本只依赖 Python3 + Node(用于运行 cnchar 生成数据)
  - 中间文件存放在 ./build/ 目录, 产出 ./data.json

用法:
  python3 build_data.py          # 下载+构建
  python3 build_data.py --skip-download   # 使用已有缓存重新构建
"""
import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.parse
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, 'build')
OUT = os.path.join(HERE, 'data.json')

# 固定版本, 可复现
CNCHAR_VERSION = '3.2.6'
CNCHAR_ORDER_VERSION = '3.2.6'
IDS_URL = 'https://raw.githubusercontent.com/cjkvi/cjkvi-ids/master/ids.txt'

# 附加词库(成语/古诗)
IDIOM_URL = 'https://raw.githubusercontent.com/pwxcoo/chinese-xinhua/master/data/idiom.json'
TANG_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/全唐诗/poet.tang.{}.json'
YD_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/御定全唐詩/json/{:03d}.json'
SONG_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/宋词/ci.song.{}.json'


def need_download(path):
    return not os.path.exists(path) or os.path.getsize(path) == 0


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        print(f'[cache] {dest}')
        return dest
    print(f'[download] {url}')
    url = urllib.parse.quote(url, safe=':/%#?&=@[]!$\'()*+,;~-')
    req = urllib.request.Request(url, headers={'User-Agent': 'build_data.py/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    with open(dest, 'wb') as f:
        f.write(data)
    return dest


def fetch_npm_package(name, version, dest_dir):
    """下载并解包 npm 包, 返回包目录. 带缓存."""
    pkg_dir = os.path.join(BUILD, f'{name}-{version}')
    if os.path.isdir(pkg_dir):
        return pkg_dir
    tarball = os.path.join(BUILD, f'{name}-{version}.tgz')
    url = f'https://registry.npmjs.org/{name}/-/{name}-{version}.tgz'
    download(url, tarball)
    with tarfile.open(tarball, 'r:gz') as tf:
        tf.extractall(pkg_dir)
    return pkg_dir


def load_ids():
    """读取 cjkvi IDS, 返回 {字: [拆字字符串...]}"""
    ids_file = os.path.join(BUILD, 'ids.txt')
    download(IDS_URL, ids_file)
    ids = {}
    with open(ids_file, encoding='utf-8') as f:
        for line in f:
            if not line.startswith('U+'):
                continue
            p = line.rstrip('\n').split('\t')
            if len(p) < 3:
                continue
            cp = chr(int(p[0][2:], 16))
            decs = [d for d in p[2:] if d and d != '？']
            if decs:
                ids[cp] = decs
    return ids


IDC = set('⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻')

def is_han(c):
    o = ord(c)
    return (0x3400 <= o <= 0x4DBF or 0x4E00 <= o <= 0x9FFF
            or 0xF900 <= o <= 0xFAFF or 0x20000 <= o <= 0x2FA1F)


def parse_components(ids, keep_chars):
    """从 IDS 提取部件。
    - cp: 完全拆散(递归展开到原子部件, 如 品->口,口,口)
    - fx: 该字出现的全部 IDS 分解串(去重), 用于字形匹配
    """
    # 原子: IDS 中该字只有自身或没有有效分解(如 口/女/子/日/木)
    def is_atom(ch):
        decs = ids.get(ch)
        if not decs:
            return True
        # 若所有分解只含自身(无 IDC 运算符), 视为原子
        for d in decs:
            if any(c in IDC for c in d):
                return False
        return True

    cache = {}
    def deep_parts(ch, stack):
        """递归展开到原子部件, 带环保护."""
        if ch in cache:
            return cache[ch]
        if ch in stack:
            return [ch]
        decs = ids.get(ch)
        if not decs or is_atom(ch):
            cache[ch] = [ch]
            return [ch]
        # 取第一个分解(多字形取首个), 递归展开其中的汉字部件
        d = decs[0]
        parts = []
        stack.add(ch)
        in_bracket = False
        for c in d:
            if c in IDC:
                continue
            if c == '[':
                in_bracket = True
                continue
            if c == ']':
                in_bracket = False
                continue
            if in_bracket:
                continue
            if is_han(c):
                parts.extend(deep_parts(c, stack))
            else:
                # 非汉字符号(如 ㇀ 等)原样保留
                parts.append(c)
        stack.discard(ch)
        cache[ch] = parts
        return parts

    out_cp = {}
    out_fx = {}
    for cp, decs in ids.items():
        if cp not in keep_chars:
            continue
        # 完全拆散
        parts = []
        for d in decs:
            # 先归一: 去掉 IDC 后直接部件(旧行为)用于 cp? 不, cp 用深拆
            pass
        deep = []
        for d in decs:
            stack = set()
            for c in d:
                if c in IDC:
                    continue
                if c == '[':
                    # 字形限定标记 [GTKV] 等: 跳过到 ]
                    continue
                if c == ']':
                    continue
                if not is_han(c):
                    deep.append(c)
                    continue
                for p in deep_parts(c, stack):
                    deep.append(p)
        if deep:
            out_cp[cp] = deep
        # 全部 IDS 串(去重, 保留原样) 用于字形匹配
        fx = []
        for d in decs:
            if d not in fx:
                fx.append(d)
        if fx:
            out_fx[cp] = fx
    return out_cp, out_fx


def run_cnchar_build():
    """用 Node 运行 cnchar, 导出拼音/笔画/笔顺数据."""
    cnchar_dir = fetch_npm_package('cnchar', CNCHAR_VERSION, BUILD)
    order_dir = fetch_npm_package('cnchar-order', CNCHAR_ORDER_VERSION, BUILD)
    js = r'''
const fs=require('fs');
global.window=global;
eval(fs.readFileSync(process.argv[1],'utf8'));
eval(fs.readFileSync(process.argv[2],'utf8'));
const c=global.cnchar;
c._.warn=()=>{};
const spell={}, stroke={}, order={};
for (const [ch,code] of Object.entries(c.order.dict.orders)) {
  const pyRaw=c.spell(ch,'poly','tone','array')[0]||'';
  const items=pyRaw.replace(/[()]/g,'').split('|').filter(Boolean);
  spell[ch]=items.map(p=>{
    const info=c.spellInfo(p);
    if(!info) return p.toLowerCase();
    return (info.spell||p.toLowerCase()) + info.tone;
  }).join('|');
  stroke[ch]=c.stroke(ch);
  order[ch]=code;
}
// 字母->笔画名表
const src=fs.readFileSync(process.argv[2],'utf8');
const i=src.indexOf('"a":{"shape":');
let start=src.lastIndexOf('{', i);
let depth=0, j=start;
while(j<src.length){ if(src[j]==='{')depth++; else if(src[j]==='}'){depth--; if(!depth)break;} j++; }
const alphabet=JSON.parse(src.slice(start,j+1));
console.log(JSON.stringify({spell,stroke,order,alphabet}));
'''
    cnchar_main = os.path.join(cnchar_dir, 'package', 'cnchar.min.js')
    cnchar_order = os.path.join(order_dir, 'package', 'cnchar.order.min.js')
    out = subprocess.run(['node', '-e', js, cnchar_main, cnchar_order],
                         capture_output=True, text=True, timeout=300)
    if out.returncode:
        sys.exit('cnchar 构建失败: ' + out.stderr[:2000])
    return json.loads(out.stdout)


def download_json_list(urls, label):
    """下载一组 json 并合并列表."""
    all_items = []
    for i, url in enumerate(urls):
        fname = f'{label}_{i}.json'
        dest = os.path.join(BUILD, fname)
        download(url, dest)
        with open(dest, encoding='utf-8') as f:
            items = json.load(f)
        if isinstance(items, list):
            all_items.extend(items)
        else:
            all_items.append(items)
        if (i + 1) % 20 == 0 or i + 1 == len(urls):
            print(f'  {label}: {i+1}/{len(urls)}, 累计 {len(all_items)} 条')
    return all_items


def fetch_idioms():
    """成语词典 -> [{word, pinyin, explanation}]"""
    dest = os.path.join(BUILD, 'idiom.json')
    download(IDIOM_URL, dest)
    with open(dest, encoding='utf-8') as f:
        items = json.load(f)
    out = []
    for it in items:
        w = it.get('word', '').strip()
        if not w:
            continue
        out.append({
            'word': w,
            'pinyin': it.get('pinyin', ''),
            'explanation': it.get('explanation', ''),
        })
    return out


def fetch_tang():
    """全唐诗(58片, 繁体) -> 每行诗句一个词条, 附标题/作者."""
    urls = [TANG_BASE.format(i * 1000) for i in range(58)]
    items = download_json_list(urls, 'tang')
    out = []
    for it in items:
        title = it.get('title', '')
        author = it.get('author', '')
        for line in it.get('paragraphs', []):
            line = line.strip()
            if not line:
                continue
            out.append({'word': line, 'title': title, 'author': author, 'dynasty': '唐'})
    return out


def fetch_yuding():
    """御定全唐诗(900卷) -> 同上"""
    urls = [YD_BASE.format(i) for i in range(1, 901)]
    items = download_json_list(urls, 'yuding')
    out = []
    for it in items:
        title = it.get('title', '')
        author = it.get('author', '')
        for line in it.get('paragraphs', []):
            line = line.strip()
            if not line:
                continue
            out.append({'word': line, 'title': title, 'author': author, 'dynasty': '唐'})
    return out


def fetch_song_ci():
    """宋词(23片) -> 每行一句, 附词牌/作者"""
    song_files = [0,1000,10000,11000,12000,13000,14000,15000,16000,17000,18000,19000,2000,20000,'2019y',21000,3000,4000,5000,6000,7000,8000,9000]
    urls = [SONG_BASE.format(f) for f in song_files]
    items = download_json_list(urls, 'songci')
    out = []
    for it in items:
        title = it.get('rhythmic', '')  # 词牌名
        author = it.get('author', '')
        for line in it.get('paragraphs', []):
            line = line.strip()
            if not line:
                continue
            out.append({'word': line, 'title': title, 'author': author, 'dynasty': '宋'})
    return out


def build_extra():
    """构建附加词库 json 文件."""
    print('下载成语...')
    idioms = fetch_idioms()
    with open(os.path.join(HERE, 'dict_idiom.json'), 'w', encoding='utf-8') as f:
        json.dump(idioms, f, ensure_ascii=False, separators=(',', ':'))
    print(f'成语: {len(idioms)}')

    print('下载全唐诗...')
    tang = fetch_tang()
    with open(os.path.join(HERE, 'dict_poetry_tang.json'), 'w', encoding='utf-8') as f:
        json.dump(tang, f, ensure_ascii=False, separators=(',', ':'))
    print(f'全唐诗行: {len(tang)}')

    print('下载御定全唐诗...')
    yuding = fetch_yuding()
    with open(os.path.join(HERE, 'dict_poetry_yuding.json'), 'w', encoding='utf-8') as f:
        json.dump(yuding, f, ensure_ascii=False, separators=(',', ':'))
    print(f'御定全唐诗行: {len(yuding)}')

    print('下载宋词...')
    songci = fetch_song_ci()
    with open(os.path.join(HERE, 'dict_poetry_song.json'), 'w', encoding='utf-8') as f:
        json.dump(songci, f, ensure_ascii=False, separators=(',', ':'))
    print(f'宋词行: {len(songci)}')


def collect_dict_chars():
    """收集词库中的汉字, 确保数据覆盖词库."""
    chars = set()
    with open(os.path.join(HERE, 'dict.txt'), encoding='utf-8') as f:
        for line in f:
            w = line.split()[0] if line.strip() else ''
            for ch in w:
                o = ord(ch)
                if 0x3400 <= o <= 0x9FFF or 0xF900 <= o <= 0xFAFF or 0x20000 <= o <= 0x2FA1F:
                    chars.add(ch)
    return chars


def build():
    os.makedirs(BUILD, exist_ok=True)
    data = run_cnchar_build()
    spell, stroke, order, alphabet = data['spell'], data['stroke'], data['order'], data['alphabet']

    # 收集词库字 + cnchar 字
    keep = collect_dict_chars()
    keep.update(spell.keys())
    print('cnchar 拼音/笔画/笔顺:', len(spell), len(stroke), len(order))
    print('词库汉字:', len(keep))

    ids = load_ids()
    comps, fxs = parse_components(ids, keep)
    print('部件数据:', len(comps), '字形数据:', len(fxs))

    # 组装最终表
    final = {'py': {}, 'st': {}, 'od': {}, 'cp': {}, 'fx': {}}
    for ch in keep:
        if ch in spell:
            final['py'][ch] = spell[ch]
        if ch in stroke:
            final['st'][ch] = stroke[ch]
        if ch in order:
            final['od'][ch] = ','.join(alphabet[x]['name'] for x in order[ch])
        if ch in comps:
            final['cp'][ch] = ','.join(comps[ch])
        if ch in fxs:
            final['fx'][ch] = '|'.join(fxs[ch])

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(final, f, ensure_ascii=False, separators=(',', ':'))
    print(f'写出 {OUT}: {os.path.getsize(OUT)/1024/1024:.2f} MB, {len(final["py"])} 字')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--skip-download', action='store_true', help='使用已有缓存')
    ap.add_argument('--extra', action='store_true', help='同时构建成语/古诗附加词库')
    args = ap.parse_args()
    build()
    if args.extra:
        build_extra()
