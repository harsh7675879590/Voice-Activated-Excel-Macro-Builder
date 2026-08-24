/**
 * Voice Module — Handles voice recording, Web Speech API integration,
 * and real-time audio waveform visualization.
 */

const Voice = {
    isListening: false,
    recognition: null,
    audioContext: null,
    analyser: null,
    microphone: null,
    waveformCanvas: null,
    waveformCtx: null,
    animationFrame: null,
    onTranscript: null,
    onPartialTranscript: null,
    onStateChange: null,

    /**
     * Initialize the voice module.
     */
    init(options = {}) {
        this.onTranscript = options.onTranscript || (() => {});
        this.onPartialTranscript = options.onPartialTranscript || (() => {});
        this.onStateChange = options.onStateChange || (() => {});

        // Initialize Web Speech API
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';
            this.recognition.maxAlternatives = 1;

            this.recognition.onresult = (event) => this._handleResult(event);
            this.recognition.onerror = (event) => this._handleError(event);
            this.recognition.onend = () => this._handleEnd();
            this.recognition.onstart = () => this._handleStart();
        }

        // Set up waveform canvas
        this.waveformCanvas = document.getElementById('waveform-canvas');
        if (this.waveformCanvas) {
            this.waveformCtx = this.waveformCanvas.getContext('2d');
            this._resizeCanvas();
            window.addEventListener('resize', () => this._resizeCanvas());
            this._drawIdleWaveform();
        }
    },

    /**
     * Check if speech recognition is supported.
     */
    isSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    },

    /**
     * Toggle listening state.
     */
    toggle() {
        if (this.isListening) {
            this.stop();
        } else {
            this.start();
        }
    },

    /**
     * Start listening.
     */
    async start() {
        // Re-initialize SpeechRecognition if needed
        if (!this.recognition) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                this.recognition = new SpeechRecognition();
                this.recognition.continuous = false;
                this.recognition.interimResults = true;
                this.recognition.lang = 'en-US';
                this.recognition.maxAlternatives = 1;

                this.recognition.onresult = (event) => this._handleResult(event);
                this.recognition.onerror = (event) => this._handleError(event);
                this.recognition.onend = () => this._handleEnd();
                this.recognition.onstart = () => this._handleStart();
            }
        }

        if (!this.recognition) {
            if (this.onStateChange) {
                this.onStateChange('error', 'Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
            }
            return;
        }

        try {
            // Start speech recognition directly first
            this.recognition.start();
            this.isListening = true;
            if (this.onStateChange) {
                this.onStateChange('listening');
            }

            // Start audio waveform in background without blocking
            this._startAudioCapture().catch(() => {});
        } catch (error) {
            if (error.name === 'InvalidStateError') {
                // Already started
                this.isListening = true;
                if (this.onStateChange) this.onStateChange('listening');
            } else {
                console.error('Failed to start voice recognition:', error);
                if (this.onStateChange) {
                    this.onStateChange('error', error.message || 'Microphone error');
                }
            }
        }
    },

    /**
     * Stop listening.
     */
    stop() {
        this.isListening = false;
        try {
            if (this.recognition) {
                this.recognition.stop();
            }
        } catch (e) {}
        this._stopAudioCapture();
        if (this.onStateChange) {
            this.onStateChange('idle');
        }
    },

    /**
     * Start audio capture for waveform visualization.
     */
    async _startAudioCapture() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;

            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);

            this._stream = stream;
            this._drawWaveform();
        } catch (error) {
            console.warn('Microphone access denied, waveform unavailable:', error);
        }
    },

    /**
     * Stop audio capture.
     */
    _stopAudioCapture() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        if (this._stream) {
            this._stream.getTracks().forEach(track => track.stop());
            this._stream = null;
        }
        if (this.audioContext) {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
        }
        this.microphone = null;
        this.analyser = null;

        // Draw idle waveform
        setTimeout(() => this._drawIdleWaveform(), 100);
    },

    /**
     * Handle speech recognition result.
     */
    _handleResult(event) {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        if (interimTranscript) {
            this.onPartialTranscript(interimTranscript);
        }

        if (finalTranscript) {
            this.onTranscript(finalTranscript);
        }
    },

    /**
     * Handle speech recognition start.
     */
    _handleStart() {
        this.isListening = true;
        this.onStateChange('listening');
    },

    /**
     * Handle speech recognition end.
     */
    _handleEnd() {
        this.isListening = false;
        this._stopAudioCapture();
        this.onStateChange('idle');
    },

    /**
     * Handle speech recognition error.
     */
    _handleError(event) {
        console.error('Speech recognition error:', event.error);
        this.isListening = false;
        this._stopAudioCapture();

        const messages = {
            'no-speech': 'No speech detected. Try again.',
            'audio-capture': 'Microphone not found. Check your audio settings.',
            'not-allowed': 'Microphone access denied. Please allow microphone access.',
            'network': 'Network error. Check your connection.',
        };

        this.onStateChange('error', messages[event.error] || `Error: ${event.error}`);
    },

    /**
     * Draw real-time waveform visualization.
     */
    _drawWaveform() {
        if (!this.analyser || !this.waveformCtx) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const canvas = this.waveformCanvas;
        const ctx = this.waveformCtx;
        const width = canvas.width;
        const height = canvas.height;

        const draw = () => {
            this.animationFrame = requestAnimationFrame(draw);
            this.analyser.getByteFrequencyData(dataArray);

            // Clear
            ctx.clearRect(0, 0, width, height);

            // Draw frequency bars
            const barCount = 64;
            const barWidth = (width / barCount) * 0.7;
            const gap = (width / barCount) * 0.3;
            const centerY = height / 2;

            for (let i = 0; i < barCount; i++) {
                const dataIndex = Math.floor(i * bufferLength / barCount);
                const value = dataArray[dataIndex] / 255;
                const barHeight = Math.max(2, value * centerY * 0.9);

                const x = i * (barWidth + gap) + gap / 2;
                const hue = 190 + (i / barCount) * 80; // Cyan to purple gradient
                const alpha = 0.4 + value * 0.6;

                ctx.fillStyle = `hsla(${hue}, 100%, 65%, ${alpha})`;

                // Mirror bars from center
                const radius = 2;
                // Top bar
                ctx.beginPath();
                ctx.roundRect(x, centerY - barHeight, barWidth, barHeight, radius);
                ctx.fill();
                // Bottom bar (mirrored)
                ctx.beginPath();
                ctx.roundRect(x, centerY, barWidth, barHeight, radius);
                ctx.fill();
            }

            // Center line
            ctx.strokeStyle = 'rgba(0, 212, 255, 0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, centerY);
            ctx.lineTo(width, centerY);
            ctx.stroke();
        };

        draw();
    },

    /**
     * Draw idle waveform (static, subtle visualization).
     */
    _drawIdleWaveform() {
        if (!this.waveformCtx || !this.waveformCanvas) return;

        const ctx = this.waveformCtx;
        const width = this.waveformCanvas.width;
        const height = this.waveformCanvas.height;
        const centerY = height / 2;

        ctx.clearRect(0, 0, width, height);

        // Draw subtle sine wave
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.1)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        for (let x = 0; x < width; x++) {
            const y = centerY + Math.sin(x * 0.03) * 5 + Math.sin(x * 0.01) * 3;
            if (x === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // Center line
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();
    },

    /**
     * Resize canvas to match container.
     */
    _resizeCanvas() {
        if (!this.waveformCanvas) return;
        const container = this.waveformCanvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        this.waveformCanvas.width = container.clientWidth * dpr;
        this.waveformCanvas.height = container.clientHeight * dpr;
        this.waveformCtx.scale(dpr, dpr);
        this.waveformCanvas.style.width = container.clientWidth + 'px';
        this.waveformCanvas.style.height = container.clientHeight + 'px';
    },
};

// Explicitly attach to window for global access
window.Voice = Voice;

