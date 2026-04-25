import { state } from './state.js';
import { DATA_REFRESH_INTERVAL } from './constants.js';
import { loadData } from './data.js';
import { handleGeolocation } from './geo.js';
import {
    setupCustomSelect,
    closeAllCustomSelects,
    updateStationOrder,
    updateDestinationDropdown,
    updateTrains,
    loadTrains,
    setCustomSelectValue,
    updateRefreshRing
} from './ui.js';

// --- INITIALIZATION ---

// Initialize UI immediate state to prevent flash
document.querySelectorAll('.direction-btn').forEach(b => b.classList.remove('active'));
const activeBtn = document.querySelector(`.direction-btn[data-direction="${state.currentDirection}"]`);
if (activeBtn) activeBtn.classList.add('active');

// Set up station select
setupCustomSelect(document.getElementById('stationSelect'), (val) => {
    state.currentStation = val;
    localStorage.setItem('patco_station', state.currentStation);
    updateDestinationDropdown();
    loadTrains(false);
    const geoIcon = document.querySelector('#findMe .geo-icon');
    if (geoIcon) geoIcon.textContent = 'location_searching';
});

// Set up destination select
setupCustomSelect(document.getElementById('destinationSelect'), (val) => {
    const prev = state.currentDestination;
    state.currentDestination = val;

    if (state.currentDestination) {
        localStorage.setItem('patco_destination', state.currentDestination);
    } else {
        localStorage.removeItem('patco_destination');
    }

    const clearBtn = document.getElementById('clearDestination');
    clearBtn.style.opacity = state.currentDestination ? '1' : '0';
    clearBtn.style.pointerEvents = state.currentDestination ? '' : 'none';

    const noDestOpt = document.querySelector('#destinationSelect .custom-select-option[data-value=""]');
    if (noDestOpt) noDestOpt.style.display = state.currentDestination ? 'none' : '';

    // Re-render with new destination
    loadTrains(false, true);
});

// Global Event Listeners
document.addEventListener('click', () => closeAllCustomSelects());
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllCustomSelects();
});

document.getElementById('findMe').addEventListener('click', () => {
    handleGeolocation({
        updateTrains,
        updateDestinationDropdown,
        setCustomSelectValue
    });
});

document.getElementById('clearDestination').addEventListener('click', () => {
    // Hide the clear button and reset the dropdown immediately
    const clearBtn = document.getElementById('clearDestination');
    clearBtn.style.opacity = '0';
    clearBtn.style.pointerEvents = 'none';

    const destSelect = document.getElementById('destinationSelect');
    const noDestOpt = destSelect.querySelector('.custom-select-option[data-value=""]');
    if (noDestOpt) noDestOpt.style.display = '';
    setCustomSelectValue(destSelect, '');

    // Clear state and re-render
    state.currentDestination = '';
    localStorage.removeItem('patco_destination');
    loadTrains(false, true);
});

document.querySelectorAll('.direction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const newDirection = btn.dataset.direction;
        const isOpen = !!document.querySelector('.custom-select.open');

        closeAllCustomSelects();

        if (newDirection === state.currentDirection) return;

        document.querySelectorAll('.direction-btn').forEach(b => {
            b.classList.remove('active');
            b.style.background = '';
            b.style.boxShadow = '';
        });
        btn.classList.add('active');

        // Reset severity color to brand red during transition to prevent black flash
        document.documentElement.style.setProperty('--severity-color', 'var(--patco-red)');

        state.currentDirection = newDirection;
        localStorage.setItem('patco_direction', state.currentDirection);

        if (state.currentDestination && state.currentStation) {
            const oldStation = state.currentStation;
            state.currentStation = state.currentDestination;
            state.currentDestination = oldStation;

            state.isStationFromGeo = false;
            if (state.geoClearTimeout) {
                clearTimeout(state.geoClearTimeout);
                state.geoClearTimeout = null;
            }

            localStorage.setItem('patco_station', state.currentStation);
            localStorage.setItem('patco_destination', state.currentDestination);

            setCustomSelectValue(document.getElementById('stationSelect'), state.currentStation, !isOpen);
            setCustomSelectValue(document.getElementById('destinationSelect'), state.currentDestination, !isOpen);

            const geoIcon = document.querySelector('#findMe .geo-icon');
            if (geoIcon) geoIcon.textContent = 'location_searching';
        }

        loadTrains(false);

        const reorderLists = () => {
            updateStationOrder();
            updateDestinationDropdown();
        };

        if (isOpen) {
            setTimeout(reorderLists, 200);
        } else {
            reorderLists();
        }
    });
});

// Final Setup
updateStationOrder();
updateDestinationDropdown();
loadData({ updateTrains, updateDestinationDropdown });

// Web Worker Setup
let countdownWorker;
if (window.Worker) {
    countdownWorker = new Worker(`/app/js/worker.js?v=${new Date().getTime()}`);
    countdownWorker.onmessage = function (e) {
        if (e.data === 'fetch') {
            loadData({ updateTrains, updateDestinationDropdown });
        } else if (e.data === 'tick') {
            state.refreshCountdown--;
            if (state.refreshCountdown <= 0) {
                loadTrains(false, true);
                state.refreshCountdown = 60 - new Date().getSeconds();
                if (state.refreshCountdown <= 0) state.refreshCountdown = 60;
            }
            updateRefreshRing();
        }
    };
    countdownWorker.postMessage({ type: 'start', interval: DATA_REFRESH_INTERVAL });
} else {
    setInterval(() => {
        loadData({ updateTrains, updateDestinationDropdown });
    }, DATA_REFRESH_INTERVAL);

    setInterval(() => {
        state.refreshCountdown--;
        if (state.refreshCountdown <= 0) {
            loadTrains(false, true);
            state.refreshCountdown = 60 - new Date().getSeconds();
            if (state.refreshCountdown <= 0) state.refreshCountdown = 60;
        }
        updateRefreshRing();
    }, 1000);
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (state.currentStation) loadTrains(false, true);
        if (Date.now() - state.lastFetchTime > DATA_REFRESH_INTERVAL) {
            loadData({ updateTrains, updateDestinationDropdown });
        }
    }
});

// Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js?v=__CACHE_BUST__').then(registration => {
            console.log('ServiceWorker registration successful');

            // Check for updates periodically
            setInterval(() => {
                registration.update();
            }, 60 * 60 * 1000); // Check every hour
        }).catch(err => {
            console.warn('ServiceWorker registration failed', err);
        });
    });

    // Only listen for controllerchange if we did NOT just come back from an update reload.
    // This breaks the reload cascade: update fires controllerchange → reload → flag is set →
    // reloaded page skips the listener entirely → no more reloads.
    if (!state.isUpdating) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            sessionStorage.setItem('patco_sw_updating', '1');
            window.location.reload();
        });
    }
}
