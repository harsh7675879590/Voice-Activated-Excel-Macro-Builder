/**
 * VoiceMacro — React SaaS Application
 * Linear / Stripe / Raycast inspired productivity interface
 */

const { useState, useEffect, useRef, useMemo } = React;

// ---------------------------------------------------------------------------
// Syntax Highlighting Helper for Pandas Code
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
// Main Application Component
// ---------------------------------------------------------------------------
function VoiceMacroApp() {
  // App state
  const [status, setStatus] = useState({ status: 'ready', has_file: false, has_llm: false });
  const [workbook, setWorkbook] = useState(null); // WorkbookSchema
  const [activeSheet, setActiveSheet] = useState('Tax_Data');
  const [currentData, setCurrentData] = useState({ data: [], columns: [], row_count: 0 });
  const [history, setHistory] = useState([]);

  // Command & Pipeline state
  const [commandText, setCommandText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState(''); // 'Analyzing' | 'Generating' | 'Validating' | 'Dry-running'
  const [pipelineResult, setPipelineResult] = useState(null);
  const [executionResult, setExecutionResult] = useState(null);

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

    // Voice setup
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

    // Keyboard shortcut (Ctrl+K or Cmd+K to focus search)
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
        await fetchCurrentData();
        setPipelineResult(null);
        setExecutionResult(null);
        showToast('Sample tax dataset loaded (15 clients, 8 attributes)', 'success');
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
    showToast(`Uploading ${file.name}...`, 'info');
    try {
      const res = await API.uploadExcel(file);
      if (res.success) {
        setWorkbook(res.schema);
        setActiveSheet(res.schema.active_sheet);
        await fetchCurrentData();
        setPipelineResult(null);
        setExecutionResult(null);
        showToast(`Loaded ${file.name} successfully`, 'success');
      }
    } catch (err) {
      showToast(`Upload failed: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Reset Data
  const handleResetData = async () => {
    try {
      const res = await API.resetData();
      if (res.success) {
        if (res.schema) setWorkbook(res.schema);
        await fetchCurrentData();
        setPipelineResult(null);
        setExecutionResult(null);
        showToast('Data reset back to original state', 'success');
      }
    } catch (err) {
      showToast(`Reset failed: ${err.message}`, 'error');
    }
  };

  // Voice Toggle
  const handleToggleVoice = async () => {
    // If no dataset loaded, auto-load sample data first
    if (!status.has_file && !workbook) {
      showToast('Loading sample dataset for voice command...', 'info');
      try {
        const res = await API.generateSampleData();
        if (res.success) {
          setWorkbook(res.schema);
          setActiveSheet(res.schema.active_sheet || 'Tax_Data');
          await fetchCurrentData();
        }
      } catch (e) {}
    }

    const voiceEngine = window.Voice || (typeof Voice !== 'undefined' ? Voice : null);
    if (voiceEngine) {
      if (!voiceEngine.isSupported()) {
        showToast('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.', 'warning');
        return;
      }
      voiceEngine.toggle();
    } else {
      showToast('Voice engine initializing...', 'info');
    }
  };

  // Run Command
  const handleRunCommand = async (textToRun) => {
    const query = textToRun || commandText;
    if (!query.trim() || isProcessing) return;

    if (!status.has_file && !workbook) {
      showToast('Please load sample data or upload an Excel file first', 'warning');
      return;
    }

    setIsProcessing(true);
    setExecutionResult(null);
    setPipelineResult(null);

    // Compact stepper stages
    setProcessingStage('Analyzing intent...');
    await new Promise(r => setTimeout(r, 120));
    setProcessingStage('Generating Pandas code...');
    await new Promise(r => setTimeout(r, 120));
    setProcessingStage('AST Safety validation...');

    try {
      const res = await API.processVoiceCommand(query, activeSheet);
      setProcessingStage('Dry-run sandbox...');
      await new Promise(r => setTimeout(r, 100));

      if (res.stage === 'ERROR') {
        showToast(res.error || 'Operation error', 'error');
        setPipelineResult(res);
      } else {
        setPipelineResult(res);
        showToast('Transformation generated. Review preview and approve.', 'info');
      }
      fetchHistory();
    } catch (err) {
      showToast(`Command error: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
      setProcessingStage('');
    }
  };

  // Approve & Execute
  const handleApprove = async () => {
    if (!pipelineResult?.generated_code?.code) return;
    setIsProcessing(true);
    try {
      const code = pipelineResult.generated_code.code;
      const transcript = pipelineResult.transcript || commandText;
      const res = await API.executeCode(code, 'pandas', transcript);
      if (res.success) {
        setExecutionResult(res);
        if (res.updated_schema || res.schema) {
          setWorkbook(res.updated_schema || res.schema);
        }
        await fetchCurrentData();
        showToast('Execution successful! Live workbook updated.', 'success');
        fetchHistory();
      } else {
        showToast(res.message || 'Execution failed', 'error');
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
      showToast('Transformation rejected — no changes made', 'info');
    } catch (e) {}
  };

  // Copy Code
  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    showToast('Pandas code copied to clipboard', 'info');
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Greeting time
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // Contextual command suggestions
  const suggestions = [
    { label: 'Filter revenue > $500k', query: 'Filter revenue above 500000' },
    { label: 'Show pending clients', query: 'Show pending clients' },
    { label: 'Group by state & sum revenue', query: 'Group by state and sum the revenue' },
    { label: 'Calculate profit column', query: 'Calculate profit as gross revenue minus net revenue' },
  ];

  // Active sheet schema columns
  const activeSheetColumns = useMemo(() => {
    if (!workbook?.sheets) return [];
    const sheet = workbook.sheets.find(s => s.sheet_name === activeSheet) || workbook.sheets[0];
    return sheet?.columns || [];
  }, [workbook, activeSheet]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900">
      
      {/* ------------------------------------------------------------------ */}
      {/* 1. TOP NAVIGATION HEADER                                            */}
      {/* ------------------------------------------------------------------ */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm font-bold text-sm tracking-tighter">
            VM
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-900 text-sm tracking-tight">VoiceMacro</span>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                v2.0 SaaS
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-normal">AI Excel Macro Builder for Tax & Finance</p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2.5">
          {/* Connection Status Pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs text-slate-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>{status.has_llm ? 'AI Engine Ready' : 'Rule-Based Engine'}</span>
          </div>

          {/* Reset button (if data loaded) */}
          {(workbook || currentData.row_count > 0) && (
            <button
              onClick={handleResetData}
              title="Reset data back to raw unedited state"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Reset Data</span>
            </button>
          )}

          {/* Schema Inspector Drawer Trigger */}
          <button
            onClick={() => setSchemaDrawerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>Schema</span>
          </button>

          {/* Security Details Drawer Trigger */}
          <button
            onClick={() => setSecurityDrawerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Security</span>
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* 2. MAIN LAYOUT (240px Sidebar + Flexible Central Workspace)         */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex-1 flex max-w-[1600px] w-full mx-auto p-6 gap-6">

        {/* LEFT SIDEBAR (240px) */}
        <aside className="w-60 flex-shrink-0 flex flex-col gap-5">
          
          {/* Active Workbook Panel */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current Workbook</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" title="Active"></span>
            </div>

            {workbook || status.has_file ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5 p-2 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="w-8 h-8 rounded bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                    XLS
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900 truncate">
                      {workbook?.filename || status.current_file || 'sample_tax_data.xlsx'}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {currentData.row_count || 15} rows · {currentData.columns?.length || 8} cols
                    </p>
                  </div>
                </div>

                {/* Sheet Selector */}
                {workbook?.sheets && workbook.sheets.length > 1 && (
                  <div>
                    <label className="text-[11px] font-medium text-slate-500 block mb-1">Active Sheet</label>
                    <select
                      value={activeSheet}
                      onChange={(e) => setActiveSheet(e.target.value)}
                      className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-1.5 font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      {workbook.sheets.map(s => (
                        <option key={s.sheet_name} value={s.sheet_name}>{s.sheet_name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-xs text-slate-500 mb-3">No workbook loaded</p>
                <button
                  onClick={handleLoadSample}
                  disabled={isProcessing}
                  className="w-full py-2 px-3 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold border border-indigo-200 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Load Sample Data</span>
                </button>
              </div>
            )}
          </div>

          {/* Upload / Switch File Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Upload Dataset</span>
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
              className="border-2 border-dashed border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/50 rounded-lg p-4 text-center cursor-pointer transition-all group"
            >
              <svg className="w-6 h-6 text-slate-400 group-hover:text-indigo-600 mx-auto mb-1.5 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-xs font-medium text-slate-700">Drop Excel file here</p>
              <p className="text-[10px] text-slate-400 mt-0.5">.xlsx, .xls up to 50MB</p>
            </div>

            <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-[10px] text-slate-400">Demo dataset:</span>
              <button
                onClick={handleLoadSample}
                className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                Sample Tax Data
              </button>
            </div>
          </div>

          {/* Recent Command History */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex-1 flex flex-col min-h-[220px]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Audit History</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">
                {history.length}
              </span>
            </div>

            {history.length > 0 ? (
              <div className="space-y-2 overflow-y-auto max-h-[300px] pr-1">
                {history.slice(0, 10).map((h, idx) => (
                  <div
                    key={h.id || idx}
                    onClick={() => {
                      if (h.transcript) {
                        setCommandText(h.transcript);
                        handleRunCommand(h.transcript);
                      }
                    }}
                    className="p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 cursor-pointer transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-xs font-medium text-slate-800 line-clamp-1 group-hover:text-indigo-600">
                        {h.transcript || 'Executed operation'}
                      </p>
                      <span className="text-[9px] text-emerald-600 font-semibold flex-shrink-0">✓ Run</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center p-3">
                <p className="text-xs text-slate-400">Commands will be logged here with timestamps</p>
              </div>
            )}
          </div>

        </aside>

        {/* ------------------------------------------------------------------ */}
        {/* 3. MAIN WORKSPACE (Central Interaction Canvas)                     */}
        {/* ------------------------------------------------------------------ */}
        <main className="flex-1 flex flex-col gap-6 min-w-0">

          {/* Hero & Command Input Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="mb-4">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{greeting}, Analyst</h1>
              <p className="text-sm text-slate-500 mt-1 font-normal">
                Ask questions or command transformations for <span className="font-semibold text-slate-700">{workbook?.filename || 'sample_tax_data.xlsx'}</span> in natural language.
              </p>
            </div>

            {/* Primary Command Bar */}
            <div className="relative flex items-center">
              <div className="absolute left-4 text-slate-400 pointer-events-none">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
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
                placeholder={isListening ? "Listening... Speak your command" : "What would you like to do with this workbook? (e.g. 'Filter revenue above 500k')"}
                className={`w-full pl-12 pr-28 py-3.5 bg-slate-50 hover:bg-white focus:bg-white text-slate-900 text-sm font-medium rounded-xl border ${
                  isListening ? 'border-indigo-500 ring-2 ring-indigo-100 bg-white' : 'border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
                } transition-all placeholder:text-slate-400 focus:outline-none`}
              />

              {/* Action Buttons inside Command Bar */}
              <div className="absolute right-3 flex items-center gap-1.5">
                {/* Clear button */}
                {commandText && !isProcessing && (
                  <button
                    onClick={() => setCommandText('')}
                    className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}

                {/* Inline Microphone Button */}
                <button
                  type="button"
                  onClick={handleToggleVoice}
                  title={isListening ? "Stop listening" : "Click to speak voice command"}
                  className={`p-2 rounded-lg transition-all flex items-center justify-center ${
                    isListening 
                      ? 'bg-red-500 text-white shadow-sm ring-4 ring-red-100 animate-pulse' 
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>

                {/* Submit button */}
                <button
                  onClick={() => handleRunCommand()}
                  disabled={!commandText.trim() || isProcessing}
                  className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white transition-all shadow-sm flex items-center justify-center"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Active Voice Recording Bar */}
            {isListening && (
              <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between animate-toast">
                <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-3">
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping"></span>
                    <span className="text-[11px] font-bold text-red-700 uppercase tracking-wide">Listening:</span>
                  </div>
                  <span className="text-xs text-slate-800 font-medium truncate">
                    {interimTranscript ? `"${interimTranscript}"` : "Speak your transformation into microphone..."}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => {
                      if (interimTranscript) {
                        setCommandText(interimTranscript);
                        handleRunCommand(interimTranscript);
                      }
                      if (window.Voice) Voice.stop();
                    }}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
                  >
                    Done & Run
                  </button>
                  <button
                    onClick={() => {
                      if (window.Voice) Voice.stop();
                      setInterimTranscript('');
                    }}
                    className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-medium border border-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Contextual Suggestions Chips */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-slate-400 mr-1">Suggestions:</span>
              {suggestions.map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setCommandText(s.query);
                    handleRunCommand(s.query);
                  }}
                  className="text-xs font-medium px-3 py-1 rounded-full bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 transition-colors"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Compact Execution Stepper (When analyzing/generating) */}
          {isProcessing && (
            <div className="bg-white rounded-xl border border-indigo-100 p-4 shadow-sm flex items-center justify-between animate-toast">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin"></div>
                <div>
                  <p className="text-xs font-semibold text-slate-900">{processingStage || 'Processing transformation...'}</p>
                  <p className="text-[11px] text-slate-500">Analyzing schema & verifying AST security whitelist</p>
                </div>
              </div>

              {/* 4-step compact progress */}
              <div className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
                <span className="text-indigo-600 font-semibold">1. Parse Intent</span>
                <span>→</span>
                <span className="text-indigo-600 font-semibold">2. Generate</span>
                <span>→</span>
                <span className="text-indigo-600 font-semibold">3. Validate</span>
                <span>→</span>
                <span>4. Ready</span>
              </div>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* 4. RESULT AREA (Interpretation + Pandas Code + Data Preview)     */}
          {/* ---------------------------------------------------------------- */}
          {pipelineResult && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col gap-0">
              
              {/* Natural Language Interpretation Banner */}
              <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                    AI
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900">
                      {pipelineResult.generated_code?.explanation || pipelineResult.intent?.intent_type || 'Generated Transformation'}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Command: <span className="italic font-medium text-slate-700">"{pipelineResult.transcript}"</span>
                    </p>
                  </div>
                </div>

                {/* Validation Status Badges */}
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                    AST Whitelisted
                  </span>

                  {pipelineResult.redaction_report?.total_redactions > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      🔒 {pipelineResult.redaction_report.total_redactions} PII Redacted
                    </span>
                  )}
                </div>
              </div>

              {/* Generated Pandas Code Display */}
              {pipelineResult.generated_code && (
                <div className="p-4 bg-slate-900 text-slate-100 font-mono text-xs border-b border-slate-200">
                  <div className="flex items-center justify-between mb-2 text-[11px] text-slate-400 font-sans">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                      <span>🐼</span> Python / Pandas Macro
                    </span>
                    <button
                      onClick={() => handleCopyCode(pipelineResult.generated_code.code)}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium transition-colors"
                    >
                      {copiedCode ? '✓ Copied' : 'Copy Code'}
                    </button>
                  </div>
                  <pre
                    className="overflow-x-auto p-3 rounded-lg bg-slate-950/60 border border-slate-800 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: highlightCode(pipelineResult.generated_code.code) }}
                  />
                </div>
              )}

              {/* Execution Success Banner (if executed) */}
              {executionResult && (
                <div className="p-4 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between text-xs text-emerald-800">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-emerald-700">✅ Execution Successful:</span>
                    <span>{executionResult.message}</span>
                  </div>
                  <span className="font-semibold text-emerald-700">Live Data Updated</span>
                </div>
              )}

              {/* Data Diff Table Preview */}
              <div className="p-4 flex-1">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Data Preview</span>
                    {pipelineResult.diff && (
                      <div className="flex items-center gap-1 text-[11px]">
                        {pipelineResult.diff.rows_added > 0 && (
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">+{pipelineResult.diff.rows_added} added</span>
                        )}
                        {pipelineResult.diff.rows_removed > 0 && (
                          <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 font-medium">-{pipelineResult.diff.rows_removed} removed</span>
                        )}
                        {pipelineResult.diff.cells_modified > 0 && (
                          <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">~{pipelineResult.diff.cells_modified} modified</span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Showing top {pipelineResult.diff?.preview_after?.length || currentData.data?.length || 0} rows
                  </span>
                </div>

                {/* Table Component */}
                <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-[320px]">
                  <table className="w-full text-left text-xs font-normal border-collapse">
                    <thead className="bg-slate-100 text-slate-600 text-[11px] font-semibold sticky top-0 border-b border-slate-200 z-10">
                      <tr>
                        <th className="p-2.5 w-10 text-center text-slate-400">#</th>
                        {(pipelineResult.diff?.preview_after?.[0] ? Object.keys(pipelineResult.diff.preview_after[0]) : currentData.columns).map(col => (
                          <th key={col} className="p-2.5 whitespace-nowrap font-semibold">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                      {(pipelineResult.diff?.preview_after || currentData.data).slice(0, 15).map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-2.5 text-center text-slate-400 font-sans">{rIdx + 1}</td>
                          {Object.keys(row).map(col => (
                            <td key={col} className="p-2.5 text-slate-700 whitespace-nowrap">
                              {row[col] !== null ? String(row[col]) : <span className="text-slate-300 italic">null</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action Bar (Approve / Reject) */}
              {!executionResult && pipelineResult.stage === 'AWAITING_APPROVAL' && (
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                  <p className="text-xs text-slate-500 font-medium">
                    Review the preview above. Click Approve to apply this transformation to the live workbook.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleReject}
                      disabled={isProcessing}
                      className="px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors"
                    >
                      ✕ Reject
                    </button>
                    <button
                      onClick={handleApprove}
                      disabled={isProcessing}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white transition-colors shadow-sm flex items-center gap-1.5"
                    >
                      <span>✓ Approve & Execute</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Default Data Table (when no pending query) */}
          {!pipelineResult && currentData.data.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Live Workbook Table</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                    {currentData.row_count} rows × {currentData.columns.length} columns
                  </span>
                </div>
                <span className="text-[11px] text-slate-400">Showing first {Math.min(currentData.data.length, 15)} records</span>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-[360px]">
                <table className="w-full text-left text-xs font-normal border-collapse">
                  <thead className="bg-slate-100 text-slate-600 text-[11px] font-semibold sticky top-0 border-b border-slate-200 z-10">
                    <tr>
                      <th className="p-2.5 w-10 text-center text-slate-400">#</th>
                      {currentData.columns.map(col => (
                        <th key={col} className="p-2.5 whitespace-nowrap font-semibold">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                    {currentData.data.slice(0, 15).map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50 transition-colors">
                        <td className="p-2.5 text-center text-slate-400 font-sans">{rIdx + 1}</td>
                        {currentData.columns.map(col => (
                          <td key={col} className="p-2.5 text-slate-700 whitespace-nowrap">
                            {row[col] !== null ? String(row[col]) : <span className="text-slate-300 italic">null</span>}
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
      {/* 5. SLIDE-OVER DRAWERS                                              */}
      {/* ------------------------------------------------------------------ */}

      {/* SECURITY & PRIVACY DRAWER */}
      {securityDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 drawer-backdrop" onClick={() => setSecurityDrawerOpen(false)} />
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl p-6 overflow-y-auto flex flex-col z-10 border-l border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Security & Privacy Guardrails</h2>
                  <p className="text-[11px] text-slate-500">Zero raw data egress guarantee</p>
                </div>
              </div>
              <button
                onClick={() => setSecurityDrawerOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            {/* 4 Pillars */}
            <div className="space-y-4 text-xs text-slate-600 flex-1">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-2 font-semibold text-slate-900 mb-1">
                  <span className="text-indigo-600">🛡️</span> 1. Schema-Only Transmission
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Raw workbook cells NEVER leave your local machine. Only column names and data types are used for code generation.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-2 font-semibold text-slate-900 mb-1">
                  <span className="text-emerald-600">🔍</span> 2. AST Whitelist Security
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  All generated Python code passes through an Abstract Syntax Tree (AST) validator. File I/O, `eval`, `exec`, and system calls are strictly blocked.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-2 font-semibold text-slate-900 mb-1">
                  <span className="text-amber-600">🧪</span> 3. Dry-Run Sandbox
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Transformations execute on an in-memory cloned DataFrame first. Changes only touch live data when you explicitly click Approve.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-2 font-semibold text-slate-900 mb-1">
                  <span className="text-cyan-600">🔒</span> 4. Client-Side PII Redaction
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Client names, SSNs, EINs, phone numbers, and emails in voice transcripts are sanitized before parsing.
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <button
                onClick={() => setSecurityDrawerOpen(false)}
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold text-xs transition-colors"
              >
                Close Security Panel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WORKBOOK SCHEMA INSPECTOR DRAWER */}
      {schemaDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 drawer-backdrop" onClick={() => setSchemaDrawerOpen(false)} />
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl p-6 overflow-y-auto flex flex-col z-10 border-l border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Workbook Schema Inspector</h2>
                  <p className="text-[11px] text-slate-500">{activeSheet} · {activeSheetColumns.length} columns</p>
                </div>
              </div>
              <button
                onClick={() => setSchemaDrawerOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              <div className="space-y-2">
                {activeSheetColumns.map((col, idx) => (
                  <div key={idx} className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-900">{col.name}</p>
                      <p className="text-[10px] text-slate-400">Cardinality: {col.sample_cardinality || 'N/A'}</p>
                    </div>
                    <span className="font-mono text-[10px] font-medium px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {col.dtype}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <button
                onClick={() => setSchemaDrawerOpen(false)}
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold text-xs transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 6. TOAST NOTIFICATIONS CONTAINER                                   */}
      {/* ------------------------------------------------------------------ */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-2.5 rounded-lg shadow-lg border text-xs font-medium flex items-center gap-2 animate-toast ${
              t.type === 'success' ? 'bg-emerald-900 text-white border-emerald-800' :
              t.type === 'error' ? 'bg-red-900 text-white border-red-800' :
              t.type === 'warning' ? 'bg-amber-900 text-white border-amber-800' :
              'bg-slate-900 text-white border-slate-800'
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

// Render React App
const rootEl = document.getElementById('root');
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(<VoiceMacroApp />);
}
