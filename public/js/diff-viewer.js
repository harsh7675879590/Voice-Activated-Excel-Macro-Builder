/**
 * Diff Viewer — Renders side-by-side spreadsheet diff visualization.
 * Color-coded: green (added), red (removed), yellow (modified).
 */

const DiffViewer = {
    container: null,
    diffData: null,

    init(containerId) {
        this.container = document.getElementById(containerId);
    },

    /**
     * Render a diff result.
     */
    showDiff(diffResult) {
        if (!this.container) return;
        this.diffData = diffResult;

        const stats = this._renderStats(diffResult);
        const table = this._renderDiffTable(diffResult);

        this.container.innerHTML = `
            <div class="diff-viewer animate-in">
                <div class="diff-header">
                    <span style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">
                        📋 Data Preview — Changes
                    </span>
                    ${stats}
                </div>
                ${table}
            </div>
        `;
    },

    /**
     * Render diff statistics.
     */
    _renderStats(diff) {
        const parts = [];

        if (diff.rows_added > 0) {
            parts.push(`<span class="diff-stat added">+${diff.rows_added} rows</span>`);
        }
        if (diff.rows_removed > 0) {
            parts.push(`<span class="diff-stat removed">-${diff.rows_removed} rows</span>`);
        }
        if (diff.cells_modified > 0) {
            parts.push(`<span class="diff-stat modified">~${diff.cells_modified} cells</span>`);
        }

        if (parts.length === 0) {
            parts.push(`<span class="diff-stat" style="color: var(--text-tertiary);">No changes</span>`);
        }

        return `<div class="diff-stats">${parts.join('')}</div>`;
    },

    /**
     * Render the diff as a table comparing before and after.
     */
    _renderDiffTable(diff) {
        // Use the after preview (result data)
        const data = diff.preview_after;
        if (!data || data.length === 0) {
            return '<div class="empty-state"><div class="empty-state-text">No data to preview</div></div>';
        }

        // Get columns from data
        const columns = Object.keys(data[0]);

        // Build a map of changed cells for highlighting
        const changedCells = new Map();
        if (diff.changes) {
            diff.changes.forEach(change => {
                const key = `${change.row}-${change.column}`;
                changedCells.set(key, change.diff_type);
            });
        }

        // Table header
        let headerHtml = '<tr><th>#</th>';
        columns.forEach(col => {
            headerHtml += `<th>${this._escapeHtml(col)}</th>`;
        });
        headerHtml += '</tr>';

        // Table rows
        let rowsHtml = '';
        const maxRows = Math.min(data.length, 50);

        for (let i = 0; i < maxRows; i++) {
            const row = data[i];
            let rowClass = '';

            // Check if entire row is added/removed
            const rowDiffType = changedCells.get(`${i}-${columns[0]}`);
            if (rowDiffType === 'added') rowClass = 'diff-row-added';
            else if (rowDiffType === 'removed') rowClass = 'diff-row-removed';

            rowsHtml += `<tr class="${rowClass}">`;
            rowsHtml += `<td style="color: var(--text-tertiary); font-size: 10px;">${i + 1}</td>`;

            columns.forEach(col => {
                const cellKey = `${i}-${col}`;
                const cellDiffType = changedCells.get(cellKey);
                let cellClass = '';

                if (cellDiffType === 'added') cellClass = 'diff-cell-added';
                else if (cellDiffType === 'removed') cellClass = 'diff-cell-removed';
                else if (cellDiffType === 'modified') cellClass = 'diff-cell-modified';

                const value = row[col] ?? '';
                rowsHtml += `<td class="${cellClass}" title="${this._escapeHtml(String(value))}">
                    ${this._escapeHtml(this._truncate(String(value), 20))}
                </td>`;
            });

            rowsHtml += '</tr>';
        }

        if (data.length > maxRows) {
            rowsHtml += `<tr><td colspan="${columns.length + 1}" style="text-align: center; color: var(--text-tertiary); padding: 8px;">
                ... and ${data.length - maxRows} more rows
            </td></tr>`;
        }

        return `
            <div class="diff-table-wrapper">
                <table class="diff-table">
                    <thead>${headerHtml}</thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        `;
    },

    /**
     * Show the before/after comparison view.
     */
    showComparison(diffResult) {
        if (!this.container) return;

        const beforeTable = this._renderDataTable(diffResult.preview_before, 'Before');
        const afterTable = this._renderDataTable(diffResult.preview_after, 'After');

        this.container.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                ${beforeTable}
                ${afterTable}
            </div>
        `;
    },

    /**
     * Render a simple data table.
     */
    _renderDataTable(data, label) {
        if (!data || data.length === 0) {
            return `<div class="empty-state"><div class="empty-state-text">No ${label.toLowerCase()} data</div></div>`;
        }

        const columns = Object.keys(data[0]);

        let html = `
            <div style="border: 1px solid var(--glass-border); border-radius: var(--radius-md); overflow: hidden;">
                <div style="padding: 6px 10px; background: rgba(255,255,255,0.02); border-bottom: 1px solid var(--glass-border); font-size: 11px; font-weight: 600; color: var(--text-secondary);">
                    ${label}
                </div>
                <div class="diff-table-wrapper" style="max-height: 200px;">
                    <table class="diff-table">
                        <thead><tr>`;

        columns.forEach(col => {
            html += `<th>${this._escapeHtml(col)}</th>`;
        });

        html += '</tr></thead><tbody>';

        data.slice(0, 30).forEach(row => {
            html += '<tr>';
            columns.forEach(col => {
                const val = row[col] ?? '';
                html += `<td>${this._escapeHtml(this._truncate(String(val), 15))}</td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table></div></div>';
        return html;
    },

    /**
     * Clear the diff viewer.
     */
    clear() {
        if (this.container) {
            this.container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📋</div>
                    <div class="empty-state-text">Data diff preview will appear here</div>
                </div>
            `;
        }
    },

    _truncate(str, maxLen) {
        return str.length > maxLen ? str.substring(0, maxLen) + '…' : str;
    },

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};
