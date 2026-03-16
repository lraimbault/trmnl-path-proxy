const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { DateTime } = require('luxon');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Main PANYNJ RidePATH JSON endpoint
const PATH_API_URL = 'https://www.panynj.gov/bin/portauthority/ridepath.json';
const ALERTS_API_URL = 'https://www.panynj.gov/bin/portauthority/everbridge/incidents?status=All&department=Path';

// Fetch train times
app.get('/trmnl/path', async (req, res) => {
    try {
        const { station = 'GROVE_STREET', targets = '' } = req.query;
        
        // Users can optionally filter by passing targets=WTC,33RD_STREET
        const filterTargets = targets ? targets.toUpperCase().split(',') : [];

        // Let's create a map to normalized station keys
        const stationMap = {
            'grove_street': 'GRV',
            'newark': 'NWK',
            'journal_square': 'JSQ',
            'exchange_place': 'EXP',
            'newport': 'NEW',
            'hoboken': 'HOB',
            'world_trade_center': 'WTC',
            'christopher_street': 'CHR',
            'ninth_street': '09S',
            'onth_street': '09S', // common typo
            'fourteenth_street': '14S',
            'twenty_third_street': '23S',
            'thirty_third_street': '33S',
            'harrison': 'HAR'
        };

        const mappedStation = stationMap[station.toLowerCase()] || station.toUpperCase();

        const [response, alertsResponse] = await Promise.all([
            axios.get(PATH_API_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }),
            axios.get(ALERTS_API_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }).catch(e => ({ data: { data: [] } }))
        ]);

        const data = response.data;
        const results = data.results || [];
        
        const activeAlerts = (alertsResponse.data?.data || []).map(a => a.message || a.title);
        
        // Find our station
        const stationData = results.find(s => s.consideredStation === mappedStation);
        
        if (!stationData) {
            return res.status(404).json({ error: `Station ${mappedStation} not found` });
        }

        // Parse destinations and formats
        // We want the full human-readable names for the TRMNL Interface
        const humanNames = {
            'GRV': 'Grove Street',
            'NWK': 'Newark',
            'JSQ': 'Journal Square',
            'EXP': 'Exchange Place',
            'NEW': 'Newport',
            'HOB': 'Hoboken',
            'WTC': 'World Trade Center',
            'CHR': 'Christopher Street',
            '09S': '9th Street',
            '14S': '14th Street',
            '23S': '23rd Street',
            '33S': '33rd Street',
            'HAR': 'Harrison'
        };

        const groupedTrains = {};
        
        stationData.destinations.forEach(dest => {
            dest.messages.forEach(msg => {
                const trgt = msg.target.toUpperCase();
                if (filterTargets.length > 0 && !filterTargets.includes(trgt)) return;
                
                const arrivalMinutes = Math.floor(parseInt(msg.secondsToArrival) / 60);
                const humanTarget = humanNames[trgt] || msg.headSign || trgt;
                
                if (!groupedTrains[humanTarget]) {
                    groupedTrains[humanTarget] = {
                        target: humanTarget,
                        lineColor: msg.lineColor,
                        trains: []
                    };
                }
                
                groupedTrains[humanTarget].trains.push({
                    minutes: arrivalMinutes < 1 ? 'Now' : arrivalMinutes.toString(),
                    secondsToArrival: parseInt(msg.secondsToArrival)
                });
            });
        });

        const destinations = Object.values(groupedTrains).map(d => {
            d.trains.sort((a,b) => a.secondsToArrival - b.secondsToArrival);
            d.trains = d.trains.slice(0, 2); // Transit UX: Max 2 upcoming trains
            return d;
        });

        res.json({
            station_name: humanNames[stationData.consideredStation] || stationData.consideredStation,
            destinations: destinations,
            alerts: activeAlerts,
            last_updated: DateTime.now().setZone('America/New_York').toFormat('hh:mm a')
        });

    } catch (error) {
        console.error('Error fetching PATH data:', error.stack);
        res.status(500).json({ error: 'Failed to fetch PATH data' });
    }
});

app.listen(PORT, () => {
    console.log(`PATH TRMNL proxy server running on port ${PORT}`);
});
