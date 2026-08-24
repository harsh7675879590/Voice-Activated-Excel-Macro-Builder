/**
 * App Controller — Main application orchestrator.
 * Wires together all modules and manages the full pipeline flow.
 */

const App = {
    state: {
        hasFile: false,
        currentFile: null,
        currentSheet: null,
        pendingCode: null,
        pipelineResult: null,
        isProcessing: false,
    },

    /**
     * Initialize the application.
     */
    async init() {
        console.log('🚀 Voice Macro Builder initializing...');

        // Initialize modules
        Pipeline.init('pipeline-container');
        SchemaViewer.init('schema-container', {
            onSheetSelect: (sheetName) => this.handleSheetSelect(sheetName),
        });
        CodeDisplay.init('code-container');
        DiffViewer.init('diff-container');

        Voice.init({
            onTranscript: (text) => this.handleTranscript(text),
            onPartialTranscript: (text) => this.handlePartialTranscript(text),
            onStateChange: (state, message) => this.handleVoiceStateChange(state, message),
        });

        // Set up event listeners
        this._bindEvents();

        // Check server status
        await this._checkServerStatus();

        // Check if voice is supported
        if (!Voice.isSupported()) {
            this.showToast('Speech recognition not supported. Use the text input instead.', 'warning');
        }

        console.log('✅ Voice Macro Builder ready');
    },

    /**
     * Bind UI event listeners.
     */
    _bindEvents() {
        // Voice orb click
        const voiceOrb = document.getElementById('voice-orb');
        if (voiceOrb) {
            voiceOrb.addEventListener('click', () => this.toggleVoice());
        }

        // File upload
        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.handleFileUpload(e.target.files[0]);
                }
            });
        }

        // Upload zone drag & drop
        const uploadZone = document.getElementById('upload-zone');
        if (uploadZone) {
            uploadZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadZone.classList.add('dragover');
            });
            uploadZone.addEventListener('dragleave', () => {
                uploadZone.classList.remove('dragover');
            });
            uploadZone.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadZone.classList.remove('dragover');
                if (e.dataTransfer.files.length > 0) {
                    this.handleFileUpload(e.dataTransfer.files[0]);
                }
            });
        }

        // Sample data button
        const sampleBtn = document.getElementById('btn-sample-data');
        if (sampleBtn) {
            sampleBtn.addEventListener('click', () => this.loadSampleData());
        }

        // Approve button
        const approveBtn = document.getElementById('btn-approve');
        if (approveBtn) {
            approveBtn.addEventListener('click', () => this.approveCode());
        }

        // Reject button
        const rejectBtn = document.getElementById('btn-reject');
        if (rejectBtn) {
            rejectBtn.addEventListener('click', () => this.rejectCode());
        }

        // Text input (alternative to voice)
        const textInput = document.getElementById('text-command-input');
        if (textInput) {
            textInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && textInput.value.trim()) {
                    this.handleTranscript(textInput.value.trim());
                    textInput.value = '';
                }
            });
        }

        // Send button for text input
        const sendBtn = document.getElementById('btn-send-command');
        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                const textInput = document.getElementById('text-command-input');
                if (textInput && textInput.value.trim()) {
                    this.handleTranscript(textInput.value.trim());
                    textInput.value = '';
                }
            });
        }

        // Keyboard shortcut: Space to toggle voice
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && e.target === document.body) {
                e.preventDefault();
                this.toggleVoice();
            }
        });
    },

    /**
     * Check server connectivity.
     */
    async _checkServerStatus() {
        try {
            const status = await API.getStatus();
            this._updateStatusIndicator('connected', 'Connected');

            if (status.has_llm) {
                this._updateLLMBadge('AI Ready', true);
            } else {
                this._updateLLMBadge('Rule-Based', false);
            }

            if (status.has_file) {
                this.state.hasFile = true;
                this.state.currentFile = status.current_file;
            }
        } catch (error) {
            this._updateStatusIndicator('disconnected', 'Offline');
            this.showToast('Cannot connect to server. Start the backend with: python -m uvicorn backend.main:app --port 8000', 'error');
        }
    },

    /**
     * Toggle voice recording.
     */
    toggleVoice() {
        if (!this.state.hasFile) {
            this.showToast('Upload an Excel file or load sample data first', 'warning');
            return;
        }
        Voice.toggle();
    },

    /**
     * Handle final voice transcript.
     */
    async handleTranscript(transcript) {
        if (!transcript.trim() || this.state.isProcessing) return;

        if (!this.state.hasFile) {
            this.showToast('Upload an Excel file or load sample data first', 'warning');
            return;
        }

        // Update transcript display
        const transcriptEl = document.getElementById('transcript-display');
        if (transcriptEl) {
            transcriptEl.textContent = `"${transcript}"`;
            transcriptEl.classList.remove('empty');
            transcriptEl.classList.add('active');
        }

        // Process through pipeline
        await this.processCommand(transcript);
    },

    /**
     * Handle partial (interim) transcript.
     */
    handlePartialTranscript(text) {
        const transcriptEl = document.getElementById('transcript-display');
        if (transcriptEl) {
            transcriptEl.innerHTML = `<span style="opacity: 0.6">${text}</span><span class="typing-cursor"></span>`;
            transcriptEl.classList.remove('empty');
        }
    },

    /**
     * Handle voice state changes.
     */
    handleVoiceStateChange(state, message) {
        const orb = document.getElementById('voice-orb');
        const label = document.getElementById('voice-label');

        if (orb) {
            orb.classList.remove('listening', 'processing');
            if (state === 'listening') {
                orb.classList.add('listening');
            }
        }

        if (label) {
            const labels = {
                'listening': '🎤 Listening... Speak your command',
                'idle': 'Click to speak or press Space',
                'error': `⚠️ ${message || 'Error occurred'}`,
            };
            label.textContent = labels[state] || 'Click to speak';
            label.classList.toggle('active', state === 'listening');
        }

        if (state === 'listening') {
            Pipeline.setStage('listening');
        }

        if (state === 'error' && message) {
            this.showToast(message, 'error');
        }
    },

    /**
     * Process a voice command through the full pipeline.
     */
    async processCommand(transcript) {
        this.state.isProcessing = true;
        this._setProcessingUI(true);

        const orb = document.getElementById('voice-orb');
        if (orb) orb.classList.add('processing');

        try {
            // Animate pipeline stages
            const stages = ['transcribing', 'parsing_intent', 'extracting_schema', 
                           'generating_code', 'validating', 'dry_running'];
            
            // Start the pipeline animation
            let stageIndex = 0;
            const advanceInterval = setInterval(() => {
                if (stageIndex < stages.length) {
                    Pipeline.setStage(stages[stageIndex]);
                    stageIndex++;
                }
            }, 400);

            // Make API call
            const result = await API.processVoiceCommand(transcript, this.state.currentSheet);

            clearInterval(advanceInterval);

            this.state.pipelineResult = result;

            // Handle result
            if (result.stage === 'ERROR') {
                Pipeline.setError();
                this.showToast(result.error || 'Pipeline error occurred', 'error');
                CodeDisplay.clear();
                DiffViewer.clear();

                if (result.generated_code) {
                    CodeDisplay.showCode(result.generated_code);
                }
                if (result.validation) {
                    CodeDisplay.showValidation(result.validation);
                }
            } else if (result.stage === 'AWAITING_APPROVAL') {
                Pipeline.setStage('awaiting_approval');

                // Show generated code
                if (result.generated_code) {
                    CodeDisplay.showCode(result.generated_code);
                    this.state.pendingCode = result.generated_code.code;
                }

                // Show validation
                if (result.validation) {
                    CodeDisplay.showValidation(result.validation);
                }

                // Show diff
                if (result.diff) {
                    DiffViewer.showDiff(result.diff);
                }

                // Show PII redaction info
                if (result.redaction_report && result.redaction_report.total_redactions > 0) {
                    this._showRedactionInfo(result.redaction_report);
                }

                // Show approval bar
                this._showApprovalBar(true);

                this.showToast('Code generated! Review the diff and approve or reject.', 'info');
            }

            // Add to history display
            this._addToHistoryUI(transcript, result);

        } catch (error) {
            Pipeline.setError();
            this.showToast(error.message, 'error');
        } finally {
            this.state.isProcessing = false;
            this._setProcessingUI(false);
            if (orb) orb.classList.remove('processing');
        }
    },

    /**
     * Handle file upload.
     */
    async handleFileUpload(file) {
        if (!file.name.match(/\.(xlsx|xls|xlsm)$/i)) {
            this.showToast('Please upload an Excel file (.xlsx, .xls, .xlsm)', 'error');
            return;
        }

        this.showToast(`Uploading ${file.name}...`, 'info');

        try {
            const result = await API.uploadExcel(file);

            if (result.success) {
                this.state.hasFile = true;
                this.state.currentFile = result.schema.filename;
                this.state.currentSheet = result.schema.active_sheet;

                SchemaViewer.renderSchema(result.schema);
                this._updateStatusIndicator('connected', `${result.schema.filename}`);
                this._hideUploadZone();

                this.showToast(`Loaded ${file.name} — ${result.schema.sheets.length} sheet(s) found`, 'success');
            }
        } catch (error) {
            this.showToast(`Upload failed: ${error.message}`, 'error');
        }
    },

    /**
     * Load sample tax data for demo.
     */
    async loadSampleData() {
        try {
            this.showToast('Generating sample tax data...', 'info');
            const result = await API.generateSampleData();

            if (result.success) {
                this.state.hasFile = true;
                this.state.currentFile = result.schema.filename;
                this.state.currentSheet = result.schema.active_sheet;

                SchemaViewer.renderSchema(result.schema);
                this._updateStatusIndicator('connected', 'sample_tax_data.xlsx');
                this._hideUploadZone();

                this.showToast('Sample tax data loaded! Try a voice command.', 'success');
            }
        } catch (error) {
            this.showToast(`Failed to load sample data: ${error.message}`, 'error');
        }
    },

    /**
     * Handle sheet selection.
     */
    async handleSheetSelect(sheetName) {
        try {
            const result = await API.setActiveSheet(sheetName);
            if (result.success) {
                this.state.currentSheet = sheetName;
                this.showToast(`Switched to sheet: ${sheetName}`, 'info');
            }
        } catch (error) {
            this.showToast(`Failed to switch sheet: ${error.message}`, 'error');
        }
    },

    /**
     * Approve and execute the pending code.
     */
    async approveCode() {
        if (!this.state.pendingCode) return;

        try {
            this.showToast('Executing approved code...', 'info');
            Pipeline.complete();

            const result = await API.executeCode(this.state.pendingCode);

            if (result.success) {
                this.showToast(result.message, 'success');
                this._showApprovalBar(false);
                this.state.pendingCode = null;

                // Show execution result banner in code container
                this._showExecutionResult(result);

                // Show result preview in diff viewer
                if (result.result_preview && result.result_preview.length > 0) {
                    DiffViewer.showDiff({
                        preview_after: result.result_preview,
                        rows_added: 0,
                        rows_removed: 0,
                        cells_modified: 0,
                        changes: [],
                    });

                    // Scroll diff into view so user sees the result
                    const diffEl = document.getElementById('diff-container');
                    if (diffEl) {
                        diffEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            } else {
                this.showToast(result.message, 'error');
            }
        } catch (error) {
            this.showToast(`Execution failed: ${error.message}`, 'error');
        }
    },

    /**
     * Show a prominent execution result in the code panel.
     */
    _showExecutionResult(result) {
        const codeContainer = document.getElementById('code-container');
        if (!codeContainer) return;

        const resultDiv = document.createElement('div');
        resultDiv.className = 'animate-in';
        resultDiv.style.marginTop = '8px';
        resultDiv.innerHTML = `
            <div class="validation-result safe" style="padding: 12px; flex-direction: column; align-items: flex-start; gap: 6px;">
                <div style="display: flex; align-items: center; gap: 8px; width: 100%;">
                    <span style="font-size: 16px;">✅</span>
                    <strong style="font-size: 12px;">Execution Successful</strong>
                </div>
                <div style="font-size: 11px; opacity: 0.9; padding-left: 24px;">
                    ${this._escapeHtml(result.message)}
                </div>
            </div>
        `;
        codeContainer.appendChild(resultDiv);
    },

    /**
     * Reject the pending code.
     */
    async rejectCode() {
        try {
            await API.rejectCode();
            this.state.pendingCode = null;
            this._showApprovalBar(false);
            Pipeline.reset();
            CodeDisplay.clear();
            DiffViewer.clear();
            this.showToast('Changes rejected — no modifications made', 'info');
        } catch (error) {
            this.showToast(`Error: ${error.message}`, 'error');
        }
    },

    // -------------------------------------------------------------------
    // UI Helpers
    // -------------------------------------------------------------------

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️',
        };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toast-out 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },

    _updateStatusIndicator(state, text) {
        const dot = document.getElementById('status-dot');
        const label = document.getElementById('status-text');
        if (dot) {
            dot.className = 'status-dot';
            if (state === 'connected') dot.className = 'status-dot';
            else if (state === 'disconnected') dot.className = 'status-dot danger';
        }
        if (label) label.textContent = text;
    },

    _updateLLMBadge(text, isAI) {
        const badge = document.getElementById('llm-badge');
        if (badge) {
            badge.textContent = text;
            badge.style.background = isAI ? 'var(--accent-primary-soft)' : 'var(--glass-bg)';
            badge.style.color = isAI ? 'var(--accent-primary)' : 'var(--text-tertiary)';
        }
    },

    _setProcessingUI(isProcessing) {
        const orb = document.getElementById('voice-orb');
        const textInput = document.getElementById('text-command-input');
        const sendBtn = document.getElementById('btn-send-command');

        if (textInput) textInput.disabled = isProcessing;
        if (sendBtn) sendBtn.disabled = isProcessing;
    },

    _showApprovalBar(show) {
        const bar = document.getElementById('approval-bar');
        if (bar) {
            bar.style.display = show ? 'flex' : 'none';
            if (show) bar.classList.add('animate-in');
        }
    },

    _showRedactionInfo(report) {
        const container = document.getElementById('redaction-info');
        if (!container || report.total_redactions === 0) return;

        let html = `
            <div class="redaction-badge">
                🔒 ${report.total_redactions} PII redaction${report.total_redactions !== 1 ? 's' : ''} applied
            </div>
        `;

        if (report.entries && report.entries.length > 0) {
            html += '<div class="redaction-list">';
            report.entries.forEach(entry => {
                html += `
                    <div class="redaction-item">
                        <span class="category">${entry.category}</span>
                        <span>${entry.original_pattern} → ${entry.replacement}</span>
                    </div>
                `;
            });
            html += '</div>';
        }

        container.innerHTML = html;
        container.style.display = 'block';
    },

    _hideUploadZone() {
        const uploadZone = document.getElementById('upload-section');
        if (uploadZone) {
            uploadZone.style.display = 'none';
        }
    },

    _addToHistoryUI(transcript, result) {
        const container = document.getElementById('history-list');
        if (!container) return;

        // Remove empty state
        const emptyState = container.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const isSuccess = result.stage === 'AWAITING_APPROVAL' || result.stage === 'COMPLETE';
        const intentType = result.intent ? result.intent.intent_type : 'UNKNOWN';
        const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        const entry = document.createElement('div');
        entry.className = 'history-entry animate-in';
        entry.innerHTML = `
            <div class="history-icon ${isSuccess ? 'success' : 'rejected'}">
                ${isSuccess ? '✓' : '✗'}
            </div>
            <div class="history-content">
                <div class="history-command">"${this._escapeHtml(transcript)}"</div>
                <div class="history-meta">
                    ${intentType} • ${time}
                </div>
            </div>
        `;

        container.prepend(entry);
    },

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());
