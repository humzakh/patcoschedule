import { state } from './state.js';
import { STATION_LOCATIONS } from './constants.js';

export function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export function getNearestStation(lat, lon) {
    let nearest = null;
    let minDistance = Infinity;

    for (const [name, coords] of Object.entries(STATION_LOCATIONS)) {
        const dist = getDistance(lat, lon, coords.lat, coords.lon);
        if (dist < minDistance) {
            minDistance = dist;
            nearest = name;
        }
    }
    return nearest;
}

export function handleGeolocation(callbacks) {
    const { updateTrains, updateDestinationDropdown, setCustomSelectValue } = callbacks;
    
    const btn = document.getElementById('findMe');
    if (!navigator.geolocation) {
        const icon = btn.querySelector('.geo-icon');
        if (icon) icon.textContent = 'location_disabled';
        return;
    }

    let loadingTimeout = setTimeout(() => {
        btn.classList.add('geo-loading');
    }, 300);

    const icon = btn.querySelector('.geo-icon');
    if (icon) icon.textContent = 'location_searching';

    const options = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
    };

    const onSuccess = (position) => {
        clearTimeout(loadingTimeout);
        const { latitude, longitude } = position.coords;
        const nearest = getNearestStation(latitude, longitude);

        if (nearest) {
            state.currentStation = nearest;
            state.isStationFromGeo = true;
            localStorage.setItem('patco_station', state.currentStation);
            setCustomSelectValue(document.getElementById('stationSelect'), state.currentStation, true, true);

            updateDestinationDropdown();
            updateTrains(false);

            const icon = btn.querySelector('.geo-icon');
            if (icon) icon.textContent = 'my_location';

            if (state.geoClearTimeout) {
                clearTimeout(state.geoClearTimeout);
            }
            state.geoClearTimeout = setTimeout(() => {
                if (state.isStationFromGeo) {
                    state.isStationFromGeo = false;
                    const select = document.getElementById('stationSelect');
                    if (select.dataset.value === state.currentStation) {
                        setCustomSelectValue(select, state.currentStation, true, false);
                    }
                }
            }, 300000);
        }

        btn.classList.remove('geo-loading');
    };

    function showGeoToast() {
        const toast = document.getElementById('geoToast');
        if (!toast) return;

        toast.style.display = 'block';
        setTimeout(() => {
            toast.style.opacity = '1';
        }, 10);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                toast.style.display = 'none';
            }, 300);
        }, 3000);
    }

    const onError = (error) => {
        clearTimeout(loadingTimeout);
        console.warn("Geolocation error (trying fallback):", error);

        if (options.enableHighAccuracy) {
            options.enableHighAccuracy = false;
            options.timeout = 10000;
            navigator.geolocation.getCurrentPosition(onSuccess, (finalError) => {
                console.error("Geolocation final error:", finalError);
                btn.classList.remove('geo-loading');
                const icon = btn.querySelector('.geo-icon');
                if (icon) icon.textContent = 'location_disabled';
                showGeoToast();
            }, options);
        } else {
            btn.classList.remove('geo-loading');
            const icon = btn.querySelector('.geo-icon');
            if (icon) icon.textContent = 'location_disabled';
            showGeoToast();
        }
    };

    navigator.geolocation.getCurrentPosition(onSuccess, onError, options);
}
