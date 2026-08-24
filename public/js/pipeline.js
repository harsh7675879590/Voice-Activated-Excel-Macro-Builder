/**
 * Pipeline Module — Manages pipeline stage visualization and state transitions.
 */

const Pipeline = {
    stages: [
        { id: 'listening',       label: 'Voice',      icon: '🎤' },
        { id: 'transcribing',    label: 'Transcript',  icon: '📝' },
        { id: 'parsing_intent',  label: 'Intent',      icon: '🧠' },
        { id: 'extracting_schema', label: 'Schema',    icon: '📊' },
        { id: 'generating_code', label: 'Code Gen',    icon: '⚡' },
        { id: 'validating',      label: 'Validate',    icon: '🛡️' },
        { id: 'dry_running',     label: 'Dry Run',     icon: '🧪' },
        { id: 'awaiting_approval', label: 'Approve',   icon: '✅' },
    ],

    currentStageIndex: -1,
    container: null,

    /**
     * Initialize the pipeline visualization.
     */
    init(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;
        this.render();
    },

    /**
     * Render the pipeline stages.
     */
    render() {
        if (!this.container) return;

        let html = '<div class="pipeline-stages">';

        this.stages.forEach((stage, index) => {
            const state = this._getStageState(index);

            html += `
                <div class="pipeline-stage ${state}" data-stage="${stage.id}">
                    <div class="pipeline-node ${state}">
                        ${state === 'completed' ? '✓' : stage.icon}
                    </div>
                    <span class="pipeline-label">${stage.label}</span>
                </div>
            `;

            // Connector between stages (not after last)
            if (index < this.stages.length - 1) {
                const connState = index < this.currentStageIndex ? 'completed' :
                                  index === this.currentStageIndex ? 'active' : '';
                html += `<div class="pipeline-connector ${connState}"></div>`;
            }
        });

        html += '</div>';
        this.container.innerHTML = html;
    },

    /**
     * Set the current active stage.
     */
    setStage(stageId) {
        const index = this.stages.findIndex(s => s.id === stageId);
        if (index !== -1) {
            this.currentStageIndex = index;
            this.render();
        }
    },

    /**
     * Advance to the next stage.
     */
    advance() {
        if (this.currentStageIndex < this.stages.length - 1) {
            this.currentStageIndex++;
            this.render();
        }
    },

    /**
     * Set all stages to complete.
     */
    complete() {
        this.currentStageIndex = this.stages.length;
        this.render();
    },

    /**
     * Set error state on current stage.
     */
    setError() {
        if (this.container) {
            const activeNode = this.container.querySelector('.pipeline-node.active');
            if (activeNode) {
                activeNode.classList.remove('active');
                activeNode.classList.add('error');
            }
        }
    },

    /**
     * Reset pipeline to idle.
     */
    reset() {
        this.currentStageIndex = -1;
        this.render();
    },

    /**
     * Animate through stages automatically (for demo/processing).
     */
    async animateThrough(stages, delayMs = 300) {
        for (const stageId of stages) {
            this.setStage(stageId);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    },

    /**
     * Get the visual state of a stage.
     */
    _getStageState(index) {
        if (index < this.currentStageIndex) return 'completed';
        if (index === this.currentStageIndex) return 'active';
        return '';
    },
};
