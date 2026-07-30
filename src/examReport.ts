import type { ExamStudentAnalysis } from './examAnalytics';
import type { ExamRecord, Language } from './store/types';

type ExamReportInput = {
  className: string;
  studentName: string;
  exam: ExamRecord;
  analysis: ExamStudentAnalysis;
  lang: Language;
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const formatNumber = (value: number) =>
  Number.isInteger(value) ? value.toString() : value.toFixed(1);

const formatPercent = (value: number | null) =>
  value == null ? '-' : `${Math.round(value)}%`;

export const createExamReportHtml = ({
  className,
  studentName,
  exam,
  analysis,
  lang,
}: ExamReportInput) => {
  const copy = lang === 'en'
    ? {
        documentTitle: 'Individual Assessment Report',
        assessment: 'Assessment',
        date: 'Date',
        student: 'Student',
        className: 'Class',
        overall: 'Overall',
        classAverage: 'Class average',
        trend: 'Trend',
        improving: 'Improving',
        declining: 'Needs attention',
        stable: 'Stable',
        first: 'First record',
        comparedWithPrevious: 'vs. previous',
        item: 'Item',
        score: 'Score',
        performance: 'Performance',
        itemTrend: 'Item trend',
        strengths: 'Strengths',
        weaknesses: 'Focus areas',
        missing: 'Scores to complete',
        none: 'None identified',
        mentorComment: 'Teacher comment',
        noComment: 'No teacher comment yet.',
        note: 'Trends use normalized percentages from entered assessment history and support instructional review only.',
      }
    : {
        documentTitle: '個別考試學習報告',
        assessment: '考試',
        date: '日期',
        student: '學生',
        className: '班級',
        overall: '整體表現',
        classAverage: '班級平均',
        trend: '學習趨勢',
        improving: '進步中',
        declining: '需要關注',
        stable: '大致持平',
        first: '首次紀錄',
        comparedWithPrevious: '較上次',
        item: '評量項目',
        score: '成績',
        performance: '得分率',
        itemTrend: '項目趨勢',
        strengths: '優勢項目',
        weaknesses: '優先加強',
        missing: '尚待補登',
        none: '目前未辨識',
        mentorComment: '導師評語',
        noComment: '導師尚未補充評語。',
        note: '趨勢依已輸入的歷次考試百分比計算，僅供教學回饋與學習支持使用。',
      };
  const trendLabel = copy[analysis.trend];
  const trendDelta =
    analysis.trendDelta == null
      ? ''
      : `${analysis.trendDelta >= 0 ? '+' : ''}${analysis.trendDelta.toFixed(1)}%`;
  const itemRows = analysis.itemAnalyses.map((item) => {
    const itemTrend =
      item.trendDelta == null
        ? '-'
        : `${item.trendDelta >= 0 ? '+' : ''}${item.trendDelta.toFixed(1)}%`;
    const score =
      item.score == null
        ? '-'
        : `${formatNumber(item.score)} / ${formatNumber(item.maxScore)}`;
    const width = Math.max(0, Math.min(100, item.percent ?? 0));
    return `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td class="numeric">${escapeHtml(score)}</td>
        <td>
          <div class="score-line">
            <div class="score-track"><span style="width:${width}%"></span></div>
            <strong>${formatPercent(item.percent)}</strong>
          </div>
        </td>
        <td class="numeric ${item.trendDelta != null && item.trendDelta < -3 ? 'negative' : ''}">
          ${escapeHtml(itemTrend)}
        </td>
      </tr>
    `;
  }).join('');
  const list = (items: Array<{ name: string }>) =>
    items.length > 0
      ? items.map((item) => `<span class="tag">${escapeHtml(item.name)}</span>`).join('')
      : `<span class="empty">${escapeHtml(copy.none)}</span>`;
  const comment = analysis.mentorComment
    ? escapeHtml(analysis.mentorComment).replaceAll('\n', '<br>')
    : `<span class="empty">${escapeHtml(copy.noComment)}</span>`;

  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'zh-Hant'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(studentName)} - ${escapeHtml(exam.title)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 14mm 14mm; }
    * { box-sizing: border-box; }
    html { background: #e2e8f0; }
    body {
      margin: 0;
      color: #172033;
      background: #e2e8f0;
      font-family: "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif;
      font-size: 10.5pt;
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 12px auto;
      padding: 12mm 14mm 14mm;
      background: #fffdf8;
      box-shadow: 0 16px 50px rgba(15, 23, 42, .16);
    }
    .masthead {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 18px;
      align-items: end;
      padding-bottom: 12px;
      border-bottom: 3px solid #0f766e;
    }
    .eyebrow {
      margin: 0 0 3px;
      color: #0f766e;
      font-size: 9pt;
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    h1 { margin: 0; font-size: 24pt; line-height: 1.15; letter-spacing: -.03em; }
    .exam-name { margin-top: 5px; color: #475569; font-size: 11pt; }
    .identity { min-width: 54mm; border-left: 1px solid #cbd5e1; padding-left: 14px; }
    .identity div { display: flex; justify-content: space-between; gap: 12px; margin-top: 3px; }
    .identity span { color: #64748b; }
    .identity strong { text-align: right; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1px;
      margin-top: 12px;
      background: #cbd5e1;
      border: 1px solid #cbd5e1;
    }
    .metric { min-height: 28mm; padding: 10px 12px; background: #f8fafc; }
    .metric-label { color: #64748b; font-size: 8.5pt; font-weight: 700; }
    .metric-value { margin-top: 2px; font-size: 22pt; font-weight: 900; line-height: 1; }
    .metric-note { margin-top: 5px; color: #475569; font-size: 8.5pt; }
    .trend-improving .metric-value { color: #047857; }
    .trend-declining .metric-value { color: #be123c; }
    .trend-stable .metric-value, .trend-first .metric-value { color: #0f766e; }
    .section { margin-top: 14px; break-inside: avoid; }
    .section h2 {
      margin: 0 0 7px;
      color: #0f172a;
      font-size: 11pt;
      letter-spacing: .02em;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th {
      padding: 6px 7px;
      color: #f8fafc;
      background: #334155;
      text-align: left;
      font-size: 8.5pt;
    }
    th:nth-child(1) { width: 27%; }
    th:nth-child(2) { width: 20%; }
    th:nth-child(3) { width: 36%; }
    th:nth-child(4) { width: 17%; }
    td { padding: 6px 7px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
    tbody tr:nth-child(even) td { background: #f8fafc; }
    .numeric { text-align: right; font-variant-numeric: tabular-nums; }
    .negative { color: #be123c; font-weight: 800; }
    .score-line { display: grid; grid-template-columns: 1fr 34px; gap: 8px; align-items: center; }
    .score-track { height: 6px; overflow: hidden; border-radius: 99px; background: #e2e8f0; }
    .score-track span { display: block; height: 100%; border-radius: inherit; background: #0f766e; }
    .profile { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 9px; }
    .profile-card { min-height: 25mm; padding: 9px 10px; border: 1px solid #dbe4e6; background: #f8fafc; }
    .profile-card h3 { margin: 0 0 7px; color: #475569; font-size: 8.5pt; }
    .tag {
      display: inline-block;
      margin: 0 4px 4px 0;
      padding: 3px 7px;
      border-left: 3px solid #0f766e;
      background: #e6fffb;
      color: #115e59;
      font-size: 8.5pt;
      font-weight: 700;
    }
    .profile-card:nth-child(2) .tag { border-color: #f59e0b; background: #fffbeb; color: #92400e; }
    .profile-card:nth-child(3) .tag { border-color: #94a3b8; background: #f1f5f9; color: #475569; }
    .comment {
      min-height: 30mm;
      padding: 11px 12px;
      border-left: 4px solid #0f766e;
      background: #f0fdfa;
      white-space: normal;
    }
    .empty { color: #94a3b8; font-style: italic; }
    .footer {
      margin-top: 14px;
      padding-top: 8px;
      border-top: 1px solid #cbd5e1;
      color: #64748b;
      font-size: 8pt;
    }
    @media print {
      html, body { background: white; }
      .sheet { width: auto; min-height: auto; margin: 0; padding: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="masthead">
      <div>
        <p class="eyebrow">${escapeHtml(copy.documentTitle)}</p>
        <h1>${escapeHtml(studentName)}</h1>
        <div class="exam-name">${escapeHtml(copy.assessment)} - ${escapeHtml(exam.title)}</div>
      </div>
      <div class="identity">
        <div><span>${escapeHtml(copy.className)}</span><strong>${escapeHtml(className)}</strong></div>
        <div><span>${escapeHtml(copy.student)}</span><strong>${escapeHtml(studentName)}</strong></div>
        <div><span>${escapeHtml(copy.date)}</span><strong>${escapeHtml(exam.examDate)}</strong></div>
      </div>
    </header>

    <section class="metrics">
      <div class="metric">
        <div class="metric-label">${escapeHtml(copy.overall)}</div>
        <div class="metric-value">${formatPercent(analysis.overallPercent)}</div>
        <div class="metric-note">${analysis.completedItemCount} / ${analysis.totalItemCount}</div>
      </div>
      <div class="metric">
        <div class="metric-label">${escapeHtml(copy.classAverage)}</div>
        <div class="metric-value">${formatPercent(analysis.classAveragePercent)}</div>
      </div>
      <div class="metric trend-${analysis.trend}">
        <div class="metric-label">${escapeHtml(copy.trend)}</div>
        <div class="metric-value">${escapeHtml(trendLabel)}</div>
        <div class="metric-note">${escapeHtml(trendDelta ? `${copy.comparedWithPrevious} ${trendDelta}` : '')}</div>
      </div>
    </section>

    <section class="section">
      <h2>${escapeHtml(copy.performance)}</h2>
      <table>
        <thead>
          <tr>
            <th>${escapeHtml(copy.item)}</th>
            <th class="numeric">${escapeHtml(copy.score)}</th>
            <th>${escapeHtml(copy.performance)}</th>
            <th class="numeric">${escapeHtml(copy.itemTrend)}</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
    </section>

    <section class="section profile">
      <div class="profile-card"><h3>${escapeHtml(copy.strengths)}</h3>${list(analysis.strengthItems)}</div>
      <div class="profile-card"><h3>${escapeHtml(copy.weaknesses)}</h3>${list(analysis.weaknessItems)}</div>
      <div class="profile-card"><h3>${escapeHtml(copy.missing)}</h3>${list(analysis.missingItems)}</div>
    </section>

    <section class="section">
      <h2>${escapeHtml(copy.mentorComment)}</h2>
      <div class="comment">${comment}</div>
    </section>
    <footer class="footer">${escapeHtml(copy.note)}</footer>
  </main>
</body>
</html>`;
};
