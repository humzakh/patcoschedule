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
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 0)
};
