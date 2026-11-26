/**
 * Pulse Analytics Interactive Dashboard Engine
 * Strict adherence to the dataviz skill:
 * - Computable CVD-safe palettes
 * - Thin marks (<=24px), 2px lines, 8px markers with 2px surface rings
 * - Unified crosshair + tooltip snapping to X
 * - Accessible table view alternates
 * - Secure DOM injection via textContent
 */

(function () {
  'use strict';

  // --- STATE ---
  const state = {
    timeRange: '30d',
    channel: 'all',
    theme: localStorage.getItem('pulse_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    visibleSeries: {
      revenue: true,
      orders: true
    },
    trendViewMode: 'chart', // 'chart' | 'table'
    channelViewMode: 'chart',
    tableSearchQuery: '',
    sortColumn: 'date',
    sortAsc: false,
    transactions: []
  };

  // Channel configuration matching validated categorical slots
  const CHANNELS = [
    { id: 'direct', name: 'Direct', colorVar: '--series-1', defaultHex: '#2a78d6' },
    { id: 'search', name: 'Organic Search', colorVar: '--series-2', defaultHex: '#eb6834' },
    { id: 'referral', name: 'Referral', colorVar: '--series-3', defaultHex: '#1baf7a' },
    { id: 'social', name: 'Social Media', colorVar: '--series-4', defaultHex: '#eda100' }
  ];

  const CHANNEL_SHARES = {
    direct: 0.38,
    search: 0.32,
    referral: 0.18,
    social: 0.12
  };

  // Helper to format currency
  function formatCurrency(val) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(val);
  }

  function formatCurrencyPrecise(val) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  }

  // Gridline + Y-axis label renderer shared across charts
  function renderGridlines(parentG, ySteps, maxVal, padding, chartH, width) {
    for (let i = 0; i <= ySteps; i++) {
      const yVal = padding.top + (chartH / ySteps) * i;
      const tickVal = Math.round(maxVal * (1 - i / ySteps));

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', padding.left);
      line.setAttribute('y1', yVal);
      line.setAttribute('x2', width - padding.right);
      line.setAttribute('y2', yVal);
      line.setAttribute('class', i === ySteps ? 'axis-baseline' : 'grid-line');
      parentG.appendChild(line);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', padding.left - 8);
      text.setAttribute('y', yVal + 4);
      text.setAttribute('text-anchor', 'end');
      text.setAttribute('class', 'axis-text num');
      text.textContent = tickVal >= 1000 ? `$${(tickVal / 1000).toFixed(0)}k` : `$${tickVal}`;
      parentG.appendChild(text);
    }
  }

  function formatNumber(val) {
    return new Intl.NumberFormat('en-US').format(val);
  }

  // --- MOCK DATA ENGINE ---
  function generateBaseData(range, channelFilter) {
    let dayCount = 30;
    if (range === 'today') dayCount = 12; // 12 two-hour intervals
    else if (range === '7d') dayCount = 7;
    else if (range === '30d') dayCount = 30;
    else if (range === '90d') dayCount = 90;
    else if (range === 'ytd') dayCount = 60;

    const points = [];
    const now = new Date();

    // Baseline multiplier based on channel filter
    const channelMultiplier = CHANNEL_SHARES[channelFilter] || 1.0;

    for (let i = dayCount - 1; i >= 0; i--) {
      let label = '';
      if (range === 'today') {
        const hour = 8 + i * 1.2;
        const hrInt = Math.floor(hour) % 24;
        label = `${hrInt.toString().padStart(2, '0')}:00`;
      } else {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }

      // Smooth periodic variation + realistic noise
      const timeFactor = Math.sin((dayCount - i) / 4) * 0.25 + 1;
      const baseRev = Math.round((3800 + Math.sin(i * 0.7) * 900 + (Math.random() * 600 - 300)) * channelMultiplier * timeFactor);
      const baseOrders = Math.round(baseRev / (75 + Math.random() * 20));

      points.push({
        label,
        revenue: Math.max(300, baseRev),
        orders: Math.max(5, baseOrders)
      });
    }

    let totalRevenue = points.reduce((sum, p) => sum + p.revenue, 0);
    let totalOrders = points.reduce((sum, p) => sum + p.orders, 0);

    const channelData = CHANNELS.map(ch => {
      const share = CHANNEL_SHARES[ch.id];
      const rev = channelFilter === 'all' || channelFilter === ch.id
        ? Math.round(totalRevenue * (channelFilter === 'all' ? share : 1.0))
        : 0;
      return {
        id: ch.id,
        name: ch.name,
        colorVar: ch.colorVar,
        revenue: rev,
        share: channelFilter === 'all' ? Math.round(share * 100) : (channelFilter === ch.id ? 100 : 0)
      };
    });

    return {
      points,
      totalRevenue,
      totalOrders,
      conversionRate: 3.42 + (Math.sin(dayCount) * 0.3),
      aov: totalOrders > 0 ? totalRevenue / totalOrders : 80,
      channelData
    };
  }

  // Generate mock transaction stream
  function initTransactions() {
    const customers = [
      'Sarah Jenkins', 'Marcus Vance', 'Elena Rostova', 'David Chen',
      'Amara Okafor', 'Liam O\'Connor', 'Chloe Martin', 'Carlos Santana',
      'Aoi Tanaka', 'Benjamin Hayes', 'Fatima Al-Mansoor', 'Julian Meyer'
    ];
    const statuses = ['good', 'warning', 'critical', 'serious'];
    const statusLabels = {
      good: 'Completed',
      warning: 'Processing',
      critical: 'Cancelled',
      serious: 'Refunded'
    };
    const channels = ['direct', 'search', 'referral', 'social'];

    const txs = [];
    const now = Date.now();

    for (let i = 0; i < 24; i++) {
      const ch = channels[Math.floor(Math.random() * channels.length)];
      const st = statuses[Math.floor(Math.random() * (i < 4 ? 2 : statuses.length))];
      const amount = (45 + Math.random() * 210).toFixed(2);
      const timeOffset = i * (18 * 60 * 1000) + Math.random() * 10000;
      const date = new Date(now - timeOffset);

      txs.push({
        id: `ORD-98${420 - i}`,
        customer: customers[i % customers.length],
        channel: ch,
        date: date.toISOString(),
        dateDisplay: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) + ', ' + date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        amount: parseFloat(amount),
        status: st,
        statusLabel: statusLabels[st]
      });
    }

    state.transactions = txs;
  }

  // --- THEME MANAGEMENT ---
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pulse_theme', theme);

    const themeIcon = document.getElementById('theme-icon');
    const themeText = document.getElementById('theme-text');

    if (theme === 'dark') {
      themeIcon.innerHTML = '<use href="#icon-sun"></use>';
      themeText.textContent = 'Light';
    } else {
      themeIcon.innerHTML = '<use href="#icon-moon"></use>';
      themeText.textContent = 'Dark';
    }

    // Re-render charts to recalculate styles if needed
    renderDashboard();
  }

  // --- TOAST NOTIFICATIONS ---
  function showToast(message, iconId = '#icon-check') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';

    const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('width', '16');
    iconSvg.setAttribute('height', '16');
    iconSvg.setAttribute('class', 'toast-icon');
    const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    useEl.setAttribute('href', iconId);
    iconSvg.appendChild(useEl);

    const textSpan = document.createElement('span');
    textSpan.textContent = message;

    toast.appendChild(iconSvg);
    toast.appendChild(textSpan);
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }

  // --- KPI SPARKLINE RENDERER ---
  function renderSparkline(svgEl, data, colorVar) {
    if (!svgEl || !data || data.length === 0) return;
    svgEl.innerHTML = '';

    const width = 90;
    const height = 32;
    const pad = 3;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = (max - min) || 1;

    const pts = data.map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (width - pad * 2);
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', pts.join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', `var(${colorVar})`);
    polyline.setAttribute('stroke-width', '2');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');

    // Last point marker
    const lastPt = pts[pts.length - 1].split(',');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', lastPt[0]);
    circle.setAttribute('cy', lastPt[1]);
    circle.setAttribute('r', '3');
    circle.setAttribute('fill', `var(${colorVar})`);

    svgEl.appendChild(polyline);
    svgEl.appendChild(circle);
  }

  // --- SVG TREND LINE & AREA CHART RENDERER ---
  function renderTrendChart(data) {
    const svg = document.getElementById('trend-svg');
    const viewport = document.getElementById('trend-chart-viewport');
    const tooltip = document.getElementById('trend-tooltip');
    const legend = document.getElementById('trend-legend');
    const tableContainer = document.getElementById('trend-table-container');

    if (!svg || !viewport) return;
    svg.innerHTML = '';

    const pts = data.points;
    if (!pts || pts.length === 0) return;

    // Viewport box dimensions
    const width = svg.clientWidth || 750;
    const height = 280;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const padding = { top: 20, right: 30, bottom: 40, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // Scaling
    const maxRev = Math.max(...pts.map(p => p.revenue)) * 1.15 || 1000;
    const maxOrders = Math.max(...pts.map(p => p.orders)) * 1.25 || 100;

    // Compute coordinate points
    const stepX = chartW / (pts.length - 1 || 1);
    const revPoints = pts.map((p, i) => ({
      x: padding.left + i * stepX,
      y: padding.top + chartH - (p.revenue / maxRev) * chartH,
      data: p
    }));

    const orderPoints = pts.map((p, i) => ({
      x: padding.left + i * stepX,
      y: padding.top + chartH - (p.orders / maxOrders) * chartH,
      data: p
    }));

    // 1. Gridlines & Y-Axis ticks (4 lines)
    const gridG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    renderGridlines(gridG, 4, maxRev, padding, chartH, width);
    svg.appendChild(gridG);

    // 2. X-Axis labels (sample appropriately to prevent collision)
    const xLabelG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const skip = Math.ceil(pts.length / 7);
    pts.forEach((p, i) => {
      if (i % skip === 0 || i === pts.length - 1) {
        const x = padding.left + i * stepX;
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', height - 12);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'axis-text');
        text.textContent = p.label;
        xLabelG.appendChild(text);
      }
    });
    svg.appendChild(xLabelG);

    // 3. Render Area & Lines
    const seriesG = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    // Render a single series: area wash (~10% opacity) + 2px round line
    const baselineY = padding.top + chartH;
    function renderSeries(points, colorVar) {
      if (!points.length) return;
      const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      let dArea = `M ${points[0].x} ${baselineY} L ${points[0].x} ${points[0].y} `;
      for (let i = 1; i < points.length; i++) {
        dArea += `L ${points[i].x} ${points[i].y} `;
      }
      dArea += `L ${points[points.length - 1].x} ${baselineY} Z`;
      areaPath.setAttribute('d', dArea);
      areaPath.setAttribute('fill', `var(${colorVar})`);
      areaPath.setAttribute('opacity', '0.10');
      seriesG.appendChild(areaPath);

      const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      let dLine = `M ${points[0].x} ${points[0].y} `;
      for (let i = 1; i < points.length; i++) {
        dLine += `L ${points[i].x} ${points[i].y} `;
      }
      linePath.setAttribute('d', dLine);
      linePath.setAttribute('fill', 'none');
      linePath.setAttribute('stroke', `var(${colorVar})`);
      linePath.setAttribute('stroke-width', '2');
      linePath.setAttribute('stroke-linecap', 'round');
      linePath.setAttribute('stroke-linejoin', 'round');
      seriesG.appendChild(linePath);
    }

    if (state.visibleSeries.revenue) renderSeries(revPoints, '--series-1');
    if (state.visibleSeries.orders) renderSeries(orderPoints, '--series-2');

    svg.appendChild(seriesG);

    // 4. Interactive Overlay (Crosshair & Markers)
    const overlayG = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    // Crosshair hairline
    const crosshair = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    crosshair.setAttribute('y1', padding.top);
    crosshair.setAttribute('y2', padding.top + chartH);
    crosshair.setAttribute('class', 'crosshair-line');
    crosshair.style.opacity = '0';
    overlayG.appendChild(crosshair);

    // Active Markers (8px with 2px surface ring)
    const revMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    revMarker.setAttribute('r', '4.5');
    revMarker.setAttribute('fill', 'var(--series-1)');
    revMarker.setAttribute('stroke', 'var(--surface-1)');
    revMarker.setAttribute('stroke-width', '2');
    revMarker.style.opacity = '0';
    overlayG.appendChild(revMarker);

    const orderMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    orderMarker.setAttribute('r', '4.5');
    orderMarker.setAttribute('fill', 'var(--series-2)');
    orderMarker.setAttribute('stroke', 'var(--surface-1)');
    orderMarker.setAttribute('stroke-width', '2');
    orderMarker.style.opacity = '0';
    overlayG.appendChild(orderMarker);

    svg.appendChild(overlayG);

    // Mouse / Touch Snapping Logic
    function handlePointer(evt) {
      const rect = svg.getBoundingClientRect();
      const pointerX = (evt.clientX || (evt.touches && evt.touches[0].clientX)) - rect.left;

      if (pointerX < padding.left || pointerX > width - padding.right) {
        hideTooltip();
        return;
      }

      // Find nearest index
      const relX = pointerX - padding.left;
      const rawIdx = Math.round(relX / stepX);
      const idx = Math.max(0, Math.min(pts.length - 1, rawIdx));

      const pRev = revPoints[idx];
      const pOrd = orderPoints[idx];

      // Snap crosshair
      crosshair.setAttribute('x1', pRev.x);
      crosshair.setAttribute('x2', pRev.x);
      crosshair.style.opacity = '1';

      if (state.visibleSeries.revenue) {
        revMarker.setAttribute('cx', pRev.x);
        revMarker.setAttribute('cy', pRev.y);
        revMarker.style.opacity = '1';
      } else {
        revMarker.style.opacity = '0';
      }

      if (state.visibleSeries.orders) {
        orderMarker.setAttribute('cx', pOrd.x);
        orderMarker.setAttribute('cy', pOrd.y);
        orderMarker.style.opacity = '1';
      } else {
        orderMarker.style.opacity = '0';
      }

      // Update Tooltip DOM securely
      tooltip.innerHTML = '';

      const title = document.createElement('div');
      title.className = 'tooltip-title';
      title.textContent = pRev.data.label;
      tooltip.appendChild(title);

      // Tooltip row helper: swatch + label + value
      function addTooltipRow(colorVar, labelText, formattedValue) {
        const row = document.createElement('div');
        row.className = 'tooltip-row';

        const nameGroup = document.createElement('div');
        nameGroup.className = 'tooltip-series-name';
        const swatch = document.createElement('span');
        swatch.className = 'tooltip-swatch';
        swatch.style.backgroundColor = `var(${colorVar})`;
        const nameText = document.createElement('span');
        nameText.textContent = labelText;
        nameGroup.appendChild(swatch);
        nameGroup.appendChild(nameText);

        const valText = document.createElement('span');
        valText.className = 'tooltip-value num';
        valText.textContent = formattedValue;

        row.appendChild(nameGroup);
        row.appendChild(valText);
        tooltip.appendChild(row);
      }

      if (state.visibleSeries.revenue) {
        addTooltipRow('--series-1', 'Revenue', formatCurrency(pRev.data.revenue));
      }

      if (state.visibleSeries.orders) {
        addTooltipRow('--series-2', 'Orders', formatNumber(pOrd.data.orders));
      }

      // Position tooltip above nearest point
      const primaryY = state.visibleSeries.revenue ? pRev.y : pOrd.y;
      tooltip.style.left = `${(pRev.x / width) * 100}%`;
      tooltip.style.top = `${primaryY}px`;
      tooltip.classList.add('visible');
    }

    function hideTooltip() {
      crosshair.style.opacity = '0';
      revMarker.style.opacity = '0';
      orderMarker.style.opacity = '0';
      tooltip.classList.remove('visible');
    }

    svg.onpointermove = handlePointer;
    svg.onpointerleave = hideTooltip;

    // 5. Build Interactive Legend
    legend.innerHTML = '';

    const seriesConfig = [
      { key: 'revenue', name: 'Revenue ($)', colorVar: '--series-1' },
      { key: 'orders', name: 'Orders (Qty)', colorVar: '--series-2' }
    ];

    seriesConfig.forEach(s => {
      const item = document.createElement('div');
      item.className = `legend-item ${state.visibleSeries[s.key] ? '' : 'dimmed'}`;
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-pressed', state.visibleSeries[s.key]);
      item.title = `Click to toggle ${s.name}`;

      const swatch = document.createElement('span');
      swatch.className = 'legend-line-swatch';
      swatch.style.backgroundColor = `var(${s.colorVar})`;

      const label = document.createElement('span');
      label.textContent = s.name;

      item.appendChild(swatch);
      item.appendChild(label);

      item.onclick = () => {
        // Prevent hiding both series
        const otherKey = s.key === 'revenue' ? 'orders' : 'revenue';
        if (state.visibleSeries[s.key] && !state.visibleSeries[otherKey]) {
          return; // keep at least one visible
        }
        state.visibleSeries[s.key] = !state.visibleSeries[s.key];
        renderTrendChart(data);
      };

      legend.appendChild(item);
    });

    // 6. Populate Accessible Table View
    tableContainer.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th scope="col">Date / Period</th>
          <th scope="col">Revenue</th>
          <th scope="col">Orders</th>
        </tr>
      </thead>
      <tbody>
        ${pts.map(p => `
          <tr>
            <td>${p.label}</td>
            <td class="num">${formatCurrency(p.revenue)}</td>
            <td class="num">${formatNumber(p.orders)}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    tableContainer.appendChild(table);
  }

  // --- SVG CHANNEL BAR CHART RENDERER ---
  function renderChannelBarChart(data) {
    const svg = document.getElementById('channel-svg');
    const tooltip = document.getElementById('channel-tooltip');
    const legend = document.getElementById('channel-legend');
    const tableContainer = document.getElementById('channel-table-container');

    if (!svg) return;
    svg.innerHTML = '';

    const channels = data.channelData;
    const width = svg.clientWidth || 380;
    const height = 280;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const padding = { top: 20, right: 20, bottom: 40, left: 55 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const maxRev = Math.max(...channels.map(c => c.revenue)) * 1.15 || 1000;

    // Gridlines & Y-Axis
    const gridG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    renderGridlines(gridG, 4, maxRev, padding, chartH, width);
    svg.appendChild(gridG);

    // Columns: thin marks <= 24px, 4px rounded top, square baseline
    const slotWidth = chartW / channels.length;
    const barWidth = Math.min(24, slotWidth * 0.45);
    const barsG = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    channels.forEach((ch, i) => {
      const centerX = padding.left + i * slotWidth + slotWidth / 2;
      const barX = centerX - barWidth / 2;
      const barH = (ch.revenue / maxRev) * chartH;
      const barY = padding.top + chartH - barH;

      // Group for bar with hover behavior
      const barGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      barGroup.style.cursor = 'pointer';

      // Bar rect with rounded top end: rx="4"
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', barX);
      rect.setAttribute('y', barY);
      rect.setAttribute('width', barWidth);
      rect.setAttribute('height', Math.max(2, barH));
      rect.setAttribute('rx', '4');
      rect.setAttribute('ry', '4');
      rect.setAttribute('fill', `var(${ch.colorVar})`);
      rect.style.transition = 'opacity 0.15s ease, transform 0.15s ease';

      // Interactive hover
      barGroup.onpointerenter = () => {
        rect.style.opacity = '0.85';

        tooltip.innerHTML = '';
        const title = document.createElement('div');
        title.className = 'tooltip-title';
        title.textContent = ch.name;
        tooltip.appendChild(title);

        const row1 = document.createElement('div');
        row1.className = 'tooltip-row';
        row1.innerHTML = `<span>Revenue:</span><span class="tooltip-value num">${formatCurrency(ch.revenue)}</span>`;
        tooltip.appendChild(row1);

        const row2 = document.createElement('div');
        row2.className = 'tooltip-row';
        row2.innerHTML = `<span>Contribution:</span><span class="tooltip-value num">${ch.share}%</span>`;
        tooltip.appendChild(row2);

        tooltip.style.left = `${(centerX / width) * 100}%`;
        tooltip.style.top = `${barY}px`;
        tooltip.classList.add('visible');
      };

      barGroup.onpointerleave = () => {
        rect.style.opacity = '1';
        tooltip.classList.remove('visible');
      };

      barGroup.appendChild(rect);
      barsG.appendChild(barGroup);

      // X-axis label
      const xText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      xText.setAttribute('x', centerX);
      xText.setAttribute('y', height - 12);
      xText.setAttribute('text-anchor', 'middle');
      xText.setAttribute('class', 'axis-text');
      // Abbreviate if space is small
      xText.textContent = width < 320 ? ch.name.split(' ')[0] : ch.name;
      svg.appendChild(xText);
    });

    svg.appendChild(barsG);

    // Populate Legend
    legend.innerHTML = '';
    channels.forEach(ch => {
      const item = document.createElement('div');
      item.className = 'legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'legend-swatch';
      swatch.style.backgroundColor = `var(${ch.colorVar})`;
      const text = document.createElement('span');
      text.textContent = `${ch.name} (${ch.share}%)`;
      item.appendChild(swatch);
      item.appendChild(text);
      legend.appendChild(item);
    });

    // Populate Accessible Table
    tableContainer.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th scope="col">Marketing Channel</th>
          <th scope="col">Revenue</th>
          <th scope="col">Share</th>
        </tr>
      </thead>
      <tbody>
        ${channels.map(c => `
          <tr>
            <td>${c.name}</td>
            <td class="num">${formatCurrency(c.revenue)}</td>
            <td class="num">${c.share}%</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    tableContainer.appendChild(table);
  }

  // --- FUNNEL STAGE METERS RENDERER ---
  function renderFunnelMeters(data) {
    const container = document.getElementById('funnel-meter-list');
    if (!container) return;

    const baseOrders = data.totalOrders;
    const stages = [
      { name: '1. Total Impressions', count: baseOrders * 28, pct: 100, colorVar: '--series-1' },
      { name: '2. Product Page Views', count: Math.round(baseOrders * 9.5), pct: 68, colorVar: '--series-1' },
      { name: '3. Added to Shopping Cart', count: Math.round(baseOrders * 3.2), pct: 36, colorVar: '--series-1' },
      { name: '4. Initiated Checkout', count: Math.round(baseOrders * 1.5), pct: 18, colorVar: '--series-1' },
      { name: '5. Completed Purchase', count: baseOrders, pct: 12, colorVar: '--status-good' }
    ];

    container.innerHTML = '';
    stages.forEach(st => {
      const item = document.createElement('div');
      item.className = 'meter-item';

      const meta = document.createElement('div');
      meta.className = 'meter-meta';

      const label = document.createElement('span');
      label.className = 'meter-label';
      label.textContent = st.name;

      const stat = document.createElement('span');
      stat.className = 'meter-stat num';
      stat.textContent = `${formatNumber(st.count)} (${st.pct}%)`;

      meta.appendChild(label);
      meta.appendChild(stat);

      const track = document.createElement('div');
      track.className = 'meter-track';

      const fill = document.createElement('div');
      fill.className = 'meter-fill';
      fill.style.width = `${st.pct}%`;
      fill.style.backgroundColor = `var(${st.colorVar})`;

      track.appendChild(fill);
      item.appendChild(meta);
      item.appendChild(track);
      container.appendChild(item);
    });
  }

  // --- TRANSACTIONS TABLE RENDERER ---
  function renderTransactionsTable() {
    const tbody = document.getElementById('orders-tbody');
    if (!tbody) return;

    let filtered = state.transactions.slice();

    // Channel filter
    if (state.channel !== 'all') {
      filtered = filtered.filter(t => t.channel === state.channel);
    }

    // Search query filter
    if (state.tableSearchQuery.trim()) {
      const q = state.tableSearchQuery.toLowerCase();
      filtered = filtered.filter(t =>
        t.id.toLowerCase().includes(q) ||
        t.customer.toLowerCase().includes(q) ||
        t.channel.toLowerCase().includes(q) ||
        t.statusLabel.toLowerCase().includes(q)
      );
    }

    // Sorting
    filtered.sort((a, b) => {
      let valA = a[state.sortColumn];
      let valB = b[state.sortColumn];

      if (state.sortColumn === 'amount') {
        return state.sortAsc ? valA - valB : valB - valA;
      }
      if (state.sortColumn === 'date') {
        return state.sortAsc ? new Date(valA) - new Date(valB) : new Date(valB) - new Date(valA);
      }

      valA = String(valA).toLowerCase();
      valB = String(valB).toLowerCase();
      return state.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

    tbody.innerHTML = '';

    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.setAttribute('colspan', '6');
      td.style.textAlign = 'center';
      td.style.padding = '1.5rem';
      td.style.color = 'var(--muted)';
      td.textContent = 'No matching transactions found.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const channelNames = {
      direct: 'Direct',
      search: 'Organic Search',
      referral: 'Referral',
      social: 'Social Media'
    };

    const statusIcons = {
      good: '#icon-check',
      warning: '#icon-clock',
      critical: '#icon-x',
      serious: '#icon-alert'
    };

    filtered.forEach(tx => {
      const tr = document.createElement('tr');

      // Order ID
      const tdId = document.createElement('td');
      tdId.className = 'num';
      tdId.style.fontWeight = '600';
      tdId.textContent = tx.id;

      // Customer
      const tdCust = document.createElement('td');
      tdCust.textContent = tx.customer;

      // Channel
      const tdCh = document.createElement('td');
      tdCh.textContent = channelNames[tx.channel] || tx.channel;

      // Date
      const tdDate = document.createElement('td');
      tdDate.className = 'num';
      tdDate.textContent = tx.dateDisplay;

      // Amount
      const tdAmt = document.createElement('td');
      tdAmt.className = 'num';
      tdAmt.style.fontWeight = '600';
      tdAmt.textContent = formatCurrencyPrecise(tx.amount);

      // Status Badge (icon + label, never color alone)
      const tdStatus = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `status-badge ${tx.status}`;

      const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      iconSvg.setAttribute('class', 'badge-icon');
      const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      useEl.setAttribute('href', statusIcons[tx.status] || '#icon-check');
      iconSvg.appendChild(useEl);

      const label = document.createElement('span');
      label.textContent = tx.statusLabel;

      badge.appendChild(iconSvg);
      badge.appendChild(label);
      tdStatus.appendChild(badge);

      tr.appendChild(tdId);
      tr.appendChild(tdCust);
      tr.appendChild(tdCh);
      tr.appendChild(tdDate);
      tr.appendChild(tdAmt);
      tr.appendChild(tdStatus);

      tbody.appendChild(tr);
    });
  }

  // --- DASHBOARD RENDER ORCHESTRATOR ---
  function renderDashboard() {
    const data = generateBaseData(state.timeRange, state.channel);

    // 1. Update KPI Values & Deltas
    const revEl = document.getElementById('kpi-val-revenue');
    const ordEl = document.getElementById('kpi-val-orders');
    const convEl = document.getElementById('kpi-val-conversion');
    const aovEl = document.getElementById('kpi-val-aov');

    if (revEl) revEl.textContent = formatCurrency(data.totalRevenue);
    if (ordEl) ordEl.textContent = formatNumber(data.totalOrders);
    if (convEl) convEl.textContent = `${data.conversionRate.toFixed(2)}%`;
    if (aovEl) aovEl.textContent = formatCurrencyPrecise(data.aov);

    // KPI Sparklines
    renderSparkline(document.getElementById('sparkline-revenue'), data.points.map(p => p.revenue), '--series-1');
    renderSparkline(document.getElementById('sparkline-orders'), data.points.map(p => p.orders), '--series-2');
    renderSparkline(document.getElementById('sparkline-conversion'), data.points.map(p => (p.orders / (p.revenue / 75)) * 100), '--series-3');
    renderSparkline(document.getElementById('sparkline-aov'), data.points.map(p => p.revenue / (p.orders || 1)), '--series-4');

    // 2. Charts
    renderTrendChart(data);
    renderChannelBarChart(data);
    renderFunnelMeters(data);

    // 3. Transactions
    renderTransactionsTable();
  }

  // --- EXPORT TO CSV ---
  function exportCSV() {
    const data = generateBaseData(state.timeRange, state.channel);
    let csvContent = 'Date,Revenue,Orders\n';
    data.points.forEach(p => {
      csvContent += `"${p.label}",${p.revenue},${p.orders}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `pulse_analytics_${state.timeRange}_${state.channel}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Dataset exported to CSV successfully');
  }

  // --- SIMULATE LIVE TRANSACTION ---
  function simulateLiveOrder() {
    const customers = [
      'Alexander Vance', 'Zoe Sterling', 'Nate Robinson', 'Priya Sharma',
      'Gabriel Silva', 'Grace Kim', 'Hannah Abbott', 'Lucas Moreau'
    ];
    const channels = ['direct', 'search', 'referral', 'social'];

    const newOrder = {
      id: `ORD-98${Math.floor(500 + Math.random() * 499)}`,
      customer: customers[Math.floor(Math.random() * customers.length)],
      channel: channels[Math.floor(Math.random() * channels.length)],
      date: new Date().toISOString(),
      dateDisplay: 'Just now, ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      amount: parseFloat((35 + Math.random() * 195).toFixed(2)),
      status: 'good',
      statusLabel: 'Completed'
    };

    state.transactions.unshift(newOrder);

    // Trigger visual notification and re-render
    showToast(`New live order: ${newOrder.id} (${formatCurrencyPrecise(newOrder.amount)}) by ${newOrder.customer}`);

    renderTransactionsTable();
  }

  // --- EVENT LISTENERS INITIALIZATION ---
  function initEvents() {
    // 1. Time range presets
    const rangeChips = document.querySelectorAll('.preset-filters .filter-chip');
    rangeChips.forEach(chip => {
      chip.addEventListener('click', () => {
        rangeChips.forEach(c => {
          c.classList.remove('active');
          c.setAttribute('aria-selected', 'false');
        });
        chip.classList.add('active');
        chip.setAttribute('aria-selected', 'true');
        state.timeRange = chip.getAttribute('data-range');

        // Update period text on tiles
        const periodText = state.timeRange === 'today' ? 'vs yesterday' : 'vs previous period';
        document.querySelectorAll('.delta-period').forEach(el => el.textContent = periodText);

        renderDashboard();
      });
    });

    // 2. Channel selector
    const channelSelect = document.getElementById('channel-select');
    if (channelSelect) {
      channelSelect.addEventListener('change', (e) => {
        state.channel = e.target.value;
        renderDashboard();
      });
    }

    // 3. Theme Toggle
    const themeBtn = document.getElementById('btn-theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme);
      });
    }

    // 4. Accessible Table View Toggles (shared helper)
    function setupChartViewToggle(stateKey, btnEl, svgEl, legendEl, tableEl) {
      btnEl.addEventListener('click', () => {
        if (state[stateKey] === 'chart') {
          state[stateKey] = 'table';
          svgEl.style.display = 'none';
          legendEl.style.display = 'none';
          tableEl.style.display = 'block';
          btnEl.querySelector('.view-text').textContent = 'Chart View';
          btnEl.querySelector('.view-icon').innerHTML = '<use href="#icon-chart"></use>';
        } else {
          state[stateKey] = 'chart';
          svgEl.style.display = 'block';
          legendEl.style.display = 'flex';
          tableEl.style.display = 'none';
          btnEl.querySelector('.view-text').textContent = 'Table View';
          btnEl.querySelector('.view-icon').innerHTML = '<use href="#icon-table"></use>';
        }
      });
    }

    const toggleTrendViewBtn = document.getElementById('btn-toggle-trend-view');
    const trendSvg = document.getElementById('trend-svg');
    const trendTable = document.getElementById('trend-table-container');
    const trendLegend = document.getElementById('trend-legend');

    if (toggleTrendViewBtn && trendSvg && trendTable) {
      setupChartViewToggle('trendViewMode', toggleTrendViewBtn, trendSvg, trendLegend, trendTable);
    }

    const toggleChannelViewBtn = document.getElementById('btn-toggle-channel-view');
    const channelSvg = document.getElementById('channel-svg');
    const channelTable = document.getElementById('channel-table-container');
    const channelLegend = document.getElementById('channel-legend');

    if (toggleChannelViewBtn && channelSvg && channelTable) {
      setupChartViewToggle('channelViewMode', toggleChannelViewBtn, channelSvg, channelLegend, channelTable);
    }

    // 5. Search in transactions
    const searchInput = document.getElementById('order-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.tableSearchQuery = e.target.value;
        renderTransactionsTable();
      });
    }

    // 6. Table Sort Headers
    const sortHeaders = document.querySelectorAll('#orders-table th[data-sort]');
    sortHeaders.forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort');
        if (state.sortColumn === col) {
          state.sortAsc = !state.sortAsc;
        } else {
          state.sortColumn = col;
          state.sortAsc = true;
        }
        renderTransactionsTable();
      });
    });

    // 7. Action buttons
    const simulateBtn = document.getElementById('btn-simulate-order');
    if (simulateBtn) {
      simulateBtn.addEventListener('click', simulateLiveOrder);
    }

    const exportBtn = document.getElementById('btn-export-csv');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportCSV);
    }

    // 8. Responsive resize re-draw
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        renderDashboard();
      }, 100);
    });
  }

  // --- INIT ---
  function init() {
    initTransactions();
    applyTheme(state.theme);
    initEvents();
    renderDashboard();
  }

  // Execute on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
