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

function interpolate(start, end, t) {
    return Math.round(start + (end - start) * t);
}

export function getTimeColor(mins, maxMins = 15) {
    if (mins > 60) return '#3b82f6'; // Blue for long waits
    
    if (mins > maxMins) {
        const t = (mins - maxMins) / (60 - maxMins);
        // Fade from Green (#22c55e: 34, 197, 94) to Forest Green (21, 128, 61)
        return `rgb(${interpolate(34, 21, t)}, ${interpolate(197, 128, t)}, ${interpolate(94, 61, t)})`;
    }
    
    if (mins <= 1) return '#ef4444'; // Red for imminent trains
    
    const ratio = mins / maxMins;
    if (ratio > 0.5) {
        const t = (ratio - 0.5) / 0.5;
        // Fade from Yellow (#eab308: 234, 179, 8) to Green (#22c55e: 34, 197, 94)
        return `rgb(${interpolate(234, 34, t)}, ${interpolate(179, 197, t)}, ${interpolate(8, 94, t)})`;
    } else {
        const t = ratio / 0.5;
        // Fade from Red (#ef4444: 239, 68, 68) to Yellow (#eab308: 234, 179, 8)
        return `rgb(${interpolate(239, 234, t)}, ${interpolate(68, 179, t)}, ${interpolate(68, 8, t)})`;
    }
}

export function getDirColor(d) {
    if (!d || !d.trains || d.trains.length === 0) return '#22c55e';
    return getTimeColor(d.trains[0].minutes);
}
