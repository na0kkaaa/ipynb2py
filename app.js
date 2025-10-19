// ===== Utility Functions =====
const $ = (sel) => document.querySelector(sel);

const fmtBytes = (n) => {
  if (!Number.isFinite(n)) return "—";
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed((i === 0) ? 0 : 1)} ${units[i]}`;
};

const download = (filename, text) => {
  const blob = new Blob([text], { type: 'text/x-python;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
};

// ===== Core Converter =====
function ipynbToPy({ nb, filename, opts }) {
  const cells = Array.isArray(nb.cells) ? nb.cells : [];
  const lines = [];

  // ヘッダーコメント追加
  if (opts.header) {
    lines.push(
      '#!/usr/bin/env python3',
      '# coding: utf-8',
      `# Converted from: ${filename}`,
      `# Generated at  : ${new Date().toLocaleString()}`,
    );
  }

  // セルを順次変換
  let idx = 1;
  for (const cell of cells) {
    // マークダウンセルをコメントアウト形式で変換
    if (cell.cell_type === 'markdown') {
      const src = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
      const mdLines = src.replace(/\r\n/g, '\n').split('\n');

      lines.push('');
      for (const line of mdLines) {
        lines.push(`# ${line}`);
      }
      continue;
    }

    // コードセルの処理
    if (cell.cell_type !== 'code') continue;

    // セル見出しの挿入
    if (opts.inTags) {
      lines.push('', `# In[${idx}]:`);
    }

    // セルのソースコード取得
    const src = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    let body = src.replace(/\r\n/g, '\n');

    // マジックコマンドのコメントアウト
    if (opts.magics) {
      // 行頭の %, %%, ! をコメントアウト（インデント維持）
      body = body.replace(/^(\s*)(%{1,2}|!)/gm, (m, g1) => `${g1}# ${m.trimStart()}`);
    }

    lines.push(body);
    idx += 1;
  }

  return lines.join('\n');
}

// ===== Application State =====
const state = {
  file: null,
  nb: null,
  codeCells: 0
};

// ===== DOM Elements =====
const dropzone = $('#dropzone');
const fileInput = $('#fileInput');
const btnConvert = $('#btnConvert');
const statusEl = $('#status');

// ===== UI Helper Functions =====
const setStatus = (msg, cls = '') => {
  statusEl.className = `status ${cls}`;
  statusEl.textContent = msg;
};

const updateFileMetadata = (file, json) => {
  $('#metaName').textContent = file.name;
  $('#metaSize').textContent = fmtBytes(file.size);
  $('#metaCells').textContent = json.cells.length;
  $('#metaCodeCells').textContent = state.codeCells;
  $('#metaLines').textContent = '—';
};

// ===== File Handling =====
async function handleFile(file) {
  try {
    // ファイル拡張子チェック
    if (!file || !/\.ipynb$/i.test(file.name)) {
      throw new Error('拡張子が .ipynb のファイルを選択してください');
    }

    setStatus('読み込み中…');
    const text = await file.text();

    // JSON パース
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error('JSON を解釈できません（壊れた .ipynb の可能性）');
    }

    // Notebook 形式チェック
    if (!json.cells || !Array.isArray(json.cells)) {
      throw new Error('Notebook 形式ではありません（cells 配列が見つかりません）');
    }

    // 状態更新
    state.file = file;
    state.nb = json;
    state.codeCells = json.cells.filter(c => c.cell_type === 'code').length;

    // メタデータ表示更新
    updateFileMetadata(file, json);

    // 変換ボタンの有効化
    btnConvert.disabled = state.codeCells === 0;
    setStatus(
      state.codeCells > 0
        ? '準備できました。変換を実行できます。'
        : 'コードセルがありません。'
    );
  } catch (err) {
    console.error(err);
    setStatus(err.message || '読み込みに失敗しました', 'err');
    btnConvert.disabled = true;
  }
}

// ===== Event Listeners =====

// ドラッグ&ドロップイベント
['dragenter', 'dragover'].forEach(ev => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach(ev => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
  });
});

dropzone.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files?.[0];
  if (f) handleFile(f);
});

// Dropzone クリックイベント
dropzone.addEventListener('click', (e) => {
  // ボタンやラベル内のクリックは無視
  if (e.target === fileInput || e.target.closest('label') || e.target.closest('button')) {
    return;
  }
  fileInput.click();
});

// ファイル選択イベント
fileInput.addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) handleFile(f);
  fileInput.value = ''; // リセットして同じファイルを再選択可能に
});

// 変換ボタンイベント
btnConvert.addEventListener('click', async () => {
  if (!state.file || !state.nb) return;

  try {
    setStatus('変換中…');

    // オプション取得
    const opts = {
      magics: $('#optMagics').checked,
      header: $('#optHeader').checked,
      inTags: $('#optInTags').checked,
    };

    // 変換実行
    const py = ipynbToPy({
      nb: state.nb,
      filename: state.file.name,
      opts
    });

    // ダウンロード
    const outName = state.file.name.replace(/\.ipynb$/i, '.py');
    download(outName, py);

    // 出力行数更新
    $('#metaLines').textContent = (py.split('\n').length).toLocaleString();
    setStatus('完了しました。ダウンロードを開始しました。', 'ok');
  } catch (err) {
    console.error(err);
    setStatus(err.message || '変換に失敗しました', 'err');
  }
});

// ===== Initialization =====
// AdSense manual unit render（任意）
try {
  (adsbygoogle = window.adsbygoogle || []).push({});
} catch (e) {
  /* ignore in dev */
}

// 初期表示
setStatus('ファイルを選択してください');
