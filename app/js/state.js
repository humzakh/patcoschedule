export const state = {
    currentStation: localStorage.getItem('patco_station') || '',
    currentDirection: localStorage.getItem('patco_direction') || 'eastbound',
    currentDestination: localStorage.getItem('patco_destination') || '',
    isStationFromGeo: false,
    geoClearTimeout: null,
    patcoData: null,
    lastFetchTime: 0,
    isListExpanded: false,
    refreshCountdown: 60 - new Date().getSeconds(),
    currentTrainColor: '#22c55e',
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 0),
    isUpdating: !!sessionStorage.getItem('patco_sw_updating')
};

// Clear the flag immediately so it doesn't persist across future reloads
if (state.isUpdating) {
    sessionStorage.removeItem('patco_sw_updating');
}
