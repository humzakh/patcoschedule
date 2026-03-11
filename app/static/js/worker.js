// Background Web Worker to keep the timers ticking reliably 
// even when the main browser tab is throttled or heavily backgrounded.

let tickIntervalId = null;
let fetchIntervalId = null;

self.onmessage = function(e) {
    if (e.data.type === 'start') {
        const fetchInterval = e.data.interval || 60000;
        
        if (!tickIntervalId) {
            tickIntervalId = setInterval(() => {
                self.postMessage('tick');
            }, 1000);
        }
        
        if (!fetchIntervalId) {
            fetchIntervalId = setInterval(() => {
                self.postMessage('fetch');
            }, fetchInterval);
        }
    } else if (e.data.type === 'stop') {
        if (tickIntervalId) {
            clearInterval(tickIntervalId);
            tickIntervalId = null;
        }
        if (fetchIntervalId) {
            clearInterval(fetchIntervalId);
            fetchIntervalId = null;
        }
    }
};
