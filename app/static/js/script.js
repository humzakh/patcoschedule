let currentStation = localStorage.getItem('patco_station') || '';
let currentDirection = localStorage.getItem('patco_direction') || 'eastbound';

// The loaded JSON data
let patcoData = null;

// Initialize UI immediate state to prevent flash
const activeBtn = document.querySelector(`.direction-btn[data-direction="${currentDirection}"]`);
if (activeBtn) activeBtn.classList.add('active');

if (currentStation) {
    const select = document.getElementById('stationSelect');
    if (select) select.value = currentStation;
}

// Ensure the station dropdown loads in the correct order for the cached direction before the data fetch finishes
updateStationOrder();

let refreshInterval;
let currentTrainColor = '#22c55e'; // Default to green
let isListExpanded = false; // Track expanded state
let lastFetchTime = 0;
const DATA_REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes

// We don't need timeOffset because we'll just use the client's clock,
// but we do need to calculate durations based on America/New_York time
// since the schedules are in New York time.
// Actually, it's easier to just convert New York time to local time, 
// or evaluate the time difference in absolute milliseconds.
function getNYDate(date = new Date()) {
    return new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

// Convert "4:30A" into a comparable Date object using today's date in NY
// Parse "HH:MM[A/P]" into a Date object based on nyDate.
// We pass an explicitly tracked dayOffset to handle overnight wraps.
function parseTime(timeStr, nyDate, dayOffset = 0) {
    if (!timeStr || !timeStr.match(/([AP])$/)) return null;

    let [hoursStr, minutesStr] = timeStr.slice(0, -1).split(':');
    let hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    const suffix = timeStr.slice(-1);

    if (suffix === 'P' && hours !== 12) hours += 12;
    if (suffix === 'A' && hours === 12) hours = 0;

    const d = new Date(nyDate);
    d.setHours(hours, minutes, 0, 0);

    if (dayOffset > 0) {
        d.setDate(d.getDate() + dayOffset);
    }

    return d;
}

// Determine if we need to look at weekday, saturday, or sunday
function getScheduleType(nyDate) {
    const day = nyDate.getDay();
    if (day === 6) return 'saturday';
    if (day === 0) return 'sunday';
    return 'weekday';
}

function formatTime(timeStr) {
    if (!timeStr) return timeStr;
    return timeStr.replace(/([AP])$/, ' $1M');
}

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

function getTimeColor(mins, maxMins = 15) {
    if (mins > 60) return '#3b82f6';
    if (mins > maxMins) {
        const t = (mins - maxMins) / (60 - maxMins);
        const r = Math.round(34 + (21 - 34) * t);
        const g = Math.round(197 + (128 - 197) * t);
        const b = Math.round(94 + (61 - 94) * t);
        return `rgb(${r},${g},${b})`;
    }
    if (mins <= 1) return '#ef4444';
    const ratio = mins / maxMins;
    if (ratio > 0.5) {
        const t = (ratio - 0.5) / 0.5;
        const r = Math.round(234 + (34 - 234) * t);
        const g = Math.round(179 + (197 - 179) * t);
        const b = Math.round(8 + (94 - 8) * t);
        return `rgb(${r},${g},${b})`;
    } else {
        const t = ratio / 0.5;
        const r = Math.round(239 + (234 - 239) * t);
        const g = Math.round(68 + (179 - 68) * t);
        const b = Math.round(68 + (8 - 68) * t);
        return `rgb(${r},${g},${b})`;
    }
}

async function loadData() {
    try {
        updateTrains(); // This will show the spinner ONLY if a station is already selected, else "Select a station"

        // Append timestamp to bypass aggressive browser caching for the changing data payload
        const res = await fetch(`https://raw.githubusercontent.com/humzakh/patcoschedule/data/patco_data.json?t=${new Date().getTime()}`);
        patcoData = await res.json();
        lastFetchTime = Date.now();
        updateTrains();
    } catch (err) {
        console.error('Failed to load PATCO data:', err);
        document.getElementById('trainInfo').innerHTML = `
            <div class="card error">
                <p>Failed to load schedule data</p>
                <p style="font-size: 0.8rem; margin-top: 0.5rem;">Please check your connection and refresh the page.</p>
            </div>
        `;
    }
}

function updateStationOrder() {
    const select = document.getElementById('stationSelect');
    const paGrp = document.getElementById('pa-stations');
    const njGrp = document.getElementById('nj-stations');

    // Make sure we select the cached station immediately if one exists
    if (currentStation) {
        select.value = currentStation;
    } else {
        select.value = "";
    }

    // The HTML is hardcoded in the Eastbound sequence.
    // We visually reverse the station list so it flows logically with the user's travel direction.
    const reverseOptions = (grp) => {
        const options = Array.from(grp.children);
        options.reverse().forEach(opt => grp.appendChild(opt));
    };

    // Sort container order and internal option order
    if (currentDirection === 'eastbound') {
        // PA comes first when headed east
        select.appendChild(paGrp);
        select.appendChild(njGrp);

        // If they are currently in westbound "reversed" state, flip them back
        if (paGrp.dataset.reversed === "true") {
            reverseOptions(paGrp);
            reverseOptions(njGrp);
            paGrp.dataset.reversed = "false";
        }
    } else {
        // NJ comes first when headed west
        select.appendChild(njGrp);
        select.appendChild(paGrp);

        // If they are currently in eastbound "normal" state, flip them to reversed
        if (paGrp.dataset.reversed !== "true") {
            reverseOptions(paGrp);
            reverseOptions(njGrp);
            paGrp.dataset.reversed = "true";
        }
    }
}

// Extract next N trains from our local data structure
function getNextTrainsForDirection(station, direction, count = 20) {
    if (!patcoData || !station) return null;

    const now = new Date();
    const nyNow = getNYDate(now);

    let upcoming = [];

    // --- HELPER FUNCTION ---
    function scanScheduleDay(scanDate, isTomorrow) {
        if (upcoming.length >= count) return;

        // 1. Find the literal matrix data for this exact scanDate
        const dateStr = [
            scanDate.getFullYear(),
            String(scanDate.getMonth() + 1).padStart(2, '0'),
            String(scanDate.getDate()).padStart(2, '0')
        ].join('-');
        const mm_dd = `${String(scanDate.getMonth() + 1).padStart(2, '0')}-${String(scanDate.getDate()).padStart(2, '0')}`;

        let matrix = null;
        let scheduleName = null;
        let scheduleUrl = "";

        // Check special
        if (patcoData.schedules.special) {
            for (const key of Object.keys(patcoData.schedules.special)) {
                if (key.includes(dateStr) || key.includes(mm_dd)) {
                    matrix = patcoData.schedules.special[key][direction];
                    scheduleName = `Special (${mm_dd})`;
                    scheduleUrl = patcoData.schedules.special[key].url || "https://www.ridepatco.org/schedules/";
                    break;
                }
            }
        }

        // Check standard fallback
        if (!matrix) {
            const typ = getScheduleType(scanDate);
            if (patcoData.schedules.standard[direction][typ]) {
                matrix = patcoData.schedules.standard[direction][typ];
                scheduleName = typ;
                scheduleUrl = patcoData.standard_url;
                if (typ === 'weekday') scheduleUrl += '#page=1';
                else scheduleUrl += '#page=2';
            }
        }

        if (!matrix) return; // No schedule for this day

        const headers = matrix[0];
        const stIdx = headers.indexOf(station);
        if (stIdx === -1) return;

        // 2. Set the exact time floor to compare against
        const cmpTime = new Date(scanDate);
        if (isTomorrow) {
            // If scanning tomorrow, we want all trains from 00:00 onwards
            cmpTime.setHours(0, 0, 0, 0);
        } else {
            // If scanning today, we want trains from RIGHT NOW onwards
            cmpTime.setHours(nyNow.getHours(), nyNow.getMinutes(), 0, 0);
        }

        // 3. Scan the rows maintaining chronological awareness
        let prevMins = -1;
        let dayOffset = 0;

        for (let i = 1; i < matrix.length; i++) {
            const timeStr = matrix[i][stIdx];
            if (!timeStr) continue;

            const suffix = timeStr.slice(-1);
            if (suffix === 'A' || suffix === 'P') {
                let [hStr, mStr] = timeStr.slice(0, -1).split(':');
                let h = parseInt(hStr, 10);
                let m = parseInt(mStr, 10);
                if (suffix === 'P' && h !== 12) h += 12;
                if (suffix === 'A' && h === 12) h = 0;

                const thisMins = (h * 60) + m;

                // If the time drastically regresses (e.g. 11:53 PM [1433] to 12:13 AM [13]), we crossed midnight
                if (prevMins !== -1 && thisMins < prevMins - 120) {
                    dayOffset++;
                }
                prevMins = thisMins;
            }

            // Generate an exact Date object for `timeStr` occurring on `scanDate`
            // Pass dayOffset to natively handle overnight rollovers
            const tData = parseTime(timeStr, scanDate, dayOffset);

            if (tData && tData >= cmpTime) {
                // Determine minutes from actual right now
                const msDiff = tData.getTime() - nyNow.getTime();
                const mins = Math.ceil(msDiff / 60000);

                upcoming.push({
                    time: timeStr,
                    minutes: mins,
                    is_tomorrow: isTomorrow || dayOffset > 0,
                    is_carryover: !isTomorrow && dayOffset > 0,
                    schedule: scheduleName,
                    schedule_url: scheduleUrl
                });

                if (upcoming.length >= count) return;
            }
        }
    }

    // --- EXECUTION ---
    // Scan Today First
    scanScheduleDay(new Date(nyNow), false);

    // If we are still short, explicitly scan Tomorrow
    if (upcoming.length < count) {
        const tomorrow = new Date(nyNow);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0); // Start of tomorrow
        scanScheduleDay(tomorrow, true);
    }

    if (upcoming.length === 0) return null;

    return {
        station: station,
        direction: direction,
        trains: upcoming,
        schedule: upcoming[0].schedule
    };
}


function updateTrains(showLoading = false) {
    if (!patcoData) {
        if (currentStation) {
            document.getElementById('trainInfo').innerHTML = `
            <div class="card loading">
                <div class="spinner"></div>
                <p>Fetching schedule data...</p>
            </div>
            `;
        } else {
            document.getElementById('trainInfo').innerHTML = `
            <div class="card loading">
                <p>Select a station to see train times</p>
            </div>
            `;
        }
        return;
    }

    if (!currentStation) {
        document.getElementById('trainInfo').innerHTML = `
        <div class="card loading">
            <p>Select a station to see train times</p>
        </div>
    `;
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

    const eastbound = getNextTrainsForDirection(currentStation, 'eastbound');
    const westbound = getNextTrainsForDirection(currentStation, 'westbound');

    const getDirColor = (d) => {
        if (!d || !d.trains || d.trains.length === 0) return '#22c55e';
        return getTimeColor(d.trains[0].minutes);
    }

    const eastColor = getDirColor(eastbound);
    const westColor = getDirColor(westbound);

    document.documentElement.style.setProperty('--east-color', eastColor);
    document.documentElement.style.setProperty('--west-color', westColor);

    const currentData = currentDirection === 'eastbound' ? eastbound : westbound;
    try {
        if (currentData) {
            renderTrains(currentData);
        } else {
            throw new Error('No service for this direction');
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

// We no longer fetch from /api/next, so loadTrains just invokes the local logic
function loadTrains(showLoading = true) {
    updateTrains(showLoading);
}

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

    const getBadgeClass = (schedule) => {
        if (schedule.toLowerCase().includes('special')) return 'special';
        if (schedule === 'weekday') return 'weekday';
        if (schedule === 'sunday') return 'sunday';
        if (schedule === 'saturday') return 'weekend';
        return '';
    };
    const badgeClass = getBadgeClass(next.schedule);

    const countdownColor = getTimeColor(next.minutes);
    currentTrainColor = countdownColor;

    const isLongWait = next.minutes >= 60;

    // Format the top-level today schedule badge
    let displayNextSchedule = next.schedule;
    if (displayNextSchedule.startsWith('Special (')) {
        // Convert "Special (02-23)" to "Special Schedule (02/23)"
        displayNextSchedule = displayNextSchedule.replace('Special (', 'Special Schedule (').replace('-', '/');
    } else {
        displayNextSchedule = displayNextSchedule + (displayNextSchedule.toLowerCase().includes('schedule') ? '' : ' schedule');
    }

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
        ${next.schedule_url ? `<a href="${next.schedule_url}" target="_blank" class="schedule-badge ${badgeClass}">${displayNextSchedule} ↗</a>` : `<div class="schedule-badge ${badgeClass}">${displayNextSchedule}</div>`}
    </div>
`;

    if (upcoming.length > 0) {
        const initialCount = 4;
        const hasMore = upcoming.length > initialCount;
        const visibleTrains = upcoming.slice(0, initialCount);
        const hiddenTrains = upcoming.slice(initialCount);

        for (let i = 0; i < upcoming.length; i++) {
            if (!upcoming[i].is_tomorrow) {
                if (upcoming[i + 1] && upcoming[i + 1].is_tomorrow) {
                    upcoming[i].isLastToday = true;
                    break;
                }
            }
        }

        let tomorrowHeaderRendered = false;

        const renderInfos = (list) => {
            return list.map(train => {
                let html = '';
                if (train.is_tomorrow && !tomorrowHeaderRendered && !next.is_tomorrow) {
                    tomorrowHeaderRendered = true;

                    // Find the primary schedule for tomorrow (not a carryover train)
                    let primaryTomorrowTrain = upcoming.find(t => t.is_tomorrow && !t.is_carryover) || train;
                    let displayScheduleText = primaryTomorrowTrain.schedule;
                    if (displayScheduleText.startsWith('Special (')) {
                        displayScheduleText = 'Special';
                    }
                    let displaySchedule = displayScheduleText + (displayScheduleText.toLowerCase().includes('schedule') ? '' : ' schedule');

                    html += `
                    <li class="upcoming-header">
                        <span>Tomorrow</span>
                        ${primaryTomorrowTrain.schedule_url ?
                            `<a href="${primaryTomorrowTrain.schedule_url}" target="_blank" class="upcoming-schedule ${getBadgeClass(primaryTomorrowTrain.schedule)}">${displaySchedule} ↗</a>` :
                            `<span class="upcoming-schedule ${getBadgeClass(primaryTomorrowTrain.schedule)}">${displaySchedule}</span>`
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

    const activeBtn = document.querySelector('.direction-btn.active');
    if (activeBtn) {
        activeBtn.style.background = countdownColor;
        let shadowColor = countdownColor;
        if (countdownColor.startsWith('#')) {
            shadowColor = countdownColor + '66';
        } else {
            shadowColor = countdownColor.replace('rgb(', 'rgba(').replace(')', ', 0.4)');
        }
        activeBtn.style.boxShadow = `0 4px 15px ${shadowColor}`;
    }

    document.documentElement.style.setProperty('--severity-color', countdownColor);

    if (isListExpanded) {
        const hiddenList = document.getElementById('hiddenTrains');
        const btn = document.querySelector('.show-more-btn');
        if (hiddenList && btn) {
            hiddenList.style.display = 'block';
            btn.innerHTML = '▲';
        }
    }
}

document.getElementById('stationSelect').addEventListener('change', (e) => {
    currentStation = e.target.value;
    localStorage.setItem('patco_station', currentStation);
    loadTrains();
});

document.querySelectorAll('.direction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.direction-btn').forEach(b => {
            b.classList.remove('active');
            b.style.background = '';
            b.style.boxShadow = '';
        });
        btn.classList.add('active');
        currentDirection = btn.dataset.direction;
        localStorage.setItem('patco_direction', currentDirection);

        updateStationOrder();
        loadTrains(false);
    });
});

document.querySelectorAll('.direction-btn').forEach(btn => {
    if (btn.dataset.direction === currentDirection) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
});

const REFRESH_INTERVAL = 60;
let refreshCountdown = 60 - new Date().getSeconds();
const circumference = 2 * Math.PI * 8;

function updateRefreshRing() {
    const progress = document.querySelector('.refresh-ring .progress');
    const countdownEl = document.getElementById('refreshCountdown');
    if (progress && countdownEl) {
        const offset = circumference * (1 - refreshCountdown / REFRESH_INTERVAL);
        progress.style.strokeDashoffset = offset;
        progress.style.stroke = currentTrainColor;
        countdownEl.textContent = refreshCountdown + 's';

        requestAnimationFrame(() => {
            progress.classList.add('animated');
        });
    }
}

function startRefreshTimer() {
    refreshCountdown = 60 - new Date().getSeconds();
    updateRefreshRing();
}

// Kickoff
loadData();

setInterval(() => {
    loadData();
}, DATA_REFRESH_INTERVAL);

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (currentStation) loadTrains(false);
        if (Date.now() - lastFetchTime > DATA_REFRESH_INTERVAL) {
            loadData();
        }
    }
});
startRefreshTimer();

setInterval(() => {
    refreshCountdown--;
    if (refreshCountdown <= 0) {
        loadTrains(false);
        refreshCountdown = 60 - new Date().getSeconds();
        if (refreshCountdown <= 0) refreshCountdown = 60;
    }
    updateRefreshRing();
}, 1000);
