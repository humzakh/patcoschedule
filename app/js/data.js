import { state } from './state.js';
import { getNYDate, parseTime } from './utils.js';
import { DATA_URL } from './constants.js';

function getScheduleType(date) {
    const day = date.getDay();
    if (day === 6) return 'saturday';
    if (day === 0) return 'sunday';
    return 'weekday';
}

export function getNextTrainsForDirection(station, direction, count = 20) {
    if (!state.patcoData || !station) return null;

    const now = new Date();
    const nyNow = getNYDate(now);

    let upcoming = [];

    function scanScheduleDay(scanDate, isTomorrow) {
        if (upcoming.length >= count) return;

        const dateStr = [
            scanDate.getFullYear(),
            String(scanDate.getMonth() + 1).padStart(2, '0'),
            String(scanDate.getDate()).padStart(2, '0')
        ].join('-');
        const mm_dd = `${String(scanDate.getMonth() + 1).padStart(2, '0')}-${String(scanDate.getDate()).padStart(2, '0')}`;

        let matrix = null;
        let scheduleName = null;
        let scheduleUrl = "";

        if (state.patcoData.schedules.special) {
            for (const key of Object.keys(state.patcoData.schedules.special)) {
                if (key.includes(dateStr) || key.includes(mm_dd)) {
                    matrix = state.patcoData.schedules.special[key][direction];
                    scheduleName = `Special (${mm_dd})`;
                    scheduleUrl = state.patcoData.schedules.special[key].url || "https://www.ridepatco.org/schedules/";
                    break;
                }
            }
        }

        if (!matrix) {
            const typ = getScheduleType(scanDate);

            if (state.patcoData.schedules.standard[typ] && state.patcoData.schedules.standard[typ][direction]) {
                matrix = state.patcoData.schedules.standard[typ][direction];
                scheduleName = typ;
                scheduleUrl = state.patcoData.schedules.standard[typ].url || "";
            }
        }

        if (!matrix) return;
 
        const headers = matrix.stations;
        const stIdx = headers.indexOf(station);
        if (stIdx === -1) return;
 
        const cmpTime = new Date(scanDate);
        if (isTomorrow) {
            cmpTime.setHours(0, 0, 0, 0);
        } else {
            cmpTime.setHours(nyNow.getHours(), nyNow.getMinutes(), 0, 0);
        }
 
        let prevMins = -1;
        let dayOffset = 0;
 
        for (const row of matrix.times) {
            const timeStr = row[stIdx];
            if (!timeStr) continue;
 
            const suffix = timeStr.slice(-1);
            if (suffix === 'A' || suffix === 'P') {
                let [hStr, mStr] = timeStr.slice(0, -1).split(':');
                let h = parseInt(hStr, 10);
                let m = parseInt(mStr, 10);
                if (suffix === 'P' && h !== 12) h += 12;
                if (suffix === 'A' && h === 12) h = 0;
 
                const thisMins = (h * 60) + m;
                if (prevMins !== -1 && thisMins < prevMins - 120) {
                    dayOffset++;
                }
                prevMins = thisMins;
            }
 
            const tData = parseTime(timeStr, scanDate, dayOffset);
 
            if (tData && tData >= cmpTime) {
                const msDiff = tData.getTime() - nyNow.getTime();
                const mins = Math.ceil(msDiff / 60000);
 
                let arrivalTime = null;
                let arrivalMinutes = null;
                if (state.currentDestination) {
                    const destIdx = headers.indexOf(state.currentDestination);
                    if (destIdx !== -1) {
                        const destTimeStr = row[destIdx];
                        if (destTimeStr) {
                            arrivalTime = destTimeStr;
                            const arrData = parseTime(destTimeStr, scanDate, dayOffset);
                            if (arrData) {
                                arrivalMinutes = Math.ceil((arrData.getTime() - nyNow.getTime()) / 60000);
                            }
                        } else {
                            arrivalTime = 'closed';
                        }
                    }
                }
 
                upcoming.push({
                    time: timeStr,
                    minutes: mins,
                    is_tomorrow: isTomorrow || dayOffset > 0,
                    is_carryover: !isTomorrow && dayOffset > 0,
                    schedule: scheduleName,
                    schedule_url: scheduleUrl,
                    arrivalTime: arrivalTime,
                    arrivalMinutes: arrivalMinutes
                });
 
                if (upcoming.length >= count) return;
            }
        }
    }

    // Scan Today First
    scanScheduleDay(new Date(nyNow), false);

    // If we are still short, explicitly scan Tomorrow
    if (upcoming.length < count) {
        const tomorrow = new Date(nyNow);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        // Filter out trains we already picked up (e.g. carryovers in today's matrix)
        const existingTimes = new Set(upcoming.map(t => `${t.time}-${t.is_tomorrow}`));
        const startLen = upcoming.length;

        scanScheduleDay(tomorrow, true);

        // Deduplicate the newly added trains
        if (upcoming.length > startLen) {
            const newTrains = upcoming.slice(startLen).filter(t => !existingTimes.has(`${t.time}-${t.is_tomorrow}`));
            upcoming.length = startLen;
            upcoming.push(...newTrains);
        }
    }

    // Post-process to calculate "closed until" for specific destination
    if (state.currentDestination && upcoming.length > 0) {
        for (let i = 0; i < upcoming.length; i++) {
            if (upcoming[i].arrivalTime === 'closed') {
                for (let j = i + 1; j < upcoming.length; j++) {
                    if (upcoming[j].arrivalTime && upcoming[j].arrivalTime !== 'closed') {
                        upcoming[i].closedUntil = upcoming[j].arrivalTime;
                        break;
                    }
                }
            }
        }
    }

    if (upcoming.length === 0) return null;

    return {
        station: station,
        direction: direction,
        trains: upcoming,
        schedule: upcoming[0].schedule
    };
}

export async function loadData(callbacks) {
    const { updateTrains, updateDestinationDropdown } = callbacks;
    try {
        updateTrains(true);

        const fetchPromise = fetch(`${DATA_URL}?t=${new Date().getTime()}`, { cache: 'no-store' })
            .then(res => res.json());
        const delayPromise = new Promise(resolve => setTimeout(resolve, 2000));

        const [data] = await Promise.all([fetchPromise, delayPromise]);

        state.patcoData = data;
        state.lastFetchTime = Date.now();
        updateDestinationDropdown();
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
