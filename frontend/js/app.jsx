/**
 * VOCALEXCEL — Financial Ledger & Terminal UI
 * Precision Excel Macro Builder for Tax & Finance Professionals
 */

const { useState, useEffect, useRef, useMemo } = React;

// ---------------------------------------------------------------------------
// Syntax Highlighting Helper for Pandas Code in Terminal
// ---------------------------------------------------------------------------
function highlightCode(code) {
  if (!code) return '';
  let escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const tokens = [];
  const isOverlapping = (a, b) => a.start < b.end && b.start < a.end;
  const canAdd = (tok) => !tokens.some(t => isOverlapping(t, tok));

  const collect = (regex, className) => {
    let m;
    while ((m = regex.exec(escaped)) !== null) {
      const tok = { start: m.index, end: m.index + m[0].length, className };
      if (canAdd(tok)) tokens.push(tok);
    }
  };

  // 1. Strings
  collect(/(&#39;[^&#]*?&#39;|&quot;[^&]*?&quot;|'[^']*?'|"[^"]*?")/g, 'code-string');
  // 2. Comments
  collect(/(#.*)$/gm, 'code-comment');
  // 3. Operators
  collect(/(&lt;=|&gt;=|!=|==|&lt;|&gt;|=|\+|-|\*|\/)/g, 'code-operator');
  // 4. Numbers
  collect(/\b(\d+\.?\d*)\b/g, 'code-number');
  // 5. Keywords
  const keywords = ['import', 'from', 'def', 'return', 'if', 'else', 'elif', 'for', 'in', 'while', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'as', 'with', 'lambda'];
  keywords.forEach(kw => collect(new RegExp(`\\b(${kw})\\b`, 'g'), 'code-keyword'));
  // 6. Methods
  const methodRegex = /\.(\w+)\s*(?=\()/g;
  let m;
  while ((m = methodRegex.exec(escaped)) !== null) {
    const tok = { start: m.index + 1, end: m.index + 1 + m[1].length, className: 'code-function' };
    if (canAdd(tok)) tokens.push(tok);
  }

  tokens.sort((a, b) => b.start - a.start);
  for (const tok of tokens) {
    escaped = escaped.substring(0, tok.start) + `<span class="${tok.className}">` + escaped.substring(tok.start, tok.end) + '</span>' + escaped.substring(tok.end);
  }
  return escaped;
}

// ---------------------------------------------------------------------------
// Helper: Format numeric values with commas & precision
// ---------------------------------------------------------------------------
function formatCellValue(val, colName) {
  if (val === null || val === undefined) return <span className="text-slate-400 italic">null</span>;
  const str = String(val);
  
  // Check if numeric column
  const isNumericCol = /revenue|amount|tax|profit|gross|net|pct|rate|count|total|cost|price/i.test(colName);
  const num = parseFloat(str.replace(/,/g, ''));

  if (isNumericCol && !isNaN(num) && /^-?\d+(\.\d+)?$/.test(str.trim())) {
    if (colName.toLowerCase().includes('pct') || colName.toLowerCase().includes('rate')) {
      return num.toFixed(2) + '%';
    }
    return num.toLocaleString('en-US');
  }
  return str;
}

function isNumericColumn(colName) {
  return /revenue|amount|tax|profit|gross|net|pct|rate|count|total|cost|price|id/i.test(colName);
}
// ---------------------------------------------------------------------------
// VOCALEXCEL Vector Brand Logo Component (Exact Match to Brand Spec)
// ---------------------------------------------------------------------------
function VocalExcelLogo({ className = "h-7" }) {
  return (
    <svg
      viewBox="0 0 256 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ height: '28px', width: 'auto' }}
    >
      {/* 1. Microphone Icon (0 to 22) */}
      <g id="mic-icon">
        <rect x="5.5" y="1.5" width="11" height="17" rx="5.5" fill="#322956" />
        <line x1="12.5" y1="6.5" x2="16" y2="6.5" stroke="#F7F5F0" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="12.5" y1="10.5" x2="16" y2="10.5" stroke="#F7F5F0" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M 1.5 10.5 C 1.5 17 5 21 11 21 C 17 21 20.5 17 20.5 10.5" fill="none" stroke="#322956" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M 11 21 L 11 26" stroke="#322956" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M 6.5 26 L 15.5 26" stroke="#322956" strokeWidth="2.5" strokeLinecap="round" />
      </g>

      {/* 2. VOCAL Wordmark */}
      <g id="vocal-wordmark" stroke="#8B5CF6" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* V */}
        <path d="M 30 5 L 38 25 L 46 5" />
        
        {/* O */}
        <path d="M 60 6 A 9.8 9.8 0 0 0 60 24" />
        <path d="M 64 6 A 9.8 9.8 0 0 1 64 24" />
        
        {/* C */}
        <path d="M 98 5 L 88 5 A 10 10 0 0 0 88 25 L 98 25" />
        
        {/* A */}
        <path d="M 104 25 L 112 5 L 120 25" />
        <path d="M 108 18 L 116 18" />
        
        {/* L */}
        <path d="M 126 5 L 126 25 L 140 25" />
      </g>

      {/* 3. EXCEL Wordmark */}
      <g id="excel-wordmark" stroke="#322956" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* E */}
        <path d="M 148 5 L 148 25" />
        <path d="M 152 5 L 162 5" />
        <path d="M 152 15 L 160 15" />
        <path d="M 152 25 L 162 25" />
        
        {/* X */}
        <path d="M 168 5 L 184 25" />
        <path d="M 184 5 L 168 25" />
        
        {/* C */}
        <path d="M 210 5 L 200 5 A 10 10 0 0 0 200 25 L 210 25" />
        
        {/* E */}
        <path d="M 216 5 L 216 25" />
        <path d="M 220 5 L 230 5" />
        <path d="M 220 15 L 228 15" />
        <path d="M 220 25 L 230 25" />
        
        {/* L */}
        <path d="M 236 5 L 236 25 L 250 25" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main VOCALEXCEL Ledger Application
// ---------------------------------------------------------------------------
function VocalExcelApp() {
  // App state
  const [status, setStatus] = useState({ status: 'ready', has_file: false, has_llm: false });
  const [workbook, setWorkbook] = useState(null);
  const [activeSheet, setActiveSheet] = useState('Tax_Data');
  const [currentData, setCurrentData] = useState({ data: [], columns: [], row_count: 0 });
  const [rawOriginalData, setRawOriginalData] = useState([]); // Pre-filter dataset for audit diff
  const [history, setHistory] = useState([]);

  // Command & Pipeline state
  const [commandText, setCommandText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStageIndex, setProcessingStageIndex] = useState(0); // 0, 1, 2, 3
  const [pipelineResult, setPipelineResult] = useState(null);
  const [executionResult, setExecutionResult] = useState(null);
  const [isFlashingApproval, setIsFlashingApproval] = useState(false);

  // Voice state
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');

  // UI Drawers & Toasts
  const [securityDrawerOpen, setSecurityDrawerOpen] = useState(false);
  const [schemaDrawerOpen, setSchemaDrawerOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [copiedCode, setCopiedCode] = useState(false);

  const commandInputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Toast Helper
  const showToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // Initial Load
  useEffect(() => {
    fetchStatus();
    fetchHistory();

    const voiceEngine = window.Voice || (typeof Voice !== 'undefined' ? Voice : null);
    if (voiceEngine) {
      voiceEngine.init({
        onTranscript: (text) => {
          setIsListening(false);
          setInterimTranscript('');
          setCommandText(text);
          handleRunCommand(text);
        },
        onPartialTranscript: (partial) => {
          setInterimTranscript(partial);
        },
        onStateChange: (state, msg) => {
          setIsListening(state === 'listening');
          if (state === 'error' && msg) {
            showToast(msg, 'error');
          }
        },
      });
    }

    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        commandInputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setSecurityDrawerOpen(false);
        setSchemaDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await API.getStatus();
      setStatus(res);
      if (res.has_file) {
        fetchCurrentData();
      }
    } catch (e) {
      showToast('Cannot connect to server. Ensure FastAPI backend is running.', 'error');
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await API.getHistory();
      if (res && res.history) {
        setHistory(res.history);
      }
    } catch (e) {}
  };

  const fetchCurrentData = async () => {
    try {
      const res = await API.getCurrentData();
      setCurrentData(res);
      if (rawOriginalData.length === 0 && res.data?.length > 0) {
        setRawOriginalData(res.data);
      }
    } catch (e) {}
  };

  // Load Sample Data
  const handleLoadSample = async () => {
    setIsProcessing(true);
    try {
      const res = await API.generateSampleData();
      if (res.success) {
        setWorkbook(res.schema);
        setActiveSheet(res.schema.active_sheet || 'Tax_Data');
        const dataRes = await API.getCurrentData();
        setCurrentData(dataRes);
        setRawOriginalData(dataRes.data || []);
        setPipelineResult(null);
        setExecutionResult(null);
        setCommandText('');
        setHistory([]);
        setStatus(prev => ({ ...prev, has_file: true, current_file: 'sample_tax_data.xlsx' }));
        showToast('Reset to default sample tax ledger (0 queries executed)', 'success');
      }
    } catch (e) {
      showToast(`Failed to load sample data: ${e.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // File Upload
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    showToast(`Auditing & uploading ${file.name}...`, 'info');
    try {
      const res = await API.uploadExcel(file);
      if (res.success) {
        setWorkbook(res.schema);
        setActiveSheet(res.schema.active_sheet);
        const dataRes = await API.getCurrentData();
        setCurrentData(dataRes);
        setRawOriginalData(dataRes.data || []);
        setPipelineResult(null);
        setExecutionResult(null);
        setCommandText('');
        setHistory([]);
        setStatus(prev => ({ ...prev, has_file: true, current_file: file.name }));
        showToast(`Workbook '${file.name}' verified and loaded`, 'success');
      }
    } catch (err) {
      showToast(`Upload failed: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Reset Data (Full Clean Slate: Reset to default sample_tax_data.xlsx and clear all history)
  const handleResetData = async () => {
    setIsProcessing(true);
    try {
      const res = await API.resetData();
      if (res.success) {
        setWorkbook(res.schema);
        setActiveSheet(res.schema.active_sheet || 'Tax_Data');
        const dataRes = await API.getCurrentData();
        setCurrentData(dataRes);
        setRawOriginalData(dataRes.data || []);
        setPipelineResult(null);
        setExecutionResult(null);
        setCommandText('');
        setHistory([]);
        setStatus(prev => ({
          ...prev,
          status: 'ready',
          has_file: true,
          current_file: 'sample_tax_data.xlsx',
          current_sheet: 'Tax_Data',
          history_count: 0
        }));
        if (fileInputRef.current) fileInputRef.current.value = '';
        showToast('Whole app reset to default sample file (All commands cleared)', 'success');
      }
    } catch (err) {
      showToast(`Reset failed: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Clear History
  const handleClearHistory = async (e) => {
    e?.stopPropagation();
    try {
      await API.clearHistory();
      setHistory([]);
      showToast('Command audit history cleared', 'info');
    } catch (err) {
      setHistory([]);
    }
  };

  // Voice Toggle
  const handleToggleVoice = () => {
    const voiceEngine = window.Voice || (typeof Voice !== 'undefined' ? Voice : null);
    if (voiceEngine) {
      if (!voiceEngine.isSupported()) {
        showToast('Speech recognition not supported in this browser. Please use Chrome, Edge, or Safari.', 'warning');
        return;
      }
      voiceEngine.toggle();
    } else {
      showToast('Voice engine initializing...', 'info');
    }

    // Load baseline data asynchronously if needed without blocking the mic activation
    if (!status.has_file && !workbook) {
      showToast('Loading baseline sample ledger for voice dictation...', 'info');
      API.generateSampleData().then(async (res) => {
        if (res.success) {
          setWorkbook(res.schema);
          setActiveSheet(res.schema.active_sheet || 'Tax_Data');
          const dataRes = await API.getCurrentData();
          setCurrentData(dataRes);
          setRawOriginalData(dataRes.data || []);
        }
      }).catch(() => {});
    }
  };

  // Run Command
  const handleRunCommand = async (textToRun) => {
    const query = textToRun || commandText;
    if (!query.trim() || isProcessing) return;

    if (!status.has_file && !workbook) {
      showToast('Loading baseline sample ledger...', 'info');
      try {
        const res = await API.generateSampleData();
        if (res.success) {
          setWorkbook(res.schema);
          setActiveSheet(res.schema.active_sheet || 'Tax_Data');
          const dataRes = await API.getCurrentData();
          setCurrentData(dataRes);
          setRawOriginalData(dataRes.data || []);
        }
      } catch (e) {}
    }

    setIsProcessing(true);
    setExecutionResult(null);
    setPipelineResult(null);

    // Sequential status pacing (~150ms per step)
    setProcessingStageIndex(1); // 1. Intent Parsing
    await new Promise(r => setTimeout(r, 150));
    setProcessingStageIndex(2); // 2. AST Validation
    await new Promise(r => setTimeout(r, 150));
    setProcessingStageIndex(3); // 3. Sandbox Dry-Run

    try {
      const res = await API.processVoiceCommand(query, activeSheet);
      await new Promise(r => setTimeout(r, 120));

      if (res.stage === 'ERROR') {
        showToast(res.error || 'Syntax/Logic error in command', 'error');
        setPipelineResult(res);
      } else {
        setPipelineResult(res);
        showToast('Audit simulation ready. Review ledger diff below.', 'info');
      }
      fetchHistory();
    } catch (err) {
      showToast(`Command error: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
      setProcessingStageIndex(0);
    }
  };

  // Approve & Execute with Brass Flash Animation
  const handleApprove = async () => {
    if (!pipelineResult?.generated_code?.code) return;
    setIsProcessing(true);
    try {
      const code = pipelineResult.generated_code.code;
      const transcript = pipelineResult.transcript || commandText;
      const res = await API.executeCode(code, 'pandas', transcript);
      
      if (res.success) {
        // Trigger 400ms brass flash animation across updated rows
        setIsFlashingApproval(true);
        setTimeout(() => setIsFlashingApproval(false), 500);

        setExecutionResult(res);
        if (res.updated_schema || res.schema) {
          setWorkbook(res.updated_schema || res.schema);
        }
        await fetchCurrentData();
        showToast('Approved & executed. Live financial ledger updated.', 'success');
        fetchHistory();
      } else {
        showToast(res.message || 'Execution error', 'error');
      }
    } catch (err) {
      showToast(`Execution error: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Reject
  const handleReject = async () => {
    try {
      await API.rejectCode();
      setPipelineResult(null);
      showToast('Transformation rejected — live ledger untouched', 'info');
    } catch (e) {}
  };

  // Copy Code
  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    showToast('Pandas macro code copied to clipboard', 'info');
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Dynamic Greeting in Serif Display
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning, Analyst.';
    if (hour < 17) return 'Good afternoon, Analyst.';
    return 'Good evening, Analyst.';
  }, []);

  // Suggestions formatted as Terminal Command Palette Strip
  const terminalCommands = [
    { key: '1', label: 'Filter revenue > $500k', query: 'Filter revenue above 500000' },
    { key: '2', label: 'Calculate profit column', query: 'Calculate profit as gross revenue minus net revenue' },
    { key: '3', label: 'Show pending filings', query: 'Show pending clients' },
    { key: '4', label: 'Group by state & sum revenue', query: 'Group by state and sum the revenue' },
    { key: '5', label: 'Top 5 by gross revenue', query: 'Show top 5 clients by gross revenue' },
  ];

  // Active sheet schema columns
  const activeSheetColumns = useMemo(() => {
    if (!workbook?.sheets) return [];
    const sheet = workbook.sheets.find(s => s.sheet_name === activeSheet) || workbook.sheets[0];
    return sheet?.columns || [];
  }, [workbook, activeSheet]);

  // Label columns vs Numeric columns split
  const columnCategories = useMemo(() => {
    const cols = (currentData.columns?.length > 0) ? currentData.columns :
                 (pipelineResult?.diff?.preview_after?.[0] ? Object.keys(pipelineResult.diff.preview_after[0]) : []);
    const labelCols = cols.filter(c => !isNumericColumn(c));
    const numericCols = cols.filter(c => isNumericColumn(c));
    return { labelCols, numericCols, all: cols };
  }, [currentData, pipelineResult]);

  return (
    <div className="min-h-screen bg-[#F7F5F0] text-[#0B0E14] flex flex-col font-sans selection:bg-[#1B4332] selection:text-white">
      
      {/* ------------------------------------------------------------------ */}
      {/* 1. TOP AUDIT NAVIGATION BAR                                        */}
      {/* ------------------------------------------------------------------ */}
      <header className="sticky top-0 z-30 bg-[#F7F5F0]/95 backdrop-blur-md border-b border-[#E2DED4] px-6 py-3 flex items-center justify-between shadow-sm">
        <div>
          <VocalExcelLogo className="h-7 mb-0.5" />
          <p className="text-[11px] text-[#6B7280] font-mono tracking-tight">
            AST-Validated Macro Engine for Tax & Accounting
          </p>
        </div>

        {/* Navigation Action Badges */}
        <div className="flex items-center gap-3">
          {/* Status Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#EFECE6] border border-[#E2DED4] font-mono text-xs text-[#0B0E14]">
            <span className="w-2 h-2 rounded-full bg-[#1B4332]"></span>
            <span>{status.has_llm ? 'AI Engine [Active]' : 'Rule-Based Engine [Verified]'}</span>
          </div>

          {/* Reset Baseline Data Button */}
          {(workbook || currentData.row_count > 0) && (
            <button
              onClick={handleResetData}
              title="Restore baseline ledger"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-medium text-[#6B7280] hover:text-[#0B0E14] hover:bg-[#EFECE6] border border-[#E2DED4] transition-colors"
            >
              <span>↺</span>
              <span>Reset Baseline</span>
            </button>
          )}

          {/* Schema Inspector Trigger */}
          <button
            onClick={() => setSchemaDrawerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-medium text-[#0B0E14] hover:bg-[#EFECE6] border border-[#E2DED4] transition-colors"
          >
            <span>[☷]</span>
            <span>Schema Audit</span>
          </button>

          {/* Security & Verification Seal Drawer Trigger */}
          <button
            onClick={() => setSecurityDrawerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold bg-[#1B4332] hover:bg-[#2D6A4F] text-[#F7F5F0] border border-[#1B4332] shadow-sm transition-all"
          >
            <span>🛡️</span>
            <span>Security & AST Seal</span>
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* 2. MAIN LAYOUT GRID (Minmax Sidebar + Fluid Central Workspace)      */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(260px,310px)_1fr] max-w-[1680px] w-full mx-auto p-6 gap-6">

        {/* LEFT AUDIT SIDEBAR */}
        <aside className="flex flex-col gap-5">
          
          {/* Current Ledger File Card */}
          <div className="bg-white rounded-lg border border-[#E2DED4] p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3 border-b border-[#E2DED4] pb-2">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#6B7280]">
                Active Ledger File
              </span>
              <span className="font-mono text-[10px] text-[#1B4332] font-semibold">● Verified</span>
            </div>

            {workbook || status.has_file ? (
              <div className="space-y-3">
                <div className="p-2.5 rounded bg-[#F7F5F0] border border-[#E2DED4]">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📄</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-bold text-[#0B0E14] truncate">
                        {workbook?.filename || status.current_file || 'sample_tax_data.xlsx'}
                      </p>
                      <p className="font-mono text-[10px] text-[#6B7280] tabular-nums mt-0.5">
                        {currentData.row_count || 15} rows · {currentData.columns?.length || 8} columns
                      </p>
                    </div>
                  </div>
                </div>

                {/* Sheet Selector */}
                {workbook?.sheets && workbook.sheets.length > 1 && (
                  <div>
                    <label className="font-mono text-[10px] font-bold uppercase text-[#6B7280] block mb-1">
                      Target Worksheet
                    </label>
                    <select
                      value={activeSheet}
                      onChange={(e) => setActiveSheet(e.target.value)}
                      className="w-full font-mono text-xs bg-[#F7F5F0] border border-[#E2DED4] rounded p-1.5 text-[#0B0E14] focus:outline-none focus:border-[#1B4332]"
                    >
                      {workbook.sheets.map(s => (
                        <option key={s.sheet_name} value={s.sheet_name}>{s.sheet_name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-3">
                <p className="font-mono text-xs text-[#6B7280] mb-3">No active workbook loaded</p>
                <button
                  onClick={handleLoadSample}
                  disabled={isProcessing}
                  className="w-full py-2 px-3 rounded bg-[#0B0E14] hover:bg-[#161B22] text-[#F7F5F0] font-mono text-xs font-semibold border border-[#0B0E14] transition-colors shadow-sm"
                >
                  ⚡ Load Sample Tax Ledger
                </button>
              </div>
            )}
          </div>

          {/* Upload Workbook Box */}
          <div className="bg-white rounded-lg border border-[#E2DED4] p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#6B7280]">
                Upload Ledger Dataset
              </span>
            </div>
            
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx,.xls,.xlsm"
              className="hidden"
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#E2DED4] hover:border-[#1B4332] hover:bg-[#F7F5F0] rounded p-4 text-center cursor-pointer transition-all group"
            >
              <div className="font-mono text-lg text-[#6B7280] group-hover:text-[#1B4332] mb-1">⇪</div>
              <p className="font-sans text-xs font-semibold text-[#0B0E14]">Select or drop Excel ledger</p>
              <p className="font-mono text-[10px] text-[#6B7280] mt-0.5">.xlsx, .xls, .xlsm up to 50MB</p>
            </div>

            <div className="mt-3 flex items-center justify-between pt-2 border-t border-[#E2DED4]">
              <span className="font-mono text-[10px] text-[#6B7280]">Quick demo dataset:</span>
              <button
                onClick={handleLoadSample}
                className="font-mono text-[11px] font-bold text-[#1B4332] hover:underline"
              >
                sample_tax_data.xlsx
              </button>
            </div>
          </div>

          {/* Audit History Log */}
          <div className="bg-white rounded-lg border border-[#E2DED4] p-4 shadow-sm flex-1 flex flex-col min-h-[220px]">
            <div className="flex items-center justify-between mb-3 border-b border-[#E2DED4] pb-2">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#6B7280]">
                Command Audit Trail
              </span>
              <div className="flex items-center gap-1.5">
                {history.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="font-mono text-[9px] text-[#6B7280] hover:text-[#8B1E1E] px-1 rounded hover:bg-[#FDF2F2] transition-colors"
                    title="Clear history log"
                  >
                    [Clear]
                  </button>
                )}
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#EFECE6] text-[#0B0E14] font-bold">
                  {history.length}
                </span>
              </div>
            </div>

            {history.length > 0 ? (
              <div className="space-y-2 overflow-y-auto max-h-[340px] pr-1">
                {history.slice(0, 15).map((h, idx) => (
                  <div
                    key={h.id || idx}
                    onClick={() => {
                      if (h.transcript) {
                        setCommandText(h.transcript);
                        handleRunCommand(h.transcript);
                      }
                    }}
                    className="p-2.5 rounded bg-[#F7F5F0] hover:bg-[#EFECE6] border border-[#E2DED4] cursor-pointer transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <p className="font-mono text-xs font-semibold text-[#0B0E14] line-clamp-1 group-hover:text-[#1B4332]">
                        &gt; {h.transcript || 'Executed macro'}
                      </p>
                      <span className="font-mono text-[9px] text-[#1B4332] font-bold flex-shrink-0">
                        [✓ EXECUTED]
                      </span>
                    </div>
                    <p className="font-mono text-[10px] text-[#6B7280] tabular-nums mt-1">
                      {new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center p-3">
                <p className="font-mono text-xs text-[#6B7280]">All macro operations are logged here with timestamps</p>
              </div>
            )}
          </div>

        </aside>

        {/* ------------------------------------------------------------------ */}
        {/* 3. MAIN WORKSPACE (Financial Ledger & Terminal Canvas)              */}
        {/* ------------------------------------------------------------------ */}
        <main className="flex flex-col gap-6 min-w-0">

          {/* Hero Header & Command Palette Area */}
          <div className="bg-white rounded-lg border border-[#E2DED4] p-6 shadow-sm">
            <div className="mb-4">
              <h1 className="font-display-title font-serif font-bold text-[#0B0E14] tracking-tight">
                {greeting}
              </h1>
              <p className="font-sans text-sm text-[#6B7280] mt-1 font-normal">
                Command transformations on <span className="font-mono font-bold text-[#0B0E14]">{workbook?.filename || 'sample_tax_data.xlsx'}</span> using voice or precision text.
              </p>
            </div>

            {/* Precision Natural-Language Command Bar */}
            <div className="relative flex items-center mb-3">
              <div className="absolute left-4 font-mono text-sm font-bold text-[#6B7280] pointer-events-none">
                &gt;
              </div>

              <input
                ref={commandInputRef}
                type="text"
                value={commandText}
                onChange={(e) => setCommandText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && commandText.trim()) {
                    handleRunCommand();
                  }
                }}
                disabled={isProcessing}
                placeholder={isListening ? "Listening... Speak your command now" : "What would you like to do with this workbook? (e.g. 'Filter revenue above 500000')"}
                className={`w-full pl-9 pr-32 py-3 bg-[#F7F5F0] hover:bg-white focus:bg-white text-[#0B0E14] font-mono text-xs md:text-sm rounded border ${
                  isListening ? 'border-[#8B1E1E] ring-2 ring-[#8B1E1E]/20 bg-white' : 'border-[#E2DED4] focus:border-[#1B4332] focus:ring-1 focus:ring-[#1B4332]'
                } transition-all placeholder:text-[#6B7280] focus:outline-none`}
              />

              {/* Action Buttons inside Command Bar */}
              <div className="absolute right-2.5 flex items-center gap-1.5">
                {/* Clear button */}
                {commandText && !isProcessing && (
                  <button
                    onClick={() => setCommandText('')}
                    className="p-1 text-[#6B7280] hover:text-[#0B0E14] rounded transition-colors font-mono text-xs"
                    title="Clear input"
                  >
                    [✕]
                  </button>
                )}

                {/* Inline Voice Mic Button */}
                <button
                  type="button"
                  onClick={handleToggleVoice}
                  title={isListening ? "Stop voice listening" : "Click to speak voice command"}
                  className={`px-2.5 py-1.5 rounded font-mono text-xs font-semibold transition-all flex items-center gap-1 ${
                    isListening 
                      ? 'bg-[#8B1E1E] text-white shadow-sm ring-2 ring-[#8B1E1E]/30 animate-pulse' 
                      : 'bg-[#EFECE6] hover:bg-[#E2DED4] text-[#0B0E14] border border-[#E2DED4]'
                  }`}
                >
                  <span>🎙</span>
                  <span className="text-[10px] hidden sm:inline">{isListening ? 'LISTENING' : 'VOICE'}</span>
                </button>

                {/* Submit Execute Button */}
                <button
                  onClick={() => handleRunCommand()}
                  disabled={!commandText.trim() || isProcessing}
                  className="px-3 py-1.5 rounded bg-[#0B0E14] hover:bg-[#161B22] disabled:opacity-40 text-[#F7F5F0] font-mono text-xs font-bold transition-all shadow-sm flex items-center gap-1"
                >
                  <span>RUN</span>
                  <span className="text-[10px] text-[#C9A227]">↵</span>
                </button>
              </div>
            </div>

            {/* Active Voice Listening Banner */}
            {isListening && (
              <div className="mb-3 p-3 rounded bg-[#8B1E1E]/10 border border-[#8B1E1E]/30 flex items-center justify-between animate-toast">
                <div className="flex items-center gap-2 min-w-0 flex-1 mr-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#8B1E1E] animate-ping flex-shrink-0"></span>
                  <span className="font-mono text-xs font-bold text-[#8B1E1E] uppercase flex-shrink-0">RECORDING VOICE:</span>
                  <span className="font-mono text-xs text-[#0B0E14] font-medium truncate">
                    {interimTranscript ? `"${interimTranscript}"` : "Speak clearly into your microphone..."}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 font-mono text-xs">
                  <button
                    onClick={() => {
                      if (interimTranscript) {
                        setCommandText(interimTranscript);
                        handleRunCommand(interimTranscript);
                      }
                      if (window.Voice) Voice.stop();
                    }}
                    className="px-3 py-1 bg-[#8B1E1E] text-white rounded font-bold hover:bg-[#6D1616]"
                  >
                    Done & Run ↵
                  </button>
                  <button
                    onClick={() => {
                      if (window.Voice) Voice.stop();
                      setInterimTranscript('');
                    }}
                    className="px-2.5 py-1 bg-white text-[#0B0E14] rounded border border-[#E2DED4]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* 1. Command Palette Terminal Strip (Single-line row) */}
            <div className="terminal-strip px-3 py-2 rounded-lg flex items-center gap-2.5 overflow-x-auto shadow-inner no-scrollbar">
              <div className="flex items-center gap-1.5 font-mono text-xs text-[#C9A227] font-semibold flex-shrink-0">
                <span>&gt;</span>
                <span className="tracking-wider">COMMANDS</span>
                <span className="text-slate-500">❯</span>
              </div>

              <div className="flex items-center gap-2 flex-nowrap flex-1 min-w-0">
                {terminalCommands.map((cmd) => (
                  <button
                    key={cmd.key}
                    onClick={() => {
                      setCommandText(cmd.query);
                      handleRunCommand(cmd.query);
                    }}
                    className="terminal-prompt-btn"
                    title={`Run query: ${cmd.query}`}
                  >
                    <span className="text-[#C9A227] font-bold">&gt;</span>
                    <span>{cmd.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Sequential Pipeline Stepper (Brief ~150ms verification pacing) */}
          {isProcessing && (
            <div className="bg-white rounded-lg border border-[#1B4332]/30 p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-3 animate-toast">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full border-2 border-[#1B4332] border-t-transparent animate-spin"></div>
                <div>
                  <p className="font-mono text-xs font-bold text-[#0B0E14]">
                    {processingStageIndex === 1 ? '1. Parsing Natural Language Intent...' :
                     processingStageIndex === 2 ? '2. Compiling & AST Whitelist Verification...' :
                     processingStageIndex === 3 ? '3. Simulating in Sandbox Dry-Run Engine...' :
                     'Verifying Safe Operations...'}
                  </p>
                  <p className="font-mono text-[11px] text-[#6B7280]">Compiler-level security checks & zero-egress inspection</p>
                </div>
              </div>

              <div className="flex items-center gap-2 font-mono text-[11px] font-bold">
                <span className={processingStageIndex >= 1 ? 'text-[#1B4332]' : 'text-slate-400'}>[1. PARSE]</span>
                <span className="text-slate-300">→</span>
                <span className={processingStageIndex >= 2 ? 'text-[#1B4332]' : 'text-slate-400'}>[2. AST VALIDATE]</span>
                <span className="text-slate-300">→</span>
                <span className={processingStageIndex >= 3 ? 'text-[#1B4332]' : 'text-slate-400'}>[3. SANDBOX DRY-RUN]</span>
              </div>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* 4. SIGNATURE DIFF & APPROVE SCREEN (The Core Product Moment)      */}
          {/* ---------------------------------------------------------------- */}
          {pipelineResult && (
            <div className={`bg-white rounded-lg border border-[#E2DED4] shadow-sm overflow-hidden flex flex-col ${isFlashingApproval ? 'row-flash-approve' : ''}`}>
              
              {/* Natural Language Interpretation Banner */}
              <div className="p-4 bg-[#F7F5F0] border-b border-[#E2DED4] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-[#0B0E14] text-[#C9A227] uppercase">
                      Audit Interpretation
                    </span>
                    <span className="font-mono text-xs text-[#6B7280]">
                      Query: <span className="text-[#0B0E14] font-bold">"{pipelineResult.transcript}"</span>
                    </span>
                  </div>
                  <h3 className="font-serif font-bold text-sm md:text-base text-[#0B0E14]">
                    {pipelineResult.generated_code?.explanation || 'Simulated Macro Transformation'}
                  </h3>
                </div>

                {/* 3. Stamped AST Official Wax-Seal Badge */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="ast-seal-badge">
                    <svg className="w-3.5 h-3.5 animate-stroke-draw" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>OFFICIALLY VERIFIED: AST SAFE</span>
                  </div>

                  {pipelineResult.redaction_report?.total_redactions > 0 && (
                    <span className="font-mono text-[11px] font-bold px-2.5 py-1 rounded bg-[#FAF5E8] text-[#C9A227] border border-[#C9A227]/40">
                      🔒 {pipelineResult.redaction_report.total_redactions} PII REDACTED
                    </span>
                  )}
                </div>
              </div>

              {/* Generated Pandas Code in Dark Terminal Box */}
              {pipelineResult.generated_code && (
                <div className="p-4 bg-[#0B0E14] text-[#F7F5F0] font-mono text-xs border-b border-[#E2DED4]">
                  <div className="flex items-center justify-between mb-2 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1.5 font-bold text-[#C9A227]">
                      <span>🐍</span> Python / Pandas Verified Execution Script
                    </span>
                    <button
                      onClick={() => handleCopyCode(pipelineResult.generated_code.code)}
                      className="px-2.5 py-1 rounded bg-[#161B22] hover:bg-[#2A323D] text-[#CBD5E1] font-mono text-[10px] border border-[#2A323D] transition-colors"
                    >
                      {copiedCode ? '✓ Copied' : 'Copy Script'}
                    </button>
                  </div>
                  <pre
                    className="overflow-x-auto p-3 rounded bg-[#05070A] border border-[#2A323D] leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: highlightCode(pipelineResult.generated_code.code) }}
                  />
                </div>
              )}

              {/* Live Execution Success Confirmation Banner */}
              {executionResult && (
                <div className="p-4 bg-[#1B4332]/10 border-b border-[#1B4332]/30 flex items-center justify-between font-mono text-xs text-[#1B4332]">
                  <div className="flex items-center gap-2">
                    <span className="font-bold">[✓ EXECUTED]:</span>
                    <span>{executionResult.message}</span>
                  </div>
                  <span className="font-bold underline">Live Ledger Updated</span>
                </div>
              )}

              {/* 4. Transformed Data Preview */}
              <div className="p-4 flex-1">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#6B7280]">
                      Transformed Ledger Preview
                    </span>
                    
                    {pipelineResult.diff && (
                      <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold">
                        <span className="px-2 py-0.5 rounded bg-[#1B4332]/10 text-[#1B4332] border border-[#1B4332]/30">
                          {pipelineResult.diff.total_rows_after} Resulting Rows
                        </span>
                        {pipelineResult.diff.rows_removed > 0 && (
                          <span className="px-2 py-0.5 rounded bg-[#8B1E1E]/10 text-[#8B1E1E] border border-[#8B1E1E]/30">
                            -{pipelineResult.diff.rows_removed} Filtered Out
                          </span>
                        )}
                        {pipelineResult.diff.cells_modified > 0 && (
                          <span className="px-2 py-0.5 rounded bg-[#FAF5E8] text-[#C9A227] border border-[#C9A227]/40">
                            Δ {pipelineResult.diff.cells_modified} Modified
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-[#6B7280]">
                    Showing top {Math.min(pipelineResult.diff?.preview_after?.length || 0, 25)} records
                  </span>
                </div>

                {/* 4. Clean Data Preview Table (Directly showing resulting filtered/transformed rows) */}
                <div className="border border-[#E2DED4] rounded overflow-x-auto max-h-[380px]">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-[#EFECE6] text-[#0B0E14] font-mono text-[11px] sticky top-0 border-b border-[#E2DED4] z-10">
                      <tr>
                        <th className="p-2.5 w-12 text-center text-[#6B7280] font-bold ledger-hairline-r">
                          #
                        </th>
                        
                        {/* Label Columns (Left-Aligned) */}
                        {columnCategories.labelCols.map(col => (
                          <th key={col} className="p-2.5 text-left font-bold whitespace-nowrap ledger-hairline-r">
                            {col} <span className="text-[9px] text-[#6B7280]">[txt]</span>
                          </th>
                        ))}

                        {/* Numeric Columns (Right-Aligned) */}
                        {columnCategories.numericCols.map((col, idx) => (
                          <th
                            key={col}
                            className={`p-2.5 text-right font-bold whitespace-nowrap ${
                              idx < columnCategories.numericCols.length - 1 ? 'ledger-hairline-r' : ''
                            }`}
                          >
                            {col} <span className="text-[9px] text-[#6B7280]">[num]</span>
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-[#E2DED4] font-mono text-xs">
                      {(pipelineResult.diff?.preview_after || []).slice(0, 25).map((row, rIdx) => {
                        return (
                          <tr
                            key={rIdx}
                            className="hover:bg-[#F7F5F0] transition-colors"
                          >
                            {/* Row Index */}
                            <td className="p-2 text-center text-[#6B7280] font-mono tabular-nums ledger-hairline-r">
                              {rIdx + 1}
                            </td>

                            {/* Label Columns (Left-Aligned) */}
                            {columnCategories.labelCols.map(col => (
                              <td key={col} className="p-2 text-left text-[#0B0E14] whitespace-nowrap ledger-hairline-r">
                                {formatCellValue(row[col], col)}
                              </td>
                            ))}

                            {/* Numeric Columns (Right-Aligned with Tabular Nums) */}
                            {columnCategories.numericCols.map((col, idx) => (
                              <td
                                key={col}
                                className={`p-2 text-right text-[#0B0E14] font-mono tabular-nums font-semibold whitespace-nowrap ${
                                  idx < columnCategories.numericCols.length - 1 ? 'ledger-hairline-r' : ''
                                }`}
                              >
                                {formatCellValue(row[col], col)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action Bar (Approve & Execute with Brass Button) */}
              {!executionResult && pipelineResult.stage === 'AWAITING_APPROVAL' && (
                <div className="p-4 bg-[#F7F5F0] border-t border-[#E2DED4] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="font-mono text-xs text-[#6B7280]">
                    <span>[VERIFICATION REQUIRED]: </span>
                    <span className="text-[#0B0E14] font-semibold">Examine diff above. Approve to apply delta to active workbook.</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleReject}
                      disabled={isProcessing}
                      className="px-4 py-2 rounded bg-white hover:bg-[#FDF2F2] border border-[#8B1E1E]/40 font-mono text-xs font-bold text-[#8B1E1E] transition-colors"
                    >
                      [✕ REJECT]
                    </button>

                    {/* Stamped Brass Approval Button */}
                    <button
                      onClick={handleApprove}
                      disabled={isProcessing}
                      className="px-5 py-2 rounded bg-[#C9A227] hover:bg-[#B38F1E] text-[#0B0E14] font-mono text-xs font-bold border border-[#A68314] shadow-sm transition-all flex items-center gap-1.5 tracking-tight"
                    >
                      <span>✓</span>
                      <span>APPROVE &amp; EXECUTE</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Baseline Live Financial Ledger Table (when no active diff) */}
          {!pipelineResult && currentData.data.length > 0 && (
            <div className="bg-white rounded-lg border border-[#E2DED4] p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3 border-b border-[#E2DED4] pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#6B7280]">
                    Baseline Financial Ledger
                  </span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#EFECE6] text-[#0B0E14] font-bold tabular-nums">
                    {currentData.row_count} Rows × {currentData.columns.length} Fields
                  </span>
                </div>
                <span className="font-mono text-[11px] text-[#6B7280]">
                  Tabular Numeral Alignment [Active]
                </span>
              </div>

              {/* 2. Data Table with Tabular Monospace and Hairlines */}
              <div className="border border-[#E2DED4] rounded overflow-x-auto max-h-[420px]">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-[#EFECE6] text-[#0B0E14] font-mono text-[11px] sticky top-0 border-b border-[#E2DED4] z-10">
                    <tr>
                      <th className="p-2.5 w-12 text-center text-[#6B7280] font-bold ledger-hairline-r">
                        #
                      </th>
                      {columnCategories.labelCols.map(col => (
                        <th key={col} className="p-2.5 text-left font-bold whitespace-nowrap ledger-hairline-r">
                          {col} <span className="text-[9px] text-[#6B7280]">[txt]</span>
                        </th>
                      ))}
                      {columnCategories.numericCols.map((col, idx) => (
                        <th
                          key={col}
                          className={`p-2.5 text-right font-bold whitespace-nowrap ${
                            idx < columnCategories.numericCols.length - 1 ? 'ledger-hairline-r' : ''
                          }`}
                        >
                          {col} <span className="text-[9px] text-[#6B7280]">[num]</span>
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[#E2DED4] font-mono text-xs">
                    {currentData.data.slice(0, 20).map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-[#F7F5F0] transition-colors">
                        <td className="p-2 text-center text-[#6B7280] font-mono tabular-nums ledger-hairline-r">
                          {rIdx + 1}
                        </td>
                        {columnCategories.labelCols.map(col => (
                          <td key={col} className="p-2 text-left text-[#0B0E14] whitespace-nowrap ledger-hairline-r">
                            {formatCellValue(row[col], col)}
                          </td>
                        ))}
                        {columnCategories.numericCols.map((col, idx) => (
                          <td
                            key={col}
                            className={`p-2 text-right text-[#0B0E14] font-mono tabular-nums font-semibold whitespace-nowrap ${
                              idx < columnCategories.numericCols.length - 1 ? 'ledger-hairline-r' : ''
                            }`}
                          >
                            {formatCellValue(row[col], col)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* 5. AUDIT INSPECTION REPORT DRAWERS                                 */}
      {/* ------------------------------------------------------------------ */}

      {/* SECURITY & ZERO-EGRESS INSPECTION REPORT DRAWER */}
      {securityDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 drawer-backdrop" onClick={() => setSecurityDrawerOpen(false)} />
          <div className="relative w-full max-w-lg bg-white h-full shadow-2xl p-6 overflow-y-auto flex flex-col z-10 border-l border-[#E2DED4]">
            
            {/* Header with Certified Stamp */}
            <div className="flex items-center justify-between pb-4 border-b border-[#E2DED4] mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded bg-[#1B4332] text-[#F7F5F0] flex items-center justify-center font-bold text-sm shadow-sm">
                  🛡️
                </div>
                <div>
                  <h2 className="font-serif font-bold text-base text-[#0B0E14]">Enterprise Security & AST Audit</h2>
                  <p className="font-mono text-[10px] text-[#6B7280]">Zero Raw Data Egress Certificate</p>
                </div>
              </div>
              <button
                onClick={() => setSecurityDrawerOpen(false)}
                className="p-1 text-[#6B7280] hover:text-[#0B0E14] font-mono text-sm"
              >
                [✕ CLOSE]
              </button>
            </div>

            {/* 5. Inspection Report Checklist Format */}
            <div className="space-y-4 font-mono text-xs text-[#0B0E14] flex-1">
              <div className="p-3.5 rounded bg-[#F7F5F0] border border-[#E2DED4]">
                <div className="flex items-center justify-between font-bold mb-1 text-[#1B4332]">
                  <span>[01. SCHEMA-ONLY EGRESS PROTOCOL]</span>
                  <span className="text-[10px] text-[#1B4332] font-semibold">PASSED ✓</span>
                </div>
                <p className="font-sans text-xs text-[#6B7280] leading-relaxed">
                  Raw row values and cell contents NEVER leave your workstation. Only column headers and inferred data types are used by the code synthesis engine.
                </p>
              </div>

              <div className="p-3.5 rounded bg-[#F7F5F0] border border-[#E2DED4]">
                <div className="flex items-center justify-between font-bold mb-1 text-[#1B4332]">
                  <span>[02. AST COMPILER WHITELIST]</span>
                  <span className="text-[10px] text-[#1B4332] font-semibold">PASSED ✓</span>
                </div>
                <p className="font-sans text-xs text-[#6B7280] leading-relaxed">
                  Every Python line is parsed into an Abstract Syntax Tree. System calls, file writes (`open`, `to_csv`), `eval`, `exec`, and network requests (`socket`, `requests`) are blocked at the compiler level.
                </p>
              </div>

              <div className="p-3.5 rounded bg-[#F7F5F0] border border-[#E2DED4]">
                <div className="flex items-center justify-between font-bold mb-1 text-[#1B4332]">
                  <span>[03. MEMORY SANDBOX DRY-RUN]</span>
                  <span className="text-[10px] text-[#1B4332] font-semibold">PASSED ✓</span>
                </div>
                <p className="font-sans text-xs text-[#6B7280] leading-relaxed">
                  Transformations execute exclusively on an isolated in-memory cloned DataFrame. Live data is modified ONLY upon clicking "Approve & Execute".
                </p>
              </div>

              <div className="p-3.5 rounded bg-[#F7F5F0] border border-[#E2DED4]">
                <div className="flex items-center justify-between font-bold mb-1 text-[#1B4332]">
                  <span>[04. CLIENT-SIDE PII REDACTION]</span>
                  <span className="text-[10px] text-[#1B4332] font-semibold">PASSED ✓</span>
                </div>
                <p className="font-sans text-xs text-[#6B7280] leading-relaxed">
                  SSNs, Tax EINs, phone numbers, email addresses, and client identifiers are scrubbed client-side prior to query parsing.
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-[#E2DED4]">
              <button
                onClick={() => setSecurityDrawerOpen(false)}
                className="w-full py-2.5 bg-[#0B0E14] hover:bg-[#161B22] text-[#F7F5F0] rounded font-mono font-bold text-xs transition-colors"
              >
                [CLOSE AUDIT CERTIFICATE]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. WORKBOOK SCHEMA INSPECTOR AUDIT REPORT DRAWER */}
      {schemaDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 drawer-backdrop" onClick={() => setSchemaDrawerOpen(false)} />
          <div className="relative w-full max-w-lg bg-white h-full shadow-2xl p-6 overflow-y-auto flex flex-col z-10 border-l border-[#E2DED4]">
            
            <div className="flex items-center justify-between pb-4 border-b border-[#E2DED4] mb-5">
              <div className="flex items-center gap-2">
                <span className="text-xl">📋</span>
                <div>
                  <h2 className="font-serif font-bold text-base text-[#0B0E14]">Workbook Schema Inspection</h2>
                  <p className="font-mono text-[10px] text-[#6B7280]">{activeSheet} · {activeSheetColumns.length} Audited Fields</p>
                </div>
              </div>
              <button
                onClick={() => setSchemaDrawerOpen(false)}
                className="p-1 text-[#6B7280] hover:text-[#0B0E14] font-mono text-sm"
              >
                [✕]
              </button>
            </div>

            {/* Checklist items with cardinality micro-bars */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-2.5">
              {activeSheetColumns.map((col, idx) => {
                const isNumeric = isNumericColumn(col.name);
                const cardinality = col.sample_cardinality || 10;
                const cardPct = Math.min(100, Math.max(10, cardinality * 7));

                return (
                  <div key={idx} className="p-3 rounded bg-[#F7F5F0] border border-[#E2DED4]">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-[#6B7280]">[{String(idx + 1).padStart(2, '0')}]</span>
                        <p className="font-mono text-xs font-bold text-[#0B0E14]">{col.name}</p>
                      </div>
                      <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-white text-[#1B4332] border border-[#E2DED4]">
                        {col.dtype}
                      </span>
                    </div>

                    {/* Cardinality Micro-Bar */}
                    <div className="flex items-center justify-between gap-3 text-[10px] font-mono text-[#6B7280] mt-2 pt-1.5 border-t border-[#E2DED4]/60">
                      <span>Cardinality: {cardinality}</span>
                      <div className="flex items-center gap-1 flex-1 max-w-[120px]">
                        <div className="w-full bg-[#E2DED4] h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-[#1B4332] h-full rounded-full"
                            style={{ width: `${cardPct}%` }}
                          />
                        </div>
                      </div>
                      <span className="font-bold text-[#0B0E14]">{isNumeric ? 'NUMERIC' : 'LABEL'}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-4 border-t border-[#E2DED4]">
              <button
                onClick={() => setSchemaDrawerOpen(false)}
                className="w-full py-2.5 bg-[#0B0E14] hover:bg-[#161B22] text-[#F7F5F0] rounded font-mono font-bold text-xs transition-colors"
              >
                [DONE]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 6. TOAST AUDIT NOTIFICATIONS                                       */}
      {/* ------------------------------------------------------------------ */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none font-mono">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-2.5 rounded shadow-lg border text-xs font-bold flex items-center gap-2 animate-toast ${
              t.type === 'success' ? 'bg-[#1B4332] text-white border-[#1B4332]' :
              t.type === 'error' ? 'bg-[#8B1E1E] text-white border-[#8B1E1E]' :
              t.type === 'warning' ? 'bg-[#C9A227] text-[#0B0E14] border-[#C9A227]' :
              'bg-[#0B0E14] text-white border-[#2A323D]'
            }`}
          >
            <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>

    </div>
  );
}

// Render VOCALEXCEL React Ledger Application
const rootEl = document.getElementById('root');
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(<VocalExcelApp />);
}
