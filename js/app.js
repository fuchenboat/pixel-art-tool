/* 像素画转换器 —— 纯前端实现，图片不离开浏览器 */
(function () {
  'use strict';

  var MAX_FILE_SIZE = 30 * 1024 * 1024;   // 30MB
  var BASE_MAX_DIM = 1600;                // 原图先缩到最长边 1600，保证性能
  var GRID_MAX_DIM = 1200;                // 像素网格最长边上限
  var GRID_MAX_PIXELS = 640000;           // 像素网格总像素上限
  var SAMPLE_LIMIT = 20000;               // 参与中位切分的最大采样像素数

  var el = {
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    uploadSection: document.getElementById('upload'),
    workspace: document.getElementById('workspace'),
    srcPreview: document.getElementById('srcPreview'),
    srcInfo: document.getElementById('srcInfo'),
    outCanvas: document.getElementById('outCanvas'),
    outInfo: document.getElementById('outInfo'),
    busy: document.getElementById('busy'),
    pixelSize: document.getElementById('pixelSize'),
    pixelSizeVal: document.getElementById('pixelSizeVal'),
    colorCount: document.getElementById('colorCount'),
    colorCountNum: document.getElementById('colorCountNum'),
    exportScale: document.getElementById('exportScale'),
    exportPng: document.getElementById('exportPng'),
    exportSvg: document.getElementById('exportSvg'),
    exportPalette: document.getElementById('exportPalette'),
    resetBtn: document.getElementById('resetBtn'),
    toast: document.getElementById('toast'),
    themeToggle: document.getElementById('themeToggle'),
    navLinks: Array.prototype.slice.call(document.querySelectorAll('.nav-link')),
    views: {
      home: document.getElementById('view-home'),
      about: document.getElementById('view-about')
    }
  };

  var THEME_KEY = 'pixeltool-theme';

  var state = {
    baseCanvas: null,   // 归一化后的原图画布
    baseW: 0,
    baseH: 0,
    fileName: 'pixelart',
    quantCanvas: null,  // 量化后的像素画小画布（1 像素 = 1 个方块）
    palette: null,      // 当前量化所用调色板（[r, g, b] 数组）
    gridW: 0,
    gridH: 0,
    token: 0
  };

  /* ------------------------- 工具函数 ------------------------- */

  function toast(msg, isError) {
    el.toast.textContent = msg;
    el.toast.className = 'toast' + (isError ? ' error' : '');
    el.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.hidden = true; }, 2400);
  }

  function syncFill(input) {
    var min = +input.min || 0, max = +input.max || 100;
    var p = ((+input.value - min) / (max - min)) * 100;
    input.style.setProperty('--fill', p + '%');
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ------------------------- 图片加载 ------------------------- */

  function handleFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast('请选择图片文件（JPG / PNG / GIF / WebP / BMP）', true);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast('文件超过 30MB，请压缩后再试', true);
      return;
    }

    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      initBase(img, file.name);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      toast('图片解码失败，请更换文件', true);
    };
    img.src = url;
  }

  function initBase(img, name) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) { toast('无法读取图片尺寸', true); return; }

    var scale = Math.min(1, BASE_MAX_DIM / Math.max(w, h));
    var bw = Math.max(1, Math.round(w * scale));
    var bh = Math.max(1, Math.round(h * scale));

    var c = document.createElement('canvas');
    c.width = bw;
    c.height = bh;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, bw, bh);

    state.baseCanvas = c;
    state.baseW = bw;
    state.baseH = bh;
    state.fileName = (name || 'pixelart').replace(/\.[^.]+$/, '') || 'pixelart';

    el.srcPreview.src = c.toDataURL('image/png');
    el.srcInfo.textContent = w + ' × ' + h + ' px';
    el.uploadSection.hidden = true;
    el.workspace.hidden = false;
    showView('home', false);   // 从任意视图上传后都回到首页工作区

    // 根据图片尺寸智能设置像素块默认值
    var suggested = Math.max(1, Math.round(Math.max(bw, bh) / 128));
    el.pixelSize.value = Math.min(64, Math.max(1, suggested));
    syncFill(el.pixelSize);
    updateLabels();

    render();
    el.workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ------------------------- 颜色量化（中位切分） ------------------------- */

  function makeBox(pixels) {
    var rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    var rs = 0, gs = 0, bs = 0, i, p;
    for (i = 0; i < pixels.length; i++) {
      p = pixels[i];
      if (p[0] < rmin) rmin = p[0];
      if (p[0] > rmax) rmax = p[0];
      if (p[1] < gmin) gmin = p[1];
      if (p[1] > gmax) gmax = p[1];
      if (p[2] < bmin) bmin = p[2];
      if (p[2] > bmax) bmax = p[2];
      rs += p[0]; gs += p[1]; bs += p[2];
    }
    var rr = rmax - rmin, gr = gmax - gmin, br = bmax - bmin;
    var channel = 0, range = rr;
    if (gr > range) { range = gr; channel = 1; }
    if (br > range) { range = br; channel = 2; }
    var n = pixels.length || 1;
    return {
      pixels: pixels,
      range: range,
      channel: channel,
      color: [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)]
    };
  }

  function buildPalette(pixels, maxColors) {
    if (!pixels.length) return [];
    var boxes = [makeBox(pixels)];
    while (boxes.length < maxColors) {
      var idx = -1, best = -1, i;
      for (i = 0; i < boxes.length; i++) {
        if (boxes[i].pixels.length < 2) continue;
        if (boxes[i].range > best) { best = boxes[i].range; idx = i; }
      }
      if (idx === -1 || best <= 0) break;   // 已无颜色可再分
      var box = boxes[idx];
      var ch = box.channel;
      box.pixels.sort(function (a, b) { return a[ch] - b[ch]; });
      var mid = box.pixels.length >> 1;
      boxes.splice(idx, 1, makeBox(box.pixels.slice(0, mid)), makeBox(box.pixels.slice(mid)));
    }
    // 不同盒子可能收敛到相同的平均色，按 RGB 去重，保证导出的色板每色唯一
    var seen = {};
    var unique = [];
    boxes.forEach(function (b) {
      var key = (b.color[0] << 16) | (b.color[1] << 8) | b.color[2];
      if (!seen[key]) { seen[key] = 1; unique.push(b.color); }
    });
    return unique;
  }

  // 5 位量化的最近色查找表，避免逐像素遍历调色板
  function makeMapper(palette) {
    var lut = new Int16Array(32768).fill(-1);
    var n = palette.length;
    return function (r, g, b) {
      var key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      var hit = lut[key];
      if (hit >= 0) return hit;
      var bestI = 0, bestD = Infinity;
      for (var i = 0; i < n; i++) {
        var p = palette[i];
        var dr = r - p[0], dg = g - p[1], db = b - p[2];
        var d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; bestI = i; }
      }
      lut[key] = bestI;
      return bestI;
    };
  }

  /* ------------------------- 渲染 ------------------------- */

  function computeGrid() {
    var size = Math.max(1, +el.pixelSize.value);
    var gw = Math.max(1, Math.round(state.baseW / size));
    var gh = Math.max(1, Math.round(state.baseH / size));

    var scale = 1;
    if (gw > GRID_MAX_DIM) scale = Math.min(scale, GRID_MAX_DIM / gw);
    if (gh > GRID_MAX_DIM) scale = Math.min(scale, GRID_MAX_DIM / gh);
    if (gw * gh * scale * scale > GRID_MAX_PIXELS) {
      scale = Math.min(scale, Math.sqrt(GRID_MAX_PIXELS / (gw * gh)));
    }
    if (scale < 1) {
      gw = Math.max(1, Math.round(gw * scale));
      gh = Math.max(1, Math.round(gh * scale));
    }
    return { w: gw, h: gh };
  }

  function render() {
    if (!state.baseCanvas) return;
    var my = ++state.token;

    var grid = computeGrid();
    var gw = grid.w, gh = grid.h;
    var maxColors = Math.max(2, +el.colorCount.value);

    // 1. 降采样到像素网格（开启平滑，取邻域平均值）
    var small = document.createElement('canvas');
    small.width = gw;
    small.height = gh;
    var sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(state.baseCanvas, 0, 0, gw, gh);

    var imgData = sctx.getImageData(0, 0, gw, gh);
    var data = imgData.data;
    var total = gw * gh;

    // 2. 采样像素用于构建调色板（跳过低透明度像素）
    var step = Math.max(1, Math.ceil(total / SAMPLE_LIMIT));
    var samples = [];
    for (var i = 0; i < total; i += step) {
      var o = i * 4;
      if (data[o + 3] < 128) continue;
      samples.push([data[o], data[o + 1], data[o + 2]]);
    }

    var palette = samples.length ? buildPalette(samples, maxColors) : [];
    state.palette = palette;
    var map = palette.length ? makeMapper(palette) : null;

    // 3. 回写量化结果
    if (map) {
      for (var j = 0; j < total; j++) {
        var k = j * 4;
        if (data[k + 3] < 128) { data[k + 3] = 0; continue; }
        var c = palette[map(data[k], data[k + 1], data[k + 2])];
        data[k] = c[0];
        data[k + 1] = c[1];
        data[k + 2] = c[2];
        data[k + 3] = 255;
      }
    }

    if (my !== state.token) return;   // 已有更新的渲染，丢弃本次结果

    sctx.putImageData(imgData, 0, 0);

    state.quantCanvas = small;
    state.gridW = gw;
    state.gridH = gh;

    // 4. 输出到展示画布（小尺寸 + CSS 像素化放大，保证清晰与性能）
    el.outCanvas.width = gw;
    el.outCanvas.height = gh;
    var octx = el.outCanvas.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.clearRect(0, 0, gw, gh);
    octx.drawImage(small, 0, 0);

    el.outInfo.textContent = gw + ' × ' + gh + ' 方块 · ' + (palette.length || 0) + ' 色';
  }

  /* ------------------------- 导出 ------------------------- */

  function exportPNG() {
    if (!state.quantCanvas) return;
    var scale = Math.max(1, parseInt(el.exportScale.value, 10) || 1);
    var gw = state.gridW, gh = state.gridH;

    var c = document.createElement('canvas');
    c.width = gw * scale;
    c.height = gh * scale;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.quantCanvas, 0, 0, c.width, c.height);

    el.exportPng.disabled = true;
    c.toBlob(function (blob) {
      el.exportPng.disabled = false;
      if (!blob) { toast('PNG 导出失败', true); return; }
      download(blob, state.fileName + '_pixel_' + gw + 'x' + gh + '_' + scale + 'x.png');
      toast('PNG 已导出（' + c.width + ' × ' + c.height + '）');
    }, 'image/png');
  }

  function exportSVG() {
    if (!state.quantCanvas) return;
    var scale = Math.max(1, parseInt(el.exportScale.value, 10) || 1);
    var gw = state.gridW, gh = state.gridH;

    var ctx = state.quantCanvas.getContext('2d');
    var data = ctx.getImageData(0, 0, gw, gh).data;

    var parts = [];
    // 按行做同色横向合并，减少节点数量
    for (var y = 0; y < gh; y++) {
      var x = 0;
      while (x < gw) {
        var o = (y * gw + x) * 4;
        if (data[o + 3] === 0) { x++; continue; }
        var hex = '#' + toHex(data[o]) + toHex(data[o + 1]) + toHex(data[o + 2]);
        var run = 1;
        while (x + run < gw) {
          var o2 = (y * gw + x + run) * 4;
          if (data[o2 + 3] === 0) break;
          if (data[o2] !== data[o] || data[o2 + 1] !== data[o + 1] || data[o2 + 2] !== data[o + 2]) break;
          run++;
        }
        parts.push('<rect x="' + x + '" y="' + y + '" width="' + run + '" height="1" fill="' + hex + '"/>');
        x += run;
      }
    }

    var svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + (gw * scale) + '" height="' + (gh * scale) +
      '" viewBox="0 0 ' + gw + ' ' + gh + '" shape-rendering="crispEdges">\n' +
      parts.join('\n') + '\n</svg>\n';

    download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      state.fileName + '_pixel_' + gw + 'x' + gh + '.svg');
    toast('SVG 已导出（' + parts.length + ' 个色块）');
  }

  function toHex(v) {
    var s = v.toString(16);
    return s.length === 1 ? '0' + s : s;
  }

  // 导出 GIMP 调色板（.gpl）：纯文本格式，Aseprite / GIMP / Lospec 均可直接载入
  function exportPalette() {
    var palette = state.palette;
    if (!palette || !palette.length) return;

    var lines = ['GIMP Palette', 'Name: ' + state.fileName + '_palette', 'Columns: 16', '#'];
    palette.forEach(function (c) {
      var r = ('   ' + c[0]).slice(-3);
      var g = ('   ' + c[1]).slice(-3);
      var b = ('   ' + c[2]).slice(-3);
      lines.push(r + ' ' + g + ' ' + b + '\t#' + toHex(c[0]) + toHex(c[1]) + toHex(c[2]));
    });

    download(new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8' }),
      state.fileName + '_palette_' + palette.length + 'c.gpl');
    toast('调色板已导出（' + palette.length + ' 色 .gpl，可在 Aseprite 中载入）');
  }

  /* ------------------------- 视图与主题 ------------------------- */

  function showView(name, scroll) {
    if (!el.views[name]) return;
    Object.keys(el.views).forEach(function (k) {
      el.views[k].hidden = (k !== name);
    });
    el.navLinks.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.view === name);
    });
    if (scroll !== false) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 隐私模式下忽略 */ }
  }

  /* ------------------------- 交互绑定 ------------------------- */

  var rafId = 0;
  function scheduleRender() {
    el.busy.hidden = false;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(function () {
      render();
      el.busy.hidden = true;
    });
  }

  function updateLabels() {
    el.pixelSizeVal.textContent = el.pixelSize.value;
    if (el.colorCountNum.value !== el.colorCount.value) {
      el.colorCountNum.value = el.colorCount.value;
    }
    syncFill(el.pixelSize);
    syncFill(el.colorCount);
  }

  // 输入框 → 滑块：只有合法数值才实时生效，避免输入过程被打断
  function previewColorCount() {
    var n = parseInt(el.colorCountNum.value, 10);
    if (isNaN(n) || n < 2 || n > 256) return;
    if (+el.colorCount.value === n) return;
    el.colorCount.value = n;
    syncFill(el.colorCount);
    scheduleRender();
  }

  // 回车 / 失焦：非法或越界输入回落到 2–256
  function commitColorCount() {
    var n = parseInt(el.colorCountNum.value, 10);
    if (isNaN(n)) n = +el.colorCount.value;
    n = Math.min(256, Math.max(2, n));
    el.colorCountNum.value = n;
    if (el.colorCount.value !== String(n)) {
      el.colorCount.value = n;
      syncFill(el.colorCount);
      scheduleRender();
    }
  }

  el.dropZone.addEventListener('click', function () { el.fileInput.click(); });
  el.dropZone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
  });
  el.fileInput.addEventListener('change', function () {
    if (this.files && this.files[0]) handleFile(this.files[0]);
    this.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    el.dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      el.dropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    el.dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      el.dropZone.classList.remove('dragover');
    });
  });
  el.dropZone.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  // 整页拖拽 + 粘贴
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  window.addEventListener('paste', function (e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image') === 0) {
        handleFile(items[i].getAsFile());
        break;
      }
    }
  });

  el.pixelSize.addEventListener('input', function () { updateLabels(); scheduleRender(); });
  el.colorCount.addEventListener('input', function () { updateLabels(); scheduleRender(); });
  el.colorCountNum.addEventListener('input', previewColorCount);
  el.colorCountNum.addEventListener('change', commitColorCount);

  el.exportPng.addEventListener('click', exportPNG);
  el.exportSvg.addEventListener('click', exportSVG);
  el.exportPalette.addEventListener('click', exportPalette);
  el.resetBtn.addEventListener('click', function () {
    state.baseCanvas = null;
    state.quantCanvas = null;
    state.palette = null;
    el.srcPreview.removeAttribute('src');
    el.workspace.hidden = true;
    el.uploadSection.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  el.navLinks.forEach(function (btn) {
    btn.addEventListener('click', function () { showView(btn.dataset.view); });
  });

  el.themeToggle.addEventListener('click', function () {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
  });

  updateLabels();
})();
