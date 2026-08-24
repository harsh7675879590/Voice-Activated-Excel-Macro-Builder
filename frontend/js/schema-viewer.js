/**
 * Schema Viewer — Renders schema cards for uploaded Excel workbooks.
 */

const SchemaViewer = {
    container: null,
    schema: null,
    activeSheet: null,
    onSheetSelect: null,

    init(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.onSheetSelect = options.onSheetSelect || (() => {});
    },

    /**
     * Render the workbook schema.
     */
    renderSchema(workbookSchema) {
        if (!this.container) return;

        this.schema = workbookSchema;
        this.activeSheet = workbookSchema.active_sheet;

        let html = '';

        // File info
        html += `
            <div class="file-info animate-in">
                <span class="file-info-icon">📗</span>
                <div>
                    <div class="file-info-name">${this._escapeHtml(workbookSchema.filename)}</div>
                    <div class="file-info-meta">${workbookSchema.sheets.length} sheet${workbookSchema.sheets.length !== 1 ? 's' : ''}</div>
                </div>
            </div>
        `;

        // Sheet cards
        html += '<div style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">';

        workbookSchema.sheets.forEach((sheet, index) => {
            const isActive = sheet.sheet_name === this.activeSheet;
            html += this._renderSheetCard(sheet, isActive, index);
        });

        html += '</div>';

        this.container.innerHTML = html;

        // Bind click events
        this.container.querySelectorAll('.schema-card').forEach(card => {
            card.addEventListener('click', () => {
                const sheetName = card.dataset.sheet;
                this.setActiveSheet(sheetName);
                this.onSheetSelect(sheetName);
            });
        });
    },

    /**
     * Set the active sheet.
     */
    setActiveSheet(sheetName) {
        this.activeSheet = sheetName;
        this.container.querySelectorAll('.schema-card').forEach(card => {
            card.classList.toggle('active', card.dataset.sheet === sheetName);
        });
    },

    /**
     * Render a single sheet card.
     */
    _renderSheetCard(sheet, isActive, index) {
        const dtypeColors = {
            'int64': '#f78c6c',
            'float64': '#f78c6c',
            'string': '#c3e88d',
            'datetime64': '#82aaff',
            'bool': '#c792ea',
        };

        let columnsHtml = sheet.columns.map(col => {
            const color = dtypeColors[col.dtype] || '#89ddff';
            return `
                <div class="schema-column">
                    <span class="schema-col-name">${this._escapeHtml(col.name)}</span>
                    <span class="schema-col-type" style="color: ${color}">${col.dtype}</span>
                </div>
            `;
        }).join('');

        return `
            <div class="schema-card ${isActive ? 'active' : ''} animate-in animate-in-delay-${index + 1}" 
                 data-sheet="${this._escapeHtml(sheet.sheet_name)}">
                <div class="schema-card-header">
                    <span class="schema-sheet-name">
                        📄 ${this._escapeHtml(sheet.sheet_name)}
                    </span>
                    <span class="schema-row-count">${sheet.row_count.toLocaleString()} rows</span>
                </div>
                <div class="schema-columns">
                    ${columnsHtml}
                </div>
            </div>
        `;
    },

    /**
     * Clear the schema display.
     */
    clear() {
        if (this.container) {
            this.container.innerHTML = '';
            this.schema = null;
            this.activeSheet = null;
        }
    },

    /**
     * Escape HTML entities.
     */
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};
