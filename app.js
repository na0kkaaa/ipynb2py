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
    // File extension check
    if (!file || !/\.ipynb$/i.test(file.name)) {
      throw new Error('Please select a file with .ipynb extension');
    }

    setStatus('Loading…');
    const text = await file.text();

    // JSON parse
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error('File may be corrupted');
    }

    // Notebook format check
    if (!json.cells || !Array.isArray(json.cells)) {
      throw new Error('Not a valid Notebook format (cells array not found)');
    }

    // Update state
    state.file = file;
    state.nb = json;
    state.codeCells = json.cells.filter(c => c.cell_type === 'code').length;

    // Update metadata display
    updateFileMetadata(file, json);

    // Enable convert button
    btnConvert.disabled = state.codeCells === 0;
    setStatus(
      state.codeCells > 0
        ? 'Ready. You can convert now.'
        : 'No code cells found.'
    );
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Failed to load file', 'err');
    btnConvert.disabled = true;
  }
}

// ===== Event Listeners =====

// Drag & drop events
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

// Dropzone click event
dropzone.addEventListener('click', (e) => {
  // Ignore clicks on buttons or labels
  if (e.target === fileInput || e.target.closest('label') || e.target.closest('button')) {
    return;
  }
  fileInput.click();
});

// File selection event
fileInput.addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) handleFile(f);
  fileInput.value = ''; // Reset to allow reselecting the same file
});

// Convert button event
btnConvert.addEventListener('click', async () => {
  if (!state.file || !state.nb) return;

  try {
    setStatus('Converting…');

    // Get options
    const opts = {
      magics: $('#optMagics').checked,
      inTags: $('#optInTags').checked,
    };

    // Execute conversion
    const py = ipynbToPy({
      nb: state.nb,
      filename: state.file.name,
      opts
    });

    // Get conversion mode
    const mode = document.querySelector('input[name="convertMode"]:checked').value;

    if (mode === 'download') {
      // Download
      const outName = state.file.name.replace(/\.ipynb$/i, '.py');
      download(outName, py);
      $('#metaLines').textContent = (py.split('\n').length).toLocaleString();

      // Temporarily change button text
      const originalText = btnConvert.textContent;
      btnConvert.textContent = '✓ Download Complete!';
      btnConvert.style.backgroundColor = '#10b981';
      btnConvert.style.color = '#ffffff';
      btnConvert.style.borderColor = '#10b981';

      setStatus('Complete. Download started.', 'ok');

      // Restore after 2 seconds
      setTimeout(() => {
        btnConvert.textContent = originalText;
        btnConvert.style.backgroundColor = '';
        btnConvert.style.color = '';
        btnConvert.style.borderColor = '';
      }, 2000);
    } else {
      // Copy to clipboard
      await navigator.clipboard.writeText(py);
      $('#metaLines').textContent = (py.split('\n').length).toLocaleString();

      // Temporarily change button text
      const originalText = btnConvert.textContent;
      btnConvert.textContent = '✓ Copied!';
      btnConvert.style.backgroundColor = '#10b981';
      btnConvert.style.color = '#ffffff';
      btnConvert.style.borderColor = '#10b981';

      setStatus('Complete. Copied to clipboard.', 'ok');

      // Restore after 2 seconds
      setTimeout(() => {
        btnConvert.textContent = originalText;
        btnConvert.style.backgroundColor = '';
        btnConvert.style.color = '';
        btnConvert.style.borderColor = '';
      }, 2000);
    }
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Conversion failed', 'err');
  }
});

// ===== Initialization =====
// AdSense manual unit render (optional)
try {
  (adsbygoogle = window.adsbygoogle || []).push({});
} catch (e) {
  /* ignore in dev */
}

test1-3

// Initial display
setStatus('Please select a file');
