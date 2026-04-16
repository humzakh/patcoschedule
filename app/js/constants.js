export const PA_STATIONS = [
    "15/16th & Locust",
    "12/13th & Locust",
    "9/10th & Locust",
    "8th & Market",
    "Franklin Square"
];

export const NJ_STATIONS = [
    "City Hall",
    "Broadway",
    "Ferry Avenue",
    "Collingswood",
    "Westmont",
    "Haddonfield",
    "Woodcrest",
    "Ashland",
    "Lindenwold"
];

export const WB_ORDER = [...NJ_STATIONS].reverse().concat([...PA_STATIONS].reverse());

export const STATION_LOCATIONS = {
    "15/16th & Locust": { lat: 39.948332, lon: -75.166838 },
    "12/13th & Locust": { lat: 39.948332, lon: -75.162000 },
    "9/10th & Locust": { lat: 39.948332, lon: -75.156828 },
    "8th & Market": { lat: 39.950794, lon: -75.153920 },
    "Franklin Square": { lat: 39.954707, lon: -75.151865 },
    "City Hall": { lat: 39.942360, lon: -75.122851 },
    "Broadway": { lat: 39.940801, lon: -75.120224 },
    "Ferry Avenue": { lat: 39.920038, lon: -75.101890 },
    "Collingswood": { lat: 39.914164, lon: -75.076899 },
    "Westmont": { lat: 39.907923, lon: -75.056910 },
    "Haddonfield": { lat: 39.898822, lon: -75.034220 },
    "Woodcrest": { lat: 39.882415, lon: -75.013444 },
    "Ashland": { lat: 39.866127, lon: -74.996116 },
    "Lindenwold": { lat: 39.821915, lon: -74.985611 }
};

export const DATA_REFRESH_INTERVAL = 15 * 60 * 1000;
export const REFRESH_INTERVAL = 60;
export const CIRCUMFERENCE = 2 * Math.PI * 8;
export const DATA_URL = 'https://raw.githubusercontent.com/humzakh/patcoschedule/data/patco_data.json';
