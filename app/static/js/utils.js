export function getNYDate(date = new Date()) {
    return new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

export function parseTime(timeStr, nyDate, dayOffset = 0) {
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

export function getScheduleType(nyDate) {
    const day = nyDate.getDay();
    if (day === 6) return 'saturday';
    if (day === 0) return 'sunday';
    return 'weekday';
}

export function formatTime(timeStr) {
    if (!timeStr) return timeStr;
    return timeStr.replace(/([AP])$/, ' $1M');
}

export function formatMinutes(mins) {
    if (mins <= 1) return '< 1 minute';
    if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''}`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    if (remainingMins === 0) {
        return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    return `${hours} hr ${remainingMins} min`;
}

export function getTimeColor(mins, maxMins = 15) {
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

export function getDirColor(d) {
    if (!d || !d.trains || d.trains.length === 0) return '#22c55e';
    return getTimeColor(d.trains[0].minutes);
}
