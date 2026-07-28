(function() {
  'use strict';

  if (window.__savageActive) return;
  window.__savageActive = true;

  // State
  let tool = window.__savageInitialTool === 'rect' ? 'rect' : 'line';
  let isDrawing = false;
  let isEditing = false;
  let isRotating = false;
  let startPoint = null;
  let lastMousePos = null;
  let shapes = [];
  let currentShape = null;
  let svg = null;
  let blockOverlay = null;
  let rectState = 0;
  let outerRect = null;
  let innerRect = null;
  let rafId = null;

  // Edit state
  let selectedShape = null;
  let editHandle = null;
  let hoverHandle = null;
  let hoverShape = null;
  const HANDLE_SIZE = 10;
  const EDGE_THRESHOLD = 8;
  const SELECTION_COLOR = '#e43a48';
  const ROTATION_SNAP = 5;
  const MIN_DRAG_DIST = 5;

  function init() {
    createBlockOverlay();
    createSVG();
    createToolbar();
    selectTool(tool);
    createInfoPanel();
    setupEvents();
    document.body.classList.add('savage-active');
    updateInfo();
  }

  function createBlockOverlay() {
    if (document.getElementById('savage-block')) return;
    blockOverlay = document.createElement('div');
    blockOverlay.id = 'savage-block';
    blockOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:transparent;z-index:2147483645;cursor:crosshair;touch-action:none;';
    document.body.appendChild(blockOverlay);
  }

  function createSVG() {
    if (document.getElementById('savage-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'savage-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;overflow:hidden;';

    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.cssText = 'width:100%;height:100%;display:block;';

    // Add glow filter for bright line effect
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'sv-glow');
    filter.setAttribute('x', '-50%');
    filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%');
    filter.setAttribute('height', '200%');
    filter.innerHTML = `
      <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    `;
    defs.appendChild(filter);
    svg.appendChild(defs);

    updateSVGViewBox();

    overlay.appendChild(svg);
    document.body.appendChild(overlay);
  }

  function updateSVGViewBox() {
    if (svg) {
      svg.setAttribute('viewBox', '0 0 ' + window.innerWidth + ' ' + window.innerHeight);
    }
  }

  function createToolbar() {
    if (document.getElementById('savage-toolbar')) return;
    const toolbar = document.createElement('div');
    toolbar.id = 'savage-toolbar';
    toolbar.innerHTML = `
      <div class="sv-toolbar-inner">
        <div class="sv-brand" title="Savage Measurement">
          <svg class="sv-logo" viewBox="0 0 64 64" aria-hidden="true">
            <rect class="sv-logo-bg" x="4" y="4" width="56" height="56" rx="12" />
            <path class="sv-logo-ruler" d="M12 52 H52 M12 52 V43 M52 52 V43 M17 52 V47 M23 52 V44 M29 52 V47 M35 52 V44 M41 52 V47 M47 52 V44" />
            <path class="sv-logo-bracket" d="M12 16 H23 M52 16 H41" />
            <path class="sv-logo-a" d="M20 46 L32 14 L44 46 M26 33 H38" />
            <path class="sv-logo-scan" d="M18 9 H46" />
          </svg>
        </div>
        <div class="sv-notice" id="sv-notice-text">Draw and measure with precision</div>
        <div class="sv-tools">
          <button class="sv-tool active" data-tool="line" title="Line Tool — Draw multi-segment measurement lines (Alt+1)">
            <span class="sv-tool-icon">📏</span>
            <span class="sv-tool-label">Line</span>
          </button>
          <button class="sv-tool" data-tool="rect" title="Rectangle Tool — Measure area percentages (Alt+2)">
            <span class="sv-tool-icon">▭</span>
            <span class="sv-tool-label">Rect</span>
          </button>
          <div class="sv-divider"></div>
          <button class="sv-tool sv-tool-danger" data-tool="clear" title="Clear All Shapes (Delete)">
            <span class="sv-tool-icon">🗑️</span>
            <span class="sv-tool-label">Clear</span>
          </button>
        </div>
        <div class="sv-shortcuts-hint">
          <kbd>Alt+A</kbd> Toggle · <kbd>1</kbd> Line · <kbd>2</kbd> Rect · <kbd>Esc</kbd> Close · <kbd>Del</kbd> Remove
        </div>
      </div>
    `;
    document.body.appendChild(toolbar);

    toolbar.querySelectorAll('.sv-tool').forEach(btn => {
      btn.addEventListener('click', handleToolClick);
    });
  }

  function updateNotice(text) {
    const notice = document.getElementById('sv-notice-text');
    if (notice) {
      notice.style.opacity = '0';
      setTimeout(() => {
        notice.textContent = text;
        notice.style.opacity = '1';
      }, 150);
    }
  }

  function handleToolClick(e) {
    const selected = e.currentTarget.dataset.tool;
    if (selected === 'clear') {
      clearAll();
      return;
    }
    selectTool(selected);
  }

  function selectTool(selected) {
    if (!['line', 'rect'].includes(selected)) return;
    
    document.querySelectorAll('.sv-tool').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === selected);
    });
    
    tool = selected;
    selectedShape = null;
    editHandle = null;
    resetDrawing();
    redrawAll();
    updateInfo();
    updateNotice(getToolNotice());
    chrome.runtime?.sendMessage?.({ type: 'savage_tool_changed', tool: selected });
  }

  function getToolNotice() {
    if (tool === 'line') return 'Drag to draw lines · Click to select · Drag side handle to rotate';
    if (tool === 'rect') {
      if (rectState === 0) return 'Draw the OUTER rectangle first';
      if (rectState === 1) return 'Now draw the INNER rectangle inside the first one';
      if (rectState === 2) return 'Max 2 rectangles reached · Click Clear to restart';
    }
    return 'Draw and measure with precision';
  }

  function clearAll() {
    shapes = [];
    rectState = 0;
    outerRect = null;
    innerRect = null;
    selectedShape = null;
    editHandle = null;
    redrawAll();
    updateInfo();
    updateNotice('All shapes cleared');
    setTimeout(() => updateNotice(getToolNotice()), 1500);
  }

  function resetDrawing() {
    isDrawing = false;
    isEditing = false;
    isRotating = false;
    startPoint = null;
    currentShape = null;
  }

  function createInfoPanel() {
    if (document.getElementById('savage-info')) return;
    const info = document.createElement('div');
    info.id = 'savage-info';
    info.innerHTML = `
      <div class="sv-info-box" id="sv-info-box">
        <div class="sv-info-placeholder">Ready to measure</div>
      </div>
      <div class="sv-credit">Restricted by Alamin</div>
    `;
    document.body.appendChild(info);
  }

  function updateInfo() {
    const box = document.getElementById('sv-info-box');
    if (!box) return;

    let html = '';
    
    // Rectangle info
    if (rectState >= 1 && outerRect) {
      html += `<div class="sv-info-row"><span class="sv-info-label">Outer Area</span><span class="sv-info-value">${formatNumber(outerRect.area)} px²</span></div>`;
    }
    if (rectState >= 2 && innerRect) {
      html += `<div class="sv-info-row"><span class="sv-info-label">Inner Area</span><span class="sv-info-value">${formatNumber(innerRect.area)} px²</span></div>`;
      const pct = ((innerRect.area / outerRect.area) * 100).toFixed(1);
      html += `<div class="sv-info-row sv-info-highlight"><span class="sv-info-label">Percentage</span><span class="sv-info-value">${pct}%</span></div>`;
    }

    // Selected shape info
    if (selectedShape) {
      html += '<div class="sv-info-divider"></div>';
      if (selectedShape.type === 'line') {
        const angle = Math.round(((selectedShape.angle || 0) * 180 / Math.PI) % 360);
        const normalizedAngle = angle < 0 ? angle + 360 : angle;
        const bounds = getLineBounds(selectedShape);
        html += `<div class="sv-info-row"><span class="sv-info-label">Angle</span><span class="sv-info-value">${normalizedAngle}°</span></div>`;
        html += `<div class="sv-info-row"><span class="sv-info-label">Width</span><span class="sv-info-value">${formatNumber(bounds.width)} px</span></div>`;
        html += `<div class="sv-info-row"><span class="sv-info-label">Height</span><span class="sv-info-value">${formatNumber(bounds.height)} px</span></div>`;
        html += '<div class="sv-info-hint">🖱 Drag side dot to rotate · Drag ends to resize · Drag center to move</div>';
      } else {
        html += `<div class="sv-info-row"><span class="sv-info-label">Width</span><span class="sv-info-value">${formatNumber(selectedShape.width)} px</span></div>`;
        html += `<div class="sv-info-row"><span class="sv-info-label">Height</span><span class="sv-info-value">${formatNumber(selectedShape.height)} px</span></div>`;
        html += `<div class="sv-info-row"><span class="sv-info-label">Area</span><span class="sv-info-value">${formatNumber(selectedShape.area)} px²</span></div>`;
        html += '<div class="sv-info-hint">🖱 Drag handles to resize · Drag center to move</div>';
      }
    } else if (tool === 'rect') {
      if (rectState === 0) {
        html = '<div class="sv-info-placeholder">Click and drag to draw the outer rectangle</div>';
      } else if (rectState === 1) {
        html = '<div class="sv-info-placeholder">Draw the inner rectangle inside the first one</div>';
      } else if (rectState === 2) {
        html += '<div class="sv-info-hint">Maximum reached. Click 🗑️ Clear to start over.</div>';
      }
    } else if (tool === 'line' && shapes.length === 0) {
      html = '<div class="sv-info-placeholder">Click and drag to draw measurement lines</div>';
    } else if (tool === 'line') {
      html = '<div class="sv-info-hint">Click a line to select · Drag to draw more</div>';
    }

    box.innerHTML = html || '<div class="sv-info-placeholder">Click shapes to edit and measure</div>';
  }

  function formatNumber(n) {
    if (!n || isNaN(n)) return '0';
    return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n).toString();
  }

  // ===== EVENT HANDLING =====

  function setupEvents() {
    blockOverlay.addEventListener('mousedown', onMouseDown, { passive: false });
    blockOverlay.addEventListener('mousemove', onMouseMove, { passive: true });
    blockOverlay.addEventListener('mouseup', onMouseUp, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize, { passive: true });
    
    // Click outside to deselect
    document.addEventListener('click', onDocumentClick);
  }

  function onDocumentClick(e) {
    if (!e.target.closest('#savage-toolbar') && !e.target.closest('#savage-info') && 
        !e.target.closest('#savage-block') && selectedShape && !isDrawing && !isEditing && !isRotating) {
      selectedShape = null;
      editHandle = null;
      redrawAll();
      updateInfo();
    }
  }

  function onResize() {
    updateSVGViewBox();
    redrawAll();
  }

  function getMousePos(e) {
    return { x: e.clientX, y: e.clientY };
  }

  function onMouseDown(e) {
    if (e.target.closest('#savage-toolbar') || e.target.closest('#savage-info')) return;
    e.preventDefault();

    const pos = getMousePos(e);

    // === RECT TOOL: Drawing sequence logic ===
    if (tool === 'rect') {
      if (rectState === 1) {
        const clickedHandle = findHandleAt(pos);
        if (clickedHandle && clickedHandle.shape !== outerRect) {
          isEditing = true;
          selectedShape = clickedHandle.shape;
          editHandle = clickedHandle.handle;
          startPoint = pos;
          redrawAll();
          updateInfo();
          return;
        }
        isDrawing = true;
        startPoint = pos;
        currentShape = { type: 'rect', start: { ...pos }, end: { ...pos } };
        selectedShape = null;
        redrawAll();
        return;
      }

      if (rectState === 0) {
        isDrawing = true;
        startPoint = pos;
        currentShape = { type: 'rect', start: { ...pos }, end: { ...pos } };
        selectedShape = null;
        return;
      }
    }

    // === Check for handle click (edit/rotate) ===
    const clickedHandle = findHandleAt(pos);
    if (clickedHandle) {
      if (clickedHandle.handle === 'rotate') {
        isRotating = true;
        selectedShape = clickedHandle.shape;
        editHandle = 'rotate';
        startPoint = pos;
        const center = getLineCenter(selectedShape);
        selectedShape._rotateStartAngle = Math.atan2(pos.y - center.y, pos.x - center.x);
        selectedShape._initialAngle = selectedShape.angle || 0;
      } else {
        isEditing = true;
        selectedShape = clickedHandle.shape;
        editHandle = clickedHandle.handle;
        startPoint = pos;
      }
      redrawAll();
      updateInfo();
      return;
    }

    // === Check for shape click (select) ===
    const clickedShape = findShapeAt(pos);
    if (clickedShape) {
      selectedShape = clickedShape;
      redrawAll();
      updateInfo();
      return;
    }

    // === Click on empty space - deselect and start drawing ===
    selectedShape = null;
    editHandle = null;
    redrawAll();

    if (tool === 'rect' && rectState >= 2) return;

    isDrawing = true;
    startPoint = pos;
    currentShape = { type: tool, start: { ...pos }, end: { ...pos }, angle: 0 };
  }

  function onMouseMove(e) {
    const pos = getMousePos(e);
    lastMousePos = pos;

    updateCursor(pos);
    updateHoverState(pos);

    if (isRotating && selectedShape && selectedShape.type === 'line') {
      const center = getLineCenter(selectedShape);
      const currentAngle = Math.atan2(pos.y - center.y, pos.x - center.x);
      const deltaAngle = currentAngle - selectedShape._rotateStartAngle;
      let newAngle = (selectedShape._initialAngle + deltaAngle) * (180 / Math.PI);
      newAngle = Math.round(newAngle / ROTATION_SNAP) * ROTATION_SNAP;
      selectedShape.angle = newAngle * (Math.PI / 180);
      
      scheduleRedraw();
      return;
    }

    if (isEditing && selectedShape && editHandle) {
      resizeShape(selectedShape, editHandle, pos);
      scheduleRedraw();
      return;
    }

    if (!isDrawing || !currentShape) return;
    currentShape.end = pos;
    scheduleRedraw();
  }

  function scheduleRedraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      redrawAll();
      if (isDrawing && currentShape) drawPreview();
    });
  }

  function onMouseUp(e) {
    if (isRotating) {
      isRotating = false;
      if (selectedShape) {
        delete selectedShape._rotateStartAngle;
        delete selectedShape._initialAngle;
      }
      startPoint = null;
      recalculateAreas();
      updateInfo();
      return;
    }

    if (isEditing) {
      isEditing = false;
      startPoint = null;
      recalculateAreas();
      updateInfo();
      return;
    }

    if (!isDrawing || !startPoint) return;
    isDrawing = false;

    const endPt = getMousePos(e);
    const dist = Math.hypot(endPt.x - startPoint.x, endPt.y - startPoint.y);

    if (tool === 'line' && dist > MIN_DRAG_DIST) {
      shapes.push({ 
        type: 'line', 
        start: { ...startPoint }, 
        end: { ...endPt },
        angle: 0
      });
      updateNotice('Line created! Click to select and rotate');
      setTimeout(() => updateNotice(getToolNotice()), 2000);
    } else if (tool === 'rect' && dist > 20) {
      handleRectDraw(startPoint, endPt);
      if (rectState === 1) updateNotice('Outer rectangle created! Now draw the inner one');
      else if (rectState === 2) updateNotice('Measurement complete! Area percentage calculated');
      setTimeout(() => updateNotice(getToolNotice()), 2500);
    }

    currentShape = null;
    startPoint = null;
    redrawAll();
    updateInfo();
  }

  // ===== HOVER STATE =====

  function updateHoverState(pos) {
    const newHoverHandle = findHandleAt(pos);
    const newHoverShape = !newHoverHandle ? findShapeAt(pos) : null;
    
    if (newHoverHandle?.shape !== hoverHandle?.shape || newHoverHandle?.handle !== hoverHandle?.handle ||
        newHoverShape !== hoverShape) {
      hoverHandle = newHoverHandle;
      hoverShape = newHoverShape;
      scheduleRedraw();
    }
  }

  // ===== EDIT / RESIZE / ROTATE LOGIC =====

  function getLineCenter(shape) {
    const x1 = Math.min(shape.start.x, shape.end.x);
    const x2 = Math.max(shape.start.x, shape.end.x);
    const y1 = Math.min(shape.start.y, shape.end.y);
    const y2 = Math.max(shape.start.y, shape.end.y);
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }

  function getLineBounds(shape) {
    const x1 = Math.min(shape.start.x, shape.end.x);
    const x2 = Math.max(shape.start.x, shape.end.x);
    const y1 = Math.min(shape.start.y, shape.end.y);
    const y2 = Math.max(shape.start.y, shape.end.y);
    return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
  }

  function rotatePoint(point, center, angleRad) {
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos
    };
  }

  function getRotatedLines(shape) {
    const bounds = getLineBounds(shape);
    const angle = shape.angle || 0;
    const center = { x: bounds.cx, y: bounds.cy };
    const ratios = [0, 1/3, 1/2, 2/3, 1];
    
    return ratios.map(r => {
      const localY = bounds.y1 + bounds.height * r;
      const p1 = rotatePoint({ x: bounds.x1, y: localY }, center, angle);
      const p2 = rotatePoint({ x: bounds.x2, y: localY }, center, angle);
      return {
        x1: p1.x, y1: p1.y,
        x2: p2.x, y2: p2.y,
        label: r === 0 ? '' : r === 1/3 ? '⅓' : r === 1/2 ? '½' : r === 2/3 ? '⅔' : ''
      };
    });
  }

  function findHandleAt(pos) {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i];

      if (shape.type === 'line') {
        const lines = shape.angle ? getRotatedLines(shape) : getHorizontalLines(shape);
        const bounds = getLineBounds(shape);
        const center = { x: bounds.cx, y: bounds.cy };
        const angle = shape.angle || 0;
        
        // Rotation handle
        const midLine = lines[2];
        const midPoint = { x: (midLine.x1 + midLine.x2) / 2, y: (midLine.y1 + midLine.y2) / 2 };
        const perpAngle = angle + Math.PI / 2;
        const rotHandleDist = 30;
        const rotHandle = {
          x: midPoint.x + Math.cos(perpAngle) * rotHandleDist,
          y: midPoint.y + Math.sin(perpAngle) * rotHandleDist
        };
        
        if (dist(pos, rotHandle) < HANDLE_SIZE + 4) {
          return { shape, handle: 'rotate' };
        }

        // Start and end handles
        if (dist(pos, { x: lines[0].x1, y: lines[0].y1 }) < HANDLE_SIZE) {
          return { shape, handle: 'start' };
        }
        if (dist(pos, { x: lines[4].x2, y: lines[4].y2 }) < HANDLE_SIZE) {
          return { shape, handle: 'end' };
        }
        
        // Move handle (center)
        if (dist(pos, center) < HANDLE_SIZE + 2) {
          return { shape, handle: 'move' };
        }
      } else if (shape.type === 'rect') {
        const corners = [
          { x: shape.x, y: shape.y },
          { x: shape.x + shape.width, y: shape.y },
          { x: shape.x + shape.width, y: shape.y + shape.height },
          { x: shape.x, y: shape.y + shape.height }
        ];

        for (let c = 0; c < corners.length; c++) {
          if (dist(pos, corners[c]) < HANDLE_SIZE) {
            return { shape, handle: 'corner-' + c };
          }
        }

        if (Math.abs(pos.y - shape.y) < EDGE_THRESHOLD && pos.x > shape.x && pos.x < shape.x + shape.width) {
          return { shape, handle: 'edge-top' };
        }
        if (Math.abs(pos.y - (shape.y + shape.height)) < EDGE_THRESHOLD && pos.x > shape.x && pos.x < shape.x + shape.width) {
          return { shape, handle: 'edge-bottom' };
        }
        if (Math.abs(pos.x - shape.x) < EDGE_THRESHOLD && pos.y > shape.y && pos.y < shape.y + shape.height) {
          return { shape, handle: 'edge-left' };
        }
        if (Math.abs(pos.x - (shape.x + shape.width)) < EDGE_THRESHOLD && pos.y > shape.y && pos.y < shape.y + shape.height) {
          return { shape, handle: 'edge-right' };
        }

        if (rectState !== 1 && 
            pos.x >= shape.x && pos.x <= shape.x + shape.width &&
            pos.y >= shape.y && pos.y <= shape.y + shape.height) {
          return { shape, handle: 'move' };
        }
      }
    }
    return null;
  }

  function findShapeAt(pos) {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i];

      if (tool === 'rect' && rectState === 1 && shape === outerRect) {
        continue;
      }

      if (shape.type === 'line') {
        const lines = shape.angle ? getRotatedLines(shape) : getHorizontalLines(shape);
        for (let line of lines) {
          if (pointToLineDistance(pos, { x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }) < 10) {
            return shape;
          }
        }
      } else if (shape.type === 'rect') {
        if (pos.x >= shape.x - 5 && pos.x <= shape.x + shape.width + 5 &&
            pos.y >= shape.y - 5 && pos.y <= shape.y + shape.height + 5) {
          return shape;
        }
      }
    }
    return null;
  }

  function resizeShape(shape, handle, pos) {
    if (shape.type === 'line') {
      if (handle === 'start') {
        const dx = pos.x - shape.start.x;
        const dy = pos.y - shape.start.y;
        shape.start.x = pos.x;
        shape.start.y = pos.y;
        shape.end.x += dx;
        shape.end.y += dy;
      } else if (handle === 'end') {
        shape.end.x = pos.x;
        shape.end.y = pos.y;
      } else if (handle === 'move') {
        const dx = pos.x - startPoint.x;
        const dy = pos.y - startPoint.y;
        shape.start.x += dx;
        shape.start.y += dy;
        shape.end.x += dx;
        shape.end.y += dy;
        startPoint = { ...pos };
      }
    } else if (shape.type === 'rect') {
      if (handle === 'move') {
        const dx = pos.x - startPoint.x;
        const dy = pos.y - startPoint.y;
        shape.x += dx;
        shape.y += dy;
        startPoint = { ...pos };
      } else if (handle.startsWith('corner-')) {
        const cornerIdx = parseInt(handle.split('-')[1]);
        const oldCorners = [
          { x: shape.x, y: shape.y },
          { x: shape.x + shape.width, y: shape.y },
          { x: shape.x + shape.width, y: shape.y + shape.height },
          { x: shape.x, y: shape.y + shape.height }
        ];

        oldCorners[cornerIdx] = { ...pos };

        const xs = oldCorners.map(c => c.x);
        const ys = oldCorners.map(c => c.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);

        shape.x = minX;
        shape.y = minY;
        shape.width = maxX - minX;
        shape.height = maxY - minY;
        shape.area = shape.width * shape.height;
      } else if (handle === 'edge-top') {
        const newY = pos.y;
        const delta = shape.y - newY;
        shape.y = newY;
        shape.height += delta;
        shape.area = shape.width * shape.height;
      } else if (handle === 'edge-bottom') {
        shape.height = pos.y - shape.y;
        shape.area = shape.width * shape.height;
      } else if (handle === 'edge-left') {
        const newX = pos.x;
        const delta = shape.x - newX;
        shape.x = newX;
        shape.width += delta;
        shape.area = shape.width * shape.height;
      } else if (handle === 'edge-right') {
        shape.width = pos.x - shape.x;
        shape.area = shape.width * shape.height;
      }
    }
  }

  function recalculateAreas() {
    if (outerRect) outerRect.area = outerRect.width * outerRect.height;
    if (innerRect) innerRect.area = innerRect.width * innerRect.height;
  }

  function updateCursor(pos) {
    if (tool === 'rect' && rectState === 1) {
      blockOverlay.style.cursor = 'crosshair';
      return;
    }

    const handle = findHandleAt(pos);
    if (handle) {
      if (handle.handle === 'rotate') {
        blockOverlay.style.cursor = 'grab';
      } else if (handle.handle === 'move') {
        blockOverlay.style.cursor = 'move';
      } else if (handle.handle.startsWith('edge-')) {
        const edge = handle.handle.split('-')[1];
        if (edge === 'top' || edge === 'bottom') {
          blockOverlay.style.cursor = 'ns-resize';
        } else {
          blockOverlay.style.cursor = 'ew-resize';
        }
      } else if (handle.handle.startsWith('corner-')) {
        blockOverlay.style.cursor = 'nwse-resize';
      } else {
        blockOverlay.style.cursor = 'pointer';
      }
    } else if (findShapeAt(pos)) {
      blockOverlay.style.cursor = 'pointer';
    } else {
      blockOverlay.style.cursor = 'crosshair';
    }
  }

  // ===== HORIZONTAL LINE CALCULATION =====

  function getHorizontalLines(shape) {
    const x1 = Math.min(shape.start.x, shape.end.x);
    const x2 = Math.max(shape.start.x, shape.end.x);
    const y1 = Math.min(shape.start.y, shape.end.y);
    const y2 = Math.max(shape.start.y, shape.end.y);
    const width = x2 - x1;
    const height = y2 - y1;
    const ratios = [0, 1/3, 1/2, 2/3, 1];

    return ratios.map(r => ({
      x1: x1,
      y1: y1 + height * r,
      x2: x1 + width,
      y2: y1 + height * r,
      label: r === 0 ? '' : r === 1/3 ? '⅓' : r === 1/2 ? '½' : r === 2/3 ? '⅔' : ''
    }));
  }

  // ===== DRAWING =====

  function handleRectDraw(p1, p2) {
    const rx = Math.min(p1.x, p2.x);
    const ry = Math.min(p1.y, p2.y);
    const rw = Math.abs(p2.x - p1.x);
    const rh = Math.abs(p2.y - p1.y);

    if (rectState === 0) {
      outerRect = { 
        type: 'rect', x: rx, y: ry, width: rw, height: rh, 
        area: rw * rh, isOuter: true 
      };
      shapes.push(outerRect);
      rectState = 1;
    } else if (rectState === 1) {
      const clampedX = Math.max(outerRect.x, rx);
      const clampedY = Math.max(outerRect.y, ry);
      const clampedRight = Math.min(outerRect.x + outerRect.width, rx + rw);
      const clampedBottom = Math.min(outerRect.y + outerRect.height, ry + rh);

      const finalW = Math.max(10, clampedRight - clampedX);
      const finalH = Math.max(10, clampedBottom - clampedY);

      innerRect = { 
        type: 'rect', x: clampedX, y: clampedY, 
        width: finalW, height: finalH, 
        area: finalW * finalH, isOuter: false 
      };
      shapes.push(innerRect);
      rectState = 2;
    }
  }

  // ===== SVG RENDERING =====

  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  function clearSVG() {
    while (svg?.firstChild) svg.removeChild(svg.firstChild);
  }

  function redrawAll() {
    clearSVG();
    shapes.forEach((shape) => {
      const isSelected = (shape === selectedShape);
      const isHovered = (shape === hoverShape && !isSelected);
      if (shape.type === 'line') drawLine(shape, isSelected, isHovered);
      else if (shape.type === 'rect') drawRect(shape, isSelected, isHovered);
    });

    if (selectedShape) {
      drawSelectionHandles(selectedShape);
    }

    if (rectState === 2 && innerRect && outerRect) {
      drawPctLabel();
    }
  }

  function drawPreview() {
    if (!currentShape) return;
    if (currentShape.type === 'line') {
      drawHorizontalLines(currentShape, true, false);
    } else if (currentShape.type === 'rect') {
      const ox = Math.min(currentShape.start.x, currentShape.end.x);
      const oy = Math.min(currentShape.start.y, currentShape.end.y);
      const ow = Math.abs(currentShape.end.x - currentShape.start.x);
      const oh = Math.abs(currentShape.end.y - currentShape.start.y);

      svg.appendChild(svgEl('rect', {
        x: ox, y: oy, width: ow, height: oh,
        fill: 'none', stroke: '#ff1111', 'stroke-width': '2'
      }));
    }
  }

  function drawLine(shape, isSelected, isHovered) {
    drawHorizontalLines(shape, isSelected, isHovered);
  }

  function drawHorizontalLines(shape, isPreview, isHovered) {
    const lines = shape.angle ? getRotatedLines(shape) : getHorizontalLines(shape);
    const color = isPreview ? '#ffaaaa' : isHovered ? '#ff1111' : '#cc0000';
    const strokeWidth = (shape === selectedShape) ? '3' : '2.5';

    lines.forEach((line, i) => {
      // Main line with subtle glow for selected
      if (shape === selectedShape) {
        svg.appendChild(svgEl('line', {
          x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2,
          stroke: color, 'stroke-width': '5', opacity: '0.15', 'stroke-linecap': 'round'
        }));
      }
      
      const mainLine = svgEl('line', {
        x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2,
        stroke: color, 'stroke-width': strokeWidth, 'stroke-linecap': 'round',
        filter: 'url(#sv-glow)'
      });
      svg.appendChild(mainLine);

      // Endpoints
      if (!isPreview) {
        svg.appendChild(svgEl('circle', { cx: line.x1, cy: line.y1, r: (shape === selectedShape) ? 4 : 3, fill: color, opacity: '0.8' }));
        svg.appendChild(svgEl('circle', { cx: line.x2, cy: line.y2, r: (shape === selectedShape) ? 4 : 3, fill: color, opacity: '0.8' }));
      }

      // Labels
      if (line.label && !isPreview) {
        const midX = (line.x1 + line.x2) / 2;
        const midY = (line.y1 + line.y2) / 2;
        const angle = shape.angle || 0;
        const labelOffset = 18;
        const lx = midX + Math.cos(angle + Math.PI/2) * labelOffset;
        const ly = midY + Math.sin(angle + Math.PI/2) * labelOffset;
        drawLabel(lx, ly, line.label, shape === selectedShape);
      }
    });
  }

  function drawRect(shape, isSelected, isHovered) {
    const fill = shape.isOuter ? 'none' : 'rgba(255,200,0,0.15)';
    const stroke = isSelected ? SELECTION_COLOR : isHovered ? '#ff3333' : '#f13b4a';
    const width = isSelected ? '3' : '2';

    if (isSelected) {
      svg.appendChild(svgEl('rect', {
        x: shape.x - 2, y: shape.y - 2, width: shape.width + 4, height: shape.height + 4,
        fill: 'none', stroke: stroke, 'stroke-width': '6', opacity: '0.1', rx: '2'
      }));
    }

    svg.appendChild(svgEl('rect', {
      x: shape.x, y: shape.y, width: shape.width, height: shape.height,
      fill: fill, stroke: stroke, 'stroke-width': width, rx: '2'
    }));

    const corners = [
      [shape.x, shape.y],
      [shape.x + shape.width, shape.y],
      [shape.x + shape.width, shape.y + shape.height],
      [shape.x, shape.y + shape.height]
    ];
    corners.forEach(([cx, cy]) => {
      svg.appendChild(svgEl('circle', { cx, cy, r: isSelected ? 4 : 3, fill: stroke }));
    });
  }

  function drawSelectionHandles(shape) {
    if (shape.type === 'line') {
      const lines = shape.angle ? getRotatedLines(shape) : getHorizontalLines(shape);
      const bounds = getLineBounds(shape);
      const center = { x: bounds.cx, y: bounds.cy };
      const angle = shape.angle || 0;
      
      // Start handle
      drawHandle(lines[0].x1, lines[0].y1, 'start', hoverHandle?.shape === shape && hoverHandle?.handle === 'start');
      // End handle
      drawHandle(lines[4].x2, lines[4].y2, 'end', hoverHandle?.shape === shape && hoverHandle?.handle === 'end');
      
      // Move handle at center
      drawHandle(center.x, center.y, 'move', hoverHandle?.shape === shape && hoverHandle?.handle === 'move');
      
      // Rotation handle
      const midLine = lines[2];
      const midPoint = { x: (midLine.x1 + midLine.x2) / 2, y: (midLine.y1 + midLine.y2) / 2 };
      const perpAngle = angle + Math.PI / 2;
      const rotHandleDist = 32;
      const rotHandle = {
        x: midPoint.x + Math.cos(perpAngle) * rotHandleDist,
        y: midPoint.y + Math.sin(perpAngle) * rotHandleDist
      };
      
      const isRotHover = hoverHandle?.shape === shape && hoverHandle?.handle === 'rotate';
      
      // Connection line
      svg.appendChild(svgEl('line', {
        x1: midPoint.x, y1: midPoint.y,
        x2: rotHandle.x, y2: rotHandle.y,
        stroke: isRotHover ? '#ff3434' : SELECTION_COLOR, 
        'stroke-width': isRotHover ? '2' : '1.5', 
        'stroke-dasharray': '4,3',
        opacity: '0.7'
      }));
      
      drawRotationHandle(rotHandle.x, rotHandle.y, isRotHover);
      
      // Angle indicator — no background fill
      const angleDeg = Math.round((angle * 180 / Math.PI) % 360);
      const normalizedAngle = angleDeg < 0 ? angleDeg + 360 : angleDeg;
      drawLabel(rotHandle.x + 18, rotHandle.y - 8, normalizedAngle + '°', false, true, true);
      
    } else if (shape.type === 'rect') {
      const corners = [
        { x: shape.x, y: shape.y },
        { x: shape.x + shape.width, y: shape.y },
        { x: shape.x + shape.width, y: shape.y + shape.height },
        { x: shape.x, y: shape.y + shape.height }
      ];
      corners.forEach((c, i) => {
        const isHover = hoverHandle?.shape === shape && hoverHandle?.handle === 'corner-' + i;
        drawHandle(c.x, c.y, 'corner-' + i, isHover);
      });

      const midTop = { x: shape.x + shape.width / 2, y: shape.y };
      const midBottom = { x: shape.x + shape.width / 2, y: shape.y + shape.height };
      const midLeft = { x: shape.x, y: shape.y + shape.height / 2 };
      const midRight = { x: shape.x + shape.width, y: shape.y + shape.height / 2 };

      drawEdgeHandle(midTop.x, midTop.y, 'horizontal', hoverHandle?.shape === shape && hoverHandle?.handle === 'edge-top');
      drawEdgeHandle(midBottom.x, midBottom.y, 'horizontal', hoverHandle?.shape === shape && hoverHandle?.handle === 'edge-bottom');
      drawEdgeHandle(midLeft.x, midLeft.y, 'vertical', hoverHandle?.shape === shape && hoverHandle?.handle === 'edge-left');
      drawEdgeHandle(midRight.x, midRight.y, 'vertical', hoverHandle?.shape === shape && hoverHandle?.handle === 'edge-right');
    }
  }

  function drawHandle(x, y, type, isHovered) {
    const size = isHovered ? 12 : HANDLE_SIZE;
    const half = size / 2;

    if (isHovered) {
      svg.appendChild(svgEl('circle', {
        cx: x, cy: y, r: half + 3,
        fill: 'none', stroke: SELECTION_COLOR, 'stroke-width': '1.5', opacity: '0.3'
      }));
    }

    svg.appendChild(svgEl('rect', {
      x: x - half, y: y - half,
      width: size, height: size,
      fill: '#ffffff', stroke: SELECTION_COLOR, 'stroke-width': '2',
      rx: '3'
    }));
  }

  function drawRotationHandle(x, y, isHovered) {
    const size = isHovered ? 14 : 12;
    const r = size / 2;
    
    if (isHovered) {
      svg.appendChild(svgEl('circle', {
        cx: x, cy: y, r: r + 4,
        fill: 'none', stroke: SELECTION_COLOR, 'stroke-width': '1.5', opacity: '0.3'
      }));
    }

    svg.appendChild(svgEl('circle', {
      cx: x, cy: y, r: r,
      fill: '#ffffff', stroke: SELECTION_COLOR, 'stroke-width': '2.5'
    }));
    
    // Rotation arrows
    const arrowPath = `M ${x-3} ${y-1} A 3.5 3.5 0 0 1 ${x+2} ${y-2.5} M ${x+2} ${y-2.5} L ${x+1} ${y-4.5} M ${x+2} ${y-2.5} L ${x+4} ${y-1.5}`;
    svg.appendChild(svgEl('path', {
      d: arrowPath,
      fill: 'none', stroke: SELECTION_COLOR, 'stroke-width': '1.5',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }));
  }

  function drawEdgeHandle(x, y, orientation, isHovered) {
    const w = orientation === 'horizontal' ? (isHovered ? 16 : 14) : (isHovered ? 8 : 6);
    const h = orientation === 'horizontal' ? (isHovered ? 8 : 6) : (isHovered ? 16 : 14);

    if (isHovered) {
      svg.appendChild(svgEl('circle', {
        cx: x, cy: y, r: Math.max(w, h) / 2 + 3,
        fill: 'none', stroke: SELECTION_COLOR, 'stroke-width': '1.5', opacity: '0.3'
      }));
    }

    svg.appendChild(svgEl('rect', {
      x: x - w / 2, y: y - h / 2,
      width: w, height: h,
      fill: '#ffffff', stroke: SELECTION_COLOR, 'stroke-width': '2',
      rx: '3'
    }));
  }

  function drawPctLabel() {
    if (!innerRect || !outerRect) return;

    const pct = ((innerRect.area / outerRect.area) * 100).toFixed(1);
    const cx = innerRect.x + innerRect.width / 2;
    const cy = innerRect.y + innerRect.height / 2;

    const text = pct + '%';
    const textWidth = text.length * 10;
    const pillW = textWidth + 20;
    const pillH = 26;

    const g = svgEl('g', {});
    
    // Shadow
    g.appendChild(svgEl('rect', {
      x: cx - pillW / 2 + 2, y: cy - pillH / 2 + 2,
      width: pillW, height: pillH,
      fill: 'rgba(0,0,0,0.15)', rx: '8'
    }));
    
    g.appendChild(svgEl('rect', {
      x: cx - pillW / 2, y: cy - pillH / 2,
      width: pillW, height: pillH,
      fill: '#ffdd00', stroke: '#e63946', 'stroke-width': '2',
      rx: '8'
    }));

    const txt = svgEl('text', {
      x: cx, y: cy + 5,
      'text-anchor': 'middle',
      'font-family': 'Arial, sans-serif',
      'font-size': '14',
      'font-weight': 'bold',
      fill: '#000000'
    });
    txt.textContent = text;
    g.appendChild(txt);

    svg.appendChild(g);
  }

  function drawLabel(x, y, text, isSelected, isSmall = false, noBackground = false) {
    const g = svgEl('g', {});
    const padding = isSmall ? 8 : 12;
    const fontSize = isSmall ? '22' : '26';
    const width = text.length * (isSmall ? 12 : 15) + padding * 2;
    const height = (isSmall ? 28 : 34);
    
    if (!noBackground) {
      g.appendChild(svgEl('rect', {
        x: x - width / 2, y: y - height / 2, 
        width: width, height: height,
        fill: '#ffdd00', 
        stroke: isSelected ? '#e63946' : '#cc7700', 
        'stroke-width': '2',
        rx: '6', opacity: '0.98'
      }));
    }
    
    const txt = svgEl('text', {
      x: x, y: y + (isSmall ? 6 : 7),
      'text-anchor': 'middle',
      'font-family': 'SF Mono, Monaco, monospace',
      'font-size': fontSize,
      'font-weight': 'bold',
      fill: '#ffffff',
      style: 'fill:#ffffff !important; color:#ffffff !important;'
    });
    txt.textContent = text;
    g.appendChild(txt);
    svg.appendChild(g);
  }

  // ===== MATH UTILS =====

  function dist(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  function pointToLineDistance(p, lineStart, lineEnd) {
    const A = p.x - lineStart.x;
    const B = p.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;
    let xx, yy;
    if (param < 0) {
      xx = lineStart.x; yy = lineStart.y;
    } else if (param > 1) {
      xx = lineEnd.x; yy = lineEnd.y;
    } else {
      xx = lineStart.x + param * C;
      yy = lineStart.y + param * D;
    }
    return Math.hypot(p.x - xx, p.y - yy);
  }

  // ===== CLEANUP =====

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (selectedShape) {
        selectedShape = null;
        editHandle = null;
        redrawAll();
        updateInfo();
      } else {
        deactivate();
      }
      return;
    }
    if (e.key === '1') {
      e.preventDefault();
      selectTool('line');
      return;
    }
    if (e.key === '2') {
      e.preventDefault();
      selectTool('rect');
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedShape) {
        const idx = shapes.indexOf(selectedShape);
        if (idx > -1) {
          shapes.splice(idx, 1);
          if (selectedShape === outerRect) { outerRect = null; rectState = 0; }
          if (selectedShape === innerRect) { innerRect = null; rectState = 1; }
          selectedShape = null;
          redrawAll();
          updateInfo();
        }
      }
    }
  }

  function deactivate(options = {}) {
    if (!window.__savageActive) return;
    window.__savageActive = false;

    if (blockOverlay) {
      blockOverlay.removeEventListener('mousedown', onMouseDown);
      blockOverlay.removeEventListener('mousemove', onMouseMove);
      blockOverlay.removeEventListener('mouseup', onMouseUp);
    }

    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('click', onDocumentClick);
    window.removeEventListener('resize', onResize);

    const ids = ['savage-block', 'savage-overlay', 'savage-toolbar', 'savage-info'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    document.body.classList.remove('savage-active');
    document.body.style.cursor = '';

    if (options.notify !== false) {
      chrome.runtime?.sendMessage?.({ type: 'savage_deactivated' });
    }
  }

  window.__savageSetTool = selectTool;
  window.__savageDeactivate = deactivate;

  init();
})();