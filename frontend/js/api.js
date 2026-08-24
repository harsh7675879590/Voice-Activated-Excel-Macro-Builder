/**
 * API Client — Handles all communication between frontend and backend.
 * Wraps fetch calls with error handling and base URL management.
 */

const API = {
    BASE_URL: window.location.origin,

    async request(endpoint, options = {}) {
        const url = `${this.BASE_URL}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
            ...options,
        };

        // Remove Content-Type for FormData
        if (options.body instanceof FormData) {
            delete config.headers['Content-Type'];
        }

        try {
            const response = await fetch(url, config);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ detail: response.statusText }));
                throw new Error(errorData.detail || `HTTP ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            if (error.message === 'Failed to fetch') {
                throw new Error('Cannot connect to server. Make sure the backend is running on port 8000.');
            }
            throw error;
        }
    },

    // Status
    async getStatus() {
        return this.request('/api/status');
    },

    // File Upload
    async uploadExcel(file) {
        const formData = new FormData();
        formData.append('file', file);
        return this.request('/api/upload-excel', {
            method: 'POST',
            body: formData,
        });
    },

    // Set Active Sheet
    async setActiveSheet(sheetName) {
        return this.request('/api/set-active-sheet', {
            method: 'POST',
            body: JSON.stringify({ sheet_name: sheetName }),
        });
    },

    // Process Voice Command
    async processVoiceCommand(transcript, activeSheet = null) {
        return this.request('/api/process-voice', {
            method: 'POST',
            body: JSON.stringify({
                transcript,
                active_sheet: activeSheet,
            }),
        });
    },

    // Execute Approved Code
    async executeCode(code, language = 'pandas', transcript = '') {
        return this.request('/api/execute', {
            method: 'POST',
            body: JSON.stringify({ code, language, transcript }),
        });
    },

    // Reject Code
    async rejectCode() {
        return this.request('/api/reject', {
            method: 'POST',
        });
    },

    // Reset Data to original unmodified state
    async resetData() {
        return this.request('/api/reset-data', {
            method: 'POST',
        });
    },

    // Clear History
    async clearHistory() {
        return this.request('/api/clear-history', {
            method: 'POST',
        });
    },

    // Get History
    async getHistory() {
        return this.request('/api/history');
    },

    // Get Current Data Preview
    async getCurrentData() {
        return this.request('/api/current-data');
    },

    // Generate Sample Data
    async generateSampleData() {
        return this.request('/api/generate-sample', {
            method: 'POST',
        });
    },
};
