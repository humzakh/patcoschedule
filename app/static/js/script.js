let currentStation = localStorage.getItem('patco_station') || '';
let currentDirection = localStorage.getItem('patco_direction') || 'eastbound';

// Initialize UI immediate state to prevent flash
// 1. Set active direction button
const activeBtn = document.querySelector(`.direction-btn[data-direction="${currentDirection}"]`);
if (activeBtn) activeBtn.classList.add('active');

// 2. Pre-set station dropdown if we have a saved value
if (currentStation) {
    const select = document.getElementById('stationSelect');
    if (select) select.innerHTML = `<option value="${currentStation}" selected>${currentStation}</option>`;
}
let refreshInterval;
let currentTrainColor = '#22c55e'; // Default to green
let isListExpanded = false; // Track expanded state
let timeOffset = 0; // Server time offset (server time - client time)
let stationsData = null; // Global cache for station data to allow re-rendering

// Cache for train data (both directions)
let trainDataCache = {
    eastbound: null,
    westbound: null,
    lastStation: null
};

// Format time: "10:29A" -> "10:29 AM"
function formatTime(timeStr) {
    if (!timeStr) return timeStr;
    return timeStr.replace(/([AP])$/, ' $1M');
}

// Format minutes: show hours for times > 60 min
function formatMinutes(mins) {
    if (mins <= 1) return '< 1 minute';
    if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''}`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    if (remainingMins === 0) {
        return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    return `${hours} hr ${remainingMins} min`;
}

// Toggle show more trains
function toggleMoreTrains(btn) {
    const hiddenList = document.getElementById('hiddenTrains');
    if (hiddenList.style.display === 'none') {
        hiddenList.style.display = 'block';
        btn.innerHTML = '▲';
        isListExpanded = true;
    } else {
        hiddenList.style.display = 'none';
        btn.innerHTML = '▼';
        isListExpanded = false;
    }
}

// Get color based on time remaining (green -> yellow -> red)
// maxMins: time at which color is fully green (15 mins)
function getTimeColor(mins, maxMins = 15) {
    if (mins > 60) return '#3b82f6'; // Blue for > 1 hour

    // Transition from Light Green (at 15m) to Dark Green (at 60m)
    if (mins > maxMins) {
        // Interpolate: Light Green (34, 197, 94) -> Dark Green (21, 128, 61)
        const t = (mins - maxMins) / (60 - maxMins);
        const r = Math.round(34 + (21 - 34) * t);
        const g = Math.round(197 + (128 - 197) * t);
        const b = Math.round(94 + (61 - 94) * t);
        return `rgb(${r},${g},${b})`;
    }

    if (mins <= 1) return '#ef4444'; // red

    const ratio = mins / maxMins;
    if (ratio > 0.5) {
        // green to yellow (ratio 1.0 -> 0.5)
        const t = (ratio - 0.5) / 0.5;
        const r = Math.round(234 + (34 - 234) * t);
        const g = Math.round(179 + (197 - 179) * t);
        const b = Math.round(8 + (94 - 8) * t);
        return `rgb(${r},${g},${b})`;
    } else {
        // yellow to red (ratio 0.5 -> 0.0)
        const t = ratio / 0.5;
        const r = Math.round(239 + (234 - 239) * t);
        const g = Math.round(68 + (179 - 68) * t);
        const b = Math.round(68 + (8 - 68) * t);
        return `rgb(${r},${g},${b})`;
    }
}

// Fetch stations and populate dropdown
async function loadStations() {
    try {
        const res = await fetch('/api/stations');
        stationsData = await res.json();
        renderStationDropdown();

        if (currentStation) {
            loadTrains();
        }
    } catch (err) {
        console.error('Failed to load stations:', err);
    }
}

// Render station dropdown based on current direction
function renderStationDropdown() {
    if (!stationsData) return;

    const select = document.getElementById('stationSelect');
    const savedValue = select.value || currentStation; // Persist selection

    // Clear existing options
    select.innerHTML = '';

    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = "";
    defaultOption.textContent = "Select a station...";
    defaultOption.disabled = true;
    defaultOption.selected = true;
    defaultOption.hidden = true;
    select.appendChild(defaultOption);

    // Clone data to avoid mutating global cache
    let groups = [];
    if (stationsData.grouped) {
        groups = JSON.parse(JSON.stringify(stationsData.grouped));
    }

    // If Eastbound, we want to reverse the logical order (PA -> NJ)
    // Default (Westbound) is NJ -> PA
    if (currentDirection === 'eastbound') {
        groups.reverse(); // Flip group order
        groups.forEach(group => {
            group.stations.reverse(); // Flip stations within group
        });
    }

    if (groups.length > 0) {
        groups.forEach(group => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = group.label;

            group.stations.forEach(station => {
                const option = document.createElement('option');
                option.value = station;
                option.textContent = station;
                if (station === savedValue) option.selected = true;
                optgroup.appendChild(option);
            });

            select.appendChild(optgroup);
        });
    } else {
        // Fallback to flat list
        let stations = [...stationsData.westbound];
        if (currentDirection === 'eastbound') {
            stations.reverse();
        }
        stations.forEach(station => {
            const option = document.createElement('option');
            option.value = station;
            option.textContent = station;
            if (station === savedValue) option.selected = true;
            select.appendChild(option);
        });
    }

    // Explicitly set value again to be sure
    if (savedValue) {
        select.value = savedValue;
    }
}

// Load next trains
async function loadTrains(showLoading = true) {
    if (!currentStation) {
        document.getElementById('trainInfo').innerHTML = `
        <div class="card loading">
            <p>Select a station to see train times</p>
        </div>
    `;
        return;
    }

    // Check if we have cached data for this station and direction
    if (trainDataCache.lastStation === currentStation && trainDataCache[currentDirection]) {
        renderTrains(trainDataCache[currentDirection]);
        // Fetch fresh data in background
        fetchBothDirections(true);
        return;
    }

    if (showLoading) {
        document.getElementById('trainInfo').innerHTML = `
        <div class="card loading">
            <div class="spinner"></div>
            <p>Loading...</p>
        </div>
    `;
    }

    await fetchBothDirections(showLoading);
}

// Fetch train data for both directions
async function fetchBothDirections(updateUI = true) {
    try {
        const res = await fetch(`/api/next?station=${encodeURIComponent(currentStation)}&direction=both&count=20`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        // Update cache
        trainDataCache.lastStation = currentStation;
        trainDataCache.eastbound = data.eastbound || null;
        trainDataCache.westbound = data.westbound || null;

        // Sync server time
        if (data.server_time_iso) {
            syncServerTime(data.server_time_iso);
        }

        // Update direction colors for hover effects
        const getDirColor = (d) => {
            if (!d || !d.trains || d.trains.length === 0) return '#22c55e';
            return getTimeColor(d.trains[0].minutes);
        }

        const eastColor = getDirColor(trainDataCache.eastbound);
        const westColor = getDirColor(trainDataCache.westbound);

        document.documentElement.style.setProperty('--east-color', eastColor);
        document.documentElement.style.setProperty('--west-color', westColor);

        // Render
        if (updateUI) {
            const currentData = trainDataCache[currentDirection];
            if (currentData) {
                renderTrains(currentData);
            } else {
                if ((currentDirection == 'eastbound' && !data.eastbound) || (currentDirection == 'westbound' && !data.westbound)) {
                    throw new Error('No service for this direction');
                }
                throw new Error('No data available');
            }
        }

    } catch (err) {
        document.getElementById('trainInfo').innerHTML = `
        <div class="card error">
            <p>Failed to load train times</p>
            <p style="font-size: 0.8rem; margin-top: 0.5rem;">${err.message}</p>
        </div>
        `;
    }
}

// Helper to sync server time and countdown
function syncServerTime(isoTime) {
    const serverTime = new Date(isoTime).getTime();
    const clientTime = Date.now();
    timeOffset = serverTime - clientTime;

    // Force resync countdown with new precise server time
    refreshCountdown = 60 - getServerTime().getSeconds();
    if (refreshCountdown <= 0) refreshCountdown = 60;
    updateRefreshRing();
}

// Render train information
function renderTrains(data) {
    if (!data.trains || data.trains.length === 0) {
        document.getElementById('trainInfo').innerHTML = `
        <div class="card">
            <div class="loading">
                <p>No upcoming trains found</p>
            </div>
        </div>
    `;
        return;
    }

    const next = data.trains[0];
    const upcoming = data.trains.slice(1);

    // Determine badge class based on schedule type
    const getBadgeClass = (schedule) => {
        if (schedule.toLowerCase().includes('special')) return 'special';
        if (schedule === 'weekday') return 'weekday';
        if (schedule === 'sunday') return 'sunday';
        if (schedule === 'saturday') return 'weekend';
        return '';
    };
    const badgeClass = getBadgeClass(next.schedule);



    // Get dynamic color based on time remaining
    const countdownColor = getTimeColor(next.minutes);
    currentTrainColor = countdownColor; // Store for refresh ring

    // Different display for trains more than 1 hour away
    const isLongWait = next.minutes >= 60;

    let html = `
    <div class="card next-train-card">
        ${isLongWait ? `
            <p class="countdown-label">Next train at</p>
            <div class="countdown" style="background: linear-gradient(135deg, ${countdownColor}, ${countdownColor}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">${formatTime(next.time)}</div>
            <div class="countdown-unit">${next.is_tomorrow ? 'tomorrow' : ''}</div>
        ` : `
            <p class="countdown-label">Next train in</p>
            <div class="countdown" style="background: linear-gradient(135deg, ${countdownColor}, ${countdownColor}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">${next.minutes <= 1 ? '< 1' : next.minutes}</div>
            <div class="countdown-unit">${next.minutes <= 1 ? 'minute' : 'minutes'}</div>
            <div class="next-time">
                ${formatTime(next.time)}${next.is_tomorrow ? ' <span style="color: var(--text-muted); font-size: 0.9rem;">(tomorrow)</span>' : ''}
            </div>
        `}
        <div class="refresh-note">
            <div class="refresh-ring">
                <svg viewBox="0 0 20 20">
                    <circle class="bg" cx="10" cy="10" r="8"></circle>
                    <circle class="progress" cx="10" cy="10" r="8" stroke-dasharray="50.27" stroke-dashoffset="${50.27 * (1 - refreshCountdown / 60)}" style="stroke: ${countdownColor}"></circle>
                </svg>
            </div>
            <span>Refreshing in <span id="refreshCountdown">${refreshCountdown}s</span></span>
        </div>
        ${next.schedule_url ? `<a href="${next.schedule_url}" target="_blank" class="schedule-badge ${badgeClass}">${next.schedule}${next.schedule.toLowerCase().includes('schedule') ? '' : ' schedule'} ↗</a>` : `<div class="schedule-badge ${badgeClass}">${next.schedule}${next.schedule.toLowerCase().includes('schedule') ? '' : ' schedule'}</div>`}
    </div>
`;

    if (upcoming.length > 0) {
        const initialCount = 4;
        const hasMore = upcoming.length > initialCount;
        const visibleTrains = upcoming.slice(0, initialCount);
        const hiddenTrains = upcoming.slice(initialCount);

        // Identify the last "today" train to style its border
        // We do this on the full 'upcoming' list so it works across the split
        for (let i = 0; i < upcoming.length; i++) {
            if (!upcoming[i].is_tomorrow) {
                // Only add border if the NEXT one is explicitly tomorrow (meaning we have a transition)
                // If it's simply the last item in the list, we don't add the border
                if (upcoming[i + 1] && upcoming[i + 1].is_tomorrow) {
                    upcoming[i].isLastToday = true;
                    break; // Found it
                }
            }
        }

        // Track if header has been shown
        let tomorrowHeaderRendered = false;

        // Helper to render list with header injection
        const renderInfos = (list) => {
            return list.map(train => {
                let html = '';
                // Inject header if this is the first tomorrow train AND the main card isn't already tomorrow
                // If main card is tomorrow, the whole list is tomorrow, so no separator needed
                if (train.is_tomorrow && !tomorrowHeaderRendered && !next.is_tomorrow) {
                    tomorrowHeaderRendered = true;
                    const schedBadge = train.schedule !== next.schedule ?
                        `<span class="upcoming-schedule ${getBadgeClass(train.schedule)}">${train.schedule}</span>` : '';

                    // Use the train's schedule badge for the header
                    html += `
                    <li class="upcoming-header">
                        <span>Tomorrow</span>
                        ${train.schedule_url ?
                            `<a href="${train.schedule_url}" target="_blank" class="upcoming-schedule ${getBadgeClass(train.schedule)}">${train.schedule} ↗</a>` :
                            `<span class="upcoming-schedule ${getBadgeClass(train.schedule)}">${train.schedule}</span>`
                        }
                    </li>
                `;
                }

                html += `
                    <li class="upcoming-item ${train.isLastToday ? 'thick-border' : ''}">
                        <span class="upcoming-time">${formatTime(train.time)}</span>
                        <span class="upcoming-tomorrow">${train.is_tomorrow ? '' : ''}</span>
                        <div class="upcoming-spacer"></div>
                        <span class="upcoming-minutes">${formatMinutes(train.minutes)}</span>
                    </li>
            `;
                return html;
            }).join('');
        };

        html += `
        <div class="card">
            <ul class="upcoming-list">
                ${renderInfos(visibleTrains)}
            </ul>
            ${hasMore ? `
                <ul class="upcoming-list" id="hiddenTrains" style="display: none;">
                    ${renderInfos(hiddenTrains)}
                </ul>
                <button class="show-more-btn" onclick="toggleMoreTrains(this)">▼</button>
            ` : ''}
        </div>
    `;
    }

    document.getElementById('trainInfo').innerHTML = html;

    // Update direction button color based on next train time
    const activeBtn = document.querySelector('.direction-btn.active');
    if (activeBtn) {
        activeBtn.style.background = countdownColor;
        // Parse color for shadow (handle both hex and rgb)
        let shadowColor = countdownColor;
        if (countdownColor.startsWith('#')) {
            shadowColor = countdownColor + '66'; // Add alpha for hex
        } else {
            // Convert rgb to rgba
            shadowColor = countdownColor.replace('rgb(', 'rgba(').replace(')', ', 0.4)');
        }
        activeBtn.style.boxShadow = `0 4px 15px ${shadowColor}`;
    }

    // Set severity color CSS variable for hover states
    document.documentElement.style.setProperty('--severity-color', countdownColor);

    // Restore expanded state if it was expanded before refresh
    if (isListExpanded) {
        const hiddenList = document.getElementById('hiddenTrains');
        const btn = document.querySelector('.show-more-btn');
        if (hiddenList && btn) {
            hiddenList.style.display = 'block';
            btn.innerHTML = '▲';
        }
    }
}

// Event listeners
document.getElementById('stationSelect').addEventListener('change', (e) => {
    currentStation = e.target.value;
    localStorage.setItem('patco_station', currentStation);
    loadTrains();
});

document.querySelectorAll('.direction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.direction-btn').forEach(b => {
            b.classList.remove('active');
            // Reset inline styles on non-active buttons
            b.style.background = '';
            b.style.boxShadow = '';
        });
        btn.classList.add('active');
        currentDirection = btn.dataset.direction;
        localStorage.setItem('patco_direction', currentDirection);

        // Update station dropdown order
        renderStationDropdown();

        // Use cached data if available for instant switching
        if (trainDataCache.lastStation === currentStation && trainDataCache[currentDirection]) {
            renderTrains(trainDataCache[currentDirection]);
        } else {
            loadTrains();
        }
    });
});

// Set initial direction button state
document.querySelectorAll('.direction-btn').forEach(btn => {
    if (btn.dataset.direction === currentDirection) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
});

// Refresh countdown
const REFRESH_INTERVAL = 60; // 60s total circle
let refreshCountdown = 60 - new Date().getSeconds(); // Initial backup before server sync
const circumference = 2 * Math.PI * 8; // r=8

// Helper to get server time
function getServerTime() {
    return new Date(Date.now() + timeOffset);
}

function updateRefreshRing() {
    const progress = document.querySelector('.refresh-ring .progress');
    const countdownEl = document.getElementById('refreshCountdown');
    if (progress && countdownEl) {
        // Scale based on 60 second minute
        const offset = circumference * (1 - refreshCountdown / REFRESH_INTERVAL);
        progress.style.strokeDashoffset = offset;
        // Use same color as train countdown
        progress.style.stroke = currentTrainColor;
        countdownEl.textContent = refreshCountdown + 's';

        // Ensure animation is enabled for updates
        // Using requestAnimationFrame to ensure the class is added after any potential DOM updates
        requestAnimationFrame(() => {
            progress.classList.add('animated');
        });
    }
}

function startRefreshTimer() {
    refreshCountdown = 60 - getServerTime().getSeconds();
    updateRefreshRing();
}

// Initial load
loadStations();

// Refresh on visibility change (when switching tabs/apps)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentStation) {
        loadTrains();
    }
});
startRefreshTimer();

// Countdown tick every second
setInterval(() => {
    refreshCountdown--;
    if (refreshCountdown <= 0) {
        loadTrains(false);  // Skip loading spinner on auto-refresh
        // Resync with server time on minute boundary (should be ~60)
        refreshCountdown = 60 - getServerTime().getSeconds();
        if (refreshCountdown <= 0) refreshCountdown = 60; // Safety
    }
    updateRefreshRing();
}, 1000);
