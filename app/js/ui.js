import { state } from './state.js';
import { CIRCUMFERENCE, WB_ORDER, PA_STATIONS, NJ_STATIONS } from './constants.js';
import { formatTime, formatMinutes, getTimeColor, getDirColor } from './utils.js';
import { getNextTrainsForDirection } from './data.js';

/**
 * Helper to update the train info area with a smooth fade sequence
 */
async function setInfoHtml(html, skipAnimation = false) {
    const infoArea = document.getElementById('trainInfo');
    if (!infoArea) return;

    // Normalize and compare to prevent redundant animations
    const normalizedNew = html.replace(/\s+/g, ' ').trim();
    const normalizedOld = infoArea.innerHTML.replace(/\s+/g, ' ').trim();
    if (normalizedNew === normalizedOld) return;

    if (skipAnimation || !infoArea.querySelector('.card')) {
        infoArea.innerHTML = html;
        return;
    }

    // Add fade-out to existing cards
    const existingCards = infoArea.querySelectorAll('.card');
    existingCards.forEach(card => card.classList.add('p-fade-out'));

    // Wait for fade-out animation (0.15s in CSS)
    await new Promise(resolve => setTimeout(resolve, 150));

    infoArea.innerHTML = html;
}

export function setCustomSelectValue(selectEl, value, updateList = true, fromGeo = false) {
    selectEl.dataset.value = value;
    const trigger = selectEl.querySelector('.custom-select-trigger');
    const valueSpan = trigger.querySelector('.custom-select-value');
    if (value) {
        const opt = selectEl.querySelector(`.custom-select-option[data-value="${CSS.escape(value)}"]`);
        let displayText = opt ? opt.dataset.value : value;

        if (fromGeo && selectEl.id === 'stationSelect') {
            valueSpan.innerHTML = `<span class="material-symbols-outlined" style="font-size: 1.1em; vertical-align: text-bottom; margin-right: 6px; color: var(--text-secondary);">my_location</span>${displayText}`;
        } else {
            valueSpan.textContent = displayText;
        }
        trigger.classList.remove('placeholder');
    } else {
        if (selectEl.id === 'stationSelect') {
            valueSpan.textContent = 'Select a station...';
            trigger.classList.add('placeholder');
        } else {
            valueSpan.textContent = 'No destination';
            trigger.classList.remove('placeholder');
        }
    }

    if (updateList) {
        selectEl.querySelectorAll('.custom-select-option').forEach(o => {
            o.classList.toggle('selected', o.dataset.value === value);
        });
    }
}

export function updateBodyLock() {
    const anyOpen = document.querySelector('.custom-select.open');
    if (!anyOpen) {
        document.body.classList.remove('has-custom-select-open');
    }
}

export function closeAllCustomSelects(except = null) {
    document.querySelectorAll('.custom-select.open').forEach(s => {
        if (s !== except) {
            s.classList.remove('open');
            s.classList.remove('hover-ready');
            clearTimeout(s.hoverTimeout);
        }
    });
    updateBodyLock();
}

export function setupCustomSelect(selectEl, onChange) {
    const trigger = selectEl.querySelector('.custom-select-trigger');
    const optionsPanel = selectEl.querySelector('.custom-select-options');
    const list = selectEl.querySelector('.custom-select-list');

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();

        if (selectEl.classList.contains('open')) {
            selectEl.classList.remove('open');
            selectEl.classList.remove('hover-ready');
            clearTimeout(selectEl.hoverTimeout);
            updateBodyLock();
        } else {
            closeAllCustomSelects(selectEl);
            document.body.classList.add('has-custom-select-open');

            const triggerRect = trigger.getBoundingClientRect();
            const selectedOpt = selectEl.querySelector('.custom-select-option.selected:not([data-value=""])') ||
                selectEl.querySelector('.custom-select-option.origin-station') ||
                selectEl.querySelector('.custom-select-option');

            if (selectedOpt) {
                const wasHidden = optionsPanel.style.display === 'none';
                if (wasHidden) optionsPanel.style.display = 'block';

                const triggerHeight = trigger.getBoundingClientRect().height;
                const optOffsetTop = selectedOpt.offsetTop;
                const optHeight = selectedOpt.offsetHeight;
                const listHeight = list.offsetHeight;
                const panelHeight = optionsPanel.offsetHeight;
                const triggerTop = triggerRect.top;
                const windowHeight = window.innerHeight;

                const idealScrollTop = optOffsetTop - (listHeight / 2) + (optHeight / 2);
                list.scrollTop = idealScrollTop;
                const actualScrollTop = list.scrollTop;

                let offset = (triggerHeight / 2) - (optOffsetTop - actualScrollTop + (optHeight / 2));
                const padding = 10;
                const absoluteTop = triggerTop + offset;
                const absoluteBottom = absoluteTop + panelHeight;

                if (absoluteTop < padding) {
                    offset += (padding - absoluteTop);
                } else if (absoluteBottom > windowHeight - padding) {
                    offset -= (absoluteBottom - (windowHeight - padding));
                }

                optionsPanel.style.setProperty('--dropdown-offset', `${offset}px`);
                if (wasHidden) optionsPanel.style.display = '';
            }

            selectEl.classList.add('open');
            selectEl.hoverTimeout = setTimeout(() => {
                selectEl.classList.add('hover-ready');
            }, 250);
        }
    });

    optionsPanel.addEventListener('click', (e) => e.stopPropagation());

    selectEl.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            if (window.matchMedia("(hover: none)").matches && !selectEl.classList.contains('hover-ready')) {
                e.stopPropagation();
                return;
            }

            if (opt.classList.contains('disabled')) {
                selectEl.classList.remove('open');
                selectEl.classList.remove('hover-ready');
                clearTimeout(selectEl.hoverTimeout);
                updateBodyLock();
                return;
            }
            const val = opt.dataset.value;
            state.isStationFromGeo = false;
            if (state.geoClearTimeout) {
                clearTimeout(state.geoClearTimeout);
                state.geoClearTimeout = null;
            }
            setCustomSelectValue(selectEl, val, true, false);
            selectEl.classList.remove('open');
            selectEl.classList.remove('hover-ready');
            clearTimeout(selectEl.hoverTimeout);
            updateBodyLock();
            if (onChange) onChange(val);
        });
    });
}

export function toggleMoreTrains(btn) {
    const container = document.getElementById('hiddenTrainsContainer');
    if (!container || !btn) return;

    const isExpanding = !container.classList.contains('expanded');

    // Remove any existing transition listener to prevent conflicts
    if (container._transitionHandler) {
        container.removeEventListener('transitionend', container._transitionHandler);
    }

    if (isExpanding) {
        container.style.display = 'block';
        const targetHeight = container.scrollHeight;
        container.style.height = '0px';
        container.offsetHeight; // Force reflow
        container.style.height = targetHeight + 'px';
        container.classList.add('expanded');
        btn.classList.add('expanded');
        state.isListExpanded = true;

        container._transitionHandler = (e) => {
            if (e.propertyName === 'height') {
                if (container.classList.contains('expanded')) {
                    container.style.height = 'auto';
                }
            }
        };
        container.addEventListener('transitionend', container._transitionHandler, { once: true });
    } else {
        container.style.height = container.scrollHeight + 'px';
        container.offsetHeight; // Force reflow
        container.style.height = '0px';
        container.classList.remove('expanded');
        btn.classList.remove('expanded');
        state.isListExpanded = false;
    }
}

export function updateStationOrder() {
    const select = document.getElementById('stationSelect');
    const optionsContainer = select.querySelector('.custom-select-list');
    const paGrp = document.getElementById('pa-stations');
    const njGrp = document.getElementById('nj-stations');

    if (state.currentStation) {
        setCustomSelectValue(select, state.currentStation, true, state.isStationFromGeo);
    }

    const reverseOptions = (grp) => {
        const options = Array.from(grp.querySelectorAll('.custom-select-option'));
        options.reverse().forEach(opt => grp.appendChild(opt));
    };

    if (state.currentDirection === 'eastbound') {
        optionsContainer.appendChild(paGrp);
        optionsContainer.appendChild(njGrp);
        if (paGrp.dataset.reversed === "true") {
            reverseOptions(paGrp);
            reverseOptions(njGrp);
            paGrp.dataset.reversed = "false";
        }
    } else {
        optionsContainer.appendChild(njGrp);
        optionsContainer.appendChild(paGrp);
        if (paGrp.dataset.reversed !== "true") {
            reverseOptions(paGrp);
            reverseOptions(njGrp);
            paGrp.dataset.reversed = "true";
        }
    }
}

export function updateDestinationDropdown() {
    const destGroup = document.getElementById('destinationGroup');
    const destSelect = document.getElementById('destinationSelect');
    const optionsContainer = destSelect.querySelector('.custom-select-list');
    const destPaGrp = document.getElementById('dest-pa-stations');
    const destNjGrp = document.getElementById('dest-nj-stations');

    if (!state.currentStation || !state.currentDirection) {
        destGroup.style.display = 'none';
        return;
    }

    destGroup.style.display = '';

    let stationOrder;
    if (state.patcoData && state.patcoData.stations && state.patcoData.stations[state.currentDirection]) {
        stationOrder = state.patcoData.stations[state.currentDirection];
    } else {
        stationOrder = state.currentDirection === 'westbound' ? WB_ORDER : [...WB_ORDER].reverse();
    }

    const originIdx = stationOrder.indexOf(state.currentStation);

    const reverseOptions = (grp) => {
        const options = Array.from(grp.querySelectorAll('.custom-select-option'));
        options.reverse().forEach(opt => grp.appendChild(opt));
    };

    if (state.currentDirection === 'eastbound') {
        optionsContainer.appendChild(destPaGrp);
        optionsContainer.appendChild(destNjGrp);
        if (destPaGrp.dataset.reversed === "true") {
            reverseOptions(destPaGrp);
            reverseOptions(destNjGrp);
            destPaGrp.dataset.reversed = "false";
        }
    } else {
        optionsContainer.appendChild(destNjGrp);
        optionsContainer.appendChild(destPaGrp);
        if (destPaGrp.dataset.reversed !== "true") {
            reverseOptions(destPaGrp);
            reverseOptions(destNjGrp);
            destPaGrp.dataset.reversed = "true";
        }
    }

    const allOptions = destSelect.querySelectorAll('.custom-select-option[data-value]:not([data-value=""])');
    allOptions.forEach(opt => {
        const stIdx = stationOrder.indexOf(opt.dataset.value);
        if (opt.dataset.value === state.currentStation) {
            opt.classList.add('disabled', 'origin-station');
            opt.innerHTML = `<span>${opt.dataset.value}</span><span class="origin-badge">Origin</span>`;
        } else if (stIdx >= 0 && stIdx <= originIdx) {
            opt.classList.add('disabled');
            opt.classList.remove('origin-station');
            opt.textContent = opt.dataset.value;
        } else {
            opt.classList.remove('disabled', 'origin-station');
            opt.textContent = opt.dataset.value;
        }
    });

    if (state.currentDestination) {
        const destIdx = stationOrder.indexOf(state.currentDestination);
        if (destIdx > originIdx) {
            setCustomSelectValue(destSelect, state.currentDestination);
        } else {
            state.currentDestination = '';
            localStorage.removeItem('patco_destination');
            setCustomSelectValue(destSelect, '');
        }
    } else {
        setCustomSelectValue(destSelect, '');
    }

    const noDestOption = destSelect.querySelector('.custom-select-option[data-value=""]');
    const clearBtn = document.getElementById('clearDestination');
    clearBtn.style.opacity = state.currentDestination ? '1' : '0';
    clearBtn.style.pointerEvents = state.currentDestination ? '' : 'none';
    if (noDestOption) noDestOption.style.display = state.currentDestination ? 'none' : '';
}

export async function updateTrains(showLoading = false, skipAnimation = false) {
    const infoArea = document.getElementById('trainInfo');
    if (skipAnimation) {
        infoArea.classList.add('no-animate');
    } else {
        infoArea.classList.remove('no-animate');
    }
    if (!state.patcoData) {
        if (state.currentStation) {
            await setInfoHtml(`
            <div class="card loading">
                <div class="spinner"></div>
                <p>Fetching schedule data...</p>
            </div>
            `, skipAnimation);
        } else {
            infoArea.classList.add('no-animate');
            await setInfoHtml(`
            <div class="card loading">
                <p>Select a station to see train times</p>
            </div>
            `, true);
        }
        return;
    }

    if (!state.currentStation) {
        infoArea.classList.add('no-animate');
        await setInfoHtml(`
        <div class="card loading">
            <p>Select a station to see train times</p>
        </div>
    `, true);
        return;
    }

    if (showLoading) {
        const loadingText = !state.patcoData ? 'Fetching schedule data...' : 'Loading...';
        await setInfoHtml(`
        <div class="card loading">
            <div class="spinner"></div>
            <p>${loadingText}</p>
        </div>
    `, skipAnimation);
        return;
    }

    const eastbound = getNextTrainsForDirection(state.currentStation, 'eastbound');
    const westbound = getNextTrainsForDirection(state.currentStation, 'westbound');

    let eastColor = getDirColor(eastbound);
    let westColor = getDirColor(westbound);

    if (state.currentDestination) {
        const oppositeDir = state.currentDirection === 'eastbound' ? 'westbound' : 'eastbound';
        const swappedData = getNextTrainsForDirection(state.currentDestination, oppositeDir);
        if (oppositeDir === 'eastbound') {
            eastColor = getDirColor(swappedData);
        } else {
            westColor = getDirColor(swappedData);
        }
    }

    document.documentElement.style.setProperty('--east-color', eastColor);
    document.documentElement.style.setProperty('--west-color', westColor);

    const currentData = state.currentDirection === 'eastbound' ? eastbound : westbound;
    try {
        if (currentData) {
            await renderTrains(currentData, skipAnimation);
        } else {
            throw new Error('No service for this direction');
        }
    } catch (err) {
        await setInfoHtml(`
         <div class="card error">
             <p>Failed to load train times</p>
             <p style="font-size: 0.8rem; margin-top: 0.5rem;">${err.message}</p>
         </div>
         `, skipAnimation);
    }

}

export async function loadTrains(showLoading = true, skipAnimation = false) {
    await updateTrains(showLoading, skipAnimation);
}

export async function renderTrains(data, skipAnimation = false) {
    if (!data.trains || data.trains.length === 0) {
        document.title = "PATCO Schedule";
        await setInfoHtml(`
        <div class="card">
            <div class="loading">
                <p>No upcoming trains found</p>
            </div>
        </div>
    `, skipAnimation);
        return;
    }

    const next = data.trains[0];
    const upcoming = data.trains.slice(1);

    const currentTrainId = `${state.currentStation}-${state.currentDirection}-${next.time}`;
    if (state.lastNextTrainId && state.lastNextTrainId !== currentTrainId) {
        skipAnimation = false;
    }
    state.lastNextTrainId = currentTrainId;

    const getBadgeClass = (schedule) => {
        if (schedule.toLowerCase().includes('special')) return 'special';
        if (schedule === 'weekday') return 'weekday';
        if (schedule === 'sunday') return 'sunday';
        if (schedule === 'saturday') return 'weekend';
        return '';
    };
    const badgeClass = getBadgeClass(next.schedule);

    const countdownColor = getTimeColor(next.minutes);
    state.currentTrainColor = countdownColor;

    const isLongWait = next.minutes >= 60;

    if (isLongWait || state.isMobile) {
        document.title = "PATCO Schedule";
    } else {
        const timeText = next.minutes <= 1 ? "< 1 min" : `${next.minutes} mins`;
        document.title = `PATCO Schedule │ ${timeText}`;
    }

    let displayNextSchedule = next.schedule;
    if (displayNextSchedule.startsWith('Special (')) {
        displayNextSchedule = displayNextSchedule.replace('Special (', 'Special Schedule (').replace('-', '/').replace(/([(/])0/g, '$1');
    } else {
        displayNextSchedule = displayNextSchedule + (displayNextSchedule.toLowerCase().includes('schedule') ? '' : ' schedule');
    }

    let html = `
    <div class="card next-train-card">
        ${isLongWait ? `
            <p class="countdown-label">Next train at</p>
            <div class="countdown" style="color: ${countdownColor};">${formatTime(next.time)}</div>
            <div class="countdown-unit">${next.is_tomorrow ? 'tomorrow' : ''}</div>
            ${next.arrivalTime ? `
            <div class="next-arrival">
                ${next.arrivalTime === 'closed'
                    ? `<span class="arrival-dest">Destination: ${state.currentDestination} (closed)</span>`
                    : `arrives ${formatTime(next.arrivalTime)} <span class="arrival-dest">at ${state.currentDestination}</span>`
                }
            </div>
            ` : ''}
        ` : `
            <p class="countdown-label">Next train in</p>
            <div class="countdown" style="color: ${countdownColor};">${next.minutes <= 1 ? '< 1' : next.minutes}</div>
            <div class="countdown-unit">${next.minutes <= 1 ? 'minute' : 'minutes'}</div>
            <div class="next-time">
                ${formatTime(next.time)}${next.is_tomorrow ? ' <span style="color: var(--text-muted); font-size: 0.9rem;">(tomorrow)</span>' : ''}
            </div>
            ${next.arrivalTime ? `
            <div class="next-arrival">
                ${next.arrivalTime === 'closed'
                ? `<span class="arrival-dest">Destination: ${state.currentDestination} (closed)</span>`
                : `arrives ${formatTime(next.arrivalTime)} <span class="arrival-dest">at ${state.currentDestination}</span>`
            }
            </div>
            ` : ''}
        `}
        <div class="refresh-note">
            <div class="refresh-ring">
                <svg viewBox="0 0 20 20">
                    <circle class="bg" cx="10" cy="10" r="8"></circle>
                    <circle class="progress" cx="10" cy="10" r="8" stroke-dasharray="${CIRCUMFERENCE}" stroke-dashoffset="${CIRCUMFERENCE * (1 - state.refreshCountdown / 60)}" style="stroke: ${countdownColor}"></circle>
                </svg>
            </div>
            <span>Refreshing in <span id="refreshCountdown">${state.refreshCountdown}s</span></span>
        </div>
        ${next.schedule_url ? `<a href="${next.schedule_url}" target="_blank" class="schedule-badge ${badgeClass}">${displayNextSchedule} ↗</a>` : `<div class="schedule-badge ${badgeClass}">${displayNextSchedule}</div>`}
    </div>
`;

    if (upcoming.length > 0) {
        const initialCount = 5;
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
                        <span class="upcoming-time">${formatTime(train.time)}${train.arrivalTime ? ' <span class="arrival-time"><span class="arrival-arrow">→</span> ' + (train.arrivalTime === 'closed' ? '<span class="arrival-closed">Closed</span>' : '<span class="arrival-value">' + formatTime(train.arrivalTime) + '</span>') + '</span>' : ''}</span>
                        <span class="upcoming-tomorrow">${train.is_tomorrow && !tomorrowHeaderRendered && !next.is_tomorrow ? ' (tomorrow)' : ''}</span>
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
                <div class="expand-container ${state.isListExpanded ? 'expanded' : ''}" id="hiddenTrainsContainer" style="${state.isListExpanded ? 'height: auto; display: block;' : 'display: none;'}">
                    <ul class="upcoming-list" id="hiddenTrains">
                        ${renderInfos(hiddenTrains)}
                    </ul>
                </div>
                <button class="show-more-btn ${state.isListExpanded ? 'expanded' : ''}" id="toggleMoreBtn">
                    <span class="material-symbols-outlined">expand_more</span>
                </button>
            ` : ''}
        </div>
    `;
    }

    const currentActiveBtn = document.querySelector('.direction-btn.active');
    if (currentActiveBtn) {
        currentActiveBtn.style.transition = 'background 0.4s ease-out, color 0.4s ease-out';
        currentActiveBtn.style.background = countdownColor;
        setTimeout(() => currentActiveBtn.style.transition = '', 400);
    }

    document.documentElement.style.setProperty('--severity-color', countdownColor);

    await setInfoHtml(html, skipAnimation);

    // Add event listener for the toggle button after rendering
    const toggleBtn = document.getElementById('toggleMoreBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => toggleMoreTrains(toggleBtn));
    }
}

export function updateRefreshRing() {
    const progress = document.querySelector('.refresh-ring .progress');
    const countdownEl = document.getElementById('refreshCountdown');
    if (progress && countdownEl) {
        const offset = CIRCUMFERENCE * (1 - state.refreshCountdown / 60);
        progress.style.strokeDashoffset = offset;
        progress.style.stroke = state.currentTrainColor;
        countdownEl.textContent = state.refreshCountdown + 's';

        requestAnimationFrame(() => {
            progress.classList.add('animated');
        });
    }
}
