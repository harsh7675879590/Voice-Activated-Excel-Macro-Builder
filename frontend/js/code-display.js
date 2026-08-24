/**
 * Code Display — Renders syntax-highlighted Python/Pandas code blocks.
 */

const CodeDisplay = {
    container: null,

    init(containerId) {
        this.container = document.getElementById(containerId);
    },

    /**
     * Display generated code with syntax highlighting.
     */
    showCode(generatedCode) {
        if (!this.container) return;

        const highlighted = this._highlightPython(generatedCode.code);

        this.container.innerHTML = `
            <div class="code-block animate-in">
                <div class="code-block-header">
                    <span class="code-block-lang">
                        ${generatedCode.language === 'pandas' ? '🐼 Pandas' : '📊 VBA'}
                    </span>
                    <button class="btn btn-sm" onclick="CodeDisplay.copyCode()" title="Copy code">
                        📋 Copy
                    </button>
                </div>
                <div class="code-block-body">
                    <pre>${highlighted}</pre>
                </div>
            </div>
            <div class="explanation-box animate-in animate-in-delay-1" style="margin-top: 8px;">
                <span class="icon">💡</span>
                ${this._escapeHtml(generatedCode.explanation)}
            </div>
        `;

        this._currentCode = generatedCode.code;
    },

    /**
     * Show validation result.
     */
    showValidation(validation) {
        if (!this.container) return;

        const validationDiv = document.createElement('div');
        validationDiv.className = 'animate-in';
        validationDiv.style.marginTop = '8px';

        if (validation.is_safe) {
            validationDiv.innerHTML = `
                <div class="validation-result safe">
                    <span>🛡️</span>
                    <span>AST Safety Check Passed — Code is safe to execute</span>
                </div>
            `;
        } else {
            const violations = validation.violations.map(v =>
                `<div style="padding: 2px 0;">• ${this._escapeHtml(v.message)}${v.line_number ? ` (line ${v.line_number})` : ''}</div>`
            ).join('');

            validationDiv.innerHTML = `
                <div class="validation-result unsafe">
                    <span>⚠️</span>
                    <div>
                        <strong>Safety Check Failed</strong>
                        <div style="margin-top: 4px; font-size: 10px; opacity: 0.9;">${violations}</div>
                    </div>
                </div>
            `;
        }

        // Show warnings if any
        if (validation.warnings && validation.warnings.length > 0) {
            const warnings = validation.warnings.map(w =>
                `<div style="padding: 2px 0;">• ${this._escapeHtml(w.message)}</div>`
            ).join('');

            validationDiv.innerHTML += `
                <div class="validation-result warning" style="margin-top: 6px;">
                    <span>⚡</span>
                    <div>
                        <strong>Warnings</strong>
                        <div style="margin-top: 4px; font-size: 10px; opacity: 0.9;">${warnings}</div>
                    </div>
                </div>
            `;
        }

        this.container.appendChild(validationDiv);
    },

    /**
     * Copy code to clipboard.
     */
    async copyCode() {
        if (this._currentCode) {
            try {
                await navigator.clipboard.writeText(this._currentCode);
                App.showToast('Code copied to clipboard', 'success');
            } catch {
                App.showToast('Failed to copy code', 'error');
            }
        }
    },

    /**
     * Clear the code display.
     */
    clear() {
        if (this.container) {
            this.container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">⚡</div>
                    <div class="empty-state-text">Generated code will appear here</div>
                </div>
            `;
        }
    },

    /**
     * Basic Python syntax highlighting.
     */
    _highlightPython(code) {
        let html = this._escapeHtml(code);

        // Keywords
        const keywords = ['import', 'from', 'def', 'return', 'if', 'else', 'elif',
            'for', 'in', 'while', 'not', 'and', 'or', 'is', 'None', 'True', 'False',
            'as', 'with', 'try', 'except', 'finally', 'raise', 'class', 'lambda',
            'yield', 'pass', 'break', 'continue', 'del', 'assert'];

        // Built-in functions
        const builtins = ['print', 'len', 'range', 'int', 'float', 'str', 'bool',
            'list', 'dict', 'tuple', 'set', 'sorted', 'round', 'abs', 'sum',
            'min', 'max', 'isinstance', 'type', 'enumerate', 'zip'];

        // Collect all tokens with their positions and classes.
        // Priority: strings > comments > operators > numbers > keywords > builtins > methods
        const tokens = [];
        const isOverlapping = (a, b) => a.start < b.end && b.start < a.end;
        const canAdd = (tok) => !tokens.some(t => isOverlapping(t, tok));

        const collect = (regex, className) => {
            let m;
            while ((m = regex.exec(html)) !== null) {
                const tok = { start: m.index, end: m.index + m[0].length, className };
                if (canAdd(tok)) tokens.push(tok);
            }
        };

        // 1. Strings (highest priority) — match HTML-escaped quotes
        collect(/(&#39;[^&#]*?&#39;|&quot;[^&]*?&quot;|'[^']*?'|"[^"]*?")/g, 'code-string');

        // 2. Comments
        collect(/(#.*)$/gm, 'code-comment');

        // 3. Operators — match escaped &lt; &gt; and plain = !
        collect(/(&lt;=|&gt;=|!=|==|&lt;|&gt;|=)/g, 'code-operator');

        // 4. Numbers
        collect(/\b(\d+\.?\d*)\b/g, 'code-number');

        // 5. Keywords
        keywords.forEach(kw => {
            collect(new RegExp(`\\b(${kw})\\b`, 'g'), 'code-keyword');
        });

        // 6. Built-in functions (followed by paren)
        builtins.forEach(fn => {
            collect(new RegExp(`\\b(${fn})(?=\\s*\\()`, 'g'), 'code-builtin');
        });

        // 7. Method calls — .methodName(
        {
            const methodRegex = /\.(\w+)\s*(?=\()/g;
            let m;
            while ((m = methodRegex.exec(html)) !== null) {
                const tok = { start: m.index + 1, end: m.index + 1 + m[1].length, className: 'code-function' };
                if (canAdd(tok)) tokens.push(tok);
            }
        }

        // Sort tokens by start position descending so we can insert from end
        tokens.sort((a, b) => b.start - a.start);

        // Insert span tags from end to start (preserves earlier indices)
        for (const tok of tokens) {
            const before = html.substring(0, tok.start);
            const content = html.substring(tok.start, tok.end);
            const after = html.substring(tok.end);
            html = before + `<span class="${tok.className}">` + content + '</span>' + after;
        }

        return html;
    },

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};
